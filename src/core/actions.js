import { hashSeed } from './rng.js';
import { TALENTS, TALENT_IDS } from '../data/talents.js';
// プレイヤーの操作。ブラウザの UI と CLI は必ずここを通す。
// どの関数も { ok: true, ... } か { ok: false, error } を返す。
import { GOODS } from '../data/goods.js';
import { quote, cityWants } from './market.js';
import { TRANSPORTS, ROUTE_KINDS } from '../data/transports.js';
import { BUILDINGS } from '../data/buildings.js';
import { BALANCE as B } from '../data/balance.js';
import { tick, addMerchant, drainEvents } from './world.js';
import { cityTier } from './city.js';
import { executeTrade, previewTrade, moveWarehouse } from './trade.js';
import { departWithExpectation, validateOrder, runOrder } from './orders.js';
import { cargoUsed, findPath, canDepart } from './caravan.js';
import { gridKey, P } from './grid.js';
import { buildingInputs } from './production.js';
import { placeCheck, placeableTiles, addBuilding, cityRadius, coordName, civicWants, civicsIn } from './district.js';
import { PRODUCERS, CIVICS } from '../data/district.js';
import { emit } from './events.js';
import { checkGoals } from './scoring.js';
import { gainRep as gainRepFromAction } from './trade.js';
import { postGrade, gradeName } from './posts.js';
import { buildingUsable, producerUsable, neededTech } from './techs.js';

const fail = (error) => ({ ok: false, error });

// その町に自分の手がかりがあるか（商人が滞在している、または定期便がその町を回っている）
export function hasPresence(world, cityId) {
  if (world.cities[cityId]?.founded || world.player.branches?.includes(cityId)) return true;
  return world.player.merchants.some((m) => m.city === cityId || m.order?.stops.some((s) => s.city === cityId));
}

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
  if (lines.some((l) => !Number.isInteger(l.qty))) return fail('数量は整数で指定する');
  const r = executeTrade(world, m, lines);
  if (r.ok) checkGoals(world);
  return r.ok ? r : fail(r.errors.join(' / '));
}

export function travel(world, mid, to, { guards = 0 } = {}) {
  const [m, err] = idle(world, mid);
  if (err) return err;
  if (!world.cities[to]) return fail(`不明な町: ${to}（町: ${Object.values(world.cities).map((c) => `${c.name}=${c.id}`).join('、')}。日本語の名前でもよい）`);
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
  let r = findPath(world, from, to, m.transport);
  if (!r) return null;
  // 才能: 健脚・船乗りは日数が縮む
  const ship = TRANSPORTS[m.transport].modes.includes('sea');
  if ((m.talent === 'swift' && !ship) || (m.talent === 'sailor' && ship)) r = { ...r, days: Math.max(1, Math.round(r.total / 1.15)) };
  return { ...r, danger: r.edges.reduce((s, e) => Math.max(s, e.danger), 0), desertDays: r.desertDays || 0 };
}

export function canBuyTransportAt(world, city, type) {
  const t = TRANSPORTS[type];
  if (!world.allowedTransports.includes(type)) return false;
  if (t.buyAt.tier !== undefined && cityTier(city) < t.buyAt.tier) return false;
  if (t.buyAt.tags && !t.buyAt.tags.every((tag) => city.tags.includes(tag))) return false;
  return true;
}

// 商人に暇を出す（最後の1人は残す）。輸送手段は半額で下取りし、積荷は今いる町で売り払う
export function dismissMerchant(world, mid) {
  const [m, err] = idle(world, mid);
  if (err) return err;
  if (world.player.merchants.length <= 1) return fail('最後の1人には暇を出せない');
  if (m.settlers) return fail(`${m.name}は開拓団を連れている（交易所に住みつかせてから）`);
  let gain = TRANSPORTS[m.transport].cost * 0.5;
  const city = world.cities[m.city];
  for (const [g, q] of Object.entries(m.cargo)) {
    if (cityWants(city, g)) { gain += quote(world, city, g, -q); city.stock[g] = (city.stock[g] || 0) + q; }
  }
  world.player.silver += gain;
  world.player.merchants = world.player.merchants.filter((x) => x !== m);
  emit(world, { type: 'dismiss', text: `${m.name}に暇を出した（輸送手段の下取りと積荷で +${Math.round(gain)}銀）` });
  return { ok: true, gain: Math.round(gain) };
}

