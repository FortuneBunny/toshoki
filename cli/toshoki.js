#!/usr/bin/env node
// 糖商記 CLI版。1回の実行で1コマンド、状態はセーブファイルに残す。
//   node cli/toshoki.js new --scenario s2 --seed 42 --save run.json
//   node cli/toshoki.js --save run.json status
// 引数なしで起動すると対話モード（REPL）になる。
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import * as G from '../src/core/index.js';

const { GOODS, TRANSPORTS, BUILDINGS, SCENARIOS, SCENARIO_ORDER, HEIRLOOMS } = G;

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
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else if (a === '-m') opts.merchant = argv[++i];
    else pos.push(a);
  }
  return { opts, pos };
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
  throw new Error('商人が複数いるので -m <番号> で指定する（merchants で一覧）');
}

// ---------- 画面 ----------
function statusText(world) {
  const pl = world.player;
  const out = [];
  out.push(`■ ${world.scenario.no}. ${world.scenario.title}   ${G.dateString(world.day)}（${world.day}日目 / 期限 ${world.scenario.deadline}日）`);
  out.push(`銀 ${Math.floor(pl.silver)}   資産 ${Math.floor(G.netWorth(world))}   評判 Lv${pl.repLevel}（${pl.rep}）   連続黒字 ${pl.streak}`);
  if (world.scenario.goods.some((id) => ['sea', 'river'].length) && world.edges.some((e) => e.monsoon)) out.push(`季節: ${G.SEASON_NAMES[G.seasonOf(world)]}`);
  out.push('目標:');
  for (const g of G.goalsStatus(world)) out.push(`  ${g.done ? '✔' : '□'} ${g.text}  [${'█'.repeat(Math.round(g.p * 10))}${'░'.repeat(10 - Math.round(g.p * 10))}] ${Math.round(g.p * 100)}%`);
  out.push('商人:');
  for (const m of pl.merchants) out.push('  ' + merchantLine(world, m));
  const active = world.contracts.filter((c) => !c.done && !c.failed);
  if (active.length) {
    out.push('大口注文:');
    for (const c of active) out.push(`  #${c.id} ${world.cities[c.city].name}(${c.city}) ${gname(c.good)} ${c.delivered}/${c.qty}  残り${c.deadline - world.day}日  報酬 ${c.reward}`);
  }
  if (world.scenario.tutorial) {
    const next = world.scenario.tutorial.find((t) => !t.done(world));
    if (next) out.push(`手引き: ${next.text}`);
  }
  if (world.finished) out.push(world.finished.win ? `🏆 達成！ランク ${world.finished.rank}` : `期限切れ（ランク C）`);
  return out.join('\n');
}

function merchantLine(world, m) {
  const t = TRANSPORTS[m.transport];
  const cargo = Object.entries(m.cargo).map(([id, q]) => `${GOODS[id].name}${q}`).join(' ') || '空';
  const where = m.travel
    ? `移動中 → ${world.cities[m.travel.to].name}（あと約${Math.max(1, Math.ceil(m.travel.totalDays - m.travel.elapsed))}日${m.guards ? `、護衛${m.guards}` : ''}）`
    : `${world.cities[m.city].name}(${m.city})に滞在`;
  const order = m.order ? (m.order.paused ? ' [定期便:停止中]' : ' [定期便]') : '';
  return `#${m.id} ${m.name} ${t.name} ${G.cargoUsed(m)}/${t.cap}  ${where}${order}  積荷: ${cargo}  累計損益 ${Math.round(m.lifetime)}`;
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
    rows.push([gname(id), have ? `${have}${m.cost[id] ? `(@${fmt(m.cost[id])})` : ''}` : '', sell ? fmt(sell) : '買取なし', buy ? fmt(buy) : '在庫なし', stock, fmt(G.dailyDemand(city, id), 1), fmt(GOODS[id].base, 0), trend]);
  }
  const t = TRANSPORTS[m.transport];
  return [
    `■ ${city.name}の市場（${G.tierName(G.cityTier(city))}、人口 ${Math.floor(city.pop)}、糖度 ${Math.round(city.glucose)}${city.rush ? '、🍬ラッシュ中' : ''}${city.crash ? '、💥クラッシュ中' : ''}）  ${m.name} 積載 ${G.cargoUsed(m)}/${t.cap}  銀 ${Math.floor(world.player.silver)}`,
    table(['品物', '積荷(仕入値)', '売値', '買値', '町の在庫', '1日の消費', '基準', '相場の推移'], rows, [2, 3, 4, 5, 6]),
    '※ 売値・買値は1個目の値段。たくさん売るほど売値は下がり、たくさん買うほど買値は上がる。正確な合計は quote で確認できる。',
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
    const ageText = age === null ? '未訪問' : age === 0 ? '今' : `${age}日前`;
    return [`${c.name}(${c.id})`, ageText, ...cells];
  });
  return [
    '■ 知っている相場（中値。手数料抜き。×=その町では買い取らない）',
    table(['町', '情報', ...ids.map((id) => GOODS[id].name)], rows, ids.map((_, i) => i + 2)),
    '※ 情報は商人が最後にその町にいた時点のもの。今の相場とは違うかもしれない。',
  ].join('\n');
}

