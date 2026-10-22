// ブラウザ版の入口: 状態、時間の進行、画面の組み立て、演出のつなぎ込み
import { h, add, clear, icon, goodIcon, fmt, safeStorage } from './dom.js';
import { createWorldView } from './world.js';
import { openTrade } from './tradeDialog.js';
import { renderSide, departDialog, orderDialog, ledgerDialog, helpDialog, settingsDialog, resultDialog, titleScreen, modal, techDialog, hireDialog } from './panels.js';
import { sfx, setSound } from './audio.js';
import { setMusic, setMusicMood, regionFor } from './music.js';
import { openDistrict } from './district.js';
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
  campaign: { cleared: {}, unlocked: [], ...readJSON(KEY_CAMP, {}) },
  sfx,
  els: {},
  shownSilver: 0,
};

setSound(app.settings.sound, app.settings.sfxVol ?? 0.5);
fx.setFxLevel(app.settings.fx);
// 音楽はブラウザの決まりで、最初に画面を触ってから鳴らす
document.addEventListener('pointerdown', () => setMusic(app.settings.music ?? true, app.settings.musicVol ?? 0.35), { once: true });

app.setSetting = (k, v) => {
  app.settings[k] = v;
  writeJSON(KEY_SET, app.settings);
  setSound(app.settings.sound, app.settings.sfxVol ?? 0.5);
  setMusic(app.settings.music ?? true, app.settings.musicVol ?? 0.35);
  fx.setFxLevel(app.settings.fx);
};

app.toast = (text, opts) => fx.toast(text, opts);
app.openDistrict = (id) => { setSpeed(0); openDistrict(app, id); };
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

// 古い保存（重ねがけの家訓）から、解放済みの一覧へ移す
if (app.campaign.heirlooms) {
  app.campaign.unlocked = [...new Set([...(app.campaign.unlocked || []), ...app.campaign.heirlooms])];
  delete app.campaign.heirlooms;
}

