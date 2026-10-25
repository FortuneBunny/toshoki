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
//   low: { demand, price }, fair: { demand: 1日に買う数, price, stock: 始まりの在庫（目標在庫に対する割合）, want: [市が買う総量の幅] } }
export function planShifts(world) {
  const sc = world.scenario.shifts;
  if (!sc) return;
  if ([...sc.markets, ...sc.fairs].some((id) => !world.cities[id])) return; // 町の形が違う古いセーブ
  if (sc.travelLead && !world.shiftTravelDays) world.shiftTravelDays = Object.fromEntries(sc.fairs.map((f) => [f, (findPath(world, sc.travelLead, f, 'camel')?.days ?? sc.lead)]));
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
  let gbag = [];
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
    // want: 市が買う総量（予告に出す）。買い終えると閉じる。何人を回すかを、予告を読んで選ぶ（23回目の Sol の案。試作）
    // wants: 総量の候補から引く（小さい市と大きい市に分ける）
    const want = sc.fair.wants ? sc.fair.wants[Math.floor(rnd() * sc.fair.wants.length)] : sc.fair.want ? 5 * between(sc.fair.want.map((v) => v / 5)) : undefined;
    let good = sc.good;
    if (sc.goods?.length) { if (!gbag.length) gbag = [...sc.goods]; good = gbag.splice(Math.floor(rnd() * gbag.length), 1)[0]; }
    list.push({ id: list.length + 1, good, low, fair, want, ...(sc.fair.rivals ? { rivals: true } : {}), ...(sc.fair.rivalCaravans ? { caravans: true } : {}), announce: Math.max(1, start - (sc.travelLead ? world.shiftTravelDays[fair] + 4 : sc.lead)), start, end: start + sc.days, fairEnd: start + (sc.fairDays ?? sc.days), sold: 0, value: 0, lowValue: 0 });
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
// full: 総量を買い終えた市は、次の日に閉じる
export const fairEnd = (x) => x.full ?? x.fairEnd ?? x.end;
export const fairActive = (world, x) => world.day >= x.start && world.day < fairEnd(x);
// 隊商市があと何個買うか（総量のない市・市のない町は上限なし）
export function fairRoom(world, city, good) {
  for (const x of world.shifts || []) {
    if (x.fair === city.id && x.good === good && x.want && fairActive(world, x)) return Math.max(0, x.want - x.sold - (x.others || 0));
  }
  return Infinity;
}
// 総量の知らせ（予告・画面・CLI で同じ言い方）。始まったあとは残りも出す
export const fairWantText = (x) => (x.want ? `市が買うのは全部で${x.want}個まで（${x.sold + (x.others || 0) > 0 ? `あと${Math.max(0, x.want - x.sold - (x.others || 0))}個。` : ''}${x.rivals ? 'よその商人も毎日持ち込む。' : ''}${x.caravans ? 'ライバルの隊商が売った分も数える。' : ''}買い終えると閉じる）` : '');
// 市と安値の今の様子を分けて書く（市の行に安値の残り日数を出し、閉じた市も「今」「高く買う」と出ていた。24回目の Sol・Opus）
export const fairClosed = (world, x) => world.day >= fairEnd(x);
export function fairStateText(world, x) {
  if (world.day < x.start) return `${x.start - world.day}日後から（${x.start}〜${fairEnd(x) - 1}日目）`;
  // 総量を買い終えた市は、次の日に閉じる（「今（あと1日）」と出て、まだ買うように読めた。26回目の Opus）
  if (x.full && !fairClosed(world, x)) return `${x.want}個を買い終えた（今日で閉じる）`;
  if (!fairClosed(world, x)) return `今（あと${fairEnd(x) - world.day}日、${fairEnd(x) - 1}日目まで）`;
  return `閉じた（${x.full ? `${x.want}個を買い終えた` : '期間が終わった'}）`;
}
export const lowStateText = (world, x) => (shiftActive(world, x) ? `今（あと${x.end - world.day}日、${x.end - 1}日目まで）` : `${x.start - world.day}日後から（${x.start}〜${x.end - 1}日目）`);
const wantText = (x) => (x.want ? `${fairWantText(x)}。` : '');
// ライバルの隊商（s7）: 予告は読まず、市が立ってから本拠地の蔵の品を市へ送る。本拠地から市までの日数を出す
export function caravanText(world, x) {
  if (!x.caravans) return '';
  const r = world.rivals.find((y) => world.scenario.shifts?.fair?.rivalCity || y.workshop?.output === x.good);
  if (!r) return '';
  const home = world.scenario.shifts?.fair?.rivalCity || r.workshop.city;
  const route = findPath(world, home, x.fair, r.merchants[0]?.transport || 'donkey');
  return `${r.name}は予告を読まず、市が立ってから${nm(world, home)}${world.scenario.shifts?.fair?.rivalCity ? 'の市場で買った' : 'の蔵の'}${GOODS[x.good].name}を市へ送る（${nm(world, home)}を出てから${route ? `約${route.days}日。商人が${nm(world, home)}へ戻るのを待つと、もっと遅い` : '道がない'}${route && route.days >= fairEnd(x) - x.start ? '。市が閉じるまでに着かない' : ''}）。`;
}

// 毎日の補正（applyModifiers のあと）
export function applyShifts(world) {
  const sc = world.scenario.shifts;
  for (const c of Object.values(world.cities)) { c.fairDemand = null; c.fairPriceMax = null; }
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
      if (sc.fair.priceMax) fair.fairPriceMax = { [x.good]: sc.fair.priceMax };
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
  watchAlts(world);
  // rivals: よその商人も市に白糖を持ち込み、総量を毎日埋めていく（総量の rivals 倍ずつ）。早く着いた人ほど多く売れる
  // （近い町から直に行けるようにすると、始まってから回す手が、予告を読む手に追いついた。24回目のあと）
  if (sc?.fair?.rivals) for (const x of world.shifts || []) {
    if (!x.want || !fairActive(world, x) || world.day === x.start) continue;
    const add = Math.min(Math.max(1, Math.round(x.want * sc.fair.rivals)), x.want - x.sold - (x.others || 0));
    if (add <= 0) continue;
    x.others = (x.others || 0) + add;
    if (x.sold + x.others >= x.want && !x.full) { x.full = world.day + 1; closeAltsTo(world, x); }
  }
  for (const x of world.shifts || []) {
    const g = GOODS[x.good].name;
    if (world.day === x.announce) {
      emit(world, { type: 'shift', big: true, city: x.fair, shift: x.id, text: `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${sc.days}日間）、${nm(world, x.low)}に${g}が大量に入り、安くしか売れなくなる（値はふだんの約${Math.round(sc.low.price * 100)}%、買う数は約${Math.round(sc.low.demand * 100)}%）${sc.lowOthers ? `（ほかのいつもの売り場も、値が約${Math.round((1 - sc.lowOthers.price) * 100)}%下がり、買う数が約${Math.round((1 - sc.lowOthers.demand) * 100)}%減る）` : ''}。始まりと同時に、${nm(world, x.fair)}に隊商市が立ち、${fairEnd(x) - x.start}日間（${fairEnd(x) - 1}日目まで）${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく。まとめて売ると値が下がる${sc.fair.priceMax ? `。値は基準の${sc.fair.priceMax}倍まで上がる` : ''}）。${wantText(x)}${fairPriceText(world, x)}。${caravanText(world, x)}市は安値より早く閉じる。商人ごとの着く日は予告の画面で分かる。定期便の「臨時の便（期間予約）」で、先に売り先を変えておける` });
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
      // ライバルの隊商が市で売った分も出す（s7。取り合いの結果が見えるように）
      const rv = x.caravans ? `。${world.rivals.map((r) => r.name).join('・') || 'ライバル'}は${x.others ? `${x.others}個を売った（約${Math.round(x.rivalValue || 0)}銀）` : '0個'}` : '';
      const txt = x.sold > 0
        ? `${nm(world, x.fair)}の隊商市が${x.full ? `${x.want}個を買い終えて` : ''}閉じた。${g}を${x.sold}個売って${Math.round(x.value)}銀（同じ日に${nm(world, x.low)}で売っていたら約${Math.round(x.lowValue)}銀）${rv}`
        : `${nm(world, x.fair)}の隊商市が${x.full ? `${x.want}個を買い終えて` : ''}閉じた${rv}`;
      emit(world, { type: 'shiftEnd', city: x.fair, rare: x.sold > 0 && x.value > x.lowValue * 1.2, text: `${txt}${tailText(world, x)}` });
    }
  }
}

// 市が閉じたあとも安値が長く続くとき（s8）: 安値の終わりと次の予告の早い日、荷の扱い方（32回目の相談: 市のあとの約100日が、荷の整理と待ちになった）
function tailText(world, x) {
  const sc = world.scenario.shifts;
  if (x.end - fairEnd(x) < 20) return '';
  const lead = sc.travelLead ? Math.max(...Object.values(world.shiftTravelDays || {}), 0) + 4 : sc.lead;
  const next = Math.max(world.day + 1, x.end + (sc.gap?.[0] ?? 0) - lead);
  return `。${nm(world, x.low)}の${GOODS[x.good].name}の安値は${x.end - 1}日目まで続く。持っている${GOODS[x.good].name}は、倉庫に置くか、最低売値をつけて持ち越すか、ほかの品の便に組み替えよ（安値の間は、ほかの品で稼ぐ時期）。次の予告は早くて${next}日目`;
}

// 終わったとき（勝ち・負け）に開いている隊商市の途中の結果（市が閉じる前に終わると、最後に効いた判断の答えが見えなかった。24回目の Sol）
export function openFairNotes(world) {
  return (world.shifts || []).filter((x) => fairActive(world, x) && x.sold > 0).map((x) =>
    `${nm(world, x.fair)}の隊商市（開いている途中）: ${GOODS[x.good].name}を${x.sold}個売って${Math.round(x.value)}銀（同じ日に${nm(world, x.low)}で売っていたら約${Math.round(x.lowValue)}銀）`);
}

// 隊商市の売値の目安（1個目と、10個まとめて売ったときの1個あたり）。始まる前は、始まりの日の市を仮に作って測る
// （市でいくらで買うかがどこにも出ず、最低売値が当て推量になって全部持ち帰った。24回目の Opus）
export function fairPrice(world, x) {
  const sc = world.scenario.shifts;
  const c = world.cities[x.fair];
  if (!sc || !c || fairClosed(world, x)) return null;
  // まとめ売りの目安は、市があと買う数を超えない（総量5個の市に「10個まとめて」と出ていた。25回目の Sol）
  const n = Math.max(1, Math.min(10, x.want ? x.want - x.sold - (x.others || 0) : 10));
  if (fairActive(world, x)) return { one: quote(world, c, x.good, -1), ten: quote(world, c, x.good, -n) / n, n, now: true };
  const keep = { cap: c.fairPriceMax, fd: c.fairDemand, pm: c.priceMods, st: c.stock[x.good] };
  if (sc.fair.priceMax) c.fairPriceMax = { [x.good]: sc.fair.priceMax };
  c.fairDemand = { ...(c.fairDemand || {}), [x.good]: sc.fair.demand };
  c.priceMods = { ...(c.priceMods || {}), [x.good]: (c.priceMods?.[x.good] ?? 1) * sc.fair.price };
  c.stock[x.good] = sc.fair.demand * B.targetStockDays * (sc.fair.stock ?? 0);
  const r = { one: quote(world, c, x.good, -1), ten: quote(world, c, x.good, -n) / n, n, now: false };
  c.fairPriceMax = keep.cap; c.fairDemand = keep.fd; c.priceMods = keep.pm; c.stock[x.good] = keep.st;
  return r;
}
export function fairPriceText(world, x) {
  const p = fairPrice(world, x);
  return p ? `${p.now ? '今の' : ''}市の売値の目安: 1個目は約${Math.round(p.one)}銀、${p.n > 1 ? `${p.n}個まとめて売ると1個あたり約${Math.round(p.ten)}銀` : '残りは1個'}（毎日約${world.scenario.shifts.fair.demand}個ずつ売れていき、値が戻る）` : '';
}

// 予告から組んだ予約を、切り替わらないまま逃したら知らせる。積み待ちで締切が近いときも知らせる
// （積み待ちのあいだに期間が過ぎ、市で1個も売らないまま、いつもの便に戻っていたことに気づけなかった。24回目の Sol）
export function noteAltMiss(world, m, a) {
  if (!a.shift || a.used || a.missed) return;
  a.missed = true;
  const x = (world.shifts || []).find((s) => s.id === a.shift);
  const st = m.order?.stops?.[m.order.next];
  const why = m.order?.holding && st?.waitFor ? `${nm(world, m.city)}で${GOODS[st.waitFor.good].name}を待っていた（${Math.floor(m.cargo[st.waitFor.good] || 0)}/${st.waitFor.qty}個）` : '期間中に、市に間に合う町で切り替われなかった';
  emit(world, { type: 'orderNote', merchant: m.id, city: m.city, bad: true, text: `${m.name}: 予告#${a.shift}${x ? `（${nm(world, x.fair)}の隊商市）` : ''}の臨時の便に切り替わらないまま、予約の期間が過ぎた。${why}` });
}
function watchAlts(world) {
  for (const m of world.player.merchants) for (const a of m.order?.alts || []) {
    if (!a.shift) continue;
    // 切り替わったあと、積む町で待っているうちに市に間に合わなくなるときも知らせる
    // （切り替わった予約は「逃した」に数えず、積み待ちのまま市で1個も売らずに、いつもの便へ戻っていた。26回目の Sol）
    if (a.used) { watchLoading(world, m, a); continue; }
    if (world.day >= a.until) { noteAltMiss(world, m, a); continue; }
    const st = m.order.stops[m.order.next];
    if (!a.warned && world.day >= a.from && a.until - world.day <= 3 && m.order.holding && st?.waitFor) {
      a.warned = true;
      emit(world, { type: 'orderNote', merchant: m.id, city: m.city, bad: true, text: `${m.name}: 予告#${a.shift}の臨時の便の期間は、あと${a.until - world.day}日。${nm(world, m.city)}で${GOODS[st.waitFor.good].name}を待っている（${Math.floor(m.cargo[st.waitFor.good] || 0)}/${st.waitFor.qty}個）。待つ数を減らすか、手で出発させないと逃す` });
    }
  }
}

function watchLoading(world, m, a) {
  const o = m.order;
  const st = o.stops[o.next];
  if (a.loadNoted || o.altOn !== a.id || m.travel || !o.holding || !st?.waitFor) return;
  const x = (world.shifts || []).find((y) => y.id === a.shift);
  if (!x || fairClosed(world, x)) return;
  const route = findPath(world, m.city, x.fair, m.transport);
  if (!route) return;
  const last = fairEnd(x) - 1 - route.days;
  if (world.day < last - 3) return;
  a.loadNoted = true;
  const have = `${nm(world, m.city)}で${GOODS[st.waitFor.good].name}を待っている（${Math.floor(m.cargo[st.waitFor.good] || 0)}/${st.waitFor.qty}個）`;
  emit(world, { type: 'orderNote', merchant: m.id, city: m.city, bad: true, text: last >= world.day
    ? `${m.name}: 予告#${a.shift}の臨時の便で、${have}。${last}日目までに出ないと、${nm(world, x.fair)}の市が閉じる前に着かない。待つ数を減らすか、手で出発させる`
    : `${m.name}: 予告#${a.shift}の臨時の便で、${have}。もう${nm(world, x.fair)}の市が閉じる前には着かない` });
}

// 閉じた市へ回る臨時の便は、次に町を出るときにいつもの便へ戻す（空の市と交易所を往復し続けないように）
function closeAltsTo(world, x) {
  for (const m of world.player.merchants) for (const a of m.order?.alts || []) {
    if (a.until > x.full && a.stops.some((s) => s.city === x.fair)) a.until = Math.max(a.from + 1, x.full);
  }
}

// 隊商市で売った分を記録する（終わりの知らせで、読んだ得を数字で見せる）
export function noteShiftSale(world, city, good, n, gain) {
  for (const x of world.shifts || []) {
    if (x.fair !== city.id || x.good !== good || !fairActive(world, x)) continue;
    x.sold += n;
    x.value += gain;
    if (x.want && x.sold + (x.others || 0) >= x.want && !x.full) {
      x.full = world.day + 1;
      closeAltsTo(world, x);
    }
    const low = world.cities[x.low];
    if (low) x.lowValue += quote(world, low, good, -n);
  }
}

// ライバルの隊商が隊商市で売った分（s7 の試作 (a)。22回目の相談）: 市が買う総量を、プレイヤーと取り合う
export function noteRivalFairSale(world, city, good, n, gain) {
  for (const x of world.shifts || []) {
    if (x.fair !== city.id || x.good !== good || !fairActive(world, x)) continue;
    x.others = (x.others || 0) + n;
    x.rivalValue = (x.rivalValue || 0) + gain;
    if (x.want && x.sold + x.others >= x.want && !x.full) {
      x.full = world.day + 1;
      closeAltsTo(world, x);
    }
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
  return { left, text: `隊商市は、${names(sc.fairs)}の${n}つを一巡するまで同じ町に立たない。${used.length ? `この一巡で、まだ予告の出ていない町は${names(left)}（決まるのは町だけ。始まる日・安くなる町・総量は、予告まで分からない）` : '次の予告から新しい一巡（どの町にも立ちうる）'}` };
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
    if (x.low === city.id) out.push({ kind: on ? 'down' : 'shift', text: on ? `📉${g}の大量入荷中（${when}）。${g}は安くしか売れない。${fairClosed(world, x) ? `${nm(world, x.fair)}の隊商市は${fairStateText(world, x)}` : `隊商市は${nm(world, x.fair)}（${fairStateText(world, x)}）`}` : `📉${when}、${g}が大量に入って安くなる（${x.start}〜${x.end - 1}日目）。そのあいだ${nm(world, x.fair)}の隊商市が高く買う` });
    if (x.fair === city.id && world.day < fairEnd(x)) out.push({ kind: fon ? 'up' : 'shift', text: fon ? `🎪隊商市が立っている（${fwhen}）。${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく）${wantText(x)}` : `🎪${fwhen}、隊商市が立つ（${x.start}〜${fairEnd(x) - 1}日目）。${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく）${wantText(x)}` });
  }
  return out;
}

const baseStopsOf = (o) => (o?.altOn ? o.base : o?.stops) || [];
// その予告の期間にかかる臨時の便の予約
// 予告から組んだ予約は予告の番号で、手で組んだ予約は「隊商市の町へ行き、期間が重なる」で見る
// （期間の重なりだけを見ていて、別の市への予約まで「予約ずみ」と出た。24回目の Sol）
export function altCovering(m, x) {
  // 手で組んだ予約の期間は「切り替わる期間」で、市より行く日数だけ前にある。予告が出てから市が閉じるまでに重なれば数える（25回目の Opus）
  return (m.order?.alts || []).find((a) => (a.shift ? a.shift === x.id : a.stops.some((s) => s.city === x.fair) && a.from < fairEnd(x) && a.until > x.announce)) || null;
}

// 定期便の停泊地が、予告された低迷にかかるか（商人の欄に出す）
export function orderShiftWarnings(world, m) {
  if (!m.order) return [];
  const out = [];
  for (const x of knownShifts(world)) {
    const st0 = baseStopsOf(m.order).find((s) => s.city === x.low && (s.sell || []).some((v) => v.good === x.good));
    if (!st0) continue;
    const alt = altCovering(m, x);
    // 今回っている臨時の便は、商人の欄に出ているので重ねて出さない（25回目の Sol）
    if (alt && m.order.altOn === alt.id) continue;
    const covered = !!alt;
    out.push({ shift: x, covered, text: covered ? `臨時の便を予約ずみ（${alt.from}〜${alt.until}日目）` : `この便の売り先${nm(world, x.low)}は、${shiftActive(world, x) ? `今${GOODS[x.good].name}が安い（あと${x.end - world.day}日）` : `${x.start - world.day}日後から${GOODS[x.good].name}が安い`}。${fairClosed(world, x) ? `${nm(world, x.fair)}の隊商市は${fairStateText(world, x)}` : `隊商市は${nm(world, x.fair)}（${fairStateText(world, x)}）`}` });
  }
  return out;
}

// 臨時の便の期間の目安（これは「切り替わる」期間。隊商市で売れる期間とは別）: 隊商市まで行く日数だけ、始まりと終わりを前へずらす。
// 着くのが始まりより早いと、まだ買ってもらえないので1日あとに着くようにする（市が閉じる前に着けない町では、切り替わらない。orders.js の switchAlt）。
// ready: 商人が今の旅を終えて、便の最初の停泊地に戻れる日（帰り道の商人に、間に合わない予約を勧めていた。21回目の Sol）。
// late: 戻ってから出ても間に合わない
// 町 at で便 stops に切り替えたときの、最初の行き先と、隊商市へ着く日（積み待ちは入らない）。
// 今いる町が便にあればそこから。なければ、市で売る品を積んでいれば市へ直に、積んでいなければ最初の停泊地から
export function altEntry(world, m, stops, at, x = null, day = world.day) {
  let entry = stops.findIndex((s) => s.city === at);
  if (entry < 0) {
    const j = stops.findIndex((s) => (s.sell || []).some((v) => (m.cargo[v.good] || 0) >= 1));
    entry = j >= 0 ? j : 0;
  }
  if (!x) return { entry };
  const f = stops.findIndex((s) => s.city === x.fair);
  if (f < 0) return { entry, arrive: Infinity };
  const leg = (a, b) => (a === b ? 0 : findPath(world, a, b, m.transport)?.days ?? Infinity);
  let t = day + leg(at, stops[entry].city);
  for (let i = entry; i !== f; i = (i + 1) % stops.length) t += leg(stops[i].city, stops[(i + 1) % stops.length].city);
  return { entry, arrive: t };
}

// arrive: 今予約したときに隊商市へ着く日の目安。afterStart: 始まってから切り替えたときに着く日（「始まってからでは間に合わない」と一律に書いていたが、
// 近い商人は間に合った。22回目の Sol。商人ごとの見込みに替えた）。どちらも積み待ちは入らない
export function altWindowFor(world, m, x, stops) {
  // 市の町を通らない便（いつもの便など）を渡されたら、臨時の便の下書きで測る（いつもの便で測って、届く便まで「着けない」と出ていた。25回目の Sol）
  if (!stops?.some((s) => s.city === x.fair)) stops = altDraftFor(world, m, x) || stops;
  const base = baseStopsOf(m.order);
  const home = stops?.[0]?.city || base[0]?.city || m.city;
  const dist = (c) => findPath(world, c, x.fair, m.transport)?.days ?? Infinity;
  const d = dist(home);
  // 期間: いつもの便のどの町で切り替わっても市に間に合うように、遠い町から出る日に始め、近い町から出る日に終える
  // （交易所からの日数だけで決めていたので、糖蜜町や翠糖京から直に行けば間に合う便が入らなかった。24回目の Opus）
  const ds = [home, ...base.map((s) => s.city)].map(dist).filter((v) => v < Infinity);
  const dmax = Math.max(d, ...ds), dmin = Math.min(d, ...ds);
  const start = Math.max(world.day, x.start - dmax + 1);
  const until = Math.max(start + 1, fairEnd(x) - dmin - 1);
  let ready = world.day;
  const at = m.travel ? m.travel.to : m.city;
  if (m.travel) ready += Math.max(0, Math.ceil(m.travel.totalDays - m.travel.elapsed));
  const t0 = ready;
  if (at !== home) ready += findPath(world, at, home, m.transport)?.days ?? 0;
  // 着く日の目安: 今の旅の行き先から、いつもの便をたどり、切り替われる最初の町で切り替えたとき
  const route = stops || [];
  const firstArrive = (from) => {
    if (!route.length || !base.length) return Infinity;
    let c = at, t = t0, i = Math.max(0, base.findIndex((s) => s.city === at));
    for (let k = 0; k < 2 * base.length + 2 && t < until; k++) {
      if (t >= from) {
        const r = altEntry(world, m, route, c, x, t);
        if (r.arrive <= fairEnd(x) - 1 && r.arrive >= x.start - 2) return Math.max(r.arrive, x.start);
      }
      const n = base[(i + 1) % base.length].city;
      t += c === n ? 0 : findPath(world, c, n, m.transport)?.days ?? Infinity;
      c = n; i = (i + 1) % base.length;
    }
    return Infinity;
  };
  const arrive = firstArrive(start);
  const afterStart = firstArrive(Math.max(x.start, world.day));
  return { from: start, until, days: d, ready, late: arrive > fairEnd(x) - 1, lastSale: fairEnd(x) - 1, arrive, afterStart };
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
  // 積むのは市の品だけ、上限なし（いつもの便の「白糖8個まで」が写り、総量10の市に8個しか運べなかった。ほかの品で荷台が埋まり、待つ数に届かなかった。26回目の Opus）
  if ((home.load || []).some((l) => String(l).split('*')[0] === x.good)) home.load = [x.good];
  return [home, { city: x.fair, buy: [], sell: (at.sell || []).map((v) => ({ ...v, min: 0 })), unload: [], load: [] }];
}
