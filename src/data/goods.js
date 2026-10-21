// 品物の定義
// base: 基準価格（銀）  glu: 1個あたりの糖量  rate: 人口1000人あたりの1日の消費量
// tier: 消費が始まる町の段階  weight: 積載量の重さ  kind: food（主食・果実）/ sweet（甘味）/ goods（非糖の品）/ input（加工専用）

export const CATEGORIES = {
  staple: '主食',
  fruit: '果実',
  sweetRaw: '甘味の原料',
  processed: '加工品',
  luxury: '贅沢品',
  trade: '交易品',
  material: '資材',
};

export const GOODS = {
  wheat:      { name: '麦',       cat: 'staple',    kind: 'food',  base: 4,   glu: 1.0, rate: 6,    tier: 0, weight: 1 },
  rice:       { name: '米',       cat: 'staple',    kind: 'food',  base: 5,   glu: 1.1, rate: 6,    tier: 0, weight: 1 },
  millet:     { name: 'キビ',     cat: 'staple',    kind: 'food',  base: 3,   glu: 0.8, rate: 5,    tier: 0, weight: 1 },
  dates:      { name: 'なつめやし', cat: 'fruit',   kind: 'food',  base: 6,   glu: 1.4, rate: 3,    tier: 0, weight: 1 },
  grapes:     { name: 'ぶどう',   cat: 'fruit',     kind: 'food',  base: 7,   glu: 1.2, rate: 2,    tier: 1, weight: 1 },
  raisins:    { name: '干しぶどう', cat: 'fruit',   kind: 'food',  base: 11,  glu: 2.0, rate: 1.5,  tier: 1, weight: 1 },
  cane:       { name: 'サトウキビ', cat: 'sweetRaw', kind: 'sweet', base: 4,  glu: 0.8, rate: 1,    tier: 0, weight: 1 },
  honey:      { name: '蜂蜜',     cat: 'sweetRaw',  kind: 'sweet', base: 15,  glu: 3.0, rate: 0.8,  tier: 1, weight: 1 },
  molasses:   { name: '糖蜜',     cat: 'processed', kind: 'sweet', base: 11,  glu: 2.5, rate: 0.7,  tier: 1, weight: 1 },
  rawsugar:   { name: '粗糖',     cat: 'processed', kind: 'sweet', base: 18,  glu: 4.0, rate: 0.8,  tier: 1, weight: 1 },
  whitesugar: { name: '白糖',     cat: 'processed', kind: 'sweet', base: 42,  glu: 6.0, rate: 0.6,  tier: 2, weight: 1 },
  malt:       { name: '麦芽',     cat: 'processed', kind: 'input', base: 8,   glu: 1.0, rate: 0,    tier: 9, weight: 1 },
  mizuame:    { name: '水飴',     cat: 'processed', kind: 'sweet', base: 20,  glu: 4.0, rate: 0.5,  tier: 2, weight: 1 },
  sweets:     { name: '菓子',     cat: 'luxury',    kind: 'sweet', base: 40,  glu: 8.0, rate: 0.3,  tier: 2, weight: 1 },
  sugarart:   { name: '砂糖細工', cat: 'luxury',    kind: 'sweet', base: 130, glu: 10,  rate: 0.12, tier: 3, weight: 1 },
  wine:       { name: '果実酒',   cat: 'luxury',    kind: 'sweet', base: 38,  glu: 3.0, rate: 0.4,  tier: 2, weight: 1 },
  silk:       { name: '絹',       cat: 'trade',     kind: 'goods', base: 64,  glu: 0,   rate: 0.25, tier: 3, weight: 1 },
  pottery:    { name: '陶器',     cat: 'trade',     kind: 'goods', base: 22,  glu: 0,   rate: 0.5,  tier: 2, weight: 1 },
  spice:      { name: '香辛料',   cat: 'trade',     kind: 'goods', base: 48,  glu: 0,   rate: 0.25, tier: 3, weight: 1 },
  tea:        { name: '茶',       cat: 'trade',     kind: 'goods', base: 26,  glu: 0,   rate: 0.5,  tier: 2, weight: 1 },
  salt:       { name: '塩',       cat: 'trade',     kind: 'goods', base: 8,   glu: 0,   rate: 1.2,  tier: 1, weight: 1 },
  timber:     { name: '木材',     cat: 'material',  kind: 'goods', base: 6,   glu: 0,   rate: 0.8,  tier: 1, weight: 2 },
  iron:       { name: '鉄',       cat: 'material',  kind: 'goods', base: 18,  glu: 0,   rate: 0.3,  tier: 2, weight: 2 },
  tools:      { name: '道具',     cat: 'material',  kind: 'goods', base: 30,  glu: 0,   rate: 0.3,  tier: 1, weight: 1 },
};

export const GOOD_IDS = Object.keys(GOODS);

// 隊商が砂漠で食べる順番
export const PROVISIONS = ['dates', 'raisins', 'millet', 'wheat', 'rice'];
