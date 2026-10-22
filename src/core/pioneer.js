// 開拓の始まり（版4 H2）: 市場のある町がない土地に、一族を選んで最初の交易所を置く。
// 土地には集落（家が数軒と畑）と野の需要施設（古い寺院・隊商宿・領主の館）が散らばっている。
// どちらも、交易所の圏に入ると、その交易所の住人と買い手になる。集落のままでは育たない。
import { GOODS } from '../data/goods.js';
import { PRODUCER_FOR, PRODUCERS, CIVICS } from '../data/district.js';
import { BALANCE as B } from '../data/balance.js';
import { gridKey, tileOf, T, GRID_W, GRID_H } from './grid.js';
import { cityRadius, worldToDistrict, addBuilding, updateHousing, tileIndex, districtProduction } from './district.js';
import { cityTier } from './city.js';
import { targetStock } from './market.js';
import { emit } from './events.js';
import { observe } from './knowledge.js';

export const HQ_RANGE = 14; // 最初の交易所は、一族の館からこのマス数以内

export function isPioneer(world) {
  return !!world.scenario.pioneer;
}

// 始める前の段階: 'family'（一族を選ぶ）→ 'post'（最初の交易所を置く）→ null（遊べる）
export function setupStage(world) {
  return world.setup?.stage || null;
}

export function familyList(world) {
  return world.scenario.pioneer?.families || [];
}

// 地図座標（1000×600）をマスに
const toTile = (p) => tileOf(p.x, p.y);

// 集落・野の需要施設・一族の館を、シナリオの定義から作る（createWorld から。マス目を作る前に呼ぶ）
export function initPioneer(world) {
  const pz = world.scenario.pioneer;
  world.hamlets = (pz.hamlets || []).map((hm, i) => {
    const [x, y] = toTile(hm);
    return { id: `h${i + 1}`, name: hm.name, x, y, pop: hm.pop, foods: { ...hm.foods }, absorbedBy: null };
  });
  world.wilds = (pz.wilds || []).map((wd, i) => {
    const [x, y] = toTile(wd);
    return { id: `w${i + 1}`, type: wd.type, x, y, absorbedBy: null };
  });
  world.setup = { stage: familyList(world).length > 1 ? 'family' : 'post' };
  if (familyList(world).length === 1) setFamily(world, familyList(world)[0]);
}

// マス目を作ったあと: 集落の家と畑を置くマスを決める（水・山には置かない）
export function placeHamletTiles(world) {
  const grid = world.grid;
  const free = (x, y) => x > 0 && y > 0 && x < GRID_W - 1 && y < GRID_H - 1 && ![T.WATER, T.MOUNTAIN].includes(grid.terrain[gridKey(x, y)]);
  for (const hm of world.hamlets || []) {
    const ring = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    const houses = Math.max(2, Math.min(9, Math.ceil(hm.pop / 45)));
    hm.houses = ring.map(([dx, dy]) => [hm.x + dx, hm.y + dy]).filter(([x, y]) => free(x, y)).slice(0, houses);
    const far = [[2, 0], [0, 2], [-2, 0], [0, -2], [2, 1], [-2, -1], [1, 2], [-1, -2], [2, -1], [-2, 1]];
    const spots = far.map(([dx, dy]) => [hm.x + dx, hm.y + dy]).filter(([x, y]) => free(x, y));
    hm.fields = Object.keys(hm.foods).flatMap((g, i) => spots.slice(i * 2, i * 2 + 2).map(([x, y]) => [x, y, g]));
  }
}

function setFamily(world, fam) {
  world.player.family = fam.id;
  world.player.hq = toTile(fam);
  world.setup = { stage: 'post' };
  assignRivalFamilies(world);
}

// ライバルの一族は、プレイヤーが選ばなかった一族から（シナリオの順に）
export function assignRivalFamilies(world) {
  if (!world.player.family) return;
  const others = familyList(world).filter((f) => f.id !== world.player.family);
  world.rivals.forEach((r, i) => {
    const rf = others[i % Math.max(1, others.length)];
    if (rf) { r.family = rf.id; r.hq = toTile(rf); }
  });
}

export function chooseFamily(world, id) {
  if (setupStage(world) !== 'family') return { ok: false, error: '一族はもう決まっている' };
  const fam = familyList(world).find((f) => f.id === id || f.name === id);
  if (!fam) return { ok: false, error: `一族は ${familyList(world).map((f) => `${f.id}（${f.name}）`).join('・')} から選ぶ` };
  setFamily(world, fam);
  emit(world, { type: 'family', big: true, text: `${fam.name}として商いを始める。${fam.text || ''}館の近くに最初の交易所を置こう` });
  return { ok: true };
}

// 交易所の中心から圏（cheb 距離 r）の中にある、まだ取り込まれていない集落と野の需要施設
export function coveredBy(world, x, y, r) {
  const inR = (o) => !o.absorbedBy && Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= r;
  return { hamlets: (world.hamlets || []).filter(inR), wilds: (world.wilds || []).filter(inR) };
}

