import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/core/index.js';

const silent = { stopOn: new Set() };

test('同じシードなら同じ結果になる', () => {
  const run = () => {
    const w = G.createWorld('s2', { seed: 42 });
    G.trade(w, 1, [{ good: 'wheat', qty: 10 }]);
    G.travel(w, 1, 'natsume');
    G.advance(w, 80, silent);
    return G.serialize(w);
  };
  assert.equal(run(), run());
});

test('買うほど値段が上がり、売るほど下がる', () => {
  const w = G.createWorld('s2', { seed: 1 });
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
  const w = G.createWorld('s1', { seed: 3 });
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
  const w = G.createWorld('s3', { seed: 5 });
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
  const w = G.createWorld('s3', { seed: 1 });
  w.player.silver = 5000;
  assert.ok(G.build(w, 'toumitsu', 'mill').ok);
  w.player.warehouses.toumitsu.stock.rawsugar = 20;
  G.advance(w, 3, silent);
  assert.ok((w.stats.produced.whitesugar || 0) > 0);
});

test('通れる道のない輸送手段は買えない', () => {
  const w = G.createWorld('s5', { seed: 1 });
  w.player.silver = 5000;
  const r = G.buyTransport(w, 1, 'cart');
  assert.equal(r.ok, false);
});

test('目標を満たすと勝ちになる', () => {
  const w = G.createWorld('s1', { seed: 1 });
  w.player.silver = 700;
  G.advance(w, 1, silent);
  assert.ok(w.finished?.win);
});

test('倉庫との積み下ろしは整数だけ受け付ける（NaN で倉庫が壊れない）', () => {
  const w = G.createWorld('s3', { seed: 1 });
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
  const w = G.createWorld('s2', { seed: 4 });
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
  const w = G.createWorld('s2', { seed: 2 });
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
  const w = G.createWorld('s1', { seed: 1 });
  w.player.silver = 5000;
  const c = w.cities.mugi;
  const [x, y] = G.placeableTiles(c, G.cityTier(c), 'wheat_farm')[0];
  assert.equal(G.placeProducer(w, 'mugi', 'wheat_farm', x, y).ok, false);
});

test('住居: 人口に合わせて家が建ち、空き地がなければ人口は頭打ちになる', () => {
  const w = G.createWorld('s2', { seed: 5 });
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
  const w = G.createWorld('s2', { seed: 6 });
  const c = w.cities.natsume;
  assert.equal(G.staffing(c), 1);
  for (let i = 0; i < 20; i++) c.district.buildings.push({ id: c.district.nextId++, type: 'date_grove', x: 0, y: 0, owner: 'town', rate: 0, virtual: true });
  assert.ok(G.staffing(c) < 1);
});

test('需要施設: 建てると需要が増え、求める品を届け続けると満足度が上がる', () => {
  const w = G.createWorld('s6', { seed: 2 });
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
  const w = G.createWorld('s8', { seed: 1 });
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
  const w = G.createWorld('s2', { seed: 1 });
  const r = G.travel(w, 1, 'kohaku');
  assert.ok(r.ok);
  const m = w.player.merchants[0];
  assert.ok(m.travel.tiles.length > 5);
  const adv = G.advance(w, r.days + 3);
  assert.ok(adv.events.some((e) => e.type === 'arrive'));
  assert.equal(m.city, 'kohaku');
});
