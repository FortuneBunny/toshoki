import { growthBlocker, growthPerDay } from './city.js';
// 相場の知識。一度訪れた町と自分の交易所は、いつでも最新の様子が分かる（版4。読むのは相場の古さではなく、町の糖度の流れ）。
// まだ訪れていない町は、噂で値の一部が届くだけ。
import { midPrice, cityWants } from './market.js';

export function observe(world, cityId) {
  const city = world.cities[cityId];
  const prices = {};
  const stock = {};
  const wants = {};
  for (const id of world.scenario.goods) {
    prices[id] = midPrice(city, id);
    stock[id] = Math.floor(city.stock[id] || 0);
    wants[id] = cityWants(city, id);
  }
  const prev = world.player.knowledge[cityId];
  const history = prev?.history || {};
  for (const id of world.scenario.goods) {
    const h = (history[id] = history[id] || []);
    if (!h.length || h[h.length - 1][0] !== world.day) h.push([world.day, prices[id]]);
    if (h.length > 40) h.splice(0, h.length - 40);
  }
  world.player.knowledge[cityId] = { day: world.day, prices, stock, wants, history, glucose: city.glucose, pop: city.pop, diet: { ...(city.diet || {}) }, sweetLevel: city.sweetLevel || 0, blocker: growthBlocker(world, city), growth: growthPerDay(city) };
}

export function observePresent(world) {
  const here = new Set();
  for (const m of world.player.merchants) if (!m.travel) here.add(m.city);
  // 自分の交易所と、一度訪れた町は、いつでも様子が分かる
  for (const c of Object.values(world.cities)) if (c.founded || isVisited(world, c.id)) here.add(c.id);
  for (const id of here) if (world.cities[id]) observe(world, id);
}

// 一度訪れた（相場を見た）町か。噂で値の一部を聞いただけの町は含めない
export function isVisited(world, cityId) {
  const k = world.player.knowledge[cityId];
  return !!k && !k.partial && k.day >= 0;
}

// その町についての知識の古さ（日）
export function knowledgeAge(world, cityId) {
  const k = world.player.knowledge[cityId];
  if (!k || k.day < 0) return null;
  return world.day - k.day;
}
