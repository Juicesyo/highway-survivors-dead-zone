/**
 * 战斗与实体系统
 * 武器开火 / 弹道 / 敌人 AI / 伤害结算 / 掉落 / 特效
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;
  var P = HS.P;
  var D = HS.Data;
  var Game = HS.Game;

  /* 车身距离查询的暂存（避免每帧 new） */
  var _bodyOut = { x: 0, y: 0, d: 0 };

  /** 让飞行物朝目标缓慢转向（追踪 / 回旋都用它），maxTurn 为这一帧最大转角 */
  function turnTo(b, tx, ty, maxTurn) {
    var want = Math.atan2(ty - b.y, tx - b.x);
    var cur = Math.atan2(b.vy, b.vx);
    var d = want - cur;
    while (d > Math.PI) d -= U.TAU;
    while (d < -Math.PI) d += U.TAU;
    if (d > maxTurn) d = maxTurn;
    else if (d < -maxTurn) d = -maxTurn;
    var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    var na = cur + d;
    b.vx = Math.cos(na) * sp;
    b.vy = Math.sin(na) * sp;
  }

  /**
   * 点到线段的最短距离平方。
   *
   * 弹体命中判定用**线段**而不是端点：一帧的位移可能比目标还长。
   * 反器材步枪 780px/s，30fps 下每帧飞 26px，而一只游荡者的判定直径只有
   * (5.5 + 1.9) × 2 ≈ 14.8px —— 只看端点时子弹会整个"跨"过它，
   * 低帧率设备上一半以上的重弹是空包弹（见 tools/check-hit.js）。
   */
  function segDist2(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var qx = x1 + dx * t - px, qy = y1 + dy * t - py;
    return qx * qx + qy * qy;
  }

  /**
   * 追踪目标：射程内、且不在"身后"。
   *
   * 以前是 `nearest(b.x,b.y,150)` 无死角索敌 + 4.6 rad/s 转向，
   * 子弹能原地掉头去追背后的丧尸，看起来像导弹 —— 但卡片上写的是
   * "缓慢修正方向"。现在只在前方 ±100° 内小幅修正，掉头交给火箭。
   */
  Game.homingTarget = function (b, range) {
    var list = this.run.enemies, best = null, bd = range * range;
    var hx = b.vx, hy = b.vy;
    var hs = Math.sqrt(hx * hx + hy * hy) || 1;
    hx /= hs; hy /= hs;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.submerged) continue;
      var dx = e.x - b.x, dy = e.y - b.y;
      var d2 = dx * dx + dy * dy;
      if (d2 >= bd || d2 < 1) continue;
      var d = Math.sqrt(d2);
      if ((dx * hx + dy * hy) / d < -0.17) continue;   // 身后超过 ~100° 不管
      bd = d2;
      best = e;
    }
    return best;
  };

  /* ---------------- 空间网格（就近查询） ---------------- */
  function Grid(cell) {
    this.cell = cell;
    this.map = {};
  }
  Grid.prototype.clear = function () { this.map = {}; };
  Grid.prototype.key = function (gx, gy) { return (gx + 2048) * 8192 + (gy + 2048); };
  Grid.prototype.insert = function (o) {
    var k = this.key(Math.floor(o.x / this.cell), Math.floor(o.y / this.cell));
    var c = this.map[k];
    if (!c) { c = []; this.map[k] = c; }
    c.push(o);
  };

  /* ================= 武器基础动作 ================= */
  /* 具体武器的开火逻辑在 gear.js（手持）与 auto.js（自动装备）里，
     这里只保留所有攻击共用的弹道 / 投掷 / 连锁工具。 */

  /** 同一层：地面 vs 楼顶。近身光环不应该隔着楼板清地面尸群 */
  Game.sameLevel = function (e) {
    var p = this.run && this.run.p;
    if (!p) return true;
    return (e.roof || null) === (p.roof || null);
  };

  /** 连锁闪电：从起点开始，一跳一跳地找下一个目标 */
  Game.chain = function (p, start, dmg, chains, used, color, shock) {
    var pts = [{ x: p.x, y: p.y - 2 }];
    var cur = start;
    var guard = 0;
    while (cur && guard++ < chains) {
      used[cur.uid] = 1;
      pts.push({ x: cur.x, y: cur.y });
      this.hurtEnemy(cur, dmg, { tag: 'energy', electric: 1 });
      /* 电弧引爆：每跳落点小范围爆炸，清群更利索 */
      if (shock) this.explode(cur.x, cur.y, 18, dmg * 0.3, color || '#7ee8fa', { quiet: 1 });
      cur = this.nearestExcept(cur.x, cur.y, 95, used);
    }
    this.run.chains.push({ pts: pts, life: 0.16, max: 0.16, color: color || null });
  };

  /**
   * 连锁闪电（升级特效·连锁闪电）
   *
   * 每 X 次开火蓄一发：从玩家身上拉出一道电弧跳到最近的敌人，再逐跳扩散。
   * X 随等级缩短（6/4/3），跳数 2+lvl、伤害按武器那一发的 40/60/80% 折算，
   * 所以它会跟着你的武器一起变强，而不是越到后期越像挠痒。
   *
   * **闸门在这里**：两道电弧之间至少隔 CHAIN_GAP 秒，与武器射速无关。
   * 蓄能照常按开火次数累积（一次齐射只算一次），但攒到顶之后要等冷却，
   * 所以冲锋枪 / 持续光束（红莲切割者 12.5 跳/秒）不会把电弧刷成一条线。
   * 以前是"谁射速高谁放电快"，只能靠把持续光束整个排除来兜住 —— 那样反而不公平。
   */
  var CHAIN_GAP = 0.45;      // 两道连锁闪电的最小间隔（秒）

  Game.chargeChain = function (st, mul, def) {
    var p = this.run.p;
    var lvl = p.chainLvl | 0;
    if (!lvl) return;
    /* 一次性齐射只算一次开火：散弹 8 颗弹丸不该攒 8 格 */
    var need = HS.Data.chainNeed ? HS.Data.chainNeed(lvl) : (7 - lvl);
    p.chainN = (p.chainN || 0) + 1;
    if (p.chainN < need) return;
    /* 冷却没到就继续攒着（chainN 不归零），攒满等闸门一开立刻放 */
    if (this.run.t - (p._chainT || -999) < CHAIN_GAP) return;
    var dmg = (st.dmg || 10) * (mul || 1) * (0.4 + 0.2 * lvl);
    /* 场上没人就先不放电，蓄能够了等下一个目标 */
    if (!this.chainBolt(dmg, 2 + lvl)) return;
    p.chainN = 0;
    p._chainT = this.run.t;
  };

  /** 放一道连锁闪电；返回是否真的打到了人 */
  Game.chainBolt = function (dmg, jumps) {
    var run = this.run, p = run.p;
    var start = null, bd = 170 * 170;
    for (var i = 0; i < run.enemies.length; i++) {
      var e = run.enemies[i];
      if (e.dead || e.submerged) continue;
      if (p.roof ? e.roof !== p.roof : e.roof) continue;
      var d2 = U.dist2(e.x, e.y, p.x, p.y);
      if (d2 < bd) { bd = d2; start = e; }
    }
    if (!start) return false;
    var used = {};
    var pts = [{ x: p.x, y: p.y - 3 }];
    var cur = start;
    for (var j = 0; j < jumps && cur; j++) {
      used[cur.uid] = 1;
      pts.push({ x: cur.x, y: cur.y });
      /* 首跳满伤、后续每跳衰减 15%；electric 让它在积水中继续传导 */
      this.hurtEnemy(cur, dmg * Math.pow(0.85, j), { tag: 'energy', electric: 1, noCrit: true });
      for (var k = 0; k < 3; k++) {
        run.fx.push({
          kind: 'p', x: cur.x + U.rand(-3, 3), y: cur.y + U.rand(-4, 2),
          vx: U.rand(-52, 52), vy: U.rand(-52, 20),
          life: 0.24, max: 0.24, color: k % 2 ? '#a8f3ff' : '#e8fbff', size: 1.6
        });
      }
      cur = this.nearestExcept(cur.x, cur.y, 100, used);
    }
    run.chains.push({ pts: pts, life: 0.2, max: 0.2, color: '#a8f3ff' });
    run.fx.push({ kind: 'ring', x: start.x, y: start.y, r: 3, max: 14,
      life: 0.25, maxLife: 0.25, color: '#a8f3ff' });
    HS.Audio.zap();
    return true;
  };

  Game.lob = function (x, y, tx, ty, opt) {
    var run = this.run;
    var d = U.dist(x, y, tx, ty) || 1;
    var speed = opt.explode ? 230 : 210;
    run.bullets.push({
      x: x, y: y, sx: x, sy: y, tx: tx, ty: ty,
      vx: (tx - x) / d * speed, vy: (ty - y) / d * speed,
      dmg: opt.dmg, r: 3, life: d / speed, max: d / speed,
      pierce: 0, color: opt.color, kind: 'lob', dead: false,
      radius: opt.radius, dps: opt.dps || 0, dur: opt.dur || 0,
      explode: !!opt.explode, hit: null, shard: opt.shard || 0,
      effect: opt.effect || null, slow: opt.slow || 0, stun: opt.stun || 0,
      effectDur: opt.effectDur || 0, tag: 'explosive',
      /* id 必须透传：landLob 靠它区分冰冻手雷 / 爆闪 / EMP 的落地特效，
         以前漏了这一行，三种投掷物落地时画的都是同一圈橙火星 */
      id: opt.id || null,
      /* fire:1 → 砸出来的是火海，池子里的敌人会被点着 */
      fire: opt.fire ? 1 : 0
    });
  };

  /**
   * 投掷：先抬手蓄力，再让东西飞出去。
   *
   * 直接调 lob 的话瓶子会在手还没抬起来的时候就出膛，动作和弹道完全对不上。
   * 这里只登记一个"待投"的请求，由 updateThrows 在出手帧（rel）真正生成子弹。
   */
  Game.handThrow = function (p, tx, ty, opt) {
    if (!p.throws) p.throws = [];
    var ang = Math.atan2(ty - p.y, tx - p.x);
    var delay = opt.delay || 0;
    p.throws.push({
      t: 0, dur: 0.36 + delay, rel: 0.15 + delay, fired: false,
      tx: tx, ty: ty, opt: opt,
      kind: opt.explode ? 'grenade' : 'molotov',
      face: Math.cos(ang) >= -0.15 ? 1 : -1
    });
    /* 同屏最多演三套动作，多了就排不上了（正常 CD 下不会触发） */
    if (p.throws.length > 3) p.throws.splice(0, p.throws.length - 3);
  };

  Game.updateThrows = function (dt) {
    var p = this.run.p, list = p.throws;
    if (!list || !list.length) return;
    for (var i = list.length - 1; i >= 0; i--) {
      var th = list[i];
      th.t += dt;
      if (!th.fired && th.t >= th.rel) {
        th.fired = true;
        /* 从身前出手：起点比人高一点，接上 lob 的抛物线 */
        var a = Math.atan2(th.ty - p.y, th.tx - p.x);
        this.lob(p.x + Math.cos(a) * 5, p.y - 4 + Math.sin(a) * 3, th.tx, th.ty, th.opt);
      }
      if (th.t >= th.dur) list.splice(i, 1);
    }
  };

  /**
   * 通用发射器：所有远程武器最终都走这里。
   * opt 支持：speed / life / r / pierce / color / kind / split / bounce /
   *          homing / explode / radius / effect / delay / boomerang / tag
   */
  Game.shoot = function (x, y, ang, opt) {
    var sp = opt.speed || 300;
    var p = this.run.p;
    /* 枪口焰 / 后坐：只是表现，不影响弹道 */
    p.fireT = 0.07;
    p.recoil = 1;
    this.run.bullets.push({
      x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      dmg: opt.dmg, r: opt.r || 2, life: opt.life || 1, max: opt.life || 1,
      pierce: opt.pierce || 0, color: opt.color || '#fff',
      kind: opt.kind || 'bullet', hit: null, dead: false,
      radius: opt.radius || 0, explode: opt.explode ? 1 : 0, dps: 0, dur: 0,
      split: opt.split || 0, bounce: opt.bounce || 0, homing: opt.homing || 0,
      effect: opt.effect || null, delay: opt.delay || 0,
      /* 出血层数上限跟着武器分支等级走（回旋刃这类走弹道的带刃武器要用） */
      bleedLv: opt.bleedLv || 0,
      /* 嗜血等级（同上：飞行类的刃也要能吸血，见 updateBullets 的命中段） */
      leechLv: opt.leechLv || 0, leechN: 0,
      /* 拖拽参数（鱼叉 / 钩爪各自不同，见 combat.js 的 pull 效果） */
      pullStop: opt.pullStop, pullK: opt.pullK,
      boomerang: opt.boomerang || 0, tag: opt.tag || null,
      centerBonus: opt.centerBonus || 0,
      /* 命中即炸（攻城弩阵）：穿透时每一段都炸，所以不能走 explode 那条"炸完就死"的路 */
      boom: opt.boom || 0,
      /* 大号弹丸（转管风暴）：只影响表现，判定宽度由 r 决定 */
      big: opt.big || 0,
      /* 碎片数必须一起抄进弹体：火箭落地时 explode 读的是**弹体**而不是武器，
         漏了这一行，RPG / 重型RPG 的「碎片弹」「焚城」全成了空包弹（玩家报过） */
      shard: opt.shard || 0,
      /* 回旋刃的"回程中"标记：回程不吃掩体（见 updateBullets 的掩体段） */
      returning: 0,
      age: 0, didSplit: false
    });
  };

  /* ================= 索敌 ================= */

  /**
   * 最近的敌人 —— **只认看得见的**。
   * 公路隧道里灯与灯之间几乎全黑，看不见的东西当然锁不上（这就是"灯有用"的地方）：
   * 站在黑段里，只有贴身（玩家自带那点光）或者走进光池，武器才会自己开火。
   * 其它地图没有照明场，Light.seen 恒为 true，行为不变。
   */
  Game.nearest = function (x, y, range) {
    var list = this.run.enemies, best = null, bd = range * range;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.submerged) continue;
      var d = U.dist2(e.x, e.y, x, y);
      if (d >= bd) continue;
      if (HS.Light && !HS.Light.seen(e.x, e.y, this.run)) continue;
      bd = d; best = e;
    }
    return best;
  };

  Game.nearestExcept = function (x, y, range, used) {
    var list = this.run.enemies, best = null, bd = range * range;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.submerged || used[e.uid]) continue;
      var d = U.dist2(e.x, e.y, x, y);
      if (d >= bd) continue;
      if (HS.Light && !HS.Light.seen(e.x, e.y, this.run)) continue;
      bd = d; best = e;
    }
    return best;
  };

  /* ================= 伤害 ================= */

  /**
   * 点燃：燃烧状态的**唯一入口**。
   *
   * 以前每个调用点各写一遍 `e.burn = Math.max(...)` / `e.burnDps = Math.max(...)`，
   * 结果同一把火在不同武器上强度差三四倍（喷火枪 0.5×单跳、火焰环 0.35×dps、
   * 燃烧瓶干脆不挂）。集中到这里以后，调平衡只改一个数。
   *
   * 叠加规则是"取最强"而不是累加：长燃不能被短燃覆盖，弱火也不能削弱强火。
   * 点燃瞬间冒一簇火星 —— 玩家得看得出"这一下点着了"，否则 dot 等于暗改。
   */
  Game.ignite = function (e, dps, dur) {
    if (!e || e.dead) return;
    if (!(dps > 0) || !(dur > 0)) return;
    var fresh = !(e.burn > 0);
    e.burn = Math.max(e.burn || 0, dur);
    e.burnDps = Math.max(e.burnDps || 0, dps);
    /* 刚点着的那一下补一簇火：燃烧粒子的每帧概率太小，点燃没有"起燃"的瞬间感 */
    var run = this.run;
    if (fresh && run && run.fx.length < 210) {
      for (var i = 0; i < 4; i++) {
        var a = Math.random() * U.TAU;
        run.fx.push({
          kind: 'p', x: e.x + U.rand(-e.r * 0.6, e.r * 0.6), y: e.y - U.rand(0, e.r),
          vx: Math.cos(a) * U.rand(14, 42), vy: -U.rand(20, 52),
          life: U.rand(0.24, 0.44), max: 0.44,
          color: Math.random() < 0.45 ? '#ffd166' : '#ff7a33', size: Math.random() < 0.5 ? 1.6 : 2.4
        });
      }
    }
  };

  /**
   * 近战命中的打击感 —— 全部发生在**被砍的目标身上**，屏幕一动不动。
   *
   * 三个反馈同时在目标处叠加：
   *   1. `e.jolt`：精灵自己抖 0.12s + 轻微放大（渲染层读它，逻辑坐标不变）；
   *   2. 命中点爆 3~4 颗白 / 浅金火星，沿"玩家→目标"方向外甩；
   *   3. 重击（伤害 ≥12）多一颗大火星 + 一圈很小的白色冲击环。
   *
   * 为什么不用震屏：近战每秒能打 4~7 下，链锯/钻头更是每帧判定。
   * 每次命中抖 3.5px 的话，屏幕等于一直在晃 —— 那不是"有重量"，
   * 是画面发飘。全屏震动只留给爆炸、载具碾压、跳楼这种低频事件。
   */
  Game.hitJolt = function (e, d) {
    var run = this.run;
    if (!run || !e || e.dead) return;
    e.jolt = 0.12;
    if (run.fx.length > 200) return;
    /* 满屏挥砍（链锯 / 钻头每帧判定）时限流：0.04s 一次，
       否则二十只怪同时被扫到，火花会糊成一片白 */
    if (run.t - (run._joltT || -9) < 0.04) return;
    run._joltT = run.t;
    var p = run.p;
    var a = Math.atan2(e.y - (p.y - 3), e.x - p.x);
    if (!isFinite(a)) a = 0;
    var heavy = d >= 12;
    var n = heavy ? 4 : 3;
    for (var i = 0; i < n; i++) {
      var sa = a + U.rand(-0.75, 0.75);
      var sp = U.rand(50, heavy ? 135 : 105);
      run.fx.push({
        kind: 'p', x: e.x + U.rand(-2, 2), y: e.y - e.r * 0.45 + U.rand(-2, 2),
        vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp - 24,
        life: U.rand(0.11, 0.18), max: 0.18,
        color: i === 0 ? '#ffffff' : '#ffe0a8', size: i === 0 ? 2 : 1.4
      });
    }
    /* 重击补一圈贴着目标的白色小环：不抖屏，但"这一下很重"要看得出来 */
    if (heavy && run.fx.length < 200) {
      run.fx.push({
        kind: 'ring', x: e.x, y: e.y - e.r * 0.4,
        r: 2, max: 9, life: 0.14, maxLife: 0.14, color: '#fff4d6'
      });
    }
  };

  /**
   * 出血：带刃冷兵器的专属状态（升级分支「锯齿刃口」，见 upgrades.js）。
   *
   * 和燃烧的区别：燃烧是"点着就一直烧"，出血是**越砍越深** —— 每次命中叠一层，
   * 层数上限由分支等级决定（Lv1/2/3 → 3/4/5 层），持续时间统一 3.2s（每次命中续满）。
   * 每层每秒伤害 = 这一刀伤害 × 0.18：快刀层数叠得快、重刀单层更痛，两边总量接近。
   * 伤害走 dot + 无视护甲（伤口不看护甲），和燃烧同一口径。
   */
  Game.bleed = function (e, dmg, lv) {
    if (!e || e.dead) return;
    var run = this.run;
    if (!run) return;
    var cap = 2 + (lv || 1);
    var stacks = (e.bleedStacks || 0) + 1;
    if (stacks > cap) stacks = cap;
    e.bleedStacks = stacks;
    e.bleedHit = Math.max(e.bleedHit || 0, dmg * 0.22);
    e.bleed = 3.2;
    /* 见血的那一下：几点血珠从伤口甩出去。没有这一步，玩家只会以为
       "伤害变高了"，完全看不出挂了流血。
       颜色统一走灰黑（和击杀死溅、地面污渍同一套色）—— 红血不适合过审，
       灰黑在夜色街道上也更"脏"，观感并不吃亏 */
    if (run.fx.length < 210) {
      var n = stacks >= cap ? 5 : 3;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * U.TAU;
        run.fx.push({
          kind: 'p', x: e.x + U.rand(-e.r * 0.6, e.r * 0.6), y: e.y - e.r * 0.3,
          vx: Math.cos(a) * U.rand(22, 70), vy: Math.sin(a) * U.rand(8, 36) - 16,
          life: U.rand(0.26, 0.5), max: 0.5,
          color: Math.random() < 0.4 ? '#6e6e78' : (Math.random() < 0.5 ? '#4a4a52' : '#2c2c33'),
          size: Math.random() < 0.5 ? 2 : 1.6
        });
      }
    }
    /* 地上偶尔留一小摊血：层数堆满的目标脚下才明显 */
    if (stacks >= cap && Math.random() < 0.3 && run.decals.length < 50) {
      run.decals.push({
        x: e.x + U.rand(-4, 4), y: e.y + U.rand(0, 4),
        r: U.rand(2.5, 5), a: 0.5, life: 9, max: 9, blood: 1
      });
    }
  };

  /**
   * 唯一伤害入口。
   *
   * 传入的 dmg 已经包含武器数值与通用属性（Gear.global 里乘过 dmgMul），
   * 这里只叠加运行时的临时加成：增幅器、联动标记、暴击。
   */
  Game.hurtEnemy = function (e, dmg, opt) {
    if (e.dead) return;
    opt = opt || {};
    /* 潜渡中的水鬼在水面以下：子弹、刀锋、光束都摸不到它。
       只有爆炸（榴弹 / 炸弹 / 炮击）能靠冲击波震到它 —— 这是提前处理它的唯一办法。 */
    if (e.submerged && !opt.force && opt.tag !== 'explosive') return;
    /* 出水那一拍（emergeGuard）：水花糊在身上，打不中。
       它辛苦潜过来、咬完一口就站在玩家脸上等死 —— 26 血对中期玩家是 0.2 秒的事，
       于是"水鬼"整张图只剩一个会送经验的怪。给这 0.35 秒是为了让它**能退回去**，
       不是让它变肉（血量一点没动）。玩家看到身上糊着一层水膜就别浪费子弹，
       等它落地再打 —— 这层膜在 render 里是画出来的。 */
    if (e.emergeGuard > 0) return;
    var run = this.run, p = run.p;
    var crit = opt.forceCrit || (!opt.noCrit && Math.random() < p.crit);
    var d = dmg;

    if (p.ampT > 0) d *= p.ampMul;
    if (e.mark > 0) d *= (e.markMul || 1.08);
    /* 裂口（机械钻头）：伤口让目标挨打更痛，最多 3 层 × 12% */
    if (e.rift) d *= 1 + 0.12 * e.rift;
    /* 血怒（联动）：对已经在流血的目标，近战这一刀更狠 */
    if (p.syn && p.syn.bloodRage && opt.tag === 'melee' && e.bleed > 0) d *= 1.25;

    if (p.syn) {
      if (p.syn.xbStack && p.xbT > 0 && p.xbStack) {
        d *= 1 + 0.08 * Math.min(5, p.xbStack);
      }
      if (p.syn.critBurn && crit && (e.burn > 0 || e.synFrozen || (e.slow || 0) > 0.4)) {
        d *= 1.35 + 0.1 * ((p.synLv.critBurn || 1) - 1);
      }
      /* 冰火两重天：冻住的敌人更脆 —— 火焰（tag 'fire'，含火焰环的持续灼烧、喷火枪）
         和自动装备（tag 'auto'，毒雾 / 无人机 / 炮塔）都吃这 +40%。
         以前只判 'auto'，所以"冰火"里那一半"火"其实没有效果。 */
      if (p.syn.ringIce && e.synFrozen && (opt.tag === 'auto' || opt.tag === 'fire')) d *= 1.4;
    }
    if (crit) {
      d *= p.critMul;
      if (p.syn && p.syn.lmgHeat) p.heatT = 1.2;
      /* 暴走：暴击刷新加速窗口，连暴就一直续 */
      if (p.syn && p.syn.critRush) {
        p.rateT = 1.0;
        p.rateMul = 0.2 + 0.05 * ((p.synLv.critRush || 1) - 1);
      }
    }

    /* 护甲：只挡实弹 / 近战 / 爆炸。火焰、冰霜、持续伤害在调用点标了
       ignoreArmor —— 它们天生无视护甲，所以「破甲」对喷火枪毫无意义。
       破甲只是把这一层削减掉一部分（p.armorPen 是通用的，opt.pen 是
       武器自带的，比如机械钻头的"护甲形同虚设"）。 */
    if (e.armor && !opt.ignoreArmor) {
      var pen = p.armorPen + (opt.pen || 0);
      if (pen > 1) pen = 1;
      d *= (1 - e.armor * (1 - pen));
    }

    /* Boss 减伤：末世街区的暴君皮糙肉厚，吃到的所有伤害打折（e.dmgCut）。
       放在暴击/联动之后，减的是"最终结算值"，倍率再高也压得住。 */
    if (e.dmgCut) d *= (1 - e.dmgCut);

    /* 近战命中：**不抖屏**。
       挥砍是每秒好几次的高频动作，一记命中抖一次的话屏幕就一直在晃 ——
       不是"打击感强"，是画面发飘、看久了头晕。改成打在被砍的那只身上：
       目标自己抖一下 + 命中点爆火花 + 大号数字，视线全被吸到目标上，
       屏幕本身始终不动。（爆炸 / 碾压 / 跳楼这些低频大事件才配全屏震动） */
    if (opt.tag === 'melee') this.hitJolt(e, d);

    /* 顿帧：只有近战**挥砍**的重击才停一下（单次伤害 ≥ 目标最大血 15%）。
       - 弹体命中的近战（回旋刃）不算：它是"一直在刮"，不是一记重拳 ——
         一整套刀飞出去、每帧都在刮新目标，能把顿帧刷成常态；
         实测 10 秒里 40% 的帧都在顿帧，世界只走真实时间的 0.64 倍，玩起来就是掉帧。
       - 同一次顿帧还有 0.4 秒冷却：以前只限制"一帧一次"，多目标挥砍照样能连着刷。
         现在最多每 0.4 秒来一下，挥砍的"顿"还在，慢动作没有了。 */
    if (!opt.noHitStop && opt.tag === 'melee' && !run.hitStopOn && e.maxHp > 0 &&
        d >= e.maxHp * 0.15 && run.t - (run.hitStopT || -9) > 0.4) {
      run.hitStopOn = 1;
      run.hitStopT = run.t;
      this.hitStop = Math.max(this.hitStop || 0, 0.05);
    }

    if (opt.electric && !opt.noConduct && HS.Water) HS.Water.conduct(e, d, run);
    e.hp -= d;
    /* 持续伤害（dot）每帧都在跳，闪白会让目标一直发白 —— 流血还要看清血珠，
       所以 dot 自己决定闪不闪（出血用 noFlash） */
    if (!opt.noFlash) e.flash = 1;

    /* 处决：这一下把血打到斩杀线以下的，直接收掉 —— 伤害多少不重要，
       重要的是"残血不必再补一枪"。Boss 免疫（否则整场 Boss 战只剩刷血线），
       精英阈值减半；燃烧 / 中毒这类持续伤害同样能触发。 */
    var exec = false;
    if (p.execCut && e.maxHp > 0 && !e.boss && !(e.def && e.def.boss)) {
      var cut = p.execCut * (e.elite ? 0.5 : 1);
      if (cut > 0 && e.hp > 0 && e.hp <= e.maxHp * cut) {
        e.hp = 0;
        exec = true;
      }
    }

    if (!opt.silent) {
      if (run.texts.length > 30) run.texts.shift();
      run.texts.push({
        x: e.x + U.rand(-2, 2), y: e.y - e.r - 4,
        vy: -26, life: 0.5, max: 0.5,
        txt: Math.round(d), crit: crit,
        /* 近战数字加粗放大一档：抖屏撤掉以后，"这一刀多重"全靠数字读 */
        big: opt.tag === 'melee' ? 1 : 0
      });
      /* 击中反馈按伤害来源分音色（内部自带节流，命中频率太高） */
      HS.Audio.impact(opt.tag, crit);
    }
    /* 被炸到就震出水面：水下无敌的解法是往水里丢爆炸物，不是拿枪对着涟漪打 */
    if (e.submerged && opt.tag === 'explosive') {
      e.submerged = false;
      e.subState = 3; e.subT = 0.3;
      e.subCd = (e.def.subCd || 4) + Math.random() * 2;
      if (HS.Audio && HS.Audio.splash) HS.Audio.splash(true);
      for (var sbi = 0; sbi < 6; sbi++) {
        run.fx.push({
          kind: 'p', x: e.x + U.rand(-5, 5), y: e.y + U.rand(-4, 4),
          vx: U.rand(-42, 42), vy: U.rand(-56, -10),
          life: 0.34, max: 0.34, color: sbi % 2 ? '#9ecfc4' : '#6f9b93', size: 2
        });
      }
    }
    if (exec) this.execKill(e, opt);
    if (e.hp <= 0) this.killEnemy(e);
  };

  /**
   * 处决表现：两道交叉的白刃斩痕 + 暗色血点 + 「处决」字。
   * 反馈必须比普通命中重一档，否则玩家感受不到"这一下是斩杀"。
   * 颜色全部走冷白 / 灰黑：**游戏里不出现红色血**（过审口径，见 Game.bleed）。
   */
  Game.execKill = function (e, opt) {
    var run = this.run, p = run.p;
    var a = Math.atan2(e.y - p.y, e.x - p.x);
    /* 交叉两道斩痕：单弧在低分辨率下容易被当成普通刀光，交叉起来才是"处决" */
    run.fx.push({
      kind: 'slash', x: e.x, y: e.y - 3, ang: a, r: 18 + e.r, arc: 2.5,
      life: 0.26, max: 0.26, color: '#e6edf5'
    });
    run.fx.push({
      kind: 'slash', x: e.x, y: e.y - 4, ang: a + 1.05, r: 15 + e.r, arc: 1.9,
      life: 0.22, max: 0.22, color: '#9aa6b4'
    });
    run.fx.push({
      kind: 'ring', x: e.x, y: e.y, r: 3, max: 13,
      life: 0.18, maxLife: 0.18, color: '#8b939c'
    });
    for (var i = 0; i < 7; i++) {
      run.fx.push({
        kind: 'p', x: e.x + U.rand(-3, 3), y: e.y + U.rand(-4, 2),
        vx: U.rand(-76, 76), vy: U.rand(-96, 12),
        life: U.rand(0.18, 0.34), max: 0.34,
        color: i % 3 ? '#3a3a42' : '#6e6e78', size: i % 2 ? 2 : 1
      });
    }
    if (!opt || !opt.silent) {
      if (run.texts.length > 30) run.texts.shift();
      run.texts.push({
        x: e.x + U.rand(-2, 2), y: e.y - e.r - 8,
        vy: -24, life: 0.6, max: 0.6, txt: '处决', crit: true
      });
    }
    if (HS.Audio && HS.Audio.execute) HS.Audio.execute();
  };

  Game.killEnemy = function (e) {
    if (e.dead) return;
    e.dead = true;
    var run = this.run;

    run.kills++;
    if (e.elite) run.eliteKills++;

    /* 击杀回复：小怪按值回血，Boss 一次性回一截 */
    var p = run.p;
    if (p.lifesteal > 0) {
      p.hp = Math.min(p.maxHp, p.hp + p.lifesteal * (e.boss ? 12 : 1));
    }
    if (p.syn && p.syn.xbStack) {
      /* 穿透流：击杀会保留已有的穿透层数，算是一种奖励 */
      p.xbT = Math.max(p.xbT || 0, 1.2);
    }

    /* 自爆尸：死的那一刻原地炸开。冲击波不分敌我 ——
       在尸堆里点它，等于用一发免费的爆炸清场，也可能把自己送走。
       放在掉落 / 击杀特效之前：爆炸的判定要立刻生效，不能等闪白播完。 */
    if (e.def && e.def.bomber) this.bomberBlast(e);

    /* 龙息喷枪点着的目标烧死后炸开，并把火递给周围的人 —— 火焰会顺着尸群走。
       密集尸群里可能连锁，所以按 0.25s 窗口限 6 次，防止一帧炸出上百次。 */
    if (e.napalm && !e.boss) {
      if (run.napalmT === undefined || run.t - run.napalmT > 0.25) {
        run.napalmT = run.t;
        run.napalmN = 0;
      }
      if (run.napalmN < 6) {
        run.napalmN++;
        var nd = Math.max(8, (e.burnDps || 0) * 2.4);
        this.explode(e.x, e.y, 26, nd, '#ff8b3d', { quiet: true });
        for (var bi = 0; bi < run.enemies.length; bi++) {
          var ne = run.enemies[bi];
          if (ne.dead || ne === e) continue;
          if (U.dist(ne.x, ne.y, e.x, e.y) > 34 + ne.r) continue;
          ne.napalm = 1;
          /* 龙息连锁的火也要走 ignite，才能吃到"刚点着冒火星"的反馈 */
          this.ignite(ne, nd * 0.5, 1.8);
        }
      }
    }

    /* 击杀飞溅（灰黑） */
    var n = e.boss ? 30 : 5;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * U.TAU;
      var sp = U.rand(20, e.boss ? 150 : 70);
      run.fx.push({
        kind: 'p', x: e.x, y: e.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
        life: U.rand(0.3, 0.7), max: 0.7,
        color: Math.random() < 0.3 ? '#54545c' : '#3a3a42',
        size: U.rand(1, 2.4)
      });
    }
    if (run.fx.length > 160) run.fx.splice(0, run.fx.length - 160);

    /* 地面污渍（灰黑） */
    if (run.decals.length > 50) run.decals.shift();
    run.decals.push({
      x: e.x, y: e.y, r: e.boss ? 30 : e.r * 1.5,
      a: 0.45, life: 12, max: 12
    });

    /* 经验 */
    run.gems.push({
      x: e.x, y: e.y,
      vx: U.rand(-30, 30), vy: U.rand(-30, 30),
      xp: e.xp, size: e.xp >= 7 ? 3.2 : (e.xp >= 3 ? 2.5 : 1.9),
      dead: false, t: Math.random() * 6
    });

    /* 上限保护：只丢最老的一颗，绝不做合并。
       以前把经验并进最新一颗会造出经验炸弹，等于变相自动拾取。 */
    if (run.gems.length > 320) run.gems.shift();

    if (e.boss) {
      /* 双首领：只从存活表里摘掉这一只；还有别的没倒，就不算通关 */
      if (run.bosses && run.bosses.length) {
        for (var bq = 0; bq < run.bosses.length; bq++) {
          if (run.bosses[bq] === e) { run.bosses.splice(bq, 1); break; }
        }
      }
      if (run.bosses && run.bosses.length) {
        /* 还有一只没倒：把"门面"换成活着的那只，血条继续指着它 */
        run.boss = run.bosses[0];
        run.shake = 14;
        this.explode(e.x, e.y, 96, 0, '#9aa0a8');
        this.bannerShow((e.def.name || '首领') + ' 倒下了 · 还剩 ' + run.bosses.length + ' 只首领', 3);
        HS.Audio.win();
        return;
      }
      run.boss = null;
      run.bossKilled = true;
      run.shake = 14;
      this.explode(e.x, e.y, 110, 0, '#9aa0a8');
      if (run.endless) {
        /* 三只首领轮流出场，间隔随场次收缩：100s → 最短 60s */
        run.nextBossAt = run.t + Math.max(60, 100 - (run.bossCount - 1) * 8);
        run.bossSpawned = false;
        var esp = this.dropSpot(e.x, e.y);
        run.drops.push(this.hintDrop({ kind: 'chest', x: esp.x, y: esp.y, bob: 0, life: 60, dead: false }, 7));
        run.drops.push({ kind: 'heart', x: e.x + 14, y: e.y, bob: 0, life: 60, dead: false });
        this.bannerShow('首领倒下 · 死区仍在扩张', 3);
        HS.Audio.win();
        return;
      }
      this.bannerShow('区域已清空', 3);
      HS.Audio.win();
      this.finishRun(true);
      return;
    }

    /* 掉落：血包是稀缺资源，概率全面压低 —— 精英掉宝更偏宝箱，
       小怪掉血从 2.2%/5% 砍到 1.2%/2.5% */
    if (e.elite) {
      run.drops.push({
        kind: Math.random() < 0.8 ? 'chest' : 'heart',
        x: e.x, y: e.y, bob: Math.random() * 6, life: 45, dead: false
      });
    } else if (Math.random() < (run.bossSpawned ? 0.007 : 0.005)) {
      run.drops.push({ kind: 'heart', x: e.x, y: e.y, bob: 0, life: 22, dead: false });
    } else if (Math.random() < 0.035) {
      run.drops.push({ kind: 'gold', x: e.x, y: e.y, bob: 0, life: 22, dead: false, amount: 3 });
    }
  };

  /**
   * 爆炸：中心伤害更高，边缘衰减。
   * src.centerBonus 来自 RPG 联动「聚能装药」，贴身炸更疼。
   * src.shard 是「碎片战斗部」分支：爆炸后向四周甩出致命碎片。
   * src.quiet 用于连环小爆炸（电弧引爆等），不重复播音效、不震屏。
   */
  Game.explode = function (x, y, radius, dmg, color, src) {
    var run = this.run;
    var quiet = !!(src && src.quiet);
    run.fx.push({
      kind: 'ring', x: x, y: y, r: 6, max: radius,
      life: 0.3, maxLife: 0.3, color: color || '#ffb86b'
    });
    if (dmg > 0) {
      var center = (src && src.centerBonus) ? src.centerBonus : 1;
      for (var i = 0; i < run.enemies.length; i++) {
        var e = run.enemies[i];
        if (e.dead) continue;
        var d = U.dist(e.x, e.y, x, y);
        if (d >= radius + e.r) continue;
        var falloff = 1 - 0.4 * (d / (radius || 1));
        if (center > 1 && d < radius * 0.4) falloff *= center;
        this.hurtEnemy(e, dmg * falloff, { tag: 'explosive',
          electric: !!(src && (src.electric || src.id === 'emp' || src.effect === 'emp')) ? 1 : 0 });
      }
      /* 碎片：从爆心向外甩一圈短命强弹，回程还能补刀 */
      if (src && src.shard > 0) {
        var nS = Math.min(5, src.shard | 0);
        for (var s = 0; s < nS; s++) {
          var sa = (s / nS) * U.TAU + Math.random() * 0.5;
          this.shoot(x + Math.cos(sa) * 6, y + Math.sin(sa) * 6, sa, {
            dmg: dmg * 0.45, speed: 280, life: 0.26, r: 2,
            color: color || '#ffd166', pierce: 1, tag: 'explosive'
          });
        }
      }
    }
    if (!quiet) {
      run.shake = Math.max(run.shake, 6);
      HS.Audio.boom();
    }
  };

  /**
   * 自爆尸的死后爆炸。
   *
   * 为什么不是"主动自爆"：主动自爆会变成"它自己走过来炸你"，玩家只能躲；
   * 而"被你打死才炸"把开关交到玩家手里 —— 什么时候点掉它、站在哪个角度点，
   * 是这张图唯一的博弈。
   *
   * 伤害口径：对丧尸是**满额**（所以能当连锁炸弹用，但一帧里最多结算 8 次，
   * 否则一屏三十只自爆尸会互相引爆成一串雷）；对玩家按距离衰减，
   * 站在最外圈只掉一半多点。
   */
  Game.bomberBlast = function (e) {
    var run = this.run;
    if (!run) return;
    var r = e.blastR || (e.def && e.def.blastR) || 46;
    var mul = e.blastMul || (e.def && e.def.blastDmg) || 2.2;
    var dmg = Math.max(4, e.dmg * mul);
    var i;

    run.fx.push({
      kind: 'ring', x: e.x, y: e.y, r: 4, max: r,
      life: 0.3, maxLife: 0.3, color: '#e6ff62'
    });
    run.fx.push({
      kind: 'ring', x: e.x, y: e.y, r: 2, max: r * 0.58,
      life: 0.42, maxLife: 0.42, color: '#fbffc8'
    });
    if (run.fx.length < 210) {
      for (i = 0; i < 12; i++) {
        var ba = Math.random() * U.TAU;
        var bs = U.rand(40, 150);
        run.fx.push({
          kind: 'p', x: e.x, y: e.y,
          vx: Math.cos(ba) * bs, vy: Math.sin(ba) * bs - 20,
          life: U.rand(0.2, 0.45), max: 0.45,
          color: i % 3 === 0 ? '#e6ff62' : (i % 3 === 1 ? '#8a9a52' : '#3a3a42'),
          size: U.rand(1.4, 2.6)
        });
      }
    }

    /* 对丧尸：范围内的全吃。连锁窗口限 8 次，够炸穿一小片尸群，不会卡帧 */
    if (run.blastT === undefined || run.t - run.blastT > 0.2) {
      run.blastT = run.t;
      run.blastN = 0;
    }
    if (run.blastN < 8) {
      run.blastN++;
      for (i = 0; i < run.enemies.length; i++) {
        var o = run.enemies[i];
        if (o.dead || o === e) continue;
        var od = U.dist(o.x, o.y, e.x, e.y);
        if (od > r + o.r) continue;
        this.hurtEnemy(o, dmg * (1 - 0.4 * (od / (r || 1))), { tag: 'explosive' });
      }
    }

    /* 对玩家 */
    var p = run.p;
    var pd = U.dist(p.x, p.y, e.x, e.y);
    if (pd < r + p.r) {
      this.damagePlayer(Math.max(4, dmg * (1 - 0.45 * (pd / (r || 1)))));
    }

    /* 震屏压得很低：这张图一次能引出五六只自爆尸连环炸，
       原来每发都顶到 6px，一串炸下来整块屏幕在抖，看见什么全靠猜。
       3.2 / 1.5 是"能感觉到，但不晃眼"的量；连续炸还有 R.shakeAmount 的疲劳再打折。 */
    run.shake = Math.max(run.shake, e.mini ? 1.5 : 3.2);
    /* 大小崽分开：三只小崽连着炸时用轻的那档，别把玩家的枪声盖掉 */
    HS.Audio.pop(!!e.mini);
  };

  /**
   * 育母吐崽：一口气挤出 n 只小自爆尸。
   *
   * 小崽不是"第二只 Boss"：体型 62%、血量三成、炸得也轻。
   * 它们的作用是逼玩家在"继续输出育母"和"先清崽"之间做选择 ——
   * 放着不管，三十秒后走廊里全是会炸的东西。
   */
  Game.spitBombers = function (boss, n) {
    var run = this.run, p = run.p;
    var base = Math.atan2(p.y - boss.y, p.x - boss.x);
    for (var i = 0; i < n; i++) {
      var a = base + (i - (n - 1) / 2) * 0.5;
      var sx = boss.x + Math.cos(a) * (boss.r + 7);
      var sy = boss.y + Math.sin(a) * (boss.r + 7);
      var m = this.spawnEnemy('bomber', false, sx, sy);
      m.mini = true;
      m.scale *= 0.62;
      m.r *= 0.62;
      m.maxHp = Math.max(7, m.maxHp * 0.28);
      m.hp = m.maxHp;
      m.xp = Math.max(1, Math.round(m.xp * 0.5));
      m.gold = 1;
      m.dmg *= 0.6;
      m.blastR = 30;
      m.blastMul = 1.3;
      /* 出生硬直：给玩家 0.35 秒"这里冒出来三只"的反应时间 */
      m.spawnT = 0.35;
      for (var k = 0; k < 5; k++) {
        run.fx.push({
          kind: 'p', x: sx + U.rand(-4, 4), y: sy + U.rand(-4, 4),
          vx: U.rand(-40, 40), vy: U.rand(-50, 6),
          life: 0.4, max: 0.4,
          color: k % 2 ? '#e3d67e' : '#a89a52', size: 2
        });
      }
    }
    run.fx.push({
      kind: 'ring', x: boss.x, y: boss.y, r: boss.r * 0.5, max: boss.r * 2.1,
      life: 0.4, maxLife: 0.4, color: '#e3d67e'
    });
    run.shake = Math.max(run.shake, 5);
    HS.Audio.spit();
  };

  /**
   * 眩晕：尖啸者的超声命中后，玩家短暂"站不起来" —— 不能走、不能开枪。
   *
   * 这是全游戏唯一一个夺走操作权的负面状态，所以有三条硬约束：
   *   ① 只有一只怪会，且有 6 秒以上的冷却；
   *   ② 屏幕必须给足反馈（脚下光环 + 人物头上的「眩晕」+ 画面抖动），
   *      否则玩家只会觉得"我明明推着摇杆啊"；
   *   ③ 车里只吃三成 —— 车窗和引擎声挡掉大半，也算给"开车冲场"留一条活路。
   */
  Game.stunPlayer = function (sec) {
    var run = this.run, p = run.p;
    if (!p || this.state !== 'run') return 0;
    var s = p.veh ? sec * 0.35 : sec;
    if (s <= 0) return 0;
    if (p.stun > s) return 0;          // 已经在更长的眩晕里，不叠加
    p.stun = s;
    p.stunMax = s;
    p.hurtT = Math.max(p.hurtT, 0.25);
    run.fx.push({
      kind: 'ring', x: p.x, y: p.y + 2, r: 6, max: 30,
      life: 0.32, maxLife: 0.32, color: '#bfe9ff'
    });
    if (run.texts.length > 30) run.texts.shift();
    run.texts.push({
      x: p.x, y: p.y - 18, vy: -18, life: 1, max: 1, txt: '眩晕', crit: true
    });
    run.shake = Math.max(run.shake, 4);
    HS.Audio.hurt();
    /* 耳鸣跟上：眩晕是"操作被夺走"，光有受击音玩家只会以为自己挨了一下打 */
    HS.Audio.tinnitus();
    return s;
  };

  /**
   * 裂口：机械钻头钻出来的伤口 —— 让目标**受到的伤害变高**（可叠 3 层，每层 +12%）。
   *
   * 和出血分工：出血是目标自己掉血（自伤），裂口是"挨打更痛"（易伤）。
   * 两者都挂在目标身上，钻头一件武器把两个都带了，所以它打 boss / 精英最狠。
   */
  Game.rift = function (e) {
    if (!e || e.dead) return;
    var run = this.run;
    if (!run) return;
    e.rift = Math.min(3, (e.rift || 0) + 1);
    e.riftT = 4;
    if (run.fx.length < 210) {
      for (var i = 0; i < 3; i++) {
        var a = Math.random() * U.TAU;
        run.fx.push({
          kind: 'p', x: e.x, y: e.y - e.r * 0.3,
          vx: Math.cos(a) * U.rand(26, 76), vy: Math.sin(a) * U.rand(16, 54) - 10,
          life: 0.22, max: 0.22,
          color: Math.random() < 0.5 ? '#e6edf5' : '#9aa6b4', size: 1.4
        });
      }
    }
  };

  /**
   * 近战清弹：挥砍 / 突刺时把攻击范围内的敌方子弹一并扫掉。
   *
   * 近战最难受的不是打不动，而是被 200px 外的匪徒和呕酸尸白打 ——
   * 走过去的一路上全是子弹。这一刀扫掉范围内的弹丸，
   * 等于给近战一条"用身法换安全"的活路（不是无敌，只是把远程的节奏打断）。
   */
  Game.sweepBullets = function (p, r) {
    var run = this.run;
    if (!run) return 0;
    var list = run.ebullets, r2 = r * r, n = 0, i;
    for (i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.dead) continue;
      if (U.dist2(b.x, b.y, p.x, p.y) > r2) continue;
      b.dead = true;
      n++;
      if (n <= 4 && run.fx.length < 210) {
        run.fx.push({
          kind: 'p', x: b.x, y: b.y,
          vx: U.rand(-34, 34), vy: U.rand(-36, -6),
          life: 0.2, max: 0.2, color: '#e6edf5', size: 1.4
        });
      }
    }
    return n;
  };

  /**
   * 格挡反击：盾牌挡下伤害时，对身前一圈打回去。
   *
   * 以前"格挡"只是一个隐形的伤害系数，玩家根本不知道自己刚挡住了什么 ——
   * 现在挡下来会有一下可见的反震（白光环 + 伤害数字 + 击退），
   * 盾牌才像一件"拿在手上的东西"。
   */
  Game.blockCounter = function (p) {
    var run = this.run;
    if (!run) return;
    if (p.counterCd > 0) return;
    var i, ent = null, def = null;
    for (i = 0; i < p.weapons.length; i++) {
      var d = HS.Data.gear[p.weapons[i].id];
      if (d && d.counter) { ent = p.weapons[i]; def = d; break; }
    }
    if (!ent) return;
    var st = HS.Gear.stat(ent, p);
    var dmg = (st.dmg || 0) * (def.counter || 0.9);
    var rad = Math.max(34, (st.range || 30) * 1.4);
    /* 「铁壁阵线」联动：反击伤害翻倍、冷却减半 —— 让这条老联动和新机制接上 */
    if (p.syn && p.syn.shieldWall) {
      dmg *= 2;
      rad *= 1.15;
      p.counterCd = 0.14;
    } else {
      p.counterCd = 0.28;
    }
    var list = run.enemies, hit = 0;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || !this.sameLevel(e)) continue;
      var dx = e.x - p.x, dy = e.y - p.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > rad * rad) continue;
      this.hurtEnemy(e, dmg, { tag: 'melee' });
      var dd = Math.sqrt(d2) || 1;
      e.x += dx / dd * 7;
      e.y += dy / dd * 7;
      hit++;
    }
    if (run.fx.length < 210) {
      run.fx.push({
        kind: 'ring', x: p.x, y: p.y + 1, r: rad, max: rad,
        life: 0.26, maxLife: 0.26, color: '#dcecff'
      });
    }
    /* 反击同样不抖屏：hurtEnemy 已经逐个目标做了 hitJolt，这里只补音效 */
    if (hit) HS.Audio.impact('melee', false);
  };

  Game.damagePlayer = function (dmg, opt) {
    var run = this.run, p = run.p;
    if (this.state !== 'run') return;
    opt = opt || {};

    /* 坐在车里：所有伤害都变成车体磨损，人一滴血不掉。
       （要不要为了省车而下車，就是这个系统最核心的取舍） */
    if (p.veh && !opt.ignoreVehicle) {
      HS.Vehicle.damage(run, p.veh, Math.max(1, dmg * (opt.ranged ? 0.8 : 1.1)), true);
      return;
    }

    if (p.invuln > 0 && !opt.ignoreInvuln) return;

    /* 闪避：完全免伤；格挡：减伤但不算免伤 */
    if (!opt.ignoreArmor && p.dodge > 0 && Math.random() < p.dodge) {
      if (run.texts.length > 30) run.texts.shift();
      run.texts.push({
        x: p.x, y: p.y - 12, vy: -34, life: 0.6, max: 0.6, txt: '闪避', crit: true
      });
      p.invuln = 0.2;
      return;
    }
    if (!opt.ignoreArmor && p.block > 0 && Math.random() < p.block) {
      dmg *= 0.35;
      if (run.texts.length > 30) run.texts.shift();
      run.texts.push({
        x: p.x + 6, y: p.y - 12, vy: -30, life: 0.5, max: 0.5, txt: '格挡', crit: true
      });
      /* 挡住就反震：盾牌的收益要看得见，否则玩家只会觉得自己"运气好" */
      this.blockCounter(p);
    }
    if (opt.ranged) dmg *= (1 - (p.rangedCut || 0));
    /* 钢铁意志：残血时更抗揍，把「堆护甲」变成一套能翻盘的保命逻辑 */
    if (p.syn && p.syn.ironWall && p.hp < p.maxHp * 0.35) dmg *= 0.75;
    var d = Math.max(1, dmg - (opt.ignoreArmor ? 0 : p.armor));
    p.hp -= d;
    p.invuln = 0.45 + (p.invulnBonus || 0);
    p.hurtT = 0.3;
    /* 受击的震屏压到 2.5：保留"被打到了"的信号，但别再整屏晃。
       后期尸潮里受击很密，4px 的抖动会让人看不清自己站在哪。 */
    run.shake = Math.max(run.shake, 2.5);
    HS.Audio.hurt();
    if (run.search) this.cancelSearch('被击中，搜刮中止');
    if (run.texts.length > 30) run.texts.shift();
    run.texts.push({
      x: p.x, y: p.y - 10, vy: -30, life: 0.7, max: 0.7,
      txt: '-' + Math.round(d), hurt: true
    });
    P.vibrate('light');
  };

  /**
   * 水鬼拖拽：咬中之后把玩家往最近的深水区拖。
   *
   * 它不靠伤害杀人 —— 一口只有 5 点，真正要命的是"把你从干地拖进泥沼"：
   * 深水里玩家只剩三成移速，尸群一围就出不来。
   * **玩家的操作不被剥夺**：拖拽只是一段持续位移，摇杆随时可以抵消它。
   * 这和尖啸者的眩晕是两种东西 —— 后者是"整个人定住，连枪都开不了"。
   */
  var DRAG_TIME = 1.4;      // 拖拽持续多久
  var DRAG_SPD = 48;        // 拖拽速度：干地上玩家跑得掉，浅水僵持，深水才拖得动
  var DRAG_REACH = 170;     // 找方向时最远看到哪 —— 桥面正中到深水约 110px，要看得见
  var DRAG_IMMUNE = 2.5;    // 松口之后多久免疫（防止被一路接力拖到水中央）

  Game.dragToWater = function (from) {
    var run = this.run, p = run.p;
    if (!HS.Water || p.veh || p.roof) return false;
    /* **已经站在深水里就不再拖了**。这是它最要命的一个坑：
       以前不看当前水深，玩家被拖进水里之后它还在往更深处推，一路推到离公路
       几十米的水中央 —— 深水里玩家只有三成移速（≈18px/s），普通丧尸走不进来，
       BOSS 也过不来：既打不到东西、也死不掉，整局卡在那里。
       拖到水里它的目的就算达成了，剩下该靠玩家自己往回爬。 */
    if (HS.Water.zone(p.x, p.y, run) === 2) return false;
    /* 松口后有一小段免疫：否则几只水鬼轮流咬，等于一直在被拖 */
    if (p.dragImmune > 0) return false;
    /* 八个方向各探一段，取"最近方向上的第一处深水"，**只用来定方向**。
       它不保证一次就拖进水里：拖拽总位移 ≈ 1.4×48 ≈ 67px，而玩家站在桥面正中时
       深水在 110px 外 —— 一次拖不到位是正常的，被咬第二次就进去了。
       以前这里卡"只认 88px 内的深水"，结果站在中间的玩家永远不触发，技能等于没有。 */
    var bestA = -1, bestD = 1e9, i, d, x, y;
    for (i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      for (d = 26; d <= DRAG_REACH; d += 8) {
        x = p.x + Math.cos(a) * d;
        y = p.y + Math.sin(a) * d;
        if (HS.Water.zone(x, y, run) === 2) {
          if (d < bestD) { bestD = d; bestA = a; }
          break;
        }
      }
    }
    if (bestA < 0) return false;        // 附近一圈都没有深水：不拖
    /* 已经在被拖就只刷新时长，不叠加速度 —— 几只水鬼同时咬不该把人钉在原地 */
    if (!(p.dragT > 0)) {
      p.dragT = DRAG_TIME;
      p.dragVX = Math.cos(bestA) * DRAG_SPD;
      p.dragVY = Math.sin(bestA) * DRAG_SPD;
    }
    /* 免疫从"松口"开始算，所以是 拖拽时长 + 免疫时长 */
    p.dragImmune = DRAG_TIME + DRAG_IMMUNE;
    run.fx.push({
      kind: 'ring', x: p.x, y: p.y + 2, r: 4, max: 22,
      life: 0.45, maxLife: 0.45, color: '#8fc4b8'
    });
    if (HS.Audio && HS.Audio.splash) HS.Audio.splash(false);
    return true;
  };

  /* ================= 子弹 ================= */

  Game.updateBullets = function (dt) {
    var run = this.run, list = run.bullets, enemies = run.enemies, p = run.p;

    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      /* 连发：延迟出膛的子弹先原地等着，看起来才有"哒哒哒"的节奏 */
      if (b.delay > 0) { b.delay -= dt; continue; }
      b.age += dt;

      /* 追踪：普通弹丸只做小幅修正；homing = 2 是火箭（可以咬人咬到死） */
      if (b.homing) {
        var strong = b.homing > 1;
        var ht = strong ? this.nearest(b.x, b.y, 200) : this.homingTarget(b, 140);
        if (ht) turnTo(b, ht.x, ht.y, (strong ? 4.2 : 2.0) * dt);
      }
      /* 回旋刃：过半程折返，回到手上之前一直保持伤害判定 */
      if (b.boomerang && (b.returning || b.age > b.max * 0.45)) {
        b.returning = 1;
        var hdx = p.x - b.x, hdy = p.y - b.y;
        var hd2 = hdx * hdx + hdy * hdy;
        /* 贴身 60px 内把转身速度拉满（40rad/s ≈ 6px 转弯半径）：刀才会真的落回手上，
           而不是按 9rad/s 的宽弧绕着人转圈 —— 那看起来就是"回来的位置很奇怪" */
        turnTo(b, p.x, p.y, (hd2 < 3600 ? 40 : 9) * dt);
        /* 收在 16px：再近就钻进身体里了，这里正好是"接住"的位置 */
        if (hd2 < 16 * 16) { b.dead = true; continue; }
        /* 兜底：绕圈绕太久（玩家一直在跑、被墙角挡住）也要收，
           否则又回到"越攒越多"。2.2 倍名义射程时间 ≈ 2.8 秒 */
        if (b.age > b.max * 2.2) { b.dead = true; continue; }
        if (b.life < 0.08) b.life = 0.08;
      }

      /* 这一帧的飞行时间：打满射程的那一帧只飞剩下的那一点。
         以前是"先飞满一整帧再看 life<=0"，于是最后一帧的线段从来没被判定过 ——
         目标恰好站在射程边缘时（远距离的静止目标、贴着最大射程补刀），
         这一发会整发打空。现在先把位移夹到射程终点，判定照常做，
         飞行时间用完的收尾（火箭炸开 / 落地）挪到这一帧的最末尾。 */
      var step = dt;
      if (b.life > 0 && b.life < step) step = b.life;
      /* 记下这一帧的起点：命中判定走「线段」而不是「点」（见 segDist2） */
      var ox = b.x, oy = b.y;
      b.x += b.vx * step;
      b.y += b.vy * step;
      b.life -= dt;

      if (b.kind === 'lob') {
        if (b.life <= 0) { this.landLob(b); b.dead = true; }
        continue;
      }

      /* 掩体挡子弹；站在楼顶时子弹越过女儿墙，不再被建筑遮挡。
         **回旋刃是例外**：它是"扔出去还要回来"的，撞墙就消失等于这一刀白扔；
         而回程被车壳 / 墙角挡住是天天发生的事（玩家报过"碰到墙就回不来"）。
         去程撞上 → 退回这一帧的起点、弹一下，并直接进入折返；
         回程撞上 → 干脆不理掩体，回手优先（宁可穿过一块车壳，也别把刀吞了）。 */
      if (!b.returning && HS.World.hitBlock(b.x, b.y, b.r, !!p.roof)) {
        if (b.boomerang) {
          b.x = ox; b.y = oy;
          b.vx *= -0.5; b.vy *= -0.5;
          b.returning = 1;
          if (run.fx.length < 200) {
            run.fx.push({
              kind: 'p', x: b.x, y: b.y, vx: U.rand(-30, 30), vy: U.rand(-30, 30),
              life: 0.16, max: 0.16, color: '#dfe6ee', size: 1.4
            });
          }
        } else {
          if (b.explode && b.kind === 'rocket') this.explode(b.x, b.y, b.radius || 24, b.dmg, b.color, b);
          b.dead = true;
          run.fx.push({
            kind: 'p', x: b.x, y: b.y,
            vx: U.rand(-40, 40), vy: U.rand(-40, 40),
            life: 0.2, max: 0.2, color: '#ffd166', size: 1.6
          });
          continue;
        }
      }

      /* 载具是掩体：玩家/自己的弹幕会被车壳挡下（自己开的那辆除外），
         但**不打掉车壳耐久** —— 载具耐久只该被丧尸啃和撞车消耗，
         否则站在车边开一梭子就把待用的车打成废铁，等于自己拆自己的路。
         回旋刃同样例外：撞车壳 = 弹回来，不掉刀。 */
      var vveh = null;
      if (!b.returning) {
        for (var vi = 0; vi < run.vehicles.length; vi++) {
          var vvk = run.vehicles[vi];
          if (vvk === p.veh || vvk.wreck) continue;
          HS.Vehicle.bodyNear(vvk, b.x, b.y, _bodyOut);
          if (_bodyOut.d < b.r + vvk.def.w * 0.5) { vveh = vvk; break; }
        }
      }
      if (vveh) {
        if (b.boomerang) {
          b.x = ox; b.y = oy;
          b.vx *= -0.5; b.vy *= -0.5;
          b.returning = 1;
        } else {
          if (b.explode && b.kind === 'rocket') {
            this.explode(b.x, b.y, b.radius || 24, b.dmg, b.color, b);
          }
          run.fx.push({
            kind: 'p', x: b.x, y: b.y,
            vx: U.rand(-50, 50), vy: U.rand(-50, 30),
            life: 0.16, max: 0.16, color: '#ffd166', size: 1.6
          });
          b.dead = true;
          continue;
        }
      }

      for (var j = 0; j < enemies.length; j++) {
        var e = enemies[j];
        if (e.dead) continue;
        /* 水下的水鬼不挡子弹：打过去、穿过去，别让它白吃一发再消失 */
        if (e.submerged) continue;
        if (b.hit && b.hit[e.uid]) continue;
        var rr = e.r + b.r;
        /* 扫掠判定：这一帧的弹道（ox,oy → b.x,b.y）只要擦到就命中。
           原来只测终点，高速弹体会整帧跨过小目标（反器材步枪 780px/s 在
           30fps 下每帧 26px，比游荡者的判定直径还长）—— 低帧率下会凭空丢伤害。 */
        if (segDist2(e.x, e.y, ox, oy, b.x, b.y) >= rr * rr) continue;

        this.hurtEnemy(e, b.dmg, { tag: b.tag, noHitStop: 1 });
        /* 嗜血：飞出去的刃（回旋刃）打中也要回血。
           以前只有挥砍 / 突刺两条路结算 leech，弹体这一路完全没读 ——
           玩家在回旋刃上点满嗜血，打到人却一滴血不回。
           衰减口径和挥砍一致：同一把刀第 n 个目标按 0.75^(n-1) 折算。 */
        if (b.leechLv) {
          var leechK = Math.pow(0.75, b.leechN || 0);
          b.leechN = (b.leechN || 0) + 1;
          var leechHeal = b.dmg * 0.018 * b.leechLv * leechK;
          if (leechHeal > 0 && HS.Gear && HS.Gear.leech) {
            HS.Gear.leech(p, leechHeal);
            if (HS.Gear.leechTrail) HS.Gear.leechTrail(p, e, 1);
          }
        }
        this.bulletEffect(b, e, p);

        /* 攻城弩阵：命中就炸一次，**箭本身继续穿**（穿透过去的每一段都炸）。
           quiet 掉震动和音效：一轮 8 箭 × 最多 5 段，震屏会把画面抖散。 */
        if (b.boom > 0) {
          this.explode(b.x, b.y, b.boom, b.dmg * 0.55, b.color, { quiet: true });
        }

        var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;

        /* 分裂：命中后炸出两枚弱化次级弹（只分裂一次，避免指数爆炸） */
        if (b.split > 0 && !b.didSplit) {
          b.didSplit = true;
          for (var q = 0; q < b.split; q++) {
            var sa = Math.atan2(b.vy, b.vx) + (q % 2 ? 0.5 : -0.5);
            this.shoot(b.x, b.y, sa, {
              dmg: b.dmg * 0.55, speed: sp * 0.85, life: 0.42,
              r: b.r, color: b.color, pierce: 0, tag: b.tag
            });
          }
        }

        if (b.explode && b.kind === 'rocket') {
          this.explode(b.x, b.y, b.radius || 24, b.dmg, b.color, b);
          b.dead = true;
          break;
        }
        if (b.bounce > 0) {
          b.bounce--;
          if (!b.hit) b.hit = {};
          b.hit[e.uid] = 1;
          var nt = this.nearestExcept(b.x, b.y, 120, b.hit);
          if (nt) {
            turnTo(b, nt.x, nt.y, Math.PI);
            if (b.life < 0.3) b.life = 0.3;
          } else {
            b.dead = true;
          }
        } else if (b.pierce > 0) {
          b.pierce--;
          if (!b.hit) b.hit = {};
          b.hit[e.uid] = 1;
          if (p.syn && p.syn.xbStack) {
            p.xbStack = Math.min(5, (p.xbStack || 0) + 1);
            p.xbT = 2.5;
          }
        } else {
          b.dead = true;
        }
        break;
      }

      /* 射程走完的收尾：先做完这一帧的命中判定，再让子弹消失
         （火箭在自己的落点炸开；反器材步枪这类重弹则是"打满射程就停"）。
         这里重新读一次 life：弹射 / 回旋在命中时会把 life 续上，别把它当场枪毙。 */
      if (b.life <= 0 && !b.dead) {
        if (b.explode && b.kind === 'rocket') {
          this.explode(b.x, b.y, b.radius || 24, b.dmg, b.color, b);
        }
        b.dead = true;
      }
    }
    U.compact(list, 'dead');
  };

  /** 弹着效果：爆炸弹 / 燃烧弹 / 拖拽钩 / 无人机标记 */
  Game.bulletEffect = function (b, e, p) {
    if (b.effect === 'explode') {
      this.explode(b.x, b.y, b.radius || 26, b.dmg * 0.6, b.color, b);
    } else if (b.effect === 'burn') {
      /* 龙息弹这类"命中点燃"的子弹：燃烧 dot 按这一发的 0.8 倍给，
         打三枪就有一把火在持续咬 —— 以前 0.5 倍、1.5 秒，几乎看不见 */
      this.ignite(e, b.dmg * 0.8, 2.0);
    } else if (b.effect === 'bleed') {
      /* 回旋刃这类"掷出去的刃"走弹道，出血从这里补上（层数上限随分支等级） */
      this.bleed(e, b.dmg, b.bleedLv);
    } else if (b.effect === 'pull') {
      /* 鱼叉：把猎物往自己这边拽。
         · 距离越远拽得越狠（最多 150px），但停在贴身 26px 外，别把敌人塞进怀里
         · 拽完给 0.16s 踉跄 —— 否则它下一帧就走回来，"拉近"等于没发生
         · 拉出一道锁链 + 铁链声，让"拽"这件事看得见 */
      var run2 = this.run;
      var dx = p.x - e.x, dy = p.y - e.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      /* 停手距离 / 拖拽比例按武器给：鱼叉是重叉，留一点身位（26 / 0.72）；
         钩爪是把人拽到能砍到的距离（16 / 0.9） */
      var stopD = b.pullStop === undefined ? 26 : b.pullStop;
      var pullK = b.pullK === undefined ? 0.72 : b.pullK;
      var pull = Math.min(150, Math.max(0, d - stopD) * pullK);
      if (pull > 1) {
        e.x += dx / d * pull;
        e.y += dy / d * pull;
        e.stun = Math.max(e.stun || 0, 0.16);
        e.pullT = 0.18;
        run2.chains.push({
          pts: [{ x: p.x, y: p.y - 3 }, { x: e.x, y: e.y - 4 }],
          life: 0.18, max: 0.18, color: '#d8c9a2', straight: true, w: 1
        });
        for (var pi = 0; pi < 4; pi++) {
          run2.fx.push({
            kind: 'p', x: e.x + U.rand(-3, 3), y: e.y + U.rand(-3, 3),
            vx: U.rand(-40, 40), vy: U.rand(-50, 6),
            life: 0.2, max: 0.2, color: '#b9a887', size: 1.5
          });
        }
        if (HS.Audio && HS.Audio.chain) HS.Audio.chain();
      }
    } else if (b.effect === 'mark') {
      e.mark = 3.5;
      e.markMul = 1.18;
    }
    if (b.tag === 'auto' && p.syn && p.syn.droneMark) {
      e.mark = 2.5;
    }
  };

  Game.landLob = function (b) {
    var run = this.run;
    var i, e;

    /* 炮击标记：先落点，延迟后才覆盖轰炸 */
    if (b.effect === 'artillery') {
      run.devices.push({
        kind: 'delay', owner: 0, x: b.x, y: b.y,
        life: b.effectDur || 1.4, max: b.effectDur || 1.4,
        r: b.radius, dmg: b.dmg, color: '#ffd166', dead: false
      });
      run.fx.push({
        kind: 'ring', x: b.x, y: b.y, r: 6, max: b.radius,
        life: 0.3, maxLife: 0.3, color: '#ffd166'
      });
      HS.Audio.ui();
      return;
    }

    if (b.explode) {
      this.explode(b.x, b.y, b.radius, b.dmg, b.color, b);
      /* 冰冻 / 闪光 / EMP：先炸，再补控制 */
      if (b.stun || b.slow) {
        for (i = 0; i < run.enemies.length; i++) {
          e = run.enemies[i];
          if (e.dead) continue;
          if (U.dist(e.x, e.y, b.x, b.y) > b.radius + e.r) continue;
          if (b.stun) e.stun = Math.max(e.stun || 0, e.stun + b.stun);
          if (b.slow) {
            e.slow = Math.max(e.slow || 0, Math.min(0.85, b.slow));
            e.slowT = Math.max(e.slowT || 0, 2.4);
            e.synFrozen = 1;
          }
        }
      }
      if (b.effect === 'smoke') {
        run.pools.push({
          x: b.x, y: b.y, r: b.radius, life: b.dur || 5, max: b.dur || 5,
          dps: 0, slow: b.slow || 0.25, tick: 0, dead: false, smoke: 1
        });
      } else {
        /* 每种投掷物补一层自己的落地特效 —— 以前全都只有一圈同色冲击环，
           冰冻手雷和普通手雷在画面上完全一样 */
        if (b.id === 'cryogrenade') {
          for (i = 0; i < 7; i++) {
            var ca2 = i / 7 * U.TAU + Math.random() * 0.4;
            var cs = U.rand(40, 110);
            run.fx.push({
              kind: 'p', x: b.x + Math.cos(ca2) * 6, y: b.y + Math.sin(ca2) * 4,
              vx: Math.cos(ca2) * cs, vy: Math.sin(ca2) * cs * 0.8 - 12,
              life: U.rand(0.3, 0.55), max: 0.55,
              color: i % 2 ? '#dff3ff' : '#8fd4ff', size: 2.5
            });
          }
          run.fx.push({
            kind: 'ring', x: b.x, y: b.y, r: 8, max: b.radius * 0.9,
            life: 0.35, maxLife: 0.35, color: '#bfe9ff'
          });
        } else if (b.id === 'flashbang') {
          /* 爆闪：两圈快速外扩的白环，比普通爆炸更快更亮 */
          run.fx.push({
            kind: 'ring', x: b.x, y: b.y, r: 6, max: b.radius * 1.5,
            life: 0.22, maxLife: 0.22, color: '#ffffff'
          });
          run.fx.push({
            kind: 'ring', x: b.x, y: b.y, r: 2, max: b.radius * 0.7,
            life: 0.34, maxLife: 0.34, color: '#fff6c8'
          });
        } else if (b.id === 'emp') {
          /* 电磁脉冲：几道短电弧向外劈 */
          for (i = 0; i < 5; i++) {
            var ea2 = i / 5 * U.TAU + Math.random() * 0.5;
            run.chains.push({
              pts: [{ x: b.x, y: b.y },
                { x: b.x + Math.cos(ea2) * b.radius * 0.85, y: b.y + Math.sin(ea2) * b.radius * 0.7 }],
              life: 0.16, max: 0.16, color: '#8ef4ff', straight: 0
            });
          }
        } else {
          /* 普通爆炸物：一把橙黄火星，方向随机 */
          for (i = 0; i < 6; i++) {
            var sa2 = Math.random() * U.TAU;
            var sp2 = U.rand(50, 140);
            run.fx.push({
              kind: 'p', x: b.x, y: b.y,
              vx: Math.cos(sa2) * sp2, vy: Math.sin(sa2) * sp2 - 20,
              life: U.rand(0.2, 0.4), max: 0.4,
              color: i % 3 ? (b.color || '#ffb347') : '#fff3c4', size: 2
            });
          }
        }
      }
      return;
    }

    run.pools.push({
      x: b.x, y: b.y, r: b.radius, life: b.dur, max: b.dur,
      dps: b.dps, tick: 0, dead: false,
      /* fire:1 → 池子里的敌人会被点着（见 updateEnemies 的火池段）。
         燃烧瓶 / 火焰类投掷物走这条；钻核（gear.js 里 push 的 core 池）不吃。 */
      fire: b.fire ? 1 : 0
    });
    run.fx.push({
      kind: 'ring', x: b.x, y: b.y, r: 4, max: b.radius,
      life: 0.25, maxLife: 0.25, color: '#ff6b35'
    });
    HS.Audio.boom();
  };

  /** 某个点是否在烟幕里（远程压制 / 弹道遮挡都靠它） */
  Game.inSmoke = function (x, y) {
    var pools = this.run.pools;
    for (var i = 0; i < pools.length; i++) {
      var pool = pools[i];
      if (!pool.smoke || pool.dead) continue;
      if (U.dist2(x, y, pool.x, pool.y) < pool.r * pool.r) return true;
    }
    return false;
  };

  Game.updateEnemyBullets = function (dt) {
    var run = this.run, p = run.p, list = run.ebullets;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.kind === 'rock') b.rot = (b.rot || 0) + (b.spin || 0) * dt;
      if (b.life <= 0) { b.dead = true; continue; }

      /* 烟幕吃掉远程弹道：子弹/酸液穿进烟雾就散掉 —— 这是烟雾发射器的核心用途 */
      if (run.pools.length && this.inSmoke(b.x, b.y)) {
        b.dead = true;
        if (run.fx.length < 200) {
          run.fx.push({
            kind: 'p', x: b.x, y: b.y, vx: U.rand(-14, 14), vy: U.rand(-14, 4),
            life: 0.3, max: 0.3, color: '#b9c2cc', size: 2
          });
        }
        continue;
      }

      /* 载具是实体：子弹按车体胶囊判定，不再从车头车尾穿过去。
         打到自己开的车 → 车体磨损（damagePlayer 内部路由）；
         打到停着的车 → 那辆车掉耐久，掩体是会被打坏的 */
      var hitVeh = null;
      for (var vi = 0; vi < run.vehicles.length; vi++) {
        var vv = run.vehicles[vi];
        if (vv.wreck) continue;
        HS.Vehicle.bodyNear(vv, b.x, b.y, _bodyOut);
        if (_bodyOut.d < b.r + vv.def.w * 0.5 + 1) { hitVeh = vv; break; }
      }
      if (hitVeh) {
        if (hitVeh === p.veh) this.damagePlayer(b.dmg, { ranged: true });
        else {
          HS.Vehicle.damage(run, hitVeh, Math.max(1, b.dmg * 0.8));
          run.fx.push({
            kind: 'p', x: b.x, y: b.y,
            vx: U.rand(-50, 50), vy: U.rand(-50, 30),
            life: 0.16, max: 0.16, color: '#ffd166', size: 1.6
          });
        }
        b.dead = true;
        continue;
      }

      var rr = b.r + HS.Vehicle.bodyR(p) + 2;
      if (U.dist2(b.x, b.y, p.x, p.y) < rr * rr) {
        this.damagePlayer(b.dmg, { ranged: true });
        b.dead = true;
      }
    }
    U.compact(list, 'dead');
  };

  Game.spitAcid = function (e, ang) {
    this.run.ebullets.push({
      x: e.x, y: e.y - 2,
      vx: Math.cos(ang) * 120, vy: Math.sin(ang) * 120,
      life: 2.2, dmg: e.dmg * 0.9, r: 3, dead: false
    });
    HS.Audio.zap();
  };

  /**
   * 匪徒开枪：一颗飞行速度很快的子弹 + 枪口焰 + 一声枪响。
   * 子弹射程就是 def.range，飞完就消失 —— 这样"躲到远处"是有用的，
   * 也让玩家能从弹道方向判断枪手在哪个方向。
   */
  Game.fireGun = function (e, ang) {
    var run = this.run;
    var sp = 330;
    var a = ang + (Math.random() - 0.5) * 0.13;   // 一点点散布，不会枪枪必中
    var ca = Math.cos(a), sa = Math.sin(a);
    var mx = e.x + ca * (e.r + 3), my = e.y - 2 + sa * (e.r + 3);

    run.ebullets.push({
      x: mx, y: my, vx: ca * sp, vy: sa * sp,
      life: (e.def.range || 158) / sp,
      dmg: e.dmg * 0.85, r: 2.5, kind: 'gun', rot: a, dead: false
    });

    /* 枪口焰：三颗火星 + 一圈短命的光 */
    for (var i = 0; i < 3; i++) {
      run.fx.push({
        kind: 'p', x: mx, y: my,
        vx: ca * U.rand(40, 110) + U.rand(-18, 18),
        vy: sa * U.rand(40, 110) + U.rand(-18, 18),
        life: 0.09, max: 0.09, color: i === 0 ? '#fff3c4' : '#ffb347', size: 2
      });
    }
    run.fx.push({
      kind: 'ring', x: mx, y: my, r: 2, max: 9,
      life: 0.1, maxLife: 0.1, color: '#ffd166'
    });

    HS.Audio.weapon('pistol');
  };

  /** 暴君对楼顶玩家抛掷碎石 */
  Game.throwBossRock = function (e) {
    var p = this.run.p;
    var ang = Math.atan2(p.y - e.y, p.x - e.x);
    this.run.ebullets.push({
      x: e.x, y: e.y - 6,
      vx: Math.cos(ang) * 155, vy: Math.sin(ang) * 155,
      life: 2.8, dmg: e.dmg * 1.2, r: 4, kind: 'rock',
      rot: ang, spin: 9, dead: false
    });
    HS.Audio.weapon('launcher');
    HS.Audio.hit();
  };

  /* ================= 敌人 ================= */

  /**
   * 被墙 / 家具顶死时的补救：把这一步拆成 X、Y 两次小位移，
   * 各自单独做碰撞推出，于是"撞墙"只会吃掉法向分量、切向分量还在，
   * 丧尸就会顺着墙面 / 家具边缘滑向门口，而不是贴着墙一动不动。
   * 只有真的被卡住（实际位移远小于预期）时才走这条昂贵路径。
   */
  function slideFix(e, px, py, mdx, mdy) {
    var want2 = mdx * mdx + mdy * mdy;
    if (want2 < 1e-6) return;
    var ax = e.x - px, ay = e.y - py;
    if (ax * ax + ay * ay >= want2 * 0.3) return;
    var r = e.r * 0.4;
    e.x = px + mdx;
    e.y = py;
    HS.World.resolve(e, r);
    e.y += mdy;
    HS.World.resolve(e, r);
  }

  /* ---------------- 同层追击的绕行 ---------------- */

  /* 最多沿楼边挪几个角就放弃（一个矩形走完一圈是 4 个） */
  var WP_MAX_HOP = 6;

  /**
   * 绕墙：直线追人被楼体 / 废墟挡住时，沿楼的外沿一个角一个角地转。
   *
   * 解决两种卡死：
   *   1. 玩家正好站在楼背后 —— 追击方向垂直于墙面，切向分量为 0，
   *      沿墙滑（slideFix）根本没有分量可滑，丧尸永久顶在墙上
   *   2. 门洞就在直线路上 —— 丧尸从门里钻进去，发现玩家在外面又得掉头出来，
   *      出门一步又判定"在楼外"重新追直线，于是在门槛上每帧来回翻，永远过不去
   *
   * 做法（凸矩形的最短外绕就是"绕角"）：
   *   - proactive=true：都在楼外时，只要楼体压在直线上就主动绕，
   *     不去钻门洞（这正是 (2) 的根治办法）
   *   - proactive=false：被家具 / 车 / 同伴顶住时才绕（兜底）
   *   - 起步选最近的角 + 顺/逆时针里便宜的方向，之后方向不翻转
   *   - 到角点 → 沿同方向换下一个角；直线恢复通畅 → 立刻收工
   *   - 自己在某栋楼里、或目标在楼里（那该走门）都不绕
   *
   * 返回 true 表示这帧要用 e.wpX / e.wpY 当目标。
   */
  function wallRoute(e, tx, ty, dt, proactive) {
    var B = HS.Buildings;
    var r = e.r * 0.4;

    if (e.wpT > 0) {
      e.wpT -= dt;
      /* 直线已经通了 → 直接追，别再多走冤枉路 */
      if (e.wpB && !B.segHitsBld(e.x, e.y, tx, ty, e.wpB, r + 2)) {
        B.routeClear(e);
        return false;
      }
      /* 到角点了，或者去角点的路上被别的实心块顶住 → 沿同方向换下一个角 */
      if (U.dist(e.x, e.y, e.wpX, e.wpY) < 10 || e.blockT > 0.6) {
        if (e.wpHop >= WP_MAX_HOP || !B.routeNext(e, tx, ty, r)) return false;
        return true;
      }
      if (e.wpT > 0) return true;
      B.routeClear(e);
      return false;
    }

    if (!proactive && e.blockT < 0.22) return false;

    var list = B.buildingsNear(e.x, e.y);
    var bestB = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      /* 已经在这栋楼里：卡住的是门 / 家具，绕行帮不上忙 */
      if (e.x > b.x0 && e.x < b.x1 && e.y > b.y0 && e.y < b.y1) continue;
      /* 目标在楼里：那是穿门，不是绕行 */
      if (!b.ruin && tx > b.x0 && tx < b.x1 && ty > b.y0 && ty < b.y1) continue;
      /* 只绕真正压在直线上的楼体，否则会把敌人往反方向拽 */
      if (!B.segHitsBld(e.x, e.y, tx, ty, b, r + 2)) continue;
      var nx = e.x < b.x0 ? b.x0 : (e.x > b.x1 ? b.x1 : e.x);
      var ny = e.y < b.y0 ? b.y0 : (e.y > b.y1 ? b.y1 : e.y);
      var d2 = (e.x - nx) * (e.x - nx) + (e.y - ny) * (e.y - ny);
      if (d2 < bestD) { bestD = d2; bestB = b; }
    }
    if (!bestB) return false;
    return B.routeStart(e, bestB, tx, ty, r);
  }

  /**
   * 被实心道具（车壳 / 车堆 / 隧道衬砌）顶住时，选**哪一边**滑过去。
   *
   * 以前是 `wallSide = (uid & 1) ? 1 : -1` —— 一只怪的左右终身固定。
   * 在空地上够用，但公路隧道的车堆和墙一起夹出的是"死角落"：
   * 奇偶决定了它偏偏往墙那侧滑，撞回去、再滑、再撞回来，永远出不来。
   *
   * 这里改成探针：沿期望方向左右各打三条射线（0.7 / 1.15 / 1.6 rad，
   * 距离 r+8 / r+20 / r+32），哪侧空得多往哪侧走；两侧一样才用奇偶决定，
   * 这样同一批怪也不会整队贴同一边。
   */
  function probeSide(e, ang) {
    var bestSide = 1, bestScore = -1;
    for (var si = 0; si < 2; si++) {
      var sd = si === 0 ? 1 : -1;
      var score = 0;
      for (var k = 0; k < 3; k++) {
        var aa = ang + sd * (0.7 + k * 0.45);
        var dd = e.r + 8 + k * 12;
        if (!HS.World.insideSolid(e.x + Math.cos(aa) * dd, e.y + Math.sin(aa) * dd)) {
          score += 1 + k;      // 远端通比近端通更值钱：说明那边真能走出去
        }
      }
      if (score > bestScore) { bestScore = score; bestSide = sd; }
    }
    if (bestScore <= 0) bestSide = (e.uid & 1) ? 1 : -1;
    /* 分不出高下时按奇偶错开，避免一整队挤向同一侧 */
    if (bestScore === 3) bestSide = (e.uid & 1) ? 1 : -1;
    return bestSide;
  }

  /**
   * 直线 a→b 上有没有实心块（每 9px 采一点，最多 26 点）。
   * 只用来判断"还要不要继续侧滑"，所以精度比建筑那套 raycast 粗糙得多，
   * 够用且便宜。
   */
  function segBlocked(x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 6) return false;
    var n = Math.min(26, Math.ceil(d / 9));
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      if (HS.World.insideSolid(x0 + dx * t, y0 + dy * t)) return true;
    }
    return false;
  }

  /**
   * 被实心道具顶住时的局部寻路（只在需要时算，最多 3 次/秒）。
   * 返回 true 表示这帧要用 e.navX / e.navY 当目标。
   * 水图交给 Water.route（它认深水，不认车壳），这里避开。
   */
  function propNav(e, tx, ty, dt) {
    if (HS.Game.run.map.water) return false;
    if (e.navT > 0) {
      e.navT -= dt;
      if (U.dist(e.x, e.y, e.navX, e.navY) > 11) return true;
      e.navT = 0;
    }
    if (e.blockT < 0.7) return false;
    if (e.navCd > 0) { e.navCd -= dt; return false; }
    e.navCd = 0.35;
    var rt = HS.World.route(e.x, e.y, tx, ty);
    if (!rt) return false;
    e.navX = rt.x; e.navY = rt.y; e.navT = 0.55;
    return true;
  }

  /**
   * 把卡死的杂兵挪到附近最近的一块空地（约 22~46px，朝玩家那侧找）。
   * 这是最后一道兜底：楼顶那只"3 秒没进展就放它下楼"的看门狗同一个思路 ——
   * 一个原地打转的丧尸没有任何观赏价值，玩家只会觉得"这游戏的怪坏了"。
   */
  function unstick(e, p, run) {
    /* 冷却 5 秒：别让它一路"传送"穿过整个车堆 */
    if (e.uT > 0) return false;
    var away = Math.atan2(p.y - e.y, p.x - e.x);
    for (var wi = 0; wi < 12; wi++) {
      var wa = away + (wi % 2 ? 1 : -1) * (0.25 + wi * 0.16);
      var wr = 22 + (wi >> 1) * 12;
      var wx = e.x + Math.cos(wa) * wr, wy = e.y + Math.sin(wa) * wr;
      if (HS.World.insideSolid(wx, wy) || HS.World.insideSolid(wx, wy - 4) ||
          HS.World.insideSolid(wx, wy + 4) || HS.World.insideSolid(wx - 4, wy) ||
          HS.World.insideSolid(wx + 4, wy)) continue;
      for (var wf = 0; wf < 4; wf++) {
        run.fx.push({
          kind: 'p', x: e.x + U.rand(-4, 4), y: e.y + U.rand(-3, 3),
          vx: U.rand(-30, 30), vy: U.rand(-24, 8),
          life: 0.3, max: 0.3, color: '#5a5f66', size: 1.6
        });
      }
      e.x = wx; e.y = wy;
      e.blockT = 0; e.wallT = 0; e.navT = 0;
      e.progBest = undefined; e.progT = 0; e.uT = 5;
      return true;
    }
    return false;
  }

  /**
   * 育母的"弹药"：身边最近的一只自爆尸（小的也行，大的优先）。
   * 只挑没在被扔、没死的 —— 否则会出现两只 Boss 抢同一只的怪事。
   */
  Game.nearestBomber = function (x, y, range) {
    var run = this.run, list = run.enemies, best = null, bd = range * range;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.dead || !o.def || !o.def.bomber) continue;
      if (o.hurlT > 0 || o.mini) continue;
      var d2 = U.dist2(o.x, o.y, x, y);
      if (d2 < bd) { bd = d2; best = o; }
    }
    if (best) return best;
    /* 只有小崽也凑合：小崽炸得轻，但"被扔出去"这件事本身有威胁 */
    bd = range * range;
    for (var j = 0; j < list.length; j++) {
      var m = list[j];
      if (m.dead || !m.def || !m.def.bomber || m.hurlT > 0) continue;
      var md2 = U.dist2(m.x, m.y, x, y);
      if (md2 < bd) { bd = md2; best = m; }
    }
    return best;
  };

  /** 找到附近还活着的诱饵 */
  function nearestLure(x, y, range) {
    var list = HS.Game.run.devices, best = null, bd = range * range;
    for (var i = 0; i < list.length; i++) {
      var dv = list[i];
      if (dv.dead || dv.kind !== 'lure') continue;
      var d = U.dist2(dv.x, dv.y, x, y);
      if (d < bd) { bd = d; best = dv; }
    }
    return best;
  }

  Game.updateEnemies = function (dt) {
    var run = this.run, p = run.p, list = run.enemies;
    var grid = this._grid || (this._grid = new Grid(26));
    grid.clear();

    var pRoof = p.roof || null;
    var pB = HS.Buildings.insideOf(p.x, p.y);
    var i, e;
    for (i = 0; i < list.length; i++) {
      if (!list[i].dead) grid.insert(list[i]);
    }

    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.dead) continue;

      e.flash = Math.max(0, e.flash - dt * 5);
      /* 水鬼的出水保护（见 hurtEnemy / 潜渡分支） */
      if (e.emergeGuard > 0) e.emergeGuard = Math.max(0, e.emergeGuard - dt);
      /* 熔核层数：断火 0.5 秒就凉下来（红莲进化的 beamOnce 负责往上叠） */
      if (e.meltT > 0) {
        e.meltT -= dt;
        if (e.meltT <= 0) e.melt = 0;
      }
      /* 近战受击的自身抖动（见 Game.hitJolt）：只影响这一只的绘制，不碰镜头 */
      if (e.jolt > 0) e.jolt = Math.max(0, e.jolt - dt);
      /* 步频跟着实际速度走：快的丧尸腿频高，被冰冻减速时会明显变慢 */
      var animSpd = e.speed * (1 - (e.slow || 0));
      e.anim += dt * (3 + animSpd * 0.18) * (e.type === 'crawler' ? 1.4 : 1);
      if (e.bladeCd > 0) e.bladeCd -= dt;
      if (e.ramCd > 0) e.ramCd -= dt;
      if (e.slowT > 0) {
        e.slowT -= dt;
        if (e.slowT <= 0) { e.slow = 0; e.synFrozen = 0; }
      }
      if (e.burn > 0) {
        var burnDps = e.burnDps || 0;
        e.burn -= dt;
        if (burnDps > 0) {
          this.hurtEnemy(e, burnDps * dt, { silent: true, noCrit: true, dot: 1, ignoreArmor: 1 });
        }
        if (e.burn <= 0) e.burnDps = 0;
        /* 燃烧要"看得出来在掉血"：每 0.55s 弹一个小号橙字，写的是**每秒伤害**。
           全局限流 0.1s 一个 —— 一排怪同时烧的时候不至于把屏幕糊满数字。
           以前 dot 全 silent，玩家只能看到敌人莫名掉血，以为是谁的直伤。 */
        e.burnNumT = (e.burnNumT || 0) + dt;
        if (burnDps >= 0.6 && e.burnNumT >= 0.55 && run.t - (run._burnNumT || -9) > 0.1) {
          e.burnNumT = 0;
          run._burnNumT = run.t;
          if (run.texts.length > 32) run.texts.shift();
          run.texts.push({
            x: e.x + U.rand(-3, 3), y: e.y - e.r - 3,
            vy: -18, life: 0.55, max: 0.55,
            txt: Math.round(burnDps), dot: 1
          });
        }
        /* 燃烧要有看得见的火苗 —— 否则"弹丸点燃目标"这套机制等于不存在 */
        if (run.fx.length < 200 && Math.random() < 0.3) {
          run.fx.push({
            kind: 'p', x: e.x + U.rand(-e.r, e.r), y: e.y - U.rand(0, e.r * 1.5),
            vx: U.rand(-8, 8), vy: -U.rand(26, 50),
            life: 0.32, max: 0.32,
            color: Math.random() < 0.5 ? '#ff8b3d' : '#ffd166', size: 1.8
          });
        }
        if (e.dead) continue;
      }
      /* 出血：层数越高掉得越快，到点一次性清空。走 dot + 无视护甲，
         和燃烧同一口径，但**不闪白**（否则整只怪一直是白的，血珠看不见） */
      if (e.bleed > 0) {
        e.bleed -= dt;
        var bdps = (e.bleedHit || 0) * (e.bleedStacks || 1);
        if (bdps > 0) {
          this.hurtEnemy(e, bdps * dt, { silent: true, noCrit: true, dot: 1, noFlash: 1,
            ignoreArmor: 1, tag: 'bleed' });
        }
        if (e.bleed <= 0) { e.bleed = 0; e.bleedStacks = 0; e.bleedHit = 0; }
        /* 持续往外渗血：一两颗暗色血点，频率低到不会糊屏 */
        if (!e.dead && run.fx.length < 200 && Math.random() < 0.22) {
          run.fx.push({
            kind: 'p', x: e.x + U.rand(-e.r, e.r), y: e.y + U.rand(-2, e.r * 0.8),
            vx: U.rand(-7, 7), vy: U.rand(6, 22),
            life: 0.3, max: 0.3,
            color: Math.random() < 0.5 ? '#4a4a52' : '#2c2c33', size: 1.4
          });
        }
        if (e.dead) continue;
      }
      if (e.mark > 0) e.mark -= dt;
      /* 裂口到点愈合（4 秒没被继续钻就恢复） */
      if (e.riftT > 0) {
        e.riftT -= dt;
        if (e.riftT <= 0) { e.riftT = 0; e.rift = 0; }
      }
      /* 眩晕：完全停止行动（闪光弹 / EMP / 电击警棍） */
      if (e.stun > 0) {
        e.stun -= dt;
        e.gait += (0 - e.gait) * Math.min(1, dt * 10);
        continue;
      }
      /* 刚从育母的育囊里挤出来：0.35s 的落地硬直。
         否则它们一出生就贴在玩家身上，爆炸完全没有反应时间 */
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        e.anim += dt * 2.4;
        e.gait += (0.35 - e.gait) * Math.min(1, dt * 8);
        continue;
      }

      /* 被育母扔出来的自爆尸：走抛物线，落地就炸。
         这一段必须在寻路之前，否则它会一边飞一边按地面 AI 追人。 */
      if (e.hurlT > 0) {
        e.hurlT -= dt;
        var hk = e.hurlDur > 0 ? 1 - Math.max(0, e.hurlT) / e.hurlDur : 1;
        if (hk > 1) hk = 1;
        e.x = e.hurlX + (e.hurlX2 - e.hurlX) * hk;
        e.y = e.hurlY + (e.hurlY2 - e.hurlY) * hk;
        e.hurlH = Math.sin(hk * Math.PI) * (e.hurlArc || 46);
        e.hurlSpin = (e.hurlSpin || 0) + dt * 11;
        e.anim += dt * 8;
        if (e.hurlT <= 0 || hk >= 1) {
          e.hurlT = 0; e.hurlH = 0;
          /* 落地即引爆：hurtEnemy 走 killEnemy → bomberBlast，玩家/尸群一起招呼 */
          this.hurtEnemy(e, 1e9, { noCrit: true, tag: 'explosive' });
        }
        continue;
      }

      /* 门洞 / 楼梯寻路：
         玩家在楼里 → 走门；玩家在楼顶 → 进楼后走楼梯；
         自己在楼顶而玩家不在 → 从楼梯原路下去。 */
      var tx = p.x, ty = p.y;
      var navUsed = false;
      if (!e.boss) {
        var eB = HS.Buildings.insideOf(e.x, e.y);

        if (e.roof) {
          if (e.roof !== pRoof) {
            var downB = e.roof;
            if (downB.stairs) {
              /* 下楼的目标要带绕障：楼顶没有网格寻路，直线冲楼梯会被
                 屋顶风口顶死（"上得去下不来"就是这个）。roofStep 会把
                 被风口挡住的直线换成"绕到风口角上"的临时目标。 */
              var dop = HS.Buildings.roofStep(e, downB);
              if (dop) { tx = dop.x; ty = dop.y; }
              else { tx = downB.stairs.x; ty = downB.stairs.y; }
              /* 到达判定按"楼梯矩形"算：站到楼梯边上就该下去，
                 以前只认中心点 9px，靠边站会被判定成没到，一直贴着磨 */
              var sDist = HS.Buildings.stairsDist(e.x, e.y, downB);
              if (sDist < 5) {
                e.roof = null;
                e.roofT = 0;
                e.x = downB.stairs.x + U.rand(-3, 3);
                e.y = downB.stairs.y + U.rand(-3, 3);
                /* 下楼时把楼顶残留的绕行/贴墙状态清掉，否则会在室内
                   继续按楼顶的方向斜着走一段 */
                e.wpT = 0;
                e.wallT = 0;
                e.blockT = 0;
              } else {
                /* 兜底看门狗：流场正常情况下总能走到楼梯，只有"被同伴挤在
                   风口角落"这种偶发情况会真的走不动。3 秒没有任何进展就
                   直接放它下楼 —— 一个卡在楼顶的丧尸没有任何观赏价值，
                   但玩家会以为"这游戏丧尸下不来" */
                e.roofT = (e.roofT || 0) + dt;
                if (e.roofBest === undefined || sDist < e.roofBest - 1) {
                  e.roofBest = sDist;
                  e.roofT = 0;
                } else if (e.roofT > 3) {
                  e.roof = null;
                  e.roofT = 0;
                  e.x = downB.stairs.x + U.rand(-3, 3);
                  e.y = downB.stairs.y + U.rand(-3, 3);
                  e.wpT = 0;
                  e.wallT = 0;
                  e.blockT = 0;
                }
              }
            } else {
              e.roof = null;
            }
          }
        } else if (pRoof && eB === pRoof) {
          if (pRoof.stairs) {
            /* 已经摸进楼里：顺着楼梯上楼顶 */
            tx = pRoof.stairs.x; ty = pRoof.stairs.y;
            if (HS.Buildings.stairsDist(e.x, e.y, pRoof) < 5) {
              e.roof = pRoof;
              e.x = pRoof.stairs.x + U.rand(-6, 6);
              e.y = pRoof.stairs.y + U.rand(-6, 6);
              /* 落点可能压在屋顶风口上，先推出来再算"到了"，
                 否则一上楼就被顶开、下一帧又判定没到，来回抖 */
              HS.Buildings.resolveRoof(e, pRoof);
              e.wpT = 0;
              e.wallT = 0;
              e.blockT = 0;
              e.climbCd = 0.5;
              for (var cf = 0; cf < 4; cf++) {
                run.fx.push({
                  kind: 'p', x: e.x + U.rand(-5, 5), y: e.y + U.rand(-2, 6),
                  vx: U.rand(-24, 24), vy: U.rand(-24, -4),
                  life: 0.3, max: 0.3, color: '#8d8478', size: 1.4
                });
              }
              if (!run.roofClimbHint) {
                run.roofClimbHint = true;
                this.bannerShow('楼顶也不是安全屋 · 它们会顺着楼梯上来', 2.6);
              }
            }
          }
        } else if (eB !== pB && (eB || pB)) {
          /* 一里一外：穿门。doorNav 自带粘滞状态，不会在门洞里来回抖 */
          var bld = eB || pB;
          if (HS.Buildings.doorNav(e, bld, !eB, p.x, p.y, dt)) {
            tx = e.navX; ty = e.navY;
            navUsed = true;
          }
        } else if (!eB && !pB) {
          /* 都在楼外：楼体压在直线上就沿外沿绕开。
             不要指望"从门洞抄近道"——钻进去发现人又在外面，
             掉头出来一步又判定成楼外，会在门槛上每帧来回翻。 */
          HS.Buildings.navClear(e);
          if (wallRoute(e, p.x, p.y, dt, true)) {
            tx = e.wpX; ty = e.wpY;
            navUsed = true;
          }
        } else {
          /* 同一层又没有门要穿，清掉残留的穿门状态 */
          HS.Buildings.navClear(e);
        }
      }

      /* 兜底：被家具 / 车壳 / 同伴顶住时也要脱困 */
      if (!e.boss && !e.roof && !navUsed && wallRoute(e, tx, ty, dt, false)) {
        tx = e.wpX; ty = e.wpY;
      }
      /* 再兜一层：楼体之外还有车堆这种"几块旋转矩形拼出的凹形"，
         纯侧滑会在口袋里横跳，这里换成 12px 粗网格的局部寻路 */
      if (!e.boss && !e.roof && !navUsed && propNav(e, p.x, p.y, dt)) {
        tx = e.navX; ty = e.navY; navUsed = true;
      }

      /* 诱饵：附近的丧尸会改追诱饵（Boss 不上当） */
      if (!e.boss && run.devices.length) {
        var lure = nearestLure(e.x, e.y, 175);
        if (lure) { tx = lure.x; ty = lure.y; }
      }

      var dx = tx - e.x, dy = ty - e.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var spd = e.speed * (1 - (e.slow || 0)) * HS.Water.speed(e, run);
      var ux = dx / d, uy = dy / d;
      var px0 = e.x, py0 = e.y;   // 位移前的坐标，用来判断有没有被顶死

      /* 切向脱困：被家具 / 车壳 / 同伴挤住、又没楼体可绕时，朝一侧斜着挪一段。
         方向符号 wallSide 固定、wallT 锁 0.6s —— 否则松手就撞回原处，来回横跳。 */
      if (!e.boss && !e.def.ranged) {
        if (e.wallT > 0) {
          e.wallT -= dt;
          /* 1.5 rad ≈ 纯侧滑：只沿障碍物表面走，别再把 1/4 的力顶进车里。
             之前用 1.15 rad，一半的位移被车壳顶回来，0.5 秒只挪十几像素，
             刚好不够绕出一辆车的宽度，于是在车堆边上反复横跳。 */
          var wa = Math.atan2(uy, ux) + e.wallSide * 1.5;
          ux = Math.cos(wa); uy = Math.sin(wa);
          if (e.navT > 0) e.navT = 0;   // 寻路接管了就别再侧滑
          /* 绕出来了就立刻恢复直追（别把整段侧滑走完，否则会平白绕远） */
          if (!segBlocked(e.x, e.y, p.x, p.y)) e.wallT = 0;
        } else if (e.blockT > 0.3 && !(e.wpT > 0) && !(e.navT > 0) &&
          segBlocked(e.x, e.y, p.x, p.y)) {
          /* 只在"直线真被挡住"时才开始侧滑，侧滑期间也不再看计时器：
             一直滑到直线通了为止（上限 1.6s）。固定 0.5~0.75s 的窗口
             在车堆这种厚障碍前面根本不够，滑一半就放弃 = 原地打转。 */
          e.wallT = 1.6;
          e.wallSide = probeSide(e, Math.atan2(uy, ux));
        }
      }

      /* 深水避让：普通丧尸沿水岸走，不再一头顶在深水边缘原地抖。
         水栖敌人（水鬼）整片水域都能走，不需要绕。
         三段式：跟路点 → 锁定绕行方向 → 局部避让；被水塘困住时用粗网格寻路兜底。 */
      if (!e.boss && !e.roof && run.map.water && HS.Water && !(e.def && e.def.waterborne)) {
        if (!e.waterSide) e.waterSide = (e.uid & 1) ? 1 : -1;
        var wpA = Math.atan2(p.y - e.y, p.x - e.x);

        if (e.rtT > 0) {
          /* 跟路点：到点之前不重新决策，否则会在两格边界上来回蹭 */
          e.rtT -= dt;
          var rtD = Math.sqrt(U.dist2(e.x, e.y, e.rtX, e.rtY));
          if (rtD < 14) e.rtT = 0;
          else { ux = (e.rtX - e.x) / rtD; uy = (e.rtY - e.y) / rtD; }
        } else if (e.waterT > 0) {
          e.waterT -= dt;
          ux = Math.cos(e.waterAng); uy = Math.sin(e.waterAng);
        } else {
          var wd = HS.Water.stepDir(e.x, e.y, Math.atan2(uy, ux),
            Math.max(20, e.r * 2.6), run, e.waterSide, wpA);
          var wDev = wd - Math.atan2(uy, ux);
          while (wDev > Math.PI) wDev -= U.TAU;
          while (wDev < -Math.PI) wDev += U.TAU;
          if (Math.abs(wDev) > 0.45) { e.waterAng = wd; e.waterT = 0.6; }
          ux = Math.cos(wd); uy = Math.sin(wd);
        }

        /* 卡死看门狗：1.2s 内净位移不到 26px（原地顶水 / 绕着水塘打转都算） */
        var watk = (e.def.pounce && e.pounceState) || (e.def.vomit && e.vomitState);
        e.stuckT = (e.stuckT || 0) + dt;
        if (e.stuckT >= 1.2) {
          var smx = e.x - (e.stuckX === undefined ? e.x : e.stuckX);
          var smy = e.y - (e.stuckY === undefined ? e.y : e.stuckY);
          var farFromP = U.dist2(e.x, e.y, p.x, p.y) > 34 * 34;
          if (e.stuckX !== undefined && farFromP && !watk && smx * smx + smy * smy < 676) {
            var rt = HS.Water.route ? HS.Water.route(e.x, e.y, p.x, p.y, run) : null;
            if (rt) {
              e.rtX = rt.x; e.rtY = rt.y; e.rtT = 6;
            } else {
              /* 没有可走的路：贴着水岸长距离绕一侧（比每帧重算更不容易打转） */
              e.waterAng = wpA + e.waterSide * 1.5;
              e.waterT = 1.6;
              e.waterSide = -e.waterSide;
            }
          }
          e.stuckX = e.x; e.stuckY = e.y; e.stuckT = 0;
        }
      }

      if (e.boss) {
        var bt = e.def.bossType || 'tyrant';

        if (bt === 'gatling') {
          /* ---- 扫射暴君（死区之夜）----
             走位 → 枪管预热(0.9s) → 扫射(2.2s 大弹幕) → 过热罢工(3s 活靶子)。
             弹大、射程远、密度高，但整轮打完有真空期。 */
          e.gSt = e.gSt || 0;
          if (e.gSt === 0) {
            /* 中距离走位 */
            if (d > 360) { e.x += ux * spd * dt; e.y += uy * spd * dt; }
            else if (d < 150) { e.x -= ux * spd * 0.7 * dt; e.y -= uy * spd * 0.7 * dt; }
            e.gCd = (e.gCd === undefined ? 1.6 : e.gCd) - dt;
            if (e.gCd <= 0 && (!p.roof && !e.roof || p.roof && e.roof === p.roof)) {
              e.gSt = 1; e.gT = 0.9;
            }
          } else if (e.gSt === 1) {
            /* 预热：枪管转起来，火花从枪口溅出。
               枪口必须跟着"朝向玩家的那一侧"走 —— 以前写死在身体左侧 (-26,-6)，
               结果子弹从背后飞出来，看起来像"没拿枪却在开枪" */
            e.gT -= dt;
            e.spinA = (e.spinA || 0) + dt * 24;
            var gAim = Math.atan2(p.y - e.y, p.x - e.x);
            e.gAim = gAim;
            var gm1x = e.x + Math.cos(gAim) * 17, gm1y = e.y - 2 + Math.sin(gAim) * 17;
            if (Math.random() < 0.5) {
              run.fx.push({
                kind: 'p', x: gm1x + U.rand(-3, 3), y: gm1y + U.rand(-4, 4),
                vx: Math.cos(gAim) * U.rand(30, 80) + U.rand(-20, 20),
                vy: Math.sin(gAim) * U.rand(30, 80) + U.rand(-40, 10),
                life: 0.18, max: 0.18, color: '#ffd166', size: 1.6
              });
            }
            if (e.gT <= 0) { e.gSt = 2; e.gT = 0; e.gShot = 0; }
          } else if (e.gSt === 2) {
            /* 扫射：站定输出弹幕。过热按"每 10 发判定一次"结算：
               概率从 1% 起步，每多扫 10 发上一个台阶，最高 30%。
               gShot 只在真正出膛时 +1（按帧计数会和开火节拍错开，判定会漏）。 */
            e.spinA = (e.spinA || 0) + dt * 24;   // 扫射全程枪管都在转
            if (!e.gFireT || e.gFireT <= 0) {
              e.gFireT = 0.12;
              e.gShot = (e.gShot || 0) + 1;
              e.gAim = Math.atan2(p.y - e.y, p.x - e.x);
              var ga2 = e.gAim + (Math.random() - 0.5) * 0.22;
              var gca = Math.cos(ga2), gsa = Math.sin(ga2);
              /* 枪口点 = 瞄准方向 17px 处，和渲染里画出来的枪管对齐 */
              var gmx = e.x + Math.cos(e.gAim) * 17, gmy = e.y - 2 + Math.sin(e.gAim) * 17;
              run.ebullets.push({
                x: gmx, y: gmy,
                vx: gca * 280, vy: gsa * 280,
                life: 520 / 280, dmg: e.dmg * 0.55,
                r: 4.5, kind: 'gun', rot: ga2, dead: false
              });
              run.fx.push({
                kind: 'p', x: gmx, y: gmy,
                vx: gca * 90, vy: gsa * 90,
                life: 0.08, max: 0.08, color: '#fff3c4', size: 2.4
              });
              if (e.gShot % 3 === 0) HS.Audio.weapon('minigun');
              if (e.gShot % 10 === 0) {
                /* 每 10 发判定一次：1% → +9%/档 → 30% 封顶（约第 4 档到顶） */
                var gheat = Math.min(0.3, 0.01 + 0.09 * (e.gShot / 10 - 1));
                if (Math.random() < gheat) {
                  /* 枪管过热：冒烟罢工，gShot 归零，下一轮从 1% 重新爬 */
                  e.gSt = 3; e.gT = 3;
                  e.gShot = 0;
                  run.shake = Math.max(run.shake, 3);
                }
              }
            }
            e.gFireT -= dt;
          } else {
            /* 过热：原地冒烟，动都懒得动 —— 全场最好打的几秒 */
            e.gT -= dt;
            if (Math.random() < 0.6) {
              run.fx.push({
                kind: 'p', x: e.x - 20 + U.rand(-8, 8), y: e.y - 8,
                vx: U.rand(-8, 8), vy: -U.rand(20, 44),
                life: 0.6, max: 0.6, color: Math.random() < 0.5 ? '#555a62' : '#3a3e44', size: 2.4
              });
            }
            if (e.gT <= 0) { e.gSt = 0; e.gCd = 2.4; }
          }
        } else if (bt === 'axeboss') {
          /* ---- 断堤巨斧（锈水高速）----
             交叉斩封走位，跃劈砸出深水坑。两招都会劈碎桥面与残骸。
             半血后进入“断堤”状态：动作更快，落点水坑更大。 */
          e.axeRage = e.hp < e.maxHp * 0.45;
          if (e.axeRage) spd *= 1.28;
          e.aSt = e.aSt || 0;
          e.aCleaveCd = (e.aCleaveCd === undefined ? 3.2 : e.aCleaveCd) - dt;
          e.aLeapCd = (e.aLeapCd === undefined ? 6.2 : e.aLeapCd) - dt;
          /* 交叉斩的三个数字，**判定与地上的裂纹都只读这一份**：
             CL_CAST 是"多近才起手"（够近就抡），CL_R / CL_HALF 才是"这一刀砍得到哪"。
             以前这两个概念混着用（裂纹按起手距离 132 画），地上的弧就圈到了砍不到的地方。 */
          var CL_CAST = 132, CL_R = 118, CL_HALF = 0.86;
          if (e.aSt === 0) {
            e.x += ux * spd * dt; e.y += uy * spd * dt;
            if (e.aLeapCd <= 0 && d < 290 && d > 45) {
              e.aSt = 2; e.aT = 0.82; e.aAim = Math.atan2(p.y - e.y, p.x - e.x);
            } else if (e.aCleaveCd <= 0 && d < CL_CAST) {
              e.aSt = 1; e.aT = 0.68; e.aAim = Math.atan2(p.y - e.y, p.x - e.x);
              run.shake = Math.max(run.shake, 3);
            }
          } else if (e.aSt === 1) {
            /* 交叉斩：双斧亮起锈红预警，0.68s 后锁向落下。 */
            e.aT -= dt;
            e.aAim = Math.atan2(p.y - e.y, p.x - e.x);
            if (Math.random() < 0.55) run.fx.push({
              kind: 'p', x: e.x + Math.cos(e.aAim) * 16, y: e.y - 5 + Math.sin(e.aAim) * 16,
              vx: U.rand(-12, 12), vy: U.rand(-28, -8), life: 0.3, max: 0.3,
              color: Math.random() < 0.5 ? '#ff7b4a' : '#ffc078', size: 2
            });
            if (e.aT <= 0) {
              var pAng = Math.atan2(p.y - e.y, p.x - e.x);
              for (var ax = -1; ax <= 1; ax += 2) {
                var aa = e.aAim + ax * 0.46;
                run.fx.push({ kind: 'slash', x: e.x, y: e.y - 3, ang: aa, r: 92, arc: 1.3, life: 0.24, max: 0.24, color: '#ffb27a' });
                if (U.dist(e.x, e.y, p.x, p.y) < CL_R) {
                  var diff = pAng - aa;
                  while (diff > Math.PI) diff -= U.TAU;
                  while (diff < -Math.PI) diff += U.TAU;
                  if (Math.abs(diff) < CL_HALF) this.damagePlayer(e.dmg * 1.15);
                }
                var tipX = e.x + Math.cos(aa) * 72, tipY = e.y + Math.sin(aa) * 72;
                HS.World.smash(tipX, tipY, 22, this);
                /* 地上留的不是"斧尖砸的坑"，而是**斧刃划过的一道弧**。
                   半径取**伤害判定边界**（CL_R），不是斧刃视觉长度（92），也不是起手距离（CL_CAST）——
                   裂纹要圈住"这一刀能砍到哪"，玩家站在弧外面就该是安全的。
                   弧长同样取判定半角 ×2：两道斧的弧正好铺满那条扇形，
                   判定能打到的最外沿和裂纹是同一条线。
                   狂暴时判定范围不变，只是动作快、冷却短，所以半径不变。 */
                if (HS.Water) HS.Water.crackArc(e.x, e.y, aa, CL_HALF * 2, CL_R, run);
              }
              run.shake = Math.max(run.shake, 7);
              HS.Audio.boom();
              /* 挥出去之后留 0.26s 的收势：斧头扫过、身体前压 —— 让"它真的砍了一刀"看得见 */
              e.aSt = 5; e.aT = 0.26;
              e.aCleaveCd = e.axeRage ? 2.9 : 4.2;
            }
          } else if (e.aSt === 2) {
            /* 跃劈蓄力：蹲下、双斧后拉，落点先在地面亮圈。 */
            e.aT -= dt;
            e.aAim = Math.atan2(p.y - e.y, p.x - e.x);
            e.aTx = p.x; e.aTy = p.y;
            if (e.aT <= 0) {
              e.aSt = 3; e.aT = 0.58; e.aAir = 0.58;
              e.aSX = e.x; e.aSY = e.y;
              run.shake = Math.max(run.shake, 4);
              HS.Audio.zap();
            }
          } else if (e.aSt === 3) {
            /* 空中跃劈：按剩余时间插值落点，落地前不结算接触伤害。 */
            e.aT -= dt;
            var ak = 1 - Math.max(0, e.aT) / 0.58;
            e.x = e.aSX + (e.aTx - e.aSX) * ak;
            e.y = e.aSY + (e.aTy - e.aSY) * ak;
            e.airH = Math.sin(ak * Math.PI) * 28;
            if (e.aT <= 0) {
              e.airH = 0;
              var lr = e.axeRage ? 76 : 62;
              if (U.dist(e.x, e.y, p.x, p.y) < lr + p.r) this.damagePlayer(e.dmg * 1.35);
              run.fx.push({ kind: 'ring', x: e.x, y: e.y + 3, r: 6, max: lr, life: 0.34, maxLife: 0.34, color: '#ff9a66' });
              run.fx.push({ kind: 'ring', x: e.x, y: e.y + 3, r: 3, max: lr * 0.62, life: 0.5, maxLife: 0.5, color: '#b8e4d4' });
              HS.World.smash(e.x, e.y, lr * 0.7, this);
              if (HS.Water) HS.Water.breakTerrain(e.x, e.y, e.axeRage ? 46 : 36, run);
              for (var wv = 0; wv < 10; wv++) run.fx.push({
                kind: 'p', x: e.x + U.rand(-14, 14), y: e.y + U.rand(-7, 7),
                vx: U.rand(-90, 90), vy: U.rand(-90, 20), life: 0.45, max: 0.45,
                color: wv % 2 ? '#7fb5a3' : '#c6a56a', size: 2
              });
              run.shake = Math.max(run.shake, 10);
              HS.Audio.boom();
              e.aSt = 4; e.aT = 0.72;
            }
          } else if (e.aSt === 4) {
            /* 跃劈落地收招 */
            e.aT -= dt;
            if (e.aT <= 0) { e.aSt = 0; e.aLeapCd = e.axeRage ? 5.2 : 7.6; }
          } else {
            /* aSt 5：交叉斩的挥砍收势，纯表演，不结算伤害也不动冷却 */
            e.aT -= dt;
            if (e.aT <= 0) e.aSt = 0;
          }
        } else if (bt === 'stalker') {
          /* ---- 猎杀者（荒漠公路）----
             三段扑杀 + 狂暴嚎叫；每损失 25% 最大生命，攻击频率 +10%。 */
          e.rage = Math.floor(Math.max(0, 1 - e.hp / e.maxHp) / 0.25);
          if (e.roarT > 0) { e.roarT -= dt; spd *= 1.5; }   // 嚎叫加速余韵
          var sLvl = (!p.roof && !e.roof) || (p.roof && e.roof === p.roof);

          e.sSt = e.sSt || 0;
          if (e.sSt === 0) {
            e.x += ux * spd * dt;
            e.y += uy * spd * dt;
            /* 每损失 25% 最大生命 → 技能冷却消耗速度 +10%（= 攻击频率 +10%/层） */
            var cdRate = 1 + e.rage * 0.1;
            e.sPounceCd = (e.sPounceCd === undefined ? 3 : e.sPounceCd) - dt * cdRate;
            e.sRoarCd = (e.sRoarCd === undefined ? 5 : e.sRoarCd) - dt * cdRate;
            if (e.sRoarCd <= 0 && sLvl && d < 320) {
              e.sSt = 4; e.sT = 0.6;
            } else if (e.sPounceCd <= 0 && sLvl && d > 55 && d < 320) {
              e.sSt = 1; e.sT = 0.35; e.sLeft = 3;
              run.fx.push({
                kind: 'ring', x: e.x, y: e.y + 2, r: 4, max: 18,
                life: 0.35, maxLife: 0.35, color: '#ff5040'
              });
            }
          } else if (e.sSt === 1) {
            /* 扑击蓄力：方向跟到起跳瞬间才锁 */
            e.sT -= dt;
            e.pounceAng = Math.atan2(p.y - e.y, p.x - e.x);
            if (e.sT <= 0) {
              e.sSt = 2; e.sT = 0.32;
              e.pvx = Math.cos(e.pounceAng) * 400;
              e.pvy = Math.sin(e.pounceAng) * 400;
              HS.Audio.zap();
            }
          } else if (e.sSt === 2) {
            /* 扑 */
            e.sT -= dt;
            if (HS.World.insideSolid(e.x + e.pvx * dt * 3, e.y + e.pvy * dt * 3)) e.sT = 0;
            e.x += e.pvx * dt;
            e.y += e.pvy * dt;
            run.fx.push({
              kind: 'p', x: e.x, y: e.y,
              vx: -e.pvx * 0.1 + U.rand(-12, 12), vy: -e.pvy * 0.1 + U.rand(-12, 12),
              life: 0.2, max: 0.2, color: '#4d4238', size: 2
            });
            if (e.sT <= 0) {
              e.sLeft--;
              if (e.sLeft > 0) { e.sSt = 3; e.sT = 0.24; }
              else { e.sSt = 0; e.sPounceCd = 4.6; }
            }
          } else if (e.sSt === 3) {
            /* 段间缓冲：一拍停顿让玩家能预判下一扑 */
            e.sT -= dt;
            if (e.sT <= 0) { e.sSt = 1; e.sT = 0.35; }
          } else {
            /* 狂暴嚎叫：聚气 → 爆发加速 + 召尸 */
            e.sT -= dt;
            e.sRoarA = (e.sRoarA || 0) - dt * 3;
            if (Math.random() < 0.5) {
              run.fx.push({
                kind: 'ring', x: e.x, y: e.y,
                r: 6, max: 34 + Math.random() * 20,
                life: 0.3, maxLife: 0.3, color: '#ff6a4a'
              });
            }
            if (e.sT <= 0) {
              e.roarT = 3;
              e.sRoarCd = 8.5;
              run.shake = 6;
              HS.Audio.boom();
              for (var sk = 0; sk < 6; sk++) {
                var sa3 = Math.random() * U.TAU;
                var sr3 = 40 + Math.random() * 34;
                this.spawnEnemy(Math.random() < 0.7 ? 'walker' : 'runner', false,
                  e.x + Math.cos(sa3) * sr3, e.y + Math.sin(sa3) * sr3);
              }
              this.bannerShow('猎杀者发出了嚎叫', 1.8);
              e.sSt = 0;
            }
          }
        } else if (bt === 'shrieker') {
          /* ---- 尖啸者（公路隧道 · 双首领之一）----
             改动（用户反馈）：超声**不再是前方扇形**，只要玩家在视野里、距离够近，
             一嗓子就晕 —— 走廊这么窄，"绕到背后"本来也不是像样的应对。
             真正的应对变成：**躲到车壳后面**（看不见就不吃）或者干脆跑出射程。

             两招：
               ① 短啸：仰头蓄声 0.55s → 全向 250px 内、视线通 → 掉血 + 眩晕 0.9s，冷却 7.5s。
               ② 长啸（新）：蓄 0.5s 后**持续尖啸 2.4s**，每 0.32s 补一次短眩晕 + 掉血。
                  被它锁住会一直站不起来 —— 唯一的解法是躲进车后的视线死角，
                  断掉视线它就当场收声。冷却 12s，用完这 12 秒是输出窗口。
             贴身改用骨爪横扫。 */
          e.hSt = e.hSt || 0;
          e.hSonicCd = (e.hSonicCd === undefined ? 4.2 : e.hSonicCd) - dt;
          e.hChanCd = (e.hChanCd === undefined ? 9 : e.hChanCd) - dt;
          e.hClawCd = (e.hClawCd === undefined ? 2.4 : e.hClawCd) - dt;
          var hLvl = (!p.roof && !e.roof) || (p.roof && e.roof === p.roof);
          var hSee = hLvl && d < 250 && !segBlocked(e.x, e.y, p.x, p.y);

          if (e.hSt === 0) {
            /* 中距离站位：喊得到、抓不到。贴太近它会退半步 */
            if (d > 200) { e.x += ux * spd * dt; e.y += uy * spd * dt; }
            else if (d < 96) { e.x -= ux * spd * 0.62 * dt; e.y -= uy * spd * 0.62 * dt; }
            if (e.hClawCd <= 0 && hLvl && d < 56) {
              e.hSt = 3; e.hT = 0.34;
              e.hAng = Math.atan2(p.y - e.y, p.x - e.x);
            } else if (e.hChanCd <= 0 && hSee && d < 230) {
              /* 长啸优先：先蓄 0.5s 再进持续段 */
              e.hSt = 5; e.hT = 0.5;
              e.hChanT = 2.4; e.hChanTick = 0;
              e.hAng = Math.atan2(p.y - e.y, p.x - e.x);
              run.shake = Math.max(run.shake, 3);
              HS.Audio.scream(true);
            } else if (e.hSonicCd <= 0 && hSee) {
              e.hSt = 1; e.hT = 0.55;
              e.hAng = Math.atan2(p.y - e.y, p.x - e.x);
              run.shake = Math.max(run.shake, 2);
              HS.Audio.scream(true);
            }
          } else if (e.hSt === 1) {
            /* 短啸：仰头、胸腔撑开，喉咙口一圈圈往里收的光环 —— 这就是"要喊了" */
            e.hT -= dt;
            e.hAng = Math.atan2(p.y - e.y, p.x - e.x);
            var hk = 1 - Math.max(0, e.hT) / 0.55;
            if (Math.random() < 0.7 && run.fx.length < 210) {
              run.fx.push({
                kind: 'ring', x: e.x + Math.cos(e.hAng) * (e.r + 2),
                y: e.y - 4 + Math.sin(e.hAng) * (e.r + 2),
                r: 16 - hk * 10, max: 16 - hk * 10, life: 0.1, maxLife: 0.1,
                color: '#bfe9ff'
              });
            }
            if (e.hT <= 0) {
              var hRange = 250;
              run.fx.push({
                kind: 'ring', x: e.x, y: e.y, r: 8, max: hRange,
                life: 0.5, maxLife: 0.5, color: '#bfe9ff'
              });
              run.fx.push({
                kind: 'ring', x: e.x, y: e.y, r: 4, max: hRange * 0.72,
                life: 0.36, maxLife: 0.36, color: '#e8f8ff'
              });
              /* 全向：不再判角度，只判"看得见 + 够近" */
              if (hSee) {
                this.damagePlayer(e.dmg * 0.35);
                this.stunPlayer(0.9);
              }
              run.shake = Math.max(run.shake, 8);
              HS.Audio.scream(false);
              e.hSt = 2; e.hT = 0.5;
              e.hSonicCd = 7.5;
            }
          } else if (e.hSt === 2) {
            /* 收声：喉咙还在震，站定一拍 */
            e.hT -= dt;
            if (e.hT <= 0) e.hSt = 0;
          } else if (e.hSt === 3) {
            /* 骨爪横扫：贴身那一下，蓄力 0.34s */
            e.hT -= dt;
            e.hAng = Math.atan2(p.y - e.y, p.x - e.x);
            if (e.hT <= 0) {
              run.fx.push({
                kind: 'slash', x: e.x, y: e.y - 2, ang: e.hAng, r: 62, arc: 1.15,
                life: 0.22, maxLife: 0.22, color: '#dcecff'
              });
              var cpa = Math.atan2(p.y - e.y, p.x - e.x);
              var cdiff = cpa - e.hAng;
              while (cdiff > Math.PI) cdiff -= U.TAU;
              while (cdiff < -Math.PI) cdiff += U.TAU;
              if (hLvl && d < 70 && Math.abs(cdiff) < 0.9) {
                this.damagePlayer(e.dmg * 0.95);
              }
              e.hSt = 4; e.hT = 0.28;
              e.hClawCd = 2.6;
              HS.Audio.impact('melee', false);
            }
          } else if (e.hSt === 4) {
            e.hT -= dt;
            if (e.hT <= 0) e.hSt = 0;
          } else if (e.hSt === 5) {
            /* 长啸：0.5s 起手 → 2.4s 持续段，每 0.32s 一次"再晕一下" */
            if (e.hT > 0) {
              e.hT -= dt;
              e.hAng = Math.atan2(p.y - e.y, p.x - e.x);
              if (e.hT <= 0) { e.hChanT = 2.4; e.hChanTick = 0; HS.Audio.scream(false); }
            } else {
              e.hChanT -= dt;
              e.hChanTick = (e.hChanTick || 0) - dt;
              /* 每一拍：看得见就往死里震，看不见（躲进车后）就断声 */
              if (e.hChanTick <= 0) {
                e.hChanTick = 0.32;
                if (hSee) {
                  this.damagePlayer(e.dmg * 0.10);
                  this.stunPlayer(0.42);
                  run.shake = Math.max(run.shake, 5);
                  run.fx.push({
                    kind: 'ring', x: e.x, y: e.y, r: 10, max: 190,
                    life: 0.42, maxLife: 0.42, color: '#bfe9ff'
                  });
                } else {
                  /* 视线断了：立刻收声，玩家获得 12 秒输出窗口 */
                  e.hSt = 2; e.hT = 0.45;
                  e.hChanCd = 12;
                  HS.Audio.zap();
                }
              }
              if (e.hSt === 5 && e.hChanT <= 0) {
                e.hSt = 2; e.hT = 0.55;
                e.hChanCd = 12;
              }
            }
          }
        } else if (bt === 'brood') {
          /* ---- 育母（公路隧道 · 双首领之二）----
             慢慢压上来 → 育囊绷紧(0.9s) → 挤出 3 只小自爆尸 → 缓一拍。
             贴身用育囊撞（范围大、伤害高，但 0.45s 蓄力看得见）。
             它自己几乎不走位，难的是"你舍不舍得顶着三只小崽继续打它"。 */
          e.bSt = e.bSt || 0;
          e.bSpawnCd = (e.bSpawnCd === undefined ? 3.4 : e.bSpawnCd) - dt;
          e.bSlamCd = (e.bSlamCd === undefined ? 3.2 : e.bSlamCd) - dt;
          e.bThrowCd = (e.bThrowCd === undefined ? 5 : e.bThrowCd) - dt;
          var bLvl = (!p.roof && !e.roof) || (p.roof && e.roof === p.roof);
          if (e.bSt === 0) {
            e.x += ux * spd * dt;
            e.y += uy * spd * dt;
            if (e.bSpawnCd <= 0 && bLvl && d < 340) {
              e.bSt = 1; e.bT = 0.9;
              e.bAng = Math.atan2(p.y - e.y, p.x - e.x);
            } else if (e.bSlamCd <= 0 && bLvl && d < 64) {
              e.bSt = 3; e.bT = 0.45;
              e.bAng = Math.atan2(p.y - e.y, p.x - e.x);
            } else if (e.bThrowCd <= 0 && bLvl && d > 66 && d < 320) {
              /* 抓投：先挑一只身边的自爆尸当"弹药"，没有就过一会儿再看 */
              var vic = this.nearestBomber(e.x, e.y, 175);
              if (vic) {
                e.bSt = 5; e.bT = 0.5;
                e.bVictim = vic;
                e.bAng = Math.atan2(p.y - e.y, p.x - e.x);
                HS.Audio.spit();
              } else {
                e.bThrowCd = 1.4;
              }
            }
          } else if (e.bSt === 1) {
            /* 育囊绷紧：整只往后仰，囊皮上的缝一鼓一鼓 */
            e.bT -= dt;
            if (Math.random() < 0.55 && run.fx.length < 210) {
              var a2b = Math.random() * U.TAU;
              run.fx.push({
                kind: 'p', x: e.x + U.rand(-e.r * 0.6, e.r * 0.6), y: e.y + U.rand(0, e.r * 0.7),
                vx: Math.cos(a2b) * 8, vy: -U.rand(10, 30),
                life: 0.4, max: 0.4, color: Math.random() < 0.5 ? '#e3d67e' : '#a89a52', size: 2
              });
            }
            if (e.bT <= 0) {
              this.spitBombers(e, 3);
              e.bSt = 2; e.bT = 0.55;
              e.bSpawnCd = 7.4;
            }
          } else if (e.bSt === 2) {
            e.bT -= dt;
            if (e.bT <= 0) e.bSt = 0;
          } else if (e.bSt === 3) {
            /* 育囊撞：往前扑半步，落地一圈冲击 */
            e.bT -= dt;
            if (e.bT <= 0) {
              var bSr = 62;
              run.fx.push({
                kind: 'ring', x: e.x + Math.cos(e.bAng) * 18, y: e.y + Math.sin(e.bAng) * 10,
                r: 6, max: bSr, life: 0.3, maxLife: 0.3, color: '#e3d67e'
              });
              var spl = Math.atan2(p.y - e.y, p.x - e.x);
              var bsDev = spl - e.bAng;
              while (bsDev > Math.PI) bsDev -= U.TAU;
              while (bsDev < -Math.PI) bsDev += U.TAU;
              if (bLvl && d < bSr + p.r && Math.abs(bsDev) < 1.1) {
                this.damagePlayer(e.dmg * 1.15);
              }
              run.shake = Math.max(run.shake, 7);
              HS.Audio.boom();
              e.bSt = 4; e.bT = 0.34;
              e.bSlamCd = 3.4;
            }
          }
          if (e.bSt === 4) {
            e.bT -= dt;
            if (e.bT <= 0) e.bSt = 0;
          } else if (e.bSt === 5) {
            /* 抓取：0.5s 把那只自爆尸拎起来（它这段时间还在乱走，抓空了就作废） */
            e.bT -= dt;
            var vv = e.bVictim;
            if (!vv || vv.dead || vv.hurlT > 0) {
              e.bSt = 0; e.bThrowCd = 1;
            } else if (e.bT <= 0) {
              e.bSt = 6; e.bT = 0.35;
              e.bThrowCd = 7.5;
              /* 抛物线扔向玩家当前位置；距离越远飞得越久、弧越高 */
              var flight = 0.55 + Math.min(0.4, d / 700);
              vv.hurlT = flight;
              vv.hurlDur = flight;
              vv.hurlX = vv.x; vv.hurlY = vv.y;
              vv.hurlX2 = p.x; vv.hurlY2 = p.y;
              vv.hurlArc = 40 + Math.min(32, d * 0.12);
              vv.hurlSpin = 0;
              vv.blastMul = (vv.blastMul || (vv.def && vv.def.blastDmg) || 2.2) * 1.3;
              vv.speed = 0;
              run.fx.push({
                kind: 'ring', x: vv.x, y: vv.y, r: 4, max: 22,
                life: 0.24, maxLife: 0.24, color: '#e3d67e'
              });
            }
          } else if (e.bSt === 6) {
            e.bT -= dt;
            if (e.bT <= 0) e.bSt = 0;
          }
        } else {
          /* ---- 血肉暴君（末世街区）----
             暴走：Boss 存活越久速度越快，避免被无限风筝 */
          e.age = (e.age || 0) + dt;
          var enrage = 1 + Math.max(0, e.age - 26) * 0.028;
          if (enrage > 2.3) enrage = 2.3;
          if (e.age > 26 && !e.enraged) {
            e.enraged = true;
            this.bannerShow('暴君暴走 · 速度提升', 2.2);
            run.shake = 6;
          }
          spd = spd * enrage;

          e.chargeCd -= dt;
          if (e.chargeT > 0) {
            e.chargeT -= dt;
            e.x += ux * spd * 2.7 * dt;
            e.y += uy * spd * 2.7 * dt;
            if (Math.random() < 0.3) {
              run.fx.push({
                kind: 'p', x: e.x, y: e.y + 8,
                vx: U.rand(-20, 20), vy: U.rand(-30, -5),
                life: 0.4, max: 0.4, color: '#33333a', size: 2
              });
            }
          } else {
            e.x += ux * spd * dt;
            e.y += uy * spd * dt;
            if (e.chargeCd <= 0 && d < 240) {
              e.chargeT = 1.05;
              e.chargeCd = 5.2;
              run.shake = Math.max(run.shake, 5);
            }
          }
          e.addCd = (e.addCd === undefined ? 6 : e.addCd) - dt;
          if (e.addCd <= 0) {
            e.addCd = 7.5;
            for (var k = 0; k < 4; k++) {
              var aa = Math.random() * U.TAU;
              this.spawnEnemy('walker', false, e.x + Math.cos(aa) * 26, e.y + Math.sin(aa) * 26);
            }
          }

          /* 玩家上楼顶时，暴君会抡起碎石往上砸，楼顶不是安全屋 */
          if (p.roof) {
            e.throwCd = (e.throwCd === undefined ? 2.3 : e.throwCd) - dt;
            if (e.throwCd <= 0 && d < 360) {
              e.throwCd = 3.3;
              this.throwBossRock(e);
            }
          }
        }
      } else if (e.def.ranged) {
        if (d > e.def.range) {
          e.x += ux * spd * dt;
          e.y += uy * spd * dt;
        } else if (d < e.def.range * 0.62) {
          e.x -= ux * spd * 0.8 * dt;
          e.y -= uy * spd * 0.8 * dt;
        }
        e.shootCd -= dt;
        /* 在烟里看不见目标：持枪匪徒 / 吐酸者被烟幕压制 */
        if (e.shootCd <= 0 && d < e.def.range * 1.2 && !this.inSmoke(e.x, e.y)) {
          e.shootCd = e.def.cd;
          /* 持枪匪徒打的是子弹，吐酸者喷的是酸液 —— 表现和手感完全不同 */
          if (e.def.gun) this.fireGun(e, Math.atan2(dy, dx));
          else this.spitAcid(e, Math.atan2(dy, dx));
        }
      } else if (e.def.pounce) {
        /* ---- 扑袭者：平时是只快丧尸，进了范围就"蓄力→猛扑→踉跄" ----
           蓄力时死盯玩家但方向在起跳瞬间才锁死，扑到脸上才算数；
           扑空撞墙会自己断掉进踉跄，玩家有一整拍反打窗口。 */
        e.pounceCd -= dt;
        if (e.pounceState === 1) {
          e.pounceWind -= dt;
          e.pounceAng = Math.atan2(p.y - e.y, p.x - e.x);
          if (e.pounceWind <= 0) {
            e.pounceState = 2;
            e.pounceT = 0.5;
            e.pvx = Math.cos(e.pounceAng) * 330;
            e.pvy = Math.sin(e.pounceAng) * 330;
            run.shake = Math.max(run.shake, 3);
            HS.Audio.zap();
          }
        } else if (e.pounceState === 2) {
          e.pounceT -= dt;
          /* 前方是实心障碍就提前收势，不然会一帧扎进墙里 */
          if (HS.World.insideSolid(e.x + e.pvx * dt * 3, e.y + e.pvy * dt * 3)) {
            e.pounceT = 0;
          }
          e.x += e.pvx * dt;
          e.y += e.pvy * dt;
          /* 撕开空气的拖尾 */
          run.fx.push({
            kind: 'p', x: e.x, y: e.y,
            vx: -e.pvx * 0.12 + U.rand(-14, 14), vy: -e.pvy * 0.12 + U.rand(-14, 14),
            life: 0.22, max: 0.22, color: '#565e6a', size: 2
          });
          if (e.pounceT <= 0) {
            e.pounceState = 3;
            e.pounceRec = 0.75;
            if (U.dist2(e.x, e.y, p.x, p.y) < (e.r + p.r + 4) * (e.r + p.r + 4)) {
              run.shake = Math.max(run.shake, 5);
            }
          }
        } else if (e.pounceState === 3) {
          e.pounceRec -= dt;
          if (e.pounceRec <= 0) {
            e.pounceState = 0;
            e.pounceCd = 3.2 + Math.random() * 1.8;
          }
        } else {
          e.x += ux * spd * dt;
          e.y += uy * spd * dt;
          /* 同呕酸尸：触发看"到玩家的真实距离"，不是到寻路路径点的距离 */
          var ppd = U.dist(e.x, e.y, p.x, p.y);
          if (e.pounceCd <= 0 && ppd > 34 && ppd < 200 &&
              (!p.roof && !e.roof || p.roof && e.roof === p.roof)) {
            e.pounceState = 1;
            e.pounceWind = 0.5;
            run.fx.push({
              kind: 'ring', x: e.x, y: e.y + 2, r: 3, max: 15,
              life: 0.45, maxLife: 0.45, color: '#ff5040'
            });
          }
        }
      } else if (e.def.vomit) {
        /* ---- 呕酸尸：逼近→蓄力（脚下亮预警矩形）→喷一条矩形毒液带 ----
           毒液本体是 run.pools 里的一块旋转矩形，站在里面按跳掉血。 */
        e.vomitCd -= dt;
        if (e.vomitState === 1) {
          e.vomitWind -= dt;
          e.vomitAng = Math.atan2(p.y - e.y, p.x - e.x);
          /* 酸囊充能：绿色气泡往嘴里聚 */
          if (Math.random() < 0.4) {
            run.fx.push({
              kind: 'p', x: e.x + U.rand(-9, 9), y: e.y + U.rand(-8, 2),
              vx: U.rand(-6, 6), vy: -U.rand(14, 34),
              life: 0.4, max: 0.4, color: '#9be04a', size: 2
            });
          }
          if (e.vomitWind <= 0) {
            e.vomitState = 2;
            e.sprayT = 1.5;
            var va = e.vomitAng + (Math.random() - 0.5) * 0.12;
            run.pools.push({
              spray: 1,
              x: e.x + Math.cos(va) * (e.r + 2), y: e.y + Math.sin(va) * (e.r + 2),
              ang: va, len: 124, wid: 36,
              life: 1.5, max: 1.5, dps: e.dmg * 0.9, tick: 0, dead: false
            });
            HS.Audio.zap();
          }
        } else if (e.vomitState === 2) {
          e.sprayT -= dt;
          if (e.sprayT <= 0) {
            e.vomitState = 0;
            e.vomitCd = e.def.cd + Math.random() * 1.4;
          }
        } else {
          e.x += ux * spd * dt;
          e.y += uy * spd * dt;
          /* 触发距离必须用"到玩家的真实距离"：d 是到寻路目标点的距离，
             穿门 / 绕楼时路径点就在眼前，会出现"还没接近玩家就开喷" */
          var vpd = U.dist(e.x, e.y, p.x, p.y);
          if (e.vomitCd <= 0 && vpd < e.def.range && vpd > 16 &&
              (!p.roof && !e.roof || p.roof && e.roof === p.roof)) {
            e.vomitState = 1;
            e.vomitWind = 0.7;
          }
        }
      } else if (e.def.submerge) {
        /* ---- 水鬼：潜渡 ----
           0 追（和普通丧尸一样绕深水）→ 1 下潜（0.45s 冒泡，仍是活靶子）
           → 2 水下突进（无视深水、子弹打不到，水面只剩涟漪；时长按到玩家的
               实际距离给，所以它能一路潜到脚下，最长 4.5s）
           → 3 出水（溅水，贴脸浮出才咬得到）→ 冷却。
           深水对所有其他单位都是墙，只有它是近路：玩家得盯着水面的涟漪走位。 */
        e.subCd = (e.subCd === undefined ? 2.4 + Math.random() * 2 : e.subCd) - dt;
        var dpd = U.dist(e.x, e.y, p.x, p.y);

        if (e.subState === 1) {
          e.subT -= dt;
          if (Math.random() < 0.5) {
            run.fx.push({
              kind: 'p', x: e.x + U.rand(-6, 6), y: e.y + U.rand(-4, 4),
              vx: U.rand(-8, 8), vy: -U.rand(10, 26),
              life: 0.4, max: 0.4, color: '#9fc6bb', size: 1.6
            });
          }
          if (e.subT <= 0) {
            e.subState = 2;
            /* 潜行时长按**这段距离**给，不再是固定 1.5 秒。
               1.5 秒只能游 34×1.75×1.5 ≈ 89px，可它从 250px 外就会起潜 ——
               于是经常"潜到一半自己浮上来"，在半路上白白挨打，
               玩家看到的就是"水鬼技能够不着人"。现在算到能贴到脚下为止，
               上限 4.5 秒（防止玩家一路跑、它一直在水下追着不露头）。 */
            var subSpd0 = e.speed * 1.75;
            /* ×1.3 是转向损耗的余量：它一边游一边修正朝向（2.2 rad/s），
               实际走过的路比直线长，不留余量就会差最后十几像素 */
            var needT = (U.dist(e.x, e.y, p.x, p.y) - 12) / subSpd0 * 1.3;
            e.subT = Math.min(4.8, Math.max(1.8, needT));
            e.submerged = true;
            e.subAng = Math.atan2(p.y - e.y, p.x - e.x);
            HS.Audio.splash(false);
            run.fx.push({
              kind: 'ring', x: e.x, y: e.y + 2, r: 2, max: 16,
              life: 0.5, maxLife: 0.5, color: '#a8e0d8'
            });
          }
        } else if (e.subState === 2) {
          e.subT -= dt;
          var subWant = Math.atan2(p.y - e.y, p.x - e.x);
          var subDa = subWant - e.subAng;
          while (subDa > Math.PI) subDa -= U.TAU;
          while (subDa < -Math.PI) subDa += U.TAU;
          e.subAng += Math.max(-2.2 * dt, Math.min(2.2 * dt, subDa));
          var subSpd = e.speed * 1.75;
          e.x += Math.cos(e.subAng) * subSpd * dt;
          e.y += Math.sin(e.subAng) * subSpd * dt;
          /* 涟漪是它唯一的破绽：一路拖过去，看得懂就知道该往哪躲 */
          if (Math.random() < 0.6) {
            run.fx.push({
              kind: 'ring', x: e.x + U.rand(-3, 3), y: e.y + U.rand(-2, 2),
              r: 1, max: 9, life: 0.5, maxLife: 0.5, color: '#8fc4b8'
            });
          }
          /* 出水阈值必须**小于咬击阈值**（e.r + p.r + 8 = 18.5），否则会出现
             "贴脸浮出却咬空"：以前这里是 20，判定咬击时 dpd 已经落在 20~22，
             差 1.5px 就吃不到那一口 —— 它辛苦潜到脚下，玩家只看到它冒个头。 */
          if (e.subT <= 0 || dpd < 18) {
            e.subState = 3; e.subT = 0.3; e.submerged = false;
            /* 出水保护：从浮出到落地这一拍打不中（见 hurtEnemy）。
               必须在 e.submerged = false 之后给 —— 先能被打，再给保护，
               否则会出现"浮出来了却还按水下无敌算"的怪现象。 */
            e.emergeGuard = e.def.emergeGuard || 0.35;
            HS.Audio.splash(true);
            for (var sw = 0; sw < 6; sw++) {
              run.fx.push({
                kind: 'p', x: e.x, y: e.y,
                vx: U.rand(-46, 46), vy: U.rand(-58, -8),
                life: 0.34, max: 0.34, color: sw % 2 ? '#9ecfc4' : '#6f9b93', size: 2
              });
            }
            /* 出水一口：贴脸浮出才咬得到，站着不动才会被偷袭 */
            if (dpd < e.r + p.r + 8 && !p.roof && !e.roof) {
              this.damagePlayer(e.dmg);
              /* 咬中之后不松口：把玩家往最近的深水拖（见 Game.dragToWater）。
                 伤害压得低，它靠的是"把你拖进慢速区"而不是一口咬死。 */
              this.dragToWater(e);
            }
          }
        } else if (e.subState === 3) {
          e.subT -= dt;
          if (e.subT <= 0) { e.subState = 0; e.subCd = e.def.subCd + Math.random() * 2.2; }
        } else {
          e.x += ux * spd * dt;
          e.y += uy * spd * dt;
          if (e.subCd <= 0 && dpd > 44 && dpd < 250 && !p.roof && !e.roof &&
              HS.Water && HS.Water.zone(e.x, e.y, run) > 0) {
            e.subState = 1;
            e.subT = 0.45;
          }
        }
      } else if (e.def.wobble) {
        var wob = Math.sin(run.t * 4 + e.seed) * 0.55;
        var ang2 = Math.atan2(dy, dx) + wob;
        e.x += Math.cos(ang2) * spd * dt;
        e.y += Math.sin(ang2) * spd * dt;
      } else {
        e.x += ux * spd * dt;
        e.y += uy * spd * dt;
      }

      /* 障碍物：杂兵贴着绕，Boss 直接撞碎；楼顶丧尸只受女儿墙约束 */
      if (e.boss) {
        HS.World.smash(e.x, e.y, e.r * 1.1, this);
      } else if (e.roof) {
        HS.Buildings.resolveRoof(e, e.roof);
      } else {
        var mdx = e.x - px0, mdy = e.y - py0;
        HS.World.resolve(e, e.r * 0.4, px0, py0);
        slideFix(e, px0, py0, mdx, mdy);
        HS.Water.resolve(e, e.r * 0.4, px0, py0, run);
      }

      /* 相互挤开，避免叠成一条线 */
      if (!e.boss) {
        var cx = Math.floor(e.x / 26), cy = Math.floor(e.y / 26);
        for (var gx = cx - 1; gx <= cx + 1; gx++) {
          for (var gy = cy - 1; gy <= cy + 1; gy++) {
            var cell = grid.map[grid.key(gx, gy)];
            if (!cell) continue;
            for (var ci = 0; ci < cell.length; ci++) {
              var o = cell[ci];
              if (o === e || o.dead) continue;
              /* 楼上楼下不是同一层，不互相挤 */
              if ((o.roof || null) !== (e.roof || null)) continue;
              var ox = e.x - o.x, oy = e.y - o.y;
              var od2 = ox * ox + oy * oy;
              var min = (e.r + o.r) * 0.92;
              if (od2 > 0.0001 && od2 < min * min) {
                var od = Math.sqrt(od2);
                var push = (min - od) / min * 46 * dt;
                e.x += (ox / od) * push;
                e.y += (oy / od) * push;
              }
            }
          }
        }
      }

      /* ---- 步态强度：只看"这一帧真的挪了多少" ----
         被墙顶死、被同伴挤住、站在玩家面前啃人时，gait 会掉下来，
         腿就自然不再空踩 —— 不会出现原地跑步的滑稽感。
         lean 用位移方向算，让身体朝着实际前进方向倾斜。 */
      var mvx = e.x - px0, mvy = e.y - py0;
      var want = spd * dt;
      var ratio = want > 0.00001 ? Math.sqrt(mvx * mvx + mvy * mvy) / want : 0;
      if (ratio > 1) ratio = 1;
      e.gait += (ratio - e.gait) * Math.min(1, dt * 12);
      var lt = want > 0.00001 ? mvx / want : 0;
      if (lt > 1) lt = 1; else if (lt < -1) lt = -1;
      e.lean += (lt * 0.9 - e.lean) * Math.min(1, dt * 8);

      /* 被顶住的时间：绕行 / 切向脱困都靠它决定要不要介入。
         注意两点：远程兵站着不动是"正常"；已经贴到玩家脸上啃人时也不算卡住
         （接触击退会把位移抵消掉，误判成卡住会让它绕着玩家打转）。
         扑袭者蓄力 / 踉跄、呕酸尸蓄力 / 喷吐时站着不动是动作的一部分，
         不能被当成"卡住"拉去脱困。 */
      var acting = (e.def.pounce && e.pounceState) || (e.def.vomit && e.vomitState) ||
        (e.def.submerge && e.subState);
      if (!e.boss && !e.def.ranged && !acting) {
        if (ratio < 0.45 && U.dist(e.x, e.y, p.x, p.y) > 26) {
          e.blockT += dt;
        } else {
          e.blockT -= dt * 1.5;
          if (e.blockT < 0) e.blockT = 0;
        }
      }
      /* 死胡同看门狗：车堆用几块旋转矩形拼出来，难免夹出比身体还窄的口袋。
         局部寻路对"进去了才发现封死"的坑无解，所以给它一条和楼顶一样的出路：
         卡够 2.5 秒就挪到附近最近的一块空地（约 22~46px）。
         只在离玩家较远时做，玩家看不见"瞬移"，只会看到它从车堆另一头钻出来。 */
      if (e.uT > 0) e.uT -= dt;
      if (!e.boss && !e.roof && !e.def.ranged) {
        var pdNow = U.dist(e.x, e.y, p.x, p.y);
        if (e.blockT > 2.5 && e.navT <= 0 && pdNow > 70) {
          unstick(e, p, run);
        } else if (pdNow > 70) {
          /* 第二种卡法：一直在动（被同伴挤得左右晃），但**离玩家越来越远**。
             只在"看不见玩家"（中间挡着东西）时才判，否则玩家自己跑远了也会被误伤 */
          if (e.progBest === undefined || pdNow < e.progBest - 8) {
            e.progBest = pdNow; e.progT = 0;
          } else {
            e.progT = (e.progT || 0) + dt;
            if (e.progT > 4 && segBlocked(e.x, e.y, p.x, p.y)) {
              e.progT = 0;
              unstick(e, p, run);
            }
          }
        } else {
          e.progBest = undefined; e.progT = 0;
        }
      }


      /* 接触伤害：只有同一层才能碰到（地面 vs 楼顶互不影响） */
      var sameLevel = (!pRoof && !e.roof) || (pRoof && e.roof === pRoof);
      var airborne = e.def.bossType === 'axeboss' && e.aSt === 3;
      /* 潜渡中的水鬼在水面以下：既碰不到玩家，也啃不到车 */
      if (sameLevel && !airborne && !e.submerged) {
        var touching;
        if (p.veh) {
          /* 车是长条：按到车身的距离算。车尾被啃也算啃车，
             不能只认车中心那一个小圆 */
          HS.Vehicle.bodyNear(p.veh, e.x, e.y, _bodyOut);
          touching = _bodyOut.d < p.veh.def.w * 0.5 + e.r + 2;
        } else {
          var rr = e.r + p.r + 1;
          touching = U.dist2(e.x, e.y, p.x, p.y) < rr * rr;
        }
        if (touching) {
          if (p.veh) {
            /* 车体被啃：按秒磨耐久，人被铁皮挡着不掉血 */
            HS.Vehicle.chew(run, e, dt);
            if (!e.boss) {
              e.x += ux * 2.5;
              e.y += uy * 2.5;
            }
          } else {
            if (p.invuln <= 0) {
              // 轻推一下即可，推太远会形成一圈"力场"
              var kb = e.boss ? 0 : 4;
              e.x += ux * kb;
              e.y += uy * kb;
            }
            this.damagePlayer(e.dmg);
          }
        }
      }

      /* 画面外卡死的杂兵直接回收（世界 320x180，280px 一定在画外），留着只会白占刷怪预算
         （楼体缝隙、被道具夹住的窄缝都归这里兜底）。每秒半次判定，几乎零成本。 */
      if (!e.boss) {
        e.farT = (e.farT || 0) + dt;
        if (e.farT >= 1.5) {
          if (U.dist2(e.x, e.y, p.x, p.y) > 280 * 280) {
            var fmx = e.x - (e.farX === undefined ? e.x : e.farX);
            var fmy = e.y - (e.farY === undefined ? e.y : e.farY);
            if (e.farX !== undefined && fmx * fmx + fmy * fmy < 64) e.dead = true;
          }
          e.farX = e.x; e.farY = e.y; e.farT = 0;
        }
      }
    }

    U.compact(list, 'dead');
  };

  /* ================= 拾取 / 掉落 ================= */

  Game.updatePickups = function (dt) {
    var run = this.run, p = run.p;
    var i, g;

    for (i = 0; i < run.gems.length; i++) {
      g = run.gems[i];
      if (g.dead) continue;
      g.t += dt * 3;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.vx *= 0.92;
      g.vy *= 0.92;

      var d = U.dist(g.x, g.y, p.x, p.y);

      /* 只有进入磁石半径才会被吸走：范围外的经验必须自己走过去捡 */
      if (d < p.magnet) {
        var pull = 90 + (1 - d / p.magnet) * 260;
        g.x += (p.x - g.x) / (d || 1) * pull * dt;
        g.y += (p.y - g.y) / (d || 1) * pull * dt;
      }
      if (d < 9) {
        g.dead = true;
        this.gainXp(g.xp);
        HS.Audio.pickup();
      }
    }
    U.compact(run.gems, 'dead');

    for (i = 0; i < run.drops.length; i++) {
      var dr = run.drops[i];
      if (dr.dead) continue;
      dr.bob += dt * 3;
      dr.life -= dt;
      if (dr.hintT > 0) dr.hintT -= dt;
      if (dr.life <= 0) { dr.dead = true; continue; }
      if (U.dist(dr.x, dr.y, p.x, p.y) < 12) {
        dr.dead = true;
        this.pickDrop(dr);
      }
    }
    U.compact(run.drops, 'dead');
  };

  Game.pickDrop = function (dr) {
    var run = this.run, p = run.p;
    if (dr.kind === 'heart') {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.28);
      this.bannerShow('生命 +28%', 1.4);
      HS.Audio.pickup();
    } else if (dr.kind === 'gold') {
      run.gold += dr.amount || 3;
      this.bannerShow('废料金币 +' + (dr.amount || 3), 1.2);
      HS.Audio.pickup();
    } else if (dr.kind === 'chest') {
      var cards = this.lootCards();
      /* 空投箱里翻到的卡也先问一句（和搜刮同一个弹窗），玩家点头才生效 */
      if (!this.giveLoot(cards[0], '空投')) HS.Audio.win();
    }
  };

  /* ================= 特效 ================= */

  Game.updateFx = function (dt) {
    var run = this.run, i, f;

    for (i = 0; i < run.fx.length; i++) {
      f = run.fx[i];
      f.life -= dt;
      if (f.life <= 0) { f.dead = true; continue; }
      if (f.kind === 'p') {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 120 * dt;
      } else if (f.kind === 'ring') {
        f.r = f.max * (1 - f.life / f.maxLife);
      }
    }
    U.compact(run.fx, 'dead');

    for (i = 0; i < run.texts.length; i++) {
      var t = run.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 0.94;
      if (t.life <= 0) t.dead = true;
    }
    U.compact(run.texts, 'dead');

    for (i = 0; i < run.decals.length; i++) {
      var dc = run.decals[i];
      dc.life -= dt;
      dc.a = 0.45 * (dc.life / dc.max);
      if (dc.life <= 0) dc.dead = true;
    }
    U.compact(run.decals, 'dead');

    for (i = 0; i < run.chains.length; i++) {
      var ch = run.chains[i];
      ch.life -= dt;
      if (ch.life <= 0) ch.dead = true;
    }
    U.compact(run.chains, 'dead');

    /* 燃烧地面 + 呕酸尸的矩形毒液带 */
    for (i = 0; i < run.pools.length; i++) {
      var pool = run.pools[i];
      pool.life -= dt;
      if (pool.life <= 0) { pool.dead = true; continue; }

      /* 毒液带：以喷口为原点、向前延伸的旋转矩形，玩家在矩形内按跳掉血。
         判定是"向前 0~len"（和视觉粒子一致），不是以喷口为中心的对称矩形 ——
         否则站在 80px 外的玩家看得见毒液却不掉血。
         呕酸尸是地面单位，玩家上楼顶就泼不到 —— 那是真·安全位 */
      if (pool.spray) {
        var vp = run.p;
        pool.tick += dt;
        if (pool.tick >= 0.25) {
          pool.tick -= 0.25;
          var pca = Math.cos(-pool.ang), psa = Math.sin(-pool.ang);
          var prx = vp.x - pool.x, pry = vp.y - pool.y;
          var plx = prx * pca - pry * psa, ply = prx * psa + pry * pca;
          if (!vp.roof &&
              plx > -vp.r && plx < pool.len + vp.r &&
              Math.abs(ply) < pool.wid * 0.5 + vp.r) {
            this.damagePlayer(pool.dps * 0.25);
          }
        }
        if (Math.random() < 0.75) {
          var pd2 = U.rand(6, pool.len * 0.95);
          var pw2 = U.rand(-pool.wid, pool.wid) * 0.5;
          run.fx.push({
            kind: 'p',
            x: pool.x + Math.cos(pool.ang) * pd2 - Math.sin(pool.ang) * pw2,
            y: pool.y + Math.sin(pool.ang) * pd2 + Math.cos(pool.ang) * pw2,
            vx: U.rand(-10, 10), vy: U.rand(-26, -8),
            life: 0.4, max: 0.4,
            color: Math.random() < 0.5 ? '#9be04a' : '#c8f57a', size: 1.8
          });
        }
        continue;
      }

      pool.tick += dt;
      if (pool.tick >= 0.25) {
        pool.tick -= 0.25;
        for (var j = 0; j < run.enemies.length; j++) {
          var e = run.enemies[j];
          /* 地面火池 / 毒雾池同样摸不到水面以下的水鬼。
             （爆炸不算池子，那条路径会先把它震出水面） */
          if (e.dead || e.submerged) continue;
          if (U.dist2(e.x, e.y, pool.x, pool.y) < (pool.r + e.r) * (pool.r + e.r)) {
            /* tag 跟着池子走：火焰用 fire，钻核（便携钻头进化）用 melee */
            if (pool.dps > 0) this.hurtEnemy(e, pool.dps * 0.25, { silent: true, tag: pool.tag || 'fire', dot: 1, ignoreArmor: 1 });
            /* 站在火海里就会被点着 —— 走开以后还要烧一小段。
               以前只有"池内按 tick 扣血"，离开火池火就凭空灭了，
               燃烧瓶看着像一摊会掉血的油漆，而不是火。 */
            if (pool.fire) this.ignite(e, pool.dps * 1.1, 1.8);
            if (pool.slow) {
              e.slow = Math.max(e.slow || 0, Math.min(0.8, pool.slow));
              e.slowT = Math.max(e.slowT || 0, 0.6);
            }
          }
        }
        if (Math.random() < 0.4 && !pool.core) {
          run.fx.push({
            kind: 'p', x: pool.x + U.rand(-pool.r, pool.r) * 0.7,
            y: pool.y + U.rand(-pool.r, pool.r) * 0.7,
            vx: U.rand(-8, 8), vy: U.rand(-30, -12),
            life: 0.4, max: 0.4, color: Math.random() < 0.5 ? '#ff8b3d' : '#ffd166', size: 1.6
          });
        }
        /* 钻核：不吃火苗，改甩钢灰色的碎屑 */
        if (pool.core && run.fx.length < 200) {
          var ca2 = Math.random() * U.TAU;
          run.fx.push({
            kind: 'p', x: pool.x + U.rand(-pool.r, pool.r) * 0.7,
            y: pool.y + U.rand(-pool.r, pool.r) * 0.7,
            vx: Math.cos(ca2) * U.rand(20, 60), vy: Math.sin(ca2) * U.rand(20, 60) - 14,
            life: 0.22, max: 0.22, color: Math.random() < 0.5 ? '#e6edf5' : '#9aa6b4', size: 1.4
          });
        }
      }
    }
    U.compact(run.pools, 'dead');
  };
})();
