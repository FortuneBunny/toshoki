// 区画: 町の中のマス目。地形と資源の生成、建物の配置、町の生産量の集計。
// 生成はワールドの乱数を使わない（町ごとのシードから作る）。今までの結果の再現性を保つため。
import { DISTRICT_SIZE as N, DISTRICT_CENTER as C, MARKET_RADIUS, TERRAIN, RESOURCES, PRODUCERS, PRODUCER_FOR } from '../data/district.js';
const RESOURCE_NAMES = Object.fromEntries(Object.entries(RESOURCES).map(([k, v]) => [k, v.name]));
import { hashSeed } from './rng.js';

function localRng(seed) {
  let t = hashSeed(seed);
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (x, y) => y * N + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const dist = (x, y) => Math.max(Math.abs(x - C), Math.abs(y - C));

export function marketRadius(tier, bonus = 0) {
  return Math.min(C, MARKET_RADIUS[Math.max(0, Math.min(MARKET_RADIUS.length - 1, tier))] + bonus);
}

// 地形と資源の文字列を作る
function makeLand(r, tags) {
  const terrain = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = r();
      let t;
      if (tags.includes('desert')) t = v < 0.68 ? 's' : v < 0.85 ? '.' : v < 0.95 ? 'h' : 'f';
      else t = v < 0.42 ? 'f' : v < 0.85 ? '.' : v < 0.95 ? 'h' : 's';
      terrain.push(t);
    }
  }
  // 港町は一辺が水辺
  if (tags.includes('port')) {
    const side = Math.floor(r() * 4);
    for (let i = 0; i < N; i++) for (let k = 0; k < 2; k++) {
      const [x, y] = [[i, k], [N - 1 - k, i], [i, N - 1 - k], [k, i]][side];
      terrain[idx(x, y)] = 'w';
    }
  }
  terrain[idx(C, C)] = '.';
  return { terrain, res: new Array(N * N).fill('-') };
}

// 中心のまわりから、条件に合う空きマスを探す（近い順、少しばらつかせる）
function freeTiles(d, r, ok, maxDist = N) {
  const out = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = idx(x, y);
    if (x === C && y === C) continue;
    if (TERRAIN[d.terrain[i]].blocked) continue;
    if (d.used[i]) continue;
    const dd = dist(x, y);
    if (dd > maxDist) continue;
    if (!ok(i, x, y)) continue;
    out.push({ x, y, i, key: dd + r() * 1.5 });
  }
  return out.sort((a, b) => a.key - b.key);
}

// 資源のかたまりを置く（中心から dmin〜dmax の距離に n マス）
function placeDeposit(d, r, code, n, dmin, dmax) {
  const cands = freeTiles(d, r, (i, x, y) => d.res[i] === '-' && dist(x, y) >= dmin && dist(x, y) <= dmax);
  if (!cands.length) return [];
  const seed = cands[Math.floor(r() * Math.min(cands.length, 6))];
  const cluster = [seed];
  d.res[seed.i] = code;
  while (cluster.length < n) {
    const near = freeTiles(d, r, (i, x, y) => d.res[i] === '-' && cluster.some((c) => Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1));
    if (!near.length) break;
    const t = near[0];
    d.res[t.i] = code;
    cluster.push(t);
  }
  return cluster;
}

function canPlaceProducer(d, type, i) {
  const p = PRODUCERS[type];
  if (p.resource) return d.res[i] === p.resource;
  return p.terrain.includes(d.terrain[i]);
}

