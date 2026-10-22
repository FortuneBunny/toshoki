// シナリオ定義。座標は 1000×600 の地図上。道の長さは座標の距離から計算する。
// 新しいギミックは「安全な状況で一度触らせてから、本番に置く」順に出す。

// 手引き用: その食べ物を採る交易所の名前
const tutPost = (w, g) => Object.values(w.cities).find((c) => c.founded && (c.produces?.[g] || 0) > 0)?.name || `${g === 'wheat' ? '麦' : 'なつめやし'}の交易所`;

const s1 = {
  id: 's1', no: 1, title: 'はじまりの甘み',
  // 版4: 町のない土地から始める手引き。違う食べ物の集落のそばに交易所を2つ置き、食べ物を運び合う
  intro: '一族の当主として、まだ市場のない土地に入る。麦を作る集落と、なつめやしを作る集落がある。それぞれのそばに交易所を開き、食べ物を運び合おう。どちらの食卓も2種類になれば糖度が上がり、家が建って町が育つ。',
  goods: ['wheat', 'dates'],
  start: { silver: 600, merchants: [{ name: 'ハサン', portrait: 'merchant-1' }] },
  cities: [],
  edges: [],
  pioneer: {
    families: [{ id: 'hasan', name: 'ハサン家', x: 470, y: 330, text: '麦の集落となつめやしの集落の間に館がある。' }],
    hamlets: [
      { name: '麦の集落', x: 400, y: 300, pop: 420, foods: { wheat: 8.4 } },
      { name: 'なつめやしの集落', x: 520, y: 285, pop: 360, foods: { dates: 5.1 } },
    ],
    // 古い寺院は、麦の集落のそば。麦の交易所の圏に入り、なつめやしを毎日買う
    wilds: [{ type: 'shrine', x: 419, y: 281 }],
    rivalPosts: [],
  },
  shapes: [{ kind: 'desert', points: [[560, 0], [1000, 0], [1000, 600], [560, 600]] }],
  goals: [{ type: 'posts', count: 2, pop: 300 }, { type: 'postTier', tier: 1, pop: 600 }],
  deadline: 300, rankS: 0.45,
  maxPosts: 2, postCost: 250, maxPaths: 1,
  events: false, contracts: false, bandits: false,
  district: false, // 区画は見るだけ（建物を置くのは s2 から）
  // 手引きは、実際に置いた交易所に合わせて文を変える（なつめやし側から始めても「麦の集落のそば」と出ていた。第15回テスト）
  tutorial: [
    { text: '集落のそば（緑の印）に、最初の交易所を置く（無料）。麦か、なつめやしの集落を圏に入れる', done: (w) => Object.values(w.cities).some((c) => c.founded) },
    { text: (w) => `上の「交易所」から、${(w.hamlets || []).find((hm) => !hm.absorbedBy)?.name || 'もう一つの集落'}のそばに2つ目の交易所を開く`, done: (w) => Object.values(w.cities).filter((c) => c.founded).length >= 2 },
    { text: (w) => `${tutPost(w, 'wheat')}で麦を買い、${tutPost(w, 'dates')}へ運んで売る（相場は品の少ない町ほど高い）`, done: (w) => (w.stats.soldTotal.wheat || 0) > 0 },
    { text: (w) => `${tutPost(w, 'dates')}でなつめやしを買い、${tutPost(w, 'wheat')}で売る${(w.wilds || []).some((x) => x.absorbedBy) ? '（古い寺院も毎日なつめやしを買う）' : ''}`, done: (w) => (w.stats.soldTotal.dates || 0) > 0 },
    { text: '交易所の糖度ゲージを見る。食卓が2種類になると糖度が上がり、家が建つ。往復を「定期便」にしよう', done: (w) => w.player.merchants.some((m) => m.order) },
    { text: '早く育てるには: 交易所の欄の「止めているもの」を見て、足りない食べ物を定期便で多めに運ぶ（買う個数を増やす）', done: (w) => !!w.finished },
  ],
};

