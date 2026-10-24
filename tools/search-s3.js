// s3 の評価器と探索ボット（22回目の相談の作業1）: 予告を読まない固定の手を自動で探し、同じ物流の土台で
// 「固定・始まってから回す・予告を読む（回す人数0〜3）・予定の列なし」を比べる。
// node tools/search-s3.js search  [--random 400] [--climb 12] [--keep 12] [--out file.json]   探す（探索用→選抜用のシード）
// node tools/search-s3.js eval    --genome file.json|'{"..."}' [--seeds 3001-3200] [--modes fixed,react,read1,read2,read3,none]
// node tools/search-s3.js fstar   21回目の F*（14個待ち）を、この道具の型で回す（検定: S 2割前後になるか）
// 共通: --set '{"fair":{"price":1.2}}'（シナリオの shifts に重ねる）  --line 130（S の線。既定はシナリオの rankS から）
// 物流の土台（遺伝子）: 交易所の場所・待つ数・最低売値つきの売り先の並び（商人ごと）・雇う人数と才能・技術を買う額・道・荷車。
// どの手も、画面に出ない情報（予定の列・需要の波）は読まない。読む手が使うのは knownShifts だけ
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename } from 'node:path';
import * as G from '../src/core/index.js';

const SCEN = 's3';
const FAIRS = G.SCENARIOS.s3.shifts.fairs;
const CITIES = ['toumitsu', 'suitou', ...FAIRS];
const MINS = [0, 20, 27, 35, 45, 60, 80];
const PATHS = [['post', 'toumitsu'], ['post', 'suitou'], ['post', 'hachi'], ['post', 'natsume'], ['toumitsu', 'hachi'], ['suitou', 'natsume'], ['toumitsu', 'natsume'], ['post', 'izumi'], ['suitou', 'izumi'], ['toumitsu', 'izumi']].filter((x) => x.every((c) => c === 'post' || G.SCENARIOS.s3.cities.some((y) => y.id === c)));
const TALENT = ['any', 'sweettooth', 'appraiser', 'swift'];

// ---- 1回の遊び ----
const postOf = (w) => Object.values(w.cities).find((c) => c.founded)?.id;
const stopOf = (city, min, load = []) => ({ city, buy: [], sell: [{ good: 'whitesugar', min }, { good: 'molasses', min: 0 }], load });

function routeFor(w, g, r, transport) {
  const home = { city: postOf(w), buy: [], sell: [], load: ['whitesugar', ...(g.molasses ? [`molasses*${g.molasses}`] : [])], waitFor: { good: 'whitesugar', qty: transport === 'cart' ? g.cartWait : g.wait } };
  return [home, ...r.map((s) => stopOf(s.city, s.min))];
}
const reachable = (w, stops, t) => stops.every((s, i) => G.findPath(w, s.city, stops[(i + 1) % stops.length].city, t));

