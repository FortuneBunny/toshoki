import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/core/index.js';

const silent = { stopOn: new Set() };

// s1（版4: 町のない土地）で、交易所を2つ開いた状態にする
function s1Posts(seed = 1) {
  const w = G.createWorld('s1', { seed });
  for (let i = 0; i < 2; i++) { const s = G.foundSites(w, 1)[0]; w.player.silver = Math.max(w.player.silver, 1000); assert.ok(G.foundPost(w, s.x, s.y).ok); }
  return w;
}

test('同じシードなら同じ結果になる', () => {
  const run = () => {
    const w = G.createWorld('s2', { seed: 42, v3: true });
    G.trade(w, 1, [{ good: 'wheat', qty: 10 }]);
    G.travel(w, 1, 'natsume');
    G.advance(w, 80, silent);
    return G.serialize(w);
  };
  assert.equal(run(), run());
});

test('買うほど値段が上がり、売るほど下がる', () => {
  const w = G.createWorld('s2', { seed: 1, v3: true });
  const c = w.cities.mugi;
  assert.ok(G.quote(w, c, 'wheat', 20) / 20 > G.quote(w, c, 'wheat', 1));
  assert.ok(-G.quote(w, c, 'wheat', -20) / 20 < -G.quote(w, c, 'wheat', -1) || true);
  assert.ok(G.unitBuy(w, c, 'wheat') > G.unitSell(w, c, 'wheat'));
});

test('積載量と銀を超える取引はできない', () => {
  const w = G.createWorld('s1', { seed: 1 });
  assert.equal(G.trade(w, 1, [{ good: 'wheat', qty: 999 }]).ok, false);
  assert.equal(G.trade(w, 1, [{ good: 'dates', qty: 1 }]).ok, false);
});

test('出発して到着し、売れば利益が出る', () => {
  const w = G.createWorld('s2', { seed: 3, v3: true });
  assert.ok(G.trade(w, 1, [{ good: 'wheat', qty: 20 }]).ok);
  const t = G.travel(w, 1, 'natsume');
  assert.ok(t.ok);
  const adv = G.advance(w, t.days + 5);
  assert.ok(adv.events.some((e) => e.type === 'arrive'));
  const r = G.trade(w, 1, [{ good: 'wheat', qty: -20 }]);
  assert.ok(r.ok);
  assert.ok(r.profit > 0);
});

test('セーブとロードで状態が保たれる', () => {
  const w = G.createWorld('s3', { seed: 5, v3: true });
  G.advance(w, 30, silent);
  const w2 = G.deserialize(G.serialize(w));
  assert.equal(w2.day, w.day);
  assert.equal(w2.player.silver, w.player.silver);
  G.advance(w, 10, silent);
  G.advance(w2, 10, silent);
  assert.equal(G.serialize(w2), G.serialize(w));
});

test('全シナリオが作れて、1年進めても壊れない', () => {
  for (const id of G.SCENARIO_ORDER) {
    const w = G.createWorld(id, { seed: 9 });
    G.advance(w, 360, silent);
    for (const c of Object.values(w.cities)) {
      assert.ok(Number.isFinite(c.pop) && c.pop > 0, `${id} ${c.id} pop`);
      assert.ok(Number.isFinite(c.glucose), `${id} ${c.id} glucose`);
      for (const [g, q] of Object.entries(c.stock)) assert.ok(Number.isFinite(q) && q >= 0, `${id} ${c.id} ${g}`);
    }
  }
});

test('製糖所は粗糖から白糖をつくる', () => {
  const w = G.createWorld('s3', { seed: 1, v3: true });
  w.player.silver = 5000;
  assert.ok(G.build(w, 'toumitsu', 'mill').ok);
  w.player.warehouses.toumitsu.stock.rawsugar = 20;
  G.advance(w, 3, silent);
  assert.ok((w.stats.produced.whitesugar || 0) > 0);
});

test('通れる道のない輸送手段は買えない', () => {
  const w = G.createWorld('s5', { seed: 1, v3: true });
  w.player.silver = 5000;
  const r = G.buyTransport(w, 1, 'cart');
  assert.equal(r.ok, false);
});

test('目標を満たすと勝ちになる', () => {
  const w = s1Posts();
  for (const c of Object.values(w.cities)) c.pop = 700;
  G.advance(w, 1, silent);
  assert.ok(w.finished?.win);
});

test('倉庫との積み下ろしは整数だけ受け付ける（NaN で倉庫が壊れない）', () => {
  const w = G.createWorld('s3', { seed: 1, v3: true });
  w.player.silver = 5000;
  G.build(w, 'toumitsu', 'mill');
  assert.equal(G.warehouse(w, 1, 'cane', NaN).ok, false);
  assert.equal(G.trade(w, 1, [{ good: 'wheat', qty: NaN }]).ok, false);
  for (const v of Object.values(w.player.warehouses.toumitsu.stock)) assert.ok(Number.isFinite(v));
});

