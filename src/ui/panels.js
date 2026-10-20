// 右側のパネル、モーダル（出発、定期便、帳簿、設定、ヘルプ、結果、タイトル）
import { h, add, clear, icon, goodIcon, fmt } from './dom.js';
import { sparkline } from './sparkline.js';
import * as G from '../core/index.js';
import { RULES } from '../data/help.js';

const { GOODS, TRANSPORTS, BUILDINGS, HEIRLOOMS, SCENARIOS, SCENARIO_ORDER } = G;

export function modal(app, title, body, footer, { wide = false, onClose } = {}) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const box = h('div', { class: 'modal', style: { maxWidth: wide ? '1100px' : '640px' }, role: 'dialog', 'aria-label': title });
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
    app.modalClosed();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  add(box, h('header', {}, h('h2', {}, title), h('button', { class: 'btn ghost small', onclick: close, 'aria-label': '閉じる' }, '✕')), h('div', { class: 'body' }, body));
  if (footer) add(box, h('footer', {}, typeof footer === 'function' ? footer(close) : footer));
  add(back, box);
  add(document.body, back);
  return { close, box };
}

// ---------- 右パネル ----------
export function renderSide(app, el) {
  const world = app.world;
  clear(el);
  const cityId = app.state.selCity;
  if (cityId) add(el, cityPanel(app, cityId));
  else add(el, overview(app));
}

function gaugeBlock(g, target) {
  return h('div', {},
    h('div', { class: 'gauge' }, h('div', { class: 'fill', style: { width: `${Math.min(100, (g / 200) * 100)}%` } }), target !== undefined ? h('div', { class: 'target', style: { left: `${Math.min(100, (target / 200) * 100)}%` } }) : null),
    h('div', { class: 'gauge-legend' }, h('span', {}, '飢え'), h('span', {}, '40'), h('span', {}, '安定'), h('span', {}, '110 活況'), h('span', {}, '140 ラッシュ')));
}

