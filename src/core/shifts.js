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
  // lowBag: 低迷する町を袋から引く（どの町も一巡で1回ずつ。2回とも同じ町になるくじが大きかった。22回目の Opus）
  let bag = [];
  // fairBag: 隊商市の町も袋から引く（候補の町を一巡するまで、同じ町に立たない）。市の町をいつも通る固定の便が、
  // 場所のくじに当たったシードで S に届いた（23回目の Opus）。町を3つにし、線までに3回立つ形と組んで、決まった分け前にする
  let fbag = [];
  while (start < (world.scenario.deadline || 600)) {
    let low;
    if (sc.lowBag) { if (!bag.length) bag = [...sc.markets]; low = bag.splice(Math.floor(rnd() * bag.length), 1)[0]; }
    else low = sc.markets[Math.floor(rnd() * sc.markets.length)];
    // 隊商市の町は毎回の抽選（前回の町を外していたので、候補が2町の s3 では必ず交互になり、場所を読む必要がなかった。22回目の Sol）
    // fairAlt: 前回と違う町（比べるための古い決め方）
    const fairs = sc.fairAlt && list.length ? sc.fairs.filter((f) => f !== list.at(-1).fair) : sc.fairs;
    let fair;
    if (sc.fairBag) { if (!fbag.length) fbag = [...sc.fairs]; fair = fbag.splice(Math.floor(rnd() * fbag.length), 1)[0]; }
    else fair = fairs[Math.floor(rnd() * fairs.length)];
    list.push({ id: list.length + 1, good: sc.good, low, fair, announce: Math.max(1, start - sc.lead), start, end: start + sc.days, fairEnd: start + (sc.fairDays ?? sc.days), sold: 0, value: 0, lowValue: 0 });
    start += sc.days + between(sc.gap);
  }
  world.shifts = list;
}

// 予告ずみの交代（画面とボットが読んでよいのはこれだけ）
export function knownShifts(world) {
  return (world.shifts || []).filter((x) => world.day >= x.announce && world.day < x.end);
}
export const shiftActive = (world, x) => world.day >= x.start && world.day < x.end;
// 隊商市は、安値の期間より短い（fairDays）。始まってから動いても間に合わず、予告を読んで先に出た便が取る（21回目の Sol: 始まってから回す手が S 68/90）
export const fairEnd = (x) => x.fairEnd ?? x.end;
export const fairActive = (world, x) => world.day >= x.start && world.day < fairEnd(x);

// 毎日の補正（applyModifiers のあと）
export function applyShifts(world) {
  const sc = world.scenario.shifts;
  for (const c of Object.values(world.cities)) c.fairDemand = null;
  if (!sc) return;
  for (const x of world.shifts || []) {
    if (!shiftActive(world, x)) continue;
    const low = world.cities[x.low];
    const fair = fairActive(world, x) ? world.cities[x.fair] : null;
    if (low) {
      low.demandMods[x.good] = (low.demandMods[x.good] ?? 1) * sc.low.demand;
      low.priceMods[x.good] = (low.priceMods[x.good] ?? 1) * sc.low.price;
    }
    // 余波（lowOthers）: 大量入荷は、ほかのいつもの売り場の値も少し下げる（2町を回って安い町を避ける固定の便が、低迷をほぼ受け流した。21回目の Sol）
    if (sc.lowOthers) for (const id of sc.markets) {
      const c = id !== x.low ? world.cities[id] : null;
      if (!c) continue;
      c.demandMods[x.good] = (c.demandMods[x.good] ?? 1) * sc.lowOthers.demand;
      c.priceMods[x.good] = (c.priceMods[x.good] ?? 1) * sc.lowOthers.price;
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
      emit(world, { type: 'shift', big: true, city: x.fair, shift: x.id, text: `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${sc.days}日間）、${nm(world, x.low)}に${g}が大量に入り、安くしか売れなくなる。始まりと同時に、${nm(world, x.fair)}に隊商市が立ち、${fairEnd(x) - x.start}日間（${fairEnd(x) - 1}日目まで）${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく。まとめて売ると値が下がる）。市は安値より早く閉じる。商人ごとの着く日は予告の画面で分かる。定期便の「臨時の便（期間予約）」で、先に売り先を変えておける` });
    }
    if (world.day === x.start) {
      // 隊商市は、よその商人の白糖も少し持って始まる（空の市場は値が基準の3倍近くになり、隊商市の町をいつも通る固定の便が強すぎた）
      const fair = world.cities[x.fair];
      const want = sc.fair.demand * B.targetStockDays * (sc.fair.stock ?? 0);
      if (fair) fair.stock[x.good] = Math.max(fair.stock[x.good] || 0, want);
    }
    if (world.day === x.start) emit(world, { type: 'shiftStart', city: x.fair, text: `${nm(world, x.fair)}に隊商市が立った（${fairEnd(x) - 1}日目まで）。${nm(world, x.low)}の${g}は安値になった（${x.end - 1}日目まで）` });
    if (world.day === x.end && x.end !== fairEnd(x)) emit(world, { type: 'shiftOver', city: x.low, quiet: false, text: `${nm(world, x.low)}の${g}の値が戻った` });
    if (world.day === fairEnd(x)) {
      // 閉じた市の残りの白糖は、よその商人が持ち帰る（閉じると値が下限まで落ち、安く買い戻して売り直すと売った額に2回数えられた。20回目の Opus）
      const fair = world.cities[x.fair];
      if (fair) fair.stock[x.good] = 0;
      const txt = x.sold > 0
        ? `${nm(world, x.fair)}の隊商市が閉じた。${g}を${x.sold}個売って${Math.round(x.value)}銀（同じ日に${nm(world, x.low)}で売っていたら約${Math.round(x.lowValue)}銀）`
        : `${nm(world, x.fair)}の隊商市が閉じた`;
      emit(world, { type: 'shiftEnd', city: x.fair, rare: x.sold > 0 && x.value > x.lowValue * 1.2, text: txt });
    }
  }
}

