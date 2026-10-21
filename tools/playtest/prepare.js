// プレイテスト用の作業ディレクトリを作り、テスターへの指示文を出力する。
//   node tools/playtest/prepare.js <周回名> <テスター名> <腕前 expert|mid|novice> <シナリオ,...> [最大コマンド数] [シード]
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PERSONAS = {
  expert: '経験豊富なストラテジー・経済シミュレーションのゲーマー。説明をきちんと読み、数字を計算して効率を追求する。最短でのクリアと最高ランクを狙い、ルールの抜け道や必勝法がないかも探す。',
  mid: 'ゲームはそこそこ遊ぶが、経済シミュレーションは得意ではない普通のプレイヤー。説明はざっと読む。細かい計算はあまりせず、気になったことを試しながら楽しんで遊ぶ。',
  novice: 'このジャンルは初めての初心者。説明は最初に少し読むだけで、あとは直感で動く。数字の細かい比較はほとんどせず、ときどき手順を間違えたり、同じことを繰り返したりする。分からないときは適当に試す。',
};

const [round, tester, tier, scenarios = 's1,s2', max = '120', seed = '7'] = process.argv.slice(2);
if (!round || !tester || !(PERSONAS[tier] || tier === 'adversary')) {
  console.error('usage: prepare.js <round> <tester> <expert|mid|novice|adversary> [scenarios] [max] [seed]');
  process.exit(1);
}
const dir = resolve('playtests/raw', round, tester);
if (existsSync(dir)) rmSync(dir, { recursive: true });
mkdirSync(join(dir, 'game'), { recursive: true });
for (const p of ['cli', 'src', 'package.json']) cpSync(p, join(dir, 'game', p), { recursive: true });

// 敵対的評価（tier が adversary）: 仕様とソースを読ませ、壊し方を探させる
const adversary = tier === 'adversary';
if (adversary) {
  mkdirSync(join(dir, 'spec'), { recursive: true });
  mkdirSync(join(dir, 'scratch'), { recursive: true });
  for (const f of ['pillars.md', 'PLAN.md', 'PLAN-construction.md', 'balance-log.md']) cpSync(join('docs', f), join(dir, 'spec', f));
  cpSync('README.md', join(dir, 'spec', 'README.md'));
}
const prompt = readFileSync(adversary ? 'tools/playtest/adversarial.md' : 'tools/playtest/prompt.md', 'utf8')
  .replaceAll('{{PERSONA}}', PERSONAS[tier] || '')
  .replaceAll('{{DIR}}', dir.replace(/\\/g, '/'))
  .replaceAll('{{SCENARIOS}}', scenarios.split(',').map((s) => `\`${s}\``).join(' → '))
  .replaceAll('{{SCENARIO}}', '<id>')
  .replaceAll('{{SEED}}', seed)
  .replaceAll('{{MAX_COMMANDS}}', max)
  .replaceAll('{{TESTER}}', tester);
writeFileSync(join(dir, 'PROMPT.md'), prompt);
console.log(dir);
