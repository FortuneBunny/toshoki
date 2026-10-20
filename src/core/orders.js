import { dailyDemand } from './city.js';
import { canBuyTransportAt, buyTransport } from './actions.js';
// 到着時の処理と定期便（自動化）
// order = { stops: [{ city, sell: [{ good, min }], buy: [{ good, qty, max }], unload: [good], load: [good] }], next: 0, paused: false }
import { GOODS } from '../data/goods.js';
import { emit } from './events.js';
import { observe } from './knowledge.js';
import { executeTrade, moveWarehouse } from './trade.js';
import { quote, cityWants } from './market.js';
import { cargoUsed, cargoCap, startTravel, findPath, edgeDays, foodNeeded } from './caravan.js';
import { PROVISIONS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';

export function arriveAt(world, m) {
  observe(world, m.city);
  world.stats.trips += 1;
  if (m.order?.pauseNext && (m.order.pauseNext === true || m.order.pauseNext === m.city)) {
    m.order.pauseNext = false;
    runOrder(world, m, { depart: false });
    m.order.paused = true;
    emit(world, { type: 'arrive', merchant: m.id, city: m.city, text: `${m.name}が${world.cities[m.city].name}に到着し、定期便を止めた（売買は済ませた）` });
    return;
  }
  // 予約した輸送手段の買い替え（買える町に着いたら）
  if (m.pendingTransport && canBuyTransportAt(world, world.cities[m.city], m.pendingTransport)) {
    const t = m.pendingTransport;
    const r = buyTransport(world, m.id, t);
    m.pendingTransport = null;
    emit(world, { type: 'transportBought', merchant: m.id, text: r.ok ? `${m.name}が予約どおり輸送手段を買い替えた` : `${m.name}の輸送手段の買い替えは見送った: ${r.error}` });
  }
  if (m.order && !m.order.paused) {
    m.order.runs = (m.order.runs || 0) + 1;
    // 定期便が2つの町の間を走った回数（目標「結ぶ」用）。途中で別の町に寄っても、a と b を行き来すれば1回。
    // 商人ごとに覚えるので、定期便を設定し直しても数は消えない
    world.stats.legs = world.stats.legs || {};
    for (const g of world.scenario.goals || []) {
      if (g.type !== 'link' || (m.city !== g.a && m.city !== g.b)) continue;
      const k = [g.a, g.b].sort().join('|');
      m.linkSeen = m.linkSeen || {};
      const other = m.city === g.a ? g.b : g.a;
      if (m.linkSeen[k] === other) world.stats.legs[k] = (world.stats.legs[k] || 0) + 1;
      m.linkSeen[k] = m.city;
    }
    emit(world, { type: 'orderArrive', merchant: m.id, city: m.city, quiet: true, text: `${m.name}（定期便）が${world.cities[m.city].name}に着いた` });
    runOrder(world, m);
    return;
  }
  emit(world, { type: 'arrive', merchant: m.id, city: m.city, text: `${m.name}が${world.cities[m.city].name}に到着した` });
}

export function runOrder(world, m, { depart = true } = {}) {
  const o = m.order;
  const stop = o.stops[o.next];
  const city = world.cities[m.city];
  const notes = [];
  if (stop && stop.city === m.city) {
    for (const good of stop.unload || []) {
      if (m.cargo[good]) moveWarehouse(world, m, good, -m.cargo[good]);
    }
    for (const item of stop.load || []) {
      // load:品*上限 で、積む数に上限をつけられる（仕入れの分の荷台を空けておく）
      const [good, cap] = String(item).split('*');
      const wh = world.player.warehouses[m.city];
      const have = Math.floor(wh?.stock[good] || 0);
      const room = Math.floor((cargoCap(m) - cargoUsed(m)) / GOODS[good].weight);
      const limit = cap ? Math.max(0, Number(cap) - (m.cargo[good] || 0)) : Infinity;
      const n = Math.min(have, room, limit);
      if (n > 0) moveWarehouse(world, m, good, n);
    }
    // どの停泊地でも扱わない積荷（定期便を組み替える前の残りなど）は、買い取る町で売る（砂漠の食料は残す）
    const handled = new Set(o.stops.flatMap((st) => [...(st.sell || []).map((x) => x.good), ...(st.unload || []), ...(st.buy || []).map((x) => x.good), ...(st.load || []).map((x) => String(x).split('*')[0])]));
    for (const good of Object.keys(m.cargo)) {
      if (handled.has(good) || PROVISIONS.includes(good) || !cityWants(city, good)) continue;
      executeTrade(world, m, [{ good, qty: -m.cargo[good] }], { auto: true });
      notes.push(`便で扱わない${GOODS[good].name}を売り払った`);
    }
    // 売り: 最低価格を下回るなら売らずに持ち越す（赤字売りを防ぐ）
    for (const s of stop.sell || []) {
      const have = (m.cargo[s.good] || 0) - (s.keep || 0);
      if (have <= 0 || !cityWants(city, s.good)) continue;
      let n = have;
      while (n > 0 && quote(world, city, s.good, -n) / n < (s.min || 0)) n = Math.floor(n * 0.7);
      if (n <= 0) { notes.push(`${GOODS[s.good].name}は売値 ${(quote(world, city, s.good, -1)).toFixed(2)} が最低売値 ${s.min} を下回るので売らずに持ち越し`); continue; }
      executeTrade(world, m, [{ good: s.good, qty: -n }], { auto: true });
    }
    // 次の区間で砂漠を渡るなら、食料の分の積載と銀を空けておく（品物で積荷が埋まって飢えないように）
    const nextCity = o.stops[(o.next + 1) % o.stops.length].city;
    const food = PROVISIONS.includes(stop.buy?.[0]?.good) ? 0 : foodNeed(world, m, nextCity);
    // 買い: 上限価格を超えない範囲で、指定数まで
    for (const b of stop.buy || []) {
      const reserve = PROVISIONS.includes(b.good) ? 0 : food;
      const room = Math.floor((cargoCap(m) - cargoUsed(m) - reserve) / GOODS[b.good].weight);
      const want = Math.max(0, b.qty - (m.cargo[b.good] || 0));
      // 食べ物は、その町が2日に食べる分を残して買う（定期便の買い占めで町が飢えないように）
      const keepForTown = GOODS[b.good].kind === 'food' ? Math.ceil(dailyDemand(city, b.good, false) * 2) : 0;
      let n = Math.min(room, want, Math.max(0, Math.floor((city.stock[b.good] || 0) - keepForTown)));
      // 手元に残す銀（定期便ごと。最初は50）。砂漠の食料だけは残す銀を割っても買う
      const budget = world.player.silver - (PROVISIONS.includes(b.good) ? 0 : (o.reserve ?? 0));
      while (n > 0 && (quote(world, city, b.good, n) / n > (b.max || Infinity) || quote(world, city, b.good, n) > budget)) n = Math.floor(n * 0.7);
      if (n <= 0) {
        if (want > 0) {
          const unit = quote(world, city, b.good, 1);
          notes.push(!(city.stock[b.good] >= 1) ? `${GOODS[b.good].name}は${city.name}に在庫がない` : unit > (b.max || Infinity) ? `${GOODS[b.good].name}は買値 ${unit.toFixed(2)} が上限 ${b.max} を超えるので買わない` : room <= 0 ? `${GOODS[b.good].name}は積載がいっぱい` : `${GOODS[b.good].name}は銀が足りず買えない`);
        }
        continue;
      }
      executeTrade(world, m, [{ good: b.good, qty: n }], { auto: true });
    }
    // 待つ指定（wait:品*数）: 積荷がその数になるまで、この町で待つ（最大30日。毎日、積む・買うをやり直す）
    if (stop.waitFor && (m.cargo[stop.waitFor.good] || 0) < stop.waitFor.qty) {
      o.holdSince = o.holdSince ?? world.day;
      if (world.day - o.holdSince < 30) { o.holding = true; return; }
      notes.push(`${GOODS[stop.waitFor.good].name}が${stop.waitFor.qty}個そろわないまま30日たったので出発`);
    }
    o.holding = false;
    o.holdSince = null;
    o.next = (o.next + 1) % o.stops.length;
  }
  if (notes.length) emit(world, { type: 'orderNote', merchant: m.id, city: m.city, text: `${m.name}（定期便）: ${notes.join('、')}` });
  if (!depart) return;
  const target = o.stops[o.next].city;
  if (target === m.city) return;
  autoProvision(world, m, target);
  m.guards = o.guards || 0;
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

// 砂漠を渡るなら、足りない食料を今いる町で買い足す
// 次の行き先までに砂漠で食べる食料の数（足りている分は引かない）
function foodNeed(world, m, to) {
  if (!to || to === m.city) return 0;
  const route = findPath(world, m.city, to, m.transport);
  if (!route) return 0;
  const desertDays = route.edges.filter((e) => e.kind === 'desert').reduce((s, e) => s + edgeDays(world, e, m.transport, e.a), 0);
  if (!desertDays) return 0;
  const need = foodNeeded(world, m, desertDays);
  const have = PROVISIONS.reduce((s, g) => s + (m.cargo[g] || 0), 0);
  return Math.max(0, need - have);
}

function autoProvision(world, m, to) {
  if (!foodNeed(world, m, to)) return;
  const route = findPath(world, m.city, to, m.transport);
  const desertDays = route.edges.filter((e) => e.kind === 'desert').reduce((s, e) => s + edgeDays(world, e, m.transport, e.a), 0);
  const need = foodNeeded(world, m, desertDays);
  let have = PROVISIONS.reduce((s, g) => s + (m.cargo[g] || 0), 0);
  const city = world.cities[m.city];
  for (const g of PROVISIONS) {
    if (have >= need) break;
    if (!world.scenario.goods.includes(g)) continue;
    const room = cargoCap(m) - cargoUsed(m);
    const n = Math.min(need - have, Math.floor(city.stock[g] || 0), room);
    if (n <= 0 || quote(world, city, g, n) > world.player.silver) continue;
    executeTrade(world, m, [{ good: g, qty: n }], { auto: true });
    have += n;
  }
}

export function validateOrder(world, order) {
  if (!order?.stops?.length || order.stops.length < 2) return '停泊地は2つ以上必要';
  for (const s of order.stops) {
    if (!world.cities[s.city]) return `不明な町: ${s.city}`;
    for (const x of [...(s.sell || []), ...(s.buy || [])]) if (!GOODS[x.good]) return `不明な品物: ${x.good}`;
  }
  return null;
}
