// 到着時の処理と定期便（自動化）
// order = { stops: [{ city, sell: [{ good, min }], buy: [{ good, qty, max }], unload: [good], load: [good] }], next: 0, paused: false }
import { GOODS } from '../data/goods.js';
import { emit } from './events.js';
import { observe } from './knowledge.js';
import { executeTrade, moveWarehouse } from './trade.js';
import { quote, cityWants } from './market.js';
import { cargoUsed, cargoCap, startTravel } from './caravan.js';

export function arriveAt(world, m) {
  observe(world, m.city);
  world.stats.trips += 1;
  if (m.order && !m.order.paused) {
    runOrder(world, m);
    return;
  }
  emit(world, { type: 'arrive', merchant: m.id, city: m.city, text: `${m.name}が${world.cities[m.city].name}に到着した` });
}

export function runOrder(world, m) {
  const o = m.order;
  const stop = o.stops[o.next];
  const city = world.cities[m.city];
  const notes = [];
  if (stop && stop.city === m.city) {
    for (const good of stop.unload || []) {
      if (m.cargo[good]) moveWarehouse(world, m, good, -m.cargo[good]);
    }
    // 売り: 最低価格を下回るなら売らずに持ち越す（赤字売りを防ぐ）
    for (const s of stop.sell || []) {
      const have = m.cargo[s.good] || 0;
      if (!have || !cityWants(city, s.good)) continue;
      let n = have;
      while (n > 0 && quote(world, city, s.good, -n) / n < (s.min || 0)) n = Math.floor(n * 0.7);
      if (n <= 0) { notes.push(`${GOODS[s.good].name}は安いので見送り`); continue; }
      executeTrade(world, m, [{ good: s.good, qty: -n }], { auto: true });
    }
    for (const good of stop.load || []) {
      const wh = world.player.warehouses[m.city];
      const have = Math.floor(wh?.stock[good] || 0);
      const room = Math.floor((cargoCap(m) - cargoUsed(m)) / GOODS[good].weight);
      const n = Math.min(have, room);
      if (n > 0) moveWarehouse(world, m, good, n);
    }
    // 買い: 上限価格を超えない範囲で、指定数まで
    for (const b of stop.buy || []) {
      const room = Math.floor((cargoCap(m) - cargoUsed(m)) / GOODS[b.good].weight);
      const want = Math.max(0, b.qty - (m.cargo[b.good] || 0));
      let n = Math.min(room, want, Math.floor(city.stock[b.good] || 0));
      while (n > 0 && (quote(world, city, b.good, n) / n > (b.max || Infinity) || quote(world, city, b.good, n) > world.player.silver)) n = Math.floor(n * 0.7);
      if (n <= 0) { if (want > 0) notes.push(`${GOODS[b.good].name}は高いので見送り`); continue; }
      executeTrade(world, m, [{ good: b.good, qty: n }], { auto: true });
    }
    o.next = (o.next + 1) % o.stops.length;
  }
  if (notes.length) emit(world, { type: 'orderNote', merchant: m.id, city: m.city, text: `${m.name}（定期便）: ${notes.join('、')}` });
  const target = o.stops[o.next].city;
  if (target === m.city) return;
  const res = departWithExpectation(world, m, target);
  if (!res.ok) {
    o.paused = true;
    emit(world, { type: 'orderStuck', merchant: m.id, bad: true, text: `${m.name}の定期便が止まった: ${res.error}` });
  }
}

// 出発時に「行き先の相場をどう読んでいたか」を記録する（読み的中の判定に使う）
export function departWithExpectation(world, m, to) {
  const k = world.player.knowledge[to];
  const prices = {};
  if (k) for (const id of Object.keys(m.cargo)) if (k.prices?.[id] !== undefined) prices[id] = k.prices[id];
  const res = startTravel(world, m, to);
  if (res.ok) m.expected = { city: to, prices, day: world.day };
  return res;
}

export function validateOrder(world, order) {
  if (!order?.stops?.length || order.stops.length < 2) return '停泊地は2つ以上必要';
  for (const s of order.stops) {
    if (!world.cities[s.city]) return `不明な町: ${s.city}`;
    for (const x of [...(s.sell || []), ...(s.buy || [])]) if (!GOODS[x.good]) return `不明な品物: ${x.good}`;
  }
  return null;
}
