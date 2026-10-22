// 交易所（G4）: 地図のどこにでも新しい町を開く。道か水辺に面し、ほかの町から離れていること
import { gridKey, T, GRID_W, GRID_H } from './grid.js';
import { GOODS } from '../data/goods.js';
import { generateDistrict, districtProduction, updateHousing } from './district.js';
import { districtLand } from './world.js';
import { cityTier, dailyDemand } from './city.js';
import { targetStock } from './market.js';
import { emit } from './events.js';
import { observe } from './knowledge.js';
import { BALANCE as B } from '../data/balance.js';

export const POST_COST = B.postCost;
export const POST_POP = 160;
const MIN_GAP = 14; // ほかの町からこのマス数以上離す
const EDGE_MARGIN = 7; // 区画（12×12）が地図からはみ出さないように
const POST_NAMES = ['風見の辻', '若葉の市', '白砂の宿', '月見の宿', '黄金の辻', '星降る市', '虹の渡し', '琥珀の宿', '蜜月の辻', '銀泉の市'];

// 地形ごとの「その土地で作れる品」の候補（シナリオにある品だけ使う）
const TERRAIN_GOODS = {
  [T.FERTILE]: ['wheat', 'rice', 'grapes', 'cane'],
  [T.PLAIN]: ['wheat', 'millet', 'grapes'],
  [T.SAND]: ['dates', 'millet'],
  [T.HILL]: ['honey', 'grapes', 'tea'],
};

export function postsAllowed(world) {
  return world.scenario.maxPosts ?? ((world.scenario.buildings || []).includes('road') ? B.postMax : 0);
}
export function postsFounded(world) {
  return Object.values(world.cities).filter((c) => c.founded).length;
}

// その場所に開けるか（開けないなら理由）
export function siteCheck(world, x, y) {
  const grid = world.grid;
  if (x < EDGE_MARGIN || y < EDGE_MARGIN || x >= GRID_W - EDGE_MARGIN || y >= GRID_H - EDGE_MARGIN) return '地図の端に近すぎる';
  const k = gridKey(x, y);
  const t = grid.terrain[k];
  if (t === T.WATER || t === T.MOUNTAIN) return '水や山の上には開けない';
  for (const [cx, cy] of Object.values(grid.cityTiles)) if (Math.max(Math.abs(cx - x), Math.abs(cy - y)) < MIN_GAP) return `ほかの町に近すぎる（${MIN_GAP}マス以上離す）`;
  let road = false;
  let water = false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const kk = gridKey(x + dx, y + dy);
    if (grid.path[kk]) road = true;
    if (grid.terrain[kk] === T.WATER) water = true;
  }
  if (!road && !water) return '道か水辺から2マス以内でないと開けない（先に道を敷く）';
  return null;
}

// まわりの土地を見て、作れそうな品を決める
export function siteGoods(world, x, y) {
  const grid = world.grid;
  const cnt = {};
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const xx = x + dx;
    const yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= GRID_W || yy >= GRID_H) continue;
    const t = grid.terrain[gridKey(xx, yy)];
    cnt[t] = (cnt[t] || 0) + 1;
  }
  const order = Object.entries(cnt).filter(([t]) => TERRAIN_GOODS[t]).sort((a, b) => b[1] - a[1]);
  const goods = [];
  for (const [t] of order) {
    for (const g of TERRAIN_GOODS[t]) {
      if (world.scenario.goods.includes(g) && !goods.includes(g) && GOODS[g]) { goods.push(g); break; }
    }
    if (goods.length >= 2) break;
  }
  return goods;
}

// 候補地: 道や水辺に沿って、開ける場所を土地の良さの順に
export function foundSites(world, limit = 8) {
  const grid = world.grid;
  const out = [];
  for (let y = EDGE_MARGIN; y < GRID_H - EDGE_MARGIN; y += 3) {
    for (let x = EDGE_MARGIN; x < GRID_W - EDGE_MARGIN; x += 3) {
      if (siteCheck(world, x, y)) continue;
      const goods = siteGoods(world, x, y);
      if (!goods.length) continue;
      let fertile = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (grid.terrain[gridKey(x + dx, y + dy)] === T.FERTILE) fertile++;
      let near = Infinity;
      let nearId = null;
      for (const [id, [cx, cy]] of Object.entries(grid.cityTiles)) { const d = Math.max(Math.abs(cx - x), Math.abs(cy - y)); if (d < near) { near = d; nearId = id; } }
      out.push({ x, y, goods, score: fertile + goods.length * 10 - Math.abs(near - 22) * 0.5, near: nearId, nearDist: near });
    }
  }
  out.sort((a, b) => b.score - a.score);
  // 近すぎる候補は間引く
  const picked = [];
  for (const s of out) {
    if (picked.some((p) => Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) < 10)) continue;
    picked.push(s);
    if (picked.length >= limit) break;
  }
  return picked;
}

