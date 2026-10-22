// 自己テストの結果を DOM ダンプから読む: node tools/selftest-check.js <URL>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const url = process.argv[2];
const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((b) => existsSync(b));
// 毎回まっさらな設定で開く（キャッシュに残った古いモジュールで動いていたことがある）
const profile = mkdtempSync(join(tmpdir(), 'toshoki-selftest-'));
const html = execFileSync(browser, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--virtual-time-budget=25000', '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
console.log(m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '自己テストの結果が見つからない');
