// 町: 生産、消費、糖度、人口、シュガーラッシュとクラッシュ
import { GOODS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';
import { midPrice } from './market.js';
import { jitter } from './rng.js';
import { emit } from './events.js';

export function cityTier(city) {
  let t = 0;
  for (let i = 0; i < B.tierPops.length; i++) if (city.pop >= B.tierPops[i]) t = i;
  return t;
}

export const tierName = (t) => B.tierNames[t];

// 1日の消費量の基準。withPrice=true なら価格による増減と、ラッシュとクラッシュも反映する。
export function dailyDemand(city, id, withPrice = true) {
  const g = GOODS[id];
  if (!g.rate || cityTier(city) < g.tier) return 0;
  let d = (g.rate * city.pop) / 1000;
  d *= city.demandMods?.[id] ?? 1;
  if (!withPrice) return d;
  if (g.kind === 'sweet') {
    if (city.rush > 0) d *= B.rushSweetDemand;
    if (city.crash > 0) d *= B.crashSweetDemand;
  }
  const p = midPrice(city, id);
  const e = Math.pow(g.base / p, B.consumeElasticity);
  return d * Math.min(B.consumeMax, Math.max(B.consumeMin, e));
}

export function glucoseNeed(city) {
  return (city.pop / 1000) * B.needPer1000;
}

function produce(world, city) {
  const labor = Math.min(2, Math.max(0.5, Math.sqrt(city.pop / city.basePop)));
  for (const [id, rate] of Object.entries(city.produces || {})) {
    const cap = Math.max(20, dailyDemand(city, id, false) * B.stockCapDays, rate * 15);
    if ((city.stock[id] || 0) >= cap) continue;
    const mod = city.prodMods?.[id] ?? 1;
    const amount = rate * labor * mod * jitter(world, B.productionNoise);
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
    const eat = Math.min(city.stock[id] || 0, dailyDemand(city, id));
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
    city.stock[id] -= eat;
    luxWant += d * GOODS[id].base;
    luxGot += eat * GOODS[id].base;
  }
  city.luxury = luxWant > 0 ? luxGot / luxWant : 1;
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
  if (city.glucose >= B.rushLine && (city.sweetLevel || 0) >= B.rushSweetLine) {
    city.rush = B.rushDays;
    city.rushCount = (city.rushCount || 0) + 1;
    world.stats.rushes = (world.stats.rushes || 0) + 1;
    emit(world, { type: 'rush', city: city.id, big: true, text: `${city.name}でシュガーラッシュ！甘味が飛ぶように売れる` });
  }
}

export function updateCity(world, city) {
  const before = cityTier(city);
  produce(world, city);
  consume(world, city);
  rushCycle(world, city);
  city.pop = Math.max(20, city.pop * (1 + growthRate(city)));
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
