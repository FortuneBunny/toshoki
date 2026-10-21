// 演出: 浮かぶ数字、糖の結晶のパーティクル、画面の揺れ、フラッシュ、通知、バナー
// 強さ（level）: 0=控えめ 1=標準 2=最大。大きい出来事ほど派手にし、小さい出来事は控えめにする。
import { h } from './dom.js';

let level = 1;
export const setFxLevel = (l) => { level = l; };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const layer = () => document.getElementById('fx-layer');

export function floatNumber(x, y, text, { size = 'normal', negative = false } = {}) {
  const el = h('div', { class: `float-num ${size === 'normal' ? '' : size} ${negative ? 'neg' : ''}`, style: { left: `${x}px`, top: `${y}px` } }, text);
  layer().append(el);
  setTimeout(() => el.remove(), 1500);
}

const CRYSTAL = 'assets/svg/ui/sugar-crystal.svg';
const COIN = 'assets/svg/ui/silver.svg';
const STAR = 'assets/svg/ui/star.svg';

// 物理っぽく弾けて落ちる粒
export function burst(x, y, count = 12, { img = CRYSTAL, spread = 1, gravity = 0.35, size = 18 } = {}) {
  if (reduced() || level === 0) count = Math.min(count, 3);
  else if (level === 2) count = Math.round(count * 1.6);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const el = h('img', { src: img, class: 'particle', style: { left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px` } });
    layer().append(el);
    const a = Math.random() * Math.PI * 2;
    const v = (3 + Math.random() * 6) * spread;
    parts.push({ el, x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: Math.random() * 360, vr: (Math.random() - 0.5) * 20, life: 1 });
  }
  let frames = 0;
  function step() {
    frames++;
    for (const p of parts) {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      p.life -= 0.018;
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.r}deg) scale(${0.5 + p.life * 0.7})`;
      p.el.style.opacity = Math.max(0, p.life);
    }
    if (frames < 60) requestAnimationFrame(step);
    else parts.forEach((p) => p.el.remove());
  }
  requestAnimationFrame(step);
}

// 粒が所持金の表示に吸い込まれる
export function coinsTo(fromX, fromY, toEl, count = 6) {
  if (!toEl) return;
  const r = toEl.getBoundingClientRect();
  const tx = r.left + 20;
  const ty = r.top + r.height / 2;
  const n = level === 0 || reduced() ? 2 : level === 2 ? count * 2 : count;
  for (let i = 0; i < n; i++) {
    const el = h('img', { src: COIN, class: 'particle', style: { left: `${fromX}px`, top: `${fromY}px`, width: '20px', height: '20px' } });
    layer().append(el);
    const delay = i * 45;
    const ox = (Math.random() - 0.5) * 80;
    const oy = (Math.random() - 0.5) * 60 - 30;
    const start = performance.now() + delay;
    const dur = 650;
    function step(now) {
      const t = Math.min(1, Math.max(0, (now - start) / dur));
      const e = t * t * (3 - 2 * t);
      const mx = fromX + ox;
      const my = fromY + oy;
      const x = (1 - e) * (1 - e) * fromX + 2 * (1 - e) * e * mx + e * e * tx;
      const y = (1 - e) * (1 - e) * fromY + 2 * (1 - e) * e * my + e * e * ty;
      el.style.transform = `translate(${x - fromX}px, ${y - fromY}px) scale(${1 - e * 0.4})`;
      if (t < 1) requestAnimationFrame(step);
      else el.remove();
    }
    requestAnimationFrame(step);
  }
}

export function shake(el = document.getElementById('app')) {
  if (level === 0 || reduced()) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

export function flash() {
  if (level === 0 || reduced()) return;
  const el = h('div', { class: 'flash' });
  document.body.append(el);
  setTimeout(() => el.remove(), 520);
}

// sticky: 自分で消すまで残す（行き先を選んでいる間の案内など）。消すときは返した要素を remove する
export function toast(text, { icon, kind = '', sticky = false } = {}) {
  const box = document.getElementById('toasts');
  while (box.children.length >= 4) box.firstChild.remove();
  const el = h('div', { class: `toast ${kind}` }, icon ? h('img', { src: `assets/svg/${icon}.svg`, alt: '' }) : null, text);
  box.append(el);
  if (!sticky) setTimeout(() => el.remove(), 3700);
  return el;
}

export function banner(title, sub, img) {
  if (level === 0) return toast(title, { icon: img });
  const el = h('div', { class: 'banner' }, h('div', {}, img ? h('img', { src: `assets/svg/${img}.svg`, alt: '' }) : null, h('div', { class: 't' }, title), sub ? h('div', { class: 's' }, sub) : null));
  document.body.append(el);
  setTimeout(() => el.remove(), 2700);
}

// 所持金のカウントアップ
// 新しいカウントアップが始まったら、前のものは止める（古い値で上書きしないように）
export function countUp(el, from, to, dur = 600) {
  const start = performance.now();
  const token = (el.__countToken = (el.__countToken || 0) + 1);
  el.textContent = Math.floor(from).toLocaleString('ja-JP');
  function step() {
    if (el.__countToken !== token) return;
    const t = Math.min(1, (performance.now() - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.floor(from + (to - from) * e).toLocaleString('ja-JP');
    if (t < 1) setTimeout(step, 16);
  }
  step();
}

export const STAR_IMG = STAR;
