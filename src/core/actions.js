// プレイヤーの操作。ブラウザの UI と CLI は必ずここを通す。
// どの関数も { ok: true, ... } か { ok: false, error } を返す。
import { GOODS } from '../data/goods.js';
import { TRANSPORTS, ROUTE_KINDS } from '../data/transports.js';
import { BUILDINGS } from '../data/buildings.js';
import { BALANCE as B } from '../data/balance.js';
import { tick, addMerchant, drainEvents } from './world.js';
import { cityTier } from './city.js';
import { executeTrade, previewTrade, moveWarehouse } from './trade.js';
import { departWithExpectation, validateOrder, runOrder } from './orders.js';
import { cargoUsed, findPath } from './caravan.js';
import { buildingInputs } from './production.js';
import { emit } from './events.js';
import { checkGoals } from './scoring.js';

const fail = (error) => ({ ok: false, error });

export function getMerchant(world, id) {
  return world.player.merchants.find((m) => m.id === Number(id) || m.name === id);
}

function idle(world, id) {
  const m = getMerchant(world, id);
  if (!m) return [null, fail('その商人はいない')];
  if (m.travel) return [null, fail(`${m.name}は移動中`)];
  return [m, null];
}

export function preview(world, mid, lines) {
  const [m, err] = idle(world, mid);
  return err || previewTrade(world, m, lines);
}

export function trade(world, mid, lines) {
  const [m, err] = idle(world, mid);
  if (err) return err;
  const r = executeTrade(world, m, lines);
  if (r.ok) checkGoals(world);
  return r.ok ? r : fail(r.errors.join(' / '));
}

export function travel(world, mid, to, { guards = 0 } = {}) {
  const [m, err] = idle(world, mid);
  if (err) return err;
  if (!world.cities[to]) return fail(`不明な町: ${to}`);
  if (to === m.city) return fail('すでにその町にいる');
  if (guards < 0 || guards > 12) return fail('護衛は0〜12人');
  m.guards = Math.floor(guards);
  const r = departWithExpectation(world, m, to);
  if (!r.ok) { m.guards = 0; return fail(r.error); }
  return { ok: true, days: r.days };
}

export function routeInfo(world, mid, to) {
  const m = getMerchant(world, mid);
  const from = m.travel ? m.travel.to : m.city;
  const r = findPath(world, from, to, m.transport);
  if (!r) return null;
  return { ...r, danger: r.edges.reduce((s, e) => Math.max(s, e.danger), 0), desertDays: r.edges.filter((e) => e.kind === 'desert').length };
}

export function canBuyTransportAt(world, city, type) {
  const t = TRANSPORTS[type];
  if (!world.allowedTransports.includes(type)) return false;
  if (t.buyAt.tier !== undefined && cityTier(city) < t.buyAt.tier) return false;
  if (t.buyAt.tags && !t.buyAt.tags.every((tag) => city.tags.includes(tag))) return false;
  return true;
}

export function buyTransport(world, mid, type) {
  const [m, err] = idle(world, mid);
  if (err) return err;
  const t = TRANSPORTS[type];
  if (!t) return fail(`不明な輸送手段: ${type}`);
  if (m.transport === type) return fail('すでに持っている');
  const city = world.cities[m.city];
  if (!canBuyTransportAt(world, city, type)) return fail(`${city.name}では${t.name}を買えない`);
  if (cargoUsed(m) > t.cap) return fail('今の積荷が載り切らない');
  // 今いる町から1本も通れる道がないなら買わせない（立ち往生の罠を防ぐ）
  if (!world.edges.some((e) => (e.a === m.city || e.b === m.city) && t.modes.includes(e.kind))) {
    return fail(`${city.name}からは${t.name}で通れる道がない（${t.modes.map((x) => ROUTE_KINDS[x].name).join('・')}が必要）`);
  }
  const refund = TRANSPORTS[m.transport].cost * 0.5;
  const price = t.cost - refund;
  if (world.player.silver < price) return fail(`銀が足りない（${Math.ceil(price)}必要）`);
  world.player.silver -= price;
  m.transport = type;
  emit(world, { type: 'transport', merchant: m.id, big: true, text: `${m.name}が${t.name}を手に入れた！積載量 ${t.cap}` });
  return { ok: true, price };
}

const NAMES = [['ライラ', 'merchant-2'], ['ユースフ', 'merchant-3'], ['ナシル', 'merchant-4'], ['ザフラ', 'merchant-2'], ['オマル', 'merchant-1'], ['ファリダ', 'merchant-2']];

export function hireMerchant(world, cityId) {
  const city = world.cities[cityId];
  if (!city) return fail('不明な町');
  if (!world.player.merchants.some((m) => m.city === cityId)) return fail('雇うには、その町に自分の商人がいる必要がある');
  const max = world.scenario.maxMerchants ?? 4;
  if (world.player.merchants.length >= max) return fail(`このシナリオで雇える商人は${max}人まで`);
  const cost = B.merchantHireCost * world.player.merchants.length;
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  const [name, portrait] = NAMES[(world.player.merchants.length - 1) % NAMES.length];
  const m = addMerchant(world, { name, portrait, city: cityId });
  emit(world, { type: 'hire', merchant: m.id, big: true, text: `${name}が一族の商人に加わった！` });
  return { ok: true, merchant: m.id, cost };
}

