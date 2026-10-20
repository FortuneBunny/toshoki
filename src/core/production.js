// 工房: 倉庫の材料を加工する。足りない材料は、許可されていれば町の市場から買う。
import { BUILDINGS } from '../data/buildings.js';
import { GOODS } from '../data/goods.js';
import { quote } from './market.js';
import { cityTier } from './city.js';
import { emit } from './events.js';

export function buildingInputs(type) {
  const ids = new Set();
  for (const r of BUILDINGS[type].recipes || []) for (const id of Object.keys(r.in)) ids.add(id);
  return [...ids];
}

function tryBatch(world, b, recipe, wh, city) {
  const missing = {};
  for (const [id, n] of Object.entries(recipe.in)) {
    const lack = n - Math.floor(wh.stock[id] || 0);
    if (lack > 0) missing[id] = lack;
  }
  // 足りない材料を市場から買う（基準価格の1.5倍まで）
  if (Object.keys(missing).length) {
    if (!b.autoBuy) return false;
    let total = 0;
    for (const [id, n] of Object.entries(missing)) {
      if ((city.stock[id] || 0) < n) return false;
      const cost = quote(world, city, id, n);
      if (cost / n > GOODS[id].base * 1.5) return false;
      total += cost;
    }
    if (world.player.silver < total) return false;
    for (const [id, n] of Object.entries(missing)) {
      const cost = quote(world, city, id, n);
      city.stock[id] -= n;
      world.player.silver -= cost;
      world.stats.spent += cost;
      wh.basis[id] = ((wh.basis[id] || 0) * (wh.stock[id] || 0) + cost) / ((wh.stock[id] || 0) + n);
      wh.stock[id] = (wh.stock[id] || 0) + n;
    }
  }
  let inCost = 0;
  for (const [id, n] of Object.entries(recipe.in)) {
    inCost += (wh.basis[id] || 0) * n;
    wh.stock[id] -= n;
  }
  const outCount = Object.values(recipe.out).reduce((s, n) => s + n, 0);
  for (const [id, n] of Object.entries(recipe.out)) {
    const cur = wh.stock[id] || 0;
    wh.basis[id] = ((wh.basis[id] || 0) * cur + (inCost / outCount) * n) / (cur + n);
    wh.stock[id] = cur + n;
    world.stats.produced[id] = (world.stats.produced[id] || 0) + n;
  }
  return true;
}

export function updateProduction(world) {
  for (const b of world.player.buildings) {
    const def = BUILDINGS[b.type];
    const city = world.cities[b.city];
    const wh = world.player.warehouses[b.city];
    world.player.silver -= def.upkeep;
    if (!b.active) continue;
    let made = 0;
    for (let i = 0; i < def.batches; i++) {
      const recipes = def.recipes.filter((r) => (r.minTier ?? 0) <= cityTier(city) && (!b.recipe || b.recipe === r.name));
      let ok = false;
      for (const r of recipes) if (tryBatch(world, b, r, wh, city)) { ok = true; made++; break; }
      if (!ok) break;
    }
    if (made === 0 && !b.idleWarned) {
      b.idleWarned = true;
      emit(world, { type: 'idle', city: b.city, text: `${city.name}の${def.name}は材料がなく止まっている（材料: ${buildingInputs(b.type).map((id) => GOODS[id].name).join('、')}）` });
    } else if (made > 0) b.idleWarned = false;
  }
}