// シナリオを始める。解放済みの家訓があれば、1つだけ選んでから始める
app.startScenario = (id, heirloom) => {
  const unlocked = (app.campaign.unlocked || []).filter((k) => G.HEIRLOOMS[k]);
  if (heirloom === undefined && unlocked.length) return heirloomPicker(id, unlocked);
  // 開発・テスト用: #play=free&seed=7 でシードを決められる
  const seed = Number(location.hash.match(/seed=(\d+)/)?.[1]) || Math.floor(Math.random() * 1e9);
  // 開発用: #play=s2&v3 で、版3の町のある形（自己テストと、古い画面の撮影用）
  const w = G.createWorld(id, { seed, heirloom: heirloom || null, v3: /[&#]v3(&|$)/.test(location.hash) });
  mount(w);
  fx.banner(`${w.scenario.no}. ${w.scenario.title}`, heirloom ? `家訓「${G.HEIRLOOMS[heirloom].name}」を胸に` : '目標を確かめて、最初の商いへ', 'ui/logo');
};

function heirloomPicker(id, unlocked) {
  let chosen = app.campaign.lastHeirloom && unlocked.includes(app.campaign.lastHeirloom) ? app.campaign.lastHeirloom : null;
  const grid = h('div', { class: 'heirlooms' });
  const draw = () => {
    clear(grid);
    add(grid, h('div', { class: `heirloom ${chosen === null ? 'sel' : ''}`, onclick: () => { chosen = null; draw(); } }, h('b', {}, '家訓なし'), h('div', { class: 'dim' }, '素の腕前で挑む')));
    for (const k of Object.keys(G.HEIRLOOMS)) {
      const x = G.HEIRLOOMS[k];
      const ok = unlocked.includes(k);
      add(grid, h('div', { class: `heirloom ${chosen === k ? 'sel' : ''} ${ok ? '' : 'locked'}`, onclick: () => { if (ok) { chosen = k; draw(); } } },
        h('b', {}, ok ? x.name : '？？？'),
        ok ? [h('div', { class: 'good' }, `＋ ${x.plus}`), h('div', { class: 'bad' }, `－ ${x.minus}`)] : h('div', { class: 'faint' }, `「${G.SCENARIOS[x.unlock].title}」を達成で解放`)));
    }
  };
  draw();
  app.state.modals++;
  modal(app, '家訓を1つ選ぶ', h('div', {}, h('div', { class: 'dim', style: { marginBottom: '8px' } }, '一族に伝わる家訓から、ひとつだけ持っていける。どれにも利点と代償がある。'), grid), (close) => [
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn ghost', onclick: close }, 'やめる'),
    h('button', { class: 'btn primary', onclick: () => { close(); app.campaign.lastHeirloom = chosen; writeJSON(KEY_CAMP, app.campaign); app.startScenario(id, chosen); } }, 'この家訓で始める'),
  ], { onClose: () => { if (!app.world) app.showTitle(); } });
}

// シナリオを達成したら、そのシナリオの家訓を解放する
app.unlockHeirloom = (scenarioId) => {
  const k = G.heirloomFor(scenarioId);
  if (!k) return null;
  const fresh = !(app.campaign.unlocked || []).includes(k);
  if (fresh) app.campaign.unlocked = [...(app.campaign.unlocked || []), k];
  writeJSON(KEY_CAMP, app.campaign);
  return { key: k, fresh };
};

app.showTitle = () => {
  app.state.speed = 0;
  clear(document.getElementById('app'));
  titleScreen(app);
};

app.confirm = (title, text, onOk) => {
  app.state.modals++;
  setSpeed(0);
  // 町のないシナリオで始める前なら、どう閉じても、選び直しに戻る
  modal(app, title, h('div', { style: { whiteSpace: 'pre-line', lineHeight: 1.7 } }, text), (close) => [h('span', { style: { flex: 1 } }), h('button', { class: 'btn ghost', onclick: close }, 'やめる'), h('button', { class: 'btn primary', onclick: () => { close(); onOk(); } }, '決定')], { onClose: () => { if (app.world?.setup) setTimeout(() => app.setupFlow(), 60); } });
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
  if (!r.fx.some((f) => f.type === 'profit' || f.type === 'loss')) (r.rows?.some((x) => x.qty > 0) ? sfx.buy() : sfx.click());
  flushEvents({ skipTrade: true });
  app.save();
  app.render();
};

app.afterOrder = (mid) => {
  sfx.order();
  fx.banner('定期便 開始！', 'あとは自動で回る。次の一手を考えよう', 'ui/route');
  flushEvents({ quiet: true });
  app.save();
  app.render();
};

app.pickDestination = (mid, { toggle = true } = {}) => {
  const m = G.getMerchant(app.world, mid);
  if (!m || m.travel) return;
  // 選んでいる最中にもう一度「出発」を押すとやめる（触って操作する画面には Esc がないため）。交易の画面などから来たときはやめない
  if (toggle && app.state.pick?.mid === mid) { endPick(); app.render(); return; }
  const days = {};
  for (const id of Object.keys(app.world.cities)) {
    if (id === m.city) continue;
    const r = G.findPath(app.world, m.city, id, m.transport);
    if (r) days[id] = r.days;
  }
  app.state.selMerchant = mid;
  app.state.pick = { mid, days };
  app.map?.frameCities([m.city, ...Object.keys(days)], m.city);
  // 選んでいる間は案内を残し、選び終えたら消す（すぐ消えると何をする場面か分からず、出発後も残ると紛らわしかった）
  app.pickToast?.remove();
  const how = window.matchMedia?.('(hover: none)').matches ? 'もう一度「出発」でやめる' : 'Esc でやめる';
  app.pickToast = fx.toast(`${m.name}の行き先を地図で選ぶ（${how}）`, { icon: `transport/${m.transport}`, sticky: true });
  app.render();
};

// 行き先を選ぶのを終える（案内も一緒に消す。確かめの画面の上に「地図で選ぶ」が残っていた。Sol の指摘）
function endPick() {
  app.state.pick = null;
  app.state.hoverRoute = null;
  app.pickToast?.remove();
  app.pickToast = null;
}
// 出発の確かめを開く。開けなかったときに、開いた数だけが残らないようにする
function openDepart(mid, to) {
  endPick();
  const m = G.getMerchant(app.world, mid);
  if (!m || m.travel || !G.findPath(app.world, m.city, to, m.transport)) return app.error('今はその町へ出発できない');
  setSpeed(0);
  app.state.modals++;
  try { departDialog(app, mid, to); } catch (e) { app.state.modals = Math.max(0, app.state.modals - 1); throw e; }
}
app.openDepart = openDepart;

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
    if (e.quiet) continue;
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
      case 'unlock': case 'transport': case 'hire': case 'build': case 'road': case 'aid': case 'donate': case 'place': case 'civic': case 'expand': case 'branch': case 'settlers': case 'settled': fx.toast(e.text, { icon: 'ui/star' }); break;
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
  app.map = createWorldView(mapWrap, world, {
    onCity: (id) => onCityClick(id),
    onCityDouble: (id) => app.openDistrict(id),
    onHoverCity: (id) => hoverRouteTo(id),
    onBuildTile: (wx, wy) => buildAt(wx, wy),
    onFoundTile: (x, y) => foundAt(x, y),
  });
  G.drainEvents(world);
  for (const e of world.log.slice(-40)) addFeed(e);
  renderTop(true);
  app.render();
  // 最初は一時停止で始める。手引きのあるシナリオでは手引きを出す
  // 町のないシナリオで、まだ始めていなければ: 一族を選ぶ → 最初の交易所を置く
  if (world.setup) setTimeout(() => app.setupFlow(), 250);
}

// ---------- 町のないシナリオの始まり（版4 H2） ----------
app.setupFlow = () => {
  const W = app.world;
  if (!W.setup) return;
  if (G.setupStage(W) === 'family') return familyDialog();
  if (!app.state.found) {
    app.startFound();
    // 一番良い候補地を画面の真ん中に（スマホでは手引きの枠に隠れていた）
    const s = app.state.found?.sites?.[0];
    if (s) requestAnimationFrame(() => app.map.centerTile(s.x, s.y, 0.9));
  }
};
function familyDialog() {
  const W = app.world;
  const cards = G.familyList(W).map((f) => {
    const [fx, fy] = G.tileOf(f.x, f.y);
    // 館の近くの集落（最初の交易所で取り込めるもの）
    const near = (W.hamlets || []).filter((hm) => Math.max(Math.abs(hm.x - fx), Math.abs(hm.y - fy)) <= G.HQ_RANGE + 2);
    const wilds = (W.wilds || []).filter((w) => Math.max(Math.abs(w.x - fx), Math.abs(w.y - fy)) <= G.HQ_RANGE + 2);
    return h('div', { class: 'hire-card' },
      h('div', { class: 'talent' }, f.name),
      h('div', { class: 'muted' }, f.text || ''),
      h('div', { class: 'dim', style: { fontSize: '12px' } }, `館の近くの集落: ${near.map((hm) => `${hm.name}（${Object.keys(hm.foods).map((g) => GOODS[g].name).join('・')}）`).join('、') || 'なし'}`),
      wilds.length ? h('div', { class: 'dim', style: { fontSize: '12px' } }, `近くの古い建物: ${wilds.map((w) => G.CIVICS[w.type].name).join('、')}`) : null,
      h('button', { class: 'btn primary small', onclick: () => { const r = app.run(() => G.chooseFamily(W, f.id)); if (r.ok) app.map.centerTile(...W.player.hq, 0.9); md.close(); app.render(); } }, 'この一族で始める'));
  });
  app.state.modals++;
  const md = modal(app, '一族を選ぶ（館の立つ地域が決まる）', h('div', {}, h('p', { class: 'muted' }, `${Object.keys(app.world.cities).length ? '自分の交易所はまだない（古い町はあるが、一族のものではない）。' : 'この土地には、市場のある町がまだない。'}一族の館の近くに最初の交易所を置き、集落を町に育てていく。${app.world.rivals.length ? 'ライバルは、選ばなかった一族の館から始める。' : ''}`), h('div', { class: 'hire-cards' }, cards)), () => [], { wide: true, onClose: () => { if (app.world?.setup) setTimeout(() => app.setupFlow(), 60); } });
}

// 建設モード: 町のパネルで建物を選ぶと、地図の上で置けるマスが光る
app.startBuild = (cityId, kind, type) => {
  const city = app.world.cities[cityId];
  const tiles = G.placeableTiles(city, G.cityTier(city), kind === 'civic' ? null : type);
  app.state.build = { city: cityId, kind, type, tiles };
  setSpeed(0);
  app.map.centerOn?.(city.x, city.y);
  const name = kind === 'civic' ? G.CIVICS[type].name : G.PRODUCERS[type].name;
  fx.toast(`${name}を置くマスを地図で選ぶ（光っているマス。Esc でやめる）`, { icon: 'ui/workshop' });
  app.render();
};
function buildAt(wx, wy) {
  const b = app.state.build;
  const city = app.world.cities[b.city];
  const xy = G.worldToDistrict(city, wx, wy);
  if (!xy || !b.tiles.some(([x, y]) => x === xy[0] && y === xy[1])) return app.error('そのマスには置けない（光っているマスを選ぶ）');
  const r = b.kind === 'civic' ? app.run(() => G.buildCivic(app.world, b.city, b.type, xy), 'build') : app.run(() => G.placeProducer(app.world, b.city, b.type, xy[0], xy[1]), 'build');
  if (r.ok) { app.state.build = null; app.render(); }
}
app.buildAt = (wx, wy) => buildAt(wx, wy);
// 道を敷く: 町のパネルで種類を選び、地図で相手の町を選ぶ
app.startPath = (from, kind) => {
  app.state.roadPick = { from, kind };
  app.state.pick = null;
  setSpeed(0);
  fx.toast(`${G.PATH_KINDS[kind].name}でつなぐ相手の町を地図で選ぶ（Esc でやめる）`, { icon: 'ui/workshop' });
  app.render();
};
function finishPath(to) {
  const { from, kind } = app.state.roadPick;
  app.state.roadPick = null;
  app.state.hoverRoute = null;
  if (to === from) return app.render();
  const plan = G.planPath(app.world, from, to, kind);
  if (!plan) return app.error('その2つの町は結べない（山や海を越えられない）');
  if (!plan.newTiles) return app.error('もうその道でつながっている');
  const W = app.world;
  const before = W.allowedTransports.map((t) => [t, G.findPath(W, from, to, t)?.days]);
  app.confirm(`${G.PATH_KINDS[kind].name}を敷く`, h('div', {},
    h('p', {}, `${W.cities[from].name}〜${W.cities[to].name}: 新しく${plan.newTiles}マス、`, h('b', {}, `${plan.cost}銀`), `（手持ち ${Math.floor(W.player.silver)}銀）`),
    h('p', { class: 'muted' }, `${G.PATH_KINDS[kind].note}。敷いた道 ${G.pathsBuilt(W)}/${G.pathsAllowed(W)}本`),
    h('p', { class: 'muted' }, `今の日数: ${before.map(([t, d]) => `${G.TRANSPORTS[t].name} ${d ? `約${d}日` : '行けない'}`).join('・')}`)),
  () => app.run(() => G.buildPath(W, from, to, kind), 'road'));
}
// 交易所を開く: 候補地が光り、どこかのマスを選ぶ
app.startFound = () => {
  const W = app.world;
  if (!G.postsAllowed(W)) return app.error('このシナリオでは交易所を開けない');
  app.state.found = { sites: G.foundSites(W, W.setup ? 12 : 8) };
  setSpeed(0);
  if (W.setup) { app.setupToast?.remove(); app.setupToast = fx.toast('一族の館の近く（黄色の枠の中）に、最初の交易所を置こう（無料）。緑の印は、集落を圏に入れられる場所', { icon: 'ui/workshop', sticky: true }); }
  else fx.toast(`交易所を開く場所を選ぶ（緑の印がおすすめ。${W.scenario.pioneer ? '集落や古い建物のそば' : '道か水辺から2マス以内'}）。費用 ${G.postCost(W)}銀・Esc でやめる`, { icon: 'ui/workshop' });
  app.render();
};
function foundAt(x, y) {
  const W = app.world;
  // 印の近くなら印の場所に寄せる
  const s = app.state.found.sites.find((p) => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1);
  if (s) { x = s.x; y = s.y; }
  const why = G.siteCheck(W, x, y);
  if (why) return app.error(why);
  const setup = !!W.setup;
  app.state.found = null;
  let what;
  if (W.scenario.pioneer) {
    // 町のないシナリオ: 圏に入る集落と古い建物、格上げで入るもの
    const pv = G.sitePreview(W, x, y);
    const hamText = (list) => list.map((hm) => `${hm.name}（人口${hm.pop}・${Object.keys(hm.foods).map((g) => GOODS[g].name).join('・')}）`).join('、');
    what = [
      h('p', {}, pv.hamlets.length ? `圏に入る集落: ${hamText(pv.hamlets)}` : '圏に入る集落はない（人が少なく、採れる品もない）'),
      pv.wilds.length ? h('p', {}, `圏に入る古い建物: ${pv.wilds.map((w) => `${G.CIVICS[w.type].name}（${Object.keys(G.CIVICS[w.type].flat).filter((g) => W.scenario.goods.includes(g)).map((g) => GOODS[g].name).join('・')}を毎日買う）`).join('、')}`) : null,
      h('p', { class: 'muted' }, `人口${pv.pop}人から始まる。${pv.later.hamlets.length || pv.later.wilds.length ? `「市場」に格上げすると、${[hamText(pv.later.hamlets), pv.later.wilds.map((w) => G.CIVICS[w.type].name).join('、')].filter(Boolean).join('、')}も入る。` : ''}違う食べ物を届けると育つ`),
    ];
  } else what = h('p', { class: 'muted' }, `採れそうな品: ${G.siteGoods(W, x, y).map((g) => GOODS[g].name).join('・')}。人口${G.POST_POP}人から始まる。食べ物と甘味を届けると育つ`);
  app.confirm(setup ? '最初の交易所を開く' : '交易所を開く', h('div', {}, h('p', {}, `${x},${y} に${setup ? '最初の交易所を開く（無料）' : '新しい町を開く: '}`, setup ? null : h('b', {}, `${G.postCost(W)}銀`), setup ? null : `（手持ち ${Math.floor(W.player.silver)}銀）`), what),
  () => {
    const r = app.run(() => G.foundPost(W, x, y), 'build');
    if (r.ok) {
      app.state.selCity = r.id;
      if (setup) { app.state.selMerchant = W.player.merchants[0]?.id; app.setupToast?.remove(); app.setupToast = null; renderTop(true); }
      app.render();
    }
  });
}
app.foundAt = (x, y) => foundAt(x, y);
app.clickCity = (id) => onCityClick(id);
function onCityClick(id) {
  const st = app.state;
  if (st.roadPick) return finishPath(id);
  if (st.pick) {
    // 選んでいる間に、その商人が定期便で出た・暇を出された・移動を始めたなら、選ぶのをやめる
    // （そのまま確かめの画面を開こうとして落ち、開いた数だけが残って時間が二度と進まなかった。画面での敵対的評価（Opus）の指摘）
    const pm = G.getMerchant(app.world, st.pick.mid);
    if (!pm || pm.travel || (pm.order && !pm.order.paused)) { endPick(); st.selCity = id; app.render(); return; }
    if (st.pick.days[id] === undefined) return app.error('その町へは行けない');
    const mid = st.pick.mid;
    endPick();
    openDepart(mid, id);
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
    app.els.posts = null;
    app.els.silverNum = h('span', { class: 'big num' }, fmt(pl.silver));
    // 毎日の出費を銀の横に出す（何もしていないのに銀が減る理由が分からなかった。第15回テスト）
    app.els.cost = h('small', { class: 'faint num daily-cost' });
    app.els.silver = h('div', { class: 'stat silver-stat', title: '銀（お金）' }, icon('ui/silver'), app.els.silverNum, app.els.cost);
    app.els.rep = h('div', { class: 'stat', title: '評判（上がると手数料が下がる）' }, icon('ui/trophy', 'icon-sm'), h('span'));
    app.els.streak = h('div', { class: 'stat streak', title: '連続黒字' }, '🔥', h('span'));
    app.els.date = h('div', { class: 'date' });
    app.els.speed = h('div', { class: 'speed' });
    add(top, 
      h('div', { class: 'brand', onclick: () => app.confirm('タイトルへ戻る', '今の状態は自動で保存されています。', () => app.showTitle()) }, h('img', { src: 'assets/svg/ui/sugar-crystal.svg', class: 'icon', alt: '' }), '糖商記', h('small', {}, 'GREAT GLUCOSE EMPIRE')),
      app.els.silver, app.els.rep, app.els.streak, app.els.date, app.els.speed,
      G.postsAllowed(app.world) ? (app.els.posts = h('button', { class: 'btn ghost small', title: '地図のどこかに新しい町を開く', onclick: () => app.startFound() }, '')) : null,
      G.techList(app.world).length ? h('button', { class: 'btn ghost small', title: '技術を買う', onclick: () => { setSpeed(0); techDialog(app); } }, '技術') : null,
      h('button', { class: 'btn ghost small', onclick: () => { app.state.modals++; setSpeed(0); ledgerDialog(app); } }, '帳簿'),
      h('button', { class: 'btn ghost small', onclick: () => { app.state.modals++; setSpeed(0); helpDialog(app); } }, '遊び方'),
      h('button', { class: 'btn ghost small', onclick: () => { app.state.modals++; setSpeed(0); settingsDialog(app); } }, '設定'));
  }
  const dc = G.dailyCost(w, { guards: true });
  app.els.cost.textContent = dc > 0 ? ` −${fmt(dc, 1)}/日` : '';
  app.els.silver.title = `銀（お金）。毎日 ${fmt(dc, 1)}銀かかる: 商人の給金と輸送手段の維持費${pl.buildings.length ? '・工房の維持費' : ''}${pl.branches?.length ? '・商館' : ''}（止まっていてもかかる）`;
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
  const hints = w.finished ? [] : G.goalHints(w);
  if (hints.length) add(el, h('div', { class: 'goalhint' }, hints.map((x) => h('span', { role: 'button', class: x.warn ? 'bad' : '', title: 'この町の様子を見る', onclick: () => { app.state.selCity = x.city; app.render(); } }, '▸ ', x.text))));
  // 「(S: 0日)」の意味が分かりにくかった（15回目の Opus）
  const sLeft = Math.floor(w.scenario.deadline * (w.scenario.rankS ?? 0.55)) - w.day;
  add(el, h('div', { class: `deadline ${left < 30 ? 'warn' : ''}` }, w.finished ? (w.finished.win ? `達成 ランク${w.finished.rank}` : '期限切れ') : `期限まで ${left} 日（${sLeft > 0 ? `ランクSは あと${sLeft}日以内` : 'ランクSの期日は過ぎた'}）`));
}

function renderMerchants() {
  const w = app.world;
  const el = clear(app.els.merchants);
  // 町のないシナリオで始める前: 商人はまだ館にいる
  if (w.setup) {
    add(el, h('div', { class: 'mcard add', role: 'button', style: { cursor: 'pointer' }, onclick: () => app.setupFlow() }, G.setupStage(w) === 'family' ? '一族を選ぶ' : '最初の交易所を置く', h('small', { class: 'dim', style: { display: 'block', fontSize: '11px' } }, '置くと、商人が館から出てくる')));
    return;
  }
  for (const m of w.player.merchants) {
    const t = TRANSPORTS[m.transport];
    const used = G.cargoUsed(m);
    const cap = G.cargoCap(m);
    const where = m.travel ? `→ ${w.cities[m.travel.to].name}（あと${Math.max(1, Math.ceil(m.travel.totalDays - m.travel.elapsed))}日）` : `${w.cities[m.city].name}に滞在`;
    const cargo = Object.entries(m.cargo);
    const card = h('div', { class: `mcard ${app.state.selMerchant === m.id ? 'sel' : ''}`, onclick: () => { app.state.selMerchant = m.id; if (!m.travel) app.state.selCity = m.city; app.render(); } },
      h('img', { class: 'portrait', src: `assets/svg/transport/${m.portrait}.svg`, alt: '' }),
      h('div', { class: 'info' },
        h('div', { class: 'name' }, h('span', { title: m.talent ? G.TALENTS[m.talent].text : '' }, `${m.id}. ${m.name}`, m.talent ? h('small', { class: 'talent' }, ` ${G.TALENTS[m.talent].name}`) : null), h('span', { class: 'dim', style: { fontWeight: 500, fontSize: '12px' } }, icon(`transport/${m.transport}`, 'icon-sm'), ` ${used}/${cap}`)),
        h('div', { class: 'where' }, where, m.order ? (m.order.paused ? ' ・定期便(停止)' : ' ・定期便') : '', m.settlers ? ` ・開拓団${m.settlers.n}人→${w.cities[m.settlers.to].name}` : ''),
        h('div', { class: 'cargo-bar' }, h('i', { style: { width: `${(used / cap) * 100}%` } })),
        m.travel ? h('div', { class: 'progress-bar' }, h('i', { style: { width: `${Math.min(100, (m.travel.elapsed / Math.max(1, m.travel.totalDays)) * 100)}%` } })) : null,
        h('div', { style: { display: 'flex', gap: '2px', flexWrap: 'wrap', minHeight: '18px' } }, cargo.slice(0, 6).map(([g, q]) => h('span', { title: `${GOODS[g].name} ${q}` }, goodIcon(g, 'icon-sm'), h('small', { class: 'num' }, q)))),
        h('div', { class: 'acts' },
          h('button', { class: 'btn small primary', disabled: !!m.travel || undefined, onclick: (e) => { e.stopPropagation(); openTradeFor(m.id); } }, '交易'),
          h('button', { class: 'btn small', disabled: !!m.travel || undefined, onclick: (e) => { e.stopPropagation(); app.pickDestination(m.id); } }, '出発'),
          h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); app.state.modals++; setSpeed(0); orderDialog(app, m.id); } }, '定期便'),
          !m.travel ? transportButton(m) : null,
          !m.travel && w.player.merchants.length > 1 ? h('button', { class: 'btn small ghost', disabled: m.settlers ? true : undefined, title: m.settlers ? '開拓団を連れている間は暇を出せない（交易所に住みつかせてから）' : '輸送手段を半額で下取りし、積荷は今の町で売る。給金と維持費がかからなくなる', onclick: (e) => { e.stopPropagation(); app.confirm(`${m.name}に暇を出す`, `${TRANSPORTS[m.transport].name}を${TRANSPORTS[m.transport].cost * 0.5}銀で下取りし、積荷は${w.cities[m.city].name}で売り払います。`, () => app.run(() => G.dismissMerchant(w, m.id))); } }, '暇') : null)));
    add(el, card);
  }
  const max = G.merchantCap(w);
  // 押すと、商人がいる町で雇う画面を開く（押しても何も起きず、雇えない理由も分からなかった。画面だけのテストの指摘）
  if (w.player.merchants.length < max) add(el, h('div', { class: 'mcard add', role: 'button', style: { cursor: 'pointer' }, title: '商人を雇う', onclick: () => {
    const sel = w.player.merchants.find((x) => x.id === app.state.selMerchant && !x.travel);
    const at = sel?.city || w.player.merchants.find((x) => !x.travel)?.city || Object.keys(w.cities).find((id) => G.hasPresence(w, id));
    if (!at || !G.hasPresence(w, at)) return app.error('雇えるのは、商人が滞在している町か、定期便が回っている町。今は全員が移動中');
    const cost = G.hireCost(w);
    if (w.player.silver < cost) return app.error(`雇うには ${cost} 銀いる（今 ${Math.floor(w.player.silver)} 銀）`);
    hireDialog(app, at, cost, max);
  } }, `＋ 商人 ${w.player.merchants.length}/${max}`, h('small', { class: 'dim', style: { display: 'block', fontSize: '11px' } }, `${w.cities[w.player.merchants.find((x) => !x.travel)?.city]?.name || ''}で ${G.hireCost(w)} 銀`)));
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
  add(el, h('span', { class: 'tog' }, el.classList.contains('mini') ? '全部見る' : '小さくする'), h('b', {}, '手引き'), h('ol', { class: 'steps' }, steps.map((s, i) => h('li', { class: i < idx ? 'done' : i === idx ? 'now' : '' }, typeof s.text === 'function' ? s.text(w) : s.text))));
  if (!el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('click', () => { el.classList.toggle('mini'); renderTutorial(); }); }
}