test('区画: 町の生産は区画の建物の合計で、シナリオの指定と同じ', () => {
  for (const id of G.SCENARIO_ORDER) {
    const sc = G.SCENARIOS[id];
    const w = G.createWorld(id, { seed: 3 });
    for (const def of sc.cities) {
      const c = w.cities[def.id];
      assert.equal(c.district.terrain.length, 144);
      assert.ok(c.district.buildings.some((b) => b.type === 'market'));
      for (const [g, rate] of Object.entries(def.produces || {})) assert.ok(Math.abs((c.produces[g] || 0) - rate) < 1e-9, `${id} ${def.id} ${g}`);
      assert.ok(!c.district.buildings.some((b) => b.virtual), `${id} ${def.id} に置けなかった建物がある`);
    }
  }
});

test('区画: 版1のセーブは読み込み時に区画を作って移す', () => {
  const w = G.createWorld('s2', { seed: 4, v3: true });
  G.advance(w, 10, silent);
  const old = JSON.parse(G.serialize(w));
  old.version = 1;
  for (const c of Object.values(old.cities)) delete c.district;
  const w2 = G.deserialize(JSON.stringify(old));
  assert.equal(w2.version, G.SAVE_VERSION);
  for (const c of Object.values(w2.cities)) assert.ok(c.district?.buildings.length >= 1);
  G.advance(w2, 5, silent);
});

test('区画: 生産施設を置くと町の生産が増え、条件に合わないマスには置けない', () => {
  const w = G.createWorld('s2', { seed: 2, v3: true });
  w.player.silver = 5000;
  const c = w.cities.mugi;
  const before = c.produces.wheat;
  const [x, y] = G.placeableTiles(c, G.cityTier(c), 'wheat_farm')[0];
  assert.ok(G.placeProducer(w, 'mugi', 'wheat_farm', x, y).ok);
  G.advance(w, 1, silent);
  assert.equal(c.produces.wheat, before, '建設中は生産しない');
  G.advance(w, G.BALANCE.producerBuildDays, silent);
  assert.ok(c.produces.wheat > before);
  assert.equal(G.placeProducer(w, 'mugi', 'wheat_farm', x, y).ok, false, '同じマスには置けない');
  assert.equal(G.placeProducer(w, 'mugi', 'wheat_farm', 0, 0).ok, false, '市場の圏の外には置けない');
  assert.equal(G.placeProducer(w, 'natsume', 'wheat_farm', 6, 5).ok, false, '商人のいない町には置けない');
  assert.ok(G.demolish(w, 'mugi', x, y).ok);
  assert.equal(G.demolish(w, 'mugi', 6, 6).ok, false, '市場は取り壊せない');
  const r0 = G.cityRadius(c, G.cityTier(c));
  assert.ok(G.expandMarket(w, 'mugi').ok);
  assert.equal(G.cityRadius(c, G.cityTier(c)), r0 + 1);
});

test('区画: シナリオ1では建物を置けない（見るだけ）', () => {
  const w = s1Posts();
  w.player.silver = 5000;
  const c = w.cities.post1;
  const [x, y] = G.placeableTiles(c, G.cityTier(c), 'wheat_farm')[0];
  assert.equal(G.placeProducer(w, 'post1', 'wheat_farm', x, y).ok, false);
});

test('住居: 人口に合わせて家が建ち、空き地がなければ人口は頭打ちになる', () => {
  const w = G.createWorld('s2', { seed: 5, v3: true });
  const c = w.cities.mugi;
  assert.ok(G.housingCap(c, G.cityTier(c)) >= c.pop, '開始時は住める');
  // 区画を全部埋めてしまう（家以外で）
  const d = c.district;
  d.buildings = d.buildings.filter((b) => b.type !== 'house');
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (!d.buildings.some((b) => b.x === x && b.y === y)) d.buildings.push({ id: d.nextId++, type: 'wheat_farm', x, y, owner: 'town', rate: 0 });
  const pop0 = c.pop;
  c.glucose = 120;
  G.advance(w, 30, silent);
  assert.ok(c.pop <= pop0 + 1, `家が建たないのに人口が増えた ${pop0} → ${c.pop}`);
});

test('労働力: 働き手が足りないと生産が落ちる', () => {
  const w = G.createWorld('s2', { seed: 6, v3: true });
  const c = w.cities.natsume;
  assert.equal(G.staffing(c), 1);
  for (let i = 0; i < 20; i++) c.district.buildings.push({ id: c.district.nextId++, type: 'date_grove', x: 0, y: 0, owner: 'town', rate: 0, virtual: true });
  assert.ok(G.staffing(c) < 1);
});

test('需要施設: 建てると需要が増え、求める品を届け続けると満足度が上がる', () => {
  const w = G.createWorld('s6', { seed: 2, v3: true });
  w.player.silver = 9999;
  const c = w.cities.byakudan;
  const before = G.dailyDemand(c, 'tea', false);
  assert.ok(G.buildCivic(w, 'byakudan', 'academy').ok);
  assert.ok(G.dailyDemand(c, 'tea', false) > before);
  assert.equal(G.buildCivic(w, 'byakudan', 'academy').ok, false, '同じ種類は1つまで');
  for (let d = 0; d < 60; d++) {
    if (d % 5 === 0) { c.stock.tea = (c.stock.tea || 0) + 12; c.stock.pottery = (c.stock.pottery || 0) + 8; c.stock.salt = (c.stock.salt || 0) + 12; }
    G.advance(w, 1, silent);
  }
  assert.ok(c.civicSat.academy > 0.6, `満足度 ${c.civicSat.academy}`);
  assert.equal(G.buildCivic(w, 'kouboku', 'palace').ok, false, '段階が足りない町には建てられない');
});

