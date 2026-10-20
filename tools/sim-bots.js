// 決まった戦略で遊ぶボット。バランスの確認用。
//   node tools/sim-bots.js [シナリオ...] [--seeds 20] [--bots idle,greedy,known,sweet,random]
import * as G from '../src/core/index.js';

const { GOODS, TRANSPORTS } = G;

function parse() {
  const args = process.argv.slice(2);
  const opts = { seeds: 20, bots: 'idle,random,known,greedy,sweet', scenarios: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seeds') opts.seeds = Number(args[++i]);
    else if (args[i] === '--bots') opts.bots = args[++i];
    else if (args[i] === '--verbose') opts.verbose = true;
    else opts.scenarios.push(args[i]);
  }
  if (!opts.scenarios.length) opts.scenarios = G.SCENARIO_ORDER;
  opts.bots = opts.bots.split(',');
  return opts;
}

// 目的地で n 個売ったときの見込み額。cheat=true なら本当の今の相場、false なら知識（古い在庫）から推定
function expectedSale(world, destId, good, n, cheat) {
  const dest = world.cities[destId];
  if (cheat) return G.cityWants(dest, good) ? G.quote(world, dest, good, -n) : 0;
  const k = world.player.knowledge[destId];
  if (!k || k.prices?.[good] === undefined) return null;
  if (k.wants && k.wants[good] === false) return 0;
  const stock = k.stock?.[good];
  if (stock === undefined) return k.prices[good] * n * 0.85;
  const fake = { ...dest, stock: { ...dest.stock, [good]: stock } };
  return G.quote(world, fake, good, -n);
}

function sellAll(world, m, cheat, filter = () => true) {
  const city = world.cities[m.city];
  const lines = [];
  for (const [good, q] of Object.entries(m.cargo)) {
    if (!filter(good) || !G.cityWants(city, good)) continue;
    const unit = G.quote(world, city, good, -q) / q;
    // 仕入れ値を下回るなら、少し待つ（ただし2回までしか持ち越さない）
    m.holds = m.holds || {};
    if (unit < (m.cost[good] || 0) && (m.holds[good] || 0) < 2) { m.holds[good] = (m.holds[good] || 0) + 1; continue; }
    m.holds[good] = 0;
    lines.push({ good, qty: -q });
  }
  if (lines.length) G.trade(world, m.id, lines);
}

// 今いる町で何を買ってどこへ行くか
function plan(world, m, { cheat, goods }) {
  const here = world.cities[m.city];
  const cap = G.cargoCap(m) - G.cargoUsed(m);
  let best = null;
  for (const dest of Object.keys(world.cities)) {
    if (dest === m.city) continue;
    const route = G.findPath(world, m.city, dest, m.transport);
    if (!route) continue;
    const desert = route.edges.some((e) => e.kind === 'desert');
    for (const good of goods) {
      let n = Math.min(Math.floor(cap / GOODS[good].weight), Math.floor(here.stock[good] || 0));
      while (n > 0 && G.quote(world, here, good, n) > world.player.silver) n = Math.floor(n * 0.8);
      if (n < 2) continue;
      // 買い過ぎで値が上がりすぎないよう、利益が最大になる数を探す
      let bestN = 0, bestProfit = 0;
      for (const k of [n, Math.ceil(n * 0.75), Math.ceil(n * 0.5), Math.ceil(n * 0.3)]) {
        const sale = expectedSale(world, dest, good, k, cheat);
        if (sale === null) continue;
        const p = sale - G.quote(world, here, good, k);
        if (p > bestProfit) { bestProfit = p; bestN = k; }
      }
      const perDay = bestProfit / Math.max(1, route.days);
      if (bestN && (!best || perDay > best.perDay)) best = { dest, good, n: bestN, perDay, desert, days: route.days };
    }
  }
  return best;
}

// 情報がない町を見に行く（探索）
function explore(world, m) {
  const unknown = Object.keys(world.cities).filter((id) => id !== m.city && !world.player.knowledge[id]);
  const stale = Object.keys(world.cities).filter((id) => id !== m.city).sort((a, b) => (world.player.knowledge[a]?.day ?? -1) - (world.player.knowledge[b]?.day ?? -1));
  for (const id of [...unknown, ...stale]) if (G.findPath(world, m.city, id, m.transport)) return id;
  return null;
}

function provisions(world, m, days) {
  // 砂漠用の食料を積む（なつめやし優先）
  const city = world.cities[m.city];
  const need = Math.ceil(G.cargoCap(m) / 20) * days + 1;
  for (const id of G.PROVISIONS) {
    if (!world.scenario.goods.includes(id)) continue;
    const have = m.cargo[id] || 0;
    const n = Math.min(need - have, Math.floor(city.stock[id] || 0), G.cargoCap(m) - G.cargoUsed(m));
    if (n > 0) { G.trade(world, m.id, [{ good: id, qty: n }]); return; }
  }
}