// 画面（ダイアログ）を開いた直後の 0.4 秒は、その上のクリックを受けない。
// スマホでは、地図をタップして開いた画面に、同じタップのクリックが届き、「決定」を押して銀を使ったり、画面を閉じたりした（画面での敵対的評価（Sol）の指摘）
new MutationObserver((list) => { for (const r of list) for (const n of r.addedNodes) if (n.classList?.contains('modal-back')) n.__openedAt = performance.now(); }).observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', (e) => {
  const back = e.target.closest?.('.modal-back');
  if (back && performance.now() - (back.__openedAt || 0) < 400) { e.stopPropagation(); e.preventDefault(); }
}, true);

// 数の入力欄は、押したら中身を全部選ぶ。打てば置き換わる
// （定期便の個数の欄で、13 のあとに 20 と打つと「132020」になった。画面だけのテスト（Sonnet）の指摘）
document.addEventListener('focusin', (e) => { if (e.target.matches?.('input[type=number]')) setTimeout(() => e.target.select(), 0); });

app.render = () => {
  const pm = app.state.pick && app.world ? G.getMerchant(app.world, app.state.pick.mid) : null;
  if (app.state.pick && (!pm || pm.travel || (pm.order && !pm.order.paused))) endPick();
  if (!app.state.pick && app.pickToast) { app.pickToast.remove(); app.pickToast = null; }
  // 音楽: 選んだ商人のいる地域。ラッシュの町にいれば変奏
  if (app.world) {
    const m = G.getMerchant(app.world, app.state.selMerchant) || app.world.player.merchants[0];
    const cid = m ? (m.travel ? m.travel.to : m.city) : null;
    setMusicMood(regionFor(app.world, cid), Object.values(app.world.cities).some((c) => c.rush > 0));
  }
  if (app.els.posts && app.world) app.els.posts.textContent = `交易所 ${G.postsFounded(app.world)}/${G.postsAllowed(app.world)}`;
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
      // 町で待っているだけの商人がいたら知らせる（行き先を選び損ねたまま35日が過ぎた。画面だけのテストの指摘）
      for (const m of w.player.merchants) {
        if (m.travel || (m.order && !m.order.paused) || w.player.buildings.some((b) => b.city === m.city)) { m.idleSince = null; continue; } // 工房の町で待つのは、手引きどおりのことがある
        m.idleSince = m.idleSince ?? w.day;
        if ((w.day - m.idleSince) % 10 === 0 && w.day > m.idleSince) fx.toast(`${m.name}は${w.cities[m.city].name}で${w.day - m.idleSince}日待っている。「出発」で行き先を選ぶか、定期便を組む`, { icon: `transport/${m.transport}` });
      }
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
    w.unlockedHeirloom = app.unlockHeirloom(w.scenarioId);
  }
  app.save();
  if (!w.finished.win) sfx.defeat();
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
  if (e.key === 'Escape' && app.state.build) { app.state.build = null; app.render(); }
  if (e.key === 'Escape' && app.state.found && !app.world?.setup) { app.state.found = null; app.render(); }
  if (e.key === 'Escape' && app.state.roadPick) { app.state.roadPick = null; app.state.hoverRoute = null; app.render(); }
});

