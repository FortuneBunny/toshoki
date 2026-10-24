// 売買の確定。交易画面、CLI、定期便はすべてここを通る。
import { GOODS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';
import { quote, cityWants, midPrice, spreadFor, sellBonus } from './market.js';
import { cargoUsed, cargoCap } from './caravan.js';
import { emit } from './events.js';
import { observe } from './knowledge.js';
import { noteShiftSale, fairRoom } from './shifts.js';
import { portRoom, notePortSale, marketPrice } from './markets.js';

// lines: [{ good, qty }]  qty > 0 は買い、qty < 0 は売り
// 才能による値段の補正（買い: 値切り上手、売り: 目利き・甘党）
export function talentPrice(m, good, buying) {
  if (buying) return m.talent === 'haggler' ? 0.95 : 1;
  let f = 1;
  if (m.talent === 'appraiser') f *= 1.04;
  if (m.talent === 'sweettooth' && GOODS[good]?.kind === 'sweet') f *= 1.08;
  return f;
}

// 同じ品の行はまとめる（同じ売りの行を何度も書くと、1個を何個にも数えられたため。12回目の Sol の指摘）
// 数量は整数に切り捨てる（定期便の小数の「残す数」で 0.001個を1個分の値で売れたため。13回目の Sol の指摘）
function mergeLines(lines) {
  const by = new Map();
  for (const { good, qty } of lines) { const q = Number.isFinite(qty) ? Math.trunc(qty) : qty; if (q) by.set(good, (by.get(good) || 0) + q); }
  return [...by].map(([good, qty]) => ({ good, qty })).filter((l) => l.qty);
}

// 最近この町で自分が買った量（30日かけて忘れる）。同じ町で買った品を売り戻すときは、才能やラッシュの上乗せを付けない
const RECENT_DAYS = 30;
function recentBought(world, city, good) {
  const r = city.playerBought?.[good];
  if (!r) return 0;
  return r.q * Math.max(0, 1 - (world.day - r.day) / RECENT_DAYS);
}
function noteBought(world, city, good, q) {
  city.playerBought = city.playerBought || {};
  city.playerBought[good] = { q: recentBought(world, city, good) + q, day: world.day };
}

// 売りの受け取り額。同じ町で最近買った分は、買値より必ず安くなるように上乗せを外す
// （評判で手数料が下がると、甘党・値切り上手・ラッシュの上乗せで、同じ町の売り買いだけで儲かったため。12回目の Sol の指摘）
export function sellValue(world, m, city, good, n) {
  if (n <= 0) return 0;
  const full = quote(world, city, good, -n) * talentPrice(m, good, false) * marketPrice(world, m, city, good);
  const k = Math.min(n, recentBought(world, city, good));
  if (k <= 0) return full;
  const s = spreadFor(world);
  const mids = quote(world, city, good, -n) / ((1 - s) * sellBonus(world, city, good));
  const plain = mids * Math.min(1 - s, 0.94 * (1 + s));
  return full * ((n - k) / n) + Math.min(full, plain) * (k / n);
}

export function previewTrade(world, m, lines) {
  lines = mergeLines(lines);
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
      const cost = quote(world, city, good, Math.min(qty, avail)) * talentPrice(m, good, true);
      silverDelta -= cost;
      rows.push({ good, qty, total: -cost });
    } else {
      const have = m.cargo[good] || 0;
      if (-qty > have) errors.push(`${g.name}は${have}個しか積んでいない`);
      if (!cityWants(city, good)) errors.push(`${city.name}では${g.name}を買い取ってもらえない`);
      const gain = sellValue(world, m, city, good, Math.min(-qty, have));
      silverDelta += gain;
      rows.push({ good, qty, total: gain });
    }
    cargoDelta += qty * g.weight;
  }
  const used = cargoUsed(m) + cargoDelta;
  if (used > cargoCap(m)) errors.push(`積載量を超える（${used}/${cargoCap(m)}）`);
  // 銀が減る取引だけ確かめる（借金のときでも、売って銀を増やすことはできる）
  if (silverDelta < 0 && world.player.silver + silverDelta < 0) errors.push(`銀が足りない（必要 ${Math.ceil(-silverDelta)}、所持 ${Math.floor(world.player.silver)}）`);
  return { ok: errors.length === 0, errors, silverDelta, rows, cargoAfter: used };
}