function cityPanel(app, id) {
  const world = app.world;
  const c = world.cities[id];
  const here = world.player.merchants.filter((m) => m.city === id);
  const k = world.player.knowledge[id];
  const age = G.knowledgeAge(world, id);
  const box = h('div', {});
  add(box, h('div', { class: 'panel-title' }, icon(`cities/tier${G.cityTier(c)}`, 'icon-lg'), h('div', {}, c.name, h('div', { class: 'dim', style: { fontSize: '12px', fontWeight: 500 } }, `${G.tierName(G.cityTier(c))}${c.tags.includes('desert') ? '・砂漠' : ''}${c.tags.includes('port') ? '・港' : ''}`)),
    h('button', { class: 'btn ghost small', style: { marginLeft: 'auto' }, onclick: () => { app.state.selCity = null; app.render(); } }, '✕')));
  if (here.length) {
    const tier = G.cityTier(c);
    const next = G.BALANCE.tierPops[tier + 1];
    add(box, 
      h('div', { class: 'section' }, '糖度（町の血糖値）'),
      gaugeBlock(c.glucose, c.glucoseTarget),
      h('dl', { class: 'kv' },
        h('dt', {}, '糖度'), h('dd', {}, `${Math.round(c.glucose)}（向かう先 ${Math.round(c.glucoseTarget)}）${c.rush ? ` 🍬ラッシュ あと${c.rush}日` : ''}${c.crash ? ` 💥クラッシュ あと${c.crash}日` : ''}`),
        h('dt', {}, '人口'), h('dd', {}, `${fmt(c.pop)}${next ? ` / 次の段階 ${fmt(next)}` : ''}`),
        h('dt', {}, '成長'), h('dd', { class: G.growthPerDay(c) >= 0 ? 'good' : 'bad' }, `${(G.growthPerDay(c) * 100).toFixed(2)}% / 日`)),
      h('div', { class: 'section' }, '食卓（糖度への寄与）'),
      dietChips(world, c),
      h('div', { class: 'faint', style: { fontSize: '11px' } }, `甘味の摂取 ${Math.round((c.sweetLevel || 0) * 100)}（75以上かつ糖度140以上でシュガーラッシュ）。1種類の食べ物で上げられるのは50まで、甘味は45まで。`),
      adviceBlock(world, c));
  } else {
    add(box, h('div', { class: 'faint' }, age === null ? 'まだ訪れていない町。商人を送ると相場が分かる。' : `最後に見たのは ${age} 日前。今どうなっているかは分からない。`));
    if (k?.glucose !== undefined) add(box, h('div', { class: 'section' }, `糖度（${age}日前）`), gaugeBlock(k.glucose));
  }
  // 相場
  if (k) {
    add(box, h('div', { class: 'section' }, `相場 ${age === 0 ? '（今）' : `（${age}日前の情報）`}`));
    const t = h('table', { class: 'prices-table' }, h('tr', {}, h('th', {}, '品物'), h('th', {}, '中値'), h('th', {}, '在庫'), h('th', {}, '推移')));
    for (const gid of world.scenario.goods) {
      const p = k.prices?.[gid];
      if (p === undefined) continue;
      const hist = k.history?.[gid] || [];
      const want = k.wants?.[gid] !== false;
      add(t, h('tr', {}, h('td', {}, goodIcon(gid, 'icon-sm'), ' ', GOODS[gid].name, want ? '' : h('span', { class: 'faint' }, ' 買取なし')), h('td', { class: `num ${p < GOODS[gid].base * 0.75 ? 'good' : p > GOODS[gid].base * 1.35 ? 'bad' : ''}` }, fmt(p, 1)), h('td', { class: 'num' }, k.stock?.[gid] ?? '?'), h('td', {}, hist.length > 1 ? sparkline(hist.map((x) => x[1]), 50, 16) : '')));
    }
    add(box, t);
  }
  const prod = Object.entries(c.produces);
  if (prod.length) add(box, h('div', { class: 'section' }, '特産'), h('div', { class: 'chips' }, prod.map(([g, r]) => h('span', { class: 'chip' }, goodIcon(g, 'icon-sm'), `${GOODS[g].name} ${fmt(r, 1)}/日`))));
  // この町でできること
  const acts = h('div', { class: 'chips', style: { gap: '6px' } });
  if (here.length) {
    const max = world.scenario.maxMerchants ?? 4;
    if (world.player.merchants.length < max) {
      const cost = G.BALANCE.merchantHireCost * world.player.merchants.length;
      add(acts, h('button', { class: 'btn small', onclick: () => app.confirm(`商人を雇う（${cost}銀）`, `${c.name}で新しい商人を雇います。給金は1日${G.BALANCE.merchantWage}銀。最大${max}人。`, () => app.run(() => G.hireMerchant(world, id), 'hire')) }, `商人を雇う ${cost}銀`));
    }
    for (const b of (world.scenario.buildings || []).filter((x) => BUILDINGS[x]?.recipes)) {
      if (world.player.buildings.some((x) => x.city === id && x.type === b)) continue;
      const def = BUILDINGS[b];
      add(acts, h('button', { class: 'btn small', onclick: () => app.confirm(`${def.name}を建てる（${def.cost}銀）`, recipeText(def), () => app.run(() => G.build(world, id, b), 'build')) }, `${def.name} ${def.cost}銀`));
    }
  }
  if (acts.children.length) add(box, h('div', { class: 'section' }, 'この町でできること'), acts);
  const bs = world.player.buildings.filter((b) => b.city === id);
  if (bs.length) {
    add(box, h('div', { class: 'section' }, '自分の工房と倉庫'));
    for (const b of bs) {
      add(box, h('div', { class: 'contract' }, icon(`cities/${b.type}`, 'icon'), h('div', { style: { flex: 1 } }, h('b', {}, BUILDINGS[b.type].name), h('div', { class: 'faint' }, recipeText(BUILDINGS[b.type]))),
        h('button', { class: 'btn tiny', onclick: () => app.run(() => G.setBuilding(world, b.id, { active: !b.active })) }, b.active ? '稼働中' : '停止中'),
        h('button', { class: 'btn tiny', title: '足りない材料を市場から買う', onclick: () => app.run(() => G.setBuilding(world, b.id, { autoBuy: !b.autoBuy })) }, b.autoBuy ? '自動購入あり' : '自動購入なし')));
    }
    const wh = world.player.warehouses[id];
    const items = Object.entries(wh?.stock || {}).filter(([, q]) => q >= 1);
    add(box, h('div', { class: 'chips' }, items.length ? items.map(([g, q]) => h('span', { class: 'chip' }, goodIcon(g, 'icon-sm'), `${GOODS[g].name} ${Math.floor(q)}`)) : h('span', { class: 'faint' }, '倉庫は空')));
  }
  const cs = world.contracts.filter((x) => x.city === id && !x.done && !x.failed);
  if (cs.length) add(box, h('div', { class: 'section' }, '大口注文'), cs.map((x) => contractEl(world, x)));
  // 道
  add(box, h('div', { class: 'section' }, '道'));
  for (const e of world.edges.filter((x) => x.a === id || x.b === id)) {
    const other = world.cities[e.a === id ? e.b : e.a];
    const canRoad = (world.scenario.buildings || []).includes('road') && e.kind === 'trail';
    add(box, h('div', { class: 'dim', style: { fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' } },
      `→ ${other.name}  ${G.ROUTE_KINDS[e.kind].name}  距離${e.len}${e.danger ? `  ⚔危険度${e.danger}` : ''}${e.monsoon ? '  季節風' : ''}`,
      canRoad ? h('button', { class: 'btn tiny', onclick: () => app.confirm(`街道に整備（${Math.round(e.len * BUILDINGS.road.costPerLength)}銀）`, '小道を街道にすると荷車が通れる。', () => app.run(() => G.upgradeRoad(world, e.id), 'road')) }, '整備') : null));
  }
  return box;
}

function recipeText(def) {
  return def.recipes.map((r) => `${Object.entries(r.in).map(([g, n]) => `${GOODS[g].name}${n}`).join('+')} → ${Object.entries(r.out).map(([g, n]) => `${GOODS[g].name}${n}`).join('+')}`).join(' / ') + `（1日${def.batches}回、維持費${def.upkeep}/日）`;
}

function adviceBlock(world, c) {
  const adv = G.dietAdvice(world, c).slice(0, 5);
  if (!adv.length) return null;
  return h('div', {}, h('div', { class: 'section' }, '伸びしろ（1日あたりの目安量）'),
    h('div', { class: 'chips' }, adv.map((a) => h('span', { class: 'chip', title: `${GOODS[a.good].name}を1日に約${fmt(a.perDay, 1)}個届け続けると、糖度が最大+${a.gain}` }, goodIcon(a.good, 'icon-sm'), `約${fmt(a.perDay, 1)}個/日 → +${a.gain}`))));
}

function dietChips(world, c) {
  const diet = Object.entries(c.diet || {}).sort((a, b) => b[1] - a[1]);
  const box = h('div', { class: 'chips' });
  for (const [g, v] of diet) add(box, h('span', { class: 'chip' }, goodIcon(g, 'icon-sm'), `${GOODS[g].name} +${Math.round(v * 100)}`));
  const missing = world.scenario.goods.filter((g) => GOODS[g].kind === 'food' && G.dailyDemand(c, g, false) > 0 && !(c.diet?.[g] > 0.02));
  for (const g of missing) add(box, h('span', { class: 'chip', style: { opacity: 0.55, outline: '1px dashed #8c7b63' } }, goodIcon(g, 'icon-sm'), `${GOODS[g].name} 不足`));
  if (!box.children.length) add(box, h('span', { class: 'faint' }, '何も食べていない'));
  return box;
}

function contractEl(world, c) {
  const left = c.deadline - world.day;
  return h('div', { class: 'contract' }, icon('ui/contract', 'icon'), goodIcon(c.good, 'icon-sm'),
    h('div', { style: { flex: 1 } }, `${world.cities[c.city].name}: ${GOODS[c.good].name} ${c.delivered}/${c.qty}`, h('div', { class: left < 10 ? 'bad' : 'faint' }, `残り${left}日・報酬 ${c.reward}銀`)));
}

function overview(app) {
  const world = app.world;
  const box = h('div', {});
  const sc = world.scenario;
  add(box, h('div', { class: 'panel-title' }, `${sc.no}. ${sc.title}`));
  add(box, h('div', { class: 'dim', style: { fontSize: '12px' } }, sc.intro));
  add(box, h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '4px' } }, `ランク: S=${Math.floor(sc.deadline * (sc.rankS ?? 0.55))}日以内 / A=${Math.floor(sc.deadline * 0.75)}日以内 / B=期限内`));
  const active = world.contracts.filter((c) => !c.done && !c.failed);
  if (active.length) add(box, h('div', { class: 'section' }, '大口注文'), active.map((c) => contractEl(world, c)));
  // 全部の町の相場（知っている範囲）
  add(box, h('div', { class: 'section' }, '知っている相場'));
  const t = h('table', { class: 'prices-table' });
  add(t, h('tr', {}, h('th', {}, '町'), ...sc.goods.map((g) => h('th', { title: GOODS[g].name }, goodIcon(g, 'icon-sm')))));
  for (const c of Object.values(world.cities)) {
    const k = world.player.knowledge[c.id];
    const age = G.knowledgeAge(world, c.id);
    const cls = age === null ? 'faint' : age <= 3 ? 'age-fresh' : age <= 15 ? 'age-old' : 'age-stale';
    add(t, h('tr', { style: { cursor: 'pointer' }, onclick: () => { app.state.selCity = c.id; app.render(); } },
      h('td', {}, c.name, h('div', { class: cls, style: { fontSize: '10px' } }, age === null ? '未訪問' : age === 0 ? '今' : `${age}日前`)),
      ...sc.goods.map((g) => {
        const p = k?.prices?.[g];
        if (p === undefined) return h('td', { class: 'faint' }, '?');
        const want = k.wants?.[g] !== false;
        return h('td', { class: `num ${p < GOODS[g].base * 0.75 ? 'good' : p > GOODS[g].base * 1.35 ? 'bad' : ''}`, style: want ? {} : { opacity: 0.4 } }, fmt(p, p < 10 ? 1 : 0));
      })));
  }
  add(box, h('div', { class: 'table-scroll' }, t), h('div', { class: 'faint', style: { fontSize: '11px' } }, '緑=安い（仕入れどき）、赤=高い（売りどき）。情報は商人が最後にいたときのもの。'));
  // 定期便
  const orders = world.player.merchants.filter((m) => m.order);
  if (orders.length) {
    add(box, h('div', { class: 'section' }, '定期便の成績'));
    for (const m of orders) {
      const days = Math.max(1, world.day - m.order.since);
      add(box, h('div', { class: 'dim', style: { fontSize: '12px' } }, `${m.name}: ${m.order.stops.map((s) => world.cities[s.city].name).join('→')} `, h('span', { class: (m.order.profit || 0) >= 0 ? 'good' : 'bad' }, `${fmt(m.order.profit || 0)}銀（${fmt((m.order.profit || 0) / days, 1)}/日）`), m.order.paused ? ' 停止中' : ''));
    }
  }
  return box;
}