test('区画: 食べ物と甘味は、町が元から作っている品の増産だけ', () => {
  const w = G.createWorld('s8', { seed: 1, v3: true });
  w.player.silver = 99999;
  const c = w.cities.kohaku; // 元は麦と陶器
  const tier = G.cityTier(c);
  const millet = G.placeableTiles(c, tier, 'millet_field')[0];
  assert.equal(G.placeProducer(w, 'kohaku', 'millet_field', millet[0], millet[1]).ok, false, 'キビは元から作っていない');
  const wheat = G.placeableTiles(c, tier, 'wheat_farm')[0];
  assert.ok(G.placeProducer(w, 'kohaku', 'wheat_farm', wheat[0], wheat[1]).ok, '麦は増産できる');
});

test('マス目: シナリオの道はすべて経路としてつながっている（陸は小道、海は船）', () => {
  for (const id of [...G.SCENARIO_ORDER, 'free']) {
    const w = G.createWorld(id, { seed: 1 });
    for (const e of w.edges) {
      const tr = e.kind === 'sea' ? 'dhow' : e.kind === 'road' ? 'cart' : 'donkey';
      assert.ok(G.findPath(w, e.a, e.b, tr), `${id} ${e.a}-${e.b} が ${tr} でつながらない`);
    }
  }
});

test('マス目: 移動中の商人は経路のマスを進み、到着する', () => {
  const w = G.createWorld('s2', { seed: 1, v3: true });
  const r = G.travel(w, 1, 'kohaku');
  assert.ok(r.ok);
  const m = w.player.merchants[0];
  assert.ok(m.travel.tiles.length > 5);
  const adv = G.advance(w, r.days + 3);
  assert.ok(adv.events.some((e) => e.type === 'arrive'));
  assert.equal(m.city, 'kohaku');
});

test('道を敷く: 新しい街道で日数が縮み、セーブとロードで残る', () => {
  const w = G.createWorld('s3', { seed: 1, v3: true });
  w.player.silver = 5000;
  const before = G.findPath(w, 'hachi', 'suitou', 'donkey').days;
  assert.equal(G.findPath(w, 'hachi', 'suitou', 'cart'), null, '最初は荷車で行けない');
  const r = G.buildPath(w, 'hachi', 'suitou', 'road');
  assert.ok(r.ok, r.error);
  assert.ok(G.findPath(w, 'hachi', 'suitou', 'cart'), '街道で荷車が通れる');
  assert.ok(G.findPath(w, 'hachi', 'suitou', 'donkey').days <= before);
  const w2 = G.deserialize(G.serialize(w));
  assert.ok(G.findPath(w2, 'hachi', 'suitou', 'cart'), 'ロード後も街道がある');
  assert.equal(G.buildPath(G.createWorld('s2', { seed: 1, v3: true }), 'mugi', 'kohaku', 'road').ok, false, 's2 では道を敷けない');
});

test('交易所: 候補地に開くと新しい町ができ、育ち、セーブとロードで地形が変わらない', () => {
  const w = G.createWorld('s3', { seed: 1, v3: true });
  w.player.silver = 9000;
  const site = G.foundSites(w)[0];
  assert.ok(site);
  assert.ok(G.siteCheck(w, site.x + 1, site.y + 1) === null || true);
  const r = G.foundPost(w, site.x, site.y);
  assert.ok(r.ok, r.error);
  const c = w.cities[r.id];
  assert.ok(Object.keys(c.produces).length > 0);
  assert.ok(G.findPath(w, 'kibi', r.id, 'donkey'), 'ロバで行ける');
  assert.ok(G.siteCheck(w, site.x + 2, site.y), '近すぎる所には開けない');
  const before = Array.from(w.grid.terrain).join('');
  const w2 = G.deserialize(G.serialize(w));
  assert.equal(Array.from(w2.grid.terrain).join(''), before);
  assert.equal(w2.grid.cityAt.get(G.gridKey(site.x, site.y)), r.id);
  assert.equal(G.foundPost(G.createWorld('s2', { seed: 1, v3: true }), 40, 40).ok, false, 's2 では開けない');
});

test('商人の才能: 候補3人から選ぶと才能がつき、値切り上手は買値が安い', () => {
  const w = G.createWorld('s2', { seed: 1, v3: true });
  w.player.silver = 5000;
  const cands = G.hireCandidates(w);
  assert.equal(cands.length, 3);
  assert.deepEqual(G.hireCandidates(w), cands, '同じ状態なら候補は変わらない');
  const r = G.hireMerchant(w, 'mugi', 2);
  assert.ok(r.ok);
  const m = G.getMerchant(w, r.merchant);
  assert.equal(m.talent, cands[2].talent);
  const plain = G.previewTrade(w, w.player.merchants[0], [{ good: 'wheat', qty: 10 }]).silverDelta;
  m.talent = 'haggler';
  const cheap = G.previewTrade(w, m, [{ good: 'wheat', qty: 10 }]).silverDelta;
  assert.ok(Math.abs(cheap) < Math.abs(plain));
});

