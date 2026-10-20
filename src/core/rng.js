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