// ---------- 出発 ----------
export function departDialog(app, mid, to) {
  const world = app.world;
  const m = G.getMerchant(world, mid);
  const route = G.findPath(world, m.city, to, m.transport);
  const dest = world.cities[to];
  let guards = route.edges.some((e) => e.danger) && world.scenario.bandits ? 2 : 0;
  const desertDays = route.edges.filter((e) => e.kind === 'desert').reduce((s, e) => s + G.edgeDays(world, e, m.transport, e.a), 0);
  const food = G.PROVISIONS.reduce((s, g) => s + (m.cargo[g] || 0), 0);
  const need = Math.ceil(desertDays * G.cargoCap(m) * G.BALANCE.provisionPerCap);
  const k = world.player.knowledge[to];
  const body = h('div', {});
  const draw = () => {
    clear(body);
    add(body, 
      h('div', {}, `${route.path.map((id) => world.cities[id].name).join(' → ')}`),
      h('div', { class: 'total-big' }, `約 ${route.days} 日`),
      route.edges.some((e) => e.monsoon) ? h('div', { class: 'dim' }, `季節: ${G.SEASON_NAMES[G.seasonOf(world)]}（追い風なら速く、向かい風なら遅い）`) : null,
      desertDays ? h('div', { class: food >= need ? 'good' : 'bad' }, `砂漠 約${desertDays}日。隊商の食料 ${food} / 必要 ${need}${food < need ? '（足りない！なつめやし・干しぶどう・キビ・麦・米を積もう）' : ''}`) : null,
      route.edges.some((e) => e.danger) && world.scenario.bandits ? h('div', {},
        h('div', { class: 'amber' }, `⚔ 盗賊の出る道（最大危険度 ${Math.max(...route.edges.map((e) => e.danger))}）`),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' } }, icon('transport/guard', 'icon'), '護衛',
          h('button', { class: 'btn tiny', onclick: () => { guards = Math.max(0, guards - 1); draw(); } }, '−'), h('b', { class: 'num' }, guards), h('button', { class: 'btn tiny', onclick: () => { guards = Math.min(12, guards + 1); draw(); } }, '＋'),
          h('span', { class: 'dim' }, `費用 約${guards * G.BALANCE.guardWage * route.days}銀`))) : null,
      k ? h('div', { class: 'dim', style: { marginTop: '6px' } }, `${dest.name}の相場は${G.knowledgeAge(world, to)}日前の情報。着く頃には ${G.knowledgeAge(world, to) + route.days} 日前の情報になる。`) : h('div', { class: 'dim' }, `${dest.name}の相場はまだ知らない。`),
      Object.keys(m.cargo).length && k ? h('div', { class: 'chips' }, Object.entries(m.cargo).map(([g, q]) => {
        const p = k.prices?.[g];
        const want = k.wants?.[g] !== false;
        return h('span', { class: 'chip' }, goodIcon(g, 'icon-sm'), `${GOODS[g].name}×${q} ${p !== undefined && want ? `≈${fmt(p, 1)}` : '買取なし?'}`);
      })) : null);
  };
  draw();
  modal(app, `${m.name} → ${dest.name}`, body, (close) => [
    h('button', { class: 'btn ghost', onclick: close }, 'やめる'),
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn primary', onclick: () => { close(); app.depart(mid, to, guards); } }, '出発！'),
  ]);
}

