// 目標の判定、資産の計算、ランク
import { GOODS } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';
import { TRANSPORTS } from '../data/transports.js';
import { cityTier, tierName } from './city.js';
import { cityWants, quote } from './market.js';
import { emit } from './events.js';
import { BALANCE as B } from '../data/balance.js';
import { GRID_W, GRID_H, T } from './grid.js';

// 資産の内訳（帳簿に出す。所持金と資産の目標の差が、何から来ているか分からなかった。画面だけのテスト（Sol）の指摘）
export function netWorthParts(world) {
  const pl = world.player;
  const parts = { silver: pl.silver, cargo: 0, transports: 0, warehouses: 0, workshops: 0, branches: 0 };
  // 品は、その町（積荷は移動中なら行き先）で売ったときの値の8割。買い取らない品は0
  // （積み替えるだけで資産が増えないように。12回目の Opus の指摘）
  const goodsValue = (city, stock) => {
    let v = 0;
    for (const [id, q] of Object.entries(stock)) {
      if (q <= 0 || !city || !cityWants(city, id)) continue;
      v += Math.min(q * GOODS[id].base, quote(world, city, id, -Math.floor(q))) * 0.8;
    }
    return v;
  };
  for (const m of pl.merchants) {
    parts.cargo += goodsValue(world.cities[m.travel?.to || m.city], m.cargo);
    parts.transports += TRANSPORTS[m.transport].cost * 0.5;
  }
  for (const [cid, wh] of Object.entries(pl.warehouses)) parts.warehouses += goodsValue(world.cities[cid], wh.stock);
  for (const b of pl.buildings) parts.workshops += BUILDINGS[b.type].cost * 0.5;
  // 商館は、払った額の半分
  for (let i = 0; i < (pl.branches?.length || 0); i++) parts.branches += B.branchCost * Math.pow(2, i) * 0.5;
  parts.total = Object.values(parts).reduce((x, y) => x + y, 0);
  return parts;
}

export function netWorth(world) {
  return netWorthParts(world).total;
}

// 指定した町が、1つ目の町から道（または水）だけでどれだけつながっているか
export function networkReach(world, cities, mode) {
  const grid = world.grid;
  const W = GRID_W;
  const ok = (k) => grid.cityAt.has(k) || (mode === 'sea' ? grid.terrain[k] === T.WATER : grid.path[k] >= (mode === 'trail' ? 1 : 2));
  const [sx, sy] = grid.cityTiles[cities[0]];
  const seen = new Uint8Array(grid.terrain.length);
  const q = [sy * W + sx];
  seen[q[0]] = 1;
  while (q.length) {
    const k = q.pop();
    const x = k % W;
    const y = (k / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= GRID_H) continue;
      const nk = ny * W + nx;
      if (seen[nk] || !ok(nk)) continue;
      seen[nk] = 1;
      q.push(nk);
    }
  }
  return cities.filter((id) => { const [x, y] = grid.cityTiles[id]; return seen[y * W + x]; }).length;
}

