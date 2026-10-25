/**
 * 载具系统：生成 / 上下车 / 驾驶物理 / 碾压 / 磨损 / 报废
 *
 * 设计取舍：
 *   - 载具不是"第二套武器"，而是**一次性的机动护盾**。上车后所有武器停火，
 *     换来高速位移 + 碾压伤害 + 一层会消耗的耐久。
 *   - 耐久是唯一的资源：撞墙撞车按道具硬度扣，撞丧尸按体型扣，被啃按秒扣。
 *     所以开车不是"无脑冲"，而是要在"撞得爽"和"还能开多久"之间取舍。
 *   - 载具数量很少（每个区块 3.5% 概率），但下车后仍然留在原地，可以回来接着开。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;
  var P = HS.P;
  var D = HS.Data;

  var CELL = 192;      // 与 obstacles.js 的区块一致
  var BLOCK = 384;     // 街区周期
  var ROAD = 88;       // 车行道宽

  var V = {};

  var propsBuf = [];
  var syncT = 0;
  V._run = null;

  /* 车身扫地时置 >0：这期间"自己开的那辆"不参与碰撞，
     否则探针圆会被车体本身顶出去，车就永远动不了。 */
  var sweepGuard = 0;

  /* 车身三段的采样位置（相对半长，正 = 车头方向）。
     两端放在胶囊端点上、半径取 w/2，这样"碰撞范围"正好等于画出来的车壳：
     采样点往内缩会让车头埋进墙里，半径取小了车会停在离墙一大截的地方。 */
  var BODY_SAMPLES = [1, 0, -1];
  var _sweep = { x: 0, y: 0 };
  var _near = { x: 0, y: 0, d: 0 };

  function mod(v, m) {
    var r = v % m;
    return r < 0 ? r + m : r;
  }

  /* ---------------- 生成 ---------------- */

  /** 车体四角 + 中心都不能压到实心物（建筑 / 家具 / 废车 / 隔离墩） */
  function clearAt(x, y, w, h) {
    var hw = w * 0.5, hh = h * 0.5;
    if (HS.World.insideSolid(x, y)) return false;
    if (HS.World.insideSolid(x - hw, y - hh)) return false;
    if (HS.World.insideSolid(x + hw, y - hh)) return false;
    if (HS.World.insideSolid(x - hw, y + hh)) return false;
    if (HS.World.insideSolid(x + hw, y + hh)) return false;
    if (HS.Buildings.insideOf(x, y)) return false;
    if (HS.Buildings.doorBlocked(x, y, w + 10, h + 10)) return false;
    return true;
  }

  function pickDef(seed) {
    var spawn = D.vehicleSpawn;
    return U.hash(seed, 7, 4831) < (spawn.pickupChance || 0.42)
      ? D.vehicles.pickup : D.vehicles.sedan;
  }

  /**
   * 在 (x,y) 放一辆车。vertical 表示车头朝北/南（沿纵向车道停放）。
   * 返回实例，放不下就返回 null。
   */
  V.spawn = function (run, x, y, vertical, def) {
    if (!run || run.vehicles.length >= (D.vehicleSpawn.max || 24)) return null;
    def = def || pickDef(x + y);

    /* 停车角度不能像停车场：八成顺着路边但歪十几度，两成是被人弃车时甩歪的 */
    var coin = U.hash(x * 3 + 11, y * 7 + 5, 4837);
    var base = vertical
      ? (coin < 0.5 ? -Math.PI / 2 : Math.PI / 2)
      : (coin < 0.5 ? Math.PI : 0);
    var tilt = (U.hash(x * 5 + 3, y * 11 + 7, 4841) - 0.5) * 0.62;   // ±18°
    if (U.hash(x * 7 + 1, y * 3 + 13, 4843) < 0.2) {
      /* 弃车：彻底歪着，像是急刹之后被丢下的 */
      tilt += (U.hash(x * 13 + 5, y * 17 + 3, 4849) - 0.5) * 1.15;
    }
    var heading = base + tilt;

    /* 斜停的车占地按旋转后的投影算 */
    var ac = Math.abs(Math.cos(heading)), as = Math.abs(Math.sin(heading));
    var w = ac * def.h + as * def.w;
    var h = as * def.h + ac * def.w;

    /* 别和已有载具叠在一起（含残骸） */
    for (var i = 0; i < run.vehicles.length; i++) {
      var o = run.vehicles[i];
      if (U.dist2(o.x, o.y, x, y) < 46 * 46) return null;
    }
    if (!clearAt(x, y, w, h)) return null;
    if (HS.Water && !HS.Water.canPlace(x, y, w, h, run)) return null;

    var v = {
      isVeh: true, def: def, id: def.id,
      x: x, y: y, w: w, h: h, r: def.r,
      dur: def.maxDur, maxDur: def.maxDur,
      speed: 0, heading: heading,
      /* 战损斑点的随机种子：同一辆车永远是同一张"脸" */
      seed: Math.floor(U.hash(x * 13 + 7, y * 11 + 3, 4903) * 99991),
      ramCd: 0, flash: 0, smokeT: 0,
      /* 撞击接触锁：顶着墙不放只算一次撞击，不会把车"磨"死在墙边 */
      touching: false, touchT: 0, stunT: 0,
      wreck: false, wreckT: 0, by: y + h / 2
    };
    run.vehicles.push(v);
    return v;
  };

  /** 荒漠公路：只有一条纵向的车道，车一律停在路面上 */
  function onDesert() {
    return !!(V._run && V._run.map && (V._run.map.theme === 'desert' || V._run.map.theme === 'flood'));
  }

  /** 车道中心：把随机点吸附到最近的车道带里，避免车停在街区空地上 */
  function snapToRoad(x, y, vertical) {
    if (onDesert()) {
      var lane0 = (U.hash(x, y, 4833) - 0.5) * ROAD * 0.6;
      return { x: lane0, y: y };
    }
    if (vertical) {
      var bx = Math.floor(x / BLOCK) * BLOCK;
      var lane = ROAD * 0.5 + (U.hash(x, y, 4833) - 0.5) * ROAD * 0.62;
      return { x: bx + lane, y: y };
    }
    var by = Math.floor(y / BLOCK) * BLOCK;
    var lane2 = ROAD * 0.5 + (U.hash(x, y, 4833) - 0.5) * ROAD * 0.42;
    return { x: x, y: by + lane2 };
  }

  /** 按区块补齐附近的车（每 0.25s 扫一次，成本可忽略） */
  V.sync = function (run, dt) {
    syncT -= dt;
    if (syncT > 0) return;
    syncT = 0.25;

    var p = run.p;
    var cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    var rate = D.vehicleSpawn.rate || 0.035;
    if (D.vehicleSpawn.mapRate && D.vehicleSpawn.mapRate[run.map.id] !== undefined) {
      rate = D.vehicleSpawn.mapRate[run.map.id];
    }

    for (var gx = cx - 1; gx <= cx + 1; gx++) {
      for (var gy = cy - 1; gy <= cy + 1; gy++) {
        var k = gx + ',' + gy;
        if (run.vehSeen[k]) continue;
        run.vehSeen[k] = 1;
        if (U.hash(gx, gy, 4813) > rate) continue;

        var ox = gx * CELL + 20 + U.hash(gx, gy, 4817) * (CELL - 40);
        var oy = gy * CELL + 20 + U.hash(gx, gy, 4819) * (CELL - 40);
        /* 出生点空地留给新手车 */
        if (Math.abs(ox) < 120 && Math.abs(oy) < 120) continue;

        var vertical = onDesert() ? true : (U.hash(gx, gy, 4823) < 0.5);
        var sp = snapToRoad(ox, oy, vertical);
        V.spawn(run, sp.x, sp.y, vertical);
      }
    }
  };

  /** 开局在出生点旁边摆一辆，保证第一次上路就能摸到方向盘 */
  V.onStart = function (run) {
    V._run = run;
    run.vehicles.length = 0;
    run.vehSeen = {};
    run.vehDestroyed = 0;
    run.nearVeh = null;
    run.vehHint = false;
    if (D.vehicleSpawn.starter === false) return;

    var p = run.p;
    var tries = [
      { x: p.x + 76, y: p.y, v: false },
      { x: p.x - 84, y: p.y, v: false },
      { x: p.x, y: p.y - 88, v: true },
      { x: p.x, y: p.y + 92, v: true },
      { x: p.x, y: p.y - 136, v: true },
      { x: p.x, y: p.y + 140, v: true },
      { x: p.x + 46, y: p.y + 54, v: false },
      { x: p.x - 52, y: p.y - 58, v: false }
    ];
    for (var i = 0; i < tries.length; i++) {
      var sp = snapToRoad(tries[i].x, tries[i].y, tries[i].v);
      if (V.spawn(run, sp.x, sp.y, tries[i].v, D.vehicles.sedan)) return;
    }
  };

  /* ---------------- 查询 ---------------- */

  V.nearest = function (run, x, y, maxD) {
    var list = run.vehicles;
    var best = null, bd = maxD * maxD;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v.wreck) continue;
      var d2 = U.dist2(v.x, v.y, x, y);
      if (d2 < bd) { bd = d2; best = v; }
    }
    return best;
  };

  /**
   * 车体的轴对齐包围盒。
   * 车可以歪着停，所以不能只按 90° 切换 w/h，得按旋转后的真实投影算，
   * 否则斜停的车会出现"人从车角穿过去"和深度排序错位。
   */
  V.setExtent = function (v) {
    var c = Math.abs(Math.cos(v.heading));
    var s = Math.abs(Math.sin(v.heading));
    v.w = c * v.def.h + s * v.def.w;
    v.h = s * v.def.h + c * v.def.w;
    v.by = v.y + v.h / 2;
  };

  /** 玩家在车里时，替身的碰撞半径应该是车体而不是人 */
  V.bodyR = function (p) {
    return p.veh ? p.veh.def.r : p.r;
  };

  /** 车身中心线的半长（车被当成一根胶囊，两端各是半径 w/2 的圆） */
  function bodyHalf(v) {
    var hl = (v.def.h - v.def.w) * 0.5;
    return hl > 0 ? hl : 0;
  }

  /**
   * 点到车身的最近距离。结果写进 out（out.x/out.y 是中心线上的最近点），
   * 返回距离。碾压、被啃、撞墙判定都走这个，别再拿中心点当车。
   */
  V.bodyNear = function (v, x, y, out) {
    var hl = bodyHalf(v);
    var ax = Math.cos(v.heading) * hl, ay = Math.sin(v.heading) * hl;
    var ex = x - v.x, ey = y - v.y;
    var t = hl > 0.001 ? (ex * ax + ey * ay) / (hl * hl) : 0;
    if (t > 1) t = 1; else if (t < -1) t = -1;
    var nx = v.x + ax * t, ny = v.y + ay * t;
    out.x = nx;
    out.y = ny;
    out.d = Math.sqrt((x - nx) * (x - nx) + (y - ny) * (y - ny));
    return out.d;
  };

  /**
   * 车身扫地：沿车头 → 车尾布三个采样圆，逐个把车从障碍里推出来。
   * 原来只拿一个 r=9 的圆撞墙，车头会先埋进墙里十来个像素才"发现"撞了；
   * 车头 / 车尾各加一个圆之后，接触点是真实的保险杠位置。
   */
  function resolveBody(v, p) {
    var hl = bodyHalf(v);
    var rad = v.def.w * 0.5;
    var c = Math.cos(v.heading), s = Math.sin(v.heading);
    sweepGuard++;
    for (var i = 0; i < BODY_SAMPLES.length; i++) {
      var ox = c * hl * BODY_SAMPLES[i], oy = s * hl * BODY_SAMPLES[i];
      _sweep.x = p.x + ox;
      _sweep.y = p.y + oy;
      HS.World.resolve(_sweep, rad);
      var dx = _sweep.x - (p.x + ox), dy = _sweep.y - (p.y + oy);
      if (dx || dy) {
        p.x += dx;
        p.y += dy;
      }
    }
    sweepGuard--;
  }

  /**
   * 停着的车是实心的：由 HS.World.resolve 顺带调用。
   * 自己开着的那辆车不参与（否则会把自己顶出去）。
   */
  V.resolve = function (ent, r) {
    var run = V._run;
    if (!run || !run.vehicles.length) return;
    var list = run.vehicles;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v === ent) continue;
      /* 自己开的那辆：玩家本身和扫地探针都不参与，否则会被自己顶飞；
         但别的实体（丧尸）照样要撞在车身上，不能穿车而过 */
      if (run.p && run.p.veh === v && (sweepGuard > 0 || ent === run.p)) continue;

      /* 车是长条，而且可能斜着停：用「沿车身的胶囊」比 AABB 准得多，
         贴着车角走不会被一层看不见的方形空气墙挡住 */
      var hl = Math.max(0, (v.def.h - v.def.w) * 0.5);
      var ax = Math.cos(v.heading) * hl;
      var ay = Math.sin(v.heading) * hl;
      var ex = ent.x - v.x, ey = ent.y - v.y;
      var t = hl > 0.001 ? (ex * ax + ey * ay) / (hl * hl) : 0;
      if (t > 1) t = 1; else if (t < -1) t = -1;
      var nx = v.x + ax * t, ny = v.y + ay * t;
      var dx = ent.x - nx, dy = ent.y - ny;
      var rad = v.def.w * 0.5 + r;
      var d2 = dx * dx + dy * dy;
      if (d2 >= rad * rad) continue;

      if (d2 > 0.0001) {
        var d = Math.sqrt(d2);
        var push = (rad - d) / d;
        ent.x += dx * push;
        ent.y += dy * push;
      } else {
        var px = -Math.sin(v.heading), py = Math.cos(v.heading);
        ent.x += px * rad;
        ent.y += py * rad;
      }
    }
  };

  /* ---------------- 上下车 ---------------- */

  V.applyGear = function (p) {
    var v = p.veh;
    if (!v) return;
    var mul = p.vehDurMul || 1;
    var ratio = v.maxDur > 0 ? v.dur / v.maxDur : 1;
    v.maxDur = v.def.maxDur * mul;
    v.dur = Math.max(1, Math.min(v.maxDur, ratio * v.maxDur));
  };

  V.enter = function (run, v) {
    if (!run || !v || v.wreck) return false;
    var p = run.p;
    if (p.veh || p.roof) return false;
    if (U.dist(p.x, p.y, v.x, v.y) > 38) return false;
    if (HS.Buildings.insideOf(p.x, p.y)) return false;

    HS.Game.cancelSearch();
    p.veh = v;
    p.x = v.x;
    p.y = v.y;
    p.gait = 0;
    p.lean = 0;
    p.invuln = Math.max(p.invuln, 0.7);
    v.speed = 0;
    /* 方向盘状态复位：不清掉的话，上次下车时残留的角速度会让车一上车自己打转 */
    v.turnV = 0;
    v.mvDir = v.heading;
    v.skidT = 0;
    V.applyGear(p);
    HS.Audio.ui();
    HS.Game.bannerShow('驾驶 ' + v.def.name + ' · 武器收起，只能靠撞', 2.8);
    return true;
  };

  V.exit = function (run, silent) {
    var p = run.p;
    var v = p.veh;
    if (!v) return false;

    p.veh = null;
    v.speed = 0;
    V.setExtent(v);

    /* 优先放到车侧（避开后方，免得一下车就被自己车头挡住视线） */
    var half = v.def.w * 0.5 + 8;
    var dirs = [v.heading + Math.PI / 2, v.heading - Math.PI / 2,
      v.heading + Math.PI, v.heading];
    var placed = false;
    for (var i = 0; i < dirs.length; i++) {
      var nx = v.x + Math.cos(dirs[i]) * half;
      var ny = v.y + Math.sin(dirs[i]) * half;
      if (HS.World.insideSolid(nx, ny)) continue;
      if (HS.Buildings.insideOf(nx, ny)) continue;
      p.x = nx;
      p.y = ny;
      placed = true;
      break;
    }
    if (!placed) {
      p.x = v.x;
      p.y = v.y;
      HS.World.resolve(p, p.r);
    }

    /* 收枪一阵子，避免下车瞬间贴脸开火 */
    for (var w = 0; w < p.weapons.length; w++) {
      if (p.weapons[w].timer < 0.35) p.weapons[w].timer = 0.35;
    }
    p.invuln = Math.max(p.invuln, 0.35);
    if (!silent) HS.Audio.ui();
    return true;
  };

  /* ---------------- 磨损 / 报废 ---------------- */

  V.damage = function (run, v, amount, showText) {
    if (!v || v.wreck || amount <= 0) return;
    v.dur -= amount;
    v.flash = 1;
    if (showText && amount >= 4) {
      if (run.texts.length > 30) run.texts.shift();
      run.texts.push({
        x: v.x + U.rand(-3, 3), y: v.y - 14, vy: -26, life: 0.6, max: 0.6,
        txt: '-' + Math.round(amount), hurt: true
      });
    }
    if (v.dur <= 0) {
      v.dur = 0;
      V.wreck(run, v);
    }
  };

  /** 丧尸贴车啃咬：按秒扣耐久，玩家本人在车里不掉血 */
  V.chew = function (run, e, dt) {
    var p = run.p, v = p.veh;
    if (!v || v.wreck) return;
    var rate = e.dmg * 0.16 * (p.vehHurtCut || 1);
    V.damage(run, v, rate * dt, false);
  };

  V.wreck = function (run, v) {
    if (v.wreck) return;
    var p = run.p;
    v.wreck = true;
    v.dur = 0;
    v.speed = 0;
    v.wreckT = 0;
    v.smokeT = 0;

    /* 油箱炸开：顺带清一小圈丧尸，让"车毁"不至于变成纯粹的惩罚 */
    HS.Game.explode(v.x, v.y, 84, v.def.ramDmg * 1.15, '#ffb86b');
    run.shake = Math.max(run.shake, 12);
    for (var i = 0; i < 16; i++) {
      var a = Math.random() * U.TAU;
      var sp = U.rand(30, 150);
      run.fx.push({
        kind: 'p', x: v.x, y: v.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
        life: U.rand(0.4, 0.9), max: 0.9,
        color: i % 3 === 0 ? '#ffd166' : '#5a5a62', size: U.rand(1.5, 3)
      });
    }
    HS.Audio.boom();

    if (p.veh === v) {
      p.veh = null;
      var side = v.heading + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
      p.x = v.x + Math.cos(side) * (v.def.w * 0.5 + 10);
      p.y = v.y + Math.sin(side) * (v.def.w * 0.5 + 10);
      HS.World.resolve(p, p.r);

      var dmg = Math.max(4, p.maxHp * 0.16 * (p.ejectCut || 1));
      HS.Game.damagePlayer(dmg, { ignoreInvuln: true, ignoreVehicle: true });
      p.invuln = Math.max(p.invuln, 1.2);
      HS.Game.bannerShow('载具报废 · 你被甩了出去 -' + Math.round(dmg) + ' HP', 2.8);
      HS.Audio.hurt();
    }
    run.vehDestroyed = (run.vehDestroyed || 0) + 1;
  };

  /* ---------------- 撞击 ---------------- */

  /** 找出车头当前顶着的硬物，返回它的 crash 硬度 */
  function impactHardness(x, y, r) {
    var hardness = 5;
    var best = null;

    var cell = HS.World.CELL || 192;
    var cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    propsBuf.length = 0;
    for (var gx = cx - 1; gx <= cx + 1; gx++) {
      for (var gy = cy - 1; gy <= cy + 1; gy++) {
        var list = HS.World.chunk(gx, gy);
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (!o.solid || o.broken) continue;
          var nx = x < o.bx0 ? o.bx0 : (x > o.bx1 ? o.bx1 : x);
          var ny = y < o.by0 ? o.by0 : (y > o.by1 ? o.by1 : y);
          if (U.dist2(x, y, nx, ny) > r * r) continue;
          propsBuf.push(o);
          var c = (o.def && o.def.crash) || 6;
          if (c > hardness) { hardness = c; best = o; }
        }
      }
    }

    /* 停着的车比杂物更硬 */
    var run = V._run;
    if (run) {
      for (var vi = 0; vi < run.vehicles.length; vi++) {
        var vv = run.vehicles[vi];
        if (vv === run.p.veh) continue;
        var hw = vv.w * 0.5, hh = vv.h * 0.5;
        var nx2 = x < vv.x - hw ? vv.x - hw : (x > vv.x + hw ? vv.x + hw : x);
        var ny2 = y < vv.y - hh ? vv.y - hh : (y > vv.y + hh ? vv.y + hh : y);
        if (U.dist2(x, y, nx2, ny2) <= r * r && hardness < 12) hardness = 12;
      }
    }

    /* 墙体 / 家具 / 废墟比路边杂物更硬 */
    var wall = HS.Buildings.hitBlock(x, y, r, false);
    if (wall && hardness < 9) { hardness = 9; best = null; }

    return { hardness: hardness, obs: best };
  }

  /** 车头中心：撞墙的火花 / 硬度判定都从这里算，不是从车中心 */
  function noseX(p, v) {
    return p.x + Math.cos(v.heading) * bodyHalf(v);
  }
  function noseY(p, v) {
    return p.y + Math.sin(v.heading) * bodyHalf(v);
  }

  /**
   * 这一帧被顶住了：扣耐久、反弹、冒火花。
   */
  V.impact = function (run, v) {
    if (v.wreck) return;
    if (v.ramCd > 0 || v.touching) return;
    var p = run.p;
    v.ramCd = 0.4;
    v.touching = true;
    v.touchT = 0;
    v.stunT = 0.26;

    var hit = impactHardness(noseX(p, v), noseY(p, v), v.def.w * 0.5 + 2);
    var spdF = Math.min(1, Math.abs(v.speed) / v.def.spd);
    var loss = hit.hardness * v.def.crashMul * (0.45 + spdF * 0.7)
      * (p.vehWearCut || 1);
    V.damage(run, v, loss, true);
    var hx = noseX(p, v), hy = noseY(p, v);

    /* 纸箱之类会被直接撞碎 */
    var o = hit.obs;
    if (o && o.def && o.def.brittle) {
      o.broken = true;
      o.looted = true;
      for (var k = 0; k < 7; k++) {
        run.fx.push({
          kind: 'p', x: o.x + U.rand(-6, 6), y: o.y + U.rand(-6, 6),
          vx: U.rand(-70, 70), vy: U.rand(-60, 10),
          life: U.rand(0.25, 0.5), max: 0.5,
          color: k % 3 === 0 ? '#9a7448' : '#5a3d22', size: U.rand(1, 2)
        });
      }
    }

    /* 速度反弹：撞得越狠掉得越多，但保留一点，免得卡死在墙角 */
    v.speed *= -0.28;
    run.shake = Math.max(run.shake, 3 + spdF * 5);
    for (var i = 0; i < 6; i++) {
      run.fx.push({
        kind: 'p', x: hx + U.rand(-5, 5), y: hy - 2 + U.rand(-4, 4),
        vx: U.rand(-90, 90), vy: U.rand(-70, 20),
        life: U.rand(0.15, 0.35), max: 0.35,
        color: i % 2 === 0 ? '#ffe08a' : '#ffb86b', size: 1.4
      });
    }
    if (loss >= 6) {
      HS.Audio.boom();
      P.vibrate('medium');
    } else {
      HS.Audio.hit();
      P.vibrate('light');
    }

    /* 撞得太狠：车头冒一会儿白烟，给玩家一个"该下车了"的信号 */
    if (v.dur / v.maxDur < 0.35) {
      for (var s = 0; s < 4; s++) {
        run.fx.push({
          kind: 'p', x: p.x + U.rand(-4, 4), y: p.y - 6,
          vx: U.rand(-10, 10), vy: U.rand(-40, -16),
          life: 0.8, max: 0.8, color: 'rgba(120,120,128,0.85)', size: 2
        });
      }
    }
  };

  /* ---------------- 驾驶 ---------------- */

  V.drive = function (run, dt, ax) {
    var p = run.p, v = p.veh;
    if (!v || v.wreck) return;
    var def = v.def;
    var mag = ax.mag;
    if (v.stunT > 0) v.stunT -= dt;
    if (v.turnV === undefined) v.turnV = 0;
    if (v.mvDir === undefined) v.mvDir = v.heading;

    /* ---- 转向：摇杆方向 → 目标横摆角速度 → 实际角速度（一阶惯性）----
       以前是"按固定角速度把车头直接掰到摇杆方向"：推杆就咔地转、松手立刻停，
       像拖着一张会旋转的贴图。现在方向盘有建立时间（约 0.11s 打满舵），
       松手后车头自然回正，转弯才有重量。 */
    var steerIn = 0;
    if (mag > 0.12 && v.stunT <= 0) {
      var want = Math.atan2(ax.dy, ax.dx);
      var diff = want - v.heading;
      while (diff > Math.PI) diff -= U.TAU;
      while (diff < -Math.PI) diff += U.TAU;
      /* 速度越高越钝；摇杆只推一半 → 方向盘也只打一半 */
      var bite = Math.min(1, mag / 0.55);
      var maxRate = def.turn * (1 - 0.35 * Math.min(1, v.speed / def.spd)) * bite;
      /* 偏差大时给满舵，快对齐时自动收油 —— 否则会绕着目标角度左右摆 */
      var tgt = diff * 8;
      if (tgt > maxRate) tgt = maxRate;
      else if (tgt < -maxRate) tgt = -maxRate;
      steerIn = tgt;
    }
    v.turnV += (steerIn - v.turnV) * Math.min(1, dt * 9);
    if (Math.abs(v.turnV) < 0.002) v.turnV = 0;
    v.heading += v.turnV * dt;
    while (v.heading > Math.PI) v.heading -= U.TAU;
    while (v.heading < -Math.PI) v.heading += U.TAU;

    /* 车身朝向与行进方向分离一点点：急打方向时会先"斜着滑"过去，
       滞后约 0.07s —— 够产生车重，又不至于像冰面一样失控 */
    var mdiff = v.heading - v.mvDir;
    while (mdiff > Math.PI) mdiff -= U.TAU;
    while (mdiff < -Math.PI) mdiff += U.TAU;
    v.mvDir += mdiff * Math.min(1, dt * 14);
    while (v.mvDir > Math.PI) v.mvDir -= U.TAU;
    while (v.mvDir < -Math.PI) v.mvDir += U.TAU;

    if (mag > 0.15 && v.stunT <= 0) {
      var target = def.spd * Math.min(1, mag / 0.85) * (HS.Water ? HS.Water.speed(p, run) : 1);
      if (v.speed < target) v.speed = Math.min(target, v.speed + def.accel * dt);
      else v.speed = Math.max(target, v.speed - def.accel * 1.7 * dt);
    } else if (v.stunT <= 0) {
      /* 松油门是滑行，不是踩刹车：原来按 0.85 倍加速度掉速，
         一脚松开车就定住，和"自然"正好相反。低于 40 才收得干脆些，
         免得最后几码爬很久 */
      v.speed -= def.accel * (v.speed < 40 ? 1.1 : 0.5) * dt;
      if (v.speed < 0) v.speed = 0;
    } else {
      v.speed *= 0.82;
    }

    var px = p.x, py = p.y;
    var wantDist = v.speed * dt;
    var wasInside = !!HS.Buildings.insideOf(px, py);

    /* 深水不再是硬墙：车能直接开进去，只是速度掉到 0.32（Water.speed 里给），
       所以这里不再做"顺岸滑行"的自动避让 —— 想去水里趟就自己开进去。 */
    var moveDir = v.mvDir;
    p.x += Math.cos(moveDir) * v.speed * dt;
    p.y += Math.sin(moveDir) * v.speed * dt;
    resolveBody(v, p);

    /* 车体和玩家位置必须是同一个点：渲染 / 耐久条 / 残骸坐标全读 v.x/v.y。
       漏了这一步，车就会留在上车的原地，人自己跑掉（"载具图标不动"）。 */
    v.x = p.x;
    v.y = p.y;
    V.setExtent(v);

    /* 急转 + 有速度 = 侧滑：从外侧车轮甩出一撮灰。
       视觉上"车在抓地"全靠这层，缺了手感会像在冰上飘 */
    if (Math.abs(v.turnV) > 1.1 && v.speed > def.spd * 0.4 && run.fx.length < 220) {
      v.skidT = (v.skidT || 0) - dt;
      if (v.skidT <= 0) {
        v.skidT = 0.05;
        var sideA = v.heading + (v.turnV > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
        run.fx.push({
          kind: 'p',
          x: p.x + Math.cos(sideA) * (def.w * 0.5 + 1) + U.rand(-2, 2),
          y: p.y + Math.sin(sideA) * (def.w * 0.5 + 1) + U.rand(-2, 2),
          vx: Math.cos(sideA) * 18 + U.rand(-8, 8),
          vy: Math.sin(sideA) * 18 + U.rand(-8, 8),
          life: 0.4, max: 0.4, color: 'rgba(186,180,168,0.42)', size: 1.6
        });
      }
    }

    /* 车进不了楼：门洞只有 21px，比车宽，硬挤就当作撞墙 */
    var nowInside = HS.Buildings.insideOf(p.x, p.y);
    if (nowInside && !wasInside) {
      p.x = px;
      p.y = py;
      v.x = p.x;
      v.y = p.y;
      V.setExtent(v);
      V.impact(run, v);
    } else {
      var moved = U.dist(px, py, p.x, p.y);
      if (wantDist > 0.4 && moved < wantDist * 0.55) {
        V.impact(run, v);
      } else {
        /* 真的开起来了：解除接触锁（要连续自由行驶 0.2 秒，避免抖动着反复计费） */
        if (wantDist > 0.4 && moved >= wantDist * 0.9) {
          v.touchT += dt;
          if (v.touchT > 0.2) v.touching = false;
        }
        if (wantDist > 0.4 && moved < wantDist * 0.92) v.speed *= 0.97;
      }
    }

    if (v.ramCd > 0) v.ramCd -= dt;
    v.by = p.y + v.h / 2;

    V.ram(run, v, dt);

    /* 高速时车尾扬尘，速度感全靠这层粒子 */
    var spdF = Math.abs(v.speed) / def.spd;
    if (spdF > 0.35) {
      v.dustT = (v.dustT || 0) - dt;
      if (v.dustT <= 0) {
        v.dustT = 0.07;
        var back = v.heading + Math.PI;
        run.fx.push({
          kind: 'p',
          x: p.x + Math.cos(back) * (v.def.w * 0.5 + 2) + U.rand(-2, 2),
          y: p.y + Math.sin(back) * (v.def.w * 0.5 + 2) + U.rand(-2, 2),
          vx: Math.cos(back) * 20 + U.rand(-8, 8),
          vy: Math.sin(back) * 20 + U.rand(-8, 8),
          life: 0.4, max: 0.4,
          color: 'rgba(168,158,138,0.5)', size: 1.6
        });
      }
    }
  };

  /** 碾压：车头碰到的丧尸按速度吃伤害，同时磨损车体 */
  V.ram = function (run, v, dt) {
    var p = run.p;
    var list = run.enemies;
    /* 撞的是整个车身（胶囊），不是「车中心一个 r=12 的圆」——
       否则车头压到丧尸时还不算撞，得等它滑到车中间才掉血。 */
    var reach = v.def.w * 0.5 + 3;
    var spdF = Math.min(1, Math.abs(v.speed) / v.def.spd);
    var tMul = 1 + Math.min(run.t, 420) / 60 * 0.22;

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.roof) continue;
      if (e.ramCd > 0) continue;
      var rr = reach + e.r;
      if (V.bodyNear(v, e.x, e.y, _near) > rr) continue;

      /* 慢速贴上来只能算"蹭"，伤害很低，但依然会磨车 */
      if (spdF < 0.16) {
        e.ramCd = 0.5;
        V.damage(run, v, 0.45 * (p.vehWearCut || 1), false);
        e.x += Math.cos(v.heading) * 3;
        e.y += Math.sin(v.heading) * 3;
        continue;
      }

      var dmg = v.def.ramDmg * (0.45 + spdF * 0.9) * (p.vehRamMul || 1) * tMul;
      if (e.boss) dmg *= 0.4;
      HS.Game.hurtEnemy(e, dmg, { raw: true });
      e.ramCd = 0.26;

      var kb = e.boss ? 0 : 6 + spdF * 11;
      e.x += Math.cos(v.heading) * kb;
      e.y += Math.sin(v.heading) * kb;
      e.gait = 1;

      var wear = (e.boss ? 22 : (e.r >= 8 ? 3.6 : 1.15)) * (0.65 + spdF * 0.7)
        * (p.vehWearCut || 1);
      V.damage(run, v, wear, false);

      for (var k = 0; k < 3; k++) {
        run.fx.push({
          kind: 'p', x: e.x + U.rand(-3, 3), y: e.y + U.rand(-3, 3),
          vx: Math.cos(v.heading) * 40 + U.rand(-40, 40),
          vy: Math.sin(v.heading) * 30 + U.rand(-40, 10),
          life: U.rand(0.2, 0.45), max: 0.45,
          color: k === 0 ? '#54545c' : '#3a3a42', size: U.rand(1, 2)
        });
      }
      if (Math.random() < 0.45) HS.Audio.hit();
      if (!e.boss) run.shake = Math.max(run.shake, 1.2 + spdF * 3.2);
    }
  };

  /* ---------------- 每帧维护 ---------------- */

  V.updateWorld = function (run, dt) {
    var list = run.vehicles;
    var p = run.p;

    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v.flash > 0) v.flash = Math.max(0, v.flash - dt * 3);

      if (v.wreck) {
        v.wreckT += dt;
        v.smokeT -= dt;
        if (v.smokeT <= 0 && v.wreckT < 24) {
          v.smokeT = U.rand(0.12, 0.26);
          run.fx.push({
            kind: 'p', x: v.x + U.rand(-7, 7), y: v.y - 4 + U.rand(-6, 6),
            vx: U.rand(-10, 10), vy: U.rand(-26, -10),
            life: 1.1, max: 1.1, color: 'rgba(58,58,64,0.85)', size: U.rand(2, 3)
          });
        }
        continue;
      }

      if (v !== p.veh) {
        V.setExtent(v);
      }

      /* 低耐久冒烟：HUD 之外的第二重提示 */
      if (v.dur / v.maxDur < 0.3) {
        v.smokeT -= dt;
        if (v.smokeT <= 0) {
          v.smokeT = U.rand(0.1, 0.22);
          var front = v.heading;
          run.fx.push({
            kind: 'p',
            x: v.x + Math.cos(front) * v.def.h * 0.32,
            y: v.y + Math.sin(front) * v.def.h * 0.32 - 2,
            vx: U.rand(-8, 8), vy: U.rand(-34, -14),
            life: 0.9, max: 0.9,
            color: v.dur / v.maxDur < 0.15 ? 'rgba(30,30,34,0.9)' : 'rgba(96,96,104,0.8)',
            size: v.dur / v.maxDur < 0.15 ? 3 : 2
          });
        }
      }
    }
  };

  HS.Vehicle = V;
})();