// ---------- 定期便 ----------
export function orderDialog(app, mid) {
  const world = app.world;
  const m = G.getMerchant(world, mid);
  const goods = world.scenario.goods;
  // 下書き: 既存の定期便 → 直近の取引 → 今いる町と隣町
  let stops;
  if (m.order) stops = JSON.parse(JSON.stringify(m.order.stops));
  else {
    const recent = (m.recent || []).slice(-2);
    if (recent.length === 2 && recent[0].city !== recent[1].city) {
      stops = recent.map((r) => ({
        city: r.city,
        buy: Object.entries(r.buy).map(([g, q]) => ({ good: g, qty: q, max: Math.ceil(GOODS[g].base * 1.1 * 10) / 10 })),
        sell: Object.keys(r.sell).map((g) => ({ good: g, min: Math.floor((m.cost[g] || GOODS[g].base * 0.6) * 1.1 * 10) / 10 })),
      }));
      // 片方で買った品は、もう片方で売る
      for (let i = 0; i < 2; i++) for (const b of stops[i].buy) if (!stops[1 - i].sell.some((x) => x.good === b.good)) stops[1 - i].sell.push({ good: b.good, min: Math.floor(GOODS[b.good].base * 0.8 * 10) / 10 });
    } else {
      const here = m.city || m.travel?.to;
      const nb = G.neighbors(world, here).map((e) => (e.a === here ? e.b : e.a))[0];
      stops = [{ city: here, buy: [], sell: [] }, { city: nb, buy: [], sell: [] }];
    }
  }
  const body = h('div', {});
  const cityOpts = (sel) => Object.values(world.cities).map((c) => h('option', { value: c.id, selected: c.id === sel || undefined }, c.name));
  const goodOpts = (sel) => goods.map((g) => h('option', { value: g, selected: g === sel || undefined }, GOODS[g].name));
  const draw = () => {
    clear(body);
    add(body, h('div', { class: 'dim', style: { marginBottom: '8px', fontSize: '12px' } }, '停泊地を順番に回り続ける。最低売値より安ければ売らずに持ち越し、上限買値より高ければ買わない（赤字を防ぐ）。直近の取引から下書きを作っています。'));
    stops.forEach((st, i) => {
      const box = h('div', { class: 'order-stop' });
      add(box, h('div', { class: 'row' }, h('b', {}, `${i + 1}.`), h('select', { onchange: (e) => { st.city = e.target.value; } }, cityOpts(st.city)),
        h('span', { style: { flex: 1 } }), stops.length > 2 ? h('button', { class: 'btn tiny danger', onclick: () => { stops.splice(i, 1); draw(); } }, '削除') : null));
      (st.sell ||= []).forEach((x, j) => add(box, h('div', { class: 'row' }, '売る', h('select', { onchange: (e) => { x.good = e.target.value; } }, goodOpts(x.good)), '最低', h('input', { type: 'number', step: '0.1', value: x.min, onchange: (e) => { x.min = Number(e.target.value); } }), '銀', h('button', { class: 'btn tiny ghost', onclick: () => { st.sell.splice(j, 1); draw(); } }, '✕'))));
      (st.buy ||= []).forEach((x, j) => add(box, h('div', { class: 'row' }, '買う', h('select', { onchange: (e) => { x.good = e.target.value; } }, goodOpts(x.good)), h('input', { type: 'number', value: x.qty, onchange: (e) => { x.qty = Number(e.target.value); } }), '個まで、上限', h('input', { type: 'number', step: '0.1', value: x.max === Infinity ? '' : x.max, onchange: (e) => { x.max = e.target.value === '' ? Infinity : Number(e.target.value); } }), '銀', h('button', { class: 'btn tiny ghost', onclick: () => { st.buy.splice(j, 1); draw(); } }, '✕'))));
      if (world.player.warehouses[st.city]) {
        add(box, h('div', { class: 'row' }, '倉庫:', h('label', {}, '下ろす ', h('select', { onchange: (e) => { st.unload = e.target.value ? [e.target.value] : []; } }, h('option', { value: '' }, '—'), goodOpts((st.unload || [])[0]))),
          h('label', {}, ' 積む ', h('select', { onchange: (e) => { st.load = e.target.value ? [e.target.value] : []; } }, h('option', { value: '' }, '—'), goodOpts((st.load || [])[0])))));
      }
      add(box, h('div', { class: 'row' },
        h('button', { class: 'btn tiny', onclick: () => { st.sell.push({ good: goods[0], min: GOODS[goods[0]].base * 0.8 }); draw(); } }, '+ 売る品'),
        h('button', { class: 'btn tiny', onclick: () => { st.buy.push({ good: goods[0], qty: 20, max: GOODS[goods[0]].base }); draw(); } }, '+ 買う品')));
      add(body, box);
    });
    add(body, h('button', { class: 'btn small', onclick: () => { stops.push({ city: Object.keys(world.cities)[0], buy: [], sell: [] }); draw(); } }, '+ 停泊地を追加'));
  };
  draw();
  modal(app, `${m.name}の定期便`, body, (close) => [
    m.order ? h('button', { class: 'btn danger', onclick: () => { G.clearOrder(world, mid); close(); app.render(); } }, '定期便を解除') : null,
    m.order && !m.order.paused ? h('button', { class: 'btn ghost', onclick: () => { const r = G.pauseOrderAtNext(world, mid); app.toast(r.now ? '定期便を止めた' : '次の町で止まる'); close(); app.render(); } }, '次の町で止める') : null,
    m.order?.paused ? h('button', { class: 'btn', onclick: () => { app.run(() => G.resumeOrder(world, mid)); close(); } }, '再開') : null,
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn ghost', onclick: close }, 'キャンセル'),
    h('button', { class: 'btn primary', onclick: () => { const r = G.setOrder(world, mid, { stops }); if (!r.ok) return app.error(r.error); close(); app.afterOrder(mid); } }, '定期便を開始'),
  ], { wide: true });
}

