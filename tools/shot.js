// ヘッドレスのブラウザで画面を撮る（開発用）。コンソールのエラーも表示する。
//   node tools/shot.js <URL> <出力PNG> [幅] [高さ]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [url, out = 'shot.png', w = '1440', hgt = '900'] = process.argv.slice(2);
const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((b) => existsSync(b));
let log = '';
try {
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${hgt}`, `--virtual-time-budget=${process.env.VT || 4000}`, '--enable-logging=stderr', '--v=0', `--screenshot=${resolve(out)}`, url], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  log = String(e.stderr || '');
}
const lines = (log || '').split('\n').filter((l) => /CONSOLE|Uncaught|Error/i.test(l));
console.log(lines.join('\n') || '(console errors none captured)');
console.log(resolve(out));
