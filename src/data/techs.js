// 技術（E2）: お金で買う。ライバルのいるシナリオでは先に買った側が独占し、もう一方は使用料を払って使う
export const TECHS = {
  // 駅伝制は版4で外した（相場はいつも最新になったため）。古いセーブの表示のためだけに残す
  relay: { name: '駅伝制', cost: 1500, text: '（版4で廃止）', legacy: true },
  carrack: { name: '大型帆船の造船術', cost: 2000, text: '大型帆船（積載220）が都市の港で買える' },
  refinery: { name: '精製の秘法', cost: 1200, text: '工房の1日の生産回数 +1' },
  caravanserai: { name: '隊商宿の網', cost: 900, text: '砂漠で食べる食料が3割減る' },
  wheel: { name: '鉄の車輪', cost: 1000, text: '荷車の積載 +20%' },
};
export const LICENSE_RATE = 0.6; // 使用料は値段の6割（独占した側に入る）