const s2 = {
  id: 's2', no: 2, title: 'なつめやしの谷',
  // 版4: 谷の村は集落になった。東の琥珀京だけが古い町。琥珀京は麦となつめやしの入荷に波があり、細る時期を読んで運ぶ
  // 谷の集落は、食べ物を多めに作る（自分の食卓の倍の3倍。余りを琥珀京へ売る谷）
  intro: '谷には集落が点々とある。東の砂漠の向こうには、古い大きな町・琥珀京。交易所を開いて谷の集落を町に育てよ。琥珀京は麦となつめやしを遠くから仕入れていて、入荷には波がある──町の欄の「これから」で細る時期を読み、高くなる頃に着くように運べ。交易所を「町」（人口1000）に育て、琥珀京でなつめやしを150個売り、一族の資産を3000銀にせよ。なつめやしは自分の交易所の食卓にも要る──売る時機を読め。',
  goods: ['wheat', 'millet', 'dates', 'honey', 'rawsugar'],
  start: { silver: 500, merchants: [{ name: 'ハサン', portrait: 'merchant-1' }] },
  cities: [
    // 入荷の波: 麦は90日、なつめやしは70日で一回り。いちばん細ると、ふだんの半分（麦）・4割（なつめやし）になる
    { id: 'kohaku', name: '琥珀京', x: 640, y: 340, pop: 3300, steady: true, produces: { wheat: 18, dates: 14, honey: 1.4 }, waves: { wheat: { period: 90, amp: 0.5 }, dates: { period: 70, amp: 0.8, phase: 30 } } },
  ],
  edges: [],
  pioneer: {
    families: [{ id: 'hasan', name: 'ハサン家', x: 230, y: 380, text: '谷の西、麦の集落のそばに館がある。' }],
    hamlets: [
      { name: '麦の集落', x: 170, y: 395, pop: 460, foods: { wheat: 13 } },
      { name: 'ナツメ泉', x: 455, y: 235, pop: 320, foods: { dates: 6.5 } },
      { name: '蜜蜂の集落', x: 360, y: 440, pop: 220, foods: { honey: 1.1 } },
      { name: 'キビの集落', x: 265, y: 500, pop: 300, foods: { millet: 7 } },
      { name: '甘蔗の浜', x: 520, y: 480, pop: 380, foods: { rawsugar: 1.9, wheat: 2.1 } },
    ],
    // 古い寺院は、麦の集落の北。隊商宿は、砂漠のふちのナツメ泉のそば（砂漠の交易所ではラクダが買える）
    wilds: [{ type: 'shrine', x: 300, y: 330 }, { type: 'inn', x: 472, y: 248 }],
    rivalPosts: [],
  },
  shapes: [{ kind: 'desert', points: [[420, 60], [920, 80], [900, 240], [640, 260], [430, 250]] }],
  // 琥珀京へのなつめやしの目標（琥珀京に一度も売らず、谷の中の交換だけでSが取れた。17回目の Sol）。なつめやしは自分の食卓にも要るので、売るか食べさせるかを読む
  goals: [{ type: 'postTier', tier: 2, pop: 1000 }, { type: 'networth', amount: 3000 }, { type: 'deliver', good: 'dates', city: 'kohaku', amount: 150 }],
  deadline: 400, rankS: 0.55,
  maxPosts: 4, postCost: 300, maxPaths: 3,
  knownAtStart: ['kohaku'], // 名の知れた古い町。相場は最初から聞こえてくる
  events: true, contracts: true, bandits: false, newsDaysPerHop: 4,
  disabledEvents: ['sandstorm', 'plague'],
  transports: ['donkey', 'camel'],
  maxMerchants: 3,
};