// 区画を生成する。produces（町の今の生産量）を、同じ合計になる生産施設に置き換える
export function generateDistrict(city, { seed, scenarioGoods = [] }) {
  const r = localRng(`district:${seed}:${city.id}`);
  const land = makeLand(r, city.tags || []);
  const d = { terrain: land.terrain, res: land.res, used: new Array(N * N).fill(false) };
  d.used[idx(C, C)] = true;
  const buildings = [{ id: 1, type: 'market', x: C, y: C, owner: 'town' }];
  let nextId = 2;

  // 今の生産を施設に（キーの順番は produces と同じにする＝乱数の消費順を変えないため）
  for (const [good, total] of Object.entries(city.produces || {})) {
    const type = PRODUCER_FOR[good];
    if (!type || !(total > 0)) continue;
    const p = PRODUCERS[type];
    const n = Math.max(1, Math.round(total / p.rate));
    if (p.resource) {
      // 足りない資源のマスを、中心の近くに用意する
      const have = freeTiles(d, r, (i) => d.res[i] === p.resource, 4).length;
      if (have < n) placeDeposit(d, r, p.resource, n - have, 1, 3);
    }
    const tiles = freeTiles(d, r, (i) => canPlaceProducer(d, type, i), 4);
    let placed = 0;
    for (let k = 0; k < n; k++) {
      const t = tiles[k] || freeTiles(d, r, () => true, 5)[0];
      if (!t) break;
      d.used[t.i] = true;
      // 最後の1軒で端数を合わせ、合計を元の生産量とぴったり同じにする
      const rate = k < n - 1 ? total / n : total - (total / n) * (n - 1);
      buildings.push({ id: nextId++, type, x: t.x, y: t.y, owner: 'town', rate });
      placed++;
    }
    if (!placed) buildings.push({ id: nextId++, type, x: C, y: C, owner: 'town', rate: total, virtual: true });
  }

  // 伸びしろ: 今ある資源のそばに空きの資源マスを足す（同じ品を増産できる）
  for (const [good] of Object.entries(city.produces || {})) {
    const type = PRODUCER_FOR[good];
    if (type && PRODUCERS[type].resource) placeDeposit(d, r, PRODUCERS[type].resource, 2, 2, 5);
  }
  // これから建てられる資源（シナリオの品で、まだこの町にないもの）を、外側に
  const extra = scenarioGoods.map((g) => PRODUCER_FOR[g]).filter((t) => t && PRODUCERS[t].resource && !(city.produces || {})[PRODUCERS[t].good]);
  for (const t of extra) if (r() < 0.4) placeDeposit(d, r, PRODUCERS[t].resource, 2, 3, 6);

  return { size: N, terrain: d.terrain.join(''), res: d.res.join(''), buildings, nextId, radiusBonus: 0 };
}

// 町の生産量（品物ごと）を区画の建物から集計する。挿入順は建物の順＝元の produces の順
export function districtProduction(city) {
  const out = {};
  for (const b of city.district.buildings) {
    if (b.owner !== 'town' || !PRODUCERS[b.type]) continue;
    const g = PRODUCERS[b.type].good;
    out[g] = (out[g] || 0) + (b.rate ?? PRODUCERS[b.type].rate);
  }
  return out;
}

export function tileAt(district, x, y) {
  if (!inside(x, y)) return null;
  const i = idx(x, y);
  return { x, y, terrain: district.terrain[i], res: district.res[i], building: district.buildings.find((b) => b.x === x && b.y === y && !b.virtual) || null };
}

// その町の今の市場の圏
export function cityRadius(city, tier) {
  return marketRadius(tier, city.district.radiusBonus || 0);
}

// (x, y) に type を置けるか。置けなければ理由を返す
export function placeCheck(city, tier, type, x, y) {
  const d = city.district;
  if (!inside(x, y)) return '区画の外';
  const i = idx(x, y);
  if (dist(x, y) > cityRadius(city, tier)) return '市場の圏の外（町が育つか、圏を広げると置ける）';
  if (TERRAIN[d.terrain[i]].blocked) return '水辺には置けない';
  if (d.buildings.some((b) => b.x === x && b.y === y && !b.virtual)) return 'すでに建物がある';
  const p = PRODUCERS[type];
  if (p) {
    if (p.resource && d.res[i] !== p.resource) return `${p.name}は「${RESOURCE_NAMES[p.resource]}」のマスにしか置けない`;
    if (!p.resource && !p.terrain.includes(d.terrain[i])) return `${p.name}は${p.terrain.map((t) => TERRAIN[t].name).join('・')}にしか置けない`;
  }
  return null;
}

// 置けるマスの一覧（中心に近い順）
export function placeableTiles(city, tier, type) {
  const out = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!placeCheck(city, tier, type, x, y)) out.push([x, y]);
  return out.sort((a, b) => dist(a[0], a[1]) - dist(b[0], b[1]));
}

export function addBuilding(city, b) {
  const d = city.district;
  const nb = { id: d.nextId++, ...b };
  d.buildings.push(nb);
  return nb;
}

// 座標の表記: 列は A〜L、行は 1〜12（例: C5）
export const coordName = (x, y) => `${String.fromCharCode(65 + x)}${y + 1}`;
export function parseCoord(s) {
  const m = /^([A-La-l])\s*(\d{1,2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const x = m[1].toUpperCase().charCodeAt(0) - 65;
  const y = Number(m[2]) - 1;
  return inside(x, y) ? [x, y] : null;
}

export { idx as tileIndex, inside as tileInside, dist as tileDist };
