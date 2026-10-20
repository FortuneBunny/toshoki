// 相場の知識。商人がいる町の相場だけが最新になり、ほかの町の情報は時間とともに古くなる。
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
  world.player.knowledge[cityId] = { day: world.day, prices, stock, wants, history, glucose: city.glucose, pop: city.pop };
}

export function observePresent(world) {
  const here = new Set();
  for (const m of world.player.merchants) if (!m.travel) here.add(m.city);
  for (const id of here) observe(world, id);
  // 情報網の技術: 一定日数ごとに遠くの町の相場が（古いまま）届く
  const net = world.scenario.infoNetwork;
  if (net && world.day % net.every === 0) {
    for (const id of Object.keys(world.cities)) if (!here.has(id)) observe(world, id);
  }
}

// その町についての知識の古さ（日）
export function knowledgeAge(world, cityId) {
  const k = world.player.knowledge[cityId];
  if (!k || k.day < 0) return null;
  return world.day - k.day;
}
