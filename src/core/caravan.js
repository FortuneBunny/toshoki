// 商人の移動（G0: マス目の上の経路探索）
// 経路は A* でマス単位に求め、1マスずつ進む。1マスにかかる日数は「地形 × 道 × 輸送手段」で決まる。
import { GOODS, PROVISIONS } from '../data/goods.js';
import { TRANSPORTS, DESERT_SLOW } from '../data/transports.js';
import { BALANCE as B } from '../data/balance.js';
import { chance, randInt } from './rng.js';
import { emit } from './events.js';
import { arriveAt } from './orders.js';
import { GRID_W, GRID_H, TILE_LEN, T, P, astar, gridKey } from './grid.js';

export function seasonOf(world) {
  const d = world.day % 360;
  return d < 180 ? 0 : 1;
}
export const SEASON_NAMES = ['夏の季節風（東へ）', '冬の季節風（西へ）'];

// 今の路線図との日数合わせ（A* の経路は直線より少し長くなるため）
const CALIB = 0.9;

export function canUse(edge, transportId) {
  return TRANSPORTS[transportId].modes.includes(edge.kind);
}

export function neighbors(world, cityId) {
  return world.edges.filter((e) => e.a === cityId || e.b === cityId);
}

const isShip = (id) => TRANSPORTS[id].modes.includes('sea');

function inStorm(world, x, y) {
  for (const s of world.storms || []) if (s.until > world.day && Math.hypot(s.x - x, s.y - y) <= s.r) return true;
  return false;
}

// そのマスに入るのにかかる日数（1マスぶん、斜めの補正は呼ぶ側）。通れなければ Infinity
export function tileDays(world, k, transportId, dx) {
  const grid = world.grid;
  const t = TRANSPORTS[transportId];
  const ter = grid.terrain[k];
  const isCity = grid.cityAt.has(k);
  const speed = t.speed * (1 + (world.player.mods?.speed || 0));
  let f;
  if (isShip(transportId)) {
    if (ter !== T.WATER && !isCity) return Infinity;
    f = 1;
    // 季節風: 夏は東向き、冬は西向きが追い風
    if (dx) {
      const favorable = seasonOf(world) === 0 ? dx > 0 : dx < 0;
      f *= favorable ? 0.7 : 1.7;
    }
  } else {
    if ((ter === T.WATER || ter === T.MOUNTAIN) && !isCity) return Infinity;
    const onPath = grid.path[k] > P.NONE || isCity;
    if (transportId === 'cart' && grid.path[k] < P.ROAD && !isCity) return Infinity;
    if (onPath) f = ter === T.HILL ? 1.3 : 1;
    else f = ter === T.HILL ? 3.5 : ter === T.SAND ? (transportId === 'camel' ? 1.6 : 3) : 2.2; // 道なき道
    if (ter === T.SAND) {
      f /= DESERT_SLOW[transportId] ?? 1;
      if (inStorm(world, k % GRID_W, Math.floor(k / GRID_W))) f *= 1.8;
    }
  }
  return ((TILE_LEN * CALIB) / speed) * f;
}

function routeTiles(world, a, b, transportId) {
  const cost = (k, dx) => tileDays(world, k, transportId, dx);
  // 最小の重み（ヒューリスティック用）: 速い輸送手段の追い風
  const t = TRANSPORTS[transportId];
  const minCost = ((TILE_LEN * CALIB) / (t.speed * 1.3)) * 0.69;
  return astar(a, b, cost, { minCost, directional: true });
}

