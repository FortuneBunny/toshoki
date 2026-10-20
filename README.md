# 糖商記 〜Great Glucose Empire〜

**町は糖で動いている。** 相場を読み、隊商を走らせ、糖を届けて町を育てる交易シミュレーション。

2001年の名作『Trade Empires』に着想を得た、ブラウザで遊べるゲームです。インストールは不要で、CLI（テキスト）版でも遊べます。

▶ **遊ぶ: https://fortunebunny.github.io/toshoki/**

![タイトル](assets/svg/ui/logo.svg)

## どんなゲーム？
- **相場を読む**: 町ごとに品物の在庫があり、少ないほど高く、多いほど安い。他の町の相場は、商人が最後にいたときの古い情報しか分からない。「着いたとき、まだ高いか？」を読み切ろう。
- **町を育てる**: 町には「糖度」（町の血糖値）がある。食べ物と甘味が届くと上がり、人口が増え、集落から大都市へ育つ。同じ食べ物ばかりでは伸びない。食卓の多様さが鍵。
- **甘い誘惑**: よく食べている町（糖度140以上）に甘味を2種類以上まとめて届けると「シュガーラッシュ」が起きる。甘味が飛ぶように売れるが、そのあとには「シュガークラッシュ」が来る。
- **加工と自動化**: 製糖所でサトウキビを白糖に。儲かる往復は「定期便」にして自動化し、次の一手へ。
- **砂漠と海**: 砂漠では隊商が食料を食べ、盗賊も出る。海では季節風に乗れば速く、逆らえば遅い。
- **ライバル**: サルマン商会が同じ市場を狙ってくる。

全8シナリオ。達成すると一族の「家訓」が1つ解放され、次からのシナリオで1つだけ選んで持っていけます。どの家訓にも利点と代償があります。

## 操作（ブラウザ版）
- 商人のカードの「交易」で売り買い、「出発」で行き先を地図から選ぶ。
- 交易画面は RimWorld 風。`‹ ›` で1個ずつ（Shift で10個、Ctrl で100個）、`«` で買えるだけ、`»` で全部売る。
- スペースキーで一時停止／再開、`1`〜`3` で速度。
- 進行はブラウザに自動で保存されます。

## CLI 版
Node.js 18 以上で動きます。

```sh
node cli/toshoki.js new --scenario s1 --save run.json   # はじめる
node cli/toshoki.js --save run.json status               # 状況
node cli/toshoki.js --save run.json market               # 今いる町の市場
node cli/toshoki.js --save run.json trade buy wheat 20   # 取引
node cli/toshoki.js --save run.json travel natsume       # 出発（到着まで進む）
node cli/toshoki.js help                                 # コマンド一覧
node cli/toshoki.js help rules                           # ルール
```

引数なしで `node cli/toshoki.js` を実行すると対話モードになります。

## 開発
ビルドは不要です（素の HTML / CSS / JavaScript）。

```sh
npm run serve          # http://localhost:8123/ で開発用サーバー
npm test               # ゲームの中身のテスト
npm run bots -- s2     # 決まった戦略のボットでバランスを確認
npm run svg:check      # SVG 素材の検証
```

- `src/core/` ゲームの中身（ブラウザと CLI で共通）
- `src/data/` 品物・シナリオ・バランス定数
- `src/ui/` ブラウザの画面と演出
- `cli/` CLI 版
- `assets/svg/` SVG 素材（`assets/STYLE.md` がスタイルガイド）
- `docs/` 計画書、デザインピラー、調整の記録
- `playtests/` AI プレイテストの要約

## 作り方について
このゲームは Claude Code（Anthropic）で作りました。素材の SVG はサブエージェントが描き、バランスは腕前の違う複数の AI（Claude Opus / Sonnet / Haiku、Codex Sol / Luna）に CLI 版を遊ばせて調整しています。調整の判断は `docs/pillars.md`（ゲームの柱）を基準にし、経緯は `docs/balance-log.md` と `playtests/` に残しています。

## ライセンス
MIT
