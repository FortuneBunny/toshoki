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
  baseFoodCap: 1.1,           // 主食・果実で満たせる糖度の上限（110）
  singleFoodCap: 0.5,         // 1種類の食べ物で満たせるのは必要量の50%まで
  singleSweetCap: 0.4,        // 1種類の甘味が糖度に効くのは必要量の40%まで
  sweetGain: 0.85,            // 甘味の糖量が糖度に効く倍率
  glucoseFollow: 0.12,        // 糖度が目標に近づく速さ（1日あたり）
  consumeElasticity: 0.7,     // 安いと多く消費する度合い
  consumeMin: 0.4, consumeMax: 2.4,
  starveLine: 40, stableTop: 110, rushLine: 150,
  growthStarve: -0.006,       // 糖度0のときの1日の人口変化率
  growthStable: [0, 0.003],
  growthBoom: [0.0032, 0.0055],
  luxuryBase: 0.7,            // 非糖の品の需要を満たしたときの成長倍率 = base + span × 充足率
  luxurySpan: 0.6,
  tierPops: [0, 300, 1000, 3000, 8000],
  tierNames: ['集落', '村', '町', '都市', '大都市'],

  // シュガーラッシュとクラッシュ
  rushDays: 8,
  rushSweetDemand: 1.8,
  rushGrowthBonus: 0.004,
  crashDays: 14,
  crashSweetDemand: 0.3,
  crashSweetGlu: 0.25,
  crashGrowth: -0.002,

  // 生産
  productionNoise: 0.25,      // 毎日の生産量のぶれ
  stockCapDays: 40,           // 在庫がこの日数分を超えたら生産を止める

  // 背景の交易（見えない商人による価格の平準化）
  diffusionRate: 0.006,
  diffusionThreshold: 1.35,

  // 移動と危険
  banditBase: 0.025,          // 危険度1の道で、1日あたり襲われる確率
  guardWage: 2,               // 護衛1人の1日の給金
  guardPower: 1,              // 護衛1人の強さ
  banditPower: [1, 4],        // 盗賊の強さの範囲
  banditLoss: 0.35,           // 負けたときに奪われる積荷の割合
  starveSlow: 2,              // 砂漠で食料が尽きたときの移動の遅れ（倍率）
  starveLoss: 0.03,           // 食料が尽きた日ごとに失う積荷の割合
  provisionPerCap: 1 / 60,    // 砂漠で1日に食べる量 = 積載量 × これ（ロバなら3日で1個）

  // 人と組織
  merchantHireCost: 150,
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
