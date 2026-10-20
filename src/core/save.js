// セーブとロード（JSON）。シナリオの定義は保存せず、ID から引き直す。
import { SCENARIOS } from '../data/scenarios.js';
import { SAVE_VERSION, resolveScenario } from './world.js';
import { generateDistrict, districtProduction, updateHousing } from './district.js';
import { buildGrid } from './grid.js';
import { BALANCE } from '../data/balance.js';
const tierOf = (pop) => BALANCE.tierPops.reduce((t, p, i) => (pop >= p ? i : t), 0);

export function serialize(world) {
  const base = resolveScenario(world.scenarioId, world.seed);
  return JSON.stringify({ ...world, scenarioOverrides: world.scenario.infoNetwork !== base.infoNetwork ? { infoNetwork: world.scenario.infoNetwork } : null });
}

function hopTable(world) {
  const table = {};
  for (const s of Object.keys(world.cities)) {
    const d = { [s]: 0 };
    const q = [s];
    while (q.length) {
      const c = q.shift();
      for (const e of world.edges) {
        const n = e.a === c ? e.b : e.b === c ? e.a : null;
        if (n && d[n] === undefined) { d[n] = d[c] + 1; q.push(n); }
      }
    }
    table[s] = d;
  }
  return table;
}

// 版1 → 版2: 区画がないので、今の生産量から区画を作る
function migrateV1(data) {
  const sc = resolveScenario(data.scenarioId, data.seed);
  for (const c of Object.values(data.cities)) {
    if (!c.district) {
      c.district = generateDistrict(c, { seed: data.seed, scenarioGoods: sc?.goods || [] });
      c.produces = districtProduction(c);
      updateHousing(c, tierOf(c.pop), 999);
    }
  }
  data.version = 2;
}

// 元から作っている品の記録がない区画には、今の生産から補う
function ensureNative(data) {
  for (const c of Object.values(data.cities)) if (c.district && !c.district.native) c.district.native = Object.keys(c.produces || {}).filter((g) => (c.produces[g] || 0) > 0);
}

export function deserialize(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data.version === 1) migrateV1(data);
  if (data.version !== SAVE_VERSION) throw new Error(`セーブデータの版が違う（${data.version}）`);
  ensureNative(data);
  const sc = resolveScenario(data.scenarioId, data.seed);
  if (!sc) throw new Error(`不明なシナリオ: ${data.scenarioId}`);
  const overrides = data.scenarioOverrides;
  delete data.scenarioOverrides;
  Object.defineProperty(data, 'scenario', { value: overrides ? { ...sc, ...overrides } : sc, enumerable: false, writable: true });
  Object.defineProperty(data, 'hopDistance', { value: hopTable(data), enumerable: false, writable: true });
  data.gridMods = data.gridMods || [];
  data.storms = data.storms || [];
  Object.defineProperty(data, 'grid', { value: buildGrid(data), enumerable: false, writable: true });
  Object.defineProperty(data, 'routeCache', { value: new Map(), enumerable: false, writable: true });
  return data;
}
