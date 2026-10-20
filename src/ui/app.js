// ブラウザ版の入口: 状態、時間の進行、画面の組み立て、演出のつなぎ込み
import { h, add, clear, icon, goodIcon, fmt, safeStorage } from './dom.js';
import { createMap } from './map.js';
import { openTrade } from './tradeDialog.js';
import { renderSide, departDialog, orderDialog, ledgerDialog, helpDialog, settingsDialog, resultDialog, titleScreen, modal } from './panels.js';
import { sfx, setSound } from './audio.js';
import * as fx from './juice.js';
import * as G from '../core/index.js';

const { GOODS, TRANSPORTS } = G;
const store = safeStorage();
const KEY_SAVE = 'toshoki.save.v1';
const KEY_CAMP = 'toshoki.campaign.v1';
const KEY_SET = 'toshoki.settings.v1';
const SPEEDS = [0, 1.5, 3, 6]; // 1秒あたりの日数

function readJSON(key, fallback) {
  try { return JSON.parse(store?.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJSON(key, v) {
  try { store?.setItem(key, JSON.stringify(v)); } catch { /* 保存できない環境では何もしない */ }
}

const app = {
  world: null,
  map: null,
  state: { speed: 0, selCity: null, selMerchant: null, pick: null, hoverRoute: null, modals: 0 },
  settings: { fx: 1, sound: true, autoPause: true, ...readJSON(KEY_SET, {}) },
  campaign: { cleared: {}, heirlooms: [], ...readJSON(KEY_CAMP, {}) },
  sfx,
  els: {},
  shownSilver: 0,
};

setSound(app.settings.sound);
fx.setFxLevel(app.settings.fx);

app.setSetting = (k, v) => {
  app.settings[k] = v;
  writeJSON(KEY_SET, app.settings);
  setSound(app.settings.sound);
  fx.setFxLevel(app.settings.fx);
};

app.toast = (text, opts) => fx.toast(text, opts);
app.error = (text) => { sfx.error(); fx.toast(text, { kind: 'bad', icon: 'ui/crash' }); };
app.modalClosed = () => { app.state.modals = Math.max(0, app.state.modals - 1); app.render(); };
app.hasSave = () => !!store?.getItem(KEY_SAVE);

app.save = () => {
  if (!app.world) return;
  try { store?.setItem(KEY_SAVE, G.serialize(app.world)); } catch { /* 容量不足などは無視 */ }
};

app.loadSave = () => {
  try {
    const w = G.deserialize(store.getItem(KEY_SAVE));
    mount(w);
  } catch (e) {
    app.error(`セーブを読み込めなかった: ${e.message}`);
    app.showTitle();
  }
};

app.startScenario = (id) => {
  const seed = Math.floor(Math.random() * 1e9);
  const w = G.createWorld(id, { seed, heirlooms: app.campaign.heirlooms });
  mount(w);
  fx.banner(`${w.scenario.no}. ${w.scenario.title}`, '目標を確かめて、最初の商いへ', 'ui/logo');
};

app.inherit = (k) => {
  app.campaign.heirlooms.push(k);
  writeJSON(KEY_CAMP, app.campaign);
};

app.showTitle = () => {
  app.state.speed = 0;
  clear(document.getElementById('app'));
  titleScreen(app);
};

app.confirm = (title, text, onOk) => {
  app.state.modals++;
  setSpeed(0);
  modal(app, title, h('div', {}, text), (close) => [h('span', { style: { flex: 1 } }), h('button', { class: 'btn ghost', onclick: close }, 'やめる'), h('button', { class: 'btn primary', onclick: () => { close(); onOk(); } }, '決定')]);
};

// アクションを実行し、結果の出来事を演出につなぐ
app.run = (fn, sound) => {
  const r = fn();
  if (!r.ok) { app.error(r.error); return r; }
  if (sound === 'hire' || sound === 'build' || sound === 'road') sfx.levelUp();
  flushEvents();
  app.save();
  app.render();
  return r;
};

app.afterTrade = (r, x, y, before) => {
  const silverEl = app.els.silver;
  for (const f of r.fx) {
    if (f.type === 'profit') {
      const big = f.amount > 400 ? 'huge' : f.amount > 120 ? 'big' : 'normal';
      fx.floatNumber(x, y - 10, `+${fmt(f.amount)} 銀`, { size: big });
      fx.coinsTo(x, y, silverEl, Math.min(14, 4 + Math.round(f.amount / 40)));
      sfx.coin(f.amount, f.streak);
      if (f.streak >= 3) setTimeout(() => fx.floatNumber(x, y - 50, `🔥 ${f.streak}連続黒字！`, { size: 'normal' }), 200);
      if (f.amount > 400) { fx.flash(); fx.shake(); }
    }
    if (f.type === 'loss') { fx.floatNumber(x, y - 10, `${fmt(f.amount)} 銀`, { negative: true }); sfx.loss(); }
    if (f.type === 'hit') {
      setTimeout(() => {
        fx.banner('読み的中！', `${GOODS[f.good].name}が予想より +${fmt(f.diff)} 銀高く売れた`, 'ui/star');
        fx.burst(innerWidth / 2, innerHeight / 2, 26, { size: 22 });
        sfx.hit();
      }, 350);
    }
    if (f.type === 'contract') setTimeout(() => { fx.banner('大口注文 達成！', `報酬 +${fmt(f.reward)} 銀`, 'ui/contract'); sfx.levelUp(); }, 700);
    if (f.type === 'streakBroken') fx.toast(`連続黒字が途切れた（${f.was}連続）`, { kind: 'bad' });
  }
  if (!r.fx.some((f) => f.type === 'profit' || f.type === 'loss')) sfx.click();
  flushEvents({ skipTrade: true });
  app.save();
  app.render();
};

app.afterOrder = (mid) => {
  sfx.levelUp();
  fx.banner('定期便 開始！', 'あとは自動で回る。次の一手を考えよう', 'ui/route');
  flushEvents({ quiet: true });
  app.save();
  app.render();
};

app.pickDestination = (mid) => {
  const m = G.getMerchant(app.world, mid);
  if (!m || m.travel) return;
  const days = {};
  for (const id of Object.keys(app.world.cities)) {
    if (id === m.city) continue;
    const r = G.findPath(app.world, m.city, id, m.transport);
    if (r) days[id] = r.days;
  }
  app.state.selMerchant = mid;
  app.state.pick = { mid, days };
  fx.toast(`${m.name}の行き先を地図で選ぶ（Esc でやめる）`, { icon: `transport/${m.transport}` });
  app.render();
};

app.depart = (mid, to, guards) => {
  const r = G.travel(app.world, mid, to, { guards });
  if (!r.ok) return app.error(r.error);
  sfx.depart();
  app.state.pick = null;
  app.state.hoverRoute = null;
  if (app.state.speed === 0 && app.state.modals === 0) setSpeed(app.lastSpeed || 1);
  app.save();
  app.render();
};

function setSpeed(s) {
  if (s > 0) app.lastSpeed = s;
  app.state.speed = s;
  renderTop();
}

// ---------- 出来事 → 演出 ----------
function flushEvents({ skipTrade = false, quiet = false, events = null } = {}) {
  const evs = events || G.drainEvents(app.world);
  const feed = app.els.feed;
  for (const e of evs) {
    if (feed) addFeed(e);
    if (quiet) continue;
    const at = cityScreen(e.city);
    switch (e.type) {
      case 'tierUp': fx.banner(`${app.world.cities[e.city].name}が「${G.tierName(e.tier)}」に！`, '新しい需要が生まれた', `cities/tier${e.tier}`); sfx.fanfare(); fx.burst(at[0], at[1], 30); break;
      case 'tierDown': fx.toast(e.text, { kind: 'bad', icon: 'ui/famine' }); sfx.bad(); break;
      case 'rush': fx.toast(e.text, { kind: 'rare', icon: 'ui/rush' }); sfx.rush(); fx.burst(at[0], at[1], 22, { size: 16 }); break;
      case 'crash': fx.toast(e.text, { kind: 'bad', icon: 'ui/crash' }); sfx.crash(); break;
      case 'repUp': fx.banner(`評判 レベル${e.level}`, '手数料が下がった！', 'ui/trophy'); sfx.levelUp(); break;
      case 'contract': fx.toast(e.text, { kind: 'rare', icon: 'ui/contract' }); sfx.rare(); break;
      case 'contractDone': if (!skipTrade) { fx.banner('大口注文 達成！', e.text, 'ui/contract'); sfx.levelUp(); } break;
      case 'contractFail': fx.toast(e.text, { kind: 'bad' }); break;
      case 'hit': break;
      case 'profit':
        if (!skipTrade && e.auto) {
          const m = app.world.player.merchants.find((x) => x.id === e.merchant);
          const p = m ? app.map.screenPos(...app.map.unitPos(m)) : at;
          if (app.settings.fx > 0) fx.floatNumber(p[0], p[1] - 20, `+${fmt(e.amount)}`, { size: e.amount > 300 ? 'big' : 'normal' });
          sfx.coin(e.amount * 0.5, Math.min(4, e.streak));
        }
        break;
      case 'loss': if (!skipTrade && e.auto) sfx.loss(); break;
      case 'robbed': fx.toast(e.text, { kind: 'bad', icon: 'transport/bandit' }); sfx.bad(); fx.shake(); break;
      case 'repelled': fx.toast(e.text, { icon: 'transport/guard' }); sfx.levelUp(); break;
      case 'starve': fx.toast(e.text, { kind: 'bad', icon: 'ui/famine' }); sfx.bad(); break;
      case 'famine': case 'plague': case 'sandstorm': fx.toast(e.text, { kind: 'bad', icon: e.type === 'sandstorm' ? 'ui/storm' : 'ui/famine' }); break;
      case 'festival': case 'fashion': fx.toast(e.text, { kind: 'rare', icon: 'ui/festival' }); sfx.rare(); break;
      case 'harvest': case 'windfall': fx.toast(e.text, { kind: 'rare', icon: e.type === 'windfall' ? 'ui/sugar-crystal' : 'terrain/field' }); sfx.rare(); break;
      case 'rumor': break;
      case 'arrive': sfx.arrive(); break;
      case 'unlock': case 'transport': case 'hire': case 'build': case 'road': case 'aid': case 'donate': fx.toast(e.text, { icon: 'ui/star' }); break;
      case 'orderStuck': case 'debt': fx.toast(e.text, { kind: 'bad' }); sfx.bad(); break;
      case 'milestone': fx.toast(e.text, { icon: 'ui/star' }); sfx.rare(); break;
      case 'victory': setTimeout(() => { sfx.victory(); fx.flash(); fx.burst(innerWidth / 2, innerHeight / 3, 60, { size: 24 }); }, 100); break;
      default: break;
    }
  }
  return evs;
}

function cityScreen(id) {
  const c = app.world.cities[id];
  if (!c || !app.map) return [innerWidth / 2, innerHeight / 2];
  return app.map.screenPos(c.x, c.y);
}

function addFeed(e) {
  const feed = app.els.feed;
  const el = h('div', { class: `ev ${e.big ? 'big' : ''} ${e.bad ? 'bad' : ''} ${e.rare ? 'rare' : ''} ${e.news || e.type === 'rumor' ? 'news' : ''}` }, h('span', { class: 'd' }, `${e.day}日`), h('span', {}, e.text));
  if (e.city && app.world.cities[e.city]) el.style.cursor = 'pointer', el.addEventListener('click', () => { app.state.selCity = e.city; app.render(); });
  feed.prepend(el);
  while (feed.children.length > 120) feed.lastChild.remove();
}

// ---------- 画面 ----------
function mount(world) {
  app.world = world;
  app.state = { speed: 0, selCity: null, selMerchant: world.player.merchants[0]?.id, pick: null, hoverRoute: null, modals: 0 };
  app.shownSilver = world.player.silver;
  const root = clear(document.getElementById('app'));
  document.querySelector('.title-screen')?.remove();
  app.els.top = h('div', { class: 'topbar' });
  app.els.goals = h('div', { class: 'goalbar' });
  const mapWrap = h('div', { class: 'mapwrap' });
  app.els.side = h('div', { class: 'side-scroll' });
  app.els.feed = h('div', { class: 'feed', 'aria-label': '出来事' });
  app.els.merchants = h('div', { class: 'merchants' });
  app.els.tutorial = h('div', { class: 'tutorial hidden' });
  add(mapWrap, app.els.tutorial);
  add(root, app.els.top, app.els.goals, h('div', { class: 'main' }, mapWrap, h('div', { class: 'side' }, app.els.side, app.els.feed)), app.els.merchants);
  app.map = createMap(mapWrap, world, {
    onCity: (id) => onCityClick(id),
    onEdge: (id) => {
      const e = world.edges.find((x) => x.id === id);
      fx.toast(`${world.cities[e.a].name}〜${world.cities[e.b].name}: ${G.ROUTE_KINDS[e.kind].name}、距離${e.len}${e.danger ? `、危険度${e.danger}` : ''}`);
    },
  });
  G.drainEvents(world);
  for (const e of world.log.slice(-40)) addFeed(e);
  renderTop(true);
  app.render();
  // 最初は一時停止で始める。手引きのあるシナリオでは手引きを出す
}

function onCityClick(id) {
  const st = app.state;
  if (st.pick) {
    if (st.pick.days[id] === undefined) return app.error('その町へは行けない');
    const mid = st.pick.mid;
    st.pick = null;
    st.hoverRoute = null;
    app.state.modals++;
    setSpeed(0);
    departDialog(app, mid, id);
    return;
  }
  st.selCity = st.selCity === id ? null : id;
  sfx.click();
  app.render();
}

function renderTop(force = false) {
  const w = app.world;
  if (!w) return;
  const top = app.els.top;
  const pl = w.player;
  if (force || !app.els.silver) {
    clear(top);
    app.els.silverNum = h('span', { class: 'big num' }, fmt(pl.silver));
    app.els.silver = h('div', { class: 'stat silver-stat', title: '銀（お金）' }, icon('ui/silver'), app.els.silverNum);
    app.els.rep = h('div', { class: 'stat', title: '評判（上がると手数料が下がる）' }, icon('ui/trophy', 'icon-sm'), h('span'));
    app.els.streak = h('div', { class: 'stat streak', title: '連続黒字' }, '🔥', h('span'));
    app.els.date = h('div', { class: 'date' });
    app.els.speed = h('div', { class: 'speed' });
    add(top, 
      h('div', { class: 'brand', onclick: () => app.confirm('タイトルへ戻る', '今の状態は自動で保存されています。', () => app.showTitle()) }, h('img', { src: 'assets/svg/ui/sugar-crystal.svg', class: 'icon', alt: '' }), '糖商記', h('small', {}, 'GREAT GLUCOSE EMPIRE')),
      app.els.silver, app.els.rep, app.els.streak, app.els.date, app.els.speed,
      h('button', { class: 'btn ghost small', onclick: () => { app.state.modals++; setSpeed(0); ledgerDialog(app); } }, '帳簿'),
      h('button', { class: 'btn ghost small', onclick: () => { app.state.modals++; setSpeed(0); helpDialog(app); } }, '遊び方'),
      h('button', { class: 'btn ghost small', onclick: () => { app.state.modals++; setSpeed(0); settingsDialog(app); } }, '設定'));
  }
  // 所持金はカウントアップで動かす
  const target = Math.floor(pl.silver);
  if (target !== Math.floor(app.shownSilver)) {
    fx.countUp(app.els.silverNum, app.shownSilver, target, Math.min(900, 250 + Math.abs(target - app.shownSilver)));
    app.els.silver.classList.remove('flash-up', 'flash-down');
    void app.els.silver.offsetWidth;
    if (Math.abs(target - app.shownSilver) > 3) app.els.silver.classList.add(target > app.shownSilver ? 'flash-up' : 'flash-down');
    app.shownSilver = target;
  }
  app.els.rep.lastChild.textContent = `評判Lv${pl.repLevel}`;
  app.els.streak.lastChild.textContent = ` ${pl.streak}`;
  app.els.streak.classList.toggle('hot', pl.streak >= 3);
  app.els.date.textContent = G.dateString(w.day);
  clear(app.els.speed);
  ['⏸', '▶', '▶▶', '▶▶▶'].forEach((label, i) => add(app.els.speed, h('button', { class: `btn small ${app.state.speed === i ? 'on' : ''}`, title: i ? `${i}倍速（${i}キー）` : '一時停止（スペース）', onclick: () => { sfx.click(); setSpeed(i); } }, label)));
}

function renderGoals() {
  const w = app.world;
  const el = clear(app.els.goals);
  for (const g of G.goalsStatus(w)) {
    add(el, h('div', { class: `goal ${g.done ? 'done' : ''} ${g.p > 0.85 && !g.done ? 'near' : ''}` }, g.done ? '✔' : '◇', h('span', {}, g.text.split('（')[0]), h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(g.p * 100)}%` } })), h('span', { class: 'num dim' }, `${Math.round(g.p * 100)}%`)));
  }
  const left = w.scenario.deadline - w.day;
  add(el, h('div', { class: `deadline ${left < 30 ? 'warn' : ''}` }, w.finished ? (w.finished.win ? `達成 ランク${w.finished.rank}` : '期限切れ') : `期限まで ${left} 日（S: ${Math.max(0, Math.floor(w.scenario.deadline * (w.scenario.rankS ?? 0.55)) - w.day)}日）`));
}

function renderMerchants() {
  const w = app.world;
  const el = clear(app.els.merchants);
  for (const m of w.player.merchants) {
    const t = TRANSPORTS[m.transport];
    const used = G.cargoUsed(m);
    const where = m.travel ? `→ ${w.cities[m.travel.to].name}（あと${Math.max(1, Math.ceil(m.travel.totalDays - m.travel.elapsed))}日）` : `${w.cities[m.city].name}に滞在`;
    const cargo = Object.entries(m.cargo);
    const card = h('div', { class: `mcard ${app.state.selMerchant === m.id ? 'sel' : ''}`, onclick: () => { app.state.selMerchant = m.id; if (!m.travel) app.state.selCity = m.city; app.render(); } },
      h('img', { class: 'portrait', src: `assets/svg/transport/${m.portrait}.svg`, alt: '' }),
      h('div', { class: 'info' },
        h('div', { class: 'name' }, h('span', {}, `${m.id}. ${m.name}`), h('span', { class: 'dim', style: { fontWeight: 500, fontSize: '12px' } }, icon(`transport/${m.transport}`, 'icon-sm'), ` ${used}/${t.cap}`)),
        h('div', { class: 'where' }, where, m.order ? (m.order.paused ? ' ・定期便(停止)' : ' ・定期便') : ''),
        h('div', { class: 'cargo-bar' }, h('i', { style: { width: `${(used / t.cap) * 100}%` } })),
        m.travel ? h('div', { class: 'progress-bar' }, h('i', { style: { width: `${Math.min(100, (m.travel.elapsed / Math.max(1, m.travel.totalDays)) * 100)}%` } })) : null,
        h('div', { style: { display: 'flex', gap: '2px', flexWrap: 'wrap', minHeight: '18px' } }, cargo.slice(0, 6).map(([g, q]) => h('span', { title: `${GOODS[g].name} ${q}` }, goodIcon(g, 'icon-sm'), h('small', { class: 'num' }, q)))),
        h('div', { class: 'acts' },
          h('button', { class: 'btn small primary', disabled: !!m.travel || undefined, onclick: (e) => { e.stopPropagation(); openTradeFor(m.id); } }, '交易'),
          h('button', { class: 'btn small', disabled: !!m.travel || undefined, onclick: (e) => { e.stopPropagation(); app.pickDestination(m.id); } }, '出発'),
          h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); app.state.modals++; setSpeed(0); orderDialog(app, m.id); } }, '定期便'),
          !m.travel ? transportButton(m) : null)));
    add(el, card);
  }
  const max = w.scenario.maxMerchants ?? 4;
  if (w.player.merchants.length < max) add(el, h('div', { class: 'mcard add', title: '商人がいる町の画面から雇える' }, `＋ 商人 ${w.player.merchants.length}/${max}`));
}

function transportButton(m) {
  const w = app.world;
  const city = w.cities[m.city];
  const opts = Object.keys(TRANSPORTS).filter((t) => t !== m.transport && G.canBuyTransportAt(w, city, t));
  if (!opts.length) return null;
  return h('button', { class: 'btn small', onclick: (e) => {
    e.stopPropagation();
    app.state.modals++;
    setSpeed(0);
    const body = h('div', {}, opts.map((t) => {
      const d = TRANSPORTS[t];
      return h('div', { class: 'contract' }, icon(`transport/${t}`, 'icon-lg'), h('div', { style: { flex: 1 } }, h('b', {}, d.name), h('div', { class: 'dim' }, `積載${d.cap}・速さ${d.speed}・維持費${d.upkeep}/日・${d.modes.map((x) => G.ROUTE_KINDS[x].name).join('/')}`)),
        h('button', { class: 'btn primary small', onclick: () => { const r = app.run(() => G.buyTransport(w, m.id, t)); if (r.ok) { sfx.fanfare(); md.close(); } } }, `${d.cost - TRANSPORTS[m.transport].cost * 0.5}銀`));
    }), h('div', { class: 'faint' }, `今の${TRANSPORTS[m.transport].name}は半額で下取り。`));
    const md = modal(app, `${m.name}の輸送手段`, body);
  } }, '乗換');
}

function openTradeFor(mid) {
  app.state.modals++;
  setSpeed(0);
  openTrade(app, mid);
}

function renderTutorial() {
  const w = app.world;
  const el = app.els.tutorial;
  const steps = w.scenario.tutorial;
  if (!steps) { el.classList.add('hidden'); return; }
  const idx = steps.findIndex((s) => !s.done(w));
  if (idx < 0) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  clear(el);
  add(el, h('span', { class: 'tog' }, el.classList.contains('mini') ? '全部見る' : '小さくする'), h('b', {}, '手引き'), h('ol', { class: 'steps' }, steps.map((s, i) => h('li', { class: i < idx ? 'done' : i === idx ? 'now' : '' }, s.text))));
  if (!el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('click', () => { el.classList.toggle('mini'); renderTutorial(); }); }
}

app.render = () => {
  if (!app.world) return;
  renderTop();
  renderGoals();
  renderMerchants();
  renderSide(app, app.els.side);
  renderTutorial();
  app.map.update(app.world, app.state);
};

// ---------- 時間の進行 ----------
let acc = 0;
let last = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const w = app.world;
  if (w && app.state.speed > 0 && app.state.modals === 0 && !(w.finished && !w.continueAfterEnd)) {
    acc += dt * SPEEDS[app.state.speed];
    let ticked = false;
    while (acc >= 1) {
      acc -= 1;
      const adv = G.advance(w, 1, { stopOn: new Set() });
      ticked = true;
      const evs = flushEvents({ events: adv.events });
      if (w.day % 10 === 0) app.save();
      if (evs.some((e) => e.type === 'victory' || e.type === 'defeat')) { finish(); break; }
      if (app.settings.autoPause && evs.some((e) => e.type === 'arrive')) {
        setSpeed(0);
        const e = evs.find((x) => x.type === 'arrive');
        app.state.selMerchant = e.merchant;
        app.state.selCity = e.city;
        fx.toast(`${e.text}。交易しよう`, { icon: 'ui/silver' });
        break;
      }
    }
    if (ticked) app.render();
  } else acc = 0;
}

function finish() {
  setSpeed(0);
  const w = app.world;
  w.resultShown = true;
  if (w.finished.win) {
    const prev = app.campaign.cleared[w.scenarioId];
    const order = ['C', 'B', 'A', 'S'];
    if (!prev || order.indexOf(w.finished.rank) > order.indexOf(prev)) app.campaign.cleared[w.scenarioId] = w.finished.rank;
    writeJSON(KEY_CAMP, app.campaign);
  }
  app.save();
  setTimeout(() => { app.state.modals++; resultDialog(app); }, 900);
}
app.checkFinish = () => { if (app.world.finished && !app.world.resultShown) { app.world.resultShown = true; finish(); } };

// 交易で目標を達成した場合
const origAfterTrade = app.afterTrade;
app.afterTrade = (...a) => { origAfterTrade(...a); app.checkFinish(); };

document.addEventListener('keydown', (e) => {
  if (!app.world || e.target.closest?.('input, select, textarea')) return;
  if (e.key === ' ' && app.state.modals === 0) { e.preventDefault(); setSpeed(app.state.speed ? 0 : app.lastSpeed || 1); }
  if (['1', '2', '3'].includes(e.key) && app.state.modals === 0) setSpeed(Number(e.key));
  if (e.key === 'Escape' && app.state.pick) { app.state.pick = null; app.state.hoverRoute = null; app.render(); }
});

// 行き先を選んでいる間は、カーソルの町までの経路を光らせる
document.addEventListener('mousemove', (e) => {
  const st = app.state;
  if (!st.pick || !app.world) return;
  const node = e.target.closest?.('.city-node');
  if (!node) { if (st.hoverRoute) { st.hoverRoute = null; app.map.update(app.world, st); } return; }
  const id = Object.values(app.world.cities).find((c) => node.getAttribute('transform') === `translate(${c.x},${c.y})`)?.id;
  const m = G.getMerchant(app.world, st.pick.mid);
  if (!id || !m || id === m.city) return;
  const r = G.findPath(app.world, m.city, id, m.transport);
  st.hoverRoute = r;
  app.map.update(app.world, st);
});

window.addEventListener('beforeunload', () => app.save());

// 開発用: #play=s2 で直接シナリオを始める
const direct = location.hash.match(/play=(\w+)/);
if (direct && (G.SCENARIOS[direct[1]] || direct[1] === 'free')) {
  app.startScenario(direct[1]);
  if (/open=trade/.test(location.hash)) { app.state.modals++; openTrade(app, 1); }
  if (/open=order/.test(location.hash)) { app.state.modals++; orderDialog(app, 1); }
  if (/open=city/.test(location.hash)) { app.state.selCity = app.world.player.merchants[0].city; app.render(); }
  if (/selftest/.test(location.hash)) { app.setSetting('sound', false); import('./selftest.js').then((m) => m.selftest(app)); }
  if (/open=result/.test(location.hash)) { app.world.finished = { win: true, rank: 'S', day: 100, score: 3200 }; app.state.modals++; resultDialog(app); }
}
else app.showTitle();
// 時間はタイマーで進める（背景タブでも一定に動き、ヘッドレスでも試験できる）
setInterval(loop, 50);
window.__toshoki = app;
