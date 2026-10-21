// 開拓団: 大きな町から交易所へ人を移す。商人が一団を運び、着いた交易所に住む家と食べ物がそろっていれば住みつく。
// 終盤に余る銀を、交易所の人口に換える手段（12回目の敵対的評価のあとの相談で、Sol の案を元にした）。
// 代償は送り出す町ではなく受け入れる側に置く: 家の空き地と、食べ物3種類が届いて糖度が足りている食卓を先に整えておく必要がある
import { BALANCE as B } from '../data/balance.js';
import { GOODS } from '../data/goods.js';
import { cityTier } from './city.js';
import { canHouse, updateHousing } from './district.js';
import { dwellingStatus } from './dwelling.js';
import { postsAllowed } from './posts.js';
import { emit } from './events.js';
import { cargoUsed, cargoCap } from './caravan.js';

const fail = (error) => ({ ok: false, error });

export function settlersAllowed(world) {
  return !!world.scenario.branches && postsAllowed(world) > 0;
}

// その交易所に次の一団を送る費用（交易所ごとに 6000 → 9000 → 12000）。運んでいる途中の団も数える
// （住みついた数だけ見ていたので、同時に送ると全部6000銀になった。13回目の Opus・Sol の指摘）
export function settlerCost(world, postId) {
  const n = (world.cities[postId]?.settlerGroups || 0) + pendingTo(world, postId);
  return Math.round((B.settlerCost + B.settlerCostStep * n) * (world.player.mods?.buildCost ?? 1));
}

// 食卓のならし（交易所ごとに毎日）。受け入れは、その日の食卓ではなく、ここ10日ほどの食卓で見る
// （食べ物を1個だけ売ってその日の食卓を3種類にすると、3団が一度に住みついたため。13回目の Sol の指摘）
export function trackPosts(world) {
  for (const c of Object.values(world.cities)) {
    if (!c.founded) continue;
    c.dietAvg = c.dietAvg || {};
    for (const g of new Set([...Object.keys(c.dietAvg), ...Object.keys(c.diet || {})])) {
      c.dietAvg[g] = (c.dietAvg[g] || 0) * (1 - B.settlerDietFollow) + (c.diet?.[g] || 0) * B.settlerDietFollow;
      if (c.dietAvg[g] < 1e-4) delete c.dietAvg[g];
    }
  }
}

// 移っても住みつけるか（理由を返す。住みつけるなら null）。
// ここ10日ほどの食卓に食べ物が3種類あり、糖度が足りていること（増えた人で食べ物を分けるので、ぎりぎりで送ると糖度が下がって伸び悩む）
export function settleCheck(world, postId, n = B.settlerGroup) {
  const c = world.cities[postId];
  const tier = cityTier(c);
  // 開いた直後は、配られた在庫で食卓がそろって見えるので受け入れない（13回目の Opus の指摘）
  const age = world.day - (c.foundedDay ?? 0);
  if (age < B.settlerPostAge) return `${c.name}は開いて${age}日。開拓団を受け入れられるのは${B.settlerPostAge}日目から`;
  if (c.lastSettled !== undefined && world.day - c.lastSettled < B.settlerGap) return `${c.name}には${world.day - c.lastSettled}日前に開拓団が住みついたばかり（次は${B.settlerGap}日あける）`;
  if (!canHouse(c, tier, n)) return `${c.name}には${n}人分の家を建てる空き地がない`;
  const dw = dwellingStatus(c, tier);
  if (!dw.ok) return `${c.name}の住居の求める品が足りない（${dw.missing.map((g) => GOODS[g].name).join('・')}）。家が建たない`;
  const foods = world.scenario.goods.filter((g) => GOODS[g].kind === 'food');
  const want = Math.min(3, foods.length);
  const eaten = foods.filter((g) => (c.dietAvg?.[g] || 0) > B.settlerDietLine);
  if (eaten.length < want) return `${c.name}の食卓に、続けて届いている食べ物が${eaten.length}種類（${want}種類要る${eaten.length ? `。今あるもの: ${eaten.map((g) => GOODS[g].name).join('・')}` : ''}。10日ほど続けて届ける）`;
  if (c.glucose < B.settlerGlucose) return `${c.name}の糖度が${Math.round(c.glucose)}（${B.settlerGlucose}以上要る。食べ物を多く届ける）`;
  return null;
}

// 送り出す町から人を減らしてよいか。目標の町は、目標の人口を割らない分だけ出せる
// （人を出せる町が目標の都だけで、送ると律速の目標が遅れたため。13回目の Opus の指摘）
export function settlerSourceCheck(world, from) {
  if (from.founded) return '開拓団は交易所からは出せない';
  if (cityTier(from) < B.settlerMinTier) return `開拓団を出せるのは「${B.tierNames[B.settlerMinTier]}」以上の町`;
  for (const g of world.scenario.goals || []) {
    if (g.city !== from.id) continue;
    const need = g.type === 'cityPop' ? g.pop : g.type === 'cityTier' ? B.tierPops[g.tier] : 0;
    if (need && from.pop - B.settlerGroup < need) return `${from.name}は目標の町。人口が${need + B.settlerGroup}を超えるまでは開拓団を出さない（目標を割るため）`;
  }
  return null;
}

