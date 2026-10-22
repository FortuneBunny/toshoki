// 画面の撮影用に、途中の状態のセーブを作る（ボットで日を進め、建物や道を足す）
//   node tools/shots/fixtures.js  → tools/shots/out/fixtures/*.json
import { mkdirSync, writeFileSync } from 'node:fs';
import * as G from '../../src/core/index.js';
import { BOTS } from '../sim-bots.js';

const OUT = 'tools/shots/out/fixtures';
mkdirSync(OUT, { recursive: true });

function play(id, days, seed = 7) {
  const world = G.createWorld(id, { seed });
  G.drainEvents(world);
  for (let d = 0; d < days && !world.finished; d++) {
    for (const m of world.player.merchants) if (!m.travel) BOTS.goal(world, m);
    G.advance(world, 1, { stopOn: new Set() });
  }
  world.finished = null;
  return world;
}

// 町を大きく育てて、区画を家と建物で埋める
function grow(world, cityId, pop) {
  const c = world.cities[cityId];
  c.pop = pop;
  for (let i = 0; i < 400; i++) G.updateHousing(c, G.cityTier(c), 4);
}

function buildAll(world, cityId) {
  world.player.silver = 999999;
  const m0 = world.player.merchants[0];
  m0.travel = null;
  m0.city = cityId;
  const c = world.cities[cityId];
  const tier = G.cityTier(c);
  for (const type of Object.keys(G.PRODUCERS)) {
    const spot = G.placeableTiles(c, tier, type)[0];
    if (spot) G.placeProducer(world, cityId, type, spot.x, spot.y);
  }
  for (const type of Object.keys(G.CIVICS).filter((x) => !G.CIVICS[x].wild)) G.buildCivic(world, cityId, type);
}

function save(name, world) {
  G.drainEvents(world);
  writeFileSync(`${OUT}/${name}.json`, G.serialize(world));
  console.log(name, `day ${world.day}`, Object.values(world.cities).map((c) => `${c.name}:${Math.round(c.pop)}`).join(' '));
}

const here = (w) => w.player.merchants[0].city || Object.keys(w.cities)[0];

save('s2-mid', play('s2', 140));
save('s4-mid', play('s4', 200));
save('s6-mid', play('s6', 160));
save('s7-mid', play('s7', 200));
{
  const w = play('s5', 220);
  const ids = Object.keys(w.cities);
  w.cities[ids[0]].rush = G.BALANCE.rushDays;
  w.cities[ids[1]].crash = G.BALANCE.crashDays;
  save('s5-rush', w);
}
{
  const w = play('s8', 400);
  const cap = Object.values(w.cities).sort((a, b) => b.pop - a.pop)[0].id;
  w.cities[cap].pop = 7000;
  buildAll(w, cap);
  grow(w, cap, 9000);
  const s = G.foundSites(w)[0];
  if (s) { const r = G.foundPost(w, s.x, s.y); if (r.ok !== false && r.id) { G.buildPath(w, cap, r.id, 'road'); grow(w, r.id, 700); } }
  G.advance(w, 5, { stopOn: new Set() });
  save('s8-built', w);
  // 商館（都と港に開き、銀が余っている状態）
  G.buildBranch(w, cap);
  w.player.silver = 30000;
  save('s8-branch', w);
  // 開拓団（都にいる商人が1団を連れている）
  const ms = w.player.merchants.slice(0, 2);
  for (const m of ms) { m.order = null; m.travel = null; m.city = cap; m.cargo = {}; }
  const post = Object.values(w.cities).find((c) => c.founded);
  if (post) G.sendSettlers(w, ms[0].id, post.id);
  save('s8-settlers', w);
}
{
  const w = play('free', 300);
  w.player.silver = 999999;
  const s = G.foundSites(w)[0];
  if (s) { const r = G.foundPost(w, s.x, s.y); if (r.id) G.buildPath(w, here(w), r.id, 'road'); }
  save('free-post', w);
}
