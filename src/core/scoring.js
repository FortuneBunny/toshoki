// 目標の判定、資産の計算、ランク
import { GOODS } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';
import { TRANSPORTS } from '../data/transports.js';
import { cityTier, tierName } from './city.js';
import { cityWants } from './market.js';
import { emit } from './events.js';
import { BALANCE as B } from '../data/balance.js';

export function netWorth(world) {
  const pl = world.player;
  let w = pl.silver;
  for (const m of pl.merchants) {
    for (const [id, q] of Object.entries(m.cargo)) w += q * GOODS[id].base * 0.8;
    w += TRANSPORTS[m.transport].cost * 0.5;
  }
  for (const wh of Object.values(pl.warehouses)) for (const [id, q] of Object.entries(wh.stock)) w += q * GOODS[id].base * 0.8;
  for (const b of pl.buildings) w += BUILDINGS[b.type].cost * 0.5;
  return w;
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
    case 'cityPop': {
      const c = world.cities[g.city];
      return { p: c.pop / g.pop, text: `${c.name}の人口を ${g.pop} にする（今 ${Math.floor(c.pop)}）` };
    }
    case 'cityTier': {
      const c = world.cities[g.city];
      const t = cityTier(c);
      const lo = c.basePop;
      const hi = B.tierPops[g.tier];
      return { p: t >= g.tier ? 1 : Math.max(0, (c.pop - lo) / (hi - lo)), text: `${c.name}を「${tierName(g.tier)}」に育てる（今「${tierName(t)}」人口 ${Math.floor(c.pop)}/${hi}）` };
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
      const mine = s.soldTotal[g.good] || 0;
      const theirs = world.rivals.reduce((a, r) => a + (r.sold[g.good] || 0), 0);
      const total = mine + theirs;
      const share = total ? mine / total : 0;
      const p = Math.min(mine / g.min, share / g.share);
      return { p, text: `${GOODS[g.good].name}の取引量でライバルを上回る（自分 ${mine} 個 / ライバル ${theirs} 個、最低 ${g.min} 個）` };
    }
    default:
      return { p: 0, text: '?' };
  }
}

export function goalsStatus(world) {
  return world.scenario.goals.map((g) => {
    const r = goalProgress(world, g);
    return { ...r, p: Math.max(0, Math.min(1, r.p)), done: r.p >= 1 };
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
  // 目標の節目（25/50/75%）で小さな演出を出す
  world.milestones = world.milestones || {};
  st.forEach((g, i) => {
    for (const q of [0.25, 0.5, 0.75]) {
      const key = `${i}:${q}`;
      if (g.p >= q && !world.milestones[key] && !g.done) {
        world.milestones[key] = true;
        emit(world, { type: 'milestone', text: `目標「${g.text.split('（')[0]}」が ${q * 100}% に到達` });
      }
    }
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
