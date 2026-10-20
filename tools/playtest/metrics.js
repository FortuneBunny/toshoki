// プレイテストのログ（save-*.json.log.jsonl）から数値を集計する。
//   node tools/playtest/metrics.js playtests/raw/<周回名>
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const rows = [];
for (const tester of readdirSync(root)) {
  const dir = join(root, tester);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.log.jsonl'))) {
    const lines = readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const scenario = lines.find((l) => l.cmd === 'new')?.scenario || f;
    const cmds = lines.filter((l) => l.cmd !== 'new');
    const errors = cmds.filter((l) => l.ok === false);
    const last = [...cmds].reverse().find((l) => l.ok);
    // 同じコマンドを3回以上続けて打った回数（迷いの目安）
    let repeats = 0;
    for (let i = 2; i < cmds.length; i++) {
      const k = (l) => `${l.cmd} ${(l.args || []).join(' ')}`;
      if (k(cmds[i]) === k(cmds[i - 1]) && k(cmds[i]) === k(cmds[i - 2]) && !['wait', 'travel'].includes(cmds[i].cmd)) repeats++;
    }
    const count = (c) => cmds.filter((l) => l.cmd === c).length;
    rows.push({
      tester, scenario, commands: cmds.length, errors: errors.length, repeats,
      day: last?.day ?? 0, silver: last?.silver ?? 0,
      result: last?.finished ? (last.finished.win ? `達成 ${last.finished.rank}` : '期限切れ') : '途中',
      trade: count('trade'), quote: count('quote'), travel: count('travel'), prices: count('prices'), order: count('order'),
      report: existsSync(join(dir, 'report.md')) ? 'あり' : 'なし',
    });
  }
}
console.table(rows);
