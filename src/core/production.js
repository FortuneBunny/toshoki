// 工房: 倉庫の材料を加工する。足りない材料は、許可されていれば町の市場から買う。
import { BUILDINGS } from '../data/buildings.js';
import { GOODS } from '../data/goods.js';
import { quote } from './market.js';
import { cityTier } from './city.js';
import { emit } from './events.js';
import { BALANCE as B } from '../data/balance.js';

export function buildingInputs(type) {
  const ids = new Set();
  for (const r of BUILDINGS[type].recipes || []) for (const id of Object.keys(r.in)) ids.add(id);
  return [...ids];
}

function tryBatch(world, b, recipe, wh, city) {
  b.why = null;
  const missing = {};
  for (const [id, n] of Object.entries(recipe.in)) {
    const lack = n - Math.floor(wh.stock[id] || 0);
    if (lack > 0) missing[id] = lack;
  }
  // 足りない材料を市場から買う（基準価格の1.5倍まで）
  if (Object.keys(missing).length) {
    const names = Object.keys(missing).map((id) => GOODS[id].name).join('・');
    if (!b.autoBuy) { b.why = `倉庫に${names}がない（自動仕入れは切ってある）`; return false; }
    let total = 0;
    for (const [id, n] of Object.entries(missing)) {
      if ((city.stock[id] || 0) < n) { b.why = `倉庫にも${city.name}の市場にも${GOODS[id].name}が足りない`; return false; }
      const cost = quote(world, city, id, n);
      const cap = b.priceCap ?? 1.5; // 自動仕入れの上限（基準の何倍まで買うか。workshop <番号> maxprice で変えられる）
      if (cost / n > GOODS[id].base * cap) { b.why = `${GOODS[id].name}の相場（${(cost / n).toFixed(1)}）が自動仕入れの上限（基準の${cap}倍 = ${(GOODS[id].base * cap).toFixed(1)}）を超えている。上げるには workshop ${b.id} maxprice <倍率>`; return false; }
      total += cost;
    }
    if (world.player.silver - total < B.autoBuyReserve) { b.why = `手元の銀が少ないので自動仕入れを控えている（${B.autoBuyReserve}銀を残す）`; return false; }
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
    b.made = b.made || {};
    b.made[id] = (b.made[id] || 0) + n;
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
    for (let i = 0; i < def.batches + (world.player.mods?.batchBonus || 0); i++) {
      const recipes = def.recipes.filter((r) => (r.minTier ?? 0) <= cityTier(city) && (!b.recipe || b.recipe === r.name));
      let ok = false;
      // 止まった理由は、上から試したレシピごとに並べる（下のレシピも試したことが分かるように）
      const whys = [];
      for (const r of recipes) { if (tryBatch(world, b, r, wh, city)) { ok = true; made++; break; } if (b.why) whys.push(recipes.length > 1 ? `${r.name}: ${b.why}` : b.why); }
      if (!ok && whys.length) b.why = whys.join('／');
      if (!ok) break;
    }
    b.lastMade = made;
    // 止まった知らせは、理由が変わったときか、30日ぶりのときだけ
    if (made === 0 && world.day - (b.idleDay ?? -99) >= 30) {
      b.idleWarned = b.why || 'none';
      b.idleDay = world.day;
      emit(world, { type: 'idle', city: b.city, text: `${city.name}の${def.name}が止まっている: ${b.why || '材料がない'}（材料: ${buildingInputs(b.type).map((id) => GOODS[id].name).join('、')}。倉庫へ下ろせば動く）` });
    } else if (made > 0 && world.day - (b.idleDay ?? -99) >= 30) b.idleWarned = null;
  }
}
