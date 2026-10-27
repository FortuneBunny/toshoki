// 強盗団の予告（28回目の相談。s4 で試作）: 護衛では撃退できない強盗団が、約20日前に予告されて、決まった区域に決まった期間だけ居座る。
// s4 のいちばん強い固定の手は、護衛なしで玻璃の都↔オアシスの道を絹を積んで通り続ける（S 66%。28回目の Opus）。
// 読む人は、区域を避けて別の道を回るか、期間の前に運び終えるか、便を止めて待つ。懸賞金はない（撃退を稼ぎにしない。28回目の Sol）
// s4 では、奪うのではなく足止めする（holdDays）: 区域で捕まった便は、積荷は無事のまま最大30日動けない。積荷を奪う形は、固定の手が銀を失って完走できなくなった（2回目の Sol）
// 予定は世界を作るときに、プレイヤーの行動と別の乱数で決める。予告したあとは変えない
import { GOODS } from '../data/goods.js';
import { hashSeed, inStream, chance } from './rng.js';
import { emit } from './events.js';
import { TILE_PX } from './grid.js';
import { dailyCost } from './world.js';
import { findPath } from './caravan.js';

// シナリオの定義: gangs: { zones: [{ id, name, x, y, r（px）, hint }], first, gap, lead, days, chance: 区域の1マス1日の襲われる率, loss: 奪われる割合,
//   holdDays: あれば奪わずに足止めする日数（一団につき各便一度）, stopAfter: その日で強盗団は来なくなる,
//   edgeDays・edgeChance: 居座る期間の始めと終わりの edgeDays 日は、捕まる率を edgeChance にする（33回目の相談: きわどく攻めるのを賭けにする）,
//   boost: { city, good, mult, after, zones }: 強盗団がいる間と、去ってから after 日は、city で good が mult 倍で売れる（33回目の Opus: 避けるだけでは当たった手応えがない）。zones があれば、その区域の強盗団だけ }
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
// その日、区域にいる便が捕まる率
export function gangChanceOn(world, x, day) {
  const sc = world.scenario.gangs;
  if (day < x.start || day >= x.end) return 0;
  const e = sc.edgeDays || 0;
  return e && (day - x.start < e || x.end - 1 - day < e) ? sc.edgeChance ?? sc.chance : sc.chance;
}
// 値上がりの期間（強盗団がいる間と、去ってから after 日）
const boostZone = (b, x) => !b.zones || b.zones.includes(x.zone);
export const gangBoostOn = (world, x) => !!world.scenario.gangs?.boost && boostZone(world.scenario.gangs.boost, x) && world.day >= x.start && world.day < x.end + (world.scenario.gangs.boost.after || 0);
export function applyGangs(world) {
  const b = world.scenario.gangs?.boost;
  if (!b || !world.gangs?.some((x) => gangBoostOn(world, x))) return;
  const c = world.cities[b.city];
  if (c) c.priceMods[b.good] = (c.priceMods[b.good] ?? 1) * b.mult;
}
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
      if (!chance(world, gangChanceOn(world, g, world.day))) return;
      if (sc.holdDays) {
        m.gangHeldIds ??= [];
        if (m.gangHeldIds.includes(g.id) || !m.travel) return;
        m.gangHeldIds.push(g.id);
        m.travel.gangHeldUntil = Math.min(world.day + sc.holdDays, sc.stopAfter ?? Infinity);
        m.travel.totalDays += m.travel.gangHeldUntil - world.day;
        world.stats.gangHeldCount = (world.stats.gangHeldCount || 0) + 1;
        emit(world, { type: 'gangHeld', merchant: m.id, bad: true, gang: g.id, text: `${m.name}が${z.name}で強盗団に捕まり、${m.travel.gangHeldUntil - world.day}日間足止めされる（${m.travel.gangHeldUntil}日目まで）。積荷は無事で、待つ間はこの商人の給金・乗り物の維持費・食料・護衛代はかからない。${moneyText(world, m.travel.gangHeldUntil)}` });
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
const harmText = (sc) => (sc.holdDays ? `区域に入った隊商は捕まって${sc.holdDays}日足止めされる（一団につき一度。積荷は無事で、その間の給金と維持費はかからないが、売上も入らない）${edgeText(sc)}` : `区域を通る隊商は積荷の約${Math.round(sc.loss * 10)}割を奪われうる`);
const edgeText = (sc) => (sc.edgeDays ? `。ただし居座る期間の始めと終わりの${sc.edgeDays}日は、見張りが手薄で、捕まるのは1日に約${Math.round((sc.edgeChance ?? sc.chance) * 10)}割` : '');
const boostText = (world, sc, x) => (sc.boost && boostZone(sc.boost, x) ? `。道がふさがる間${sc.boost.after ? `と、去ってから${sc.boost.after}日` : ''}（${x.end + sc.boost.after - 1}日目まで）は、${world.cities[sc.boost.city]?.name}で${GOODS[sc.boost.good].name}が品薄になり、約${sc.boost.mult}倍で売れる` : '');

// 旅が予告ずみの区域を通る日（31回目の Opus: 自分の便が区域を通るか・何日目に入るかが、どの画面にも出なかった）
// tiles・steps は findPath の経路。i・part は旅の途中から数えるとき。1日に進む量は才能だけを入れる（砂嵐・飢えの遅れは入らない）
// 旅の1日ぶんは、日付が進んだあとに、その日の始めのマスで強盗団を確かめる（caravan.js の stepTravel）。今日出ると、最初に確かめるのは明日
export function gangCrossings(world, m, tiles, steps, { i = 0, part = 0, day = world.day + 1 } = {}) {
  const known = knownGangs(world);
  if (!known.length || !tiles?.length) return [];
  const per = m.talent === 'swift' && !['dhow', 'carrack'].includes(m.transport) ? 1.15 : 1;
  const hits = new Map();
  for (let d = day; i < steps.length && d < day + 400; d++) {
    const [x, y] = tiles[Math.min(i, tiles.length - 1)];
    for (const g of known) {
      if (!inGangZone(gangZone(world, g), x, y)) continue;
      const h = hits.get(g.id) || { gang: g, from: d, to: d, safe: 1 };
      h.to = d;
      h.safe *= 1 - gangChanceOn(world, g, d);
      hits.set(g.id, h);
    }
    let budget = per;
    while (budget > 1e-9 && i < steps.length) {
      const need = steps[i] - part;
      if (budget >= need) { budget -= need; part = 0; i++; } else { part += budget; budget = 0; }
    }
  }
  return [...hits.values()].map(({ safe, ...h }) => ({ ...h, risk: 1 - safe, caught: h.from < h.gang.end && h.to >= h.gang.start }));
}
// きわどいときは、遅れるとどうなるかも書く（食料切れや砂嵐の遅れは、着く日を後ろへずらすだけ。32回目の Opus）
const marginText = (h) => (h.caught ? '' : h.to < h.gang.start && h.gang.start - h.to <= 3 ? `。⚠余裕は${h.gang.start - h.to}日だけ。遅れると捕まる` : h.from >= h.gang.end && h.from - h.gang.end <= 3 ? '。遅れる分には安全' : '');
export const gangCrossText = (world, hs) => hs.map((h) => `${gangZone(world, h.gang).name}を${h.from === h.to ? `${h.from}日目` : `${h.from}〜${h.to}日目`}に通る（強盗団は${h.gang.start}〜${h.gang.end - 1}日目 → ${h.caught ? (h.risk > 0.995 ? '⚠捕まる' : `⚠捕まる見込み 約${Math.round(h.risk * 100)}%`) : '重ならない'}${marginText(h)}）`).join('。') + (hs.length ? '（食料切れや砂嵐で遅れると、日が後ろへずれる）' : '');
// 捕まらずに出られるいちばん早い日（画面だけのテスト4回目の Opus: 何日に出れば安全かを自分で数え、待ちすぎた）
export function safeDepartDay(world, m, route) {
  const last = Math.max(0, ...knownGangs(world).map((g) => g.end));
  for (let d = world.day; d <= last; d++) if (!gangCrossings(world, m, route.tiles, route.steps, { day: d + 1 }).some((h) => h.caught)) return d;
  return last;
}
// 安全な日より前で、捕まる見込みが5割以下になるいちばん早い日（端の日の賭け。33回目の Opus）
export function gambleDepartDay(world, m, route) {
  const safe = safeDepartDay(world, m, route);
  for (let d = world.day; d < safe; d++) {
    const risk = Math.max(0, ...gangCrossings(world, m, route.tiles, route.steps, { day: d + 1 }).filter((h) => h.caught).map((h) => h.risk));
    if (risk > 0 && risk <= 0.5 + 1e-9) return { day: d, risk };
  }
  return null;
}
// 今の旅の残り
export const travelGangCrossings = (world, m) => (m.travel ? gangCrossings(world, m, m.travel.tiles, m.travel.steps, { i: m.travel.i, part: m.travel.part, day: Math.max(world.day + 1, m.travel.gangHeldUntil ?? 0) }).filter((h) => !(m.gangHeldIds || []).includes(h.gang.id)) : []);

// 足止めの間のお金の見通し（32回目の相談: 足止めの間に銀が尽き、借金で定期便が何も買えなくなった）
function moneyText(world, until) {
  const pl = world.player;
  const cost = dailyCost(world, { guards: true });
  if (cost <= 0) return '';
  const left = Math.floor(pl.silver / cost);
  const tail = '銀が尽きると、定期便は何も買えなくなる。倉庫の品を売る・護衛を減らす・商人に暇を出す、で備えよ';
  if (pl.silver < 0) return `今の銀は${Math.floor(pl.silver)}（借金）。1日の出費は約${Math.round(cost)}銀。${tail}`;
  return left < until - world.day ? `今の銀${Math.floor(pl.silver)}、1日の出費約${Math.round(cost)}銀 → 売上が入らなければ${world.day + left}日目ごろに借金になる。${tail}` : `今の銀${Math.floor(pl.silver)}なら、足止めが終わるまで出費（1日約${Math.round(cost)}銀）をまかなえる`;
}

// 予告の文。区域のおおよその場所（どの町とどの町の間か）と、今の旅で区域を通る商人も添える（31回目の Opus: 「玻璃の都の西」だけでは、辻からの行きも通ると分からなかった）
const announceText = (world, x, z, sc) => `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${x.end - x.start}日間）、${z.name}に強盗団が居座る。護衛では防げず、${harmText(sc)}${boostText(world, sc, x)}。${z.hint}`;
function travelersText(world, x) {
  const out = [];
  for (const m of world.player.merchants) {
    const h = travelGangCrossings(world, m).find((y) => y.gang.id === x.id && y.caught);
    if (h) out.push(`${m.name}（${h.from}日目に区域に入る）`);
  }
  return out.length ? `。⚠今の旅のままだと捕まる: ${out.join('、')}` : '';
}

// 予告の要点のカード（33回目の相談: 予告の文が長く、要点を探した。4行以内）
function gangCard(world, x, z, sc) {
  const t = travelersText(world, x);
  return {
    when: `${x.start}〜${x.end - 1}日目（${x.start - world.day}日後から${x.end - x.start}日間）`,
    where: z.name,
    what: `${sc.holdDays ? `区域に入った隊商は${sc.holdDays}日足止め（護衛では防げない。積荷は無事${sc.edgeDays ? `。始めと終わりの${sc.edgeDays}日は1日に約${Math.round((sc.edgeChance ?? sc.chance) * 10)}割` : ''}）` : `区域を通る隊商は積荷の約${Math.round(sc.loss * 10)}割を奪われうる`}${sc.boost && boostZone(sc.boost, x) ? `。${x.end + sc.boost.after - 1}日目まで、${world.cities[sc.boost.city]?.name}で${GOODS[sc.boost.good].name}が約${sc.boost.mult}倍` : ''}`,
    you: t ? t.replace(/^。/, '') : '今の旅で区域に入る商人はいない。出る前に、出発の画面で通る日を確かめる',
  };
}

// 定期便の便ごとに、この強盗団の間は区域を通る便を手前で待たせるか（予告の窓で選ぶ）
export function setOrderGangWait(world, mid, gangId, on) {
  const m = world.player.merchants.find((x) => x.id === mid);
  if (!m?.order) return { ok: false, error: '定期便がない' };
  const set = new Set(m.order.gangWait || []);
  if (on) set.add(gangId); else set.delete(gangId);
  m.order.gangWait = [...set];
  return { ok: true };
}
// 始まる5日前の知らせ: 区域に入りそうな商人がいれば（今の旅と、定期便の次の旅）。速く進めていても止める（画面だけのテスト5回目の Opus: ▶▶▶で始まる前を飛ばした）
function soonText(world, x) {
  const out = [];
  for (const m of world.player.merchants) {
    if (m.travel) { const h = travelGangCrossings(world, m).find((y) => y.gang.id === x.id && y.caught); if (h) out.push(`${m.name}（今の旅で${h.from}日目に区域に入る）`); continue; }
    const o = m.order;
    if (!o || o.paused || o.gangWait?.includes(x.id)) continue;
    const to = o.stops[o.next]?.city;
    const r = to && to !== m.city ? findPath(world, m.city, to, m.transport) : null;
    const h = r && gangCrossings(world, m, r.tiles, r.steps).find((y) => y.gang.id === x.id && y.caught);
    if (h) out.push(`${m.name}（定期便の次の旅で${h.from}日目に区域に入る）`);
  }
  return out;
}

// 予告・始まり・終わりの知らせ（毎日）
export function updateGangs(world) {
  const sc = world.scenario.gangs;
  if (!sc) return;
  if (!world.gangs) planGangs(world);
  for (const x of world.gangs || []) {
    const z = gangZone(world, x);
    if (world.day === x.announce) emit(world, { type: 'gang', big: true, zone: x.zone, gang: x.id, text: `${announceText(world, x, z, sc)}${travelersText(world, x)}`, card: gangCard(world, x, z, sc) });
    if (world.day === x.start - 5 && x.start - 5 > x.announce) { const who = soonText(world, x); if (who.length) emit(world, { type: 'gangSoon', big: true, bad: true, zone: x.zone, gang: x.id, text: `5日後（${x.start}日目）から${z.name}に強盗団が居座る。このままだと捕まる: ${who.join('、')}。定期便は、この知らせの窓で「区域を通る便は手前で待つ」を選べる` }); }
    if (world.day === x.start) emit(world, { type: 'gangStart', zone: x.zone, text: `${z.name}に強盗団が現れた（${x.end - 1}日目まで）` });
    if (world.day === x.end) emit(world, { type: 'gangEnd', zone: x.zone, text: `${z.name}の強盗団が去った` });
  }
}

// 町の「これから」に出す行（区域のそばの町）
export function gangNotes(world, city) {
  const b = world.scenario.gangs?.boost;
  const boost = b && b.city === city.id ? (world.gangs || []).filter((x) => boostZone(b, x) && world.day >= x.announce && world.day < x.end + b.after).map((x) => ({ kind: gangBoostOn(world, x) ? 'up' : 'shift', text: `🧵${GOODS[b.good].name}が品薄 ${gangBoostOn(world, x) ? `今（${x.end + b.after - 1}日目まで）` : `${x.start}〜${x.end + b.after - 1}日目`}、約${b.mult}倍で売れる（強盗団で道がふさがるため）` })) : [];
  return [...boost, ...knownGangs(world).filter((x) => {
    const z = gangZone(world, x);
    return Math.hypot(z.x - city.x, z.y - city.y) <= z.r + 220;
  }).map((x) => ({ kind: 'shift', text: `🗡強盗団 ${gangZone(world, x).name} ${gangStateText(world, x)}。護衛では防げない${world.scenario.gangs.holdDays ? `（捕まると${world.scenario.gangs.holdDays}日足止め）` : ''}` }))];
}
