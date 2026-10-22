/**
 * 可进入建筑系统
 *
 * 与旧版「整栋楼 = 一个实心矩形」不同，这里把建筑拆成：
 *   - 四面墙（带 2~3 个门洞）：墙挡人、挡子弹，门洞可以进出
 *   - 室内地板 + 家具（部分可搜刮、部分挡子弹）
 *   - 楼梯（多层建筑）与楼顶（可跳下，摔伤）
 *   - 屋顶虚化状态 reveal：玩家进入时屋顶淡出，露出室内细节
 *
 * 所有生成都由坐标 + 种子确定性决定，并缓存到 BLOCK 级，保证
 * 同一个位置永远是同一栋楼、同一批家具；World.reset 时清空战利品状态。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;

  var BLOCK = 384;
  var ROAD = 88;
  var WALK = 30;
  var WALL_T = 5;          // 墙厚
  var DOOR_GAP = 16;       // 门洞宽
  var DOOR_WAREHOUSE = 22; // 仓库大门更宽
  var INSET = 8;           // 屋顶 / 楼顶活动边界内缩

  /* 街区内部可用宽度约 250，2x2 每格约 125：建筑可以比旧版大一圈 */
  var DIMS = { tower: [96, 88], house: [84, 64], warehouse: [100, 72], motel: [104, 62] };

  var PAL = {
    tower: [
      { wall: '#1b2027', roof: '#5f6c7e', edge: '#7a8799', floor: '#333b45', floor2: '#3f4854', trim: '#8b96a2', accent: '#c9a227' },
      { wall: '#1b221c', roof: '#5c7064', edge: '#74897a', floor: '#313a33', floor2: '#3c473f', trim: '#87978a', accent: '#b45f3a' }
    ],
    house: [
      { wall: '#241b16', roof: '#98624b', edge: '#b3765a', floor: '#4a392c', floor2: '#584437', trim: '#a8855f', accent: '#c9553f' },
      { wall: '#191d24', roof: '#7588a6', edge: '#8fa4c0', floor: '#3a4049', floor2: '#454c57', trim: '#9da9b8', accent: '#c9a227' }
    ],
    warehouse: [
      { wall: '#191d22', roof: '#75808c', edge: '#8d99a7', floor: '#3a3d39', floor2: '#464a44', trim: '#99a4af', accent: '#c9a227' },
      { wall: '#211d17', roof: '#877b66', edge: '#a0917a', floor: '#403d35', floor2: '#4b473e', trim: '#a8987e', accent: '#b45f3a' }
    ],
    /* 荒漠汽车旅馆：土黄灰泥墙 + 铁皮顶，墙根一圈被风沙磨白 */
    motel: [
      { wall: '#2b2318', roof: '#65523a', edge: '#8a7350', floor: '#4e3f2c', floor2: '#5c4a34', trim: '#b09a72', accent: '#a8442f' },
      { wall: '#262019', roof: '#5a4a33', edge: '#7d6a4a', floor: '#463a29', floor2: '#544532', trim: '#a08d68', accent: '#8f6a2a' }
    ]
  };

  /* ---------------- 家具表 ---------------- */
  /* w/h 是占地尺寸；lootChance 决定是否可搜刮。所有家具都带 lootType，
     保证每栋楼至少有 2 个可搜刮点。 */
  var FURN = {
    house: [
      { id: 'bed', w: 17, h: 12, solid: 1, block: 0, chance: 0.22 },
      { id: 'couch', w: 18, h: 10, solid: 1, block: 0, chance: 0.28 },
      { id: 'table', w: 12, h: 8, solid: 1, block: 0, chance: 0.62 },
      { id: 'shelf', w: 7, h: 17, solid: 1, block: 1, chance: 0.62 },
      { id: 'fridge', w: 10, h: 12, solid: 1, block: 1, chance: 0.68 },
      { id: 'cabinet', w: 9, h: 10, solid: 1, block: 1, chance: 0.64 },
      { id: 'tv', w: 11, h: 6, solid: 1, block: 0, chance: 0.30 },
      { id: 'crate', w: 12, h: 12, solid: 1, block: 0, chance: 0.78 }
    ],
    tower: [
      { id: 'desk', w: 18, h: 10, solid: 1, block: 0, chance: 0.60 },
      { id: 'cabinet', w: 12, h: 12, solid: 1, block: 1, chance: 0.66 },
      { id: 'copier', w: 14, h: 11, solid: 1, block: 0, chance: 0.62 },
      { id: 'rack', w: 10, h: 16, solid: 1, block: 1, chance: 0.72 },
      { id: 'vending', w: 10, h: 15, solid: 1, block: 1, chance: 0.66 },
      { id: 'planter', w: 10, h: 10, solid: 1, block: 0, chance: 0.16 },
      { id: 'cooler', w: 8, h: 8, solid: 1, block: 0, chance: 0.45 },
      { id: 'crate', w: 14, h: 14, solid: 1, block: 0, chance: 0.78 }
    ],
    warehouse: [
      { id: 'shelf', w: 10, h: 24, solid: 1, block: 1, chance: 0.66 },
      { id: 'crate', w: 16, h: 16, solid: 1, block: 0, chance: 0.78 },
      { id: 'barrel', w: 11, h: 11, solid: 1, block: 0, chance: 0.66 },
      { id: 'pallet', w: 18, h: 14, solid: 1, block: 0, chance: 0.64 },
      { id: 'workbench', w: 20, h: 11, solid: 1, block: 0, chance: 0.66 },
      { id: 'locker', w: 10, h: 14, solid: 1, block: 1, chance: 0.62 }
    ],
    /* 汽车旅馆：一排房间，床 / 行李箱 / 前台柜 */
    motel: [
      { id: 'bed', w: 17, h: 12, solid: 1, block: 0, chance: 0.34 },
      { id: 'bed', w: 17, h: 12, solid: 1, block: 0, chance: 0.30 },
      { id: 'table', w: 12, h: 8, solid: 1, block: 0, chance: 0.66 },
      { id: 'cabinet', w: 9, h: 10, solid: 1, block: 1, chance: 0.70 },
      { id: 'couch', w: 18, h: 10, solid: 1, block: 0, chance: 0.30 },
      { id: 'fridge', w: 10, h: 12, solid: 1, block: 1, chance: 0.66 },
      { id: 'crate', w: 12, h: 12, solid: 1, block: 0, chance: 0.76 }
    ]
  };

  var DOOR_PAIRS = [
    ['N', 'S'], ['E', 'W'],
    ['N', 'E'], ['S', 'W'],
    ['N', 'W'], ['S', 'E']
  ];

  var cache = {};
  var cacheCount = 0;
  var theme = 'street';

  function mod(v, m) {
    var r = v % m;
    return r < 0 ? r + m : r;
  }
  function key(cx, cy) { return (cx + 8192) * 16384 + (cy + 8192); }

  function rectOverlap(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
    return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
  }

  function circleRect(x, y, r, x0, y0, x1, y1) {
    var nx = x < x0 ? x0 : (x > x1 ? x1 : x);
    var ny = y < y0 ? y0 : (y > y1 ? y1 : y);
    var dx = x - nx, dy = y - ny;
    return dx * dx + dy * dy <= r * r;
  }

  /** 线段与矩形相交（Liang-Barsky） */
  function segRect(x0, y0, x1, y1, rx0, ry0, rx1, ry1) {
    var t0 = 0, t1 = 1;
    var dx = x1 - x0, dy = y1 - y0;
    var p = [-dx, dx, -dy, dy];
    var q = [x0 - rx0, rx1 - x0, y0 - ry0, ry1 - y0];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return false;
      } else {
        var t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > t1) return false;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return false;
          if (t < t1) t1 = t;
        }
      }
    }
    return true;
  }

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

  /* ---------------- 门 / 墙 ---------------- */

  function makeDoors(b) {
    var idx = (U.hash(b.seed, 1, 101) * DOOR_PAIRS.length) | 0;
    var sides = DOOR_PAIRS[idx].slice();
    if (b.kind === 'warehouse' && U.hash(b.seed, 2, 202) < 0.34) {
      var all = ['N', 'S', 'E', 'W'];
      for (var k = 0; k < all.length; k++) {
        if (sides.indexOf(all[k]) < 0) { sides.push(all[k]); break; }
      }
    }

    var gap = b.kind === 'warehouse' ? DOOR_WAREHOUSE : DOOR_GAP;
    for (var i = 0; i < sides.length; i++) {
      var side = sides[i];
      var f = 0.5 + (i === 0 ? -0.17 : 0.17) + (U.hash(b.seed, 3 + i, 303) - 0.5) * 0.16;
      f = Math.max(0.22, Math.min(0.78, f));
      var cx, cy, ox, oy;
      if (side === 'N') {
        cx = b.x0 + b.w * f; cy = b.y0 + WALL_T / 2;
        ox = 0; oy = -1;
      } else if (side === 'S') {
        cx = b.x0 + b.w * f; cy = b.y1 - WALL_T / 2;
        ox = 0; oy = 1;
      } else if (side === 'W') {
        cx = b.x0 + WALL_T / 2; cy = b.y0 + b.h * f;
        ox = -1; oy = 0;
      } else {
        cx = b.x1 - WALL_T / 2; cy = b.y0 + b.h * f;
        ox = 1; oy = 0;
      }
      var off = WALL_T / 2 + 8;
      b.doors.push({
        side: side, cx: cx, cy: cy, gap: gap,
        ox: cx + ox * off, oy: cy + oy * off,
        ix: cx - ox * off, iy: cy - oy * off,
        out: { x: ox, y: oy }
      });
    }
  }

  function makeWalls(b) {
    var sides = ['N', 'S', 'E', 'W'];
    for (var s = 0; s < sides.length; s++) {
      var side = sides[s];
      var gaps = [];
      for (var d = 0; d < b.doors.length; d++) {
        if (b.doors[d].side !== side) continue;
        gaps.push([b.doors[d].cx - b.doors[d].gap / 2, b.doors[d].cx + b.doors[d].gap / 2,
          b.doors[d].cy - b.doors[d].gap / 2, b.doors[d].cy + b.doors[d].gap / 2]);
      }

      if (side === 'N' || side === 'S') {
        var wy0 = side === 'N' ? b.y0 : b.y1 - WALL_T;
        var wy1 = wy0 + WALL_T;
        var spans = [];
        if (gaps.length) {
          /* gaps 按 x 轴排序 */
          gaps.sort(function (a, c) { return a[0] - c[0]; });
          var cur = b.x0;
          for (var g = 0; g < gaps.length; g++) {
            if (gaps[g][0] > cur + 1) spans.push([cur, gaps[g][0]]);
            if (gaps[g][1] > cur) cur = gaps[g][1];
          }
          if (cur < b.x1 - 1) spans.push([cur, b.x1]);
        } else {
          spans.push([b.x0, b.x1]);
        }
        for (var i2 = 0; i2 < spans.length; i2++) {
          b.walls.push({
            side: side, x0: spans[i2][0], y0: wy0, x1: spans[i2][1], y1: wy1,
            broken: false, seed: (b.seed + i2 * 37 + s * 11) | 0
          });
        }
      } else {
        var wx0 = side === 'W' ? b.x0 : b.x1 - WALL_T;
        var wx1 = wx0 + WALL_T;
        var spans2 = [];
        if (gaps.length) {
          gaps.sort(function (a, c) { return a[2] - c[2]; });
          var cur2 = b.y0;
          for (var g2 = 0; g2 < gaps.length; g2++) {
            if (gaps[g2][2] > cur2 + 1) spans2.push([cur2, gaps[g2][2]]);
            if (gaps[g2][3] > cur2) cur2 = gaps[g2][3];
          }
          if (cur2 < b.y1 - 1) spans2.push([cur2, b.y1]);
        } else {
          spans2.push([b.y0, b.y1]);
        }
        for (var i3 = 0; i3 < spans2.length; i3++) {
          b.walls.push({
            side: side, x0: wx0, y0: spans2[i3][0], x1: wx1, y1: spans2[i3][1],
            broken: false, seed: (b.seed + i3 * 53 + s * 13) | 0
          });
        }
      }
    }
  }

  /* ---------------- 室内 ---------------- */

  /**
   * 门洞净空判定：门洞本身 + 门内点附近的一段走道，都不许摆东西。
   * 以前只留了门口 8px，家具可以长在"门内点"上（门内点在墙内 13px 处），
   * 结果门口被沙发/复印机堵死，丧尸进屋后再也出不来。
   */
  function doorClear(b, x0, y0, x1, y1) {
    var PAD = 4;       // 门洞两侧留的余量（够丧尸错身）
    var IN = 22;       // 门内点 + 转身空间
    var OUT = 12;      // 门外一点，别把门槛堵了
    for (var i = 0; i < b.doors.length; i++) {
      var d = b.doors[i];
      var cx0, cx1, cy0, cy1;
      if (d.side === 'N') {
        cx0 = d.cx - d.gap / 2 - PAD; cx1 = d.cx + d.gap / 2 + PAD;
        cy0 = b.y0 - OUT; cy1 = b.y0 + IN;
      } else if (d.side === 'S') {
        cx0 = d.cx - d.gap / 2 - PAD; cx1 = d.cx + d.gap / 2 + PAD;
        cy0 = b.y1 - IN; cy1 = b.y1 + OUT;
      } else if (d.side === 'W') {
        cx0 = b.x0 - OUT; cx1 = b.x0 + IN;
        cy0 = d.cy - d.gap / 2 - PAD; cy1 = d.cy + d.gap / 2 + PAD;
      } else {
        cx0 = b.x1 - IN; cx1 = b.x1 + OUT;
        cy0 = d.cy - d.gap / 2 - PAD; cy1 = d.cy + d.gap / 2 + PAD;
      }
      if (rectOverlap(x0, y0, x1, y1, cx0, cy0, cx1, cy1)) return true;
    }
    return false;
  }

  function makeStairs(b) {
    if (!b.roofAccess) return;
    var ix0 = b.ix0, iy0 = b.iy0, ix1 = b.ix1, iy1 = b.iy1;
    var sw = 17, sh = 17;
    var order = [0, 1, 2, 3];
    var start = (U.hash(b.seed, 9, 909) * 4) | 0;
    for (var n = 0; n < 4; n++) {
      var c = order[(start + n) % 4];
      var sx = (c % 2 === 0) ? ix0 + 3 : ix1 - 3 - sw;
      var sy = (c < 2) ? iy0 + 3 : iy1 - 3 - sh;
      if (doorClear(b, sx - 2, sy - 2, sx + sw + 2, sy + sh + 2)) continue;
      var clash = false;
      for (var f = 0; f < b.furniture.length; f++) {
        var q = b.furniture[f];
        if (rectOverlap(sx - 3, sy - 3, sx + sw + 3, sy + sh + 3, q.x0, q.y0, q.x1, q.y1)) { clash = true; break; }
      }
      if (clash) continue;
      b.stairs = {
        isStairs: true, x: sx + sw / 2, y: sy + sh / 2,
        w: sw, h: sh, x0: sx, y0: sy, x1: sx + sw, y1: sy + sh,
        by: sy + sh, bld: b
      };
      return;
    }
  }

  function makeRoof(b) {
    b.roofVents = [];
    var count = (b.kind === 'tower' ? 2 : 1) + ((U.hash(b.seed, 12, 1212) * 2) | 0);
    for (var i = 0; i < count; i++) {
      var w = 10 + ((U.hash(b.seed, 13 + i, 1313) * 8) | 0);
      var h = 7 + ((U.hash(b.seed, 15 + i, 1515) * 6) | 0);
      var x = b.x0 + 8 + U.hash(b.seed, 17 + i, 1717) * (b.w - 16 - w);
      var y = b.y0 + 8 + U.hash(b.seed, 19 + i, 1919) * (b.h - 16 - h);
      if (i === 0) {
        /* 第一个通风口避开楼梯口正上方 */
        if (b.stairs) { x = b.x0 + b.w * 0.7; y = b.y0 + b.h * 0.28; }
      }
      b.roofVents.push({ x: x, y: y, w: w, h: h, x0: x, y0: y, x1: x + w, y1: y + h, seed: (b.seed + i * 71) | 0 });
    }

    /* 烟囱 / 水塔：屋顶上的地标，也是实心掩体。让屋顶一眼看去不是地板。 */
    function freeRoofSpot(w, h) {
      for (var t = 0; t < 10; t++) {
        var xx = b.x0 + 7 + U.hash(b.seed, 41 + t, 4141) * Math.max(1, b.w - 14 - w);
        var yy = b.y0 + 7 + U.hash(b.seed, 43 + t, 4343) * Math.max(1, b.h - 14 - h);
        if (b.stairs && rectOverlap(xx - 4, yy - 4, xx + w + 4, yy + h + 4,
          b.stairs.x0, b.stairs.y0, b.stairs.x1, b.stairs.y1)) continue;
        var clash = false;
        for (var v = 0; v < b.roofVents.length; v++) {
          var vv = b.roofVents[v];
          if (rectOverlap(xx - 4, yy - 4, xx + w + 4, yy + h + 4, vv.x0, vv.y0, vv.x1, vv.y1)) {
            clash = true; break;
          }
        }
        if (!clash) return { x: xx, y: yy };
      }
      return null;
    }

    if (b.kind === 'house' && U.hash(b.seed, 27, 2727) < 0.78) {
      var ch = freeRoofSpot(9, 9);
      if (ch) {
        b.roofVents.push({
          isChimney: true, x: ch.x + 4.5, y: ch.y + 4.5, w: 9, h: 9,
          x0: ch.x, y0: ch.y, x1: ch.x + 9, y1: ch.y + 9,
          seed: (b.seed + 271) | 0
        });
      }
    } else if (b.kind === 'tower' && U.hash(b.seed, 29, 2929) < 0.62) {
      var tk = freeRoofSpot(16, 15);
      if (tk) {
        b.roofVents.push({
          isTank: true, x: tk.x + 8, y: tk.y + 7.5, w: 16, h: 15,
          x0: tk.x, y0: tk.y, x1: tk.x + 16, y1: tk.y + 15,
          seed: (b.seed + 291) | 0
        });
      }
    }

    if (b.roofAccess && U.hash(b.seed, 21, 2121) < 0.82) {
      var cw = 14, ch = 14;
      var cx = b.x0 + 10 + U.hash(b.seed, 23, 2323) * (b.w - 20 - cw);
      var cy = b.y0 + 10 + U.hash(b.seed, 25, 2525) * (b.h - 20 - ch);
      for (var v = 0; v < b.roofVents.length; v++) {
        var vv = b.roofVents[v];
        if (rectOverlap(cx - 5, cy - 5, cx + cw + 5, cy + ch + 5, vv.x0, vv.y0, vv.x1, vv.y1)) {
          cx = b.x0 + b.w * 0.28; cy = b.y0 + b.h * 0.68;
          break;
        }
      }
      b.roofCrate = {
        isRoofCrate: true, x: cx + cw / 2, y: cy + ch / 2,
        w: cw, h: ch, x0: cx, y0: cy, x1: cx + cw, y1: cy + ch,
        by: cy + ch, solid: false, blockBullets: false,
        lootable: true, looted: false, lootType: 'roof',
        bld: b, seed: (b.seed + 999) | 0, broken: false
      };
    }
  }

  function makeInterior(b) {
    b.ix0 = b.x0 + WALL_T + 1;
    b.iy0 = b.y0 + WALL_T + 1;
    b.ix1 = b.x1 - WALL_T - 1;
    b.iy1 = b.y1 - WALL_T - 1;
    b.furniture = [];
    b.stairs = null;

    makeStairs(b);

    var defs = FURN[b.kind];
    var lootType = b.kind === 'house' ? 'home'
      : (b.kind === 'tower' ? 'office' : (b.kind === 'motel' ? 'motel' : 'warehouse'));
    var target = (b.kind === 'house' || b.kind === 'motel' ? 6 : (b.kind === 'tower' ? 7 : 7)) +
      ((U.hash(b.seed, 31, 3131) * 4) | 0);
    /* 门洞净空变大后废案变多，多试几次，屋子才不会空荡荡 */
    var attempts = target * 8;

    for (var a = 0; a < attempts && b.furniture.length < target; a++) {
      var def = defs[(U.hash(b.seed, 33 + a, 3333) * defs.length) | 0];
      var fw = def.w, fh = def.h;
      var side = (U.hash(b.seed, 35 + a, 3535) * 4) | 0;
      var frac = U.hash(b.seed, 37 + a, 3737);
      var fx, fy;

      if (side === 0) {
        fx = b.ix0 + 4 + frac * Math.max(1, b.ix1 - b.ix0 - fw - 8);
        fy = b.iy0 + 3;
      } else if (side === 1) {
        fx = b.ix0 + 4 + frac * Math.max(1, b.ix1 - b.ix0 - fw - 8);
        fy = b.iy1 - 3 - fh;
      } else if (side === 2) {
        fx = b.ix0 + 3;
        fy = b.iy0 + 4 + frac * Math.max(1, b.iy1 - b.iy0 - fh - 8);
      } else {
        fx = b.ix1 - 3 - fw;
        fy = b.iy0 + 4 + frac * Math.max(1, b.iy1 - b.iy0 - fh - 8);
      }
      fx = Math.round(fx); fy = Math.round(fy);

      if (fx < b.ix0 + 2 || fy < b.iy0 + 2 || fx + fw > b.ix1 - 2 || fy + fh > b.iy1 - 2) continue;
      if (doorClear(b, fx - 1, fy - 1, fx + fw + 1, fy + fh + 1)) continue;
      if (b.stairs && rectOverlap(fx - 3, fy - 3, fx + fw + 3, fy + fh + 3,
        b.stairs.x0, b.stairs.y0, b.stairs.x1, b.stairs.y1)) continue;

      var clash2 = false;
      for (var q2 = 0; q2 < b.furniture.length; q2++) {
        var o2 = b.furniture[q2];
        if (rectOverlap(fx - 3, fy - 3, fx + fw + 3, fy + fh + 3, o2.x0, o2.y0, o2.x1, o2.y1)) {
          clash2 = true; break;
        }
      }
      if (clash2) continue;

      var lootable = U.hash(b.seed, 39 + a, 3939) < def.chance;
      b.furniture.push({
        isFurn: true, kindId: def.id, bld: b,
        x: fx + fw / 2, y: fy + fh / 2, w: fw, h: fh,
        x0: fx, y0: fy, x1: fx + fw, y1: fy + fh,
        by: fy + fh,
        solid: !!def.solid, blockBullets: !!def.block,
        lootable: lootable, looted: false, lootType: lootType,
        broken: false, seed: (b.seed + a * 97 + 17) | 0
      });
    }

    /* 保证每栋楼至少有两个可搜刮点，不然进去一趟太亏 */
    var lootCount = 0;
    for (var li = 0; li < b.furniture.length; li++) if (b.furniture[li].lootable) lootCount++;
    for (var lj = 0; lj < b.furniture.length && lootCount < 2; lj++) {
      if (!b.furniture[lj].lootable) {
        b.furniture[lj].lootable = true;
        lootCount++;
      }
    }

    /* 房间太挤时，塞一个不挡路的补给袋，保证有两个搜刮点 */
    function addFallbackBag() {
      var cw = 6, ch = 6;
      for (var yy = b.iy1 - 2 - ch; yy >= b.iy0 + 2; yy -= 1) {
        for (var xx = b.ix0 + 2; xx <= b.ix1 - 2 - cw; xx += 1) {
          if (doorClear(b, xx, yy, xx + cw, yy + ch)) continue;
          if (b.stairs && rectOverlap(xx, yy, xx + cw, yy + ch,
            b.stairs.x0, b.stairs.y0, b.stairs.x1, b.stairs.y1)) continue;
          var bad = false;
          for (var fx2 = 0; fx2 < b.furniture.length; fx2++) {
            var ff = b.furniture[fx2];
            if (rectOverlap(xx, yy, xx + cw, yy + ch, ff.x0, ff.y0, ff.x1, ff.y1)) { bad = true; break; }
          }
          if (bad) continue;
          b.furniture.push({
            isFurn: true, kindId: 'bag', bld: b,
            x: xx + cw / 2, y: yy + ch / 2, w: cw, h: ch,
            x0: xx, y0: yy, x1: xx + cw, y1: yy + ch, by: yy + ch,
            solid: false, blockBullets: false,
            lootable: true, looted: false, lootType: lootType,
            broken: false, seed: (b.seed + 777 + xx + yy * 13) | 0
          });
          lootCount++;
          return true;
        }
      }
      return false;
    }
    var guard = 0;
    while (b.furniture.length < 2 && guard++ < 6 && addFallbackBag()) {}

    makeRoof(b);
    b.reveal = 0;
  }

  /** 废墟：只保留残墙和塌下来的顶板，不能进入，也没有搜刮点 */
  function makeRuinInterior(b) {
    b.ix0 = b.x0 + WALL_T + 1;
    b.iy0 = b.y0 + WALL_T + 1;
    b.ix1 = b.x1 - WALL_T - 1;
    b.iy1 = b.y1 - WALL_T - 1;
    b.furniture = [];
    b.stairs = null;
    b.roofVents = [];
    b.roofCrate = null;
    b.reveal = 0;
  }

  /* ---------------- 生成 / 查询 ---------------- */

  /**
   * 每块街区 0~2 栋建筑（旧的 2x2 四栋太密）。
   * 约 62% 是塌掉的废墟（实心、不可进入），其余才是可进入的完整建筑。
   *
   * 荒漠公路（theme === 'desert'）走另一套规则：整片荒野里只零星几间屋子
   * 或者一间汽车旅馆，而且全都紧紧贴着公路 —— 玩家沿路走就能碰到，
   * 不用为了找房子在沙地里瞎跑。
   */
  function generate(bx, by) {
    var out = [];
    var desert = (theme === 'desert');
    /* 建筑必须完整落在自己的区块里：碰撞查询是按区块取缓存的，
       一旦楼跨到隔壁区块，玩家就能从墙角穿过去 */
    var minX = bx + 4, maxX = bx + BLOCK - 4;
    var minY = by + 4, maxY = by + BLOCK - 4;

    /** 造一栋楼：位置已经定好，放不下就返回 null。
     *  sa / sb 是"种子对"（街区 + 格子的坐标），同一对坐标永远生成同一栋楼。 */
    function place(kind, cx, cy, ruin, sa, sb) {
      var w = DIMS[kind][0], h = DIMS[kind][1];
      if (cx < minX || cx + w > maxX || cy < minY || cy + h > maxY) return null;
      /* 出生点附近留空地 */
      if (cx < 100 && cx + w > -100 && cy < 100 && cy + h > -100) return null;

      var b = {
        isBuilding: true, ruin: ruin,
        kind: kind, x: cx + w / 2, y: cy + h / 2, w: w, h: h,
        x0: cx, y0: cy, x1: cx + w, y1: cy + h,
        /* 荒漠只用土黄那一套配色：蓝灰色调的房子摆在沙地里像贴上去的 */
        pal: PAL[kind][desert ? 0 : ((U.hash(sa, sb, 9901) * 2) | 0) % 2],
        seed: ((U.hash(sa, sb, 4243) * 9973) | 0),
        by: cy + h, reveal: 0,
        floors: kind === 'tower' ? 3 : (kind === 'house' ? 2 : 1),
        roofAccess: !ruin && kind !== 'warehouse',
        doors: [], walls: [], furniture: [], stairs: null, roofVents: [], roofCrate: null
      };

      if (ruin) {
        makeWalls(b);
        makeRuinInterior(b);
      } else {
        makeDoors(b);
        makeWalls(b);
        makeInterior(b);
      }
      out.push(b);
      return b;
    }

    /* ---------------- 荒漠公路：路边零星房屋 / 汽车旅馆 ---------------- */
    if (desert) {
      var droll = U.hash(bx, by, 5501);
      if (droll > 0.34) return out;           // 大部分路段什么都没有

      var dkind = U.hash(bx, by, 6611) < 0.34 ? 'motel' : 'house';
      var dw = DIMS[dkind][0], dh = DIMS[dkind][1];
      var half = ROAD * 0.5;

      /* 只有"挨着公路"的区块才可能长房子。荒漠里没有街区，
         离开公路几百像素就是纯沙地，那里的区块一律空着 ——
         否则会出现一栋孤零零立在沙丘中间的楼，非常出戏。 */
      if (bx >= half || bx + BLOCK <= -half) return out;

      /* 区块在这一侧还剩多少地（公路右边 / 左边） */
      var rightRoom = (bx + BLOCK) - half;
      var leftRoom = -half - bx;
      if (rightRoom < dw + 16 && leftRoom < dw + 16) return out;

      /* 内边缘离路肩 8~30px：走在路上正好从房子门口经过 */
      var gap = 8 + U.hash(bx, by, 6623) * 22;
      var dcx = (rightRoom >= dw + 16) ? (half + gap) : (-half - gap - dw);
      var dcy = Math.round(by + 22 + U.hash(bx, by, 6629) * Math.max(1, BLOCK - 44 - dh));

      /* 旅馆是地标，塌掉的概率明显低于路边小屋 —— 否则整条路只剩沙 */
      var druin = U.hash(bx, by, 6007) < (dkind === 'motel' ? 0.22 : 0.55);
      var made = place(dkind, dcx, dcy, druin, bx, by);
      /* 极少数情况下贴着路的格子放不下（别的建筑占了 / 出生点空地），
         就往里挪一点再试一次，别让这一段路彻底空着 */
      if (!made) {
        var inner = (rightRoom >= dw + 16) ? (half + 26 + gap) : (-half - 26 - gap - dw);
        place(dkind, inner, dcy, druin, bx + 1, by);
      }
      return out;
    }

    /* ---------------- 街区：2x2 网格 ---------------- */
    var ix0 = bx + ROAD + WALK + 8, iy0 = by + ROAD + WALK + 8;
    var span = BLOCK - (ROAD + WALK) - 18;   // 约 248，留给街区边缘一点余量
    var cell = span / 2;

    var layout = U.hash(bx, by, 5501);
    var count = layout < 0.08 ? 0 : (layout < 0.60 ? 1 : 2);
    var forceEnterable = (bx === 0 && by === 0);
    if (forceEnterable && count === 0) count = 1;

    /* 确定性打乱四个格子，保证每次生成结果一致 */
    var order = [0, 1, 2, 3];
    for (var oi = 3; oi > 0; oi--) {
      var oj = (U.hash(bx, by, 5701 + oi) * (oi + 1)) | 0;
      if (oj < 0) oj = 0;
      if (oj > oi) oj = oi;
      var tmp = order[oi]; order[oi] = order[oj]; order[oj] = tmp;
    }
    /* 出生街区：把 0 号格子换到最前面，保证第一栋完整房屋在左上角
       （直接改 cellIdx 会和后面的 order[1] 撞车，必须动排列本身） */
    if (forceEnterable) {
      var zi = order.indexOf(0);
      var t0 = order[0]; order[0] = 0; order[zi] = t0;
    }

    for (var n = 0; n < count; n++) {
      var cellIdx = order[n];
      var gx = cellIdx % 2;
      var gy = (cellIdx / 2) | 0;

      var roll = U.hash(bx + gx, by + gy, 6607);
      var kind = roll < 0.34 ? 'tower' : (roll < 0.7 ? 'house' : 'warehouse');
      if (forceEnterable && n === 0 && kind === 'warehouse') kind = 'house';
      var w = DIMS[kind][0], h = DIMS[kind][1];

      var cx = ix0 + gx * cell + (cell - w) / 2 + (U.hash(bx + gx, by + gy, 7703) - 0.5) * 8;
      var cy = iy0 + gy * cell + (cell - h) / 2 + (U.hash(bx + gx, by + gy, 8819) - 0.5) * 8;
      cx = Math.round(cx); cy = Math.round(cy);

      /* 别顶出街区内部可用范围 */
      if (cx < ix0) cx = ix0;
      if (cx > maxX - w) cx = maxX - w;
      if (cy < iy0) cy = iy0;
      if (cy > maxY - h) cy = maxY - h;

      var ruin = !(forceEnterable && n === 0) && U.hash(bx + gx, by + gy, 6007) < 0.62;
      place(kind, cx, cy, ruin, bx + gx, by + gy);
    }
    return out;
  }

  function buildingsAtBlock(bx, by) {
    bx = Math.floor(bx / BLOCK) * BLOCK;
    by = Math.floor(by / BLOCK) * BLOCK;
    var k = key(bx, by);
    var list = cache[k];
    if (list) return list;
    list = generate(bx, by);
    cache[k] = list;
    cacheCount++;
    if (cacheCount > 320) {
      cache = {};
      cacheCount = 1;
      cache[k] = list;
    }
    return list;
  }

  function buildingsNear(x, y) {
    return buildingsAtBlock(Math.floor(x / BLOCK) * BLOCK, Math.floor(y / BLOCK) * BLOCK);
  }

  function buildingsInRect(x0, y0, x1, y1, out) {
    out.length = 0;
    var bx0 = Math.floor(x0 / BLOCK) * BLOCK, bx1 = Math.floor(x1 / BLOCK) * BLOCK;
    var by0 = Math.floor(y0 / BLOCK) * BLOCK, by1 = Math.floor(y1 / BLOCK) * BLOCK;
    for (var bx = bx0; bx <= bx1; bx += BLOCK) {
      for (var by = by0; by <= by1; by += BLOCK) {
        var list = buildingsAtBlock(bx, by);
        for (var i = 0; i < list.length; i++) out.push(list[i]);
      }
    }
    return out;
  }

  function insideOf(x, y) {
    var list = buildingsNear(x, y);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.ruin) continue;      // 废墟是实心路障，没有「室内」
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return b;
    }
    return null;
  }

  function doorBlocked(ox, oy, w, h) {
    var list = buildingsNear(ox, oy);
    var x0 = ox - w / 2, y0 = oy - h / 2, x1 = ox + w / 2, y1 = oy + h / 2;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      for (var d = 0; d < b.doors.length; d++) {
        var dr = b.doors[d];
        var cx0, cx1, cy0, cy1;
        if (dr.side === 'N') {
          cx0 = dr.cx - dr.gap / 2 - 7; cx1 = dr.cx + dr.gap / 2 + 7;
          cy0 = b.y0 - 14; cy1 = b.y0 + 22;
        } else if (dr.side === 'S') {
          cx0 = dr.cx - dr.gap / 2 - 7; cx1 = dr.cx + dr.gap / 2 + 7;
          cy0 = b.y1 - 22; cy1 = b.y1 + 14;
        } else if (dr.side === 'W') {
          cx0 = b.x0 - 14; cx1 = b.x0 + 22;
          cy0 = dr.cy - dr.gap / 2 - 7; cy1 = dr.cy + dr.gap / 2 + 7;
        } else {
          cx0 = b.x1 - 22; cx1 = b.x1 + 14;
          cy0 = dr.cy - dr.gap / 2 - 7; cy1 = dr.cy + dr.gap / 2 + 7;
        }
        if (rectOverlap(x0, y0, x1, y1, cx0, cy0, cx1, cy1)) return true;
      }
    }
    return false;
  }

  /* ---------------- 碰撞 ---------------- */

  function resolve(ent, r) {
    var list = buildingsNear(ent.x, ent.y);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (ent.x < b.x0 - r - 3 || ent.x > b.x1 + r + 3 ||
          ent.y < b.y0 - r - 3 || ent.y > b.y1 + r + 3) continue;

      /* 废墟整块都是实心瓦砾堆：挡住玩家和普通丧尸 */
      if (b.ruin) {
        pushOut(ent, r, b.x0, b.y0, b.x1, b.y1);
        continue;
      }

      for (var w = 0; w < b.walls.length; w++) {
        var wl = b.walls[w];
        if (wl.broken) continue;
        if (ent.x < wl.x0 - r || ent.x > wl.x1 + r ||
            ent.y < wl.y0 - r || ent.y > wl.y1 + r) continue;
        pushOut(ent, r, wl.x0, wl.y0, wl.x1, wl.y1);
      }

      if (ent.x > b.x0 - r && ent.x < b.x1 + r && ent.y > b.y0 - r && ent.y < b.y1 + r) {
        for (var f = 0; f < b.furniture.length; f++) {
          var fu = b.furniture[f];
          if (!fu.solid || fu.broken) continue;
          if (ent.x < fu.x0 - r || ent.x > fu.x1 + r ||
              ent.y < fu.y0 - r || ent.y > fu.y1 + r) continue;
          pushOut(ent, r, fu.x0, fu.y0, fu.x1, fu.y1);
        }
      }
    }
  }

  function resolveRoof(ent, b) {
    var minX = b.x0 + INSET, maxX = b.x1 - INSET;
    var minY = b.y0 + INSET, maxY = b.y1 - INSET;
    if (ent.x < minX) ent.x = minX;
    if (ent.x > maxX) ent.x = maxX;
    if (ent.y < minY) ent.y = minY;
    if (ent.y > maxY) ent.y = maxY;

    for (var i = 0; i < b.roofVents.length; i++) {
      var v = b.roofVents[i];
      pushOut(ent, ent.r || 5, v.x0, v.y0, v.x1, v.y1);
    }
  }

  function hitBlock(x, y, r, ignoreBld) {
    if (ignoreBld) return null;
    var list = buildingsNear(x, y);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) continue;

      /* 废墟是实心掩体，子弹打在瓦砾堆上 */
      if (b.ruin) return b;

      for (var w = 0; w < b.walls.length; w++) {
        var wl = b.walls[w];
        if (wl.broken) continue;
        if (x >= wl.x0 - r && x <= wl.x1 + r && y >= wl.y0 - r && y <= wl.y1 + r) return wl;
      }
      for (var f = 0; f < b.furniture.length; f++) {
        var fu = b.furniture[f];
        if (!fu.blockBullets || fu.broken) continue;
        if (x >= fu.x0 - r && x <= fu.x1 + r && y >= fu.y0 - r && y <= fu.y1 + r) return fu;
      }
    }
    return null;
  }

  function insideSolid(x, y) {
    var list = buildingsNear(x, y);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
      for (var w = 0; w < b.walls.length; w++) {
        var wl = b.walls[w];
        if (!wl.broken && x >= wl.x0 && x <= wl.x1 && y >= wl.y0 && y <= wl.y1) return true;
      }
    }
    return false;
  }

  /* ---------------- 楼顶 / 搜刮 ---------------- */

  function nearStairs(x, y, maxDist) {
    var b = insideOf(x, y);
    if (!b || !b.stairs) return null;
    var d = U.dist(x, y, b.stairs.x, b.stairs.y);
    return d <= maxDist ? b : null;
  }

  /** 站在楼顶、靠近楼梯口：可以原路下楼，楼顶不是单向陷阱 */
  function nearRoofHatch(x, y, b, maxDist) {
    if (!b || !b.stairs) return null;
    return U.dist(x, y, b.stairs.x, b.stairs.y) <= maxDist ? b : null;
  }

  function edgeDir(x, y, b, margin) {
    var minX = b.x0 + INSET, maxX = b.x1 - INSET;
    var minY = b.y0 + INSET, maxY = b.y1 - INSET;
    var dl = x - minX, dr = maxX - x, dt = y - minY, db = maxY - y;
    var m = Math.min(dl, dr, dt, db);
    if (m > margin) return null;
    if (m === dl) return { x: -1, y: 0, d: dl };
    if (m === dr) return { x: 1, y: 0, d: dr };
    if (m === dt) return { x: 0, y: -1, d: dt };
    return { x: 0, y: 1, d: db };
  }

  function interiorLootNear(b, x, y, maxDist) {
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < b.furniture.length; i++) {
      var f = b.furniture[i];
      if (!f.lootable || f.looted || f.broken) continue;
      var dx = f.x - x, dy = f.y - y;
      var d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = f; }
    }
    return best;
  }

  function roofLootNear(b, x, y, maxDist) {
    var c = b.roofCrate;
    if (!c || c.looted || c.broken) return null;
    return U.dist(x, y, c.x, c.y) <= maxDist ? c : null;
  }

  /* ---------------- 门的寻路目标 ---------------- */

  /* 门洞阶段常量：
     APPROACH 走向自己这一侧的门点，THROUGH 已经贴住门洞、正在穿过去。
     一旦进入 THROUGH 就不再回头，否则门外点 / 门内点会每帧互相顶替，
     丧尸会在门洞里原地抖动，永远出不来（或永远进不去）。 */
  var DOOR_REACH = 13;       // 距门点多近算"贴住门洞"
  var STUCK_TIME = 0.9;      // 多久没有靠近目标算卡住

  function doorVisible(ex, ey, px, py, b) {
    return !segRect(ex, ey, px, py, b.x0 + 1, b.y0 + 1, b.x1 - 1, b.y1 - 1);
  }

  /** 直线有没有穿过楼内的实心家具（选门时避开绕不过去的路线） */
  function lineHitsFurn(b, x0, y0, x1, y1) {
    for (var i = 0; i < b.furniture.length; i++) {
      var f = b.furniture[i];
      if (f.broken || !f.solid) continue;
      if (segRect(x0, y0, x1, y1, f.x0, f.y0, f.x1, f.y1)) return true;
    }
    return false;
  }

  /** 选一扇门（只在开始穿门 / 换门时调用） */
  function pickDoorIdx(b, x, y, wantInside, tx, ty) {
    var best = 0, bestCost = 1e9;
    for (var i = 0; i < b.doors.length; i++) {
      var d = b.doors[i];
      var px = wantInside ? d.ox : d.ix;
      var py = wantInside ? d.oy : d.iy;
      var cost = U.dist(x, y, px, py) + U.dist(px, py, tx, ty) * 0.12;
      /* 门外看不见门点 → 绕墙角，代价高一点；室内被家具挡住 → 也加价 */
      if (wantInside) {
        if (!doorVisible(x, y, px, py, b)) cost += 200;
      } else if (lineHitsFurn(b, x, y, d.ix, d.iy)) {
        cost += 90;
      }
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    return best;
  }

  /** 清掉穿门状态（离开楼体 / 同层追击时调用） */
  function navClear(e) {
    e.navB = null;
    e.navDoor = -1;
    e.navOut = false;
    e.navBest = 0;
    e.navStuck = 0;
    e.navTry = 0;
  }

  /* ---------------- 绕行（同层追击绕楼体） ---------------- */

  var _wpTmp = { x: 0, y: 0 };

  /**
   * 楼体的四个角，按顺时针排：0=左上 1=右上 2=右下 3=左下。
   * pad 是外扩量（至少 = 实体半径 + 几像素），保证角点不贴墙。
   */
  function cornerOf(b, idx, pad, out) {
    out.x = (idx === 1 || idx === 2) ? b.x1 + pad : b.x0 - pad;
    out.y = (idx >= 2) ? b.y1 + pad : b.y0 - pad;
    return out;
  }

  /**
   * 线段是否穿过某栋楼（矩形按 pad 外扩）。
   * 只有真被楼挡住的直线才值得绕；从楼旁边过的不算，免得把敌人往反方向拽。
   */
  function segHitsBld(x0, y0, x1, y1, b, pad) {
    return segRect(x0, y0, x1, y1, b.x0 - pad, b.y0 - pad, b.x1 + pad, b.y1 + pad);
  }

  /* 可见性判定用的外扩量：取负值（把矩形往里缩一点）。
     贴着墙走的那条线会擦到墙边，用正值会被误判成"穿墙"，
     结果刚从角上出发就找不到下一个角。真正穿过楼体照样能查出来。 */
  var VIS_PAD = -2;

  /**
   * 开始绕一栋楼。凸矩形的最短外绕一定形如「先走到一个能看见的角，再沿四条边走」，
   * 所以：
   *   1. 只有直线能走到的角才算候选（否则会从门洞里往楼里钻）
   *   2. 每个候选角 × 两个方向，都算一遍「走几步 + 最后跳到目标」的代价
   *   3. 取最便宜的（方向就此定下，之后不再翻转）
   */
  function routeStart(e, b, tx, ty, r) {
    var pad = r + 7;
    var bestCost = Infinity, bestNear = -1, bestDir = 1;

    for (var v = 0; v < 4; v++) {
      cornerOf(b, v, pad, _wpTmp);
      if (insideSolid(_wpTmp.x, _wpTmp.y)) continue;
      if (segHitsBld(e.x, e.y, _wpTmp.x, _wpTmp.y, b, VIS_PAD)) continue;
      var d0 = U.dist(e.x, e.y, _wpTmp.x, _wpTmp.y);

      for (var s = 0; s < 2; s++) {
        var dir = s === 0 ? 1 : -1;
        var idx = v, path = d0, cost = d0 + U.dist(_wpTmp.x, _wpTmp.y, tx, ty);
        for (var k = 0; k < 4; k++) {
          cornerOf(b, idx, pad, _wpTmp);
          var ax = _wpTmp.x, ay = _wpTmp.y;
          idx = (idx + dir + 4) % 4;
          cornerOf(b, idx, pad, _wpTmp);
          path += Math.abs(_wpTmp.x - ax) + Math.abs(_wpTmp.y - ay);
          var c = path + U.dist(_wpTmp.x, _wpTmp.y, tx, ty);
          if (c < cost) cost = c;
        }
        if (cost < bestCost) { bestCost = cost; bestNear = v; bestDir = dir; }
      }
    }

    /* 一个能看见的角都没有（堵在门洞里 / 被别的实心块围着）：
       先退回这扇门的外点，再重新决定 */
    if (bestNear < 0) {
      for (var d = 0; d < b.doors.length; d++) {
        var dr = b.doors[d];
        if (!inDoorway(dr, e.x, e.y, 6)) continue;
        e.wpB = b; e.wpIdx = 0; e.wpDir = 1; e.wpHop = 0;
        e.wpX = dr.ox; e.wpY = dr.oy; e.wpT = 3; e.blockT = 0;
        return true;
      }
      return false;
    }

    e.wpB = b;
    e.wpIdx = bestNear;
    e.wpDir = bestDir;
    e.wpHop = 0;
    /* 已经在角上就不用再走一遍 */
    cornerOf(b, bestNear, pad, _wpTmp);
    if (U.dist(e.x, e.y, _wpTmp.x, _wpTmp.y) < 10) return routeNext(e, tx, ty, r);
    e.wpX = _wpTmp.x;
    e.wpY = _wpTmp.y;
    e.wpT = 6;
    e.blockT = 0;
    return true;
  }

  /** 沿既定方向换到下一个角；四个角都被实心块占了就放弃 */
  function routeNext(e, tx, ty, r) {
    var b = e.wpB;
    if (!b) return false;
    var pad = r + 7;
    for (var t = 0; t < 4; t++) {
      e.wpIdx = (e.wpIdx + e.wpDir + 4) % 4;
      cornerOf(b, e.wpIdx, pad, _wpTmp);
      if (insideSolid(_wpTmp.x, _wpTmp.y)) continue;
      /* 从当前位置要能直线走到这个角，否则等于又往楼里钻 */
      if (segHitsBld(e.x, e.y, _wpTmp.x, _wpTmp.y, b, VIS_PAD)) continue;
      e.wpHop++;
      e.wpX = _wpTmp.x;
      e.wpY = _wpTmp.y;
      e.wpT = 6;
      e.blockT = 0;
      return true;
    }
    routeClear(e);
    return false;
  }

  function routeClear(e) {
    e.wpB = null;
    e.wpIdx = 0;
    e.wpDir = 1;
    e.wpHop = 0;
    e.wpT = 0;
  }

  /** 是否已经站在门洞里（横向按门宽，纵向按墙厚给一点余量） */
  function inDoorway(d, x, y, pad) {
    if (d.side === 'N' || d.side === 'S') {
      return Math.abs(x - d.cx) < d.gap / 2 + pad && Math.abs(y - d.cy) < 13;
    }
    return Math.abs(y - d.cy) < d.gap / 2 + pad && Math.abs(x - d.cx) < 13;
  }

  /**
   * 穿门导航：目标点写进 e.navX / e.navY，返回 true 表示这帧要用它。
   * wantInside=true：敌人在楼外，要进楼；false：敌人在楼里，要出去。
   *
   * 三段保险，保证一定能走出去：
   *   1. 选定门后不再每帧重选（粘滞），并且一旦贴住门洞就锁定"穿门"阶段
   *   2. 0.9 秒没有更靠近目标 → 换下一扇门（可能被家具挡住）
   *   3. 所有门都试过还不行 → 朝门洞硬挪一段，彻底杜绝"永久卡在楼里"
   */
  function doorNav(e, b, wantInside, tx, ty, dt) {
    if (e.navB !== b || !(e.navDoor >= 0) || e.navDoor >= b.doors.length) {
      e.navB = b;
      e.navDoor = pickDoorIdx(b, e.x, e.y, wantInside, tx, ty);
      e.navOut = false;
      e.navBest = 1e9;
      e.navStuck = 0;
      e.navTry = 0;
    }

    var inside = insideOf(e.x, e.y) === b;
    if (wantInside) {
      if (inside) { navClear(e); return false; }
    } else if (!inside &&
      (e.x < b.x0 - 2 || e.x > b.x1 + 2 || e.y < b.y0 - 2 || e.y > b.y1 + 2)) {
      /* 要真的离开墙体一点才算出来了：站在门槛上就收工的话，
         下一帧又会被判成"在楼里"重新开始，状态反复重置最容易卡死 */
      navClear(e);
      return false;
    }

    var d = b.doors[e.navDoor];
    var nearX = wantInside ? d.ox : d.ix;
    var nearY = wantInside ? d.oy : d.iy;
    var farX = wantInside ? d.ix : d.ox;
    var farY = wantInside ? d.iy : d.oy;

    /* 贴近门洞（或已经在门洞里）就锁定"穿门"，之后绝不再折回去走门点，
       否则两只丧尸在同一个门洞一进一出会互相顶死 */
    if (!e.navOut && (inDoorway(d, e.x, e.y, 3) || U.dist(e.x, e.y, nearX, nearY) < DOOR_REACH)) {
      e.navOut = true;
    }

    var gx = e.navOut ? farX : nearX;
    var gy = e.navOut ? farY : nearY;

    var gd = U.dist(e.x, e.y, gx, gy);
    if (gd < e.navBest - 0.5) {
      e.navBest = gd;
      e.navStuck = 0;
    } else {
      e.navStuck += dt;
    }

    if (e.navStuck > STUCK_TIME) {
      e.navStuck = 0;
      e.navBest = 1e9;
      e.navTry++;
      if (e.navTry <= b.doors.length) {
        /* 换一扇门，重新从"走向门点"开始 */
        e.navDoor = (e.navDoor + 1) % b.doors.length;
        e.navOut = false;
      } else {
        /* 门全被堵住：直接挪到自己这一侧的门点上（那里一定是空的），
           然后照常穿门，绝不无限期卡在楼里 */
        e.navTry = 0;
        e.navOut = true;
        e.x = nearX;
        e.y = nearY;
      }
      d = b.doors[e.navDoor];
      nearX = wantInside ? d.ox : d.ix;
      nearY = wantInside ? d.oy : d.iy;
      farX = wantInside ? d.ix : d.ox;
      farY = wantInside ? d.iy : d.oy;
      gx = e.navOut ? farX : nearX;
      gy = e.navOut ? farY : nearY;
    }

    e.navX = gx;
    e.navY = gy;
    return true;
  }

  /* ---------------- 破坏 ---------------- */

  function debris(run, x, y, n) {
    for (var i = 0; i < n; i++) {
      if (run.fx.length > 160) break;
      run.fx.push({
        kind: 'p', x: x + (Math.random() - 0.5) * 10, y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 110, vy: -Math.random() * 80,
        life: 0.45 + Math.random() * 0.3, max: 0.7,
        color: Math.random() < 0.35 ? '#9a9ea6' : '#5f6168', size: 1.5 + Math.random()
      });
    }
  }

  function smash(x, y, r, game) {
    if (!game || !game.run) return;
    var run = game.run;
    var list = buildingsNear(x, y);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (x < b.x0 - r - 4 || x > b.x1 + r + 4 || y < b.y0 - r - 4 || y > b.y1 + r + 4) continue;

      for (var w = 0; w < b.walls.length; w++) {
        var wl = b.walls[w];
        if (wl.broken) continue;
        if (circleRect(x, y, r, wl.x0, wl.y0, wl.x1, wl.y1)) {
          wl.broken = true;
          debris(run, (wl.x0 + wl.x1) / 2, (wl.y0 + wl.y1) / 2, 6);
        }
      }
      for (var f = 0; f < b.furniture.length; f++) {
        var fu = b.furniture[f];
        if (fu.broken) continue;
        if (circleRect(x, y, r, fu.x0, fu.y0, fu.x1, fu.y1)) {
          fu.broken = true;
          fu.looted = true;
          debris(run, fu.x, fu.y, 4);
        }
      }
    }
  }

  /* ---------------- 导出 ---------------- */

  var B = {
    BLOCK: BLOCK, ROAD: ROAD, WALK: WALK, WALL_T: WALL_T, INSET: INSET,
    reset: function (mapTheme) {
      cache = {};
      cacheCount = 0;
      if (mapTheme) theme = mapTheme;
    },
    setTheme: function (t) { theme = t; },
    buildingsAtBlock: buildingsAtBlock,
    buildingsNear: buildingsNear,
    buildingsInRect: buildingsInRect,
    insideOf: insideOf,
    resolve: resolve,
    resolveRoof: resolveRoof,
    hitBlock: hitBlock,
    insideSolid: insideSolid,
    doorBlocked: doorBlocked,
    nearStairs: nearStairs,
    nearRoofHatch: nearRoofHatch,
    edgeDir: edgeDir,
    interiorLootNear: interiorLootNear,
    roofLootNear: roofLootNear,
    doorNav: doorNav,
    navClear: navClear,
    cornerOf: cornerOf,
    segHitsBld: segHitsBld,
    routeStart: routeStart,
    routeNext: routeNext,
    routeClear: routeClear,
    smash: smash
  };

  HS.Buildings = B;
})();
