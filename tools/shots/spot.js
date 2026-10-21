// テストプレイ中の抜き打ち撮影: テスターのセーブ（CLI 版）を、ブラウザ版の画面で撮る
//   node tools/shots/spot.js <テストの作業フォルダ（playtests/raw/roundN）> [--every 分] [--port 8123]
// 前に撮ったときから進んだセーブだけを撮る。--every を付けると、その間隔で繰り返す（止めるまで）。
// 出力: tools/shots/out/spot/<テスター>-<シナリオ>-d<日>-<場面>.png と report.txt
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as G from '../../src/core/index.js';
import { shootAll } from './shoot.js';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const every = args.includes('--every') ? Number(args[args.indexOf('--every') + 1]) : 0;
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '8123';
const OUT = resolve('tools/shots/out/spot');
mkdirSync(OUT, { recursive: true });
const seen = new Map();

function saves() {
  const list = [];
  for (const tester of readdirSync(root, { withFileTypes: true })) {
    if (!tester.isDirectory()) continue;
    const dir = join(root, tester.name);
    for (const f of readdirSync(dir)) if (/^save-.*\.json$/.test(f)) list.push({ tester: tester.name, path: join(dir, f) });
  }
  return list;
}

async function round() {
  const jobs = [];
  for (const sv of saves()) {
    let world;
    try { world = G.deserialize(readFileSync(sv.path, 'utf8')); } catch { continue; } // 書き込み途中なら次の回に
    const key = `${sv.tester}/${world.scenario.id}`;
    if (seen.get(key) === world.day) continue;
    seen.set(key, world.day);
    const tag = `${sv.tester}-${world.scenario.id}-d${world.day}`;
    const fx = `out/spot/${tag}.json`;
    writeFileSync(join(OUT, `${tag}.json`), G.serialize(world));
    const load = `load=tools/shots/${fx}`;
    // 場面: いつもの画面、全体、一番大きい町の寄り、その区画、スマホ幅
    const big = Object.values(world.cities).sort((a, b) => b.pop - a.pop)[0].id;
    const post = Object.values(world.cities).find((c) => c.founded)?.id;
    const scenes = [['play', load, 1440, 900], ['fit', `${load}&cam=fit`, 1440, 900], ['big', `${load}&cam=${big}@1.6`, 1440, 900], ['district', `${load}&city=${big}&open=district`, 1440, 900], ['phone', load, 390, 844]];
    if (post) scenes.push(['post', `${load}&cam=${post}@1.8&city=${post}&open=city`, 1440, 900]);
    for (const [s, hash, w, h] of scenes) jobs.push({ name: `${tag}-${s}`, hash, w, h, port, out: join(OUT, `${tag}-${s}.png`) });
  }
  if (!jobs.length) return console.log(`${new Date().toLocaleTimeString()} 新しいセーブなし`);
  const results = await shootAll(jobs);
  const report = results.map((r) => `${r.ok ? 'OK ' : 'NG '} ${r.name}${r.errs.length ? `\n    ${r.errs.join('\n    ')}` : ''}`).join('\n');
  appendFileSync(join(OUT, 'report.txt'), `${report}\n`);
  console.log(report);
}

if (!root || !existsSync(root)) { console.log('使い方: node tools/shots/spot.js playtests/raw/roundN [--every 分]'); process.exit(1); }
await round();
if (every > 0) setInterval(round, every * 60000);
