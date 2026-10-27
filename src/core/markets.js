// 港の市の予告（29回目の相談。s6 で試作）: ふだんの港は、ある品を少しずつしか買い取らない（倉の空きが1日に少しずつ戻る）。
// 予告された市の数日間だけ、大口の商人が来て、上限なしで高く買う。目標の数え方は変えない（1袋は1袋。29回目の Opus）
// 固定の便は、ふだんの空きの分しか売れない。読む人は、市に合わせて積荷を持って着く
// 市で上限なしに売れるのは、よそから運んできた積荷だけ。その港の倉庫から積み直した分は、ふだんの空きに数える（倉庫に貯めて、たまたま市に当たった便で全部売る手を塞ぐ）
// 予定は世界を作るときに、プレイヤーの行動と別の乱数で決める。予告したあとは変えない
import { GOODS } from '../data/goods.js';
import { hashSeed } from './rng.js';
import { emit } from './events.js';
import { BALANCE as B } from '../data/balance.js';
import { findPath, seasonOf, SEASON_NAMES } from './caravan.js';
import { cityWants } from './market.js';
import { dailyDemand } from './city.js';

// シナリオの定義: portMarket: { city, good, first, gap（なければ1回だけ）, lead, days, rate: 空きの戻り（個/日）, max: 空きの上限, price: 市の値の倍率,
//   from: あれば、市で上限なしに売れるのは、その港から直に来て、市の期間に着いた船だけ（30回目の相談。積んだまま泊めておく手を塞ぐ） }
export function planMarkets(world) {
  const sc = world.scenario.portMarket;
  if (!sc) return;
  let s = hashSeed(`market:${world.scenarioId}:${world.seed}`);
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
    list.push({ id: list.length + 1, city: sc.city, good: sc.good, announce: Math.max(1, start - sc.lead), start, end: start + sc.days });
    if (!sc.gap) break;
    start += sc.days + between(sc.gap);
  }
  world.markets = list;
}

export function knownMarkets(world) {
  return (world.markets || []).filter((x) => world.day >= x.announce && world.day < x.end);
}
export const marketActive = (world, x) => world.day >= x.start && world.day < x.end;
export const marketOn = (world, cityId, good) => (world.markets || []).some((x) => x.city === cityId && x.good === good && marketActive(world, x));
export const marketStateText = (world, x) => (marketActive(world, x) ? `今（あと${x.end - world.day}日、${x.end - 1}日目まで）` : `${x.start - world.day}日後から（${x.start}〜${x.end - 1}日目）`);

const limited = (world, city, good) => {
  const sc = world.scenario.portMarket;
  return sc && sc.city === city.id && sc.good === good;
};
// ふだんの空き（最初は上限まで空いている）
export const portRoomLeft = (world) => Math.floor(world.portRoom ?? world.scenario.portMarket?.max ?? 0);

// この商人の積荷が市の扱いになるか（from があれば、その港から直に来て、市の期間に着いた船だけ）
function marketShip(world, m, city, good) {
  if (!marketOn(world, city.id, good)) return false;
  const from = world.scenario.portMarket.from;
  if (!from) return true;
  const x = world.markets.find((y) => y.city === city.id && y.good === good && marketActive(world, y));
  return m.lastFrom === from && m.city === city.id && (m.arriveDay ?? -1) >= x.start;
}

// 今この商人が、この港でその品を売れる数
export function portRoom(world, m, city, good) {
  if (!limited(world, city, good)) return Infinity;
  const normal = portRoomLeft(world);
  if (!marketShip(world, m, city, good)) return normal;
  const here = m.whLoaded?.city === city.id ? m.whLoaded[good] || 0 : 0;
  return Math.max(0, (m.cargo[good] || 0) - here) + normal;
}