export function build(world, cityId, type) {
  const city = world.cities[cityId];
  const def = BUILDINGS[type];
  if (!city || !def?.recipes) return fail('建てられない');
  if (!(world.scenario.buildings || []).includes(type)) return fail('このシナリオでは建てられない');
  if (!world.player.merchants.some((m) => m.city === cityId)) return fail('建てるには、その町に自分の商人がいる必要がある');
  if (world.player.buildings.some((b) => b.city === cityId && b.type === type)) return fail('すでにある');
  if (world.player.silver < def.cost) return fail(`銀が足りない（${def.cost}必要）`);
  world.player.silver -= def.cost;
  const b = { id: world.player.buildings.length + 1, type, city: cityId, active: true, autoBuy: true, recipe: null, inputs: buildingInputs(type), made: {}, lastMade: 0 };
  world.player.buildings.push(b);
  city.buildings = world.player.buildings.filter((x) => x.city === cityId);
  world.player.warehouses[cityId] = world.player.warehouses[cityId] || { stock: {}, basis: {} };
  emit(world, { type: 'build', city: cityId, big: true, text: `${city.name}に${def.name}を建てた！倉庫も使えるようになった` });
  return { ok: true, building: b.id };
}

export function setBuilding(world, bid, opts) {
  const b = world.player.buildings.find((x) => x.id === Number(bid));
  if (!b) return fail('その工房はない');
  for (const k of ['active', 'autoBuy', 'recipe']) if (k in opts) b[k] = opts[k];
  return { ok: true };
}

export function warehouse(world, mid, good, qty) {
  const [m, err] = idle(world, mid);
  if (err) return err;
  if (!GOODS[good]) return fail(`不明な品物: ${good}`);
  const r = moveWarehouse(world, m, good, qty);
  return r.ok ? r : fail(r.error);
}

export function setOrder(world, mid, order) {
  const m = getMerchant(world, mid);
  if (!m) return fail('その商人はいない');
  const problem = validateOrder(world, order);
  if (problem) return fail(problem);
  for (const s of order.stops) {
    const r = findPath(world, order.stops[0].city, s.city, m.transport);
    if (!r) return fail(`${world.cities[s.city].name}へは今の輸送手段で行けない`);
  }
  m.order = { stops: order.stops, next: 0, paused: false, since: world.day, profit: 0, runs: 0 };
  emit(world, { type: 'order', merchant: m.id, big: true, text: `${m.name}の定期便を設定した。あとは自動で回る` });
  if (!m.travel) {
    // 今いる町が停泊地ならそこから始め、違えば最初の停泊地へ向かう
    const idx = order.stops.findIndex((s) => s.city === m.city);
    m.order.next = idx >= 0 ? idx : 0;
    runOrder(world, m);
  }
  return { ok: true };
}

export function resumeOrder(world, mid) {
  const m = getMerchant(world, mid);
  if (!m?.order) return fail('定期便がない');
  m.order.paused = false;
  if (!m.travel) runOrder(world, m);
  return { ok: true };
}

export function pauseOrderAtNext(world, mid) {
  const m = getMerchant(world, mid);
  if (!m?.order) return fail('定期便がない');
  if (!m.travel) { m.order.paused = true; return { ok: true, now: true }; }
  m.order.pauseNext = true;
  return { ok: true, now: false };
}

export function clearOrder(world, mid) {
  const m = getMerchant(world, mid);
  if (!m) return fail('その商人はいない');
  m.order = null;
  return { ok: true };
}

export function upgradeRoad(world, edgeId) {
  const e = world.edges.find((x) => x.id === Number(edgeId));
  if (!e) return fail('その道はない');
  if (!(world.scenario.buildings || []).includes('road')) return fail('このシナリオでは道を整備できない');
  if (e.kind !== 'trail') return fail('整備できるのは小道だけ');
  const cost = Math.round(e.len * BUILDINGS.road.costPerLength);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  e.kind = 'road';
  emit(world, { type: 'road', big: true, text: `${world.cities[e.a].name}〜${world.cities[e.b].name}の小道を街道に整備した！荷車が通れる` });
  return { ok: true, cost };
}

// 日を進める。重要な出来事が起きたら途中で止まる（CLI と自動進行の停止用）
const STOP_TYPES = new Set(['arrive', 'victory', 'defeat', 'robbed', 'starve', 'orderStuck', 'debt']);
export function advance(world, days, { stopOn = STOP_TYPES } = {}) {
  const collected = [];
  for (let i = 0; i < days; i++) {
    if (world.finished && !world.continueAfterEnd) break;
    tick(world);
    const ev = drainEvents(world);
    collected.push(...ev);
    if (ev.some((e) => stopOn.has(e.type))) break;
  }
  return { ok: true, events: collected, day: world.day };
}

export function continueAfterEnd(world) {
  world.continueAfterEnd = true;
  return { ok: true };
}
