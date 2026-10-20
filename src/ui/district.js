// 区画の画面: 斜め見下ろしのマス目に、地形・資源・建物を描く。生産施設を選んで置ける。
import { h, s, add, clear, goodIcon, fmt } from './dom.js';
import { modal } from './panels.js';
import * as G from '../core/index.js';

const TW = 52; // マスの幅
const TH = 26; // マスの高さ
const TERRAIN_FILL = { m: '#9a7b52', r: '#b8915a', '.': '#e2cf9a', f: '#b7c97a', s: '#f0d9a2', w: '#5bb4d6', h: '#c9a46a' };
const PRODUCER_OF_RES = Object.fromEntries(Object.entries(G.PRODUCERS).filter(([, p]) => p.resource).map(([k, p]) => [p.resource, p.good]));

const iso = (x, y) => [(x - y) * (TW / 2), (x + y) * (TH / 2)];
const diamond = (cx, cy) => `${cx},${cy - TH / 2} ${cx + TW / 2},${cy} ${cx},${cy + TH / 2} ${cx - TW / 2},${cy}`;

export function openDistrict(app, cityId) {
  const world = app.world;
  const city = world.cities[cityId];
  let selected = null; // 置こうとしている施設の種類
  let demolishMode = false;
  let hover = null;
  const body = h('div', { class: 'district' });
  const info = h('div', { class: 'district-info' });

  function render() {
    clear(body);
    const d = city.district;
    const tier = G.cityTier(city);
    const rad = G.cityRadius(city, tier);
    const here = G.hasPresence(world, cityId);
    const canBuild = here && G.districtEnabled(world);

    // 左: 施設の一覧
    const palette = h('div', { class: 'district-palette' });
    add(palette, h('div', { class: 'section' }, '生産施設を置く'));
    if (!G.districtEnabled(world)) add(palette, h('div', { class: 'faint' }, 'このシナリオでは区画を見るだけ（建物を置くのは次のシナリオから）'));
    else if (!here) add(palette, h('div', { class: 'faint' }, '置くには、この町に商人がいるか、定期便が回っている必要がある'));
    for (const [k, p] of Object.entries(G.PRODUCERS)) {
      if (!world.scenario.goods.includes(p.good)) continue;
      const nativeOnly = ['food', 'sweet'].includes(G.GOODS[p.good].kind) && !(d.native || []).includes(p.good);
      if (nativeOnly) continue;
      const n = G.placeableTiles(city, tier, k).length;
      const cost = Math.round(p.cost * (world.player.mods?.buildCost ?? 1));
      add(palette, h('button', {
        class: `btn small district-item ${selected === k ? 'primary' : ''}`, disabled: !canBuild || !n || undefined,
        title: n ? `${p.name}: ${G.GOODS[p.good].name}が毎日 +${p.rate}（町の市場に出る）。働き手 ${p.workers}人` : `${p.name}を置けるマスがない`,
        onclick: () => { selected = selected === k ? null : k; demolishMode = false; render(); },
      }, goodIcon(p.good, 'icon-sm'), h('span', {}, p.name), h('small', { class: 'num' }, `${cost}銀`), h('small', { class: 'faint' }, n ? `${n}か所` : 'なし')));
    }
    add(palette, h('div', { class: 'section' }, '需要施設'));
    for (const [k, cv] of Object.entries(G.CIVICS)) {
      const why = G.civicCheck(world, cityId, k);
      if (why && /扱わない/.test(why)) continue;
      const wants = G.civicWants(k, world.scenario.goods);
      add(palette, h('button', {
        class: `btn small district-item ${selected === `civic:${k}` ? 'primary' : ''}`, disabled: !canBuild || !!why || undefined,
        title: why || `${cv.name}: ${wants.map((g) => G.GOODS[g].name).join('・')}が届くと成長 最大+${Math.round(cv.growth * 100)}%。${cv.effect}`,
        onclick: () => { selected = selected === `civic:${k}` ? null : `civic:${k}`; demolishMode = false; render(); },
      }, h('img', { src: `assets/svg/cities/${k}.svg`, class: 'icon-sm', alt: '', onerror: (e) => { e.target.style.visibility = 'hidden'; } }), h('span', {}, cv.name), h('small', { class: 'num' }, `${G.civicCost(world, k)}銀`), h('small', { class: 'faint' }, why ? why.replace(/^.*は「/, '「') : wants.map((g) => G.GOODS[g].name).join('・'))));
    }
    add(palette, h('div', { class: 'section' }, 'そのほか'));
    add(palette, h('button', { class: `btn small ${demolishMode ? 'danger' : 'ghost'}`, disabled: !canBuild || undefined, onclick: () => { demolishMode = !demolishMode; selected = null; render(); } }, demolishMode ? '取り壊しモード中' : '自分の施設を取り壊す'));
    const ec = G.expandCost(world, cityId);
    add(palette, h('button', { class: 'btn small', disabled: !canBuild || (d.radiusBonus || 0) >= 2 || undefined, onclick: () => app.confirm(`市場の圏を広げる（${ec}銀）`, '建物を置ける範囲が1マス広がります（最大2回）。', () => { app.run(() => G.expandMarket(world, cityId), 'build'); render(); }) }, `市場の圏を広げる ${ec}銀`));

    // 右: 区画の絵
    const isCivic = selected?.startsWith('civic:');
    const valid = new Set(selected ? G.placeableTiles(city, tier, isCivic ? null : selected).map(([x, y]) => `${x},${y}`) : []);
    const [minX] = iso(0, d.size - 1);
    const [maxX] = iso(d.size - 1, 0);
    const width = maxX - minX + TW + 20;
    const height = (d.size * 2) * (TH / 2) + 90;
    const ox = -minX + TW / 2 + 10;
    const oy = 70;
    const svg = s('svg', { class: 'district-map', viewBox: `0 0 ${width} ${height}`, width: '100%' });
    const tiles = s('g');
    const things = s('g');
    for (let y = 0; y < d.size; y++) for (let x = 0; x < d.size; x++) {
      const i = y * d.size + x;
      const [cx0, cy0] = iso(x, y);
      const cx = cx0 + ox;
      const cy = cy0 + oy;
      const inR = G.tileDist(x, y) <= rad;
      const key = `${x},${y}`;
      const b = d.buildings.find((v) => v.x === x && v.y === y && !v.virtual);
      const poly = s('polygon', {
        points: diamond(cx, cy), fill: TERRAIN_FILL[d.terrain[i]], stroke: valid.has(key) ? '#7dff6a' : 'rgba(59,38,24,0.25)', 'stroke-width': valid.has(key) ? 2.5 : 1,
        opacity: inR ? 1 : 0.45, class: 'tile',
        onmouseenter: () => { hover = { x, y }; showInfo(); },
        onclick: () => onTile(x, y),
      });
      add(tiles, poly);
      if (d.terrain[i] === 'h' && !b) add(tiles, s('path', { d: `M${cx - 8},${cy + 3} L${cx - 2},${cy - 5} L${cx + 4},${cy + 3}`, fill: 'none', stroke: '#8a6a3e', 'stroke-width': 1.5, 'pointer-events': 'none' }));
      if (d.res[i] !== '-' && !b) {
        const g = PRODUCER_OF_RES[d.res[i]];
        if (g) add(tiles, s('image', { href: `assets/svg/goods/${g}.svg`, x: cx - 9, y: cy - 11, width: 18, height: 18, opacity: inR ? 0.75 : 0.35, 'pointer-events': 'none' }));
      }
      if (b) things.append(buildingSprite(b, cx, cy, tier));
    }
    add(svg, tiles, things);

    info.textContent = '';
    add(body, palette, h('div', { class: 'district-view' }, svg, info));
    showInfo();
  }

  function buildingSprite(b, cx, cy, tier) {
    const g = s('g', { 'pointer-events': 'none' });
    if (b.type === 'house') {
      const v = ((b.x * 7 + b.y * 11) % 10) / 10;
      const w = 16 + v * 6;
      const hh = 10 + v * 4;
      const roof = ['#c8553d', '#d9822b', '#8e3b2e', '#a65a1b'][Math.floor(v * 4)];
      add(g, s('rect', { x: cx - w / 2, y: cy - hh + 2, width: w, height: hh, fill: ['#f3dfb3', '#e2c08a', '#f0d6a0'][Math.floor(v * 3)], stroke: '#3b2618', 'stroke-width': 1.2 }));
      if (tier >= 3 && v > 0.75) add(g, s('path', { d: `M${cx - w / 2 + 1},${cy - hh + 2} Q${cx},${cy - hh - w * 0.7} ${cx + w / 2 - 1},${cy - hh + 2} Z`, fill: v > 0.9 ? '#ffd166' : '#5bb4d6', stroke: '#3b2618', 'stroke-width': 1.2 }));
      else add(g, s('path', { d: `M${cx - w / 2 - 2},${cy - hh + 2} L${cx},${cy - hh - 6} L${cx + w / 2 + 2},${cy - hh + 2} Z`, fill: roof, stroke: '#3b2618', 'stroke-width': 1.2 }));
      add(g, s('rect', { x: cx - 2, y: cy - 4, width: 4, height: 6, fill: '#3b2618', opacity: 0.6 }));
      return g;
    }
    if (G.CIVICS[b.type]) {
      add(g, s('image', { href: `assets/svg/cities/${b.type}.svg`, x: cx - 30, y: cy - 50, width: 60, height: 60 }));
      return g;
    }
    if (b.type === 'market') {
      add(g, s('image', { href: `assets/svg/cities/tier${tier}.svg`, x: cx - 34, y: cy - 58, width: 68, height: 68 }));
    } else if (b.owner === 'player') {
      add(g, s('image', { href: `assets/svg/cities/${b.type}.svg`, x: cx - 26, y: cy - 44, width: 52, height: 52 }));
    } else {
      const p = G.PRODUCERS[b.type];
      const building = b.readyDay !== undefined && world.day < b.readyDay;
      add(g, s('polygon', { points: diamond(cx, cy + 1), fill: b.placed ? '#f2a93b' : '#a07a48', opacity: 0.55 }));
      add(g, s('image', { href: `assets/svg/goods/${p.good}.svg`, x: cx - 16, y: cy - 30, width: 32, height: 32, opacity: building ? 0.45 : 1 }));
      if (building) add(g, s('text', { x: cx, y: cy + 6, 'text-anchor': 'middle', style: 'font:900 10px sans-serif;fill:#3b2618' }, `建設中 あと${b.readyDay - world.day}日`));
    }
    return g;
  }

  function describe(x, y) {
    const t = G.tileAt(city.district, x, y);
    const parts = [`${G.coordName(x, y)}: ${G.TERRAIN[t.terrain].name}`];
    if (t.res !== '-') parts.push(G.RESOURCES[t.res].name);
    if (t.building) {
      const b = t.building;
      if (b.readyDay !== undefined && world.day < b.readyDay) parts.push(`建設中（あと${b.readyDay - world.day}日）`);
      parts.push(G.CIVICS[b.type] ? `${G.CIVICS[b.type].name}（満足度 ${Math.round((city.civicSat?.[b.type] || 0) * 100)}%）` : b.type === 'house' ? `家（${G.houseCap(G.cityTier(city))}人まで住める）` : b.type === 'market' ? '市場' : b.owner === 'player' ? `自分の${G.BUILDINGS[b.type].name}` : `${G.PRODUCERS[b.type].name}（${G.GOODS[G.PRODUCERS[b.type].good].name} ${fmt(b.rate ?? G.PRODUCERS[b.type].rate, 1)}/日${b.placed ? '、自分が建てた' : ''}）`);
    }
    return parts.join('・');
  }

  function showInfo() {
    const tier = G.cityTier(city);
    const cap = G.housingCap(city, tier);
    const head = `${city.name}  ${G.tierName(tier)}・人口 ${fmt(city.pop)} / 住める人数 ${fmt(cap)}（家 ${G.houseCount(city)}軒）・働き手 ${fmt(Math.min(G.workersNeeded(city), G.workersAvailable(city)))} / ${fmt(G.workersAvailable(city))}（必要 ${fmt(G.workersNeeded(city))}）・市場の圏 ${G.cityRadius(city, tier)}マス${G.staffing(city) < 1 ? `\n⚠ 働き手が足りず、生産施設が ${Math.round(G.staffing(city) * 100)}% しか動いていない` : ''}${city.pop >= cap * 0.98 ? '\n⚠ 家を建てる空き地がなく、人口が頭打ち' : ''}`;
    let line = hover ? describe(hover.x, hover.y) : 'マスにカーソルを合わせると詳細';
    if (hover && selected) {
      const civic = selected.startsWith('civic:') ? selected.slice(6) : null;
      const why = G.placeCheck(city, tier, civic ? null : selected, hover.x, hover.y);
      line += why ? `　✖ ${why}` : `　✔ ${civic ? G.CIVICS[civic].name : G.PRODUCERS[selected].name}を置ける（クリック）`;
    }
    info.textContent = `${head}\n${line}`;
  }

  function onTile(x, y) {
    if (demolishMode) {
      const t = G.tileAt(city.district, x, y);
      if (!t.building) return;
      app.confirm('取り壊す', `${describe(x, y)} を取り壊します。費用は戻りません。`, () => { app.run(() => G.demolish(world, cityId, x, y)); render(); });
      return;
    }
    if (!selected) return;
    if (selected.startsWith('civic:')) {
      const type = selected.slice(6);
      const r = app.run(() => G.buildCivic(world, cityId, type, [x, y]), 'build');
      if (r.ok) { selected = null; render(); }
      return;
    }
    const why = G.placeCheck(city, G.cityTier(city), selected, x, y);
    if (why) return app.error(why);
    const p = G.PRODUCERS[selected];
    const r = app.run(() => G.placeProducer(world, cityId, selected, x, y), 'build');
    if (r.ok) render();
    void p;
  }

  app.state.modals++;
  render();
  modal(app, `${city.name}の区画`, body, null, { wide: true });
}
