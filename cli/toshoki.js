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
  if (notes.length) out.push(`・ 定期便の見送り ${notes.length}件（最新: ${notes[notes.length - 1].text}）`);
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
  out.push(`銀 ${Math.floor(pl.silver)}   資産 ${Math.floor(G.netWorth(world))}（銀＋品物×基準の8割＋輸送手段・工房×半額）   評判 Lv${pl.repLevel}（${pl.rep}）   連続黒字 ${pl.streak}`);
  if (world.scenario.goods.some((id) => ['sea', 'river'].length) && world.edges.some((e) => e.monsoon)) out.push(`季節: ${G.SEASON_NAMES[G.seasonOf(world)]}`);
  const sc = world.scenario;
  out.push(`ランクの基準: S=${Math.floor(sc.deadline * (sc.rankS ?? 0.55))}日以内 / A=${Math.floor(sc.deadline * 0.75)}日以内 / B=期限内`);
  out.push(`このシナリオ: 輸送手段 ${world.allowedTransports.map((t) => TRANSPORTS[t].name).join('・')} / 商人は最大${sc.maxMerchants ?? 4}人 / 工房 ${(sc.buildings || []).filter((b) => BUILDINGS[b]?.recipes).map((b) => BUILDINGS[b].name).join('・') || 'なし'}${(sc.buildings || []).includes('road') ? ' / 道の整備あり' : ''}（費用は shop）`);
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
  if (world.finished) out.push(world.finished.win ? `🏆 達成！ランク ${world.finished.rank}（${world.finished.day}日目）` : `期限切れ（ランク C）`);
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
    let all = '';
    if (have && wants) {
      const total = G.quote(world, city, id, -have);
      const pl = total - (m.cost[id] || 0) * have;
      all = `${Math.round(total)}（${pl >= 0 ? '+' : ''}${Math.round(pl)}）`;
    }
    rows.push([gname(id), have ? `${have}${m.cost[id] ? `(@${fmt(m.cost[id])})` : ''}` : '', sell ? fmt(sell) : '買取なし', all, buy ? fmt(buy) : '在庫なし', stock, fmt(G.dailyDemand(city, id), 1), fmt(GOODS[id].base, 0), trend]);
  }
  const t = TRANSPORTS[m.transport];
  return [
    `■ ${city.name}の市場（${G.tierName(G.cityTier(city))}、人口 ${Math.floor(city.pop)}、糖度 ${Math.round(city.glucose)}${city.rush ? '、🍬ラッシュ中' : ''}${city.crash ? '、💥クラッシュ中' : ''}）  ${m.name} 積載 ${G.cargoUsed(m)}/${t.cap}  銀 ${Math.floor(world.player.silver)}`,
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
  const out = [`■ ${c.name}(${id})  ${G.tierName(G.cityTier(c))}  人口 ${here ? Math.floor(c.pop) : k?.pop !== undefined ? `${Math.floor(k.pop)}（${world.day - k.day}日前）` : '?'}`];
  if (here) {
    const tierIdx = G.cityTier(c);
    const nextPop = G.BALANCE.tierPops[tierIdx + 1];
    out.push(`糖度 ${Math.round(c.glucose)}（目標値 ${Math.round(c.glucoseTarget)}）  1日の人口増加率 ${(G.growthPerDay(c) * 100).toFixed(2)}%${nextPop ? `  次の段階まで 人口 ${nextPop}` : ''}`);
    out.push(`糖度の目安: 40未満=飢え（人口減） 40〜110=安定（成長） 110〜140=活況（急成長） 140以上で甘味を大量に食べるとシュガーラッシュ → その後クラッシュ`);
    const diet = Object.entries(c.diet || {}).sort((a, b) => b[1] - a[1]);
    if (diet.length) out.push(`食卓（糖度への寄与）: ${diet.map(([g, v]) => `${GOODS[g].name} +${Math.round(v * 100)}`).join(' / ')}`);
    const missingFood = world.scenario.goods.filter((g) => GOODS[g].kind === 'food' && G.dailyDemand(c, g, false) > 0 && !(c.diet?.[g] > 0.02));
    out.push(`甘味の摂取: ${Math.round((c.sweetLevel || 0) * 100)}（75以上かつ糖度140以上でシュガーラッシュ）`);
    out.push(`※ 1種類の食べ物で上げられる糖度は50まで、甘味は1種類45まで。種類を増やすほど糖度が上がる。${missingFood.length ? `今足りない食べ物: ${missingFood.map((g) => GOODS[g].name).join('、')}` : ''}`);
    const adv = G.dietAdvice(world, c).slice(0, 6);
    if (adv.length) out.push(`伸びしろ（1日あたりの目安量で、糖度がどれだけ上がるか）: ${adv.map((a) => `${GOODS[a.good].name} 約${fmt(a.perDay, 1)}個/日で+${a.gain}`).join(' / ')}`);
    if (world.scenario.goods.some((g) => GOODS[g].kind === 'goods')) out.push(`暮らしの豊かさ（非糖の品の充足）: ${Math.round(c.luxury * 100)}%`);
    if (c.rush) out.push(`🍬 シュガーラッシュ中（あと${c.rush}日）: 甘味の需要と売値が上がる`);
    if (c.crash) out.push(`💥 シュガークラッシュ中（あと${c.crash}日）: 甘味が売れず、糖度に効かない`);
    const prod = Object.entries(c.produces).map(([g, r]) => `${GOODS[g].name}${fmt(r)}`).join(' ') || 'なし';
    out.push(`特産（1日の生産量）: ${prod}`);
    const demand = world.scenario.goods.filter((g) => G.dailyDemand(c, g, false) > 0).map((g) => `${GOODS[g].name}${fmt(G.dailyDemand(c, g, false))}`).join(' ');
    out.push(`需要（1日の基本消費量）: ${demand || 'なし'}`);
  } else {
    out.push('（自分の商人がいないので、今のことは分からない）');
    if (k?.glucose !== undefined) out.push(`最後に見た糖度: ${Math.round(k.glucose)}（${world.day - k.day}日前）`);
    if (k?.diet) out.push(`最後に見た食卓: ${Object.entries(k.diet).sort((a, b) => b[1] - a[1]).map(([g, v]) => `${GOODS[g].name} +${Math.round(v * 100)}`).join(' / ') || 'なし'}`);
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
  // buy wheat 20 dates 5 sell honey all ...
  const lines = [];
  let act = null;
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] === 'buy' || pos[i] === 'sell') { act = pos[i]; continue; }
    if (!act) throw new Error('buy か sell から書く（例: trade buy wheat 20 sell dates all）');
    const good = pos[i];
    const n = pos[++i];
    if (!GOODS[good]) throw new Error(`不明な品物: ${good}`);
    const q = n === 'all' ? Infinity : parseInt(n, 10);
    if (!(q > 0)) throw new Error(`${GOODS[good].name}の数量が不正: ${n}`);
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
      else if (kind === 'keep') { const [good, qty] = item.split('*'); stop.sell.filter((x) => x.good === good).forEach((x) => { x.keep = Number(qty || 0); }); stop.keepList = [...(stop.keepList || []), { good, qty: Number(qty || 0) }]; }
      else if (kind === 'unload' || kind === 'load') stop[kind].push(item);
      else throw new Error(`停泊地の書き方が不正: ${p}`);
    }
  }
  for (const k of stop.keepList || []) {
    const s = stop.sell.find((x) => x.good === k.good);
    if (s) s.keep = k.qty;
  }
  delete stop.keepList;
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
  travel <町id> [--guards n] [--nowait]  出発して、到着か事件まで日を進める（--nowait なら時間を進めない）
  wait <日数> [-m 番号]                日を進める（最大120日。手動の商人の到着や重要な出来事で止まる。-m を付けるとその商人が町に着いたら止まる）
  shop                                 雇用・輸送手段・工房・道の費用と条件（どこで買えるか）
  hire [confirm]                       今いる町で商人を雇う（confirm なしなら費用だけ表示）
  transport <種類> [confirm]           輸送手段を買い替える（camel, cart, dhow, carrack）
  build <種類> [confirm]               今いる町に工房を建てる（mill, confectionery, winery, malthouse）
  workshops                            工房の一覧（レシピ、生産数、倉庫）
  workshop <番号> on|off|autobuy|noautobuy
  load <品物> <数> / unload <品物> <数>  倉庫との積み下ろし
  road <道の番号> [confirm]            小道を街道に整備する
  donate [confirm]                     今いる町に寄進する（費用は人口に比例。90日間、成長が早まる）
  order add "<町> sell:品@最低値 keep:品*残す数 buy:品*数@上限値 unload:品 load:品" "<町> ..."
                                       定期便を設定（停泊地を2つ以上）。例:
                                       order add "mugi buy:wheat*20@3" "kohaku sell:wheat@5"
  order list                           定期便ごとの損益
  order pause                          次に町に着いたら定期便を止める（その町で操作できる）
  order clear | order resume
  inherit <家訓>                       シナリオ達成後、家訓を選んで次のシナリオの始め方を表示

