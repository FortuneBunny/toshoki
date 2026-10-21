// ゲーム状態の生成と、1日の進行
import { GOODS } from '../data/goods.js';
import { TRANSPORTS } from '../data/transports.js';
import { BALANCE as B } from '../data/balance.js';
import { SCENARIOS } from '../data/scenarios.js';
import { HEIRLOOMS } from '../data/heirlooms.js';
import { generateFreeplay } from '../data/freeplay.js';
import { hashSeed } from './rng.js';
import { updateCity, dailyDemand, cityTier } from './city.js';
import { targetStock, midPrice } from './market.js';
import { applyModifiers, updateEvents, emit } from './events.js';
import { observe, observePresent } from './knowledge.js';
import { stepTravel } from './caravan.js';
import { updateProduction } from './production.js';
import { updateRivals } from './rival.js';
import { checkGoals } from './scoring.js';
import { generateDistrict, districtProduction, updateHousing } from './district.js';
import { buildGrid, GRID_W, GRID_H, gridKey } from './grid.js';
import { rivalTechs } from './techs.js';
import { runOrder } from './orders.js';
import { PRODUCERS } from '../data/district.js';
import { BUILDINGS } from '../data/buildings.js';

export const SAVE_VERSION = 2;
// 地図の1ピクセルが表す距離（ロバは1日に10進む）
export const MAP_SCALE = 0.2;

function hopTable(cities, edges) {
  const ids = Object.keys(cities);
  const table = {};
  for (const s of ids) {
    const d = { [s]: 0 };
    const q = [s];
    while (q.length) {
      const c = q.shift();
      for (const e of edges) {
        const n = e.a === c ? e.b : e.b === c ? e.a : null;
        if (n && d[n] === undefined) { d[n] = d[c] + 1; q.push(n); }
      }
    }
    table[s] = d;
  }
  return table;
}

// シナリオの定義を引く。フリープレイはシードから生成する
export function resolveScenario(id, seed) {
  if (id === 'free') return generateFreeplay(seed);
  return SCENARIOS[id];
}

