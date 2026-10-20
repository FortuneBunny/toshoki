// 商人の移動: 経路探索、移動日数、砂漠での食料、盗賊
import { GOODS, PROVISIONS } from '../data/goods.js';
import { TRANSPORTS, DESERT_SLOW } from '../data/transports.js';
import { BALANCE as B } from '../data/balance.js';
import { chance, randInt } from './rng.js';
import { emit } from './events.js';
import { arriveAt } from './orders.js';

export function seasonOf(world) {
  const d = world.day % 360;
  return d < 180 ? 0 : 1;
}
export const SEASON_NAMES = ['夏の季節風（東へ）', '冬の季節風（西へ）'];

export function canUse(edge, transportId) {
  return TRANSPORTS[transportId].modes.includes(edge.kind);
}

// edge を from から渡るのにかかる日数
export function edgeDays(world, edge, transportId, from, merchant) {
  const t = TRANSPORTS[transportId];
  let speed = t.speed * (1 + (world.player.heirloomSpeed || 0));
  if (edge.kind === 'desert') speed *= DESERT_SLOW[transportId] ?? 1;
  let days = edge.len / speed;
  if (edge.kind === 'desert' && edge.stormUntil > world.day) days *= 1.8;
  if (edge.monsoon) {
    const forward = from === edge.a;
    const favorable = seasonOf(world) === 0 ? forward : !forward;
    days *= favorable ? 0.7 : 1.7;
  }
  return Math.max(1, Math.round(days));
}

export function neighbors(world, cityId) {
  return world.edges.filter((e) => e.a === cityId || e.b === cityId);
}

// 日数が最短の経路（Dijkstra）。通れない場合は null
export function findPath(world, from, to, transportId) {
  if (from === to) return { path: [from], edges: [], days: 0 };
  const dist = { [from]: 0 };
  const prev = {};
  const done = new Set();
  while (true) {
    let cur = null;
    for (const [k, v] of Object.entries(dist)) if (!done.has(k) && (cur === null || v < dist[cur])) cur = k;
    if (cur === null) return null;
    if (cur === to) break;
    done.add(cur);
    for (const e of neighbors(world, cur)) {
      if (!canUse(e, transportId)) continue;
      const next = e.a === cur ? e.b : e.a;
      const nd = dist[cur] + edgeDays(world, e, transportId, cur);
      if (dist[next] === undefined || nd < dist[next]) {
        dist[next] = nd;
        prev[next] = { city: cur, edge: e };
      }
    }
  }
  const path = [to];
  const edges = [];
  let c = to;
  while (c !== from) {
    edges.unshift(prev[c].edge);
    c = prev[c].city;
    path.unshift(c);
  }
  return { path, edges, days: dist[to] };
}

export function cargoUsed(m) {
  let used = 0;
  for (const [id, q] of Object.entries(m.cargo)) used += q * GOODS[id].weight;
  return used;
}
export function cargoCap(m) {
  return TRANSPORTS[m.transport].cap;
}

export function startTravel(world, m, to) {
  const route = findPath(world, m.city, to, m.transport);
  if (!route) return { ok: false, error: `${TRANSPORTS[m.transport].name}では${world.cities[to].name}へ行けない` };
  m.travel = { path: route.path, leg: 0, daysLeft: 0, legDays: 0, to, from: m.city, totalDays: route.days, elapsed: 0 };
  beginLeg(world, m);
  m.city = null;
  return { ok: true, days: route.days };
}

function beginLeg(world, m) {
  const t = m.travel;
  const a = t.path[t.leg];
  const b = t.path[t.leg + 1];
  const edge = world.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  t.edge = edge.id;
  t.legDays = edgeDays(world, edge, m.transport, a, m);
  t.daysLeft = t.legDays;
}

function eatProvisions(world, m, edge) {
  if (edge.kind !== 'desert') return;
  const need = Math.max(1, Math.ceil(cargoCap(m) / 20)) * B.provisionPerDay;
  let left = need;
  for (const id of PROVISIONS) {
    const have = m.cargo[id] || 0;
    const eat = Math.min(have, left);
    if (eat > 0) {
      m.cargo[id] = have - eat;
      if (!m.cargo[id]) delete m.cargo[id];
      left -= eat;
    }
    if (!left) break;
  }
  if (left > 0) {
    // 食料が尽きた: 進みが遅れ、積荷の一部を失う
    m.travel.daysLeft += 1 / B.starveSlow;
    let lost = 0;
    for (const id of Object.keys(m.cargo)) {
      const q = Math.floor(m.cargo[id] * B.starveLoss);
      m.cargo[id] -= q;
      lost += q;
      if (!m.cargo[id]) delete m.cargo[id];
    }
    if (!m.starveWarned) {
      emit(world, { type: 'starve', merchant: m.id, bad: true, text: `${m.name}の隊商は砂漠で食料が尽きた！進みが遅れ、積荷を失っている（食料は なつめやし・干しぶどう・キビ・麦・米）` });
      m.starveWarned = true;
    }
    world.stats.starvedLoss = (world.stats.starvedLoss || 0) + lost;
  }
}

function banditCheck(world, m, edge) {
  if (!edge.danger || !world.scenario.bandits) return;
  const p = B.banditBase * edge.danger * (1 - (world.player.heirloomSafety || 0));
  if (!chance(world, p)) return;
  const power = randInt(world, B.banditPower[0], Math.round(B.banditPower[1] * Math.min(1.5, edge.danger)));
  const guard = m.guards * B.guardPower;
  if (guard >= power) {
    world.player.rep += 10;
    world.stats.banditsRepelled = (world.stats.banditsRepelled || 0) + 1;
    emit(world, { type: 'repelled', merchant: m.id, big: true, text: `${m.name}の護衛が盗賊（強さ${power}）を撃退した！評判 +10` });
    return;
  }
  let lost = 0;
  let lostValue = 0;
  for (const id of Object.keys(m.cargo)) {
    const q = Math.ceil(m.cargo[id] * B.banditLoss);
    m.cargo[id] -= q;
    lost += q;
    lostValue += q * GOODS[id].base;
    if (!m.cargo[id]) delete m.cargo[id];
  }
  world.stats.banditLoss = (world.stats.banditLoss || 0) + lostValue;
  emit(world, { type: 'robbed', merchant: m.id, bad: true, text: `${m.name}が盗賊（強さ${power}、護衛${m.guards}人）に襲われ、積荷${lost}個（約${Math.round(lostValue)}銀分）を奪われた` });
}

export function stepTravel(world, m) {
  const t = m.travel;
  if (!t) return;
  const edge = world.edges.find((e) => e.id === t.edge);
  eatProvisions(world, m, edge);
  banditCheck(world, m, edge);
  world.player.silver -= m.guards * B.guardWage;
  t.daysLeft -= 1;
  t.elapsed += 1;
  if (t.daysLeft > 0.001) return;
  t.leg += 1;
  const reached = t.path[t.leg];
  if (t.leg < t.path.length - 1) {
    // 通過する町の相場も見える
    world.passing = world.passing || [];
    world.passing.push(reached);
    beginLeg(world, m);
    return;
  }
  m.city = reached;
  m.travel = null;
  m.starveWarned = false;
  m.guards = 0;
  arriveAt(world, m);
}
