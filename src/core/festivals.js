// 大祭の予告（28回目の相談。s5 で試作）: 町の大祭が、約30日前に予告されて、決まった期間だけ開かれる。
// 目標のラッシュは、大祭の期間に始まったものだけを数える（during: 'festival'）。
// 甘味を流し続ける固定の便は、ラッシュの起きる日がたまたまになり、大祭の直前に起きると、続くクラッシュで大祭を逃す。
// 予告を読む人は、大祭の前に甘味を止めて、期間に合わせてまとめて届ける
// 予定は世界を作るときに、プレイヤーの行動と別の乱数で決める。予告したあとは変えない
import { hashSeed } from './rng.js';
import { emit } from './events.js';
import { BALANCE as B } from '../data/balance.js';
import { rushRipe } from './city.js';

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
  if (g?.during === 'festival') {
    if (fest) return '（大祭のラッシュ。目標に数える）';
    if (g.anyAfter && world.day >= g.anyAfter) return `（${g.anyAfter}日目を過ぎたので、大祭の外のラッシュも目標に数える）`;
    const next = (world.festivals || []).find((x) => x.city === cityId && x.start > world.day && x.announce <= world.day);
    const clash = next && next.start - world.day < B.rushDays + B.crashDays ? `。反動のクラッシュが、${next.start - world.day}日後の大祭に重なる` : '';
    return `（大祭の期間ではないので、目標には数えない${next ? `。次の大祭まで${next.start - world.day}日` : ''}${clash}）`;
  }
  return fest ? '（大祭のラッシュ）' : '';
}

export const festivalCountText = (world, cityId) => countText(world, cityId);

// 予告・始まり・終わりの知らせ（毎日）
export function updateFestivals(world) {
  const sc = world.scenario.festivals;
  if (!sc) return;
  if (!world.festivals) planFestivals(world);
  // 救いの日を知らせる（画面だけのテスト7回目の Opus: 目標が「2回」から「1回」に、知らせなしで変わった）
  for (const g of world.scenario.goals || []) {
    if (g.type !== 'rushes') continue;
    if (g.relaxAfter && world.day === g.relaxAfter) emit(world, { type: 'goalRelax', big: true, text: `${g.relaxAfter}日目を過ぎた。目標の大祭のラッシュは、1回でよくなった` });
    if (g.anyAfter && world.day === g.anyAfter) emit(world, { type: 'goalRelax', big: true, text: `${g.anyAfter}日目を過ぎた。大祭の外のラッシュも目標に数える。${B.rushIgnite ? `${nm(world, g.city)}は、熟せば火を入れなくてもラッシュが起きる` : ''}` });
  }
  for (const x of world.festivals || []) {
    const c = nm(world, x.city);
    if (world.day === x.announce) emit(world, { type: 'grandFest', big: true, city: x.city, festival: x.id, text: `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${sc.days}日間）、${c}で大祭が開かれる。${countText(world, x.city)}。ラッシュのあとには、甘味を受けつけないクラッシュ（約${B.crashDays}日）が来るので、大祭の前にラッシュを起こすと大祭を逃す。${B.rushIgnite ? '甘味と食べ物を届け続けて町を熟させ、大祭に入ってから甘味をまとめて売って火を入れよ' : '甘味の便を止めて、大祭に合わせて2種類まとめて届けよ'}${B.rushIgnite && world.cities[x.city] ? `。${festGluForecast(world, world.cities[x.city], x)}` : ''}` });
    const city = world.cities[x.city];
    if (world.day === x.start) x.countAtStart = city?.festRushCount || 0;
    // 大祭の間に届いた最高の糖度と甘味の摂取（逃したわけに、実際の値を出す。34回目の Opus）
    if (city && world.day >= x.start && world.day < x.end) { x.peakGlu = Math.max(x.peakGlu || 0, city.glucose); x.peakSweet = Math.max(x.peakSweet || 0, city.sweetLevel || 0); }
    if (world.day === x.end && city && (city.festRushCount || 0) === (x.countAtStart ?? 0)) emit(world, { type: 'grandFestMissed', city: x.city, text: `${c}の大祭で、ラッシュが起きなかった。${missReason(world, city, x)}` });
    if (world.day === x.start) emit(world, { type: 'grandFestStart', city: x.city, text: `${c}の大祭が始まった（${x.end - 1}日目まで）。今ラッシュが始まれば、${world.scenario.goals?.some((g) => g.type === 'rushes' && g.festivalWeight) ? '目標に多く数える' : '目標に数える'}${B.rushIgnite && world.cities[x.city] ? (rushRipe(world, world.cities[x.city]) ? `。${c}は🔥熟している。甘味を持った商人で「🔥火を入れて売る」と、翌日ラッシュ` : `。${c}はまだ熟していない（糖度${Math.round(world.cities[x.city].glucose)}/${(world.scenario.rushLine ?? B.rushLine) - B.rushRipeGap}）。食べ物と甘味を届けて熟させよ`) : ''}` });
    if (world.day === x.end) emit(world, { type: 'grandFestEnd', city: x.city, text: `${c}の大祭が終わった` });
  }
}