// 目標1つの進み具合（0〜1）と説明
export function goalProgress(world, g) {
  const s = world.stats;
  switch (g.type) {
    case 'silver': {
      const v = world.player.silver;
      return { p: v / g.amount, text: `銀を ${g.amount} にする（今 ${Math.floor(v)}）` };
    }
    case 'networth': {
      const v = netWorth(world);
      return { p: v / g.amount, text: `資産を ${g.amount} 銀にする（今 ${Math.floor(v)}）` };
    }
    case 'link': {
      // 定期便で2つの町を結ぶ（往復の回数。片道2回で1往復）
      const legs = world.stats.legs?.[[g.a, g.b].sort().join('|')] || 0;
      const v = Math.floor(legs / 2);
      return { p: v / g.count, text: `定期便で${world.cities[g.a].name}と${world.cities[g.b].name}を結ぶ（往復 ${v}/${g.count} 回）` };
    }
    case 'network': {
      const got = networkReach(world, g.cities, g.mode || 'road');
      const names = g.cities.map((id) => world.cities[id].name).join('・');
      return { p: got / g.cities.length, text: `${names}を${g.mode === 'trail' ? '道' : g.mode === 'sea' ? '航路' : '街道'}でつなぐ（${got}/${g.cities.length}町）` };
    }
    case 'postTier': {
      // 自分で開いた交易所を育てる
      const posts = Object.values(world.cities).filter((c) => c.founded);
      const best = posts.reduce((b, c) => (!b || c.pop > b.pop ? c : b), null);
      // pop があれば人口で（一度届けば達成のまま。交易所は小さく始まるので、段階より手前の人口を目標にできる）
      const hi = g.pop || B.tierPops[g.tier];
      const goal = g.pop ? `人口${g.pop}` : `「${tierName(g.tier)}」`;
      if (!best) return { p: 0, text: `交易所を開いて${goal}に育てる（まだ開いていない。上の「交易所」/ CLI: sites）` };
      const reached = g.pop ? best.pop >= g.pop : cityTier(best) >= g.tier;
      return { p: reached ? 1 : Math.min(0.99, best.pop / hi), text: `交易所を開いて${goal}に育てる（${best.name} 人口 ${Math.floor(best.pop)}/${hi}）` };
    }
    case 'posts': {
      // 自分の交易所を、いくつも育てる（町のないシナリオ）
      const posts = Object.values(world.cities).filter((c) => c.founded);
      const v = posts.filter((c) => c.pop >= g.pop).length;
      return { p: Math.min(1, v / g.count), text: `人口${g.pop}以上の交易所を${g.count}つにする（今 ${v}つ・開いた交易所 ${posts.length}）` };
    }
    case 'cityPop': {
      const c = world.cities[g.city];
      return { p: c.pop / g.pop, text: `${c.name}の人口を ${g.pop} にする（今 ${Math.floor(c.pop)}）` };
    }
    case 'cityTier': {
      const c = world.cities[g.city];
      const t = cityTier(c);
      const lo = c.basePop;
      const hi = B.tierPops[g.tier];
      return { p: t >= g.tier ? 1 : Math.min(0.99, Math.max(0, (c.pop - lo) / (hi - lo))), text: `${c.name}を「${tierName(g.tier)}」に育てる（今「${tierName(t)}」人口 ${Math.floor(c.pop)}/${hi}）` };
    }
    case 'produce': {
      const v = s.produced[g.good] || 0;
      return { p: v / g.amount, text: `${GOODS[g.good].name}を ${g.amount} 個つくる（今 ${v}）` };
    }
    case 'deliver': {
      const v = g.city ? s.sold[g.city]?.[g.good] || 0 : s.soldTotal[g.good] || 0;
      const where = g.city ? `${world.cities[g.city].name}で` : '';
      const notYet = g.city && !cityWants(world.cities[g.city], g.good) ? `。${world.cities[g.city].name}はまだ${GOODS[g.good].name}を買い取らない──町が育つと買い取る` : '';
      return { p: v / g.amount, text: `${where}${GOODS[g.good].name}を ${g.amount} 個売る（今 ${v}${notYet}）` };
    }
    case 'rushes': {
      const v = g.city ? world.cities[g.city].rushCount || 0 : s.rushes || 0;
      const where = g.city ? `${world.cities[g.city].name}で` : '';
      return { p: v / g.count, text: `${where}シュガーラッシュを ${g.count} 回起こす（今 ${v}）` };
    }
    case 'totalPop': {
      const v = Object.values(world.cities).reduce((a, c) => a + c.pop, 0);
      return { p: v / g.pop, text: `全ての町の人口の合計を ${g.pop} にする（今 ${Math.floor(v)}）` };
    }
    case 'share': {
      // 売った額で比べる（個数だと、安売りしても同じ1個なので相場を読む意味がなかった。13回目の Opus・Sol の指摘）
      if (g.by === 'value') {
        const mine = Math.max(0, (s.soldValue?.[g.good] || 0) - (s.boughtValue?.[g.good] || 0));
        const theirs = world.rivals.reduce((a, r) => a + (r.soldValue?.[g.good] || 0), 0);
        const total = mine + theirs;
        const p = Math.min(mine / g.min, (total ? mine / total : 0) / g.share);
        return { p, text: `${GOODS[g.good].name}を売った額でライバルを上回る（自分 ${Math.floor(mine)} 銀 / ライバル ${Math.floor(theirs)} 銀、最低 ${g.min} 銀。市場で買った分の代金は差し引く＝数えるのは自分の工房で作った分）` };
      }
      // 市場で買った分は差し引く（買って売る循環で数を稼げないように。数えるのは自分で作った分）
      const mine = Math.max(0, (s.soldTotal[g.good] || 0) - (s.bought[g.good] || 0));
      const theirs = world.rivals.reduce((a, r) => a + (r.sold[g.good] || 0), 0);
      const total = mine + theirs;
      const share = total ? mine / total : 0;
      const p = Math.min(mine / g.min, share / g.share);
      return { p, text: `${GOODS[g.good].name}を売った数でライバルを上回る（自分 ${mine} 個 / ライバル ${theirs} 個、最低 ${g.min} 個。市場で買った分は差し引く＝数えるのは自分の工房で作った分）` };
    }
    default:
      return { p: 0, text: '?' };
  }
}

