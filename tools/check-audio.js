/**
 * 音效输出链自检：总增益 → 软限幅 → destination，以及平台不支持 WaveShaper 时的回退。
 * 用法：node tools/check-audio.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.GameGlobal = global;
global.HS = {};
require(path.join(ROOT, 'src/core/util.js'));
require(path.join(ROOT, 'src/core/audio.js'));
const A = global.HS.Audio;

let bad = 0;
const ck = (n, c, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' ' + n + (x ? '  (' + x + ')' : '')); if (!c) bad++; };

function mkParam(v) {
  return {
    value: v,
    setValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; }
  };
}

function mkCtx(withShaper) {
  const dest = { name: 'dest' };
  const made = [];
  const ctx = {
    currentTime: 0, sampleRate: 44100, state: 'running', destination: dest,
    createGain() {
      const g = { kind: 'gain', gain: mkParam(1), to: [], connect(t) { this.to.push(t); return t; } };
      made.push(g); return g;
    },
    createOscillator() {
      return { type: '', frequency: mkParam(440), connect(t) { return t; }, start() {}, stop() {} };
    },
    createBiquadFilter() {
      return { type: '', frequency: mkParam(1000), Q: mkParam(1), connect(t) { return t; } };
    },
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d }; },
    createBufferSource() { return { buffer: null, loop: false, connect(t) { return t; }, start() {}, stop() {} }; }
  };
  if (withShaper) {
    ctx.createWaveShaper = () => {
      const s = { kind: 'shaper', curve: null, oversample: 'none', to: [], connect(t) { this.to.push(t); return t; } };
      made.push(s); return s;
    };
  }
  ctx._made = made;
  return ctx;
}

/* 1. 支持 WaveShaper：gain → shaper → destination */
{
  const ctx = mkCtx(true);
  A.ctx = ctx; A._gain = null; A._curve = null; A.enabled = true;
  A._budget = 0; A._budgetT = 0;
  A.weapon('pistol');
  const g = A._gain;
  const shaper = ctx._made.find(n => n.kind === 'shaper');
  ck('建立了总增益节点', !!g && g.kind === 'gain');
  ck('总增益值 = SFX_VOL', g && g.gain.value === A.SFX_VOL, g ? String(g.gain.value) : '-');
  ck('链路经过软限幅', !!shaper && g.to.indexOf(shaper) >= 0);
  ck('软限幅接 destination', shaper && shaper.to.indexOf(ctx.destination) >= 0);
  ck('曲线长度 2048', shaper && shaper.curve && shaper.curve.length === 2048, shaper && shaper.curve ? String(shaper.curve.length) : '无');
  ck('oversample 设为 2x', shaper && shaper.oversample === '2x', shaper && shaper.oversample);
}

/* 2. 曲线：小信号严格线性，大信号被压住但不削平 */
{
  const cur = A._softCurve();
  const mid = (cur.length - 1) / 2;
  const at = x => cur[Math.round(mid + x * mid)];
  const lin = [0.1, 0.3, 0.6].every(x => Math.abs(at(x) - x) < 0.006);
  ck('|x| ≤ 0.6 段完全线性（不改变音量）', lin, '0.3 → ' + at(0.3).toFixed(3) + ', 0.6 → ' + at(0.6).toFixed(3));
  ck('输入 1.0 被压到 0.9~0.96', at(1) > 0.88 && at(1) < 0.97, '1.0 → ' + at(1).toFixed(3));
  ck('曲线连续（0.599 vs 0.601 无跳变）', Math.abs(at(0.601) - at(0.599)) < 0.01);
  ck('奇对称', Math.abs(at(-0.4) + at(0.4)) < 1e-6);
}

/* 3. 不支持 WaveShaper：直接接 destination，不能断链 */
{
  const ctx = mkCtx(false);
  A.ctx = ctx; A._gain = null; A.enabled = true;
  A.weapon('smg');
  const g = A._gain;
  ck('无 WaveShaper 时仍建立总增益', !!g);
  ck('此时直连 destination', g && g.to.indexOf(ctx.destination) >= 0);
}

/* 4. 发声预算：连续开火不该全部被丢掉 */
{
  A._budget = 0; A._budgetT = 0;
  let ok = 0;
  for (let i = 0; i < 40; i++) if (A._ok()) ok++;
  ck('100ms 内至少放行 20 层（约 10 发）', ok >= 20, ok + ' 层');
  A._budgetT = 0;   // 重置窗口
}

/* 5. 关掉音效后不再建节点 */
{
  A.enabled = false;
  A._budget = 0; A._budgetT = 0;
  const before = A._budget;
  A.weapon('pistol');
  ck('音效关闭时静默', A._budget === before, 'budget ' + before + ' → ' + A._budget);
  A.enabled = true;
}

console.log(bad ? '\n' + bad + ' 项失败' : '\n全部通过');
process.exit(bad ? 1 : 0);
