// 家訓: シナリオを達成すると1つ選び、次のシナリオへ受け継ぐ（重ねがけ可）
export const HEIRLOOMS = {
  shousai: { name: '商才', text: '売値 +4%', apply: (w) => { w.player.heirloomSell = (w.player.heirloomSell || 0) + 0.04; } },
  jinbou:  { name: '人望', text: '手数料 -15%', apply: (w) => { w.player.heirloomSpread = (w.player.heirloomSpread || 0) - 0.15; } },
  kenkyaku: { name: '健脚', text: '移動速度 +10%', apply: (w) => { w.player.heirloomSpeed = (w.player.heirloomSpeed || 0) + 0.1; } },
  kenyaku: { name: '倹約', text: '維持費 -30%', apply: (w) => { w.player.heirloomUpkeep = Math.min(0.6, (w.player.heirloomUpkeep || 0) + 0.3); } },
  youjin:  { name: '用心', text: '盗賊に襲われる確率 -40%', apply: (w) => { w.player.heirloomSafety = Math.min(0.8, (w.player.heirloomSafety || 0) + 0.4); } },
  motode:  { name: '元手', text: '開始時の銀 +300', apply: (w) => { w.player.silver += 300; } },
};
