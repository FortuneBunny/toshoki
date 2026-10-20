// 地図（SVG）: 地形の飾り、道、町、移動中の隊商
import { s, h } from './dom.js';
import * as G from '../core/index.js';

const W = 1000;
const H = 600;

function hash(str) {
  let x = 2166136261;
  for (const c of str) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0;
  return x;
}
function rand(seed) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// 道は少し曲げる（二次ベジェ）
function edgeGeom(world, e) {
  const a = world.cities[e.a];
  const b = world.cities[e.b];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = ((hash(`${e.a}-${e.b}`) % 100) / 100 - 0.5) * 0.35 * len;
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return { a, b, cx, cy, d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}` };
}
function bezier(g, t, fromA) {
  if (!fromA) t = 1 - t;
  const x = (1 - t) * (1 - t) * g.a.x + 2 * (1 - t) * t * g.cx + t * t * g.b.x;
  const y = (1 - t) * (1 - t) * g.a.y + 2 * (1 - t) * t * g.cy + t * t * g.b.y;
  return [x, y];
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
  if (g < 150) return '#8fd16a';
  return '#c8f4ff';
}

const EDGE_LEGEND = [['trail', '小道'], ['road', '街道'], ['desert', '砂漠'], ['sea', '海路'], ['river', '川']];

export function createMap(container, world, handlers) {
  const svg = s('svg', { class: 'map', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
  const defs = s('defs', {},
    s('radialGradient', { id: 'map-sand', cx: '50%', cy: '45%', r: '75%' },
      s('stop', { offset: '0%', 'stop-color': '#f1dcae' }),
      s('stop', { offset: '70%', 'stop-color': '#e2c48a' }),
      s('stop', { offset: '100%', 'stop-color': '#c9a46a' })),
    s('pattern', { id: 'map-grain', width: 8, height: 8, patternUnits: 'userSpaceOnUse' },
      s('circle', { cx: 2, cy: 3, r: 0.7, fill: '#b98c55', opacity: 0.25 }),
      s('circle', { cx: 6, cy: 6, r: 0.5, fill: '#fff', opacity: 0.2 })),
    s('filter', { id: 'map-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
      s('feGaussianBlur', { stdDeviation: 6 })));
  svg.append(defs);
  svg.append(s('rect', { width: W, height: H, fill: 'url(#map-sand)' }), s('rect', { width: W, height: H, fill: 'url(#map-grain)' }));

  const sc = world.scenario;
  // 地形（海・砂漠・川など）
  for (const sh of sc.shapes || []) {
    const pts = sh.points.map((p) => p.join(',')).join(' ');
    if (sh.kind === 'sea') svg.append(s('polygon', { points: pts, fill: '#5bb4d6', stroke: '#2f7fa8', 'stroke-width': 3, opacity: 0.95 }));
    if (sh.kind === 'desert') svg.append(s('polygon', { points: pts, fill: '#f0c27a', opacity: 0.55 }));
    if (sh.kind === 'green') svg.append(s('polygon', { points: pts, fill: '#9cc77a', opacity: 0.45 }));
    if (sh.kind === 'river') svg.append(s('polyline', { points: pts, fill: 'none', stroke: '#5bb4d6', 'stroke-width': 10, 'stroke-linecap': 'round', opacity: 0.85 }));
  }
  // 飾りの地形アイコン（町と道から離れた場所に、シードで決まった配置）
  const r = rand(hash(sc.id));
  const decor = s('g', { opacity: 0.85 });
  const near = (x, y, d) => Object.values(world.cities).some((c) => Math.hypot(c.x - x, c.y - y) < d);
  const types = sc.decor || ['dunes', 'dunes', 'mountain', 'palm', 'field', 'forest'];
  for (let i = 0, placed = 0; i < 400 && placed < (sc.decorCount || 26); i++) {
    const x = 30 + r() * (W - 60);
    const y = 30 + r() * (H - 60);
    if (near(x, y, 80)) continue;
    const inSea = (sc.shapes || []).some((sh) => sh.kind === 'sea' && pointInPoly([x, y], sh.points));
    const t = inSea ? 'waves' : types[Math.floor(r() * types.length)];
    const size = 34 + r() * 22;
    decor.append(s('image', { href: `assets/svg/terrain/${t}.svg`, x: x - size / 2, y: y - size / 2, width: size, height: size }));
    placed++;
  }
  svg.append(decor);

  // 道
  const edgeLayer = s('g');
  const geoms = {};
  for (const e of world.edges) {
    const g = edgeGeom(world, e);
    geoms[e.id] = g;
    const path = s('path', { d: g.d, class: `edge ${e.kind}`, 'data-edge': e.id });
    const hit = s('path', { d: g.d, class: 'edge-hit', onclick: (ev) => handlers.onEdge?.(e.id, ev) });
    edgeLayer.append(path, hit);
    if (e.danger) {
      const [x, y] = bezier(g, 0.5, true);
      edgeLayer.append(s('text', { x, y: y - 6, class: 'edge-danger', 'text-anchor': 'middle' }, '⚔'.repeat(Math.min(3, Math.ceil(e.danger)))));
    }
  }
  svg.append(edgeLayer);
  const preview = s('path', { class: 'route-preview', d: '' });
  svg.append(preview);

  // 町
  const cityLayer = s('g');
  const cityEls = {};
  for (const c of Object.values(world.cities)) {
    const glow = s('circle', { r: 52, fill: '#c8f4ff', filter: 'url(#map-glow)', class: 'rush-glow', opacity: 0 });
    const ringBg = s('circle', { r: 46, fill: 'rgba(59,38,24,0.18)', stroke: 'rgba(59,38,24,0.35)', 'stroke-width': 6, class: 'ring-bg' });
    const ring = s('circle', { r: 46, fill: 'none', stroke: '#f2a93b', 'stroke-width': 6, 'stroke-linecap': 'round', transform: 'rotate(-90)', 'stroke-dasharray': `0 999` });
    const img = s('image', { href: `assets/svg/${cityImage(c)}.svg`, x: -42, y: -48, width: 84, height: 84 });
    const label = s('text', { y: 56, 'text-anchor': 'middle', class: 'label' }, c.name);
    const sub = s('text', { y: 71, 'text-anchor': 'middle', class: 'sub' }, '');
    const badges = s('g', { transform: 'translate(30,-46)' });
    const pick = s('text', { y: -54, 'text-anchor': 'middle', class: 'sub' }, '');
    const g = s('g', { class: 'city-node', transform: `translate(${c.x},${c.y})`, onclick: (ev) => handlers.onCity?.(c.id, ev) }, glow, ringBg, ring, img, label, sub, badges, pick);
    cityLayer.append(g);
    cityEls[c.id] = { g, ring, img, sub, glow, badges, pick, imgKey: cityImage(c) };
  }
  svg.append(cityLayer);

  const unitLayer = s('g');
  svg.append(unitLayer);
  const unitEls = new Map();

  container.append(svg);
  const legend = h('div', { class: 'legend' }, EDGE_LEGEND.filter(([k]) => world.edges.some((e) => e.kind === k)).map(([k, n]) =>
    h('span', {}, s('svg', { viewBox: '0 0 28 8' }, s('path', { d: 'M2,4 L26,4', class: `edge ${k}` })), n)),
  world.edges.some((e) => e.danger) ? h('span', {}, '⚔ 盗賊') : null);
  container.append(legend);

  function circ(r0) { return 2 * Math.PI * r0; }

  function unitPos(m) {
    if (!m.travel) {
      const c = world.cities[m.city];
      return [c.x, c.y];
    }
    const t = m.travel;
    const e = world.edges.find((x) => x.id === t.edge);
    const g = geoms[e.id];
    const from = t.path[t.leg];
    const prog = Math.min(1, Math.max(0, 1 - t.daysLeft / Math.max(1, t.legDays)));
    return bezier(g, prog, from === e.a);
  }

  return {
    svg,
    geoms,
    update(world, state) {
      for (const c of Object.values(world.cities)) {
        const el = cityEls[c.id];
        const k = world.player.knowledge[c.id];
        const here = world.player.merchants.some((m) => m.city === c.id);
        const gl = here ? c.glucose : k?.glucose;
        const key = cityImage(c);
        if (key !== el.imgKey) {
          el.imgKey = key;
          el.img.setAttribute('href', `assets/svg/${key}.svg`);
        }
        if (gl !== undefined) {
          const frac = Math.min(1, gl / 200);
          el.ring.setAttribute('stroke-dasharray', `${circ(46) * frac} 999`);
          el.ring.setAttribute('stroke', gaugeColor(gl));
          el.ring.setAttribute('opacity', here ? 1 : 0.45);
        }
        el.glow.setAttribute('opacity', c.rush > 0 && (here || (k && world.day - k.day < 10)) ? 0.7 : 0);
        const age = G.knowledgeAge(world, c.id);
        el.sub.textContent = `${G.tierName(G.cityTier(c))} ${Math.round(c.pop).toLocaleString('ja-JP')}人${age === null ? ' ・未訪問' : age > 0 && !here ? ` ・情報${age}日前` : ''}`;
        el.g.classList.toggle('sel', state.selCity === c.id);
        // 小さなバッジ: 大口注文、工房、ラッシュ、クラッシュ
        const bs = [];
        if (world.contracts.some((x) => x.city === c.id && !x.done && !x.failed)) bs.push('ui/contract');
        if (world.player.buildings.some((b) => b.city === c.id)) bs.push('ui/workshop');
        if (c.rush > 0) bs.push('ui/rush');
        if (c.crash > 0) bs.push('ui/crash');
        const sig = bs.join();
        if (el.badges.dataset.sig !== sig) {
          el.badges.dataset.sig = sig;
          while (el.badges.firstChild) el.badges.firstChild.remove();
          bs.forEach((b, i) => el.badges.append(s('image', { href: `assets/svg/${b}.svg`, x: 0, y: i * 24, width: 26, height: 26 })));
        }
        el.pick.textContent = state.pick?.days?.[c.id] !== undefined ? `▼ 約${state.pick.days[c.id]}日` : '';
      }
      // 隊商（自分とライバル）
      const seen = new Set();
      const place = (key, m, img, cls, label, idx, flip) => {
        seen.add(key);
        let el = unitEls.get(key);
        if (!el) {
          el = {
            g: s('g', { class: `merchant-sprite ${cls}` }),
            img: s('image', { x: -22, y: -26, width: 44, height: 44 }),
            tag: s('circle', { cx: 18, cy: -20, r: 8, class: 'tag', stroke: '#3b2618', 'stroke-width': 2 }),
            text: s('text', { x: 18, y: -16, 'text-anchor': 'middle', style: 'font:900 10px sans-serif;fill:#3b2618' }, label),
          };
          el.g.append(el.img, el.tag, el.text);
          unitLayer.append(el.g);
        }
        el.img.setAttribute('href', `assets/svg/transport/${img}.svg`);
        el.img.setAttribute('transform', flip ? 'scale(-1,1)' : '');
        let [x, y] = m;
        if (idx !== null) { x += 34 + (idx % 3) * 26; y += 10 + Math.floor(idx / 3) * 22; }
        el.g.setAttribute('transform', `translate(${x},${y - 6})`);
      };
      world.player.merchants.forEach((m, i) => {
        const pos = unitPos(m);
        let flip = false;
        if (m.travel) {
          const a = world.cities[m.travel.path[m.travel.leg]];
          const b = world.cities[m.travel.path[m.travel.leg + 1]];
          flip = b.x < a.x;
        }
        place(`p${m.id}`, pos, m.transport, `mine ${state.selMerchant === m.id ? 'sel' : ''}`, String(i + 1), m.travel ? null : i, flip);
      });
      world.rivals.forEach((rv, ri) => rv.merchants.forEach((m, mi) => {
        const city = world.cities[m.travelDays > 0 ? m.from : m.city];
        let pos = [city.x, city.y];
        if (m.travelDays > 0) {
          const d = world.cities[m.dest];
          const total = Math.max(1, (world.day - m.departDay) + m.travelDays);
          const t = (world.day - m.departDay) / total;
          pos = [city.x + (d.x - city.x) * t, city.y + (d.y - city.y) * t];
        } else pos = [pos[0] - 40, pos[1] + 20];
        place(`r${ri}-${mi}`, pos, m.transport, 'rival', '敵', null, m.travelDays > 0 && world.cities[m.dest].x < city.x);
      }));
      for (const [k, el] of unitEls) if (!seen.has(k)) { el.g.remove(); unitEls.delete(k); }
      // 行き先を選んでいる間は経路を光らせる
      if (state.hoverRoute) {
        const d = state.hoverRoute.edges.map((e, i) => {
          const g = geoms[e.id];
          const from = state.hoverRoute.path[i];
          return from === e.a ? g.d : `M${g.b.x},${g.b.y} Q${g.cx},${g.cy} ${g.a.x},${g.a.y}`;
        }).join(' ');
        preview.setAttribute('d', d);
      } else preview.setAttribute('d', '');
    },
    // 画面上の座標（演出用）
    screenPos(x, y) {
      const pt = svg.createSVGPoint();
      pt.x = x;
      pt.y = y;
      const m = svg.getScreenCTM();
      if (!m) return [innerWidth / 2, innerHeight / 2];
      const p = pt.matrixTransform(m);
      return [p.x, p.y];
    },
    unitPos,
  };
}

function pointInPoly([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