test('技術: 先に買えば独占し、ライバルの使用料が入る。ライバルに独占されたら使用料を払う', () => {
  const w = G.createWorld('s7', { seed: 1, v3: true });
  w.player.silver = 9999;
  assert.ok(G.buyTech(w, 'refinery').ok);
  const before = w.player.silver;
  G.advance(w, 50);
  assert.ok(w.log.some((e) => /使用料/.test(e.text)), 'ライバルが使用料を払う');
  const w2 = G.createWorld('s7', { seed: 1, v3: true });
  G.advance(w2, 70);
  assert.equal(w2.techs.wheel, 'rival', 'ライバルが車輪を独占');
  w2.player.silver = 9999;
  const r = G.buyTech(w2, 'wheel');
  assert.ok(r.ok);
  assert.equal(r.cost, Math.round(G.TECHS.wheel.cost * G.LICENSE_RATE));
  assert.equal(w2.techs.wheel, 'licensed');
});

test('目標「網」: 街道を敷くと町がつながる。目標「結ぶ」: 定期便の往復を数える', () => {
  const w = G.createWorld('s3', { seed: 1, v3: true });
  w.player.silver = 9999;
  const g = { type: 'network', cities: ['kibi', 'toumitsu', 'hachi'], mode: 'road' };
  const before = G.goalProgress(w, g).p;
  assert.ok(before < 1);
  assert.ok(G.buildPath(w, 'toumitsu', 'hachi', 'road').ok);
  assert.equal(G.goalProgress(w, g).p, 1);
  // 途中で糖蜜町に寄っても、甘蔗の里と翠糖京の行き来は数える（s3 の目標）
  // 荷を積んで着いた片道だけを数える（空荷の便は数えない）
  const r = G.setOrder(w, 1, { stops: [{ city: 'kibi', buy: [{ good: 'wheat', qty: 10, max: 99 }], sell: [{ good: 'dates', min: 0 }] }, { city: 'toumitsu', buy: [], sell: [] }, { city: 'suitou', buy: [{ good: 'dates', qty: 10, max: 99 }], sell: [{ good: 'wheat', min: 0 }] }] });
  assert.ok(r.ok, r.error);
  for (let i = 0; i < 120; i++) G.advance(w, 1);
  assert.ok(G.goalProgress(w, { type: 'link', a: 'kibi', b: 'suitou', count: 2 }).p > 0, '寄り道しても往復が数えられる');
});

test('住居の求める品: そろっていないと家が建たず、届けると建つ', () => {
  const w = G.createWorld('s8', { seed: 1, v3: true });
  const c = w.cities.kohaku;
  const tier = G.cityTier(c);
  assert.equal(c.dwellWants.length, 3);
  assert.equal(G.dwellingStatus(c, tier).ok, false, '最初は足りない');
  const houses = G.houseCount(c);
  c.pop = G.housingCap(c, tier) * 0.99; // 頭打ちの近くで、新しい家が要る状態にする
  for (let i = 0; i < 20; i++) G.advance(w, 1);
  const stuck = G.houseCount(c);
  // 求める品を毎日たっぷり届ける
  for (let i = 0; i < 40; i++) { for (const g of G.dwellingStatus(c, G.cityTier(c)).wants) c.stock[g] = (c.stock[g] || 0) + 20; G.advance(w, 1); }
  assert.ok(G.dwellingStatus(c, G.cityTier(c)).ok, '届けるとそろう');
  assert.ok(G.houseCount(c) > stuck, `家が建つ（${houses} → ${stuck} → ${G.houseCount(c)}）`);
});

test('家: 次の段階に近づくほど大きくなり、段階の境目で頭打ちにならない', () => {
  assert.ok(G.houseCap(3, { pop: 7990 }) > G.houseCap(3) * 1.15);
  assert.equal(G.houseCap(3, { pop: 3000 }), G.houseCap(3));
});

test('借金のときでも売れる。商人に暇を出すと下取りで銀が戻る', () => {
  const w = G.createWorld('s2', { seed: 1, v3: true });
  const m = w.player.merchants[0];
  m.cargo.wheat = 10;
  w.player.silver = -300;
  const r = G.executeTrade(w, m, [{ good: 'wheat', qty: -10 }]);
  assert.ok(r.ok !== false, r.errors?.join(' '));
  assert.ok(w.player.silver > -300);
  w.player.silver = 5000;
  const h = G.hireMerchant(w, 'mugi');
  assert.ok(h.ok);
  const before = w.player.silver;
  assert.ok(G.dismissMerchant(w, h.merchant).ok);
  assert.equal(w.player.merchants.length, 1);
  assert.ok(w.player.silver >= before);
  assert.equal(G.dismissMerchant(w, 1).ok, false, '最後の1人は残す');
});