// ---------- 帳簿 ----------
export function ledgerDialog(app) {
  const world = app.world;
  const s = world.stats;
  const body = h('div', {},
    h('dl', { class: 'kv' },
      h('dt', {}, '資産'), h('dd', { class: 'num' }, `${fmt(G.netWorth(world))} 銀`),
      h('dt', {}, '売上'), h('dd', { class: 'num' }, `${fmt(s.revenue)} 銀`),
      h('dt', {}, '仕入れ'), h('dd', { class: 'num' }, `${fmt(s.spent)} 銀`),
      h('dt', {}, '取引の利益'), h('dd', { class: 'num good' }, `${fmt(s.profit)} 銀`),
      h('dt', {}, '売却'), h('dd', {}, `${s.sales}回（赤字 ${s.lossSales}回）`),
      h('dt', {}, '読み的中'), h('dd', {}, `${s.hits}回`),
      h('dt', {}, '最長連続黒字'), h('dd', {}, `${world.player.maxStreak}`),
      h('dt', {}, '大口注文'), h('dd', {}, `${s.contracts}件達成`),
      h('dt', {}, 'シュガーラッシュ'), h('dd', {}, `${s.rushes}回`),
      s.banditLoss ? [h('dt', {}, '盗賊の被害'), h('dd', { class: 'bad' }, `約${fmt(s.banditLoss)}銀`)] : null),
    s.history.length > 2 ? h('div', {}, h('div', { class: 'section' }, '銀の推移'), sparkline(s.history.map((x) => x[1]), 560, 90)) : null,
    h('div', { class: 'section' }, '商人ごとの累計損益'),
    world.player.merchants.map((m) => h('div', {}, `${m.name}: `, h('span', { class: m.lifetime >= 0 ? 'good' : 'bad' }, `${fmt(m.lifetime)} 銀`))));
  modal(app, '帳簿', body);
}

