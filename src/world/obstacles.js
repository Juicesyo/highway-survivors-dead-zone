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

  /* 公路隧道：可通行走廊半宽 88，两侧是 44 厚的混凝土衬砌（撞不穿、打不穿），
     再往外是山体。墙由生成器按 192 区块整段铺，永远无缝 ——
     这张图没有任何岔路，玩家只能沿 y 走。 */
  var TUN_HALF = 88;
  var TUN_WALL = 44;
  var TUN_ROAD = 56;      // 沥青路面半宽，56~88 是检修步道
  var ROCK_W = 220;       // 衬砌外侧的山体厚度（纯碰撞，看不见边）

  function isTunnel() { return theme === 'tunnel'; }

  function isRoad(x, y) {
    if (theme === 'tunnel') return Math.abs(x) < TUN_ROAD;
    if (theme === 'desert' || theme === 'flood') return Math.abs(x) < DESERT_HALF;
    return mod(x, BLOCK) < ROAD || mod(y, BLOCK) < ROAD;
  }
  function isSidewalk(x, y) {
    if (isRoad(x, y)) return false;
    if (theme === 'tunnel') return Math.abs(x) < TUN_HALF;
    if (theme === 'desert' || theme === 'flood') return Math.abs(x) < DESERT_HALF + WALK;
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

  /* 隧道衬砌用的伪道具：够硬、挡子弹、撞不碎。
     不参与绘制（wall:1，render.js 的 sort/draw 会整段跳过），
     形状只交给碰撞与弹道查询。 */
  var TUN_WALL_DEF = {
    id: 'tunnelwall', w: 0, h: 0,
    vFrames: [], hFrames: [],
    solid: 1, blockBullets: 1, crash: 14
  };

  /* ---------------- 公路隧道：事故现场 ----------------
   *
   * 这条隧道是"堵死的那一刻"被封起来的：每隔 1152px 就有一处连环追尾 ——
   * 三四辆车挤在同一条车道上，角度全拧着，其中一辆已经烧成空壳。
   * 死规定（改之前先问自己：还走得过去吗？）：
   *   · 车一律贴着**同一侧**墙，另一侧永远留出 ≥ 46px 的通道（check-tunnel 会量）；
   *   · 位置 / 角度 / 烧没烧全由事故点种子决定，同一坐标永远一样；
   *   · 车壳照旧能搜刮 —— 事故现场是这张图主要的金币来源。
   */
  var ACC_GAP = 1152;      // 两处事故的间距（6 个区块）
  var ACC_SPAN = 170;      // 单处事故在 y 方向的半径（含车长和刹车痕）

  function accidentY(k) { return k * ACC_GAP + 300 + U.hash(k, 17, 5527) * 620; }
  function accidentSide(k) { return U.hash(k, 19, 5531) < 0.5 ? -1 : 1; }
  function accidentCount(k) { return 5 + Math.floor(U.hash(k, 23, 5533) * 3); }   // 5~7 辆

  /** 一处事故的车位布局（世界坐标，不含区块归属 —— 归谁由 accidentProps 定） */
  /* 车堆按 k 缓存：渲染每帧要取火源位置、accidentProps 每次落块也算一遍，
     不缓存的话同一处车堆会被反复构造（一次 5~7 个对象 + 十几次 hash）。 */
  var carCache = {};

  function accidentCars(k) {
    if (carCache[k]) return carCache[k];
    var ay = accidentY(k);
    var side = accidentSide(k);
    var n = accidentCount(k);
    var burnt = Math.floor(U.hash(k, 29, 5537) * n);      // 其中一辆烧成壳
    var cars = [];
    for (var i = 0; i < n; i++) {
      var sd = k * 37 + i;
      var h1 = U.hash(sd, 3, 5543);
      var h2 = U.hash(sd, 5, 5549);
      var h3 = U.hash(sd, 7, 5557);
      var h4 = U.hash(sd, 11, 5563);
      /* 车堆里有两辆是横过来的：一辆在路中间，车多的场次再来一辆偏到另一侧，
         形成一个"绕桩"的 S 弯 —— 这是这处事故真正的玩法，也是走廊被堵住的样子。
         通道宽度全靠这两辆和墙之间的距离撑着（check-tunnel 会量）。 */
      var jack = i === n - 1;
      var jack2 = n >= 5 && i === n - 2;
      var tipped = jack && U.hash(k, 31, 5573) < 0.85;
      var def = tipped ? D.props.tipped : (h1 < 0.22 ? D.props.van : D.props.sedan);
      /* 车堆里**恰好一辆**还在烧（就是"这里为什么会撞"的答案，也是这处场景唯一的光源）。
         别让 h2<0.16 那几辆也带火：一处车堆点三把火，光照会互相叠加成一片橙雾。 */
      var burning = i === burnt;
      var frame;
      if (tipped) frame = 'car_tipped_v';
      else if (def === D.props.van) frame = 'car_van_v';
      else if (burning || h2 < 0.16) frame = 'car_burnt_v';
      else frame = h2 < 0.58 ? 'car_sedan_v' : 'car_blue_v';

      var w = def.w, h = def.h;
      /* 跟随车堆的：贴着同侧墙停（44~58，车宽 24，斜 0.6rad 时最远到 84，压不到 88 的墙）；
         横在中间的那辆：|x| 只有 2~14，车头斜着顶住车堆，把走廊掐到只剩一侧能过。 */
      /* 横过来那辆的车头顶进车堆里（x 20~28，车身斜着能压到 44 的堆上）——
         "撞在一起"要靠重叠才看得出来，光挨着只是并排停 */
      var ox = jack ? side * (20 + h3 * 8)
        : (jack2 ? -side * (2 + h3 * 10) : side * (44 + h3 * 14));
      var oy = ay + (i - (n - 1) / 2) * 11 + (h4 - 0.5) * 5;
      /* 追尾：跟车的车头大多是顺路的，只有横过来那两辆角度是拧的 */
      var ang = (jack || jack2) ? -side * (1.0 + h3 * 0.5)
        : (h1 < 0.5 ? -1 : 1) * (0.15 + h3 * 0.6);

      var pad = def.pad || 0;
      var cw = Math.max(4, w - pad * 2);
      var ch = Math.max(4, h - pad * 2);
      cars.push({
        type: def.id, def: def, acc: k,
        x: ox, y: oy, w: w, h: h, frame: frame,
        x0: ox - w / 2, y0: oy - h / 2, x1: ox + w / 2, y1: oy + h / 2,
        bx0: ox - cw / 2, by0: oy - ch / 2, bx1: ox + cw / 2, by1: oy + ch / 2,
        solid: true, blockBullets: true,
        lootable: !!(def.loot && U.hash(sd, 41, 5579) < (def.lootChance || 0)),
        looted: false,
        flip: U.hash(sd, 43, 5581) < 0.5,
        ang: ang, hw: cw / 2, hh: ch / 2,
        by: oy + h / 2,
        fire: burning ? 1 : 0
      });
    }
    carCache[k] = cars;
    return cars;
  }

  /** 这处事故的火源（还在烧的那辆车），没有就 null */
  function accidentFire(k) {
    var cars = accidentCars(k);
    for (var i = 0; i < cars.length; i++) {
      if (cars[i].fire) return { k: k, x: cars[i].x, y: cars[i].y - 2 };
    }
    return null;
  }

  /** 渲染 / 照明用：可视范围内的火源 */
  function firesIn(y0, y1, out) {
    out = out || [];
    out.length = 0;
    if (theme !== 'tunnel') return out;
    var k0 = Math.floor((y0 - ACC_SPAN) / ACC_GAP);
    var k1 = Math.floor((y1 + ACC_SPAN) / ACC_GAP);
    for (var k = k0; k <= k1; k++) {
      var ay = accidentY(k);
      if (ay < y0 - ACC_SPAN || ay > y1 + ACC_SPAN) continue;
      var f = accidentFire(k);
      if (f) out.push(f);
    }
    return out;
  }

  /** 把落在本区块里的事故车塞进 out（每辆车只归属一个区块，不会重复生成） */
  function accidentProps(cx, cy, out) {
    var y0 = cy * CELL;
    var k0 = Math.floor((y0 - ACC_SPAN) / ACC_GAP);
    var k1 = Math.floor((y0 + CELL + ACC_SPAN) / ACC_GAP);
    for (var k = k0; k <= k1; k++) {
      var cars = accidentCars(k);
      for (var i = 0; i < cars.length; i++) {
        var o = cars[i];
        if (Math.floor(o.y / CELL) !== cy || Math.floor(o.x / CELL) !== cx) continue;
        out.push(o);
      }
    }
  }

  /** 这个 y 是不是落进了某处事故的车堆里（普通道具要给事故让位，别把通道堵死） */
  function nearAccident(y) {
    var k0 = Math.floor((y - ACC_SPAN) / ACC_GAP);
    var k1 = Math.floor((y + ACC_SPAN) / ACC_GAP);
    for (var k = k0; k <= k1; k++) {
      if (Math.abs(accidentY(k) - y) < ACC_SPAN) return true;
    }
    return false;
  }

  /** 渲染用：可视范围内的事故点（画地面的烟熏 / 刹车痕 / 碎玻璃） */
  function accidentsIn(y0, y1, out) {
    out = out || [];
    out.length = 0;
    if (theme !== 'tunnel') return out;
    var k0 = Math.floor((y0 - ACC_SPAN) / ACC_GAP);
    var k1 = Math.floor((y1 + ACC_SPAN) / ACC_GAP);
    for (var k = k0; k <= k1; k++) {
      var ay = accidentY(k);
      if (ay < y0 - ACC_SPAN || ay > y1 + ACC_SPAN) continue;
      out.push({ k: k, y: ay, side: accidentSide(k), n: accidentCount(k) });
    }
    return out;
  }

  function tunnelWalls(cx, cy, out) {
    var y0 = cy * CELL, y1 = y0 + CELL;
    for (var s = -1; s <= 1; s += 2) {
      var wx = s * (TUN_HALF + TUN_WALL / 2);
      out.push({
        type: 'tunnelwall', def: TUN_WALL_DEF, wall: 1,
        x: wx, y: (y0 + y1) / 2,
        w: TUN_WALL, h: CELL,
        x0: wx - TUN_WALL / 2, y0: y0, x1: wx + TUN_WALL / 2, y1: y1,
        bx0: wx - TUN_WALL / 2, by0: y0, bx1: wx + TUN_WALL / 2, by1: y1,
        solid: true, blockBullets: true, lootable: false, looted: false,
        ang: 0, hw: TUN_WALL / 2, hh: CELL / 2, by: y1
      });
      /* 墙外的山体：画面里只是一片黑，但**必须也是实心的** ——
         否则被爆炸甩出去 / 被同伴顶出去的实体能在岩石里"游泳"，
         再靠 insideSolid 的螺旋搜索又能原地出现在走廊里。 */
      var rx = s * (TUN_HALF + TUN_WALL + ROCK_W / 2);
      out.push({
        type: 'tunnelrock', def: TUN_WALL_DEF, wall: 1,
        x: rx, y: (y0 + y1) / 2,
        w: ROCK_W, h: CELL,
        x0: rx - ROCK_W / 2, y0: y0, x1: rx + ROCK_W / 2, y1: y1,
        bx0: rx - ROCK_W / 2, by0: y0, bx1: rx + ROCK_W / 2, by1: y1,
        solid: true, blockBullets: true, lootable: false, looted: false,
        ang: 0, hw: ROCK_W / 2, hh: CELL / 2, by: y1
      });
    }
  }

  function build(cx, cy) {
    var out = [];
    /* 隧道：墙是"地形"，每个区块都要有；道具另算 */
    if (theme === 'tunnel') {
      tunnelWalls(cx, cy, out);
      /* 事故车先落位：后面的普通道具会拿它们做重叠检测，不会在车里再塞一辆 */
      if (cx * CELL < TUN_HALF && cx * CELL + CELL > -TUN_HALF) accidentProps(cx, cy, out);
    }
    var density = D.propDensity[theme] || 0.6;
    /* 少数区块刷两个道具，摆放更松散 */
    var tries = U.hash(cx, cy, 8801) < 0.24 ? 2 : 1;

    for (var n = 0; n < tries; n++) {
    var sd = n * 977;
    if (U.hash(cx, cy, 7311 + sd) > density) continue;

    var ox = cx * CELL + 12 + U.hash(cx, cy, 101 + sd) * (CELL - 24);
    var oy = cy * CELL + 12 + U.hash(cx, cy, 211 + sd) * (CELL - 24);
    /* 锈水高速：能摆东西的只有桥面 |x|<62 这条带。整块 192 均匀撒点的话
       一大半落在深水里被拒，路面上就只剩零星几件。 */
    if (theme === 'flood') {
      var bx0 = Math.max(cx * CELL, -62), bx1 = Math.min(cx * CELL + CELL, 62);
      if (bx1 - bx0 < 10) continue;
      ox = bx0 + U.hash(cx, cy, 101 + sd) * (bx1 - bx0);
    }
    /* 隧道：只有走廊里能摆东西。区间按"整块都在走廊内"取，
       再给车壳留出旋转后的余量（62 + 22 < 88）。 */
    if (theme === 'tunnel') {
      var tx0 = Math.max(cx * CELL, -(TUN_HALF - 26));
      var tx1 = Math.min(cx * CELL + CELL, TUN_HALF - 26);
      if (tx1 - tx0 < 8) continue;
      ox = tx0 + U.hash(cx, cy, 101 + sd) * (tx1 - tx0);
    }

    /* 出生点周围留出空地 */
    if (Math.abs(ox) < 135 && Math.abs(oy) < 135) continue;
    /* 事故现场里不再摆普通道具：那一处只留车堆，通道宽度才是可算的 */
    if (theme === 'tunnel' && nearAccident(oy)) continue;

    /* 荒漠分区：人造障碍（车壳 / 路牌 / 广告牌…）只出现在路肩附近，
       远处荒野只稀疏地长仙人掌 —— 满地垃圾车不像荒漠 */
    var def;
    if (theme === 'flood' && HS.Water && HS.Game.run && HS.Water.zone(ox, oy, HS.Game.run) === 2) continue;
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
      /* 荒漠直路：车壳、路障都顺着路摆 */
      vertical = true;
    } else if (theme === 'tunnel') {
      /* 隧道：消防通道被刮得只剩一条，车多半是顺着墙擦过去的 */
      vertical = U.hash(cx, cy, 9031 + sd) < 0.72;
    } else if (theme === 'flood') {
      /* 锈水高速：被水冲过的车不会停得整整齐齐 —— 六成顺路，四成横过来 */
      vertical = U.hash(cx, cy, 9031 + sd) < 0.58;
    } else if (U.hash(cx, cy, 9011 + sd) < 0.3) {
      vertical = U.hash(cx, cy, 9013 + sd) < 0.5;
    } else if (mx < ROAD) vertical = true;
    else if (my < ROAD) vertical = false;
    else vertical = U.hash(cx, cy, 401 + sd) < 0.5;

    /* 会旋转的物件（废弃车辆）一律取竖放帧，朝向交给 ang 随机转 */
    if (def.spin) vertical = true;
    var frames = (oriented && !vertical) ? def.hFrames : def.vFrames;
    var frame = frames[Math.floor(U.hash(cx, cy, 613 + sd) * frames.length) % frames.length];
    var w = oriented && !vertical ? def.h : def.w;
    var h = oriented && !vertical ? def.w : def.h;

    /* 废弃车辆 360° 朝向：转起来以后压占要按旋转后的包围盒算 */
    var rot = def.spin ? U.hash(cx, cy, 9053 + sd) * Math.PI * 2 : 0;
    var aw = w, ah = h;
    if (rot) {
      var ca = Math.abs(Math.cos(rot)), sa2 = Math.abs(Math.sin(rot));
      aw = w * ca + h * sa2;
      ah = w * sa2 + h * ca;
    }

    /* 别压在建筑上，也别堵住门洞 */
    if (buildingOverlap(ox, oy, aw, ah)) continue;
    if (B.doorBlocked(ox, oy, aw, ah)) continue;
    /* 水里的道具要留出人行道：外扩 12px 不能碰深水。
       否则会出现"深水 + 一根管子"把桥面夹成两三像素的死缝，
       丧尸（和玩家）走到那儿就再也过不去了。 */
    if (theme === 'flood' && HS.Water && HS.Game && HS.Game.run &&
        !HS.Water.canPlace(ox, oy, aw + 12, ah + 12, HS.Game.run)) continue;
    /* 别和本区块另一个道具叠在一起 */
    var clash = false;
    for (var ck = 0; ck < out.length; ck++) {
      var q = out[ck];
      if (Math.abs(q.x - ox) < (q.w + aw) / 2 + 8 && Math.abs(q.y - oy) < (q.h + ah) / 2 + 8) { clash = true; break; }
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
      /* ang / hw / hh：旋转矩形的碰撞（旋转车用），ang=0 时等价于 AABB */
      ang: rot, hw: cw / 2, hh: ch / 2,
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

  /* ---------------- 旋转矩形（会转的废弃车辆） ---------------- */

  /** 小圆是否落在旋转矩形里（o: {x,y,ang,hw,hh}） */
  function boxHit(x, y, r, o) {
    var c = Math.cos(o.ang), s = Math.sin(o.ang);
    var dx = x - o.x, dy = y - o.y;
    var lx = dx * c + dy * s;
    var ly = -dx * s + dy * c;
    return Math.abs(lx) <= o.hw + r && Math.abs(ly) <= o.hh + r;
  }

  /** 把小圆推出旋转矩形（就地修改 ent）；返回是否发生碰撞 */
  function pushOutRot(ent, r, o) {
    var c = Math.cos(o.ang), s = Math.sin(o.ang);
    var dx = ent.x - o.x, dy = ent.y - o.y;
    var lx = dx * c + dy * s;
    var ly = -dx * s + dy * c;
    var ex = o.hw + r, ey = o.hh + r;
    if (Math.abs(lx) < ex && Math.abs(ly) < ey) {
      /* 已经嵌进去了：沿最小穿透轴顶出来 */
      var px = ex - Math.abs(lx), py = ey - Math.abs(ly);
      var ox = 0, oy = 0;
      if (px < py) ox = (lx >= 0 ? px : -px);
      else oy = (ly >= 0 ? py : -py);
      ent.x += ox * c - oy * s;
      ent.y += ox * s + oy * c;
      return true;
    }
    var nx = lx < -o.hw ? -o.hw : (lx > o.hw ? o.hw : lx);
    var ny = ly < -o.hh ? -o.hh : (ly > o.hh ? o.hh : ly);
    var ddx = lx - nx, ddy = ly - ny;
    var d2 = ddx * ddx + ddy * ddy;
    if (d2 > r * r) return false;
    var d = Math.sqrt(d2) || 0.0001;
    var push = (r - d) / d;
    var wx = ddx * push, wy = ddy * push;
    ent.x += wx * c - wy * s;
    ent.y += wx * s + wy * c;
    return true;
  }

  /* ---------------- 局部寻路（实心道具） ---------------- */

  /**
   * 绕实心道具的粗网格寻路：只在敌人真被顶住时调用。
   *
   * 为什么需要它：街道上挡路的主要是楼，`Buildings.navClear / wallRoute` 已经能绕；
   * 但公路隧道的车堆是**几块旋转矩形拼出来的凹形**，纯侧滑会在口袋里左右横跳
   * （实测 16 秒走不出来）。这里用 12px 格子做一次小范围 BFS，
   * 目标是"每走一步都离玩家更近"的格子 —— 口袋的出口自然会被选中。
   *
   * 返回前方的路点（约 40px 外），走不到就给 null。
   */
  function route(ex, ey, tx, ty) {
    /* 16px 格子 + 半径 3 的四点采样。
       半径必须**和碰撞半径一致**（杂兵 resolve 用的是 r*0.4 ≈ 2.2px）：
       按 11px 的"视觉半径"算，寻路会认为车堆彻底封死、直接放弃，
       而敌人其实挤得过去 —— 那样就变成"明明有缝，却站在缝边上不动"。 */
    var N = 12, RAD = 12;
    var cellFree = function (x, y) {
      if (insideSolid(x, y)) return false;
      return !insideSolid(x - 3, y) && !insideSolid(x + 3, y) &&
        !insideSolid(x, y - 3) && !insideSolid(x, y + 3);
    };
    var cx = Math.floor(ex / N), cy = Math.floor(ey / N);
    var w = RAD * 2 + 1;
    var startI = RAD * w + RAD;
    var parent = [], dist = [], i;
    for (i = 0; i < w * w; i++) { parent[i] = -1; dist[i] = -1; }

    var q = [startI], qi = 0;
    dist[startI] = 0;
    var bestI = -1, bestCost = 1e9;
    while (qi < q.length) {
      var ci = q[qi++];
      var gx = ci % w, gy = (ci - gx) / w;
      var wx = (cx - RAD + gx) * N + N * 0.5;
      var wy = (cy - RAD + gy) * N + N * 0.5;
      var dd = dist[ci];
      /* 代价 = 到玩家的直线距离 + 走过的格数（一步按 4px 算）。
         口袋里的格子虽然离玩家近，但要走十几步，会被这条路挡住。 */
      var cost = Math.sqrt((tx - wx) * (tx - wx) + (ty - wy) * (ty - wy)) + dd * 4;
      if (cost < bestCost) { bestCost = cost; bestI = ci; }
      for (var k = 0; k < 4; k++) {
        var nx = gx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        var ny = gy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= w) continue;
        var ni = ny * w + nx;
        if (dist[ni] >= 0) continue;
        if (!cellFree((cx - RAD + nx) * N + N * 0.5, (cy - RAD + ny) * N + N * 0.5)) continue;
        dist[ni] = dd + 1;
        parent[ni] = ci;
        q.push(ni);
      }
    }
    if (bestI < 0 || dist[bestI] === 0) return null;

    /* 沿父链回到起点，取前方第 2~4 格当路点（太近会原地蹭，太远会抄角）。
       优先选"直着能走到"的那一格；全被挡住就退回最近的一格，
       反正下一帧还会重算 —— 比在原地打转强。 */
    var chain = [bestI], guard = 0;
    while (parent[chain[chain.length - 1]] >= 0 && guard++ < 64) {
      chain.push(parent[chain[chain.length - 1]]);
    }
    var fallback = null;
    for (var hop = 4; hop >= 1; hop--) {
      if (hop >= chain.length) continue;
      var pick = chain[hop];
      var pgx = pick % w, pgy = (pick - pgx) / w;
      var px = (cx - RAD + pgx) * N + N * 0.5;
      var py = (cy - RAD + pgy) * N + N * 0.5;
      var pt = { x: px, y: py };
      if (!fallback) fallback = pt;
      var sx = px - ex, sy = py - ey;
      var sd = Math.sqrt(sx * sx + sy * sy) || 1;
      var steps = Math.ceil(sd / 7), blocked = false;
      for (var si = 2; si <= steps; si++) {
        if (!cellFree(ex + sx * (si / steps), ey + sy * (si / steps))) { blocked = true; break; }
      }
      if (!blocked) return pt;
    }
    return fallback;
  }

  /** 圆形实体推出建筑墙体 / 家具，再推出实心道具（就地修改 ent） */
  function resolve(ent, r, ox, oy) {
    var run = HS.Game && HS.Game.run;
    B.resolve(ent, r);
    /* 停着的载具也是实心的（自己开的那辆由载具模块内部跳过） */
    if (HS.Vehicle && HS.Vehicle.resolve) HS.Vehicle.resolve(ent, r);
    if (HS.Water && run) {
      HS.Water.resolve(ent, r, ox, oy, run);
      HS.Water.resolveWrecks(ent, r, ox, oy, run);
    }
    var cx = Math.floor(ent.x / CELL), cy = Math.floor(ent.y / CELL);
    for (var gx = cx - 1; gx <= cx + 1; gx++) {
      for (var gy = cy - 1; gy <= cy + 1; gy++) {
        var list = chunk(gx, gy);
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (!o.solid || o.broken) continue;
          if (o.ang) pushOutRot(ent, r, o);
          else pushOut(ent, r, o.bx0, o.by0, o.bx1, o.by1);
        }
      }
    }
  }

  /** 子弹遮挡：墙体 / 高家具 / 道具按 blockBullets 判定；门洞可以打过去 */
  function hitBlock(x, y, r, ignoreBld) {
    var bHit = B.hitBlock(x, y, r, ignoreBld);
    if (bHit) return bHit;
    if (HS.Water && HS.Game.run) {
      var wHit = HS.Water.hitBlock(x, y, r, HS.Game.run);
      if (wHit) return wHit;
    }

    var cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (var gx = cx - 1; gx <= cx + 1; gx++) {
      for (var gy = cy - 1; gy <= cy + 1; gy++) {
        var list = chunk(gx, gy);
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (!o.blockBullets || o.broken) continue;
          if (o.ang ? boxHit(x, y, r, o)
            : (x >= o.bx0 - r && x <= o.bx1 + r && y >= o.by0 - r && y <= o.by1 + r)) return o;
        }
      }
    }
    return null;
  }

  /** 点是否落在建筑 / 实心道具里（出生点纠偏用） */
  function insideSolid(x, y) {
    if (B.insideSolid(x, y)) return true;
    if (HS.Water && HS.Game.run && HS.Water.insideSolid(x, y, HS.Game.run)) return true;
    var list = chunk(Math.floor(x / CELL), Math.floor(y / CELL));
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o.solid || o.broken) continue;
      if (o.ang ? boxHit(x, y, 0, o) : (x >= o.bx0 && x <= o.bx1 && y >= o.by0 && y <= o.by1)) return true;
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
    if (HS.Water) HS.Water.smash(x, y, r, run, 45);
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
    TUN_HALF: TUN_HALF, TUN_WALL: TUN_WALL, TUN_ROAD: TUN_ROAD,
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
    pushOutRot: pushOutRot,
    boxHit: boxHit,
    hitBlock: hitBlock,
    insideSolid: insideSolid,
    nearLoot: nearLoot,
    accidentsIn: accidentsIn,
    route: route,
    accidentY: accidentY,
    accidentFire: accidentFire,
    firesIn: firesIn,
    ACC_GAP: 1152,
    smash: smash,
    buildingsInRect: buildingsInRect,
    isRoad: isRoad,
    isSidewalk: isSidewalk,
    tileKind: tileKind
  };

  HS.World = World;
})();
