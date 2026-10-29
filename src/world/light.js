/**
 * 公路隧道的照明场
 *
 * 隧道里没有天光。可见度由两样东西叠出来：
 *
 *   ① **顶灯**（主）—— 每 192px 一盏，照到的地方半径 168，比玩家自己那圈（105）**大得多**，
 *      灯下的路面、车堆、尸群都是真的看得清，不是一层朦胧的雾。
 *   ② **玩家自己那点光**（辅）—— 半径 = **经验吸取范围**（`p.magnet`，基础 44），
 *      圈内全亮，圈外按 smoothstep 衰减到 `2.4 倍`处全黑。
 *      它保证"坏灯那一段"玩家也不至于连自己的脚都看不见（卡在车堆里摸黑是最劝退的），
 *      堆拾取范围 = 看得更远。
 *
 * 两者取**较亮**的那个（max）：所以灯下比身边亮，坏灯段只剩身边那一圈，两者都够不着的地方才真黑。
 *
 * 这份文件把"某个点看不看得见"抽成纯函数，供两处共用：
 *   - render.js 逐圈算压暗强度
 *   - combat.js 决定"看不看得见" → 看不见的敌人不进索敌
 * 同一个函数供两处，才不会出现"画面上漆黑一片，武器却隔空点人"。
 *
 * 约定：灯位由 y 决定（走廊沿 y 无限延伸），所以只吃 y 和 run.t。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;

  var STEP = 288;        // 灯距（1.5 个区块一盏：灯下亮一大片，灯与灯之间才收得下去）
  var OFF = 40;          // 灯相对区块起点的偏移（和 render 的灯位一致）
  var LAMP_X = 62;       // 灯离中线的横向距离（贴在车道边）
  var RADIUS = 190;      // 单盏灯的照明半径（二维距离，比玩家光圈 106 大）
  var FIRE_R = 215;      // 事故车堆那把火的照明半径（比路灯还远一点，它是最亮的东西）
  var NEAR_MIN = 40;     // 玩家光圈的最小半径（magnet 被压得再低也留这么多）
  var FADE = 2.4;        // 从"全亮"到"全黑"要走多少倍核心半径

  /* 事故点附近的灯强制半亮（结果按灯位缓存，事故点只跟坐标有关） */
  var accCache = {};
  function nearAccidentY(y) {
    var c = accCache[y];
    if (c !== undefined) return c;
    var W = HS.World, res = false;
    if (W && W.accidentY) {
      var GAP = W.ACC_GAP || 1152;
      var k0 = Math.round(y / GAP);
      for (var k = k0 - 1; k <= k0 + 1; k++) {
        if (Math.abs(W.accidentY(k) - y) < 250) { res = true; break; }
      }
    }
    accCache[y] = res;
    return res;
  }

  /** 第 lid 盏灯的亮度（0=坏，1=亮），会闪，但只跟时间和灯位有关 */
  function lampFl(lid, t) {
    var rv = U.hash(0, lid, 933);
    /* 事故点的灯必须有应急照明（见 nearAccidentY）—— 注意传的是灯的**世界坐标 y**，
       不是灯序号（踩过一次：传 lid 之后整条隧道都算不出事故点，灯全黑）。 */
    var wy = lid * STEP + OFF;
    if (rv < 0.38) {
      /* 坏透的灯：不闪，就是黑的（会闪的是下面那档"接触不良"） */
      if (nearAccidentY(wy)) return 0.52 + 0.07 * Math.sin(t * 2.7 + lid * 1.9);
      return 0;
    }
    if (rv < 0.50) {
      /* 接触不良：以前是把两段高频 sin 硬切成 0.04 / 0.22 / 1.0 三档 ——
         每秒跳两三次、幅度接近满亮，整片光池跟着忽明忽暗，非常刺眼（像报警灯）。
         现在改成：一段平滑的低频抖动（0.38~0.56），偶尔"掉一次电"，
         掉电本身也用 smoothstep 过渡，全程没有任何硬跳。 */
      var jitter = Math.sin(t * 2.3 + lid * 1.7) * 0.5 + Math.sin(t * 5.1 + lid * 0.9) * 0.28;
      var fl2 = 0.47 + jitter * 0.09;
      var dip = Math.sin(t * 1.13 + lid * 3.1);          // 每 ~5.6 秒一次
      if (dip > 0.97) {
        var dk = (dip - 0.97) / 0.03;
        dk = dk * dk * (3 - 2 * dk);                     // 0→1 平滑，别硬切
        fl2 *= 1 - 0.62 * dk;
      }
      return fl2;
    }
    if (rv < 0.60) {
      /* 快坏了：很慢的呼吸，幅度只放到 0.4~0.56，不要在高亮区来回拉 */
      return 0.48 + 0.08 * Math.sin(t * 1.7 + lid * 1.4);
    }
    /* 正常的灯：几乎不动，只有一点点呼吸（0.85~0.99） */
    var fl = 0.92 + 0.07 * Math.sin(t * 0.6 + lid);
    /* 事故点一带的灯常年是坏的（就是它们坏了才撞的车），但玩家要在车堆里贴身打架，
       全黑着打不合理 —— 那里留一盏接触不良的应急灯，半亮、慢慢呼吸。 */
    if (fl < 0.55 && nearAccidentY(wy)) fl = 0.52 + 0.07 * Math.sin(t * 3.1 + lid * 2.3);
    return fl;
  }

  /**
   * 第 lid 盏灯的世界坐标。
   * 左右**严格交替**（0 左、1 右、2 左……）：隧道里的顶灯本来就是一左一右排的，
   * 用哈希随机的话会连着三盏都在同一侧，走廊一头亮一头黑，看着像画错了。
   */
  function lampPos(lid) {
    var par = Math.abs(lid) % 2;
    return { x: (par === 0 ? -1 : 1) * LAMP_X, y: lid * STEP + OFF };
  }

  /**
   * 一盏灯的光形：t = 距离 / 照明半径（0~1）。
   * 前 34% 几乎全亮（灯正下方要能看清路况），之后快速收尾到 0 ——
   * 这一段是渲染和索敌共用的，改这里两边一起变。
   */
  function lampShape(t) {
    if (t <= 0) return 1;
    if (t >= 1) return 0;
    /* 前 55% 几乎全亮：灯正下方那一大片路面、车堆、尸群都要看得清，
       这是"路灯照亮路况"的底线；剩下 45% 快速收尾，灯与灯之间才有暗段。 */
    if (t < 0.55) return 1 - 0.06 * (t / 0.55);
    var k = (t - 0.55) / 0.45;
    return 0.94 * (1 - k) * (1 - k);
  }

  /**
   * 环境光强 0~1：附近几盏灯里最亮的那一盏的贡献。
   * 用**二维距离**（以前只看 y，等于假设灯把整条走廊横向铺满 —— 于是灯看起来
   * 不像一盏灯，倒像一条发光的地毯）。现在灯是光锥：站在它下面最亮，走到对面墙下会暗一档。
   */
  function level(x, y, t) {
    var lid = Math.round((y - OFF) / STEP);
    var best = 0;
    for (var k = lid - 1; k <= lid + 1; k++) {
      var fl = lampFl(k, t);
      if (fl <= 0.02) continue;
      var pos = lampPos(k);
      var dx = x - pos.x, dy = y - pos.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > RADIUS) continue;
      var f = fl * lampShape(d / RADIUS);
      if (f > best) best = f;
    }
    var fv = fireLevel(x, y, t);
    if (fv > best) best = fv;
    return best > 1 ? 1 : best;
  }

  /* 事故车堆的火源：位置固定（按 k 缓存），亮度每秒抖十几次 */
  var fireCache = {};
  function fireAt(k) {
    if (fireCache[k] !== undefined) return fireCache[k];
    var W = HS.World, f = null;
    if (W && W.accidentFire) f = W.accidentFire(k);
    fireCache[k] = f;
    return f;
  }

  /** 火光的光形：q = 距离 / 火光半径（0~1） */
  function fireShape(q) {
    if (q <= 0) return 1;
    if (q >= 1) return 0;
    return q < 0.4 ? 1 - 0.08 * (q / 0.4) : 0.92 * Math.pow(1 - (q - 0.4) / 0.6, 1.5);
  }

  /** 火焰跳动：两层不同频率叠加，t 是游戏时间、k 是事故点序号（让每堆火抖得不一样） */
  function fireFlick(t, k) {
    /* 火该跳，但幅度别大：±0.10 已经够"噼啪"，再大整片地面会跟着晃 */
    return 0.87 + 0.06 * Math.sin(t * 9 + k * 3.7) + 0.04 * Math.sin(t * 23 + k * 1.3);
  }

  /**
   * 火光照强 0~1。燃烧的车堆是隧道里最亮的点：
   * 半径 215、前 40% 几乎全亮，外面收得比灯快（火是点光源，不是灯罩）。
   * 亮度带两层不同频率的抖动 —— 火焰跳动才有"噼啪"的感觉。
   */
  function fireLevel(x, y, t) {
    var GAP = (HS.World && HS.World.ACC_GAP) || 1152;
    var k0 = Math.round(y / GAP);
    var best = 0;
    for (var k = k0 - 1; k <= k0 + 1; k++) {
      var f = fireAt(k);
      if (!f) continue;
      var dx = x - f.x, dy = y - f.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > FIRE_R) continue;
      var v = fireShape(d / FIRE_R) * fireFlick(t, k);
      if (v > best) best = v;
    }
    return best > 1 ? 1 : best;
  }

  /** 玩家的光圈核心半径 = 经验吸取范围（看得最清楚的那一圈） */
  function nearR(p) {
    var m = p && p.magnet ? p.magnet : NEAR_MIN;
    return m > NEAR_MIN ? m : NEAR_MIN;
  }

  /** 光圈边缘：到这里为止完全黑 */
  function farR(p) {
    return nearR(p) * FADE;
  }

  /**
   * 只按"离玩家多远"算的光强，0（全黑）~1（全亮）。
   * 核心圈内恒 1，之后 smoothstep 衰减到 FADE 倍处归零。
   */
  function radial(x, y, p) {
    if (!p) return 0;
    var dx = x - p.x, dy = y - p.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var nr = nearR(p);
    if (d <= nr) return 1;
    var k = (d - nr) / (farR(p) - nr);
    if (k >= 1) return 0;
    return 1 - k * k * (3 - 2 * k);      // 1 - smoothstep：越往外越黑
  }

  /**
   * 综合可见度：玩家光圈 与 灯池 取较亮的那个。
   * 以前是相加，灯稍微有点亮就把整条走廊抬起来（灯距 192、半径 140 → 处处 ≥0.3，
   * 等于没有黑暗）；改成 max 之后，灯下真的亮、灯与灯之间会掉下去、坏灯段只剩身边那圈。
   * 渲染和索敌都读它 —— 画面黑成什么样，武器就打不到多远。
   */
  function vis(x, y, run) {
    if (!run) return 1;
    var v = radial(x, y, run.p);
    var lv = level(x, y, run.t || 0);
    if (lv > v) v = lv;
    return v > 1 ? 1 : v;
  }

  /**
   * 站在玩家视角，这个点算不算"看得见"。
   * 贴身（核心圈内）无条件算，其余走 vis 阈值。
   */
  function seen(x, y, run) {
    if (!run || !run.map || !run.map.tunnel) return true;   // 只有隧道有这套照明
    var p = run.p;
    if (p) {
      var dx = x - p.x, dy = y - p.y;
      var nr = nearR(p);
      if (dx * dx + dy * dy < nr * nr) return true;
    }
    return vis(x, y, run) > 0.16;
  }

  HS.Light = {
    STEP: STEP, OFF: OFF, LAMP_X: LAMP_X, RADIUS: RADIUS, FADE: FADE,
    lampFl: lampFl, lampPos: lampPos, lampShape: lampShape, level: level,
    FIRE_R: FIRE_R, fireAt: fireAt, fireLevel: fireLevel,
    fireShape: fireShape, fireFlick: fireFlick,
    nearR: nearR, farR: farR, radial: radial, vis: vis, seen: seen
  };
})();