// 噂の届き方: 交易所は一番近い町とつながっているとみなす
export function linkPostHops(world, id) {
  const hop = world.hopDistance;
  const grid = world.grid;
  if (!hop || !grid) return;
  const [x, y] = grid.cityTiles[id];
  let near = null;
  let best = Infinity;
  for (const [oid, [cx, cy]] of Object.entries(grid.cityTiles)) { if (oid === id) continue; const d = Math.hypot(cx - x, cy - y); if (d < best) { best = d; near = oid; } }
  hop[id] = { [id]: 0 };
  for (const [oid, d] of Object.entries(hop[near] || {})) { if (oid === id) continue; hop[id][oid] = d + 1; if (hop[oid]) hop[oid][id] = d + 1; }
  hop[id][near] = 1;
  if (hop[near]) hop[near][id] = 1;
}

// 交易所の格（0 交易所・1 市場・2 大市場）。古いセーブの交易所は格がないので、市場として扱う
export function postGrade(city) {
  return city.founded ? city.grade ?? 1 : 2;
}
export const gradeName = (g) => B.postGradeNames[g];

export function postCost(world) {
  return Math.round((world.scenario.postCost ?? POST_COST) * (1 + postsFounded(world) * 0.5) * (world.player.mods?.buildCost ?? 1));
}

export function foundPost(world, x, y, name = null) {
  const fail = (error) => ({ ok: false, error });
  const allowed = postsAllowed(world);
  if (postsFounded(world) >= allowed) return fail(allowed ? `このシナリオで開ける交易所は${allowed}つまで` : 'このシナリオでは交易所を開けない');
  const why = siteCheck(world, x, y);
  if (why) return fail(why);
  const goods = siteGoods(world, x, y);
  if (!goods.length) return fail('この土地で作れる品がない');
  const cost = postCost(world);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  const n = postsFounded(world);
  const id = `post${n + 1}`;
  const px = x * (1000 / GRID_W);
  const py = y * (1000 / GRID_W);
  const produces = {};
  goods.forEach((g, i) => { produces[g] = i === 0 ? 2.4 : 1.2; });
  const grid = world.grid;
  const tags = [];
  if (grid.terrain[gridKey(x, y)] === T.SAND) tags.push('desert');
  const c = {
    id, name: name || POST_NAMES[n % POST_NAMES.length], x: px, y: py, tags, founded: true, foundedDay: world.day, grade: 0,
    pop: POST_POP, basePop: POST_POP, glucose: 70, glucoseTarget: 75, luxury: 1,
    produces, stock: {}, rush: 0, crash: 0, rushCount: 0,
    prodMods: {}, demandMods: {}, priceMods: {}, growthMod: 1,
  };
  world.cities[id] = c;
  grid.cityTiles[id] = [x, y];
  grid.cityAt.set(gridKey(x, y), id);
  grid.version++;
  world.routeCache?.clear?.();
  c.district = generateDistrict(c, { seed: world.seed, scenarioGoods: world.scenario.goods, ...districtLand(world, c) });
  c.produces = districtProduction(c);
  updateHousing(c, cityTier(c), 999);
  for (const g of world.scenario.goods) {
    const t = targetStock(c, g);
    c.stock[g] = c.produces[g] ? t * 1.2 : dailyDemand(c, g, false) > 0 ? t * 0.2 : 0;
  }
  observe(world, id);
  linkPostHops(world, id);
  emit(world, { type: 'found', big: true, text: `新しい交易所「${c.name}」を開いた！ ${goods.map((g) => GOODS[g].name).join('・')}が採れる土地` });
  return { ok: true, id, cost };
}