// 隊商市で売った分を記録する（終わりの知らせで、読んだ得を数字で見せる）
export function noteShiftSale(world, city, good, n, gain) {
  for (const x of world.shifts || []) {
    if (x.fair !== city.id || x.good !== good || !fairActive(world, x)) continue;
    x.sold += n;
    x.value += gain;
    const low = world.cities[x.low];
    if (low) x.lowValue += quote(world, low, good, -n);
  }
}

// 袋の決まり（fairBag）を画面に出す: 予告ずみの市だけから、この一巡でまだ市の立っていない町を数える
// （隠れた決まりにすると、覚えた人だけが先読みできる。23回目の Sol・Opus）
export function fairRound(world) {
  const sc = world.scenario.shifts;
  if (!sc?.fairBag) return null;
  const told = (world.shifts || []).filter((x) => world.day >= x.announce);
  const n = sc.fairs.length;
  const used = told.slice(Math.floor(told.length / n) * n).map((x) => x.fair);
  const left = sc.fairs.filter((f) => !used.includes(f));
  const names = (ids) => ids.map((id) => nm(world, id)).join('・');
  return { left, text: `隊商市は、${names(sc.fairs)}の${n}つを一巡するまで同じ町に立たない。${used.length ? `この一巡でまだ立っていないのは${names(left)}` : '次の市から新しい一巡（どの町にも立ちうる）'}` };
}

// 町の「これから」に出す行
export function shiftNotes(world, city) {
  const sc = world.scenario.shifts;
  const out = [];
  for (const x of knownShifts(world)) {
    const g = GOODS[x.good].name;
    const on = shiftActive(world, x);
    const when = on ? `あと${x.end - world.day}日` : `${x.start - world.day}日後から${sc.days}日間`;
    const fon = fairActive(world, x);
    const fwhen = fon ? `あと${fairEnd(x) - world.day}日` : `${x.start - world.day}日後から${fairEnd(x) - x.start}日間`;
    if (x.low === city.id) out.push({ kind: on ? 'down' : 'shift', text: on ? `📉${g}の大量入荷中（${when}）。${g}は安くしか売れない。隊商市は${nm(world, x.fair)}` : `📉${when}、${g}が大量に入って安くなる（${x.start}〜${x.end - 1}日目）。そのあいだ${nm(world, x.fair)}の隊商市が高く買う` });
    if (x.fair === city.id && world.day < fairEnd(x)) out.push({ kind: fon ? 'up' : 'shift', text: fon ? `🎪隊商市が立っている（${fwhen}）。${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく）` : `🎪${fwhen}、隊商市が立つ（${x.start}〜${fairEnd(x) - 1}日目）。${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく）` });
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
// ready: 商人が今の旅を終えて、便の最初の停泊地に戻れる日（帰り道の商人に、間に合わない予約を勧めていた。21回目の Sol）。
// late: 戻ってから出ても間に合わない
// arrive: 今予約したときに隊商市へ着く日の目安。afterStart: 始まってから切り替えたときに着く日（「始まってからでは間に合わない」と一律に書いていたが、
// 近い商人は間に合った。22回目の Sol。商人ごとの見込みに替えた）。どちらも積み待ちは入らない
export function altWindowFor(world, m, x, stops) {
  const home = stops?.[0]?.city || baseStopsOf(m.order)[0]?.city || m.city;
  const d = findPath(world, home, x.fair, m.transport)?.days ?? 0;
  const until = fairEnd(x) - d - 2;
  const start = Math.max(world.day, x.start - d + 1);
  let ready = world.day;
  const at = m.travel ? m.travel.to : m.city;
  if (m.travel) ready += Math.max(0, Math.ceil(m.travel.totalDays - m.travel.elapsed));
  if (at !== home) ready += findPath(world, at, home, m.transport)?.days ?? 0;
  return { from: start, until: Math.max(start + 1, until), days: d, ready, late: until <= Math.max(start, ready), lastSale: fairEnd(x) - 1,
    arrive: Math.max(start, ready) + d, afterStart: Math.max(x.start, ready, world.day) + d };
}

// 臨時の便の下書き: 便の最初の停泊地（積む町）と、隊商市の町の往復。隊商市では、低迷する町（なければ、その品を売る停泊地）で売っていた品を売る。
// （いつもの巡回の1つだけを替えていたので、市のあとに遠回りし、読んでも速くならなかった。21回目の Sol）
export function altDraftFor(world, m, x) {
  const base = m.order ? baseStopsOf(m.order) : null;
  if (!base?.length) return null;
  const sells = (s) => (s.sell || []).some((v) => v.good === x.good);
  const at = base.find((s) => s.city === x.low && sells(s)) || base.find(sells);
  if (!at) return null;
  const home = JSON.parse(JSON.stringify(base[0]));
  if (home.city === x.fair) return null;
  return [home, { city: x.fair, buy: [], sell: (at.sell || []).map((v) => ({ ...v, min: 0 })), unload: [], load: [] }];
}