// 行き先を選んでいる間は、カーソルの町までの経路を光らせる
function hoverRouteTo(id) {
  const st = app.state;
  if (st.roadPick && app.world) {
    const plan = id && id !== st.roadPick.from ? G.planPath(app.world, st.roadPick.from, id, st.roadPick.kind) : null;
    st.hoverRoute = plan ? { tiles: plan.tiles } : null;
    app.map.update(app.world, st);
    return;
  }
  if (!st.pick || !app.world) return;
  const m = G.getMerchant(app.world, st.pick.mid);
  st.hoverRoute = id && m && !m.travel && id !== m.city ? G.findPath(app.world, m.city, id, m.transport) : null;
  app.map.update(app.world, st);
}

window.addEventListener('beforeunload', () => app.save());

// 開発用: #play=s2 で直接シナリオを始める。#load=<セーブのJSONのURL> で途中の状態から（画面の撮影用）
const direct = location.hash.match(/play=(\w+)/);
const loadUrl = location.hash.match(/load=([^&]+)/);
if (loadUrl) {
  fetch(decodeURIComponent(loadUrl[1])).then((r) => r.text()).then((t) => { mount(G.deserialize(t)); devOpens(); });
} else if (direct && (G.SCENARIOS[direct[1]] || direct[1] === 'free')) {
  if (/unlockall/.test(location.hash)) app.campaign.unlocked = Object.keys(G.HEIRLOOMS).slice(0, 4);
  app.startScenario(direct[1], /unlockall/.test(location.hash) ? undefined : null);
  devOpens();
}
else app.showTitle();

