// 技術（E2）: お金で買う。ライバルのいるシナリオでは先に買った側が独占し、もう一方は使用料を払って使う
export const TECHS = {
  // 駅伝制は版4で外した（相場はいつも最新になったため）。古いセーブの表示のためだけに残す
  relay: { name: '駅伝制', cost: 1500, text: '（版4で廃止）', legacy: true },
  carrack: { name: '大型帆船の造船術', cost: 2000, text: '大型帆船（積載220）が都市の港で買える' },
  refinery: { name: '精製の秘法', cost: 1200, text: '工房の1日の生産回数 +1' },
  caravanserai: { name: '隊商宿の網', cost: 900, text: '砂漠で食べる食料が3割減る' },
  wheel: { name: '鉄の車輪', cost: 1000, text: '荷車の積載 +20%' },
  // 品を開く技術（版4 H3）: 作り方と、その品を求める需要が開く。だれかが買うまで、その品はどの町でも求められない。
  // ライバルが先に買うと、作るには使用料が要る（需要はどちらが買っても開く）
  whiterefining: { name: '白糖の精製法', cost: 900, text: '製糖所で粗糖から白糖を作れる。町が白糖を求め始める', unlocks: { recipes: ['白糖の精製'], goods: ['whitesugar'], producers: ['sugar_white'] } },
  confection: { name: '菓子の技', cost: 800, text: '菓子工房を建てられる。町が菓子を求め始める', unlocks: { buildings: ['confectionery'], goods: ['sweets'] } },
  sugarcraft: { name: '砂糖細工の技法', cost: 1500, text: '菓子工房で砂糖細工を作れる（都市以上）。宮殿と都市が砂糖細工を求め始める', unlocks: { recipes: ['砂糖細工'], goods: ['sugarart'] } },
  spicesugar: { name: '香辛糖の秘伝', cost: 1600, text: '菓子工房で白糖と香辛料から香辛糖を作れる。宮殿と都市が香辛糖を求め始める', unlocks: { recipes: ['香辛糖づくり'], goods: ['spicesugar'] } },
  teaceremony: { name: '茶の湯の作法', cost: 1100, text: '菓子工房で茶と蜂蜜から茶菓子を作れる。茶館と町が茶菓子を求め始める', unlocks: { recipes: ['茶菓子づくり'], goods: ['teacake'] } },
};
export const LICENSE_RATE = 0.6; // 使用料は値段の6割（独占した側に入る）
