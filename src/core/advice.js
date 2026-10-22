// 次の一手の例（初めての人向け）: 今いる町で買って、相場を知っている町で売る候補を、1日あたりの見込み利益の順に
import { GOODS, PROVISIONS } from '../data/goods.js';
import { BALANCE as B } from '../data/balance.js';
import { quote, cityWants } from './market.js';
import { settlersAllowed, settlerCost, settleCheck, settlerSourceCheck } from './settlers.js';
import { routeInfo, merchantCap, hireCost, branchesAllowed, branchCost, branchCheck, donateCost, hasPresence } from './actions.js';
import { dailyCost } from './world.js';
import { glucoseNeed, cityTier, dailyDemand, rushSweetPlan } from './city.js';
import { dwellingStatus } from './dwelling.js';
import { goalsStatus } from './scoring.js';
import { knowledgeAge } from './knowledge.js';
import { foundSites, postCost } from './posts.js';
import { cargoCap, cargoUsed, foodNeeded } from './caravan.js';

export function suggestTrades(world, mid, limit = 3) {
  const m = world.player.merchants.find((x) => x.id === Number(mid));
  if (!m || m.travel) return [];
  const here = world.cities[m.city];
  const room = cargoCap(m) - cargoUsed(m);
  const out = [];
  for (const [cid, k] of Object.entries(world.player.knowledge)) {
    // 古すぎる相場（120日より前）は当てにならないので使わない
    if (cid === m.city || !k?.prices || !Number.isFinite(k.day) || world.day - k.day > 120) continue;
    const r = routeInfo(world, m.id, cid);
    if (!r) continue;
    const days = Math.max(1, r.days);
    // 砂漠を渡るなら、食料の分だけ積める量が減る
    const food = foodNeeded(world, m, r.desertDays || 0);
    for (const good of world.scenario.goods) {
      const there = k.prices[good];
      const stock = Math.floor(here.stock[good] || 0);
      if (!there || stock < 3) continue;
      const target = world.cities[cid];
      if (!cityWants(target, good)) continue;
      // 行き先が自分でたくさん作っている品は、古い相場が高くても値崩れしやすい
      if ((target.produces?.[good] || 0) >= (here.produces?.[good] || 0) * 0.5 && (target.produces?.[good] || 0) > 0) continue;
      const g = GOODS[good];
      let qty = Math.min(stock, Math.floor((room - food) / g.weight));
      // 買い進むと値上がりし、売り進むと値下がりする。見込みが残る数まで減らす
      while (qty > 0) {
        const cost = quote(world, here, good, qty);
        if (cost <= world.player.silver && there * 0.9 * qty > cost * 1.08) break;
        qty = Math.floor(qty * 0.75);
      }
      if (qty < 2) continue;
      const cost = quote(world, here, good, qty);
      const profit = there * 0.9 * qty - cost;
      out.push({ good, qty, to: cid, days, cost: Math.round(cost), profit: Math.round(profit), perDay: profit / days, food, age: world.day - k.day, desert: r.desertDays || 0 });
    }
  }
  out.sort((a, b) => b.perDay - a.perDay);
  const best = [];
  for (const s of out) { if (!best.some((b) => b.to === s.to)) best.push(s); if (best.length >= limit) break; }
  return best;
}

// まだ相場を知らない、近い町
export function unknownNear(world, mid) {
  const m = world.player.merchants.find((x) => x.id === Number(mid));
  if (!m || m.travel) return null;
  let best = null;
  for (const c of Object.values(world.cities)) {
    if (c.id === m.city || world.player.knowledge[c.id]?.prices) continue;
    const r = routeInfo(world, m.id, c.id);
    if (r && (!best || r.days < best.days)) best = { to: c.id, days: r.days, desert: r.desertDays || 0 };
  }
  return best;
}

