// 次の一手の例（初めての人向け）: 今いる町で買って、相場を知っている町で売る候補を、1日あたりの見込み利益の順に
import { GOODS, PROVISIONS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';
import { quote, cityWants } from './market.js';
import { routeInfo } from './actions.js';
import { cargoCap, cargoUsed, foodNeeded } from './caravan.js';

export function suggestTrades(world, mid, limit = 3) {
  const m = world.player.merchants.find((x) => x.id === Number(mid));
  if (!m || m.travel) return [];
  const here = world.cities[m.city];
  const room = cargoCap(m) - cargoUsed(m);
  const out = [];
  for (const [cid, k] of Object.entries(world.player.knowledge)) {
    // 古すぎる相場（120日より前）は当てにならないので使わない
    if (cid === m.city || !k?.prices || !Number.isFinite(k.day) || world.day - k.day > 120) continue;
    const r = routeInfo(world, m.id, cid);
    if (!r) continue;
    const days = Math.max(1, r.days);
    // 砂漠を渡るなら、食料の分だけ積める量が減る
    const food = foodNeeded(world, m, r.desertDays || 0);
    for (const good of world.scenario.goods) {
      const there = k.prices[good];
      const stock = Math.floor(here.stock[good] || 0);
      if (!there || stock < 3) continue;
      const target = world.cities[cid];
      if (!cityWants(target, good)) continue;
      // 行き先が自分でたくさん作っている品は、古い相場が高くても値崩れしやすい
      if ((target.produces?.[good] || 0) >= (here.produces?.[good] || 0) * 0.5 && (target.produces?.[good] || 0) > 0) continue;
      const g = GOODS[good];
      let qty = Math.min(stock, Math.floor((room - food) / g.weight));
      // 買い進むと値上がりし、売り進むと値下がりする。見込みが残る数まで減らす
      while (qty > 0) {
        const cost = quote(world, here, good, qty);
        if (cost <= world.player.silver && there * 0.9 * qty > cost * 1.08) break;
        qty = Math.floor(qty * 0.75);
      }
      if (qty < 2) continue;
      const cost = quote(world, here, good, qty);
      const profit = there * 0.9 * qty - cost;
      out.push({ good, qty, to: cid, days, cost: Math.round(cost), profit: Math.round(profit), perDay: profit / days, food, age: world.day - k.day, desert: r.desertDays || 0 });
    }
  }
  out.sort((a, b) => b.perDay - a.perDay);
  const best = [];
  for (const s of out) { if (!best.some((b) => b.to === s.to)) best.push(s); if (best.length >= limit) break; }
  return best;
}

// まだ相場を知らない、近い町
export function unknownNear(world, mid) {
  const m = world.player.merchants.find((x) => x.id === Number(mid));
  if (!m || m.travel) return null;
  let best = null;
  for (const c of Object.values(world.cities)) {
    if (c.id === m.city || world.player.knowledge[c.id]?.prices) continue;
    const r = routeInfo(world, m.id, c.id);
    if (r && (!best || r.days < best.days)) best = { to: c.id, days: r.days, desert: r.desertDays || 0 };
  }
  return best;
}

export function adviceText(world, mid) {
  const ss = suggestTrades(world, mid);
  const lines = [];
  const name = (id) => world.cities[id].name;
  for (const s of ss) {
    lines.push(`${GOODS[s.good].name}を${s.qty}個買って（約${s.cost}銀）${name(s.to)}へ（約${s.days}日）。見込み +${s.profit}銀（${s.age}日前の相場）${s.food ? `。砂漠を渡るので食料（${PROVISIONS.map((g) => GOODS[g].name).join('・')}のどれか）を${s.food}個積む` : ''}`);
  }
  const u = unknownNear(world, mid);
  if (u) {
    // 相場を知らない町へは、手ぶらで行かずに、ここの特産（安い品）を積んでいく
    const m = world.player.merchants.find((x) => x.id === Number(mid));
    const here = world.cities[m.city];
    const target = world.cities[u.to];
    // 行き先がその品を作っていても、ここより作る量が少なければ足りていないことが多い
    const local = Object.entries(here.produces || {}).filter(([g, r]) => ((target.produces || {})[g] || 0) < r * 0.5 && world.scenario.goods.includes(g)).sort((a, b) => b[1] - a[1])[0]?.[0];
    const food = foodNeeded(world, m, u.desert);
    const qty = local ? Math.max(0, Math.min(Math.floor(here.stock[local] || 0), Math.floor((cargoCap(m) - cargoUsed(m) - food) / GOODS[local].weight))) : 0;
    // 確かめに行くだけなので、少しだけ（積載の4分の1、手持ちの4分の1まで）。小さな町ではすぐ値崩れする
    let qty2 = Math.min(qty, Math.floor(cargoCap(m) / 4));
    while (qty2 > 0 && local && quote(world, here, local, qty2) > world.player.silver * 0.25) qty2 = Math.floor(qty2 * 0.8);
    const carry = local && qty2 >= 2 ? `ここの特産の${GOODS[local].name}を${qty2}個（約${Math.round(quote(world, here, local, qty2))}銀）積んで、` : '';
    lines.push(`${carry}まだ相場を知らない${name(u.to)}へ行ってみる（約${u.days}日）。相場が分からないので赤字の恐れもある。少なめに試し、着いたら market で確かめて売る${food ? `。砂漠を渡るので食料を${food}個積む` : ''}`);
  }
  if (!lines.length) lines.push('今いる町で見込みのある取引が見つからない。積荷を売るか、別の町へ行って相場を確かめよう');
  return lines;
}
