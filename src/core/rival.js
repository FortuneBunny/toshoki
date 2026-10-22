// ライバル商家（台本付き）。少し古い相場をもとに、一番儲かりそうな品を運ぶ。
// 破産で止まらないよう、資金が尽きると一族から援助が入る。
import { GOODS } from '../data/goods.js';
import { TRANSPORTS } from '../data/transports.js';
import { quote, cityWants, midPrice } from './market.js';
import { findPath } from './caravan.js';
import { emit } from './events.js';
import { BALANCE as B } from '../data/balance.js';
import { foundSites, createPost } from './posts.js';
import { HQ_RANGE } from './pioneer.js';

function bestPlan(world, r, m) {
  const here = world.cities[m.city];
  const cap = TRANSPORTS[m.transport].cap;
  let best = null;
  for (const to of Object.keys(world.cities)) {
    if (to === m.city) continue;
    const route = findPath(world, m.city, to, m.transport);
    if (!route) continue;
    const dest = world.cities[to];
    for (const id of r.goods || world.scenario.goods) {
      const stock = Math.floor(here.stock[id] || 0);
      if (stock < 3 || !cityWants(dest, id)) continue;
      const n = Math.min(stock, Math.floor(cap / GOODS[id].weight), Math.floor(r.silver / Math.max(1, midPrice(here, id) * 1.2)));
      if (n < 3) continue;
      const cost = quote(world, here, id, n);
      const gain = quote(world, dest, id, -n) * (r.skill ?? 0.85);
      const perDay = (gain - cost) / Math.max(1, route.days);
      if (perDay > 0 && (!best || perDay > best.perDay)) best = { to, id, n, perDay, days: route.days };
    }
  }
  return best;
}

// ライバルの工房: 本拠地の市場から原料を買い、製品を蔵に貯める
function rivalWorkshop(world, r) {
  const w = r.workshop;
  if (!w) return;
  const city = world.cities[w.city];
  const have = Math.floor(city.stock[w.input] || 0);
  const n = Math.min(have, w.inputPerDay);
  if (n < w.ratio) return;
  const batches = Math.floor(n / w.ratio);
  const cost = quote(world, city, w.input, batches * w.ratio);
  if (cost > r.silver) return;
  city.stock[w.input] -= batches * w.ratio;
  r.silver -= cost;
  r.store = r.store || {};
  r.store[w.output] = (r.store[w.output] || 0) + batches;
}

