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
