// 住居の求める品（E6。原作の Dwelling の需要に倣う）
// 町ごとに、地域に合った品を3つまで決める。町が育つほど求める数が増え（村1・町2・都市以上3）、
// 「1つ欠けまで」そろっていないと新しい家が建たない（＝人口の上限が伸びない）。
import { GOODS } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';

// 地域ごとの好み（先にあるものほど選ばれやすい）
const REGION_PREFS = {
  desert: ['salt', 'silk', 'tea', 'pottery', 'raisins', 'honey', 'molasses', 'rawsugar'],
  port: ['spice', 'tea', 'pottery', 'salt', 'wine', 'rawsugar', 'honey', 'raisins'],
  east: ['tea', 'pottery', 'silk', 'honey', 'rawsugar', 'salt', 'raisins'],
  plain: ['pottery', 'salt', 'wine', 'tools', 'honey', 'raisins', 'rawsugar', 'molasses'],
};
export const DWELLING_RATE = 0.3; // 求める品の需要（人口千人あたり1日）
const SAT_LINE = 0.3; // ならした充足率（その品の需要全体のうち食べられた割合）がこれ以上なら「そろっている」

export function dwellingRegion(world, city) {
  if (city.tags.includes('desert')) return 'desert';
  if (city.tags.includes('port')) return 'port';
  if (world.scenario.goods.some((g) => g === 'tea' || g === 'silk')) return 'east';
  return 'plain';
}

// そのシナリオで手に入る品（どこかの町が作るか、工房で作れる）
function obtainable(world) {
  const set = new Set();
  for (const c of Object.values(world.cities)) for (const [g, r] of Object.entries(c.produces || {})) if (r > 0) set.add(g);
  for (const b of world.scenario.buildings || []) for (const r of BUILDINGS[b]?.recipes || []) for (const g of Object.keys(r.out)) set.add(g);
  return set;
}

// 町の住居が求める品（最大3つ）。町が作っている品は求めない
export function assignDwelling(world, city) {
  const ok = obtainable(world);
  const prefs = REGION_PREFS[dwellingRegion(world, city)];
  const own = city.district?.native || Object.keys(city.produces || {});
  city.dwellWants = prefs.filter((g) => world.scenario.goods.includes(g) && ok.has(g) && GOODS[g] && !own.includes(g)).slice(0, 3);
}

// 今の段階で求める品（村1つ・町2つ・都市以上3つ）
// その段階の町が使う品だけ（香辛料のような高級品は、都市になるまで求めない）
export function dwellingActive(city, tier) {
  return (city.dwellWants || []).filter((g) => GOODS[g].tier <= Math.max(1, tier)).slice(0, Math.min(3, tier));
}

export function dwellingDemand(city, id, tier) {
  return dwellingActive(city, tier).includes(id) ? (DWELLING_RATE * city.pop) / 1000 : 0;
}

// ならした充足率を更新する（consume の後に毎日）
export function updateDwellingSat(city, tier) {
  const prev = city.dwellSat || {};
  city.dwellSat = {};
  for (const g of dwellingActive(city, tier)) city.dwellSat[g] = (prev[g] ?? 0.6) * 0.75 + Math.min(1, city.eatRatio?.[g] ?? 0) * 0.25; // 届けると数日で○になる
}

// 家が建つか: 求める品が「1つ欠けまで」そろっている
export function dwellingStatus(city, tier) {
  const act = dwellingActive(city, tier);
  const met = act.filter((g) => (city.dwellSat?.[g] ?? 0.6) >= SAT_LINE);
  const missing = act.filter((g) => !met.includes(g));
  return { wants: act, met, missing, ok: missing.length <= 1 };
}