export function adviceText(world, mid) {
  const ss = suggestTrades(world, mid);
  const lines = [];
  const name = (id) => world.cities[id].name;
  // 町のないシナリオの序盤: 交易所が1つだけなら、違う食べ物の集落のそばに2つ目を
  const own = Object.values(world.cities).filter((c) => c.founded);
  if (world.scenario.pioneer && own.length === 1) {
    const have = Object.keys(own[0].produces).filter((g) => own[0].produces[g] > 0);
    const [ox, oy] = world.grid.cityTiles[own[0].id];
    const near = foundSites(world, 30).filter((s) => s.preview.foods.some((g) => !have.includes(g) && GOODS[g].kind === 'food')).map((s) => ({ ...s, d: Math.max(Math.abs(s.x - ox), Math.abs(s.y - oy)) })).sort((a, b) => a.d - b.d)[0];
    if (near) lines.push(`2つ目の交易所を、${near.preview.hamlets.map((hm) => hm.name).join('・')}のそば（${near.x},${near.y}、${near.d}マス先）に開く（上の「交易所」/ CLI: found ${near.x},${near.y} confirm・${postCost(world)}銀）。${near.preview.foods.map((g) => GOODS[g].name).join('・')}と${have.map((g) => GOODS[g].name).join('・')}を運び合うと、どちらの食卓も2種類になって糖度が上がり、家が建つ`);
  }
  for (const s of ss) {
    lines.push(`${GOODS[s.good].name}を${s.qty}個買って（約${s.cost}銀）${name(s.to)}へ（約${s.days}日）。見込み +${s.profit}銀${s.food ? `。砂漠を渡るので食料（${PROVISIONS.map((g) => GOODS[g].name).join('・')}のどれか）を${s.food}個積む` : ''}`);
  }
  const u = unknownNear(world, mid);
  if (u) {
    // 相場を知らない町へは、手ぶらで行かずに、ここの特産（安い品）を積んでいく
    const m = world.player.merchants.find((x) => x.id === Number(mid));
    const here = world.cities[m.city];
    const target = world.cities[u.to];
    // 行き先がその品を作っていても、ここより作る量が少なければ足りていないことが多い
    const local = Object.entries(here.produces || {}).filter(([g, r]) => ((target.produces || {})[g] || 0) < r * 0.5 && world.scenario.goods.includes(g)).sort((a, b) => b[1] - a[1])[0]?.[0];
    const food = foodNeeded(world, m, u.desert);
    const qty = local ? Math.max(0, Math.min(Math.floor(here.stock[local] || 0), Math.floor((cargoCap(m) - cargoUsed(m) - food) / GOODS[local].weight))) : 0;
    // 確かめに行くだけなので、少しだけ（積載の4分の1、手持ちの4分の1まで）。小さな町ではすぐ値崩れする
    let qty2 = Math.min(qty, Math.floor(cargoCap(m) / 4));
    while (qty2 > 0 && local && quote(world, here, local, qty2) > world.player.silver * 0.25) qty2 = Math.floor(qty2 * 0.8);
    const carry = local && qty2 >= 2 ? `ここの特産の${GOODS[local].name}を${qty2}個（約${Math.round(quote(world, here, local, qty2))}銀）積んで、` : '';
    lines.push(`${carry}まだ相場を知らない${name(u.to)}へ行ってみる（約${u.days}日）。相場が分からないので赤字の恐れもある。少なめに試し、着いたら相場を確かめて売る${food ? `。砂漠を渡るので食料を${food}個積む` : ''}`);
  }
  // 積んでいる品の売り先（買ったあとに「見込みのある取引がない」とだけ出て、どこへ行けばよいか分からなかったため）
  if (!ss.length) {
    const m = world.player.merchants.find((x) => x.id === Number(mid));
    for (const [good, q] of Object.entries(m?.cargo || {})) {
      if (!(q > 0)) continue;
      let best = null;
      for (const [cid, k] of Object.entries(world.player.knowledge)) {
        if (cid === m.city || !k?.prices?.[good] || !cityWants(world.cities[cid], good)) continue;
        const r = routeInfo(world, m.id, cid);
        if (!r) continue;
        const gain = k.prices[good] * 0.9 * q - (m.cost[good] || 0) * q;
        if (gain > 0 && (!best || gain / Math.max(1, r.days) > best.gain / Math.max(1, best.days))) best = { cid, days: r.days, gain, age: world.day - k.day };
      }
      if (best) lines.push(`積んでいる${GOODS[good].name}${q}個は、${name(best.cid)}（約${best.days}日）で売ると見込み +${Math.round(best.gain)}銀。「出発」で地図の${name(best.cid)}を選ぶ`);
    }
  }
  if (!lines.length) lines.push('今いる町で見込みのある取引が見つからない。積荷を売るか、別の町へ行って相場を確かめよう');
  return lines;
}

