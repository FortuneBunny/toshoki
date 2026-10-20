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
    name: '菓子工房', cost: 900, upkeep: 3, batches: 2,
    recipes: [
      { in: { whitesugar: 3, honey: 1 }, out: { sugarart: 1 }, name: '砂糖細工', minTier: 3 },
      { in: { whitesugar: 1, wheat: 1 }, out: { sweets: 2 }, name: '菓子づくり' },
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
