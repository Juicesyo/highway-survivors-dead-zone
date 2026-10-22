/**
 * 音效电平表（离线渲染，用来校准"听感音量"）
 *
 * 直接按 audio.js 里 tone / noise / burst 的包络公式合成采样，
 * 用 WebAudio 规格的 RBJ biquad 做滤波，算出每条音的峰值与 RMS，
 * 以「吸收经验」的 pickup 为参考（玩家反馈这个音量刚好）。
 *
 * 用法：node tools/sfx-level.js           只看现状
 *       node tools/sfx-level.js --json    输出机器可读结果
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SR = 44100;
const NOISE_SEC = 2.0;                 // 分析窗口（doom 最长 1.1s）

/* ---------------- 滤波与工具 ---------------- */
function biquadCoef(type, f0, Q) {
  const w0 = 2 * Math.PI * Math.min(SR * 0.49, Math.max(10, f0)) / SR;
  const cs = Math.cos(w0), sn = Math.sin(w0);
  if (type === 'bandpass') {
    const alpha = sn / (2 * Math.max(1e-4, Q));
    return [alpha, 0, -alpha, 1 + alpha, -2 * cs, 1 - alpha];
  }
  const q = Math.pow(10, Q / 20);      // WebAudio 的 lowpass Q 以 dB 计
  const alpha = sn / (2 * q);
  const b0 = (1 - cs) / 2, b1 = 1 - cs, b2 = (1 - cs) / 2;
  const a0 = 1 + alpha, a1 = -2 * cs, a2 = 1 - alpha;
  return [b0, b1, b2, a0, a1, a2];
}

/** 逐点跑一遍 biquad（频率可变，每 32 点重算一次系数） */
function runBiquad(x, type, Q, fAt) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c = null, lastF = -1;
  for (let i = 0; i < x.length; i++) {
    const f = fAt(i / SR);
    if (lastF < 0 || Math.abs(f - lastF) > 40) {
      c = biquadCoef(type, f, Q);
      lastF = f;
    }
    const [b0, b1, b2, a0, a1, a2] = c;
    const inV = x[i];
    const out = (b0 / a0) * inV + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = inV;
    y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}

const expEnv = (dur, vol) => (t) => {
  /* 0 → 0.008 起音，之后指数衰减到 0.0001（和 audio.js 完全一致） */
  const A0 = 0.0001;
  if (t < 0 || t > dur) return 0;
  if (t < 0.008) return A0 * Math.pow(vol / A0, t / 0.008);
  const k = (t - 0.008) / Math.max(1e-6, dur - 0.008);
  return vol * Math.pow(A0 / vol, Math.min(1, k));
};

const expFreq = (f0, f1, dur) => (t) => {
  const k = Math.min(1, Math.max(0, t / dur));
  return f0 * Math.pow(Math.max(20, f1) / f0, k);
};

function wave(type, ph) {
  switch (type) {
    case 'sine': return Math.sin(2 * Math.PI * ph);
    case 'triangle': return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
    case 'sawtooth': return 2 * ph - 1;
    default: return ph < 0.5 ? 1 : -1;
  }
}

/* ---------------- 三种发声原语 ---------------- */
const N = Math.floor(SR * NOISE_SEC);
const white = () => {
  const b = new Float64Array(N);
  for (let i = 0; i < N; i++) b[i] = 2 * Math.random() - 1;
  return b;
};

function simTone(freq, dur, type, vol, slideTo) {
  const n = Math.ceil(SR * (dur + 0.03));
  const out = new Float64Array(n);
  const env = expEnv(dur, vol);
  const fAt = slideTo ? expFreq(freq, slideTo, dur) : () => freq;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph = (ph + fAt(t) / SR) % 1;
    out[i] = wave(type || 'square', ph) * env(t);
  }
  return out;
}

function simNoise(dur, vol, cutoff) {
  const n = Math.ceil(SR * (dur + 0.02));
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = (2 * Math.random() - 1) * (1 - i / n);
  const env = expEnv(dur, vol);
  const filtered = runBiquad(raw, 'lowpass', 1, expFreq(cutoff || 1200, 120, dur));
  for (let i = 0; i < n; i++) filtered[i] *= env(i / SR);
  return filtered;
}

function simBurst(dur, vol, f0, f1) {
  const n = Math.ceil(SR * (dur + 0.02));
  const raw = new Float64Array(n);
  const w = white();
  for (let i = 0; i < n; i++) raw[i] = w[i % w.length];
  const env = expEnv(dur, vol);
  const filtered = runBiquad(raw, 'bandpass', 1.1, expFreq(f0, f1, dur));
  for (let i = 0; i < n; i++) filtered[i] *= env(i / SR);
  return filtered;
}

/** 多层混合（相位视为随机，采样的平方和叠加） */
function mixRMSAndPeak(layers, master) {
  let peak = 0, sum = 0, len = 0;
  for (const l of layers) {
    len = Math.max(len, l.length);
    for (let i = 0; i < l.length; i++) {
      sum += l[i] * l[i];
      if (Math.abs(l[i]) > peak) peak = Math.abs(l[i]);
    }
  }
  return {
    rms: Math.sqrt(sum / Math.max(1, len)) * master,
    peak: peak * master * (layers.length > 1 ? 1.25 : 1)   // 双层峰值大致相加（保守）
  };
}

