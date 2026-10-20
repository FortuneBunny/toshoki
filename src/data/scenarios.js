// シナリオ定義。座標は 1000×600 の地図上。道の長さは座標の距離から計算する。
// 新しいギミックは「安全な状況で一度触らせてから、本番に置く」順に出す。

const s1 = {
  id: 's1', no: 1, title: 'はじまりの甘み',
  intro: '一族の当主として最初の商いに出る。麦の里では麦があまり、ナツメ泉ではなつめやしがあまっている。安く買って、足りない町で売ろう。',
  goods: ['wheat', 'dates'],
  start: { silver: 150, merchants: [{ name: 'ハサン', portrait: 'merchant-1', city: 'mugi' }] },
  cities: [
    { id: 'mugi', name: '麦の里', x: 260, y: 320, pop: 520, produces: { wheat: 9 } },
    { id: 'natsume', name: 'ナツメ泉', x: 700, y: 280, pop: 430, produces: { dates: 6.5 }, tags: ['desert'] },
  ],
  edges: [{ a: 'mugi', b: 'natsume', kind: 'trail' }],
  knownAtStart: ['natsume'],
  goals: [{ type: 'silver', amount: 600 }],
  deadline: 240, rankS: 0.5,
  events: false, contracts: false, bandits: false,
  tutorial: [
    { text: '麦の里で「交易」を開き、麦を買えるだけ買う', done: (w) => (w.stats.bought.wheat || 0) > 0 },
    { text: 'ナツメ泉へ出発する', done: (w) => w.stats.trips >= 1 },
    { text: 'ナツメ泉で麦を売る（相場は品の少ない町ほど高い）', done: (w) => (w.stats.soldTotal.wheat || 0) > 0 },
    { text: 'なつめやしを買って麦の里で売る。往復で稼ごう', done: (w) => (w.stats.soldTotal.dates || 0) > 0 },
    { text: '町の糖度ゲージを見る。食べ物が届くと糖度が上がり、人口が増える', done: (w) => w.stats.trips >= 4 },
  ],
};

const s2 = {
  id: 's2', no: 2, title: 'なつめやしの谷',
  intro: '谷には4つの町がある。相場は日々動き、遠くの町の情報はどんどん古くなる。「着いたとき、まだ高いか？」を読み切れ。麦の里を「町」に育て、一族の資産を3000銀にせよ。',
  goods: ['wheat', 'dates', 'honey', 'rawsugar', 'silk'],
  start: { silver: 220, merchants: [{ name: 'ハサン', portrait: 'merchant-1', city: 'mugi' }] },
  cities: [
    { id: 'mugi', name: '麦の里', x: 170, y: 390, pop: 640, produces: { wheat: 10 } },
    { id: 'natsume', name: 'ナツメ泉', x: 470, y: 170, pop: 380, produces: { dates: 7 }, tags: ['desert'] },
    { id: 'kanbi', name: '甘蔗の浜', x: 520, y: 470, pop: 470, produces: { rawsugar: 2.6, honey: 1.2, wheat: 2 } },
    { id: 'kohaku', name: '琥珀京', x: 830, y: 300, pop: 3300, produces: { silk: 1.7, wheat: 9, dates: 2 } },
  ],
  edges: [
    { a: 'mugi', b: 'natsume', kind: 'trail' },
    { a: 'mugi', b: 'kanbi', kind: 'trail' },
    { a: 'natsume', b: 'kanbi', kind: 'trail' },
    { a: 'natsume', b: 'kohaku', kind: 'desert' },
    { a: 'kanbi', b: 'kohaku', kind: 'trail' },
  ],
  goals: [{ type: 'cityTier', city: 'mugi', tier: 2 }, { type: 'networth', amount: 3000 }],
  deadline: 360, rankS: 0.5,
  events: true, contracts: true, bandits: false, newsDaysPerHop: 4,
  disabledEvents: ['sandstorm', 'plague'],
  maxMerchants: 2,
};

export const SCENARIOS = { s1, s2 };
export const SCENARIO_ORDER = ['s1', 's2'];
