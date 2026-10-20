// 町: 生産、消費、糖度、人口、シュガーラッシュとクラッシュ
import { GOODS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';
import { midPrice, targetStock } from './market.js';
import { jitter } from './rng.js';
import { emit } from './events.js';
import { districtProduction, staffing, housingCap, updateHousing, civicDemand, civicsIn, civicSatisfaction } from './district.js';
import { CIVICS } from '../data/district.js';
import { dwellingDemand, updateDwellingSat, dwellingStatus, assignDwelling } from './dwelling.js';
import { gainRep } from './trade.js';

export function cityTier(city) {
  let t = 0;
  for (let i = 0; i < B.tierPops.length; i++) if (city.pop >= B.tierPops[i]) t = i;
  return t;
}

export const tierName = (t) => B.tierNames[t];

// 1日の消費量の基準。withPrice=true なら価格による増減と、ラッシュとクラッシュも反映する。
export function dailyDemand(city, id, withPrice = true) {
  const g = GOODS[id];
  // 需要施設と住居が求める品は、町の段階が低くても需要がある
  const civic = civicDemand(city, id) + dwellingDemand(city, id, cityTier(city));
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
    const amount = rate * labor * mod * staff * jitter(world, B.productionNoise);
    city.stock[id] = (city.stock[id] || 0) + amount;
  }
}

function consume(world, city) {
  const need = glucoseNeed(city);
  // 主食と果実は、必要量 × 上限 まで食べる（多すぎる分は比例して減らす）
  const ids = world.scenario.goods;
  const foods = ids.filter((id) => GOODS[id].kind === 'food');
  const want = {};
  let wantGlu = 0;
  // 同じ食べ物だけでは糖度に上限がある（食卓の多様さが成長の鍵）
  const singleCap = (need * B.singleFoodCap);
  for (const id of foods) {
    const w = Math.min(city.stock[id] || 0, dailyDemand(city, id), singleCap / GOODS[id].glu);
    want[id] = w;
    wantGlu += w * GOODS[id].glu;
  }
  const scale = wantGlu > need * B.baseFoodCap ? (need * B.baseFoodCap) / wantGlu : 1;
  city.eatRatio = {};
  for (const id of foods) { const dd = dailyDemand(city, id); city.eatRatio[id] = dd > 0 ? Math.min(1, (city.stock[id] || 0) / dd) : 0; }
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
    const dmd = dailyDemand(city, id);
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
    const d = dailyDemand(city, id);
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
    emit(world, { type: 'rush', city: city.id, big: true, text: `${city.name}でシュガーラッシュ！甘味が飛ぶように売れる` });
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
  city.pop = Math.max(20, city.pop * (1 + growthRate(city)));
  // 住居の求める品が「1つ欠けまで」そろっていないと、新しい家は建たない（空き家は出る）
  const dw = dwellingStatus(city, cityTier(city));
  if (!dw.ok && !city.dwellWarned) {
    city.dwellWarned = true;
    emit(world, { type: 'dwelling', city: city.id, text: `${city.name}では新しい家が建たなくなった。住居が${dw.missing.map((g) => GOODS[g].name).join('・')}を求めている（1つ欠けまでそろえば建つ）` });
  } else if (dw.ok) city.dwellWarned = false;
  if (city.district) {
    const h = updateHousing(city, cityTier(city), dw.ok ? 1 : 0);
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

export function growthPerDay(city) {
  return growthRate(city);
}

// 人口の伸びを止めている一番の理由（初めての人向けの一言）
export function growthBlocker(world, city) {
  const tier = cityTier(city);
  if (city.crash > 0) return `シュガークラッシュ中（あと${city.crash}日）。終わるまで育たない`;
  if (city.district && city.pop >= housingCap(city, tier) * 0.98) {
    const dw = dwellingStatus(city, tier);
    if (!dw.ok) return `家が建たない。住居が${dw.missing.map((g) => GOODS[g].name).join('・')}を求めている`;
    return '家を建てる空き地がない（市場の圏を広げるか、施設を減らす）';
  }
  if (city.glucose < B.starveLine) return `糖度${Math.round(city.glucose)}で飢えている（40未満は人口が減る）。食べ物を届ける`;
  if (city.glucose < 75) {
    const missing = world.scenario.goods.filter((g) => GOODS[g].kind === 'food' && !(city.diet?.[g] > 0.05));
    return `糖度${Math.round(city.glucose)}。伸びはゆっくり（糖度が上がるほど速く育つ）。食卓にない食べ物を届ける${missing.length ? `: ${missing.slice(0, 3).map((g) => GOODS[g].name).join('・')}` : ''}`;
  }
  return null;
}
