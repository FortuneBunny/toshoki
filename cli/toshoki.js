#!/usr/bin/env node
// 糖商記 CLI版。1回の実行で1コマンド、状態はセーブファイルに残す。
//   node cli/toshoki.js new --scenario s2 --seed 42 --save run.json
//   node cli/toshoki.js --save run.json status
// 引数なしで起動すると対話モード（REPL）になる。
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import * as G from '../src/core/index.js';
import { RULES } from '../src/data/help.js';

const { GOODS, TRANSPORTS, BUILDINGS, SCENARIOS, SCENARIO_ORDER, HEIRLOOMS } = G;
const heirloomList = () => Object.entries(HEIRLOOMS).map(([k, x]) => `  ${k}: ${G.heirloomText(k)}（${SCENARIOS[x.unlock].no}. ${SCENARIOS[x.unlock].title} を達成で解放）`).join('\n');

// ---------- 表示の道具 ----------
const width = (s) => [...String(s)].reduce((w, ch) => w + (/[ᄀ-￿]/.test(ch) && !/[｡-ﾟ]/.test(ch) ? 2 : 1), 0);
const pad = (s, n, right = false) => {
  s = String(s);
  const fill = ' '.repeat(Math.max(0, n - width(s)));
  return right ? fill + s : s + fill;
};
function table(headers, rows, rightCols = []) {
  const all = [headers, ...rows];
  const ws = headers.map((_, i) => Math.max(...all.map((r) => width(r[i] ?? ''))));
  const line = (r) => r.map((c, i) => pad(c ?? '', ws[i], rightCols.includes(i))).join('  ');
  return [line(headers), ws.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}
const fmt = (n, d = 1) => (n === undefined || n === null || Number.isNaN(n) ? '-' : Number(n).toFixed(d));
const silver = (n) => `${Math.floor(n)} 銀`;
const gname = (id) => `${GOODS[id].name}(${id})`;

// 定期便の売却はまとめて1行にする（大事な通知が埋もれないように）
function compactEvents(events) {
  const autos = events.filter((e) => (e.type === 'profit' || e.type === 'loss') && e.auto);
  const rest = events.filter((e) => !autos.includes(e) && e.type !== 'orderNote' && !e.quiet);
  const out = rest.map(eventLine);
  if (autos.length) {
    const sum = autos.reduce((acc, e) => acc + e.amount, 0);
    out.push(`💰 定期便: 売却${autos.length}回、損益合計 ${sum >= 0 ? '+' : ''}${Math.round(sum)} 銀`);
  }
  const notes = events.filter((e) => e.type === 'orderNote');
  if (notes.length) out.push(`・ 定期便の見送り ${notes.length}件（最新: ${notes[notes.length - 1].text}）${notes.some((n) => /上限/.test(n.text)) ? '。買値の上限を上げるなら order edit <停泊地の番号> "..." -m <番号>' : ''}`);
  return out;
}

function eventLine(e) {
  const mark = e.type === 'victory' ? '🏆' : e.type === 'hit' ? '🎯' : e.type === 'profit' ? '💰' : e.type === 'rush' ? '🍬' : e.type === 'tierUp' ? '🎉'
    : e.type === 'contract' || e.type === 'contractDone' ? '📜' : e.type === 'rumor' || e.news ? '👂' : e.bad ? '✖' : e.big ? '★' : '・';
  return `${mark} [${e.day}日] ${e.text}`;
}

// ---------- 引数 ----------
function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--nowait') opts.nowait = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--hold') opts.hold = true;
    else if (a === '--fire') opts.fire = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else if (a === '-m') opts.merchant = argv[++i];
    else pos.push(a);
  }
  return { opts, pos };
}

// 住居の求める品: 町が育つほど増える。1つ欠けまでそろっていないと家が建たない
function dwellingLine(world, c) {
  const tier = G.cityTier(c);
  const st = G.dwellingStatus(c, tier);
  const all = (c.dwellWants || []).map((g) => GOODS[g].name).join('・') || 'なし';
  if (!(c.dwellWants || []).length) return '住居の求める品: なし（このシナリオで手に入る品の中に、この町の住居が求めるものはない）';
  if (!st.wants.length) return `住居の求める品: まだない（育つと ${all} を求める）`;
  // 1日に使う量と、今の在庫で何日もつか
  const list = st.wants.map((g) => { const d = G.dailyDemand(c, g, false); const days = d > 0 ? Math.floor((c.stock[g] || 0) / d) : 0; const src = Object.values(world.cities).filter((x) => x.id !== c.id && (x.produces?.[g] || 0) > 0.3).map((x) => x.name); return `${GOODS[g].name}${st.met.includes(g) ? '○' : '×'}（1日約${fmt(d, 1)}個、在庫${days}日分${src.length ? `、産地: ${src.join('・')}` : '、工房で作る品'}）`; }).join(' ');
  const rule = st.wants.length === 1 ? '今求めるのは1つだけ。届かなくても家は建つ' : `今求めるのは${st.wants.length}つ。そのうち${st.wants.length - 1}つ以上そろえば家がどんどん建つ`;
  return `住居の求める品（${rule}。住民が毎日使うので、在庫が切れると×に戻る。届けてから数日かけて○になる）: ${list}  → ${st.ok ? '家は建つ' : '⚠ 家がゆっくりしか建たない（5日に1軒）'}${(c.dwellWants || []).length > st.wants.length ? `（育つと ${all} を求める）` : ''}`;
}

// ラッシュまでの目安: 糖度140以上と、その日の甘味の摂取（必要量に対する割合）70%以上の両方
// まとめて届ける量の目安も出す（白糖7個が数日で切れ、摂取69%で止まった。31回目の Gemini）
function rushGap(glucose, sweet, plan = null, line = 140, city = null) {
  if (glucose === undefined) return 'ラッシュの目安は町を見ないと分からない';
  // ラッシュ中・クラッシュ中は、条件がそろっていても起きない（34回目の Sol: 「明日にもラッシュ」と出た）
  if (city?.rush > 0) return `ラッシュ中（あと${city.rush}日）`;
  if (city?.crash > 0) return `クラッシュ中（あと${city.crash}日）。終わるまで次のラッシュは起きない`;
  const g = Math.round(glucose);
  const s = Math.round(sweet * 100);
  const need = [];
  // 火入れ: 熟す目安と、火を入れる量（35回目の Sol: 線を越えれば起きる古い案内と、熟す目安が並んでいた）
  if (G.BALANCE.rushIgnite) {
    if (city?.ignite != null) return '火が入った（明日ラッシュが始まる）';
    const rl = line - G.BALANCE.rushRipeGap, rs = Math.round(G.BALANCE.rushRipeSweet * 100);
    if (g < rl) need.push(`糖度をあと${rl - g}（今${g}。食べ物を何種類も届ける）`);
    if (s < rs) need.push(`甘味の摂取をあと${rs - s}%（今${s}%）`);
    if (need.length) return `熟すまで ${need.join('、')}。熟したら、火を入れて売る（trade ... --fire）と翌日にラッシュ（ふつうに売っても起きない）`;
    const kinds = G.BALANCE.rushIgniteKinds ?? 2;
    const sw = city ? Object.keys(city.stock).filter((k) => GOODS[k]?.kind === 'sweet') : [];
    return `🔥熟している。甘味をまとめて火を入れて売ると（trade ... --fire）火が入る${city ? `（${sw.length ? sw.slice(0, 3).map((k) => `${GOODS[k].name}なら${G.igniteNeed(city, k)}個`).join('・') : '町の画面の個数'}）` : ''}${kinds > 1 ? `。そのとき町に甘味が${kinds}種類以上要る` : ''}`;
  }
  if (g < line) need.push(`糖度をあと${line - g}（今${g}。食べ物を何種類も届ける）`);
  if (s < G.BALANCE.rushSweetLine * 100) need.push(`甘味の摂取をあと${Math.round(G.BALANCE.rushSweetLine * 100) - s}%（今${s}%＝今日の甘味の必要量のうち食べた割合。甘味を2種類以上まとめて届ける${plan?.length ? `。目安は ${plan.slice(0, 2).map((p) => `${GOODS[p.good].name} 1日約${Math.ceil(p.perDay)}個（20日ごとの便なら1回に約${Math.ceil(p.perDay * 20)}個。まとめて届けて火をつけるなら、ラッシュまでの約1週間もつ${Math.ceil(p.perDay * 7)}個以上）`).join(' ＋ ')}。届けた日だけでなく、毎日切らさないこと（ほかの甘味でもよい）` : ''}）`);
  return need.length ? `ラッシュまで ${need.join('、')}` : '条件はそろっている（明日にもラッシュ）';
}

// 今いる町: --at、または商人のいる町が1つならそこ
function hereCity(world, opts) {
  if (opts.at) return opts.at;
  if (opts.merchant) return pickMerchant(world, opts).city;
  const cs = [...new Set(world.player.merchants.filter((m) => !m.travel).map((m) => m.city))];
  if (cs.length === 1) return cs[0];
  return pickMerchant(world, opts).city;
}
// 品物は日本語の名前でもよい（キビ → millet）
function goodArg(g) {
  if (!g || GOODS[g]) return g;
  return Object.keys(GOODS).find((id) => GOODS[id].name === g) || g;
}
// 日本語の町の名前を id に
function cityArg(world, s) {
  if (!s || world.cities[s]) return s;
  const c = Object.values(world.cities).find((x) => x.name === s);
  return c ? c.id : s;
}

const WORLD_CH = ['.', '"', ':', 'n', '^', '~'];
function lookText(world, cx, cy, r = 12) {
  const g = world.grid;
  const rows = [`■ ${cx},${cy} のまわり（. 平地  " 肥えた土地  : 砂地  n 丘  ^ 山  ~ 水  - 小道  = 街道  ! 危険  @ 町${world.scenario.pioneer ? '  h 集落  w 古い建物  H 一族の館' : ''}）`];
  const names = [];
  for (let y = cy - r; y <= cy + r; y++) {
    let line = '';
    for (let x = cx - r * 2; x <= cx + r * 2; x++) {
      if (x < 0 || y < 0 || x >= G.GRID_W || y >= G.GRID_H) { line += ' '; continue; }
      const k = G.gridKey(x, y);
      const id = g.cityAt.get(k);
      if (id) { line += '@'; names.push(`@(${x},${y}) ${world.cities[id].name}(${id})`); continue; }
      const hm = (world.hamlets || []).find((o) => !o.absorbedBy && o.x === x && o.y === y);
      if (hm) { line += 'h'; names.push(`h(${x},${y}) ${hm.name}`); continue; }
      const wd = (world.wilds || []).find((o) => !o.absorbedBy && o.x === x && o.y === y);
      if (wd) { line += 'w'; names.push(`w(${x},${y}) ${G.CIVICS[wd.type].name}`); continue; }
      if (world.player.hq && world.player.hq[0] === x && world.player.hq[1] === y) { line += 'H'; names.push(`H(${x},${y}) 一族の館`); continue; }
      if (world.player.merchants.some((m) => { const [px, py] = m.travel ? [m.travel.tiles[m.travel.i][0], m.travel.tiles[m.travel.i][1]] : g.cityTiles[m.city]; return px === x && py === y; })) { line += 'M'; continue; }
      line += g.path[k] === 2 ? '=' : g.path[k] === 1 ? (g.danger[k] ? '!' : '-') : WORLD_CH[g.terrain[k]];
    }
    rows.push(line);
  }
  if (names.length) rows.push(names.join('  '));
  return rows.join('\n');
}
function overviewText(world) {
  const g = world.grid;
  const rows = [`■ 世界の地図（縦4×横2マスを1文字。英字は町、. 平地、" 肥えた土地、: 砂、n 丘、^ 山、~ 水、= 道${world.scenario.pioneer ? '、h 集落、w 古い建物、H 一族の館（wild で一覧）' : ''}）`];
  const letters = {};
  Object.keys(world.cities).forEach((id, i) => { letters[id] = String.fromCharCode(65 + i); });
  for (let y = 0; y < G.GRID_H; y += 4) {
    let line = '';
    for (let x = 0; x < G.GRID_W; x += 2) {
      let ch = null;
      const cnt = [0, 0, 0, 0, 0, 0];
      let road = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        const k = G.gridKey(x + dx, y + dy);
        const id = g.cityAt.get(k);
        if (id) ch = letters[id];
        else if (!ch && (world.hamlets || []).some((o) => !o.absorbedBy && o.x === x + dx && o.y === y + dy)) ch = 'h';
        else if (!ch && (world.wilds || []).some((o) => !o.absorbedBy && o.x === x + dx && o.y === y + dy)) ch = 'w';
        else if (!ch && world.player.hq && world.player.hq[0] === x + dx && world.player.hq[1] === y + dy) ch = 'H';
        cnt[g.terrain[k]]++;
        if (g.path[k]) road++;
      }
      if (!ch) ch = road ? '=' : WORLD_CH[cnt.indexOf(Math.max(...cnt))];
      line += ch;
    }
    rows.push(line);
  }
  rows.push(Object.entries(letters).map(([id, l]) => `${l}=${world.cities[id].name}(${id})`).join('  '));
  return rows.join('\n');
}

function pickMerchant(world, opts) {
  const ms = world.player.merchants;
  if (opts.merchant) {
    const m = G.getMerchant(world, opts.merchant);
    if (!m) throw new Error(`商人 ${opts.merchant} はいない（merchants で一覧）`);
    return m;
  }
  if (ms.length === 1) return ms[0];
  const idle = ms.filter((m) => !m.travel);
  if (idle.length === 1) return idle[0];
  throw new Error(`商人が複数いるので -m <番号> で指定する（${ms.map((m) => `-m ${m.id}=${m.name}・${m.travel ? `移動中→${world.cities[m.travel.to].name}` : world.cities[m.city].name}${m.order ? '・定期便' : ''}`).join('、')}）`);
}

