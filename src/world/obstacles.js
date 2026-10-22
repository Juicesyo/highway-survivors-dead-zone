/**
 * 世界道具 / 障碍物系统
 *
 * - 按 192x192 区块确定性生成（同一坐标永远生成同样的道具），带缓存
 * - 提供：地面分区（车道 / 人行道 / 街区）、圆形碰撞推出、子弹遮挡、就近搜刮查询
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;
  var D = HS.Data;
  var B = HS.Buildings;

  var CELL = 192;
  var BLOCK = 384;   // 街区周期
  var ROAD = 88;     // 车行道宽
  var WALK = 30;     // 人行道宽

  var cache = {};
  var count = 0;
  var theme = 'street';

  function mod(v, m) {
    var r = v % m;
    return r < 0 ? r + m : r;
  }

  function key(cx, cy) { return (cx + 8192) * 16384 + (cy + 8192); }

  /* ---------------- 地面分区 ---------------- */

  /**
   * 荒漠公路不是十字路网，而是一条笔直的公路（x 轴居中、沿 y 无限延伸）：
   *   |x| < ROAD/2 是柏油路，再往外是路肩沙地，其余都是荒野。
   * 其余主题仍是「每 BLOCK 一条横纵车道」的街区。
   */
  var DESERT_HALF = ROAD * 0.5;

  function isRoad(x, y) {
    if (theme === 'desert') return Math.abs(x) < DESERT_HALF;
    return mod(x, BLOCK) < ROAD || mod(y, BLOCK) < ROAD;
  }
  function isSidewalk(x, y) {
    if (isRoad(x, y)) return false;
    if (theme === 'desert') return Math.abs(x) < DESERT_HALF + WALK;
    return mod(x, BLOCK) < ROAD + WALK || mod(y, BLOCK) < ROAD + WALK;
  }
  /** 0=车道 1=人行道/路肩 2=街区内部 / 荒野 */
  function tileKind(x, y) {
    if (isRoad(x, y)) return 0;
    if (isSidewalk(x, y)) return 1;
    return 2;
  }

  function buildingOverlap(ox, oy, w, h) {
    var list = B.buildingsNear(ox, oy);
    for (var i = 0; i < list.length; i++) {
      var bd = list[i];
      if (ox + w / 2 + 3 > bd.x0 && ox - w / 2 - 3 < bd.x1 &&
          oy + h / 2 + 3 > bd.y0 && oy - h / 2 - 3 < bd.y1) return true;
    }
    return false;
  }

  /* ---------------- 生成 ---------------- */

  var ZONE_MUL_ROAD = { sedan: 2.2, van: 2.0, barrier: 1.4, tires: 0.8, dumpster: 0.35, crate: 0.5, cone: 1.2 };
  var ZONE_MUL_WALK = { sedan: 0.5, van: 0.6, barrier: 0.8, tires: 1.2, dumpster: 1.7, crate: 1.7, cone: 1.5 };

  function pickType(x, y, roll) {
    var road = isRoad(x, y);
    var mul = road ? ZONE_MUL_ROAD : ZONE_MUL_WALK;
    var total = 0;
    var ids = [];
    var ws = [];
    for (var id in D.props) {
      var w = (D.props[id].weight[theme] || 0) * (mul[id] || 1);
      if (w <= 0) continue;
      ids.push(id);
      ws.push(w);
      total += w;
    }
    if (total <= 0) return null;
    var r = roll * total;
    for (var i = 0; i < ids.length; i++) {
      r -= ws[i];
      if (r <= 0) return D.props[ids[i]];
    }
    return D.props[ids[ids.length - 1]];
  }

  function build(cx, cy) {
    var out = [];
    var density = D.propDensity[theme] || 0.6;
    /* 少数区块刷两个道具，摆放更松散 */
    var tries = U.hash(cx, cy, 8801) < 0.24 ? 2 : 1;

    for (var n = 0; n < tries; n++) {
    var sd = n * 977;
    if (U.hash(cx, cy, 7311 + sd) > density) continue;

    var ox = cx * CELL + 12 + U.hash(cx, cy, 101 + sd) * (CELL - 24);
    var oy = cy * CELL + 12 + U.hash(cx, cy, 211 + sd) * (CELL - 24);

    /* 出生点周围留出空地 */
    if (Math.abs(ox) < 135 && Math.abs(oy) < 135) continue;

    /* 荒漠分区：人造障碍（车壳 / 路牌 / 广告牌…）只出现在路肩附近，
       远处荒野只稀疏地长仙人掌 —— 满地垃圾车不像荒漠 */
    var def;
    if (theme === 'desert' && Math.abs(ox) - DESERT_HALF > 60) {
      /* 约 16% 的荒野区块有一株仙人掌，其余留白 */
      if (U.hash(cx, cy, 8811 + sd) > 0.16) continue;
      def = D.props.cactus;
    } else {
      def = pickType(ox, oy, U.hash(cx, cy, 307 + sd));
      if (!def) continue;
    }

    /* 朝向：七成顺着道路，三成随机；位置和方向都带镜像变化 */
    var oriented = def.vFrames[0] !== def.hFrames[0];
    var vertical;
    var mx = mod(ox, BLOCK), my = mod(oy, BLOCK);
    if (theme === 'desert') {
      /* 荒漠只有纵向一条路：车壳、路障都顺着路摆，没人会在沙地上横着停车 */
      vertical = true;
    } else if (U.hash(cx, cy, 9011 + sd) < 0.3) {
      vertical = U.hash(cx, cy, 9013 + sd) < 0.5;
    } else if (mx < ROAD) vertical = true;
    else if (my < ROAD) vertical = false;
    else vertical = U.hash(cx, cy, 401 + sd) < 0.5;

    var frames = (oriented && !vertical) ? def.hFrames : def.vFrames;
    var frame = frames[Math.floor(U.hash(cx, cy, 613 + sd) * frames.length) % frames.length];
    var w = oriented && !vertical ? def.h : def.w;
    var h = oriented && !vertical ? def.w : def.h;

    /* 别压在建筑上，也别堵住门洞 */
    if (buildingOverlap(ox, oy, w, h)) continue;
    if (B.doorBlocked(ox, oy, w, h)) continue;
    /* 别和本区块另一个道具叠在一起 */
    var clash = false;
    for (var ck = 0; ck < out.length; ck++) {
      var q = out[ck];
      if (Math.abs(q.x - ox) < (q.w + w) / 2 + 8 && Math.abs(q.y - oy) < (q.h + h) / 2 + 8) { clash = true; break; }
    }
    if (clash) continue;

    var pad = def.pad || 0;
    var cw = Math.max(4, w - pad * 2);
    var ch = Math.max(4, h - pad * 2);

    var obs = {
      type: def.id,
      def: def,
      x: ox, y: oy, w: w, h: h,
      frame: frame,
      x0: ox - w / 2, y0: oy - h / 2, x1: ox + w / 2, y1: oy + h / 2,
      bx0: ox - cw / 2, by0: oy - ch / 2, bx1: ox + cw / 2, by1: oy + ch / 2,
      solid: !!def.solid,
      blockBullets: !!def.blockBullets,
      lootable: !!(def.loot && U.hash(cx, cy, 503 + sd) < def.lootChance),
      looted: false,
      flip: U.hash(cx, cy, 701 + sd) < 0.5,
      by: oy + h / 2        // 深度排序用（底边）
    };
    out.push(obs);
    }
    return out;
  }

  function chunk(cx, cy) {
    var k = key(cx, cy);
    var c = cache[k];
    if (c) return c;
    c = build(cx, cy);
    cache[k] = c;
    count++;
    if (count > 1200) {
      cache = {};
      count = 1;
      cache[k] = c;
    }
    return c;
  }

  /* ---------------- 查询 ---------------- */

  function queryRect(x0, y0, x1, y1, out) {
    out.length = 0;
    var cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    var cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
    for (var gx = cx0; gx <= cx1; gx++) {
      for (var gy = cy0; gy <= cy1; gy++) {
        var list = chunk(gx, gy);
        for (var i = 0; i < list.length; i++) out.push(list[i]);
      }
    }
    return out;
  }

  /* ---------------- 碰撞 ---------------- */

  function pushOut(ent, r, x0, y0, x1, y1) {
    var nx = ent.x < x0 ? x0 : (ent.x > x1 ? x1 : ent.x);
    var ny = ent.y < y0 ? y0 : (ent.y > y1 ? y1 : ent.y);
    var dx = ent.x - nx, dy = ent.y - ny;
    var d2 = dx * dx + dy * dy;
    if (d2 > r * r) return false;

    if (d2 > 0.0001) {
      var d = Math.sqrt(d2);
      var push = (r - d) / d;
      ent.x += dx * push;
      ent.y += dy * push;
    } else {
      var left = ent.x - x0, right = x1 - ent.x;
      var top = ent.y - y0, bottom = y1 - ent.y;
      var m = Math.min(left, right, top, bottom);
      if (m === left) ent.x = x0 - r;
      else if (m === right) ent.x = x1 + r;
      else if (m === top) ent.y = y0 - r;
      else ent.y = y1 + r;
    }
    return true;
  }

  /** 圆形实体推出建筑墙体 / 家具，再推出实心道具（就地修改 ent） */
  function resolve(ent, r) {
    B.resolve(ent, r);
    /* 停着的载具也是实心的（自己开的那辆由载具模块内部跳过） */
    if (HS.Vehicle && HS.Vehicle.resolve) HS.Vehicle.resolve(ent, r);
    var cx = Math.floor(ent.x / CELL), cy = Math.floor(ent.y / CELL);
    for (var gx = cx - 1; gx <= cx + 1; gx++) {
      for (var gy = cy - 1; gy <= cy + 1; gy++) {
        var list = chunk(gx, gy);
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (!o.solid || o.broken) continue;
          pushOut(ent, r, o.bx0, o.by0, o.bx1, o.by1);
        }
      }
    }
  }

  /** 子弹遮挡：墙体 / 高家具 / 道具按 blockBullets 判定；门洞可以打过去 */
  function hitBlock(x, y, r, ignoreBld) {
    var bHit = B.hitBlock(x, y, r, ignoreBld);
    if (bHit) return bHit;

    var cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (var gx = cx - 1; gx <= cx + 1; gx++) {
      for (var gy = cy - 1; gy <= cy + 1; gy++) {
        var list = chunk(gx, gy);
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (!o.blockBullets || o.broken) continue;
          if (x >= o.bx0 - r && x <= o.bx1 + r && y >= o.by0 - r && y <= o.by1 + r) return o;
        }
      }
    }
    return null;
  }

  /** 点是否落在建筑 / 实心道具里（出生点纠偏用） */
  function insideSolid(x, y) {
    if (B.insideSolid(x, y)) return true;
    var list = chunk(Math.floor(x / CELL), Math.floor(y / CELL));
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o.solid || o.broken) continue;
      if (x >= o.bx0 && x <= o.bx1 && y >= o.by0 && y <= o.by1) return true;
    }
    return false;
  }

  /** 最近的可搜刮目标：楼内只搜家具，楼顶只搜屋顶物资，街道搜道具 */
  function nearLoot(x, y, maxDist, run) {
    var pf = run && run.p;
    if (pf && pf.roof) {
      return B.roofLootNear(pf.roof, x, y, maxDist);
    }
    var bld = B.insideOf(x, y);
    if (bld) {
      return B.interiorLootNear(bld, x, y, maxDist);
    }

    var best = null, bd = maxDist * maxDist;
    var cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (var gx = cx - 1; gx <= cx + 1; gx++) {
      for (var gy = cy - 1; gy <= cy + 1; gy++) {
        var list = chunk(gx, gy);
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (!o.lootable || o.looted || o.broken) continue;
          var dx = o.x - x, dy = o.y - y;
          var d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = o; }
        }
      }
    }
    return best;
  }

  /** Boss 撞碎范围内的道具和建筑墙体 */
  function smash(x, y, r, game) {
    var run = game.run;
    B.smash(x, y, r, game);
    var cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (var gx = cx - 1; gx <= cx + 1; gx++) {
      for (var gy = cy - 1; gy <= cy + 1; gy++) {
        var list = chunk(gx, gy);
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (o.broken || !o.solid) continue;
          var nx = x < o.x0 ? o.x0 : (x > o.x1 ? o.x1 : x);
          var ny = y < o.y0 ? o.y0 : (y > o.y1 ? o.y1 : y);
          if ((x - nx) * (x - nx) + (y - ny) * (y - ny) > r * r) continue;

          o.broken = true;
          o.looted = true;
          for (var k = 0; k < 7; k++) {
            run.fx.push({
              kind: 'p', x: o.x + (Math.random() - 0.5) * o.w,
              y: o.y + (Math.random() - 0.5) * o.h,
              vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 90,
              life: 0.5, max: 0.5,
              color: k % 3 === 0 ? '#c8ccd2' : '#6a6f78', size: 2
            });
          }
        }
      }
    }
  }

  /** 可视范围内的建筑（渲染用） */
  function buildingsInRect(x0, y0, x1, y1, out) {
    return B.buildingsInRect(x0, y0, x1, y1, out);
  }

  var World = {
    CELL: CELL, BLOCK: BLOCK, ROAD: ROAD, WALK: WALK,
    reset: function (mapTheme) {
      cache = {};
      count = 0;
      B.reset(mapTheme);
      if (mapTheme) theme = mapTheme === 'highway' ? 'street' : mapTheme;
    },
    setTheme: function (t) { theme = t === 'highway' ? 'street' : t; },
    chunk: chunk,
    queryRect: queryRect,
    resolve: resolve,
    pushOut: pushOut,
    hitBlock: hitBlock,
    insideSolid: insideSolid,
    nearLoot: nearLoot,
    smash: smash,
    buildingsInRect: buildingsInRect,
    isRoad: isRoad,
    isSidewalk: isSidewalk,
    tileKind: tileKind
  };

  HS.World = World;
})();