// 売る直前（積荷を減らす前）: 市の分を先に使い、残りでふだんの空きを減らす
export function notePortSale(world, m, city, good, n) {
  if (!limited(world, city, good)) return;
  let rest = n;
  if (marketShip(world, m, city, good)) {
    const here = m.whLoaded?.city === city.id ? m.whLoaded[good] || 0 : 0;
    const free = Math.max(0, (m.cargo[good] || 0) - here);
    rest = Math.max(0, n - free);
    if (m.whLoaded?.city === city.id && m.whLoaded[good]) m.whLoaded[good] = Math.max(0, here - rest);
    const x = world.markets.find((y) => y.city === city.id && y.good === good && marketActive(world, y));
    if (x) x.sold = (x.sold || 0) + Math.min(n, free);
  }
  world.portRoom = Math.max(0, (world.portRoom ?? world.scenario.portMarket.max) - rest);
}

// 市の値の倍率
export const marketPrice = (world, m, city, good) => (limited(world, city, good) && marketShip(world, m, city, good) ? world.scenario.portMarket.price || 1 : 1);

// 市で上限なしに売れる船の言い方
export function shipText(world) {
  const from = world.scenario.portMarket.from;
  return from ? `${world.cities[from]?.name || from}から直に来て、市の間に着いた船の` : 'よそから運んできた';
}

// 季節ごとの航海の日数（31回目の Opus: route は今いる町と今の風の日数しか出ず、胡椒港に着くまで逆算できなかった）
function sailText(world) {
  const sc = world.scenario.portMarket;
  if (!sc.from) return '';
  const d0 = world.day;
  const days = [0, 1].map((k) => {
    world.day = Math.floor(d0 / 360) * 360 + k * 180 + 1;
    try { return findPath(world, sc.from, sc.city, 'dhow')?.days; } finally { world.day = d0; }
  });
  if (days.some((v) => v == null)) return '';
  const next = (Math.floor(d0 / 180) + 1) * 180;
  const nm = (id) => world.cities[id]?.name || id;
  return `ダウ船で${nm(sc.from)}から${nm(sc.city)}まで、${SEASON_NAMES[0]}なら約${days[0]}日、${SEASON_NAMES[1]}なら約${days[1]}日（今は${SEASON_NAMES[seasonOf(world)].replace(/（.*/, '')}、${next}日目から${SEASON_NAMES[1 - seasonOf(world)].replace(/（.*/, '')}）`;
}
// 仕入れ先の量（32回目の相談: 差は1回の市に売れる量で決まるのに、量が予告から読めなかった）
function supplyText(world) {
  const sc = world.scenario.portMarket;
  const c = sc.from && world.cities[sc.from];
  const rate = c?.produces?.[sc.good];
  if (!rate) return '';
  const spare = rate - dailyDemand(c, sc.good, false);
  const cap = Math.max(20, dailyDemand(c, sc.good, false) * B.stockCapDays, rate * 15);
  return `${c.name}の${GOODS[sc.good].name}は、1日に約${Math.round(spare * 10) / 10}袋の余りがたまり、約${Math.round(cap)}袋で頭打ちになる（1隻が1回に積めるのはそこまで。2隻目は在庫が戻るのを待つ。早くから買い集めて、${c.name}の商館の倉庫に貯めておくと多く運べる。倉庫から積んだ分も「直に来た船」に数える）。`;
}
// まだ買い取らない町への一言（31回目の Opus: 町のうちに予告が出て、売れないのに気づかなかった）
const notYetText = (world, sc) => (cityWants(world.cities[sc.city], sc.good) ? '' : `今の${world.cities[sc.city].name}は、まだ${GOODS[sc.good].name}を買い取らない（都市に育ててから）。`);

// 予告の要点のカード（33回目の相談）。参加できる条件と、今足りない準備は隠さない（33回目の Sol）
function marketCard(world, x, sc) {
  const nm = (id) => world.cities[id]?.name || id;
  const g = GOODS[sc.good].name;
  const days = sc.from ? findPath(world, sc.from, sc.city, 'dhow')?.days : null;
  const ready = cityWants(world.cities[sc.city], sc.good);
  return {
    when: `${x.start}〜${x.end - 1}日目（${x.start - world.day}日後から${sc.days}日間）`,
    where: nm(sc.city),
    what: `${sc.from ? `${nm(sc.from)}から直に来た船の` : 'よそから運んだ'}${g}を、上限なしで約${Math.round(sc.price * 10) / 10}倍で買う`,
    you: `${ready ? '' : `⚠ 今の${nm(sc.city)}は、まだ${g}を買い取らない（都市に育ててから）。`}${days != null ? `今の風ならダウ船で${nm(sc.from)}から約${days}日 → ${x.start - days}日目ごろに出る（出航の目安の日に知らせる）` : ''}`,
  };
}

