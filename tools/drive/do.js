// 常駐サーバー（server.js）に指示を1つ送る。
//   node tools/drive/do.js open "play=s1" [--mobile] [--fresh 保存を消して] [--dir 出力先]
//   node tools/drive/do.js click 640 400        座標をクリック（スマホ幅ならタップ）
//   node tools/drive/do.js click "交易"          見えている文字で押す（--nth 1 で2つ目）
//   node tools/drive/do.js drag 600 400 300 400  ドラッグ（地図を動かす。コマ落ちも測る）
//   node tools/drive/do.js wheel 600 400 -300    ホイール（拡大縮小）
//   node tools/drive/do.js key Escape | type "文字" | wait 2000 | list | fps 3000 | console | quit
//   node tools/drive/do.js audio [ms]               ここ ms ミリ秒の音（鳴った効果音・音の大きさ・音割れ）
//   node tools/drive/do.js wav 60 [名前.wav]         最後の60秒（最大120）を WAV に書き出す
// どの指示も、あとで画面を1枚撮り、そのファイルを出力する（--noshot で撮らない、--name で名前）
const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '8131';
const flag = (k) => args.includes(k);
const val = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const pos = args.filter((a, i) => !a.startsWith('--') && !['--port', '--dir', '--name', '--nth', '--wait', '--ms'].includes(args[i - 1]));
const [cmd, ...rest] = pos;
const num = (s) => (s !== undefined && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : undefined);
const c = { cmd, shot: !flag('--noshot'), name: val('--name') };
if (val('--wait')) c.wait = Number(val('--wait'));
if (val('--ms')) c.ms = Number(val('--ms'));
switch (cmd) {
  case 'open': Object.assign(c, { hash: rest[0] || '', mobile: flag('--mobile'), dir: val('--dir'), fresh: flag('--fresh') }); break;
  case 'click': if (num(rest[0]) !== undefined) Object.assign(c, { x: num(rest[0]), y: num(rest[1]) }); else Object.assign(c, { text: rest[0], nth: Number(val('--nth') || 0) }); break;
  case 'drag': Object.assign(c, { x1: num(rest[0]), y1: num(rest[1]), x2: num(rest[2]), y2: num(rest[3]) }); break;
  case 'wheel': Object.assign(c, { x: num(rest[0]), y: num(rest[1]), dy: num(rest[2]) }); break;
  case 'key': c.key = rest[0]; break;
  case 'type': c.text = rest[0]; break;
  case 'wait': c.ms = num(rest[0]) || 1000; break;
  case 'eval': c.js = rest[0]; break;
  case 'fps': c.ms = num(rest[0]) || 3000; break;
  case 'audio': c.ms = num(rest[0]); break;
  case 'wav': Object.assign(c, { secs: num(rest[0]) || 60, file: rest[1] }); break;
  default: break;
}
const r = await (await fetch(`http://127.0.0.1:${port}`, { method: 'POST', body: JSON.stringify(c) })).json();
if (cmd === 'list' && r.ok) {
  for (const b of r.items) console.log(`(${b.x},${b.y}) ${b.w}x${b.h}${b.disabled ? ' [押せない]' : ''} ${b.tag} ${b.text}`);
} else console.log(JSON.stringify(r, null, 1));