// 積み上げ型の目標（つくった数・売った数・ラッシュの回数）は一度届けば達成のまま。
// 状態の目標（銀・資産・人口・町の段階）は、すべての目標がそろう瞬間に満たしている必要がある。
const CUMULATIVE = new Set(['produce', 'deliver', 'rushes', 'share']);
export function goalsStatus(world) {
  world.goalsDone = world.goalsDone || [];
  world.goalsReached = world.goalsReached || [];
  return world.scenario.goals.map((g, i) => {
    const r = goalProgress(world, g);
    if (r.p >= 1) { world.goalsReached[i] = true; if (CUMULATIVE.has(g.type)) world.goalsDone[i] = true; }
    const done = CUMULATIVE.has(g.type) ? !!world.goalsDone[i] : r.p >= 1;
    const slipped = !done && world.goalsReached[i] && !CUMULATIVE.has(g.type);
    return { ...r, text: slipped ? `${r.text}（一度届いたが今は下回っている。全部の目標がそろう時に満たす必要がある）` : r.text, p: done ? 1 : Math.max(0, Math.min(1, r.p)), done };
  });
}

export function rankFor(world, day) {
  const ratio = day / world.scenario.deadline;
  if (ratio <= (world.scenario.rankS ?? 0.55)) return 'S';
  if (ratio <= 0.75) return 'A';
  return 'B';
}

// 1日ごとに勝敗を判定する
export function checkGoals(world) {
  if (world.finished) return;
  const st = goalsStatus(world);
  // 目標の節目（25/50/75%）で小さな演出を出す。一度に越えた節目は、いちばん上の1つだけ知らせる（25・50・75%が重なって地図を隠した。第15回テスト）
  world.milestones = world.milestones || {};
  st.forEach((g, i) => {
    let top = 0;
    for (const q of [0.25, 0.5, 0.75]) {
      const key = `${i}:${q}`;
      if (g.p >= q && !world.milestones[key] && !g.done) { world.milestones[key] = true; top = q; }
    }
    if (top) emit(world, { type: 'milestone', text: `目標「${g.text.split('（')[0]}」が ${top * 100}% に到達` });
  });
  if (st.every((g) => g.done)) {
    const rank = rankFor(world, world.day);
    world.finished = { win: true, rank, day: world.day, score: Math.round(netWorth(world)) };
    emit(world, { type: 'victory', big: true, text: `目標達成！ランク ${rank}（${world.day}日目、期限 ${world.scenario.deadline}日）` });
  } else if (world.day >= world.scenario.deadline) {
    world.finished = { win: false, rank: 'C', day: world.day, score: Math.round(netWorth(world)) };
    const lacking = st.filter((g) => !g.done).map((g) => g.text).join(' / ');
    emit(world, { type: 'defeat', bad: true, text: `期限切れ。届かなかった目標: ${lacking}` });
  }
}

// 寄進などで銀を使うと、資産・銀の目標を割るか（警告用）
export function spendWarning(world, cost) {
  for (const g of world.scenario.goals) {
    if (g.type === 'networth' && netWorth(world) >= g.amount && netWorth(world) - cost < g.amount) return `資産が目標の${g.amount}銀を割る（全部の目標がそろう時に満たしている必要がある）`;
    if (g.type === 'silver' && world.player.silver >= g.amount && world.player.silver - cost < g.amount) return `銀が目標の${g.amount}を割る`;
  }
  return null;
}