export function executeTrade(world, m, lines, { auto = false } = {}) {
  // 売りを先に（売った銀で買えるように）
  lines = mergeLines(lines).sort((a, b) => a.qty - b.qty);
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
      const cost = quote(world, city, good, qty) * talentPrice(m, good, true);
      const have = m.cargo[good] || 0;
      m.cost[good] = ((m.cost[good] || 0) * have + cost) / (have + qty);
      m.cargo[good] = have + qty;
      city.stock[good] -= qty;
      noteBought(world, city, good, qty);
      world.player.silver -= cost;
      world.stats.spent += cost;
      world.stats.bought[good] = (world.stats.bought[good] || 0) + qty;
      world.stats.boughtValue = world.stats.boughtValue || {};
      world.stats.boughtValue[good] = (world.stats.boughtValue[good] || 0) + cost;
    } else {
      // 総量のある隊商市は、残りの分しか買わない
      // 港の買い取りの空き（s6 の香辛料。市の間は運んできた分は上限なし）
      const n = Math.min(-qty, fairRoom(world, city, good), portRoom(world, m, city, good));
      if (n <= 0) continue;
      // 読み的中: 出発時に知っていた相場より高く売れたか
      const expected = m.expected?.city === city.id ? m.expected.prices[good] : undefined;
      const actualMid = midPrice(city, good);
      const gain = sellValue(world, m, city, good, n);
      const basis = (m.cost[good] || 0) * n;
      // この町で最近自分が買った分の売り戻しは、目標の取引量と大口注文に数えない。
      // 個数で差し引く（よそで買った品を少し混ぜると、売り戻しが数えられたため。13回目の Opus の指摘）
      const back = Math.min(n, Math.floor(recentBought(world, city, good)));
      const counted = n - back;
      if (back > 0) city.playerBought[good] = { q: recentBought(world, city, good) - back, day: world.day };
      const p = gain - basis;
      profit += p;
      sold += n;
      notePortSale(world, m, city, good, n);
      m.cargo[good] -= n;
      if (!m.cargo[good]) { delete m.cargo[good]; delete m.cost[good]; }
      city.stock[good] = (city.stock[good] || 0) + n;
      world.player.silver += gain;
      world.stats.revenue += gain;
      if (counted > 0) {
        world.stats.sold[city.id] = world.stats.sold[city.id] || {};
        world.stats.sold[city.id][good] = (world.stats.sold[city.id][good] || 0) + counted;
        world.stats.soldTotal[good] = (world.stats.soldTotal[good] || 0) + counted;
        world.stats.soldValue = world.stats.soldValue || {};
        world.stats.soldValue[good] = (world.stats.soldValue[good] || 0) + (gain * counted) / n;
        noteShiftSale(world, city, good, counted, (gain * counted) / n);
      }
      m.lifetime += p;
      if (!auto && expected !== undefined && actualMid > expected * 1.15 && p > 0) {
        const diff = (actualMid - expected) * n;
        hit = { good, diff };
      }
      fx.push({ type: 'sale', good, qty: n, gain, profit: p });
      if (auto && m.order) { m.order.profit = (m.order.profit || 0) + p; }
      if (counted > 0) contractProgress(world, city, good, counted, fx);
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
        emit(world, { type: 'hit', merchant: m.id, city: city.id, big: true, text: `読み的中！${GOODS[hit.good].name}が、出発時に知っていた相場より高く売れた（相場の差 +${Math.round(hit.diff)} 銀ぶん）` });
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
  qty = Number.isFinite(qty) ? Math.trunc(qty) : 0;
  if (!qty) return { ok: false, error: '数量は1以上の整数' };
  const g = GOODS[good];
  if (qty > 0) {
    const have = Math.floor(wh.stock[good] || 0);
    if (qty > have) return { ok: false, error: `倉庫の${g.name}は${have}個` };
    if (cargoUsed(m) + qty * g.weight > cargoCap(m)) return { ok: false, error: '積載量を超える' };
    const cur = m.cargo[good] || 0;
    m.cost[good] = ((m.cost[good] || 0) * cur + (wh.basis[good] || 0) * qty) / (cur + qty);
    m.cargo[good] = cur + qty;
    wh.stock[good] -= qty;
    // この港の倉庫から積んだ分（港の市で上限なしに売れるのは、よそから運んできた分だけ。markets.js）
    if (m.whLoaded?.city !== m.city) m.whLoaded = { city: m.city };
    m.whLoaded[good] = (m.whLoaded[good] || 0) + qty;
  } else {
    const n = -qty;
    const have = m.cargo[good] || 0;
    if (n > have) return { ok: false, error: `${g.name}は${have}個しか積んでいない` };
    const cur = wh.stock[good] || 0;
    wh.basis[good] = ((wh.basis[good] || 0) * cur + (m.cost[good] || 0) * n) / (cur + n);
    wh.stock[good] = cur + n;
    m.cargo[good] -= n;
    if (m.whLoaded?.city === m.city && m.whLoaded[good]) m.whLoaded[good] = Math.min(m.whLoaded[good], m.cargo[good]);
    if (!m.cargo[good]) { delete m.cargo[good]; delete m.cost[good]; }
  }
  return { ok: true };
}
