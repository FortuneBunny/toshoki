// RimWorld 風の交易画面
// 左が商人の積荷、右が町の在庫。矢印は「品物が動く方向」。< で買う（町→積荷）、> で売る（積荷→町）。
// 動かせない方向のボタンは隠し、数量が0でなければ外側のボタンが「0」（リセット）になる。
import { h, clear, goodIcon, icon, fmt } from './dom.js';
import { sparkline } from './sparkline.js';
import * as G from '../core/index.js';

const { GOODS, CATEGORIES } = G;

export function openTrade(app, merchantId) {
  const world = app.world;
  const m = G.getMerchant(world, merchantId);
  const city = world.cities[m.city];
  const qty = {}; // good -> 数量（+買い / -売り）
  const wh = world.player.warehouses[m.city];
  const whQty = {}; // good -> 倉庫との移動（+積む / -下ろす）
  let sortBy = 'category';
  let onlyTradeable = false;

  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-label': '交易' });
  back.append(modal);

  const tip = h('div', { class: 'tip hidden' });
  document.body.append(tip);
  function showTip(e, html) {
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    tip.style.left = `${Math.min(innerWidth - 290, e.clientX + 14)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  }
  const hideTip = () => tip.classList.add('hidden');

  function lines() {
    return Object.entries(qty).filter(([, q]) => q).map(([good, q]) => ({ good, qty: q }));
  }

  // 1つの品物について、動かせる範囲
  function limits(id) {
    const have = m.cargo[id] || 0;
    const stock = Math.floor(city.stock[id] || 0);
    const wants = G.cityWants(city, id);
    return { maxBuy: stock, maxSell: wants ? have : 0 };
  }

  function preview() {
    return G.preview(world, m.id, lines());
  }

  function setQty(id, q, e) {
    const { maxBuy, maxSell } = limits(id);
    q = Math.max(-maxSell, Math.min(maxBuy, Math.round(q)));
    qty[id] = q;
    app.sfx.click();
    render();
  }

  function step(e) {
    return e.shiftKey ? 10 : e.ctrlKey || e.metaKey ? 100 : 1;
  }

  // 積載と銀の範囲で、あと何個買えるか
  function maxAffordable(id) {
    const base = { ...qty, [id]: 0 };
    const rest = Object.entries(base).filter(([, q]) => q).map(([good, q]) => ({ good, qty: q }));
    let lo = 0;
    let hi = limits(id).maxBuy;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const pv = G.preview(world, m.id, [...rest, { good: id, qty: mid }]);
      if (pv.ok) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function priceTip(id, kind) {
    const g = GOODS[id];
    const stock = Math.floor(city.stock[id] || 0);
    const target = G.targetStock(city, id);
    const spread = G.spreadFor(world);
    const lv = world.player.repLevel;
    const k = world.player.knowledge[m.city];
    const hist = k?.history?.[id] || [];
    return `<b>${g.name}</b>（基準 ${g.base} 銀）<br>
      町の在庫 ${stock} / 町が持ちたい量 ${Math.round(target)}<br>
      → 在庫が少ないほど高く、多いほど安い<br>
      手数料 ${(spread * 100).toFixed(1)}%${lv ? `（評判Lv${lv}で割引）` : ''}<br>
      ${kind === 'sell' && m.cost[id] ? `仕入れ値 ${fmt(m.cost[id], 1)} 銀<br>` : ''}
      ${hist.length > 1 ? `最近の相場: ${hist.slice(-8).map((x) => fmt(x[1], 1)).join(' → ')}` : ''}`;
  }

  function render() {
    clear(modal);
    const pv = preview();
    const cap = G.cargoCap(m);
    const goods = [...world.scenario.goods];
    if (sortBy === 'price') goods.sort((a, b) => GOODS[b].base - GOODS[a].base);
    else goods.sort((a, b) => Object.keys(CATEGORIES).indexOf(GOODS[a].cat) - Object.keys(CATEGORIES).indexOf(GOODS[b].cat));
    const wanted = goods.filter((id) => G.cityWants(city, id) || (city.stock[id] || 0) >= 1);
    const unwanted = goods.filter((id) => !wanted.includes(id) && (m.cargo[id] || 0) > 0);
    const shown = onlyTradeable ? wanted.filter((id) => (m.cargo[id] || 0) > 0 || (city.stock[id] || 0) >= 1) : wanted;

    const header = h('header', {},
      icon(`transport/${m.portrait}`, 'icon-lg'),
      h('h2', {}, `交易 — ${city.name}`),
      h('span', { class: 'dim' }, `交渉役: ${m.name}（評判Lv${world.player.repLevel}${world.player.repLevel ? `、手数料 -${Math.round(Math.min(0.8, world.player.repLevel * G.BALANCE.repSpreadCut) * 100)}%` : ''}）`),
      h('button', { class: 'btn ghost small', onclick: close, 'aria-label': '閉じる' }, '✕'));

    const head = h('div', { class: 'trade-head' },
      h('div', { class: 'side-l' }, `${m.name}の積荷`),
      h('div', { class: 'hint' }, '＋は買う（町→積荷）／－は売る（積荷→町）', h('br'), 'Shift: 10個ずつ　Ctrl: 100個ずつ'),
      h('div', { class: 'side-r' }, `${city.name}の市場`, h('div', { class: 'dim', style: { fontSize: '12px', fontWeight: 500 } }, `${G.tierName(G.cityTier(city))}・人口 ${fmt(city.pop)}・糖度 ${Math.round(city.glucose)}${city.rush ? '・🍬ラッシュ中' : ''}${city.crash ? '・💥クラッシュ中' : ''}`)));

    const tools = h('div', { class: 'trade-tools' },
      h('span', { class: 'dim' }, '並び替え:'),
      h('button', { class: `btn tiny ${sortBy === 'category' ? 'primary' : 'ghost'}`, onclick: () => { sortBy = 'category'; render(); } }, '種類'),
      h('button', { class: `btn tiny ${sortBy === 'price' ? 'primary' : 'ghost'}`, onclick: () => { sortBy = 'price'; render(); } }, '価格'),
      h('label', { style: { marginLeft: '8px' } }, h('input', { type: 'checkbox', checked: onlyTradeable || undefined, onchange: (e) => { onlyTradeable = e.target.checked; render(); } }), ' 取引できる品だけ'),
      h('span', { style: { marginLeft: 'auto' }, class: 'dim' }, '価格にカーソルを合わせると内訳'));

    const table = h('div', {});
    table.append(h('div', { class: 'trow head' },
      h('span'), h('span', {}, '品物'), h('span', { class: 'r' }, '積荷'), h('span', { class: 'r' }, '売値'), h('span', { class: 'r' }, ''),
      h('span', { style: { textAlign: 'center' } }, '数量'), h('span'), h('span', { class: 'r' }, '買値'), h('span', { class: 'r' }, '在庫'), h('span', { class: 'r' }, '推移')));
    // 銀の行（固定、差額が自動で入る）
    const delta = pv.silverDelta;
    table.append(h('div', { class: 'trow silver' },
      icon('ui/silver', 'icon'), h('span', { class: 'nm' }, '銀'), h('span', { class: 'r num' }, fmt(world.player.silver)), h('span'), h('span'),
      h('div', { class: `qty ${delta > 0.5 ? 'buy' : delta < -0.5 ? 'sell' : ''}`, style: { display: 'flex', alignItems: 'center', justifyContent: 'center' } }, delta ? `${delta > 0 ? '+' : ''}${fmt(delta)}` : '0'),
      h('span'), h('span'), h('span', { class: 'r faint' }, '自動'), h('span')));

    const row = (id, dim) => {
      const g = GOODS[id];
      const have = m.cargo[id] || 0;
      const stock = Math.floor(city.stock[id] || 0);
      const q = qty[id] || 0;
      const { maxBuy, maxSell } = limits(id);
      const sell = maxSell > 0 || G.cityWants(city, id) ? G.unitSell(world, city, id) : null;
      const buy = stock > 0 ? G.unitBuy(world, city, id) : null;
      const cheapness = (p) => (p < g.base * 0.75 ? 'cheap' : p > g.base * 1.35 ? 'dear' : '');
      // 左側（買う方向: <<, <）
      const left = h('div', { class: 'arrows l' });
      if (q > 0 || maxBuy > 0) {
        if (q < 0) left.append(h('button', { class: 'btn tiny', title: '0に戻す', onclick: () => setQty(id, 0) }, '0'));
        else if (q < maxBuy) left.append(h('button', { class: 'btn tiny', title: '買えるだけ買う', onclick: () => setQty(id, maxAffordable(id)) }, '«'));
        if (q < maxBuy) left.append(h('button', { class: 'btn tiny', title: '1個買う（Shift: 10 / Ctrl: 100）', onclick: (e) => setQty(id, q + step(e)) }, '‹'));
      }
      const right = h('div', { class: 'arrows r' });
      if (q < 0 || maxSell > 0) {
        if (q > -maxSell) right.append(h('button', { class: 'btn tiny', title: '1個売る（Shift: 10 / Ctrl: 100）', onclick: (e) => setQty(id, q - step(e)) }, '›'));
        if (q > 0) right.append(h('button', { class: 'btn tiny', title: '0に戻す', onclick: () => setQty(id, 0) }, '0'));
        else if (q > -maxSell) right.append(h('button', { class: 'btn tiny', title: '全部売る', onclick: () => setQty(id, -maxSell) }, '»'));
      }
      const input = h('input', {
        class: `qty ${q > 0 ? 'buy' : q < 0 ? 'sell' : ''}`, value: q ? (q > 0 ? `+${q}` : q) : '0', inputmode: 'numeric',
        'aria-label': `${g.name}の数量`,
        onchange: (e) => setQty(id, parseInt(e.target.value, 10) || 0),
        onfocus: (e) => e.target.select(),
      });
      const hist = world.player.knowledge[m.city]?.history?.[id] || [];
      const sp = hist.length > 1 ? sparkline(hist.map((x) => x[1]), 56, 18) : h('span');
      const r = h('div', { class: `trow ${q ? 'active' : ''} ${dim ? 'unwanted' : ''}` },
        goodIcon(id), h('span', { class: 'nm', title: CATEGORIES[g.cat] }, g.name, g.kind === 'sweet' ? h('span', { class: 'faint', style: { fontSize: '10px' } }, ' 甘') : null),
        h('span', { class: 'r num' }, have ? fmt(have) : ''),
        h('span', { class: `r num price ${sell ? cheapness(sell) : ''}`, onmousemove: (e) => sell && showTip(e, priceTip(id, 'sell')), onmouseleave: hideTip }, sell ? fmt(sell, 1) : '—'),
        left, input, right,
        h('span', { class: `r num price ${buy ? cheapness(buy) : ''}`, onmousemove: (e) => buy && showTip(e, priceTip(id, 'buy')), onmouseleave: hideTip }, buy ? fmt(buy, 1) : '—'),
        h('span', { class: 'r num' }, stock ? fmt(stock) : ''),
        sp);
      return r;
    };
    for (const id of shown) table.append(row(id, false));
    if (unwanted.length) {
      table.append(h('div', { class: 'faint', style: { margin: '6px 4px 2px', fontSize: '12px' } }, `── ${city.name}では買い取らない品 ──`));
      for (const id of unwanted) table.append(row(id, true));
    }

    // 倉庫（工房のある町だけ）
    let whBox = null;
    if (wh) {
      whBox = h('div', { style: { marginTop: '10px' } }, h('div', { class: 'section' }, `自分の倉庫（${city.name}）`));
      const ids = world.scenario.goods.filter((id) => (wh.stock[id] || 0) >= 1 || (m.cargo[id] || 0) > 0);
      if (!ids.length) whBox.append(h('div', { class: 'faint' }, '倉庫は空'));
      for (const id of ids) {
        const n = Math.floor(wh.stock[id] || 0);
        whBox.append(h('div', { class: 'trow' }, goodIcon(id), h('span', { class: 'nm' }, GOODS[id].name), h('span', { class: 'r num' }, m.cargo[id] || ''),
          h('span'), h('span'),
          h('div', { class: 'arrows', style: { justifyContent: 'center', gridColumn: 'span 3' } },
            h('button', { class: 'btn tiny', disabled: !n || undefined, onclick: () => act(() => G.warehouse(world, m.id, id, Math.min(n, Math.floor((cap - G.cargoUsed(m)) / GOODS[id].weight))), '積んだ') }, '« 積む'),
            h('button', { class: 'btn tiny', disabled: !(m.cargo[id] > 0) || undefined, onclick: () => act(() => G.warehouse(world, m.id, id, -m.cargo[id]), '下ろした') }, '下ろす »')),
          h('span', { class: 'r num' }, n), h('span')));
      }
    }

    // 右のまとめ
    const buys = lines().filter((l) => l.qty > 0);
    const sells = lines().filter((l) => l.qty < 0);
    const rowTotal = (good) => pv.rows.find((r) => r.good === good)?.total || 0;
    let expectProfit = 0;
    for (const l of sells) expectProfit += rowTotal(l.good) - (m.cost[l.good] || 0) * -l.qty;
    const over = pv.cargoAfter > cap;
    const summary = h('div', { class: 'trade-summary' },
      h('h4', {}, h('span', {}, `買う`), h('span', { class: 'bad num' }, buys.length ? fmt(buys.reduce((s, l) => s + rowTotal(l.good), 0)) : '')),
      buys.length ? buys.map((l) => h('div', { class: 'line' }, goodIcon(l.good, 'icon-sm'), GOODS[l.good].name, h('span', { class: 'num' }, `×${l.qty}`))) : h('div', { class: 'faint' }, 'なし'),
      h('h4', {}, h('span', {}, `売る`), h('span', { class: 'good num' }, sells.length ? `+${fmt(sells.reduce((s, l) => s + rowTotal(l.good), 0))}` : '')),
      sells.length ? sells.map((l) => h('div', { class: 'line' }, goodIcon(l.good, 'icon-sm'), GOODS[l.good].name, h('span', { class: 'num' }, `×${-l.qty}`))) : h('div', { class: 'faint' }, 'なし'),
      sells.length ? h('div', { class: expectProfit >= 0 ? 'good' : 'bad' }, `見込み利益 ${expectProfit >= 0 ? '+' : ''}${fmt(expectProfit)} 銀`) : null,
      h('h4', {}, h('span', {}, '積載'), h('span', { class: 'num' }, `${pv.cargoAfter} / ${cap}`)),
      h('div', { class: `capacity ${over ? 'over' : ''}` }, h('i', { style: { width: `${Math.min(100, (pv.cargoAfter / cap) * 100)}%` } })),
      h('h4', {}, h('span', {}, '取引後の銀')),
      h('div', { class: `total-big num ${world.player.silver + pv.silverDelta < 0 ? 'bad' : ''}` }, fmt(world.player.silver + pv.silverDelta)),
      h('div', { class: 'dim num' }, `${fmt(world.player.silver)} → ${pv.silverDelta >= 0 ? '+' : ''}${fmt(pv.silverDelta)}`),
      pv.ok ? null : h('div', { class: 'bad', style: { fontSize: '12px' } }, pv.errors.join(' / ')),
      contractsHere());

    const footer = h('footer', {},
      h('button', { class: 'btn ghost', onclick: () => { for (const k of Object.keys(qty)) qty[k] = 0; render(); } }, 'リセット'),
      h('button', { class: 'btn ghost', onclick: close }, 'キャンセル'),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn', onclick: () => { close(); app.pickDestination(m.id); } }, '取引せずに出発…'),
      h('button', { class: 'btn primary', disabled: !lines().length || !pv.ok || undefined, onclick: (e) => accept(e, true) }, '確定して出発…'),
      h('button', { class: 'btn primary', disabled: !lines().length || !pv.ok || undefined, onclick: (e) => accept(e, false) }, '取引を確定'));

    modal.append(header, h('div', { class: 'body' }, h('div', { class: 'trade' }, h('div', { class: 'trade-main' }, head, tools, table, whBox), summary)), footer);
  }

  function contractsHere() {
    const cs = world.contracts.filter((c) => c.city === city.id && !c.done && !c.failed);
    if (!cs.length) return null;
    return h('div', {}, h('h4', {}, '大口注文'), cs.map((c) => h('div', { class: 'contract' }, goodIcon(c.good, 'icon-sm'), `${GOODS[c.good].name} ${c.delivered}/${c.qty}（残り${c.deadline - world.day}日）報酬 ${c.reward}`)));
  }

  function act(fn, msg) {
    const r = fn();
    if (!r.ok) app.error(r.error);
    render();
    app.render();
  }

  function accept(e, thenDepart) {
    const btn = e.currentTarget.getBoundingClientRect();
    const before = world.player.silver;
    const r = G.trade(world, m.id, lines());
    if (!r.ok) { app.error(r.error); return; }
    app.afterTrade(r, btn.left + btn.width / 2, btn.top, before);
    close();
    if (thenDepart) app.pickDestination(m.id);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  function close() {
    back.remove();
    tip.remove();
    document.removeEventListener('keydown', onKey);
    app.modalClosed();
  }

  render();
  document.body.append(back);
  return { close };
}