// ---------- 画面 ----------
function statusText(world) {
  const pl = world.player;
  const out = [];
  out.push(`■ ${world.scenario.no}. ${world.scenario.title}   ${G.dateString(world.day)}（${world.day}日目 / 期限 ${world.scenario.deadline}日）`);
  if (pl.heirloom) out.push(`家訓: ${G.heirloomText(pl.heirloom)}`);
  out.push(`銀 ${Math.floor(pl.silver)}   資産 ${Math.floor(G.netWorth(world))}（銀＋積荷と倉庫の品はその町で売った値の8割（積荷は移動中なら行き先）＋輸送手段・工房・商館×半額。区画の施設・道・交易所・技術・寄進は入らない）   評判 Lv${pl.repLevel}（${pl.rep}）   連続黒字 ${pl.streak}`);
  if (world.scenario.goods.some((id) => ['sea', 'river'].length) && world.edges.some((e) => e.monsoon)) out.push(`季節: ${G.SEASON_NAMES[G.seasonOf(world)]}（切り替わるまで あと${180 - (world.day % 180)}日。夏は東へ、冬は西へ追い風）`);
  const sc = world.scenario;
  out.push(`ランクの基準: S=${Math.floor(sc.deadline * (sc.rankS ?? 0.55))}日以内 / A=${Math.floor(sc.deadline * 0.75)}日以内 / B=期限内`);
  out.push(`このシナリオ: 輸送手段 ${world.allowedTransports.map((t) => TRANSPORTS[t].name).join('・')} / 商人は最大${G.merchantCap(world)}人${G.branchesAllowed(world) ? '（商館で1人ずつ増やせる）' : ''} / 工房 ${(sc.buildings || []).filter((b) => BUILDINGS[b]?.recipes).map((b) => BUILDINGS[b].name).join('・') || 'なし'}${(sc.buildings || []).includes('road') ? ' / 道の整備あり' : ''}（費用は shop）`);
  out.push(`使える建設: 区画の施設 ${G.districtEnabled(world) ? 'あり' : 'なし'} / 道を敷く ${G.pathsAllowed(world) ? `${G.pathsAllowed(world)}本まで` : 'なし'} / 交易所 ${G.postsAllowed(world) ? `${G.postsAllowed(world)}つまで` : 'なし'} / 技術 ${G.techList(world).length ? G.techList(world).map((t) => t.name).join('・') : 'なし'}`);
  // 町のないシナリオで、まだ始めていない
  if (world.setup) {
    out.push(`★ まだ始まっていない（時間は進まない）。${G.setupStage(world) === 'family' ? `まず一族を選ぶ: families で一覧 → family <id>（${G.familyList(world).map((f) => `${f.id}=${f.name}`).join('・')}）` : '一族の館の近くに最初の交易所を置く（無料）: sites で候補 → found <x,y> confirm。集落を圏に入れられる場所でないと置けない。置くと商人が館から出てくる'}`);
  }
  if (sc.pioneer) out.push(`町のない土地: まだ交易所の圏にない集落 ${G.wildernessList(world).hamlets.length}・古い建物 ${G.wildernessList(world).wilds.length}（wild で一覧。交易所を開くか、市場に格上げして圏に入れる）`);
  out.push('目標（全部が同時にそろった時に達成。銀・資産・町の人口や段階は、一度届いても下回ると戻る）:');
  G.goalsStatus(world).forEach((g, i) => {
    out.push(`  ${g.done ? '✔' : '□'} ${g.text}  [${'█'.repeat(Math.round(g.p * 10))}${'░'.repeat(10 - Math.round(g.p * 10))}] ${Math.round(g.p * 100)}%`);
    const def = sc.goals[i];
    if (!g.done && ['cityTier', 'cityPop', 'rushes'].includes(def.type)) {
      const c = world.cities[def.city];
      const k = world.player.knowledge[c.id];
      const here = world.player.merchants.some((m) => m.city === c.id) || G.isVisited(world, c.id) || c.founded;
      const adv = here ? G.dietAdvice(world, c).slice(0, 3) : [];
      out.push(`      ${c.name}: 糖度 ${here ? Math.round(c.glucose) : k?.glucose !== undefined ? `${Math.round(k.glucose)}（${world.day - k.day}日前）` : '?'}${def.type === 'rushes' ? `、${rushGap(here ? c.glucose : k?.glucose, (here ? c.sweetLevel : k?.sweetLevel) || 0, G.rushSweetPlan(world, c), G.rushLineOf(world), here ? c : null)}` : ''}${here ? (() => { const why = G.growthBlocker(world, c); return why ? `。⚠ ${why}` : ''; })() : k?.blocker ? `。⚠ ${world.day - k.day}日前に見たとき: ${k.blocker}` : ''}${adv.length ? `。続けて届けると伸びる: ${adv.map((a) => `${GOODS[a.good].name} 約${fmt(a.perDay, 1)}個/日で+${a.gain}（20日ごとの便なら1回に約${Math.ceil(a.perDay * 20)}個）`).join('、')}` : here ? '' : '（詳しくは商人を送って city で）'}`);
    }
  });
  // 町を育てる次の一手（画面と同じ。画面だけのテスト4回目）
  for (const x of G.goalHints(world)) if (x.plan) out.push(`  💡 ${world.cities[x.city].name}: ${x.plan}`);
  out.push('商人:');
  // 定期便が直近10日に買値の上限で見送った品
  const skipped = (world.log || []).filter((e) => e.type === 'orderNote' && world.day - e.day <= 10 && /上限/.test(e.text));
  if (skipped.length) out.push(`⚠ 定期便が買値の上限で仕入れを見送っている（直近: ${skipped[skipped.length - 1].text}）。上げるなら order edit`);
  // 毎日の出費と、今の銀で何日もつか
  const daily = G.dailyCost(world, { guards: true });
  if (daily > 0) out.push(`毎日の出費 ${fmt(daily, 1)}銀（給金・維持費・工房・護衛代。工房の材料費は別）${pl.silver < daily * 20 ? `  ⚠ 売らずにいると約${Math.max(0, Math.floor(pl.silver / daily))}日で銀が尽きる` : ''}`);
  // 工房の自動仕入れが止まりそうなら、先に知らせる
  const ab = pl.buildings.filter((b) => b.active && b.autoBuy);
  if (ab.length && pl.silver < G.BALANCE.autoBuyReserve * 2) out.push(`⚠ 手元の銀 ${Math.floor(pl.silver)}。${G.BALANCE.autoBuyReserve}銀を切ると工房の自動仕入れが止まる（倉庫の製品を売って銀に戻そう）`);
  for (const m of pl.merchants) out.push('  ' + merchantLine(world, m));
  // 予告された売り場の交代（詳しくは shifts）
  for (const x of G.knownMarkets(world)) out.push(`⚓ 港の市の予告#${x.id}: ${world.cities[x.city].name}の${GOODS[x.good].name} ${G.marketStateText(world, x)}。${G.marketShipText(world)}${GOODS[x.good].name}は上限なしで高値`);
  for (const x of G.knownGangs(world)) out.push(`🗡 強盗団の予告#${x.id}: ${G.gangZone(world, x).name} ${G.gangStateText(world, x)}。護衛では防げない`);
  for (const x of G.knownFestivals(world)) out.push(`🎆 大祭の予告#${x.id}: ${world.cities[x.city].name}で大祭 ${G.festivalStateText(world, x)}。${G.festivalCountText(world, x.city) || 'この間に始まったラッシュは祝いが大きい'}`);
  for (const x of G.knownBlights(world)) out.push(`🌾 不作の予告#${x.id}: ${GOODS[x.good].name}が不作 ${G.blightStateText(world, x)}。どの産地も作る量が約${Math.round(world.scenario.blights.cut * 10)}割に`);
  for (const x of G.knownShifts(world)) out.push(`📣 予告#${x.id}: ${world.cities[x.low].name}で${GOODS[x.good].name}が安い ${G.lowStateText(world, x)} / ${world.cities[x.fair].name}の隊商市 ${G.fairStateText(world, x)}。臨時の便の期間の目安は shifts`);
  // 町にいて定期便のない商人には、次の一手の例を1つ（詳しくは advice）
  for (const m of pl.merchants) if (!m.travel && !m.order && world.day < 120) out.push(`  💡 #${m.id} 次の一手の例: ${G.adviceText(world, m.id)[0]}（ほかの案は advice）`);
  // 銀が眠っていれば、目標に効く使い方を
  const sa = G.silverAdvice(world);
  if (sa.length) { out.push(`💰 銀が余っている（${Math.floor(pl.silver)}）。使い道の例:`); for (const a of sa) out.push(`  ・${a.text}`); }
  const stalled = world.player.buildings.filter((b) => b.active && !b.lastMade && world.day > 0);
  for (const b of stalled) {
    // 止まっている間に倉庫にたまった材料（定期便が下ろし続けると気づきにくいため）
    const wh = world.player.warehouses[b.city]?.stock || {};
    const piled = G.buildingInputs(b.type).filter((g) => (wh[g] || 0) >= 20).map((g) => `${GOODS[g].name}${Math.floor(wh[g])}`);
    out.push(`⚠ ${world.cities[b.city].name}の${BUILDINGS[b.type].name}が止まっている: ${b.why || '材料がない'}${piled.length ? `。倉庫で眠っている材料: ${piled.join('・')}` : ''}（workshops で詳細）`);
  }
  const active = world.contracts.filter((c) => !c.done && !c.failed);
  if (active.length) {
    out.push('大口注文:');
    for (const c of active) {
      // 一番早く着ける商人（町にいる者）から、期限に間に合うかの目安
      let best = null;
      for (const m of world.player.merchants) { if (m.travel) continue; const r = m.city === c.city ? { days: 0 } : G.routeInfo(world, m.id, c.city); if (r && (!best || r.days < best.days)) best = { days: r.days, name: m.name }; }
      const left = c.deadline - world.day;
      const reach = best ? `。${best.name}なら約${best.days}日で着く${best.days > left ? '（間に合わない）' : ''}` : '';
      out.push(`  #${c.id} ${world.cities[c.city].name}(${c.city}) ${gname(c.good)} ${c.delivered}/${c.qty}  残り${left}日  報酬 ${c.reward}${reach}`);
    }
  }
  if (world.scenario.tutorial) {
    const next = world.scenario.tutorial.find((t) => !t.done(world));
    if (next) out.push(`手引き: ${typeof next.text === "function" ? next.text(world) : next.text}`);
  }
  if (world.finished) out.push(world.finished.win ? `🏆 達成！ランク ${world.finished.rank}（${world.finished.day}日目）` : `期限切れ（ランク C）`);
  return out.join('\n');
}

function merchantLine(world, m) {
  const t = TRANSPORTS[m.transport];
  const cargo = Object.entries(m.cargo).map(([id, q]) => `${GOODS[id].name}${q}`).join(' ') || '空';
  const where = m.travel
    ? `移動中 → ${world.cities[m.travel.to].name}（あと約${Math.max(1, Math.ceil(m.travel.totalDays - m.travel.elapsed))}日${m.guards ? `、護衛${m.guards}` : ''}${world.day < (m.travel.gangHeldUntil ?? -Infinity) ? `、強盗団に足止め中・${m.travel.gangHeldUntil}日目まで` : ''}${G.travelGangCrossings(world, m).length ? `。🗡 ${G.gangCrossText(world, G.travelGangCrossings(world, m))}` : ''}）`
    : `${world.cities[m.city].name}(${m.city})に滞在`;
  const order = (m.order ? (m.order.paused ? ' [定期便:停止中]' : m.order.altOn ? ` [臨時の便〜${m.order.alts.find((a) => a.id === m.order.altOn)?.until}日目]` : ' [定期便]') : '') + G.orderShiftWarnings(world, m).map((w) => w.covered ? ` [${w.text}]` : ` ⚠${w.text}`).join('') + (m.settlers ? ` [開拓団${m.settlers.n}人→${world.cities[m.settlers.to].name}]` : '');
  return `#${m.id} ${m.name}${m.talent ? `【${G.TALENTS[m.talent].name}】` : ''} ${t.name} ${G.cargoUsed(m)}/${G.cargoCap(m)}  ${where}${order}  積荷: ${cargo}  累計損益 ${Math.round(m.lifetime)}`;
}

function marketText(world, m) {
  const city = world.cities[m.city];
  const rows = [];
  for (const id of world.scenario.goods) {
    const wants = G.cityWants(city, id);
    const stock = Math.floor(city.stock[id] || 0);
    const have = m.cargo[id] || 0;
    const buy = stock > 0 ? G.unitBuy(world, city, id) : null;
    const sell = wants ? G.unitSell(world, city, id) : null;
    const hist = world.player.knowledge[city.id]?.history?.[id] || [];
    const trend = hist.length >= 2 ? spark(hist.map((h) => h[1])) : '';
    let all = '';
    if (have && wants) {
      const total = G.sellValue(world, m, city, id, Math.min(have, G.fairRoom(world, city, id), G.portRoom(world, m, city, id)));
      const pl = total - (m.cost[id] || 0) * have;
      all = `${Math.round(total)}（${pl >= 0 ? '+' : ''}${Math.round(pl)}）`;
    }
    rows.push([gname(id), have ? `${have}${m.cost[id] ? `(@${fmt(m.cost[id])})` : ''}` : '', sell ? fmt(sell) : '買取なし', all, buy ? fmt(buy) : '在庫なし', stock, fmt(G.dailyDemand(city, id), 1), fmt(GOODS[id].base, 0), trend]);
  }
  const t = TRANSPORTS[m.transport];
  return [
    `■ ${city.name}の市場（${G.tierName(G.cityTier(city))}、人口 ${Math.floor(city.pop)}、糖度 ${Math.round(city.glucose)}${city.rush ? '、🍬ラッシュ中' : ''}${city.crash ? '、💥クラッシュ中' : ''}）  ${m.name} 積載 ${G.cargoUsed(m)}/${G.cargoCap(m)}  銀 ${Math.floor(world.player.silver)}`,
    table(['品物', '積荷(仕入値)', '売値(あなたが売る)', '全部売ると(損益)', '買値(あなたが買う)', '町の在庫', '1日の消費', '基準', '相場の推移'], rows, [2, 3, 4, 5, 6, 7]),
    '※ 売値・買値は1個目の値段。たくさん売るほど売値は下がり、たくさん買うほど買値は上がる。買うときの合計は quote で確認できる。',
  ].join('\n');
}

const SPARK = '▁▂▃▄▅▆▇█';
function spark(vals) {
  const v = vals.slice(-12);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return v.map((x) => SPARK[hi - lo < 1e-9 ? 3 : Math.round(((x - lo) / (hi - lo)) * 7)]).join('');
}

function pricesText(world) {
  const ids = world.scenario.goods;
  const rows = Object.values(world.cities).map((c) => {
    const k = world.player.knowledge[c.id];
    const age = G.knowledgeAge(world, c.id);
    const cells = ids.map((id) => {
      let p = k?.prices?.[id];
      if (p === undefined) return '?';
      const ageThis = k.priceDay?.[id] !== undefined && (k.day < 0 || k.priceDay[id] > k.day) ? world.day - k.priceDay[id] : null;
      return `${fmt(p)}${k.wants && k.wants[id] === false ? '×' : ''}${ageThis !== null ? '(噂)' : ''}`;
    });
    const ageText = age === null ? '未訪問' : age === 0 ? '今' : '噂';
    return [`${c.name}(${c.id})`, ageText, ...cells];
  });
  return [
    '■ 知っている相場（中値。手数料抜き。×=その町では買い取らない）',
    table(['町', '情報', ...ids.map((id) => GOODS[id].name)], rows, ids.map((_, i) => i + 2)),
    '※ 一度訪れた町は、いつでも今の相場が分かる（未訪問の町は噂で聞いた値だけ）。読むのは、着くまでに町がどう変わるか（town で糖度の流れを見る）。',
    `作っている町（産地）: ${ids.filter((g) => Object.values(world.cities).some((c) => (c.produces?.[g] || 0) > 0.3)).map((g) => `${GOODS[g].name}=${Object.values(world.cities).filter((c) => (c.produces?.[g] || 0) > 0.3).map((c) => c.name).join('・')}`).join('  ')}`,
  ].join('\n');
}

