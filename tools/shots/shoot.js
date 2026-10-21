// ヘッドレスの Chrome でゲームの画面を1枚撮る（run.js と spot.js から使う）
import { execFile } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((b) => existsSync(b));

// 幅 600 未満は、Chrome のウィンドウがそこまで狭くできないため、frame.html の iframe の中に開いて撮る
export function shoot({ name, hash, w, h, out, port = '8123' }) {
  const prof = join(tmpdir(), `toshoki-shot-${name}-${process.pid}`);
  const url = w < 600 ? `http://localhost:${port}/tools/shots/frame.html?w=${w}&h=${h}#${hash}` : `http://localhost:${port}/index.html?shot=${name}#${hash}`;
  return new Promise((done) => {
    execFile(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${prof}`, `--window-size=${Math.max(w, 600)},${h}`, `--virtual-time-budget=${process.env.VT || 5000}`, '--enable-logging=stderr', '--v=0', `--screenshot=${out}`, url], { timeout: 60000 }, (err, stdout, stderr) => {
      const errs = String(stderr || '').split('\n').filter((l) => /CONSOLE|Uncaught/i.test(l) && !/AudioContext/.test(l)).map((l) => l.replace(/^.*?(CONSOLE|Uncaught)/, '$1').slice(0, 300));
      try { rmSync(prof, { recursive: true, force: true }); } catch { /* 消せなくてもよい */ }
      done({ name, ok: existsSync(out), errs });
    });
  });
}

// 4枚ずつ並べて撮る
export async function shootAll(list) {
  const results = [];
  for (let i = 0; i < list.length; i += 4) results.push(...(await Promise.all(list.slice(i, i + 4).map(shoot))));
  return results;
}
