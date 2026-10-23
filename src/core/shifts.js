// 売り場の交代（版4の続き。19回目の相談）: いつもの売り場の1つで、ある品が安くしか売れなくなる期間と、
// 同じ期間に、ふだんその品を買わない小さな町に「隊商市」が立って高く買う期間を、一組で予告する。
// 予定は世界を作るときに、プレイヤーの行動と別の乱数で決める。プレイヤーの売り筋はねらわない。予告したあとは変えない。
// 固定の便は、いつもの売り場で安く売り続けるか、隊商市の町をいつも回る遠回りをするかになる。
// 予告を読んで、その期間だけ便を回した人が速くなる（柱1）。期間だけ切り替える「期間予約」は orders.js
import { GOODS } from '../data/goods.js';
import { hashSeed } from './rng.js';
import { emit } from './events.js';
import { quote } from './market.js';
import { BALANCE as B } from '../data/balance.js';
import { findPath } from './caravan.js';

// シナリオの定義: shifts: { good, markets: [低迷する町], fairs: [隊商市の町], first: [最初の開始日の幅], gap: [休みの幅], lead: 予告の日数, days: 続く日数,
//   low: { demand, price }, fair: { demand: 1日に買う数, price, stock: 始まりの在庫（目標在庫に対する割合） } }
export function planShifts(world) {
  const sc = world.scenario.shifts;
  if (!sc) return;
  if ([...sc.markets, ...sc.fairs].some((id) => !world.cities[id])) return; // 町の形が違う古いセーブ
  let s = hashSeed(`shift:${world.scenarioId}:${world.seed}`);
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = ([lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1));
  const list = [];
  let start = between(sc.first);
  let prevFair = null;
  while (start < (world.scenario.deadline || 600)) {
    const low = sc.markets[Math.floor(rnd() * sc.markets.length)];
    // 隊商市は、前回と違う町に立ちやすくする（同じ町を回る固定の便で受けきれないように）
    const fairs = sc.fairs.length > 1 ? sc.fairs.filter((f) => f !== prevFair) : sc.fairs;
    const fair = fairs[Math.floor(rnd() * fairs.length)];
    prevFair = fair;
    list.push({ id: list.length + 1, good: sc.good, low, fair, announce: Math.max(1, start - sc.lead), start, end: start + sc.days, sold: 0, value: 0, lowValue: 0 });
    start += sc.days + between(sc.gap);
  }
  world.shifts = list;
}

// 予告ずみの交代（画面とボットが読んでよいのはこれだけ）
export function knownShifts(world) {
  return (world.shifts || []).filter((x) => world.day >= x.announce && world.day < x.end);
}
export const shiftActive = (world, x) => world.day >= x.start && world.day < x.end;

// 毎日の補正（applyModifiers のあと）
export function applyShifts(world) {
  const sc = world.scenario.shifts;
  for (const c of Object.values(world.cities)) c.fairDemand = null;
  if (!sc) return;
  for (const x of world.shifts || []) {
    if (!shiftActive(world, x)) continue;
    const low = world.cities[x.low];
    const fair = world.cities[x.fair];
    if (low) {
      low.demandMods[x.good] = (low.demandMods[x.good] ?? 1) * sc.low.demand;
      low.priceMods[x.good] = (low.priceMods[x.good] ?? 1) * sc.low.price;
    }
    if (fair) {
      fair.fairDemand = { ...(fair.fairDemand || {}), [x.good]: sc.fair.demand };
      fair.priceMods[x.good] = (fair.priceMods[x.good] ?? 1) * sc.fair.price;
    }
  }
}

const nm = (world, id) => world.cities[id]?.name || id;

// 予告・始まり・終わりの知らせ（毎日）
export function updateShifts(world) {
  if (!world.shifts && world.scenario.shifts) planShifts(world);
  const sc = world.scenario.shifts;
  for (const x of world.shifts || []) {
    const g = GOODS[x.good].name;
    if (world.day === x.announce) {
      emit(world, { type: 'shift', big: true, city: x.fair, shift: x.id, text: `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${sc.days}日間）、${nm(world, x.low)}に${g}が大量に入り、安くしか売れなくなる。同じ期間、${nm(world, x.fair)}に隊商市が立ち、${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく。まとめて売ると値が下がる）。定期便の「臨時の便（期間予約）」で、その期間だけ売り先を変えられる` });
    }
    if (world.day === x.start) {
      // 隊商市は、よその商人の白糖も少し持って始まる（空の市場は値が基準の3倍近くになり、隊商市の町をいつも通る固定の便が強すぎた）
      const fair = world.cities[x.fair];
      const want = sc.fair.demand * B.targetStockDays * (sc.fair.stock ?? 0);
      if (fair) fair.stock[x.good] = Math.max(fair.stock[x.good] || 0, want);
    }
    if (world.day === x.start) emit(world, { type: 'shiftStart', city: x.fair, text: `${nm(world, x.fair)}に隊商市が立った（${sc.days}日間）。${nm(world, x.low)}の${g}は安値になった` });
    if (world.day === x.end) {
      // 閉じた市の残りの白糖は、よその商人が持ち帰る（閉じると値が下限まで落ち、安く買い戻して売り直すと売った額に2回数えられた。20回目の Opus）
      const fair = world.cities[x.fair];
      if (fair) fair.stock[x.good] = 0;
      const txt = x.sold > 0
        ? `${nm(world, x.fair)}の隊商市が閉じた。${g}を${x.sold}個売って${Math.round(x.value)}銀（同じ日に${nm(world, x.low)}で売っていたら約${Math.round(x.lowValue)}銀）`
        : `${nm(world, x.fair)}の隊商市が閉じた。${nm(world, x.low)}の${g}の値も戻る`;
      emit(world, { type: 'shiftEnd', city: x.fair, rare: x.sold > 0 && x.value > x.lowValue * 1.2, text: txt });
    }
  }
}

