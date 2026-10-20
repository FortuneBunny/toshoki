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
    h('button', { class: 'btn small', title: '拡大', onclick: () => zoomAt(1.25) }, '＋'),
    h('button', { class: 'btn small', title: '縮小', onclick: () => zoomAt(0.8) }, '－'),
    h('button', { class: 'btn small', title: '全体を見る', onclick: () => fitAll() }, '全体'));
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
    c.fillStyle = '#2f7fa8';
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
      if (b.type === 'house') {
        const v = ((b.x * 7 + b.y * 11) % 10) / 10;
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
      if (c.rush > 0) { ctx.fillStyle = 'rgba(200,244,255,0.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, R * 1.3, R * 0.75, 0, 0, Math.PI * 2); ctx.fill(); }
      const im = img(cityImage(c));
      const s = 64 * Math.max(0.55, cam.zoom);
      if (ready(im)) ctx.drawImage(im, sx - s / 2, sy - s * 0.8, s, s);
      // 名前と人口
      const fs = Math.max(11, 14 * Math.min(1.2, cam.zoom + 0.3));
      ctx.font = `900 ${fs}px "Zen Maru Gothic", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#f6e7c4';
      ctx.fillStyle = '#3b2618';
      ctx.strokeText(c.name, sx, sy + s * 0.32 + fs);
      ctx.fillText(c.name, sx, sy + s * 0.32 + fs);
      const age = G.knowledgeAge(world, c.id);
      const sub = `${G.tierName(G.cityTier(c))} ${Math.round(c.pop).toLocaleString('ja-JP')}人${age === null ? '・未訪問' : age > 0 && !here ? `・${age}日前` : ''}`;
      ctx.font = `700 ${fs * 0.75}px "Zen Maru Gothic", sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeText(sub, sx, sy + s * 0.32 + fs * 1.9);
      ctx.fillStyle = '#5b4026';
      ctx.fillText(sub, sx, sy + s * 0.32 + fs * 1.9);
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
  };
}