export function createWorld(scenarioId, { seed = 1, heirloom = null, heirlooms = [] } = {}) {
  // 家訓は1つだけ（古い呼び出しの heirlooms 配列は先頭だけ使う）
  const chosen = heirloom || heirlooms[0] || null;
  const sc = resolveScenario(scenarioId, seed);
  if (!sc) throw new Error(`不明なシナリオ: ${scenarioId}`);
  const world = {
    version: SAVE_VERSION,
    scenarioId,
    seed: String(seed),
    rngState: hashSeed(`${scenarioId}:${seed}`),
    day: 0,
    cities: {},
    edges: [],
    player: {
      silver: sc.start.silver,
      merchants: [],
      branches: [],
      knowledge: {},
      buildings: [],
      warehouses: {},
      rep: 0, repLevel: 0, streak: 0, maxStreak: 0,
      heirloom: HEIRLOOMS[chosen] ? chosen : null,
      mods: { ...(HEIRLOOMS[chosen]?.mods || {}) },
    },
    allowedTransports: [...(sc.transports || ['donkey'])],
    rivals: [],
    contracts: [],
    modifiers: [],
    newsQueue: [],
    events: [],
    log: [],
    stats: { spent: 0, revenue: 0, profit: 0, sales: 0, lossSales: 0, hits: 0, trips: 0, contracts: 0, bought: {}, sold: {}, soldTotal: {}, produced: {}, rushes: 0, history: [] },
    nextId: 1,
    finished: null,
  };
  Object.defineProperty(world, 'scenario', { value: sc, enumerable: false, writable: true });

  for (const c of sc.cities) {
    world.cities[c.id] = {
      id: c.id, name: c.name, x: c.x, y: c.y, tags: c.tags || [],
      pop: c.pop, basePop: c.pop, glucose: c.glucose ?? 75, glucoseTarget: 75, luxury: 1,
      produces: { ...(c.produces || {}) }, stock: {}, rush: 0, crash: 0, rushCount: 0,
      prodMods: {}, demandMods: {}, priceMods: {}, growthMod: 1,
    };
  }
  sc.edges.forEach((e, i) => {
    const a = world.cities[e.a];
    const b = world.cities[e.b];
    const len = Math.round(Math.hypot(a.x - b.x, a.y - b.y) * MAP_SCALE * (e.lenMul ?? 1));
    world.edges.push({ id: i, a: e.a, b: e.b, kind: e.kind, len, danger: e.danger || 0, monsoon: !!e.monsoon, stormUntil: 0 });
  });
  world.hopDistance = hopTable(world.cities, world.edges);
  Object.defineProperty(world, 'hopDistance', { enumerable: false, writable: true, value: world.hopDistance });
  // 世界のマス目（地形・道）。シードから毎回作り直せるので保存しない
  world.gridMods = [];
  world.storms = [];
  Object.defineProperty(world, 'grid', { enumerable: false, writable: true, value: buildGrid(world) });
  Object.defineProperty(world, 'routeCache', { enumerable: false, writable: true, value: new Map() });

  // 区画: 町の中のマス目。生産は区画の建物から集計する（開始時の合計は produces と同じ）
  for (const c of Object.values(world.cities)) {
    c.district = generateDistrict(c, { seed: world.seed, scenarioGoods: sc.goods, ...districtLand(world, c) });
    c.produces = districtProduction(c);
    updateHousing(c, cityTier(c), 999);
  }

  // 初期在庫: 産地は多め、需要だけある品は少なめ
  for (const c of Object.values(world.cities)) {
    for (const id of sc.goods) {
      const t = targetStock(c, id);
      if (c.produces[id]) c.stock[id] = t * 1.4;
      else if (dailyDemand(c, id, false) > 0) c.stock[id] = t * 0.35;
      else c.stock[id] = 0;
    }
    Object.assign(c.stock, sc.cities.find((x) => x.id === c.id).stock || {});
  }

  // 家訓（前のシナリオから受け継いだ特典）
  const mods = world.player.mods;
  world.player.silver = Math.round(world.player.silver * (mods.startSilver ?? 1) + (mods.startBonus || 0));

  for (const md of sc.start.merchants) addMerchant(world, md);
  for (const rd of sc.rivals || []) {
    world.rivals.push({
      name: rd.name, silver: rd.silver, skill: rd.skill, goods: rd.goods, sold: {}, workshop: rd.workshop || null, store: {},
      merchants: rd.merchants.map((rm) => ({ city: rm.city, transport: rm.transport, cargo: {}, travelDays: 0, wait: rm.wait ?? 2, home: !!rm.home })),
    });
  }

  // 町の状態をなじませる（プレイヤーのいない20日間）
  for (let i = 0; i < 20; i++) {
    applyModifiers(world);
    for (const c of Object.values(world.cities)) updateCity(world, c);
  }
  // 準備期間の出来事は数えない
  for (const c of Object.values(world.cities)) { c.rush = 0; c.crash = 0; c.rushCount = 0; c.peakPop = c.pop; }
  world.stats.rushes = 0;
  world.events = [];
  world.log = [];
  for (const m of world.player.merchants) observe(world, m.city);
  for (const id of sc.knownAtStart || []) observe(world, id);
  emit(world, { type: 'start', text: sc.intro });
  return world;
}

// 区画の地形を世界のマス目から引く（町のマスを中心に N×N）
const TERRAIN_CODE = ['.', 'f', 's', 'h', 'm', 'w'];
export function districtLand(world, c) {
  const grid = world.grid;
  const [ox, oy] = grid.cityTiles[c.id];
  const landAt = (dx, dy) => {
    const x = ox + dx;
    const y = oy + dy;
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return 'w';
    const k = gridKey(x, y);
    if (grid.cityAt.has(k)) return 'r';
    if (grid.path[k]) return 'r';
    return TERRAIN_CODE[grid.terrain[k]];
  };
  return { landAt, origin: [ox, oy] };
}

export function addMerchant(world, { name, portrait, city, transport = 'donkey' }) {
  const m = {
    capMult: world.player.mods?.cap ?? 1,
    cartCap: world.player.mods?.cartCap ?? 1,
    id: world.player.merchants.length + 1, name, portrait: portrait || 'merchant-1', city, transport,
    cargo: {}, cost: {}, guards: 0, travel: null, order: null, lifetime: 0, expected: null,
  };
  world.player.merchants.push(m);
  return m;
}