// 隊商市で売った分を記録する（終わりの知らせで、読んだ得を数字で見せる）
export function noteShiftSale(world, city, good, n, gain) {
  for (const x of world.shifts || []) {
    if (x.fair !== city.id || x.good !== good || !shiftActive(world, x)) continue;
    x.sold += n;
    x.value += gain;
    const low = world.cities[x.low];
    if (low) x.lowValue += quote(world, low, good, -n);
  }
}

// 町の「これから」に出す行
export function shiftNotes(world, city) {
  const sc = world.scenario.shifts;
  const out = [];
  for (const x of knownShifts(world)) {
    const g = GOODS[x.good].name;
    const on = shiftActive(world, x);
    const when = on ? `あと${x.end - world.day}日` : `${x.start - world.day}日後から${sc.days}日間`;
    if (x.low === city.id) out.push({ kind: on ? 'down' : 'shift', text: on ? `📉${g}の大量入荷中（${when}）。${g}は安くしか売れない。隊商市は${nm(world, x.fair)}` : `📉${when}、${g}が大量に入って安くなる（${x.start}〜${x.end - 1}日目）。そのあいだ${nm(world, x.fair)}の隊商市が高く買う` });
    if (x.fair === city.id) out.push({ kind: on ? 'up' : 'shift', text: on ? `🎪隊商市が立っている（${when}）。${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく）` : `🎪${when}、隊商市が立つ（${x.start}〜${x.end - 1}日目）。${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく）` });
  }
  return out;
}

const baseStopsOf = (o) => (o?.altOn ? o.base : o?.stops) || [];
// その予告の期間にかかる臨時の便の予約
export function altCovering(m, x) {
  return (m.order?.alts || []).find((a) => a.from < x.end && a.until > x.start) || null;
}

// 定期便の停泊地が、予告された低迷にかかるか（商人の欄に出す）
export function orderShiftWarnings(world, m) {
  if (!m.order) return [];
  const out = [];
  for (const x of knownShifts(world)) {
    const st0 = baseStopsOf(m.order).find((s) => s.city === x.low && (s.sell || []).some((v) => v.good === x.good));
    if (!st0) continue;
    const alt = altCovering(m, x);
    const covered = !!alt;
    out.push({ shift: x, covered, text: covered ? `臨時の便を予約ずみ（${alt.from}〜${alt.until}日目）` : `この便の売り先${nm(world, x.low)}は、${shiftActive(world, x) ? `今${GOODS[x.good].name}が安い（あと${x.end - world.day}日）` : `${x.start - world.day}日後から${GOODS[x.good].name}が安い`}。隊商市は${nm(world, x.fair)}` });
  }
  return out;
}

// 臨時の便の期間の目安（これは「町を出る」期間。隊商市で売れる期間とは別）: 便の最初の停泊地から隊商市まで行く日数だけ、
// 始まりと終わりを前へずらす。着くのが始まりより早いと、まだ買ってもらえないので1日あとに着くようにし、
// 終わりは2日の余裕をみる（最後の日に出た便が、市の閉じた日に着いて売れなかった。20回目の Sol）。
// late: 今から出ても間に合わない
export function altWindowFor(world, m, x, stops) {
  const from = stops?.[0]?.city || baseStopsOf(m.order)[0]?.city || m.city;
  const d = findPath(world, from, x.fair, m.transport)?.days ?? 0;
  const until = x.end - d - 2;
  const start = Math.max(world.day, x.start - d + 1);
  return { from: start, until: Math.max(start + 1, until), days: d, late: until <= start, lastSale: x.end - 1 };
}

// 臨時の便の下書き: いつもの便の停泊地のうち、低迷する町（なければ、その品を売る停泊地）を隊商市の町に替える
export function altDraftFor(world, m, x) {
  const base = m.order ? baseStopsOf(m.order) : null;
  if (!base?.length) return null;
  const stops = JSON.parse(JSON.stringify(base));
  const sells = (s) => (s.sell || []).some((v) => v.good === x.good);
  let i = stops.findIndex((s) => s.city === x.low && sells(s));
  if (i < 0) i = stops.findIndex(sells);
  if (i < 0) return null;
  stops[i].city = x.fair;
  stops[i].buy = []; // 隊商市の町では仕入れない（いつもの売り先の仕入れは、そこにしかない）
  stops[i].sell = (stops[i].sell || []).map((v) => ({ ...v, min: 0 }));
  return stops.filter((s, j) => j === 0 || s.city !== stops[j - 1].city);
}
