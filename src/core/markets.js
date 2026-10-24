// 港の市の予告（29回目の相談。s6 で試作）: ふだんの港は、ある品を少しずつしか買い取らない（倉の空きが1日に少しずつ戻る）。
// 予告された市の数日間だけ、大口の商人が来て、上限なしで高く買う。目標の数え方は変えない（1袋は1袋。29回目の Opus）
// 固定の便は、ふだんの空きの分しか売れない。読む人は、市に合わせて積荷を持って着く
// 市で上限なしに売れるのは、よそから運んできた積荷だけ。その港の倉庫から積み直した分は、ふだんの空きに数える（倉庫に貯めて、たまたま市に当たった便で全部売る手を塞ぐ）
// 予定は世界を作るときに、プレイヤーの行動と別の乱数で決める。予告したあとは変えない
import { GOODS } from '../data/goods.js';
import { hashSeed } from './rng.js';
import { emit } from './events.js';

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
  }
  world.portRoom = Math.max(0, (world.portRoom ?? world.scenario.portMarket.max) - rest);
}

// 市の値の倍率
export const marketPrice = (world, m, city, good) => (limited(world, city, good) && marketShip(world, m, city, good) ? world.scenario.portMarket.price || 1 : 1);

// 市で上限なしに売れる船の言い方
function shipText(world) {
  const from = world.scenario.portMarket.from;
  return from ? `${world.cities[from]?.name || from}から直に来て、市の間に着いた船の` : 'よそから運んできた';
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
    if (world.day === x.announce) emit(world, { type: 'portMarket', big: true, city: x.city, market: x.id, text: `【予告】${x.start - world.day}日後（${x.start}〜${x.end - 1}日目の${sc.days}日間）、${c}に${g}の大口の商人が来る。ふだんの${c}は${g}を少しずつしか買わない（倉の空きは1日に約${sc.rate}個戻る）が、市の間は、${who}${g}を上限なしで約${Math.round(sc.price * 10) / 10}倍の値で買う。市に合わせて、${g}を積んだ船を着かせよ` });
    if (world.day === x.start) emit(world, { type: 'portMarketStart', city: x.city, text: `${c}に${g}の大口の商人が来た（${x.end - 1}日目まで）。${who}${g}は上限なしで売れる` });
    if (world.day === x.end) emit(world, { type: 'portMarketEnd', city: x.city, text: `${c}の${g}の市が終わった` });
  }
}

// 町の「これから」に出す行
export function marketNotes(world, city) {
  const sc = world.scenario.portMarket;
  if (!sc || sc.city !== city.id) return [];
  const g = GOODS[sc.good].name;
  const out = knownMarkets(world).map((x) => ({ kind: marketActive(world, x) ? 'up' : 'shift', text: `⚓${g}の市 ${marketStateText(world, x)}。${shipText(world)}${g}は上限なしで約${Math.round(sc.price * 10) / 10}倍` }));
  out.push({ kind: 'shift', text: `${g}の買い取りの空き ${portRoomLeft(world)}/${sc.max}個（1日に約${sc.rate}個戻る。市の間は上限なし）` });
  return out;
}