// 背景の交易: 価格差の大きい隣町へ、少しずつ品物が流れる
function diffuse(world) {
  const rate = (world.scenario.diffusion ?? 1) * B.diffusionRate;
  for (const e of world.edges) {
    const a = world.cities[e.a];
    const b = world.cities[e.b];
    for (const id of world.scenario.goods) {
      const pa = midPrice(a, id);
      const pb = midPrice(b, id);
      let from = null, to = null;
      if (pb > pa * B.diffusionThreshold) { from = a; to = b; }
      else if (pa > pb * B.diffusionThreshold) { from = b; to = a; }
      if (!from) continue;
      // 流れるのは、送り出す町の余剰分だけ
      const surplus = (from.stock[id] || 0) - targetStock(from, id);
      if (surplus < 2 || dailyDemand(to, id, false) <= 0) continue;
      const q = surplus * rate;
      from.stock[id] -= q;
      to.stock[id] = (to.stock[id] || 0) + q;
    }
  }
}

// 毎日かかる出費（給金・輸送手段の維持費・自分の施設の維持費。護衛代は移動中だけ）
export function dailyCost(world, { guards = false } = {}) {
  const pl = world.player;
  let cost = 0;
  for (const m of pl.merchants) cost += B.merchantWage + TRANSPORTS[m.transport].upkeep;
  // 表示用: 工房の維持費（稼働中のもの）と、移動中の護衛代（定期便は次も同じ人数を雇う）
  if (guards) for (const b of pl.buildings) if (b.active) cost += BUILDINGS[b.type]?.upkeep || 0;
  if (guards) for (const m of pl.merchants) cost += (m.travel ? m.guards : m.order?.guards || 0) * B.guardWage;
  // 自分が置いた生産施設の維持費
  for (const c of Object.values(world.cities)) for (const b of c.district?.buildings || []) if (b.placed && PRODUCERS[b.type]) cost += B.producerUpkeep;
  cost += (pl.branches?.length || 0) * B.branchUpkeep;
  return cost * (pl.mods?.upkeep ?? 1) + (pl.mods?.dailyFee || 0);
}

function upkeep(world) {
  const pl = world.player;
  const cost = dailyCost(world);
  pl.silver -= cost;
  const noCargo = pl.merchants.every((m) => !Object.keys(m.cargo).length);
  if (pl.silver < 0 && noCargo && !pl.aidUsed) {
    pl.aidUsed = true;
    pl.silver += 200;
    pl.rep = Math.max(0, pl.rep - 30);
    emit(world, { type: 'aid', big: true, text: '一族の長老から援助が届いた（+200 銀、評判 -30）。援助は一度きり' });
  }
  if (pl.silver < 0 && !pl.debtWarned) {
    pl.debtWarned = true;
    emit(world, { type: 'debt', bad: true, text: '銀が底をついた！借金の状態では仕入れができない' });
  } else if (pl.silver >= 0) pl.debtWarned = false;
}

function scriptedUnlocks(world) {
  for (const u of world.scenario.unlocks || []) {
    if (u.day !== world.day) continue;
    for (const t of u.transports || []) if (!world.allowedTransports.includes(t)) world.allowedTransports.push(t);
    if (u.infoNetwork) world.scenario = { ...world.scenario, infoNetwork: u.infoNetwork };
    emit(world, { type: 'unlock', big: true, text: u.text });
  }
}

export function tick(world) {
  if (world.finished && !world.continueAfterEnd) return;
  world.day += 1;
  applyModifiers(world);
  scriptedUnlocks(world);
  rivalTechs(world);
  updateEvents(world);
  for (const c of Object.values(world.cities)) updateCity(world, c);
  diffuse(world);
  updateProduction(world);
  world.passing = [];
  for (const m of world.player.merchants) stepTravel(world, m);
  // 定期便で荷を待っている商人は、毎日もう一度積む・買うを試す
  for (const m of world.player.merchants) if (!m.travel && m.order?.holding && !m.order.paused) runOrder(world, m);
  for (const id of world.passing) observe(world, id);
  updateRivals(world);
  observePresent(world);
  upkeep(world);
  if (world.day % 5 === 0) {
    world.stats.history.push([world.day, Math.round(world.player.silver)]);
    if (world.stats.history.length > 400) world.stats.history.shift();
  }
  checkGoals(world);
}

export function drainEvents(world) {
  const ev = world.events;
  world.events = [];
  return ev;
}

export function dateString(day) {
  const y = Math.floor(day / 360) + 1;
  const m = Math.floor((day % 360) / 30) + 1;
  const d = (day % 30) + 1;
  return `${y}年目 ${m}月${d}日`;
}

export { GOODS };
