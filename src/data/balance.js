// バランス定数。プレイテストで調整するのは基本的にこのファイル。
// 変更したら docs/balance-log.md に理由を書く。

export const BALANCE = {
  // 価格
  priceElasticity: 1.15,      // 在庫と目標在庫の比に対する価格の感度
  priceMin: 0.25,             // 基準価格に対する下限倍率
  priceMax: 4.0,              // 上限倍率
  targetStockDays: 12,        // 町が持ちたい在庫 = 1日の消費 × この日数
  minTargetStock: 6,          // 消費の少ない品でも最低これだけは在庫を持ちたい
  spread: 0.09,               // 売買の手数料（買値は +9%、売値は -9%）
  unwantedTarget: 2,          // 需要のない品の目標在庫（=すぐ値崩れする）

  // 糖度と人口
  needPer1000: 10,            // 人口1000人が1日に必要とする糖量
  cityEfficiency: 0.2,        // 大きな町ほど1人あたりの必要量が減る（人口千人単位の -0.2 乗）
  baseFoodCap: 1.1,           // 主食・果実で満たせる糖度の上限（110）
  singleFoodCap: 0.5,         // 1種類の食べ物で満たせるのは必要量の50%まで
  singleSweetCap: 0.45,       // 1種類の甘味が糖度に効くのは必要量の45%まで
  sweetGain: 1.0,             // 甘味の糖量が糖度に効く倍率
  glucoseFollow: 0.2,         // 糖度が目標に近づく速さ（1日あたり）
  consumeElasticity: 0.7,     // 安いと多く消費する度合い
  consumeMin: 0.4, consumeMax: 2.4,
  sweetConsumeMax: 4,         // 甘味は安いと基本の4倍まで食べる
  sweetBinge: 0.2,            // 持ちたい量を超えた甘味は、毎日その20%が余分に食べられる（ドカ食い）
  starveLine: 40, stableTop: 110, rushLine: 140,
  growthStarve: -0.006,       // 糖度0のときの1日の人口変化率
  growthStable: [0, 0.003],
  growthBoom: [0.0032, 0.0055],
  luxuryBase: 0.7,            // 非糖の品の需要を満たしたときの成長倍率 = base + span × 充足率
  luxurySpan: 0.6,
  tierPops: [0, 300, 1000, 3000, 8000],
  tierNames: ['集落', '村', '町', '都市', '大都市'],

  // シュガーラッシュとクラッシュ
  rushSweetLine: 0.7,        // ラッシュには、その日の甘味の摂取が必要量の70%以上（甘味2種類以上が目安）
  rushDays: 8,
  rushSweetDemand: 1.8,
  // 34回目の相談: 反動を軽くした（育ちの上乗せ 0.004→0.008、クラッシュ 18→12日、人口は減らずに止まる、
  // クラッシュ中の甘味の糖の効き 0.25→0.5）。ゆっくり育つ町では得、速く育つ町では損になり、町ごとに選ぶ理由が出る
  rushGrowthBonus: 0.008,
  crashDays: 12,               // ラッシュ（8日）より長く効く。わざと起こし続けると損になるように
  crashSweetDemand: 0.3,
  crashSweetGlu: 0.5,
  crashGrowth: 0,
  // 火入れ（34回目の相談の試作。false なら今までどおり、線を越えた日に勝手に起きる）:
  // 糖度が線の rushRipeGap 手前・甘味の摂取 rushRipeSweet 以上で「熟した🔥」。熟した町に甘味を
  // その品の rushIgniteDays 日分まとめて売り、甘味が2種類以上そろうと、翌日ラッシュが始まる
  rushIgnite: false,
  rushRipeGap: 10,
  rushRipeSweet: 0.4,
  rushIgniteDays: 3,

  // 生産
  productionNoise: 0.25,      // 毎日の生産量のぶれ
  stockCapDays: 40,           // 在庫がこの日数分を超えたら生産を止める

  // 背景の交易（見えない商人による価格の平準化）
  diffusionRate: 0.006,
  diffusionThreshold: 1.35,

  // 移動と危険
  banditBase: 0.025,          // 危険度1の道で、1日あたり襲われる確率
  guardWage: 2,               // 護衛1人の1日の給金
  oldTownProducers: 4,        // 古い町に自分で置ける生産施設の数
  orderHoldDays: 60,          // 定期便は仕入れ値を割って売らない。ただし、この日数売れないままなら最低売値だけで売る
  guardPower: 1,              // 護衛1人の強さ
  banditPower: [1, 4],        // 盗賊の強さの範囲
  banditLoss: 0.35,           // 負けたときに奪われる積荷の割合
  starveSlow: 2,              // 砂漠で食料が尽きたときの移動の遅れ（倍率）
  starveLoss: 0.03,           // 食料が尽きた日ごとに失う積荷の割合
  provisionPerCap: 1 / 60,    // 砂漠で1日に食べる量 = 積載量 × これ（ロバなら3日で1個）

  // 人と組織
  merchantHireCost: 150,
  branchCost: 3000,           // 商館の費用（2つ目からは倍々: 3000, 6000, 12000…）
  branchUpkeep: 5,            // 商館1つの1日の維持費
  branchMinTier: 2,           // 商館を建てられる町の段階（町以上）
  // 開拓団（大きな町から交易所へ人を移す。src/core/settlers.js）
  settlerGroup: 60,           // 1団の人数
  settlerCost: 6000,          // 1団目の費用。交易所ごとに settlerCostStep ずつ高くなる
  settlerCostStep: 3000,
  settlerMax: 3,              // 1つの交易所に送れる団の数
  settlerMinTier: 2,          // 開拓団を出せる町の段階（町以上。目標の町は目標の人口を割らない分だけ）
  settlerPostAge: 30,         // 交易所を開いてから受け入れられるまでの日数
  settlerGap: 10,             // 同じ交易所に次の団が住みつけるまでの日数
  settlerCarry: 60,           // 連れ出してから住みつくまでの期限（日）
  settlerDietFollow: 0.1,     // 受け入れの判定に使う食卓のならし（1日に今の食卓へ寄る割合。約10日）
  settlerDietLine: 0.05,      // ならした食卓で「届いている」とみなす量
  settlerGlucose: 90,         // 受け入れる交易所に要る糖度（食卓には食べ物3種類も要る）
  settlerWait: 30,            // 交易所に着いてから住みつけないまま待てる日数
  settlerLoad: 0.8,           // 開拓団が使う荷車の割合（残りに道中の食料を積める）
  autoBuyReserve: 20,         // 工房の自動仕入れは、手元の銀がこれを下回るなら止める（100だと、格上げと製糖所で銀を使い切った序盤に黙って止まった。17回目の Opus）
  dwellingFullGrowth: 1.15,   // 住居の求める品が全部そろった町の成長倍率
  // 交易所の格（版4 H1）: 交易所 → 市場 → 大市場。交易所は安く早く置くもの。格上げで圏が広がる
  postCost: 400,              // 1つ目の交易所の費用（開くたびに5割ずつ高くなる）
  postMax: 6,                 // 道を敷けるシナリオで開ける数（シナリオの maxPosts で変えられる）
  postGradeNames: ['交易所', '市場', '大市場'],
  postGradeRadius: [2, 4, 6], // 格ごとの市場の圏（中心からのマス数）
  postUpgradeCost: [0, 900, 2400], // その格へ上げる費用
  pioneerPostPop: 40,
  rivalGradePop: [700, 2600],  // ライバルの交易所が市場・大市場になる人口         // 町のないシナリオの交易所の、集落を除いた最初の人口
  postGrowth: 1.6,            // 交易所に食べ物を3種類以上届けているときの成長倍率
  // 区画: 生産施設を置いたとき
  producerBuildDays: 10,      // 置いてから動き出すまでの日数
  producerUpkeep: 1,          // 自分が置いた生産施設の1日の維持費
  // 区画: 住居と労働力
  houseCapBase: 40,           // 家1軒に住める人数 = base + perTier × 町の段階
  houseCapPerTier: 25,
  houseHeadroom: 1.15,        // 人口の1.15倍まで住めるように家を建てていく
  houseAbandon: 1.7,          // 人口に対して家が1.7倍以上あれば、空き家を取り壊す
  workerShare: 0.6,           // 人口のうち働き手の割合
  workshopWorkers: 30,        // 自分の工房1つが使う働き手
  donateCostPerPop: 1.5,      // 寄進の費用 = 人口 × これ
  donateGrowth: 1.25,         // 寄進すると、成長がプラスのときの成長率が1.25倍
  donateDays: 90,             // 寄進が効く日数
  merchantWage: 1,
  repLevels: [0, 60, 180, 400, 800, 1500],  // 評判レベルの閾値
  repSpreadCut: 0.12,         // 評判1レベルごとに手数料を何割減らすか
  streakRepBonus: 0.15,       // 連続黒字1回ごとの評判の上乗せ
  streakMax: 10,

  // 事件
  eventChancePerDay: 0.05,
  contractChancePerDay: 0.03,
  rumorChancePerDay: 0.05,
};
