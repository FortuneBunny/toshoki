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
// 値を試すとき: --set '{"low":{"demand":0.2,"price":0.5}}'（シナリオの shifts に重ねる）
if (opt('set')) Object.assign(G.SCENARIOS[SCEN].shifts, JSON.parse(opt('set')));
const WAIT = Number(opt('wait', 16));
const PICK = Number(opt('pick', 0)); // 雇う候補の番号（21回目の Sol は2番目の候補を雇った） // 白糖を何個そろえて出発するか（20回目の Sol: 固定の手は12個待ちで強くなった）

const L = ['toumitsu', 'suitou', 'toumitsu'];
const F = [{ city: 'toumitsu', min: 60 }, { city: 'suitou', min: 27 }, { city: 'toumitsu', min: 27 }];
const stop = (city, sell = [], load = [], min = 0) => ({ city, buy: [], sell: sell.map((good) => ({ good, min: good === 'whitesugar' ? min : 0 })), load });
const post = (w) => Object.values(w.cities).find((c) => c.founded).id;
// 製糖所の白糖を16個待って積み、売り先を回る
function route(w, dests, min = 0) {
  return [{ ...stop(post(w), [], ['whitesugar', 'molasses*4']), waitFor: { good: 'whitesugar', qty: WAIT } }, ...dests.map((d) => (typeof d === 'string' ? stop(d, ['whitesugar', 'molasses'], [], min) : stop(d.city, ['whitesugar', 'molasses'], [], d.min)))];
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
  // 20回目の Opus の固定の手: 糖蜜町へ小道を1本敷き、2つの売り先を1便で回って最低売値35で売る（安い町では持ち越す）
  loop35: [L, L, L],
  // 1人目だけ、蜜蜂の丘も毎回通る（隊商市が立っていれば売れる）
  hill35: [['toumitsu', 'hachi', 'toumitsu', 'suitou', 'toumitsu'], L, L],
  // 同じ土台に、予告を読む手と、始まってから回す手
  readL: [L, L, L],
  reactL: [L, L, L],
  // 21回目の Opus の固定の手 F*: 行きの糖蜜町は最低60で素通り、翠糖京と帰りの糖蜜町は最低27、12個待ち、甘党を雇う、精製の秘法は銀1350で
  fstar: [F, F, F],
  readF: [F, F, F],
  reactF: [F, F, F],
};
const STRONG = new Set(['loop35', 'hill35', 'readL', 'reactL', 'fstar', 'readF', 'reactF']);
const FSTAR = new Set(['fstar', 'readF', 'reactF']);

// 読む手: 予告を見て、低迷する町へ売る便を、その期間だけ隊商市へ回す。1つの予告につき2人まで（あとから雇った商人も、予告のあいだなら組む）
function reader(w, seen, lead) {
  for (const x of G.knownShifts(w)) {
    if (!lead && w.day < x.start) continue; // 予告を使わない手: 始まってから気づく
    const ms = w.player.merchants.filter((m) => m.order);
    const done = ms.filter((m) => seen.has(`${x.id}:${m.id}`));
    if (done.length >= 2) continue;
    const low = (m) => G.baseStops(m.order).some((s) => s.city === x.low);
    const order = [...ms.filter(low), ...ms.filter((m) => !low(m))];
    for (const m of order.filter((y) => !done.includes(y)).slice(0, 2 - done.length)) {
      seen.add(`${x.id}:${m.id}`);
      // 人に出す下書き（予告の画面の「臨時の便にする」と、CLI の order alt --shift）と同じ便
      const stops = G.altDraftFor(w, m, x) || route(w, [x.fair]);
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
  const min = bot === 'minprice' ? 34 : STRONG.has(bot) ? 35 : 0;
  let trail = STRONG.has(bot);
  G.setOrder(w, 1, { stops: route(w, plan[0], min), reserve: 30 });
  const seen = new Set();
  let changes = 0;
  while (!w.finished && w.day <= w.scenario.deadline) {
    if (trail) { const pl = G.planPath(w, p, 'toumitsu', 'trail'); if (!pl) trail = false; else if (w.player.silver > pl.cost + 300) { G.buildPath(w, p, 'toumitsu', 'trail'); trail = false; } }
    if (w.player.silver > G.hireCost(w) + 220 && w.player.merchants.length < 3) {
      const sweet = FSTAR.has(bot) ? G.hireCandidates(w).findIndex((c) => c.talent === 'sweettooth') : -1;
      const r = G.hireMerchant(w, p, sweet >= 0 ? sweet : PICK);
      if (r.ok) { const m = w.player.merchants.at(-1); G.setOrder(w, m.id, { stops: route(w, plan[w.player.merchants.length - 1], min), reserve: 30, keepAlt: true }); }
    }
    if (w.player.silver > (FSTAR.has(bot) ? 1350 : 950) && !['player', 'licensed'].includes(w.techs?.refinery)) G.buyTech(w, 'refinery');
    if (['read', 'react', 'readL', 'reactL', 'readF', 'reactF'].includes(bot)) {
      const before = seen.size;
      reader(w, seen, ['read', 'readL', 'readF'].includes(bot));
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
  const le = (t) => rs.filter((r) => r.day !== null && r.day <= t).length;
  if (args.includes('--lines')) console.log(`${bot.padEnd(9)} ≤120 ${le(120)} ≤126 ${le(126)} ≤130 ${le(130)} ≤135 ${le(135)} /${rs.length}`);
  console.log(`${bot.padEnd(9)} S ${S}/${rs.length}  日数 ${Math.min(...days)}〜${Math.max(...days)}（中央 ${days.sort((a, b) => a - b)[Math.floor(days.length / 2)]}）  ${rs.map((r) => `${r.seed}:${r.day ?? '-'}${r.rank}`).join(' ')}`);
}
if (args.includes('--json')) console.log(JSON.stringify(rows));