// 町から町への経路。通れなければ null
export function findPath(world, from, to, transportId) {
  if (from === to) return { path: [from], edges: [], days: 0, total: 0, tiles: [], steps: [] };
  const grid = world.grid;
  const ck = `${from}>${to}:${transportId}:${seasonOf(world)}:${grid.version}:${(world.storms || []).filter((s) => s.until > world.day).length}:${world.player.mods?.speed || 0}`;
  world.routeCache = world.routeCache || new Map();
  if (world.routeCache.has(ck)) return world.routeCache.get(ck);
  const tiles = routeTiles(world, grid.cityTiles[from], grid.cityTiles[to], transportId);
  let res = null;
  if (tiles) {
    const steps = [];
    let total = 0;
    let desertDays = 0;
    let danger = 0;
    let water = false;
    for (let i = 1; i < tiles.length; i++) {
      const [x, y] = tiles[i];
      const [px, py] = tiles[i - 1];
      const k = gridKey(x, y);
      const d = tileDays(world, k, transportId, x - px) * (x !== px && y !== py ? Math.SQRT2 : 1);
      steps.push(d);
      total += d;
      if (needsFood(grid, k)) desertDays += d;
      if (grid.terrain[k] === T.WATER) water = true;
      danger = Math.max(danger, grid.danger[k]);
    }
    const days = Math.max(1, Math.round(total));
    // 互換: 今までの「道の一覧」の代わりに、砂漠の区間とそれ以外の区間をまとめた疑似的な道を返す
    const edges = [];
    if (desertDays > 0.01) edges.push({ id: -1, synthetic: true, kind: 'desert', days: Math.round(desertDays), danger, a: from, b: to, len: 0 });
    edges.push({ id: -2, synthetic: true, kind: water ? 'sea' : 'trail', days: Math.max(0, Math.round(total - desertDays)), danger, monsoon: water, a: from, b: to, len: 0 });
    res = { path: [from, to], edges, days, total, tiles, steps, desertDays: Math.round(desertDays), danger };
  }
  if (world.routeCache.size > 2000) world.routeCache.clear();
  world.routeCache.set(ck, res);
  return res;
}

// 互換: 疑似的な道はその日数、昔の道は長さから
export function edgeDays(world, edge, transportId) {
  if (edge.synthetic) return edge.days;
  const t = TRANSPORTS[transportId];
  let days = edge.len / (t.speed * (1 + (world.player.mods?.speed || 0)));
  if (edge.kind === 'desert') days /= DESERT_SLOW[transportId] ?? 1;
  return Math.max(1, Math.round(days));
}

// 町から、その輸送手段で出られるか（まわりに通れるマスがあるか）
export function canDepart(world, cityId, transportId) {
  const [cx, cy] = world.grid.cityTiles[cityId];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const x = cx + dx;
    const y = cy + dy;
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
    if (Number.isFinite(tileDays(world, gridKey(x, y), transportId, dx))) return true;
  }
  return false;
}

export function cargoUsed(m) {
  let used = m.settlers ? settlerLoad(m) : 0; // 開拓団は荷車の8割を使う（残りは道中の食料用）
  for (const [id, q] of Object.entries(m.cargo)) used += q * GOODS[id].weight;
  return used;
}
export function settlerLoad(m) {
  return Math.floor(cargoCap(m) * B.settlerLoad);
}
export function cargoCap(m) {
  return Math.floor(TRANSPORTS[m.transport].cap * (m.capMult ?? 1) * (m.transport === 'cart' ? (m.cartCap ?? 1) : 1));
}

export function startTravel(world, m, to) {
  const route = findPath(world, m.city, to, m.transport);
  if (!route) return { ok: false, error: `${TRANSPORTS[m.transport].name}では${world.cities[to].name}へ行けない` };
  m.travel = { path: [m.city, to], to, from: m.city, tiles: route.tiles, steps: route.steps, i: 0, part: 0, totalDays: route.total, elapsed: 0 };
  m.city = null;
  return { ok: true, days: route.days };
}

// 今いるマス（移動中）
export function travelTile(m) {
  const t = m.travel;
  return t.tiles[Math.min(t.i, t.tiles.length - 1)];
}

// 砂漠を days 日渡るのに要る食料の数（才能・技術の補正込み、1個の余裕つき）
export function foodNeeded(world, m, days) {
  if (!days) return 0;
  return Math.ceil(days * cargoCap(m) * B.provisionPerCap * (world.player.mods?.provision ?? 1) * (m.talent === 'desert' ? 0.5 : 1)) + 1;
}

export const needsFood = (grid, k) => grid.terrain[k] === T.SAND && grid.path[k] < P.ROAD && !grid.cityAt.has(k);

