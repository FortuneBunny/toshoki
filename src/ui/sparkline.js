// 相場の小さなグラフ
import { s } from './dom.js';

export function sparkline(values, w = 60, hgt = 18, color = '#ffd166') {
  const v = values.slice(-16);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((x, i) => [(i / Math.max(1, v.length - 1)) * (w - 4) + 2, hgt - 2 - ((x - lo) / span) * (hgt - 4)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const up = v[v.length - 1] >= v[0];
  return s('svg', { class: 'spark', width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}` },
    s('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linejoin': 'round', opacity: 0.9 }),
    s('circle', { cx: last[0], cy: last[1], r: 2.4, fill: up ? '#8fd16a' : '#ff6b5b' }));
}
