// 画面を人と同じように操作するための常駐サーバー。ヘッドレスの Chrome を開いたままにし、
// DevTools のプロトコルで本物のマウス・タッチ・キーの入力を送る。指示は do.js から1つずつ送る。
//   node tools/drive/server.js [--port 8131] [--game http://localhost:8123]
// 開発用サーバー（npm run serve）を先に起動しておく
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const PORT = Number(opt('--port', 8131));
const GAME = opt('--game', 'http://localhost:8123');
const CDP_PORT = PORT + 1000;
const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((b) => existsSync(b));
const prof = join(tmpdir(), `toshoki-drive-${PORT}`);
rmSync(prof, { recursive: true, force: true });
const chrome = spawn(browser, ['--headless=new', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${prof}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());
process.on('SIGINT', () => process.exit());

// ---------- DevTools のプロトコル ----------
let ws;
let seq = 0;
const waiting = new Map();
const consoleLog = [];
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((ok) => ws.addEventListener('open', ok));
        ws.addEventListener('message', (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.no(new Error(msg.error.message)) : w.ok(msg.result); }
          if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) consoleLog.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 300));
          if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleLog.push(`log: ${msg.params.entry.text} ${msg.params.entry.url || ''}`.slice(0, 300));
          if (msg.method === 'Runtime.exceptionThrown') consoleLog.push(`exception: ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`.slice(0, 300));
        });
        await cdp('Runtime.enable');
        await cdp('Page.enable');
        await cdp('Log.enable');
        await cdp('Page.addScriptToEvaluateOnNewDocument', { source: AUDIO_TAP });
        return;
      }
    } catch { /* まだ起動していない */ }
    await sleep(200);
  }
  throw new Error('Chrome につながらない');
}
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, no) => waiting.set(id, { ok, no }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 音の記録 ----------
// ゲームの音はブラウザの中で合成している。ミュートでも合成は動くので、出口の手前で波形を拾い、
// 音の大きさ（ピーク・RMS）、音割れ、鳴った音の数を記録する。最後の120秒は録音として取り出せる（WAV）
const AUDIO_TAP = `(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || window.__audio) return;
  const A = window.__audio = { ctxs: [], starts: [], blocks: [], sfx: [], pcm: new Int16Array(24000 * 120), stamp: new Float64Array(120).fill(-1) };
  const realDest = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination').get;
  class Tap extends AC {
    constructor(...args) {
      super(...args);
      const id = A.ctxs.length;
      A.ctxs.push({ id, created: performance.now() });
      this.__id = id;
      const tap = super.createGain();
      const proc = super.createScriptProcessor(4096, 2, 1);
      const sink = super.createGain();
      sink.gain.value = 0;
      tap.connect(realDest.call(this));
      tap.connect(proc);
      proc.connect(sink);
      sink.connect(realDest.call(this));
      const step = Math.max(1, Math.round(this.sampleRate / 24000));
      proc.onaudioprocess = (e) => {
        const a = e.inputBuffer.getChannelData(0);
        const b = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : a;
        let peak = 0, sum = 0, clip = 0;
        for (let i = 0; i < a.length; i++) {
          const v = (a[i] + b[i]) / 2;
          const av = Math.max(Math.abs(a[i]), Math.abs(b[i]));
          if (av > peak) peak = av;
          if (av >= 0.99) clip++;
          sum += v * v;
          if (i % step === 0) {
            // 2つの音の出口（効果音と BGM）を同じ録音に足し合わせる。書く位置は時刻から決める
            const at = Math.floor((performance.now() / 1000) * 24000 + i / step);
            const k = at % A.pcm.length;
            // 1秒ごとの区切りに、いつの音かを覚える。120秒前の古い音が残っていたら先に消す
            const sec = Math.floor(at / 24000), slot = sec % 120;
            if (A.stamp[slot] !== sec) { A.pcm.fill(0, slot * 24000, slot * 24000 + 24000); A.stamp[slot] = sec; }
            A.pcm[k] = Math.max(-32767, Math.min(32767, A.pcm[k] + v * 32767));
          }
        }
        A.blocks.push({ t: performance.now(), ctx: id, peak, rms: Math.sqrt(sum / a.length), clip });
        if (A.blocks.length > 4000) A.blocks.splice(0, 1000);
      };
      this.__tap = tap;
    }
    get destination() { return this.__tap || realDest.call(this); }
  }
  window.AudioContext = Tap;
  if (window.webkitAudioContext) window.webkitAudioContext = Tap;
  for (const C of [OscillatorNode, AudioBufferSourceNode]) {
    const start = C.prototype.start;
    C.prototype.start = function (...a) {
      A.starts.push({ t: performance.now(), ctx: this.context.__id, kind: C === OscillatorNode ? this.type : 'buffer' });
      if (A.starts.length > 20000) A.starts.splice(0, 5000);
      return start.apply(this, a);
    };
  }
  // 効果音の名前（ゲームが開発用に出している窓口の sfx を包む）
  setInterval(() => {
    const sfx = window.__toshoki && window.__toshoki.sfx;
    if (!sfx || sfx.__wrapped) return;
    for (const k of Object.keys(sfx)) {
      if (typeof sfx[k] !== 'function') continue;
      const f = sfx[k];
      sfx[k] = (...x) => { A.sfx.push({ t: performance.now(), name: k }); return f(...x); };
    }
    sfx.__wrapped = true;
  }, 300);
})()`;
// t0（ページの時刻）からあとの音のまとめ
const AUDIO_SINCE = (t0) => `(() => {
  const A = window.__audio;
  if (!A) return null;
  const t0 = ${t0};
  const by = {};
  for (const b of A.blocks) {
    if (b.t < t0) continue;
    const x = by[b.ctx] = by[b.ctx] || { blocks: 0, peak: 0, rmsSum: 0, clip: 0, loud: 0 };
    x.blocks++; x.peak = Math.max(x.peak, b.peak); x.rmsSum += b.rms; x.clip += b.clip; if (b.rms > 0.003) x.loud++;
  }
  const starts = {};
  for (const s of A.starts) if (s.t >= t0) starts[s.ctx] = (starts[s.ctx] || 0) + 1;
  const ctxs = Object.entries(by).map(([id, x]) => ({ ctx: +id, peak: +x.peak.toFixed(3), rmsAvg: +(x.rmsSum / x.blocks).toFixed(4), soundingShare: +(x.loud / x.blocks).toFixed(2), clippedSamples: x.clip, voices: starts[id] || 0 }));
  const sfx = A.sfx.filter((s) => s.t >= t0).map((s) => s.name);
  return { contexts: A.ctxs.length, ctxs, sfx };
})()`;

async function evaluate(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

// ---------- 画面の様子 ----------
let view = { w: 1440, h: 900, mobile: false };
async function setView(w, h, mobile) {
  view = { w, h, mobile };
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
}
// 入力のあと、画面が描き変わるまでの時間（2回の描画を待つ）と、その間の長い処理を測る
const PROBE = `(() => new Promise((done) => {
  const t0 = performance.now();
  requestAnimationFrame(() => requestAnimationFrame(() => done(Math.round(performance.now() - t0))));
}))()`;
const INSTALL = `(() => {
  if (window.__drive) return;
  window.__drive = { long: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__drive.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch {}
})()`;
async function settle(ms = 250) {
  const paint = await evaluate(PROBE).catch(() => null);
  await sleep(ms);
  const long = await evaluate('(() => { const l = window.__drive?.long || []; window.__drive && (window.__drive.long = []); return l; })()').catch(() => []);
  return { paintMs: paint, longTasks: long };
}

// 見えているボタンや入力欄の一覧（AI の評価者が、写真と合わせて押せる物を知るため）
const LIST = `(() => {
  const out = [];
  const seen = new Set();
  // ボタンのほか、指のカーソルになる要素（クリックできるカード・地図の上の町の札など）も拾う。親も指なら親だけ
  const els = [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button]')];
  for (const el of document.querySelectorAll('body *')) {
    if (els.includes(el) || getComputedStyle(el).cursor !== 'pointer') continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
    els.push(el);
  }
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue;
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(x, y);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) continue; // 何かに隠れている
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || el.placeholder || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    const key = text + x + ',' + y;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, x, y, w: Math.round(r.width), h: Math.round(r.height), disabled: !!el.disabled, tag: el.tagName.toLowerCase() });
  }
  // 地図（canvas）の上の町。ゲームが開発用に出している窓口から、画面の位置を取る
  const app = window.__toshoki;
  if (app?.map?.screenPos && app.world && !document.querySelector('.modal-back')) {
    for (const c of Object.values(app.world.cities)) {
      const [x, y] = app.map.screenPos(c.x, c.y).map(Math.round);
      const top = document.elementFromPoint(x, y);
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight || top?.tagName !== 'CANVAS' || !top.classList.contains('worldview')) continue;
      out.push({ text: '町:' + c.name, x, y, w: 0, h: 0, disabled: false, tag: 'town' });
    }
  }
  return out;
})()`;
// 文字で探す（一番上に見えていて、文字が一番短く合うもの）
async function findText(text, nth = 0) {
  const items = (await evaluate(LIST)).filter((b) => b.text.includes(text)).sort((a, b) => a.text.length - b.text.length);
  if (!items.length) throw new Error(`「${text}」が画面に見つからない`);
  return items[Math.min(nth, items.length - 1)];
}

// ---------- 入力 ----------
async function mouse(type, x, y, extra = {}) {
  await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
}
async function click(x, y) {
  if (view.mobile) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(60);
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await mouse('mousePressed', x, y);
  await sleep(40);
  await mouse('mouseReleased', x, y);
}
// ドラッグ（地図を動かす）。途中の描画の間隔からコマ落ちを測る
async function drag(x1, y1, x2, y2, ms = 500) {
  await evaluate(`(() => { window.__frames = []; let last = performance.now(); const f = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 400) window.__rafId = requestAnimationFrame(f); }; window.__rafId = requestAnimationFrame(f); })()`);
  const steps = Math.max(6, Math.round(ms / 16));
  if (view.mobile) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
    for (let i = 1; i <= steps; i++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }] }); await sleep(ms / steps); }
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, buttons: 0 });
    await mouse('mousePressed', x1, y1);
    for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await sleep(ms / steps); }
    await mouse('mouseReleased', x2, y2);
  }
  const frames = await evaluate(`(() => { cancelAnimationFrame(window.__rafId); const f = window.__frames.slice(1); return f; })()`);
  return frameStats(frames);
}
function frameStats(f) {
  if (!f.length) return { frames: 0 };
  const s = [...f].sort((a, b) => a - b);
  return { frames: f.length, avgMs: +(f.reduce((a, b) => a + b, 0) / f.length).toFixed(1), p95Ms: Math.round(s[Math.floor(s.length * 0.95)]), maxMs: Math.round(s[s.length - 1]), over50ms: f.filter((x) => x > 50).length };
}
async function wheel(x, y, dy) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
}
const KEYS = { Enter: 13, Escape: 27, Space: 32, ' ': 32, Tab: 9, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
async function key(k) {
  const code = KEYS[k] ?? k.toUpperCase().charCodeAt(0);
  const text = k.length === 1 ? k : k === 'Space' ? ' ' : k === 'Enter' ? '\r' : undefined;
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k === 'Space' ? ' ' : k, windowsVirtualKeyCode: code, text });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k === 'Space' ? ' ' : k, windowsVirtualKeyCode: code });
}

