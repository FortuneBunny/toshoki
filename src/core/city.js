// 町: 生産、消費、糖度、人口、シュガーラッシュとクラッシュ
import { GOODS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';
import { midPrice, targetStock } from './market.js';
import { jitter, inStream } from './rng.js';
import { emit, supplyWave, waveTrough } from './events.js';
import { districtProduction, staffing, housingCap, updateHousing, civicDemand, civicsIn, civicSatisfaction, wildDemand } from './district.js';
import { CIVICS } from '../data/district.js';
import { dwellingDemand, updateDwellingSat, dwellingStatus, assignDwelling } from './dwelling.js';
import { gainRep } from './trade.js';
import { shiftNotes } from './shifts.js';
import { blightNotes } from './blights.js';
import { festivalNotes, festivalOn } from './festivals.js';

export function cityTier(city) {
  let t = 0;
  for (let i = 0; i < B.tierPops.length; i++) if (city.pop >= B.tierPops[i]) t = i;
  return t;
}

export const tierName = (t) => B.tierNames[t];

// 1日の消費量の基準。withPrice=true なら価格による増減と、ラッシュとクラッシュも反映する。
// wild=false なら、野の需要施設の分を除く（町の人が食べる分だけ）
export function dailyDemand(city, id, withPrice = true, { wild = true } = {}) {
  const g = GOODS[id];
  // 需要施設と住居が求める品は、町の段階が低くても需要がある
  // 隊商市（予告された売り場の交代）が立っている町は、ふだん買わない品も買う
  const civic = civicDemand(city, id, { wild }) + dwellingDemand(city, id, cityTier(city)) + (city.fairDemand?.[id] || 0);
  if ((!g.rate || cityTier(city) < g.tier) && !civic) return 0;
  let d = (g.rate && cityTier(city) >= g.tier ? (g.rate * city.pop) / 1000 : 0) + civic;
  d *= city.demandMods?.[id] ?? 1;
  if (!withPrice) return d;
  if (g.kind === 'sweet') {
    if (city.civicSat?.teahouse) d *= 1 + 0.1 * city.civicSat.teahouse;
    if (city.rush > 0) d *= B.rushSweetDemand;
    if (city.crash > 0) d *= B.crashSweetDemand;
  }
  const p = midPrice(city, id);
  const e = Math.pow(g.base / p, B.consumeElasticity);
  // 甘味は安いとドカ食いされる（消費の上限が高い）
  const max = g.kind === 'sweet' ? B.sweetConsumeMax : B.consumeMax;
  return d * Math.min(max, Math.max(B.consumeMin, e));
}

// 大きな町ほど効率がよく、1人あたりの必要量は少しずつ減る
export function glucoseNeed(city) {
  const k = city.pop / 1000;
  return k * B.needPer1000 * Math.pow(Math.max(1, k), -B.cityEfficiency);
}

function produce(world, city) {
  if (city.district) city.produces = districtProduction(city);
  // 働き手が足りなければ、生産施設は比例して動きが落ちる
  const staff = city.district ? staffing(city) : 1;
  city.staffing = staff;
  const labor = Math.min(2, Math.max(0.5, Math.sqrt(city.pop / city.basePop)));
  for (const [id, rate] of Object.entries(city.produces || {})) {
    const cap = Math.max(20, dailyDemand(city, id, false) * B.stockCapDays, rate * 15);
    if ((city.stock[id] || 0) >= cap) continue;
    const mod = city.prodMods?.[id] ?? 1;
    const amount = rate * labor * mod * staff * inStream(world, `prod:${city.id}:${id}`, () => jitter(world, B.productionNoise));
    city.stock[id] = (city.stock[id] || 0) + amount;
  }
}

const NOWILD = { wild: false };
function consume(world, city) {
  const need = glucoseNeed(city);
  const ids = world.scenario.goods;
  // 野の需要施設（寺院・隊商宿・館）は、求める品を決まった量だけ買って使う。町の人の糖度には入らない
  city.wildEat = {};
  for (const id of ids) {
    const wd = wildDemand(city, id);
    if (!wd) continue;
    const p = midPrice(city, id);
    const want = wd * Math.min(B.consumeMax, Math.max(B.consumeMin, Math.pow(GOODS[id].base / p, B.consumeElasticity)));
    const eat = Math.min(city.stock[id] || 0, want);
    city.stock[id] = (city.stock[id] || 0) - eat;
    city.wildEat[id] = want > 0 ? eat / want : 0;
  }
  // 主食と果実は、必要量 × 上限 まで食べる（多すぎる分は比例して減らす）
  const foods = ids.filter((id) => GOODS[id].kind === 'food');
  const want = {};
  let wantGlu = 0;
  // 同じ食べ物だけでは糖度に上限がある（食卓の多様さが成長の鍵）
  const singleCap = (need * B.singleFoodCap);
  for (const id of foods) {
    const w = Math.min(city.stock[id] || 0, dailyDemand(city, id, true, NOWILD), singleCap / GOODS[id].glu);
    want[id] = w;
    wantGlu += w * GOODS[id].glu;
  }
  const scale = wantGlu > need * B.baseFoodCap ? (need * B.baseFoodCap) / wantGlu : 1;
  city.eatRatio = {};
  for (const id of foods) { const dd = dailyDemand(city, id, true, NOWILD); city.eatRatio[id] = dd > 0 ? Math.min(1, (city.stock[id] || 0) / dd) : 0; }
  let baseGlu = 0;
  city.diet = {};
  for (const id of foods) {
    const eat = want[id] * scale;
    city.stock[id] -= eat;
    baseGlu += eat * GOODS[id].glu;
    if (eat > 0) city.diet[id] = (eat * GOODS[id].glu) / Math.max(1e-9, need);
  }
  // 甘味はそれぞれの需要どおりに消費し、糖度を上乗せする
  let sweetGlu = 0;
  const gluEff = city.crash > 0 ? B.crashSweetGlu : 1;
  for (const id of ids) {
    if (GOODS[id].kind !== 'sweet') continue;
    // ドカ食い: 町が持ちたい量を超えた甘味は、毎日その一部が余分に食べられる
    const surplus = Math.max(0, (city.stock[id] || 0) - targetStock(city, id));
    const dmd = dailyDemand(city, id, true, NOWILD);
    const eat = Math.min(city.stock[id] || 0, dmd + surplus * B.sweetBinge * (city.crash > 0 ? 0.2 : 1));
    city.eatRatio[id] = dmd > 0 ? Math.min(1, eat / dmd) : 0;
    if (eat <= 0) continue;
    city.stock[id] -= eat;
    const add = Math.min(eat * GOODS[id].glu * gluEff, need * B.singleSweetCap);
    sweetGlu += add;
    city.diet[id] = (add * B.sweetGain) / Math.max(1e-9, need);
  }
  // 非糖の品は「暮らしの豊かさ」として成長倍率に効く
  let luxWant = 0;
  let luxGot = 0;
  for (const id of ids) {
    if (GOODS[id].kind !== 'goods') continue;
    const d = dailyDemand(city, id, true, NOWILD);
    if (d <= 0) continue;
    const eat = Math.min(city.stock[id] || 0, d);
    city.eatRatio[id] = Math.min(1, eat / d);
    city.stock[id] -= eat;
    luxWant += d * GOODS[id].base;
    luxGot += eat * GOODS[id].base;
  }
  city.luxury = luxWant > 0 ? luxGot / luxWant : 1;
  // 需要施設の満足度
  // 満足度は日々の値をならしたもの（続けて届けていると上がり、途切れると下がる）
  const prev = city.civicSat || {};
  city.civicSat = {};
  for (const b of civicsIn(city)) city.civicSat[b.type] = (prev[b.type] || 0) * 0.9 + civicSatisfaction(city, b.type, ids) * 0.1;
  if (city.civicSat.academy) city.luxury = Math.max(city.luxury, Math.min(1, city.luxury + 0.25 * city.civicSat.academy));
  city.sweetLevel = need > 0 ? (B.sweetGain * sweetGlu) / need : 0;
  const target = need > 0 ? 100 * (baseGlu / need) + 100 * B.sweetGain * (sweetGlu / need) : 0;
  city.glucoseTarget = Math.min(220, target);
  city.glucose += (city.glucoseTarget - city.glucose) * B.glucoseFollow;
  city.glucose = Math.max(0, Math.min(220, city.glucose));
}

function growthRate(city) {
  const G = city.glucose;
  if (city.crash > 0) return B.crashGrowth;
  let r;
  if (G < B.starveLine) r = B.growthStarve * ((B.starveLine - G) / B.starveLine);
  else if (G < B.stableTop) {
    // 糖度が低いうちはほとんど育たず、上がるほど加速する
    const t = (G - B.starveLine) / (B.stableTop - B.starveLine);
    r = B.growthStable[0] + (B.growthStable[1] - B.growthStable[0]) * t * t;
  } else {
    const t = Math.min(1, (G - B.stableTop) / (B.rushLine - B.stableTop));
    r = B.growthBoom[0] + (B.growthBoom[1] - B.growthBoom[0]) * t;
  }
  if (r > 0) r *= B.luxuryBase + B.luxurySpan * city.luxury;
  if (r > 0 && city.donatedUntil > (city.today ?? 0)) r *= B.donateGrowth;
  // 交易所（開いた町）は、食べ物を3種類以上届けていれば開拓の勢いで速く育つ
  if (r > 0 && city.founded && Object.values(city.diet || {}).filter((v) => v > 0.05).length >= 3) r *= B.postGrowth;
  // 住居の求める品が全部そろっていれば、暮らしに余裕が出て少し速く育つ
  if (r > 0) { const dw = dwellingStatus(city, cityTier(city)); if (dw.wants.length && !dw.missing.length) r *= B.dwellingFullGrowth; }
  // 需要施設: 求める品が届いているほど成長が加速
  if (r > 0 && city.civicSat) for (const [t, s] of Object.entries(city.civicSat)) r *= 1 + CIVICS[t].growth * s;
  // 住める人数の上限: 家が建つ場所がなければ、それ以上は増えない
  if (r > 0 && city.district && city.pop >= housingCap(city, cityTier(city))) r = 0;
  if (city.rush > 0) r += B.rushGrowthBonus;
  return r * (city.growthMod ?? 1);
}

function rushCycle(world, city) {
  if (city.rush > 0) {
    city.rush--;
    if (city.rush === 0) {
      city.crash = B.crashDays;
      emit(world, { type: 'crash', city: city.id, text: `${city.name}でシュガークラッシュ！甘味の需要が落ち込んだ` });
    }
    return;
  }
  if (city.crash > 0) {
    city.crash--;
    if (city.crash === 0) emit(world, { type: 'crashEnd', city: city.id, text: `${city.name}の糖の反動が収まった` });
    return;
  }
  if (city.glucose >= rushLineOf(world) && (city.sweetLevel || 0) >= B.rushSweetLine) {
    city.rush = B.rushDays;
    city.rushCount = (city.rushCount || 0) + 1;
    world.stats.rushes = (world.stats.rushes || 0) + 1;
    // 大祭の期間に始まったラッシュ（目標の during: 'festival' で数える）
    const fest = festivalOn(world, city.id);
    if (fest) city.festRushCount = (city.festRushCount || 0) + 1;
    emit(world, { type: 'rush', city: city.id, big: true, text: `${city.name}でシュガーラッシュ！甘味が飛ぶように売れる${fest ? '（大祭のラッシュ。目標に数える）' : world.scenario.festivals ? '（大祭の期間ではないので、目標には数えない）' : ''}` });
  }
}

export function updateCity(world, city) {
  city.today = world.day;
  // 寺院: 供物が届いていれば、評判が少しずつ上がる
  if (city.civicSat?.temple > 0.5 && world.day % 2 === 0) gainRep(world, 1);
  const before = cityTier(city);
  produce(world, city);
  consume(world, city);
  if (!city.dwellWants) assignDwelling(world, city);
  updateDwellingSat(city, cityTier(city));
  rushCycle(world, city);
  // 落ち着いた古い町（シナリオの定義の steady）は、人口が動かない。入荷の波がそのまま値の上下に出る
  // （s2 の琥珀京は、届いた食べ物で人口7000まで膨らみ、そのあと飢えた）
  if (!city.steady) city.pop = Math.max(20, city.pop * (1 + growthRate(city)));
  // 住居の求める品が「1つ欠けまで」そろっていないと、新しい家は建たない（空き家は出る）
  const dw = dwellingStatus(city, cityTier(city));
  // 知らせるのは60日に1回まで（行ったり来たりで何度も出ないように）
  if (!dw.ok && !city.dwellWarned && world.day - (city.dwellWarnDay ?? -99) >= 60) {
    city.dwellWarned = true;
    city.dwellWarnDay = world.day;
    emit(world, { type: 'dwelling', city: city.id, text: `${city.name}では家が建ちにくくなった。今足りない住居の品: ${dw.missing.map((g) => GOODS[g].name).join('・')}（家は5日に1軒しか建たない。求める品は ${dw.wants.map((g) => GOODS[g].name).join('・')}。1つ欠けまでそろえば建つ）` });
  } else if (dw.ok) city.dwellWarned = false;
  if (city.district) {
    // 品がそろわなくても、家は5日に1軒だけゆっくり建つ（完全に止めると、上手く運んでも抜け出せなくなるため）
    const h = updateHousing(city, cityTier(city), dw.ok || world.day % 5 === 0 ? 1 : 0);
    if (h.full && !city.housingWarned) {
      city.housingWarned = true;
      emit(world, { type: 'housingFull', city: city.id, bad: true, text: `${city.name}の市場の圏に、家を建てる空き地がない。人口が頭打ちになる（圏を広げるか、施設を減らす）` });
    } else if (!h.full && h.built > 0) city.housingWarned = false;
  }
  city.peakPop = Math.max(city.peakPop || 0, city.pop);
  for (const id of Object.keys(city.stock)) if (city.stock[id] < 0.001) city.stock[id] = 0;
  const after = cityTier(city);
  if (after > before) {
    emit(world, { type: 'tierUp', city: city.id, tier: after, big: true, text: `${city.name}が「${tierName(after)}」に成長した！` });
  } else if (after < before) {
    emit(world, { type: 'tierDown', city: city.id, tier: after, text: `${city.name}が「${tierName(after)}」に衰えた` });
  }
}

// 食卓の診断。届けると糖度が伸びる品と、その量の目安
// ラッシュに要る甘味の目安: 甘味2種類で、それぞれ1日何個（必要量の割合を半分ずつ）
// ラッシュが起きる糖度（シナリオで変えられる。s5 はラッシュが目標なので低め）
export function rushLineOf(world) {
  return world.scenario.rushLine ?? B.rushLine;
}

export function rushSweetPlan(world, city) {
  const need = glucoseNeed(city);
  const each = (B.rushSweetLine / 2) * need / B.sweetGain;
  return world.scenario.goods
    .filter((id) => GOODS[id].kind === 'sweet' && GOODS[id].glu && dailyDemand(city, id, false) > 0)
    .sort((a, b) => GOODS[b].glu - GOODS[a].glu)
    .slice(0, 3)
    .map((id) => ({ good: id, perDay: each / GOODS[id].glu }));
}

export function dietAdvice(world, city) {
  const need = glucoseNeed(city);
  const out = [];
  for (const id of world.scenario.goods) {
    const g = GOODS[id];
    if (!['food', 'sweet'].includes(g.kind) || !g.glu || dailyDemand(city, id, false) <= 0) continue;
    const cap = g.kind === 'food' ? B.singleFoodCap : B.singleSweetCap * B.sweetGain;
    const now = city.diet?.[id] || 0;
    const room = cap - now;
    if (room < 0.05) continue;
    const factor = g.kind === 'sweet' ? B.sweetGain * (city.crash > 0 ? B.crashSweetGlu : 1) : 1;
    out.push({ good: id, gain: Math.round(room * 100), perDay: (room * need) / (g.glu * factor), kind: g.kind });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

// 町のこれから（版4: 読む材料は相場の古さではなく、町の糖度の流れ）。相場の横に出す短い印
// kind: rush / crash / rushSoon / up / down / hungry
export function cityOutlook(world, city) {
  const out = [];
  const line = rushLineOf(world);
  if (city.rush > 0) out.push({ kind: 'rush', text: `🍬ラッシュ中（あと${city.rush}日）。甘味がよく売れる。終わるとクラッシュ` });
  else if (city.crash > 0) out.push({ kind: 'crash', text: `💥クラッシュ中（あと${city.crash}日）。甘味が売れにくく、町も育たない` });
  else if (city.glucose >= line - 15 && world.scenario.goods.some((g) => GOODS[g].kind === 'sweet')) {
    out.push({ kind: 'rushSoon', text: `🍬ラッシュ間近（糖度${Math.round(city.glucose)}・${line}で始まる）。甘味を2種類まとめて届けると始まり、甘味が高く売れる` });
  } else if (city.glucose >= line - 45 && world.scenario.goods.some((g) => GOODS[g].kind === 'sweet' && dailyDemand(city, g, false) > 0)) {
    // 食べ物だけでは「間近」の糖度に届かない。この印を待っていると、ラッシュが一度も起きなかった（18回目の Opus）
    out.push({ kind: 'rushSoon', text: `🍬甘味でラッシュに届く（糖度${Math.round(city.glucose)}・${line}で始まる。食べ物だけでは届かない。甘味を2種類まとめて届けると糖度が上がる）` });
  }
  const to = city.glucoseTarget ?? city.glucose;
  if (to - city.glucose > 3) out.push({ kind: 'up', text: `糖度 上向き（${Math.round(city.glucose)}→${Math.round(to)}）` });
  else if (to - city.glucose < -3) out.push({ kind: 'down', text: `糖度 下向き（${Math.round(city.glucose)}→${Math.round(to)}）。食べ物が足りなくなってきた` });
  // 食卓にない食べ物は、在庫が尽きていて高い。届ければ高く売れ、糖度も伸びる
  const missing = world.scenario.goods.filter((g) => GOODS[g].kind === 'food' && dailyDemand(city, g, false) > 0 && !((city.diet?.[g] || 0) > 0.05) && !((city.produces?.[g] || 0) > 0));
  if (missing.length) out.push({ kind: 'hungry', text: `食卓にない: ${missing.slice(0, 3).map((g) => GOODS[g].name).join('・')}（高く売れ、糖度も伸びる）` });
  // 古い町の食べ物の入荷の波: これから細る品と、戻る品
  const waves = world.scenario.cities?.find((x) => x.id === city.id)?.waves || {};
  for (const g of Object.keys(waves)) {
    const now = supplyWave(world, city.id, g);
    const soon = supplyWave(world, city.id, g, world.day + 10);
    const t = waveTrough(world, city.id, g);
    if (waves[g].demand) {
      if (soon < now - 0.05) out.push({ kind: 'down', text: `${GOODS[g].name}の需要が落ちていく（いちばん少ないのは約${t}日後。そのころ${GOODS[g].name}は安くしか売れない）` });
      else if (soon > now + 0.05) out.push({ kind: 'up', text: `${GOODS[g].name}の需要が戻ってくる（今${Math.round(now * 100)}%。これから${GOODS[g].name}が高く売れる）` });
      continue;
    }
    if (soon < now - 0.05) out.push({ kind: 'down', text: `${GOODS[g].name}の入荷が細っていく（いちばん少ないのは約${t}日後。そのころ${GOODS[g].name}が高くなる）` });
    else if (soon > now + 0.05) out.push({ kind: 'up', text: `${GOODS[g].name}の入荷が戻ってくる（今${Math.round(now * 100)}%。これから${GOODS[g].name}は安くなる）` });
  }
  // ライバルの隊商が、この町へ品を運んでいる（着くと、その品の値が下がる）。ライバルの動きも読む材料（柱1）
  for (const r of world.rivals || []) {
    for (const m of r.merchants) {
      if (!(m.travelDays > 0) || m.dest !== city.id) continue;
      const load = Object.entries(m.cargo || {}).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]);
      if (load.length) out.push({ kind: 'rival', text: `${r.name}の隊商が${load.slice(0, 2).map(([g, n]) => `${GOODS[g].name}${Math.floor(n)}`).join('・')}を積んで向かっている（あと約${m.travelDays}日。着くと値が下がる）` });
    }
  }
  out.unshift(...shiftNotes(world, city), ...blightNotes(world, city), ...festivalNotes(world, city));
  return out;
}

export function growthPerDay(city) {
  if (city.steady) return 0; // 人口が動かない古い町
  return growthRate(city);
}

// その品を作っている町（多い順）。住居の求める品などの「どこで手に入るか」の案内に使う
export function producersOf(world, good, exclude = null) {
  return Object.values(world.cities).filter((c) => c.id !== exclude && (c.produces?.[good] || 0) > 0).sort((a, b) => b.produces[good] - a.produces[good]);
}
const whereText = (world, goods, exclude) => goods.map((g) => { const p = producersOf(world, g, exclude).slice(0, 2); return p.length ? `${GOODS[g].name}は${p.map((c) => c.name).join('・')}で採れる` : null; }).filter(Boolean).join('、');

// 人口の伸びを止めている一番の理由（初めての人向けの一言）
export function growthBlocker(world, city) {
  const tier = cityTier(city);
  if (city.crash > 0) return `シュガークラッシュ中（あと${city.crash}日）。終わるまで育たない`;
  if (city.district && city.pop >= housingCap(city, tier) * 0.98) {
    const dw = dwellingStatus(city, tier);
    if (!dw.ok) { const w = whereText(world, dw.missing, city.id); return `家がゆっくりしか建たない（5日に1軒）。今足りない住居の品: ${dw.missing.map((g) => GOODS[g].name).join('・')}${w ? `（${w}）` : ''}`; }
    return '家を建てる空き地がない（市場の圏を広げるか、施設を減らす）';
  }
  if (city.glucose < B.starveLine) return `糖度${Math.round(city.glucose)}で飢えている（40未満は人口が減る）。食べ物を届ける`;
  if (city.glucose < 75) {
    const missing = world.scenario.goods.filter((g) => GOODS[g].kind === 'food' && !(city.diet?.[g] > 0.05));
    return `糖度${Math.round(city.glucose)}。伸びはゆっくり（糖度が上がるほど速く育つ）。食卓にない食べ物を届ける${missing.length ? `: ${missing.slice(0, 3).map((g) => GOODS[g].name).join('・')}` : ''}`;
  }
  return null;
}