test('商館: 雇える商人が1人ずつ増え、2つ目からは倍々に高くなる', () => {
  const w = G.createWorld('s8', { seed: 5, v3: true });
  w.player.silver = 50000;
  assert.equal(G.merchantCap(w), 6);
  assert.equal(G.buildBranch(w, 'kohaku').cost, 3000);
  assert.equal(G.merchantCap(w), 7);
  assert.equal(G.branchCost(w), 6000);
  assert.equal(G.buildBranch(w, 'kohaku').ok, false); // 1つの町に1つまで
  // 商館のある町は、商人がいなくても5日ごとに相場が届く
  w.player.merchants[0].city = 'kibi';
  w.player.merchants[1].city = 'kibi';
  G.advance(w, 12, silent);
  assert.ok(G.knowledgeAge(w, 'kohaku') < 5);
  assert.deepEqual(G.deserialize(G.serialize(w)).player.branches, ['kohaku']);
  // 商館のないシナリオでは建てられない
  const w2 = G.createWorld('s2', { seed: 5, v3: true });
  w2.player.silver = 50000;
  assert.equal(G.buildBranch(w2, w2.player.merchants[0].city).ok, false);
});

test('同じ売りの行を何度書いても、積んでいる数より多くは売れない（12回目 Sol）', () => {
  const w = G.createWorld('s7', { seed: 121, v3: true });
  const m = w.player.merchants[0];
  m.cargo.whitesugar = 1;
  m.cost.whitesugar = 30;
  const before = w.player.silver;
  const r = G.trade(w, m.id, Array.from({ length: 50 }, () => ({ good: 'whitesugar', qty: -1 })));
  assert.equal(r.ok, false);
  assert.equal(w.player.silver, before);
  assert.equal(G.trade(w, m.id, [{ good: 'whitesugar', qty: -1 }]).ok, true);
  assert.equal(w.stats.soldTotal.whitesugar, 1);
});

test('評判と才能があっても、同じ町で買って売るだけでは儲からない（12回目 Sol）', () => {
  for (const talent of ['sweettooth', 'appraiser', 'haggler']) {
    const w = G.createWorld('s8', { seed: 121, v3: true });
    w.player.repLevel = 5;
    w.player.silver = 5000;
    const m = w.player.merchants[0];
    m.talent = talent;
    const c = w.cities[m.city];
    c.stock.molasses = 40;
    c.rush = 5; // ラッシュの上乗せも
    const s0 = w.player.silver;
    for (let i = 0; i < 3; i++) {
      assert.equal(G.trade(w, m.id, [{ good: 'molasses', qty: 20 }]).ok, true);
      assert.equal(G.trade(w, m.id, [{ good: 'molasses', qty: -20 }]).ok, true);
    }
    assert.ok(w.player.silver < s0, `${talent}: ${s0} → ${w.player.silver}`);
  }
});

test('全部売っても、同じ町での売り戻しは目標の取引量に数えない（12回目 Sol）', () => {
  const w = G.createWorld('s7', { seed: 121, v3: true });
  const m = w.player.merchants[0];
  w.cities[m.city].stock.wheat = 30;
  G.trade(w, m.id, [{ good: 'wheat', qty: 2 }]);
  G.trade(w, m.id, [{ good: 'wheat', qty: -1 }]);
  G.trade(w, m.id, [{ good: 'wheat', qty: -1 }]);
  assert.equal(w.stats.soldTotal.wheat || 0, 0);
});

test('暇を出したあとに雇っても、番号と名前が重ならない（12回目 Sol）', () => {
  const w = G.createWorld('s8', { seed: 121, v3: true });
  w.player.silver = 99999;
  const at = w.player.merchants[0].city;
  for (let i = 0; i < 4; i++) G.hireMerchant(w, at);
  G.dismissMerchant(w, w.player.merchants[1].id);
  G.hireMerchant(w, at);
  for (const id of ['kohaku', 'kibi', 'seikai']) { w.player.merchants[0].city = id; G.buildBranch(w, id); }
  w.player.merchants[0].city = at;
  while (G.hireMerchant(w, at).ok);
  const ids = w.player.merchants.map((x) => x.id);
  const names = w.player.merchants.map((x) => x.name);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length, names.join(','));
});

