// 価格の計算。価格は「在庫 ÷ 目標在庫」で決まり、1個売り買いするごとに動く。
import { GOODS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';
import { cityTier, dailyDemand } from './city.js';

export function targetStock(city, id) {
  const d = dailyDemand(city, id, false);
  if (d <= 0) return B.unwantedTarget;
  return Math.max(B.minTargetStock, d * B.targetStockDays);
}

// 在庫が stock のときの中値（手数料抜き）
export function midPrice(city, id, stock = city.stock[id] || 0) {
  const g = GOODS[id];
  const target = targetStock(city, id);
  const r = Math.max(0, stock) / target;
  let mult = Math.pow(2 / (1 + r), B.priceElasticity);
  mult *= city.priceMods?.[id] ?? 1;
  mult = Math.min(B.priceMax, Math.max(B.priceMin, mult));
  return g.base * mult;
}

// 町がその品を買い取るか（需要がない品は売れない）
export function cityWants(city, id) {
  if (dailyDemand(city, id, false) > 0) return true;
  if (cityTier(city) >= 3) return true;
  if ((city.produces?.[id] || 0) > 0) return true;
  if (city.buildings?.some((b) => b.inputs?.includes(id))) return true;
  return false;
}

export function spreadFor(world) {
  const lv = world.player.repLevel || 0;
  const cut = Math.min(0.8, lv * B.repSpreadCut);
  return B.spread * (1 - cut) * (1 + (world.player.heirloomSpread || 0));
}

// qty > 0 は町から買う、qty < 0 は町へ売る。合計額（買いは支払い、売りは受け取り）を返す。
export function quote(world, city, id, qty) {
  const s = spreadFor(world);
  const stock = city.stock[id] || 0;
  let total = 0;
  if (qty > 0) {
    for (let i = 0; i < qty; i++) total += midPrice(city, id, stock - i - 0.5) * (1 + s);
  } else {
    const bonus = sellBonus(world, city, id);
    for (let i = 0; i < -qty; i++) total += midPrice(city, id, stock + i + 0.5) * (1 - s) * bonus;
  }
  return total;
}

// 1個目の価格（表示用）
export function unitBuy(world, city, id) {
  return quote(world, city, id, 1);
}
export function unitSell(world, city, id) {
  return quote(world, city, id, -1);
}

// 大口注文や祭りなどで売値に掛かる倍率
export function sellBonus(world, city, id) {
  let m = 1;
  if (city.rush > 0 && GOODS[id].kind === 'sweet') m *= 1.15;
  m *= 1 + (world.player.heirloomSell || 0);
  return m;
}