--json を付けると結果を JSON で出す。`;



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
      out.push('※ これは見積もり。確定するには quote を trade に替えて同じ内容を打つ。');
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
      const plan = G.routeInfo(world, m.id, pos[0]);
      if (plan) {
        const desertDays = plan.edges.filter((e) => e.kind === 'desert').reduce((s, e) => s + G.edgeDays(world, e, m.transport, e.a), 0);
        const food = G.PROVISIONS.reduce((s, g) => s + (m.cargo[g] || 0), 0);
        const need = Math.ceil(desertDays * G.cargoCap(m) * G.BALANCE.provisionPerCap);
        if (desertDays && food < need) out.push(`⚠ 砂漠を約${desertDays}日渡るのに、隊商の食料が ${food}/${need} しかない（なつめやし・干しぶどう・キビ・麦・米）`);
        if (plan.danger && world.scenario.bandits && !Number(opts.guards || 0)) out.push(`⚠ 盗賊の出る道（危険度${plan.danger}）を護衛なしで進む（--guards n で護衛を雇える）`);
      }
      if (world.player.silver < 0) out.push('⚠ 銀がマイナス。着いた町で売らないと仕入れができない');
      const r = after(G.travel(world, m.id, pos[0], { guards: Number(opts.guards || 0) }));
      out.push(`${m.name}が${world.cities[pos[0]].name}へ出発（約${r.days}日）`);
      if ('nowait' in opts) { out.push('（時間は進めていない。ほかの商人にも指示してから wait で進める）'); break; }
      const adv = G.advance(world, r.days + 30, { stopOn: new Set(['arrive', 'victory', 'defeat', 'robbed', 'starve', 'orderStuck']) });
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
      out.push(`（${world.day}日目${asked > 120 ? '。wait は1回120日まで' : ''}${adv.events.some((e) => e.type === 'arrive') ? '。商人が到着したので止まった' : ''}）`);
      break;
    }
    case 'hire': {
      const cost = G.BALANCE.merchantHireCost * world.player.merchants.length;
      if (pos[0] !== 'confirm') { out.push(`商人を雇うと ${cost} 銀（銀 ${Math.floor(world.player.silver)} → ${Math.floor(world.player.silver - cost)}）。上限 ${world.scenario.maxMerchants ?? 4} 人。確定するには: hire confirm`); break; }
      const at = opts.merchant ? pickMerchant(world, opts) : world.player.merchants.find((x) => !x.travel);
      if (!at || at.travel) throw new Error('雇えるのは、商人が滞在している町だけ（全員移動中なら wait か order pause で止める）');
      const r = after(G.hireMerchant(world, at.city));
      out.push(`雇った（${r.cost}銀）。新しい商人の番号は #${r.merchant}（-m ${r.merchant} で操作）`);
      break;
    }
    case 'transport': {
      const m = needIdle(world, opts);
      const t = TRANSPORTS[pos[0]];
      if (!t) throw new Error(`種類を指定: ${Object.keys(TRANSPORTS).join(', ')}（費用と買える町は shop）`);
      if (pos[1] !== 'confirm') { out.push(`${t.name}: ${t.cost}銀（今の${TRANSPORTS[m.transport].name}を${TRANSPORTS[m.transport].cost * 0.5}銀で下取り）。確定するには: transport ${pos[0]} confirm`); break; }
      out.push(`購入した（差額 ${Math.round(after(G.buyTransport(world, m.id, pos[0])).price)}銀）`);
      break;
    }
    case 'build': {
      const m = needIdle(world, opts);
      const b = BUILDINGS[pos[0]];
      if (!b?.recipes) throw new Error('種類を指定（費用は shop）');
      if (pos[1] !== 'confirm') { out.push(`${b.name}: ${b.cost}銀、維持費 ${b.upkeep}/日。確定するには: build ${pos[0]} confirm`); break; }
      out.push(`建てた（工房 #${after(G.build(world, m.city, pos[0])).building}）`);
      break;
    }
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
    case 'road': {
      const e = world.edges.find((x) => x.id === Number(pos[0]));
      if (!e) throw new Error('道の番号を指定（map で一覧）');
      if (pos[1] !== 'confirm') { out.push(`道 #${e.id} の整備: ${Math.round(e.len * BUILDINGS.road.costPerLength)}銀。確定するには: road ${e.id} confirm`); break; }
      out.push(`整備した（${after(G.upgradeRoad(world, pos[0])).cost}銀）`);
      break;
    }
    case 'order': {
      if (pos[0] === 'list' || !pos[0]) {
        for (const x of world.player.merchants) {
          if (!x.order) { out.push(`#${x.id} ${x.name}: 定期便なし`); continue; }
          const days = Math.max(1, world.day - x.order.since);
          out.push(`#${x.id} ${x.name}: ${x.order.paused ? '（停止中）' : ''}${days}日で損益 ${Math.round(x.order.profit || 0)}銀（1日あたり ${fmt((x.order.profit || 0) / days)}）`);
          for (const st of x.order.stops) out.push(`    ${world.cities[st.city].name}(${st.city}): ${[...(st.sell || []).map((v) => `売 ${GOODS[v.good].name}(最低${v.min})`), ...(st.buy || []).map((v) => `買 ${GOODS[v.good].name}×${v.qty}(上限${v.max === Infinity || v.max === null ? 'なし' : v.max})`), ...(st.unload || []).map((g) => `下ろす ${GOODS[g].name}`), ...(st.load || []).map((g) => `積む ${GOODS[g].name}`)].join('、') || '何もしない'}`);
        }
        break;
      }
      const m = pickMerchant(world, opts);
      if (pos[0] === 'clear') { after(G.clearOrder(world, m.id)); out.push('定期便を解除した'); break; }
      if (pos[0] === 'resume') { after(G.resumeOrder(world, m.id)); out.push('定期便を再開した'); break; }
      if (pos[0] === 'pause') { const r = after(G.pauseOrderAtNext(world, m.id)); out.push(r.now ? '定期便を止めた（今いる町で待機）' : '次に町に着いたら止まる'); break; }
      if (pos[0] !== 'add') throw new Error('order add|list|pause|resume|clear');
      const stops = pos.slice(1).map(parseStop);
      const replaced = !!m.order;
      after(G.setOrder(world, m.id, { stops }));
      if (replaced) out.push('（以前の定期便は置き換えた）');
      out.push(`定期便: ${stops.map((s) => world.cities[s.city].name).join(' → ')} → …`);
      out.push(...G.drainEvents(world).map(eventLine));
      break;
    }
    case 'shop': {
      const sc = world.scenario;
      const pl = world.player;
      const max = sc.maxMerchants ?? 4;
      out.push('■ 投資の費用と条件');
      out.push(`商人を雇う（hire confirm）: ${pl.merchants.length >= max ? `上限（${max}人）に達している` : `${G.BALANCE.merchantHireCost * pl.merchants.length} 銀。自分の商人がいる町で雇える。最大${max}人。給金は1人1日${G.BALANCE.merchantWage}銀`}`);
      out.push('輸送手段（transport <種類> confirm。今のものは半額で下取り）:');
      for (const [k, t] of Object.entries(TRANSPORTS)) {
        if (!world.allowedTransports.includes(k)) { out.push(`  ${t.name}(${k}): このシナリオでは使えない`); continue; }
        const where = Object.values(world.cities).filter((c) => G.canBuyTransportAt(world, c, k)).map((c) => c.name);
        out.push(`  ${t.name}(${k}): ${t.cost}銀  積載${t.cap}  速さ${t.speed}  維持費${t.upkeep}/日  通れる道: ${t.modes.map((x) => G.ROUTE_KINDS[x].name).join('・')}  買える町: ${t.cost ? where.join('、') || 'なし' : '（最初から持っている）'}`);
      }
      const bs = (sc.buildings || []).filter((b) => BUILDINGS[b]?.recipes);
      out.push(`工房（build <種類> confirm）: ${bs.length ? '同じ種類は1つの町に1つまで。倉庫が付く' : 'このシナリオでは建てられない'}`);
      for (const b of bs) out.push(`  ${BUILDINGS[b].name}(${b}): ${BUILDINGS[b].cost}銀  維持費${BUILDINGS[b].upkeep}/日  1日${BUILDINGS[b].batches}回  ${BUILDINGS[b].recipes.map((r) => `${Object.entries(r.in).map(([g, n]) => `${GOODS[g].name}${n}`).join('+')}→${Object.entries(r.out).map(([g, n]) => `${GOODS[g].name}${n}`).join('+')}`).join(' / ')}`);
      out.push(`道の整備（road <番号> confirm）: ${(sc.buildings || []).includes('road') ? `小道を街道にする。距離×${BUILDINGS.road.costPerLength}銀` : 'このシナリオではできない'}`);
      out.push(`護衛: 1人1日${G.BALANCE.guardWage}銀（travel <町> --guards n）`);
      break;
    }
    case 'inherit': {
      if (!world.finished?.win) throw new Error('家訓はシナリオを達成すると受け継げる');
      const hh = HEIRLOOMS[pos[0]];
      if (!hh) throw new Error(`家訓を選ぶ: ${Object.entries(HEIRLOOMS).map(([k, x]) => `${k}（${x.name}: ${x.text}）`).join(' / ')}`);
      const list = [...world.player.heirlooms, pos[0]];
      const idx = SCENARIO_ORDER.indexOf(world.scenarioId);
      const next = SCENARIO_ORDER[idx + 1];
      out.push(`家訓「${hh.name}」を受け継いだ。`);
      out.push(next ? `次のシナリオ: node cli/toshoki.js new --scenario ${next} --heirlooms ${list.join(',')} --save save-${next}.json` : 'これが最後のシナリオだった。');
      break;
    }
    case 'donate': {
      const m = needIdle(world, opts);
      const cost = G.donateCost(world, m.city);
      if (pos[0] !== 'confirm') { out.push(`${world.cities[m.city].name}への寄進: ${cost}銀。${G.BALANCE.donateDays}日間、成長が${Math.round((G.BALANCE.donateGrowth - 1) * 100)}%早まる（糖度が40以上で成長しているときだけ）。確定するには: donate confirm`); break; }
      out.push(`寄進した（${after(G.donate(world, m.city)).cost}銀）`);
      break;
    }
    case 'workshops': {
      if (!world.player.buildings.length) { out.push('工房はまだない（build <種類> confirm で建てる。費用は shop）'); break; }
      for (const b of world.player.buildings) {
        const def = BUILDINGS[b.type];
        const wh = world.player.warehouses[b.city];
        out.push(`#${b.id} ${def.name}（${world.cities[b.city].name}）${b.active ? '稼働中' : '停止中'}  自動仕入れ${b.autoBuy ? 'あり（手元の銀が300を切ると止まる）' : 'なし'}  昨日 ${b.lastMade || 0}回  累計 ${Object.entries(b.made || {}).map(([g, n]) => `${GOODS[g].name}${n}`).join(' ') || 'なし'}`);
        out.push(`   レシピ（上から順に試す。1日${def.batches}回）: ${def.recipes.map((r) => `${Object.entries(r.in).map(([g, n]) => `${GOODS[g].name}${n}`).join('+')}→${Object.entries(r.out).map(([g, n]) => `${GOODS[g].name}${n}`).join('+')}`).join(' / ')}`);
        out.push(`   材料は倉庫から使い、足りなければ町の市場で買う（基準価格の1.5倍まで）。できた品は倉庫に入る（load で積む）。`);
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
    out.push('', statusText(world), world.finished.win ? '\n家訓を1つ受け継げる（inherit <名前>）: ' + Object.entries(HEIRLOOMS).map(([k, x]) => `${k}（${x.name}: ${x.text}）`).join(' / ') : '');
  }
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
    if (cmd === 'scenarios') return print([...SCENARIO_ORDER.map((id) => `${id}: ${SCENARIOS[id].no}. ${SCENARIOS[id].title}（期限 ${SCENARIOS[id].deadline}日）`), 'free: フリープレイ（--seed ごとに地図が変わる）'].join('\n'), opts);
    if (cmd === 'new') {
      const sc = opts.scenario || 's1';
      const world = G.createWorld(sc, { seed: opts.seed || 1, heirlooms: (opts.heirlooms || '').split(',').filter(Boolean) });
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
