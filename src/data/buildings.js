// 工房と施設
// recipes: 1回分の材料と産物。batches: 1日に回せる回数

export const BUILDINGS = {
  mill: {
    name: '製糖所', cost: 450, upkeep: 2, batches: 3,
    recipes: [
      { in: { rawsugar: 2 }, out: { whitesugar: 1 }, name: '白糖の精製' },
      { in: { cane: 4 }, out: { rawsugar: 2, molasses: 1 }, name: '粗糖づくり' },
    ],
  },
  confectionery: {
    // 菓子づくりは白糖2＋麦2→菓子3（2026-10-21 に 白糖1＋麦1→菓子2 から変更。docs/balance-log.md）
    name: '菓子工房', cost: 1200, upkeep: 3, batches: 2,
    recipes: [
      { in: { whitesugar: 3, honey: 1 }, out: { sugarart: 1 }, name: '砂糖細工', minTier: 3 },
      { in: { whitesugar: 2, wheat: 2 }, out: { sweets: 3 }, name: '菓子づくり' },
      // 麦が手に入らない大都市で止まり続けないように、米でも作れる（12回目の Opus の指摘）
      { in: { whitesugar: 2, rice: 2 }, out: { sweets: 3 }, name: '米菓子づくり' },
    ],
  },
  winery: {
    name: '醸造所', cost: 500, upkeep: 2, batches: 3,
    recipes: [{ in: { grapes: 3 }, out: { wine: 1 }, name: '果実酒づくり' }],
  },
  malthouse: {
    name: '麦芽小屋', cost: 400, upkeep: 1, batches: 3,
    recipes: [
      { in: { malt: 2 }, out: { mizuame: 1 }, name: '水飴づくり' },
      { in: { wheat: 2 }, out: { malt: 2 }, name: '麦芽づくり' },
    ],
  },
  road: { name: '街道の整備', costPerLength: 6 },
};
