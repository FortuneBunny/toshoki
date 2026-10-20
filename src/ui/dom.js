// 小さな DOM 生成の道具
export function h(tag, attrs = {}, ...children) {
  const el = tag === 'svg' || attrs?.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false || k === 'svg') continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const s = (tag, attrs = {}, ...children) => h(tag, { ...attrs, svg: true }, ...children);

// null や false を無視して子要素を足す
export function add(el, ...children) {
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export const icon = (path, cls = 'icon', alt = '') => h('img', { src: `assets/svg/${path}.svg`, class: cls, alt, draggable: 'false' });
export const goodIcon = (id, cls = 'icon') => icon(`goods/${id}`, cls);

export const fmt = (n, d = 0) => (n === undefined || n === null || Number.isNaN(n) ? '-' : Number(n).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d }));

export function safeStorage() {
  try {
    const k = '__t';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}