const s3 = {
  id: 's3', no: 3, title: '糖蜜の煙',
  // 版4: サトウキビの村は集落になった。糖蜜町と翠糖京は古い町。製糖所は、自分の交易所を「市場」に格上げすると建てられる
  intro: 'サトウキビは安いが、そのままでは価値が低い。甘蔗の集落のそばに交易所を開き、「市場」に格上げして製糖所を建てれば、市場のサトウキビを自動で仕入れて白糖に精製してくれる。できた白糖を大都市・翠糖京へ運んで売れ。白糖を運びすぎると値が崩れ、甘味の摂りすぎでクラッシュも来る──翠糖京の「これから」を見て間をあけよ。白糖を売って9000銀を稼ぎ（翠糖京と糖蜜町は、白糖の需要の山がずれている）、資産を5000銀にし、定期便で自分の交易所と翠糖京を3往復させよ。',
  goods: ['wheat', 'dates', 'honey', 'cane', 'rawsugar', 'molasses', 'whitesugar', 'sweets'],
  start: { silver: 1600, merchants: [{ name: 'ハサン', portrait: 'merchant-1' }] },
  cities: [
    // 白糖の需要の波（祭りの季節）: 80日で一回り。翠糖京と糖蜜町は山がずれている。片方へ流し続けると、谷の時期は安くしか売れない（17回目の Sol: 同じ便の増員だけで6シードすべてS）
    { id: 'toumitsu', name: '糖蜜町', x: 430, y: 300, pop: 1300, produces: { wheat: 7, honey: 0.8 }, waves: { whitesugar: { period: 80, amp: 0.8, phase: 40, demand: true } } },
    { id: 'suitou', name: '翠糖京', x: 810, y: 320, pop: 3600, produces: { wheat: 9, dates: 2, honey: 1.4 }, waves: { whitesugar: { period: 80, amp: 0.8, demand: true } } },
  ],
  edges: [{ a: 'toumitsu', b: 'suitou', kind: 'road' }],
  knownAtStart: ['toumitsu', 'suitou'],
  pioneer: {
    families: [{ id: 'hasan', name: 'ハサン家', x: 205, y: 405, text: '西の緑地、サトウキビ畑のそばに館がある。' }],
    hamlets: [
      { name: '甘蔗の集落', x: 150, y: 430, pop: 420, foods: { cane: 12, wheat: 3 } },
      { name: '麦の集落', x: 260, y: 330, pop: 360, foods: { wheat: 7.5 } },
      { name: '蜜蜂の丘', x: 420, y: 110, pop: 300, foods: { honey: 1.5, dates: 2.5 } },
      { name: 'なつめ村', x: 690, y: 525, pop: 320, foods: { dates: 4.5 } },
    ],
    wilds: [{ type: 'manor', x: 600, y: 200 }],
    rivalPosts: [],
  },
  shapes: [{ kind: 'green', points: [[60, 340], [260, 330], [300, 520], [80, 560]] }],
  decor: ['field', 'cane-field', 'cane-field', 'forest', 'palm', 'dunes'],
  // 「白糖を200個つくる」は製糖所の速さだけで決まり、定期便を写して待つだけでSが取れた（17回目の Opus・Sol）。売った額にして、需要の山で売るほど早くする
  goals: [{ type: 'sellValue', good: 'whitesugar', amount: 9000 }, { type: 'networth', amount: 5000 }, { type: 'link', a: 'post', b: 'suitou', count: 3 }],
  deadline: 420, rankS: 0.4,
  maxPosts: 3, postCost: 300, maxPaths: 3,
  tutorial: [
    { text: '甘蔗の集落のそば（緑の印）に、最初の交易所を置く（無料）', done: (w) => Object.values(w.cities).some((c) => c.founded) },
    { text: '交易所の欄のいちばん上から「市場」に格上げする（900銀）。工房を建てられるようになる', done: (w) => Object.values(w.cities).some((c) => c.founded && c.grade >= 1) || w.player.buildings.length > 0 },
    { text: '市場に製糖所を建てる（町の欄 / CLI: build mill confirm）。市場のサトウキビを自動で仕入れて加工する', done: (w) => w.player.buildings.some((b) => b.type === 'mill') },
    { text: '数日待つと、サトウキビ → 粗糖 → 白糖とできる。白糖を倉庫から積む（交易画面の倉庫 / CLI: load whitesugar all）', done: (w) => w.player.merchants.some((m) => m.cargo.whitesugar > 0) || (w.stats.soldTotal.whitesugar || 0) > 0 },
    { text: '翠糖京で白糖を売る（大都市ほど高く売れる。糖蜜町を通る街道が速い）', done: (w) => (w.stats.soldTotal.whitesugar || 0) > 0 },
    { text: 'この往復を定期便にする（自分の市場で「積む: 白糖」、翠糖京で「売る: 白糖」）', done: (w) => w.player.merchants.some((m) => m.order) },
    { text: '技術「精製の秘法」を買うと工房の生産が増える（上の「技術」/ CLI: techs）', done: (w) => !!w.techs?.refinery },
  ],
  transports: ['donkey', 'cart'],
  buildings: ['mill', 'confectionery', 'road'],
  techs: { refinery: { from: 0 } },
  events: true, contracts: true, bandits: false, newsDaysPerHop: 4,
  disabledEvents: ['sandstorm'],
  maxMerchants: 3,
};