function cityText(world, id) {
  const c = world.cities[id];
  if (!c) throw new Error(`不明な町: ${id}`);
  const k = world.player.knowledge[id];
  // 自分の交易所と、一度訪れた町は、いつでも今の様子が分かる
  const here = world.player.merchants.some((m) => m.city === id) || !!world.cities[id]?.founded || G.isVisited(world, id);
  const out = [`■ ${c.name}(${id})  ${G.tierName(G.cityTier(c))}  人口 ${here ? Math.floor(c.pop) : k?.pop !== undefined ? `${Math.floor(k.pop)}（${world.day - k.day}日前）` : '?'}`];
  if (here) {
    const tierIdx = G.cityTier(c);
    const nextPop = G.BALANCE.tierPops[tierIdx + 1];
    out.push(`糖度 ${Math.round(c.glucose)}（目標値 ${Math.round(c.glucoseTarget)}）  1日の人口増加率 ${(G.growthPerDay(c) * 100).toFixed(2)}%${nextPop ? `  次の段階まで 人口 ${nextPop}${G.growthPerDay(c) > 0 && !(G.growthBlocker(world, c) || '').startsWith('家') ? `（このペースなら あと約${Math.ceil(Math.log(nextPop / c.pop) / Math.log(1 + G.growthPerDay(c)))}日）` : G.growthBlocker(world, c) ? '（今は止まっている。下の「伸びを止めているもの」を見る）' : ''}` : ''}`);
    const why = G.growthBlocker(world, c);
    if (why) out.push(`伸びを止めているもの: ${why}`);
    const look = G.cityOutlook(world, c);
    if (look.length) out.push(`これから: ${look.map((o) => o.text).join(' / ')}`);
    out.push(`糖度の目安: 40未満=飢え（人口減） 40〜110=安定（成長） 110〜140=活況（急成長） ${G.BALANCE.rushIgnite ? `${G.rushLineOf(world) - G.BALANCE.rushRipeGap}以上で甘味を食べていると熟し、甘味をまとめて売るとシュガーラッシュ` : `${G.rushLineOf(world)}以上で甘味を大量に食べるとシュガーラッシュ`} → その後クラッシュ`);
    const diet = Object.entries(c.diet || {}).sort((a, b) => b[1] - a[1]);
    out.push(dwellingLine(world, c));
    const refuse = world.scenario.goods.filter((g) => !G.cityWants(c, g));
    if (refuse.length) out.push(`この町が買い取らない品: ${refuse.map((g) => GOODS[g].name).join('・')}（町が育つと買い取るものもある${G.knownShifts(world).some((x) => x.fair === id && !G.fairClosed(world, x)) ? '。隊商市の期間は、市が白糖を買う' : ''}）`);
    if (diet.length) out.push(`食卓（糖度への寄与）: ${diet.map(([g, v]) => `${GOODS[g].name} +${Math.round(v * 100)}`).join(' / ')}`);
    const missingFood = world.scenario.goods.filter((g) => GOODS[g].kind === 'food' && G.dailyDemand(c, g, false) > 0 && !(c.diet?.[g] > 0.02));
    out.push(`シュガーラッシュまで: ${rushGap(c.glucose, c.sweetLevel || 0, G.rushSweetPlan(world, c), G.rushLineOf(world), c)}`);
    out.push(`※ 1種類の食べ物で上げられる糖度は50まで、甘味は1種類45まで。種類を増やすほど糖度が上がる。${missingFood.length ? `今足りない食べ物: ${missingFood.map((g) => GOODS[g].name).join('、')}` : ''}`);
    const adv = G.dietAdvice(world, c).slice(0, 6);
    if (adv.length) out.push(`伸びしろ（1日あたりの目安量で、糖度がどれだけ上がるか）: ${adv.map((a) => `${GOODS[a.good].name} 約${fmt(a.perDay, 1)}個/日で+${a.gain}`).join(' / ')}`);
    if (world.scenario.goods.some((g) => GOODS[g].kind === 'goods')) out.push(`暮らしの豊かさ（非糖の品の充足）: ${Math.round(c.luxury * 100)}%`);
    for (const b of G.civicsIn(c)) out.push(`需要施設 ${G.CIVICS[b.type].name}: 満足度 ${Math.round((c.civicSat?.[b.type] || 0) * 100)}%（求める品 ${G.civicWants(b.type, world.scenario.goods).map((g) => GOODS[g].name).join('・')}。満足度に応じて成長 最大+${Math.round(G.CIVICS[b.type].growth * 100)}%）`);
    if (c.rush) out.push(`🍬 シュガーラッシュ中（あと${c.rush}日）: 甘味の需要と売値が上がる`);
    if (c.crash) out.push(`💥 シュガークラッシュ中（あと${c.crash}日）: 甘味が売れず、糖度に効かない`);
    const prod = Object.entries(c.produces).map(([g, r]) => `${GOODS[g].name}${fmt(r)}`).join(' ') || 'なし';
    out.push(`特産（1日の生産量）: ${prod}`);
    const demand = world.scenario.goods.filter((g) => G.dailyDemand(c, g, false) > 0).map((g) => `${GOODS[g].name}${fmt(G.dailyDemand(c, g, false))}`).join(' ');
    out.push(`需要（1日の基本消費量）: ${demand || 'なし'}`);
  } else {
    out.push('（まだ訪れていない町。商人を送ると、そのあとはいつでも様子が分かる）');
  }
  const routes = world.edges.filter((e) => e.a === id || e.b === id).map((e) => {
    const other = e.a === id ? e.b : e.a;
    return `  #${e.id} → ${world.cities[other].name}(${other})  ${G.ROUTE_KINDS[e.kind].name}  距離${e.len}${e.danger ? `  危険度${e.danger}` : ''}${e.monsoon ? '  季節風の影響あり' : ''}`;
  });
  out.push('道:', ...routes);
  const shops = Object.keys(TRANSPORTS).filter((t) => G.canBuyTransportAt(world, c, t) && TRANSPORTS[t].cost > 0);
  if (shops.length) out.push(`買える輸送手段: ${shops.map((t) => `${TRANSPORTS[t].name}(${t}) ${TRANSPORTS[t].cost}銀`).join('、')}`);
  const wh = world.player.warehouses[id];
  if (wh) out.push(`自分の倉庫: ${Object.entries(wh.stock).filter(([, q]) => q >= 1).map(([g, q]) => `${GOODS[g].name}${Math.floor(q)}`).join(' ') || '空'}`);
  const bs = world.player.buildings.filter((b) => b.city === id);
  for (const b of bs) out.push(`工房 #${b.id} ${BUILDINGS[b.type].name} ${b.active ? '稼働中' : '停止中'}${b.autoBuy ? '（材料を市場から自動購入）' : ''}`);
  return out.join('\n');
}

// 区画を文字の格子で描く。1マスは2文字幅
const TERRAIN_CH = { '.': '. ', f: ', ', s: ': ', w: '~~', h: 'n ', m: '^^', r: '= ' };
function districtText(world, id) {
  const c = world.cities[id];
  if (!c) throw new Error(`不明な町: ${id}`);
  const d = c.district;
  const tier = G.cityTier(c);
  const rad = G.cityRadius(c, tier);
  const n = d.size;
  const out = [`■ ${c.name}(${id})の区画  ${G.tierName(tier)}  市場の圏 ${rad}マス${d.radiusBonus ? `（広げた分 +${d.radiusBonus}）` : ''}`];
  out.push(`人口 ${Math.floor(c.pop)} / 住める人数 ${G.housingCap(c, tier)}（家 ${G.houseCount(c)}軒、1軒 ${G.houseCap(tier, c)}人。町が育つほど家も大きくなる）  働き手 ${G.workersAvailable(c)}人 / 必要 ${G.workersNeeded(c)}人${G.staffing(c) < 1 ? `  ⚠ 生産は ${Math.round(G.staffing(c) * 100)}%` : ''}`);
  out.push('   ' + Array.from({ length: n }, (_, x) => String.fromCharCode(65 + x) + ' ').join(''));
  const used = new Map();
  for (let y = 0; y < n; y++) {
    let row = String(y + 1).padStart(2, ' ') + ' ';
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const b = d.buildings.find((v) => v.x === x && v.y === y && !v.virtual);
      const inR = G.tileDist(x, y) <= rad;
      let ch;
      if (b) {
        const name = G.CIVICS[b.type] ? G.CIVICS[b.type].name : b.type === 'house' ? '家' : b.type === 'market' ? '市場' : G.PRODUCERS[b.type]?.name || BUILDINGS[b.type]?.name || b.type;
        ch = G.CIVICS[b.type] ? G.CIVICS[b.type].name[0] : b.type === 'house' ? '家' : b.type === 'market' ? '市' : b.owner === 'player' ? '工' : name[0];
        used.set(ch, G.CIVICS[b.type] ? `${G.CIVICS[b.type].name}（需要施設）` : b.type === 'house' ? '家（住居。人口に合わせて自動で建つ）' : b.type === 'market' ? '市場' : b.owner === 'player' ? `自分の工房（${name}）` : name);
      } else if (d.res[i] !== '-') ch = inR ? `${d.res[i]} ` : `${d.res[i]}.`;
      else ch = inR ? TERRAIN_CH[d.terrain[i]] : d.terrain[i] === 'w' ? '~~' : '  ';
      row += ch;
    }
    out.push(row);
  }
  out.push(`凡例: ${[...used].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  const resHere = [...new Set(d.res.split('').filter((r) => r !== '-'))];
  out.push(`地形: .=平地 ,=肥えた土地 :=砂地 n=丘 ^^=山 ==道 ~~=水辺 空白=市場の圏の外  資源: ${resHere.map((r) => `${r}=${G.RESOURCES[r].name}`).join(' ') || 'なし'}（圏の外の資源は「c.」のように表示）`);
  return out.join('\n');
}

function buildableText(world, id) {
  const c = world.cities[id];
  if (!c) throw new Error(`不明な町: ${id}`);
  const tier = G.cityTier(c);
  const out = [`■ ${c.name}に置ける生産施設（費用。置けるマスの例）`];
  for (const [k, p] of Object.entries(G.PRODUCERS)) {
    if (!world.scenario.goods.includes(p.good)) continue;
    const nativeOnly = ['food', 'sweet'].includes(GOODS[p.good].kind) && !(c.district.native || []).includes(p.good);
    const tiles = nativeOnly ? [] : G.placeableTiles(c, tier, k);
    const cost = G.producerCost(world, k);
    if (nativeOnly) { out.push(`  ${k}（${p.name}）: この町の土地では育たない（食べ物と甘味は元から作っている品だけ増産できる）`); continue; }
    out.push(`  ${k}（${p.name}）: ${cost}銀＋維持費${G.BALANCE.producerUpkeep}/日  ${GOODS[p.good].name} +${p.rate}/日（${G.BALANCE.producerBuildDays}日後から）  働き手${p.workers}人  ${tiles.length ? `置けるマス ${tiles.length}か所: ${tiles.slice(0, 6).map(([x, y]) => G.coordName(x, y)).join(' ')}` : '置けるマスがない'}`);
  }
  out.push('需要施設（その町に新しい需要を生み、求める品が届くと町が育つ）:');
  for (const [k, cv] of Object.entries(G.CIVICS).filter(([, x]) => !x.wild)) {
    const why = G.civicCheck(world, id, k);
    const wants = G.civicWants(k, world.scenario.goods).map((g) => GOODS[g].name).join('・');
    out.push(`  ${k}（${cv.name}）: ${G.civicCost(world, k)}銀  求める品 ${wants || 'なし'}  成長 +${Math.round(cv.growth * 100)}%・${cv.effect}  ${why ? `✖ ${why}` : '建てられる（civic ' + k + ' confirm）'}`);
  }
  const cc = world.cities[id];
  if (cc.founded && cc.grade !== undefined) out.push(cc.grade >= 2 ? '格: 大市場（いちばん上）' : `格: ${G.gradeName(cc.grade)}。「${G.gradeName(cc.grade + 1)}」に格上げ: expand confirm（${G.expandCost(world, id)}銀。圏が${G.BALANCE.postGradeRadius[cc.grade + 1]}マスに広がる${cc.grade === 0 ? '。工房と需要施設を建てられるようになる' : '。宮殿を建てられるようになる'}）`);
  else out.push(`市場の圏を広げる: expand（${G.expandCost(world, id)}銀）`);
  if (G.branchesAllowed(world)) { const why = G.branchCheck(world, id); out.push(`商館: ${why ? `✖ ${why}` : `branch confirm（${G.branchCost(world)}銀。雇える商人 +1）`}`); }
  out.push('置く: place <種類> <座標> confirm（例: place wheat_farm C5 confirm）');
  return out.join('\n');
}

function mapText(world) {
  const out = ['■ 地図（町と道）。マスは look・sites・found と同じ座標'];
  for (const c of Object.values(world.cities)) out.push(`  ${c.name}(${c.id})  マス(${world.grid.cityTiles[c.id].join(',')})${c.tags.length ? `  [${c.tags.join(',')}]` : ''}`);
  out.push('道（日数はロバの場合の目安）:');
  for (const e of world.edges) {
    const days = Math.max(1, Math.round(e.len / TRANSPORTS.donkey.speed / (e.kind === 'desert' ? 0.6 : 1)));
    const ok = TRANSPORTS.donkey.modes.includes(e.kind) ? `約${days}日` : 'ロバは不可';
    out.push(`  #${e.id} ${world.cities[e.a].name} ⇔ ${world.cities[e.b].name}  ${G.ROUTE_KINDS[e.kind].name}  距離${e.len}  ${ok}${e.danger ? `  危険度${e.danger}` : ''}${e.monsoon ? '  季節風' : ''}`);
  }
  return out.join('\n');
}

function parseTradeLines(pos) {
  // buy wheat 20 dates 5 sell honey all ...
  const lines = [];
  let act = null;
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] === 'buy' || pos[i] === 'sell') { act = pos[i]; continue; }
    if (!act) throw new Error('buy か sell から書く（例: trade buy wheat 20 sell dates all）');
    const good = goodArg(pos[i]);
    const n = pos[++i];
    if (!GOODS[good]) throw new Error(`不明な品物: ${good}`);
    const q = n === 'all' ? Infinity : parseInt(n, 10);
    if (!(q > 0)) throw new Error(`${GOODS[good].name}の数量が不正: ${n}`);
    lines.push({ good, qty: act === 'buy' ? q : -q });
  }
  return lines;
}

