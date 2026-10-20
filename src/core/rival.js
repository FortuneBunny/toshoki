// ライバル商家（台本付き）。少し古い相場をもとに、一番儲かりそうな品を運ぶ。
// 破産で止まらないよう、資金が尽きると一族から援助が入る。
import { GOODS } from '../data/goods.js';
import { TRANSPORTS } from '../data/transports.js';
import { quote, cityWants, midPrice } from './market.js';
import { findPath } from './caravan.js';
import { emit } from './events.js';

function bestPlan(world, r, m) {
  const here = world.cities[m.city];
  const cap = TRANSPORTS[m.transport].cap;
  let best = null;
  for (const to of Object.keys(world.cities)) {
    if (to === m.city) continue;
    const route = findPath(world, m.city, to, m.transport);
    if (!route) continue;
    const dest = world.cities[to];
    for (const id of r.goods || world.scenario.goods) {
      const stock = Math.floor(here.stock[id] || 0);
      if (stock < 3 || !cityWants(dest, id)) continue;
      const n = Math.min(stock, Math.floor(cap / GOODS[id].weight), Math.floor(r.silver / Math.max(1, midPrice(here, id) * 1.2)));
      if (n < 3) continue;
      const cost = quote(world, here, id, n);
      const gain = quote(world, dest, id, -n) * (r.skill ?? 0.85);
      const perDay = (gain - cost) / Math.max(1, route.days);
      if (perDay > 0 && (!best || perDay > best.perDay)) best = { to, id, n, perDay, days: route.days };
    }
  }
  return best;
}

export function updateRivals(world) {
  for (const r of world.rivals) {
    if (r.silver < 150) {
      r.silver += 400;
      emit(world, { type: 'rivalAid', text: `${r.name}は一族から援助を受けて持ち直した` });
    }
    for (const m of r.merchants) {
      if (m.travelDays > 0) {
        m.travelDays--;
        if (m.travelDays > 0) continue;
        // 到着して売る
        const city = world.cities[m.dest];
        m.city = m.dest;
        for (const [id, n] of Object.entries(m.cargo)) {
          const gain = cityWants(city, id) ? quote(world, city, id, -n) : 0;
          if (gain > 0) {
            city.stock[id] = (city.stock[id] || 0) + n;
            r.silver += gain;
            r.sold[id] = (r.sold[id] || 0) + n;
          }
        }
        m.cargo = {};
        m.wait = 1;
        continue;
      }
      if (m.wait > 0) { m.wait--; continue; }
      const plan = bestPlan(world, r, m);
      if (!plan) { m.wait = 3; continue; }
      const here = world.cities[m.city];
      const cost = quote(world, here, plan.id, plan.n);
      here.stock[plan.id] -= plan.n;
      r.silver -= cost;
      m.cargo = { [plan.id]: plan.n };
      m.dest = plan.to;
      m.travelDays = plan.days;
      m.from = m.city;
      m.departDay = world.day;
    }
  }
}
