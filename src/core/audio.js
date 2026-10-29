/**
 * 程序化音效（WebAudio 合成，不依赖音频文件）
 * 环境不支持时静默降级。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;

  /* ================= 武器音色表 =================
   * 全程序化合成：噪声层定质感（枪口爆裂 / 弓弦振动 / 刀刃破风），
   * 音调层定音高（口径越大越低）。不引入任何音频文件。
   * art → 音色名 只是一张映射，加武器时忘了配也能回落到通用枪声。
   * 参数：n = [时长, 音量, 起始频率, 截止频率]（带通扫频噪声）
   *       t = [频率, 时长, 波形, 音量, 滑到]
   */
  var SFX = {
    /* 枪械 */
    gun_light: { n: [0.055, 0.067, 3400, 900], t: [520, 0.055, 'square', 0.021, 190] },
    gun_heavy: { n: [0.085, 0.074, 2000, 420], t: [210, 0.085, 'square', 0.021, 90] },
    gun_fast: { n: [0.035, 0.066, 2900, 850], t: [680, 0.03, 'square', 0.024, 280] },
    gun_auto: { n: [0.05, 0.071, 2600, 700], t: [420, 0.05, 'square', 0.021, 150] },
    gun_spin: { n: [0.055, 0.101, 2200, 600], t: [300, 0.05, 'sawtooth', 0.032, 120] },
    gun_boom: { n: [0.130, 0.116, 1500, 190], t: [140, 0.11, 'sawtooth', 0.033, 55] },
    gun_sniper: { n: [0.110, 0.072, 4200, 500], t: [880, 0.13, 'square', 0.02, 110] },
    gun_rail: { n: [0.120, 0.089, 3800, 400], t: [1500, 0.14, 'sawtooth', 0.025, 90] },
    /* 弓弩：弦振是高频短滑音 */
    bow: { n: [0.05, 0.066, 1900, 900], t: [760, 0.07, 'triangle', 0.037, 1500] },
    crossbow: { n: [0.05, 0.053, 2200, 800], t: [820, 0.05, 'square', 0.023, 380] },
    /* 投掷 / 爆炸 */
    launcher: { n: [0.170, 0.084, 900, 140], t: [105, 0.17, 'triangle', 0.04, 45] },
    thrown: { n: [0.04, 0.071, 3200, 1600], t: [1100, 0.05, 'sine', 0.024, 1900] },
    /* 能量 */
    energy: { n: [0.05, 0.061, 4000, 1200], t: [1250, 0.07, 'sawtooth', 0.036, 340] },
    /* 熔核过载（红莲进化）：不是"一束脉冲"，是**一直在烧**。
       噪声拖长到 0.10 秒、中心频率压到 2600→820（闷），
       主音调从 1650 慢慢滑到 560（比 energy 滑得慢，所以听着"黏"），
       再垫一层几乎不动的低频方波 —— 那层就是"持续"的来源。
       播放间隔也从 0.16 缩到 0.11（见 Gear.fire 的 beam 分支），
       前后两发叠在一起听，才像一束没断过的火。 */
    melt: {
      n: [0.10, 0.050, 2600, 820],
      t: [1650, 0.17, 'sawtooth', 0.026, 560],
      t2: [88, 0.16, 'square', 0.018, 84]
    },
    /* 光剑挥砍：能量场被甩动的"嗡——"下滑 + 刃口的高频嘶。
       和冷兵器的 blade（一声短促破风）是两种听感，拿在手上就该听得出来 */
    saber: {
      n: [0.16, 0.043, 3600, 1100],
      t: [1560, 0.17, 'sawtooth', 0.024, 470],
      t2: [780, 0.15, 'sine', 0.020, 1560]
    },
    /* 喷火 / 液氮是"持续气流"，不是一次性爆响：三层合成统一写在 A.flame / A.frost，
       这里不再重复一条 —— ART_SFX 仍保留 flamer → 'flame' 的映射，
       weapon() 见到这个名字会直接转过去，避免出现两套听感不同的火焰声。 */
    /* 冷兵器 */
    blade: { n: [0.075, 0.077, 2800, 1300], t: [900, 0.06, 'sine', 0.022, 1600] },
    blunt: { n: [0.08, 0.087, 1500, 300], t: [150, 0.08, 'triangle', 0.035, 60] },
    thrust: { n: [0.06, 0.083, 2600, 900], t: [620, 0.05, 'sawtooth', 0.029, 1400] },
    saw: { n: [0.09, 0.079, 1800, 700] },
  };

  var ART_SFX = {
    /* 枪械 */
    pistol: 'gun_light', revolver: 'gun_heavy',
    smg: 'gun_fast',
    rifle: 'gun_auto', lmg: 'gun_auto',
    minigun: 'gun_spin',
    shotgun: 'gun_boom',
    sniper: 'gun_sniper', railgun: 'gun_rail',
    /* 弓弩 / 投掷 */
    bow: 'bow', crossbow: 'crossbow', harpoon: 'thrust',
    launcher: 'launcher', grenade: 'launcher',
    molotov: 'launcher', mine: 'launcher',
    shuriken: 'thrown', knife: 'thrown',
    /* 能量 */
    laser: 'energy', plasma: 'energy', tesla: 'energy', frost: 'energy', eshield: 'energy',
    /* 熔核过载单独一套音色：外形还是那把激光枪（ART_KIND 认 art），
       但听感必须是"持续在烧"，不能和本体的脉冲声一样 */
    meltlaser: 'melt',
    flamer: 'flame',
    /* 冷兵器：刃 / 钝器 / 刺击 / 锯 */
    saber: 'saber', katana: 'blade', shortsword: 'blade', twinblades: 'blade',
    scythe: 'blade', glaive: 'blade', whip: 'blade', blades: 'blade', greatsword: 'blade',
    hammer: 'blunt', axe: 'blunt', fist: 'blunt', shield: 'blunt',
    shieldaxe: 'blunt', baton: 'blunt', shockwave: 'blunt',
    spear: 'thrust', syringe: 'thrust',
    drill: 'saw', chainsaw: 'saw',
    /* 自动装备（部署 / 环带 / 辅助类本身不开火，配上是给自检留的出口） */
    drone: 'gun_fast', turret: 'gun_auto', beacon: 'energy',
    autoloader: 'gun_auto', firering: 'flame', icerim: 'energy', gas: 'flame', heal: 'thrown'
  };

  var A = {
    /* 暴露给自检脚本：新增武器时 audit 会检查 art 有没有音色 */
    ART_SFX: ART_SFX,
    ctx: null,
    enabled: true,
    /* 音效总增益：合成音的单层峰值只有 0.01~0.11，直接接 destination
       约等于 -30dB，和 BGM 一比就完全听不见。这一级把整条链抬起来，
       想整体调响/调轻只改这一个数（改完跑 node tools/sfx-level.js 看电平）。
       各音色之间的相对音量已经按"吸收经验"那条 pickup 校准过，别再单独调表 */
    SFX_VOL: 4.2,
    _gain: null,
    _budget: 0,
    _budgetT: 0,
    _noiseBuf: null,
    _impactT: 0,
    _curve: null,
    /* 持续光束（红莲 / 熔核）的常驻声部。见 A.beam / A.beamOff */
    _beam: null,
    _beamMelt: false,
    _beamSeen: 0,
    _beamDog: 0,

    /* ================= 背景音乐 =================
     * 和合成音效分开走：小游戏用 InnerAudioContext，浏览器用 <audio>。
     * **只在菜单页放**（标题 / 选图 / 研究所 / 设置），进局内、暂停、结算都停 ——
     * 局内的紧张感交给音效，配乐只做菜单氛围。
     * 音量独立（关掉音效不影响 BGM），默认 0.28。
     * 浏览器 / iOS 不允许无手势自动播放，所以真正出声要等
     * 第一次点击（Game.handleTaps → unlockBgm）。
     */
    bgm: null,
    bgmOn: true,
    bgmVol: 0.20,
    BGM_SRC: 'bgm/bgm.mp3',
    _bgmScene: false,      // 当前场景是否要配乐（菜单）
    _bgmUnlocked: false,   // 是否已经过用户手势
    _bgmPlaying: false,

    init: function () {
      try {
        if (typeof wx !== 'undefined' && wx.createWebAudioContext) {
          A.ctx = wx.createWebAudioContext();
        } else if (typeof window !== 'undefined') {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) A.ctx = new AC();
        }
      } catch (e) { A.ctx = null; }
      A.initBgm();
    },

    /** 建立播放器（只创建，不出声） */
    initBgm: function () {
      if (A.bgm || !A.BGM_SRC) return;
      try {
        if (typeof wx !== 'undefined' && wx.createInnerAudioContext) {
          var ia = wx.createInnerAudioContext();
          ia.src = A.BGM_SRC;
          ia.loop = true;
          ia.volume = A.bgmVol;
          A.bgm = ia;
        } else if (typeof window !== 'undefined' && typeof window.Audio !== 'undefined') {
          var el = new window.Audio(A.BGM_SRC);
          el.loop = true;
          el.volume = A.bgmVol;
          el.preload = 'auto';
          A.bgm = el;
        }
      } catch (e) { A.bgm = null; }

      /* 切后台自动停、回来按当前场景决定要不要续（浏览器标签页切走时不一定被暂停） */
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
          if (document.hidden) A.pauseBgm();
          else A._applyBgm();
        });
      }
    },

    /** 场景切换：menu = 当前是不是菜单页（只有菜单页才放） */
    setBgmScene: function (menu) {
      A._bgmScene = !!menu;
      A._applyBgm();
    },

    /** 首次用户手势后解锁（浏览器 / iOS 的自动播放限制） */
    unlockBgm: function () {
      A._bgmUnlocked = true;
      A._applyBgm();
    },

    /** 三个条件都满足才出声：菜单场景 + 设置没关 + 已有手势 */
    _applyBgm: function () {
      if (!A.bgm) return;
      var want = A._bgmScene && A.bgmOn && A._bgmUnlocked;
      if (want) A.playBgm();
      else A.pauseBgm();
    },

    playBgm: function () {
      if (!A.bgm || A._bgmPlaying) return;
      try {
        var r = A.bgm.play();
        if (r && typeof r.catch === 'function') r.catch(function () {});
        A._bgmPlaying = true;
      } catch (e) {}
    },

    pauseBgm: function () {
      if (!A._bgmPlaying) return;       // 已经在停着，不用反复调 pause
      A._bgmPlaying = false;
      if (!A.bgm) return;
      try { A.bgm.pause(); } catch (e) {}
    },

    /** 设置里的开关：关掉只暂停，打开能续上原来的进度 */
    setBgm: function (on) {
      A.bgmOn = !!on;
      A._applyBgm();
    },

    resume: function () {
      try { if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume(); } catch (e) {}
      A._applyBgm();
    },

    /**
     * 音效总输出节点（惰性创建）：总增益 → 软限幅 → destination。
     * 满屏交火时十几发枪声叠在一起，峰值能到 2~3 倍，直连 destination
     * 会被硬削成"炸麦"；软限幅只把超过 0.6 的部分压弯，单发音效不受影响。
     * 任何一步失败都退回"直连 destination"，绝不留下一条断掉的链路。
     */
    _out: function (c) {
      if (A._gain) return A._gain;
      var dest = c.destination, g = null;
      try {
        g = c.createGain();
        g.gain.value = A.SFX_VOL;
      } catch (e) { return dest; }

      try {
        var sh = c.createWaveShaper ? c.createWaveShaper() : null;
        if (sh && c.createWaveShaper) {
          sh.curve = A._softCurve();
          if (sh.oversample !== undefined) sh.oversample = '2x';
          sh.connect(dest);          // 先接出口，接不上就不要这条曲线
          g.connect(sh);
          A._gain = g;
          return g;
        }
      } catch (e2) { /* 平台不支持 WaveShaper，直连 */ }

      try { g.connect(dest); } catch (e3) { return dest; }
      A._gain = g;
      return g;
    },

    /**
     * 软限幅曲线：|x| ≤ KNEE 时完全线性（不动音色、不改音量），
     * 超过之后按 tanh 平滑压到 0.95，斜率在拐点处连续。
     * —— 用 tanh(kx)/k 那种写法则线性区是 k 倍增益，会把整体抬 6dB，别用。
     */
    _softCurve: function () {
      if (A._curve) return A._curve;
      var KNEE = 0.6;                       // 拐点：普通单发音效都在这以下
      var n = 2048, cur = new Float32Array(n), span = 1 - KNEE, i, x, a, y;
      for (i = 0; i < n; i++) {
        x = (i / (n - 1)) * 2 - 1;
        a = x < 0 ? -x : x;
        y = a <= KNEE ? a : KNEE + span * Math.tanh((a - KNEE) / span);
        cur[i] = x < 0 ? -y : y;
      }
      A._curve = cur;
      return cur;
    },

    _ok: function () {
      if (!A.ctx || !A.enabled) return false;
      var now = Date.now();
      if (now - A._budgetT > 100) { A._budgetT = now; A._budget = 0; }
      /* 每 100ms 的发声层数上限：一发子弹是两层（噪声 + 音调），
         满配自动装备同时开火会挤满配额，被丢掉的那几发就是"没声音" */
      if (A._budget > 20) return false;
      A._budget++;
      return true;
    },

    tone: function (freq, dur, type, vol, slideTo) {
      if (!A._ok()) return;
      try {
        var c = A.ctx, t = c.currentTime;
        var o = c.createOscillator();
        var g = c.createGain();
        o.type = type || 'square';
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(A._out(c));
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) {}
    },

    noise: function (dur, vol, cutoff) {
      if (!A._ok()) return;
      try {
        var c = A.ctx, t = c.currentTime;
        var n = Math.floor(c.sampleRate * dur);
        var buf = c.createBuffer(1, n, c.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < n; i++) {
          d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        }
        var src = c.createBufferSource();
        src.buffer = buf;
        var f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(cutoff || 1200, t);
        f.frequency.exponentialRampToValueAtTime(120, t + dur);
        var g = c.createGain();
        g.gain.setValueAtTime(vol || 0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(A._out(c));
        src.start(t);
      } catch (e) {}
    },

    /**
     * 短噪声爆点：带通 f0 → f1 扫频 + 指数衰减。
     * 枪声的"脆"全在这个包络上 —— 比 noise() 的低通拖尾更适合射击。
     */
    burst: function (dur, vol, f0, f1) {
      if (!A._ok()) return;
      var buf = A._getNoiseBuf();
      if (!buf) return;
      try {
        var c = A.ctx, t = c.currentTime;
        var src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        var f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(f0, t);
        f.frequency.exponentialRampToValueAtTime(Math.max(80, f1), t + dur);
        f.Q.value = 1.1;
        var g = c.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(A._out(c));
        src.start(t);
        src.stop(t + dur + 0.02);
      } catch (e) {}
    },

    /** 半秒白噪声只生成一次，之后每次射击复用，避免高射速下反复分配 buffer */
    _getNoiseBuf: function () {
      if (A._noiseBuf) return A._noiseBuf;
      try {
        var c = A.ctx;
        var n = Math.floor(c.sampleRate * 0.5) || 1024;
        var buf = c.createBuffer(1, n, c.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        A._noiseBuf = buf;
      } catch (e) { A._noiseBuf = null; }
      return A._noiseBuf;
    },

    /**
     * 武器开火音：按 art 查表，没配的退回通用枪声。
     * 噪声层 = 质感（爆裂 / 弦振 / 破风），音调层 = 音高（口径越大越低）。
     */
    weapon: function (art) {
      var name = ART_SFX[art] || 'gun_auto';
      /* 喷火 / 液氮：一次"呼"或"嘶"由三层合成（气流 + 共鸣 + 嘶声），
         和枪械那套"噪声爆点 + 音调滑落"完全是两种做法，所以在这里转一手 */
      if (name === 'flame') { A.flame(true); return; }
      if (name === 'frost') { A.frost(true); return; }
      var s = SFX[name];
      if (!s) return;
      if (s.n) A.burst(s.n[0], s.n[1], s.n[2], s.n[3]);
      if (s.t) A.tone(s.t[0], s.t[1], s.t[2], s.t[3], s.t[4]);
      /* 第二层音调：光剑这类"嗡鸣 + 尖叫"的双层音色靠它叠出来 */
      if (s.t2) A.tone(s.t2[0], s.t2[1], s.t2[2], s.t2[3], s.t2[4]);
    },

    /**
     * 击中反馈：按伤害来源换质感 —— 子弹是闷噗、刀是割裂、能量是电火花。
     * 命中频率极高（一秒几十次），内部必须节流：普通命中 80ms 一声、
     * 暴击 45ms 一声（优先级更高音色也更亮）。暴击那一声才加"叮"。
     */
    impact: function (tag, crit) {
      /* 爆炸 / 火焰命中本身就有 boom、flame，再叠一声弹着只会糊 */
      if (tag === 'explosive' || tag === 'fire') return;
      var now = Date.now();
      /* 冰系单独限流：液氮喷枪每 0.16s 就有一跳命中，跟着 80ms 的通用节流走，
         等于每秒十来声"叮"，和气流音叠在一起就是持续的"嘶嘶嘶"。
         开火本身已经表达了"在喷"，命中只需要偶尔点一下。 */
      if (tag === 'ice') {
        if (now - (A._iceT || 0) < 240) return;
        A._iceT = now;
      } else {
        if (now - A._impactT < (crit ? 45 : 80)) return;
        A._impactT = now;
      }

      if (tag === 'melee') {
        A.burst(0.045, 0.042, 1800, 620);
        A.tone(165, 0.05, 'square', 0.016, 90);
      } else if (tag === 'energy' || tag === 'ice') {
        /* 冰系这一声压低一档：它出现得比能量武器频繁得多 */
        A.burst(0.04, tag === 'ice' ? 0.034 : 0.046, 4600, 2000);
        A.tone(880, 0.04, 'sawtooth', tag === 'ice' ? 0.015 : 0.020, 320);
      } else {
        /* 普通弹着：闷一点，别盖过开火声 */
        A.burst(0.04, 0.060, 1500, 520);
        A.tone(230, 0.04, 'triangle', 0.024, 120);
      }
      if (crit) A.tone(2100, 0.05, 'square', 0.016, 3100);
    },

    /* 剑气离体：高频"嘶"+ 短噪声，和普通出刀的破风声区分开 */
    qi: function () {
      A.burst(0.14, 0.045, 4400, 1500);
      A.tone(1500, 0.16, 'sine', 0.018, 3000);
    },

    shoot: function () { A.weapon('pistol'); },
    shotgun: function () { A.noise(0.14, 0.098, 1800); A.tone(200, 0.09, 'sawtooth', 0.042, 80); },
    zap: function () { A.tone(1200, 0.07, 'sawtooth', 0.030, 320); },
    /* 鱼叉拖拽：铁链绷紧的一声脆响 + 摩擦噪声 */
    chain: function () { A.noise(0.09, 0.055, 2600); A.tone(980, 0.07, 'square', 0.022, 420); },
    /* 处决：一声短促的金属切割 + 下滑音，和普通命中音区分开 */
    execute: function () { A.noise(0.10, 0.075, 3200); A.tone(760, 0.11, 'square', 0.034, 150); },
    /* 水声：水鬼下潜/出水。小=闷一声就沉下去，大=带水花的破水声 */
    splash: function (big) {
      if (big) {
        A.noise(0.2, 0.075, 900);
        A.tone(300, 0.18, 'sine', 0.022, 90);
      } else {
        A.noise(0.13, 0.05, 1600);
        A.tone(520, 0.1, 'sine', 0.018, 200);
      }
    },
    boom: function () { A.noise(0.28, 0.11, 900); A.tone(90, 0.22, 'triangle', 0.05, 40); },
    /**
     * 自爆尸的爆开（公路隧道）。和 boom 分开做，因为两者要在同一个画面里同时存在：
     *   boom = 油桶 / 榴弹：干、空、有回响（低通噪声拖尾 + 40Hz 尾音）；
     *   pop  = 一具鼓到透光的肚子炸开：短、湿、闷，没有金属尾音。
     * 小崽（育母挤出来的）再轻一档 —— 三只一起炸时不该盖过玩家的枪声。
     */
    pop: function (soft) {
      if (soft) {
        A.noise(0.14, 0.05, 700);
        A.tone(150, 0.13, 'triangle', 0.022, 62);
      } else {
        A.noise(0.20, 0.085, 760);
        A.tone(132, 0.17, 'triangle', 0.034, 54);
        A.burst(0.10, 0.038, 1300, 380);
      }
    },
    /**
     * 尖啸者的超声。两段共用一只函数：
     *   charge=true  蓄声 0.85s：低频往上爬的一口气（给玩家"要喊了，快挪"的时间），
     *                音量压得很低，它是提示音不是噪音；
     *   charge=false 放声：气声（带通从 3.2k 扫到 900）× 高频尖叫下滑 × 胸腔低鸣。
     * 三层缺一不可 —— 只有高频是"电子音"，只有低频是"咳嗽"，叠起来才是"人声被拉成管风琴"。
     */
    scream: function (charge) {
      if (charge) {
        A.tone(170, 0.80, 'sawtooth', 0.016, 430);
        A.noise(0.40, 0.014, 1100);
      } else {
        A.burst(0.46, 0.062, 3200, 900);
        A.tone(2350, 0.42, 'sawtooth', 0.026, 880);
        A.tone(118, 0.48, 'triangle', 0.028, 58);
      }
    },
    /* 育母产崽：育囊撕开的一声湿响 + 往下一沉，和爆炸音区分开（这是"生"，不是"炸"） */
    spit: function () {
      A.noise(0.26, 0.070, 520);
      A.tone(196, 0.20, 'sine', 0.026, 74);
      A.burst(0.14, 0.034, 820, 300);
    },
    /* 被超声震晕的耳鸣：一条几乎不衰减的高频细线，跟着眩晕时长走。
       它存在的意义是"我知道我现在是废的"，所以音要细、要长、不能盖住逼近的脚步 */
    tinnitus: function () { A.tone(3720, 0.62, 'sine', 0.010, 3280); },
    hit: function () { A.tone(180, 0.04, 'square', 0.017, 120); },
    /* 喷火：**不能只用一层低通噪声** —— 那和"闷一枪"几乎同音，
       玩家拿着一根喷管听到的却是枪声。拆成三层：
       带通扫频的气流（呼）× 低频炉膛共鸣 × 一点顶部嘶声。

       fresh = 这一轮喷射的"起燃"（停火半秒后再喷）：短、亮、带爆点；
       fresh=false = 维持段：更长、更暗、更轻。两段交替着播，
       听感才是"呼————"，而不是把开火节奏照搬成"噗噗噗噗"。 */
    flame: function (fresh) {
      if (fresh === false) {
        A.burst(0.40, 0.029, 780, 240);
        A.tone(86, 0.34, 'sawtooth', 0.011, 50);
        A.noise(0.14, 0.012, 1500);
      } else {
        A.burst(0.26, 0.046, 1150, 300);
        A.tone(104, 0.24, 'sawtooth', 0.018, 60);
        A.noise(0.09, 0.025, 2300);
      }
    },
    /* 液氮：高压冷媒的"嘶"，整体频率比火焰高两个档、没有低频共鸣。
       起燃 = 一声尖的泄压，维持 = 更细更长的一缕白噪 —— 音量都压得低，
       持续音最容易盖住命中音。 */
    frost: function (fresh) {
      if (fresh === false) {
        A.burst(0.40, 0.024, 4600, 2800);
        A.tone(1480, 0.32, 'sine', 0.006, 2600);
        A.noise(0.16, 0.011, 3200);
      } else {
        A.burst(0.24, 0.040, 5600, 2300);
        A.tone(1720, 0.18, 'sine', 0.010, 2900);
        A.noise(0.10, 0.020, 3600);
      }
    },
    /* 霜火反应：一声更亮更长的蒸汽爆，带个下沉的音头 */
    steam: function () { A.noise(0.24, 0.095, 3400); A.tone(420, 0.12, 'triangle', 0.03, 180); },

    /* ================= 持续光束（红莲切割者 / 熔核过载） =================
     * 画面上是一条不断的光，声音就不能是"一发一发"的脉冲：以前每 0.16 秒
     * 放一发 0.07 秒的激光音，6Hz 的断续听起来是"还在扣扳机"，和"持续灼烧"正相反。
     *
     * 这里做一只**常驻**声部：两只差 0.7Hz 的锯齿（拍频是很慢的起伏，不是鼓点）
     * + 一层八度三角 + 一层带通白噪当气流。增益 0.2 秒起、0.26 秒落 ——
     * 起落是"光点亮 / 熄灭"，中间一直是平的。
     *
     * 防卡死：每帧由 Gear 续一次时间戳，**停手 0.32 秒没续期就自己淡出并停节点**。
     * 暂停 / 结算 / 卸枪 / 死亡 / 关音效都不需要各自挂一遍 stop ——
     * 漏挂一处就是一条永远停不下来的嗡鸣，比没声音糟得多。
     * 音量：整体 RMS 压到 pickup 的 -3dB 上下（比任何一发枪声都低，
     * 见 tools/sfx-level.js 的 beam:red / beam:melt），持续音最会盖住开火与命中音。
     */
    beam: function (melt) {
      if (!A.ctx || !A.enabled) { A.beamOff(); return; }
      A._beamSeen = Date.now();
      if (A._beam && A._beamMelt === !!melt) return;
      if (A._beam) A.beamOff();

      var c = A.ctx, t = c.currentTime;
      var v = { g: null, stopNodes: [] };
      try {
        var bus = c.createGain();
        bus.gain.setValueAtTime(0.0001, t);
        bus.gain.exponentialRampToValueAtTime(1, t + 0.20);
        bus.connect(A._out(c));
        v.g = bus;

        /* 胚体：两只锯齿差 0.7Hz。熔核更低一档（"在烧"而不是"在放电"）。
           锯齿的谐波很多，先过一道低通 —— 不然持续音会"刺"，这是最容易被听成噪音的一层 */
        var lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(melt ? 620 : 1100, t);
        lp.Q.value = 0.4;
        lp.connect(bus);
        var base = melt ? 84 : 168;
        var oscs = [
          [base, 'sawtooth', melt ? 0.0037 : 0.0033],
          [base + 0.7, 'sawtooth', melt ? 0.0031 : 0.0027],
          [base * 2.01, 'triangle', melt ? 0.0020 : 0.0018]
        ];
        for (var i = 0; i < oscs.length; i++) {
          var o = c.createOscillator();
          o.type = oscs[i][1];
          o.frequency.setValueAtTime(oscs[i][0], t);
          var og = c.createGain();
          og.gain.value = oscs[i][2];
          o.connect(og); og.connect(lp);
          o.start(t);
          v.stopNodes.push(o);
        }

        /* 气流：白噪过带通。固定频率、不扫频 —— 扫频在持续音上会被听成"一浪一浪"，
           刚好又变成脉冲感；这层只负责把"电"和"烧"的质感垫出来 */
        var nb = A._getNoiseBuf();
        if (nb) {
          var src = c.createBufferSource();
          src.buffer = nb;
          src.loop = true;
          var bp = c.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(melt ? 1480 : 2600, t);
          bp.Q.value = 0.8;
          var ng = c.createGain();
          ng.gain.value = melt ? 0.0027 : 0.0023;
          src.connect(bp); bp.connect(ng); ng.connect(bus);
          src.start(t);
          v.stopNodes.push(src);
        }
      } catch (e) {
        /* 建到一半失败：已经开声的节点必须停掉，否则就是一条永远停不下来的嗡鸣 */
        for (var k = 0; k < v.stopNodes.length; k++) {
          try { v.stopNodes[k].stop(t + 0.05); } catch (e2) {}
        }
        A._beam = null;
        A._beamMelt = false;
        return;
      }
      A._beam = v;
      A._beamMelt = !!melt;
      A._watchBeam();
    },

    /** 看门狗：只在有常驻声部时活，声部一停就自己拆掉（不常驻 interval） */
    _watchBeam: function () {
      if (A._beamDog) return;
      A._beamDog = setInterval(function () {
        if (!A._beam) { clearInterval(A._beamDog); A._beamDog = 0; return; }
        if (Date.now() - A._beamSeen > 320) A.beamOff();
      }, 120);
    },

    /** 停光：先淡出再停节点；重复调用安全。淡出失败也必须停节点 */
    beamOff: function () {
      var v = A._beam;
      if (!v) return;
      A._beam = null;
      A._beamMelt = false;
      var c = A.ctx;
      var t = (c && c.currentTime) || 0;
      try {
        var g = v.g;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      } catch (e) {}
      for (var i = 0; i < v.stopNodes.length; i++) {
        try { v.stopNodes[i].stop(t + 0.32); } catch (e2) {}
      }
      /* 淡完再拆总线：立刻 disconnect 会把尾音一起掐掉 */
      if (v.g) setTimeout(function () { try { v.g.disconnect(); } catch (e3) {} }, 420);
    },

    pickup: function () { A.tone(880, 0.06, 'triangle', 0.028, 1320); },
    hurt: function () { A.tone(140, 0.12, 'sawtooth', 0.05, 60); A.noise(0.09, 0.05, 600); },
    levelup: function () {
      A.tone(523, 0.09, 'square', 0.035);
      setTimeout(function () { A.tone(659, 0.09, 'square', 0.035); }, 90);
      setTimeout(function () { A.tone(784, 0.14, 'square', 0.04); }, 180);
    },
    die: function () {
      A.tone(300, 0.5, 'sawtooth', 0.06, 50);
      A.noise(0.5, 0.08, 500);
    },
    doom: function () {
      A.tone(70, 1.1, 'triangle', 0.09, 38);
      A.noise(0.9, 0.08, 400);
    },
    win: function () {
      A.tone(523, 0.12, 'square', 0.04);
      setTimeout(function () { A.tone(659, 0.12, 'square', 0.04); }, 120);
      setTimeout(function () { A.tone(784, 0.12, 'square', 0.04); }, 240);
      setTimeout(function () { A.tone(1046, 0.3, 'square', 0.045); }, 360);
    },
    ui: function () { A.tone(520, 0.04, 'triangle', 0.02, 700); }
  };

  HS.Audio = A;
})();