// 予告・始まり・終わりの知らせと、空きの戻り（毎日）
export function updateMarkets(world) {
  const sc = world.scenario.portMarket;
  if (!sc) return;
  if (!world.markets) planMarkets(world);
  world.portRoom = Math.min(sc.max, (world.portRoom ?? sc.max) + sc.rate);
  const who = shipText(world);
  for (const x of world.markets || []) {
    const c = world.cities[x.city]?.name || x.city;
    const g = GOODS[x.good].name;
    if (world.day === x.announce) emit(world, { type: 'portMarket', big: true, city: x.city, market: x.id, text: `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${sc.days}日間）、${c}に${g}の大口の商人が来る。ふだんの${c}は${g}を少しずつしか買わない（倉の空きは1日に約${sc.rate}個戻る）が、市の間は、${who}${g}を上限なしで約${Math.round(sc.price * 10) / 10}倍の値で買う（ただし、たくさん売るほど値は下がる。2隻目は1隻目よりずっと安い）。市に合わせて、${g}を積んだ船を着かせよ。${notYetText(world, sc)}${supplyText(world)}${sailText(world)}`, card: marketCard(world, x, sc) });
    sailNote(world, x, sc);
    if (world.day === x.start) emit(world, { type: 'portMarketStart', city: x.city, text: `${c}に${g}の大口の商人が来た（${x.end - 1}日目まで）。${who}${g}は上限なしで売れる` });
    if (world.day === x.end) emit(world, { type: 'portMarketEnd', city: x.city, text: `${c}の${g}の市が終わった（あなたが上限なしで売ったのは${Math.floor(x.sold || 0)}個）` });
  }
}

// 出航の目安の日: 今日仕入れ先を出ると、ダウ船で市の間に着く最初の日に知らせる（画面だけのテスト4回目の Sol: 市の始まりで止まっても、出航には遅い）
function sailNote(world, x, sc) {
  if (!sc.from || x.sailNoted || world.day <= x.announce || world.day >= x.end) return;
  const days = findPath(world, sc.from, sc.city, 'dhow')?.days;
  if (days == null) return;
  const at = world.day + days;
  if (at < x.start) return;
  x.sailNoted = true;
  if (at >= x.end) return;
  const nm = (id) => world.cities[id]?.name || id;
  emit(world, { type: 'portMarketSail', big: true, city: sc.from, market: x.id, text: `⚓ 出航の目安: 今日${nm(sc.from)}を出たダウ船は、${at}日目ごろ${nm(sc.city)}に着く（市は${x.start}〜${x.end - 1}日目）。${GOODS[sc.good].name}を積んだ船は、${x.end - 1 - at > 0 ? `あと${x.end - 1 - at}日のうちに出せば間に合う` : '今日出さないと間に合わない'}` });
}

// 町の「これから」に出す行
export function marketNotes(world, city) {
  const sc = world.scenario.portMarket;
  if (sc?.from === city.id && knownMarkets(world).length) return [{ kind: 'shift', text: `⚓${world.cities[sc.city].name}の${GOODS[sc.good].name}の市 ${knownMarkets(world).map((x) => marketStateText(world, x)).join('、')}。${supplyText(world)}${sailText(world)}` }];
  if (!sc || sc.city !== city.id) return [];
  const g = GOODS[sc.good].name;
  const out = knownMarkets(world).map((x) => ({ kind: marketActive(world, x) ? 'up' : 'shift', text: `⚓${g}の市 ${marketStateText(world, x)}。${shipText(world)}${g}は上限なしで約${Math.round(sc.price * 10) / 10}倍` }));
  if (out.length && sc.from) out.push({ kind: 'shift', text: `${notYetText(world, sc)}${supplyText(world)}${sailText(world)}` });
  out.push({ kind: 'shift', text: `${g}の買い取りの空き ${portRoomLeft(world)}/${sc.max}個（1日に約${sc.rate}個戻る。市の間は上限なし）` });
  return out;
}