function upgrade(world, m) {
  // 儲かったら輸送手段を良いものに替え、商人を雇う
  const city = world.cities[m.city];
  for (const t of ['carrack', 'cart', 'dhow', 'camel']) {
    const def = TRANSPORTS[t];
    if (def.cap <= TRANSPORTS[m.transport].cap) continue;
    if (!G.canBuyTransportAt(world, city, t)) continue;
    if (world.player.silver > def.cost * 2.2) { G.buyTransport(world, m.id, t); break; }
  }
  const max = world.scenario.maxMerchants ?? 4;
  if (world.player.merchants.length < max && world.player.silver > G.BALANCE.merchantHireCost * world.player.merchants.length * 3) G.hireMerchant(world, m.city);
}

const BOTS = {
  idle: () => {},
  random(world, m) {
    const city = world.cities[m.city];
    const goods = world.scenario.goods;
    const sells = Object.entries(m.cargo).filter(([g]) => G.cityWants(city, g)).map(([good, q]) => ({ good, qty: -q }));
    if (sells.length) G.trade(world, m.id, sells);
    const g = goods[Math.floor(Math.random() * goods.length)];
    const n = Math.floor(Math.random() * 15);
    if (n) G.trade(world, m.id, [{ good: g, qty: n }]);
    const ns = G.neighbors(world, m.city).filter((e) => G.canUse(e, m.transport));
    const e = ns[Math.floor(Math.random() * ns.length)];
    if (e) G.travel(world, m.id, e.a === m.city ? e.b : e.a);
  },
  greedy: (world, m) => trader(world, m, { cheat: true }),
  known: (world, m) => trader(world, m, { cheat: false }),
  sweet: (world, m) => trader(world, m, { cheat: false, onlySweet: true }),
};

function trader(world, m, { cheat, onlySweet }) {
  const goods = world.scenario.goods.filter((g) => !onlySweet || GOODS[g].kind === 'sweet');
  sellAll(world, m, cheat, (g) => !onlySweet || GOODS[g].kind === 'sweet' || !G.PROVISIONS.includes(g));
  upgrade(world, m);
  const p = plan(world, m, { cheat, goods });
  if (p && p.perDay > 1) {
    G.trade(world, m.id, [{ good: p.good, qty: p.n }]);
    if (p.desert) provisions(world, m, p.days);
    const guards = world.scenario.bandits ? 2 : 0;
    const r = G.travel(world, m.id, p.dest, { guards });
    if (!r.ok) G.travel(world, m.id, p.dest);
    return;
  }
  const dest = explore(world, m);
  if (dest) {
    const r = G.routeInfo(world, m.id, dest);
    if (r?.desertDays) provisions(world, m, r.days);
    G.travel(world, m.id, dest);
  } else G.advance(world, 1);
}

export function playBot(scenarioId, seed, botName) {
  const world = G.createWorld(scenarioId, { seed });
  G.drainEvents(world);
  const bot = BOTS[botName];
  let guard = 0;
  while (!world.finished && guard++ < 20000) {
    for (const m of world.player.merchants) if (!m.travel) bot(world, m);
    G.advance(world, 1, { stopOn: new Set() });
  }
  const s = world.stats;
  return {
    win: !!world.finished?.win, rank: world.finished?.rank || 'C', day: world.finished?.day ?? world.day,
    silver: Math.round(world.player.silver), worth: Math.round(G.netWorth(world)), profit: Math.round(s.profit),
    lossRate: s.sales ? s.lossSales / s.sales : 0, hits: s.hits, rushes: s.rushes, merchants: world.player.merchants.length,
    goals: G.goalsStatus(world).map((g) => Math.round(g.p * 100)),
  };
}

function summarize(results) {
  const n = results.length;
  const wins = results.filter((r) => r.win);
  const ranks = { S: 0, A: 0, B: 0, C: 0 };
  results.forEach((r) => ranks[r.rank]++);
  const avg = (k, arr = results) => (arr.length ? arr.reduce((s, r) => s + r[k], 0) / arr.length : NaN);
  const goals = results[0].goals.map((_, i) => Math.round(results.reduce((s, r) => s + r.goals[i], 0) / n));
  return {
    win: `${Math.round((wins.length / n) * 100)}%`,
    ranks: `S${ranks.S} A${ranks.A} B${ranks.B} C${ranks.C}`,
    day: Math.round(avg('day', wins)) || '-',
    worth: Math.round(avg('worth')),
    loss: `${Math.round(avg('lossRate') * 100)}%`,
    rushes: avg('rushes').toFixed(1),
    goals: goals.join('/'),
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('sim-bots.js')) {
  const opts = parse();
  for (const sc of opts.scenarios) {
    const def = G.SCENARIOS[sc];
    console.log(`\n=== ${sc} ${def.title}（期限 ${def.deadline}日） ===`);
    const rows = [];
    for (const bot of opts.bots) {
      const results = [];
      for (let s = 1; s <= opts.seeds; s++) results.push(playBot(sc, s, bot));
      rows.push({ bot, ...summarize(results) });
    }
    console.table(rows);
  }
}