export function helpDialog(app) {
  const body = h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.7 } }, RULES,
    '\n\n【操作】\n・商人のカードの「交易」で売り買い、「出発」で行き先を地図から選ぶ。\n・交易画面の ‹ › で1個、Shift で10個、Ctrl で100個。« で買えるだけ、» で全部売る。\n・スペースキーで一時停止／再開。1〜3キーで速度。\n・手動の商人が町に着くと自動で一時停止する（設定で変えられる）。');
  modal(app, '遊び方', body);
}

export function settingsDialog(app) {
  const st = app.settings;
  const body = h('div', {},
    h('div', { class: 'section' }, '演出の強さ'),
    h('div', { class: 'chips' }, ['控えめ', '標準', '最大'].map((n, i) => h('button', { class: `btn small ${st.fx === i ? 'primary' : 'ghost'}`, onclick: () => { app.setSetting('fx', i); settingsRefresh(); } }, n))),
    h('div', { class: 'section' }, '効果音'),
    h('div', { class: 'chips' }, h('button', { class: `btn small ${st.sound ? 'primary' : 'ghost'}`, onclick: () => { app.setSetting('sound', !st.sound); settingsRefresh(); } }, st.sound ? 'オン' : 'オフ')),
    h('div', { class: 'section' }, '自動一時停止'),
    h('label', {}, h('input', { type: 'checkbox', checked: st.autoPause || undefined, onchange: (e) => app.setSetting('autoPause', e.target.checked) }), ' 手動の商人が町に着いたら一時停止する'));
  let m;
  function settingsRefresh() { m.close(); settingsDialog(app); }
  m = modal(app, '設定', body);
}

