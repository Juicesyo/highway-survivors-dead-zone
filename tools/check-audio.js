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
  /* 记下最后一次被写进去的值：持续光束的基频 / 增益都靠它断言 */
  return {
    value: v,
    setValueAtTime(x) { this.value = x; return this; },
    exponentialRampToValueAtTime(x) { this.value = x; return this; },
    linearRampToValueAtTime(x) { this.value = x; return this; },
    cancelScheduledValues() { return this; }
  };
}

function mkCtx(withShaper) {
  const dest = { name: 'dest' };
  const made = [];
  const osc = [], srcs = [];
  const ctx = {
    currentTime: 0, sampleRate: 44100, state: 'running', destination: dest,
    createGain() {
      const g = { kind: 'gain', gain: mkParam(1), to: [], connect(t) { this.to.push(t); return t; }, disconnect() {} };
      made.push(g); return g;
    },
    createOscillator() {
      const o = {
        type: '', frequency: mkParam(440), started: false, stopped: false,
        connect(t) { return t; }, start() { this.started = true; }, stop() { this.stopped = true; }
      };
      osc.push(o); return o;
    },
    createBiquadFilter() {
      return { type: '', frequency: mkParam(1000), Q: mkParam(1), connect(t) { return t; } };
    },
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d }; },
    createBufferSource() {
      const s = {
        buffer: null, loop: false, started: false, stopped: false,
        connect(t) { return t; }, start() { this.started = true; }, stop() { this.stopped = true; }
      };
      srcs.push(s); return s;
    }
  };
  if (withShaper) {
    ctx.createWaveShaper = () => {
      const s = { kind: 'shaper', curve: null, oversample: 'none', to: [], connect(t) { this.to.push(t); return t; } };
      made.push(s); return s;
    };
  }
  ctx._made = made;
  ctx._osc = osc;
  ctx._src = srcs;
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

/* 6. 每个命名音效都真能发出声：拼错函数名 / 参数写反，只有到真机上才会暴露，
      所以在这里按真实链路逐条放一遍（每条前重置发声预算，否则后半段会被预算挡掉） */
{
  const ctx = mkCtx(true);
  A.ctx = ctx; A._gain = null; A._curve = null; A.enabled = true;
  const names = ['zap', 'boom', 'pop', 'scream', 'spit', 'tinnitus', 'hurt', 'hit', 'pickup', 'ui',
    'splash', 'steam', 'qi', 'chain', 'execute', 'shotgun', 'flame', 'frost'];
  const dead = [];
  for (const n of names) {
    A._budget = 0; A._budgetT = 0;
    const before = ctx._made.length;
    try {
      if (n === 'splash') A.splash(true);
      else if (n === 'flame') A.flame(true);
      else if (n === 'frost') A.frost(true);
      else A[n]();
      if (ctx._made.length === before) dead.push(n + '(没建节点)');
    } catch (e) { dead.push(n + '(' + e.message + ')'); }
  }
  ck('18 个命名音效都能发声且不抛异常', dead.length === 0, dead.join(', ') || '全部有声');
}

/* 7. 持续光束（红莲 / 熔核）：常驻声部只建一次，停光必须把节点停掉。
      漏停一次就是一条永远停不下来的嗡鸣 —— 比"没声音"难查得多。 */
{
  const ctx = mkCtx(true);
  A.ctx = ctx; A._gain = null; A._curve = null; A.enabled = true;
  A._budget = 0; A._budgetT = 0;
  A.beamOff();

  A.beam(false);
  const v = A._beam;
  const firstFreq = ctx._osc.length ? ctx._osc[0].frequency.value : -1;
  ck('持续光束建立了常驻声部', !!v && !!v.g);
  ck('声部含 3 个振荡器 + 1 个噪声源', !!v && v.stopNodes.length === 4,
    v ? v.stopNodes.length + ' 个' : '-');
  ck('起手就发声（振荡器都 start 了）', ctx._osc.every(o => o.started) && ctx._src.every(s => s.started));
  ck('红莲基频 168Hz', Math.abs(firstFreq - 168) < 0.01, firstFreq + 'Hz');

  const oscN = ctx._osc.length;
  const madeN = ctx._made.length;
  A.beam(false);
  ck('续期复用同一个声部（不新建节点）',
    A._beam === v && ctx._osc.length === oscN && ctx._made.length === madeN,
    (ctx._osc.length - oscN) + ' 个新振荡器');

  A.beamOff();
  ck('停光释放声部', A._beam === null);
  ck('停光停掉所有发声节点', ctx._osc.every(o => o.stopped) && ctx._src.every(s => s.stopped));

  A.beam(true);
  const meltFreq = ctx._osc[ctx._osc.length - 3].frequency.value;
  ck('熔核另起声部', A._beam !== null && A._beam !== v);
  ck('熔核基频更低（84Hz）', Math.abs(meltFreq - 84) < 0.01, meltFreq + 'Hz');
  const meltOsc = ctx._osc.slice();
  A.beamOff();
  ck('熔核停光也停节点', meltOsc.every(o => o.stopped));

  A.enabled = false;
  A.beam(false);
  ck('关掉音效时不会起嗡鸣', A._beam === null);
  A.enabled = true;
}

console.log(bad ? '\n' + bad + ' 项失败' : '\n全部通过');
process.exit(bad ? 1 : 0);
