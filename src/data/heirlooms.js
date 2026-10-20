// 家訓: シナリオを達成すると、そのシナリオの家訓が解放される。
// シナリオの最初に、解放済みの家訓から1つだけ選んで持っていける（重ねがけはしない）。
// どの家訓にも利点と代償がある。強さの上乗せではなく、遊び方の違いにするため。
// mods の意味（world.player.mods に入る）:
//   sell 売値の上乗せ / spread 手数料の倍率 / speed 移動速度の増減 / safety 盗賊に襲われる確率の倍率
//   upkeep 維持費の倍率 / dailyFee 毎日の支払い / hireCost 雇用費の倍率 / buildCost 工房の建設費の倍率
//   donateCost 寄進の費用の倍率 / batchBonus 工房の1日の回数の上乗せ / cap 積載の倍率
//   startSilver 開始時の銀の倍率 / startBonus 開始時の銀の上乗せ
export const HEIRLOOMS = {
  shousai:  { name: '商才',     unlock: 's1', plus: '売値 +5%',                minus: '商人を雇う費用 +30%',       mods: { sell: 0.05, hireCost: 1.3 } },
  kenyaku:  { name: '倹約',     unlock: 's2', plus: '維持費 -35%',             minus: '開始時の銀 -20%',           mods: { upkeep: 0.65, startSilver: 0.8 } },
  shokunin: { name: '職人気質', unlock: 's3', plus: '工房が1日に1回多く動く',  minus: '工房の建設費 +40%',         mods: { batchBonus: 1, buildCost: 1.4 } },
  youjin:   { name: '用心',     unlock: 's4', plus: '盗賊に襲われる確率 -50%', minus: '移動 -6%',                  mods: { safety: 0.5, speed: -0.06 } },
  jinbou:   { name: '人望',     unlock: 's5', plus: '手数料 -30%',             minus: '寄進の費用 +60%',           mods: { spread: 0.7, donateCost: 1.6 } },
  kenkyaku: { name: '健脚',     unlock: 's6', plus: '移動 +12%',               minus: '積載 -15%',                 mods: { speed: 0.12, cap: 0.85 } },
  motode:   { name: '元手',     unlock: 's7', plus: '開始時の銀 +500',         minus: '借りた元手の利子で毎日3銀', mods: { startBonus: 500, dailyFee: 3 } },
};

export const heirloomText = (k) => `${HEIRLOOMS[k].name}（${HEIRLOOMS[k].plus}／${HEIRLOOMS[k].minus}）`;

// そのシナリオを達成すると解放される家訓
export const heirloomFor = (scenarioId) => Object.keys(HEIRLOOMS).find((k) => HEIRLOOMS[k].unlock === scenarioId) || null;