// 送り出せるか（理由を返す。送れるなら null）
export function settlerCheck(world, mid, postId) {
  if (!settlersAllowed(world)) return 'このシナリオでは開拓団を送れない';
  const m = world.player.merchants.find((x) => x.id === Number(mid));
  if (!m) return '不明な商人';
  if (m.travel) return `${m.name}は移動中`;
  if (m.order && !m.order.paused) return `${m.name}は定期便の途中（先に止める）`;
  if (m.settlers) return `${m.name}はもう開拓団を連れている`;
  if (cargoUsed(m) + Math.floor(cargoCap(m) * B.settlerLoad) > cargoCap(m)) return `${m.name}の荷を減らす（開拓団は荷車の${Math.round(B.settlerLoad * 100)}%を使う。残りに道中の食料を積める）`;
  const src = settlerSourceCheck(world, world.cities[m.city]);
  if (src) return src;
  const post = world.cities[postId];
  if (!post?.founded) return '開拓団を送れるのは自分で開いた交易所だけ';
  if ((post.settlerGroups || 0) + pendingTo(world, postId) >= B.settlerMax) return `${post.name}に送れる開拓団は${B.settlerMax}団まで`;
  return null;
}

function pendingTo(world, postId) {
  return world.player.merchants.filter((m) => m.settlers?.to === postId).length;
}

// 町から一団を連れ出す。人は出発のときに町から減り、銀もこのとき払う
export function sendSettlers(world, mid, postId) {
  const why = settlerCheck(world, mid, postId);
  if (why) return fail(why);
  const m = world.player.merchants.find((x) => x.id === Number(mid));
  const cost = settlerCost(world, postId);
  if (world.player.silver < cost) return fail(`銀が足りない（${cost}必要）`);
  world.player.silver -= cost;
  const from = world.cities[m.city];
  const n = B.settlerGroup;
  from.pop -= n;
  m.settlers = { n, from: from.id, to: postId, day: world.day };
  world.stats.spentSettlers = (world.stats.spentSettlers || 0) + cost;
  const why2 = settleCheck(world, postId, n);
  emit(world, { type: 'settlers', merchant: m.id, big: true, text: `${m.name}が${from.name}で${n}人の開拓団を連れ出した。${world.cities[postId].name}へ連れていく${why2 ? `（今のままでは住みつけない: ${why2}）` : ''}` });
  return { ok: true, cost };
}

// 交易所にいる開拓団を住みつかせる。着いた日と、その町で待っている毎日に試す。
// 待てるのは着いてから settlerWait 日まで。過ぎると散ってしまう
export function trySettle(world, m) {
  const s = m.settlers;
  if (!s) return;
  // 連れ出してから長く連れ歩くと散る（先に連れ出しておき、交易所を開いた直後に入れられたため。13回目の Opus の指摘）
  if (world.day - s.day > B.settlerCarry) {
    m.settlers = null;
    emit(world, { type: 'settlersLost', merchant: m.id, bad: true, text: `${m.name}の開拓団は、${B.settlerCarry}日たっても住む所が決まらず散ってしまった` });
    return;
  }
  if (m.travel || m.city !== s.to) return;
  const c = world.cities[s.to];
  s.waitFrom = s.waitFrom ?? world.day;
  const why = settleCheck(world, c.id, s.n);
  if (!why) {
    c.pop += s.n;
    c.settlerGroups = (c.settlerGroups || 0) + 1;
    c.lastSettled = world.day;
    updateHousing(c, cityTier(c), 999);
    m.settlers = null;
    world.stats.settled = (world.stats.settled || 0) + s.n;
    emit(world, { type: 'settled', merchant: m.id, city: c.id, big: true, text: `${s.n}人の開拓団が${c.name}に住みついた！（人口 ${Math.round(c.pop)}人）` });
    return;
  }
  if (!s.warned) {
    emit(world, { type: 'settlersWait', merchant: m.id, city: c.id, bad: true, text: `開拓団は${c.name}に着いたが、まだ住みつけない: ${why}。${B.settlerWait}日のうちに整えないと散ってしまう` });
    s.warned = true;
  }
  if (world.day - s.waitFrom >= B.settlerWait) {
    m.settlers = null;
    emit(world, { type: 'settlersLost', merchant: m.id, city: c.id, bad: true, text: `${c.name}で待っていた開拓団は、住む所と食べ物がそろわず散ってしまった` });
  }
}
