// 区画（町の中のマス目）の定義
// 区画は SIZE×SIZE のマス目。中心に市場があり、市場の圏の中にだけ建物を置ける。

export const DISTRICT_SIZE = 12;
export const DISTRICT_CENTER = 6;

// 町の段階ごとの市場の圏（中心からのマス数）
export const MARKET_RADIUS = [3, 4, 5, 6, 7];

// 地形（1マスに1つ）
export const TERRAIN = {
  '.': { name: '平地' },
  f: { name: '肥えた土地' },
  s: { name: '砂地' },
  w: { name: '水辺', blocked: true },
  m: { name: '山', blocked: true },
  r: { name: '道', blocked: true },
  h: { name: '丘' },
};

// 資源（地形の上に重なる。'-' はなし）
export const RESOURCES = {
  c: { name: 'サトウキビの湿地' },
  r: { name: '水田に向く低地' },
  v: { name: 'ぶどうの斜面' },
  p: { name: 'ヤシの泉' },
  b: { name: '花の野' },
  l: { name: '塩田' },
  m: { name: '鉱脈' },
  t: { name: '茶の斜面' },
  k: { name: '桑畑' },
  q: { name: '陶土' },
  x: { name: '香草の谷' },
};

// 町の生産施設。置けるマスの条件（terrain か resource）と、1軒あたりの標準の生産量
// workers は D2（労働力）で使う
export const PRODUCERS = {
  wheat_farm:   { name: '麦畑',         good: 'wheat',      rate: 3,   workers: 30, terrain: ['f', '.'], cost: 120 },
  rice_paddy:   { name: '水田',         good: 'rice',       rate: 3,   workers: 30, resource: 'r', cost: 140 },
  millet_field: { name: 'キビ畑',       good: 'millet',     rate: 2.5, workers: 25, terrain: ['.', 's', 'f'], cost: 100 },
  date_grove:   { name: 'なつめやしの林', good: 'dates',    rate: 2.5, workers: 25, resource: 'p', cost: 150 },
  vineyard:     { name: 'ぶどう園',     good: 'grapes',     rate: 2.5, workers: 25, resource: 'v', cost: 160 },
  raisin_rack:  { name: '干しぶどう棚', good: 'raisins',    rate: 0.8, workers: 20, resource: 'v', cost: 180 },
  cane_field:   { name: 'サトウキビ畑', good: 'cane',       rate: 3,   workers: 30, resource: 'c', cost: 150 },
  apiary:       { name: '養蜂場',       good: 'honey',      rate: 0.7, workers: 15, resource: 'b', cost: 200 },
  sugar_hut:    { name: '糖小屋',       good: 'rawsugar',   rate: 1.3, workers: 25, resource: 'c', cost: 260 },
  sugar_white:  { name: '白糖所',       good: 'whitesugar', rate: 0.3, workers: 25, resource: 'c', cost: 400 },
  salt_pan:     { name: '塩田',         good: 'salt',       rate: 3,   workers: 20, resource: 'l', cost: 140 },
  iron_mine:    { name: '鉱山',         good: 'iron',       rate: 1,   workers: 40, resource: 'm', cost: 300 },
  tea_garden:   { name: '茶園',         good: 'tea',        rate: 1.1, workers: 25, resource: 't', cost: 260 },
  silk_house:   { name: '絹織りの家',   good: 'silk',       rate: 0.8, workers: 30, resource: 'k', cost: 400 },
  kiln:         { name: '窯',           good: 'pottery',    rate: 0.8, workers: 20, resource: 'q', cost: 260 },
  spice_garden: { name: '香辛料の園',   good: 'spice',      rate: 0.8, workers: 25, resource: 'x', cost: 320 },
};

// 需要施設: 建てると、その町に新しい需要が生まれる。求める品が届いている度合い（満足度）に応じて効果がある
// wants: 人口1000人あたりの1日の需要  growth: 満足度1のときの成長率の上乗せ
export const CIVICS = {
  teahouse: { name: '茶館',   minTier: 1, cost: 350,  wants: { tea: 0.6, sweets: 0.4, mizuame: 0.4 }, growth: 0.10, effect: '甘味がよく売れる（甘味の需要 +10%）' },
  temple:   { name: '寺院',   minTier: 2, cost: 700,  wants: { honey: 0.5, wine: 0.4, sweets: 0.4 },   growth: 0.15, effect: '評判が毎日少しずつ上がる' },
  academy:  { name: '学問所', minTier: 2, cost: 600,  wants: { tea: 0.5, pottery: 0.4, salt: 0.6 },   growth: 0.10, effect: '暮らしの豊かさを底上げ' },
  palace:   { name: '宮殿',   minTier: 3, cost: 1500, wants: { silk: 0.3, spice: 0.3, sugarart: 0.15 }, growth: 0.20, effect: '宮殿の求める品が高く売れる（+15%）' },
};

// 品物 → それを生む施設
export const PRODUCER_FOR = Object.fromEntries(Object.entries(PRODUCERS).map(([k, v]) => [v.good, k]));