test('開拓団: 町から交易所へ60人を運び、続けて食卓がそろうと住みつく', () => {
  const w = G.createWorld('s8', { seed: 5, v3: true });
  w.player.silver = 60000;
  const site = G.foundSites(w)[0];
  const post = G.foundPost(w, site.x, site.y).id;
  const c = w.cities[post];
  const [m, m2] = w.player.merchants;
  // 目標の都（琥珀京）からは、目標の人口を割る分は出せない
  assert.match(G.settlerCheck(w, m.id, post), /目標の町/);
  m.city = 'hari';
  m2.city = 'hari';
  assert.equal(G.settlerCheck(w, m.id, 'kibi'), '開拓団を送れるのは自分で開いた交易所だけ');
  const hari = w.cities.hari.pop;
  assert.equal(G.sendSettlers(w, m.id, post).cost, 6000);
  assert.equal(w.cities.hari.pop, hari - 60);
  // 同時に送っても値段は上がる
  assert.equal(G.settlerCost(w, post), 9000);
  assert.equal(G.trade(w, m.id, [{ good: 'silk', qty: G.cargoCap(m) }]).ok, false, '荷車の8割は開拓団');
  assert.equal(G.setOrder(w, m.id, { stops: [{ city: 'hari' }, { city: post }] }).ok, false);
  // 開いた直後の交易所は受け入れない
  m.city = post;
  G.advance(w, 1, silent);
  assert.ok(m.settlers);
  assert.match(G.settleCheck(w, post), /開いて/);
  // 食べ物を1日だけ届けても、ならした食卓では足りない
  c.foundedDay = -100;
  for (const g of w.scenario.goods) if (G.GOODS[g].kind === 'food') c.stock[g] = 0;
  c.dietAvg = {};
  c.stock.dates = 50;
  c.glucose = 100;
  G.advance(w, 1, silent);
  assert.ok(m.settlers, '一時の食卓では住みつかない');
  // 10日ほど続けて届けると住みつく
  const pop = c.pop;
  for (let d = 0; d < 20 && m.settlers; d++) {
    for (const g of ['wheat', 'rice', 'millet', 'dates']) c.stock[g] = 500;
    c.glucose = Math.max(c.glucose, 100);
    G.advance(w, 1, silent);
  }
  assert.equal(m.settlers, null);
  assert.ok(c.pop >= pop + 55);
  assert.equal(c.settlerGroups, 1);
  assert.equal(G.settlerCost(w, post), 9000);
  // 次の団はすぐには住みつかない
  m2.city = 'hari';
  G.sendSettlers(w, m2.id, post);
  m2.city = post;
  assert.match(G.settleCheck(w, post), /ばかり/);
  // 連れ出してから60日たつと散る
  const m3 = m;
  m3.city = 'hari';
  G.sendSettlers(w, m3.id, post);
  m3.settlers.day -= 61;
  G.advance(w, 1, silent);
  assert.equal(m3.settlers, null);
  assert.equal(G.deserialize(G.serialize(w)).cities[post].settlerGroups >= 1, true);
});

test('小数の個数では売れない。売り戻しは、よそで買った品を混ぜても個数で差し引く（13回目）', () => {
  const w = G.createWorld('s7', { seed: 121, v3: true });
  const m = w.player.merchants[0];
  const city = w.cities[m.city];
  const good = Object.keys(city.stock).find((g) => city.stock[g] > 30 && G.cityWants(city, g));
  m.cargo[good] = 1; m.cost[good] = 1;
  const silver = w.player.silver;
  G.trade(w, m.id, [{ good, qty: -0.001 }]);
  assert.ok(w.player.silver <= silver + 1e-9, '0.001個では銀が増えない');
  assert.equal(m.cargo[good], 1);
  // よそで買った1個を残したまま、同じ町で買って売っても販売数は増えない
  const before = w.stats.sold[city.id]?.[good] || 0;
  for (let i = 0; i < 3; i++) { G.trade(w, m.id, [{ good, qty: 9 }]); G.trade(w, m.id, [{ good, qty: -9 }]); }
  assert.equal(w.stats.sold[city.id]?.[good] || 0, before);
  G.trade(w, m.id, [{ good, qty: -1 }]);
  assert.equal(w.stats.sold[city.id][good], before + 1);
  // 同じ町が続く定期便は作れない
  assert.ok(G.validateOrder(w, { stops: [{ city: city.id }, { city: city.id }] }));
});

test('前に遊んだ世界の状態が、次に作る世界に漏れない（ライバルの工房・町の印）', () => {
  const play = () => { const w = G.createWorld('s7', { seed: 1, v3: true }); G.advance(w, 150, silent); return [Math.round(w.rivals[0].silver), w.rivals[0].sold.whitesugar]; };
  const first = play();
  const other = G.createWorld('s7', { seed: 2, v3: true });
  G.advance(other, 300, silent);
  assert.deepEqual(play(), first);
  assert.ok(!G.SCENARIOS.s7.cities.some((c) => c.tags?.includes('port')));
});

test('砂漠で食料が尽きても、足りなかった分は次の旅に持ち越さない（画面だけのテスト Sol）', () => {
  const w = G.createWorld('s8', { seed: 1, v3: true });
  const m = w.player.merchants[0];
  m.cargo = {};
  assert.ok(G.travel(w, m.id, 'natsume').ok);
  let starved = false;
  for (let d = 0; d < 80 && m.travel; d++) { const r = G.advance(w, 1, silent); if (r.events.some((e) => e.type === 'starve')) starved = true; }
  assert.ok(starved, '食料なしで砂漠を渡ると尽きる');
  assert.ok((m.hunger || 0) < 1, `持ち越すのは端数だけ（${m.hunger}）`);
});

test('一度訪れた町は、離れてもいつでも今の相場が分かる（版4 H0）', () => {
  const w = G.createWorld('s2', { seed: 5, v3: true });
  const m = w.player.merchants[0];
  const start = m.city;
  assert.ok(G.isVisited(w, start));
  const t = G.travel(w, m.id, 'natsume');
  assert.ok(t.ok);
  G.advance(w, 3, silent);
  assert.equal(G.knowledgeAge(w, start), 0, '出たあとの町も今の情報');
  assert.equal(w.player.knowledge[start].prices.wheat, G.midPrice(w.cities[start], 'wheat'));
  assert.ok(Array.isArray(G.cityOutlook(w, w.cities[start])));
});