// ---------- 結果 ----------
export function resultDialog(app) {
  const world = app.world;
  const f = world.finished;
  const sc = world.scenario;
  const next = SCENARIO_ORDER[SCENARIO_ORDER.indexOf(sc.id) + 1];
  let chosen = null;
  const body = h('div', { class: 'result' });
  if (f.win) {
    add(body, h('img', { class: 'rank-img', src: `assets/svg/ui/rank-${f.rank.toLowerCase()}.svg`, alt: `ランク${f.rank}` }),
      h('h2', { style: { fontFamily: 'var(--font-title)', fontSize: '30px', margin: '6px 0' } }, `ランク ${f.rank}`),
      h('div', { class: 'dim' }, `${f.day}日目に達成（期限 ${sc.deadline}日、S基準 ${Math.floor(sc.deadline * (sc.rankS ?? 0.55))}日）`),
      h('div', { class: 'total-big', style: { margin: '6px 0' } }, `資産 ${fmt(f.score)} 銀`),
      h('div', { class: 'dim' }, `読み的中 ${world.stats.hits}回・最長連続黒字 ${world.player.maxStreak}・大口注文 ${world.stats.contracts}件・ラッシュ ${world.stats.rushes}回`));
    if (next) {
      const hb = h('div', { class: 'heirlooms' });
      const draw = () => {
        clear(hb);
        for (const [k, x] of Object.entries(HEIRLOOMS)) add(hb, h('div', { class: `heirloom ${chosen === k ? 'sel' : ''}`, onclick: () => { chosen = k; draw(); } }, h('b', {}, x.name), x.text));
      };
      draw();
      add(body, h('div', { class: 'section', style: { marginTop: '14px' } }, '家訓を1つ選んで次の世代へ受け継ぐ（重ねがけできる）'), hb);
    }
  } else {
    add(body, h('img', { class: 'rank-img', src: 'assets/svg/ui/rank-c.svg', alt: 'ランクC' }), h('h2', {}, '期限切れ'),
      h('div', { class: 'dim' }, G.goalsStatus(world).filter((g) => !g.done).map((g) => g.text).join(' / ')));
  }
  modal(app, f.win ? '目標達成！' : 'シナリオ失敗', body, (close) => [
    h('button', { class: 'btn ghost', onclick: () => { close(); world.continueAfterEnd = true; app.render(); } }, 'このまま遊び続ける'),
    h('button', { class: 'btn ghost', onclick: () => { close(); app.startScenario(sc.id); } }, 'やり直す'),
    h('span', { style: { flex: 1 } }),
    f.win && next ? h('button', { class: 'btn primary', onclick: () => { if (!chosen) return app.error('家訓を選んでください'); close(); app.inherit(chosen); app.startScenario(next); } }, '次のシナリオへ') : h('button', { class: 'btn primary', onclick: () => { close(); app.showTitle(); } }, 'タイトルへ'),
  ], { wide: false });
}

