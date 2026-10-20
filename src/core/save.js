// セーブとロード（JSON）。シナリオの定義は保存せず、ID から引き直す。
import { SCENARIOS } from '../data/scenarios.js';
import { SAVE_VERSION, resolveScenario } from './world.js';

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

export function deserialize(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data.version !== SAVE_VERSION) throw new Error(`セーブデータの版が違う（${data.version}）`);
  const sc = resolveScenario(data.scenarioId, data.seed);
  if (!sc) throw new Error(`不明なシナリオ: ${data.scenarioId}`);
  const overrides = data.scenarioOverrides;
  delete data.scenarioOverrides;
  Object.defineProperty(data, 'scenario', { value: overrides ? { ...sc, ...overrides } : sc, enumerable: false, writable: true });
  Object.defineProperty(data, 'hopDistance', { value: hopTable(data), enumerable: false, writable: true });
  return data;
}
