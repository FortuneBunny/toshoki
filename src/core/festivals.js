// 大祭の予告（28回目の相談。s5 で試作）: 町の大祭が、約30日前に予告されて、決まった期間だけ開かれる。
// 目標のラッシュは、大祭の期間に始まったものだけを数える（during: 'festival'）。
// 甘味を流し続ける固定の便は、ラッシュの起きる日がたまたまになり、大祭の直前に起きると、続くクラッシュで大祭を逃す。
// 予告を読む人は、大祭の前に甘味を止めて、期間に合わせてまとめて届ける
// 予定は世界を作るときに、プレイヤーの行動と別の乱数で決める。予告したあとは変えない
import { hashSeed } from './rng.js';
import { emit } from './events.js';

// シナリオの定義: festivals: { city, first: [最初の開始日の幅], gap: [休みの幅], lead: 予告の日数, days: 続く日数 }
export function planFestivals(world) {
  const sc = world.scenario.festivals;
  if (!sc) return;
  let s = hashSeed(`festival:${world.scenarioId}:${world.seed}`);
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = ([lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1));
  const list = [];
  let start = between(sc.first);
  while (start < (world.scenario.deadline || 600)) {
    list.push({ id: list.length + 1, city: sc.city, announce: Math.max(1, start - sc.lead), start, end: start + sc.days });
    start += sc.days + between(sc.gap);
  }
  world.festivals = list;
}

export function knownFestivals(world) {
  return (world.festivals || []).filter((x) => world.day >= x.announce && world.day < x.end);
}
export const festivalActive = (world, x) => world.day >= x.start && world.day < x.end;
export const festivalOn = (world, cityId) => (world.festivals || []).some((x) => x.city === cityId && festivalActive(world, x));
export const festivalStateText = (world, x) => (festivalActive(world, x) ? `今（あと${x.end - world.day}日、${x.end - 1}日目まで）` : `${x.start - world.day}日後から（${x.start}〜${x.end - 1}日目）`);

const nm = (world, id) => world.cities[id]?.name || id;
// 目標での大祭のラッシュの数え方（during: 'festival' なら大祭の分だけ、festivalWeight: n なら n 回ぶん）
function countText(world, cityId) {
  const g = (world.scenario.goals || []).find((x) => x.type === 'rushes' && x.city === cityId);
  if (!g) return '';
  if (g.during === 'festival') return '目標のラッシュは、大祭の期間に始まったものだけを数える';
  if (g.festivalWeight) return `大祭の期間に始まったラッシュは、目標に${g.festivalWeight}回ぶん数える`;
  return '';
}

// ラッシュの知らせに足す一言
export function festRushSuffix(world, cityId, fest) {
  if (!world.scenario.festivals) return '';
  const g = (world.scenario.goals || []).find((x) => x.type === 'rushes' && x.city === cityId);
  if (g?.festivalWeight) return fest ? `（大祭のラッシュ。目標に${g.festivalWeight}回ぶん数える）` : '';
  if (g?.during === 'festival') return fest ? '（大祭のラッシュ。目標に数える）' : '（大祭の期間ではないので、目標には数えない）';
  return fest ? '（大祭のラッシュ）' : '';
}

export const festivalCountText = (world, cityId) => countText(world, cityId);

// 予告・始まり・終わりの知らせ（毎日）
export function updateFestivals(world) {
  const sc = world.scenario.festivals;
  if (!sc) return;
  if (!world.festivals) planFestivals(world);
  for (const x of world.festivals || []) {
    const c = nm(world, x.city);
    if (world.day === x.announce) emit(world, { type: 'grandFest', big: true, city: x.city, festival: x.id, text: `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${sc.days}日間）、${c}で大祭が開かれる。${countText(world, x.city)}。ラッシュのあとには、甘味を受けつけないクラッシュ（約18日）が来るので、大祭の前にラッシュを起こすと大祭を逃す。甘味の便を止めて、大祭に合わせて2種類まとめて届けよ` });
    if (world.day === x.start) emit(world, { type: 'grandFestStart', city: x.city, text: `${c}の大祭が始まった（${x.end - 1}日目まで）。今ラッシュが始まれば、${world.scenario.goals?.some((g) => g.type === 'rushes' && g.festivalWeight) ? '目標に多く数える' : '目標に数える'}` });
    if (world.day === x.end) emit(world, { type: 'grandFestEnd', city: x.city, text: `${c}の大祭が終わった` });
  }
}

// 町の「これから」に出す行
export function festivalNotes(world, city) {
  return knownFestivals(world).filter((x) => x.city === city.id).map((x) => ({ kind: festivalActive(world, x) ? 'up' : 'shift', text: `🎆大祭 ${festivalStateText(world, x)}。${countText(world, city.id) || 'この間に始まったラッシュは祝いが大きい'}` }));
}