const s4 = {
  id: 's4', no: 4, title: '砂の海',
  // 版4: 一族の館は砂の海の真ん中、蜃気楼オアシスのそば。オアシスは集落になった（ほかの町は古い町のまま）
  intro: '一族の館は、砂の海の真ん中、蜃気楼オアシスのそばにある。オアシスのそばに交易所を開き、東の玻璃の都の絹を西の緑門へ運べ。隊商は砂漠で食べ物を食べ、盗賊も出る。ラクダ（隊商宿の町などの砂漠の町で買える）と護衛と食料を整えて渡れ。絹を緑門で150反売り、オアシスの交易所を「町」（人口1000）に育てよ。オアシスはなつめやしと塩しか採れない──麦やぶどう、甘味を届けると育つ。',
  goods: ['wheat', 'dates', 'grapes', 'raisins', 'rawsugar', 'salt', 'spice', 'silk'],
  start: { silver: 900, merchants: [{ name: 'ハサン', portrait: 'merchant-1' }] },
  cities: [
    { id: 'ryokumon', name: '緑門', x: 100, y: 300, pop: 3200, produces: { wheat: 14, grapes: 5, rawsugar: 2 } },
    { id: 'yado', name: '隊商宿の町', x: 330, y: 240, pop: 650, produces: { dates: 6, raisins: 1.5 }, tags: ['desert'] },
    { id: 'hari', name: '玻璃の都', x: 890, y: 270, pop: 4300, produces: { silk: 2.4, spice: 1.6, wheat: 10 } },
    { id: 'shio', name: '塩の村', x: 500, y: 540, pop: 320, produces: { salt: 6, dates: 2 }, tags: ['desert'] },
  ],
  edges: [
    { a: 'ryokumon', b: 'yado', kind: 'trail' },
    { a: 'yado', b: 'hari', kind: 'desert', danger: 1 }, // オアシスを通る古い隊商路（危険度2では、オアシスへ食べ物を運ぶほど赤字になった。17回目の Opus）
    { a: 'yado', b: 'shio', kind: 'desert', danger: 1 },
    { a: 'shio', b: 'hari', kind: 'desert', lenMul: 1.15 },
  ],
  knownAtStart: ['ryokumon', 'yado', 'hari', 'shio'],
  pioneer: {
    families: [{ id: 'hasan', name: 'ハサン家', x: 545, y: 365, text: '砂の海の真ん中、蜃気楼オアシスのそばに館がある。' }],
    // 蜃気楼オアシスのそば（市場の圏）に、ぶどうの泉。格上げすると取り込める（オアシスが人口1000に届かなかった。17回目の Opus・Sol）
    hamlets: [{ name: '蜃気楼オアシス', x: 580, y: 335, pop: 360, foods: { dates: 4, salt: 2 } }, { name: 'ぶどうの泉', x: 612, y: 362, pop: 120, foods: { grapes: 1.2 } }],
    wilds: [{ type: 'inn', x: 584, y: 315 }],
    rivalPosts: [],
  },
  shapes: [
    { kind: 'desert', points: [[260, 120], [760, 90], [820, 560], [380, 590], [250, 400]] },
    { kind: 'green', points: [[0, 150], [200, 140], [210, 470], [0, 480]] },
  ],
  decor: ['dunes', 'dunes', 'dunes', 'palm', 'mountain'],
  decorCount: 34,
  goals: [{ type: 'deliver', good: 'silk', city: 'ryokumon', amount: 150 }, { type: 'hamletPost', hamlet: '蜃気楼オアシス', pop: 1000 }],
  deadline: 540, rankS: 0.4,
  maxPosts: 2, postCost: 400, maxPaths: 2,
  transports: ['donkey', 'camel'],
  techs: { caravanserai: { from: 0 } },
  events: true, contracts: true, bandits: true, newsDaysPerHop: 5,
  maxMerchants: 4,
};