function devCity() {
  const w = app.world;
  const pick = location.hash.match(/city=(\w+)/);
  if (pick && w.cities[pick[1]]) return pick[1];
  return w.player.merchants.find((m) => m.city)?.city || Object.values(w.cities).sort((a, b) => b.pop - a.pop)[0]?.id;
}
function devOpens() {
  const cam = location.hash.match(/cam=([\w-]+)(?:@([\d.]+))?/);
  if (cam) app.map.camTo(cam[1], cam[2] ? Number(cam[2]) : undefined);
  const mid = location.hash.match(/merchant=(\d+)/);
  if (mid) app.state.selMerchant = app.world.player.merchants[Number(mid[1]) - 1]?.id;
  if (/open=trade/.test(location.hash)) { app.state.modals++; openTrade(app, 1); }
  if (/open=order/.test(location.hash)) { app.state.modals++; orderDialog(app, 1); }
  if (/open=district/.test(location.hash)) { if (/civics/.test(location.hash)) { app.world.player.silver = 99999; const cid = app.world.player.merchants[0].city; for (const k of Object.keys(G.CIVICS)) G.buildCivic(app.world, cid, k); } app.openDistrict(devCity()); }
  if (/open=city/.test(location.hash)) { app.state.selCity = devCity(); app.render(); }
  if (/open=found/.test(location.hash)) { app.world.player.silver = 99999; app.startFound(); }
  if (/open=built/.test(location.hash)) { const W = app.world; W.player.silver = 99999; const s = G.foundSites(W)[0]; if (!s) return; const r = G.foundPost(W, s.x, s.y); const c0 = W.player.merchants[0].city; G.buildPath(W, c0, r.id, 'road'); app.state.selCity = r.id; app.map.centerOn(W.cities[r.id].x, W.cities[r.id].y); app.render(); }
  if (/selftest/.test(location.hash)) { app.setSetting('sound', false); import('./selftest.js').then((m) => m.selftest(app)); }
  if (/open=result/.test(location.hash)) { app.world.finished = { win: true, rank: 'S', day: 100, score: 3200 }; app.state.modals++; resultDialog(app); }
  if (/open=help/.test(location.hash)) { app.state.modals++; helpDialog(app); }
  if (/open=tech/.test(location.hash)) { app.state.modals++; techDialog(app); }
  if (/open=hire/.test(location.hash)) { app.state.modals++; hireDialog(app, app.world.player.merchants[0].city, G.hireCost(app.world), G.merchantCap(app.world)); }
  if (/open=settings/.test(location.hash)) { app.state.modals++; settingsDialog(app); }
  if (/open=ledger/.test(location.hash)) { app.state.modals++; ledgerDialog(app); }
  if (/open=depart/.test(location.hash)) { app.state.modals++; const m = G.getMerchant(app.world, app.state.selMerchant); const to = Object.keys(app.world.cities).find((k) => k !== m.city && app.world.player.knowledge[k]) || Object.keys(app.world.cities).find((k) => k !== m.city); departDialog(app, m.id, to); }
  if (/run=\d+/.test(location.hash)) setSpeed(Number(location.hash.match(/run=(\d+)/)[1]));
  app.render();
}
// 時間はタイマーで進める（背景タブでも一定に動き、ヘッドレスでも試験できる）
setInterval(loop, 50);
window.__toshoki = app;
