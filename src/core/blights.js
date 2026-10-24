// 産地の不作の予告（22回目の相談の作業5。s2 で小さく試作）: ある品が、予告した期間だけ、どの産地でも少ししか採れなくなる。
// 予定は世界を作るときに、プレイヤーの行動と別の乱数で決める。プレイヤーの売り筋はねらわない（どの産地にも同じだけ効く）。予告したあとは変えない。
// 読む人は、始まる前に自分の交易所へ多めに届けておくか、積荷に残しておき、食卓と、入荷が細って高くなる町への売りに回す（s2 には倉庫がない。27回目の Sol）
import { GOODS } from '../data/goods.js';
import { hashSeed } from './rng.js';
import { emit } from './events.js';

// シナリオの定義: blights: { goods: [品], first: [最初の開始日の幅], gap: [休みの幅], lead: 予告の日数, days: 続く日数, cut: 作る量の倍率 }
export function planBlights(world) {
  const sc = world.scenario.blights;
  if (!sc) return;
  let s = hashSeed(`blight:${world.scenarioId}:${world.seed}`);
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = ([lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1));
  const list = [];
  let start = between(sc.first);
  // 品は袋から引く（一巡するまで同じ品にならない）
  let bag = [];
  while (start < (world.scenario.deadline || 600)) {
    if (!bag.length) bag = [...sc.goods];
    const good = bag.splice(Math.floor(rnd() * bag.length), 1)[0];
    list.push({ id: list.length + 1, good, announce: Math.max(1, start - sc.lead), start, end: start + sc.days });
    start += sc.days + between(sc.gap);
  }
  world.blights = list;
}

// 予告ずみの不作（画面とボットが読んでよいのはこれだけ）
export function knownBlights(world) {
  return (world.blights || []).filter((x) => world.day >= x.announce && world.day < x.end);
}
export const blightActive = (world, x) => world.day >= x.start && world.day < x.end;
export const blightStateText = (world, x) => (blightActive(world, x) ? `今（あと${x.end - world.day}日、${x.end - 1}日目まで）` : `${x.start - world.day}日後から（${x.start}〜${x.end - 1}日目）`);
const cutText = (world) => `作る量が約${Math.round(world.scenario.blights.cut * 10)}割に`;
// その品を作っている町（予告の文に出す）
const producers = (world, good) => Object.values(world.cities).filter((c) => (c.produces?.[good] || 0) > 0);

// 毎日の補正（applyModifiers の中）: どの産地も、作る量を cut 倍に
export function applyBlights(world) {
  const sc = world.scenario.blights;
  if (!sc) return;
  for (const x of world.blights || []) {
    if (!blightActive(world, x)) continue;
    for (const c of producers(world, x.good)) c.prodMods[x.good] = (c.prodMods[x.good] ?? 1) * sc.cut;
  }
}

// 予告・始まり・終わりの知らせ（毎日）
export function updateBlights(world) {
  const sc = world.scenario.blights;
  if (!sc) return;
  if (!world.blights) planBlights(world);
  for (const x of world.blights || []) {
    const g = GOODS[x.good].name;
    if (world.day === x.announce) {
      const names = producers(world, x.good).map((c) => c.name).join('・');
      emit(world, { type: 'blight', big: true, blight: x.id, text: `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${sc.days}日間）、${g}が不作になる。どの産地も${cutText(world)}（今${g}を作っている町: ${names || 'なし'}）。入荷が細る町では${g}が高くなり、${g}を食べる交易所の食卓も足りなくなる。始まる前に、自分の交易所へ多めに届けておけば（市場の在庫が食卓になる）食卓が持つ。積荷に残しておけば、高くなった町で売れる（倉庫は工房のある町だけ）` });
    }
    if (world.day === x.start) emit(world, { type: 'blightStart', text: `${g}の不作が始まった（${x.end - 1}日目まで。どの産地も${cutText(world)}）` });
    if (world.day === x.end) emit(world, { type: 'blightEnd', text: `${g}の不作が終わった` });
  }
}

// 町の「これから」に出す行
export function blightNotes(world, city) {
  const out = [];
  for (const x of knownBlights(world)) {
    if (!((city.produces?.[x.good] || 0) > 0)) continue;
    const g = GOODS[x.good].name;
    out.push({ kind: blightActive(world, x) ? 'down' : 'shift', text: `🌾${g}の不作 ${blightStateText(world, x)}。${cutText(world)}` });
  }
  return out;
}