const notes = [];
function resolveAll(world, m, lines) {
  const city = world.cities[m.city];
  // 売りを先に確定させ、空いた積載と入る銀を見込んでから「買えるだけ」を計算する
  const sells = lines.filter((l) => l.qty < 0).map((l) => (l.qty === -Infinity ? { good: l.good, qty: -(m.cargo[l.good] || 0) } : l)).filter((l) => l.qty);
  let freed = 0;
  let income = 0;
  for (const l of sells) {
    freed += -l.qty * GOODS[l.good].weight;
    income += G.quote(world, city, l.good, l.qty);
  }
  let room = G.cargoCap(m) - G.cargoUsed(m) + freed;
  let money = world.player.silver + income;
  const buys = [];
  for (const l of lines.filter((x) => x.qty > 0)) {
    let n = l.qty;
    if (n === Infinity) {
      n = Math.min(Math.floor(room / GOODS[l.good].weight), Math.floor(city.stock[l.good] || 0));
      while (n > 0 && G.quote(world, city, l.good, n) > money) n--;
    } else if (n > Math.floor(city.stock[l.good] || 0)) {
      n = Math.floor(city.stock[l.good] || 0);
      notes.push(n ? `${GOODS[l.good].name}は${city.name}に${n}個しかないので、${n}個にした` : `${GOODS[l.good].name}は${city.name}に在庫がないので、買えない（見積もりから外した）`);
    }
    if (n > Math.floor(room / GOODS[l.good].weight)) {
      n = Math.max(0, Math.floor(room / GOODS[l.good].weight));
      notes.push(`積載の空きに合わせて${GOODS[l.good].name}を${n}個にした`);
    }
    if (n > 0) {
      buys.push({ good: l.good, qty: n });
      room -= n * GOODS[l.good].weight;
      money -= G.quote(world, city, l.good, n);
    }
  }
  return [...sells, ...buys];
}

// 定期便の停泊地: "kohaku sell:wheat@5,dates buy:silk*10@30 unload:rawsugar load:whitesugar"
function parseStop(str, world) {
  const [name, ...parts] = str.trim().split(/\s+/);
  const city = world ? cityArg(world, name) : name;
  const stop = { city, sell: [], buy: [], unload: [], load: [] };
  for (const p of parts) {
    const [kind, list] = p.split(':');
    for (const raw of (list || '').split(',').filter(Boolean)) {
      const item = raw.replace(/^[^@*]+/, (g) => goodArg(g));
      if (kind === 'sell') { const [good, min] = item.split('@'); stop.sell.push({ good, min: min ? Number(min) : 0 }); }
      else if (kind === 'buy') { const [gq, max] = item.split('@'); const [good, qty] = gq.split('*'); stop.buy.push({ good, qty: Number(qty || 999), max: max ? Number(max) : Infinity }); }
      else if (kind === 'keep') { const [good, qty] = item.split('*'); stop.sell.filter((x) => x.good === good).forEach((x) => { x.keep = Number(qty || 0); }); stop.keepList = [...(stop.keepList || []), { good, qty: Number(qty || 0) }]; }
      else if (kind === 'fire') (stop.fireList ||= []).push(item);
      else if (kind === 'unload' || kind === 'load') stop[kind].push(item);
      else if (kind === 'wait') { const [good, qty] = item.split('*'); stop.waitFor = { good, qty: Number(qty || 1) }; }
      else throw new Error(`停泊地の書き方が不正: ${p}`);
    }
  }
  for (const k of stop.keepList || []) {
    const s = stop.sell.find((x) => x.good === k.good);
    if (s) s.keep = k.qty;
  }
  delete stop.keepList;
  // fire:品 熟した町では、その品をまとめて売って火を入れる（売る品になければ足す）
  for (const good of stop.fireList || []) {
    const s = stop.sell.find((x) => x.good === good);
    if (s) s.fire = true; else stop.sell.push({ good, min: 0, fire: true });
  }
  delete stop.fireList;
  return stop;
}

const HELP = `糖商記 〜Great Glucose Empire〜  CLI版

使い方: node cli/toshoki.js --save <ファイル> <コマンド> [引数]

【はじめる】
  new --scenario s1 --seed 1 --save run.json [--heirloom 名前]   新しいゲーム（シナリオ一覧は scenarios、家訓は heirlooms）
  scenarios                                    シナリオ一覧

【見る】
  status            日付、銀、目標、商人、大口注文
  market            今いる町の市場（売値・買値・在庫・相場の推移）
  prices            知っている全部の町の相場と、その情報の古さ
  city <町id>       町の詳細（糖度、人口、特産、需要、道）
  map               町と道の一覧
  overview          世界の地図を文字で（縮小）
  look [町|x,y]     その辺りの地図を文字で（1文字=1マス）
  district [町id]   町の区画（マス目）。建物・地形・資源と市場の圏
  buildable [町id]  その町に置ける生産施設と、置けるマスの候補
  merchants         商人の一覧
  advice [-m 番号]  次の一手の例（どこで何を買って、どこで売るか。初めての人向け）
  route <町id>      そこまでの経路と日数
  log [n]           最近の出来事
  ledger            帳簿（収支、取引の成績）
  help rules        ルールの説明

【動く】（商人が複数いるときは -m <番号> を付ける）
  quote buy wheat 20 sell dates 10    取引の見積もり（確定しない）
  trade buy wheat 20 sell dates 10    取引を確定（数量に all も使える。買いの all は積載の空き・在庫・銀の一番少ない所まで、売りの all は積荷すべて）
  trade sell rawsugar all --fire       （火入れがあるとき）熟した町で、甘味をまとめて売って火を入れる
  travel <町id> [--guards n] [--nowait]  出発して、到着か事件まで日を進める（--nowait なら時間を進めない）
  wait <日数> [-m 番号]                日を進める（最大120日。手動の商人の到着や重要な出来事で止まる。-m を付けるとその商人が町に着いたら止まる）
  shop                                 雇用・輸送手段・工房・道の費用と条件（どこで買えるか）
  hire [番号] [confirm] [--at 町]      商人を雇う（confirm なしなら費用と候補3人の才能を表示。定期便が回っている町でも雇える）
  transport <種類> [confirm]           輸送手段を買い替える（camel, cart, dhow, carrack）。定期便で移動中なら予約になり、買える町に着いたら買い替える
  guards <人数> [-m 番号]              その商人が手動で出発するとき、いつも雇う護衛の人数
  dismiss [-m 番号] [confirm]          商人に暇を出す（輸送手段を半額で下取り、積荷は売る。銀が尽きたときの立て直しに）
  build <種類> [confirm]               今いる町に工房を建てる（mill, confectionery, winery, malthouse）
  workshops                            工房の一覧（レシピ、生産数、倉庫）
  workshop <番号> on|off|autobuy|noautobuy
  workshop <番号> maxprice <倍率>       材料の自動仕入れの上限（基準価格の何倍まで買うか。最初は1.5）
  workshop <番号> recipe <レシピ名|auto>  作るものを1つに固定（例: 粗糖のまま売りたいときは 粗糖づくり）
  load <品物> <数|all>                 倉庫 → 商人 へ積む（例: load whitesugar all）
  unload <品物> <数|all>               商人 → 倉庫 へ下ろす（工房の材料を入れる。例: unload cane all）
  road <道の番号> [confirm]            小道を街道に整備する
  path <町> <町> trail|road|canal [confirm]  2つの町を結ぶ道を敷く（小道・街道・運河。経路は自動で一番安い所を通る）
  port [confirm]                       水辺の町に港を開く（船が着ける）
  sites                                交易所を開ける場所の候補（座標と、採れそうな品。町のない土地では圏に入る集落）
  copyorder <元> <先>                  定期便を別の商人に写す（番号か名前）
  families / family <id>               町のない土地: 一族の一覧 / 一族を選ぶ（館の立つ地域が決まる）
  wild                                 町のない土地: まだ交易所の圏にない集落と古い建物（近い順）
  techs                                買える技術の一覧（ライバルが先に買うと独占され、使用料がかかる）
  tech <id> [confirm]                  技術を買う
  found <x,y> [confirm]                その場所に交易所（新しい町）を開く
  place <種類> <座標> [confirm]        区画に生産施設を置く（例: place wheat_farm C5 confirm）。町の供給が増える
  demolish <座標> [confirm]            自分が置いた施設を取り壊す
  expand [confirm]                     市場の圏を1マス広げる（置ける場所が増える）。自分の交易所では格上げ（交易所→市場→大市場）
  civic <種類> [座標] [confirm]        需要施設を建てる（teahouse 茶館 / temple 寺院 / academy 学問所 / palace 宮殿）
  branch [confirm]                     今いる町に商館を開く（雇える商人 +1、その町の倉庫と相場。2つ目からは倍々に高い）
  settle <交易所> [-m 番号] [confirm]  町以上の町から開拓団（60人）を連れ出し、自分の交易所へ運ぶ（着いたら go で連れていく）
  donate [confirm]                     今いる町に寄進する（費用は人口に比例。90日間、成長が早まる）
  order add "<町> sell:品@最低値 keep:品*残す数 buy:品*数@上限値 unload:品 load:品" "<町> ..." [--guards n]
                                       定期便を設定（停泊地を2つ以上）。例:
                                       order add "mugi buy:wheat*20@3" "kohaku sell:wheat@5"
                                       停泊地の書き方（町ごとに "..." で囲む）:
                                         sell:品@最低値   その品を全部売る。最低値より安ければ売らずに持ち越す
                                         keep:品*数       売るときに、この数だけ手元に残す（砂漠の食料など）
                                         buy:品*数@上限値 その数になるまで買う。上限値より高ければ買わない
                                         unload:品        積んでいる分を全部、自分の倉庫へ下ろす（工房の材料）
                                         load:品[*数]     倉庫にある分を、積めるだけ（数を書けばその数まで）積む（工房の製品）
                                         wait:品*数       その品がその数だけ積めるまで、この町で待つ（最大30日。空荷の往復を防ぐ）
                                         fire:品          （火入れがあるとき）熟した町ではその品をまとめて売って火を入れる。熟していなければ火入れの分を残して売り、熟す手前なら数日待つ
                                       処理の順番は 下ろす → 積む → 売る → 買う
  order list                           定期便ごとの損益
  order edit <停泊地の番号> "<町 ...>"  停泊地を1つだけ書き直す（番号は、その商人の定期便の停泊地の順。-m で商人を選ぶ）
  order add ... --hold                  設定だけして、すぐには出発しない（order resume で動き出す）
  order add ... --reserve <銀>          仕入れで手元に残す銀（最初は50。砂漠の食料と、何も買えず空荷で出ることになるときは割っても買う）
  order pause [町]                     次に町に着いたら（町を書けばその町で）定期便を止める
  order alt ["<町 ...>" "<町 ...>"] --shift <予告の番号> | --from <日> --until <日>
                                       （--shift で停泊地を省くと、いつもの便の最初の停泊地と隊商市の町を往復する便）
                                       臨時の便（期間予約）: その期間だけ別の停泊地を回り、過ぎたら元の便に戻る。
                                       --shift で、予告（shifts で一覧）に合わせて期間を入れる（隊商市に着く日が期間に入るよう、行く日数だけ前へずらす）
  order alt clear [予約の番号]          臨時の便の予約を消す（番号は order list。省くと全部）。期間が重なる予約を足すと、前の予約は置き換わる
  shifts                               予告された売り場の交代（安くなる町と、隊商市の立つ町・期間）
  order clear | order resume
  heirlooms                            家訓の一覧（利点と代償、解放の条件）。new --heirloom <家訓> で1つだけ持っていける

--json を付けると結果を JSON で出す。
町は id でも日本語の名前でも指定できる。商人が複数いても、place・expand・civic・donate・port・branch は今いる町が1つなら自動で選ぶ（--at <町> でも指定できる）。
-m <番号> はコマンドのどこに書いてもよい。続けて打つときは ; ではなく && でつなぐと、失敗したところで止まる。`;