// mode: { kind: 'fixed' | 'react' | 'read' | 'none', k: 1つの予告に回す人数 }
export function play(g, seed, mode, opts = {}) {
  const w = G.createWorld(SCEN, { seed });
  // 予定の型（どの手でも同じ分け方。終わった日で層が変わらないように、生成した予定の列の最初から取る。23回目の Sol）
  const plan = { fairs: (w.shifts || []).slice(0, 3).map((x) => x.fair[0]).join(''), lows: (w.shifts || []).slice(0, 2).map((x) => x.low[0].toUpperCase()).join(''), first: w.shifts?.[0]?.start ?? null };
  if (mode.kind === 'none') w.shifts = [];
  if (G.setupStage(w) === 'family') G.chooseFamily(w, G.familyList(w)[0].id);
  const s = G.foundSites(w, 3)[g.site] || G.foundSites(w, 1)[0];
  if (!s) return { seed, day: null, rank: 'C', err: 'site', plan };
  G.foundPost(w, s.x, s.y);
  G.drainEvents(w);
  const p = postOf(w);
  G.expandMarket(w, p);
  if (!G.build(w, p, 'mill').ok) return { seed, day: null, rank: 'C', err: 'mill', plan };
  const set = (m, keepAlt) => G.setOrder(w, m.id, { stops: routeFor(w, g, g.routes[(w.player.merchants.indexOf(m)) % g.routes.length], m.transport), reserve: 30, keepAlt });
  if (!set(w.player.merchants[0]).ok) return { seed, day: null, rank: 'C', err: 'order', plan };
  const paths = g.paths.map(([a, b, kind]) => [a === 'post' ? p : a, b, kind]);
  const seen = new Set();
  let sent = 0;
  // cutoff: 探索では、S の線から遠く遅れた遊びをそこで打ち切る（期限の420日まで遊ぶと重い。打ち切った遊びは「届かず」と数える）
  const stopAt = Math.min(w.scenario.deadline, opts.cutoff ?? Infinity);
  while (!w.finished && w.day <= stopAt) {
    const pl = w.player;
    // 道: 並べた順に、銀が見積もり＋余裕を超えたら敷く
    if (paths.length) {
      const [a, b, kind] = paths[0];
      const plan = G.planPath(w, a, b, kind);
      if (!plan || !plan.newTiles) paths.shift();
      else if (pl.silver > plan.cost + g.pathMargin) { G.buildPath(w, a, b, kind); paths.shift(); }
    }
    if (pl.silver > G.hireCost(w) + g.hireMargin && pl.merchants.length < g.maxM) {
      const t = g.talent === 'any' ? -1 : G.hireCandidates(w).findIndex((c) => c.talent === g.talent);
      if (G.hireMerchant(w, p, Math.max(0, t)).ok) set(pl.merchants.at(-1), true);
    }
    if (g.tech !== null && pl.silver > g.tech && !['player', 'licensed'].includes(w.techs?.refinery)) G.buyTech(w, 'refinery');
    // 荷車: 街道の通る大きな町で、便の町がすべて荷車で回れるなら買い替え、待つ数を荷車の数にする
    if (g.cart) for (const m of pl.merchants) {
      if (m.travel || m.transport === 'cart' || pl.silver < 420 + g.cartMargin) continue;
      if (!G.canBuyTransportAt(w, w.cities[m.city], 'cart')) continue;
      const stops = routeFor(w, g, g.routes[pl.merchants.indexOf(m) % g.routes.length], 'cart');
      if (!reachable(w, stops, 'cart')) continue;
      if (G.buyTransport(w, m.id, 'cart').ok) set(m, true);
    }
    if (mode.kind === 'read' || mode.kind === 'react') sent += reader(w, seen, mode.kind === 'read', mode.k);
    G.drainEvents(w);
    G.advance(w, 1, { stopOn: new Set() });
  }
  const f = w.finished || {};
  const day = f.day ?? null;
  const sh = (w.shifts || []).filter((x) => x.start < (day ?? w.day));
  return { seed, day, rank: f.rank ?? 'C', plan, fair: sh.reduce((a, x) => a + x.sold, 0), sent };
}

// 読む手: 予告を見て、k 人まで、その期間だけ隊商市へ回す（低迷する町へ売る便から先に）。
// 予告を使わない手（react）は、始まってから気づく
function reader(w, seen, lead, k) {
  let n = 0;
  for (const x of G.knownShifts(w)) {
    if (!lead && w.day < x.start) continue;
    const ms = w.player.merchants.filter((m) => m.order);
    const done = ms.filter((m) => seen.has(`${x.id}:${m.id}`));
    if (done.length >= k) continue;
    const low = (m) => G.baseStops(m.order).some((s) => s.city === x.low);
    for (const m of [...ms.filter(low), ...ms.filter((m) => !low(m))].filter((y) => !done.includes(y)).slice(0, k - done.length)) {
      seen.add(`${x.id}:${m.id}`);
      const stops = G.altDraftFor(w, m, x);
      if (!stops) continue;
      const win = G.altWindowFor(w, m, x, stops);
      if (win.late) continue; // 画面の「間に合わない」を読む人は組まない
      if (G.setOrderAlt(w, m.id, { stops, from: win.from, until: win.until }).ok) n++;
    }
  }
  return n;
}