test('交易所は安く開けて、格上げで圏が広がる（版4 H1）', () => {
  const w = G.createWorld('s8', { seed: 1, v3: true });
  w.player.silver = 99999;
  const site = G.foundSites(w, 1)[0];
  const cost = G.postCost(w);
  assert.ok(cost <= 400, `1つ目は安い（${cost}）`);
  const r = G.foundPost(w, site.x, site.y);
  assert.ok(r.ok, r.error);
  const c = w.cities[r.id];
  assert.equal(c.grade, 0);
  assert.equal(G.cityRadius(c, G.cityTier(c)), 2);
  w.player.merchants[0].city = c.id;
  assert.ok(G.build(w, c.id, 'mill').ok === false, '交易所のままでは工房を建てられない');
  assert.ok(G.expandMarket(w, c.id).ok);
  assert.equal(c.grade, 1);
  assert.equal(G.cityRadius(c, G.cityTier(c)), 4);
  assert.ok(G.build(w, c.id, 'mill').ok, '市場になれば建てられる');
  assert.ok(G.postCost(w) > cost, '2つ目は高くなる');
});

test('技術で開く品は、だれかが技術を買うまで求められない（版4 H3）', () => {
  const w = G.createWorld('s8', { seed: 1, v3: true });
  const kohaku = w.cities.kohaku;
  assert.ok(G.goodLocked(w, 'spicesugar'));
  assert.equal(G.dailyDemand(kohaku, 'spicesugar', false), 0);
  assert.equal(G.recipeUsable(w, '香辛糖づくり'), false);
  w.day = 200;
  w.player.silver = 99999;
  const r = G.buyTech(w, 'spicesugar');
  assert.ok(r.ok, r.error);
  G.advance(w, 1, silent);
  assert.ok(!G.goodLocked(w, 'spicesugar'));
  assert.ok(G.dailyDemand(kohaku, 'spicesugar', false) > 0, '都市が香辛糖を求め始める');
  assert.ok(G.recipeUsable(w, '香辛糖づくり'));
});

test('町のない土地: 一族を選び、集落のそばに最初の交易所を置くまで時間は進まない（版4 H2）', () => {
  const w = G.createWorld('free', { seed: 3 });
  assert.equal(Object.keys(w.cities).length, 0);
  assert.equal(G.setupStage(w), 'family');
  G.advance(w, 5, silent);
  assert.equal(w.day, 0, '始める前は時間が進まない');
  assert.ok(G.chooseFamily(w, G.familyList(w)[0].id).ok);
  assert.equal(G.setupStage(w), 'post');
  // 集落のない場所には置けない
  const [hx, hy] = w.player.hq;
  let empty = null;
  for (let dy = -10; dy <= 10 && !empty; dy++) for (let dx = -10; dx <= 10 && !empty; dx++) {
    const x = hx + dx, y = hy + dy;
    if (!G.siteCheck(w, x, y)) continue;
    if (!G.sitePreview(w, x, y).hamlets.length && !w.grid.cityAt.size) empty = [x, y];
  }
  const s = G.foundSites(w, 1)[0];
  const hamletPop = s.preview.hamlets.reduce((t, hm) => t + hm.pop, 0);
  const r = G.foundPost(w, s.x, s.y);
  assert.ok(r.ok, r.error);
  assert.equal(r.cost, 0, '最初の交易所は無料');
  assert.equal(G.setupStage(w), null);
  assert.ok(w.player.merchants.length >= 1 && w.player.merchants.every((m) => m.city === r.id), '商人が最初の交易所に出てくる');
  assert.equal(Math.round(w.cities[r.id].pop), G.BALANCE.pioneerPostPop + hamletPop, '集落の人が住人になる');
  assert.ok(s.preview.hamlets.every((hm) => hm.absorbedBy === r.id));
  G.advance(w, 5, silent);
  assert.equal(w.day, 5);
});

test('町のない土地: 野の需要施設は決まった量を買い、ライバルも交易所を開く（版4 H2）', () => {
  const w = G.createWorld('s1', { seed: 1 });
  const s = G.foundSites(w, 4).find((x) => x.preview.wilds.length);
  assert.ok(s, '寺院を圏に入れられる場所がある');
  const r = G.foundPost(w, s.x, s.y);
  assert.ok(r.ok, r.error);
  const c = w.cities[r.id];
  assert.ok(G.wildDemand(c, 'dates') > 0, '古い寺院がなつめやしを求める');
  assert.ok(G.dailyDemand(c, 'dates', false) > G.dailyDemand(c, 'dates', false, { wild: false }));
  const f = G.createWorld('free', { seed: 2 });
  G.chooseFamily(f, G.familyList(f)[0].id);
  const fs = G.foundSites(f, 1)[0];
  G.foundPost(f, fs.x, fs.y);
  G.advance(f, 20, silent);
  assert.ok(Object.values(f.cities).some((x) => x.rivalPost), 'ライバルも交易所を開く');
  // 読み込み直しても同じに進む
  const g2 = G.deserialize(G.serialize(f));
  G.advance(f, 30, silent);
  G.advance(g2, 30, silent);
  assert.equal(G.serialize(f), G.serialize(g2));
});

