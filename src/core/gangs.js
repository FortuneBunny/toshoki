// 強盗団の予告（28回目の相談。s4 で試作）: 護衛では撃退できない強盗団が、約20日前に予告されて、決まった区域に決まった期間だけ居座る。
// s4 のいちばん強い固定の手は、護衛なしで玻璃の都↔オアシスの道を絹を積んで通り続ける（S 66%。28回目の Opus）。
// 読む人は、区域を避けて別の道を回るか、期間の前に運び終えるか、便を止めて待つ。懸賞金はない（撃退を稼ぎにしない。28回目の Sol）
// s4 では、奪うのではなく足止めする（holdDays）: 区域で捕まった便は、積荷は無事のまま最大30日動けない。積荷を奪う形は、固定の手が銀を失って完走できなくなった（2回目の Sol）
// 予定は世界を作るときに、プレイヤーの行動と別の乱数で決める。予告したあとは変えない
import { GOODS } from '../data/goods.js';
import { hashSeed, inStream, chance } from './rng.js';
import { emit } from './events.js';
import { TILE_PX } from './grid.js';

// シナリオの定義: gangs: { zones: [{ id, name, x, y, r（px）, hint }], first, gap, lead, days, chance: 区域の1マス1日の襲われる率, loss: 奪われる割合,
//   holdDays: あれば奪わずに足止めする日数（一団につき各便一度）, stopAfter: その日で強盗団は来なくなる }
export function planGangs(world) {
  const sc = world.scenario.gangs;
  if (!sc) return;
  let s = hashSeed(`gang:${world.scenarioId}:${world.seed}`);
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = ([lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1));
  const list = [];
  let start = between(sc.first);
  // 区域は袋から引く（一巡するまで同じ区域にならない）
  let bag = [];
  const stop = sc.stopAfter ?? Infinity;
  while (start < Math.min(stop, world.scenario.deadline || 600)) {
    if (!bag.length) bag = sc.zones.map((z) => z.id);
    const zone = bag.splice(Math.floor(rnd() * bag.length), 1)[0];
    list.push({ id: list.length + 1, zone, announce: Math.max(1, start - sc.lead), start, end: Math.min(start + sc.days, stop) });
    start += sc.days + between(sc.gap);
  }
  world.gangs = list;
}

// 予告ずみの強盗団（画面とボットが読んでよいのはこれだけ）
export function knownGangs(world) {
  return (world.gangs || []).filter((x) => world.day >= x.announce && world.day < x.end);
}
export const gangActive = (world, x) => world.day >= x.start && world.day < x.end;
export const gangZone = (world, x) => world.scenario.gangs.zones.find((z) => z.id === x.zone);
export const gangStateText = (world, x) => (gangActive(world, x) ? `今（あと${x.end - world.day}日、${x.end - 1}日目まで）` : `${x.start - world.day}日後から（${x.start}〜${x.end - 1}日目）`);
// マス（x, y）がその区域に入るか
export const inGangZone = (z, x, y) => Math.hypot(z.x / TILE_PX - x, z.y / TILE_PX - y) <= z.r / TILE_PX;

// 旅の途中の1日ぶん。区域にいれば、護衛に関係なく襲われうる
export function gangCheck(world, m, x, y, k) {
  const sc = world.scenario.gangs;
  if (!sc || !world.gangs) return;
  for (const g of world.gangs) {
    if (!gangActive(world, g)) continue;
    const z = gangZone(world, g);
    if (!inGangZone(z, x, y)) continue;
    inStream(world, `gang:${m.id}:${k}`, () => {
      if (!chance(world, sc.chance)) return;
      if (sc.holdDays) {
        m.gangHeldIds ??= [];
        if (m.gangHeldIds.includes(g.id) || !m.travel) return;
        m.gangHeldIds.push(g.id);
        m.travel.gangHeldUntil = Math.min(world.day + sc.holdDays, sc.stopAfter ?? Infinity);
        m.travel.totalDays += m.travel.gangHeldUntil - world.day;
        world.stats.gangHeldCount = (world.stats.gangHeldCount || 0) + 1;
        emit(world, { type: 'gangHeld', merchant: m.id, bad: true, gang: g.id, text: `${m.name}が${z.name}で強盗団に捕まり、${m.travel.gangHeldUntil - world.day}日間足止めされる（${m.travel.gangHeldUntil}日目まで）。積荷は無事で、待つ間は食料も護衛の給金も要らない` });
        return;
      }
      let lost = 0;
      let lostValue = 0;
      for (const id of Object.keys(m.cargo)) {
        const q = Math.ceil(m.cargo[id] * sc.loss);
        m.cargo[id] -= q;
        lost += q;
        lostValue += q * GOODS[id].base;
        if (!m.cargo[id]) delete m.cargo[id];
      }
      world.stats.gangLoss = (world.stats.gangLoss || 0) + lostValue;
      world.stats.banditLoss = (world.stats.banditLoss || 0) + lostValue;
      emit(world, { type: lost ? 'robbed' : 'robbedNothing', merchant: m.id, bad: true, gang: g.id, text: `${m.name}が${z.name}で強盗団に襲われ、積荷${lost}個（約${Math.round(lostValue)}銀分）を奪われた（護衛では防げない）` });
    });
    return;
  }
}

// 強盗団に遭うとどうなるか
const harmText = (sc) => (sc.holdDays ? `区域に入った隊商は捕まって${sc.holdDays}日足止めされる（一団につき一度。積荷は無事）` : `区域を通る隊商は積荷の約${Math.round(sc.loss * 10)}割を奪われうる`);

// 予告・始まり・終わりの知らせ（毎日）
export function updateGangs(world) {
  const sc = world.scenario.gangs;
  if (!sc) return;
  if (!world.gangs) planGangs(world);
  for (const x of world.gangs || []) {
    const z = gangZone(world, x);
    if (world.day === x.announce) emit(world, { type: 'gang', big: true, zone: x.zone, gang: x.id, text: `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${x.end - x.start}日間）、${z.name}に強盗団が居座る。護衛では防げず、${harmText(sc)}。${z.hint}` });
    if (world.day === x.start) emit(world, { type: 'gangStart', zone: x.zone, text: `${z.name}に強盗団が現れた（${x.end - 1}日目まで）` });
    if (world.day === x.end) emit(world, { type: 'gangEnd', zone: x.zone, text: `${z.name}の強盗団が去った` });
  }
}

// 町の「これから」に出す行（区域のそばの町）
export function gangNotes(world, city) {
  return knownGangs(world).filter((x) => {
    const z = gangZone(world, x);
    return Math.hypot(z.x - city.x, z.y - city.y) <= z.r + 220;
  }).map((x) => ({ kind: 'shift', text: `🗡強盗団 ${gangZone(world, x).name} ${gangStateText(world, x)}。護衛では防げない${world.scenario.gangs.holdDays ? `（捕まると${world.scenario.gangs.holdDays}日足止め）` : ''}` }));
}