function eatProvisions(world, m) {
  // 端数は持ち越して、まとまったら1個食べる
  m.hunger = (m.hunger || 0) + cargoCap(m) * B.provisionPerCap * (m.talent === 'desert' ? 0.5 : 1) * (world.player.mods?.provision ?? 1);
  let left = Math.floor(m.hunger);
  if (left <= 0) return false;
  m.hunger -= left;
  for (const id of PROVISIONS) {
    const have = m.cargo[id] || 0;
    const eat = Math.min(have, left);
    if (eat > 0) {
      m.cargo[id] = have - eat;
      if (!m.cargo[id]) delete m.cargo[id];
      left -= eat;
    }
    if (!left) break;
  }
  if (left <= 0) return false;
  // 足りなかった分は持ち越さない（持ち越すと、次に食料を積んだとき、たまった分をまとめて食べてしまい、
  // 出発の画面の「約2個食べる」が20個から13個に減った。画面だけのテスト（Sol）の指摘）
  // 食料が尽きた: 進みが遅れ、積荷の一部を失う
  let lost = 0;
  for (const id of Object.keys(m.cargo)) {
    const q = Math.floor(m.cargo[id] * B.starveLoss);
    m.cargo[id] -= q;
    lost += q;
    if (!m.cargo[id]) delete m.cargo[id];
  }
  if (!m.starveWarned) {
    emit(world, { type: 'starve', merchant: m.id, bad: true, text: `${m.name}の隊商は砂漠で食料が尽きた！進みが遅れ、積荷を失っている（食料は なつめやし・干しぶどう・キビ・麦・米）` });
    m.starveWarned = true;
  }
  world.stats.starvedLoss = (world.stats.starvedLoss || 0) + lost;
  return true;
}

function banditCheck(world, m, danger) {
  if (!danger || !world.scenario.bandits) return;
  const p = B.banditBase * danger * (world.player.mods?.safety ?? 1);
  if (!chance(world, p)) return;
  const power = randInt(world, B.banditPower[0], Math.round(B.banditPower[1] * Math.min(1.5, (1 + danger) / 2)));
  const guard = (m.guards + (m.talent === 'strong' ? 2 : 0)) * B.guardPower;
  if (guard >= power) {
    world.player.rep += 10;
    world.stats.banditsRepelled = (world.stats.banditsRepelled || 0) + 1;
    emit(world, { type: 'repelled', merchant: m.id, big: true, text: `${m.name}の護衛が盗賊（強さ${power}）を撃退した！評判 +10` });
    return;
  }
  let lost = 0;
  let lostValue = 0;
  for (const id of Object.keys(m.cargo)) {
    const q = Math.ceil(m.cargo[id] * B.banditLoss);
    m.cargo[id] -= q;
    lost += q;
    lostValue += q * GOODS[id].base;
    if (!m.cargo[id]) delete m.cargo[id];
  }
  world.stats.banditLoss = (world.stats.banditLoss || 0) + lostValue;
  // 何も奪われなかったときは、時間を止めるほどの出来事ではない
  emit(world, { type: lost ? 'robbed' : 'robbedNothing', merchant: m.id, bad: true, text: `${m.name}が盗賊（強さ${power}、護衛${m.guards}人）に襲われ、積荷${lost}個（約${Math.round(lostValue)}銀分）を奪われた` });
}

export function stepTravel(world, m) {
  const t = m.travel;
  if (!t) return;
  const grid = world.grid;
  const [x, y] = travelTile(m);
  const k = gridKey(x, y);
  // 才能: 健脚（陸）・船乗り（船）は1日に進む量が増える。砂漠の民は砂嵐でも遅れにくい
  let budget = 1;
  if (m.talent === 'swift' && !isShip(m.transport)) budget = 1.15;
  if (m.talent === 'sailor' && isShip(m.transport)) budget = 1.15;
  if (m.talent === 'desert' && grid.terrain[k] === T.SAND && inStorm(world, x, y)) budget = 1.6;
  // 食料が要るのは、街道のない砂地だけ（街道には井戸と隊商宿がある）
  if (needsFood(grid, k) && eatProvisions(world, m)) budget /= B.starveSlow;
  banditCheck(world, m, grid.danger[k]);
  world.player.silver -= m.guards * B.guardWage;
  t.elapsed += 1;
  while (budget > 1e-9 && t.i < t.steps.length) {
    const need = t.steps[t.i] - t.part;
    if (budget + 1e-9 >= need) {
      budget -= need;
      t.part = 0;
      t.i += 1;
      // 途中で通った町の相場も見える
      const [tx, ty] = t.tiles[t.i];
      const passed = grid.cityAt.get(gridKey(tx, ty));
      if (passed && passed !== t.to && passed !== t.from) {
        world.passing = world.passing || [];
        world.passing.push(passed);
      }
    } else {
      t.part += budget;
      budget = 0;
    }
  }
  if (t.i < t.steps.length) return;
  m.city = t.to;
  m.lastFrom = t.from;
  m.travel = null;
  m.starveWarned = false;
  m.guards = 0;
  arriveAt(world, m);
}
