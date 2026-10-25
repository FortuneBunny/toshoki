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

// 自分の交易所の格上げ（区画の画面の奥にしかなく、見つけにくかった。第15回テスト）。家が頭打ちのときは目立たせる
function upgradeBlock(app, c) {
  const world = app.world;
  const next = c.grade + 1;
  if (next > 2) return null;
  const cost = G.expandCost(world, c.id);
  const capped = c.pop >= G.housingCap(c, G.cityTier(c)) * 0.98;
  const [cx, cy] = world.grid?.cityTiles?.[c.id] || [0, 0];
  const now = G.cityRadius(c, G.cityTier(c));
  const r = G.cityRadius({ ...c, grade: next }, 0);
  const gain = world.hamlets ? G.coveredBy(world, cx, cy, r) : { hamlets: [], wilds: [] };
  const gains = [...gain.hamlets.map((hm) => `${hm.name}（人口${hm.pop}）`), ...gain.wilds.map((w) => G.CIVICS[w.type].name)];
  const short = cost - world.player.silver;
  const presence = G.hasPresence(world, c.id);
  const why = short > 0 ? `銀があと${fmt(short)}足りない` : !presence ? '自分の商人がいるか、定期便が回っている必要がある' : '';
  return h('div', { class: `upgrade-box ${capped ? 'hot' : ''}` },
    h('div', {}, capped ? h('b', { class: 'amber' }, '⚠ 家を建てる空き地がなく、人口が頭打ち。格上げで圏を広げよう') : h('b', {}, `「${G.gradeName(next)}」に格上げできる`)),
    h('div', { class: 'dim', style: { fontSize: '12px' } }, `圏 ${now}→${r}マス。${next === 1 ? '工房と需要施設（宮殿のほか）を建てられる。' : '宮殿も建てられる。'}${gains.length ? `圏に入る: ${gains.join('、')}` : ''}`),
    h('button', { class: `btn small ${capped ? 'primary' : ''}`, disabled: !!why || undefined, title: why, onclick: () => app.confirm(`「${G.gradeName(next)}」に格上げ（${cost}銀）`, `市場の圏が${r}マスに広がります。${gains.length ? `${gains.join('、')}が圏に入ります。` : ''}`, () => app.run(() => G.expandMarket(world, c.id), 'build')) }, `「${G.gradeName(next)}」に格上げ ${fmt(cost)}銀`),
    why ? h('span', { class: 'faint', style: { fontSize: '11px', marginLeft: '6px' } }, why) : null);
}

// 買い取らない理由（「買取なし」だけでは、技術を買ったのになぜ売れないのか分からなかった。第15回テスト）
function noBuyWhy(world, c, g) {
  if (G.goodLocked(world, g)) return `買取なし（技術「${G.TECHS[Object.keys(world.scenario.techs || {}).find((t) => G.TECHS[t]?.unlocks?.goods?.includes(g))]?.name}」で開く）`;
  if (G.cityTier(c) < GOODS[g].tier) return `買取なし（「${G.tierName(GOODS[g].tier)}」になると買う）`;
  return '買取なし';
}

// この町の工房で作れる加工品と、その作り方（工房・材料・要る技術・交易所の格）
function makeBlock(app, c) {
  const world = app.world;
  const goods = world.scenario.goods.filter((g) => GOODS[g].cat !== 'raw' && G.howToMake(world, g).length);
  if (!goods.length) return null;
  const gradeOk = G.postGrade(c) >= 1;
  return h('div', {}, h('div', { class: 'section' }, '工房で作れる品'),
    gradeOk ? null : h('div', { class: 'amber', style: { fontSize: '12px' } }, `工房は「${G.gradeName(1)}」に格上げすると建てられる`),
    h('div', { style: { fontSize: '12px', lineHeight: 1.6 } }, goods.map((g) => {
      const ways = G.howToMake(world, g);
      const lock = ways.every((w) => w.lock) ? ways[0].lock : null;
      const k = world.player.knowledge[c.id];
      const price = k?.wants?.[g] !== false && k?.prices?.[g] !== undefined ? `この町で ${fmt(k.prices[g], 1)}銀` : noBuyWhy(world, c, g);
      return h('div', { class: lock ? 'faint' : '' }, goodIcon(g, 'icon-sm'), h('b', {}, ` ${GOODS[g].name}`), `: ${ways.filter((w) => !lock || w.lock === lock).slice(0, 2).map((w) => `${w.building}で ${G.recipeLine({ ...w.recipe, lock: null })}`).join(' / ')}`,
        lock ? h('span', { class: 'amber' }, `（要: 技術「${lock}」）`) : null, h('span', { class: 'dim' }, ` ・${price}`));
    })),
    Object.keys(world.scenario.techs || {}).length ? h('button', { class: 'btn tiny ghost', onclick: () => techDialog(app) }, '技術を見る') : null);
}

