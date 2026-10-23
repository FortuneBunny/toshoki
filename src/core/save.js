// セーブとロード（JSON）。シナリオの定義は保存せず、ID から引き直す。
import { planShifts } from './shifts.js';
import { SCENARIOS } from '../data/scenarios.js';
import { SAVE_VERSION, resolveScenario, savedAsV3 } from './world.js';
import { generateDistrict, districtProduction, updateHousing } from './district.js';
import { buildGrid } from './grid.js';
import { linkPostHops } from './posts.js';
import { BALANCE } from '../data/balance.js';
const tierOf = (pop) => BALANCE.tierPops.reduce((t, p, i) => (pop >= p ? i : t), 0);

export function serialize(world) {
  const base = resolveScenario(world.scenarioId, world.seed, { v3: savedAsV3(world) });
  // 売り場の交代は、予告ずみの分だけを書く（先の予定がセーブに平文で入っていた。20回目の Opus）。続きはロードのときに同じ乱数で作り直す
  const shifts = world.shifts ? world.shifts.filter((x) => x.announce <= world.day) : undefined;
  return JSON.stringify({ ...world, shifts, scenarioOverrides: world.scenario.infoNetwork !== base.infoNetwork ? { infoNetwork: world.scenario.infoNetwork } : null });
}

function hopTable(world) {
  const table = {};
  // 交易所（あとから開いた町）は、開いた順に linkPostHops でつなぐ
  for (const s of Object.keys(world.cities).filter((id) => world.cities[id].grade === undefined)) {
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
  const sc = resolveScenario(data.scenarioId, data.seed, { v3: savedAsV3(data) });
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
  const sc = resolveScenario(data.scenarioId, data.seed, { v3: savedAsV3(data) });
  if (!sc) throw new Error(`不明なシナリオ: ${data.scenarioId}`);
  // 版4で町のない始まり方に作り替えたシナリオ（s1）の、前の版のセーブ
  if (sc.pioneer && !data.hamlets) throw new Error(`このセーブは前の版の「${sc.title}」のもので、町のない土地から始める新しい版では続きを遊べない。最初から始め直してほしい（達成の記録と家訓は残っている）`);
  const overrides = data.scenarioOverrides;
  delete data.scenarioOverrides;
  Object.defineProperty(data, 'scenario', { value: overrides ? { ...sc, ...overrides } : sc, enumerable: false, writable: true });
  Object.defineProperty(data, 'hopDistance', { value: hopTable(data), enumerable: false, writable: true });
  data.gridMods = data.gridMods || [];
  data.storms = data.storms || [];
  Object.defineProperty(data, 'grid', { value: buildGrid(data), enumerable: false, writable: true });
  Object.defineProperty(data, 'routeCache', { value: new Map(), enumerable: false, writable: true });
  for (const c of Object.values(data.cities)) if (c.grade !== undefined || c.founded) linkPostHops(data, c.id);
  if (data.shifts) {
    const saved = data.shifts;
    planShifts(data);
    data.shifts = (data.shifts || []).map((x) => saved.find((y) => y.id === x.id) || x);
  }
  // 古い版で暇を出したあとに雇うと、同じ番号の商人が2人いることがある。後の方に新しい番号を付ける
  const seen = new Set();
  for (const m of data.player.merchants) {
    if (seen.has(m.id)) m.id = Math.max(...data.player.merchants.map((x) => x.id)) + 1;
    seen.add(m.id);
  }
  return data;
}