export function buyTransport(world, mid, type) {
  const [m, err] = idle(world, mid);
  if (err) return err;
  const t = TRANSPORTS[type];
  if (!t) return fail(`不明な輸送手段: ${type}`);
  if (m.transport === type) return fail('すでに持っている');
  const city = world.cities[m.city];
  if (!canBuyTransportAt(world, city, type)) return fail(`${city.name}では${t.name}を買えない`);
  if (cargoUsed(m) > Math.floor(t.cap * (m.capMult ?? 1))) return fail('今の積荷が載り切らない');
  // 今いる町から1本も通れる道がないなら買わせない（立ち往生の罠を防ぐ）
  if (!canDepart(world, m.city, type)) {
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

const NAMES = [['ライラ', 'merchant-2'], ['ユースフ', 'merchant-3'], ['ナシル', 'merchant-4'], ['ザフラ', 'merchant-2'], ['オマル', 'merchant-1'], ['ファリダ', 'merchant-2'],
  ['カリム', 'merchant-3'], ['サミーラ', 'merchant-2'], ['ハミド', 'merchant-4'], ['ヌール', 'merchant-2'], ['タリク', 'merchant-1'], ['アミナ', 'merchant-2'], ['ラシード', 'merchant-3'], ['ジャミラ', 'merchant-2']];

// 雇う候補: 3人。才能は種と雇った人数から決まる（選び直しで変わらない）
export function hireCandidates(world) {
  const n = world.player.merchants.length;
  let t = hashSeed(`hire:${world.seed}:${world.scenarioId}:${n}`);
  const rnd = () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  // そのシナリオで意味のある才能だけ
  const ships = world.allowedTransports.some((x) => TRANSPORTS[x].modes.includes('sea'));
  const desert = world.edges.some((e) => e.kind === 'desert') || Object.values(world.cities).some((c) => c.tags.includes('desert'));
  const pool = TALENT_IDS.filter((id) => (id !== 'sailor' || ships) && (id !== 'desert' || desert) && (id !== 'strong' || world.scenario.bandits));
  const out = [];
  const used = new Set(world.player.merchants.map((m) => m.name));
  const names = NAMES.filter(([nm]) => !used.has(nm));
  while (out.length < 3 && pool.length) {
    const talent = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    // 名前を使い切ったら「二世」を付ける（同じ名前が並ばないように）
    let [name, portrait] = names[(out.length + n) % names.length] || NAMES[(out.length + n) % NAMES.length];
    for (let k = 2; used.has(name) || out.some((o) => o.name === name); k++) name = `${name.replace(/[二三四五六七八九]世$/, '')}${'二三四五六七八九'[Math.min(k, 9) - 2]}世`;
    out.push({ name, portrait, talent });
  }
  return out;
}

// 費用（家訓の補正込み）
export function hireCost(world) {
  return Math.round(B.merchantHireCost * world.player.merchants.length * (world.player.mods?.hireCost ?? 1));
}
export function buildCost(world, type) {
  return Math.round(BUILDINGS[type].cost * (world.player.mods?.buildCost ?? 1));
}

// ---------- 区画 ----------
export function districtEnabled(world) {
  return world.scenario.district !== false;
}

// 生産施設の費用: 高い品を作る施設ほど高い（産出の値打ちの18日分が下限。すぐ元が取れないように）
export function producerCost(world, type) {
  const p = PRODUCERS[type];
  return Math.round(Math.max(p.cost, GOODS[p.good].base * p.rate * 18) * (world.player.mods?.buildCost ?? 1));
}

export function placeProducer(world, cityId, type, x, y) {
  const city = world.cities[cityId];
  const p = PRODUCERS[type];
  if (!city || !p) return fail('置けない');
  if (!districtEnabled(world)) return fail('このシナリオでは区画に建物を置けない');
  if (!world.scenario.goods.includes(p.good)) return fail(`${p.name}はこのシナリオでは建てられない（${GOODS[p.good].name}を扱わない）`);
  // 食べ物と甘味は、その町が元から作っている品の増産だけ（町の中で食卓をそろえると、交易で町を育てる意味が消えるため）
  if (['food', 'sweet'].includes(GOODS[p.good].kind) && !(city.district.native || []).includes(p.good)) return fail(`${city.name}の土地では${GOODS[p.good].name}は育たない（食べ物と甘味は、元から作っている品だけ増産できる。ほかの町から運ぼう）`);
  if (!producerUsable(world, type)) return fail(`${p.name}を置くには技術「${neededTech(world, 'producers', type)}」が要る`);
  if (!hasPresence(world, cityId)) return fail('置くには、その町に自分の商人がいるか、定期便がその町を回っている必要がある');
  const why = placeCheck(city, cityTier(city), type, x, y);
  if (why) return fail(why);
  const cost = producerCost(world, type);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  addBuilding(city, { type, x, y, owner: 'town', rate: p.rate, placed: true, readyDay: world.day + B.producerBuildDays });
  world.stats.placed = (world.stats.placed || 0) + 1;
  emit(world, { type: 'place', city: cityId, big: true, text: `${city.name}で${p.name}の建設が始まった（${coordName(x, y)}）。${B.producerBuildDays}日後から${GOODS[p.good].name}が毎日 ${p.rate} 増える。維持費 ${B.producerUpkeep}銀/日` });
  return { ok: true, cost };
}

export function civicCost(world, type) {
  return Math.round(CIVICS[type].cost * (world.player.mods?.buildCost ?? 1));
}

// 需要施設が建てられるか（理由を返す。建てられるなら null）
export function civicCheck(world, cityId, type) {
  const city = world.cities[cityId];
  const c = CIVICS[type];
  if (!city || !c || c.wild) return '建てられない';
  if (!districtEnabled(world)) return 'このシナリオでは区画に建物を置けない';
  if (!civicWants(type, world.scenario.goods).length) return `${c.name}が求める品を、このシナリオでは扱わない`;
  if (cityTier(city) < c.minTier) return `${c.name}は「${['集落', '村', '町', '都市', '大都市'][c.minTier]}」以上の町に建てられる`;
  if (civicsIn(city).some((b) => b.type === type)) return 'すでにある';
  // 交易所の格: 需要施設は「市場」から、宮殿は「大市場」から
  const need = type === 'palace' ? 2 : 1;
  if (postGrade(city) < need) return `${c.name}は「${gradeName(need)}」に格上げした交易所に建てられる`;
  return null;
}

export function buildCivic(world, cityId, type, at = null) {
  const why = civicCheck(world, cityId, type);
  if (why) return fail(why);
  const city = world.cities[cityId];
  if (!hasPresence(world, cityId)) return fail('建てるには、その町に自分の商人がいるか、定期便がその町を回っている必要がある');
  let spot = at;
  if (spot) { const w2 = placeCheck(city, cityTier(city), null, spot[0], spot[1]); if (w2) return fail(w2); }
  else spot = placeableTiles(city, cityTier(city), null)[0];
  if (!spot) return fail('市場の圏に空きマスがない');
  const cost = civicCost(world, type);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  addBuilding(city, { type, x: spot[0], y: spot[1], owner: 'town', civic: true, placed: true });
  const c = CIVICS[type];
  emit(world, { type: 'civic', city: cityId, big: true, text: `${city.name}に${c.name}を建てた！${civicWants(type, world.scenario.goods).map((g) => GOODS[g].name).join('・')}が届くと町が育つ（${c.effect}）` });
  return { ok: true, cost };
}

export function demolish(world, cityId, x, y) {
  const city = world.cities[cityId];
  if (!city) return fail('不明な町');
  if (!hasPresence(world, cityId)) return fail('取り壊すには、その町に自分の商人がいるか、定期便がその町を回っている必要がある');
  const d = city.district;
  const b = d.buildings.find((v) => v.x === x && v.y === y && !v.virtual);
  if (!b) return fail('そこに建物はない');
  if (!b.placed) return fail('取り壊せるのは、自分が建てた施設だけ');
  d.buildings = d.buildings.filter((v) => v !== b);
  emit(world, { type: 'demolish', city: cityId, text: `${city.name}の${PRODUCERS[b.type]?.name || b.type}を取り壊した（${coordName(x, y)}）` });
  return { ok: true };
}

export function expandCost(world, cityId) {
  const c = world.cities[cityId];
  // 交易所は、広げる代わりに格上げする（交易所 → 市場 → 大市場）
  if (c.founded && c.grade !== undefined) return c.grade >= 2 ? null : Math.round(B.postUpgradeCost[c.grade + 1] * (world.player.mods?.buildCost ?? 1));
  return Math.round(600 * Math.pow(2, c.district.radiusBonus || 0) * (1 + cityTier(c) * 0.5));
}

export function expandMarket(world, cityId) {
  const city = world.cities[cityId];
  if (!city) return fail('不明な町');
  if (!districtEnabled(world)) return fail('このシナリオでは区画を広げられない');
  if (city.rivalPost) return fail(`${city.rivalPost}の交易所は広げられない`);
  if (!hasPresence(world, cityId)) return fail('広げるには、その町に自分の商人がいるか、定期便がその町を回っている必要がある');
  if (city.founded && city.grade !== undefined) {
    if (city.grade >= 2) return fail('もう大市場になっている（いちばん上の格）');
    const cost = expandCost(world, cityId);
    if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
    world.player.silver -= cost;
    city.grade += 1;
    const what = city.grade === 1 ? '工房と需要施設を建てられるようになった' : '宮殿も建てられるようになった';
    emit(world, { type: 'expand', city: cityId, big: true, text: `${city.name}を「${gradeName(city.grade)}」に格上げした！市場の圏が広がり、${what}` });
    return { ok: true, cost, grade: city.grade };
  }
  if ((city.district.radiusBonus || 0) >= 2) return fail('これ以上は広げられない（町が育つと自然に広がる）');
  if (cityRadius(city, cityTier(city)) >= 6) return fail('区画の端まで届いている');
  const cost = expandCost(world, cityId);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  city.district.radiusBonus = (city.district.radiusBonus || 0) + 1;
  emit(world, { type: 'expand', city: cityId, big: true, text: `${city.name}の市場の圏を広げた！建物を置ける場所が増えた` });
  return { ok: true, cost };
}

// ---------- 商館 ----------
// 商館: 町に一族の支店を置く。雇える商人の上限が1人増え、その町では倉庫が使え、相場がいつでも分かる。
// 2つ目からは倍々に高くなる（終盤の銀を、運ぶ量に換える手段。全員テスト11回目までの「銀が余る」への対策）
export function branchesAllowed(world) {
  return !!world.scenario.branches;
}
export function merchantCap(world) {
  return (world.scenario.maxMerchants ?? 4) + (world.player.branches?.length || 0);
}
export function branchCost(world) {
  return Math.round(B.branchCost * Math.pow(2, world.player.branches?.length || 0) * (world.player.mods?.buildCost ?? 1));
}
// 商館を建てられるか（理由を返す。建てられるなら null）
export function branchCheck(world, cityId) {
  const city = world.cities[cityId];
  if (!city) return '不明な町';
  if (!branchesAllowed(world)) return 'このシナリオでは商館を建てられない';
  if (world.player.branches?.includes(cityId)) return 'すでに商館がある';
  if (cityTier(city) < B.branchMinTier) return `商館は「${B.tierNames[B.branchMinTier]}」以上の町に建てられる`;
  return null;
}
export function buildBranch(world, cityId) {
  const why = branchCheck(world, cityId);
  if (why) return fail(why);
  const city = world.cities[cityId];
  if (!world.player.merchants.some((m) => m.city === cityId || m.order?.stops.some((s) => s.city === cityId))) return fail('建てるには、その町に自分の商人がいるか、定期便がその町を回っている必要がある');
  const cost = branchCost(world);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  world.player.branches = [...(world.player.branches || []), cityId];
  world.player.warehouses[cityId] = world.player.warehouses[cityId] || { stock: {}, basis: {} };
  emit(world, { type: 'branch', city: cityId, big: true, text: `${city.name}に商館を開いた！雇える商人が${merchantCap(world)}人に増えた。この町の倉庫が使え、相場がいつでも分かる（維持費 ${B.branchUpkeep}銀/日）` });
  return { ok: true, cost };
}

export function hireMerchant(world, cityId, pick = 0) {
  const city = world.cities[cityId];
  if (!city) return fail('不明な町');
  if (!hasPresence(world, cityId)) return fail('雇うには、その町に自分の商人がいるか、定期便がその町を回っている必要がある');
  const max = merchantCap(world);
  if (world.player.merchants.length >= max) return fail(`今雇える商人は${max}人まで${branchesAllowed(world) ? `（商館を建てると1人ずつ増える。次の商館は ${branchCost(world)}銀）` : ''}`);
  const cost = hireCost(world);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  const cand = hireCandidates(world)[Number(pick) || 0] || hireCandidates(world)[0];
  const { name, portrait, talent } = cand;
  const m = addMerchant(world, { name, portrait, city: cityId });
  m.talent = talent;
  emit(world, { type: 'hire', merchant: m.id, big: true, text: `${name}（${TALENTS[talent].name}）が一族の商人に加わった！` });
  return { ok: true, merchant: m.id, cost };
}

export function build(world, cityId, type, at = null) {
  const city = world.cities[cityId];
  const def = BUILDINGS[type];
  if (!city || !def?.recipes) return fail('建てられない');
  if (!(world.scenario.buildings || []).includes(type)) return fail('このシナリオでは建てられない');
  if (!buildingUsable(world, type)) return fail(`${def.name}を建てるには技術「${neededTech(world, 'buildings', type)}」が要る`);
  if (!hasPresence(world, cityId)) return fail('建てるには、その町に自分の商人がいるか、定期便がその町を回っている必要がある');
  if (world.player.buildings.some((b) => b.city === cityId && b.type === type)) return fail('すでにある');
  if (postGrade(city) < 1) return fail(`工房は「${gradeName(1)}」に格上げした交易所に建てられる`);
  // 区画に置く場所（指定がなければ、市場に近い空きマス）。費用を払う前に確かめる
  let spot = at;
  if (spot) { const why = placeCheck(city, cityTier(city), null, spot[0], spot[1]); if (why) return fail(why); }
  if (!spot) spot = placeableTiles(city, cityTier(city), null)[0] || null;
  const cost = buildCost(world, type);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  const b = { id: world.player.buildings.length + 1, type, city: cityId, active: true, autoBuy: true, recipe: null, inputs: buildingInputs(type), made: {}, lastMade: 0 };
  if (spot) { b.x = spot[0]; b.y = spot[1]; addBuilding(city, { type, x: spot[0], y: spot[1], owner: 'player', ref: b.id }); }
  world.player.buildings.push(b);
  city.buildings = world.player.buildings.filter((x) => x.city === cityId);
  world.player.warehouses[cityId] = world.player.warehouses[cityId] || { stock: {}, basis: {} };
  emit(world, { type: 'build', city: cityId, big: true, text: `${city.name}に${def.name}を建てた！倉庫も使えるようになった` });
  return { ok: true, building: b.id };
}

// 寄進: 町に井戸と市場を寄付し、しばらくの間、成長を後押しする（食べ物が足りている町にだけ効く）
export function donateCost(world, cityId) {
  return Math.round(world.cities[cityId].pop * B.donateCostPerPop * (world.player.mods?.donateCost ?? 1));
}
export function donate(world, cityId) {
  const city = world.cities[cityId];
  if (!city) return fail('不明な町');
  if (!hasPresence(world, cityId)) return fail('寄進するには、その町に自分の商人がいるか、定期便がその町を回っている必要がある');
  if (city.donatedUntil > world.day) return fail(`${city.name}への寄進はまだ効いている（あと${city.donatedUntil - world.day}日）`);
  const cost = donateCost(world, cityId);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  city.donatedUntil = world.day + B.donateDays;
  gainRepFromAction(world, 40);
  emit(world, { type: 'donate', city: cityId, big: true, text: `${city.name}に井戸と市場を寄進した！${B.donateDays}日間、成長が${Math.round((B.donateGrowth - 1) * 100)}%早まる（糖度が足りているときだけ）。評判 +40` });
  return { ok: true, cost };
}

export function setBuilding(world, bid, opts) {
  const b = world.player.buildings.find((x) => x.id === Number(bid));
  if (!b) return fail('その工房はない');
  for (const k of ['active', 'autoBuy', 'recipe', 'priceCap']) if (k in opts) b[k] = opts[k];
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
  if (m.settlers) return fail(`${m.name}は開拓団を連れている（交易所に住みつかせてから）`);
  // 続く停泊地が同じ町（最後と最初が同じも）なら1つにまとめる。同じ町が続くと便が先へ進まないため
  const merged = [];
  for (const s of order.stops) {
    const prev = merged[merged.length - 1];
    if (prev && prev.city === s.city) { for (const k of ['sell', 'buy', 'unload', 'load']) prev[k] = [...(prev[k] || []), ...(s[k] || [])]; if (s.waitFor) prev.waitFor = s.waitFor; continue; }
    merged.push({ ...s });
  }
  if (merged.length > 1 && merged[0].city === merged[merged.length - 1].city) {
    const last = merged.pop();
    for (const k of ['sell', 'buy', 'unload', 'load']) merged[0][k] = [...(last[k] || []), ...(merged[0][k] || [])];
  }
  const mergedNote = merged.length < order.stops.length;
  order = { ...order, stops: merged };
  const problem = validateOrder(world, order);
  if (problem) return fail(problem);
  for (const s of order.stops) {
    const r = findPath(world, order.stops[0].city, s.city, m.transport);
    if (!r) return fail(`${world.cities[s.city].name}へは今の輸送手段で行けない`);
  }
  m.order = { stops: order.stops, next: 0, paused: false, since: world.day, profit: 0, runs: 0, guards: Math.max(0, Math.min(12, Math.floor(order.guards || 0))), reserve: Math.max(0, Math.floor(order.reserve ?? 50)) };
  emit(world, { type: 'order', merchant: m.id, big: true, text: `${m.name}の定期便を設定した。あとは自動で回る${mergedNote ? '（同じ町が続く停泊地は1つにまとめた。最後に出発地を書かなくても、最初の町へ戻って繰り返す）' : ''}` });
  // 始める停泊地: 今いる町（移動中なら行き先）が停泊地ならそこ。違えば、積荷を売る停泊地、なければ一番近い停泊地
  const here = m.travel ? m.travel.to : m.city;
  let idx = order.stops.findIndex((s) => s.city === here);
  if (idx < 0) idx = order.stops.findIndex((s) => (s.sell || []).some((x) => m.cargo[x.good] > 0));
  if (idx < 0) {
    let best = Infinity;
    order.stops.forEach((s, i) => { const r = findPath(world, here, s.city, m.transport); if (r && r.days < best) { best = r.days; idx = i; } });
  }
  m.order.next = Math.max(0, idx);
  if (order.hold) { m.order.paused = true; return { ok: true }; }
  if (!m.travel) runOrder(world, m);
  return { ok: true };
}

export function resumeOrder(world, mid) {
  const m = getMerchant(world, mid);
  if (!m?.order) return fail('定期便がない');
  if (m.settlers) return fail(`${m.name}は開拓団を連れている（交易所に住みつかせてから）`);
  m.order.paused = false;
  m.order.pauseNext = false; // 止める予約も消す
  if (!m.travel) runOrder(world, m);
  return { ok: true };
}

export function pauseOrderAtNext(world, mid, cityId = null) {
  const m = getMerchant(world, mid);
  if (!m?.order) return fail('定期便がない');
  if (cityId && !m.order.stops.some((s) => s.city === cityId)) return fail('その町は定期便の停泊地にない');
  if (!m.travel && (!cityId || m.city === cityId)) { m.order.paused = true; return { ok: true, now: true }; }
  m.order.pauseNext = cityId || true;
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
  for (const [x, y] of world.grid.edgeTiles[e.id] || []) {
    const k = gridKey(x, y);
    if (world.grid.path[k] < P.ROAD) { world.grid.path[k] = P.ROAD; world.gridMods.push({ x, y, path: P.ROAD }); }
  }
  world.grid.version++;
  emit(world, { type: 'road', big: true, text: `${world.cities[e.a].name}〜${world.cities[e.b].name}の小道を街道に整備した！荷車が通れる` });
  return { ok: true, cost };
}

// 日を進める。重要な出来事が起きたら途中で止まる（CLI と自動進行の停止用）
// 銀が底をついたこと（debt）では止めない（status と記録で分かる。止まりすぎて操作が増えるため）
const STOP_TYPES = new Set(['arrive', 'victory', 'defeat', 'robbed', 'starve', 'orderStuck', 'settled', 'settlersLost']);
export function advance(world, days, { stopOn = STOP_TYPES } = {}) {
  const collected = [];
  for (let i = 0; i < days; i++) {
    if (world.finished && !world.continueAfterEnd) break;
    tick(world);
    const ev = drainEvents(world);
    collected.push(...ev);
    // 定期便の商人が襲われたり、砂漠で飢えたりしても止めない（任せている便。損失は帳簿と記録に残る）
    if (ev.some((e) => stopOn.has(e.type) && !(['robbed', 'starve'].includes(e.type) && getMerchant(world, e.merchant)?.order && !getMerchant(world, e.merchant).order.paused))) break;
    // 銀が底をついたら止める。ただし30日に1回まで（行ったり来たりで何度も止まらないように）
    if (ev.some((e) => e.type === 'debt') && stopOn === STOP_TYPES && world.day - (world.lastDebtStop ?? -99) >= 30) { world.lastDebtStop = world.day; break; }
  }
  return { ok: true, events: collected, day: world.day };
}

export function continueAfterEnd(world) {
  world.continueAfterEnd = true;
  return { ok: true };
}
