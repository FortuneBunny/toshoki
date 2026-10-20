import * as G from '../core/index.js';
// 開発用の自己テスト: #play=s2&selftest で、実際にボタンを押して一通り遊び、結果を画面に出す。
export async function selftest(app) {
  const log = [];
  const errors = [];
  window.addEventListener('error', (e) => errors.push(`${e.message} @${e.filename?.split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (sel, text) => {
    const els = [...document.querySelectorAll(sel)].filter((el) => !text || el.textContent.includes(text));
    if (!els.length) throw new Error(`見つからない: ${sel} ${text || ''}`);
    els[0].click();
  };
  const step = async (name, fn) => {
    try { await fn(); log.push(`✔ ${name}`); } catch (e) { log.push(`✖ ${name}: ${e.message}`); }
    await wait(120);
  };
  const w = () => app.world;
  await wait(300);
  if (app.world.scenarioId === 's3') return selftestWorkshop(app, { step, click, wait, log, errors });
  await step('交易画面を開く', () => click('.mcard .btn', '交易'));
  await step('麦を買えるだけ（«）', () => click('.trow .btn', '«'));
  await step('取引を確定', () => click('footer .btn', '取引を確定'));
  await step('積荷に麦がある', () => { if (!(w().player.merchants[0].cargo.wheat > 0)) throw new Error('麦がない'); });
  await step('出発 → 行き先を選ぶ', () => click('.mcard .btn', '出発'));
  await step('ナツメ泉をクリック', () => { app.clickCity('natsume'); });
  await step('出発ダイアログで出発', () => click('footer .btn', '出発'));
  await step('移動中になる', () => { if (!w().player.merchants[0].travel) throw new Error('移動していない'); });
  log.push(`  state: modals=${app.state.modals} speed=${app.state.speed} day=${w().day}`);
  await step('時間を進める（到着まで）', async () => {
    for (let i = 0; i < 60 && w().player.merchants[0].travel; i++) await wait(100);
    if (w().player.merchants[0].travel) throw new Error(`到着しない modals=${app.state.modals} speed=${app.state.speed} day=${w().day}`);
  });
  await step('到着で自動一時停止', () => { if (app.state.speed !== 0) throw new Error(`速度 ${app.state.speed}`); });
  await step('交易で全部売る（»）', () => { click('.mcard .btn', '交易'); click('.trow .btn', '»'); click('footer .btn', '取引を確定'); });
  await step('利益が出た', () => { if (!(w().stats.profit > 0)) throw new Error(`利益 ${w().stats.profit}`); });
  await step('定期便ダイアログ', () => { click('.mcard .btn', '定期便'); click('footer .btn', '定期便を開始'); });
  await step('定期便が設定された', () => { if (!w().player.merchants[0].order) throw new Error('なし'); });
  await step('帳簿', () => { click('.topbar .btn', '帳簿'); click('.modal header .btn'); });
  await step('町パネル', () => { app.clickCity('mugi'); if (!document.body.textContent.includes('糖度')) throw new Error('町パネルが出ない'); });
  await step('地図の canvas がある', () => { if (!document.querySelector('canvas.worldview')) throw new Error('canvas なし'); });
  await step('音楽: 地域の曲とラッシュの変奏が鳴らせる', async () => {
    const mu = await import('./music.js');
    for (const r of ['desert', 'east', 'sea', 'plain']) { mu.setMusic(true, 0.01); mu.setMusicMood(r, r === 'sea'); await wait(250); }
    mu.setMusic(false);
    click('.btn', '設定');
    if (!document.body.textContent.includes('音楽')) throw new Error('設定に音楽がない');
    click('.modal .btn, .btn', '✕');
  });
  await step('タイトル: 全シナリオを解放すると s7 が選べる', async () => {
    const { titleScreen } = await import('./panels.js');
    const keep = app.settings.allScenarios;
    const el = titleScreen(app);
    const box = el.querySelector('input[type=checkbox]');
    if (!box) throw new Error('解放のチェックがない');
    box.click();
    const t2 = document.querySelectorAll('.title-screen');
    const last = t2[t2.length - 1];
    const locked = last.querySelectorAll('.scen.locked').length;
    t2.forEach((x) => x.remove());
    app.setSetting('allScenarios', keep);
    if (locked) throw new Error(`まだ ${locked} 本が閉じている`);
  });
  await step('地図の上で麦畑を建てる', () => {
    w().player.silver = Math.max(w().player.silver, 1000);
    const before = w().stats.placed || 0;
    app.startBuild('mugi', 'producer', 'wheat_farm');
    const [dx, dy] = app.state.build.tiles[0];
    const [wx, wy] = G.districtToWorld(w().cities.mugi, dx, dy);
    app.buildAt(wx, wy);
    if (!((w().stats.placed || 0) > before)) throw new Error('建たなかった');
  });
  await step('区画を開く', () => { app.openDistrict('mugi'); if (!document.querySelector('.district-map')) throw new Error('区画の画面がない'); });
  await step('麦畑を選んで置く', () => {
    w().player.silver = Math.max(w().player.silver, 1000);
    click('.district-item', '麦畑');
    const ok = [...document.querySelectorAll('.district-map polygon.tile')].find((p) => p.getAttribute('stroke') === '#7dff6a');
    if (!ok) throw new Error('置けるマスが光っていない');
    ok.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    if (!(w().stats.placed > 0)) throw new Error('置けていない');
    click('.modal header .btn');
  });
  await step('セーブとロード', () => { app.save(); app.loadSave(); if (!w()) throw new Error('ロード失敗'); });
  await wait(400);
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:10px;top:60px;z-index:999;background:#000d;color:#fff;padding:10px;font:12px monospace;max-width:600px;white-space:pre-wrap';
  box.textContent = [...log, '', `errors: ${errors.length}`, ...errors].join('\n');
  document.body.append(box);
  document.title = errors.length || log.some((l) => l.startsWith('✖')) ? 'SELFTEST FAIL' : 'SELFTEST OK';
}

async function selftestWorkshop(app, { step, click, wait, log, errors }) {
  const w = () => app.world;
  w().player.silver = 3000;
  await step('町パネルを開く', () => { app.state.selCity = 'toumitsu'; app.render(); });
  await step('製糖所を建てるボタン', () => click('.side .btn', '製糖所'));
  await step('確認して建てる', () => click('footer .btn', '決定'));
  await step('製糖所ができた', () => { if (!w().player.buildings.length) throw new Error('なし'); });
  await step('粗糖を倉庫に入れる', () => { w().player.warehouses.toumitsu.stock.rawsugar = 10; });
  await step('数日進める', async () => { app.state.speed = 3; await wait(2500); app.state.speed = 0; });
  await step('道を敷く: ボタンから相手の町を選んで確定', () => {
    app.state.selCity = 'toumitsu'; app.render();
    click('.side .btn', '街道を敷く');
    if (!app.state.roadPick) throw new Error('道の選択に入らない');
    app.clickCity('natsu');
    const before = w().edges.length;
    click('footer .btn', '決定');
    if (w().edges.length !== before + 1) throw new Error('道が増えない');
  });
  await step('商人を雇う: 候補3人から才能で選ぶ', () => {
    w().player.silver += 2000;
    app.state.selCity = 'toumitsu'; app.render();
    click('.side .btn', '商人を雇う');
    const cards = document.querySelectorAll('.hire-card');
    if (cards.length < 2) throw new Error(`候補 ${cards.length}`);
    cards[1].querySelector('.btn').click();
    const m = w().player.merchants[w().player.merchants.length - 1];
    if (!m.talent || w().player.merchants.length < 2) throw new Error('才能つきの商人が増えない');
  });
  await step('技術: ダイアログから買う', () => {
    w().player.silver += 3000;
    click('.top .btn, header .btn, .btn', '技術');
    const b = [...document.querySelectorAll('.tech-row .btn')].find((x) => x.textContent === '買う');
    if (!b) throw new Error('買うボタンがない');
    b.click();
    if (!Object.values(w().techs || {}).includes('player')) throw new Error('技術が増えない');
    click('footer .btn', '閉じる');
  });
  await step('交易所を開く: 候補地を選んで確定', () => {
    w().player.silver += 3000;
    app.startFound();
    const s = app.state.found.sites[0];
    if (!s) throw new Error('候補地がない');
    app.foundAt(s.x, s.y);
    click('footer .btn', '決定');
    if (!w().cities.post1) throw new Error('交易所ができない');
  });
  await step('白糖ができた', () => { if (!(w().stats.produced.whitesugar > 0)) throw new Error(`produced ${JSON.stringify(w().stats.produced)}`); });
  await step('交易画面に倉庫が出る', () => { click('.mcard .btn', '交易'); if (!document.body.textContent.includes('自分の倉庫')) throw new Error('倉庫なし'); });
  await step('倉庫から積む', () => click('.btn', '« 積む'));
  await step('白糖を積んだ', () => { if (!(w().player.merchants[0].cargo.whitesugar > 0)) throw new Error(JSON.stringify(w().player.merchants[0].cargo)); });
  await wait(300);
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:10px;top:60px;z-index:999;background:#000d;color:#fff;padding:10px;font:12px monospace;max-width:600px;white-space:pre-wrap';
  box.textContent = [...log, '', `errors: ${errors.length}`, ...errors].join('\n');
  document.body.append(box);
}