// ---- 遺伝子 ----
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// 売り先の並び: 2つの大きな町を1〜3回たどる。ときどき隊商市の町を1つはさむ（固定の便が、市の町をいつも通る手）
function randRoute(r) {
  const out = [];
  const n = pick(r, [1, 2, 2, 3, 3]);
  let c = pick(r, ['toumitsu', 'suitou']);
  for (let i = 0; i < n; i++) { out.push({ city: c, min: pick(r, [0, 20, 27, 27, 35, 35, 45, 60]) }); c = c === 'toumitsu' ? 'suitou' : 'toumitsu'; }
  if (r() < 0.25) out.splice(int(r, 0, out.length), 0, { city: pick(r, FAIRS), min: pick(r, [0, 27, 35]) });
  for (let j = out.length - 1; j > 0; j--) if (out[j].city === out[j - 1].city) out.splice(j, 1);
  return out;
}
const randPath = (r) => [...pick(r, PATHS), r() < 0.8 ? 'trail' : 'road'];
export function randomGenome(r) {
  const r0 = randRoute(r);
  const paths = [];
  if (r() < 0.6) paths.push(['post', pick(r, ['toumitsu', 'toumitsu', 'suitou']), 'trail']);
  while (r() < 0.3 && paths.length < 3) { const x = randPath(r); if (!paths.some((y) => y[0] === x[0] && y[1] === x[1])) paths.push(x); }
  return {
    site: r() < 0.9 ? 0 : 1,
    wait: int(r, 6, 20), cartWait: int(r, 20, 60), molasses: pick(r, [0, 4, 4]),
    maxM: pick(r, [3, 3, 3, 2]), hireMargin: pick(r, [0, 100, 220, 220, 400]), talent: pick(r, TALENT),
    tech: r() < 0.05 ? null : pick(r, [800, 950, 1100, 1350, 1350, 1700]),
    paths, pathMargin: pick(r, [0, 150, 300, 300, 600]),
    cart: r() < 0.2, cartMargin: pick(r, [0, 200, 500]),
    routes: r() < 0.6 ? [r0] : [r0, randRoute(r), randRoute(r)],
  };
}
const clone = (g) => JSON.parse(JSON.stringify(g));
export function mutate(g0, r) {
  const g = clone(g0);
  const n = int(r, 1, 2);
  for (let i = 0; i < n; i++) {
    const k = pick(r, ['wait', 'wait', 'min', 'min', 'city', 'route', 'hire', 'talent', 'tech', 'paths', 'cart', 'molasses', 'site', 'maxM']);
    const ri = int(r, 0, g.routes.length - 1);
    const rt = g.routes[ri];
    if (k === 'wait') g.wait = Math.max(4, Math.min(20, g.wait + pick(r, [-2, -1, 1, 2])));
    else if (k === 'min') { const s = pick(r, rt); s.min = MINS[Math.max(0, Math.min(MINS.length - 1, MINS.indexOf(s.min) + pick(r, [-1, 1])))] ?? pick(r, MINS); }
    else if (k === 'city') { const s = pick(r, rt); s.city = pick(r, CITIES); }
    else if (k === 'route') { if (r() < 0.3 && g.routes.length === 1) g.routes = [rt, clone(rt), clone(rt)]; else if (r() < 0.3) g.routes = [rt]; else g.routes[ri] = r() < 0.5 && rt.length < 4 ? [...rt, { city: pick(r, CITIES), min: pick(r, MINS) }] : rt.length > 1 ? rt.slice(0, -1) : randRoute(r); }
    else if (k === 'hire') g.hireMargin = pick(r, [0, 100, 220, 400, 700]);
    else if (k === 'talent') g.talent = pick(r, TALENT);
    else if (k === 'tech') g.tech = r() < 0.1 ? null : pick(r, [600, 800, 950, 1100, 1350, 1700, 2200]);
    else if (k === 'paths') { if (r() < 0.5 && g.paths.length) g.paths.pop(); else if (g.paths.length < 3) { const x = randPath(r); if (!g.paths.some((y) => y[0] === x[0] && y[1] === x[1])) g.paths.push(x); } g.pathMargin = pick(r, [0, 150, 300, 600]); }
    else if (k === 'cart') { g.cart = !g.cart; g.cartWait = int(r, 20, 60); }
    else if (k === 'molasses') g.molasses = pick(r, [0, 2, 4]);
    else if (k === 'site') g.site = 1 - g.site;
    else if (k === 'maxM') g.maxM = pick(r, [2, 3]);
    for (const x of g.routes) for (let j = x.length - 1; j > 0; j--) if (x[j].city === x[j - 1].city) x.splice(j, 1);
  }
  return g;
}
// 21回目の Opus の固定の手 F*（14個待ち）: 糖蜜町へ小道、行きの糖蜜町は最低60、翠糖京と帰りの糖蜜町は27、甘党、精製の秘法は銀1350
export const FSTAR = {
  site: 0, wait: 14, cartWait: 40, molasses: 4, maxM: 3, hireMargin: 220, talent: 'sweettooth', tech: 1350,
  paths: [['post', 'toumitsu', 'trail']], pathMargin: 300, cart: false, cartMargin: 0,
  routes: [[{ city: 'toumitsu', min: 60 }, { city: 'suitou', min: 27 }, { city: 'toumitsu', min: 27 }]],
};
export const describe = (g) => `待${g.wait}${g.cart ? `/荷車${g.cartWait}` : ''} ${g.routes.map((r) => r.map((s) => `${s.city.slice(0, 2)}${s.min}`).join('>')).join(' | ')} 人${g.maxM}+${g.hireMargin} ${g.talent} 技${g.tech ?? '-'} 道${g.paths.map((x) => `${x[0].slice(0, 2)}-${x[1].slice(0, 2)}${x[2][0]}`).join(',') || '-'} 場${g.site}${g.molasses ? ` 蜜${g.molasses}` : ''}`;