// 今の届け方が続いたら、大祭の初日の糖度は（画面だけのテスト7回目の Opus: 予告の時点で、届けている量が足りるかが分からなかった）
export function festGluForecast(world, city, x) {
  const t = Math.max(0, x.start - world.day);
  const to = city.glucoseTarget ?? city.glucose;
  const g = to + (city.glucose - to) * Math.pow(1 - B.glucoseFollow, t);
  const ripe = (world.scenario.rushLine ?? B.rushLine) - B.rushRipeGap;
  return `今の届け方なら、大祭の初日の糖度は約${Math.round(g)}（${g >= ripe ? `熟す目安${ripe}に届く` : `熟す目安${ripe}に届かない。食べ物の種類と量を増やす`}）`;
}

// 大祭を逃したわけ（事後の1行）
function missReason(world, city, x) {
  const d = city.lastRushDay;
  if (d != null && d < x.start && d + B.rushDays + B.crashDays > x.start) return `${d}日目のラッシュの反動（クラッシュ）が大祭に重なった。次は、${B.rushIgnite ? '大祭の前には火を入れずに待て' : '大祭の前に甘味の便を止めて待て'}`;
  if (city.crash > 0 || (city.rush > 0 && d < x.start)) return 'ラッシュかその反動の最中で、大祭の間に新しいラッシュが起きなかった';
  const line = world.scenario.rushLine ?? B.rushLine;
  if (B.rushIgnite) {
    // 火入れ: 熟したか、火を入れたかを分けて知らせる（35回目の Sol: 糖度168・摂取102%でも「甘味不足」と出た）
    const ripeLine = line - B.rushRipeGap;
    const peakR = x.peakGlu != null ? `大祭の間の最高は、糖度 ${Math.round(x.peakGlu)}/${ripeLine}・甘味の摂取 ${Math.round((x.peakSweet || 0) * 100)}%/${Math.round(B.rushRipeSweet * 100)}%。` : '';
    const f = city.igniteFail;
    if (f && f.day >= x.start - 1 && f.day < x.end) return `${peakR}${f.day}日目に火入れを試したが、入らなかった: ${f.why}`;
    if (x.peakGlu != null && x.peakGlu >= ripeLine && (x.peakSweet || 0) >= B.rushRipeSweet) return `${peakR}町は熟していたが、火が入らなかった。熟した日に「火を入れて売る」で甘味をまとめて（町の画面の個数）売り、甘味を${B.rushIgniteKinds ?? 2}種類そろえよ`;
    return `${peakR}${x.peakGlu != null && x.peakGlu < ripeLine ? '糖度が足りず熟さなかった（食べ物の種類と量）' : '甘味の摂取が足りず熟さなかった'}。大祭の前に熟させ、大祭の間に火を入れよ`;
  }
  const peak = x.peakGlu != null ? `大祭の間の最高は、糖度 ${Math.round(x.peakGlu)}/${line}・甘味の摂取 ${Math.round((x.peakSweet || 0) * 100)}%/${Math.round(B.rushSweetLine * 100)}%。` : '';
  return `${peak}${x.peakGlu != null && x.peakGlu < line ? '糖度が足りなかった（食べ物の種類と量）' : '甘味（2種類以上）が足りなかった'}。大祭に合わせて、甘味をまとめて届けよ`;
}

// 町の「これから」に出す行
export function festivalNotes(world, city) {
  const out = [];
  for (const x of knownFestivals(world).filter((y) => y.city === city.id)) {
    out.push({ kind: festivalActive(world, x) ? 'up' : 'shift', text: `🎆大祭 ${festivalStateText(world, x)}。${countText(world, city.id) || 'この間に始まったラッシュは祝いが大きい'}${B.rushIgnite && !festivalActive(world, x) && !rushRipe(world, city) ? `。${festGluForecast(world, city, x)}` : ''}` });
    // 今ラッシュが起きると、反動が大祭に重なる（29回目の相談の Opus）
    const left = x.start - world.day;
    if (B.rushIgnite) { if (left > 0 && left < B.rushDays + B.crashDays && rushRipe(world, city)) out.push({ kind: 'down', text: `⚠今火を入れると、クラッシュ（${B.crashDays}日）が${left}日後の大祭に重なる。火を入れるのは大祭に入ってから（熟した町は、売らなければ起きない）` }); }
    else if (left > 0 && left < B.rushDays + B.crashDays && !(city.crash > 0) && !(city.rush > 0)) out.push({ kind: 'down', text: `⚠今ラッシュが起きると、クラッシュ（${B.crashDays}日）が${left}日後の大祭に重なる。甘味の便を止めて、大祭に合わせよ` });
  }
  return out;
}