// ---------- コマンド ----------
function run(world, cmd, pos, opts) {
  const res = { text: '', data: null, world };
  const out = [];
  // 町は日本語の名前でも指定できる
  pos = pos.map((p) => cityArg(world, p));
  if (opts.at) opts.at = cityArg(world, opts.at);
  // 町を取るコマンドで知らない町なら、町の一覧を添えて断る
  const townList = () => Object.values(world.cities).map((c) => `${c.name}=${c.id}`).join('、');
  if (['travel', 'route', 'city', 'district', 'buildable'].includes(cmd) && pos[0] && !world.cities[pos[0]]) throw new Error(`不明な町: ${pos[0]}（町: ${townList()}。日本語の名前でもよい）`);
  if (opts.at && !world.cities[opts.at]) throw new Error(`不明な町: ${opts.at}（町: ${townList()}）`);
  const after = (r) => {
    if (r && r.ok === false) throw new Error(r.error);
    return r;
  };
  // 町のないシナリオで始める前は、一族を選ぶ・交易所を置く・見るだけのコマンドしか使えない
  if (world.setup && !['status', 'families', 'family', 'sites', 'found', 'wild', 'look', 'overview', 'goals', 'help', 'rules', 'save', 'techs'].includes(cmd)) throw new Error(`まだ始まっていない。${G.setupStage(world) === 'family' ? 'families → family <id> で一族を選ぶ' : 'sites → found <x,y> confirm で最初の交易所を置く'}`);
  switch (cmd) {
    case 'status': out.push(statusText(world)); break;
    case 'shifts': {
      const list = G.knownShifts(world);
      if (G.fairRound(world)) out.push(`🎪${G.fairRound(world).text}`);
      if (!list.length) { out.push(world.scenario.shifts ? `今、予告された売り場の交代はない（予告は${world.scenario.shifts.travelLead ? `、市が始まる日より、${world.cities[world.scenario.shifts.travelLead].name}からラクダで市まで行く日数＋4日だけ前` : `始まる約${world.scenario.shifts.lead}日前`}に出る）` : 'このシナリオには、予告された売り場の交代はない'); break; }
      for (const x of list) {
        if (G.fairClosed(world, x)) { out.push(`#${x.id}: ${world.cities[x.low].name}(${x.low})で${GOODS[x.good].name}が安い ${G.lowStateText(world, x)} / ${world.cities[x.fair].name}(${x.fair})の隊商市は${G.fairStateText(world, x)}`); continue; }
        out.push(`#${x.id}: ${world.cities[x.low].name}(${x.low})で${GOODS[x.good].name}が安い ${G.lowStateText(world, x)} / ${world.cities[x.fair].name}(${x.fair})に隊商市 ${G.fairStateText(world, x)}（${GOODS[x.good].name}を高く買う。毎日約${world.scenario.shifts.fair.demand}個ずつ売れていき、まとめて売ると値が下がる${x.want ? `。${G.fairWantText(x)}` : ''}）。${G.fairPriceText(world, x)}${G.caravanText(world, x) ? ` ${G.caravanText(world, x)}` : ''}`);
        for (const m of world.player.merchants.filter((y) => y.order)) {
          // この品を運ばない便には、着く日の目安を出さない（「市が閉じる前に着けない」と出て、行けないのか運ばないのか分からなかった。31回目の Sol）
          if (!G.altDraftFor(world, m, x)) { out.push(`    #${m.id} ${m.name}: この便は${GOODS[x.good].name}を運ばない（市へ回すなら、${GOODS[x.good].name}を積む便に組み替える）`); continue; }
          const win = G.altWindowFor(world, m, x, m.order.stops);
          const base = G.baseStops(m.order);
          const have = G.altCovering(m, x);
          // 今の積荷と積み待ち（着く日の目安に積み待ちの日数は入らない。26回目の Sol: 目安の1日差でライバルより先と読み、積み待ちで逆転した）
          const st = m.order.stops[m.order.next];
          const load = `${GOODS[x.good].name}${Math.floor(m.cargo[x.good] || 0)}個${m.order.holding && st?.waitFor ? `、${world.cities[m.city]?.name || ''}で${GOODS[st.waitFor.good].name}${st.waitFor.qty}個まで待っている` : ''}`;
          out.push(`    #${m.id} ${m.name}（${load}。目安に積み待ちは入らない）: ${base[0] ? world.cities[base[0].city].name : ''}から${world.cities[x.fair].name}まで${Number.isFinite(win.days) ? `約${win.days}日` : `${TRANSPORTS[m.transport].name}では行けない`} → ${have ? `予約ずみ（${have.from}〜${have.until}日目）` : win.late ? `${win.ready > world.day ? `${base[0] ? world.cities[base[0].city].name : ''}に戻れるのは${win.ready}日目。` : ''}市が閉じる前に着けない` : `臨時の便に切り替わる期間の目安 ${win.from}〜${win.until}日目（期間中に町に着くと切り替わり、${GOODS[x.good].name}を積んでいれば市へ直に。${win.lastSale}日目までに着く${win.ready > win.from ? `。今の旅から戻るのは${win.ready}日目` : ''}。今予約すると早ければ${win.arrive}日目着、${win.afterStart > win.lastSale ? '始まってから切り替えたのでは間に合わない' : `始まってから切り替えると${win.afterStart}日目着で市の残り${win.lastSale - win.afterStart + 1}日`}）。order alt --shift ${x.id} -m ${m.id} で、${base[0] ? world.cities[base[0].city].name : ''}と${world.cities[x.fair].name}を往復する便を予約`}`);
        }
      }
      break;
    }
    case 'copyorder': {
      if (!pos[0] || !pos[1]) throw new Error('copyorder <写す元の商人> <写す先の商人>（番号か名前）');
      after(G.copyOrder(world, pos[0], pos[1]));
      out.push(`${G.getMerchant(world, pos[0]).name}の定期便を${G.getMerchant(world, pos[1]).name}に写した`);
      break;
    }
    case 'families': {
      if (!G.familyList(world).length) { out.push('このシナリオでは一族を選ばない'); break; }
      out.push('■ 一族（館の立つ地域が決まる。ライバルは選ばなかった一族の館から始める）');
      for (const f of G.familyList(world)) {
        const [fx, fy] = G.tileOf(f.x, f.y);
        const near = (world.hamlets || []).filter((hm) => Math.max(Math.abs(hm.x - fx), Math.abs(hm.y - fy)) <= G.HQ_RANGE + 2);
        out.push(`  ${f.id}（${f.name}）: 館 ${fx},${fy}。${f.text || ''}館の近くの集落: ${near.map((hm) => `${hm.name}（${hm.x},${hm.y}・人口${hm.pop}・${Object.keys(hm.foods).map((g) => GOODS[g].name).join('・')}）`).join('、') || 'なし'}`);
      }
      break;
    }
    case 'family': {
      after(G.chooseFamily(world, pos[0]));
      out.push(`${G.familyList(world).find((f) => f.id === world.player.family).name}に決めた。館は ${world.player.hq.join(',')}。次は sites → found <x,y> confirm で最初の交易所（無料）`);
      break;
    }
    case 'wild': {
      const wl = G.wildernessList(world);
      const own = Object.values(world.cities).filter((c) => c.founded).map((c) => world.grid.cityTiles[c.id]);
      const from = own.length ? own : world.player.hq ? [world.player.hq] : [];
      const d = (o) => (from.length ? Math.min(...from.map(([x, y]) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)))) : 0);
      out.push(`■ まだ交易所の圏にない集落と古い建物（自分の交易所${own.length ? '' : '（まだないので一族の館）'}から近い順）。交易所の圏は 交易所${G.BALANCE.postGradeRadius[0]}・市場${G.BALANCE.postGradeRadius[1]}・大市場${G.BALANCE.postGradeRadius[2]}マス`);
      const rows = [...wl.hamlets.map((o) => [d(o), `  集落 ${o.name} ${o.x},${o.y}（${d(o)}マス）人口${o.pop}・作る: ${Object.entries(o.foods).map(([g, r]) => `${GOODS[g].name}${r}/日`).join('・')}`]), ...wl.wilds.map((o) => [d(o), `  古い建物 ${G.CIVICS[o.type].name} ${o.x},${o.y}（${d(o)}マス）毎日買う: ${Object.entries(G.CIVICS[o.type].flat).filter(([g]) => world.scenario.goods.includes(g)).map(([g, r]) => `${GOODS[g].name}${r}`).join('・')}`])].sort((a, b) => a[0] - b[0]);
      out.push(...rows.slice(0, 20).map((r) => r[1]));
      break;
    }
    case 'market': {
      // 同じ町に商人が何人いても、その町の市場は同じなので自動で選ぶ
      const idleMs = world.player.merchants.filter((x) => !x.travel);
      const one = !opts.merchant && idleMs.length && new Set(idleMs.map((x) => x.city)).size === 1 ? idleMs[0] : needIdle(world, opts);
      out.push(marketText(world, one));
      break;
    }
    case 'prices': out.push(pricesText(world)); break;
    case 'city': out.push(cityText(world, pos[0] || pickMerchant(world, opts).city)); break;
    case 'map': out.push(mapText(world)); break;
    case 'overview': out.push(overviewText(world)); break;
    case 'look': {
      let x;
      let y;
      if (pos[0] && /^\d+,\d+$/.test(pos[0])) [x, y] = pos[0].split(',').map(Number);
      else {
        const id = cityArg(world, pos[0]) || hereCity(world, opts);
        if (!world.grid.cityTiles[id]) throw new Error('町か x,y を指定');
        [x, y] = world.grid.cityTiles[id];
      }
      out.push(lookText(world, x, y));
      break;
    }
    case 'path': {
      const [a, b, kind] = [cityArg(world, pos[0]), cityArg(world, pos[1]), pos[2]];
      if (!world.cities[a] || !world.cities[b] || !G.PATH_KINDS[kind]) throw new Error('path <町> <町> trail|road|canal [confirm]');
      const why = G.pathCheck(world, kind);
      if (why) throw new Error(why);
      const plan = G.planPath(world, a, b, kind);
      if (!plan) throw new Error('その2つの町は結べない（山や海を越えられない）');
      if (pos[3] !== 'confirm') {
        out.push(`${world.cities[a].name}〜${world.cities[b].name}に${G.PATH_KINDS[kind].name}: 新しく${plan.newTiles}マス、${plan.cost}銀（${G.PATH_KINDS[kind].note}）。敷いた道 ${G.pathsBuilt(world)}/${G.pathsAllowed(world)}本。確定するには: path ${pos[0]} ${pos[1]} ${kind} confirm`);
        for (const t of world.allowedTransports) { const r = G.findPath(world, a, b, t); out.push(`  敷く前の${TRANSPORTS[t].name}: ${r ? `約${r.days}日` : '行けない'}${!r && (kind === 'road' || t !== 'cart') && (t !== 'cart' || kind === 'road') && !TRANSPORTS[t].modes.includes('sea') ? '（敷けば通れる）' : ''}`); }
        break;
      }
      const r = after(G.buildPath(world, a, b, kind));
      out.push(`敷いた（${r.tiles}マス、${r.cost}銀）`);
      for (const t of world.allowedTransports) { const rr = G.findPath(world, a, b, t); if (rr) out.push(`  ${TRANSPORTS[t].name}: 約${rr.days}日`); }
      break;
    }
    case 'techs': {
      const list = G.techList(world);
      if (!list.length) { out.push('このシナリオで買える技術はない'); break; }
      out.push('■ 技術');
      for (const t of list) {
        const st = t.owner === 'player' ? '持っている（独占）' : t.owner === 'licensed' ? '使用料を払って使っている' : !t.available ? `${t.from}日目から（${t.price}銀）` : t.owner === 'rival' ? `ライバルが独占中。使用料 ${t.price}銀` : `${t.price}銀`;
        out.push(`  ${t.id}（${t.name}）: ${t.text}  — ${st}`);
      }
      if (world.rivals.length) out.push('ライバルも技術を狙っている。先に買えば独占でき、ライバルが使うと使用料が入る');
      break;
    }
    case 'tech': {
      const t = G.techList(world).find((x) => x.id === pos[0]);
      if (!t) throw new Error('tech <id> [confirm]（一覧は techs）');
      if (pos[1] !== 'confirm') { out.push(`${t.name}: ${t.price}銀。${t.text}。確定するには: tech ${t.id} confirm`); break; }
      out.push(`買った（${after(G.buyTech(world, t.id)).cost}銀）`);
      break;
    }
    case 'sites': {
      const allowed = G.postsAllowed(world);
      if (!allowed) { out.push('このシナリオでは交易所を開けない'); break; }
      if (world.scenario.pioneer) out.push(`■ 交易所の候補（開いた数 ${G.postsFounded(world)}/${allowed}、次の費用 ${G.postCost(world)}銀。ほかの町から8マス以上。${world.setup ? `最初の交易所は一族の館から${G.HQ_RANGE}マス以内で、集落を圏に入れられる場所。` : ''}圏（${G.BALANCE.postGradeRadius[0]}マス）に入る集落の人と畑が、交易所のものになる）`);
      else out.push(`■ 交易所の候補（開いた数 ${G.postsFounded(world)}/${allowed}、次の費用 ${G.postCost(world)}銀。道か水辺から2マス以内、ほかの町から14マス以上）。交易所は人口${G.POST_POP}人の集落から始まり、最初の産出は1日2個ほど。食べ物と甘味を届けて育てる拠点`);
      if (world.scenario.pioneer) {
        // 町のないシナリオ: 圏に入る集落と古い建物
        for (const s of G.foundSites(world, 12)) {
          const pv = s.preview;
          out.push(`  ${s.x},${s.y}（${s.dist}マス先）  人口${pv.pop}から  集落: ${pv.hamlets.map((hm) => `${hm.name}（${Object.keys(hm.foods).map((g) => GOODS[g].name).join('・')}）`).join('、') || 'なし'}${pv.wilds.length ? `  古い建物: ${pv.wilds.map((w) => G.CIVICS[w.type].name).join('、')}` : ''}${pv.later.hamlets.length || pv.later.wilds.length ? `  市場に格上げで +${[...pv.later.hamlets.map((hm) => hm.name), ...pv.later.wilds.map((w) => G.CIVICS[w.type].name)].join('・')}` : ''}`);
        }
        break;
      }
      for (const s of G.foundSites(world)) out.push(`  ${s.x},${s.y}  採れそうな品: ${s.goods.map((g) => GOODS[g].name).join('・')}  一番近い町: ${world.cities[s.near].name}（${s.nearDist}マス）`);
      break;
    }
    case 'found': {
      if (!pos[0] || !/^\d+,\d+$/.test(pos[0])) throw new Error('found <x,y> [confirm]（候補は sites）');
      const [x, y] = pos[0].split(',').map(Number);
      if (pos[1] !== 'confirm') {
        const why = G.siteCheck(world, x, y);
        if (!why && world.scenario.pioneer) {
          const pv = G.sitePreview(world, x, y);
          out.push(`${x},${y} に交易所を開く: ${G.postCost(world)}銀。圏に入る集落: ${pv.hamlets.map((hm) => `${hm.name}（人口${hm.pop}・${Object.keys(hm.foods).map((g) => GOODS[g].name).join('・')}）`).join('、') || 'なし'}${pv.wilds.length ? `。古い建物: ${pv.wilds.map((w) => G.CIVICS[w.type].name).join('、')}` : ''}。人口${pv.pop}人から始まる。確定するには: found ${pos[0]} confirm`);
          break;
        }
        out.push(why ? `✖ ${why}` : `${x},${y} に交易所を開く: ${G.postCost(world)}銀。採れそうな品: ${G.siteGoods(world, x, y).map((g) => GOODS[g].name).join('・')}。人口${G.POST_POP}人から始まる。確定するには: found ${pos[0]} confirm`);
        break;
      }
      const r = after(G.foundPost(world, x, y));
      out.push(`開いた: ${world.cities[r.id].name}(${r.id})（${r.cost}銀）`);
      break;
    }
    case 'port': {
      const at = hereCity(world, opts);
      if (pos[0] !== 'confirm') { const why = G.portCheck(world, at); out.push(why ? `✖ ${why}` : `${world.cities[at].name}に港を開く: ${Math.round(G.PORT_COST * (world.player.mods?.buildCost ?? 1))}銀。確定するには: port confirm`); break; }
      out.push(`港を開いた（${after(G.buildPort(world, at)).cost}銀）`);
      break;
    }
    case 'advice': {
      const m = pickMerchant(world, opts);
      if (m.travel) { out.push(`${m.name}は移動中`); break; }
      out.push(`■ ${m.name}の次の一手の例（今の相場から。着く頃には町の様子が変わることもある）`);
      for (const l of G.adviceText(world, m.id)) out.push(`  ・${l}`);
      break;
    }
    case 'merchants': out.push(world.player.merchants.map((m) => merchantLine(world, m)).join('\n')); break;
    case 'route': {
      const m = pickMerchant(world, opts);
      const r = G.routeInfo(world, m.id, pos[0]);
      if (!r) { out.push(`${TRANSPORTS[m.transport].name}では行けない`); break; }
      out.push(`${r.path.map((id) => world.cities[id].name).join(' → ')}  約${r.days}日${r.danger ? `  最大危険度${r.danger}（護衛 ${r.danger * 2 + 1}人でたいてい撃退）` : ''}`);
      if (G.knownGangs(world).length) {
        // 移動中なら、今の旅のあとに出たときの見積もり（32回目の Opus: 移動中に route を打つと出なかった）
        const from = m.travel ? m.travel.to : m.city;
        const day = m.travel ? world.day + Math.max(1, Math.ceil(m.travel.totalDays - m.travel.elapsed)) + 1 : world.day + 1;
        const rr = G.findPath(world, from, r.path.at(-1), m.transport);
        const hs = rr ? G.gangCrossings(world, m, rr.tiles, rr.steps, { day }) : [];
        out.push(`  🗡 ${m.travel ? `今の旅のあと（${world.cities[from].name}を${day - 1}日目に出ると）` : '今出ると'}、${hs.length ? G.gangCrossText(world, hs) : '予告された強盗団の区域は通らない'}`);
        if (!m.travel && rr && hs.some((h) => h.caught)) { const safe = G.safeDepartDay(world, m, rr); const g = G.gambleDepartDay(world, m, rr); out.push(`  → ${safe}日目（あと${safe - world.day}日）に出れば捕まらない${g ? `。賭けるなら${g.day}日目に出ると、捕まる見込み約${Math.round(g.risk * 100)}%` : ''}`); }
        if (m.travel && G.travelGangCrossings(world, m).length) out.push(`  🗡 今の旅: ${G.gangCrossText(world, G.travelGangCrossings(world, m))}`);
      }
      if (r.desertDays) {
        const need = G.foodNeeded(world, m, r.desertDays);
        const food = G.PROVISIONS.reduce((s, g) => s + (m.cargo[g] || 0), 0);
        out.push(`  砂漠を約${r.desertDays}日渡る → 食料が${need}個いる（今 ${food}個${food < need ? `、あと${need - food}個積む` : '、足りている'}）。食料は ${G.PROVISIONS.map((g) => GOODS[g].name).join('・')}`);
      }
      break;
    }
    case 'log': {
      const n = Number(pos[0] || 15);
      out.push(world.log.slice(-n).map(eventLine).join('\n') || '（まだ何もない）');
      break;
    }
    case 'ledger': {
      const s = world.stats;
      out.push(`収入 ${silver(s.revenue)}  仕入れ ${silver(s.spent)}  取引利益 ${silver(s.profit)}`);
      out.push(`売却 ${s.sales}回（うち赤字 ${s.lossSales}回）  読み的中 ${s.hits}回  移動 ${s.trips}回  大口注文達成 ${s.contracts}  最長連続黒字 ${world.player.maxStreak}`);
      if (s.banditLoss) out.push(`盗賊による損失 約${Math.round(s.banditLoss)}銀`);
      for (const m of world.player.merchants) out.push(`  ${m.name}: 累計損益 ${Math.round(m.lifetime)}`);
      const hist = s.history.slice(-24).map((h) => h[1]);
      if (hist.length > 1) out.push(`銀の推移（5日ごと）: ${spark(hist)}`);
      break;
    }
    case 'quote': {
      const m = needIdle(world, opts);
      const lines = resolveAll(world, m, parseTradeLines(pos));
      const pv = G.preview(world, m.id, lines);
      out.push(...notes.splice(0));
      const city = world.cities[m.city];
      if (!pv.rows.length) out.push('取引する数量が0（all は「積載の空き・在庫・手持ちの銀」の一番少ない所で止まる。どれかが足りない）');
      for (const r of pv.rows) {
        // 1個目と最後の1個の値段（まとめて買うほど値上がり、売るほど値下がりする）
        const first = Math.abs(G.quote(world, city, r.good, r.qty > 0 ? 1 : -1));
        const n = Math.abs(r.qty);
        const last = n > 1 ? Math.abs(G.quote(world, city, r.good, r.qty) - G.quote(world, city, r.good, r.qty > 0 ? r.qty - 1 : r.qty + 1)) : first;
        out.push(`  ${r.qty > 0 ? '買' : '売'} ${gname(r.good)} ×${n}  ${r.total > 0 ? '+' : ''}${fmt(r.total)} 銀（1個あたり ${fmt(Math.abs(r.total / r.qty))}。1個目 ${fmt(first)} → 最後の1個 ${fmt(last)}）`);
      }
      out.push(`合計 ${pv.silverDelta >= 0 ? '+' : ''}${fmt(pv.silverDelta)} 銀 → 取引後の銀 ${Math.floor(world.player.silver + pv.silverDelta)}  積載 ${pv.cargoAfter}/${G.cargoCap(m)}`);
      if (!pv.ok) out.push('✖ ' + pv.errors.join(' / '));
      out.push('※ これは見積もり。確定するには quote を trade に替えて同じ内容を打つ。');
      break;
    }
    case 'trade': {
      const m = needIdle(world, opts);
      const lines = resolveAll(world, m, parseTradeLines(pos));
      if (!lines.length) throw new Error('取引する数量が0');
      out.push(...notes.splice(0));
      // まとめ買いで単価が大きく上がるなら、買う前に知らせる（取引はそのまま行う）
      for (const l of lines) {
        if (l.qty <= 1) continue;
        const city = world.cities[m.city];
        const first = G.quote(world, city, l.good, 1);
        const avg = G.quote(world, city, l.good, l.qty) / l.qty;
        if (avg > first * 1.4) out.push(`⚠ ${gname(l.good)}はまとめて買うと値上がりする（1個目 ${fmt(first)} → 平均 ${fmt(avg)}）。少なめに買うか quote で確かめよう`);
      }
      const r = after(G.trade(world, m.id, lines, { ignite: !!opts.fire }));
      if (opts.fire) { const c = world.cities[m.city]; out.push(c.ignite === world.day ? `🔥${c.name}に火が入った。明日シュガーラッシュが始まる` : `火は入らなかった（${!G.BALANCE.rushIgnite ? '火入れのない決まり' : !G.rushRipe(world, c) ? '町が熟していない' : '量か、町にある甘味の種類が足りない'}）`); }
      for (const row of r.rows) out.push(`  ${row.qty > 0 ? '買' : '売'} ${gname(row.good)} ×${Math.abs(row.qty)}  ${row.total > 0 ? '+' : ''}${fmt(row.total)} 銀${row.capped ? `（${row.capped}個のうち、買い取りの上限で${Math.abs(row.qty)}個だけ）` : ''}`);
      out.push(`銀 ${Math.floor(world.player.silver)}（${r.silverDelta >= 0 ? '+' : ''}${fmt(r.silverDelta)}）  積載 ${G.cargoUsed(m)}/${G.cargoCap(m)}`);
      for (const f of r.fx) {
        if (f.type === 'profit') out.push(`💰 利益 +${Math.round(f.amount)} 銀${f.streak > 1 ? `  🔥${f.streak}連続黒字！` : ''}  評判 +${f.rep}`);
        if (f.type === 'loss') out.push(`✖ 損失 ${Math.round(f.amount)} 銀`);
        if (f.type === 'streakBroken') out.push(`連続黒字が途切れた（${f.was}連続）`);
        if (f.type === 'contract') out.push(`📜 大口注文達成！報酬 +${f.reward} 銀`);
      }
      break;
    }
    case 'travel': {
      const m = needIdle(world, opts);
      // いつもの護衛（guards コマンドで決めた人数）を、--guards がなければ使う
      if (opts.guards === undefined && m.defaultGuards) opts.guards = m.defaultGuards;
      const plan = G.routeInfo(world, m.id, pos[0]);
      if (plan) {
        const desertDays = plan.edges.filter((e) => e.kind === 'desert').reduce((s, e) => s + G.edgeDays(world, e, m.transport, e.a), 0);
        const food = G.PROVISIONS.reduce((s, g) => s + (m.cargo[g] || 0), 0);
        const need = G.foodNeeded(world, m, desertDays);
        if (desertDays && food < need) {
          if (!('force' in opts)) throw new Error(`砂漠を約${desertDays}日渡るのに、隊商の食料が ${food}/${need} しかない。なつめやし・干しぶどう・キビ・麦・米を積んでから出発しよう（それでも行くなら --force）`);
          out.push(`⚠ 食料が足りないまま砂漠へ（${food}/${need}）`);
        }
        const rec = plan.danger * 2 + 1;
        if (plan.danger && world.scenario.bandits && Number(opts.guards || 0) < rec) out.push(`⚠ 盗賊の出る道（危険度${plan.danger}）。護衛は${rec}人いればたいてい撃退できる（今 ${Number(opts.guards || 0)}人。--guards n で雇う、1人1日${G.BALANCE.guardWage}銀）`);
      }
      if (world.player.silver < 0) out.push('⚠ 銀がマイナス。着いた町で売らないと仕入れができない');
      if (!Object.keys(m.cargo).length) out.push('⚠ 空荷で出発する（直前の取引が失敗していないか確かめよう。相場を見に行くだけならこのままでよい）');
      const r = after(G.travel(world, m.id, pos[0], { guards: Number(opts.guards || 0) }));
      out.push(`${m.name}が${world.cities[pos[0]].name}へ出発（約${r.days}日）`);
      if ('nowait' in opts) { out.push('（時間は進めていない。ほかの商人にも指示してから wait で進める）'); break; }
      // 予告でも止める（16日の航海中に港の市の予告を通り過ぎた。31回目の Opus）
      const adv = G.advance(world, r.days + 30, { stopOn: new Set(['arrive', 'victory', 'defeat', 'robbed', 'starve', 'orderStuck', 'shift', 'blight', 'grandFest', 'gang', 'gangHeld', 'portMarket', 'portMarketSail']) });
      out.push(...compactEvents(adv.events));
      if (!m.travel && m.city === pos[0]) out.push('', marketText(world, m));
      break;
    }
    case 'wait': {
      const asked = Number(pos[0] || 1);
      const n = Math.max(1, Math.min(120, asked));
      // -m を付けると、その商人が（定期便でも）町に着いたところで止まる
      const watch = opts.merchant ? G.getMerchant(world, opts.merchant)?.id : null;
      const adv = watch
        ? (() => { const evs = []; for (let i = 0; i < n; i++) { const a = G.advance(world, 1); evs.push(...a.events); if (a.events.some((e) => ['arrive', 'orderArrive'].includes(e.type) && e.merchant === watch) || a.events.some((e) => ['victory', 'defeat'].includes(e.type))) break; } return { events: evs }; })()
        : G.advance(world, n);
      out.push(...compactEvents(adv.events));
      // 町で止まったままの商人を知らせる（取引が1つ失敗して出発せず、9〜11日気づかなかった。32回目の Opus）
      const idle = world.player.merchants.filter((y) => !y.travel && (!y.order || y.order.paused) && !y.settlers);
      if (idle.length && n > 1) out.push(`⚠ 町で止まったままの商人: ${idle.map((y) => `${y.name}（${world.cities[y.city]?.name || ''}${y.order?.paused ? '、定期便は止めている' : ''}）`).join('、')}`);
      out.push(`（${world.day}日目${asked > 120 ? '。wait は1回120日まで' : ''}${adv.events.some((e) => e.type === 'arrive') ? '。商人が到着したので止まった' : ''}）`);
      break;
    }
    case 'hire': {
      const cost = G.hireCost(world);
      const cands = G.hireCandidates(world);
      if (!pos.includes('confirm')) {
        const hereAt = opts.at || (opts.merchant ? pickMerchant(world, opts).city : world.player.merchants.find((x) => !x.travel)?.city);
        if (hereAt && !G.hasPresence(world, hereAt)) out.push(`⚠ ${world.cities[hereAt].name}では今は雇えない（商人がいるか、定期便が回っている町で雇える）`);
        out.push(`商人を雇うと ${cost} 銀（銀 ${Math.floor(world.player.silver)} → ${Math.floor(world.player.silver - cost)}）。上限 ${G.merchantCap(world)} 人。候補:`);
        cands.forEach((c, i) => out.push(`  ${i + 1}. ${c.name}【${G.TALENTS[c.talent].name}】${G.TALENTS[c.talent].text}`));
        out.push('確定するには: hire <候補の番号> confirm（例: hire 2 confirm。番号を省くと1番）');
        break;
      }
      const pick = Math.max(0, (parseInt(pos.find((p) => /^\d+$/.test(p)) || '1', 10) || 1) - 1);
      const atCity = opts.at || (opts.merchant ? pickMerchant(world, opts).city : world.player.merchants.find((x) => !x.travel)?.city);
      if (!atCity) throw new Error('どの町で雇うか --at <町id> で指定する（商人が滞在している町か、定期便が回っている町）');
      const r = after(G.hireMerchant(world, atCity, pick));
      out.push(`雇った（${r.cost}銀）。新しい商人の番号は #${r.merchant}（-m ${r.merchant} で操作）`);
      break;
    }
    case 'guards': {
      const m = pickMerchant(world, opts);
      const n = Math.max(0, Math.min(12, parseInt(pos[0], 10) || 0));
      m.defaultGuards = n;
      out.push(`${m.name}は手動で出発するとき、いつも護衛を${n}人雇う（--guards で毎回変えられる。定期便は order add の --guards）`);
      break;
    }
    case 'dismiss': {
      const m = needIdle(world, opts);
      if (pos[0] !== 'confirm') { out.push(`${m.name}に暇を出す: ${TRANSPORTS[m.transport].name}を${TRANSPORTS[m.transport].cost * 0.5}銀で下取りし、積荷は${world.cities[m.city].name}で売り払う。給金と維持費がかからなくなる。確定するには: dismiss -m ${m.id} confirm`); break; }
      out.push(`暇を出した（+${after(G.dismissMerchant(world, m.id)).gain}銀）`);
      break;
    }
    case 'transport': {
      const t = TRANSPORTS[pos[0]];
      if (!t) throw new Error(`種類を指定: ${Object.keys(TRANSPORTS).join(', ')}（費用と買える町は shop）`);
      // 移動中の定期便の商人なら、予約しておいて、買える町に着いたときに買い替える
      const pm = pickMerchant(world, opts);
      if (pm.travel && pm.order) {
        if (pos[1] !== 'confirm') { out.push(`${pm.name}は定期便で移動中。予約すると、${t.name}を買える町に着いたときに買い替える（${t.cost}銀）。予約するには: transport ${pos[0]} confirm -m ${pm.id}`); break; }
        pm.pendingTransport = pos[0];
        out.push(`予約した: ${pm.name}は${t.name}を買える町に着いたら買い替える`);
        break;
      }
      const m = needIdle(world, opts);
      if (pos[1] !== 'confirm') { out.push(`${t.name}: ${t.cost}銀（今の${TRANSPORTS[m.transport].name}を${TRANSPORTS[m.transport].cost * 0.5}銀で下取り）。確定するには: transport ${pos[0]} confirm`); break; }
      out.push(`購入した（差額 ${Math.round(after(G.buyTransport(world, m.id, pos[0])).price)}銀）`);
      break;
    }
    case 'build': {
      const m = opts.at ? { city: opts.at } : needIdle(world, opts);
      if (!world.cities[m.city]) throw new Error(`不明な町: ${m.city}`);
      const b = BUILDINGS[pos[0]];
      if (!b?.recipes) throw new Error('種類を指定（費用は shop）');
      if (pos[1] !== 'confirm') { out.push(`${b.name}: ${G.buildCost(world, pos[0])}銀、維持費 ${b.upkeep}/日。確定するには: build ${pos[0]} confirm`); break; }
      out.push(`建てた（工房 #${after(G.build(world, m.city, pos[0])).building}）`);
      break;
    }
    case 'workshop': {
      const map = { on: { active: true }, off: { active: false }, autobuy: { autoBuy: true }, noautobuy: { autoBuy: false } };
      if (pos[1] === 'maxprice') {
        const v = Number(pos[2]);
        if (!(v >= 1 && v <= 5)) throw new Error('workshop <番号> maxprice <1〜5>（基準価格の何倍まで自動で仕入れるか。最初は1.5）');
        after(G.setBuilding(world, pos[0], { priceCap: v }));
        out.push(`自動仕入れの上限を基準の${v}倍にした`);
        break;
      }
      if (pos[1] === 'recipe') {
        // レシピを1つに固定する（例: workshop 1 recipe 粗糖づくり）。auto で元に戻す
        const b = world.player.buildings.find((x) => x.id === Number(pos[0]));
        if (!b) throw new Error('その工房はない');
        const names = BUILDINGS[b.type].recipes.map((r) => r.name);
        if (pos[2] !== 'auto' && !names.includes(pos[2])) throw new Error(`レシピ: ${names.join('・')}・auto（上から順に試す）`);
        after(G.setBuilding(world, pos[0], { recipe: pos[2] === 'auto' ? null : pos[2] }));
        out.push(pos[2] === 'auto' ? 'レシピを自動（上から順に試す）に戻した' : `レシピを「${pos[2]}」だけにした`);
        break;
      }
      after(G.setBuilding(world, pos[0], map[pos[1]] || {}));
      out.push('設定した');
      break;
    }
    case 'load': case 'unload': {
      const m = needIdle(world, opts);
      const good = pos[0];
      if (!GOODS[good]) throw new Error(`品物を指定する（例: ${cmd} cane 20 / ${cmd} cane all）`);
      const wh = world.player.warehouses[m.city];
      let n;
      if (pos[1] === 'all' || pos[1] === undefined) {
        n = cmd === 'load' ? Math.min(Math.floor(wh?.stock[good] || 0), Math.floor((G.cargoCap(m) - G.cargoUsed(m)) / GOODS[good].weight)) : m.cargo[good] || 0;
      } else {
        n = parseInt(pos[1], 10);
        const avail = cmd === 'load' ? Math.min(Math.floor(wh?.stock[good] || 0), Math.floor((G.cargoCap(m) - G.cargoUsed(m)) / GOODS[good].weight)) : m.cargo[good] || 0;
        if (n > avail && avail > 0) { out.push(`（${n}個は無理なので、あるだけの${avail}個にした）`); n = avail; }
      }
      if (!(n > 0)) throw new Error(cmd === 'load' ? `倉庫から積める${GOODS[good].name}がない（倉庫 ${Math.floor(wh?.stock[good] || 0)}個、積載の空き ${G.cargoCap(m) - G.cargoUsed(m)}）` : `${GOODS[good].name}を積んでいない`);
      after(G.warehouse(world, m.id, good, (cmd === 'load' ? 1 : -1) * n));
      out.push(cmd === 'load' ? `倉庫から${m.name}へ ${GOODS[good].name}を${n}個積んだ（倉庫の残り ${Math.floor(wh.stock[good] || 0)}）` : `${m.name}から倉庫へ ${GOODS[good].name}を${n}個下ろした（倉庫 ${Math.floor(wh.stock[good] || 0)}個）`);
      break;
    }
    case 'road': {
      const e = world.edges.find((x) => x.id === Number(pos[0]));
      if (!e) throw new Error('道の番号を指定（map で一覧）');
      if (pos[1] !== 'confirm') { out.push(`道 #${e.id} の整備: ${Math.round(e.len * BUILDINGS.road.costPerLength)}銀。確定するには: road ${e.id} confirm`); break; }
      out.push(`整備した（${after(G.upgradeRoad(world, pos[0])).cost}銀）`);
      break;
    }
    case 'order': {
      if (pos[0] === 'list' || !pos[0]) {
        // -m で1人だけ（25回目の Opus: 全員分が出ていた）
        for (const x of opts.merchant ? [G.getMerchant(world, opts.merchant)].filter(Boolean) : world.player.merchants) {
          if (!x.order) { out.push(`#${x.id} ${x.name}: 定期便なし`); continue; }
          const days = Math.max(1, world.day - x.order.since);
          out.push(`#${x.id} ${x.name}: ${x.order.paused ? '（停止中）' : ''}${days}日で損益 ${Math.round(x.order.profit || 0)}銀（1日あたり ${fmt((x.order.profit || 0) / days)}）`);
          for (const a of x.order.alts || []) out.push(`    臨時の便#${a.id} ${a.from}〜${a.until}日目${x.order.altOn === a.id ? '（今はこちらを回っている）' : ''}: ${a.stops.map((s) => world.cities[s.city].name).join(' → ')}（消すなら order alt clear ${a.id} -m ${x.id}）`);
          for (const w of G.orderShiftWarnings(world, x)) out.push(`    ${w.covered ? "✔" : "⚠"} ${w.text}`);
          for (const st of G.baseStops(x.order)) out.push(`    ${world.cities[st.city].name}(${st.city}): ${[...(st.sell || []).map((v) => `売 ${GOODS[v.good].name}(最低${v.min})`), ...(st.buy || []).map((v) => `買 ${GOODS[v.good].name}×${v.qty}(上限${v.max === Infinity || v.max === null ? 'なし' : v.max})`), ...(st.unload || []).map((g) => `下ろす ${GOODS[g].name}`), ...(st.load || []).map((g) => { const [id, n] = String(g).split('*'); return `積む ${GOODS[id]?.name || id}${n ? `（${n}個まで）` : ''}`; }), ...(st.waitFor ? [`${GOODS[st.waitFor.good]?.name || st.waitFor.good}が${st.waitFor.qty}個積めるまで待つ`] : [])].join('、') || '何もしない'}`);
        }
        break;
      }
      // 定期便のある商人が複数いるときは、どの商人か必ず指定してもらう（取り違えを防ぐ）
      if (['clear', 'pause', 'resume'].includes(pos[0]) && !opts.merchant && world.player.merchants.filter((x) => x.order).length > 1) throw new Error(`定期便のある商人が複数いるので -m <番号> で指定する（order list で一覧）`);
      const m = pos[0] === 'clear' && !opts.merchant && world.player.merchants.filter((x) => x.order).length === 1 ? world.player.merchants.find((x) => x.order) : pickMerchant(world, opts);
      if (pos[0] === 'edit') {
        if (m.order?.altOn) throw new Error('今は臨時の便を回っている。いつもの便を書き直すなら、期間が過ぎてから（臨時の便を変えるなら order alt）');
        // order edit <停泊地の番号> "<町 ...>": 1つの停泊地だけ書き直す
        if (!m.order) throw new Error('定期便がない');
        const i = Number(pos[1]) - 1;
        if (!(i >= 0 && i < m.order.stops.length) || !pos[2]) throw new Error(`order edit <1〜${m.order.stops.length}> "<町 sell:... buy:...>" [-m 番号]`);
        const next = parseStop(pos[2], world);
        // 停泊地の町を変える書き換えは、取り違えを防ぐため --force が要る
        if (next.city !== m.order.stops[i].city && !opts.force) throw new Error(`停泊地${i + 1}は${world.cities[m.order.stops[i].city].name}。別の町（${world.cities[next.city]?.name || next.city}）に変えるなら --force を付ける（番号は停泊地の順: ${m.order.stops.map((s, j) => `${j + 1}=${world.cities[s.city].name}`).join(' ')}）`);
        const stops = m.order.stops.map((x, j) => (j === i ? next : x));
        const problem = G.validateOrder(world, { ...m.order, stops });
        if (problem) throw new Error(problem);
        m.order.stops = stops;
        out.push(`停泊地${i + 1}を書き直した: ${world.cities[m.order.stops[i].city].name}`);
        break;
      }
      if (pos[0] === 'clear') { after(G.clearOrder(world, m.id)); out.push('定期便を解除した'); break; }
      if (pos[0] === 'resume') { after(G.resumeOrder(world, m.id)); out.push('定期便を再開した'); break; }
      if (pos[0] === 'pause') { const r = after(G.pauseOrderAtNext(world, m.id, pos[1] || null)); out.push(r.now ? '定期便を止めた（今いる町で待機）' : pos[1] ? `${world.cities[pos[1]].name}に着いたら止まる（売買は済ませる）` : '次に町に着いたら止まる'); break; }
      if (pos[0] === 'alt') {
        if (pos[1] === 'clear') { after(G.clearOrderAlt(world, m.id, pos[2] ?? null)); out.push(pos[2] ? `臨時の便#${pos[2]}の予約を消した` : '臨時の便の予約を全部消した'); break; }
        let stops = pos.slice(1).map((p) => parseStop(p, world));
        let from = opts.from, until = opts.until, shift;
        if (opts.shift !== undefined) {
          const x = G.knownShifts(world).find((s) => s.id === Number(opts.shift));
          if (!x) throw new Error(`予告 #${opts.shift} はない（shifts で一覧）`);
          // 停泊地を省くと、いつもの便の低迷する町を隊商市の町に替えた下書き（同じ長い停泊地を商人ごとに打ち直していた。20回目の Sol）
          if (!stops.length) { stops = G.altDraftFor(world, m, x); if (!stops) throw new Error(`この便は${GOODS[x.good].name}を売らない。停泊地を書いて予約する`); }
          const win = G.altWindowFor(world, m, x, stops);
          if (win.late && opts.from === undefined) throw new Error(`${win.ready > world.day ? `${world.cities[stops[0].city].name}に戻れるのは${win.ready}日目。` : ''}${world.cities[x.fair].name}まで約${win.days}日かかり、市が閉じる前に着けない`);
          if (opts.from === undefined) from = win.from;
          if (opts.until === undefined) until = win.until;
          shift = x.id;
        }
        if (!stops.length) throw new Error('停泊地を書く（--shift なら省ける）');
        if (from === undefined || until === undefined) throw new Error('order alt "<町 ...>" "<町 ...>" --shift <予告の番号>（または --from <日> --until <日>）');
        after(G.setOrderAlt(world, m.id, { stops, from, until, shift }));
        out.push(`臨時の便: ${from}〜${until}日目に ${stops.map((s) => world.cities[s.city].name).join(' → ')}（今は${world.day}日目。期間に入ってから町に着いたとき（または町を出るとき）切り替わり、過ぎたら元の便に戻る）`);
        out.push(...G.drainEvents(world).map(eventLine));
        break;
      }
      if (pos[0] !== 'add') throw new Error('order add|alt|list|pause|resume|clear');
      const stops = pos.slice(1).map((p) => parseStop(p, world));
      const replaced = !!m.order;
      after(G.setOrder(world, m.id, { stops, guards: Number(opts.guards || 0), reserve: opts.reserve !== undefined ? Number(opts.reserve) : undefined, hold: 'hold' in opts }));
      if ('hold' in opts) out.push('（すぐには出発しない。order resume で動き出す）');
      if (replaced) out.push('（以前の定期便は置き換えた）');
      out.push(`定期便: ${stops.map((s) => world.cities[s.city].name).join(' → ')} → …`);
      // 売り先が買い取らない品は、先に知らせる（町が育つと買い取るものもある）
      for (const s of stops) for (const x of s.sell || []) if (world.cities[s.city] && !G.cityWants(world.cities[s.city], x.good)) out.push(`⚠ ${world.cities[s.city].name}は今は${GOODS[x.good]?.name || x.good}を買い取らない（売れずに持ち越しになる）`);
      out.push(...G.drainEvents(world).map(eventLine));
      break;
    }
    case 'shop': {
      const sc = world.scenario;
      const pl = world.player;
      const max = G.merchantCap(world);
      out.push('■ 投資の費用と条件');
      out.push(`商人を雇う（hire confirm [--at 町]）: ${pl.merchants.length >= max ? `上限（${max}人）に達している` : `次は ${G.hireCost(world)} 銀（150×今の人数${pl.mods?.hireCost ? `×${pl.mods.hireCost}（家訓）` : ''}。雇うほど高くなる）。商人が滞在している町か、定期便が回っている町で雇える。今の上限は${max}人${G.branchesAllowed(world) ? '（商館を開くと1人ずつ増える）' : ''}。給金は1人1日${G.BALANCE.merchantWage}銀`}`);
      out.push('輸送手段（transport <種類> confirm。今のものは半額で下取り）:');
      for (const [k, t] of Object.entries(TRANSPORTS)) {
        if (!world.allowedTransports.includes(k)) { out.push(`  ${t.name}(${k}): このシナリオでは使えない`); continue; }
        const where = Object.values(world.cities).filter((c) => G.canBuyTransportAt(world, c, k)).map((c) => c.name);
        out.push(`  ${t.name}(${k}): ${t.cost}銀  積載${t.cap}  速さ${t.speed}  維持費${t.upkeep}/日  通れる道: ${t.modes.map((x) => G.ROUTE_KINDS[x].name).join('・')}  買える町: ${t.cost ? where.join('、') || 'なし' : '（最初から持っている）'}`);
      }
      const bs = (sc.buildings || []).filter((b) => BUILDINGS[b]?.recipes);
      out.push(`工房（build <種類> confirm [--at 町]）: ${bs.length ? '同じ種類は1つの町に1つまで。倉庫が付く。材料は倉庫から使い、足りなければ市場で自動仕入れ（基準価格の1.5倍まで、手元の銀20は残す）' : 'このシナリオでは建てられない'}`);
      for (const b of bs) out.push(`  ${BUILDINGS[b].name}(${b}): ${G.buildCost(world, b)}銀  維持費${BUILDINGS[b].upkeep}/日  1日${BUILDINGS[b].batches}回  ${G.recipeList(world, b).map((r) => G.recipeLine(r)).join(' / ')}${G.neededTech(world, 'buildings', b) ? `  ✖ 要: 技術「${G.neededTech(world, 'buildings', b)}」` : ''}`);
      out.push(`道の整備（road <番号> confirm）: ${(sc.buildings || []).includes('road') ? `小道を街道にする。距離×${BUILDINGS.road.costPerLength}銀` : 'このシナリオではできない'}`);
      out.push(`商館（branch confirm [--at 町]）: ${G.branchesAllowed(world) ? `次は ${G.branchCost(world)}銀（2つ目からは倍々）＋維持費${G.BALANCE.branchUpkeep}/日。「${G.BALANCE.tierNames[G.BALANCE.branchMinTier]}」以上の町に1つずつ。雇える商人 +1、その町の倉庫が使え、相場がいつでも分かる。今あるもの: ${(pl.branches || []).map((id) => world.cities[id].name).join('・') || 'なし'}` : 'このシナリオでは建てられない'}`);
      if (G.settlersAllowed(world)) out.push(`開拓団（settle <交易所> confirm [-m 番号]）: 「${G.BALANCE.tierNames[G.BALANCE.settlerMinTier]}」以上の町から${G.BALANCE.settlerGroup}人を交易所へ運ぶ。1団目 ${G.BALANCE.settlerCost}銀、交易所ごとに${G.BALANCE.settlerCostStep}ずつ高くなり${G.BALANCE.settlerMax}団まで。受け入れる交易所に、家の空き地と、食べ物3種類が届いて糖度${G.BALANCE.settlerGlucose}以上の食卓が要る${Object.values(world.cities).filter((c) => c.founded).map((c) => `
  ${c.name}(${c.id}): 住みついた${c.settlerGroups || 0}団${world.player.merchants.filter((m) => m.settlers?.to === c.id).length ? `・運んでいる途中${world.player.merchants.filter((m) => m.settlers?.to === c.id).length}団` : ''} 次 ${G.settlerCost(world, c.id)}銀  ${G.settleCheck(world, c.id) ? `✖ ${G.settleCheck(world, c.id)}` : '○ 今なら住みつける'}`).join('')}`);
      out.push(`護衛: 1人1日${G.BALANCE.guardWage}銀（travel <町> --guards n）`);
      break;
    }
    case 'heirlooms': case 'inherit': {
      out.push('■ 家訓（シナリオを達成すると解放。新しいシナリオを始めるとき --heirloom <名前> で1つだけ持っていける）');
      out.push(heirloomList());
      out.push(world.player.heirloom ? `今の家訓: ${G.heirloomText(world.player.heirloom)}` : '今は家訓なし');
      break;
    }
    case 'donate': {
      const m = { city: hereCity(world, opts) };
      if (!world.cities[m.city]) throw new Error(`不明な町: ${m.city}`);
      const cost = G.donateCost(world, m.city);
      const warn = G.spendWarning(world, cost);
      if (warn && pos[0] !== 'confirm') out.push(`⚠ 寄進すると${warn}`);
      if (pos[0] !== 'confirm') { out.push(`${world.cities[m.city].name}への寄進: ${cost}銀。${G.BALANCE.donateDays}日間、成長が${Math.round((G.BALANCE.donateGrowth - 1) * 100)}%早まる（糖度が40以上で成長しているときだけ）。確定するには: donate confirm`); break; }
      out.push(`寄進した（${after(G.donate(world, m.city)).cost}銀）`);
      break;
    }
    case 'district': out.push(districtText(world, pos[0] || pickMerchant(world, opts).city || pickMerchant(world, opts).travel?.to)); break;
    case 'buildable': out.push(buildableText(world, cityArg(world, pos[0]) || hereCity(world, opts))); break;
    case 'place': {
      const type = pos[0];
      const p = G.PRODUCERS[type];
      if (!p) throw new Error(`種類を指定（一覧は buildable）`);
      const xy = G.parseCoord(pos[1]);
      if (!xy) throw new Error('座標を A1〜L12 の形で指定（区画は district で見られる）');
      const at = hereCity(world, opts);
      if (!at) throw new Error('どの町か --at <町id> で指定する');
      const cost = G.producerCost(world, type);
      if (pos[2] !== 'confirm') {
        const why = G.placeCheck(world.cities[at], G.cityTier(world.cities[at]), type, xy[0], xy[1]);
        out.push(why ? `✖ ${pos[1]} には置けない: ${why}` : `${world.cities[at].name}の ${pos[1]} に${p.name}: ${cost}銀。${GOODS[p.good].name}が毎日 +${p.rate}（町の市場に出る）。確定するには: place ${type} ${pos[1]} confirm`);
        break;
      }
      after(G.placeProducer(world, at, type, xy[0], xy[1]));
      out.push(`建設を始めた（${cost}銀）。${G.BALANCE.producerBuildDays}日後から動き出す。維持費 ${G.BALANCE.producerUpkeep}銀/日`);
      break;
    }
    case 'civic': {
      const type = pos[0];
      const cv = G.CIVICS[type];
      if (!cv || cv.wild) throw new Error(`種類を指定: ${Object.entries(G.CIVICS).filter(([, x]) => !x.wild).map(([k, x]) => `${k}（${x.name}）`).join('、')}`);
      const xy = pos[1] && pos[1] !== 'confirm' ? G.parseCoord(pos[1]) : null;
      const at = hereCity(world, opts);
      if (!pos.includes('confirm')) {
        const why = G.civicCheck(world, at, type);
        out.push(why ? `✖ ${why}` : `${world.cities[at].name}に${cv.name}: ${G.civicCost(world, type)}銀。求める品 ${G.civicWants(type, world.scenario.goods).map((g) => GOODS[g].name).join('・')}。届けるほど成長 最大+${Math.round(cv.growth * 100)}%・${cv.effect}。確定するには: civic ${type}${xy ? ' ' + pos[1] : ''} confirm`);
        break;
      }
      out.push(`建てた（${after(G.buildCivic(world, at, type, xy)).cost}銀）`);
      break;
    }
    case 'demolish': {
      const xy = G.parseCoord(pos[0]);
      if (!xy) throw new Error('座標を A1〜L12 の形で指定');
      const at = hereCity(world, opts);
      if (pos[1] !== 'confirm') { out.push(`${pos[0]} の建物を取り壊す（費用は戻らない）。確定するには: demolish ${pos[0]} confirm`); break; }
      after(G.demolish(world, at, xy[0], xy[1]));
      out.push('取り壊した');
      break;
    }
    case 'branch': {
      const at = hereCity(world, opts);
      const why = G.branchCheck(world, at);
      if (why) throw new Error(why);
      const cost = G.branchCost(world);
      const warn = G.spendWarning(world, cost);
      if (pos[0] !== 'confirm') { out.push(`${warn ? `⚠ ${warn}
` : ''}${world.cities[at].name}に商館を開く: ${cost}銀＋維持費${G.BALANCE.branchUpkeep}/日。雇える商人が${G.merchantCap(world)}人 → ${G.merchantCap(world) + 1}人になり、この町の倉庫が使え、相場がいつでも分かる。確定するには: branch confirm`); break; }
      out.push(`商館を開いた（${after(G.buildBranch(world, at)).cost}銀）。hire confirm で商人を雇える`);
      break;
    }
    case 'settle': {
      const m = pickMerchant(world, opts);
      const to = cityArg(world, pos[0]);
      if (!to || !world.cities[to]) throw new Error('連れていく交易所を指定する（例: settle post1）');
      const why = G.settlerCheck(world, m.id, to);
      if (why) throw new Error(why);
      const cost = G.settlerCost(world, to);
      const warn = G.spendWarning(world, cost);
      const ready = G.settleCheck(world, to);
      if (pos[1] !== 'confirm') { out.push(`${warn ? `⚠ ${warn}
` : ''}${m.name}が${world.cities[m.city].name}から${G.BALANCE.settlerGroup}人の開拓団を連れ出し、${world.cities[to].name}へ運ぶ: ${cost}銀（人は今の町から減る。荷車の${Math.round(G.BALANCE.settlerLoad * 100)}%を使う）。着いた交易所に、家を建てる空き地があり、食卓に食べ物が3種類届いて糖度が${G.BALANCE.settlerGlucose}以上なら住みつく。そろわなければ${G.BALANCE.settlerWait}日待って散る（連れ出してから${G.BALANCE.settlerCarry}日でも散る）。
今の${world.cities[to].name}: ${ready ? `✖ ${ready}` : '○ 住みつける'}
確定するには: settle ${pos[0]} confirm（そのあと travel ${to}）`); break; }
      out.push(`開拓団を連れ出した（${after(G.sendSettlers(world, m.id, to)).cost}銀）。travel ${to} で連れていく`);
      break;
    }
    case 'expand': {
      const at = hereCity(world, opts);
      if (pos[0] !== 'confirm') { const ca = world.cities[at]; out.push(ca.founded && ca.grade !== undefined ? (ca.grade >= 2 ? `${ca.name}はもう大市場` : `${ca.name}を「${G.gradeName(ca.grade + 1)}」に格上げする: ${G.expandCost(world, at)}銀。確定するには: expand confirm`) : `${ca.name}の市場の圏を1マス広げる: ${G.expandCost(world, at)}銀。確定するには: expand confirm`); break; }
      out.push(`広げた（${after(G.expandMarket(world, at)).cost}銀）`);
      break;
    }
    case 'workshops': {
      if (!world.player.buildings.length) { out.push('工房はまだない（build <種類> confirm で建てる。費用は shop）'); break; }
      for (const b of world.player.buildings) {
        const def = BUILDINGS[b.type];
        const wh = world.player.warehouses[b.city];
        out.push(`#${b.id} ${def.name}（${world.cities[b.city].name}）${b.active ? '稼働中' : '停止中'}  自動仕入れ${b.autoBuy ? `あり（手元の銀が${G.BALANCE.autoBuyReserve}を切ると止まる）` : 'なし'}  昨日 ${b.lastMade || 0}回  累計 ${Object.entries(b.made || {}).map(([g, n]) => `${GOODS[g].name}${n}`).join(' ') || 'なし'}`);
        out.push(`   レシピ（${b.recipe ? `「${b.recipe}」だけ` : '上から順に試す'}。1日${def.batches + (world.player.mods?.batchBonus || 0)}回。固定するには workshop ${b.id} recipe <名前>）: ${def.recipes.map((r) => `「${r.name}」${Object.entries(r.in).map(([g, n]) => `${GOODS[g].name}${n}`).join('+')}→${Object.entries(r.out).map(([g, n]) => `${GOODS[g].name}${n}`).join('+')}`).join(' / ')}`);
        out.push(`   材料は倉庫から使い、足りなければ町の市場で買う（基準価格の${b.priceCap ?? 1.5}倍まで。変えるには workshop ${b.id} maxprice <倍率>）。できた品は倉庫に入る（load で積む）。${b.why ? `\n   ⚠ 止まっている理由: ${b.why}` : ''}`);
        out.push(`   倉庫: ${Object.entries(wh?.stock || {}).filter(([, q]) => q >= 1).map(([g, q]) => `${GOODS[g].name}${Math.floor(q)}`).join(' ') || '空'}`);
      }
      break;
    }
    case 'continue': G.continueAfterEnd(world); out.push('目標の後も遊び続ける'); break;
    default: throw new Error(`不明なコマンド: ${cmd}（help で一覧）`);
  }
  const ev = G.drainEvents(world);
  if (ev.length) out.push(...ev.map(eventLine));
  if (world.finished && !world.endShown) {
    world.endShown = true;
    const unlocked = world.finished.win ? G.heirloomFor(world.scenarioId) : null;
    const next = SCENARIO_ORDER[SCENARIO_ORDER.indexOf(world.scenarioId) + 1];
    out.push('', statusText(world), unlocked ? `\n🏯 家訓「${G.heirloomText(unlocked)}」を解放した。` : '', world.finished.win && next ? `次のシナリオ: node cli/toshoki.js new --scenario ${next} --save save-${next}.json [--heirloom <家訓>]（解放した家訓から1つだけ。一覧は heirlooms）` : '');
  }
  res.text = out.join('\n');
  return res;
}

