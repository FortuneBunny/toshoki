// SVG素材の検証: node tools/validate-svg.js [dir]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] || 'assets/svg';
const MAX_BYTES = 16 * 1024;
const FORBIDDEN = [/<script/i, /<image/i, /<foreignObject/i, /\son\w+\s*=/i, /(xlink:)?href\s*=\s*["'](?!#)/i, /@import/i, /url\(\s*["']?(?!#)/i];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.svg') ? [p] : [];
  });
}

// タグの開閉が釣り合っているかだけを見る簡易パーサ
function checkBalance(src) {
  const body = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(body))) {
    const [, closing, name, , selfClose] = m;
    if (selfClose) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== name) return `閉じタグ </${name}> が <${top}> と対応しない`;
    } else stack.push(name);
  }
  return stack.length ? `閉じられていないタグ: ${stack.join(', ')}` : null;
}

const files = walk(root);
let failed = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const errs = [];
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(src)) errs.push('<svg> で始まっていない');
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(src)) errs.push('xmlns がない');
  if (!/viewBox="0 0 (64 64|128 128|256 256|512 256|1024 512)"/.test(src)) errs.push('viewBox が規定外');
  for (const re of FORBIDDEN) if (re.test(src)) errs.push(`禁止パターン ${re}`);
  if (Buffer.byteLength(src) > MAX_BYTES) errs.push(`サイズ超過 ${Buffer.byteLength(src)}B`);
  const bal = checkBalance(src);
  if (bal) errs.push(bal);
  if (errs.length) {
    failed++;
    console.log(`NG ${relative('.', f)}\n   - ${errs.join('\n   - ')}`);
  }
}
console.log(`${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
