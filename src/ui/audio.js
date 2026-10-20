// WebAudio で合成する効果音。音声ファイルは使わない。
let ctx = null;
let master = null;
let enabled = true;
let volume = 0.5;

function ensure() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSound(on, vol) {
  enabled = on;
  if (vol !== undefined) volume = vol;
  if (master) master.gain.value = volume;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.3, slide = 0, attack = 0.005 } = {}) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(start, dur, { gain = 0.2, freq = 1200 } = {}) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + start;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

// 長調の音階（連続黒字で1段ずつ上がる）
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const note = (base, step) => base * Math.pow(2, SCALE[Math.min(step, SCALE.length - 1)] / 12);

export const sfx = {
  click() { tone(880, 0, 0.05, { type: 'triangle', gain: 0.12 }); },
  tick() { tone(1400, 0, 0.03, { type: 'square', gain: 0.03 }); },
  error() { tone(180, 0, 0.18, { type: 'sawtooth', gain: 0.12, slide: 0.7 }); },
  // 利益が大きいほど高く、粒の多い音
  coin(amount = 50, streak = 0) {
    const base = note(660, streak);
    const n = amount > 500 ? 5 : amount > 150 ? 4 : amount > 40 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      tone(base * (1 + i * 0.25), i * 0.055, 0.22, { type: 'triangle', gain: 0.22 });
      tone(base * 2 * (1 + i * 0.25), i * 0.055 + 0.01, 0.12, { type: 'sine', gain: 0.08 });
    }
  },
  loss() { tone(330, 0, 0.25, { type: 'triangle', gain: 0.2, slide: 0.6 }); tone(247, 0.12, 0.3, { type: 'triangle', gain: 0.15, slide: 0.6 }); },
  hit() {
    [0, 4, 7, 12, 16].forEach((st, i) => tone(523 * Math.pow(2, st / 12), i * 0.06, 0.3, { type: 'square', gain: 0.09 }));
    noise(0.28, 0.4, { gain: 0.08, freq: 6000 });
  },
  levelUp() {
    [0, 4, 7, 12].forEach((st, i) => tone(392 * Math.pow(2, st / 12), i * 0.1, 0.35, { type: 'triangle', gain: 0.22 }));
    [12, 16, 19, 24].forEach((st) => tone(392 * Math.pow(2, st / 12), 0.42, 0.9, { type: 'sine', gain: 0.1 }));
  },
  fanfare() {
    const seq = [[0, 0.12], [0, 0.12], [0, 0.12], [4, 0.35], [2, 0.12], [4, 0.12], [7, 0.8]];
    let t = 0;
    for (const [st, d] of seq) { tone(392 * Math.pow(2, st / 12), t, d + 0.1, { type: 'square', gain: 0.1 }); tone(196 * Math.pow(2, st / 12), t, d + 0.1, { type: 'triangle', gain: 0.12 }); t += d; }
  },
  rush() {
    for (let i = 0; i < 10; i++) tone(1200 + Math.random() * 1800, i * 0.04, 0.15, { type: 'sine', gain: 0.07 });
    tone(523, 0, 0.6, { type: 'triangle', gain: 0.15, slide: 2 });
  },
  crash() { noise(0, 0.5, { gain: 0.25, freq: 300 }); tone(196, 0, 0.6, { type: 'sawtooth', gain: 0.08, slide: 0.5 }); },
  bad() { tone(220, 0, 0.3, { type: 'square', gain: 0.08, slide: 0.8 }); tone(208, 0.15, 0.4, { type: 'square', gain: 0.08, slide: 0.8 }); },
  rare() { [0, 7, 12, 19].forEach((st, i) => tone(784 * Math.pow(2, st / 12), i * 0.05, 0.4, { type: 'sine', gain: 0.1 })); },
  depart() { tone(440, 0, 0.08, { type: 'triangle', gain: 0.1 }); tone(660, 0.07, 0.12, { type: 'triangle', gain: 0.1 }); },
  arrive() { tone(660, 0, 0.1, { type: 'triangle', gain: 0.12 }); tone(880, 0.08, 0.16, { type: 'triangle', gain: 0.12 }); },
  victory() {
    sfx.fanfare();
    setTimeout(() => [0, 4, 7, 11, 12].forEach((st, i) => tone(523 * Math.pow(2, st / 12), i * 0.08, 1.2, { type: 'sine', gain: 0.09 })), 1500);
  },
};
