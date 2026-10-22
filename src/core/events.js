// 出来事: 通知、事件（飢饉・豊作・祭り・疫病・砂嵐・掘り出し物）、大口注文、噂
import { GOODS, GOOD_IDS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';
import { chance, pick, randInt, nextRandom } from './rng.js';
import { cityTier, dailyDemand } from './city.js';
import { midPrice } from './market.js';
import { TRANSPORTS } from '../data/transports.js';
import { isVisited } from './knowledge.js';
import { goodLocked } from './techs.js';
import { BUILDINGS } from '../data/buildings.js';

// 通知を積む。UI と CLI はここから演出を取り出す。
export function emit(world, ev) {
  const e = { day: world.day, ...ev };
  world.events.push(e);
  if (e.quiet) return e;
  world.log.push(e);
  if (world.log.length > 300) world.log.splice(0, world.log.length - 300);
  return e;
}

// 期限付きの補正を町に反映する
export function applyModifiers(world) {
  for (const c of Object.values(world.cities)) {
    c.prodMods = {};
    c.demandMods = { ...(world.scenario.demandScale || {}) }; // シナリオごとの需要の倍率（s7 の白糖など）
    // 技術で開く品は、だれかが技術を買うまで、どの町でも求められない（版4 H3）
    for (const g of world.scenario.goods) if (goodLocked(world, g)) c.demandMods[g] = 0;
    c.priceMods = {};
    c.growthMod = 1;
  }
  world.modifiers = world.modifiers.filter((m) => m.until > world.day);
  for (const m of world.modifiers) {
    const c = world.cities[m.city];
    if (!c) continue;
    if (m.kind === 'growth') {
      c.growthMod *= m.mult;
      continue;
    }
    const table = m.kind === 'prod' ? c.prodMods : m.kind === 'demand' ? c.demandMods : c.priceMods;
    for (const id of m.goods) table[id] = (table[id] ?? 1) * m.mult;
  }
}

const EVENT_TYPES = [
  {
    id: 'famine', weight: 3,
    fire(world, city) {
      const staples = Object.keys(city.produces).filter((id) => GOODS[id].kind === 'food');
      if (!staples.length) return null;
      world.modifiers.push({ city: city.id, kind: 'prod', goods: staples, mult: 0.25, until: world.day + 40 });
      return { type: 'famine', bad: true, text: `${city.name}で飢饉。食料の値が跳ね上がるだろう`, goods: staples };
    },
  },
  {
    id: 'harvest', weight: 3,
    fire(world, city) {
      const ids = Object.keys(city.produces);
      if (!ids.length) return null;
      const id = pick(world, ids);
      world.modifiers.push({ city: city.id, kind: 'prod', goods: [id], mult: 2.5, until: world.day + 30 });
      return { type: 'harvest', text: `${city.name}で${GOODS[id].name}が大豊作。安く仕入れる好機`, goods: [id] };
    },
  },
  {
    id: 'festival', weight: 3,
    fire(world, city) {
      if (cityTier(city) < 1) return null;
      const ids = GOOD_IDS.filter((id) => ['sweet', 'goods'].includes(GOODS[id].kind) && dailyDemand(city, id, false) > 0);
      if (!ids.length) return null;
      world.modifiers.push({ city: city.id, kind: 'demand', goods: ids, mult: 2.2, until: world.day + 15 });
      world.modifiers.push({ city: city.id, kind: 'price', goods: ids, mult: 1.25, until: world.day + 15 });
      return { type: 'festival', text: `${city.name}で婚礼の祭り。甘味と贅沢品の需要が高まる`, goods: ids };
    },
  },
  {
    // 流行: しばらくの間、ある町である品がよく売れる。定期便を組み替える理由になる
    id: 'fashion', weight: 3,
    fire(world, city) {
      const ids = world.scenario.goods.filter((id) => dailyDemand(city, id, false) > 0 && !(city.produces?.[id] > 0));
      if (!ids.length) return null;
      const id = pick(world, ids);
      world.modifiers.push({ city: city.id, kind: 'demand', goods: [id], mult: 2.5, until: world.day + 60 });
      world.modifiers.push({ city: city.id, kind: 'price', goods: [id], mult: 1.35, until: world.day + 60 });
      return { type: 'fashion', rare: true, text: `${city.name}で${GOODS[id].name}が大流行！60日ほど高く、たくさん売れる`, goods: [id] };
    },
  },
  {
    id: 'plague', weight: 1,
    fire(world, city) {
      if (city.pop < 600) return null;
      city.pop *= 0.88;
      world.modifiers.push({ city: city.id, kind: 'growth', goods: [], mult: 0.5, until: world.day + 30 });
      return { type: 'plague', bad: true, text: `${city.name}に疫病。人口が減った` };
    },
  },
  {
    id: 'windfall', weight: 2,
    fire(world, city) {
      const all = GOOD_IDS.filter((id) => ['luxury', 'trade'].includes(GOODS[id].cat) && GOODS[id].tier <= 3);
      // そのシナリオで扱う品だけ（扱わない品の噂は行動につながらない）
      const ids = all.filter((id) => world.scenario.goods.includes(id));
      if (!ids.length) return null;
      const id = pick(world, ids);
      const qty = randInt(world, 6, 14);
      city.stock[id] = (city.stock[id] || 0) + qty * 3;
      return { type: 'windfall', rare: true, text: `${city.name}の市場に${GOODS[id].name}の掘り出し物が大量に出た`, goods: [id] };
    },
  },
  {
    id: 'sandstorm', weight: 2,
    fire(world, city) {
      const edges = world.edges.filter((e) => e.kind === 'desert' && (e.a === city.id || e.b === city.id));
      if (!edges.length) return null;
      const [x, y] = world.grid.cityTiles[city.id];
      world.storms = (world.storms || []).filter((s) => s.until > world.day);
      world.storms.push({ x, y, r: 14, until: world.day + 8 });
      return { type: 'sandstorm', bad: true, text: `${city.name}周辺の砂漠で砂嵐。8日間、砂漠の道は進みが遅い` };
    },
  },
];

function rollEvent(world) {
  if (!world.scenario.events || !chance(world, B.eventChancePerDay)) return;
  const pool = EVENT_TYPES.filter((t) => !world.scenario.disabledEvents?.includes(t.id));
  const total = pool.reduce((s, t) => s + t.weight, 0);
  let r = nextRandom(world) * total;
  let type = pool[0];
  for (const t of pool) {
    r -= t.weight;
    if (r <= 0) { type = t; break; }
  }
  const city = pick(world, Object.values(world.cities));
  const ev = type.fire(world, city);
  if (!ev) return;
  ev.city = city.id;
  // 事件は噂として届く。近くにいれば即座、遠ければ遅れて届く
  queueNews(world, city.id, ev);
}

// 町までの距離に応じて、知らせを遅らせる
export function queueNews(world, cityId, ev) {
  const delay = newsDelay(world, cityId);
  if (delay <= 0) emit(world, ev);
  else world.newsQueue.push({ at: world.day + delay, ev });
}

export function newsDelay(world, cityId) {
  // 一度訪れた町と自分の交易所の出来事は、すぐに分かる（相場もいつも最新のため）
  if (world.cities[cityId]?.founded || isVisited(world, cityId)) return 0;
  let best = Infinity;
  for (const m of world.player.merchants) {
    const here = m.travel ? null : m.city;
    if (here === cityId) return 0;
    const from = here ?? m.travel.to;
    const d = world.hopDistance[from]?.[cityId] ?? 99;
    best = Math.min(best, d);
  }
  return Math.max(1, Math.round(best * (world.scenario.newsDaysPerHop ?? 4)));
}

function deliverNews(world) {
  const due = world.newsQueue.filter((n) => n.at <= world.day);
  world.newsQueue = world.newsQueue.filter((n) => n.at > world.day);
  for (const n of due) emit(world, { ...n.ev, news: true, text: `【噂】${n.ev.text}` });
}

// 大口注文: 期限内に指定数を売ると、代金とは別に報酬が出る
function rollContract(world) {
  if (!world.scenario.contracts || !chance(world, B.contractChancePerDay)) return;
  if (world.contracts.filter((c) => !c.done && !c.failed).length >= 3) return;
  const cities = Object.values(world.cities).filter((c) => cityTier(c) >= 1 || world.scenario.contractsAnyTier);
  if (!cities.length) return;
  const city = pick(world, cities);
  const obtainable = (id) => Object.values(world.cities).some((c) => c.produces?.[id] > 0) || (world.scenario.buildings || []).some((b) => BUILDINGS[b]?.recipes?.some((r) => r.out[id]));
  const ids = world.scenario.goods.filter((id) => dailyDemand(city, id, false) > 0 && !(city.produces?.[id] > 0) && obtainable(id));
  if (!ids.length) return;
  const id = pick(world, ids);
  // 産地として挙げるのは、地元の消費より多く作っている町だけ（仕入れられる見込みのある町）
  const where = Object.values(world.cities).filter((c) => (c.produces?.[id] || 0) > dailyDemand(c, id, false) * 1.1).map((c) => c.name);
  const capTotal = world.player.merchants.reduce((s, m) => s + TRANSPORTS[m.transport].cap, 0);
  const qty = Math.max(5, Math.min(Math.round(capTotal * 0.8), Math.round((randInt(world, 15, 40) * 10) / Math.max(4, GOODS[id].base))));
  // 一番近い商人から往復できる日数 + 余裕
  let near = 99;
  for (const m of world.player.merchants) {
    const from = m.travel ? m.travel.to : m.city;
    near = Math.min(near, (world.hopDistance[from]?.[city.id] ?? 4) * 9);
  }
  const days = Math.max(randInt(world, 25, 45), near * 2 + 12);
  const reward = Math.round(qty * GOODS[id].base * 0.8 + 40);
  const c = { id: world.nextId++, city: city.id, good: id, qty, delivered: 0, deadline: world.day + days, reward };
  world.contracts.push(c);
  emit(world, { type: 'contract', city: city.id, contract: c.id, rare: true, text: `大口注文: ${city.name}が${GOODS[id].name}を${qty}個求めている（${days}日以内、報酬 ${reward} 銀）。${city.name}でこの品を売れば数に入る。${where.length ? `仕入れられそうな町: ${where.join('、')}` : '余って売られている町は少ない（工房でつくるか、産地の在庫を待つ）'}` });
}

function expireContracts(world) {
  for (const c of world.contracts) {
    if (!c.done && !c.failed && world.day > c.deadline) {
      c.failed = true;
      emit(world, { type: 'contractFail', city: c.city, bad: true, text: `${world.cities[c.city].name}の大口注文（${GOODS[c.good].name}）は期限切れになった` });
    }
  }
}

// 噂: ランダムな町の相場の一部が、少し古い情報として届く
function rollRumor(world) {
  if (!chance(world, B.rumorChancePerDay)) return;
  const city = pick(world, Object.values(world.cities));
  const known = world.player.knowledge[city.id];
  if (known && world.day - known.day < 6) return;
  const ids = world.scenario.goods.filter((id) => (city.stock[id] || 0) > 0 || dailyDemand(city, id, false) > 0);
  if (!ids.length) return;
  const id = pick(world, ids);
  const price = midPrice(city, id);
  const delay = newsDelay(world, city.id);
  const entry = world.player.knowledge[city.id] || { day: -999, prices: {}, stock: {}, partial: true };
  entry.prices[id] = price;
  entry.priceDay = entry.priceDay || {};
  entry.priceDay[id] = world.day - delay;
  world.player.knowledge[city.id] = entry;
  const g = GOODS[id];
  const tone = price > g.base * 1.4 ? '高値' : price < g.base * 0.7 ? '安値' : '平常';
  emit(world, { type: 'rumor', city: city.id, text: `【噂】${city.name}では${g.name}が${tone}らしい（約${price.toFixed(1)}銀、${delay}日前の話）` });
}

export function updateEvents(world) {
  deliverNews(world);
  rollEvent(world);
  rollContract(world);
  expireContracts(world);
  rollRumor(world);
}