// 銀の使い道: 銀が眠っているときに、目標に効く使い方を示す（全員テスト10〜11回目: 下手な役ほど銀を余らせたまま目標に届かなかった）
// 返すのは { text, kind } の配列。銀に余裕がなければ空
export function silverAdvice(world) {
  const pl = world.player;
  const spare = pl.silver - Math.max(1000, dailyCost(world, { guards: true }) * 60);
  if (spare < 1500 || world.finished) return [];
  const out = [];
  const name = (id) => world.cities[id].name;
  // 目標の町で、食卓に足りない品（知っている範囲で）と、その産地
  const st = goalsStatus(world);
  // 目標の町（交易所の目標なら、開いた交易所のうち一番大きいもの）
  let goal = world.scenario.goals.find((g, i) => ['cityTier', 'cityPop', 'rushes'].includes(g.type) && !st[i]?.done);
  if (!goal) {
    const pi = world.scenario.goals.findIndex((g, i) => g.type === 'postTier' && !st[i]?.done);
    const post = Object.values(world.cities).filter((c) => c.founded).sort((a, b) => b.pop - a.pop)[0];
    if (pi >= 0 && post) goal = { type: 'postTier', city: post.id };
    else if (pi >= 0) out.push({ kind: 'found', text: '交易所の目標がまだ。交易所を開く（sites で候補）' });
  }
  let lack = '';
  if (goal) {
    const k = pl.knowledge[goal.city];
    const c = world.cities[goal.city];
    const diet = k?.diet || {};
    const short = world.scenario.goods
      .filter((id) => ['food', 'sweet'].includes(GOODS[id].kind) && GOODS[id].glu && !(c.produces?.[id] > 0) && (diet[id] || 0) < (GOODS[id].kind === 'food' ? 0.3 : 0.2))
      .map((id) => {
        // 産地は、地元で食べる分を引いても余る町だけ（作っているだけで、余りのない町を勧めないように）
        const spare = (x) => (x.produces?.[id] || 0) - dailyDemand(x, id, false);
        const src = Object.values(world.cities).filter((x) => x.id !== c.id && spare(x) > 0.5).sort((a, b) => spare(b) - spare(a))[0];
        return src ? { id, src: src.id, spare: spare(src), gap: (GOODS[id].kind === 'food' ? 0.5 : 0.45) - (diet[id] || 0) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 2);
    const parts = [];
    // 家が建たずに止まっているなら、住居の求める品が先（前に見たときの様子で判断する）
    if (k?.blocker && /住居/.test(k.blocker)) {
      const miss = dwellingStatus(c, cityTier(c)).missing;
      if (miss.length) parts.push(`住居の求める ${miss.map((g) => GOODS[g].name).join('・')}`);
    }
    if (short.length) {
      const need = glucoseNeed(c);
      parts.push(`食卓に足りない ${short.map((s) => `${GOODS[s.id].name}（${name(s.src)}産、1日約${Math.max(1, Math.round(Math.min(s.spare, (s.gap * need) / GOODS[s.id].glu)))}個）`).join('・')}`);
    }
    // ラッシュが目標なら、甘味（クラッシュ中は終わるまで待つ）
    if (goal.type === 'rushes' && !(c.crash > 0)) {
      const plan = rushSweetPlan(world, c).filter((p) => !(c.produces?.[p.good] > 0)).slice(0, 2);
      if (plan.length) parts.unshift(`ラッシュに要る甘味 ${plan.map((p) => `${GOODS[p.good].name}（1日約${Math.max(1, Math.round(p.perDay))}個）`).join('・')}`);
    }
    if (parts.length) lack = `${name(goal.city)}の${parts.join('と、')} の定期便を足す`;
  }
  const cap = merchantCap(world);
  if (pl.merchants.length < cap) {
    out.push({ kind: 'hire', text: `商人をあと${cap - pl.merchants.length}人雇える（次は${hireCost(world)}銀）。${lack ? `雇って、${lack}と目標に効く` : '雇って、儲かる便か目標の町への便を足す'}` });
  } else if (branchesAllowed(world)) {
    const cost = branchCost(world);
    const spots = Object.keys(world.cities).filter((id) => !branchCheck(world, id) && hasPresence(world, id) && !world.cities[id].founded).slice(0, 3);
    if (spare >= cost && spots.length) out.push({ kind: 'branch', text: `商人が上限（${cap}人）。商館（${cost}銀）を開くと、もう1人雇える。候補: ${spots.map(name).join('・')}（定期便が回っている町）${lack ? `。${lack}と目標に効く` : ''}` });
    else if (lack) out.push({ kind: 'route', text: `商人は上限。今の定期便を組み替えて、${lack}と目標に効く${spots.length ? `（商館は${cost}銀で、もう1人雇える）` : ''}` });
  }
  // 交易所の目標がまだなら、開拓団（目標の町が別にあっても出す。13回目の Opus の指摘）
  const postGoal = world.scenario.goals.findIndex((g, i) => g.type === 'postTier' && !st[i]?.done);
  const bigPost = Object.values(world.cities).filter((c) => c.founded).sort((a, b) => b.pop - a.pop)[0];
  if (postGoal >= 0 && bigPost && settlersAllowed(world) && (bigPost.settlerGroups || 0) < B.settlerMax) {
    const cost = settlerCost(world, bigPost.id);
    const src = Object.values(world.cities).filter((x) => !x.founded && cityTier(x) >= B.settlerMinTier && !settlerSourceCheck(world, x)).sort((a, b) => b.pop - a.pop).slice(0, 3).map((x) => x.name);
    const why = settleCheck(world, bigPost.id);
    if (src.length && spare >= cost) out.push({ kind: 'settlers', text: `${name(bigPost.id)}へ開拓団（${cost}銀、${B.settlerGroup}人。${src.join('・')}から）を送れる。${why ? `受け入れの準備がまだ: ${why}` : '今なら住みつける'}` });
  }
  if (goal) {
    const c = world.cities[goal.city];
    const k = pl.knowledge[goal.city];
    const cost = donateCost(world, goal.city);
    if (!(c.donatedUntil > world.day) && (k?.glucose ?? 0) >= 60 && spare >= cost) out.push({ kind: 'donate', text: `${name(goal.city)}に寄進（${cost}銀）すると、90日間成長が速まる（糖度が足りているときだけ効く。食べ物を届ける代わりにはならない）` });
  }
  return out;
}

// 目標の町の案内: 目標のバーの下に出す一言。人口・成長の速さ・止めているもの・このままだと何日かを、
// 自分が知っている範囲（最後に商人がいたときの様子）で示す。正解は決めつけず、何が足りないかを見せる
// （s2 で「麦の里を町に育てる」の手の打ち方が分からず、2人の画面だけのテストが迷った）
export function goalHints(world) {
  const st = goalsStatus(world);
  const out = [];
  const seen = new Set();
  const left = world.scenario.deadline - world.day;
  world.scenario.goals.forEach((g, i) => {
    // 一度届いた目標でも、その町が縮んでいれば知らせる（全部がそろう瞬間に満たしている必要がある。都が飢えて大都市を割っていくのに、何も出なかった。Opus の指摘）
    if (st[i]?.done) {
      if (!['cityTier', 'cityPop'].includes(g.type)) return;
      const k = world.player.knowledge[g.city];
      if (!k || !((k.growth ?? 0) < 0)) return;
      out.push({ city: g.city, warn: true, text: `⚠ ${world.cities[g.city].name}が縮んでいる（成長 ${((k.growth ?? 0) * 100).toFixed(2)}%/日）。目標を割ると達成にならない。${k.blocker ? `止めているもの: ${k.blocker}` : ''}` });
      return;
    }
    let id = null;
    let target = null;
    if (g.type === 'cityTier') { id = g.city; target = B.tierPops[g.tier]; }
    else if (g.type === 'cityPop') { id = g.city; target = g.pop; }
    else if (g.type === 'rushes' && g.city) id = g.city;
    else if (g.type === 'postTier') {
      const post = Object.values(world.cities).filter((c) => c.founded).sort((a, b) => b.pop - a.pop)[0];
      if (post) { id = post.id; target = g.pop || B.tierPops[g.tier]; }
    }
    if (!id || seen.has(id)) return;
    seen.add(id);
    const c = world.cities[id];
    const k = world.player.knowledge[id];
    const age = knowledgeAge(world, id);
    if (!k || age === null) { out.push({ city: id, text: `${c.name}: まだ様子を知らない。商人を送って確かめる` }); return; }
    const when = age === 0 ? '今' : `${age}日前`;
    let late = false;
    const r = k.growth ?? 0;
    const parts = [];
    if (target) parts.push(`人口 ${Math.floor(k.pop)}/${target}`);
    parts.push(`成長 ${(r * 100).toFixed(2)}%/日`);
    if (target && k.pop < target) {
      if (r > 0) {
        const days = Math.ceil(Math.log(target / k.pop) / Math.log(1 + r));
        parts.push(days > 2000 ? 'このままではほとんど育たない' : `このままだと約${days}日`);
        // 期限に間に合わないなら、そう言う（「順調」と出て、何もしなくてよいように読めた。Opus の指摘）
        if (days <= 2000 && days > left) late = true;
      } else parts.push('このままでは育たない');
    }
    if (g.type === 'rushes') parts.push(`糖度 ${Math.round(k.glucose)}（ラッシュは ${B.rushLine} 以上）`);
    const block = k.blocker ? `止めているもの: ${k.blocker}` : late ? `このままでは期限（残り${left}日）に間に合わない。食べ物の種類と量を増やす${settlersAllowed(world) && c.founded ? '・開拓団を送る' : ''}` : '順調。届け続ける';
    out.push({ city: id, text: `${c.name}（${when}）: ${parts.join('・')}。${block}` });
  });
  return out;
}