// ---- 並列 ----
if (!isMainThread) {
  if (workerData?.set) Object.assign(G.SCENARIOS[SCEN].shifts, workerData.set);
  if (workerData?.scen) Object.assign(G.SCENARIOS[SCEN], workerData.scen);
  parentPort.on('message', ({ id, g, seed, mode, opts }) => {
    let res;
    try { res = play(g, seed, mode, opts); } catch (e) { res = { seed, day: null, rank: 'C', err: String(e.message || e) }; }
    parentPort.postMessage({ id, res });
  });
}

class Pool {
  constructor(n, data) {
    this.ws = Array.from({ length: n }, () => new Worker(new URL(import.meta.url), { workerData: data }));
    this.idle = [...this.ws]; this.q = []; this.cb = new Map(); this.seq = 0;
    for (const w of this.ws) w.on('message', ({ id, res }) => { this.cb.get(id)(res); this.cb.delete(id); this.idle.push(w); this.pump(); });
  }
  pump() { while (this.idle.length && this.q.length) { const [msg] = this.q.shift(); this.idle.pop().postMessage(msg); } }
  run(g, seed, mode, opts) { return new Promise((res) => { const id = this.seq++; this.cb.set(id, res); this.q.push([{ id, g, seed, mode, opts }]); this.pump(); }); }
  close() { for (const w of this.ws) w.terminate(); }
}

// ---- 集計 ----
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
let LINES = []; // --lines 122,126,129,132: ほかの線での数も出す（急な段がないかを見る）
function summary(rs, line) {
  const d = rs.map((r) => r.day ?? 999).sort((a, b) => a - b);
  return { n: rs.length, S: d.filter((x) => x <= line).length, S3: d.filter((x) => x <= line + 3).length, med: median(d), q25: d[Math.floor(d.length / 4)], q75: d[Math.floor((d.length * 3) / 4)], ex: LINES.map((L) => `${L}:${d.filter((x) => x <= L).length}`).join(' ') };
}
// 探索の点数: S の線の割合を主に、線＋5日と中央の日数で傾きをつける（山登りが平らにならないように）
const fitness = (rs, line) => { const s = summary(rs, line); const d = rs.map((r) => r.day ?? 999); return s.S / s.n + 0.5 * d.filter((x) => x <= line + 5).length / s.n + 0.3 * Math.max(0, Math.min(1, (line + 25 - s.med) / 25)); };
const pct = (a, n) => `${Math.round((100 * a) / n)}%`;
const fmt = (s) => `S ${s.S}/${s.n}（${pct(s.S, s.n)}） 線+3 ${s.S3}/${s.n}（${pct(s.S3, s.n)}） 中央 ${s.med}（${s.q25}〜${s.q75}）${s.ex ? `  線別 ${s.ex}` : ''}`;

