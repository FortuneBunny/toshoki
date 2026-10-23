// 予告された売り場の交代（s3）が、読む手と固定の手を分けるかを測る（19回目の相談）
// node tools/sim-shifts.js [--seeds 1-10] [--bots fixed1,split21,...] [--scen s3]
// どのボットも同じ初期の物流（製糖所・白糖16個待ち・最大3人・精製の秘法）を使い、予定の列も同じ（行動と別の乱数）。
// 読む手（read）が使うのは、画面に出る予告（knownShifts）だけ
import * as G from '../src/core/index.js';
import { pioneerStart } from './sim-bots.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const range = (s) => { const [a, b] = s.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); };
const SEEDS = range(opt('seeds', '1-10'));
const SCEN = opt('scen', 's3');
const NO_SHIFTS = args.includes('--no-shifts');

const stop = (city, sell = [], load = [], min = 0) => ({ city, buy: [], sell: sell.map((good) => ({ good, min })), load });
const post = (w) => Object.values(w.cities).find((c) => c.founded).id;
// 製糖所の白糖を16個待って積み、売り先を回る
function route(w, dests, min = 0) {
  return [{ ...stop(post(w), [], ['whitesugar', 'molasses*4']), waitFor: { good: 'whitesugar', qty: 16 } }, ...dests.map((d) => stop(d, ['whitesugar', 'molasses'], [], min))];
}

// 商人ごとの売り先（1人目、2人目、3人目）
const PLANS = {
  fixed1: [['suitou'], ['suitou'], ['suitou']],
  split21: [['suitou'], ['toumitsu'], ['suitou']],
  split12: [['toumitsu'], ['suitou'], ['toumitsu']],
  // 隊商市の町をいつも通る（立っていれば売れる。ふだんは素通り）
  via: [['natsume', 'suitou'], ['hachi', 'toumitsu'], ['suitou']],
  // 2つの売り先を1便で回る
  loop: [['toumitsu', 'suitou'], ['suitou', 'toumitsu'], ['toumitsu', 'suitou']],
  // 隊商市の町を北と南に分けて通る
  via2: [['hachi', 'toumitsu'], ['natsume', 'suitou'], ['hachi', 'toumitsu']],
  // 最低売値で、安い時期は売らずに持ち越す
  minprice: [['suitou'], ['toumitsu'], ['suitou']],
  react: [['suitou'], ['toumitsu'], ['suitou']],
  read: [['suitou'], ['toumitsu'], ['suitou']],
};

// 読む手: 予告を見て、低迷する町へ売る便を、その期間だけ隊商市へ回す。1つの予告につき2人まで（あとから雇った商人も、予告のあいだなら組む）
function reader(w, seen, lead) {
  for (const x of G.knownShifts(w)) {
    if (!lead && w.day < x.start) continue; // 予告を使わない手: 始まってから気づく
    const ms = w.player.merchants.filter((m) => m.order);
    const done = ms.filter((m) => seen.has(`${x.id}:${m.id}`));
    if (done.length >= 2) continue;
    const order = [...ms.filter((m) => m.order.stops.some((s) => s.city === x.low)), ...ms.filter((m) => !m.order.stops.some((s) => s.city === x.low))];
    for (const m of order.filter((y) => !done.includes(y)).slice(0, 2 - done.length)) {
      seen.add(`${x.id}:${m.id}`);
      const stops = route(w, [x.fair]);
      const { from, until } = G.altWindowFor(w, m, x, stops);
      const r = G.setOrderAlt(w, m.id, { stops, from, until });
      if (args.includes('--detail')) console.log(w.day, 'alt', m.id, x.fair, from, until, r.ok || r.error);
    }
  }
}

function play(seed, bot) {
  const w = G.createWorld(SCEN, { seed });
  if (NO_SHIFTS) w.shifts = [];
  pioneerStart(w, 0);
  G.drainEvents(w);
  const p = post(w);
  G.expandMarket(w, p);
  G.build(w, p, 'mill');
  const plan = PLANS[bot];
  const min = bot === 'minprice' ? 34 : 0;
  G.setOrder(w, 1, { stops: route(w, plan[0], min), reserve: 30 });
  const seen = new Set();
  let changes = 0;
  while (!w.finished && w.day <= w.scenario.deadline) {
    if (w.player.silver > G.hireCost(w) + 220 && w.player.merchants.length < 3) {
      const r = G.hireMerchant(w, p);
      if (r.ok) { const m = w.player.merchants.at(-1); G.setOrder(w, m.id, { stops: route(w, plan[w.player.merchants.length - 1], min), reserve: 30, keepAlt: true }); }
    }
    if (w.player.silver > 950 && !['player', 'licensed'].includes(w.techs?.refinery)) G.buyTech(w, 'refinery');
    if (bot === 'read' || bot === 'react') {
      const before = seen.size;
      reader(w, seen, bot === 'read');
      changes += seen.size - before;
    }
    for (const e of G.drainEvents(w)) if (args.includes('--trace') && /orderAlt|orderNote|shift/.test(e.type)) console.log(w.day, e.text.slice(0, 120));
    if (args.includes('--trace') && w.day % 4 === 0) console.log(w.day, w.player.merchants.map((m) => `${m.id}:${m.travel ? '→' + m.travel.to : m.city}${m.order?.altOn ? '*' : ''}${m.order?.holding ? 'h' : ''} ws${m.cargo.whitesugar || 0}`).join(' '));
    G.advance(w, 1, { stopOn: new Set() });
  }
  const f = w.finished || {};
  const shifts = (w.shifts || []).filter((x) => x.start < (f.day ?? w.day));
  if (args.includes('--detail')) console.log(seed, bot, f.day, shifts.map((x) => `${x.low}/${x.fair} ${x.start}-${x.end}: ${x.sold}個 ${Math.round(x.value)}銀（低迷側なら${Math.round(x.lowValue)}）`).join(' | '), 'merchants', w.player.merchants.map((m) => m.hired ?? '').join(','));
  return { seed, bot, day: f.day ?? null, rank: f.rank ?? 'C', worth: Math.round(G.netWorth(w)), sold: Math.round(w.stats.soldValue?.whitesugar || 0), fair: shifts.reduce((s, x) => s + x.sold, 0), changes };
}

const bots = opt('bots', 'fixed1,split21,via,minprice,react,read').split(',');
const rows = [];
for (const bot of bots) {
  const rs = SEEDS.map((s) => play(s, bot));
  rows.push(...rs);
  const days = rs.map((r) => r.day ?? 999);
  const S = rs.filter((r) => r.rank === 'S').length;
  console.log(`${bot.padEnd(9)} S ${S}/${rs.length}  日数 ${Math.min(...days)}〜${Math.max(...days)}（中央 ${days.sort((a, b) => a - b)[Math.floor(days.length / 2)]}）  ${rs.map((r) => `${r.seed}:${r.day ?? '-'}${r.rank}`).join(' ')}`);
}
if (args.includes('--json')) console.log(JSON.stringify(rows));