// ---------- 写真 ----------
let shotNo = 0;
let shotDir = resolve('tools/drive/out');
async function shot(name) {
  mkdirSync(shotDir, { recursive: true });
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = join(shotDir, `${String(++shotNo).padStart(3, '0')}${name ? '-' + name.replace(/[^\w\-一-龠ぁ-んァ-ヶ]/g, '_') : ''}.png`);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

// ---------- 指示 ----------
async function handle(c) {
  const out = {};
  const cmdStart = await evaluate('performance.now()').catch(() => 0);
  switch (c.cmd) {
    case 'open': {
      const [w, h] = c.mobile ? [390, 844] : [c.w || 1440, c.h || 900];
      await setView(w, h, !!c.mobile);
      if (c.dir) shotDir = resolve(c.dir);
      if (c.fresh) { // 保存を消して始める（ページを離れるときにも保存するので、離れてから消す）
        await cdp('Page.navigate', { url: 'about:blank' });
        await sleep(300);
        await cdp('Storage.clearDataForOrigin', { origin: new URL(GAME).origin, storageTypes: 'all' });
      }
      const t0 = Date.now();
      await cdp('Page.navigate', { url: `${GAME}/index.html${c.query || ''}#${c.hash || ''}` });
      await sleep(c.wait ?? 2500);
      await evaluate(INSTALL);
      out.loadMs = Date.now() - t0;
      // 画面が始まったか（スクリプトの読み込みに失敗すると、真っ黒のままでエラーも出ないことがある）
      out.started = await evaluate(`!!document.querySelector('#app')?.children.length || !!document.querySelector('.title-screen')`);
      if (!out.started) out.warning = '画面が始まっていない（スクリプトの読み込みの失敗かもしれない）';
      break;
    }
    case 'click': {
      let x = c.x, y = c.y;
      if (c.text) { const b = await findText(c.text, c.nth || 0); x = b.x; y = b.y; out.target = b; }
      await click(x, y);
      Object.assign(out, await settle(c.wait ?? 300));
      break;
    }
    case 'drag': out.drag = await drag(c.x1, c.y1, c.x2, c.y2, c.ms || 500); Object.assign(out, await settle()); break;
    case 'wheel': await wheel(c.x, c.y, c.dy); Object.assign(out, await settle()); break;
    case 'key': await key(c.key); Object.assign(out, await settle(c.wait ?? 300)); break;
    case 'type': await cdp('Input.insertText', { text: c.text }); Object.assign(out, await settle()); break;
    case 'wait': await sleep(c.ms || 1000); break;
    case 'list': out.items = await evaluate(LIST); break;
    case 'eval': out.value = await evaluate(c.js); break;
    case 'fps': { // 何もしないでいるときの描画の間隔（ゲームの時間が進んでいるとき）
      await evaluate(`(() => { window.__frames = []; let last = performance.now(); const f = (t) => { window.__frames.push(t - last); last = t; window.__rafId = requestAnimationFrame(f); }; window.__rafId = requestAnimationFrame(f); })()`);
      await sleep(c.ms || 3000);
      out.fps = frameStats(await evaluate(`(() => { cancelAnimationFrame(window.__rafId); return window.__frames.slice(1); })()`));
      break;
    }
    case 'console': out.console = consoleLog.splice(0); break;
    case 'audio': { // ここ ms ミリ秒の音のまとめ（既定は全部）
      const now = await evaluate('performance.now()');
      out.audio = await evaluate(AUDIO_SINCE(c.ms ? now - c.ms : 0));
      break;
    }
    case 'wav': { // 最後の secs 秒（最大120）を WAV に書き出す（24kHz・モノラル）
      const secs = Math.min(120, c.secs || 60);
      const b64 = await evaluate(`(() => {
        const A = window.__audio;
        if (!A) return null;
        const n = 24000 * ${secs};
        const end = Math.floor((performance.now() / 1000) * 24000) - 24000 * 0.3;
        const out = new Int16Array(n);
        for (let i = 0; i < n; i++) out[i] = A.pcm[((end - n + i) % A.pcm.length + A.pcm.length) % A.pcm.length];
        let s = '';
        const u = new Uint8Array(out.buffer);
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        return btoa(s);
      })()`);
      if (!b64) throw new Error('音の記録がない');
      const pcm = Buffer.from(b64, 'base64');
      const hdr = Buffer.alloc(44);
      hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8);
      hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
      hdr.writeUInt32LE(24000, 24); hdr.writeUInt32LE(48000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
      hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
      mkdirSync(shotDir, { recursive: true });
      out.wav = join(shotDir, c.file || `audio-${Date.now()}.wav`);
      writeFileSync(out.wav, Buffer.concat([hdr, pcm]));
      out.seconds = +(pcm.length / 48000).toFixed(1);
      break;
    }
    case 'quit': setTimeout(() => process.exit(0), 100); break;
    default: throw new Error(`不明な指示: ${c.cmd}`);
  }
  if (c.shot !== false && !['list', 'eval', 'console', 'quit', 'fps', 'audio', 'wav'].includes(c.cmd)) out.shot = await shot(c.name || c.cmd);
  // 操作のあいだに鳴った効果音と、音割れがあれば添える
  if (!['audio', 'wav', 'list', 'eval', 'console', 'quit'].includes(c.cmd)) {
    const a = await evaluate(AUDIO_SINCE(cmdStart)).catch(() => null);
    if (a && (a.sfx.length || a.ctxs.some((x) => x.clippedSamples))) out.audio = a;
  }
  if (consoleLog.length) out.newConsole = consoleLog.splice(0);
  return out;
}

await connect();
createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    try {
      const r = await handle(JSON.parse(body || '{}'));
      res.end(JSON.stringify({ ok: true, ...r }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
  });
}).listen(PORT, () => console.log(`drive ready on ${PORT}`));
