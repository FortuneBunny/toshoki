// シード付き乱数（mulberry32）。状態は world.rngState に保存して再現性を保つ。

export function hashSeed(seed) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

export function nextRandom(world) {
  let t = (world.rngState = (world.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const chance = (world, p) => nextRandom(world) < p;
export const randInt = (world, lo, hi) => lo + Math.floor(nextRandom(world) * (hi - lo + 1));
export const pick = (world, arr) => arr[Math.floor(nextRandom(world) * arr.length)];
export const jitter = (world, amount) => 1 + (nextRandom(world) * 2 - 1) * amount;

// 目的ごとの乱数（28回目の相談）: シナリオに eventStream があると、通常の出来事・大口注文・盗賊・生産のゆらぎは、
// 行動と別の、日と場所から作った乱数を使う。プレイヤーが何をしても、同じ日の同じ場所では同じくじになる
// （1本の乱数を、雇う候補や商人の動きと共有していたので、同じシードでも遊び方で出来事が分かれ、比べられなかった。27回目の Sol）
export function inStream(world, key, fn) {
  if (!world.scenario?.eventStream) return fn();
  const keep = world.rngState;
  world.rngState = hashSeed(`${key}:${world.seed}:${world.day}`);
  try { return fn(); } finally { world.rngState = keep; }
}
