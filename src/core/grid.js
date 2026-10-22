// 世界のマス目（G0）: 地形の生成、道の層、マス単位の経路探索（A*）
// 地形はシナリオとシードから毎回作り直せるので保存しない。保存するのは、後から敷いた道（world.gridMods）だけ。
import { hashSeed } from './rng.js';

export const GRID_W = 160;
export const GRID_H = 96;
// 地図座標（1000×600）→ マス
export const TILE_PX = 1000 / GRID_W; // 6.25
// 1マスの距離（今の道の長さの単位にそろえる。地図座標 × 0.2）
export const TILE_LEN = TILE_PX * 0.2; // 1.25

// 地形の番号
export const T = { PLAIN: 0, FERTILE: 1, SAND: 2, HILL: 3, MOUNTAIN: 4, WATER: 5 };
export const TERRAIN_NAMES = ['平地', '肥えた土地', '砂地', '丘', '山', '水'];
// 道の番号
export const P = { NONE: 0, TRAIL: 1, ROAD: 2 };
export const PATH_NAMES = ['道なし', '小道', '街道'];

const key = (x, y) => y * GRID_W + x;
export const tileOf = (px, py) => [Math.max(0, Math.min(GRID_W - 1, Math.round(px / TILE_PX))), Math.max(0, Math.min(GRID_H - 1, Math.round(py / TILE_PX)))];
export const tileCenterPx = (x, y) => [x * TILE_PX, y * TILE_PX];

function rngFrom(seed) {
  let t = hashSeed(seed);
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// なめらかな値のゆらぎ（格子の乱数を双線形補間）
function valueNoise(r, cell) {
  const gw = Math.ceil(GRID_W / cell) + 2;
  const gh = Math.ceil(GRID_H / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => r());
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const v = (i, j) => g[j * gw + i];
    const a = v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx;
    const b = v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
}

// 世界のマス目を作る。scenario.cities と scenario.edges から、町のマスと最初の道を敷く
export function buildGrid(world) {
  const sc = world.scenario;
  const r = rngFrom(`grid:${sc.id}:${world.seed}`);
  const n1 = valueNoise(r, 9);
  const n2 = valueNoise(r, 4);
  const terrain = new Uint8Array(GRID_W * GRID_H);
  const path = new Uint8Array(GRID_W * GRID_H);
  const danger = new Float32Array(GRID_W * GRID_H);
  const shapes = sc.shapes || [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const [px, py] = tileCenterPx(x, y);
      let t = T.PLAIN;
      const v = n1(x, y) * 0.7 + n2(x, y) * 0.3;
      if (v < 0.38) t = T.FERTILE;
      else if (v > 0.74) t = T.HILL;
      if (v > 0.83) t = T.MOUNTAIN;
      for (const sh of shapes) {
        if (!sh.points || sh.kind === 'river') continue;
        if (!pointInPoly(px, py, sh.points)) continue;
        if (sh.kind === 'sea') t = T.WATER;
        else if (sh.kind === 'desert') t = v > 0.8 ? T.HILL : T.SAND;
        else if (sh.kind === 'green') t = v > 0.8 ? T.HILL : T.FERTILE;
      }
      terrain[key(x, y)] = t;
    }
  }
  // 町のまわりは開けた土地にする（山を退かす）。港町は水辺に接するように
  const cityTiles = {};
  for (const c of Object.values(world.cities)) {
    const [cx, cy] = tileOf(c.x, c.y);
    cityTiles[c.id] = [cx, cy];
    if (c.founded || c.grade !== undefined) continue; // 交易所（ライバルのものも）は地形を変えない
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
      const k = key(x, y);
      if (terrain[k] === T.MOUNTAIN) terrain[k] = T.HILL;
      // 町のまわりは陸地（港町も2マスは陸。海への水路はこのあと掘る）
      const landR = (c.tags || []).includes('port') ? 3 : 1;
      if (Math.abs(dx) <= landR && Math.abs(dy) <= landR && terrain[k] === T.WATER) terrain[k] = T.PLAIN;
    }
    terrain[key(cx, cy)] = c.tags?.includes('desert') ? T.SAND : T.PLAIN;
  }
  // 町のないシナリオ: 集落・野の需要施設・一族の館のまわりも、開けた陸地にする
  const spots = [...(world.hamlets || []), ...(world.wilds || [])].map((o) => [o.x, o.y, 2]);
  if (world.player?.hq) spots.push([...world.player.hq, 2]);
  for (const r of world.rivals || []) if (r.hq) spots.push([...r.hq, 2]);
  for (const f of sc.pioneer?.families || []) spots.push([...tileOf(f.x, f.y), 2]);
  for (const [cx, cy, rr] of spots) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
    const x = cx + dx;
    const y = cy + dy;
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
    const k = key(x, y);
    if (terrain[k] === T.MOUNTAIN || terrain[k] === T.WATER) terrain[k] = T.PLAIN;
  }
  const cityAt = new Map(Object.entries(cityTiles).map(([id, [x, y]]) => [key(x, y), id]));
  const grid = { terrain, path, danger, cityTiles, cityAt, edgeTiles: {}, version: 0 };
  // 最初の道: シナリオの道をマスの上に敷く（海の道は敷かない＝船は水の上を自由に進む）
  const ordered = [...world.edges].sort((x, y) => (x.kind === 'sea' ? 0 : 1) - (y.kind === 'sea' ? 0 : 1));
  for (const e of ordered) {
    // プレイヤーが敷いた道は、保存してある変化（gridMods）で戻す
    if (e.built) { grid.edgeTiles[e.id] = e.tiles || []; continue; }
    if (e.kind === 'sea') {
      // 港どうしを水でつなぐ。陸を横切る所は水路にする（町のマスはそのまま）
      const tiles = astar(cityTiles[e.a], cityTiles[e.b], (k) => (grid.terrain[k] === T.WATER ? 1 : grid.cityAt.has(k) ? 1 : 6)) || straightLine(cityTiles[e.a], cityTiles[e.b]);
      for (const [x, y] of tiles) { const k = key(x, y); if (!grid.cityAt.has(k)) grid.terrain[k] = T.WATER; }
      grid.edgeTiles[e.id] = tiles;
      continue;
    }
    const tiles = layRoute(grid, cityTiles[e.a], cityTiles[e.b]);
    const level = e.kind === 'road' ? P.ROAD : P.TRAIL;
    for (const [x, y] of tiles) {
      const k = key(x, y);
      if (grid.path[k] < level) grid.path[k] = level;
      if (e.danger) grid.danger[k] = Math.max(grid.danger[k], e.danger);
      if (e.kind === 'desert' && grid.terrain[k] !== T.WATER) grid.terrain[k] = T.SAND;
      if (grid.terrain[k] === T.MOUNTAIN) grid.terrain[k] = T.HILL;
    }
    grid.edgeTiles[e.id] = tiles;
  }
  // 後から敷いた道（セーブに残っている変化）
  for (const m of world.gridMods || []) {
    if (m.terrain !== undefined) grid.terrain[key(m.x, m.y)] = m.terrain;
    if (m.path !== undefined) grid.path[key(m.x, m.y)] = m.path;
  }
  return grid;
}