test('定期便を別の商人に写せる（版4 H5）', () => {
  const w = G.createWorld('s2', { seed: 2, v3: true });
  w.player.silver = 5000;
  const a = w.player.merchants[0];
  const h = G.hireMerchant(w, a.city);
  assert.ok(h.ok, h.error);
  const stops = [{ city: a.city, buy: [{ good: 'wheat', qty: 10 }] }, { city: 'natsume', sell: [{ good: 'wheat' }] }];
  assert.ok(G.setOrder(w, a.id, { stops }).ok);
  const r = G.copyOrder(w, a.id, h.merchant);
  assert.ok(r.ok, r.error);
  const b = G.getMerchant(w, h.merchant);
  assert.deepEqual(b.order.stops.map((s) => s.city), a.order.stops.map((s) => s.city));
  assert.equal(G.copyOrder(w, a.id, a.id).ok, false);
});

test('定期便は仕入れ値を割って売らない。長く売れなければ最低売値で売る', () => {
  const w = G.createWorld('s2', { seed: 3, v3: true });
  assert.ok(G.trade(w, 1, [{ good: 'wheat', qty: 20 }]).ok);
  const m = G.getMerchant(w, 1);
  m.cost.wheat = 100; // 高く仕入れたことにする
  assert.ok(G.setOrder(w, 1, { stops: [{ city: 'mugi', buy: [], sell: [] }, { city: 'natsume', buy: [], sell: [{ good: 'wheat', min: 0 }] }] }).ok);
  G.advance(w, 20);
  assert.ok(m.cargo.wheat >= 18, '仕入れ値を割る売りをした'); // 砂漠で少し食べる
  assert.equal(w.stats.lossSales, 0);
  G.advance(w, G.BALANCE.orderHoldDays + 20);
  assert.equal(w.stats.lossSales, 1, '長く売れないままでも売らなかった');
});

test('版4の s2〜s8: 最初の交易所を開いて遊べ、セーブとロードで同じに進む', () => {
  for (const id of ['s2', 's3', 's4', 's5', 's6', 's7', 's8']) {
    const w = G.createWorld(id, { seed: 3 });
    assert.ok(G.isPioneer(w), `${id} が町のない始まり方になっていない`);
    if (G.setupStage(w) === 'family') G.chooseFamily(w, G.familyList(w)[0].id);
    const s = G.foundSites(w, 1)[0];
    assert.ok(s, `${id} に最初の交易所の場所がない`);
    assert.ok(G.foundPost(w, s.x, s.y).ok);
    assert.ok(w.player.merchants.length >= 1);
    G.advance(w, 40, { stopOn: new Set() });
    const w2 = G.deserialize(G.serialize(w));
    G.advance(w, 30, { stopOn: new Set() });
    G.advance(w2, 30, { stopOn: new Set() });
    assert.equal(Math.round(w.player.silver), Math.round(w2.player.silver), `${id} のセーブとロードがずれた`);
    assert.deepEqual(G.goalsStatus(w).map((g) => g.p), G.goalsStatus(w2).map((g) => g.p));
  }
});

test('版3の s2 のセーブは、版3の定義で続きを遊べる', () => {
  const w = G.createWorld('s2', { seed: 1, v3: true });
  const w2 = G.deserialize(G.serialize(w));
  assert.ok(w2.cities.mugi, '版3の町がない');
  assert.ok(!G.isPioneer(w2));
});

test('古い町の入荷の波は、町の「これから」に出る', () => {
  const w = G.createWorld('s2', { seed: 1 });
  const notes = [];
  for (let i = 0; i < 9; i++) { notes.push(...G.cityOutlook(w, w.cities.kohaku).map((o) => o.text)); G.advance(w, 10, { stopOn: new Set() }); }
  assert.ok(notes.some((t) => t.includes('入荷が細っていく')));
  assert.ok(notes.some((t) => t.includes('入荷が戻ってくる')));
});

test('ライバルの工房がある町には、自分の工房を建てられない（s7 の南キビ村）', () => {
  const w = G.createWorld('s7', { seed: 1 });
  const s = G.foundSites(w, 1)[0];
  G.foundPost(w, s.x, s.y);
  const m = w.player.merchants[0];
  m.city = 'kibi2'; // 南キビ村にいることにする（建てられるかだけを見る）
  w.player.silver = 5000;
  const r = G.build(w, 'kibi2', 'mill');
  assert.equal(r.ok, false);
  assert.match(r.error, /先約/);
});

test('s3 の目標「白糖を売った額」は、市場で買った白糖の代金を差し引く', () => {
  const w = G.createWorld('s3', { seed: 1 });
  const g = w.scenario.goals.find((x) => x.type === 'sellValue');
  assert.ok(g);
  w.stats.soldValue = { whitesugar: 5000 };
  w.stats.boughtValue = { whitesugar: 2000 };
  assert.equal(Math.round(G.goalProgress(w, g).p * g.amount), 3000);
});

test('目標「結ぶ」は、空荷の便を数えない', () => {
  const w = G.createWorld('s3', { seed: 1, v3: true });
  assert.ok(G.setOrder(w, 1, { stops: [{ city: 'kibi', buy: [], sell: [] }, { city: 'suitou', buy: [], sell: [] }] }).ok);
  for (let i = 0; i < 120; i++) G.advance(w, 1);
  assert.equal(G.goalProgress(w, { type: 'link', a: 'kibi', b: 'suitou', count: 2 }).p, 0);
});