function needIdle(world, opts) {
  const m = pickMerchant(world, opts);
  if (m.travel) throw new Error(`${m.name}は移動中（${world.cities[m.travel.to].name}まで あと約${Math.max(1, Math.ceil(m.travel.totalDays - m.travel.elapsed))}日。${m.order ? `定期便の商人は町に着くとすぐ出発するので、操作したいなら order pause ${m.travel.to} -m ${m.id} で止める` : `wait <日数> -m ${m.id} で着くまで進める`}）`);
  return m;
}

function load(path) {
  if (!path) throw new Error('--save <ファイル> が必要');
  if (!existsSync(path)) throw new Error(`${path} がない。new で始める`);
  return G.deserialize(readFileSync(path, 'utf8'));
}

function main(argv) {
  const { opts, pos } = parseArgs(argv);
  const [cmd = 'help', ...rest] = pos;
  const log = (entry) => { if (opts.save) appendFileSync(`${opts.save}.log.jsonl`, JSON.stringify(entry) + '\n'); };
  try {
    if (cmd === 'help') return print(rest[0] === 'rules' ? RULES : HELP, opts);
    if ((cmd === 'heirlooms' || cmd === 'inherit') && !opts.save) return print(heirloomList(), opts);
    if (cmd === 'scenarios') return print([...SCENARIO_ORDER.map((id) => `${id}: ${SCENARIOS[id].no}. ${SCENARIOS[id].title}（期限 ${SCENARIOS[id].deadline}日）`), 'free: フリープレイ（--seed ごとに地図が変わる）'].join('\n'), opts);
    if (cmd === 'new') {
      const sc = opts.scenario || 's1';
      let hk = opts.heirloom || (opts.heirlooms || '').split(',').filter(Boolean)[0] || null;
      // 家訓は日本語の名前でもよい
      if (hk && !HEIRLOOMS[hk]) { const found = Object.entries(HEIRLOOMS).find(([, v]) => v.name === hk); if (found) hk = found[0]; }
      if (hk && !HEIRLOOMS[hk]) throw new Error(`不明な家訓: ${hk}\n${heirloomList()}`);
      const world = G.createWorld(sc, { seed: opts.seed || 1, heirloom: hk });
      const ev = G.drainEvents(world);
      writeFileSync(opts.save, G.serialize(world));
      log({ t: Date.now(), cmd: 'new', args: rest, scenario: sc, seed: opts.seed || 1 });
      return print([`■ ${world.scenario.no}. ${world.scenario.title}`, ...ev.map((e) => e.text), '', statusText(world), '', 'help でコマンド一覧、help rules でルール。'].join('\n'), opts);
    }
    const world = load(opts.save);
    const before = { day: world.day, silver: world.player.silver };
    const res = run(world, cmd, rest, opts);
    writeFileSync(opts.save, G.serialize(world));
    log({ t: Date.now(), cmd, args: rest, m: opts.merchant, day0: before.day, day: world.day, silver0: Math.round(before.silver), silver: Math.round(world.player.silver), ok: true, finished: world.finished });
    return print(res.text, opts, { day: world.day, silver: Math.round(world.player.silver), finished: world.finished });
  } catch (e) {
    log({ t: Date.now(), cmd, args: rest, ok: false, error: e.message });
    print(`✖ ${e.message}`, opts, { error: e.message });
    process.exitCode = 1;
  }
}

function print(text, opts, data = {}) {
  if (opts.json) console.log(JSON.stringify({ text, ...data }));
  else console.log(text);
}

if (process.argv.length > 2) main(process.argv.slice(2));
else {
  // 対話モード
  console.log('糖商記 対話モード。最初に "new --scenario s1 --save run.json"、以降は "status" などと打つ。終了は exit。');
  let save = null;
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  rl.on('line', (line) => {
    const args = line.match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [];
    if (args[0] === 'exit') return rl.close();
    const si = args.indexOf('--save');
    if (si >= 0) save = args[si + 1];
    else if (save) args.push('--save', save);
    if (args.length) main(args);
    rl.prompt();
  });
}
