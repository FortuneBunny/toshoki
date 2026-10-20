// 道を敷く（G3）: 2つの町を結ぶ道を、費用が最も安い経路で引く
import { astar, gridKey, T, P, GRID_W, GRID_H } from './grid.js';
import { emit } from './events.js';

export const PATH_KINDS = {
  trail: { name: '小道', level: P.TRAIL, perTile: 4, note: 'ロバとラクダが速く通れる' },
  road: { name: '街道', level: P.ROAD, perTile: 10, note: '荷車も通れる。小道の格上げにも使う' },
  canal: { name: '運河', level: 0, perTile: 26, note: '陸を掘って水路にする。船が内陸の町へ入れる' },
};

const TERRAIN_BUILD = { [T.PLAIN]: 1, [T.FERTILE]: 1, [T.SAND]: 1.5, [T.HILL]: 3, [T.MOUNTAIN]: Infinity, [T.WATER]: Infinity };

export function pathsAllowed(world) {
  return world.scenario.maxPaths ?? ((world.scenario.buildings || []).includes('road') ? 6 : 0);
}
// 道を敷けるかどうか（敷けないなら理由）
export function pathCheck(world, kind) {
  if (!PATH_KINDS[kind]) return '道の種類は trail（小道）・road（街道）・canal（運河）';
  if (kind === 'canal' && !world.allowedTransports.some((t) => ['dhow', 'carrack'].includes(t))) return 'このシナリオでは運河は掘れない（船がない）';
  if (kind === 'road' && !world.allowedTransports.includes('cart')) return 'このシナリオでは街道を敷けない（荷車がない。小道で足りる）';
  const allowed = pathsAllowed(world);
  if (pathsBuilt(world) >= allowed) return allowed ? `このシナリオで敷ける道は${allowed}本まで` : 'このシナリオでは道を敷けない';
  return null;
}
export function pathsBuilt(world) {
  return world.edges.filter((e) => e.built).length;
}

// 道の見積もり。通れなければ null
export function planPath(world, from, to, kind) {
  const grid = world.grid;
  const k = PATH_KINDS[kind];
  if (!k || !grid.cityTiles[from] || !grid.cityTiles[to] || from === to) return null;
  if (kind === 'canal') {
    // 運河: 水と陸の両方を通れる。陸は掘る（山は掘れない）
    const cost = (i) => (grid.cityAt.has(i) ? 0.2 : grid.terrain[i] === T.WATER ? 0.3 : grid.terrain[i] === T.MOUNTAIN ? Infinity : TERRAIN_BUILD[grid.terrain[i]] ?? 1);
    const tiles = astar(grid.cityTiles[from], grid.cityTiles[to], cost, { minCost: 0.2 });
    if (!tiles) return null;
    const dig = tiles.filter(([x, y]) => { const i = gridKey(x, y); return grid.terrain[i] !== T.WATER && !grid.cityAt.has(i); });
    const price = Math.round(dig.reduce((s, [x, y]) => s + k.perTile * (TERRAIN_BUILD[grid.terrain[gridKey(x, y)]] || 1), 0));
    return { kind, tiles, newTiles: dig.length, cost: Math.round(price * (world.player.mods?.buildCost ?? 1)) };
  }
  // 陸の道: 既にその格以上の道があるマスは安く通る
  const cost = (i) => {
    if (grid.cityAt.has(i)) return 0.2;
    const base = TERRAIN_BUILD[grid.terrain[i]];
    if (!Number.isFinite(base)) return Infinity;
    return grid.path[i] >= k.level ? 0.6 : base;
  };
  const tiles = astar(grid.cityTiles[from], grid.cityTiles[to], cost, { minCost: 0.2 });
  if (!tiles) return null;
  let price = 0;
  let fresh = 0;
  for (const [x, y] of tiles) {
    const i = gridKey(x, y);
    if (grid.cityAt.has(i) || grid.path[i] >= k.level) continue;
    fresh++;
    price += k.perTile * TERRAIN_BUILD[grid.terrain[i]];
  }
  return { kind, tiles, newTiles: fresh, cost: Math.round(price * (world.player.mods?.buildCost ?? 1)) };
}

// 港: 水辺の町に船着き場を作る（船が買え、船で入れるようになる）
export const PORT_COST = 700;
export function portCheck(world, cityId) {
  const c = world.cities[cityId];
  if (!c) return 'その町はない';
  if (c.tags.includes('port')) return 'もう港がある';
  if (!world.allowedTransports.some((t) => ['dhow', 'carrack'].includes(t))) return 'このシナリオでは船を使えない';
  const [cx, cy] = world.grid.cityTiles[cityId];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = cx + dx;
    const y = cy + dy;
    if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H && world.grid.terrain[gridKey(x, y)] === T.WATER) return null;
  }
  return '近くに水がない（運河を引けば港になる）';
}
export function buildPort(world, cityId) {
  const why = portCheck(world, cityId);
  if (why) return { ok: false, error: why };
  const cost = Math.round(PORT_COST * (world.player.mods?.buildCost ?? 1));
  if (world.player.silver < cost) return { ok: false, error: `銀が足りない（${cost}必要）` };
  world.player.silver -= cost;
  world.cities[cityId].tags.push('port');
  world.grid.version++;
  emit(world, { type: 'path', big: true, text: `${world.cities[cityId].name}に港を開いた！船が着ける` });
  return { ok: true, cost };
}

export function buildPath(world, from, to, kind) {
  const fail = (error) => ({ ok: false, error });
  const why = pathCheck(world, kind);
  if (why) return fail(why);
  const plan = planPath(world, from, to, kind);
  if (!plan) return fail('その2つの町は結べない（山や海を越えられない）');
  if (!plan.newTiles) return fail('すでにその道がある');
  if (world.player.silver < plan.cost) return fail(`銀が足りない（${plan.cost}必要）`);
  world.player.silver -= plan.cost;
  const grid = world.grid;
  for (const [x, y] of plan.tiles) {
    const i = gridKey(x, y);
    if (grid.cityAt.has(i)) continue;
    if (kind === 'canal') {
      if (grid.terrain[i] !== T.WATER) { grid.terrain[i] = T.WATER; grid.path[i] = P.NONE; world.gridMods.push({ x, y, terrain: T.WATER, path: P.NONE }); }
    } else if (grid.path[i] < PATH_KINDS[kind].level) {
      grid.path[i] = PATH_KINDS[kind].level;
      if (grid.terrain[i] === T.SAND) grid.danger[i] = grid.danger[i] || 0;
      world.gridMods.push({ x, y, path: grid.path[i] });
    }
  }
  grid.version++;
  world.routeCache?.clear?.();
  // 路線図にも道として足す（噂の届く速さや、定期便の初期案に使う）
  const a = world.cities[from];
  const b = world.cities[to];
  const id = Math.max(-1, ...world.edges.map((e) => e.id)) + 1;
  world.edges.push({ id, a: from, b: to, kind: kind === 'canal' ? 'sea' : kind, len: Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 0.2), danger: 0, monsoon: kind === 'canal', stormUntil: 0, built: true, tiles: plan.tiles });
  grid.edgeTiles[id] = plan.tiles;
  if (kind === 'canal') for (const c of [a, b]) if (!c.tags.includes('port')) c.tags.push('port');
  emit(world, { type: 'path', big: true, text: `${a.name}〜${b.name}に${PATH_KINDS[kind].name}を敷いた！（${plan.newTiles}マス、${plan.cost}銀）` });
  return { ok: true, cost: plan.cost, tiles: plan.newTiles };
}