// 港どうしが水でつながるように、足りなければ水路を掘る（シナリオの海の道を保証する）
function ensureWaterLink(grid, a, b) {
  const steps = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  for (let i = 1; i < steps; i++) {
    const x = Math.round(a[0] + ((b[0] - a[0]) * i) / steps);
    const y = Math.round(a[1] + ((b[1] - a[1]) * i) / steps);
    const k = key(x, y);
    if (grid.terrain[k] !== T.WATER && grid.path[k] === P.NONE) {
      // 陸を横切る区間は、まわりが水なら水にする（細い陸の切れ目だけ）
      let water = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (grid.terrain[key(x + dx, y + dy)] === T.WATER) water++;
      if (water >= 3) grid.terrain[k] = T.WATER;
    }
  }
}

// 道を敷く経路（地形にそって、山と水を避ける）
function layRoute(grid, a, b) {
  // 山は避ける。水は大回りしてでも避けるが、どうしても渡るなら土手にする
  const cost = (k) => {
    const t = grid.terrain[k];
    if (t === T.MOUNTAIN) return 8;
    if (t === T.WATER) return grid.cityAt.has(k) ? 1 : 10;
    return (t === T.HILL ? 2.2 : t === T.SAND ? 1.2 : 1) * (grid.path[k] ? 0.7 : 1);
  };
  const tiles = astar(a, b, cost) || straightLine(a, b);
  for (const [x, y] of tiles) {
    const k = key(x, y);
    if (grid.terrain[k] === T.WATER) grid.terrain[k] = T.PLAIN;
    if (grid.terrain[k] === T.MOUNTAIN) grid.terrain[k] = T.HILL;
  }
  return tiles;
}

function straightLine(a, b) {
  const steps = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  const out = [];
  for (let i = 0; i <= steps; i++) out.push([Math.round(a[0] + ((b[0] - a[0]) * i) / steps), Math.round(a[1] + ((b[1] - a[1]) * i) / steps)]);
  return out;
}

// 8方向の A*。cost(k) は「そのマスに入る重み」（Infinity なら通れない）。斜めは √2 倍
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
export function astar(a, b, cost, { minCost = 0.35 } = {}) {
  const start = key(a[0], a[1]);
  const goal = key(b[0], b[1]);
  const g = new Float64Array(GRID_W * GRID_H).fill(Infinity);
  const prev = new Int32Array(GRID_W * GRID_H).fill(-1);
  const closed = new Uint8Array(GRID_W * GRID_H);
  const h = (k) => {
    const dx = Math.abs((k % GRID_W) - b[0]);
    const dy = Math.abs(Math.floor(k / GRID_W) - b[1]);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * minCost;
  };
  // 二分ヒープ
  const heap = [];
  const push = (k, f) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const rr = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  g[start] = 0;
  push(start, h(start));
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    if (k === goal) break;
    closed[k] = 1;
    const x = k % GRID_W;
    const y = Math.floor(k / GRID_W);
    for (const [dx, dy, d] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const nk = key(nx, ny);
      if (closed[nk]) continue;
      const c = cost(nk, dx, dy);
      if (!Number.isFinite(c)) continue;
      const ng = g[k] + c * d;
      if (ng < g[nk]) {
        g[nk] = ng;
        prev[nk] = k;
        push(nk, ng + h(nk));
      }
    }
  }
  if (!Number.isFinite(g[goal])) return null;
  const out = [];
  for (let k = goal; k !== -1; k = prev[k]) out.push([k % GRID_W, Math.floor(k / GRID_W)]);
  return out.reverse();
}

export { key as gridKey };
