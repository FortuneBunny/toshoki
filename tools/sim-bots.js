// 決まった戦略で遊ぶボット。バランスの確認用。
//   node tools/sim-bots.js [シナリオ...] [--seeds 20] [--bots idle,greedy,known,sweet,random]
import * as G from '../src/core/index.js';

const { GOODS, TRANSPORTS } = G;

function parse() {
  const args = process.argv.slice(2);
  const opts = { seeds: 20, bots: 'idle,random,known,greedy,sweet,pioneer', scenarios: [] };
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
function plan(world, m, { cheat, goods, keep = false }) {
  const here = world.cities[m.city];
  const cap = G.cargoCap(m) - G.cargoUsed(m);
  let best = null;
  for (const dest of Object.keys(world.cities)) {
    if (dest === m.city) continue;
    const route = G.findPath(world, m.city, dest, m.transport);
    if (!route) continue;
    const desert = route.edges.some((e) => e.kind === 'desert');
    for (const good of goods) {
      // keep: 町が持ちたい在庫は残す（自分の交易所を飢えさせない）
      const avail = keep ? Math.max(0, (here.stock[good] || 0) - G.targetStock(here, good) * 0.6) : here.stock[good] || 0;
      let n = Math.min(Math.floor(cap / GOODS[good].weight), Math.floor(avail));
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
  const max = G.merchantCap(world);
  // 町のないシナリオでは、交易所が2つになるまで雇わない（2つ目の交易所の費用を残す）
  const early = G.isPioneer(world) && Object.values(world.cities).filter((c) => c.founded).length < 2;
  if (!early && world.player.merchants.length < max && world.player.silver > G.hireCost(world) * 3) G.hireMerchant(world, m.city);
}

export const BOTS = {
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

function trader(world, m, { cheat, onlySweet, keep = false }) {
  const goods = world.scenario.goods.filter((g) => !onlySweet || GOODS[g].kind === 'sweet');
  sellAll(world, m, cheat, (g) => !onlySweet || GOODS[g].kind === 'sweet' || !G.PROVISIONS.includes(g));
  upgrade(world, m);
  const p = plan(world, m, { cheat, goods, keep });
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

// ---------- 目標を意識するボット（そこそこ上手いプレイヤーの近似） ----------
function bestSource(world, good, exclude) {
  let best = null;
  for (const c of Object.values(world.cities)) {
    if (c.id === exclude) continue;
    const stock = c.stock[good] || 0;
    if (stock < 4) continue;
    const p = G.midPrice(c, good);
    if (!best || p < best.p) best = { id: c.id, p };
  }
  return best;
}

function goalTasks(world) {
  const tasks = [];
  for (const g of world.scenario.goals) {
    if (g.type === 'cityTier' || g.type === 'rushes' || g.type === 'cityPop') {
      const c = world.cities[g.city];
      const wantSweet = g.type === 'rushes' && !(c.crash > 0);
      for (const id of world.scenario.goods) {
        const def = GOODS[id];
        if (G.dailyDemand(c, id, false) <= 0 || (c.produces[id] || 0) > 0) continue;
        if (def.kind === 'food' || (def.kind === 'sweet' && (wantSweet || def.tier <= 1)) || def.kind === 'goods') tasks.push({ kind: 'supply', good: id, to: g.city });
      }
    }
    if (g.type === 'deliver') tasks.push({ kind: 'supply', good: g.good, to: g.city });
    if (g.type === 'produce' || g.type === 'share') tasks.push({ kind: 'produce', good: g.good || 'whitesugar' });
  }
  return tasks;
}

function millPlan(world) {
  // 製糖所はサトウキビ（または粗糖）の産地に一番近い、大きな町に建てる
  const caneSrc = Object.values(world.cities).find((c) => c.produces.cane) || Object.values(world.cities).find((c) => c.produces.rawsugar);
  if (!caneSrc) return null;
  const input = caneSrc.produces.cane ? 'cane' : 'rawsugar';
  let best = null;
  for (const c of Object.values(world.cities)) {
    const hop = world.hopDistance[caneSrc.id][c.id];
    const score = G.cityTier(c) * 2 - hop * 1.5 + (c.id === caneSrc.id ? 1 : 0);
    if (!best || score > best.score) best = { city: c.id, score };
  }
  return { src: caneSrc.id, at: best.city, input };
}

function goalBot(world, m) {
  const tasks = goalTasks(world);
  const city = world.cities[m.city];
  upgrade(world, m);
  // 工房の用意
  const prodTask = tasks.find((t) => t.kind === 'produce');
  if (prodTask && (world.scenario.buildings || []).includes('mill')) {
    const plan = millPlan(world);
    const hasMill = world.player.buildings.some((b) => b.type === 'mill');
    if (plan && !hasMill) {
      if (m.city === plan.at && world.player.silver > 700) G.build(world, m.city, 'mill');
      else if (world.player.silver > 700 && m.id === 1) { sellAll(world, m, false); G.travel(world, m.id, plan.at); return; }
    }
    if (plan && world.player.buildings.some((b) => b.type === 'mill') && m.id % 2 === 1) {
      // 材料を運び、白糖を持ち出して売る
      if (m.city === plan.at) {
        if (m.cargo[plan.input]) G.warehouse(world, m.id, plan.input, -m.cargo[plan.input]);
        const wh = world.player.warehouses[plan.at];
        const ws = Math.floor(wh?.stock.whitesugar || 0);
        if (ws > 0) G.warehouse(world, m.id, 'whitesugar', Math.min(ws, G.cargoCap(m) - G.cargoUsed(m)));
        if (m.cargo.whitesugar && G.cityWants(city, 'whitesugar') && G.quote(world, city, 'whitesugar', -1) > GOODS.whitesugar.base * 0.7) G.trade(world, m.id, [{ good: 'whitesugar', qty: -m.cargo.whitesugar }]);
        if (m.cargo.whitesugar) {
          const dest = Object.values(world.cities).filter((c) => G.cityWants(c, 'whitesugar') && c.id !== m.city).sort((a, b) => G.midPrice(b, 'whitesugar') - G.midPrice(a, 'whitesugar'))[0];
          if (dest && G.travel(world, m.id, dest.id).ok) return;
        }
        if (G.travel(world, m.id, plan.src).ok) return;
      } else if (m.city === plan.src) {
        sellAll(world, m, false);
        const n = Math.min(Math.floor(city.stock[plan.input] || 0), G.cargoCap(m) - G.cargoUsed(m));
        let k = n;
        while (k > 0 && G.quote(world, city, plan.input, k) > world.player.silver) k--;
        if (k > 0) G.trade(world, m.id, [{ good: plan.input, qty: k }]);
        if (G.travel(world, m.id, plan.at).ok) return;
      } else {
        sellAll(world, m, false);
        if (G.travel(world, m.id, m.cargo.whitesugar ? plan.at : plan.src).ok) return;
      }
    }
  }
  // 町への供給
  const supplies = tasks.filter((t) => t.kind === 'supply');
  if (supplies.length) {
    const t = supplies[(m.id + Math.floor(world.day / 60)) % supplies.length];
    if (m.city === t.to) {
      sellAll(world, m, false);
      if (m.cargo[t.good]) G.trade(world, m.id, [{ good: t.good, qty: -m.cargo[t.good] }]);
    }
    if (m.cargo[t.good] && m.city !== t.to) {
      const r = G.routeInfo(world, m.id, t.to);
      if (r?.desertDays) provisions(world, m, r.days);
      if (G.travel(world, m.id, t.to, { guards: world.scenario.bandits ? 3 : 0 }).ok) return;
    }
    const src = bestSource(world, t.good, t.to);
    if (src && m.city === src.id) {
      sellAll(world, m, false);
      const room = Math.floor((G.cargoCap(m) - G.cargoUsed(m)) * 0.8 / GOODS[t.good].weight);
      let k = Math.min(room, Math.floor(city.stock[t.good] || 0));
      while (k > 0 && G.quote(world, city, t.good, k) > world.player.silver - 30) k--;
      if (k > 0) G.trade(world, m.id, [{ good: t.good, qty: k }]);
      const r = G.routeInfo(world, m.id, t.to);
      if (r?.desertDays) provisions(world, m, r.days);
      if (m.cargo[t.good] && G.travel(world, m.id, t.to, { guards: world.scenario.bandits ? 3 : 0 }).ok) return;
    } else if (src && G.findPath(world, m.city, src.id, m.transport)) {
      // 産地へ向かう途中も、儲かるものがあれば運ぶ
      const p = plan(world, m, { cheat: false, goods: world.scenario.goods });
      if (p && p.dest === src.id && p.perDay > 1) G.trade(world, m.id, [{ good: p.good, qty: p.n }]);
      const r = G.routeInfo(world, m.id, src.id);
      if (r?.desertDays) provisions(world, m, r.days);
      if (G.travel(world, m.id, src.id, { guards: world.scenario.bandits ? 3 : 0 }).ok) return;
    }
  }
  trader(world, m, { cheat: false });
}
BOTS.goal = goalBot;

// ---------- 町のないシナリオ（版4 H2） ----------
// 始め方: 一族を選び（fam 番目）、館のそばの一番良い場所に最初の交易所を置く。どのボットも同じ（idle でも）
export function pioneerStart(world, fam = 0) {
  if (G.setupStage(world) === 'family') G.chooseFamily(world, G.familyList(world)[fam % G.familyList(world).length].id);
  const s = G.foundSites(world, 1)[0];
  if (s) G.foundPost(world, s.x, s.y);
}

const ownPosts = (world) => Object.values(world.cities).filter((c) => c.founded);
// 開拓の運営: 交易所を開く・格上げ・道・工房・技術（毎日1回）
export function pioneerManage(world) {
  const pl = world.player;
  const posts = ownPosts(world);
  const have = new Set(posts.flatMap((c) => Object.keys(c.produces).filter((g) => c.produces[g] > 0)));
  // 交易所を開く: 自分の交易所から近く、まだ作っていない食べ物の集落がある場所
  if (posts.length < Math.min(5, G.postsAllowed(world)) && pl.silver > G.postCost(world) + (posts.length < 2 ? 50 : 350)) {
    let best = null;
    for (const s of G.foundSites(world, 40)) {
      const d = Math.min(...posts.map((c) => { const [x, y] = world.grid.cityTiles[c.id]; return Math.max(Math.abs(x - s.x), Math.abs(y - s.y)); }));
      if (d > 32) continue;
      const fresh = s.preview.foods.filter((g) => !have.has(g)).length;
      const score = s.score + fresh * 6 - d * 0.2;
      if (!best || score > best.score) best = { ...s, score };
    }
    if (best) G.foundPost(world, best.x, best.y);
  }
  for (const c of posts) {
    // 格上げ: 家の空き地が足りなくなってきたら
    const cost = G.expandCost(world, c.id);
    if (cost && c.grade < 2 && c.pop >= G.housingCap(c, G.cityTier(c)) * 0.8 && pl.silver > cost + 400) {
      const m = pl.merchants.find((x) => !x.travel && x.city === c.id);
      if (m || c.founded) G.expandMarket(world, c.id);
    }
  }
  // 道: 自分の交易所どうしを小道で（近い順に）
  if (G.pathsBuilt(world) < G.pathsAllowed(world) && pl.silver > 900) {
    for (let i = 1; i < posts.length; i++) {
      const a = posts[i];
      const b = posts.slice(0, i).sort((p, q) => G.findPath(world, a.id, p.id, 'donkey')?.days - G.findPath(world, a.id, q.id, 'donkey')?.days)[0];
      if (!b || world.edges.some((e) => e.built && ((e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id)))) continue;
      const plan = G.planPath(world, a.id, b.id, 'trail');
      if (plan && pl.silver > plan.cost + 600) { G.buildPath(world, a.id, b.id, 'trail'); break; }
    }
  }
  // 製糖所: サトウキビのある市場（格上げ済み）に
  if ((world.scenario.buildings || []).includes('mill') && !pl.buildings.some((b) => b.type === 'mill') && pl.silver > 1200) {
    const at = posts.find((c) => c.grade >= 1 && c.produces.cane) || posts.find((c) => c.grade >= 1);
    if (at) {
      const m = pl.merchants.find((x) => !x.travel && x.city === at.id);
      if (m) G.build(world, at.id, 'mill');
    }
  }
  // 技術: 白糖と菓子
  for (const id of ['whiterefining', 'confection']) {
    const t = G.techList(world).find((x) => x.id === id);
    if (t && t.available && !['player', 'licensed'].includes(t.owner) && pl.silver > t.price + 1500 && pl.buildings.length) G.buyTech(world, id);
  }
  if (pl.buildings.some((b) => b.type === 'mill') && !pl.buildings.some((b) => b.type === 'confectionery') && pl.silver > 2500 && G.buildingUsable(world, 'confectionery')) {
    const at = posts.find((c) => c.grade >= 1 && pl.merchants.some((x) => !x.travel && x.city === c.id));
    if (at) G.build(world, at.id, 'confectionery');
  }
}
BOTS.pioneer = (world, m) => trader(world, m, { cheat: false, keep: true });

// 定期便を組むボット（版4のシナリオ用）。今の相場で、1日あたりの儲けが一番大きい往復を選んで定期便にする。
//   wait:   一度組んだら任せきり（15回目の Opus の遊び方の近似）。これで S に届かないことを確かめる
//   manage: 45日ごとに、町の今の様子（入荷の波・糖度）を見て組み直す。読んで動く遊び手の近似。これで S に届くことを確かめる
export function bestLeg(world, from, to, m, taken) {
  const a = world.cities[from];
  const b = world.cities[to];
  const cap = G.cargoCap(m);
  let best = null;
  for (const g of world.scenario.goods) {
    if (!G.cityWants(b, g) || taken.has(`${from}>${g}`)) continue;
    const spare = Math.floor((a.stock[g] || 0) - (a.founded ? G.targetStock(a, g) * 0.6 : 0));
    const n = Math.min(Math.floor(cap / GOODS[g].weight), spare);
    if (n < 4) continue;
    const buy = G.quote(world, a, g, n);
    const p = G.quote(world, b, g, -n) - buy;
    if (p > 0 && (!best || p > best.p)) best = { good: g, n, p, max: (buy / n) * 1.15, min: (buy / n) * 1.03 };
  }
  return best;
}
export function planOrder(world, m) {
  const ids = Object.keys(world.cities).filter((id) => G.isVisited(world, id) && !world.cities[id].rivalPost);
  const taken = new Set(world.player.merchants.filter((x) => x !== m && x.order).flatMap((x) => x.order.stops.flatMap((st) => st.buy.map((bb) => `${st.city}>${bb.good}`))));
  let best = null;
  for (const a of ids) for (const b of ids) {
    if (a >= b) continue;
    const r = G.findPath(world, a, b, m.transport);
    if (!r) continue;
    const go = bestLeg(world, a, b, m, taken);
    const back = bestLeg(world, b, a, m, taken);
    const perDay = ((go?.p || 0) + (back?.p || 0)) / (2 * r.days + 2) - (r.desertDays ? 0.3 : 0);
    if (perDay > 0.5 && (!best || perDay > best.perDay)) best = { a, b, go, back, perDay };
  }
  if (!best) return false;
  const stop = (city, buyL, sellL) => ({ city, buy: buyL ? [{ good: buyL.good, qty: buyL.n, max: buyL.max }] : [], sell: sellL ? [{ good: sellL.good, min: sellL.min }] : [] });
  return G.setOrder(world, m.id, { stops: [stop(best.a, best.go, best.back), stop(best.b, best.back, best.go)], guards: world.scenario.bandits ? 2 : 0 }).ok;
}
function orderBot(world, m, replan) {
  if (m.order && !(replan && world.day - (m.order.since ?? 0) >= replan)) return;
  if (!m.travel) upgrade(world, m);
  // 最初の30日は手で売り買いして、町と相場を知る（遊び手も、まず手で往復してから定期便にする）
  if (world.day < 30) { if (!m.travel) trader(world, m, { cheat: false, keep: true }); return; }
  if (planOrder(world, m)) return;
  if (!m.order && !m.travel) trader(world, m, { cheat: false, keep: true });
}
BOTS.wait = (world, m) => orderBot(world, m, 0);
BOTS.manage = (world, m) => orderBot(world, m, 45);

export function playBot(scenarioId, seed, botName, heirloom = null, fam = null) {
  const world = G.createWorld(scenarioId, { seed, heirloom });
  if (G.isPioneer(world)) pioneerStart(world, fam ?? seed);
  G.drainEvents(world);
  const bot = BOTS[botName];
  let guard = 0;
  while (!world.finished && guard++ < 20000) {
    if (['pioneer', 'wait', 'manage'].includes(botName) && G.isPioneer(world)) pioneerManage(world);
    // 定期便の商人は町で止まらないので、組み直しは毎日ここで見る
    if (botName === 'manage') for (const m of world.player.merchants) if (m.order) orderBot(world, m, 45);
    // 定期便の商人は町に止まらないので、雇うのはここで（儲かって銀がたまったら）
    if (['wait', 'manage'].includes(botName) && world.day >= 30 && world.player.merchants.length < G.merchantCap(world) && world.player.silver > G.hireCost(world) * 3 + 300) {
      const at = Object.values(world.cities).find((c) => c.founded && G.hasPresence(world, c.id));
      if (at) G.hireMerchant(world, at.id);
    }
    for (const m of world.player.merchants) if (!m.travel) bot(world, m);
    G.advance(world, 1, { stopOn: new Set() });
  }
  const s = world.stats;
  return {
    win: !!world.finished?.win, rank: world.finished?.rank || 'C', day: world.finished?.day ?? world.day,
    silver: Math.round(world.player.silver), worth: Math.round(G.netWorth(world)), profit: Math.round(s.profit),
    lossRate: s.sales ? s.lossSales / s.sales : 0, hits: s.hits, rushes: s.rushes, merchants: world.player.merchants.length,
    goals: G.goalsStatus(world).map((g) => Math.round(g.p * 100)),
    bandit: Math.round(s.banditLoss || 0), starved: s.starvedLoss || 0, repelled: s.banditsRepelled || 0,
    transports: world.player.merchants.map((m) => m.transport).join(','),
    rival: world.rivals.map((r) => `${Math.round(r.silver)}:${JSON.stringify(r.sold)}`).join(' '),
    mine: JSON.stringify(s.soldTotal),
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

if (process.argv[1]?.endsWith('sim-bots.js')) {
  const opts = parse();
  for (const sc of opts.scenarios) {
    const def = G.resolveScenario(sc, 1);
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