function cityText(world, id) {
  const c = world.cities[id];
  if (!c) throw new Error(`不明な町: ${id}`);
  const k = world.player.knowledge[id];
  const here = world.player.merchants.some((m) => m.city === id);
  const out = [`■ ${c.name}(${id})  ${G.tierName(G.cityTier(c))}  人口 ${here ? Math.floor(c.pop) : k ? `${Math.floor(k.pop)}（${world.day - k.day}日前）` : '?'}`];
  if (here) {
    const tierIdx = G.cityTier(c);
    const nextPop = G.BALANCE.tierPops[tierIdx + 1];
    out.push(`糖度 ${Math.round(c.glucose)}（目標値 ${Math.round(c.glucoseTarget)}）  1日の人口増加率 ${(G.growthPerDay(c) * 100).toFixed(2)}%${nextPop ? `  次の段階まで 人口 ${nextPop}` : ''}`);
    out.push(`糖度の目安: 40未満=飢え（人口減） 40〜110=安定（成長） 110〜150=活況（急成長） 150以上=シュガーラッシュ → その後クラッシュ`);
    out.push(`暮らしの豊かさ（非糖の品の充足）: ${Math.round(c.luxury * 100)}%`);
    if (c.rush) out.push(`🍬 シュガーラッシュ中（あと${c.rush}日）: 甘味の需要と売値が上がる`);
    if (c.crash) out.push(`💥 シュガークラッシュ中（あと${c.crash}日）: 甘味が売れず、糖度に効かない`);
    const prod = Object.entries(c.produces).map(([g, r]) => `${GOODS[g].name}${fmt(r)}`).join(' ') || 'なし';
    out.push(`特産（1日の生産量）: ${prod}`);
    const demand = world.scenario.goods.filter((g) => G.dailyDemand(c, g, false) > 0).map((g) => `${GOODS[g].name}${fmt(G.dailyDemand(c, g, false))}`).join(' ');
    out.push(`需要（1日の基本消費量）: ${demand || 'なし'}`);
  } else {
    out.push('（自分の商人がいないので、詳しいことは分からない）');
    if (k?.glucose !== undefined) out.push(`最後に見た糖度: ${Math.round(k.glucose)}（${world.day - k.day}日前）`);
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

function mapText(world) {
  const out = ['■ 地図（町と道）'];
  for (const c of Object.values(world.cities)) out.push(`  ${c.name}(${c.id})  位置(${c.x},${c.y})${c.tags.length ? `  [${c.tags.join(',')}]` : ''}`);
  out.push('道（日数はロバの場合の目安）:');
  for (const e of world.edges) {
    const days = Math.max(1, Math.round(e.len / TRANSPORTS.donkey.speed / (e.kind === 'desert' ? 0.6 : 1)));
    const ok = TRANSPORTS.donkey.modes.includes(e.kind) ? `約${days}日` : 'ロバは不可';
    out.push(`  #${e.id} ${world.cities[e.a].name} ⇔ ${world.cities[e.b].name}  ${G.ROUTE_KINDS[e.kind].name}  距離${e.len}  ${ok}${e.danger ? `  危険度${e.danger}` : ''}${e.monsoon ? '  季節風' : ''}`);
  }
  return out.join('\n');
}

function parseTradeLines(pos) {
  // buy wheat 20 sell dates 10 ...
  const lines = [];
  for (let i = 0; i < pos.length; i += 3) {
    const [act, good, n] = [pos[i], pos[i + 1], pos[i + 2]];
    if (!['buy', 'sell'].includes(act)) throw new Error(`"${act}" は buy か sell`);
    if (!GOODS[good]) throw new Error(`不明な品物: ${good}`);
    const q = n === 'all' ? Infinity : parseInt(n, 10);
    if (!(q > 0)) throw new Error(`数量が不正: ${n}`);
    lines.push({ good, qty: act === 'buy' ? q : -q });
  }
  return lines;
}

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
function parseStop(str) {
  const [city, ...parts] = str.trim().split(/\s+/);
  const stop = { city, sell: [], buy: [], unload: [], load: [] };
  for (const p of parts) {
    const [kind, list] = p.split(':');
    for (const item of (list || '').split(',').filter(Boolean)) {
      if (kind === 'sell') { const [good, min] = item.split('@'); stop.sell.push({ good, min: min ? Number(min) : 0 }); }
      else if (kind === 'buy') { const [gq, max] = item.split('@'); const [good, qty] = gq.split('*'); stop.buy.push({ good, qty: Number(qty || 999), max: max ? Number(max) : Infinity }); }
      else if (kind === 'unload' || kind === 'load') stop[kind].push(item);
      else throw new Error(`停泊地の書き方が不正: ${p}`);
    }
  }
  return stop;
}

const HELP = `糖商記 〜Great Glucose Empire〜  CLI版

使い方: node cli/toshoki.js --save <ファイル> <コマンド> [引数]

【はじめる】
  new --scenario s1 --seed 1 --save run.json   新しいゲーム（シナリオ一覧は scenarios）
  scenarios                                    シナリオ一覧

【見る】
  status            日付、銀、目標、商人、大口注文
  market            今いる町の市場（売値・買値・在庫・相場の推移）
  prices            知っている全部の町の相場と、その情報の古さ
  city <町id>       町の詳細（糖度、人口、特産、需要、道）
  map               町と道の一覧
  merchants         商人の一覧
  route <町id>      そこまでの経路と日数
  log [n]           最近の出来事
  ledger            帳簿（収支、取引の成績）
  help rules        ルールの説明

【動く】（商人が複数いるときは -m <番号> を付ける）
  quote buy wheat 20 sell dates 10    取引の見積もり（確定しない）
  trade buy wheat 20 sell dates 10    取引を確定（数量に all も使える）
  travel <町id> [--guards n]          出発して、到着か事件まで日を進める
  wait <日数>                          日を進める（重要な出来事で止まる）
  hire                                 今いる町で商人を雇う
  transport <種類>                     輸送手段を買い替える（camel, cart, dhow, carrack）
  build <種類>                         今いる町に工房を建てる（mill, confectionery, winery, malthouse）
  workshop <番号> on|off|autobuy|noautobuy
  load <品物> <数> / unload <品物> <数>  倉庫との積み下ろし
  road <道の番号>                      小道を街道に整備する
  order add "<町> sell:品@最低値 buy:品*数@上限値 unload:品 load:品" "<町> ..."
                                       定期便を設定（停泊地を2つ以上）。例:
                                       order add "mugi buy:wheat*20@3" "kohaku sell:wheat@5"
  order clear | order resume

--json を付けると結果を JSON で出す。`;

const RULES = `【ルールの説明】
・目的はシナリオごとの目標を期限内に達成すること。早いほどランクが上がる（S/A/B）。
・町ごとに品物の在庫があり、在庫が少ないほど高く、多いほど安い。1個売り買いするたびに値段が動く。
・あなたが知っている他の町の相場は、商人が最後にいた時点のもの。移動している間に変わる。
・町には「糖度」がある。食べ物と甘味が届くと上がり、人口が増える。
  - 1種類の食べ物だけでは糖度は上がり切らない。色々な食べ物を届けると伸びる。
  - 甘味（蜂蜜、粗糖、白糖、菓子など）は糖度を大きく押し上げる。
  - 糖度が150を超えると「シュガーラッシュ」: 数日間、甘味が飛ぶように売れる。
  - ラッシュの後は「シュガークラッシュ」: しばらく甘味が売れず、町の成長が止まる。
・町は人口に応じて 集落→村→町→都市→大都市 と育ち、育つと新しい品の需要が生まれる。
・売って利益が出ると評判が上がり、黒字が続くほど多く上がる。評判が上がると手数料が下がる。
・出発時に知っていた相場より高く売れると「読み的中」。
・大口注文: 期限内に指定数を売ると、代金とは別に報酬が出る。
・商人の給金と輸送手段の維持費が毎日かかる。
・砂漠では隊商が食べ物（なつめやし・干しぶどう・キビ・麦・米）を毎日食べる。尽きると遅れ、積荷を失う。
・危険な道では盗賊が出る。護衛を雇う（1人1日2銀）と撃退できることがある。
・定期便を設定すると、商人が自動で売り買いと移動を繰り返す。最低売値・上限買値で赤字を防げる。`;

// ---------- コマンド ----------
function run(world, cmd, pos, opts) {
  const res = { text: '', data: null, world };
  const out = [];
  const after = (r) => {
    if (r && r.ok === false) throw new Error(r.error);
    return r;
  };
  switch (cmd) {
    case 'status': out.push(statusText(world)); break;
    case 'market': out.push(marketText(world, needIdle(world, opts))); break;
    case 'prices': out.push(pricesText(world)); break;
    case 'city': out.push(cityText(world, pos[0] || pickMerchant(world, opts).city)); break;
    case 'map': out.push(mapText(world)); break;
    case 'merchants': out.push(world.player.merchants.map((m) => merchantLine(world, m)).join('\n')); break;
    case 'route': {
      const m = pickMerchant(world, opts);
      const r = G.routeInfo(world, m.id, pos[0]);
      out.push(r ? `${r.path.map((id) => world.cities[id].name).join(' → ')}  約${r.days}日${r.desertDays ? `（砂漠${r.desertDays}区間）` : ''}${r.danger ? `  最大危険度${r.danger}` : ''}` : `${TRANSPORTS[m.transport].name}では行けない`);
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
      for (const r of pv.rows) out.push(`  ${r.qty > 0 ? '買' : '売'} ${gname(r.good)} ×${Math.abs(r.qty)}  ${r.total > 0 ? '+' : ''}${fmt(r.total)} 銀（1個あたり ${fmt(Math.abs(r.total / r.qty))}）`);
      out.push(`合計 ${pv.silverDelta >= 0 ? '+' : ''}${fmt(pv.silverDelta)} 銀 → 取引後の銀 ${Math.floor(world.player.silver + pv.silverDelta)}  積載 ${pv.cargoAfter}/${G.cargoCap(m)}`);
      if (!pv.ok) out.push('✖ ' + pv.errors.join(' / '));
      break;
    }
    case 'trade': {
      const m = needIdle(world, opts);
      const lines = resolveAll(world, m, parseTradeLines(pos));
      if (!lines.length) throw new Error('取引する数量が0');
      const r = after(G.trade(world, m.id, lines));
      for (const row of r.rows) out.push(`  ${row.qty > 0 ? '買' : '売'} ${gname(row.good)} ×${Math.abs(row.qty)}  ${row.total > 0 ? '+' : ''}${fmt(row.total)} 銀`);
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
      const r = after(G.travel(world, m.id, pos[0], { guards: Number(opts.guards || 0) }));
      out.push(`${m.name}が${world.cities[pos[0]].name}へ出発（約${r.days}日）`);
      const adv = G.advance(world, r.days + 30, { stopOn: new Set(['arrive', 'victory', 'defeat', 'robbed', 'starve', 'orderStuck']) });
      out.push(...adv.events.map(eventLine));
      if (!m.travel && m.city === pos[0]) out.push('', marketText(world, m));
      break;
    }
    case 'wait': {
      const n = Math.max(1, Math.min(120, Number(pos[0] || 1)));
      const adv = G.advance(world, n);
      out.push(...adv.events.map(eventLine), `（${world.day}日目）`);
      break;
    }
    case 'hire': out.push(`雇った（${after(G.hireMerchant(world, pickMerchant(world, opts).city)).cost}銀）`); break;
    case 'transport': out.push(`購入した（差額 ${Math.round(after(G.buyTransport(world, needIdle(world, opts).id, pos[0])).price)}銀）`); break;
    case 'build': out.push(`建てた（工房 #${after(G.build(world, needIdle(world, opts).city, pos[0])).building}）`); break;
    case 'workshop': {
      const map = { on: { active: true }, off: { active: false }, autobuy: { autoBuy: true }, noautobuy: { autoBuy: false } };
      after(G.setBuilding(world, pos[0], map[pos[1]] || {}));
      out.push('設定した');
      break;
    }
    case 'load': case 'unload': {
      const m = needIdle(world, opts);
      after(G.warehouse(world, m.id, pos[0], (cmd === 'load' ? 1 : -1) * Number(pos[1])));
      out.push('移した');
      break;
    }
    case 'road': out.push(`整備した（${after(G.upgradeRoad(world, pos[0])).cost}銀）`); break;
    case 'order': {
      const m = pickMerchant(world, opts);
      if (pos[0] === 'clear') { after(G.clearOrder(world, m.id)); out.push('定期便を解除した'); break; }
      if (pos[0] === 'resume') { after(G.resumeOrder(world, m.id)); out.push('定期便を再開した'); break; }
      if (pos[0] !== 'add') throw new Error('order add|clear|resume');
      const stops = pos.slice(1).map(parseStop);
      after(G.setOrder(world, m.id, { stops }));
      out.push(`定期便: ${stops.map((s) => world.cities[s.city].name).join(' → ')} → …`);
      out.push(...G.drainEvents(world).map(eventLine));
      break;
    }
    case 'continue': G.continueAfterEnd(world); out.push('目標の後も遊び続ける'); break;
    default: throw new Error(`不明なコマンド: ${cmd}（help で一覧）`);
  }
  const ev = G.drainEvents(world);
  if (ev.length) out.push(...ev.map(eventLine));
  if (world.finished && ['travel', 'wait'].includes(cmd)) out.push('', statusText(world), world.finished.win ? '\n家訓を1つ受け継げる: ' + Object.entries(HEIRLOOMS).map(([k, h]) => `${h.name}(${k}): ${h.text}`).join(' / ') : '');
  res.text = out.join('\n');
  return res;
}

function needIdle(world, opts) {
  const m = pickMerchant(world, opts);
  if (m.travel) throw new Error(`${m.name}は移動中（wait で日を進める）`);
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
    if (cmd === 'scenarios') return print(SCENARIO_ORDER.map((id) => `${id}: ${SCENARIOS[id].no}. ${SCENARIOS[id].title}（期限 ${SCENARIOS[id].deadline}日）`).join('\n'), opts);
    if (cmd === 'new') {
      const sc = opts.scenario || 's1';
      const world = G.createWorld(sc, { seed: opts.seed || 1, heirlooms: (opts.heirlooms || '').split(',').filter(Boolean) });
      const ev = G.drainEvents(world);
      writeFileSync(opts.save, G.serialize(world));
      log({ t: Date.now(), cmd: 'new', args: rest, scenario: sc, seed: opts.seed || 1 });
      return print([`■ ${SCENARIOS[sc].no}. ${SCENARIOS[sc].title}`, ...ev.map((e) => e.text), '', statusText(world), '', 'help でコマンド一覧、help rules でルール。'].join('\n'), opts);
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