// ---------- タイトル ----------
export function titleScreen(app) {
  const camp = app.campaign;
  const el = h('div', { class: 'title-screen' });
  const list = h('div', { class: 'scen-list hidden', style: { width: 'min(980px, 100%)' } });
  for (const [i, id] of SCENARIO_ORDER.entries()) {
    const sc = SCENARIOS[id];
    const unlocked = i === 0 || camp.cleared[SCENARIO_ORDER[i - 1]];
    const rank = camp.cleared[id];
    add(list, h('div', { class: `scen ${unlocked ? '' : 'locked'}`, onclick: () => unlocked && (el.remove(), app.startScenario(id)) },
      rank ? h('img', { class: 'rank', src: `assets/svg/ui/rank-${rank.toLowerCase()}.svg`, alt: rank }) : null,
      h('div', { class: 'no' }, `シナリオ ${sc.no}`), h('h3', {}, sc.title), h('p', {}, unlocked ? sc.intro : '前のシナリオを達成すると遊べる')));
  }
  const hasSave = app.hasSave();
  add(el, 
    h('img', { class: 'logo', src: 'assets/svg/ui/logo.svg', alt: '' }),
    h('h1', {}, '糖商記'),
    h('div', { class: 'sub' }, 'GREAT GLUCOSE EMPIRE'),
    h('div', { class: 'dim', style: { maxWidth: '520px', textAlign: 'center', fontSize: '13px' } }, '町は糖で動いている。相場を読み、隊商を走らせ、糖を届けて町を育てよ。甘味は熱狂を生む──やりすぎなければ。'),
    h('div', { class: 'menu' },
      hasSave ? h('button', { class: 'btn primary', onclick: () => { el.remove(); app.loadSave(); } }, '続きから') : null,
      h('button', { class: `btn ${hasSave ? '' : 'primary'}`, onclick: () => list.classList.toggle('hidden') }, 'シナリオを選ぶ'),
      h('button', { class: 'btn', title: '毎回ちがう地図で遊ぶ', onclick: () => { el.remove(); app.startScenario('free'); } }, 'フリープレイ（ランダムな地図）'),
      h('button', { class: 'btn ghost', onclick: () => helpDialog(app) }, '遊び方')),
    list,
    camp.heirlooms.length ? h('div', { class: 'dim', style: { fontSize: '12px' } }, `受け継いだ家訓: ${camp.heirlooms.map((k) => HEIRLOOMS[k].name).join('・')}`) : '');
  add(document.body, el);
  return el;
}
