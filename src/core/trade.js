// 売買の確定。交易画面、CLI、定期便はすべてここを通る。
import { GOODS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';
import { quote, cityWants, midPrice } from './market.js';
import { cargoUsed, cargoCap } from './caravan.js';
import { emit } from './events.js';
import { observe } from './knowledge.js';

// lines: [{ good, qty }]  qty > 0 は買い、qty < 0 は売り
export function previewTrade(world, m, lines) {
  const city = world.cities[m.city];
  const errors = [];
  let silverDelta = 0;
  let cargoDelta = 0;
  const rows = [];
  for (const { good, qty } of lines) {
    if (!qty) continue;
    const g = GOODS[good];
    if (!g) { errors.push(`不明な品物: ${good}`); continue; }
    if (!world.scenario.goods.includes(good)) { errors.push(`${g.name}はこのシナリオでは扱えない`); continue; }
    if (qty > 0) {
      const avail = Math.floor(city.stock[good] || 0);
      if (qty > avail) errors.push(`${city.name}の${g.name}は${avail}個しかない`);
      const cost = quote(world, city, good, Math.min(qty, avail));
      silverDelta -= cost;
      rows.push({ good, qty, total: -cost });
    } else {
      const have = m.cargo[good] || 0;
      if (-qty > have) errors.push(`${g.name}は${have}個しか積んでいない`);
      if (!cityWants(city, good)) errors.push(`${city.name}では${g.name}を買い取ってもらえない`);
      const gain = quote(world, city, good, -Math.min(-qty, have));
      silverDelta += gain;
      rows.push({ good, qty, total: gain });
    }
    cargoDelta += qty * g.weight;
  }
  const used = cargoUsed(m) + cargoDelta;
  if (used > cargoCap(m)) errors.push(`積載量を超える（${used}/${cargoCap(m)}）`);
  if (world.player.silver + silverDelta < 0) errors.push(`銀が足りない（必要 ${Math.ceil(-silverDelta)}、所持 ${Math.floor(world.player.silver)}）`);
  return { ok: errors.length === 0, errors, silverDelta, rows, cargoAfter: used };
}

export function executeTrade(world, m, lines, { auto = false } = {}) {
  const pv = previewTrade(world, m, lines);
  if (!pv.ok) return pv;
  const city = world.cities[m.city];
  const fx = [];
  let profit = 0;
  let sold = 0;
  let hit = null;
  for (const { good, qty } of lines) {
    if (!qty) continue;
    const g = GOODS[good];
    if (qty > 0) {
      const cost = quote(world, city, good, qty);
      const have = m.cargo[good] || 0;
      m.cost[good] = ((m.cost[good] || 0) * have + cost) / (have + qty);
      m.cargo[good] = have + qty;
      // どこで仕入れたか（同じ町での売り戻しを目標に数えないため）
      m.boughtAt = m.boughtAt || {};
      m.boughtAt[good] = have > 0 && m.boughtAt[good] !== city.id ? 'mixed' : city.id;
      city.stock[good] -= qty;
      world.player.silver -= cost;
      world.stats.spent += cost;
      world.stats.bought[good] = (world.stats.bought[good] || 0) + qty;
    } else {
      const n = -qty;
      // 読み的中: 出発時に知っていた相場より高く売れたか
      const expected = m.expected?.city === city.id ? m.expected.prices[good] : undefined;
      const actualMid = midPrice(city, good);
      const gain = quote(world, city, good, qty);
      const basis = (m.cost[good] || 0) * n;
      const p = gain - basis;
      profit += p;
      sold += n;
      m.cargo[good] -= n;
      if (!m.cargo[good]) { delete m.cargo[good]; delete m.cost[good]; if (m.boughtAt) delete m.boughtAt[good]; }
      city.stock[good] = (city.stock[good] || 0) + n;
      world.player.silver += gain;
      world.stats.revenue += gain;
      // 同じ町で仕入れた品を売り戻した分は、目標の取引量には数えない
      const resold = m.boughtAt?.[good] === city.id;
      if (!resold) {
        world.stats.sold[city.id] = world.stats.sold[city.id] || {};
        world.stats.sold[city.id][good] = (world.stats.sold[city.id][good] || 0) + n;
        world.stats.soldTotal[good] = (world.stats.soldTotal[good] || 0) + n;
      }
      m.lifetime += p;
      if (!auto && expected !== undefined && actualMid > expected * 1.15 && p > 0) {
        const diff = (actualMid - expected) * n;
        hit = { good, diff };
      }
      fx.push({ type: 'sale', good, qty: n, gain, profit: p });
      if (auto && m.order) { m.order.profit = (m.order.profit || 0) + p; }
      contractProgress(world, city, good, n, fx);
    }
  }
  if (sold > 0) {
    world.stats.profit += profit;
    world.stats.sales += 1;
    const pl = world.player;
    if (profit > 0) {
      pl.streak = Math.min(B.streakMax, pl.streak + 1);
      pl.maxStreak = Math.max(pl.maxStreak, pl.streak);
      const rep = Math.max(1, Math.round((profit / 25) * (1 + pl.streak * B.streakRepBonus)));
      gainRep(world, rep);
      fx.push({ type: 'profit', amount: profit, streak: pl.streak, rep });
      if (hit) {
        world.stats.hits += 1;
        gainRep(world, 15);
        fx.push({ type: 'hit', good: hit.good, diff: hit.diff });
        emit(world, { type: 'hit', merchant: m.id, city: city.id, big: true, text: `読み的中！${GOODS[hit.good].name}が予想より高く売れた（+${Math.round(hit.diff)} 銀）` });
      }
      emit(world, { type: 'profit', merchant: m.id, city: city.id, amount: profit, streak: pl.streak, auto, big: profit > 300, text: `${m.name}: ${city.name}で売却、利益 +${Math.round(profit)} 銀${pl.streak > 1 ? `（${pl.streak}連続黒字！）` : ''}` });
    } else if (profit < 0) {
      world.stats.lossSales += 1;
      if (pl.streak > 1) fx.push({ type: 'streakBroken', was: pl.streak });
      pl.streak = 0;
      fx.push({ type: 'loss', amount: profit });
      emit(world, { type: 'loss', merchant: m.id, city: city.id, amount: profit, auto, bad: true, text: `${m.name}: ${city.name}で売却、損失 ${Math.round(profit)} 銀` });
    }
  }
  if (!auto) recordRecent(m, city.id, world.day, lines);
  observe(world, city.id);
  return { ...pv, ok: true, fx, profit };
}

// 直近の取引（町ごと）。定期便の下書きに使う
function recordRecent(m, cityId, day, lines) {
  m.recent = m.recent || [];
  let r = m.recent[m.recent.length - 1];
  if (!r || r.city !== cityId) {
    r = { city: cityId, day, buy: {}, sell: {} };
    m.recent.push(r);
    if (m.recent.length > 6) m.recent.shift();
  }
  for (const { good, qty } of lines) {
    if (qty > 0) r.buy[good] = (r.buy[good] || 0) + qty;
    else if (qty < 0) r.sell[good] = true;
  }
}

function contractProgress(world, city, good, n, fx) {
  for (const c of world.contracts) {
    if (c.done || c.failed || c.city !== city.id || c.good !== good) continue;
    c.delivered += n;
    if (c.delivered >= c.qty) {
      c.done = true;
      world.player.silver += c.reward;
      world.stats.contracts += 1;
      gainRep(world, 25);
      fx.push({ type: 'contract', reward: c.reward });
      emit(world, { type: 'contractDone', city: city.id, big: true, text: `大口注文を達成！${city.name}から報酬 ${c.reward} 銀、評判 +25` });
    }
  }
}

export function gainRep(world, amount) {
  const pl = world.player;
  pl.rep += amount;
  let lv = 0;
  B.repLevels.forEach((th, i) => { if (pl.rep >= th) lv = i; });
  if (lv > pl.repLevel) {
    pl.repLevel = lv;
    emit(world, { type: 'repUp', level: lv, big: true, text: `一族の評判がレベル${lv}に上がった！手数料が下がる` });
  }
}

// 倉庫との積み下ろし（qty > 0 は倉庫から積む、qty < 0 は倉庫へ下ろす）
export function moveWarehouse(world, m, good, qty) {
  if (!Number.isInteger(qty) || qty === 0) return { ok: false, error: '数量は1以上の整数で指定する' };
  const wh = world.player.warehouses[m.city];
  if (!wh) return { ok: false, error: 'この町に倉庫（工房）がない' };
  const g = GOODS[good];
  if (qty > 0) {
    const have = Math.floor(wh.stock[good] || 0);
    if (qty > have) return { ok: false, error: `倉庫の${g.name}は${have}個` };
    if (cargoUsed(m) + qty * g.weight > cargoCap(m)) return { ok: false, error: '積載量を超える' };
    const cur = m.cargo[good] || 0;
    m.cost[good] = ((m.cost[good] || 0) * cur + (wh.basis[good] || 0) * qty) / (cur + qty);
    m.cargo[good] = cur + qty;
    m.boughtAt = m.boughtAt || {};
    m.boughtAt[good] = cur > 0 && m.boughtAt[good] !== 'warehouse' ? 'mixed' : 'warehouse';
    wh.stock[good] -= qty;
  } else {
    const n = -qty;
    const have = m.cargo[good] || 0;
    if (n > have) return { ok: false, error: `${g.name}は${have}個しか積んでいない` };
    const cur = wh.stock[good] || 0;
    wh.basis[good] = ((wh.basis[good] || 0) * cur + (m.cost[good] || 0) * n) / (cur + n);
    wh.stock[good] = cur + n;
    m.cargo[good] -= n;
    if (!m.cargo[good]) { delete m.cargo[good]; delete m.cost[good]; }
  }
  return { ok: true };
}