// ---- 本体 ----
if (isMainThread && basename(process.argv[1] || '') === 'search-s3.js') {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const range = (s) => s.split(',').flatMap((part) => { const [a, b] = part.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); });
  const set = opt('set') ? JSON.parse(opt('set')) : null;
  const scen = opt('scen-set') ? JSON.parse(opt('scen-set')) : null;
  if (set) Object.assign(G.SCENARIOS[SCEN].shifts, set);
  if (scen) Object.assign(G.SCENARIOS[SCEN], scen);
  const sc = G.SCENARIOS[SCEN];
  const LINE = Number(opt('line', Math.floor(sc.deadline * sc.rankS)));
  LINES = opt('lines') ? opt('lines').split(',').map(Number) : [];
  // 既定は CPU の半分（全部使うと PC が重くなる）
  const pool = new Pool(Number(opt('workers', Math.max(2, Math.floor(cpus().length / 2)))), { set, scen });
  const evalOn = (g, seeds, mode, opts) => Promise.all(seeds.map((s) => pool.run(g, s, mode, opts)));
  const modeOf = (m) => (m === 'fixed' || m === 'none' ? { kind: m } : m.startsWith('react') ? { kind: 'react', k: Number(m.slice(5) || 2) } : { kind: 'read', k: Number(m.slice(4) || 2) });
  const cmd = args[0] || 'fstar';

  // 予定の型ごとの内訳（予定の列の最初の3つの市・最初の2つの低迷・最初の時期。どの手でも同じ分け方）
  const groupsOf = (rs) => {
    const groups = {};
    for (const r of rs) for (const k of [`市 ${r.plan?.fairs?.slice(0, 2) ?? '-'}`, `市 ${r.plan?.fairs ?? '-'}`, `並び ${r.plan?.lows ?? '-'}`, `始 ${(r.plan?.first ?? 0) <= (sc.shifts.first[0] + sc.shifts.first[1]) / 2 ? '前半' : '後半'}`]) (groups[k] ||= []).push(r);
    return groups;
  };
  const byPattern = (rs) => Object.entries(groupsOf(rs)).sort().map(([k, v]) => `  ${k.padEnd(10)} ${fmt(summary(v, LINE))}`).join('\n');
  const D = (r) => r?.day ?? 999;

  // 合格の条件（23回目の相談）。結果は、行ごとに ✔ / ✖
  const verdict = [];
  async function compare(g, seeds, modes) {
    const out = {};
    for (const m of modes) {
      const rs = await evalOn(g, seeds, modeOf(m));
      out[m] = rs;
      console.log(`${m.padEnd(7)} ${fmt(summary(rs, LINE))}${rs.some((r) => r.err) ? `  失敗 ${rs.filter((r) => r.err).length}（${rs.find((r) => r.err).err}）` : ''}`);
    }
    const ok = (c) => (c ? '✔' : '✖');
    const lines = [];
    if (out.fixed) {
      console.log(`固定の内訳\n${byPattern(out.fixed)}`);
      const s = summary(out.fixed, LINE);
      const big = Object.entries(groupsOf(out.fixed)).filter(([k, v]) => k.startsWith('市') && v.length >= 20).map(([k, v]) => [k, summary(v, LINE).S / v.length]);
      const worst = big.sort((a, b) => b[1] - a[1])[0];
      lines.push(`${ok(s.S <= s.n * 0.1)} 固定 S ${pct(s.S, s.n)}（線で1割以下）`, `${ok(s.S3 <= s.n * 0.15)} 固定 線+3 ${pct(s.S3, s.n)}（15%以下）`, `${ok(!worst || worst[1] <= 0.2)} 市の組ごとの最大 ${worst ? `${worst[0]} ${Math.round(worst[1] * 100)}%` : '-'}（20シード以上の組で20%以下）`);
    }
    // 同じシードどうしの差（読むと固定よりどれだけ速いか、始まってから回す手よりどれだけ速いか）
    const reads = modes.filter((m) => m.startsWith('read'));
    if (out.fixed && reads.length) {
      for (const m of reads) {
        const gain = seeds.map((_, i) => D(out.fixed[i]) - D(out[m][i]));
        const five = gain.filter((x) => x >= 5).length;
        const vsReact = out.react2 ? median(seeds.map((_, i) => D(out.react2[i]) - D(out[m][i]))) : null;
        console.log(`${m} − 固定: 中央 ${median(gain)}日速い（5日以上速い ${five}/${seeds.length}・遅い ${gain.filter((x) => x < 0).length}）${vsReact !== null ? `  始まってから2人より 中央 ${vsReact}日速い` : ''}`);
        if (m === 'read2') lines.push(`${ok(median(gain) >= 15 && five >= seeds.length * 0.75)} 読む2人: 固定より中央 ${median(gain)}日、5日以上速い ${pct(five, seeds.length)}（15日以上・75%以上）`, ...(vsReact !== null ? [`${ok(vsReact >= 5)} 読む2人: 始まってから2人より中央 ${vsReact}日（5日以上）`] : []));
      }
      // 人数: 0〜1人と2〜3人の、3日以上の有利
      if (['read1', 'read2', 'read3'].every((m) => out[m])) {
        let lo = 0, hi = 0;
        seeds.forEach((_, i) => { const a = Math.min(D(out.fixed[i]), D(out.read1[i])); const b = Math.min(D(out.read2[i]), D(out.read3[i])); if (a <= b - 3) lo++; else if (b <= a - 3) hi++; });
        console.log(`人数（3日差）: 0〜1人が有利 ${lo}  2〜3人が有利 ${hi}  どちらでもない ${seeds.length - lo - hi}`);
        lines.push(`${lo >= seeds.length * 0.2 && hi >= seeds.length * 0.2 ? '✔' : '・'} 人数: 0〜1人が有利 ${pct(lo, seeds.length)}・2〜3人が有利 ${pct(hi, seeds.length)}（各20%以上。記録のみ）`);
      }
    }
    if (out.none && out.fixed) console.log(`予定の列なし − 固定: 中央 ${median(seeds.map((_, i) => D(out.fixed[i]) - D(out.none[i])))}日（予定の列が固定の手にかける負担）`);
    if (lines.length) console.log(`合否（線 ${LINE}日）\n  ${lines.join('\n  ')}`);
    verdict.push({ g: describe(g), lines });
    // --save: シードごとの結果を書き出す
    if (opt('save')) saved.push({ g, line: LINE, set, seeds, out: Object.fromEntries(Object.entries(out).map(([m, rs]) => [m, rs.map((r) => ({ seed: r.seed, day: r.day, rank: r.rank, plan: r.plan, err: r.err }))])) });
    return out;
  }
  const saved = [];

  if (cmd === 'fstar') {
    const seeds = range(opt('seeds', '101-190'));
    console.log(`F*（14個待ち） 線 ${LINE}日  ${describe(FSTAR)}`);
    await compare(FSTAR, seeds, (opt('modes', 'fixed,react2,read1,read2,read3,none')).split(','));
  } else if (cmd === 'eval') {
    const src = opt('genome');
    const gs = existsSync(src) ? JSON.parse(readFileSync(src, 'utf8')) : JSON.parse(src);
    const list = Array.isArray(gs) ? gs : gs.top ? gs.top.map((x) => x.g) : [gs];
    const seeds = range(opt('seeds', '3001-3200'));
    for (const g of list.slice(0, Number(opt('top', 3)))) {
      console.log(`\n線 ${LINE}日  ${describe(g)}`);
      await compare(g, seeds, (opt('modes', 'fixed,react2,read1,read2,read3,none')).split(','));
    }
  } else if (cmd === 'search') {
    // シードは3つに分ける: 探索用（1001〜）・選抜用（2001〜）。最終確認は eval に新しいシードで
    const S1 = range(opt('search-seeds', '1001-1040'));
    const S2 = range(opt('select-seeds', '2001-2120'));
    const r = rng(Number(opt('rseed', 7)));
    const N = Number(opt('random', 400));
    const t0 = Date.now();
    const scored = [];
    const score = async (g, seeds) => fitness(await evalOn(g, seeds, { kind: 'fixed' }, { cutoff: LINE + 25 }), LINE);
    // ランダム探索（F* も1つ混ぜない。見つけ直せるかを確かめるため）
    // 予選: まず8シードで回し、上位だけ残りのシードで回す（弱い手に40シードを使うと重い）
    const pre = [];
    await Promise.all(Array.from({ length: N }, async () => { const g = randomGenome(r); pre.push({ g, f: await score(g, S1.slice(0, 8)) }); }));
    pre.sort((a, b) => b.f - a.f);
    // --from: 前の探索の上位（と F*）も混ぜて始める（値を変えた版で、強い手を探し直すとき）
    const seeded = opt('from') ? [...JSON.parse(readFileSync(opt('from'), 'utf8')).top.map((x) => x.g), FSTAR] : [];
    await Promise.all([...pre.slice(0, Math.ceil(N / 8)).map((x) => x.g), ...seeded].map(async (g) => scored.push({ g, f: await score(g, S1) })));
    scored.sort((a, b) => b.f - a.f);
    console.log(`ランダム ${N}: 最上位 ${scored.slice(0, 5).map((x) => x.f.toFixed(3)).join(' ')}（${Math.round((Date.now() - t0) / 1000)}秒）`);
    // 上位から型の違うものを残す（売り先の並びと荷車・待つ数で型を分ける）
    const kind = (g) => `${g.cart}|${g.routes.map((x) => x.map((s) => s.city).join('>')).join('|')}`;
    const parents = [];
    for (const x of scored) { if (parents.length >= Number(opt('keep', 12))) break; if (!parents.some((p) => kind(p.g) === kind(x.g))) parents.push(x); }
    // 山登り
    const climb = Number(opt('climb', 12));
    await Promise.all(parents.map(async (p) => {
      for (let i = 0; i < climb; i++) {
        const kids = Array.from({ length: 4 }, () => mutate(p.g, r));
        // 予選: 半分のシードで親より明らかに悪い子は、残りを回さない
        const half = S1.slice(0, S1.length / 2);
        const fs = await Promise.all(kids.map(async (k) => ((await score(k, half)) < p.f - 0.15 ? -1 : score(k, S1))));
        const j = fs.indexOf(Math.max(...fs));
        if (fs[j] >= p.f) { p.g = kids[j]; p.f = fs[j]; }
      }
    }));
    console.log(`山登り ${climb}回: ${parents.map((x) => x.f.toFixed(3)).join(' ')}（${Math.round((Date.now() - t0) / 1000)}秒）`);
    // 選抜用のシードで並べ直す
    for (const p of parents) { const rs = await evalOn(p.g, S2, { kind: 'fixed' }); p.sel = summary(rs, LINE); p.fs = fitness(rs, LINE); }
    parents.sort((a, b) => b.fs - a.fs);
    for (const p of parents) console.log(`${fmt(p.sel)}  ${describe(p.g)}`);
    const out = opt('out', 'playtests/raw/search-s3.json');
    writeFileSync(out, JSON.stringify({ line: LINE, set, top: parents.map((p) => ({ g: p.g, sel: p.sel })) }, null, 1));
    console.log(`書き出し: ${out}（${Math.round((Date.now() - t0) / 1000)}秒）`);
  }
  if (opt('save') && saved.length) writeFileSync(opt('save'), JSON.stringify(saved));
  pool.close();
}
