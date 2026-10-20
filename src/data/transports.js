// 輸送手段
// cap: 積載量  speed: 1日に進む距離  modes: 通れる道の種類  cost: 購入費  upkeep: 1日の維持費
// buyAt: 購入できる町の条件（tier = 町の段階の下限、tags = 町の特徴）

export const TRANSPORTS = {
  donkey:  { name: 'ロバ',     cap: 20,  speed: 10, modes: ['trail', 'road', 'desert'], cost: 0,    upkeep: 0, buyAt: { tier: 0 } },
  camel:   { name: 'ラクダ',   cap: 36,  speed: 12, modes: ['trail', 'road', 'desert'], cost: 260,  upkeep: 1, buyAt: { tags: ['desert'] } },
  cart:    { name: '荷車',     cap: 70,  speed: 9,  modes: ['road'],                    cost: 420,  upkeep: 2, buyAt: { tier: 2 } },
  dhow:    { name: 'ダウ船',   cap: 90,  speed: 16, modes: ['sea', 'river'],            cost: 900,  upkeep: 3, buyAt: { tags: ['port'] } },
  carrack: { name: '大型帆船', cap: 220, speed: 18, modes: ['sea'],                     cost: 2600, upkeep: 7, buyAt: { tags: ['port'], tier: 3 } },
};

// 道の種類
export const ROUTE_KINDS = {
  trail:  { name: '小道' },
  road:   { name: '街道' },
  desert: { name: '砂漠' },
  river:  { name: '川' },
  sea:    { name: '海' },
};

// ロバで砂漠を渡ると遅い
export const DESERT_SLOW = { donkey: 0.6 };