function cityPanel(app, id) {
  const world = app.world;
  const c = world.cities[id];
  const here = world.player.merchants.filter((m) => m.city === id);
  const k = world.player.knowledge[id];
  const age = G.knowledgeAge(world, id);
  const box = h('div', {});
  add(box, h('div', { class: 'panel-title' }, icon(`cities/tier${G.cityTier(c)}`, 'icon-lg'), h('div', {}, c.name, h('div', { class: 'dim', style: { fontSize: '12px', fontWeight: 500 } }, `${G.tierName(G.cityTier(c))}${c.founded && c.grade !== undefined ? `・自分の${G.gradeName(c.grade)}` : ''}${c.rivalPost ? `・${c.rivalPost}の${G.gradeName(c.grade)}` : ''}${c.tags.includes('desert') ? '・砂漠' : ''}${c.tags.includes('port') ? '・港' : ''}${world.player.branches?.includes(id) ? '・自分の商館' : ''}`)),
    h('button', { class: 'btn ghost small', style: { marginLeft: 'auto' }, onclick: () => { app.state.selCity = null; app.render(); } }, '✕')));
  if (c.founded && c.grade !== undefined && !c.rivalPost) add(box, upgradeBlock(app, c));
  if (here.length || c.founded || G.isVisited(world, id)) { // 一度訪れた町と自分の交易所は、いつでも今の様子が分かる
    const tier = G.cityTier(c);
    const next = G.BALANCE.tierPops[tier + 1];
    const look = G.cityOutlook(world, c);
    add(box, 
      look.length ? h('div', { class: 'outlook' }, look.map((o) => h('div', { class: `ol ${o.kind}` }, o.text))) : null,
      h('div', { class: 'section' }, '糖度（町の血糖値）'),
      gaugeBlock(c.glucose, c.glucoseTarget),
      h('dl', { class: 'kv' },
        h('dt', {}, '糖度'), h('dd', {}, `${Math.round(c.glucose)}（向かう先 ${Math.round(c.glucoseTarget)}）${c.rush ? ` 🍬ラッシュ あと${c.rush}日` : ''}${c.crash ? ` 💥クラッシュ あと${c.crash}日` : ''}`),
        h('dt', {}, '人口'), h('dd', {}, `${fmt(c.pop)}${next ? ` / 次の段階 ${fmt(next)}` : ''}`),
        h('dt', {}, '成長'), h('dd', { class: G.growthPerDay(c) >= 0 ? 'good' : 'bad' }, `${(G.growthPerDay(c) * 100).toFixed(2)}% / 日`, G.growthBlocker(world, c) ? h('div', { class: 'dim', style: { fontSize: '11px' } }, `止めているもの: ${G.growthBlocker(world, c)}`) : null),
        c.founded && G.settlersAllowed(world) ? h('dt', {}, '開拓団') : null,
        c.founded && G.settlersAllowed(world) ? h('dd', {}, `${c.settlerGroups || 0}/${G.BALANCE.settlerMax}団 住みついた${world.player.merchants.some((m) => m.settlers?.to === id) ? `（運んでいる途中 ${world.player.merchants.filter((m) => m.settlers?.to === id).length}団）` : ''}`, h('div', { class: 'dim', style: { fontSize: '11px' } }, G.settleCheck(world, id) ? `受け入れ ✖ ${G.settleCheck(world, id)}` : '受け入れ ○ 今なら住みつける')) : null,
        h('dt', {}, '住居'), h('dd', {}, `家 ${G.houseCount(c)}軒・住める人数 ${fmt(G.housingCap(c, tier))}${c.pop >= G.housingCap(c, tier) * 0.98 ? '（頭打ち）' : ''}`),
        h('dt', { title: '町が育つほど求める品が増える。1つ欠けまでそろえば新しい家が建つ' }, '住居の求め'), h('dd', {}, dwellingEl(c, tier, world)),
        h('dt', {}, '働き手'), h('dd', { class: G.staffing(c) < 1 ? 'bad' : '' }, `${fmt(G.workersAvailable(c))}人（必要 ${fmt(G.workersNeeded(c))}）${G.staffing(c) < 1 ? ` 生産 ${Math.round(G.staffing(c) * 100)}%` : ''}`)),
      G.civicsIn(c).length ? h('div', {}, h('div', { class: 'section' }, '需要施設'), h('div', { class: 'chips' }, G.civicsIn(c).map((b) => h('span', { class: 'chip', title: `${G.CIVICS[b.type].name}: ${G.civicWants(b.type, world.scenario.goods).map((g) => GOODS[g].name).join('・')}が届くほど成長` }, h('img', { src: `assets/svg/cities/${G.CIVICS[b.type]?.img || b.type}.svg`, class: 'icon-sm', alt: '' }), `${G.CIVICS[b.type].name} 満足度 ${Math.round((c.civicSat?.[b.type] || 0) * 100)}%`)))) : null,
      h('div', { class: 'section' }, '食卓（糖度への寄与）'),
      dietChips(world, c),
      h('div', { class: 'dim', style: { fontSize: '12px', lineHeight: 1.6 } }, `甘味の摂取 ${Math.round((c.sweetLevel || 0) * 100)}%（今日の甘味の必要量のうち食べた割合）。${Math.round(G.BALANCE.rushSweetLine * 100)}%以上かつ糖度${G.rushLineOf(world)}以上でシュガーラッシュ。1種類の食べ物で上げられるのは50まで、甘味は45まで。`),
      adviceBlock(world, c));
  } else {
    add(box, h('div', { class: 'faint' }, 'まだ訪れていない町。商人を送ると、そのあとはいつでも相場と様子が分かる。'));
  }
  // 相場
  if (k) {
    add(box, h('div', { class: 'section' }, age === 0 ? '相場（今）' : '相場（噂で聞いた値だけ）'));
    const t = h('table', { class: 'prices-table' }, h('tr', {}, h('th', {}, '品物'), h('th', {}, '中値'), h('th', {}, '在庫'), h('th', {}, '推移')));
    for (const gid of world.scenario.goods) {
      const p = k.prices?.[gid];
      if (p === undefined) continue;
      const hist = k.history?.[gid] || [];
      const want = k.wants?.[gid] !== false;
      add(t, h('tr', {}, h('td', {}, goodIcon(gid, 'icon-sm'), ' ', GOODS[gid].name, want ? '' : h('span', { class: 'faint' }, ` ${noBuyWhy(world, c, gid)}`)), h('td', { class: `num ${p < GOODS[gid].base * 0.75 ? 'good' : p > GOODS[gid].base * 1.35 ? 'bad' : ''}` }, fmt(p, 1)), h('td', { class: 'num' }, k.stock?.[gid] ?? '?'), h('td', {}, hist.length > 1 ? sparkline(hist.map((x) => x[1]), 50, 16) : '')));
    }
    add(box, t);
  }
  const prod = Object.entries(c.produces).filter(([, r]) => r > 0);
  // 作る量・食べる量・余り。特産でも町が自分で食べ切ると、買える在庫は残らない
  // （「蜂蜜 1.4/日」と出ている町で在庫が0のまま、なぜ買えないのか分からなかった。画面だけのテスト（Sol）の指摘）
  if (prod.length) add(box, h('div', { class: 'section' }, '特産（1日に作る量・町が食べる量・余り）'), h('div', { class: 'chips', style: { flexDirection: 'column', alignItems: 'flex-start' } }, prod.map(([g, r]) => {
    const eat = G.dailyDemand(c, g, false);
    const spare = r - eat;
    return h('span', { class: `chip ${spare > 0.3 ? 'good' : spare < 0 ? 'bad' : ''}`, title: spare > 0.3 ? '余りが市場にたまり、買える' : '町が自分で食べ切るので、買える在庫はほとんど残らない' },
      goodIcon(g, 'icon-sm'), `${GOODS[g].name} 作る${fmt(r, 1)}・食べる${fmt(eat, 1)} → 余り ${spare >= 0 ? '+' : ''}${fmt(spare, 1)}/日`);
  })));
  if (G.hasPresence(world, id) || c.founded) add(box, makeBlock(app, c));
  // この町でできること
  const acts = h('div', { class: 'chips', style: { gap: '6px' } });
  const selM = world.player.merchants.find((x) => x.id === app.state.selMerchant);
  if (selM && !selM.travel && selM.city !== id) {
    const r = G.findPath(world, selM.city, id, selM.transport);
    add(acts, h('button', { class: 'btn small primary', disabled: !r || undefined, title: r ? '' : `${G.TRANSPORTS[selM.transport].name}では行けない`, onclick: () => app.openDepart(selM.id, id) }, r ? `${selM.name}をここへ出発（約${r.days}日）` : `${selM.name}はここへ行けない`));
  }
  add(acts, h('button', { class: 'btn small primary', onclick: () => app.openDistrict(id) }, '区画を見る'));
  // 地図の上で建てる: 置ける生産施設と需要施設
  if (G.hasPresence(world, id) && G.districtEnabled(world)) {
    const tier = G.cityTier(c);
    const opts = [];
    for (const [k, p] of Object.entries(G.PRODUCERS)) {
      if (!world.scenario.goods.includes(p.good)) continue;
      if (['food', 'sweet'].includes(GOODS[p.good].kind) && !(c.district.native || []).includes(p.good)) continue;
      if (!G.placeableTiles(c, tier, k).length) continue;
      const spareNow = (c.produces[p.good] || 0) - G.dailyDemand(c, p.good, false);
      opts.push(h('button', { class: 'btn tiny', title: `${p.name}: ${GOODS[p.good].name} +${p.rate}/日、働き手${p.workers}人。建てると余りが ${spareNow >= 0 ? '+' : ''}${fmt(spareNow, 1)} → ${spareNow + p.rate >= 0 ? '+' : ''}${fmt(spareNow + p.rate, 1)}/日（働き手が足りれば。今の人口での目安）`, onclick: () => app.startBuild(id, 'producer', k) }, goodIcon(p.good, 'icon-sm'), ` ${p.name} ${G.producerCost(world, k)}`));
    }
    for (const k of Object.keys(G.CIVICS).filter((x) => !G.CIVICS[x].wild)) {
      if (G.civicCheck(world, id, k)) continue;
      opts.push(h('button', { class: 'btn tiny', title: G.CIVICS[k].effect, onclick: () => app.startBuild(id, 'civic', k) }, h('img', { src: `assets/svg/cities/${k}.svg`, class: 'icon-sm', alt: '' }), ` ${G.CIVICS[k].name} ${G.civicCost(world, k)}`));
    }
    if (opts.length) add(box, h('div', { class: 'section' }, '地図の上で建てる'), h('div', { class: 'chips' }, opts));
  }
  // 道を敷く・港を開く
  if (G.hasPresence(world, id)) {
    const ways = [];
    for (const kind of Object.keys(G.PATH_KINDS)) {
      if (G.pathCheck(world, kind)) continue;
      ways.push(h('button', { class: 'btn tiny', title: G.PATH_KINDS[kind].note, onclick: () => app.startPath(id, kind) }, `${G.PATH_KINDS[kind].name}を敷く`));
    }
    if (!G.portCheck(world, id)) ways.push(h('button', { class: 'btn tiny', title: '船が着けるようになる', onclick: () => app.confirm('港を開く', `${c.name}に港を開く: ${Math.round(G.PORT_COST * (world.player.mods?.buildCost ?? 1))}銀`, () => app.run(() => G.buildPort(world, id), 'road')) }, `港を開く ${G.PORT_COST}`));
    if (ways.length) add(box, h('div', { class: 'section' }, `道と港（敷いた道 ${G.pathsBuilt(world)}/${G.pathsAllowed(world)}本）`), h('div', { class: 'chips' }, ways));
  }
  if (here.length) {
    const max = G.merchantCap(world);
    if (world.player.merchants.length < max) {
      const cost = G.hireCost(world);
      add(acts, h('button', { class: 'btn small', onclick: () => hireDialog(app, id, cost, max) }, `商人を雇う ${cost}銀`));
    }
    if (G.branchesAllowed(world) && !world.player.branches?.includes(id)) {
      const why = G.branchCheck(world, id);
      const cost = G.branchCost(world);
      add(acts, h('button', { class: 'btn small', disabled: why || undefined, title: why || '雇える商人が1人増える。この町の倉庫が使え、相場がいつでも分かる',
        onclick: () => app.confirm(`${c.name}に商館を開く（${cost}銀）`, `${G.spendWarning(world, cost) ? `⚠ ${G.spendWarning(world, cost)}。` : ''}雇える商人が${G.merchantCap(world)}人から${G.merchantCap(world) + 1}人に増えます。この町の倉庫が使え、相場がいつでも分かります。維持費 ${G.BALANCE.branchUpkeep}銀/日。次の商館は倍の値段になります。`, () => app.run(() => G.buildBranch(world, id), 'build')) }, `商館 ${cost}銀`));
    }
    // 開拓団: この町から、自分の交易所へ60人を運ぶ
    if (G.settlersAllowed(world) && !c.founded) {
      for (const post of Object.values(world.cities).filter((x) => x.founded)) {
        const m = here.find((x) => !G.settlerCheck(world, x.id, post.id)) || here[0];
        const why = G.settlerCheck(world, m.id, post.id);
        const cost = G.settlerCost(world, post.id);
        const ready = G.settleCheck(world, post.id);
        add(acts, h('button', { class: 'btn small', disabled: why || undefined, title: why || `${G.BALANCE.settlerGroup}人を${post.name}へ運ぶ。${ready ? `今のままでは住みつけない: ${ready}` : '今なら住みつける'}`,
          onclick: () => app.confirm(`開拓団を${post.name}へ（${cost}銀）`, [
            G.spendWarning(world, cost) ? `⚠ ${G.spendWarning(world, cost)}` : null,
            `${m.name}が${c.name}から${G.BALANCE.settlerGroup}人を連れ出し、${post.name}へ運びます。人はこの町から減り、荷車の${Math.round(G.BALANCE.settlerLoad * 100)}%を使います。`,
            `住みつく条件: 家を建てる空き地・食卓に食べ物3種類（10日ほど続けて）・糖度${G.BALANCE.settlerGlucose}以上。増えた人で食べ物を分けるので、糖度は少し下がります。`,
            `そろわなければ、着いてから${G.BALANCE.settlerWait}日（連れ出してから${G.BALANCE.settlerCarry}日）で散ります。銀は戻りません。`,
            ready ? `今の${post.name}: ✖ ${ready}` : `今の${post.name}: ○ 住みつけます`,
            `連れ出したら、${m.name}を${post.name}へ向かわせてください。`,
          ].filter(Boolean).join('\n'), () => app.run(() => G.sendSettlers(world, m.id, post.id), 'build')) }, `開拓団→${post.name} ${cost}銀`));
      }
    }
    if (!(c.donatedUntil > world.day)) {
      const cost = G.donateCost(world, id);
      const warn = G.spendWarning(world, cost);
      add(acts, h('button', { class: 'btn small', onclick: () => app.confirm(`${c.name}に寄進する（${cost}銀）`, `${warn ? `⚠ ${warn}。` : ''}井戸と市場を寄付します。${G.BALANCE.donateDays}日間、成長が${Math.round((G.BALANCE.donateGrowth - 1) * 100)}%早まります（糖度が足りて成長しているときだけ）。`, () => app.run(() => G.donate(world, id), 'build')) }, `寄進 ${cost}銀`));
    } else add(acts, h('span', { class: 'chip' }, `寄進の効果 あと${c.donatedUntil - world.day}日`));
    for (const b of (world.scenario.buildings || []).filter((x) => BUILDINGS[x]?.recipes)) {
      if (world.player.buildings.some((x) => x.city === id && x.type === b)) continue;
      const def = BUILDINGS[b];
      const bc = G.buildCost(world, b);
      add(acts, h('button', { class: 'btn small', onclick: () => app.confirm(`${def.name}を建てる（${bc}銀）`, recipeText(def, world), () => app.run(() => G.build(world, id, b), 'build')) }, `${def.name} ${bc}銀`));
    }
  }
  if (acts.children.length) add(box, h('div', { class: 'section' }, 'この町でできること'), acts);
  const bs = world.player.buildings.filter((b) => b.city === id);
  if (bs.length) {
    add(box, h('div', { class: 'section' }, '自分の工房と倉庫'));
    for (const b of bs) {
      add(box, h('div', { class: 'contract' }, icon(`cities/${b.type}`, 'icon'), h('div', { style: { flex: 1 } }, h('b', {}, BUILDINGS[b.type].name), h('div', { class: 'faint' }, recipeText(BUILDINGS[b.type], world))),
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

function recipeText(def, world) {
  const type = Object.keys(BUILDINGS).find((k) => BUILDINGS[k] === def);
  return G.recipeList(world, type).map((r) => G.recipeLine(r)).join(' / ') + `（1日${def.batches}回、維持費${def.upkeep}/日）`;
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
  // 次の一手の例: 選んでいる商人（町にいて、定期便がない）
  const am = world.player.merchants.find((m) => m.id === app.state.selMerchant) || world.player.merchants[0];
  if (am && !am.travel && !am.order) add(box, h('div', { class: 'section' }, `💡 ${am.name}の次の一手の例`), h('ul', { class: 'advice' }, G.adviceText(world, am.id).map((l) => h('li', {}, l))));
  // 銀の使い道（銀が眠っているとき）
  const sa = G.silverAdvice(world);
  if (sa.length) add(box, h('div', { class: 'section' }, `💰 銀の使い道（今 ${Math.floor(world.player.silver)}銀）`), h('ul', { class: 'advice' }, sa.map((a) => h('li', {}, a.text))));
  // 町のないシナリオ: まだ交易所の圏に入っていない集落と古い建物（近い順）
  if (sc.pioneer) {
    const own = Object.values(world.cities).filter((c) => c.founded).map((c) => world.grid.cityTiles[c.id]);
    const from = own.length ? own : world.player.hq ? [world.player.hq] : [];
    const dist = (o) => Math.min(...from.map(([x, y]) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y))));
    const wl = G.wildernessList(world);
    const rows = [...wl.hamlets.map((o) => ({ o, text: `${o.name}（人口${o.pop}・${Object.keys(o.foods).map((g) => GOODS[g].name).join('・')}）` })), ...wl.wilds.map((o) => ({ o, text: `${G.CIVICS[o.type].name}（${Object.keys(G.CIVICS[o.type].flat).filter((g) => sc.goods.includes(g)).map((g) => GOODS[g].name).join('・')}を買う）` }))]
      .map((r) => ({ ...r, d: from.length ? dist(r.o) : 0 })).sort((a, b) => a.d - b.d).slice(0, 8);
    if (rows.length) add(box, h('div', { class: 'section' }, '🏕 まだ交易所の圏にない集落と古い建物'), h('ul', { class: 'advice' }, rows.map((r) => h('li', { style: { cursor: 'pointer' }, title: '地図でその場所を見る', onclick: () => app.map.centerTile(r.o.x, r.o.y, 0.9) }, from.length ? `${r.text} — ${own.length ? '自分の交易所' : '一族の館'}から${r.d}マス` : r.text))),
      h('div', { class: 'faint', style: { fontSize: '11px' } }, `そばに交易所を開くか（上の「交易所」）、近くの交易所を「市場」に格上げすると圏に入る（交易所の圏 ${G.BALANCE.postGradeRadius[0]}マス・市場 ${G.BALANCE.postGradeRadius[1]}マス・大市場 ${G.BALANCE.postGradeRadius[2]}マス）`));
  }
  // 全部の町の相場（知っている範囲）
  add(box, h('div', { class: 'section' }, '知っている相場'));
  const t = h('table', { class: 'prices-table' });
  add(t, h('tr', {}, h('th', {}, '町'), ...sc.goods.map((g) => h('th', { title: GOODS[g].name }, goodIcon(g, 'icon-sm')))));
  for (const c of Object.values(world.cities)) {
    const k = world.player.knowledge[c.id];
    const age = G.knowledgeAge(world, c.id);
    const cls = age === null ? 'faint' : age <= 3 ? 'age-fresh' : age <= 15 ? 'age-old' : 'age-stale';
    add(t, h('tr', { style: { cursor: 'pointer' }, onclick: () => { app.state.selCity = c.id; app.render(); } },
      h('td', {}, c.name, h('div', { class: cls, style: { fontSize: '10px' } }, age === null ? '未訪問' : age === 0 ? '今' : '噂')),
      ...sc.goods.map((g) => {
        const p = k?.prices?.[g];
        if (p === undefined) return h('td', { class: 'faint' }, '?');
        const want = k.wants?.[g] !== false;
        return h('td', { class: `num ${p < GOODS[g].base * 0.75 ? 'good' : p > GOODS[g].base * 1.35 ? 'bad' : ''}`, style: want ? {} : { opacity: 0.4 } }, fmt(p, p < 10 ? 1 : 0));
      })));
  }
  add(box, h('div', { class: 'table-scroll' }, t), h('div', { class: 'faint', style: { fontSize: '11px' } }, '緑=安い（仕入れどき）、赤=高い（売りどき）。一度訪れた町は、いつでも今の相場が分かる。'));
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
  const maxDanger = Math.max(0, ...route.edges.map((e) => e.danger || 0));
  let guards = maxDanger && world.scenario.bandits ? maxDanger * 2 + 1 : 0;
  const desertDays = route.edges.filter((e) => e.kind === 'desert').reduce((s, e) => s + G.edgeDays(world, e, m.transport, e.a), 0);
  const food = G.PROVISIONS.reduce((s, g) => s + (m.cargo[g] || 0), 0);
  const need = G.foodNeeded(world, m, desertDays);
  const k = world.player.knowledge[to];
  const body = h('div', {});
  const draw = () => {
    clear(body);
    add(body, 
      h('div', {}, `${route.path.map((id) => world.cities[id].name).join(' → ')}`),
      h('div', { class: 'total-big' }, `約 ${route.days} 日`),
      // 予告された強盗団の区域を通る日（31回目の Opus）
      ...(() => { const hs = G.gangCrossings(world, m, route.tiles, route.steps); return hs.length ? [h('div', { class: hs.some((x) => x.caught) ? 'bad' : 'amber' }, `🗡 今出ると、${G.gangCrossText(world, hs)}`)] : []; })(),
      route.edges.some((e) => e.monsoon) ? h('div', { class: 'dim' }, `季節: ${G.SEASON_NAMES[G.seasonOf(world)]}（追い風なら速く、向かい風なら遅い）`) : null,
      desertDays ? h('div', { class: food >= need ? 'good' : 'bad' }, `砂漠 約${desertDays}日。隊商の食料 ${food} / 必要 ${need}${food < need ? '（足りない！なつめやし・干しぶどう・キビ・麦・米を積もう）' : ''}`, food && need ? h('div', { class: 'dim', style: { fontSize: '12px' } }, `道中で積荷の${G.PROVISIONS.filter((g) => m.cargo[g]).map((g) => GOODS[g].name).join('・')}を約${Math.min(food, need)}個食べる（売るつもりの分も減る）`) : null) : null,
      route.edges.some((e) => e.danger) && world.scenario.bandits ? h('div', {},
        h('div', { class: 'amber' }, `⚔ 盗賊の出る道（最大危険度 ${Math.max(...route.edges.map((e) => e.danger))}）`),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' } }, icon('transport/guard', 'icon'), '護衛',
          h('button', { class: 'btn tiny', onclick: () => { guards = Math.max(0, guards - 1); draw(); } }, '−'), h('b', { class: 'num' }, guards), h('button', { class: 'btn tiny', onclick: () => { guards = Math.min(12, guards + 1); draw(); } }, '＋'),
          h('span', { class: 'dim' }, `費用 約${guards * G.BALANCE.guardWage * route.days}銀`))) : null,
      // 噂だけで、相場を見たことのない町は「まだ知らない」（「null日前の情報」と出ていた）
      // 着く頃の町を読む材料（版4: 相場はいつも最新。変わるのは、着くまでの町の糖度の流れ）
      G.isVisited(world, to) ? h('div', { class: 'dim', style: { marginTop: '6px' } }, `${dest.name}の今の様子（着くのは約${route.days}日後）`, h('div', { class: 'outlook' }, G.cityOutlook(world, dest).map((o) => h('div', { class: `ol ${o.kind}` }, o.text)))) : h('div', { class: 'dim' }, `${dest.name}の相場はまだ知らない。着いてから確かめる。`),
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
export function orderDialog(app, mid, { alt: startAlt = false, shift = null } = {}) {
  const world = app.world;
  const m = G.getMerchant(world, mid);
  const goods = world.scenario.goods;
  // 下書き: 既存の定期便 → 直近の取引 → 今いる町と隣町
  // 上限買値・最低売値は今の相場から入れる（基準値から入れていたので、相場が上がると買わずに素通りした。第15回テスト）
  const avgBuy = (cid, g, q = 20) => { const c = world.cities[cid]; return c ? G.quote(world, c, g, Math.max(1, q)) / Math.max(1, q) : GOODS[g].base; };
  const avgSell = (cid, g, q = 20) => { const c = world.cities[cid]; return c && G.cityWants(c, g) ? G.quote(world, c, g, -Math.max(1, q)) / Math.max(1, q) : 0; };
  // 上限買値: 今の買値の15%増しか、売る町の今の売値の9割（赤字にならない線）の高いほう
  const maxFor = (cid, g, q, to) => Math.ceil(Math.max(avgBuy(cid, g, q) * 1.15, to ? avgSell(to, g, q) * 0.9 : 0) * 10) / 10;
  // 最低売値は、仕入れ値（同じ便で買う町の今の値）を割らない値
  // 便の中で買わない品は、積んでいる分の仕入れ値か、訪れた産地のいちばん安い今の買値（基準値の6割にしていたので、赤字売りが続いた。16回目の Sonnet）
  const cheapest = (g) => Math.min(...Object.values(world.cities).filter((c) => G.isVisited(world, c.id) && (c.stock[g] || 0) >= 1).map((c) => avgBuy(c.id, g)), Infinity);
  const minFor = (g, from) => Math.floor((from ? avgBuy(from, g) : m.cost[g] || (Number.isFinite(cheapest(g)) ? cheapest(g) : GOODS[g].base * 0.8)) * 1.03 * 10) / 10;
  let stops;
  // その品を便の中で買う、ほかの停泊地（最低売値の基準）
  const buyerOf = (g, i) => stops.find((st, j) => j !== i && st.buy?.some((x) => x.good === g))?.city;
  // その品を売る停泊地。なければ、次の停泊地（上限買値の基準）
  const sellerOf = (g, i) => stops.find((st, j) => j !== i && st.sell?.some((x) => x.good === g))?.city || stops[(i + 1) % stops.length]?.city;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  if (m.order) stops = clone(G.baseStops(m.order));
  else {
    const recent = (m.recent || []).slice(-2);
    if (recent.length === 2 && recent[0].city !== recent[1].city) {
      stops = recent.map((r) => ({
        city: r.city,
        buy: Object.entries(r.buy).map(([g, q]) => ({ good: g, qty: q, max: maxFor(r.city, g, q, recent.find((x) => x.city !== r.city)?.city) })),
        sell: [],
      }));
      // 片方で買った品は、もう片方で売る（最低売値は買う町の今の値から）。自分で売った品で、便の中で買わないものは平均の仕入れ値から
      for (let i = 0; i < 2; i++) for (const b of stops[i].buy) stops[1 - i].sell.push({ good: b.good, min: minFor(b.good, stops[i].city) });
      recent.forEach((r, i) => { for (const g of Object.keys(r.sell)) if (!stops[i].sell.some((x) => x.good === g)) stops[i].sell.push({ good: g, min: minFor(g) }); });
    } else {
      const here = m.city || m.travel?.to;
      const nb = G.neighbors(world, here).map((e) => (e.a === here ? e.b : e.a))[0];
      stops = [{ city: here, buy: [], sell: [] }, { city: nb, buy: [], sell: [] }];
    }
  }
  // 臨時の便（期間予約）: 予告された売り場の交代のあいだだけ回る、別の停泊地（19回目の相談）
  const baseStops = stops;
  let altStops = null;
  let altFrom;
  let altUntil;
  let tab = startAlt && m.order ? 'alt' : 'base';
  const shifts = G.knownShifts(world);
  const win0 = (x) => G.fairEnd(x) - 1;
  const fit = (x) => {
    // その予告にかかる予約があれば、それを書き直す。なければ下書きから
    const have = G.altCovering(m, x);
    if (have) { altStops = clone(have.stops); altFrom = have.from; altUntil = have.until; return; }
    altStops = G.altDraftFor(world, m, x) || clone(baseStops);
    const win = G.altWindowFor(world, m, x, altStops);
    altFrom = win.from;
    altUntil = win.until;
  };
  const openAlt = () => {
    if (!altStops) {
      const x = shifts.find((s) => s.id === shift) || shifts[0];
      if (x) fit(x);
      else if (m.order.alts?.length) { const a = m.order.alts[0]; altStops = clone(a.stops); altFrom = a.from; altUntil = a.until; }
      else { altStops = clone(baseStops); altFrom = world.day + 10; altUntil = world.day + 40; }
    }
    tab = 'alt';
  };
  if (tab === 'alt') openAlt();
  const body = h('div', {});
  const cityOpts = (sel) => Object.values(world.cities).map((c) => h('option', { value: c.id, selected: c.id === sel || undefined }, c.name));
  const goodOpts = (sel) => goods.map((g) => h('option', { value: g, selected: g === sel || undefined }, GOODS[g].name));
  const draw = () => {
    clear(body);
    stops = tab === 'alt' ? altStops : baseStops;
    if (m.order) {
      add(body, h('div', { class: 'row chips', style: { marginBottom: '8px' } },
        h('button', { class: `btn small ${tab === 'base' ? 'primary' : 'ghost'}`, onclick: () => { tab = 'base'; draw(); } }, 'いつもの便'),
        h('button', { class: `btn small ${tab === 'alt' ? 'primary' : 'ghost'}`, onclick: () => { openAlt(); draw(); } }, `臨時の便（期間予約）${m.order.alts?.length ? ` ${m.order.alts.length}件` : ''}`)));
    }
    if (tab === 'alt') {
      add(body, h('div', { class: 'dim', style: { marginBottom: '8px', fontSize: '12px' } }, `決めた期間のあいだだけ、下の停泊地を回る。期間に入ってから町に着いたとき（または町を出るとき）切り替わり（積荷と旅程はそのまま）、期間が過ぎたら いつもの便に戻る。予約はいくつでも持てる（期間が重なる予約は置き換わる）。今は${world.day}日目。`));
      for (const a of m.order.alts || []) add(body, h('div', { class: 'row', style: { fontSize: '12px' } }, `予約: ${a.from}〜${a.until}日目 ${a.stops.map((x) => world.cities[x.city].name).join('→')}${m.order.altOn === a.id ? '（今はこちらを回っている）' : ''}`, h('button', { class: 'btn tiny ghost', onclick: () => { altStops = clone(a.stops); altFrom = a.from; altUntil = a.until; draw(); } }, '開く'), h('button', { class: 'btn tiny ghost', onclick: () => { G.clearOrderAlt(world, mid, a.id); app.toast('臨時の便の予約を消した'); draw(); } }, '消す')));
      add(body, h('div', { class: 'row' }, '期間', h('input', { type: 'number', value: altFrom, onchange: (e) => { altFrom = Number(e.target.value); } }), '日目から', h('input', { type: 'number', value: altUntil, onchange: (e) => { altUntil = Number(e.target.value); } }), '日目まで'));
      // 予告に合わせる: 隊商市に着く日が期間に入るよう、行く日数だけ前へずらす
      if (shifts.length) add(body, h('div', { class: 'row chips' }, h('span', { class: 'dim' }, '予告に合わせる:'), shifts.map((x) => h('button', { class: 'btn tiny', onclick: () => { fit(x); draw(); } }, `${world.cities[x.low].name}が安い→${world.cities[x.fair].name}の隊商市（${x.start}〜${win0(x)}日目に売れる）`))));
      add(body, h('div', { class: 'row', style: { margin: '6px 0' } },
        h('button', { class: 'btn primary small', onclick: () => { const r = G.setOrderAlt(world, mid, { stops: altStops, from: altFrom, until: altUntil }); if (!r.ok) return app.error(r.error); app.toast(`臨時の便を予約した（${altFrom}〜${altUntil}日目）`); flushOut(); } }, '臨時の便を予約する'),
        null));
    }
    if (tab === 'base') add(body, h('div', { class: 'dim', style: { marginBottom: '8px', fontSize: '12px' } }, '停泊地を順番に回り続ける。最低売値より安ければ売らずに持ち越し、上限買値より高ければ買わない（赤字を防ぐ）。直近の取引から下書きを作っています。値は今の相場から: 上限買値は今の買値の15%増しか、売る町の売値の9割の高いほう。最低売値は、買う町の今の買値。定期便は、積荷の仕入れ値を割っては売らない（60日売れなければ最低売値で売る）。'));
    stops.forEach((st, i) => {
      const box = h('div', { class: 'order-stop' });
      add(box, h('div', { class: 'row' }, h('b', {}, `${i + 1}.`), h('select', { onchange: (e) => { st.city = e.target.value; if (!world.player.warehouses[st.city]) { st.unload = []; st.load = []; } draw(); } }, cityOpts(st.city)),
        h('span', { style: { flex: 1 } }), stops.length > 2 ? h('button', { class: 'btn tiny danger', onclick: () => { stops.splice(i, 1); draw(); } }, '削除') : null));
      (st.sell ||= []).forEach((x, j) => add(box, h('div', { class: 'row' }, '売る', h('select', { onchange: (e) => { x.good = e.target.value; x.min = minFor(x.good, buyerOf(x.good, i)); draw(); } }, goodOpts(x.good)), '最低', h('input', { type: 'number', step: '0.1', value: x.min, onchange: (e) => { x.min = Number(e.target.value); } }), '銀', ' 残す', h('input', { type: 'number', value: x.keep || 0, title: '売らずに手元に残す数（砂漠の食料など）', onchange: (e) => { x.keep = Number(e.target.value) || 0; } }), '個', h('button', { class: 'btn tiny ghost', onclick: () => { st.sell.splice(j, 1); draw(); } }, '✕'))));
      (st.buy ||= []).forEach((x, j) => add(box, h('div', { class: 'row' }, '買う', h('select', { onchange: (e) => { x.good = e.target.value; x.max = maxFor(st.city, x.good, x.qty, sellerOf(x.good, i)); draw(); } }, goodOpts(x.good)), h('input', { type: 'number', value: x.qty, onchange: (e) => { x.qty = Number(e.target.value); } }), '個まで、上限', h('input', { type: 'number', step: '0.1', value: x.max === Infinity ? '' : x.max, onchange: (e) => { x.max = e.target.value === '' ? Infinity : Number(e.target.value); } }), '銀', h('button', { class: 'btn tiny ghost', onclick: () => { st.buy.splice(j, 1); draw(); } }, '✕'))));
      if (world.player.warehouses[st.city]) {
        add(box, h('div', { class: 'row' }, '倉庫:', h('label', {}, '下ろす ', h('select', { onchange: (e) => { st.unload = e.target.value ? [e.target.value] : []; } }, h('option', { value: '' }, '—'), goodOpts((st.unload || [])[0]))),
          h('label', {}, ' 積む ', h('select', { onchange: (e) => { st.load = e.target.value ? [e.target.value] : []; } }, h('option', { value: '' }, '—'), goodOpts(String((st.load || [])[0] || '').split('*')[0])))));
      }
      // 品はボタンで足す（プルダウンだけでは操作が多かった。第15回テスト）。値は今の相場から
      const c = world.cities[st.city];
      const canBuy = c ? goods.filter((g) => (c.stock[g] || 0) >= 1 && !st.buy.some((x) => x.good === g)) : [];
      const canSell = c ? goods.filter((g) => G.cityWants(c, g) && !st.sell.some((x) => x.good === g)).sort((a, b) => (buyerOf(b, i) ? 1 : 0) - (buyerOf(a, i) ? 1 : 0)) : [];
      if (canBuy.length) add(box, h('div', { class: 'row chips' }, h('span', { class: 'dim' }, '＋買う品:'), canBuy.map((g) => h('button', { class: 'btn tiny', onclick: () => { st.buy.push({ good: g, qty: 20, max: maxFor(st.city, g, 20, sellerOf(g, i)) }); draw(); } }, goodIcon(g, 'icon-sm'), `${GOODS[g].name} ${fmt(G.unitBuy(world, c, g), 1)}`))));
      if (canSell.length) add(box, h('div', { class: 'row chips' }, h('span', { class: 'dim' }, '＋売る品:'), canSell.slice(0, 10).map((g) => h('button', { class: `btn tiny ${buyerOf(g, i) ? '' : 'ghost'}`, onclick: () => { st.sell.push({ good: g, min: minFor(g, buyerOf(g, i)) }); draw(); } }, goodIcon(g, 'icon-sm'), `${GOODS[g].name} ${fmt(G.unitSell(world, c, g), 1)}`))));
      add(body, box);
    });
    // 停泊地も、知っている町のボタンで足す
    const known = Object.values(world.cities).filter((c) => G.isVisited(world, c.id) && !stops.some((st) => st.city === c.id));
    add(body, h('div', { class: 'row chips' }, h('span', { class: 'dim' }, '＋停泊地:'), known.length ? known.map((c) => h('button', { class: 'btn tiny', onclick: () => { stops.push({ city: c.id, buy: [], sell: [] }); draw(); } }, c.name)) : h('span', { class: 'dim' }, 'ほかに知っている町がない')));
  };
  draw();
  const md = modal(app, `${m.name}の定期便`, body, (close) => [
    m.order ? h('button', { class: 'btn danger', onclick: () => { G.clearOrder(world, mid); close(); app.render(); } }, '定期便を解除') : null,
    m.order && !m.order.paused ? h('button', { class: 'btn ghost', onclick: () => { const r = G.pauseOrderAtNext(world, mid); app.toast(r.now ? '定期便を止めた' : '次の町で止まる'); close(); app.render(); } }, '次の町で止める') : null,
    m.order?.paused ? h('button', { class: 'btn', onclick: () => { app.run(() => G.resumeOrder(world, mid)); close(); } }, '再開') : null,
    // 同じ定期便を、ほかの商人にも走らせる
    m.order && world.player.merchants.length > 1 ? h('button', { class: 'btn ghost', onclick: () => { close(); copyOrderDialog(app, mid); } }, 'ほかの商人に写す') : null,
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn ghost', onclick: close }, 'キャンセル'),
    h('button', { class: 'btn primary', onclick: () => { const r = G.setOrder(world, mid, { stops: baseStops, guards: m.order?.guards, reserve: m.order?.reserve, keepAlt: true }); if (!r.ok) return app.error(r.error); close(); app.afterOrder(mid); } }, tab === 'alt' ? 'いつもの便を開始' : '定期便を開始'),
  ], { wide: true });
  function flushOut() { md.close(); app.render(); }
}

// 売り場の交代の予告（19回目の相談）: 商人ごとに、臨時の便を1回押すだけで予約できる。中身を見て組むこともできる
export function shiftDialog(app, sid) {
  const world = app.world;
  const x = G.knownShifts(world).find((s) => s.id === sid) || G.knownShifts(world)[0];
  if (!x) { app.modalClosed(); return; }
  const sc = world.scenario.shifts;
  const g = GOODS[x.good].name;
  const low = world.cities[x.low].name;
  const fair = world.cities[x.fair].name;
  const list = h('div', { class: 'tech-list' });
  const draw = () => {
    clear(list);
    if (G.fairClosed(world, x)) { add(list, h('div', { class: 'dim' }, `${fair}の隊商市は${G.fairStateText(world, x)}。${low}の${g}は${G.lowStateText(world, x)}安い`)); return; }
    for (const m of world.player.merchants.filter((y) => y.order)) {
      const draft = G.altDraftFor(world, m, x);
      const win = draft ? G.altWindowFor(world, m, x, draft) : null;
      const hit = G.orderShiftWarnings(world, m).find((w) => w.shift.id === x.id);
      const booked = G.altCovering(m, x);
      add(list, h('div', { class: 'tech-row' },
        h('div', {}, h('b', {}, m.name), h('div', { class: 'muted' }, `いつもの便: ${G.baseStops(m.order).map((s) => world.cities[s.city].name).join('→')}${hit && !booked ? `（${low}で${g}を売る）` : ''}`),
          draft && win.late && !booked ? h('div', { class: 'bad', style: { fontSize: '12px' } }, `${win.ready > world.day ? `${world.cities[G.baseStops(m.order)[0].city].name}に戻れるのは${win.ready}日目。` : ''}${Number.isFinite(win.days) ? `${fair}まで約${win.days}日かかり、市が閉じる前に着けない` : `${G.TRANSPORTS[m.transport].name}では${fair}へ行けない`}`) : draft ? h('div', { class: 'dim', style: { fontSize: '12px' } }, booked ? `予約ずみ: ${booked.from}〜${booked.until}日目 ${booked.stops.map((s) => world.cities[s.city].name).join('→')}` : `臨時の便: ${draft.map((s) => world.cities[s.city].name).join('↔')}（${win.from}〜${win.until}日目に切り替わる便。${fair}まで約${win.days}日なので、${win.lastSale}日目までに着く${win.ready > win.from ? `。今の旅から戻るのは${win.ready}日目` : ''}）。今予約すると早ければ${win.arrive}日目に着く。${win.afterStart > win.lastSale ? '始まってから切り替えたのでは、市に間に合わない' : `始まってから切り替えると${win.afterStart}日目に着き、市の残りは${win.lastSale - win.afterStart + 1}日`}`) : h('div', { class: 'dim' }, `この便は${g}を売らない`)),
        h('span'),
        draft && !booked && !win.late ? h('button', { class: 'btn primary small', onclick: () => { const r = app.run(() => G.setOrderAlt(world, m.id, { stops: draft, from: win.from, until: win.until, shift: x.id })); if (r.ok) draw(); } }, '臨時の便にする') : null,
        h('button', { class: 'btn ghost small', onclick: () => { md.close(); app.state.modals++; orderDialog(app, m.id, { alt: true, shift: x.id }); } }, '中身を見て組む')));
    }
  };
  draw();
  const body = h('div', {},
    G.fairClosed(world, x) ? h('p', { class: 'bad' }, `${fair}の隊商市は${G.fairStateText(world, x)}。`) : null,
    h('p', {}, `${x.start - world.day > 0 ? `${x.start - world.day}日後` : '今'}（${x.start}〜${x.end - 1}日目の${sc.days}日間）、${low}に${g}が大量に入り、安くしか売れなくなる。始まりと同時に${fair}に隊商市が立ち、${G.fairEnd(x) - 1}日目まで${g}を高く買う（毎日約${sc.fair.demand}個ずつ売れていく。まとめて売ると値が下がる）。${x.want ? `${G.fairWantText(x)}。` : ''}${G.fairPriceText(world, x) ? `${G.fairPriceText(world, x)}。` : ''}${G.caravanText(world, x)}市は安値より早く閉じる。下に、商人ごとに着く日の目安を出す（積み待ちの日数は入らない）。`),
    G.fairRound(world) ? h('p', { class: 'dim', style: { fontSize: '12px' } }, `🎪${G.fairRound(world).text}。`) : null,
    h('p', { class: 'dim', style: { fontSize: '12px' } }, `その期間だけ便の売り先を${fair}に回すと、安値を避けて高く売れる。全部の便を回すと、隊商市でも値が崩れる（売れていく速さに限りがある）。下の日付は、臨時の便に切り替わる期間（着く日が市の期間に入るよう、行く日数だけ前にずらしてある）。期間中に町に着くと切り替わり、${g}を積んでいれば市へ直に向かう（積んでいなければ積む町に戻ってから）。市が閉じる前に着けない町、市が立つより2日以上早く着いてしまう町では切り替わらない。何人を回すか、回さずにそのままにするかを決める。臨時の便は期間が過ぎると、いつもの便に戻る。`),
    list);
  const md = modal(app, `📣 予告: ${fair}に隊商市`, body, (close) => [h('span', { style: { flex: 1 } }), h('button', { class: 'btn', onclick: close }, '閉じる')]);
}

function copyOrderDialog(app, mid) {
  const world = app.world;
  const m = G.getMerchant(world, mid);
  app.state.modals++;
  const rows = world.player.merchants.filter((x) => x.id !== mid).map((x) => h('div', { class: 'tech-row' },
    h('div', {}, h('b', {}, x.name), h('div', { class: 'muted' }, `${TRANSPORTS[x.transport].name}・${x.travel ? `移動中→${world.cities[x.travel.to].name}` : `${world.cities[x.city].name}に滞在`}${x.order ? '・今の定期便は置き換わる' : ''}`)),
    h('span'),
    h('button', { class: 'btn primary small', disabled: x.settlers ? true : undefined, onclick: () => { const r = app.run(() => G.copyOrder(world, mid, x.id)); if (r.ok) { md.close(); app.afterOrder(x.id); } } }, 'この商人に写す')));
  const md = modal(app, `${m.name}の定期便を写す（${m.order.stops.map((s) => world.cities[s.city].name).join('→')}）`, h('div', { class: 'tech-list' }, rows), (close) => [h('span', { style: { flex: 1 } }), h('button', { class: 'btn ghost', onclick: close }, 'やめる')]);
}

// ---------- 帳簿 ----------
export function ledgerDialog(app) {
  const world = app.world;
  const s = world.stats;
  const parts = G.netWorthParts(world);
  // 定期便ごとの採算: 取引の利益から、始めてからの給金・輸送手段の維持費・護衛代を引く
  // （売ったときの利益の知らせだけでは、給金を引いた本当の儲けが分からなかった。画面だけのテスト（Sol）の指摘）
  const orderRows = world.player.merchants.filter((m) => m.order).map((m) => {
    const days = Math.max(0, world.day - (m.order.since ?? world.day));
    const perDay = G.BALANCE.merchantWage + G.TRANSPORTS[m.transport].upkeep + (m.order.guards || 0) * G.BALANCE.guardWage;
    const net = (m.order.profit || 0) - perDay * days;
    return h('div', {}, `${m.name}（${m.order.stops.map((x) => world.cities[x.city].name).join('→')}、${days}日）: 取引の利益 ${fmt(m.order.profit || 0)} − 給金と維持費 ${fmt(perDay * days)} = `, h('span', { class: net >= 0 ? 'good' : 'bad' }, `${net >= 0 ? '+' : ''}${fmt(net)} 銀`), h('span', { class: 'dim' }, days ? `（1日 ${net >= 0 ? '+' : ''}${fmt(net / days, 1)}）` : '（今日始めた。まだ集計前）'));
  });
  const body = h('div', {},
    h('dl', { class: 'kv' },
      h('dt', {}, '資産'), h('dd', { class: 'num' }, `${fmt(parts.total)} 銀`,
        h('div', { class: 'dim', style: { fontSize: '12px' } }, [['銀', parts.silver], ['積荷', parts.cargo], ['倉庫の品', parts.warehouses], ['輸送手段', parts.transports], ['工房', parts.workshops], ['商館', parts.branches]].filter(([, v]) => v >= 1).map(([n, v]) => `${n} ${fmt(v)}`).join(' ＋ '),
          h('br'), '品はその町で売った値の8割、輸送手段・工房・商館は払った額の半分。区画の施設・道・交易所・技術・寄進は入らない')),
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
    orderRows.length ? [h('div', { class: 'section' }, '定期便の採算（給金・維持費を引いたあと）'), orderRows] : null,
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
    h('div', { class: 'chips' }, h('button', { class: `btn small ${st.sound ? 'primary' : 'ghost'}`, onclick: () => { app.setSetting('sound', !st.sound); settingsRefresh(); } }, st.sound ? 'オン' : 'オフ'),
      h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.sfxVol ?? 0.5, oninput: (e) => app.setSetting('sfxVol', Number(e.target.value)), 'aria-label': '効果音の音量' })),
    h('div', { class: 'section' }, '音楽（地域ごとの曲。シュガーラッシュの間は変奏）'),
    h('div', { class: 'chips' }, h('button', { class: `btn small ${(st.music ?? true) ? 'primary' : 'ghost'}`, onclick: () => { app.setSetting('music', !(st.music ?? true)); settingsRefresh(); } }, (st.music ?? true) ? 'オン' : 'オフ'),
      h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.musicVol ?? 0.35, oninput: (e) => app.setSetting('musicVol', Number(e.target.value)), 'aria-label': '音楽の音量' })),
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
  const body = h('div', { class: 'result' });
  if (f.win) {
    add(body, h('img', { class: 'rank-img', src: `assets/svg/ui/rank-${f.rank.toLowerCase()}.svg`, alt: `ランク${f.rank}` }),
      h('h2', { style: { fontFamily: 'var(--font-title)', fontSize: '30px', margin: '6px 0' } }, `ランク ${f.rank}`),
      h('div', { class: 'dim' }, `${f.day}日目に達成（期限 ${sc.deadline}日、S基準 ${Math.floor(sc.deadline * (sc.rankS ?? 0.55))}日）`),
      h('div', { class: 'total-big', style: { margin: '6px 0' } }, `資産 ${fmt(f.score)} 銀`),
      h('div', { class: 'dim' }, `読み的中 ${world.stats.hits}回・最長連続黒字 ${world.player.maxStreak}・大口注文 ${world.stats.contracts}件・ラッシュ ${world.stats.rushes}回`));
    const un = world.unlockedHeirloom;
    if (un) {
      const x = HEIRLOOMS[un.key];
      add(body, h('div', { class: 'heirloom sel', style: { marginTop: '14px', textAlign: 'left' } },
        h('div', { class: 'amber' }, un.fresh ? '🏯 新しい家訓を解放した' : '🏯 この家訓はすでに解放済み'),
        h('b', {}, x.name), h('div', { class: 'good' }, `＋ ${x.plus}`), h('div', { class: 'bad' }, `－ ${x.minus}`),
        h('div', { class: 'faint' }, '次からのシナリオで、解放した家訓を1つだけ選んで持っていける')));
    }
  } else {
    add(body, h('img', { class: 'rank-img', src: 'assets/svg/ui/rank-c.svg', alt: 'ランクC' }), h('h2', {}, '期限切れ'),
      h('div', { class: 'dim' }, G.goalsStatus(world).filter((g) => !g.done).map((g) => g.text).join(' / ')));
  }
  modal(app, f.win ? '目標達成！' : 'シナリオ失敗', body, (close) => [
    h('button', { class: 'btn ghost', onclick: () => { close(); world.continueAfterEnd = true; app.render(); } }, 'このまま遊び続ける'),
    h('button', { class: 'btn ghost', onclick: () => { close(); app.startScenario(sc.id); } }, 'やり直す'),
    h('span', { style: { flex: 1 } }),
    f.win && next ? h('button', { class: 'btn primary', onclick: () => { close(); app.startScenario(next); } }, '次のシナリオへ') : h('button', { class: 'btn primary', onclick: () => { close(); app.showTitle(); } }, 'タイトルへ'),
  ], { wide: false });
}

// ---------- タイトル ----------
export function titleScreen(app) {
  const camp = app.campaign;
  const el = h('div', { class: 'title-screen' });
  const list = h('div', { class: 'scen-list hidden', style: { width: 'min(980px, 100%)' } });
  for (const [i, id] of SCENARIO_ORDER.entries()) {
    const sc = SCENARIOS[id];
    // 設定「全シナリオを解放」なら、好きな順に遊べる
    const unlocked = i === 0 || camp.cleared[SCENARIO_ORDER[i - 1]] || app.settings.allScenarios;
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
    h('label', { class: 'dim', style: { fontSize: '12px' } }, h('input', { type: 'checkbox', checked: app.settings.allScenarios || undefined, onchange: (e) => { app.setSetting('allScenarios', e.target.checked); el.remove(); titleScreen(app).querySelector('.scen-list').classList.remove('hidden'); } }), ' 全てのシナリオを解放する（好きな順に遊ぶ）'),
    (camp.unlocked || []).length ? h('div', { class: 'dim', style: { fontSize: '12px' } }, `解放した家訓: ${camp.unlocked.filter((k) => HEIRLOOMS[k]).map((k) => HEIRLOOMS[k].name).join('・')}（シナリオの最初に1つ選べる）`) : '');
  add(document.body, el);
  return el;
}

// 雇う: 候補3人から才能を見て選ぶ
export function hireDialog(app, cityId, cost, max) {
  const world = app.world;
  app.state.modals++;
  const cards = G.hireCandidates(world).map((c, i) => h('div', { class: 'hire-card' },
    h('img', { src: `assets/svg/transport/${c.portrait}.svg`, class: 'portrait', alt: '' }),
    h('div', { class: 'name' }, c.name),
    h('div', { class: 'talent' }, G.TALENTS[c.talent].name),
    h('div', { class: 'muted' }, G.TALENTS[c.talent].text),
    h('button', { class: 'btn primary small', onclick: () => { md.close(); app.run(() => G.hireMerchant(world, cityId, i), 'hire'); } }, 'この人を雇う')));
  const md = modal(app, `商人を雇う（${cost}銀・給金 1日${G.BALANCE.merchantWage}銀・最大${max}人）`, h('div', { class: 'hire-cards' }, cards), (close) => [h('span', { style: { flex: 1 } }), h('button', { class: 'btn ghost', onclick: close }, 'やめる')]);
}

// 技術: 買う・使用料を払う
// 技術で開く品の作り方と、作るのに要るもの（買ったあと何をすればよいか分からなかった。第15回テスト）
function techHow(world, t) {
  const goods = (t.unlocks?.goods || []).filter((g) => world.scenario.goods.includes(g));
  const lines = goods.map((g) => {
    const w = G.howToMake(world, g).find((x) => !x.lock || x.lock === t.name);
    return w ? `${GOODS[g].name}: ${w.building}で ${G.recipeLine({ ...w.recipe, lock: null })}` : null;
  }).filter(Boolean);
  if (!lines.length) return null;
  return h('div', { class: 'dim', style: { fontSize: '11px' } }, `作り方 ${lines.join(' / ')}。工房は${G.isPioneer(world) ? `「${G.gradeName(1)}」以上の交易所に` : '町の区画に'}建てる（町の欄の「区画を見る」）`);
}

export function techDialog(app) {
  const world = app.world;
  app.state.modals++;
  const body = h('div', { class: 'tech-list' });
  const draw = () => {
    clear(body);
    for (const t of G.techList(world)) {
      const st = t.owner === 'player' ? '持っている（独占）' : t.owner === 'licensed' ? '使用料を払って使っている' : !t.available ? `${t.from}日目から買える` : t.owner === 'rival' ? `ライバルが独占中 — 使用料 ${t.price}銀` : `${t.price}銀`;
      const can = t.available && !['player', 'licensed'].includes(t.owner);
      add(body, h('div', { class: 'tech-row' },
        h('div', {}, h('b', {}, t.name), h('div', { class: 'muted' }, t.text), techHow(world, t)),
        h('div', { class: 'dim' }, st),
        can ? h('button', { class: 'btn primary small', onclick: () => { const r = app.run(() => G.buyTech(world, t.id), 'build'); if (r.ok) draw(); } }, t.owner === 'rival' ? '使用料を払う' : '買う') : h('span')));
    }
    if (world.rivals.length) add(body, h('p', { class: 'muted' }, 'ライバルも技術を狙っている。先に買えば独占でき、ライバルが使うと使用料が入る。'));
  };
  draw();
  modal(app, '技術', body, (close) => [h('span', { style: { flex: 1 } }), h('button', { class: 'btn ghost', onclick: close }, '閉じる')]);
}

// 住居の求める品（○そろっている ×足りない）
function dwellingEl(c, tier, world) {
  const st = G.dwellingStatus(c, tier);
  // 足りない品がどこで手に入るか（蜂蜜をどこで買えばよいか分からず、町に育てられなかった。画面だけのテストの指摘）
  const where = st.missing.map((g) => { const p = G.producersOf(world, g, c.id).slice(0, 2); return p.length ? `${GOODS[g].name}は${p.map((x) => x.name).join('・')}で採れる` : null; }).filter(Boolean);
  const whereEl = where.length ? h('div', { class: 'dim', style: { fontSize: '12px' } }, `${where.join('、')}。${st.ok ? '届けると育ちが少し速まる' : '運んで届ける'}`) : null;
  if (!st.wants.length) return h('span', { class: 'dim' }, (c.dwellWants || []).length ? `まだない（育つと ${(c.dwellWants || []).map((g) => GOODS[g].name).join('・')} を求める）` : 'なし');
  return h('span', {}, st.wants.map((g) => h('span', { class: `chip ${st.met.includes(g) ? 'good' : 'bad'}`, title: st.met.includes(g) ? 'そろっている' : '足りない' }, goodIcon(g, 'icon-sm'), `${GOODS[g].name} ${st.met.includes(g) ? '○' : '×'}`)), st.ok ? (st.wants.length === 1 ? h('div', { class: 'dim', style: { fontSize: '11px' } }, '今求めるのは1つだけ。届かなくても家は建つ') : null) : h('div', { class: 'bad', style: { fontSize: '11px' } }, `家がゆっくりしか建たない（${st.wants.length}つのうち${st.wants.length - 1}つ以上そろえば、どんどん建つ）`), whereEl);
}