const s5 = {
  id: 's5', no: 5, title: '甘い熱狂',
  // 版4: ぶどう谷は集落になった。一族の館はそのそば（ほかの町は古い町のまま）
  intro: '一族の館は、ぶどう谷の集落のそばにある。そこに交易所を開いて始めよ。祭都は甘味に飢えている。よく食べている町（このシナリオでは糖度130以上）に甘味を2種類以上まとめて届けるとシュガーラッシュ──甘味が飛ぶように売れる。だが熱狂のあとにはクラッシュが来て、町の成長が止まる。甘味は甘蔗浜（粗糖・白糖）とぶどう谷（蜂蜜）で手に入る。ラッシュを2回起こしつつ、祭都を「都市」に育てよ。祭りの都にふさわしく、稲田・甘蔗浜と自分の交易所から祭都へ街道を通すこと（町の画面の「街道を敷く」/ CLI: path）。コツ: 定期便を一時停止して商人の到着をそろえ、甘味を一気に届けると条件がそろいやすい。',
  goods: ['wheat', 'rice', 'dates', 'grapes', 'honey', 'rawsugar', 'malt', 'mizuame', 'wine', 'sweets', 'whitesugar'],
  start: { silver: 900, merchants: [{ name: 'ハサン', portrait: 'merchant-1' }, { name: 'ライラ', portrait: 'merchant-2' }] },
  cities: [
    { id: 'saito', name: '祭都', x: 500, y: 300, pop: 2300, produces: { wheat: 7 } },
    { id: 'ine', name: '稲田', x: 190, y: 170, pop: 700, produces: { rice: 10, wheat: 3 } },
    { id: 'satou', name: '甘蔗浜', x: 810, y: 480, pop: 800, produces: { rawsugar: 4.5, whitesugar: 0.6 } },
    { id: 'natsu', name: 'ナツメ丘', x: 810, y: 130, pop: 520, produces: { dates: 7.5 } },
  ],
  decor: ['field', 'field', 'forest', 'palm', 'cane-field'],
  edges: [
    { a: 'saito', b: 'ine', kind: 'trail' },
    { a: 'saito', b: 'satou', kind: 'trail' },
    { a: 'saito', b: 'natsu', kind: 'trail' },
    { a: 'satou', b: 'natsu', kind: 'trail' },
  ],
  knownAtStart: ['saito', 'ine', 'satou', 'natsu'],
  pioneer: {
    families: [{ id: 'hasan', name: 'ハサン家', x: 250, y: 455, text: 'ぶどう谷のそばに館がある。蜂蜜も採れる谷。' }],
    hamlets: [{ name: 'ぶどう谷', x: 210, y: 480, pop: 620, foods: { grapes: 8, honey: 1.5 } }],
    wilds: [],
    rivalPosts: [],
  },
  maxPosts: 2, postCost: 400, maxPaths: 6,
  rushLine: 130, // 祭りの都は浮かれやすい（ラッシュが目標なので、ほかの町より低い糖度で起きる）
  goals: [{ type: 'rushes', city: 'saito', count: 2 }, { type: 'cityTier', city: 'saito', tier: 3 }, { type: 'network', cities: ['saito', 'ine', 'satou'], posts: 1, mode: 'road' }],
  deadline: 480, rankS: 0.45,
  transports: ['donkey', 'cart'],
  techs: { refinery: { from: 30 }, wheel: { from: 0 } },
  buildings: ['malthouse', 'winery', 'confectionery', 'road'],
  events: true, contracts: true, bandits: false, newsDaysPerHop: 3,
  disabledEvents: ['sandstorm'],
  maxMerchants: 4, branches: true,
};

