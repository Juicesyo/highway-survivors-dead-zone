/**
 * 锈水高速：积水地形、导电、可推挤残骸与地图事件
 * 地形按世界坐标确定性生成；动态状态只挂在当前 run 上。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;
  var Water = {};
  var CELL = 192;

  function on(run) { return !!(run && run.map && run.map.theme === 'flood'); }
  function hash(x, y, s) { return U.hash(Math.floor(x), Math.floor(y), s); }

  /* 0=干地 1=浅水 2=深水。中间桥面始终留有可通行的干/浅水带。 */
  Water.zone = function (x, y, run) {
    if (!on(run)) return 0;
    if (run.pumpT > 0 && U.dist2(x, y, run.pumpX, run.pumpY) < run.pumpR * run.pumpR) {
      return U.dist2(x, y, run.pumpX, run.pumpY) < run.pumpR * run.pumpR * 0.42 ? 0 : 1;
    }
    var hz = run.waterHazards || [];
    for (var i = 0; i < hz.length; i++) {
      var h = hz[i];
      if (h.life > 0 && U.dist2(x, y, h.x, h.y) < h.r * h.r) return 2;
    }
    var ax = Math.abs(x);
    /* 岸线按 48px 一行抖动，但**每一行都是连续的一整段**：
       深水只出现在桥面两侧，永远不会围出一块把丧尸关在里面的水塘。
       （旧版按 32px 格子随机深浅，会在侧带上围出孤岛，怪刷在上面就再也出不来。）
       越出岸线还能伸出一小截浅滩 —— 它跟岸是连着的，不会变成孤岛。 */
    var row = Math.floor(y / 48);
    var side = x > 0 ? 11 : 7;
    var edge = 68 + U.hash(side, row, 7723) * 18;
    if (ax > edge) {
      /* 浅滩伸出量也按"整行"决定：按格子随机的话，伸出来的那一格会和岸断开变孤岛 */
      if (ax - edge < 24 && U.hash(side + 40, row, 7731) < 0.5) return 1;
      return 2;
    }
    /* 桥面中间的圆形深水坑：圆盘不可能围住任何东西（绕过去就行），
       而且半径和位置都受限，永远碰不到两侧的岸，所以不会把桥面切断。
       想还原"路上一汪一汪的死水"的观感，又不能再出现封闭水塘，只能这么放。 */
    if (ax < 40) {
      var row2 = Math.floor(y / 128);
      if (U.hash(0, row2, 7741) < 0.42) {
        var py0 = row2 * 128 + 16 + U.hash(0, row2, 7743) * 96;
        var px0 = (U.hash(0, row2, 7745) < 0.5 ? -1 : 1) *
          (2 + U.hash(0, row2, 7747) * 16);
        var pr2 = 10 + U.hash(0, row2, 7749) * 6;
        if (U.dist2(x, y, px0, py0) < pr2 * pr2) return 2;
      }
    }
    var gx = Math.floor(x / 32), gy = Math.floor(y / 32);
    var n = U.hash(gx, gy, 7723);
    return n < 0.55 ? 1 : 0;
  };

  Water.speed = function (ent, run) {
    if (!on(run) || ent.roof) return 1;
    var z = Water.zone(ent.x, ent.y, run);
    if (z === 2) {
      /* 深水不是墙，是"泥沼"：能走，但慢到几乎挪不动。
         水鬼本来就在水里游，深水对它没有惩罚；Boss 太重但也拖得慢。 */
      if (ent.def && ent.def.waterborne) return 0.95;
      if (ent.boss) return 0.58;
      if (ent.veh) return 0.32;
      return ent === run.p ? 0.30 : 0.34;
    }
    if (z !== 1) return 1;
    if (ent.def && ent.def.waterborne) return 1.10;
    if (ent.veh) return 0.80;
    /* 玩家 0.76 / 普通丧尸 0.82：浅水对双方都拖速度，但水鬼反而更快。
       玩家压得太低会被疾行者贴死，整张图只剩“别下路”一个答案。 */
    return ent === run.p ? 0.76 : 0.82;
  };

  Water.free = function (x, y, run) { return Water.zone(x, y, run) !== 2; };

  /** 矩形载具/物件不要一半压在深水里（中心 + 四角 + 边中点）。 */
  Water.canPlace = function (x, y, w, h, run) {
    if (!on(run)) return true;
    var hw = w * 0.5, hh = h * 0.5;
    if (Water.zone(x, y, run) === 2) return false;
    if (Water.zone(x - hw, y - hh, run) === 2) return false;
    if (Water.zone(x + hw, y - hh, run) === 2) return false;
    if (Water.zone(x - hw, y + hh, run) === 2) return false;
    if (Water.zone(x + hw, y + hh, run) === 2) return false;
    if (Water.zone(x - hw, y, run) === 2) return false;
    if (Water.zone(x + hw, y, run) === 2) return false;
    return true;
  };

  function clearAhead(x, y, a, look, run) {
    var c = Math.cos(a), s = Math.sin(a);
    /* 第一个采样点必须贴脚（2px）：深水会形成两三像素宽的斜条，
       只按 look 等分采样会整根漏过去，看起来能走、一动就被顶回来 */
    if (!Water.free(x + c * 2, y + s * 2, run)) return false;
    if (!Water.free(x + c * 5, y + s * 5, run)) return false;
    for (var i = 1; i <= 3; i++) {
      var d = look * i / 3;
      if (d <= 5) continue;
      if (!Water.free(x + c * d, y + s * d, run)) return false;
    }
    return true;
  }

  /**
   * 朝 dir 走 look 距离会进深水时，沿水岸找一条能走的角度。
   *
   * wantDir = "想去的方向"（朝玩家）。候选角度按**朝目标的进度**打分，
   * 不再只试 ±100° 然后原样返回 —— 一进凹形水湾四周全是深水，老逻辑
   * 会让丧尸顶着水岸原地踏步（实测能卡十几秒）。现在允许一直试到接近掉头：
   * 宁可先绕出去，也别站着不动。
   */
  Water.stepDir = function (x, y, dir, look, run, side, wantDir) {
    if (!on(run)) return dir;
    var look2 = look * 2;
    if (clearAhead(x, y, dir, look, run) && clearAhead(x, y, dir, look2, run)) return dir;
    var wc = Math.cos(wantDir === undefined ? dir : wantDir);
    var ws = Math.sin(wantDir === undefined ? dir : wantDir);
    var best = null, bestScore = -1e9;
    for (var k = 1; k <= 12; k++) {
      for (var s = -1; s <= 1; s += 2) {
        var a = dir + s * k * 0.26;
        if (!clearAhead(x, y, a, look, run)) continue;
        /* 朝目标的进度（−1..1）×2；偏角越大越贵；同侧加分避免左右翻 */
        var score = (Math.cos(a) * wc + Math.sin(a) * ws) * 2 - 0.12 * k;
        if (clearAhead(x, y, a, look2, run)) score += 0.7;
        if (s === side) score += 0.4;
        if (score > bestScore) { bestScore = score; best = a; }
      }
      /* 已经找到"既安全又朝目标"的方向，不必再往大偏角找 */
      if (best !== null && bestScore > 0.8) break;
    }
    if (best === null) return dir;
    if (best > Math.PI) best -= U.TAU;
    else if (best < -Math.PI) best += U.TAU;
    return best;
  };

  /** 寻路可走：不是深水，也不在实心道具/残骸/建筑里 */
  function navFree(x, y, run) {
    if (!Water.free(x, y, run)) return false;
    return !(HS.World && HS.World.insideSolid && HS.World.insideSolid(x, y));
  }

  /** 两点之间是否全程可走。步长 4px：深水会形成很窄的斜条，
      采样太稀会漏掉，敌人走到那里就被 resolve 顶回来（实测 11px 会漏）。 */
  function lineFree(x0, y0, x1, y1, run) {
    var dx = x1 - x0, dy = y1 - y0;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) return true;
    var n = Math.ceil(d / 2);
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      if (!navFree(x0 + dx * t, y0 + dy * t, run)) return false;
    }
    return true;
  }

  /**
   * 深水绕行寻路：22px 粗网格 BFS，从玩家那端倒推。
   * 只在水里被卡住时调用（stepDir 是局部避让，绕不过整片水塘）。
   * 返回下一格中心；找不到路返回 null。
   */
  Water.route = function (ex, ey, tx, ty, run) {
    if (!on(run)) return null;
    /* 先按 ±4 格窗口找；被一圈深水挤满时窗口会不够，逐步放大到 ±14 格 */
    var pads = [4, 9, 14], out = null;
    for (var pi = 0; pi < pads.length && !out; pi++) out = attempt(pads[pi]);
    return out;

    function attempt(pad) {
      var N = 14;
      var ex0 = Math.floor(ex / N), ey0 = Math.floor(ey / N);
      var gx0 = Math.min(ex0, Math.floor(tx / N)) - pad;
      var gy0 = Math.min(ey0, Math.floor(ty / N)) - pad;
      var gx1 = Math.max(ex0, Math.floor(tx / N)) + pad;
      var gy1 = Math.max(ey0, Math.floor(ty / N)) + pad;
      var w = gx1 - gx0 + 1, h = gy1 - gy0 + 1;
      if (w * h > 5000) return null;
      var dist = [], i, k;
      for (i = 0; i < w * h; i++) dist[i] = -1;
      var gcx = Math.floor(tx / N) - gx0, gcy = Math.floor(ty / N) - gy0;
      var seeds = [], rad, dx, dy;
      for (rad = 0; rad <= 3 && !seeds.length; rad++) {
        for (dx = -rad; dx <= rad; dx++) {
          for (dy = -rad; dy <= rad; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
            var sx = gcx + dx, sy = gcy + dy;
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            if (navFree((gx0 + sx) * N + N * 0.5, (gy0 + sy) * N + N * 0.5, run)) seeds.push(sy * w + sx);
          }
        }
      }
      if (!seeds.length) return null;
      var q = seeds.slice(), qi = 0;
      for (i = 0; i < seeds.length; i++) dist[seeds[i]] = 0;
      while (qi < q.length) {
        var ci = q[qi++], cx = ci % w, cy = (ci - cx) / w, cd = dist[ci];
        for (k = 0; k < 4; k++) {
          var nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
          var ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var ni = ny * w + nx;
          if (dist[ni] >= 0) continue;
          if (!navFree((gx0 + nx) * N + N * 0.5, (gy0 + ny) * N + N * 0.5, run)) continue;
          dist[ni] = cd + 1;
          q.push(ni);
        }
      }
      /* 自己可能正踩在深水里：从身边找距离最小的格子起走 */
      var bestI = -1, bestD = 1e9;
      for (rad = 0; rad <= 2; rad++) {
        for (dx = -rad; dx <= rad; dx++) {
          for (dy = -rad; dy <= rad; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
            var ei = (ey0 + dy - gy0) * w + (ex0 + dx - gx0);
            if (ei < 0 || ei >= dist.length) continue;
            if (dist[ei] >= 0 && dist[ei] < bestD) { bestD = dist[ei]; bestI = ei; }
          }
        }
        if (bestI >= 0) break;
      }
      if (bestI < 0) return null;
      if (dist[bestI] === 0) return { x: tx, y: ty };
      /* 沿"距离递减"的链往前最多跳 4 格当前瞻点：只返回隔壁格中心的话，
         敌人会在两格边界上来回蹭（实测会左右横跳 10 秒）。
         前瞻点还要做直线检查 —— 斜着抄近道可能正好下水，那就退回上一格。 */
      var chainX = [bestI % w], chainY = [(bestI - bestI % w) / w];
      for (var hop = 0; hop < 4; hop++) {
        var hx = chainX[chainX.length - 1], hy = chainY[chainY.length - 1];
        var curD = dist[hy * w + hx];
        if (curD === 0) break;
        var fX = hx, fY = hy, fD = curD;
        for (k = 0; k < 4; k++) {
          var mx = hx + (k === 0 ? 1 : k === 1 ? -1 : 0);
          var my = hy + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
          var mi = my * w + mx;
          if (dist[mi] >= 0 && dist[mi] < fD) { fD = dist[mi]; fX = mx; fY = my; }
        }
        if (fD === curD) break;
        chainX.push(fX); chainY.push(fY);
        if (fD === 0) break;
      }
      for (var ci = chainX.length - 1; ci > 0; ci--) {
        var wx = (gx0 + chainX[ci]) * N + N * 0.5;
        var wy = (gy0 + chainY[ci]) * N + N * 0.5;
        if (lineFree(ex, ey, wx, wy, run)) return { x: wx, y: wy };
      }
      return { x: (gx0 + chainX[0]) * N + N * 0.5, y: (gy0 + chainY[0]) * N + N * 0.5 };
    }
  };

  /**
   * 深水现在是"极慢可通行"，不再是硬边界 —— 这里不再把实体顶回岸上。
   * 保留空实现只为兼容各处既有调用（World.resolve / 载具 / 刷怪）。
   */
  Water.resolve = function (ent, r, ox, oy, run) { };

  /**
   * 找一个最近的干地/浅水点（刷怪、开局出生用）。
   * 深水能走但慢到 0.3 倍，把人刷在水里等于这个刷怪名额白等半分钟。
   */
  Water.dryNear = function (x, y, run) {
    if (!on(run) || Water.zone(x, y, run) !== 2) return { x: x, y: y };
    for (var rad = 8; rad <= 120; rad += 8) {
      for (var i = 0; i < 12; i++) {
        var a = i * (U.TAU / 12) + rad * 0.37;
        var tx = x + Math.cos(a) * rad, ty = y + Math.sin(a) * rad;
        if (Water.zone(tx, ty, run) !== 2) return { x: tx, y: ty };
      }
    }
    /* 实在找不到：退回桥面中心线（岸线是逐行抖动的，那里一定有干地或浅滩） */
    return { x: 0, y: y };
  };

  /* ---------------- 半沉车辆：独立动态实体，跨区块也不会丢碰撞 ---------- */
  function syncWreck(o) {
    o.x0 = o.x - o.w / 2; o.x1 = o.x + o.w / 2;
    o.y0 = o.y - o.h / 2; o.y1 = o.y + o.h / 2;
    o.bx0 = o.x0 + 1; o.bx1 = o.x1 - 1;
    o.by0 = o.y0 + 1; o.by1 = o.y1 - 1;
    o.by = o.y1;
  }

  function makeWreck(cx, cy, run) {
    /* 残骸只堵在桥面上：cx < -1 / > 0 已经全是深水，不该再刷车。
       每列 26% + 全图最多 5 辆，保证掩体存在但不会把路变成停车场。 */
    if (cx < -1 || cx > 0) return null;
    if (run.wrecks.length >= 5 || U.hash(cx, cy, 5519) > 0.26) return null;
    var vertical = U.hash(cx, cy, 5521) < 0.72;
    var x = -68 + U.hash(cx, cy, 5527) * 136;
    var y = cy * CELL + 24 + U.hash(cx, cy, 5531) * (CELL - 48);
    if (Water.zone(x, y, run) === 2 || HS.World.insideSolid(x, y)) return null;
    for (var wi = 0; wi < run.wrecks.length; wi++) {
      if (U.dist(run.wrecks[wi].x, run.wrecks[wi].y, x, y) < 48) return null;
    }
    /* 半沉车也随机朝向：斜插在水里的车看着才像被洪水推过来的 */
    var wreckAng = U.hash(cx, cy, 5537) * U.TAU;
    var carFrames = ['car_burnt_v', 'car_blue_v', 'car_sedan_v'];
    var o = {
      floodWreck: true, type: 'sedan', x: x, y: y,
      w: 24, h: 40,
      frame: carFrames[Math.floor(U.hash(cx, cy, 5539) * carFrames.length) % carFrames.length],
      solid: true, blockBullets: true, lootable: false, looted: true,
      flip: U.hash(cx, cy, 5533) < 0.5, hp: 90, maxHp: 90,
      ang: wreckAng, hw: 11, hh: 19,
      shake: 0, broken: false
    };
    syncWreck(o);
    return o;
  }

  Water.ensure = function (run) {
    if (!on(run)) return;
    var p = run.p;
    var cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    for (var gx = cx - 2; gx <= cx + 2; gx++) {
      for (var gy = cy - 2; gy <= cy + 2; gy++) {
        var k = (gx + 4096) * 8192 + (gy + 4096);
        if (run.wreckSeen[k]) continue;
        run.wreckSeen[k] = 1;
        var o = makeWreck(gx, gy, run);
        if (o) run.wrecks.push(o);
      }
    }
    /* 只保留附近残骸，离开后重新生成为原位，避免长局无限增长。 */
    for (var i = run.wrecks.length - 1; i >= 0; i--) {
      var w = run.wrecks[i];
      if (Math.abs(w.x - p.x) > 720 || Math.abs(w.y - p.y) > 720) {
        var kk = (Math.floor(w.x / CELL) + 4096) * 8192 + (Math.floor(w.y / CELL) + 4096);
        run.wreckSeen[kk] = 0;
        run.wrecks.splice(i, 1);
      }
    }
  };

  Water.query = function (x0, y0, x1, y1, run, out) {
    if (!on(run)) return out;
    for (var i = 0; i < run.wrecks.length; i++) {
      var o = run.wrecks[i];
      if (o.x1 >= x0 && o.x0 <= x1 && o.y1 >= y0 && o.y0 <= y1) out.push(o);
    }
    return out;
  };

  /**
   * 停在路上的废弃车辆是死物：谁也推不动，只能绕或砸。
   * 掩体的价值全在"位置固定"上 —— 一旦能被顶着走，玩家就再也算不准哪块车壳能救命。
   * 想改变地形只有 Boss 的破坏（Water.breakTerrain → Water.smash）。
   */
  Water.resolveWrecks = function (ent, r, ox, oy, run) {
    if (!on(run) || ent.roof) return;
    for (var i = 0; i < run.wrecks.length; i++) {
      var o = run.wrecks[i];
      if (o.broken) continue;
      /* 残骸是旋转的：判定要和画出来的一致 */
      HS.World.pushOutRot(ent, r, o);
    }
  };

  Water.hitBlock = function (x, y, r, run) {
    if (!on(run)) return null;
    for (var i = 0; i < run.wrecks.length; i++) {
      var o = run.wrecks[i];
      if (!o.broken && HS.World.boxHit(x, y, r, o)) return o;
    }
    return null;
  };

  Water.insideSolid = function (x, y, run) { return !!Water.hitBlock(x, y, 0, run); };

  Water.smash = function (x, y, r, run, dmg) {
    if (!on(run)) return;
    for (var i = 0; i < run.wrecks.length; i++) {
      var o = run.wrecks[i];
      if (o.broken || U.dist(x, y, o.x, o.y) > r + Math.max(o.w, o.h) * 0.5) continue;
      o.hp -= dmg || 45;
      /* 砸碎就地崩解，不产生位移 —— 车壳不会被一斧子劈得滑出去半个身位 */
      o.shake = 0.25;
      if (o.hp <= 0) {
        o.broken = true; o.solid = false; o.blockBullets = false;
        for (var k = 0; k < 8; k++) run.fx.push({
          kind: 'p', x: o.x + U.rand(-o.w / 2, o.w / 2), y: o.y + U.rand(-o.h / 2, o.h / 2),
          vx: U.rand(-55, 55), vy: U.rand(-55, 20), life: 0.55, max: 0.55,
          color: k % 2 ? '#855638' : '#b27946', size: 2
        });
      }
    }
  };

  /**
   * 巨斧砸地：**不是挖出深水**，而是把地面砸烂 —— 裂纹、碎石、扬尘，
   * 通行不受影响（能砸烂的只有路上的车壳）。伤痕会留在 `run.breaks` 里慢慢淡去。
   */
  Water.breakTerrain = function (x, y, r, run) {
    if (!run) return;
    if (!run.breaks) run.breaks = [];
    /* 同一处反复砸只刷新，不叠加：一次跃劈能砸出两三个圈，全留着会糊成一片 */
    for (var i = 0; i < run.breaks.length; i++) {
      var b0 = run.breaks[i];
      if (U.dist(b0.x, b0.y, x, y) < Math.max(10, r * 0.5) && Math.abs(b0.r - r) < 8) {
        b0.life = b0.max;
        b0.r = Math.max(b0.r, r);
        Water.smash(x, y, r, run, 120);
        return;
      }
    }
    run.breaks.push({
      x: x, y: y, r: r, life: 26, max: 26,
      seed: U.hash(Math.round(x), Math.round(y), 8801)
    });
    Water.smash(x, y, r, run, 120);
    /* 扬尘：一圈碎屑往外甩，落点像被硬物砸过 */
    for (var k = 0; k < 9; k++) {
      var a = U.rand(0, U.TAU), sp = U.rand(24, 90);
      run.fx.push({
        kind: 'p', x: x + Math.cos(a) * U.rand(2, r * 0.6), y: y + Math.sin(a) * U.rand(2, r * 0.4),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - U.rand(0, 30),
        life: U.rand(0.3, 0.55), max: 0.55,
        color: k % 3 === 0 ? '#6b5a46' : (k % 3 === 1 ? '#8a7a63' : '#4a4038'), size: 2
      });
    }
  };

  /* ---------------- 导电：额外跳跃，也会反噬站在水里的玩家 ---------- */
  Water.conduct = function (source, dmg, run) {
    if (!on(run) || !source || source.dead || Water.zone(source.x, source.y, run) === 0) return;
    var used = {};
    used[source.uid] = 1;
    var pts = [{ x: source.x, y: source.y }];
    var n = 0;
    for (var i = 0; i < run.enemies.length && n < 3; i++) {
      var e = run.enemies[i];
      if (e.dead || used[e.uid] || e.roof || Water.zone(e.x, e.y, run) === 0) continue;
      if (U.dist2(e.x, e.y, source.x, source.y) > 76 * 76) continue;
      used[e.uid] = 1; n++;
      pts.push({ x: e.x, y: e.y });
      HS.Game.hurtEnemy(e, dmg * 0.32, { tag: 'energy', noCrit: true, noConduct: true, ignoreArmor: true });
    }
    if (pts.length > 1) run.chains.push({ pts: pts, life: 0.22, max: 0.22, color: '#a8f3ff' });
    var p = run.p;
    if (!p.roof && Water.zone(p.x, p.y, run) > 0 && U.dist2(p.x, p.y, source.x, source.y) < 88 * 88 && run.shockSelfT <= 0) {
      run.shockSelfT = 0.7;
      run.chains.push({ pts: [{ x: source.x, y: source.y }, { x: p.x, y: p.y }], life: 0.24, max: 0.24, color: '#fff28a' });
      HS.Game.damagePlayer(Math.max(2, dmg * 0.10), { ranged: true });
      HS.Game.bannerShow('积水导电 · 你也遭到了电击', 1.2);
    }
  };

  /* ---------------- 随机事件 ---------- */
  Water.event = function (run) {
    var p = run.p;
    if (Math.random() < 0.58) {
      run.pumpT = 18; run.pumpX = p.x; run.pumpY = p.y; run.pumpR = 112;
      for (var hi = run.waterHazards.length - 1; hi >= 0; hi--) {
        if (U.dist(run.waterHazards[hi].x, run.waterHazards[hi].y, p.x, p.y) < run.pumpR + run.waterHazards[hi].r) {
          run.waterHazards.splice(hi, 1);
        }
      }
      HS.Game.bannerShow('抽水机启动 · 周围深水暂时退去 18 秒', 3);
      HS.Audio.weapon('minigun');
    } else {
      run.safeT = 12; run.safeX = p.x; run.safeY = p.y; run.safeR = 58;
      HS.Game.bannerShow('桥下安全屋开放 · 进入光圈恢复并阻挡尸群', 3);
      HS.Audio.pickup();
    }
  };

  Water.update = function (run, dt) {
    /* 地面伤痕在所有地图都要计时（无尽模式里巨斧也会出场） */
    if (run.breaks && run.breaks.length) {
      for (var bi = run.breaks.length - 1; bi >= 0; bi--) {
        run.breaks[bi].life -= dt;
        if (run.breaks[bi].life <= 0) run.breaks.splice(bi, 1);
      }
    }
    if (!on(run)) return;
    var p = run.p, i;
    if (run.shockSelfT > 0) run.shockSelfT -= dt;
    if (run.pumpT > 0) run.pumpT -= dt;
    if (run.safeT > 0) run.safeT -= dt;
    for (i = run.waterHazards.length - 1; i >= 0; i--) {
      run.waterHazards[i].life -= dt;
      if (run.waterHazards[i].life <= 0) run.waterHazards.splice(i, 1);
    }
    Water.ensure(run);

    /* 残骸位置固定（只有 Boss 能砸碎），这里只维护受击抖动和碰撞盒同步。 */
    for (i = 0; i < run.wrecks.length; i++) {
      var o = run.wrecks[i];
      if (o.broken) continue;
      if (o.shake > 0) o.shake -= dt;
      if (o.hp <= 0) Water.smash(o.x, o.y, 1, run, 1);
    }

    /* 深水现在能走：得让玩家"感觉到"自己在蹚泥，否则只会以为角色突然卡了。
       走一步甩一圈涟漪 + 两点水花，节奏跟着步态走。 */
    p.wadeT = (p.wadeT || 0) - dt;
    if (p.gait > 0.35 && p.wadeT <= 0 && Water.zone(p.x, p.y, run) === 2) {
      p.wadeT = 0.16;
      /* 三圈同心波纹、越外越淡：读起来才像水被腿搅开 */
      var wr = [3, 7, 11], wa = [0.55, 0.34, 0.20];
      for (var wi2 = 0; wi2 < 3; wi2++) {
        run.fx.push({
          kind: 'ring', x: p.x, y: p.y + 3, r: wr[wi2], max: wr[wi2],
          life: 0.5 - wi2 * 0.08, maxLife: 0.5 - wi2 * 0.08,
          color: 'rgba(168,212,202,' + wa[wi2] + ')'
        });
      }
      for (var wi = 0; wi < 2; wi++) {
        run.fx.push({
          kind: 'p', x: p.x + U.rand(-4, 4), y: p.y + U.rand(-2, 4),
          vx: U.rand(-20, 20), vy: U.rand(-26, -6),
          life: 0.3, max: 0.3, color: '#8fb3ab', size: 1.4
        });
      }
    }

    if (run.safeT > 0) {
      if (U.dist2(p.x, p.y, run.safeX, run.safeY) < run.safeR * run.safeR) {
        p.hp = Math.min(p.maxHp, p.hp + dt * 1.2);
      }
      for (i = 0; i < run.enemies.length; i++) {
        var e = run.enemies[i];
        if (e.dead || e.boss || e.roof) continue;
        var dx = e.x - run.safeX, dy = e.y - run.safeY;
        var d2 = dx * dx + dy * dy;
        if (d2 < run.safeR * run.safeR && d2 > 0.01) {
          var d = Math.sqrt(d2), push = (run.safeR - d) * Math.min(1, dt * 9);
          e.x += dx / d * push; e.y += dy / d * push;
        }
      }
    }
  };

  Water.reset = function (run) {
    run.wrecks = []; run.wreckSeen = {}; run.waterHazards = []; run.breaks = [];
    run.pumpT = 0; run.pumpX = 0; run.pumpY = 0; run.pumpR = 112;
    run.safeT = 0; run.safeX = 0; run.safeY = 0; run.safeR = 58;
    run.shockSelfT = 0;
  };

  HS.Water = Water;
})();
