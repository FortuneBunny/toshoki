// 世界のマス目の描画（G1）: canvas の斜め見下ろし。ドラッグで移動、ホイールで拡大縮小、ミニマップ。
// 今までの地図（map.js）と同じ形のやりとり（update / screenPos / unitPos）を持つ。
import { h, add } from './dom.js';
import * as G from '../core/index.js';

const TW = 32; // 拡大率1のときのマスの幅
const TH = 16;
const TERRAIN_COLOR = ['#d3cf94', '#a9c46e', '#f1dba6', '#c3a067', '#9a7b52', '#5bb4d6'];
const IMG = new Map();
function img(path) {
  if (!IMG.has(path)) {
    const im = new Image();
    im.onerror = () => console.error(`画像を読めない: assets/svg/${path}.svg`);
    im.src = `assets/svg/${path}.svg`;
    IMG.set(path, im);
  }
  return IMG.get(path);
}
const ready = (im) => im.complete && im.naturalWidth > 0;

function hash(x, y) {
  let t = (x * 374761393 + y * 668265263) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// 家の絵: 町並みの様式ごとに3種類（3は大きな町だけに混ざる立派な家）
// 様式は町そのものから決める（砂漠・港・茶か絹を作る町は東方・それ以外は平原）
export function houseSprite(world, city, v) {
  const n = G.cityTier(city) >= 3 && v > 0.75 ? 3 : v < 0.45 ? 1 : 2;
  const own = Object.keys(city.produces || {});
  const style = city.tags.includes('desert') ? 'desert' : city.tags.includes('port') ? 'port' : own.includes('tea') || own.includes('silk') ? 'east' : 'plain';
  return `${style}-${n}`;
}
function cityImage(c) {
  const t = G.cityTier(c);
  if (c.tags.includes('port') && t >= 1 && t <= 2) return 'cities/port-town';
  if (c.tags.includes('desert') && t >= 1 && t <= 2) return 'cities/oasis-town';
  return `cities/tier${t}`;
}
function gaugeColor(g) {
  if (g < 40) return '#e2553f';
  if (g < 110) return '#f2a93b';
  if (g < 140) return '#8fd16a';
  return '#c8f4ff';
}

export function createWorldView(container, world, handlers) {
  const canvas = h('canvas', { class: 'worldview' });
  const mini = h('canvas', { class: 'minimap', width: 200, height: 120 });
  const ctl = h('div', { class: 'mapctl' },
    // 押したらすぐ描き直す（止めているときは描き直しの合図だけでは画面が変わらなかった）
    h('button', { class: 'btn small', title: '拡大', onclick: () => { zoomAt(1.25); draw(); } }, '＋'),
    h('button', { class: 'btn small', title: '縮小', onclick: () => { zoomAt(0.8); draw(); } }, '－'),
    h('button', { class: 'btn small', title: '全体を見る', onclick: () => { fitAll(); draw(); } }, '全体'));
  add(container, canvas, mini, ctl);
  const ctx = canvas.getContext('2d');
  const W = G.GRID_W;
  const Hh = G.GRID_H;
  const cam = { x: 0, y: 0, zoom: 0.5 }; // x, y は斜め見下ろしの世界座標（拡大率1）での画面中心
  let state = {};
  let terrainCache = null;
  let cacheKey = '';
  let hoverCity = null;

  const iso = (tx, ty) => [(tx - ty) * (TW / 2), (tx + ty) * (TH / 2)];
  const toScreen = (wx, wy) => [(wx - cam.x) * cam.zoom + canvas.clientWidth / 2, (wy - cam.y) * cam.zoom + canvas.clientHeight / 2];
  const fromScreen = (sx, sy) => [(sx - canvas.clientWidth / 2) / cam.zoom + cam.x, (sy - canvas.clientHeight / 2) / cam.zoom + cam.y];
  const tileFromWorld = (wx, wy) => [Math.round((wy / (TH / 2) + wx / (TW / 2)) / 2), Math.round((wy / (TH / 2) - wx / (TW / 2)) / 2)];
  // 地図座標（1000×600）→ 斜め見下ろしの世界座標
  const pxToWorld = (px, py) => iso(px / G.TILE_PX, py / G.TILE_PX);

  function fitAll() {
    const [x0] = iso(0, Hh);
    const [x1] = iso(W, 0);
    const [, y1] = iso(W, Hh);
    cam.x = (x0 + x1) / 2;
    cam.y = y1 / 2;
    cam.zoom = Math.min(canvas.clientWidth / (x1 - x0), canvas.clientHeight / y1) * 0.98;
    invalidate();
  }
  function zoomAt(f, sx = canvas.clientWidth / 2, sy = canvas.clientHeight / 2) {
    const [wx, wy] = fromScreen(sx, sy);
    cam.zoom = Math.max(0.18, Math.min(3, cam.zoom * f));
    const [nx, ny] = fromScreen(sx, sy);
    cam.x += wx - nx;
    cam.y += wy - ny;
    invalidate();
  }
  function invalidate() { cacheKey = ''; }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, canvas.clientWidth * dpr);
    canvas.height = Math.max(1, canvas.clientHeight * dpr);
    invalidate();
  }

  // 地形と道を、今のカメラ用に下絵として描いておく（カメラが動いたときだけ描き直す）
  function drawTerrain() {
    const grid = world.grid;
    const dpr = window.devicePixelRatio || 1;
    const key = `${cam.x.toFixed(1)},${cam.y.toFixed(1)},${cam.zoom.toFixed(3)},${canvas.width},${grid.version}`;
    if (key === cacheKey && terrainCache) return;
    cacheKey = key;
    if (!terrainCache) terrainCache = document.createElement('canvas');
    terrainCache.width = canvas.width;
    terrainCache.height = canvas.height;
    const c = terrainCache.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#1c1712'; // 世界の外（海と見分けがつくよう暗く）
    c.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const hw = (TW / 2) * cam.zoom;
    const hh = (TH / 2) * cam.zoom;
    // 画面に見えるマスだけ
    const corners = [[0, 0], [canvas.clientWidth, 0], [0, canvas.clientHeight], [canvas.clientWidth, canvas.clientHeight]].map(([sx, sy]) => tileFromWorld(...fromScreen(sx, sy)));
    const minX = Math.max(0, Math.min(...corners.map((t) => t[0])) - 2);
    const maxX = Math.min(W - 1, Math.max(...corners.map((t) => t[0])) + 2);
    const minY = Math.max(0, Math.min(...corners.map((t) => t[1])) - 2);
    const maxY = Math.min(Hh - 1, Math.max(...corners.map((t) => t[1])) + 2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const k = G.gridKey(x, y);
        const t = grid.terrain[k];
        const [wx, wy] = iso(x, y);
        const [sx, sy] = toScreen(wx, wy);
        const v = 0.93 + hash(x, y) * 0.12;
        c.fillStyle = shade(TERRAIN_COLOR[t], t === 5 ? 0.95 + hash(x, y) * 0.08 : v);
        c.beginPath();
        c.moveTo(sx, sy - hh);
        c.lineTo(sx + hw, sy);
        c.lineTo(sx, sy + hh);
        c.lineTo(sx - hw, sy);
        c.closePath();
        c.fill();
        if (grid.danger[k] && cam.zoom > 0.4) {
          c.fillStyle = 'rgba(200,85,61,0.12)';
          c.fill();
        }
      }
    }
    // 飾り（山、ヤシ、木）: 拡大しているときだけ
    if (cam.zoom >= 0.45) {
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const k = G.gridKey(x, y);
        const t = grid.terrain[k];
        const r = hash(x + 7, y + 3);
        let deco = null;
        if (t === 4) deco = 'terrain/mountain';
        else if (t === 2 && r < 0.04) deco = 'terrain/dunes';
        else if (t === 1 && r < 0.05) deco = 'terrain/forest';
        else if (t === 3 && r < 0.06) deco = 'terrain/mountain';
        else if (t === 2 && r > 0.985 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid.terrain[G.gridKey(x + dx, y + dy)] === 1)) deco = 'terrain/palm';
        else if (t === 5 && r < 0.012) deco = 'terrain/waves';
        if (!deco || grid.path[k] || grid.cityAt.has(k)) continue;
        const im = img(deco);
        if (!ready(im)) continue;
        const [sx, sy] = toScreen(...iso(x, y));
        const s = (t === 4 ? 30 : 22) * cam.zoom;
        c.globalAlpha = t === 4 ? 1 : 0.8;
        c.drawImage(im, sx - s / 2, sy - s * 0.8, s, s);
        c.globalAlpha = 1;
      }
    }
    // 道: となりの道のマスどうしを線で結ぶ
    c.lineCap = 'round';
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const k = G.gridKey(x, y);
      const p = grid.path[k];
      if (!p && !grid.cityAt.has(k)) continue;
      const [ax, ay] = toScreen(...iso(x, y));
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= Hh) continue;
        const nk = G.gridKey(nx, ny);
        const q = grid.path[nk];
        if (!q && !grid.cityAt.has(nk)) continue;
        if (!p && !q) continue;
        // 斜めのつながりは、まっすぐのつながりが無いときだけ
        if (dx && dy && (grid.path[G.gridKey(x + dx, y)] || grid.path[G.gridKey(x, y + dy)])) continue;
        const [bx, by] = toScreen(...iso(nx, ny));
        const road = Math.min(p || 2, q || 2) >= 2;
        c.strokeStyle = road ? '#6b4a22' : '#8a6a3e';
        c.lineWidth = Math.max(1, (road ? 4 : 2.5) * cam.zoom);
        c.setLineDash(road ? [] : [4 * cam.zoom, 3 * cam.zoom]);
        c.beginPath();
        c.moveTo(ax, ay);
        c.lineTo(bx, by);
        c.stroke();
      }
    }
    c.setLineDash([]);
  }

  // 区画の建物を世界のマスに描く（家・生産施設・需要施設・工房）。市場は町の絵で描く
  function drawDistrict(c, city) {
    const d = city.district;
    if (!d?.origin || cam.zoom < 0.45) return false;
    const list = d.buildings.filter((b) => !b.virtual && b.type !== 'market').map((b) => ({ b, w: G.districtToWorld(city, b.x, b.y) }));
    list.sort((p, q) => (p.w[0] + p.w[1]) - (q.w[0] + q.w[1]));
    const hw = (TW / 2) * cam.zoom;
    const hh = (TH / 2) * cam.zoom;
    for (const { b, w } of list) {
      const [sx, sy] = toScreen(...iso(w[0], w[1]));
      if (sx < -60 || sy < -60 || sx > canvas.clientWidth + 60 || sy > canvas.clientHeight + 60) continue;
      // 斜め見下ろしの素材（地面のひし形がマスに重なるように描く）。読み込み前は図形で代用
      const S = TW * cam.zoom * (128 / 120);
      if (b.type === 'house') {
        const v = ((b.x * 7 + b.y * 11) % 10) / 10;
        const hi = img(`houses/${houseSprite(world, city, v)}`);
        if (ready(hi)) { c.drawImage(hi, sx - S / 2, sy - S * 0.75, S, S); continue; }
        const ww = (12 + v * 5) * cam.zoom;
        const h2 = (8 + v * 3) * cam.zoom;
        c.fillStyle = ['#f3dfb3', '#e2c08a', '#f0d6a0'][Math.floor(v * 3)];
        c.strokeStyle = '#3b2618';
        c.lineWidth = Math.max(0.6, cam.zoom);
        c.fillRect(sx - ww / 2, sy - h2 + 2 * cam.zoom, ww, h2);
        c.strokeRect(sx - ww / 2, sy - h2 + 2 * cam.zoom, ww, h2);
        c.fillStyle = G.cityTier(city) >= 3 && v > 0.75 ? (v > 0.9 ? '#ffd166' : '#5bb4d6') : ['#c8553d', '#d9822b', '#8e3b2e', '#a65a1b'][Math.floor(v * 4)];
        c.beginPath();
        c.moveTo(sx - ww / 2 - 1.5 * cam.zoom, sy - h2 + 2 * cam.zoom);
        c.lineTo(sx, sy - h2 - 5 * cam.zoom);
        c.lineTo(sx + ww / 2 + 1.5 * cam.zoom, sy - h2 + 2 * cam.zoom);
        c.closePath();
        c.fill();
        c.stroke();
        continue;
      }
      if (G.PRODUCERS[b.type]) {
        const building = b.readyDay !== undefined && world.day < b.readyDay;
        const bi = img(`buildings/${b.type}`);
        if (ready(bi)) { c.globalAlpha = building ? 0.5 : 1; c.drawImage(bi, sx - S / 2, sy - S * 0.75, S, S); c.globalAlpha = 1; continue; }
        c.fillStyle = b.placed ? 'rgba(242,169,59,0.55)' : 'rgba(160,122,72,0.5)';
        c.beginPath();
        c.moveTo(sx, sy - hh);
        c.lineTo(sx + hw, sy);
        c.lineTo(sx, sy + hh);
        c.lineTo(sx - hw, sy);
        c.closePath();
        c.fill();
        const im = img(`goods/${G.PRODUCERS[b.type].good}`);
        const s = 22 * cam.zoom;
        if (ready(im)) { c.globalAlpha = building ? 0.45 : 1; c.drawImage(im, sx - s / 2, sy - s * 0.85, s, s); c.globalAlpha = 1; }
        continue;
      }
      const path = G.CIVICS[b.type] ? `cities/${b.type}` : `cities/${b.type}`;
      const im = img(path);
      const s = 40 * cam.zoom;
      if (ready(im)) c.drawImage(im, sx - s / 2, sy - s * 0.8, s, s);
    }
    return true;
  }

  function drawHouses(c, city, sx, sy) {
    // 区画のない町（古いセーブなど）だけ、人口に応じた飾りの家
    const k = world.player.knowledge[city.id];
    const here = world.player.merchants.some((m) => m.city === city.id);
    const pop = here ? city.pop : k?.pop;
    if (!pop || cam.zoom < 0.35) return;
    const n = Math.min(60, Math.floor(Math.sqrt(pop) / 2.6));
    const tier = G.cityTier(city);
    for (let i = 0; i < n; i++) {
      const a = hash(i, city.x) * Math.PI * 2;
      const d = (14 + (i / n) * 40 + hash(city.y, i) * 10) * cam.zoom;
      const x = sx + Math.cos(a) * d * 1.3;
      const y = sy + Math.sin(a) * d * 0.65;
      const v = hash(i, i + city.y);
      const w = (7 + v * 4) * cam.zoom;
      const hh = (5 + v * 2) * cam.zoom;
      c.fillStyle = ['#f3dfb3', '#e2c08a', '#f0d6a0'][Math.floor(v * 3)];
      c.strokeStyle = '#3b2618';
      c.lineWidth = Math.max(0.5, cam.zoom);
      c.fillRect(x - w / 2, y - hh, w, hh);
      c.strokeRect(x - w / 2, y - hh, w, hh);
      c.fillStyle = tier >= 3 && v > 0.8 ? '#5bb4d6' : ['#c8553d', '#d9822b', '#8e3b2e'][Math.floor(v * 3)];
      c.beginPath();
      c.moveTo(x - w / 2 - 1, y - hh);
      c.lineTo(x, y - hh - w * 0.45);
      c.lineTo(x + w / 2 + 1, y - hh);
      c.closePath();
      c.fill();
      c.stroke();
    }
  }

  function unitScreen(px, py) {
    return toScreen(...pxToWorld(px, py));
  }

  function draw() {
    if (!canvas.clientWidth) return;
    drawTerrain();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(terrainCache, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 行き先を選んでいる間: 経路を光らせる
    if (state.hoverRoute?.tiles) {
      ctx.strokeStyle = 'rgba(255,246,200,0.9)';
      ctx.lineWidth = Math.max(2, 5 * cam.zoom);
      ctx.setLineDash([2 * cam.zoom, 8 * cam.zoom]);
      ctx.beginPath();
      state.hoverRoute.tiles.forEach(([x, y], i) => { const [sx, sy] = toScreen(...iso(x, y)); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 交易所の候補地
    if (state.found?.sites) {
      for (const s of state.found.sites) {
        const [sx, sy] = toScreen(...iso(s.x, s.y));
        ctx.fillStyle = 'rgba(125,255,106,0.35)';
        ctx.strokeStyle = '#7dff6a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(sx, sy, 22 * Math.max(0.6, cam.zoom), 12 * Math.max(0.6, cam.zoom), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        s.goods.forEach((g, i) => { const gi = img(`goods/${g}`); if (ready(gi)) ctx.drawImage(gi, sx - 22 + i * 22, sy - 34, 20, 20); });
      }
    }
    // 町
    const labels = [];
    const cities = Object.values(world.cities).sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const c of cities) {
      const [tx, ty] = world.grid.cityTiles[c.id];
      const [sx, sy] = toScreen(...iso(tx, ty));
      if (sx < -300 || sy < -300 || sx > canvas.clientWidth + 300 || sy > canvas.clientHeight + 300) continue;
      // 選んだ町の市場の圏
      if ((state.selCity === c.id || state.build?.city === c.id) && c.district?.origin && cam.zoom >= 0.45) {
        const rr = G.cityRadius(c, G.cityTier(c));
        const pts = [[-rr - 0.5, -rr - 0.5], [rr + 0.5, -rr - 0.5], [rr + 0.5, rr + 0.5], [-rr - 0.5, rr + 0.5]].map(([dx, dy]) => toScreen(...iso(tx + dx, ty + dy)));
        ctx.strokeStyle = 'rgba(255,209,102,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 建設モード: 置けるマスを光らせる
      if (state.build?.city === c.id && state.build.tiles) {
        ctx.strokeStyle = '#7dff6a';
        ctx.lineWidth = 2;
        const hw = (TW / 2) * cam.zoom;
        const hh2 = (TH / 2) * cam.zoom;
        for (const [dx, dy] of state.build.tiles) {
          const [wx, wy] = G.districtToWorld(c, dx, dy);
          const [px, py] = toScreen(...iso(wx, wy));
          ctx.beginPath();
          ctx.moveTo(px, py - hh2);
          ctx.lineTo(px + hw, py);
          ctx.lineTo(px, py + hh2);
          ctx.lineTo(px - hw, py);
          ctx.closePath();
          ctx.stroke();
        }
      }
      if (!drawDistrict(ctx, c)) drawHouses(ctx, c, sx, sy);
      const k = world.player.knowledge[c.id];
      const here = world.player.merchants.some((m) => m.city === c.id);
      const gl = here ? c.glucose : k?.glucose;
      const R = 30 * Math.max(0.6, cam.zoom);
      ctx.lineWidth = 5 * Math.max(0.6, cam.zoom);
      ctx.strokeStyle = 'rgba(59,38,24,0.3)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, R, R * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (gl !== undefined) {
        ctx.strokeStyle = gaugeColor(gl);
        ctx.globalAlpha = here ? 1 : 0.5;
        ctx.beginPath();
        ctx.ellipse(sx, sy, R, R * 0.55, 0, -Math.PI / 2, -Math.PI / 2 + Math.min(1, gl / 200) * Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (c.rush > 0) {
        // ラッシュ: 脈打つ光の輪と、町のまわりを回るきらめき
        const t = Date.now() / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(t * 4);
        const glow = ctx.createRadialGradient(sx, sy, R * 0.3, sx, sy, R * 1.9);
        glow.addColorStop(0, `rgba(255,230,150,${0.35 + pulse * 0.2})`);
        glow.addColorStop(0.6, `rgba(255,120,200,${0.18 + pulse * 0.12})`);
        glow.addColorStop(1, 'rgba(255,120,200,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.ellipse(sx, sy, R * 1.9, R * 1.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255,150,220,${0.6 + pulse * 0.4})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(sx, sy, R * (1.25 + pulse * 0.1), R * (0.7 + pulse * 0.06), 0, 0, Math.PI * 2); ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const a = t * 1.5 + (i * Math.PI) / 3;
          const px = sx + Math.cos(a) * R * 1.4;
          const py = sy - R * 0.4 + Math.sin(a) * R * 0.8;
          ctx.fillStyle = i % 2 ? '#c8f4ff' : '#fff7d6';
          ctx.beginPath(); ctx.moveTo(px, py - 5); ctx.lineTo(px + 2, py); ctx.lineTo(px, py + 5); ctx.lineTo(px - 2, py); ctx.closePath(); ctx.fill();
        }
      }
      if (c.crash > 0) {
        // クラッシュ: 町をくすませる
        ctx.fillStyle = 'rgba(70,80,110,0.28)';
        ctx.beginPath(); ctx.ellipse(sx, sy, R * 1.5, R * 0.85, 0, 0, Math.PI * 2); ctx.fill();
      }
      const im = img(cityImage(c));
      const s = 64 * Math.max(0.55, cam.zoom);
      if (ready(im)) {
        if (c.crash > 0) ctx.filter = 'saturate(0.35) brightness(0.85)';
        ctx.drawImage(im, sx - s / 2, sy - s * 0.8, s, s);
        ctx.filter = 'none';
      }
      // 名前・人口・バッジは、家や隊商に隠れないよう最後にまとめて描く
      labels.push(() => {
      const fs = Math.max(11, 14 * Math.min(1.2, cam.zoom + 0.3));
      ctx.font = `900 ${fs}px "Zen Maru Gothic", sans-serif`;
      ctx.textAlign = 'center';
      // 名前の下地（家が密集しても読めるように）
      ctx.font = `700 ${fs * 0.75}px "Zen Maru Gothic", sans-serif`;
      const plateW = Math.max(ctx.measureText(`${G.tierName(G.cityTier(c))} ${Math.round(c.pop).toLocaleString('ja-JP')}人・未訪問`).width, c.name.length * fs) + 14;
      ctx.fillStyle = 'rgba(246,231,196,0.82)';
      ctx.beginPath(); ctx.roundRect(sx - plateW / 2, sy + s * 0.32 + 2, plateW, fs * 2.15, 7); ctx.fill();
      ctx.font = `900 ${fs}px "Zen Maru Gothic", sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#f6e7c4';
      ctx.fillStyle = '#3b2618';
      ctx.strokeText(c.name, sx, sy + s * 0.32 + fs);
      ctx.fillText(c.name, sx, sy + s * 0.32 + fs);
      const age = G.knowledgeAge(world, c.id);
      const sub = `${G.tierName(G.cityTier(c))} ${Math.round(c.pop).toLocaleString('ja-JP')}人${world.player.branches?.includes(c.id) ? '・商館' : ''}${age === null ? '・未訪問' : age > 0 && !here ? `・${age}日前` : ''}`;
      ctx.font = `700 ${fs * 0.75}px "Zen Maru Gothic", sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeText(sub, sx, sy + s * 0.32 + fs * 1.9);
      ctx.fillStyle = '#5b4026';
      ctx.fillText(sub, sx, sy + s * 0.32 + fs * 1.9);
      // 商館のある町には、一族の旗
      if (world.player.branches?.includes(c.id)) {
        const fx0 = sx + s * 0.4, fy0 = sy - s * 0.75, fh = s * 0.55;
        ctx.strokeStyle = '#3b2618'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(fx0, fy0 + fh); ctx.lineTo(fx0, fy0); ctx.stroke();
        ctx.fillStyle = '#c2410c'; ctx.strokeStyle = '#f6e7c4'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(fx0, fy0); ctx.lineTo(fx0 + fh * 0.62, fy0 + fh * 0.17); ctx.lineTo(fx0, fy0 + fh * 0.34); ctx.closePath(); ctx.stroke(); ctx.fill();
      }
      if (c.rush > 0 || c.crash > 0) {
        const tag = c.rush > 0 ? `シュガーラッシュ！ あと${c.rush}日` : `クラッシュ あと${c.crash}日`;
        ctx.font = `900 ${fs * 0.8}px "Zen Maru Gothic", sans-serif`;
        const tw = ctx.measureText(tag).width + 12;
        const ty = sy + s * 0.32 + fs * 2.4;
        ctx.fillStyle = c.rush > 0 ? '#d6338a' : '#4a5470';
        ctx.beginPath(); ctx.roundRect(sx - tw / 2, ty, tw, fs * 1.15, 6); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(tag, sx, ty + fs * 0.88);
      }
      if (state.pick?.days?.[c.id] !== undefined) {
        ctx.fillStyle = '#3b2618';
        ctx.strokeText(`▼ 約${state.pick.days[c.id]}日`, sx, sy - s * 0.85);
        ctx.fillText(`▼ 約${state.pick.days[c.id]}日`, sx, sy - s * 0.85);
      }
      if (state.selCity === c.id || hoverCity === c.id) {
        ctx.strokeStyle = state.selCity === c.id ? '#fff' : 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(sx, sy, R + 6, (R + 6) * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 小さなバッジ
      const badges = [];
      if (world.contracts.some((x) => x.city === c.id && !x.done && !x.failed)) badges.push('ui/contract');
      if (world.player.buildings.some((b) => b.city === c.id)) badges.push('ui/workshop');
      if (c.rush > 0) badges.push('ui/rush');
      if (c.crash > 0) badges.push('ui/crash');
      badges.forEach((b, i) => { const bi = img(b); if (ready(bi)) ctx.drawImage(bi, sx + s * 0.35, sy - s * 0.8 + i * 20, 20, 20); });
      });
    }
    // 隊商
    const units = [];
    world.player.merchants.forEach((m, i) => {
      const [px, py] = unitPos(m);
      let flip = false;
      if (m.travel) { const t = m.travel; const a = t.tiles[Math.min(t.i, t.tiles.length - 1)]; const b = t.tiles[Math.min(t.i + 1, t.tiles.length - 1)]; flip = (b[0] - b[1]) < (a[0] - a[1]); }
      units.push({ px, py, img: `transport/${m.transport}`, label: String(i + 1), mine: true, idx: m.travel ? null : i, flip, sel: state.selMerchant === m.id });
    });
    world.rivals.forEach((rv) => rv.merchants.forEach((m) => {
      const city = world.cities[m.travelDays > 0 ? m.from : m.city];
      let px = city.x;
      let py = city.y;
      if (m.travelDays > 0) {
        const d = world.cities[m.dest];
        const total = Math.max(1, (world.day - m.departDay) + m.travelDays);
        const f = (world.day - m.departDay) / total;
        px += (d.x - city.x) * f;
        py += (d.y - city.y) * f;
      } else { px -= 30; py += 18; }
      units.push({ px, py, img: `transport/${m.transport}`, label: '敵', mine: false, idx: null, flip: false });
    }));
    for (const u of units) {
      let [sx, sy] = unitScreen(u.px, u.py);
      if (u.idx !== null) { sx += (26 + (u.idx % 3) * 20) * Math.max(0.6, cam.zoom); sy += 8 * Math.max(0.6, cam.zoom); }
      const s = 34 * Math.max(0.6, cam.zoom);
      const im = img(u.img);
      if (ready(im)) {
        ctx.save();
        ctx.translate(sx, sy - s * 0.6);
        if (u.flip) ctx.scale(-1, 1);
        ctx.drawImage(im, -s / 2, -s / 2, s, s);
        ctx.restore();
      }
      ctx.fillStyle = u.mine ? '#ffd166' : '#b48cf2';
      ctx.strokeStyle = '#3b2618';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx + s * 0.4, sy - s * 0.95, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3b2618';
      ctx.font = '900 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(u.label, sx + s * 0.4, sy - s * 0.95 + 3);
      if (u.sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, sy, s * 0.5, s * 0.25, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    for (const f of labels) f();
    drawMini();
  }

  // ミニマップ（真上から、色だけ）
  let miniBase = null;
  function drawMini() {
    const m = mini.getContext('2d');
    if (!miniBase || miniBase.v !== world.grid.version) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = Hh;
      const cc = c.getContext('2d');
      const im = cc.createImageData(W, Hh);
      for (let i = 0; i < W * Hh; i++) {
        const hex = world.grid.path[i] ? (world.grid.path[i] > 1 ? '#6b4a22' : '#8a6a3e') : TERRAIN_COLOR[world.grid.terrain[i]];
        const n = parseInt(hex.slice(1), 16);
        im.data[i * 4] = n >> 16;
        im.data[i * 4 + 1] = (n >> 8) & 255;
        im.data[i * 4 + 2] = n & 255;
        im.data[i * 4 + 3] = 255;
      }
      cc.putImageData(im, 0, 0);
      miniBase = { c, v: world.grid.version };
    }
    m.imageSmoothingEnabled = false;
    m.drawImage(miniBase.c, 0, 0, mini.width, mini.height);
    const sxs = mini.width / W;
    const sys = mini.height / Hh;
    for (const c of Object.values(world.cities)) {
      const [tx, ty] = world.grid.cityTiles[c.id];
      m.fillStyle = '#3b2618';
      m.fillRect(tx * sxs - 2, ty * sys - 2, 5, 5);
    }
    for (const mm of world.player.merchants) {
      const [px, py] = unitPos(mm);
      m.fillStyle = '#ffd166';
      m.fillRect((px / G.TILE_PX) * sxs - 2, (py / G.TILE_PX) * sys - 2, 4, 4);
    }
    // 見えている範囲
    const corners = [[0, 0], [canvas.clientWidth, 0], [canvas.clientWidth, canvas.clientHeight], [0, canvas.clientHeight]].map(([sx, sy]) => tileFromWorld(...fromScreen(sx, sy)));
    m.strokeStyle = '#fff';
    m.lineWidth = 1;
    m.beginPath();
    corners.forEach(([x, y], i) => (i ? m.lineTo(x * sxs, y * sys) : m.moveTo(x * sxs, y * sys)));
    m.closePath();
    m.stroke();
  }

  function cityAtScreen(sx, sy) {
    let best = null;
    for (const c of Object.values(world.cities)) {
      const [tx, ty] = world.grid.cityTiles[c.id];
      const [cx, cy] = toScreen(...iso(tx, ty));
      const d = Math.hypot((cx - sx) / 1.3, cy - 10 * cam.zoom - sy);
      if (d < 38 * Math.max(0.6, cam.zoom) && (!best || d < best.d)) best = { id: c.id, d };
    }
    return best?.id || null;
  }

  // 操作: ドラッグで移動、ホイールで拡大縮小、クリックで町
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { cam.x = drag.cx - dx / cam.zoom; cam.y = drag.cy - dy / cam.zoom; invalidate(); draw(); }
      return;
    }
    const id = cityAtScreen(e.clientX - r.left, e.clientY - r.top);
    if (id !== hoverCity) { hoverCity = id; canvas.style.cursor = id ? 'pointer' : 'grab'; handlers.onHoverCity?.(id); draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    const r = canvas.getBoundingClientRect();
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) return;
    if (state.found) {
      const [tx, ty] = tileFromWorld(...fromScreen(e.clientX - r.left, e.clientY - r.top));
      handlers.onFoundTile?.(tx, ty);
      return;
    }
    if (state.build) {
      const [tx, ty] = tileFromWorld(...fromScreen(e.clientX - r.left, e.clientY - r.top));
      handlers.onBuildTile?.(tx, ty);
      return;
    }
    const id = cityAtScreen(e.clientX - r.left, e.clientY - r.top);
    if (id) handlers.onCity?.(id, e);
  });
  canvas.addEventListener('dblclick', (e) => {
    const r = canvas.getBoundingClientRect();
    const id = cityAtScreen(e.clientX - r.left, e.clientY - r.top);
    if (id) handlers.onCityDouble?.(id, e);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    draw();
  }, { passive: false });
  mini.addEventListener('click', (e) => {
    const r = mini.getBoundingClientRect();
    const tx = ((e.clientX - r.left) / mini.clientWidth) * W;
    const ty = ((e.clientY - r.top) / mini.clientHeight) * Hh;
    [cam.x, cam.y] = iso(tx, ty);
    invalidate();
    draw();
  });
  new ResizeObserver(() => { resize(); draw(); }).observe(container);

  function unitPos(m) {
    if (!m.travel) { const c = world.cities[m.city]; return [c.x, c.y]; }
    const t = m.travel;
    const a = t.tiles[Math.min(t.i, t.tiles.length - 1)];
    const b = t.tiles[Math.min(t.i + 1, t.tiles.length - 1)];
    const f = t.steps[t.i] ? Math.min(1, t.part / t.steps[t.i]) : 0;
    return [(a[0] + (b[0] - a[0]) * f) * G.TILE_PX, (a[1] + (b[1] - a[1]) * f) * G.TILE_PX];
  }

  // 最初は全体を見せて、商人のいる町へ寄る
  requestAnimationFrame(() => {
    resize();
    fitAll();
    const m0 = world.player.merchants[0];
    if (m0?.city) {
      const [tx, ty] = world.grid.cityTiles[m0.city];
      const full = cam.zoom;
      [cam.x, cam.y] = iso(tx, ty);
      cam.zoom = Math.max(full, 1.1);
    }
    invalidate();
    draw();
  });
  // ラッシュ中の町があれば、光を動かすために描き直す
  setInterval(() => { if (Object.values(world.cities).some((c) => c.rush > 0) && !document.hidden) draw(); }, 80);
  // 画像が読み込まれたら描き直す
  setInterval(() => { if ([...IMG.values()].some((im) => !im.__drawn && ready(im))) { IMG.forEach((im) => { if (ready(im)) im.__drawn = true; }); invalidate(); draw(); } }, 300);

  return {
    canvas,
    update(w, st) { world = w; state = st; draw(); },
    screenPos(px, py) {
      const [sx, sy] = unitScreen(px, py);
      const r = canvas.getBoundingClientRect();
      return [r.left + sx, r.top + sy];
    },
    unitPos,
    centerOn(px, py) { [cam.x, cam.y] = pxToWorld(px, py); invalidate(); draw(); },
    // 町がどれも画面に見えていなければ、全部が入るように寄せる（行き先を選ぶとき、行き先が画面の外にあって選べなかったため）
    frameCities(ids, keep = null) {
      const pts = ids.map((id) => world.grid.cityTiles[id]).filter(Boolean).map((t) => iso(t[0], t[1]));
      if (!pts.length) return;
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      const visible = (p) => { const [sx, sy] = toScreen(p[0], p[1]); return sx > 40 && sx < cw - 40 && sy > 60 && sy < ch - 40; };
      const others = keep ? pts.filter((_, i) => ids[i] !== keep) : pts;
      if (others.some(visible)) return;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      cam.x = (Math.min(...xs) + Math.max(...xs)) / 2;
      cam.y = (Math.min(...ys) + Math.max(...ys)) / 2;
      // 左上の手引きと右下の小さな地図に隠れないよう、余白を広めに取る
      cam.zoom = Math.max(0.18, Math.min(cam.zoom, (cw - 2 * Math.min(260, cw * 0.25)) / Math.max(1, Math.max(...xs) - Math.min(...xs)), (ch - 2 * Math.min(170, ch * 0.22)) / Math.max(1, Math.max(...ys) - Math.min(...ys))));
      invalidate();
      draw();
    },
    // 開発用（撮影）: 町か "x,y" のマス、"fit" で全体。zoom は倍率
    camTo(target, zoom) {
      requestAnimationFrame(() => {
        if (target === 'fit') fitAll();
        else {
          const t = world.grid.cityTiles[target] || target.split('-').map(Number);
          [cam.x, cam.y] = iso(t[0], t[1]);
        }
        if (zoom) cam.zoom = zoom;
        invalidate();
        draw();
      });
    },
  };
}