const s6 = {
  id: 's6', no: 6, title: '季節風の港',
  // 版4: 香木村は集落になった。一族の館はそのそば。白檀港まで歩いて、港でダウ船を買う
  intro: '一族の館は、白檀港の南、香木村の集落のそばにある。そこに交易所を開いて始めよ。海を渡れば、香辛料と茶の島々。ダウ船は白檀港などの港で買える。ダウ船は季節風に乗れば速く、逆らえば遅い。夏は東へ、冬は西へ。胡椒港の香辛料を白檀港で200袋売り、資産を9000銀にせよ。ただし今の白檀港は「町」で、香辛料を買い取らない。進め方の例: ①胡椒港の米と砂糖岬の甘味を白檀港へ運んで「都市」（人口3000）に育てる → ②香辛料を胡椒港から白檀港へ。値崩れしたら少し待つと戻る。',
  goods: ['wheat', 'rice', 'dates', 'rawsugar', 'whitesugar', 'salt', 'spice', 'tea', 'pottery'],
  start: { silver: 1700, merchants: [{ name: 'ハサン', portrait: 'merchant-1' }] },
  cities: [
    { id: 'byakudan', name: '白檀港', x: 150, y: 210, pop: 2600, produces: { pottery: 2.2, wheat: 9, salt: 2 }, tags: ['port'] },
    { id: 'chanoshima', name: '茶の島', x: 500, y: 330, pop: 640, produces: { tea: 3.2, rawsugar: 2.5 }, tags: ['port'] },
    { id: 'misaki', name: '砂糖岬', x: 620, y: 90, pop: 900, produces: { rawsugar: 4, whitesugar: 0.8 }, tags: ['port'] },
    { id: 'koshou', name: '胡椒港', x: 880, y: 430, pop: 1700, produces: { spice: 3.2, rice: 9 }, tags: ['port'] },
  ],
  shapes: [{ kind: 'sea', points: [[230, 0], [1000, 0], [1000, 600], [260, 600], [300, 420], [240, 300]] }],
  decor: ['field', 'forest', 'palm'],
  edges: [
    { a: 'byakudan', b: 'chanoshima', kind: 'sea', monsoon: true },
    { a: 'chanoshima', b: 'koshou', kind: 'sea', monsoon: true },
    { a: 'byakudan', b: 'misaki', kind: 'sea', monsoon: true },
    { a: 'misaki', b: 'koshou', kind: 'sea', monsoon: true },
    { a: 'misaki', b: 'chanoshima', kind: 'sea' },
  ],
  knownAtStart: ['byakudan', 'chanoshima', 'misaki', 'koshou'],
  pioneer: {
    families: [{ id: 'hasan', name: 'ハサン家', x: 150, y: 470, text: '白檀港の南、香木の森のそばに館がある。' }],
    hamlets: [{ name: '香木村', x: 110, y: 500, pop: 520, foods: { wheat: 6, dates: 3 } }],
    wilds: [],
    rivalPosts: [],
  },
  maxPosts: 2, postCost: 400, maxPaths: 2,
  goals: [{ type: 'deliver', good: 'spice', city: 'byakudan', amount: 200 }, { type: 'networth', amount: 9000 }],
  deadline: 480, rankS: 0.4,
  transports: ['donkey', 'dhow', 'carrack'],
  events: true, contracts: true, bandits: false, newsDaysPerHop: 5,
  disabledEvents: ['sandstorm'],
  maxMerchants: 3, branches: true,
};

const s7 = {
  id: 's7', no: 7, title: '白い黄金',
  // 版4: キビ原は集落になった。一族の館はそのそば。製糖所は、交易所を「市場」に格上げすると建てられる
  intro: '一族の館は、北のキビ原のそばにある。そこに交易所を開き、「市場」に格上げして製糖所を建てよ。白糖は「白い黄金」と呼ばれる。紫衣のサルマン商会は南キビ村に製糖所を持ち、白糖を各地へ運んで値を崩していく。工房と定期便を整え、白糖を売った額でサルマン商会を上回れ（1万銀以上。市場で買った白糖の代金は差し引く＝自分で作った分の勝負。安く売り崩せば額は伸びない）。精製の技術は先に買った方が独占できる（上の「技術」/ CLI: techs）。',
  goods: ['wheat', 'dates', 'honey', 'cane', 'rawsugar', 'molasses', 'whitesugar', 'sweets', 'salt'],
  start: { silver: 1800, merchants: [{ name: 'ハサン', portrait: 'merchant-1' }] },
  cities: [
    { id: 'hakuto', name: '白都', x: 520, y: 290, pop: 3400, produces: { wheat: 8, salt: 2 } },
    { id: 'kibi2', name: '南キビ村', x: 210, y: 500, pop: 500, produces: { cane: 8, dates: 3 } },
    { id: 'mitsu', name: '蜜の森', x: 860, y: 120, pop: 520, produces: { honey: 3, dates: 2 } },
    { id: 'kanmi', name: '甘味の町', x: 860, y: 470, pop: 1500, produces: { wheat: 5, rawsugar: 1.5 } },
    { id: 'shio', name: '塩田', x: 520, y: 560, pop: 380, produces: { salt: 6 } },
  ],
  decor: ['cane-field', 'cane-field', 'field', 'forest', 'mountain'],
  edges: [
    { a: 'hakuto', b: 'kibi2', kind: 'trail' },
    { a: 'hakuto', b: 'mitsu', kind: 'trail' },
    { a: 'hakuto', b: 'kanmi', kind: 'road' },
    { a: 'hakuto', b: 'shio', kind: 'trail' },
    { a: 'mitsu', b: 'kanmi', kind: 'trail' },
    { a: 'kibi2', b: 'shio', kind: 'trail' },
  ],
  rivals: [{
    name: 'サルマン商会', silver: 900, skill: 0.85, goods: ['wheat', 'dates', 'honey', 'rawsugar', 'salt'],
    // 2日に1回動く（毎日だと、ライバルの工房が先に仕入れるようにしたあと、手引きどおりに遊んでも売上の9割ほどで届かなかった。17回目）
    workshop: { city: 'kibi2', input: 'cane', output: 'whitesugar', inputPerDay: 8, ratio: 4, everyDays: 2 },
    merchants: [{ city: 'kibi2', transport: 'donkey', wait: 12, home: true }, { city: 'kibi2', transport: 'donkey', wait: 30, home: true }, { city: 'kanmi', transport: 'donkey', wait: 8 }],
  }],
  knownAtStart: ['hakuto', 'kibi2', 'mitsu', 'kanmi', 'shio'],
  pioneer: {
    families: [{ id: 'hasan', name: 'ハサン家', x: 200, y: 180, text: '北のキビ原のそばに館がある。' }],
    hamlets: [{ name: 'キビ原', x: 150, y: 150, pop: 600, foods: { cane: 12, wheat: 3 } }],
    wilds: [],
    rivalPosts: [],
  },
  maxPosts: 2, postCost: 400, maxPaths: 4,
  goals: [{ type: 'share', good: 'whitesugar', share: 0.5, min: 10000, by: 'value' }],
  // 白糖を食べる町は2つだけ。需要を抑えて、売り先と売る時機で値が変わるようにする（13回目の Sol の案）
  demandScale: { whitesugar: 0.6 },
  // 白都だけへの固定の便で 195〜240日（S は 0.45 だと4シード中2つ）。ライバルの隊商の行き先を読んで売り先を分けると縮む線にする
  deadline: 480, rankS: 0.4,
  transports: ['donkey', 'cart'],
  techs: { refinery: { from: 0 }, wheel: { from: 20 } },
  buildings: ['mill', 'confectionery', 'road'],
  events: true, contracts: true, bandits: false, newsDaysPerHop: 4,
  disabledEvents: ['sandstorm'],
  maxMerchants: 4, branches: true,
};