// 交易所を置く前の見込み: 圏（交易所の格0）に入るもの
export function sitePreview(world, x, y) {
  const r = B.postGradeRadius[0];
  const { hamlets, wilds } = coveredBy(world, x, y, r);
  const near = coveredBy(world, x, y, B.postGradeRadius[1]);
  return {
    pop: B.pioneerPostPop + hamlets.reduce((s, hm) => s + hm.pop, 0),
    hamlets, wilds,
    // 市場に格上げしたら入るもの
    later: { hamlets: near.hamlets.filter((hm) => !hamlets.includes(hm)), wilds: near.wilds.filter((w) => !wilds.includes(w)) },
    foods: [...new Set(hamlets.flatMap((hm) => Object.keys(hm.foods)))],
  };
}

// 交易所の圏に入った集落と野の需要施設を取り込む（交易所を開いたとき・格上げしたとき・毎日）
export function absorbAround(world, city) {
  if (!world.hamlets?.length && !world.wilds?.length) return;
  const [cx, cy] = world.grid.cityTiles[city.id];
  const { hamlets, wilds } = coveredBy(world, cx, cy, cityRadius(city, cityTier(city)));
  const d = city.district;
  for (const hm of hamlets) {
    hm.absorbedBy = city.id;
    city.pop += hm.pop;
    city.basePop += hm.pop;
    // 集落の畑を、交易所の区画の生産施設にする（畑のマスか、その近くの空きマス）
    for (const [g, rate] of Object.entries(hm.foods)) {
      const type = PRODUCER_FOR[g];
      if (!type || !world.scenario.goods.includes(g)) continue;
      const spot = (hm.fields || []).filter((f) => f[2] === g).map(([x, y]) => worldToDistrict(city, x, y)).find((p) => p && freeTile(d, p))
        || nearestFree(d, worldToDistrict(city, hm.x, hm.y));
      if (!spot) continue;
      const res = PRODUCERS[type].resource;
      if (res) { const i = tileIndex(spot[0], spot[1]); d.res = d.res.slice(0, i) + res + d.res.slice(i + 1); }
      addBuilding(city, { type, x: spot[0], y: spot[1], owner: 'town', rate });
      if (!d.native.includes(g)) d.native.push(g);
    }
    emit(world, { type: 'hamlet', city: city.id, big: true, text: `集落「${hm.name}」が${city.name}の圏に入った！人口 +${hm.pop}（${Object.keys(hm.foods).map((g) => GOODS[g].name).join('・')}が採れる）` });
  }
  for (const w of wilds) {
    const spot = nearestFree(d, worldToDistrict(city, w.x, w.y));
    if (!spot) continue;
    w.absorbedBy = city.id;
    addBuilding(city, { type: w.type, x: spot[0], y: spot[1], owner: 'town', civic: true, wild: true });
    const wants = Object.keys(CIVICS[w.type].flat).filter((g) => world.scenario.goods.includes(g));
    emit(world, { type: 'wild', city: city.id, big: true, text: `${CIVICS[w.type].name}が${city.name}の圏に入った！${wants.map((g) => GOODS[g].name).join('・')}を毎日買ってくれる` });
  }
  if (hamlets.length) {
    // 増えた人の家を建て、集落の畑の分だけ生産を足す
    updateHousing(city, cityTier(city), 999);
    city.produces = districtProduction(city);
    for (const hm of hamlets) for (const g of Object.keys(hm.foods)) if (world.scenario.goods.includes(g)) city.stock[g] = Math.max(city.stock[g] || 0, targetStock(city, g) * 1.2);
  }
}

function freeTile(d, [x, y]) {
  const N = d.size;
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  const t = d.terrain[tileIndex(x, y)];
  if (t === 'w' || t === 'm' || t === 'r') return false;
  return !d.buildings.some((b) => b.x === x && b.y === y && !b.virtual);
}

function nearestFree(d, p) {
  if (!p) return null;
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const q = [p[0] + dx, p[1] + dy];
      if (freeTile(d, q)) return q;
    }
  }
  return null;
}

// 最初の交易所を開いたあと: 商人が館から出てきて、遊べるようになる
export function finishSetup(world, postId, addMerchant) {
  world.setup = null;
  for (const md of world.scenario.start.merchants) addMerchant(world, { ...md, city: postId });
  for (const m of world.player.merchants) observe(world, m.city);
  emit(world, { type: 'start', text: world.scenario.intro });
}

// 毎日: 圏が育った交易所（ライバルのものも）が、まわりの集落を取り込む
export function absorbDaily(world) {
  if (!world.hamlets?.some((hm) => !hm.absorbedBy) && !world.wilds?.some((w) => !w.absorbedBy)) return;
  for (const c of Object.values(world.cities)) if (c.grade !== undefined) absorbAround(world, c);
}

// 町がないシナリオの、集落と野の需要施設の様子（CLI と画面の一覧用）
export function wildernessList(world) {
  return {
    hamlets: (world.hamlets || []).filter((hm) => !hm.absorbedBy),
    wilds: (world.wilds || []).filter((w) => !w.absorbedBy),
  };
}
