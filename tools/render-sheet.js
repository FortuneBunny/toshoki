// SVG素材の一覧を、暗い背景と砂色の背景の両方に並べて PNG に撮る。
// node tools/render-sheet.js <svgディレクトリ> <出力PNG>
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const [dir = 'assets/svg/goods', out = 'sheet.png'] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith('.svg')).sort();

const cell = (f, bg) => {
  const svg = readFileSync(join(dir, f), 'utf8').replace(/<\?xml[^>]*>/, '');
  return `<figure style="background:${bg}"><div class="img">${svg}</div><figcaption>${basename(f, '.svg')}</figcaption></figure>`;
};
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#888;font:12px sans-serif}
.row{display:flex;flex-wrap:wrap;gap:4px;padding:4px}
figure{margin:0;width:140px;padding:6px;box-sizing:border-box;text-align:center}
.img svg{width:128px;height:128px;display:block}
figcaption{color:#888;margin-top:2px}
</style>
<div class="row">${files.map((f) => cell(f, '#1c1712')).join('')}</div>
<div class="row">${files.map((f) => cell(f, '#e9d3a3')).join('')}</div>`;

const work = mkdtempSync(join(tmpdir(), 'sheet-'));
const htmlPath = join(work, 'sheet.html');
writeFileSync(htmlPath, html);

const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const browser = browsers.find((b) => existsSync(b));
if (!browser) throw new Error('Chrome/Edge が見つからない');
const perRow = 9;
const rows = Math.ceil(files.length / perRow) * 2;
const height = rows * 165 + 20;
execFileSync(browser, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--window-size=${perRow * 144 + 8},${height}`,
  `--screenshot=${resolve(out)}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`,
], { stdio: 'ignore' });
console.log(`${files.length} files -> ${resolve(out)}`);
