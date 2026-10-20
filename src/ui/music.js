// 地域ごとの音楽（E3）: WebAudio で合成する。音声ファイルは使わない。
// 砂漠はヒジャーズ調、東の茶と絹の地は五音音階、海は長調、平原はドリア調。シュガーラッシュの間は変奏（速く、高く、きらきら）
let ctx = null;
let out = null;
let volume = 0.35;
let enabled = false;
let timer = null;
let region = 'plain';
let rush = false;
let step = 0;
let nextTime = 0;

const SCALES = {
  desert: [0, 1, 4, 5, 7, 8, 10, 12], // ヒジャーズ調
  east: [0, 2, 4, 7, 9, 12, 14, 16], // 五音音階
  sea: [0, 2, 4, 5, 7, 9, 11, 12], // 長調
  plain: [0, 2, 3, 5, 7, 9, 10, 12], // ドリア調
};
const ROOT = { desert: 146.8, east: 164.8, sea: 174.6, plain: 155.6 };
const TEMPO = { desert: 0.32, east: 0.36, sea: 0.3, plain: 0.34 };
// 旋律の型（音階の何番目か。-1 は休み）。決まった型を少しずつずらして繰り返す
const MOTIFS = {
  desert: [0, 1, 2, 1, 0, -1, 4, 3, 2, 1, 2, -1, 0, -1, 1, 0],
  east: [2, 3, 4, -1, 3, 2, 0, -1, 1, 2, 4, 5, 4, -1, 2, -1],
  sea: [0, 2, 4, 2, 5, 4, 2, -1, 3, 4, 5, 7, 5, 4, 2, -1],
  plain: [0, -1, 2, 3, 4, 3, 2, -1, 0, 1, 2, -1, 4, 2, 1, -1],
};
const BASS = { desert: [0, 0, 4, 0], east: [0, 3, 4, 3], sea: [0, 3, 4, 4], plain: [0, 3, 0, 4] };

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = volume;
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function note(freq, t, dur, { type = 'triangle', gain = 0.12, attack = 0.02 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function drum(t, { freq = 90, gain = 0.18, dur = 0.18 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 2, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const freqOf = (r, deg, oct = 0) => {
  const sc = SCALES[r];
  const i = ((deg % 7) + 7) % 7;
  const o = Math.floor(deg / 7) + oct;
  return ROOT[r] * 2 ** ((sc[i] + o * 12) / 12);
};

function schedule() {
  if (!ctx || !enabled) return;
  const beat = TEMPO[region] * (rush ? 0.75 : 1);
  while (nextTime < ctx.currentTime + 0.25) {
    const motif = MOTIFS[region];
    const bar = Math.floor(step / motif.length);
    let deg = motif[step % motif.length];
    // 4小節目ごとに型を少し上へずらす（単調にならないように）
    if (deg >= 0 && bar % 4 === 3) deg += 2;
    if (deg >= 0) note(freqOf(region, deg, rush ? 2 : 1), nextTime, beat * 1.6, { type: region === 'east' ? 'sine' : 'triangle', gain: 0.09 });
    if (rush && deg >= 0) note(freqOf(region, deg + 4, 2), nextTime + beat / 2, beat * 0.8, { type: 'sine', gain: 0.045 });
    if (step % 4 === 0) note(freqOf(region, BASS[region][(step / 4) % 4], -1), nextTime, beat * 3.6, { type: 'sine', gain: 0.11, attack: 0.05 });
    if (region === 'desert' || rush) { if (step % 4 === 0) drum(nextTime); if (step % 4 === 3) drum(nextTime, { freq: 160, gain: 0.08, dur: 0.08 }); }
    else if (step % 8 === 0) drum(nextTime, { freq: 70, gain: 0.1 });
    nextTime += beat;
    step++;
  }
}

export function setMusic(on, vol) {
  if (vol !== undefined) volume = vol;
  enabled = on;
  if (out) out.gain.value = volume;
  if (on) {
    if (!ensure()) return;
    if (!timer) { nextTime = ctx.currentTime + 0.1; timer = setInterval(schedule, 100); }
  } else if (timer) { clearInterval(timer); timer = null; }
}
export function setMusicMood(r, isRush) {
  if (SCALES[r] && r !== region) { region = r; step = 0; }
  rush = !!isRush;
}

// シナリオと商人のいる町から、地域を決める
export function regionFor(world, cityId) {
  const c = world.cities[cityId];
  if (!c) return 'plain';
  if (c.tags.includes('desert')) return 'desert';
  if (c.tags.includes('port')) return 'sea';
  if (world.scenario.goods.some((g) => g === 'tea' || g === 'silk')) return 'east';
  return 'plain';
}