/* ---------------- 从 audio.js 读出参数 ---------------- */
const src = fs.readFileSync(path.join(ROOT, 'src/core/audio.js'), 'utf8');
const masterM = src.match(/SFX_VOL:\s*([\d.]+)/);
const MASTER = masterM ? parseFloat(masterM[1]) : 1;

const sfxBlock = src.slice(src.indexOf('var SFX = {'), src.indexOf('var ART_SFX'));
const SFX = {};
const re = /(\w+):\s*\{\s*(?:n:\s*\[([^\]]+)\])?[,\s]*(?:t:\s*\[([^\]]+)\])?\s*\}/g;
let m;
while ((m = re.exec(sfxBlock))) {
  const name = m[1];
  const n = m[2] ? m[2].split(',').map(Number) : null;
  let t = null;
  if (m[3]) {
    const parts = m[3].split(',').map(s => s.trim());
    t = [parseFloat(parts[0]), parseFloat(parts[1]), parts[2].replace(/'/g, '')];
    t.push(parseFloat(parts[3]));
    if (parts[4] !== undefined) t.push(parseFloat(parts[4]));
  }
  SFX[name] = { n, t };
}

/* audio.js 里其它固定音效（手工抄参数，改那边这里要跟着改） */
const FIXED = {
  pickup: () => [simTone(880, 0.06, 'triangle', 0.028, 1320)],
  ui: () => [simTone(520, 0.04, 'triangle', 0.02, 700)],
  hit: () => [simTone(180, 0.04, 'square', 0.017, 120)],
  hurt: () => [simTone(140, 0.12, 'sawtooth', 0.05, 60), simNoise(0.09, 0.05, 600)],
  boom: () => [simNoise(0.28, 0.11, 900), simTone(90, 0.22, 'triangle', 0.05, 40)],
  shotgun: () => [simNoise(0.14, 0.098, 1800), simTone(200, 0.09, 'sawtooth', 0.042, 80)],
  flame: () => [simNoise(0.16, 0.088, 700)],
  qi: () => [simBurst(0.14, 0.045, 4400, 1500), simTone(1500, 0.16, 'sine', 0.018, 3000)],
  zap: () => [simTone(1200, 0.07, 'sawtooth', 0.030, 320)],
  'impact:gun': () => [simBurst(0.04, 0.060, 1500, 520), simTone(230, 0.04, 'triangle', 0.024, 120)],
  'impact:melee': () => [simBurst(0.045, 0.042, 1800, 620), simTone(165, 0.05, 'square', 0.016, 90)],
  'impact:energy': () => [simBurst(0.04, 0.046, 4600, 2000), simTone(880, 0.04, 'sawtooth', 0.020, 320)],
  'impact:crit': () => [simBurst(0.04, 0.060, 1500, 520), simTone(230, 0.04, 'triangle', 0.024, 120),
    simTone(2100, 0.05, 'square', 0.016, 3100)]
};

function measureLayers(layersFn) {
  /* 多次取平均，噪声层的随机性不会让单条忽高忽低 */
  let rms = 0, peak = 0;
  const R = 6;
  for (let k = 0; k < R; k++) {
    const r = mixRMSAndPeak(layersFn(), MASTER);
    rms += r.rms / R;
    peak += r.peak / R;
  }
  return { rms, peak };
}

const rows = [];
for (const k of Object.keys(SFX)) {
  const s = SFX[k];
  rows.push({
    name: k,
    ...measureLayers(() => {
      const out = [];
      if (s.n) out.push(simBurst(s.n[0], s.n[1], s.n[2], s.n[3]));
      if (s.t) out.push(simTone(s.t[0], s.t[1], s.t[2], s.t[3], s.t[4]));
      return out;
    })
  });
}
for (const k of Object.keys(FIXED)) rows.push({ name: k, ...measureLayers(FIXED[k]) });

const REF = rows.find(r => r.name === 'pickup');
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ master: MASTER, ref: REF, rows }, null, 1));
} else {
  const db = v => (20 * Math.log10(v / REF.rms)).toFixed(1).padStart(6);
  console.log('SFX_VOL = ' + MASTER + '   参考 pickup: rms ' + REF.rms.toFixed(4) + ' / peak ' + REF.peak.toFixed(3) + '\n');
  console.log('名称'.padEnd(16) + 'RMS'.padStart(9) + '峰值'.padStart(9) + '  vs pickup' + '  削波');
  for (const r of rows) {
    console.log(
      r.name.padEnd(16) +
      r.rms.toFixed(4).padStart(9) +
      r.peak.toFixed(3).padStart(9) +
      (r.name === 'pickup' ? '     REF' : db(r.rms) + ' dB').padStart(12) +
      (r.peak > 0.98 ? '   ⚠' : '')
    );
  }
}