export function updateRivals(world) {
  for (const r of world.rivals) {
    rivalWorkshop(world, r);
    if (r.silver < 150) {
      r.silver += 400;
      emit(world, { type: 'rivalAid', text: `${r.name}は一族から援助を受けて持ち直した` });
    }
    for (const m of r.merchants) {
      if (!m.city && !m.dest) continue; // 町のないシナリオで、まだ交易所がない
      if (m.travelDays > 0) {
        m.travelDays--;
        if (m.travelDays > 0) continue;
        // 到着して売る
        const city = world.cities[m.dest];
        m.city = m.dest;
        for (const [id, n] of Object.entries(m.cargo)) {
          const gain = cityWants(city, id) ? quote(world, city, id, -n) : 0;
          if (gain > 0) {
            city.stock[id] = (city.stock[id] || 0) + n;
            r.silver += gain;
            r.sold[id] = (r.sold[id] || 0) + n;
            r.soldValue = r.soldValue || {};
            r.soldValue[id] = (r.soldValue[id] || 0) + gain;
          }
        }
        m.cargo = {};
        m.wait = 1;
        continue;
      }
      if (m.wait > 0) { m.wait--; continue; }
      // 本拠地にいて蔵に製品があれば、それを一番高く売れる町へ運ぶ
      if (r.workshop && m.city === r.workshop.city && (r.store?.[r.workshop.output] || 0) >= 5) {
        const out = r.workshop.output;
        const n = Math.min(Math.floor(r.store[out]), TRANSPORTS[m.transport].cap);
        let best = null;
        for (const to of Object.keys(world.cities)) {
          if (to === m.city || !cityWants(world.cities[to], out)) continue;
          const route = findPath(world, m.city, to, m.transport);
          if (!route) continue;
          const perDay = quote(world, world.cities[to], out, -n) / Math.max(1, route.days);
          if (!best || perDay > best.perDay) best = { to, perDay, days: route.days };
        }
        if (best) {
          r.store[out] -= n;
          m.cargo = { [out]: n };
          m.dest = best.to;
          m.travelDays = best.days;
          m.from = m.city;
          m.departDay = world.day;
          if (!r.announced) {
            r.announced = true;
            emit(world, { type: 'rival', bad: true, text: `${r.name}が${GOODS[out].name}を${world.cities[best.to].name}へ運び始めた！市場の取り合いが始まる` });
          }
          continue;
        }
      }
      // 本拠地へ戻る（蔵が貯まっていれば）
      if (r.workshop && m.city !== r.workshop.city && (r.store?.[r.workshop.output] || 0) >= 10 && m.home) {
        const route = findPath(world, m.city, r.workshop.city, m.transport);
        if (route) { m.cargo = {}; m.dest = r.workshop.city; m.travelDays = route.days; m.from = m.city; m.departDay = world.day; continue; }
      }
      const plan = bestPlan(world, r, m);
      if (!plan) {
        // 運ぶ物がない町（大きな消費地など）で待ち続けないように、空荷で仕入れ先へ移る
        // （12回目: s8 のライバルが50日目から琥珀京で止まり、絹がずっと上限値のままだった）
        let to = null, bestScore = 0;
        for (const id of Object.keys(world.cities)) {
          if (id === m.city) continue;
          const c = world.cities[id];
          const score = (r.goods || world.scenario.goods).reduce((s, g) => s + ((c.stock[g] || 0) >= 6 && midPrice(c, g) < GOODS[g].base ? (GOODS[g].base - midPrice(c, g)) * Math.min(20, c.stock[g]) : 0), 0);
          if (score > bestScore && findPath(world, m.city, id, m.transport)) { bestScore = score; to = id; }
        }
        if (to) { const route = findPath(world, m.city, to, m.transport); m.cargo = {}; m.dest = to; m.travelDays = route.days; m.from = m.city; m.departDay = world.day; continue; }
        m.wait = 3;
        continue;
      }
      const here = world.cities[m.city];
      const cost = quote(world, here, plan.id, plan.n);
      here.stock[plan.id] -= plan.n;
      r.silver -= cost;
      m.cargo = { [plan.id]: plan.n };
      m.dest = plan.to;
      m.travelDays = plan.days;
      m.from = m.city;
      m.departDay = world.day;
    }
  }
}

// ---------- 町のないシナリオのライバル（版4 H2） ----------
// ライバルも自分の館の近くから交易所を開いて育てる。集落と野の需要施設を取り合う相手になる。
// 開いた交易所は、だれでも売り買いできる市場（プレイヤーの交易所ではない）
const RIVAL_POST_NAMES = ['砂金の辻', '紅の市', '鷹の宿', '黒曜の市', '翡翠の辻'];
export function rivalFound(world) {
  const pz = world.scenario.pioneer;
  if (!pz) return;
  for (const r of world.rivals) {
    if (!r.hq) continue;
    r.posts = r.posts || [];
    // 格上げ: 人口で自然に上がる
    for (const id of r.posts) {
      const c = world.cities[id];
      if (c && c.grade < 2 && c.pop >= B.rivalGradePop[c.grade]) { c.grade += 1; emit(world, { type: 'rivalPost', city: id, text: `${r.name}の${c.name}が「${B.postGradeNames[c.grade]}」になった` }); }
    }
    const plan = pz.rivalPosts || [6, 160, 340];
    if (r.posts.length >= plan.length || world.day < plan[r.posts.length]) continue;
    const anchors = r.posts.length ? r.posts.map((id) => world.grid.cityTiles[id]) : [r.hq];
    const reach = r.posts.length ? 34 : HQ_RANGE;
    let best = null;
    for (const s of foundSites(world, 60, { from: anchors })) {
      if (s.dist > reach) continue;
      if (!best || s.score > best.score) best = s;
    }
    if (!best) { r.posts.push(null); continue; }
    const n = r.posts.filter(Boolean).length;
    const c = createPost(world, best.x, best.y, { id: `rpost${world.rivals.indexOf(r) + 1}_${n + 1}`, name: RIVAL_POST_NAMES[n % RIVAL_POST_NAMES.length], rival: r.name });
    r.posts.push(c.id);
    for (const m of r.merchants) if (!m.city) m.city = c.id;
    emit(world, { type: 'rival', city: c.id, bad: true, text: `${r.name}が交易所「${c.name}」を開いた。まわりの集落は${r.name}のものになる（売り買いはだれでもできる）` });
  }
}
