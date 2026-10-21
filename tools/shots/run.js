// 画面をまとめて撮る。開発用サーバー（npm run serve）を起動してから使う。
//   node tools/shots/run.js [名前の一部...] [--port 8123]
// 途中の状態は先に node tools/shots/fixtures.js で作っておく
// 出力: tools/shots/out/<名前>.png と、コンソールのエラーの一覧 report.txt
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { shootAll } from './shoot.js';

const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '8123';
const filters = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');
const OUT = resolve('tools/shots/out');
mkdirSync(OUT, { recursive: true });

const F = (n) => `load=tools/shots/out/fixtures/${n}.json`;
// [名前, ハッシュ, 幅, 高さ]
const DESK = [1440, 900];
const PHONE = [390, 844];
export const SCENES = [
  ['title', '', ...DESK],
  ['heirloom', 'play=s3&unlockall', ...DESK],
  ['s1-start', 'play=s1', ...DESK],
  ['s1-fit', 'play=s1&cam=fit', ...DESK],
  ['s1-trade', 'play=s1&open=trade', ...DESK],
  ['s1-depart', 'play=s1&open=depart', ...DESK],
  ['s1-help', 'play=s1&open=help', ...DESK],
  ['s1-settings', 'play=s1&open=settings', ...DESK],
  ['s3-order', 'play=s3&open=order', ...DESK],
  ['s3-city', 'play=s3&open=city', ...DESK],
  ['s3-district', 'play=s3&open=district', ...DESK],
  ['s3-civics', 'play=s3&open=district&civics', ...DESK],
  ['s8-found', 'play=s8&open=found', ...DESK],
  ['free-post-panel', `${F('free-post')}&city=post1&open=city&cam=post1@1.4`, ...DESK],
  ['s5-rush-close', `${F('s5-rush')}&cam=fit`.replace('cam=fit', 'cam=saito@1.8'), ...DESK],
  ['s8-post-built', 'play=s8&open=built', ...DESK],
  ['s7-tech', 'play=s7&open=tech', ...DESK],
  ['s2-hire', 'play=s2&open=hire', ...DESK],
  ['result', 'play=s1&open=result', ...DESK],
  ['s2-mid', F('s2-mid'), ...DESK],
  ['s2-mid-ledger', `${F('s2-mid')}&open=ledger`, ...DESK],
  ['s4-mid', F('s4-mid'), ...DESK],
  ['s4-mid-fit', `${F('s4-mid')}&cam=fit`, ...DESK],
  ['s5-rush', F('s5-rush'), ...DESK],
  ['s5-rush-fit', `${F('s5-rush')}&cam=fit`, ...DESK],
  ['s6-mid', F('s6-mid'), ...DESK],
  ['s6-mid-fit', `${F('s6-mid')}&cam=fit`, ...DESK],
  ['s7-mid', F('s7-mid'), ...DESK],
  ['s8-built', `${F('s8-built')}&cam=kohaku@1.6`, ...DESK],
  ['s8-built-far', `${F('s8-built')}&cam=kohaku@0.6`, ...DESK],
  ['s8-built-close', `${F('s8-built')}&cam=kohaku@2.6`, ...DESK],
  ['s8-district', `${F('s8-built')}&city=kohaku&open=district`, ...DESK],
  ['s8-fit', `${F('s8-built')}&cam=fit`, ...DESK],
  ['s8-branch', `${F('s8-branch')}&cam=kohaku@1.4`, ...DESK],
  ['s8-branch-city', `${F('s8-branch')}&city=kohaku&open=city&cam=kohaku@1.4`, ...DESK],
  ['free-post', F('free-post'), ...DESK],
  ['free-post-fit', `${F('free-post')}&cam=fit`, ...DESK],
  ['m-title', '', ...PHONE],
  ['m-s1-start', 'play=s1', ...PHONE],
  ['m-s1-trade', 'play=s1&open=trade', ...PHONE],
  ['m-s3-district', 'play=s3&open=district', ...PHONE],
  ['m-s3-order', 'play=s3&open=order', ...PHONE],
  ['m-s8-built', `${F('s8-built')}&cam=kohaku@1.2`, ...PHONE],
];

const list = SCENES.filter((s) => !filters.length || filters.some((f) => s[0].includes(f)));
const results = await shootAll(list.map(([name, hash, w, h]) => ({ name, hash, w, h, port, out: join(OUT, `${name}.png`) })));
const report = results.map((r) => `${r.ok ? 'OK ' : 'NG '} ${r.name}${r.errs.length ? `\n    ${r.errs.join('\n    ')}` : ''}`).join('\n');
writeFileSync(join(OUT, 'report.txt'), report);
console.log(report);