const s8 = {
  id: 's8', no: 8, title: 'グルコース・ロード',
  // 版4: 甘蔗平原とぶどう高原は集落になった。一族を2つから選ぶ（館の場所が違う）
  intro: '一族を選べ。甘蔗平原の一族はサトウキビとキビ、ぶどう高原の一族はぶどうと蜂蜜から始める。西の海から東の砂漠まで、大陸を貫く糖の道。ここまでに学んだすべて──相場の読み、食卓の多様さ、工房、砂漠、季節風、ライバル──を使って、都・琥珀京を「大都市」に育て上げ、一族の資産を40000銀にせよ。琥珀京の食卓は、地図じゅうの食べ物でも足りない──古い町の区画にも畑を置ける（町の欄の「地図の上で建てる」）。さらに、自分の交易所のどれかを「都市」（人口3000）まで育てて、一族の拠点とせよ（交易所は上の「交易所」/ CLI: sites）。大型帆船や菓子の技は技術として買える。一族の名を歴史に刻め。',
  goods: ['wheat', 'rice', 'millet', 'dates', 'grapes', 'raisins', 'cane', 'honey', 'rawsugar', 'molasses', 'whitesugar', 'sweets', 'sugarart', 'wine', 'silk', 'spice', 'tea', 'pottery', 'salt', 'spicesugar', 'teacake'],
  start: { silver: 1400, merchants: [{ name: 'ハサン', portrait: 'merchant-1' }, { name: 'ライラ', portrait: 'merchant-2' }] },
  cities: [
    // 甘蔗平原とぶどう高原を集落にした分、都の畑を広げた（そのままでは琥珀京が大都市に届かなかった。17回目）
    { id: 'kohaku', name: '琥珀京', x: 500, y: 300, pop: 4200, produces: { wheat: 15, millet: 5, pottery: 1.5 } },
    { id: 'seikai', name: '西海港', x: 70, y: 260, pop: 1800, produces: { rice: 8, tea: 2, salt: 2 }, tags: ['port'] },
    { id: 'natsume', name: 'ナツメ泉', x: 680, y: 140, pop: 500, produces: { dates: 8 }, tags: ['desert'] },
    { id: 'hari', name: '玻璃の都', x: 940, y: 220, pop: 3800, produces: { silk: 2.5, spice: 1.2, wheat: 8 } },
    { id: 'shio', name: '塩の村', x: 760, y: 500, pop: 380, produces: { salt: 6, dates: 2 }, tags: ['desert'] },
    { id: 'kome', name: '米どころ', x: 470, y: 540, pop: 900, produces: { rice: 10, wheat: 4 } },
    { id: 'minami', name: '南の港', x: 90, y: 560, pop: 900, produces: { spice: 1.5, rawsugar: 2.5 }, tags: ['port'] },
  ],
  shapes: [
    { kind: 'sea', points: [[0, 330], [40, 330], [150, 400], [180, 600], [0, 600]] },
    { kind: 'sea', points: [[0, 0], [30, 0], [20, 200], [0, 220]] },
    { kind: 'desert', points: [[600, 60], [1000, 60], [1000, 600], [640, 600], [620, 330]] },
    { kind: 'green', points: [[160, 360], [420, 380], [440, 600], [200, 600]] },
  ],
  decor: ['dunes', 'mountain', 'palm', 'field', 'forest', 'cane-field'],
  decorCount: 36,
  edges: [
    { a: 'kohaku', b: 'kome', kind: 'road' },
    { a: 'kohaku', b: 'seikai', kind: 'trail' },
    { a: 'kohaku', b: 'natsume', kind: 'desert', danger: 1 },
    { a: 'kohaku', b: 'shio', kind: 'desert', danger: 1 },
    { a: 'natsume', b: 'hari', kind: 'desert', danger: 2 },
    { a: 'shio', b: 'hari', kind: 'desert', danger: 1, lenMul: 1.1 },
    { a: 'seikai', b: 'minami', kind: 'sea', monsoon: true },
    { a: 'minami', b: 'kome', kind: 'trail' },
  ],
  rivals: [{
    name: 'サルマン商会', silver: 1500, skill: 0.8, goods: ['wheat', 'rice', 'dates', 'rawsugar', 'whitesugar', 'silk', 'spice', 'tea', 'salt'],
    merchants: [{ city: 'hari', transport: 'camel', wait: 5 }, { city: 'seikai', transport: 'donkey', wait: 10 }],
  }],
  knownAtStart: ['kohaku', 'seikai', 'natsume', 'hari', 'shio', 'kome', 'minami'],
  pioneer: {
    families: [
      { id: 'kibi', name: '甘蔗平原の一族', x: 270, y: 445, text: '南の緑地、甘蔗平原のそばに館がある。サトウキビとキビの土地。' },
      { id: 'budou', name: 'ぶどう高原の一族', x: 300, y: 135, text: '北の高原、ぶどう高原のそばに館がある。ぶどう・干しぶどう・蜂蜜の土地。' },
    ],
    hamlets: [
      { name: '甘蔗平原', x: 230, y: 470, pop: 700, foods: { cane: 11, millet: 4 } },
      { name: 'ぶどう高原', x: 260, y: 110, pop: 650, foods: { grapes: 8, raisins: 1.5, honey: 1.2 } },
    ],
    wilds: [{ type: 'manor', x: 390, y: 420 }, { type: 'shrine', x: 380, y: 150 }],
    rivalPosts: [],
  },
  maxPosts: 4, postCost: 400, maxPaths: 8,
  // 交易所は集落を取り込んで大きく始まるので、目標は「都市」（町の段階では、取り込んだだけで届いた）
  // 資産25000は放っておいても届き、琥珀京8000が重かった（17回目の Opus）
  goals: [{ type: 'cityTier', city: 'kohaku', tier: 4 }, { type: 'networth', amount: 40000 }, { type: 'postTier', tier: 3, pop: 3000 }],
  deadline: 900, rankS: 0.55,
  transports: ['donkey', 'camel', 'cart', 'dhow'],
  buildings: ['mill', 'confectionery', 'winery', 'malthouse', 'road'],
  techs: { carrack: { from: 240 }, refinery: { from: 0 }, caravanserai: { from: 0 }, wheel: { from: 60 }, sugarcraft: { from: 0 }, teaceremony: { from: 60 }, spicesugar: { from: 120 } },
  events: true, contracts: true, bandits: true, newsDaysPerHop: 4,
  maxMerchants: 6, branches: true,
};

export const SCENARIOS = { s1, s2, s3, s4, s5, s6, s7, s8 };
export const SCENARIO_ORDER = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
