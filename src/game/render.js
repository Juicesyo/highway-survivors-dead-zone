/**
 * 世界渲染：绘制到 320 x VH 的低分辨率缓冲，再由平台层放大
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;
  var P = HS.P;
  var S = HS.Sprites;

  var R = {};

  /* ---------------- 地图地面 ---------------- */

  /* ---------------- 末世街区：道路网格 ---------------- */

  /* ---------------- 末世街区：道路网格（按块缓存，渲染只做 blit） ---------------- */

  R._gcache = {};
  R._gcount = 0;

  /* ---------------- 破败街道的画笔 ---------------- */

  function ellipseFill(b, x, y, rx, ry, color) {
    if (rx < 0.5) rx = 0.5;
    b.save();
    b.translate(x, y);
    b.scale(1, ry / rx);
    b.beginPath();
    b.arc(0, 0, rx, 0, U.TAU);
    b.fillStyle = color;
    b.fill();
    b.restore();
  }

  /** 不规则裂缝：从 (x,y) 沿 ang 方向折线延伸 */
  function crack(b, x, y, ang, len, seed, salt, color, width) {
    var n = 5;
    var st = len / n;
    b.beginPath();
    b.moveTo(x, y);
    for (var i = 0; i < n; i++) {
      ang += (U.hash(seed, i + salt, 4409) - 0.5) * 0.95;
      x += Math.cos(ang) * st;
      y += Math.sin(ang) * st;
      b.lineTo(x, y);
    }
    b.strokeStyle = color;
    b.lineWidth = width || 1;
    b.stroke();
  }

  /** 碎砖 / 石块堆 */
  function rubble(b, x, y, count, seed, salt) {
    for (var i = 0; i < count; i++) {
      var rx = x + (U.hash(seed, i, salt) - 0.5) * 24;
      var ry = y + (U.hash(seed, i, salt + 1) - 0.5) * 15;
      var w2 = 1 + ((U.hash(seed, i, salt + 2) * 3) | 0);
      var h2 = 1 + ((U.hash(seed, i, salt + 3) * 2) | 0);
      b.fillStyle = i % 4 === 0 ? '#5a4b3d' : (i % 3 === 0 ? '#4a5057' : '#33383f');
      b.fillRect(rx | 0, ry | 0, w2, h2);
      if (w2 > 1) {
        b.fillStyle = 'rgba(255,255,255,0.05)';
        b.fillRect(rx | 0, ry | 0, w2, 1);
      }
    }
  }

  /** 从裂缝里长出来的枯草 */
  function weeds(b, x, y, count, seed, salt) {
    for (var i = 0; i < count; i++) {
      var wx = x + (U.hash(seed, i, salt) - 0.5) * 18;
      var h2 = 2 + U.hash(seed, i, salt + 1) * 5;
      b.strokeStyle = i % 3 === 0 ? 'rgba(96,126,60,0.60)' : 'rgba(66,92,44,0.68)';
      b.lineWidth = 1;
      b.beginPath();
      b.moveTo(wx, y);
      b.quadraticCurveTo(
        wx + (U.hash(seed, i, salt + 2) - 0.5) * 4, y - h2 * 0.6,
        wx + (U.hash(seed, i, salt + 3) - 0.5) * 7, y - h2
      );
      b.stroke();
    }
  }

  /** 干涸污渍 + 溅点（灰黑，代替血迹） */
  function bloodStain(b, x, y, r, seed, salt) {
    ellipseFill(b, x, y, r, r * 0.62, 'rgba(30,30,34,0.30)');
    ellipseFill(b, x + r * 0.42, y + r * 0.18, r * 0.52, r * 0.30, 'rgba(46,46,52,0.24)');
    for (var i = 0; i < 6; i++) {
      var a = U.hash(seed, i, salt) * U.TAU;
      var d = r * (0.7 + U.hash(seed, i, salt + 1) * 1.7);
      b.fillStyle = 'rgba(38,38,44,' + (0.14 + U.hash(seed, i, salt + 2) * 0.16).toFixed(2) + ')';
      b.fillRect((x + Math.cos(a) * d) | 0, (y + Math.sin(a) * d * 0.7) | 0, 1, 1);
    }
  }

  /** 路面坑洞：黑洞 + 破损边缘 + 放射裂缝 */
  function pothole(b, x, y, r, seed, salt) {
    ellipseFill(b, x + 1, y + 1, r + 1.5, (r + 1.5) * 0.62, 'rgba(150,158,168,0.06)');
    ellipseFill(b, x, y, r, r * 0.62, '#080a0d');
    ellipseFill(b, x - r * 0.2, y - r * 0.2, r * 0.5, r * 0.28, 'rgba(0,0,0,0.55)');
    for (var i = 0; i < 3; i++) {
      var a = U.hash(seed, i, salt) * U.TAU;
      crack(b, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.62,
        a, 6 + U.hash(seed, i, salt + 1) * 10, seed + i, salt + 30,
        'rgba(0,0,0,0.32)', 1);
    }
  }

  /** 垃圾桶 / 纸箱 / 散落垃圾 */
  function trashPile(b, x, y, seed) {
    var h = U.hash(seed, 3, 9901);
    if (h < 0.45) {
      /* 黑色垃圾袋 */
      ellipseFill(b, x, y, 5, 4, 'rgba(0,0,0,0.35)');
      ellipseFill(b, x, y - 1, 4.5, 3.6, '#1b1f26');
      b.fillStyle = '#2a3038';
      b.fillRect((x - 2) | 0, (y - 3) | 0, 3, 1);
      b.fillStyle = 'rgba(170,180,190,0.18)';
      b.fillRect((x - 1) | 0, (y - 4) | 0, 2, 1);
    } else if (h < 0.8) {
      /* 纸箱 */
      b.fillStyle = '#5a4630';
      b.fillRect((x - 5) | 0, (y - 4) | 0, 10, 8);
      b.fillStyle = '#6b5438';
      b.fillRect((x - 5) | 0, (y - 4) | 0, 10, 2);
      b.fillStyle = 'rgba(210,200,180,0.22)';
      b.fillRect((x - 1) | 0, (y - 4) | 0, 2, 8);
    } else {
      /* 散落纸张 */
      b.fillStyle = 'rgba(200,198,182,0.24)';
      b.fillRect((x - 6) | 0, y | 0, 5, 2);
      b.fillRect((x + 1) | 0, (y - 3) | 0, 4, 2);
      b.fillRect((x - 2) | 0, (y + 3) | 0, 3, 1);
    }
  }

  /** 倒在路边的路灯 / 指示牌 */
  function fallenPole(b, x, y, ang, len, seed) {
    var x1 = x + Math.cos(ang) * len;
    var y1 = y + Math.sin(ang) * len;
    b.strokeStyle = 'rgba(0,0,0,0.35)';
    b.lineWidth = 3;
    b.beginPath(); b.moveTo(x + 2, y + 2); b.lineTo(x1 + 2, y1 + 2); b.stroke();
    b.strokeStyle = '#3c434b';
    b.lineWidth = 2;
    b.beginPath(); b.moveTo(x, y); b.lineTo(x1, y1); b.stroke();
    b.strokeStyle = 'rgba(190,200,210,0.18)';
    b.lineWidth = 1;
    b.beginPath(); b.moveTo(x, y - 1); b.lineTo(x1, y1 - 1); b.stroke();
    /* 掉落的牌面 */
    b.save();
    b.translate(x1, y1);
    b.rotate(ang + 0.2);
    b.fillStyle = 'rgba(0,0,0,0.35)';
    b.fillRect(-6, -1, 13, 8);
    b.fillStyle = U.hash(seed, 7, 7707) < 0.5 ? '#3f5a46' : '#5a3f3a';
    b.fillRect(-6, -2, 12, 7);
    b.fillStyle = 'rgba(220,225,230,0.35)';
    b.fillRect(-4, 0, 7, 1);
    b.fillRect(-4, 2, 5, 1);
    b.restore();
    /* 根部碎块 */
    rubble(b, x, y, 4, seed, 8101);
  }

  /** 枯树：顶视只看到树冠与枝干 */
  function deadTree(b, x, y, r, seed) {
    b.fillStyle = 'rgba(0,0,0,0.22)';
    ellipseFill(b, x + 4, y + 5, r, r * 0.7, 'rgba(0,0,0,0.18)');
    b.strokeStyle = '#2f2a22';
    b.lineWidth = 2;
    b.beginPath();
    for (var i = 0; i < 5; i++) {
      var a = U.hash(seed, i, 6201) * U.TAU;
      b.moveTo(x, y);
      b.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8);
    }
    b.stroke();
    b.fillStyle = 'rgba(66,78,48,0.55)';
    for (var k = 0; k < 9; k++) {
      var aa = U.hash(seed, k + 11, 6203) * U.TAU;
      var dd = U.hash(seed, k + 12, 6205) * r;
      b.fillRect((x + Math.cos(aa) * dd) | 0, (y + Math.sin(aa) * dd * 0.8) | 0, 2, 2);
    }
    b.fillStyle = '#1b1a16';
    b.fillRect((x - 1) | 0, (y - 1) | 0, 3, 3);
  }

  /** 燃烧的油桶：废土里很常见的暖色光点 */
  function fireBarrel(b, x, y, seed) {
    var r = 26;
    var g = b.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(255,160,60,0.18)');
    g.addColorStop(0.5, 'rgba(255,120,40,0.07)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    b.fillStyle = g;
    b.fillRect(x - r, y - r, r * 2, r * 2);
    ellipseFill(b, x, y, 5, 4.4, 'rgba(0,0,0,0.35)');
    ellipseFill(b, x, y - 1, 4.4, 3.4, '#4a4038');
    ellipseFill(b, x, y - 1.5, 3.2, 2.6, '#2a2320');
    b.fillStyle = '#ff8b3d';
    b.fillRect((x - 2) | 0, (y - 4) | 0, 3, 3);
    b.fillStyle = '#ffd166';
    b.fillRect((x - 1) | 0, (y - 5) | 0, 2, 2);
    b.fillStyle = 'rgba(80,70,64,0.20)';
    ellipseFill(b, x + 2, y - 10, 4, 6, 'rgba(80,70,64,0.18)');
    b.fillStyle = 'rgba(255,255,255,0.12)';
    b.fillRect((x - 3) | 0, (y - 1) | 0, 1, 2);
  }

  /** 警戒线：两端的路障柱 + 中间下垂的黄黑胶带 */
  function policeTape(b, x, y, len, vertical, seed) {
    var x1 = vertical ? x : x + len;
    var y1 = vertical ? y + len : y;
    b.strokeStyle = 'rgba(0,0,0,0.30)';
    b.lineWidth = 3;
    b.beginPath(); b.moveTo(x + 1, y + 2);
    b.quadraticCurveTo((x + x1) / 2, (y + y1) / 2 + 3, x1 + 1, y1 + 2);
    b.stroke();
    b.strokeStyle = 'rgba(206,176,84,0.62)';
    b.lineWidth = 1.5;
    b.beginPath(); b.moveTo(x, y);
    b.quadraticCurveTo((x + x1) / 2, (y + y1) / 2 + 3, x1, y1);
    b.stroke();
    b.fillStyle = 'rgba(28,30,34,0.55)';
    for (var i = 0; i < len; i += 8) {
      var t = i / len;
      var mx = x + (x1 - x) * t;
      var my = y + (y1 - y) * t + Math.sin(t * Math.PI) * 3;
      b.fillRect(mx | 0, my | 0, vertical ? 1 : 2, vertical ? 2 : 1);
    }
    b.fillStyle = '#4a5058';
    b.fillRect((x - 1) | 0, (y - 1) | 0, 3, 3);
    b.fillRect((x1 - 1) | 0, (y1 - 1) | 0, 3, 3);
    b.fillStyle = 'rgba(255,255,255,0.18)';
    b.fillRect(x | 0, y | 0, 1, 1);
    b.fillRect(x1 | 0, y1 | 0, 1, 1);
  }

  /** 沙袋掩体：废土检查站的残骸 */
  function sandbagLine(b, x, y, len, vertical, seed) {
    var n = Math.max(2, (len / 5) | 0);
    for (var row = 0; row < 2; row++) {
      for (var i = 0; i < n; i++) {
        if (U.hash(seed, row * 31 + i, 6401) < 0.12) continue;
        var bx2 = vertical ? x + row * 4 + (row % 2) * 2 : x + i * 5;
        var by2 = vertical ? y + i * 5 : y + row * 4 + (row % 2) * 2;
        b.fillStyle = 'rgba(0,0,0,0.28)';
        b.fillRect((bx2 + 1) | 0, (by2 + 2) | 0, 5, 3);
        b.fillStyle = i % 3 === 0 ? '#6b5f45' : '#574d39';
        b.fillRect(bx2 | 0, by2 | 0, 5, 3);
        b.fillStyle = 'rgba(220,205,170,0.14)';
        b.fillRect(bx2 | 0, by2 | 0, 5, 1);
      }
    }
  }

  /** 尸体：一个不会站起来的剪影，配一滩血 */
  function corpse(b, x, y, ang, seed) {
    b.save();
    b.translate(x, y);
    b.rotate(ang);
    b.fillStyle = 'rgba(0,0,0,0.28)';
    b.fillRect(-9, -2, 17, 6);
    b.fillStyle = U.hash(seed, 1, 6501) < 0.5 ? '#3d4436' : '#3a3540';
    b.fillRect(-7, -3, 11, 6);
    b.fillStyle = '#2b2f28';
    b.fillRect(-10, -2, 4, 2);
    b.fillRect(-10, 1, 4, 2);
    b.fillRect(4, -4, 5, 2);
    b.fillRect(4, 2, 5, 2);
    b.fillStyle = '#a88466';
    b.fillRect(9, -2, 4, 4);
    b.fillStyle = '#2a2018';
    b.fillRect(10, -2, 2, 3);
    b.restore();
    bloodStain(b, x + 3, y + 2, 7, seed, 6503);
    for (var i = 0; i < 4; i++) {
      var a = U.hash(seed, i + 2, 6505) * U.TAU;
      b.fillStyle = 'rgba(80,18,18,0.22)';
      b.fillRect((x + Math.cos(a) * (8 + i * 2)) | 0, (y + Math.sin(a) * 5) | 0, 1, 1);
    }
  }

  /** 购物车：空荡荡地歪在路边 */
  function shoppingCart(b, x, y, seed) {
    var flip = U.hash(seed, 1, 6601) < 0.5 ? 1 : -1;
    b.strokeStyle = 'rgba(0,0,0,0.30)';
    b.lineWidth = 3;
    b.strokeRect(x - 7 + 2, y - 5 + 3, 15, 10);
    b.strokeStyle = '#8a939c';
    b.lineWidth = 1;
    b.strokeRect(x - 7, y - 5, 15, 10);
    b.beginPath();
    for (var i = -4; i <= 4; i += 4) {
      b.moveTo(x + i, y - 5); b.lineTo(x + i, y + 5);
      b.moveTo(x - 7, y + i * 0.8); b.lineTo(x + 8, y + i * 0.8);
    }
    b.stroke();
    b.strokeStyle = '#5a636c';
    b.beginPath();
    b.moveTo(x + flip * 8, y - 5); b.lineTo(x + flip * 11, y - 8);
    b.stroke();
    b.fillStyle = '#2a2e33';
    b.fillRect((x - 6) | 0, (y + 5) | 0, 2, 2);
    b.fillRect((x + 5) | 0, (y + 5) | 0, 2, 2);
  }

  /** 行李箱 / 背包 */
  function luggage(b, x, y, seed) {
    var col = U.hash(seed, 2, 6701) < 0.5 ? '#5a4a34' : '#3a4a56';
    b.fillStyle = 'rgba(0,0,0,0.28)';
    b.fillRect(x - 5, y - 2, 12, 7);
    b.fillStyle = col;
    b.fillRect(x - 6, y - 4, 11, 7);
    b.fillStyle = 'rgba(255,255,255,0.09)';
    b.fillRect(x - 6, y - 4, 11, 1);
    b.fillStyle = '#2a241c';
    b.fillRect(x - 2, y - 4, 2, 7);
    b.fillRect(x + 3, y - 4, 1, 7);
    b.strokeStyle = '#8a7a5c';
    b.lineWidth = 1;
    b.beginPath(); b.moveTo(x - 1, y - 4); b.lineTo(x - 1, y - 7); b.stroke();
  }

  /** 焦痕：烧过的地面 */
  function scorch(b, x, y, r, seed) {
    ellipseFill(b, x, y, r, r * 0.6, 'rgba(8,8,8,0.28)');
    ellipseFill(b, x, y, r * 0.6, r * 0.35, 'rgba(0,0,0,0.22)');
    for (var i = 0; i < 7; i++) {
      var a = U.hash(seed, i, 6801) * U.TAU;
      var d = U.hash(seed, i, 6803) * r;
      b.fillStyle = i % 3 === 0 ? 'rgba(110,100,88,0.18)' : 'rgba(30,28,26,0.30)';
      b.fillRect((x + Math.cos(a) * d) | 0, (y + Math.sin(a) * d * 0.6) | 0, 2, 1);
    }
  }

  /** 拖拽污迹：一条断断续续的灰黑拖痕 */
  function bloodTrail(b, x, y, ang, len, seed) {
    for (var i = 0; i < len; i += 5) {
      var t = i / len;
      var bx2 = x + Math.cos(ang) * i + Math.sin(i * 0.7 + seed) * 2;
      var by2 = y + Math.sin(ang) * i + Math.cos(i * 0.9 + seed) * 2;
      b.fillStyle = 'rgba(30,30,34,' + (0.10 + 0.12 * (1 - t)).toFixed(2) + ')';
      b.fillRect(bx2 | 0, by2 | 0, 2 + (i % 3 === 0 ? 1 : 0), 1 + (i % 4 === 0 ? 1 : 0));
    }
  }

  /** 倒塌的矮墙 / 围栏：给空地一点轮廓 */
  function wreckWall(b, x, y, len, ang, seed) {
    var x1 = x + Math.cos(ang) * len;
    var y1 = y + Math.sin(ang) * len;
    b.strokeStyle = 'rgba(0,0,0,0.25)';
    b.lineWidth = 4;
    b.beginPath(); b.moveTo(x + 2, y + 3); b.lineTo(x1 + 2, y1 + 3); b.stroke();
    b.strokeStyle = '#4a4f56';
    b.lineWidth = 3;
    b.beginPath(); b.moveTo(x, y); b.lineTo(x1, y1); b.stroke();
    b.strokeStyle = '#6c727a';
    b.lineWidth = 1;
    b.beginPath(); b.moveTo(x, y - 1); b.lineTo(x1, y1 - 1); b.stroke();
    /* 断口 / 砖块 */
    for (var i = 0; i < 5; i++) {
      var t = U.hash(seed, i, 6301);
      b.fillStyle = i % 2 === 0 ? '#5a5148' : '#3e444b';
      b.fillRect((x + (x1 - x) * t + U.hash(seed, i, 6303) * 5) | 0,
        (y + (y1 - y) * t + U.hash(seed, i, 6305) * 4) | 0,
        2 + ((U.hash(seed, i, 6307) * 2) | 0), 2);
    }
    b.strokeStyle = 'rgba(120,86,58,0.55)';
    b.lineWidth = 1;
    b.beginPath();
    b.moveTo(x + (x1 - x) * 0.35, y + (y1 - y) * 0.35);
    b.lineTo(x + (x1 - x) * 0.35 + 5, y + (y1 - y) * 0.35 - 4);
    b.stroke();
  }

  /** 完整路灯：顶视只看到基座 + 光池 */
  function streetLamp(b, x, y, seed) {
    var r = 24;
    var g = b.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(255,214,146,0.11)');
    g.addColorStop(0.55, 'rgba(255,200,120,0.045)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    b.fillStyle = g;
    b.fillRect(x - r, y - r, r * 2, r * 2);
    b.fillStyle = 'rgba(0,0,0,0.30)';
    b.beginPath(); b.arc(x + 9, y + 11, 3.4, 0, U.TAU); b.fill();
    ellipseFill(b, x, y, 4.2, 3.4, '#22272d');
    ellipseFill(b, x, y - 0.6, 3.4, 2.6, '#4b525a');
    b.fillStyle = 'rgba(255,220,160,0.55)';
    b.fillRect((x - 1) | 0, (y - 2) | 0, 2, 1);
    b.fillStyle = 'rgba(255,255,255,0.22)';
    b.fillRect((x - 2) | 0, (y - 3) | 0, 1, 1);
    /* 基座螺栓 */
    b.fillStyle = '#6a717a';
    b.fillRect((x - 4) | 0, (y + 1) | 0, 1, 1);
    b.fillRect((x + 4) | 0, (y + 1) | 0, 1, 1);
  }

  /** 绘制一个 384x384 街区块（绝对坐标，可被缓存画布平移复用） */
  R.streetBlock = function (b, bx, by) {
    var W = HS.World;
    var BL = W.BLOCK, RD = W.ROAD, SW = W.WALK;
    var sx = Math.round(bx / BL), sy = Math.round(by / BL);
    var h0 = function (i, s) { return U.hash(sx, sy, i * 131 + s); };

    /* ---------- 0. 街区（空地 / 废土） ---------- */
    b.fillStyle = '#2c323a';
    b.fillRect(bx, by, BL, BL);

    /* 裸土、积水、碎砖、荒草 */
    for (var d0 = 0; d0 < 10; d0++) {
      var dx0 = bx + RD + SW + 16 + h0(d0, 1) * (BL - RD - SW - 32);
      var dy0 = by + RD + SW + 16 + h0(d0, 2) * (BL - RD - SW - 32);
      var rad0 = 6 + h0(d0, 3) * 16;
      if (d0 % 3 === 0) {
        ellipseFill(b, dx0, dy0, rad0, rad0 * 0.55, 'rgba(58,50,38,0.28)');
        b.fillStyle = 'rgba(30,26,20,0.20)';
        b.fillRect((dx0 - rad0 * 0.5) | 0, (dy0 - 1) | 0, (rad0 * 0.8) | 0, 2);
      } else if (d0 % 3 === 1) {
        ellipseFill(b, dx0, dy0, rad0 * 0.7, rad0 * 0.38, 'rgba(18,22,28,0.25)');
        b.fillStyle = 'rgba(100,132,150,0.05)';
        b.fillRect((dx0 - rad0 * 0.3) | 0, (dy0 - 1) | 0, (rad0 * 0.5) | 0, 1);
      } else {
        b.fillStyle = 'rgba(0,0,0,0.16)';
        b.fillRect(dx0 | 0, dy0 | 0, 10, 7);
      }
    }
    for (var rb = 0; rb < 13; rb++) {
      rubble(b, bx + RD + SW + 18 + h0(rb, 4) * (BL - RD - SW - 36),
        by + RD + SW + 18 + h0(rb, 5) * (BL - RD - SW - 36),
        3 + ((h0(rb, 6) * 5) | 0), sx * 977 + rb, 510 + rb);
    }
    for (var wd = 0; wd < 9; wd++) {
      weeds(b, bx + RD + SW + 14 + h0(wd, 7) * (BL - RD - SW - 28),
        by + RD + SW + 14 + h0(wd, 8) * (BL - RD - SW - 28),
        2 + ((h0(wd, 9) * 4) | 0), sx * 613 + wd, 620 + wd);
    }
    bloodStain(b, bx + RD + SW + 30 + h0(0, 10) * (BL - RD - SW - 60),
      by + RD + SW + 30 + h0(1, 10) * (BL - RD - SW - 60), 7, sx * 31 + 5, 711);

    /* 枯树 / 燃烧的油桶 / 倒塌的围墙：让空地有明确的剪影 */
    for (var tr2 = 0; tr2 < 2; tr2++) {
      if (h0(tr2, 11) < 0.42) continue;
      deadTree(b, bx + RD + SW + 24 + h0(tr2, 12) * (BL - RD - SW - 48),
        by + RD + SW + 24 + h0(tr2, 13) * (BL - RD - SW - 48),
        8 + h0(tr2, 14) * 7, sx * 43 + tr2);
    }
    if (h0(3, 15) > 0.64) {
      fireBarrel(b, bx + RD + SW + 26 + h0(3, 16) * (BL - RD - SW - 52),
        by + RD + SW + 26 + h0(3, 17) * (BL - RD - SW - 52), sx * 47 + 3);
    }
    if (h0(5, 18) > 0.55) {
      wreckWall(b, bx + RD + SW + 20 + h0(5, 19) * (BL - RD - SW - 100),
        by + RD + SW + 20 + h0(5, 20) * (BL - RD - SW - 40),
        24 + h0(5, 21) * 32, h0(5, 22) > 0.5 ? 0.25 : 1.35, sx * 51 + 7);
    }
    if (h0(6, 23) > 0.62) {
      sandbagLine(b, bx + RD + SW + 22 + h0(6, 24) * (BL - RD - SW - 70),
        by + RD + SW + 22 + h0(6, 25) * (BL - RD - SW - 46),
        18 + h0(6, 26) * 24, h0(6, 27) > 0.5, sx * 57 + 11);
    }
    /* 尸骸 / 遗物 / 焦痕：让空地读起来像「有人死在这里」 */
    if (h0(8, 30) > 0.48) {
      corpse(b, bx + RD + SW + 26 + h0(8, 31) * (BL - RD - SW - 52),
        by + RD + SW + 26 + h0(8, 32) * (BL - RD - SW - 52),
        h0(8, 33) * U.TAU, sx * 61 + 13);
    }
    if (h0(9, 34) > 0.62) {
      shoppingCart(b, bx + RD + SW + 24 + h0(9, 35) * (BL - RD - SW - 48),
        by + RD + SW + 24 + h0(9, 36) * (BL - RD - SW - 48), sx * 63 + 17);
    }
    for (var lg = 0; lg < 2; lg++) {
      if (h0(lg, 37) < 0.5) continue;
      luggage(b, bx + RD + SW + 20 + h0(lg, 38) * (BL - RD - SW - 40),
        by + RD + SW + 20 + h0(lg, 39) * (BL - RD - SW - 40), sx * 69 + lg);
    }
    for (var sc = 0; sc < 2; sc++) {
      scorch(b, bx + RD + SW + 30 + h0(sc, 40) * (BL - RD - SW - 60),
        by + RD + SW + 30 + h0(sc, 41) * (BL - RD - SW - 60),
        7 + h0(sc, 42) * 9, sx * 73 + sc);
    }
    if (h0(10, 43) > 0.4) {
      bloodTrail(b, bx + RD + SW + 20 + h0(10, 44) * (BL - RD - SW - 100),
        by + RD + SW + 20 + h0(10, 45) * (BL - RD - SW - 40),
        h0(10, 46) * U.TAU, 26 + h0(10, 47) * 30, sx + 10);
    }

    /* ---------- 1. 人行道 ---------- */
    b.fillStyle = '#414851';
    b.fillRect(bx + RD, by, SW, BL);
    b.fillRect(bx, by + RD, BL, SW);

    /* 地砖：缺角 / 裂缝 / 污渍 / 草 */
    var TS = 24;
    for (var ty = by + RD; ty < by + RD + SW; ty += TS) {
      for (var tx = bx; tx < bx + BL; tx += TS) {
        var th = U.hash(Math.floor(tx / TS), Math.floor(ty / TS), 881);
        if (th > 0.92) {
          /* 整块塌陷 */
          b.fillStyle = '#1b1f24';
          b.fillRect(tx + 2, ty + 2, TS - 4, TS - 4);
          rubble(b, tx + 10, ty + 10, 4, (tx | 0) + (ty | 0), 990);
        } else if (th > 0.85) {
          crack(b, tx + 3, ty + 6, 0.4, 14, tx | 0, ty | 0, 'rgba(0,0,0,0.28)', 1);
        } else if (th > 0.78) {
          b.fillStyle = 'rgba(10,12,15,0.18)';
          b.fillRect(tx + 4, ty + 3, 13, 8);
        } else if (th > 0.72) {
          weeds(b, tx + 5, ty + TS - 2, 2, (tx | 0) + 7, 991);
        }
        if (th < 0.16) {
          b.fillStyle = 'rgba(255,255,255,0.022)';
          b.fillRect(tx + 2, ty + 2, TS - 4, TS - 4);
        }
      }
    }
    for (var ty2 = by + RD; ty2 < by + RD + SW; ty2 += TS) {
      for (var tx2 = bx + RD; tx2 < bx + RD + SW; tx2 += TS) {
        var th2 = U.hash(Math.floor(tx2 / TS), Math.floor(ty2 / TS), 883);
        if (th2 > 0.92) {
          b.fillStyle = '#1b1f24';
          b.fillRect(tx2 + 2, ty2 + 2, TS - 4, TS - 4);
          rubble(b, tx2 + 10, ty2 + 10, 4, (tx2 | 0) + (ty2 | 0), 992);
        } else if (th2 > 0.85) {
          crack(b, tx2 + 4, ty2 + 4, 1.2, 15, tx2 | 0, ty2 | 0, 'rgba(0,0,0,0.28)', 1);
        } else if (th2 > 0.78) {
          b.fillStyle = 'rgba(10,12,15,0.18)';
          b.fillRect(tx2 + 3, ty2 + 6, 9, 12);
        } else if (th2 > 0.72) {
          weeds(b, tx2 + TS - 2, ty2 + 6, 2, (tx2 | 0) + 11, 993);
        }
      }
    }

    /* 砖缝 */
    b.fillStyle = 'rgba(0,0,0,0.13)';
    for (var gy = by; gy < by + BL; gy += TS) b.fillRect(bx + RD, gy, SW, 1);
    for (var gx = bx; gx < bx + BL; gx += TS) b.fillRect(gx, by + RD, 1, SW);

    /* 路缘石：亮线 + 崩口 */
    for (var cy = by; cy < by + BL; cy += 12) {
      var ch = U.hash(sx, (cy / 12) | 0, 921);
      if (ch < 0.18) continue;
      b.fillStyle = 'rgba(226,232,238,' + (0.06 + ch * 0.07).toFixed(2) + ')';
      b.fillRect(bx + RD + SW - 2, cy, 2, 10);
    }
    for (var cx = bx; cx < bx + BL; cx += 12) {
      var ch2 = U.hash((cx / 12) | 0, sy, 923);
      if (ch2 < 0.18) continue;
      b.fillStyle = 'rgba(226,232,238,' + (0.06 + ch2 * 0.07).toFixed(2) + ')';
      b.fillRect(cx, by + RD + SW - 2, 10, 2);
    }

    /* 人行道上的垃圾、碎玻璃、落叶 */
    for (var tr = 0; tr < 6; tr++) {
      var trx, try2;
      if (tr % 2 === 0) {
        trx = bx + 14 + h0(tr, 20) * (BL - 28);
        try2 = by + RD + 5 + h0(tr, 21) * (SW - 10);
      } else {
        trx = bx + RD + 5 + h0(tr, 22) * (SW - 10);
        try2 = by + 18 + h0(tr, 23) * (BL - 36);
      }
      trashPile(b, trx, try2, sx * 71 + tr + 3);
    }
    for (var gl = 0; gl < 3; gl++) {
      var glx = bx + RD + 4 + h0(gl, 24) * (SW - 8);
      var gly = by + 20 + h0(gl, 25) * (BL - 40);
      b.fillStyle = 'rgba(160,214,228,0.28)';
      b.fillRect(glx | 0, gly | 0, 1, 1);
      b.fillRect((glx + 2) | 0, (gly + 1) | 0, 1, 1);
      b.fillRect((glx - 1) | 0, (gly + 2) | 0, 1, 1);
    }

    /* ---------- 2. 车行道 ---------- */
    b.fillStyle = '#1c2026';
    b.fillRect(bx, by, RD, BL);
    b.fillRect(bx, by, BL, RD);

    /* 沥青补丁：颜色略深 / 略浅的修补块 */
    for (var pt = 0; pt < 6; pt++) {
      var ptx, pty, ptw, pth;
      if (pt % 2 === 0) {
        ptx = bx + 5 + h0(pt, 30) * (RD - 30);
        pty = by + 20 + h0(pt, 31) * (BL - 40);
        ptw = 14 + h0(pt, 32) * 30;
        pth = 8 + h0(pt, 33) * 20;
      } else {
        ptx = bx + 20 + h0(pt, 34) * (BL - 40);
        pty = by + 5 + h0(pt, 35) * (RD - 30);
        ptw = 8 + h0(pt, 36) * 20;
        pth = 14 + h0(pt, 37) * 30;
      }
      b.fillStyle = pt % 3 === 0 ? 'rgba(38,43,50,0.55)' : 'rgba(8,10,13,0.35)';
      b.fillRect(ptx | 0, pty | 0, ptw | 0, pth | 0);
      b.strokeStyle = 'rgba(0,0,0,0.22)';
      b.lineWidth = 1;
      b.strokeRect((ptx | 0) + 0.5, (pty | 0) + 0.5, (ptw | 0), (pth | 0));
    }

    /* 沥青裂缝：沿车道延伸的长裂缝 + 分支 */
    for (var cr = 0; cr < 8; cr++) {
      var crx = bx + 4 + h0(cr, 40) * (BL - 8);
      var cry = by + 4 + h0(cr, 41) * (BL - 8);
      var ca = h0(cr, 42) * U.TAU;
      crack(b, crx, cry, ca, 16 + h0(cr, 43) * 30, sx * 37 + cr, 740, 'rgba(0,0,0,0.32)', 1);
      if (h0(cr, 44) > 0.5) {
        crack(b, crx + 5, cry + 4, ca + 1.2, 8 + h0(cr, 45) * 12, sx * 41 + cr, 741, 'rgba(0,0,0,0.25)', 1);
      }
    }

    /* 坑洞 */
    for (var ph = 0; ph < 4; ph++) {
      var phx, phy;
      if (ph % 2 === 0) {
        phx = bx + 10 + h0(ph, 50) * (RD - 20);
        phy = by + 20 + h0(ph, 51) * (BL - 40);
      } else {
        phx = bx + 24 + h0(ph, 52) * (BL - 48);
        phy = by + 10 + h0(ph, 53) * (RD - 20);
      }
      pothole(b, phx, phy, 3 + h0(ph, 54) * 6, sx * 53 + ph, 750);
    }

    /* 轮胎刹车痕 */
    for (var sk = 0; sk < 2; sk++) {
      var skx = bx + 16 + h0(sk, 60) * (RD - 32);
      var sky = by + 30 + h0(sk, 61) * (BL - 60);
      b.strokeStyle = 'rgba(0,0,0,0.24)';
      b.lineWidth = 2;
      b.beginPath();
      b.moveTo(skx, sky);
      b.quadraticCurveTo(skx + 8, sky + 14, skx + 3, sky + 30);
      b.stroke();
      b.strokeStyle = 'rgba(0,0,0,0.17)';
      b.beginPath();
      b.moveTo(skx + 5, sky);
      b.quadraticCurveTo(skx + 13, sky + 14, skx + 8, sky + 30);
      b.stroke();
    }

    /* 车道边线：磨损成一段一段 */
    for (var ey = by; ey < by + BL; ey += 12) {
      var eh = U.hash(sx, (ey / 12) | 0, 931);
      if (eh < 0.24) continue;
      b.fillStyle = 'rgba(226,232,238,' + (0.04 + eh * 0.06).toFixed(2) + ')';
      b.fillRect(bx + 4, ey, 1, 10);
      b.fillRect(bx + RD - 5, ey, 1, 10);
    }
    for (var ex = bx; ex < bx + BL; ex += 12) {
      var eh2 = U.hash((ex / 12) | 0, sy, 933);
      if (eh2 < 0.24) continue;
      b.fillStyle = 'rgba(226,232,238,' + (0.04 + eh2 * 0.06).toFixed(2) + ')';
      b.fillRect(ex, by + 4, 10, 1);
      b.fillRect(ex, by + RD - 5, 10, 1);
    }

    /* 中线（双黄虚线）：掉漆 */
    for (var dy = by; dy < by + BL; dy += 44) {
      var dh = U.hash(sx, (dy / 44) | 0, 941);
      if (dh > 0.16) {
        b.fillStyle = 'rgba(206,176,84,' + (0.12 + dh * 0.16).toFixed(2) + ')';
        b.fillRect(bx + (RD >> 1) - 3, dy + 8, 2, 22);
        b.fillRect(bx + (RD >> 1) + 1, dy + 8, 2, 22);
        b.fillStyle = 'rgba(206,176,84,0.10)';
        b.fillRect(bx + (RD >> 1) - 3, dy + 30, 2, 4);
      }
    }
    for (var dx = bx; dx < bx + BL; dx += 44) {
      var dh2 = U.hash((dx / 44) | 0, sy, 943);
      if (dh2 > 0.16) {
        b.fillStyle = 'rgba(206,176,84,' + (0.12 + dh2 * 0.16).toFixed(2) + ')';
        b.fillRect(dx + 8, by + (RD >> 1) - 3, 22, 2);
        b.fillRect(dx + 8, by + (RD >> 1) + 1, 22, 2);
        b.fillStyle = 'rgba(206,176,84,0.10)';
        b.fillRect(dx + 30, by + (RD >> 1) - 3, 4, 2);
      }
    }

    /* 封路警戒线：横跨车道，已经被风吹得下垂 */
    if (h0(7, 28) > 0.58) {
      if (h0(7, 29) > 0.5) policeTape(b, bx + RD * 0.5, by + 8, RD - 16, true, sx * 67 + 5);
      else policeTape(b, bx + 8, by + RD * 0.5, RD - 16, false, sx * 67 + 9);
    }

    /* 路口斑马线：被轮胎磨掉大半 */
    for (var cw = 6; cw < RD - 6; cw += 13) {
      var cwh = U.hash(sx, sy * 17 + cw, 951);
      if (cwh < 0.22) continue;
      b.fillStyle = 'rgba(226,232,238,' + (0.06 + cwh * 0.11).toFixed(2) + ')';
      b.fillRect(bx + cw, by + RD + 6, 8, 18);
      b.fillRect(bx + RD + 6, by + cw, 18, 8);
    }

    /* ---------- 3. 路边设施 ---------- */
    /* 井盖 / 雨水篦子 */
    var mh = U.hash(sx, sy, 913);
    if (mh > 0.42) {
      var mhx = bx + RD + SW + 20 + mh * 52;
      var mhy = by + RD + SW + 20 + mh * 80;
      ellipseFill(b, mhx, mhy, 7, 6, 'rgba(0,0,0,0.28)');
      ellipseFill(b, mhx, mhy, 5.5, 4.6, '#33383f');
      b.strokeStyle = 'rgba(150,158,168,0.20)';
      b.lineWidth = 1;
      b.beginPath(); b.arc(mhx, mhy, 4, 0, U.TAU); b.stroke();
      b.fillStyle = 'rgba(0,0,0,0.30)';
      for (var mhb = -3; mhb <= 3; mhb += 2) b.fillRect((mhx + mhb) | 0, (mhy - 3) | 0, 1, 6);
    }
    if (mh < 0.5) {
      var grx = bx + RD + 3;
      var gry = by + 30 + mh * 160;
      b.fillStyle = 'rgba(0,0,0,0.35)';
      b.fillRect(grx, gry, 9, 14);
      b.fillStyle = '#272c33';
      b.fillRect(grx + 1, gry + 1, 7, 12);
      b.fillStyle = 'rgba(120,128,138,0.18)';
      for (var gb = 0; gb < 4; gb++) b.fillRect(grx + 2, gry + 2 + gb * 3, 5, 1);
      weeds(b, grx + 4, gry + 14, 2, sx * 19, 961);
    }

    /* 路灯：每块街区 1~2 盏，光池照亮人行道 */
    var lampN = 1 + (h0(0, 70) > 0.6 ? 1 : 0);
    for (var lp = 0; lp < lampN; lp++) {
      var lx, ly;
      if (h0(lp, 71) < 0.5) {
        lx = bx + RD + SW - 10;
        ly = by + 40 + h0(lp, 72) * (BL - 80);
      } else {
        lx = bx + 40 + h0(lp, 73) * (BL - 80);
        ly = by + RD + SW - 10;
      }
      streetLamp(b, lx, ly, sx * 13 + lp);
    }

    /* 倒下的路牌 / 灯杆 */
    if (h0(4, 80) > 0.55) {
      var fpx = bx + RD + 8 + h0(4, 81) * (SW - 16);
      var fpy = by + 60 + h0(4, 82) * (BL - 120);
      fallenPole(b, fpx, fpy, h0(4, 83) > 0.5 ? 1.3 : 1.8, 26 + h0(4, 84) * 18, sx * 17 + 9);
    }

    bloodStain(b, bx + RD + 10 + h0(5, 90) * (RD - 20), by + 30 + h0(5, 91) * (BL - 60), 5, sx * 23 + 3, 971);
    if (h0(6, 92) > 0.5) {
      bloodStain(b, bx + RD + SW + 20 + h0(6, 93) * (BL - RD - SW - 40),
        by + RD + SW + 20 + h0(6, 94) * (BL - RD - SW - 40), 8, sx * 29 + 7, 973);
    }
  };

  R.street = function (b, cx, cy, vw, vh) {
    var W = HS.World;
    var BL = W.BLOCK;
    var x0 = Math.floor(cx / BL) * BL - BL;
    var y0 = Math.floor(cy / BL) * BL - BL;
    var x1 = cx + vw + BL, y1 = cy + vh + BL;

    for (var bx = x0; bx < x1; bx += BL) {
      for (var by = y0; by < y1; by += BL) {
        var key = bx + '|' + by;
        var cv = R._gcache[key];
        if (!cv) {
          if (R._gcount > 40) { R._gcache = {}; R._gcount = 0; }
          cv = HS.P.createCanvas(BL, BL);
          var c = cv.getContext('2d');
          c.translate(-bx, -by);
          R.streetBlock(c, bx, by);
          R._gcache[key] = cv;
          R._gcount++;
        }
        b.drawImage(cv, bx, by);
      }
    }
  };

  /* ---------------- 荒漠公路地面 ---------------- */

  /**
   * 一条笔直公路的地面。
   *
   * 没有十字路网：路面固定在 x=0 两侧（宽 ROAD），沿 y 方向无限延伸，
   * 所以每个 384 区块只需要画「自己那一段」—— 靠 x 轴裁剪，
   * 于是同一条路穿过无数区块也能严丝合缝地接上。
   *
   * 除了柏油本身，还铺了这些"荒野感"：路肩砾石、被风吹上路面的沙、
   * 晒裂的路面、褪成土黄的中线、歪掉的里程桩。
   */
  R.desertBlock = function (b, bx, by) {
    var W = HS.World;
    var BL = W.BLOCK, RD = W.ROAD;
    var sx = Math.round(bx / BL), sy = Math.round(by / BL);
    var h0 = function (i, s) { return U.hash(sx, sy, i * 149 + s); };
    var half = RD * 0.5;
    var i, x;

    /* ---------- 0. 沙地 ---------- */
    b.fillStyle = '#4a3b24';
    b.fillRect(bx, by, BL, BL);

    /* 沙丘的明暗带：横向拉长的椭圆，让地面有起伏而不是一块纯色。
       透明度压得很低 —— 太明显就变成一坨坨污渍了 */
    for (i = 0; i < 14; i++) {
      var dx = bx + h0(i, 1) * BL;
      var dy = by + h0(i, 2) * BL;
      var rx = 34 + h0(i, 3) * 82;
      var ry = 9 + h0(i, 4) * 16;
      ellipseFill(b, dx, dy, rx, ry, i % 2 ? 'rgba(118,98,58,0.14)' : 'rgba(40,32,19,0.18)');
    }
    /* 风纹：一道一道平行的细沙脊，荒漠最有辨识度的纹理 */
    for (i = 0; i < 16; i++) {
      var rx0b = bx + h0(i, 55) * BL;
      var ry0b = by + h0(i, 56) * BL;
      var rln = 18 + h0(i, 57) * 46;
      var rang = -0.22 + h0(i, 58) * 0.44;
      b.strokeStyle = 'rgba(118,100,64,0.13)';
      b.lineWidth = 1;
      b.beginPath();
      b.moveTo(rx0b, ry0b);
      b.quadraticCurveTo(rx0b + rln * 0.5, ry0b + rang * rln * 0.4,
        rx0b + rln * Math.cos(rang), ry0b + rln * Math.sin(rang));
      b.stroke();
      b.strokeStyle = 'rgba(34,27,16,0.16)';
      b.beginPath();
      b.moveTo(rx0b + 1, ry0b + 1);
      b.quadraticCurveTo(rx0b + rln * 0.5 + 1, ry0b + rang * rln * 0.4 + 1,
        rx0b + rln * Math.cos(rang) + 1, ry0b + rln * Math.sin(rang) + 1);
      b.stroke();
    }
    /* 砂砾：一层细点，越靠路越密 */
    for (i = 0; i < 150; i++) {
      var px = bx + h0(i, 5) * BL;
      var py = by + h0(i, 6) * BL;
      var tone = h0(i, 7);
      b.fillStyle = tone > 0.76 ? 'rgba(178,156,110,0.22)'
        : (tone > 0.42 ? 'rgba(26,20,13,0.34)' : 'rgba(110,94,62,0.34)');
      b.fillRect(px | 0, py | 0, 1, 1);
    }
    /* 晒裂的泥壳 */
    for (i = 0; i < 5; i++) {
      crack(b, bx + h0(i, 8) * BL, by + h0(i, 9) * BL, h0(i, 10) * 1.5,
        12 + h0(i, 11) * 24, sx * 41 + i, 3200, 'rgba(24,18,11,0.32)', 1);
    }
    /* 干枯的草簇 / 风滚草的碎枝 */
    for (i = 0; i < 10; i++) {
      var tx = bx + 10 + h0(i, 12) * (BL - 20);
      var ty = by + 10 + h0(i, 13) * (BL - 20);
      if (Math.abs(tx) < half + 12) continue;
      var ln = 2 + ((h0(i, 14) * 3) | 0);
      b.strokeStyle = 'rgba(120,104,68,0.55)';
      b.lineWidth = 1;
      b.beginPath();
      for (var k = 0; k < 4; k++) {
        var aa = h0(i, 15 + k) * U.TAU;
        b.moveTo(tx, ty);
        b.lineTo(tx + Math.cos(aa) * ln, ty + Math.sin(aa) * ln * 0.7);
      }
      b.stroke();
    }
    /* 晒白的骨头：荒野里到处都是，一眼就知道这里没人管 */
    for (i = 0; i < 2; i++) {
      if (h0(i, 20) < 0.55) continue;
      var bx2 = bx + 20 + h0(i, 21) * (BL - 40);
      var by2 = by + 20 + h0(i, 22) * (BL - 40);
      if (Math.abs(bx2) < half + 8) continue;
      b.fillStyle = 'rgba(198,186,152,0.5)';
      b.fillRect(bx2 | 0, by2 | 0, 3, 1);
      b.fillRect((bx2 + 4) | 0, (by2 + 1) | 0, 2, 1);
      b.fillStyle = 'rgba(38,30,20,0.35)';
      b.fillRect((bx2 + 1) | 0, (by2 + 1) | 0, 1, 1);
    }

    /* ---------- 1. 路肩砾石 ---------- */
    var shoulder = 11;
    for (i = 0; i < 2; i++) {
      var a = i === 0 ? -half - shoulder : half;
      var bb = i === 0 ? -half : half + shoulder;
      var xa = Math.max(bx, a), xb2 = Math.min(bx + BL, bb);
      if (xb2 <= xa) continue;
      b.fillStyle = '#413724';
      b.fillRect(xa, by, xb2 - xa, BL);
      /* 砾石颗粒 */
      for (var g = 0; g < 26; g++) {
        var gx = xa + h0(g + i * 40, 30) * (xb2 - xa);
        var gy = by + h0(g + i * 40, 31) * BL;
        b.fillStyle = h0(g + i * 40, 32) > 0.5 ? 'rgba(120,106,76,0.5)' : 'rgba(24,19,12,0.45)';
        b.fillRect(gx | 0, gy | 0, 1, 1);
      }
    }

    /* ---------- 2. 沥青路面 ---------- */
    var rx0 = Math.max(bx, -half), rx1 = Math.min(bx + BL, half);
    if (rx1 <= rx0) return;
    var rw = rx1 - rx0;

    b.fillStyle = '#282219';
    b.fillRect(rx0, by, rw, BL);
    /* 路基边缘：一条被沙磨白的窄边，把"路面比沙地高一点"读出来 */
    b.fillStyle = 'rgba(150,138,106,0.12)';
    if (rx0 <= -half + 1) b.fillRect(-half, by, 1, BL);
    if (rx1 >= half - 1) b.fillRect(half - 1, by, 1, BL);

    /* 补丁：被反复修补过的老路。颜色只差一点点，靠轮廓而不是深色块 */
    for (i = 0; i < 4; i++) {
      var pw = 20 + h0(i, 40) * 40;
      var ph = 14 + h0(i, 41) * 34;
      var pxx = rx0 + h0(i, 42) * Math.max(1, rw - pw);
      var pyy = by + h0(i, 43) * (BL - ph);
      b.fillStyle = i % 2 ? 'rgba(44,38,30,0.35)' : 'rgba(18,15,11,0.22)';
      b.fillRect(pxx | 0, pyy | 0, pw | 0, ph | 0);
    }
    /* 沥青颗粒：撒一层很淡的亮点，路面才不会是一块死板的纯色 */
    for (i = 0; i < 120; i++) {
      var gx3 = rx0 + h0(i, 60) * rw;
      var gy3 = by + h0(i, 61) * BL;
      b.fillStyle = h0(i, 62) > 0.5 ? 'rgba(120,110,94,0.10)' : 'rgba(0,0,0,0.16)';
      b.fillRect(gx3 | 0, gy3 | 0, 1, 1);
    }

    /* 裂缝：太阳晒了几十年，路面全是蛛网 */
    for (i = 0; i < 9; i++) {
      var cx2 = rx0 + 2 + h0(i, 44) * Math.max(1, rw - 4);
      var cy2 = by + h0(i, 45) * BL;
      crack(b, cx2, cy2, h0(i, 46) * U.TAU, 14 + h0(i, 47) * 30, sx * 37 + i, 3210, 'rgba(0,0,0,0.32)', 1);
    }

    /* 车辙：两条被压得发亮的轮迹（车道中心约 ±20） */
    for (i = 0; i < 2; i++) {
      var laneX = (i === 0 ? -21 : 21);
      if (laneX < rx0 + 1 || laneX > rx1 - 1) continue;
      b.fillStyle = 'rgba(88,80,66,0.045)';
      b.fillRect(laneX - 7, by, 14, BL);
      b.fillStyle = 'rgba(120,110,92,0.035)';
      b.fillRect(laneX - 3, by, 6, BL);
    }

    /* 中线：双黄虚线，掉漆严重。
       —— 虚线的相位要按绝对坐标算，否则每个区块都从 0 开始，
          跨区块时会出现一段"顿一下"的节奏断层 */
    if (rx0 <= 0 && rx1 >= 0) {
      var phase46 = ((-by % 46) + 46) % 46;
      for (var my = by + phase46; my < by + BL; my += 46) {
        var mh = U.hash(sx, Math.round(my / 46), 3221);
        if (mh < 0.18) continue;
        b.fillStyle = 'rgba(196,164,78,' + (0.20 + mh * 0.16).toFixed(2) + ')';
        b.fillRect(-3, my + 7, 2, 24);
        b.fillRect(1, my + 7, 2, 24);
        /* 掉漆的下半段 */
        if (mh < 0.62) {
          b.fillStyle = 'rgba(196,164,78,0.08)';
          b.fillRect(-3, my + 26, 2, 6);
        }
      }
      /* 边线：靠外侧的一条白线，磨成一段一段 */
      var phase18 = ((-by % 18) + 18) % 18;
      for (var ey = by + phase18; ey < by + BL; ey += 18) {
        var eh = U.hash(sx, Math.round(ey / 18), 3231);
        if (eh < 0.3) continue;
        b.fillStyle = 'rgba(206,198,170,' + (0.07 + eh * 0.10).toFixed(2) + ')';
        if (-half + 5 >= rx0) b.fillRect(-half + 5, ey, 1, 13);
        if (half - 6 < rx1) b.fillRect(half - 6, ey, 1, 13);
      }
    }

    /* 被风吹上路面的沙：沿着路基一圈圈摊进来 */
    for (i = 0; i < 7; i++) {
      var dy2 = by + h0(i, 50) * BL;
      var side = h0(i, 51) < 0.5 ? -1 : 1;
      var edgeX = side * half;
      if (edgeX < rx0 - 6 || edgeX > rx1 + 6) continue;
      ellipseFill(b, edgeX - side * (2 + h0(i, 52) * 9), dy2,
        6 + h0(i, 53) * 10, 2 + h0(i, 54) * 4, 'rgba(78,66,42,0.34)');
    }

    /* ---------- 3. 里程桩：每隔一段插一根，斜着、歪着 ---------- */
    if ((((by % 96) + 96) % 96) === 0) {
      for (i = 0; i < 2; i++) {
        var px2 = i === 0 ? -half - 6 : half + 5;
        if (px2 < bx + 1 || px2 > bx + BL - 2) continue;
        var ph2 = U.hash(sx, i, 3241);
        if (ph2 < 0.45) continue;
        b.fillStyle = 'rgba(0,0,0,0.32)';
        b.fillRect(px2 + 1, by + 2, 2, 8);
        b.fillStyle = '#c8bfa2';
        b.fillRect(px2, by, 2, 7);
        b.fillStyle = 'rgba(122,58,38,0.75)';
        b.fillRect(px2, by + 1, 2, 2);
      }
    }
    return;
  };

  R.desert = function (b, cx, cy, vw, vh) {
    var BL = HS.World.BLOCK;
    var x0 = Math.floor(cx / BL) * BL - BL;
    var y0 = Math.floor(cy / BL) * BL - BL;
    var x1 = cx + vw + BL, y1 = cy + vh + BL;

    for (var bx = x0; bx < x1; bx += BL) {
      for (var by = y0; by < y1; by += BL) {
        var key = 'd' + bx + '|' + by;
        var cv = R._gcache[key];
        if (!cv) {
          if (R._gcount > 40) { R._gcache = {}; R._gcount = 0; }
          cv = HS.P.createCanvas(BL, BL);
          var c = cv.getContext('2d');
          c.translate(-bx, -by);
          R.desertBlock(c, bx, by);
          R._gcache[key] = cv;
          R._gcount++;
        }
        b.drawImage(cv, bx, by);
      }
    }
  };

  R.ground = function (b, theme, cx, cy, vw, vh) {
    if (theme === 'street') { R.street(b, cx, cy, vw, vh); return; }
    if (theme === 'desert') { R.desert(b, cx, cy, vw, vh); return; }
    var x0 = Math.floor(cx / 48) * 48 - 48;
    var y0 = Math.floor(cy / 48) * 48 - 48;
    var x1 = cx + vw + 48;
    var y1 = cy + vh + 48;

    if (theme === 'garage') {
      b.fillStyle = '#1a1d23';
      b.fillRect(x0, y0, x1 - x0, y1 - y0);
    } else if (theme === 'gas') {
      b.fillStyle = '#14180f';
      b.fillRect(x0, y0, x1 - x0, y1 - y0);
    } else {
      b.fillStyle = '#1e232a';
      b.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    for (var gy = y0; gy < y1; gy += 48) {
      for (var gx = x0; gx < x1; gx += 48) {
        var h = U.hash(gx / 48, gy / 48, theme === 'garage' ? 3 : (theme === 'gas' ? 2 : 1));

        if (theme === 'gas') {
          /* 砂砾 */
          if (h > 0.4) {
            b.fillStyle = 'rgba(180,170,120,0.05)';
            b.fillRect(gx + Math.floor(h * 40), gy + Math.floor((h * 541) % 40), 2, 2);
          }
          /* 油污 */
          if (h > 0.90) {
            b.fillStyle = 'rgba(8,12,6,0.30)';
            b.beginPath();
            b.arc(gx + 24, gy + 24, 7 + (h * 10) % 5, 0, U.TAU);
            b.fill();
          }
          /* 水泥地裂 */
          if (h > 0.72 && h < 0.78) {
            b.fillStyle = 'rgba(255,255,255,0.03)';
            b.fillRect(gx, gy + 47, 48, 1);
          }
          /* 加油机残骸 */
          if (h > 0.972) {
            b.fillStyle = 'rgba(0,0,0,0.4)';
            b.fillRect(gx + 14, gy + 16, 22, 30);
            b.fillStyle = '#7a2c2c';
            b.fillRect(gx + 16, gy + 14, 18, 28);
            b.fillStyle = '#d9d2b6';
            b.fillRect(gx + 20, gy + 19, 10, 7);
            b.fillStyle = 'rgba(255,90,60,0.18)';
            b.fillRect(gx + 10, gy + 8, 30, 6);
          }
        } else {
          /* 车位线 */
          if (gx % 192 === 0) {
            b.fillStyle = 'rgba(200,212,224,0.10)';
            b.fillRect(gx + 6, gy, 2, 48);
          }
          if (h > 0.68 && h < 0.73) {
            b.fillStyle = 'rgba(200,212,224,0.07)';
            b.fillRect(gx, gy + 24, 48, 2);
          }
          /* 顶灯光斑 */
          if (h > 0.44 && h < 0.47) {
            b.fillStyle = 'rgba(255,214,140,0.05)';
            b.beginPath();
            b.arc(gx + 24, gy + 18, 17, 0, U.TAU);
            b.fill();
          }
          /* 立柱 */
          if (h > 0.88) {
            b.fillStyle = 'rgba(0,0,0,0.40)';
            b.fillRect(gx + 14, gy + 14, 26, 26);
            b.fillStyle = '#2b3038';
            b.fillRect(gx + 12, gy + 12, 24, 24);
            b.fillStyle = '#39404a';
            b.fillRect(gx + 12, gy + 12, 24, 4);
            b.fillStyle = '#4a525e';
            b.fillRect(gx + 15, gy + 8, 18, 4);
            b.fillStyle = 'rgba(255,210,120,0.10)';
            b.fillRect(gx + 17, gy + 3, 14, 4);
          }
          /* 水渍 */
          if (h > 0.60 && h < 0.65) {
            b.fillStyle = 'rgba(120,160,200,0.045)';
            b.beginPath();
            b.arc(gx + 20, gy + 30, 8, 0, U.TAU);
            b.fill();
          }
        }
      }
    }
  };

  /* ---------------- 小物件 ---------------- */

  R.drawGem = function (b, g) {
    var col = g.xp >= 7 ? '#c8a2ff' : (g.xp >= 3 ? '#7ee8fa' : '#8ce99a');
    var s = g.size + (Math.sin(g.t) * 0.5 + 0.5) * 0.7;
    var x = Math.round(g.x), y = Math.round(g.y);
    b.fillStyle = 'rgba(0,0,0,0.55)';
    b.beginPath();
    b.moveTo(x, y - s - 1.4);
    b.lineTo(x + s * 0.9 + 1, y);
    b.lineTo(x, y + s + 1.4);
    b.lineTo(x - s * 0.9 - 1, y);
    b.closePath();
    b.fill();
    b.fillStyle = col;
    b.beginPath();
    b.moveTo(x, y - s);
    b.lineTo(x + s * 0.9, y);
    b.lineTo(x, y + s);
    b.lineTo(x - s * 0.9, y);
    b.closePath();
    b.fill();
    b.fillStyle = 'rgba(255,255,255,0.9)';
    b.fillRect(x - 1, y - 1.5, 1.8, 1.8);
  };

  R.drawDrop = function (b, d) {
    var x = Math.round(d.x), y = Math.round(d.y + Math.sin(d.bob) * 2);

    /* 信号柱：空投落地后的短时指引（世界层的地面效果，
       真正"绝不会看丢"的标记在 HUD 里，见 ui.js 的 dropGuides） */
    if (d.hintT > 0) {
      var hk = Math.min(1, d.hintT / (d.hintMax || 6));
      var hp = 0.55 + 0.45 * Math.sin((R._t || 0) * 7 + d.x * 0.05);
      var top = d.y - 44;
      var gd = b.createLinearGradient(d.x, top, d.x, d.y);
      gd.addColorStop(0, 'rgba(255,209,102,0)');
      gd.addColorStop(0.62, 'rgba(255,209,102,' + (0.13 * hk * hp).toFixed(3) + ')');
      gd.addColorStop(1, 'rgba(255,209,102,' + (0.32 * hk * hp).toFixed(3) + ')');
      b.fillStyle = gd;
      b.fillRect(d.x - 5, top, 10, 44);
      /* 地面扩散环：每 1.6s 一圈 */
      var ph = ((R._t || 0) % 1.6) / 1.6;
      b.globalAlpha = (1 - ph) * 0.5 * hk;
      b.strokeStyle = '#ffd166';
      b.lineWidth = 1;
      b.beginPath();
      b.arc(d.x, d.y, 6 + ph * 20, 0, U.TAU);
      b.stroke();
      b.globalAlpha = 1;
    }

    if (d.kind === 'heart') {
      /* 回血清：绿十字急救针（原来的红心太像一滩血） */
      b.fillStyle = 'rgba(0,0,0,0.55)';
      b.fillRect(x - 5, y - 4, 10, 9);
      b.fillStyle = '#274a38';
      b.fillRect(x - 5, y - 5, 10, 10);
      b.fillStyle = '#3a6b4f';
      b.fillRect(x - 5, y - 5, 10, 3);
      b.fillStyle = '#22392c';
      b.fillRect(x - 5, y + 3, 10, 2);
      b.fillStyle = '#8ce99a';
      b.fillRect(x - 1, y - 3, 2, 6);
      b.fillRect(x - 3, y - 1, 6, 2);
      b.fillStyle = 'rgba(255,255,255,0.7)';
      b.fillRect(x - 1, y - 3, 1, 1);
    } else if (d.kind === 'gold') {
      b.fillStyle = '#e9c46a';
      b.fillRect(x - 4, y - 4, 8, 8);
      b.fillStyle = '#fff3bf';
      b.fillRect(x - 2, y - 2, 4, 4);
    } else {
      b.fillStyle = '#3a2a18';
      b.fillRect(x - 6, y - 5, 12, 10);
      b.fillStyle = '#8a5a2a';
      b.fillRect(x - 6, y - 5, 12, 3);
      b.fillStyle = '#e9c46a';
      b.fillRect(x - 1, y - 1, 2, 5);
      b.fillStyle = 'rgba(255,220,140,0.22)';
      b.fillRect(x - 8, y - 7, 16, 14);
    }
  };

  /* ---------------- 世界主绘制 ---------------- */

  /**
   * 背景震动幅度。
   * 只在局内（state === 'run'）生效：升级 / 暂停时世界是冻结的，
   * 背景还在抖会让卡面和文字跟着晃，读起来很难受。
   */
  R.shakeAmount = function (g) {
    if (!g || !g.run || g.state !== 'run') return 0;
    return (g.run.shake || 0) * (P.fxLow ? 0.3 : 1);
  };

  R.world = function (g) {
    var run = g.run, p = run.p, b = P.bctx;
    R._t = run.t || 0;
    R._run = run;
    R._px = p.x;
    R._py = p.y;
    P.beginFrame();

    var sh = R.shakeAmount(g);
    var shakeX = sh > 0 ? U.rand(-sh, sh) : 0;
    var shakeY = sh > 0 ? U.rand(-sh, sh) : 0;

    /* 驾驶时相机往车头方向前瞻一小段：车永远钉在屏幕正中，速度感就没了，
       视野稍微推到前面，转弯时画面才会跟着"甩"过去（步行时保持 0） */
    var camLX = 0, camLY = 0;
    if (p.veh && !p.veh.wreck) {
      var lookF = 14 * Math.min(1, Math.abs(p.veh.speed) / (p.veh.def.spd || 1));
      camLX = Math.cos(p.veh.heading) * lookF;
      camLY = Math.sin(p.veh.heading) * lookF;
    }
    P.camX = p.x + camLX - P.VW / 2;
    P.camY = p.y + camLY - P.VH / 2;

    b.save();
    /* 相机对齐到缓冲像素（而不是世界像素），超采样下画面才不会抖 */
    var camPX = Math.round((P.camX + shakeX) * P.SS) / P.SS;
    var camPY = Math.round((P.camY + shakeY) * P.SS) / P.SS;
    b.translate(-camPX, -camPY);

    /* 地面 */
    R.ground(b, run.map.theme, P.camX, P.camY, P.VW, P.VH);

    /* 地面污渍（低配模式直接跳过，屏幕上通常有一两百摊） */
    var i;
    if (!P.fxLow) {
      for (i = 0; i < run.decals.length; i++) {
        var dc = run.decals[i];
        b.fillStyle = 'rgba(26,26,30,' + Math.max(0, dc.a).toFixed(3) + ')';
        b.beginPath();
        b.arc(dc.x, dc.y, dc.r, 0, U.TAU);
        b.fill();
      }
    }

    /* 燃烧地面 + 毒液带 */
    for (i = 0; i < run.pools.length; i++) {
      var pool = run.pools[i];

      /* 呕酸尸的矩形毒液：三层绿色叠出"浓稠"的质感，前 0.3s 迅速铺开 */
      if (pool.spray) {
        var st = pool.life / pool.max;
        var grow = Math.min(1, (1 - st) * 4 + 0.35);
        var pulse2 = 0.85 + 0.15 * Math.sin(run.t * 13 + i * 3);
        b.save();
        b.translate(pool.x, pool.y);
        b.rotate(pool.ang);
        var sL = pool.len * grow, sW = pool.wid * (0.45 + 0.55 * grow) * pulse2;
        b.fillStyle = 'rgba(155,224,74,0.13)';
        b.fillRect(0, -sW / 2, sL, sW);
        b.fillStyle = 'rgba(155,224,74,0.20)';
        b.fillRect(0, -sW * 0.34, sL * 0.92, sW * 0.68);
        b.fillStyle = 'rgba(206,245,130,0.24)';
        b.fillRect(0, -sW * 0.15, sL * 0.5, sW * 0.3);
        b.restore();
        continue;
      }

      var pt = pool.life / pool.max;
      var pulse = 0.85 + 0.15 * Math.sin(run.t * 11 + i);
      var pr = pool.r * (0.9 + 0.1 * pt) * pulse;
      b.fillStyle = 'rgba(255,60,10,0.10)';
      b.beginPath(); b.arc(pool.x, pool.y, pr, 0, U.TAU); b.fill();
      b.fillStyle = 'rgba(255,110,30,0.13)';
      b.beginPath(); b.arc(pool.x, pool.y, pr * 0.72, 0, U.TAU); b.fill();
      b.fillStyle = 'rgba(255,180,70,0.16)';
      b.beginPath(); b.arc(pool.x, pool.y, pr * 0.4, 0, U.TAU); b.fill();
    }

    /* 经验 / 掉落 */
    for (i = 0; i < run.gems.length; i++) R.drawGem(b, run.gems[i]);
    for (i = 0; i < run.drops.length; i++) R.drawDrop(b, run.drops[i]);

    /* 玩家脚下的光，夜里更容易定位 */
    b.fillStyle = 'rgba(255,205,140,0.10)';
    b.beginPath(); b.arc(p.x, p.y + 3, 20, 0, U.TAU); b.fill();
    b.fillStyle = 'rgba(255,235,200,0.07)';
    b.beginPath(); b.arc(p.x, p.y + 3, 11, 0, U.TAU); b.fill();

    /* ---- 障碍物：取可视范围 + 余量 ---- */
    var obsBuf = this._obs || (this._obs = []);
    HS.World.queryRect(P.camX - 60, P.camY - 80, P.camX + P.VW + 60, P.camY + P.VH + 80, obsBuf);
    var bBuf = this._bld || (this._bld = []);
    HS.World.buildingsInRect(P.camX - 80, P.camY - 110, P.camX + P.VW + 80, P.camY + P.VH + 110, bBuf);

    /* ---- 敌人 / 道具 / 建筑 / 玩家 一起排序，保证遮挡关系 ---- */
    var list = this._dl || (this._dl = []);
    list.length = 0;
    for (i = 0; i < run.enemies.length; i++) {
      if (!run.enemies[i].dead) list.push(run.enemies[i]);
    }
    for (i = 0; i < obsBuf.length; i++) list.push(obsBuf[i]);

    /* 室内可见时，把「地板 + 家具 + 墙」拆成独立的一层先画：
       玩家/僵尸进楼后会压在家具前面，屋顶再在最上层淡出。 */
    var proxies = this._basePool || (this._basePool = []);
    for (i = 0; i < bBuf.length; i++) {
      var bd0 = bBuf[i];
      if (bd0.reveal > 0.02) {
        var pr0 = proxies[i] || (proxies[i] = { isBldBase: true });
        pr0.bld = bd0;
        pr0.by = bd0.y0 - 2;
        list.push(pr0);
      }
      list.push(bd0);
    }

    var pRef = this._pRef || (this._pRef = { isPlayer: true, y: 0 });
    pRef.y = p.y;
    list.push(pRef);

    /* 停着的载具也要参与深度排序：车头压住丧尸、车尾被丧尸挡住 */
    for (i = 0; i < run.vehicles.length; i++) {
      var vv = run.vehicles[i];
      if (vv === p.veh) continue;          // 自己开的那辆跟玩家一起画
      if (vv.x < P.camX - 90 || vv.x > P.camX + P.VW + 90 ||
          vv.y < P.camY - 110 || vv.y > P.camY + P.VH + 110) continue;
      list.push(vv);
    }

    list.sort(function (m, n) {
      var rm = m.isPlayer ? p.roof : m.roof;
      var rn = n.isPlayer ? p.roof : n.roof;
      var a = rm ? rm.y1 + 3 : (m.by !== undefined ? m.by : m.y);
      var c = rn ? rn.y1 + 3 : (n.by !== undefined ? n.by : n.y);
      return a - c;
    });

    /* 影子统一先铺一层（建筑屋顶自带投影，室内层不需要） */
    b.fillStyle = 'rgba(0,0,0,0.28)';
    for (i = 0; i < list.length; i++) {
      var so = list[i];
      if (so.isPlayer || so.isBldBase) continue;
      if (so.isBuilding) continue;
      if (!so.frame && !so.boss &&
        (so.x < P.camX - 48 || so.x > P.camX + P.VW + 48 ||
         so.y < P.camY - 64 || so.y > P.camY + P.VH + 64)) continue;
      if (so.frame) {
        b.fillRect(Math.round(so.x - so.w / 2 + 2), Math.round(so.y + so.h / 2 - 2), so.w, 3);
      } else if (!so.boss) {
        var sw = so.r * 1.7;
        b.fillRect(Math.round(so.x - sw), Math.round(so.y + so.r * 0.7), Math.round(sw * 2), 2);
      }
    }

    for (i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.isPlayer) {
        if (p.veh) {
          R.drawVehicle(b, p.veh, true);
          continue;
        }
        if (p.roof) {
          /* 楼顶玩家：脚下光与影子要画在屋顶之上 */
          b.fillStyle = 'rgba(0,0,0,0.30)';
          b.fillRect(Math.round(p.x - 5), Math.round(p.y + 4), 10, 2);
          b.fillStyle = 'rgba(255,205,140,0.10)';
          b.beginPath(); b.arc(p.x, p.y + 3, 18, 0, U.TAU); b.fill();
        }
        var pAlpha = 1;
        if (p.invuln > 0 && Math.floor(run.t * 18) % 2 === 0) pAlpha = 0.45;
        /* 挨打时整个人被撞得一晃，比单纯闪白更像被咬到 */
        var pJx = p.hurtT > 0 ? Math.sin(p.hurtT * 78) * p.hurtT * 4 : 0;
        var aim = p.aimA || 0;
        var gunBehind = Math.sin(aim) < -0.25;

        /* 投掷时上半身跟着拧一下：蓄力往后、出手往前。
           只转 6°，再多就不像"投"而像"摔"了。 */
        var twist = 0, lunge = 0;
        if (p.throws && p.throws.length) {
          var tk = p.throws[0].t / p.throws[0].dur;
          if (tk > 1) tk = 1;
          var tf = p.throws[0].face || 1;
          if (tk < 0.42) {
            twist = -tf * 0.10 * (tk / 0.42);
            lunge = -tf * 0.9 * (tk / 0.42);
          } else {
            var te = (tk - 0.42) / 0.58;
            twist = tf * 0.10 * (1 - te);
            lunge = tf * 1.5 * (1 - te);
          }
        }
        /* 开火后坐：整个人被推回半个像素，配合枪口焰才有"后顿" */
        if (p.recoil > 0) {
          lunge -= Math.cos(aim) * p.recoil * 0.9;
        }

        b.globalAlpha = pAlpha;
        if (gunBehind) R.drawGun(b, p, aim);
        if (twist !== 0) {
          b.save();
          b.translate(p.x + pJx, p.y + 4);
          b.rotate(twist);
          b.translate(-(p.x + pJx), -(p.y + 4));
          R.drawActor(b, p.sprite, p.x + pJx + lunge, p.y, 1, p.anim, p.gait, p.lean, null, 0);
          b.restore();
        } else {
          R.drawActor(b, p.sprite, p.x + pJx + lunge, p.y, 1, p.anim, p.gait, p.lean, null, 0);
        }
        if (!gunBehind) R.drawGun(b, p, aim);
        R.drawThrow(b, p);
        b.globalAlpha = 1;
      } else if (it.isVeh) {
        R.drawVehicle(b, it, false);
      } else if (it.isBldBase) {
        R.drawBuildingBase(b, it.bld);
      } else if (it.isBuilding) {
        if (it.ruin) R.drawRuin(b, it, run);
        else R.drawBuildingRoof(b, it, run);
      } else if (it.frame) {
        R.drawProp(b, it, run);
      } else if (it.boss) {
        /* Boss 单独处理 */
      } else {
        R.drawEnemy(b, it);
      }
    }

    /* 站在楼顶时，Boss 在脚下：画在屋顶之上的一圈红色声呐，提示它的位置 */
    if (p.roof) {
      for (i = 0; i < run.enemies.length; i++) {
        if (run.enemies[i].boss && !run.enemies[i].dead) R.drawBossGhost(b, run.enemies[i], run);
      }
    }

    /* Boss 压在最上层，配一圈红光（站在楼顶时不画，避免穿透屋顶） */
    if (!p.roof) {
      for (i = 0; i < run.enemies.length; i++) {
        var be = run.enemies[i];
        if (!be.boss || be.dead) continue;
        if (be.x < P.camX - 120 || be.x > P.camX + P.VW + 120 ||
            be.y < P.camY - 160 || be.y > P.camY + P.VH + 120) continue;
        b.fillStyle = 'rgba(255,40,40,0.10)';
        b.beginPath(); b.arc(be.x, be.y, be.r * 1.8, 0, U.TAU); b.fill();
        R.drawActor(b, be.spriteName || 'boss', be.x, be.y - 4, be.scale, be.anim, be.gait,
          be.lean, be.hitSprite || 'boss_hit', Math.min(0.2, be.flash * 0.24));
        /* 点阵里那挺横抱的加特林在 32x36 的格子里糊成一坨，玩家认不出是枪，
           就会觉得"它没拿武器却在射子弹"。这里按瞄准角每帧补画一挺转管机炮，
           枪口位置和 combat.js 的出弹点完全一致。 */
        if (be.def && be.def.bossType === 'gatling') R.drawBossGatling(b, be, p);
      }
    }

    /* 玩家定位环：被尸群淹没时也能一眼看到自己（开车时由车体+耐久条代劳） */
    if (!p.veh) {
      b.strokeStyle = 'rgba(255,235,200,0.30)';
      b.lineWidth = 1;
      b.beginPath();
      b.arc(p.x, p.y + 1, 10, 0, U.TAU);
      b.stroke();
      b.fillStyle = 'rgba(255,240,205,0.72)';
      b.fillRect(p.x - 3, p.y - 14, 7, 1);
      b.fillRect(p.x - 2, p.y - 13, 5, 1);
      b.fillRect(p.x - 1, p.y - 12, 3, 1);
    }

    /* 自动装备：部署物 / 区域 / 环绕体 */
    R.drawAutos(b, run, p);

    /* 玩家子弹 */
    for (i = 0; i < run.bullets.length; i++) {
      var bu = run.bullets[i];
      if (bu.kind === 'lob') {
        var prog = 1 - bu.life / bu.max;
        var arc = Math.sin(prog * Math.PI);
        var hgt = arc * 18 + 2;
        /* 影子：飞得越高越淡越小，落点一眼能看出来 */
        b.fillStyle = 'rgba(0,0,0,' + (0.30 - arc * 0.15).toFixed(3) + ')';
        b.fillRect(snap(bu.x) - 2, snap(bu.y) - 1, 4, 2);

        /* 抛物线的"起飞 → 落地"刻度：贴着地画几个越来越暗的点，
           投掷物在空中翻滚的时候，眼睛能顺着这串点找到落点 */
        b.fillStyle = bu.explode ? 'rgba(226,196,120,0.30)' : 'rgba(255,120,60,0.28)';
        b.fillRect(snap(bu.x - bu.vx * 0.016), snap(bu.y - bu.vy * 0.016) - 1, 2, 2);
        b.fillStyle = bu.explode ? 'rgba(226,196,120,0.16)' : 'rgba(255,120,60,0.15)';
        b.fillRect(snap(bu.x - bu.vx * 0.032), snap(bu.y - bu.vy * 0.032) - 1, 2, 2);

        b.save();
        b.translate(snap(bu.x), snap(bu.y - 2 - hgt));
        b.rotate(prog * 8.5);
        if (bu.explode) {
          /* 榴弹：短粗的橄榄绿弹体 + 引信闪红 */
          b.fillStyle = '#3a4a34';
          b.fillRect(-2, -2, 4, 4);
          b.fillStyle = '#5b6f4e';
          b.fillRect(-2, -2, 3, 2);
          b.fillStyle = '#c9c2a2';
          b.fillRect(-1, -3, 2, 1);
          b.fillStyle = Math.sin(prog * 34) > 0 ? '#ff5a5a' : '#8a2c2c';
          b.fillRect(1, -3, 1, 1);
        } else {
          /* 燃烧瓶：细长玻璃瓶，颈口的火苗一直在抖 */
          b.fillStyle = '#6b5a2a';
          b.fillRect(-1, -3, 3, 5);
          b.fillStyle = '#b09452';
          b.fillRect(-1, -3, 1, 4);
          b.fillStyle = '#d9a441';
          b.fillRect(0, -4, 1, 2);
          b.fillStyle = Math.sin(prog * 40) > 0 ? '#ffd166' : '#ff8b3d';
          b.fillRect(0, -5, 1, 1);
        }
        b.restore();
      } else {
        b.fillStyle = bu.color;
        b.fillRect(bu.x - bu.r, bu.y - bu.r, bu.r * 2, bu.r * 2);
        b.fillStyle = 'rgba(255,255,255,0.55)';
        b.fillRect(bu.x - bu.r * 0.5, bu.y - bu.r * 0.5, bu.r, bu.r);
      }
    }

    /* 敌方攻击（酸液 / 碎石 / 子弹）：统一红色系，一眼分清"能打死我的东西" */
    for (i = 0; i < run.ebullets.length; i++) {
      var eb = run.ebullets[i];
      if (eb.kind === 'gun') {
        /* 匪徒的子弹：一道亮黄色曳光，尾巴比弹头长 —— 能看出是从哪个方向打来的 */
        var ga = eb.rot === undefined ? Math.atan2(eb.vy, eb.vx) : eb.rot;
        var ca2 = Math.cos(ga), sa2 = Math.sin(ga);
        b.strokeStyle = 'rgba(255,196,90,0.55)';
        b.lineWidth = 1.5;
        b.beginPath();
        b.moveTo(eb.x - ca2 * 9, eb.y - sa2 * 9);
        b.lineTo(eb.x + ca2 * 2, eb.y + sa2 * 2);
        b.stroke();
        b.fillStyle = 'rgba(255,240,180,0.85)';
        b.fillRect(eb.x - 1, eb.y - 1, 2, 2);
        b.fillStyle = '#fff6d0';
        b.fillRect(eb.x - 0.5, eb.y - 0.5, 1, 1);
      } else if (eb.kind === 'rock') {
        /* 暴君碎石：暗红石块 + 红热裂纹 */
        b.fillStyle = 'rgba(255,64,48,0.22)';
        b.fillRect(eb.x - 6, eb.y - 6, 12, 12);
        b.fillStyle = '#6e1a14';
        b.fillRect(eb.x - 4, eb.y - 4, 8, 8);
        b.fillStyle = '#e0392c';
        b.fillRect(eb.x - 3, eb.y - 3, 6, 6);
        b.fillStyle = '#ffb0a0';
        b.fillRect(eb.x - 2, eb.y - 1, 2, 2);
        b.fillStyle = 'rgba(255,120,90,0.85)';
        b.fillRect(eb.x + 1, eb.y + 1, 2, 2);
      } else {
        /* 酸液弹：红色光晕 + 亮红弹体 */
        b.fillStyle = 'rgba(255,48,48,0.26)';
        b.fillRect(eb.x - 5, eb.y - 5, 10, 10);
        b.fillStyle = '#ff2d2d';
        b.fillRect(eb.x - 3, eb.y - 3, 6, 6);
        b.fillStyle = '#ffb3a8';
        b.fillRect(eb.x - 1, eb.y - 1, 2, 2);
      }
    }

    /* 闪电 / 光束 */
    for (i = 0; i < run.chains.length; i++) {
      var ch = run.chains[i];
      var a2 = Math.max(0, ch.life / ch.max);
      /* 光束粗细跟判定宽度走（ch.w 是半宽）：基础 5 → 约 3px，
         「加宽光栅」+2 / 进化 x2.2 之后线会明显变粗，玩家才能看见升级生效 */
      var lw = ch.straight ? (ch.w ? Math.max(2.5, ch.w * 0.62) : 3) : 2;
      b.beginPath();
      for (var q = 0; q < ch.pts.length - 1; q++) {
        var p1 = ch.pts[q], p2 = ch.pts[q + 1];
        b.moveTo(p1.x, p1.y);
        if (ch.straight) {
          b.lineTo(p2.x, p2.y);
        } else {
          var mx = (p1.x + p2.x) / 2 + U.rand(-4, 4);
          var my = (p1.y + p2.y) / 2 + U.rand(-4, 4);
          b.lineTo(mx, my);
          b.lineTo(p2.x, p2.y);
        }
      }
      /* 宽光束先铺一层光晕，否则加宽只体现在判定上，肉眼看不出来 */
      if (ch.straight && lw > 3.4) {
        b.strokeStyle = ch.color
          ? U.rgba(ch.color, 0.15 * a2)
          : 'rgba(160,240,255,' + (0.15 * a2).toFixed(2) + ')';
        b.lineWidth = lw * 2.2;
        b.stroke();
      }
      b.strokeStyle = ch.color
        ? U.rgba(ch.color, 0.85 * a2)
        : 'rgba(160,240,255,' + (0.85 * a2).toFixed(2) + ')';
      b.lineWidth = lw;
      b.stroke();
    }

    /* 末世空气：缓慢飘落的灰烬 / 浮尘 */
    R.drawAtmosphere(b, run);

    /* 粒子 / 冲击环 */
    for (i = 0; i < run.fx.length; i++) {
      var f = run.fx[i];
      if (f.kind === 'p') {
        b.globalAlpha = Math.max(0, f.life / f.max);
        b.fillStyle = f.color;
        b.fillRect(f.x, f.y, f.size, f.size);
        b.globalAlpha = 1;
      } else if (f.kind === 'ring') {
        var pr = Math.max(0, f.life / f.maxLife);
        b.strokeStyle = f.color;
        b.globalAlpha = pr * 0.9;
        b.lineWidth = 2;
        b.beginPath();
        b.arc(f.x, f.y, f.r, 0, U.TAU);
        b.stroke();
        b.globalAlpha = 1;
      } else if (f.kind === 'slash') {
        /* 近战刀光：一段圆弧，越接近消失越细 */
        var sa = Math.max(0, f.life / f.max);
        b.globalAlpha = sa * 0.85;
        b.strokeStyle = f.color;
        b.lineWidth = 1 + sa * 2;
        b.beginPath();
        b.arc(f.x, f.y, f.r * 0.82, f.ang - f.arc / 2, f.ang + f.arc / 2);
        b.stroke();
        /* 内圈淡影，让刀光有厚度 */
        b.globalAlpha = sa * 0.3;
        b.beginPath();
        b.arc(f.x, f.y, f.r * 0.6, f.ang - f.arc / 2 * 0.8, f.ang + f.arc / 2 * 0.8);
        b.stroke();
        b.globalAlpha = 1;
      } else if (f.kind === 'wave') {
        /* 剑气：月牙从刀口向外扩张，越远越淡越细 —— 一眼能看出"飞出去了" */
        var wk = 1 - Math.max(0, f.life / f.max);      // 0 → 1 扩散进度
        var wr = f.r0 + (f.r1 - f.r0) * wk;
        var wHalf = f.arc * 0.5;
        var wAlpha = (1 - wk) * 0.9;
        b.globalAlpha = wAlpha;
        b.strokeStyle = f.color;
        b.lineWidth = 2.4 - wk * 1.6;
        b.beginPath();
        b.arc(f.x, f.y, wr, f.ang - wHalf, f.ang + wHalf);
        b.stroke();
        /* 内侧一层拖影，刀气才有厚度 */
        b.globalAlpha = wAlpha * 0.35;
        b.lineWidth = 1;
        b.beginPath();
        b.arc(f.x, f.y, wr * 0.86, f.ang - wHalf * 0.85, f.ang + wHalf * 0.85);
        b.stroke();
        b.globalAlpha = 1;
      } else if (f.kind === 'thrust') {
        /* 长矛突刺：从枪尖射出的一条光带，宽度跟着枪身走 */
        var tk = Math.max(0, f.life / f.max);
        var tcos = Math.cos(f.ang), tsin = Math.sin(f.ang);
        b.globalAlpha = tk * 0.9;
        b.strokeStyle = f.color;
        b.lineWidth = Math.max(1.5, f.w * 0.55);
        b.lineCap = 'round';
        b.beginPath();
        b.moveTo(f.x + tcos * 5, f.y + tsin * 5);
        b.lineTo(f.x + tcos * f.len, f.y + tsin * f.len);
        b.stroke();
        /* 枪尖一记亮点 */
        b.globalAlpha = tk;
        b.fillStyle = f.color;
        b.fillRect(f.x + tcos * f.len - 1.5, f.y + tsin * f.len - 1.5, 3, 3);
        b.lineCap = 'butt';
        b.globalAlpha = 1;
      }
    }

    /* 伤害数字 */
    b.textAlign = 'center';
    b.textBaseline = 'middle';
    for (i = 0; i < run.texts.length; i++) {
      var tx = run.texts[i];
      var ta = Math.min(1, tx.life / tx.max * 1.6);
      b.globalAlpha = ta;
      b.font = (tx.crit ? 'bold 9px' : '7px') + ' "Courier New", monospace';
      b.fillStyle = tx.hurt ? '#ff5c5c' : (tx.crit ? '#ffd166' : '#ffffff');
      b.fillText(tx.txt, tx.x, tx.y);
      b.globalAlpha = 1;
    }

    b.restore();

    /* 暗角：把视线压到画面中心，夜晚的压迫感主要来自这里 */
    R.drawVignette(b, run);
    /* 夜间地图：只留身边一圈可见，外面交给黑暗 */
    R.drawNight(b, run);
    P.present();
  };

  /* ================= 载具 ================= */

  /**
   * 画一辆车。
   *
   * 只用横 / 竖两张帧，靠"选主轴 + 残余角度旋转"表达任意朝向：
   *   |cos| >= |sin| → 横帧（车头朝左），否则竖帧（车头朝上）；
   *   往右 / 往下时做翻转，再把剩下那点角度（最多 45°）转过去。
   * 这样停在路边的车可以歪着，开起来也能平滑转向，
   * 而不是四个方向硬邦邦地弹。翻转后残余角度仍然是 heading - 基准角，
   * 因为 rotate 作用在 scale 之外，镜像不会改变旋转方向。
   */
  R.drawVehicle = function (b, v, driving) {
    if (!S.ready || !v) return;
    var c = Math.cos(v.heading), s = Math.sin(v.heading);
    var horiz = Math.abs(c) >= Math.abs(s);
    var f = S.frames[horiz ? v.def.spriteH : v.def.spriteV];
    if (!f) return;

    var flipX = false, flipY = false, base;
    if (horiz) {
      flipX = c > 0;
      base = flipX ? 0 : Math.PI;
    } else {
      flipY = s > 0;
      base = flipY ? Math.PI / 2 : -Math.PI / 2;
    }
    var tilt = v.heading - base;
    while (tilt > Math.PI) tilt -= U.TAU;
    while (tilt < -Math.PI) tilt += U.TAU;

    b.save();
    b.translate(snap(v.x), snap(v.y));
    if (tilt > 0.001 || tilt < -0.001) b.rotate(tilt);
    /* 影子按当前帧的朝向画（横置车用 f.w/f.h），跟着旋转，
       否则横着开的车底下会竖着一条 90° 错位的色块 */
    b.fillStyle = 'rgba(0,0,0,0.32)';
    b.fillRect(-f.w / 2 + 2, -f.h / 2 + 3, f.w, f.h);
    if (flipX) b.scale(-1, 1);
    if (flipY) b.scale(1, -1);
    b.drawImage(S.img, f.x, f.y, f.w, f.h, -f.w / 2, -f.h / 2, f.w, f.h);

    /* 战损层：耐久越低，锈穿的黑斑和弹孔越多。
       每辆车用 seed 决定斑点的位置，所以同一辆车不会每帧"换一张脸"。 */
    var wear = 1 - (v.maxDur > 0 ? v.dur / v.maxDur : 1);
    if (wear > 0.05) {
      var hw = v.def.w / 2 - 2, hh = v.def.h / 2 - 4;
      var n = wear > 0.6 ? 4 : (wear > 0.3 ? 2 : 1);
      for (var k = 0; k < n; k++) {
        var rx = (U.hash(v.seed || 1, k, 6203) - 0.5) * 2 * hw;
        var ry = (U.hash(v.seed || 1, k, 6209) - 0.5) * 2 * hh;
        var rw = 1 + Math.floor(U.hash(v.seed || 1, k, 6211) * 2);
        var rh = 1 + Math.floor(U.hash(v.seed || 1, k, 6217) * 2);
        b.fillStyle = 'rgba(30,22,16,' + (0.16 + wear * 0.34).toFixed(2) + ')';
        b.fillRect(rx, ry, rw, rh);
        if (k % 2 === 0) {
          b.fillStyle = 'rgba(150,86,40,' + (0.12 + wear * 0.22).toFixed(2) + ')';
          b.fillRect(rx, ry + rh, rw + 1, 1);
        }
      }
      /* 烟熏：撞得多了车头一片黑 */
      if (wear > 0.45) {
        b.fillStyle = 'rgba(20,20,24,' + ((wear - 0.45) * 0.5).toFixed(2) + ')';
        b.fillRect(-v.def.w / 2 + 2, -v.def.h / 2 + 2, v.def.w - 4, 4);
      }
    }
    b.restore();

    if (v.wreck) return;

    /* 车顶耐久条：开车时才显示，随时提醒"还能撞几下" */
    if (driving) {
      var ratio = Math.max(0, Math.min(1, v.dur / v.maxDur));
      var bw = 26;
      var by = Math.round(v.y - v.h / 2 - 7);
      var bx = Math.round(v.x - bw / 2);
      b.fillStyle = 'rgba(0,0,0,0.62)';
      b.fillRect(bx - 1, by - 1, bw + 2, 5);
      b.fillStyle = ratio > 0.5 ? '#8ce99a' : (ratio > 0.25 ? '#ffd166' : '#ff5a5a');
      b.fillRect(bx, by, Math.max(0, bw * ratio), 3);
      b.fillStyle = 'rgba(255,255,255,0.22)';
      b.fillRect(bx, by, Math.max(0, bw * ratio), 1);
      /* 撞击闪一下红边 */
      if (v.flash > 0.02) {
        b.strokeStyle = 'rgba(255,90,70,' + (v.flash * 0.7).toFixed(2) + ')';
        b.lineWidth = 1;
        b.strokeRect(bx - 2, by - 2, bw + 4, 7);
      }
    } else if (v === (R._run && R._run.nearVeh)) {
      /* 靠近可驾驶车辆：给一个和搜刮品一致的菱形提示 */
      lootHint(b, v.x, v.y - v.h / 2 - 9, R._t || 0, true);
    }
  };

  /* ---------------- 空气 / 暗角 ---------------- */

  R.drawAtmosphere = function (b, run) {
    var t = run.t || 0;
    var vw = P.VW, vh = P.VH;
    var x0 = P.camX, y0 = P.camY;
    for (var i = 0; i < 30; i++) {
      var h1 = U.hash(i, 1, 7771);
      var h2 = U.hash(i, 2, 7771);
      var h3 = U.hash(i, 3, 7771);
      var w = vw + 40, h = vh + 40;
      var x = x0 + ((h1 * w + t * (3 + h1 * 8)) % w + w) % w - 20;
      var y = y0 + ((h2 * h + t * (6 + h2 * 14)) % h + h) % h - 20;
      x += Math.sin(t * 0.7 + h3 * 9) * 2;
      b.fillStyle = 'rgba(196,202,210,' + (0.035 + h3 * 0.075).toFixed(3) + ')';
      b.fillRect(x | 0, y | 0, 1 + (h3 > 0.78 ? 1 : 0), 1);
    }

    /* 燃烧处升起淡淡的烟 */
    for (var f = 0; f < run.pools.length; f++) {
      var pool = run.pools[f];
      var a = Math.max(0, pool.life / pool.max);
      b.fillStyle = 'rgba(60,52,48,' + (0.05 * a).toFixed(3) + ')';
      b.beginPath();
      b.arc(pool.x + Math.sin(t * 1.4 + f) * 4, pool.y - 8, pool.r * 0.7, 0, U.TAU);
      b.fill();
    }
  };

  R.drawVignette = function (b, run) {
    var vw = P.VW, vh = P.VH;
    var theme = (run && run.map && run.map.theme) || 'street';
    if (!R._vig || R._vigW !== vw || R._vigH !== vh || R._vigTheme !== theme) {
      R._vigW = vw; R._vigH = vh; R._vigTheme = theme;
      R._vig = P.createCanvas(vw, vh);
      var v = R._vig.getContext('2d');
      var tint = theme === 'gas' ? '8,14,8' : (theme === 'garage' ? '10,13,22' : '8,10,15');
      var g = v.createRadialGradient(vw / 2, vh / 2, vh * 0.2, vw / 2, vh / 2, vh * 0.76);
      g.addColorStop(0, 'rgba(' + tint + ',0)');
      g.addColorStop(0.6, 'rgba(' + tint + ',0.055)');
      g.addColorStop(1, 'rgba(' + tint + ',0.36)');
      v.fillStyle = g;
      v.fillRect(0, 0, vw, vh);
      /* 上下再压一点，模拟破败街区的高楼阴影 */
      var g2 = v.createLinearGradient(0, 0, 0, vh);
      g2.addColorStop(0, 'rgba(' + tint + ',0.16)');
      g2.addColorStop(0.16, 'rgba(' + tint + ',0)');
      g2.addColorStop(0.86, 'rgba(' + tint + ',0)');
      g2.addColorStop(1, 'rgba(' + tint + ',0.20)');
      v.fillStyle = g2;
      v.fillRect(0, 0, vw, vh);
    }
    /* 抬起一点黑位，让暗部还有层次，而不是一团纯黑 */
    b.fillStyle = 'rgba(92,106,122,0.028)';
    b.fillRect(0, 0, vw, vh);
    b.drawImage(R._vig, 0, 0);
  };

  /* ---------------- 夜景：被黑暗吃掉的可视范围 ---------------- */

  /**
   * 夜间模式（map.night）。
   *
   * 相机始终以玩家为中心，所以在「屏幕空间」画一张径向渐变就够了：
   * 中心 vision 半径内是透的，往外迅速压到几乎全黑。画在暗角之后、
   * present 之前，因此只盖住世界层，HUD / 血条 / 伤害数字照旧清晰。
   *
   * 渐变用离屏画布缓存（尺寸或视野变了才重建），每帧只有一次 drawImage。
   */
  R.drawNight = function (b, run) {
    var map = run && run.map;
    if (!map || !map.night) return;
    var vw = P.VW, vh = P.VH;
    var vision = map.vision || 92;
    var maxR = Math.sqrt(vw * vw + vh * vh) * 0.5;

    if (!R._nightCv || R._nightW !== vw || R._nightH !== vh || R._nightV !== vision) {
      R._nightW = vw; R._nightH = vh; R._nightV = vision;
      R._nightCv = P.createCanvas(vw, vh);
      var c = R._nightCv.getContext('2d');
      var cx = vw / 2, cy = vh / 2;
      var g = c.createRadialGradient(cx, cy, 1, cx, cy, maxR);
      /* 半径按"全亮 → 半亮 → 全黑"三段给，边界要足够软，
         否则会像套了一个圆圈 UI，而不是夜里看不远 */
      var a = vision / maxR;
      var b2 = Math.min(0.96, vision * 1.75 / maxR);
      g.addColorStop(0, 'rgba(4,6,12,0)');
      g.addColorStop(Math.min(0.9, a * 0.55), 'rgba(4,6,12,0.02)');
      g.addColorStop(Math.min(0.94, a), 'rgba(4,6,12,0.20)');
      g.addColorStop(b2, 'rgba(3,5,10,0.88)');
      g.addColorStop(1, 'rgba(2,4,8,0.97)');
      c.fillStyle = g;
      c.fillRect(0, 0, vw, vh);

      /* 脚边一小圈暖光：手电 / 打火机的那点光，方便定位自己 */
      var lr = vision * 0.62;
      var lg = c.createRadialGradient(cx, cy, 1, cx, cy, lr);
      lg.addColorStop(0, 'rgba(255,196,120,0.13)');
      lg.addColorStop(0.6, 'rgba(255,180,110,0.05)');
      lg.addColorStop(1, 'rgba(255,170,100,0)');
      c.fillStyle = lg;
      c.fillRect(0, 0, vw, vh);
    }

    b.drawImage(R._nightCv, 0, 0);
  };

  /* ---------------- 单实体绘制 ---------------- */

  /** 对齐到渲染缓冲像素：超采样下像素画必须落在整数缓冲像素上，否则边缘发糊 */
  function snap(v) {
    var ss = P.SS || 1;
    return Math.round(v * ss) / ss;
  }

  /* ---------------- 手里的武器（枪 / 投掷物） ---------------- */

  /* 手持武器的外观族：数据表里的 art 决定画什么，新增武器不用改这里 */
  var ART_KIND = {
    pistol: 'pistol', revolver: 'pistol',
    smg: 'smg',
    rifle: 'rifle', sniper: 'rifle', lmg: 'rifle', minigun: 'minigun',
    shotgun: 'shotgun',
    launcher: 'launcher', mortar: 'launcher', harpoon: 'launcher',
    bow: 'bow', crossbow: 'bow',
    flamer: 'flamer',
    laser: 'laser', tesla: 'laser', plasma: 'laser', railgun: 'laser',
    saber: 'blade', katana: 'blade', greatsword: 'blade', twinblades: 'blade',
    scythe: 'blade', knife: 'knife', shortsword: 'blade', glaive: 'blade',
    axe: 'axe', hammer: 'axe',
    spear: 'spear',
    chainsaw: 'saw',
    fist: 'fist', drill: 'drill', whip: 'whip',
    shield: 'shield', eshield: 'shield', shieldaxe: 'shield', baton: 'baton',
    molotov: 'none', grenade: 'none', frost: 'none', beacon: 'none',
    mine: 'none', shockwave: 'none', autoloader: 'none', syringe: 'none',
    drone: 'none'
  };

  /* ---------------- 自动装备 ---------------- */

  /**
   * 自动装备的世界表现。
   * 跟随型画成小无人机，环绕型画成绕身的刃 / 球，区域型画成半透明圆，
   * 部署型画成一个带炮管的小底座 —— 让玩家一眼看出"场上还有些什么"。
   */
  R.drawAutos = function (b, run, p) {
    var i, a, def, st, k, n;

    /* 地面层：区域 / 地雷 / 诱饵 / 延迟炮击 */
    for (i = 0; i < run.devices.length; i++) {
      var dv = run.devices[i];
      if (dv.dead) continue;

      if (dv.kind === 'zone') {
        var pulse = 0.8 + 0.2 * Math.sin(run.t * 3 + i);
        b.globalAlpha = 0.10 * pulse;
        b.fillStyle = dv.color || '#8ce99a';
        b.beginPath(); b.arc(dv.x, dv.y, dv.r, 0, U.TAU); b.fill();
        b.globalAlpha = 0.42 * pulse;
        b.strokeStyle = dv.color || '#8ce99a';
        b.lineWidth = 1;
        b.beginPath(); b.arc(dv.x, dv.y, dv.r, 0, U.TAU); b.stroke();
        b.globalAlpha = 1;
      } else if (dv.kind === 'mine') {
        b.fillStyle = '#3a3a2a';
        b.fillRect(dv.x - 2, dv.y - 1, 4, 3);
        b.fillStyle = Math.sin(run.t * 8 + dv.x) > 0 ? '#ff5a5a' : '#7a2c2c';
        b.fillRect(dv.x - 0.5, dv.y - 3, 1, 1);
      } else if (dv.kind === 'lure') {
        b.strokeStyle = 'rgba(255,209,102,0.45)';
        b.lineWidth = 1;
        b.beginPath();
        b.arc(dv.x, dv.y, 7 + Math.sin(run.t * 4) * 2, 0, U.TAU);
        b.stroke();
        b.fillStyle = '#2b2f36'; b.fillRect(dv.x - 3, dv.y - 3, 6, 6);
        b.fillStyle = '#ffd166'; b.fillRect(dv.x - 1, dv.y - 1, 2, 2);
      } else if (dv.kind === 'delay') {
        var dd = 1 - dv.life / (dv.max || 1);
        b.strokeStyle = 'rgba(255,90,60,0.85)';
        b.lineWidth = 1;
        b.beginPath(); b.arc(dv.x, dv.y, (dv.r || 30) * dd, 0, U.TAU); b.stroke();
        b.fillStyle = 'rgba(255,209,102,' + (0.15 + dd * 0.35).toFixed(2) + ')';
        b.beginPath(); b.arc(dv.x, dv.y, (dv.r || 30) * dd, 0, U.TAU); b.fill();
      } else if (dv.kind === 'turret') {
        b.fillStyle = 'rgba(0,0,0,0.28)';
        b.fillRect(dv.x - 4, dv.y + 2, 8, 2);
        b.fillStyle = '#4a515c';
        b.fillRect(dv.x - 4, dv.y - 5, 8, 7);
        b.fillStyle = '#9aa6b4';
        b.fillRect(dv.x - 3, dv.y - 5, 6, 2);
        b.fillStyle = dv.gearId === 'flamenozzle' ? '#ff8b3d' : '#2b2f36';
        b.fillRect(dv.x - 1, dv.y - 4, 2, 2);
        /* 炮管朝最近的敌人 */
        var tgt = HS.Game.nearest(dv.x, dv.y, 160);
        var ang = tgt ? Math.atan2(tgt.y - dv.y, tgt.x - dv.x) : (dv.ang || 0);
        b.save();
        b.translate(dv.x, dv.y - 2);
        b.rotate(ang);
        b.fillStyle = '#39404a';
        b.fillRect(0, -1, 7, 2);
        b.fillStyle = '#828d9c';
        b.fillRect(0, -1, 5, 1);
        b.restore();
      }

      /* 耐久条：布置型的核心状态，必须一眼看得见（红了就是快被拆了） */
      if (dv.maxHp > 0) {
        var hr = Math.max(0, Math.min(1, dv.hp / dv.maxHp));
        b.fillStyle = 'rgba(0,0,0,0.55)';
        b.fillRect(dv.x - 7, dv.y - 12, 14, 2.6);
        b.fillStyle = hr > 0.5 ? '#8ce99a' : (hr > 0.25 ? '#ffd166' : '#ff6b6b');
        b.fillRect(dv.x - 7, dv.y - 12, 14 * hr, 2.6);
      }
    }

    if (!p.autos || !p.autos.length) return;

    for (i = 0; i < p.autos.length; i++) {
      a = p.autos[i];
      def = HS.Data.gear[a.id];
      if (!def) continue;
      st = a.st || HS.Gear.stat(a, p);
      if (!st) continue;

      if (def.kind === 'follow') {
        var fx = a.x === undefined ? p.x : a.x;
        var fy = a.y === undefined ? p.y - 12 : a.y;
        b.fillStyle = 'rgba(0,0,0,0.25)';
        b.fillRect(fx - 3, fy + 6, 6, 1);
        b.fillStyle = '#3e4b57';
        b.fillRect(fx - 3, fy - 2, 6, 4);
        b.fillStyle = '#8ecae6';
        b.fillRect(fx - 2, fy - 2, 2, 2);
        b.fillStyle = 'rgba(255,255,255,0.6)';
        b.fillRect(fx + 1, fy - 1, 1, 1);
        /* 旋翼：两帧闪烁 */
        b.fillStyle = Math.sin(run.t * 30 + i) > 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
        b.fillRect(fx - 6, fy - 4, 4, 1);
        b.fillRect(fx + 2, fy - 4, 4, 1);
      } else if (def.kind === 'orbit') {
        n = Math.max(1, Math.round(st.count));
        for (k = 0; k < n; k++) {
          var oa = a.ang + k * U.TAU / n;
          var ox = p.x + Math.cos(oa) * st.radius;
          var oy = p.y + Math.sin(oa) * st.radius * 0.85;
          b.save();
          b.translate(ox, oy);
          b.rotate(oa);
          if (def.id === 'orbitblade') {
            /* 满级刀轮：刀片从 6px 拉到 12px，10 片首尾相接绕成一圈 */
            var bl = st.full ? 6 : 3;
            b.fillStyle = '#dfe6ee'; b.fillRect(-bl, -1, bl * 2, 2);
            b.fillStyle = 'rgba(255,255,255,0.4)'; b.fillRect(-bl, -2, bl * 2, 1);
          } else if (def.id === 'reflectshield') {
            b.fillStyle = '#5c6672'; b.fillRect(-3, -4, 6, 8);
            b.fillStyle = 'rgba(180,220,255,0.5)'; b.fillRect(-2, -3, 4, 6);
          } else if (def.id === 'gravitysat') {
            b.fillStyle = '#4a3b6b'; b.fillRect(-2, -2, 4, 4);
            b.fillStyle = 'rgba(177,151,252,0.5)';
            b.fillRect(-3, -3, 6, 1);
          } else {
            b.fillStyle = def.color; b.fillRect(-2, -2, 4, 4);
            b.fillStyle = 'rgba(255,255,255,0.55)'; b.fillRect(-1, -1, 2, 2);
          }
          b.restore();
          /* 电流 / 重力丝线 */
          if (def.id === 'railorb' || def.id === 'gravitysat') {
            b.strokeStyle = U.rgba(def.color, 0.22);
            b.lineWidth = 1;
            b.beginPath(); b.moveTo(ox, oy); b.lineTo(p.x, p.y); b.stroke();
          }
        }
        /* 满级刀轮：补一圈淡色轨迹，视觉上把刀片连成"已经合拢的圆" */
        if (st.full && def.id === 'orbitblade') {
          b.save();
          b.translate(p.x, p.y);
          b.scale(1, 0.85);
          b.strokeStyle = 'rgba(223,230,238,0.20)';
          b.lineWidth = 1;
          b.beginPath(); b.arc(0, 0, st.radius, 0, U.TAU); b.stroke();
          b.restore();
        }
      } else if (def.kind === 'ring') {
        var rr = st.radius * p.areaMul;
        var ph = Math.sin(run.t * 4 + i) * 2;
        b.strokeStyle = U.rgba(def.color || '#ff8b3d', 0.35);
        b.lineWidth = 2 + Math.sin(run.t * 3) * 1;
        b.beginPath();
        b.arc(p.x, p.y, rr + ph * 0.2, 0, U.TAU);
        b.stroke();
        b.fillStyle = U.rgba(def.color || '#ff8b3d', 0.05);
        b.beginPath();
        b.arc(p.x, p.y, rr, 0, U.TAU);
        b.fill();
      } else if (def.kind === 'support') {
        var sa = run.t * 1.2 + i;
        var sx = p.x + Math.cos(sa) * 14;
        var sy = p.y - 12 + Math.sin(sa) * 5;
        b.fillStyle = def.color;
        b.fillRect(sx - 2, sy - 2, 4, 4);
        b.fillStyle = 'rgba(255,255,255,0.6)';
        b.fillRect(sx - 1, sy - 1, 1, 1);
      }
    }
  };

  /** 手里握着什么：优先主武器，只有副武器时就画副武器 */
  function heldDef(p) {
    var main = null, sub = null;
    var ws = p.weapons;
    if (!ws || !ws.length) return null;
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (w.slot === 'sub') sub = w;
      else main = w;
    }
    var w2 = main || sub;
    return w2 ? HS.Data.gear[w2.id] : null;
  }

  /**
   * 扫射暴君手里的加特林
   * 枪口 = 身体中心 + 瞄准方向 17px，和 combat.js 里生成弹幕的位置对齐；
   * 六根转管用 sin 上下摆动模拟旋转，过热时整根烧成暗红、枪口不再闪。
   */
  R.drawBossGatling = function (b, e, p) {
    var a = (e.gAim === undefined) ? Math.atan2(p.y - e.y, p.x - e.x) : e.gAim;
    var spin = e.spinA || 0;
    var firing = e.gSt === 2;
    var hot = e.gSt === 3;

    b.save();
    b.translate(snap(e.x), snap(e.y - 2));
    b.rotate(a);
    if (Math.cos(a) < 0) b.scale(1, -1);

    /* 机匣 + 弹链 */
    b.fillStyle = '#1b2026'; b.fillRect(-4, -4, 10, 8);
    b.fillStyle = '#39424c'; b.fillRect(-3, -3, 8, 3);
    b.fillStyle = '#4d5865'; b.fillRect(-2, -3, 5, 1);
    b.fillStyle = '#6d6038'; b.fillRect(-5, 3, 4, 1);
    b.fillRect(-1, 4, 4, 1);

    /* 六根转管：上下错开，最亮的一根是高光 */
    var i, ang, oy, lit;
    for (i = 0; i < 6; i++) {
      ang = spin + i * (Math.PI / 3);
      oy = Math.round(Math.sin(ang) * 3);
      lit = 0.5 + 0.5 * Math.cos(ang);
      b.fillStyle = hot ? '#6a4a3a'
        : (lit > 0.78 ? '#aab6c4' : (lit > 0.45 ? '#6e7a88' : '#3b444e'));
      b.fillRect(6, oy, 11, 1);
    }

    /* 枪口环（开火时闪一下） */
    b.fillStyle = hot ? '#43382f' : '#14181d';
    b.fillRect(16, -4, 2, 8);
    if (firing) {
      b.fillStyle = '#fff3c4';
      b.fillRect(18, -2, 3, 4);
      b.fillStyle = 'rgba(255,209,102,0.55)';
      b.fillRect(21, -1, 2, 2);
    }
    b.restore();
  };

  R.drawGun = function (b, p, a) {
    var def = heldDef(p);
    if (!def) return;
    var kind = ART_KIND[def.art] || 'rifle';
    if (kind === 'none') return;

    var rec = p.recoil || 0;
    var sway = Math.sin(p.anim) * 0.5 * (p.gait || 0);
    var ca = Math.cos(a), sa = Math.sin(a);
    var side = (ca >= 0 ? 1 : -1) * 1.9;
    var hx = p.x + side + ca * (1.8 - rec * 1.4) - sa * sway;
    var hy = p.y + 1.9 + sa * (1.6 - rec * 1.2) + ca * sway;

    b.save();
    b.translate(snap(hx), snap(hy));
    b.rotate(a);
    if (ca < 0) b.scale(1, -1);

    var len = 6;

    if (kind === 'pistol') {
      len = 5;
      b.fillStyle = '#3d444e'; b.fillRect(0, -1, 5, 2);
      b.fillStyle = '#828d9c'; b.fillRect(0, -1, 4, 1);
      b.fillStyle = '#22262d'; b.fillRect(-1, 0, 2, 3);
      b.fillStyle = '#e8b98d'; b.fillRect(-1, 2, 2, 2);
    } else if (kind === 'smg') {
      len = 6;
      b.fillStyle = '#3a414b'; b.fillRect(0, -1, 6, 2);
      b.fillStyle = '#828d9c'; b.fillRect(0, -1, 5, 1);
      b.fillStyle = '#22262d'; b.fillRect(0, 1, 2, 3);
      b.fillStyle = '#2a2f36'; b.fillRect(-2, 0, 2, 2);
      b.fillStyle = '#e8b98d'; b.fillRect(0, 3, 2, 2);
    } else if (kind === 'rifle') {
      len = 9;
      b.fillStyle = '#39404a'; b.fillRect(0, -1, 10, 2);
      b.fillStyle = '#8a95a3'; b.fillRect(1, -1, 8, 1);
      b.fillStyle = '#23272e'; b.fillRect(3, 1, 2, 3);
      b.fillStyle = '#5a6472'; b.fillRect(8, 0, 3, 1);
      b.fillStyle = '#e8b98d'; b.fillRect(-2, 0, 2, 2);
    } else if (kind === 'minigun') {
      len = 10;
      b.fillStyle = '#4a515c'; b.fillRect(-2, -2, 4, 4);
      b.fillStyle = '#333941'; b.fillRect(1, -2, 9, 1);
      b.fillRect(1, 0, 9, 1);
      b.fillRect(1, 2, 9, 1);
      b.fillStyle = '#9aa6b4'; b.fillRect(2, -2, 6, 1);
      b.fillStyle = '#e8b98d'; b.fillRect(-3, 1, 2, 2);
    } else if (kind === 'shotgun') {
      len = 9;
      b.fillStyle = '#3d444e'; b.fillRect(0, -1, 9, 2);
      b.fillStyle = '#828d9c'; b.fillRect(1, -1, 7, 1);
      b.fillStyle = '#7a5530'; b.fillRect(-3, 0, 4, 2);
      b.fillStyle = '#5d6672'; b.fillRect(2, 1, 3, 2);
      b.fillStyle = '#e8b98d'; b.fillRect(-3, 2, 2, 2);
    } else if (kind === 'launcher') {
      len = 9;
      b.fillStyle = '#3c443a'; b.fillRect(0, -2, 9, 3);
      b.fillStyle = '#79866f'; b.fillRect(0, -2, 8, 1);
      b.fillStyle = '#202620'; b.fillRect(1, 2, 3, 2);
      b.fillStyle = '#c9c2a2'; b.fillRect(8, -2, 2, 3);
      b.fillStyle = '#e8b98d'; b.fillRect(0, 2, 2, 2);
    } else if (kind === 'bow') {
      len = 7;
      b.strokeStyle = '#8a6a3a'; b.lineWidth = 2;
      b.beginPath(); b.arc(2, 0, 5, -1.1, 1.1); b.stroke();
      b.strokeStyle = '#d8d2c0'; b.lineWidth = 1;
      b.beginPath(); b.moveTo(4.5, -4.4); b.lineTo(4.5, 4.4); b.stroke();
      b.fillStyle = '#e8b98d'; b.fillRect(-2, 1, 2, 2);
    } else if (kind === 'flamer') {
      len = 8;
      b.fillStyle = '#4a4a3a'; b.fillRect(0, -1, 8, 3);
      b.fillStyle = '#7d7d5e'; b.fillRect(1, -1, 6, 1);
      b.fillStyle = '#2a2a20'; b.fillRect(4, 2, 4, 2);
      b.fillStyle = '#e8b98d'; b.fillRect(-2, 1, 2, 2);
    } else if (kind === 'laser') {
      len = 10;
      b.fillStyle = '#2f3a46'; b.fillRect(0, -1, 9, 2);
      b.fillStyle = def.color; b.fillRect(2, -1, 6, 1);
      b.fillStyle = '#22303a'; b.fillRect(1, 1, 2, 3);
      b.fillStyle = '#e8b98d'; b.fillRect(-2, 0, 2, 2);
    } else if (kind === 'blade') {
      len = 10;
      b.fillStyle = '#2b2f36'; b.fillRect(-2, 1, 4, 2);
      b.fillStyle = def.color; b.fillRect(0, -0.6, 10, 1.2);
      b.fillStyle = 'rgba(255,255,255,0.7)'; b.fillRect(1, -0.6, 8, 0.6);
      b.fillStyle = '#e8b98d'; b.fillRect(-2, 2, 2, 2);
    } else if (kind === 'knife') {
      len = 6;
      b.fillStyle = '#d7dde5'; b.fillRect(0, -0.5, 6, 1);
      b.fillStyle = '#2b2f36'; b.fillRect(-2, 0, 2, 2);
      b.fillStyle = '#e8b98d'; b.fillRect(-2, 1, 2, 2);
    } else if (kind === 'axe') {
      len = 7;
      b.fillStyle = '#6b4f2a'; b.fillRect(0, -0.5, 8, 2);
      b.fillStyle = '#b9c3cf'; b.fillRect(5, -3, 3, 6);
      b.fillStyle = '#8b96a3'; b.fillRect(6, -2, 1, 4);
      b.fillStyle = '#e8b98d'; b.fillRect(-2, 1, 2, 2);
    } else if (kind === 'spear') {
      len = 12;
      b.fillStyle = '#6b4f2a'; b.fillRect(-2, 0, 12, 1);
      b.fillStyle = '#cfd8e3'; b.fillRect(10, -1, 4, 3);
      b.fillStyle = '#e8b98d'; b.fillRect(-2, 1, 2, 2);
    } else if (kind === 'saw') {
      len = 6;
      b.fillStyle = '#3a4147'; b.fillRect(0, -1, 6, 3);
      b.fillStyle = '#9aa6b4';
      for (var q = 0; q < 6; q += 2) b.fillRect(q, -2, 1, 1);
      b.fillStyle = '#2a2f34'; b.fillRect(-2, 0, 2, 2);
      b.fillStyle = '#e8b98d'; b.fillRect(-2, 1, 2, 2);
    } else if (kind === 'fist') {
      len = 3;
      b.fillStyle = '#4b535d'; b.fillRect(0, -2, 3, 4);
      b.fillStyle = '#8b96a3'; b.fillRect(0, -2, 2, 2);
      b.fillStyle = '#e8b98d'; b.fillRect(-1, 2, 2, 2);
    } else if (kind === 'drill') {
      len = 5;
      b.fillStyle = '#4b535d'; b.fillRect(0, -2, 4, 4);
      b.fillStyle = '#c9d1d9';
      b.beginPath(); b.moveTo(4, -2); b.lineTo(8, 0); b.lineTo(4, 2); b.closePath(); b.fill();
      b.fillStyle = '#e8b98d'; b.fillRect(-1, 2, 2, 2);
    } else if (kind === 'whip') {
      len = 4;
      b.strokeStyle = def.color; b.lineWidth = 1;
      b.beginPath(); b.moveTo(0, 0); b.quadraticCurveTo(6, -4, 11, 1); b.stroke();
      b.fillStyle = '#e8b98d'; b.fillRect(-1, 0, 2, 2);
    } else if (kind === 'shield') {
      len = 3;
      b.fillStyle = '#5c6672'; b.fillRect(0, -4, 3, 8);
      b.fillStyle = def.color; b.fillRect(0, -3, 1, 6);
      b.fillStyle = '#e8b98d'; b.fillRect(-1, 2, 2, 2);
    } else if (kind === 'baton') {
      len = 5;
      b.fillStyle = '#2b2f36'; b.fillRect(0, -1, 2, 2);
      b.fillStyle = '#7ee8fa'; b.fillRect(2, -0.5, 4, 1);
      b.fillStyle = '#e8b98d'; b.fillRect(-1, 1, 2, 2);
    } else {
      len = 7;
      b.fillStyle = '#3d444e'; b.fillRect(0, -1, 7, 2);
      b.fillStyle = '#828d9c'; b.fillRect(0, -1, 6, 1);
      b.fillStyle = '#e8b98d'; b.fillRect(-1, 2, 2, 2);
    }

    /* 枪口焰：只有枪械才有 */
    if (p.fireT > 0 && kind !== 'blade' && kind !== 'knife' && kind !== 'axe' &&
        kind !== 'spear' && kind !== 'saw' && kind !== 'fist' && kind !== 'drill' &&
        kind !== 'shield' && kind !== 'whip' && kind !== 'baton') {
      var f = Math.min(1, p.fireT / 0.07);
      b.globalAlpha = (f * 0.95).toFixed(2);
      b.fillStyle = '#fff3c4';
      b.fillRect(len - 1, -1, 2, 2);
      b.fillStyle = '#ffb86b';
      b.fillRect(len, -2, 1, 1);
      b.fillRect(len, 1, 1, 1);
      b.fillRect(len + 1, -1, 1, 2);
      b.globalAlpha = 1;
    }
    b.restore();
  };

  /**
   * 投掷动作：手从身后抬到耳边，再甩到身前。手里握的东西在出手瞬间消失，
   * 之后就是一只空手跟完（真正的投掷物由 bullets 里的 lob 接手）。
   */
  R.drawThrow = function (b, p) {
    var list = p.throws;
    if (!list || !list.length) return;
    var th = list[0];
    var k = th.dur > 0 ? th.t / th.dur : 1;
    if (k > 1) k = 1;
    var f = th.face || 1;

    var wx, wy, lift;
    if (k < 0.42) {
      /* 蓄力：手往身后、往上抬（要抬到身体轮廓外面才看得见） */
      var t0 = k / 0.42;
      wx = p.x - f * (2.6 + 4.4 * t0);
      wy = p.y - 2 - 5.4 * t0;
      lift = t0;
    } else {
      /* 出手：从耳后甩到身前，先快后慢 */
      var t1 = (k - 0.42) / 0.58;
      var e = 1 - (1 - t1) * (1 - t1);
      wx = p.x - f * 7.0 + f * 15.5 * e;
      wy = p.y - 7.4 + 6.6 * e;
      lift = 1 - e;
    }

    /* 手臂：先描一圈深色再上色，否则纯色手臂贴在同样颜色的外套上就看不见了 */
    var col = (R._run && R._run.char && R._run.char.color) || '#3b5b8a';
    var sx0 = p.x - f * 1.5, sy0 = p.y - 2.5 - lift * 1.4;
    var mx0 = (sx0 + wx) / 2, my0 = (sy0 + wy) / 2 - 1.6;
    b.strokeStyle = 'rgba(14,18,24,0.92)';
    b.lineWidth = 3;
    b.lineCap = 'round';
    b.beginPath();
    b.moveTo(sx0, sy0);
    b.lineTo(mx0, my0);
    b.lineTo(wx, wy);
    b.stroke();
    b.strokeStyle = col;
    b.lineWidth = 1.4;
    b.beginPath();
    b.moveTo(sx0, sy0);
    b.lineTo(mx0, my0);
    b.lineTo(wx, wy);
    b.stroke();
    b.lineCap = 'butt';

    /* 手 */
    b.fillStyle = '#e8b98d';
    b.fillRect(snap(wx) - 1, snap(wy) - 1, 2, 2);

    /* 还没出手：画手里的瓶子 / 榴弹 */
    if (!th.fired) {
      if (th.kind === 'grenade') {
        b.fillStyle = '#2f3a2c';
        b.fillRect(snap(wx) - 1, snap(wy) - 2, 3, 3);
        b.fillStyle = '#4b5a44';
        b.fillRect(snap(wx) - 1, snap(wy) - 2, 2, 1);
        b.fillStyle = '#8a9a7a';
        b.fillRect(snap(wx), snap(wy) - 3, 1, 1);
      } else {
        /* 燃烧瓶：瓶身 + 布条上的火苗 */
        b.fillStyle = '#6b5a2a';
        b.fillRect(snap(wx) - 1, snap(wy) - 2, 3, 4);
        b.fillStyle = '#a8894a';
        b.fillRect(snap(wx) - 1, snap(wy) - 2, 1, 3);
        b.fillStyle = '#d9a441';
        b.fillRect(snap(wx), snap(wy) - 4, 1, 2);
        b.fillStyle = '#ff8b3d';
        b.fillRect(snap(wx), snap(wy) - 5, 1, 1);
      }
    }
  };

  /**
   * 把一帧按「上半身 + 左腿 + 右腿」三段画出来。
   * 抬腿的做法是从源矩形底端截短（顶端固定），所以脚是真的离地，而不是整条腿缩进身体。
   */
  function blitWalk(b, f, left, top, w, h, s, sway, step, cutL, cutR) {
    var lr = f.lr;
    var topH = snap(lr * s);
    var legH = h - topH;                 // 用总高倒推，保证两段严丝合缝
    var legRows = f.h - lr;
    var edge = snap(w / 2);              // 左右腿各占一半
    var legTop = snap(top + topH);

    b.drawImage(S.img, f.x, f.y, f.w, lr, snap(left + sway), top, w, topH);
    b.drawImage(S.img, f.x, f.y + lr, f.w / 2, legRows,
      snap(left + step), legTop, edge, snap(legH - cutL));
    b.drawImage(S.img, f.x + f.w / 2, f.y + lr, f.w / 2, legRows,
      snap(left + w - edge - step), legTop, w - edge, snap(legH - cutR));
  }

  /**
   * 带步态的实体绘制。
   *
   * 精灵是整帧的，原来只让整块上下浮动，看着像在地上滑。这里按帧表的 `lr`
   * （腿部起始行）把一帧拆成三段画：上半身、左腿、右腿。
   *   - 两条腿反相抬起（源矩形从底部截短，顶端固定 → 脚离地）
   *   - 抬起的那条腿向中线收一点，形成跨步
   *   - 上半身按步频起伏、重心左右倒，并朝移动方向前倾（lean）
   * 站住（gait≈0）时自动退回一次整帧绘制，不额外吃性能。
   *
   * @param {number} phase 步态相位（弧度，由移动速度累积）
   * @param {number} gait  0~1 步态强度，0 是完全站住
   * @param {number} lean  朝向前倾量（逻辑像素，正为右）
   */
  R.drawActor = function (b, name, x, y, scale, phase, gait, lean, hitName, flashAlpha) {
    if (!S.ready) return;
    var f = S.frames[name];
    if (!f) return;

    var s = (scale || 1) * (f.s || 1);
    var w = snap(f.w * s);
    var h = snap(f.h * s);

    if (gait === undefined) gait = 1;
    gait = gait > 1 ? 1 : (gait < 0 ? 0 : gait);

    var walking = gait > 0.03 && !!f.lr;
    var sw = walking ? Math.sin(phase) : 0;
    var lift = walking ? Math.abs(sw) : 0;

    /* 走路时随步伐压重心；站住时换成慢呼吸，不会完全僵死 */
    var bob = walking ? -lift * 1.2 * gait : Math.sin(phase * 0.47) * 0.25;

    /* 重心在支撑腿上：抬左腿时上身往右压，这是"走"和"滑"最直观的差别。
       只作用在上半身，腿保持落点不动，否则整个人会左右平移。 */
    var sway = walking ? sw * 0.5 * gait : 0;

    var cx = x + (lean || 0) * gait;
    var left = snap(cx - w / 2);
    var top = snap(y - h / 2 + bob);

    var flash = !!(hitName && flashAlpha > 0.02) && !!S.frames[hitName];

    if (!walking) {
      b.drawImage(S.img, f.x, f.y, f.w, f.h, left, top, w, h);
      if (flash) {
        var hf0 = S.frames[hitName];
        var pv0 = b.globalAlpha;
        b.globalAlpha = pv0 * flashAlpha;
        b.drawImage(S.img, hf0.x, hf0.y, hf0.w, hf0.h, left, top, w, h);
        b.globalAlpha = pv0;
      }
      return;
    }

    var topH = snap(f.lr * s);
    var legH = h - topH;

    /* 抬腿与跨步都要按腿长封顶 —— 矮腿丧尸（只有 4 行腿）如果照搬大角色的
       幅度，抬一下就把整条腿截没了，看起来像腿断了。 */
    var maxCut = legH * 0.4;
    if (maxCut > 1.0) maxCut = 1.0;
    var step = sw * 0.4 * gait;
    var cutL = Math.max(0, sw) * maxCut * gait;
    var cutR = Math.max(0, -sw) * maxCut * gait;

    blitWalk(b, f, left, top, w, h, s, sway, step, cutL, cutR);

    /* 受击白闪：同样的分段再叠一层，否则会和正在抬起的腿错位成重影 */
    if (flash) {
      var hf = S.frames[hitName];
      var prev = b.globalAlpha;
      b.globalAlpha = prev * flashAlpha;
      blitWalk(b, hf, left, top, w, h, s, sway, step, cutL, cutR);
      b.globalAlpha = prev;
    }
  };

  R.drawEnemy = function (b, e) {
    if (e.boss) return;          // Boss 单独处理
    /* 屏幕外的不画，后期上百只时省下大量绘制 */
    if (e.x < P.camX - 48 || e.x > P.camX + P.VW + 48 ||
        e.y < P.camY - 64 || e.y > P.camY + P.VH + 64) return;
    if (e.roof) {
      /* 楼顶上的丧尸：影子要画在屋顶表面 */
      b.fillStyle = 'rgba(0,0,0,0.30)';
      b.fillRect(Math.round(e.x - e.r * 0.8), Math.round(e.y + e.r * 0.8), Math.round(e.r * 1.6), 2);
    }

    /* ---- 攻击动作细节 ----
       扑袭者蓄力：下蹲 3px + 脚下红圈随进度收紧（起跳前最亮）。
       呕酸尸蓄力：酸囊充气膨胀 + 脚下画出毒液即将覆盖的矩形预警框，
       框跟着蓄力方向转 —— 玩家看得见"要泼到哪"，躲得有依据。 */
    var esc = e.scale, ey2 = e.y;
    if (e.def.pounce && e.pounceState === 1) {
      var pw2 = Math.max(0, e.pounceWind / 0.5);
      ey2 = e.y + 3;
      b.strokeStyle = 'rgba(255,70,50,' + (0.22 + 0.4 * (1 - pw2)).toFixed(2) + ')';
      b.lineWidth = 1.5;
      b.beginPath();
      b.arc(e.x, e.y + 4, e.r + 7 - 4 * (1 - pw2), 0, U.TAU);
      b.stroke();
    } else if (e.def.pounce && e.pounceState === 3) {
      /* 踉跄：歪头晃两下，暗示"现在打它" */
      b.save();
      b.translate(e.x, e.y);
      b.rotate(Math.sin(e.anim * 9) * 0.12);
      b.translate(-e.x, -e.y);
      R.drawActor(b, e.spriteName, e.x, e.y, e.scale, e.anim, Math.min(0.3, e.gait),
        0, e.hitSprite, Math.min(0.45, e.flash * 0.65));
      b.restore();
      if (e.elite) {
        var bw3 = 18, by3 = e.y - e.r * 2.2 - 6;
        b.fillStyle = 'rgba(0,0,0,0.6)';
        b.fillRect(e.x - bw3 / 2 - 1, by3 - 1, bw3 + 2, 5);
        b.fillStyle = '#ffb86b';
        b.fillRect(e.x - bw3 / 2, by3, bw3 * Math.max(0, e.hp / e.maxHp), 3);
      }
      return;
    } else if (e.def.vomit && e.vomitState === 1) {
      var vw2 = Math.max(0, e.vomitWind / 0.7);
      b.save();
      b.translate(e.x, e.y);
      b.rotate(e.vomitAng || 0);
      b.strokeStyle = 'rgba(190,242,120,' + (0.16 + 0.32 * (1 - vw2)).toFixed(2) + ')';
      b.lineWidth = 1;
      b.strokeRect(0, -18, 124, 36);
      b.restore();
      esc = e.scale * (1 + 0.10 * (1 - vw2));
    } else if (e.def.vomit && e.vomitState === 2) {
      /* 喷吐：身体前倾 + 轻微痉挛 */
      b.save();
      b.translate(e.x, e.y);
      b.rotate((e.vomitAng || 0) * 0.06 + Math.sin(e.anim * 16) * 0.03);
      b.translate(-e.x, -e.y);
      R.drawActor(b, e.spriteName, e.x, e.y, e.scale * 1.04, e.anim, 0.4,
        0.8, e.hitSprite, Math.min(0.45, e.flash * 0.65));
      b.restore();
      if (e.elite) {
        var bw4 = 18, by4 = e.y - e.r * 2.2 - 6;
        b.fillStyle = 'rgba(0,0,0,0.6)';
        b.fillRect(e.x - bw4 / 2 - 1, by4 - 1, bw4 + 2, 5);
        b.fillStyle = '#ffb86b';
        b.fillRect(e.x - bw4 / 2, by4, bw4 * Math.max(0, e.hp / e.maxHp), 3);
      }
      return;
    }

    R.drawActor(b, e.spriteName, e.x, ey2, esc, e.anim, e.gait,
      e.lean, e.hitSprite, Math.min(0.45, e.flash * 0.65));
    if (e.slow > 0) {
      b.fillStyle = 'rgba(140,210,255,0.16)';
      b.fillRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
    }
    if (e.elite) {
      var bw = 18;
      var by = e.y - e.r * 2.2 - 6;
      b.fillStyle = 'rgba(0,0,0,0.6)';
      b.fillRect(e.x - bw / 2 - 1, by - 1, bw + 2, 5);
      b.fillStyle = '#ffb86b';
      b.fillRect(e.x - bw / 2, by, bw * Math.max(0, e.hp / e.maxHp), 3);
    }
  };

  /** 站上楼顶时，Boss 还在地面：只画一圈红色声呐，提示它的位置 */
  R.drawBossGhost = function (b, e, run) {
    var pulse = 0.30 + 0.26 * Math.sin(run.t * 4);
    b.fillStyle = 'rgba(255,40,40,0.08)';
    b.beginPath(); b.arc(e.x, e.y, e.r * 1.5, 0, U.TAU); b.fill();
    b.strokeStyle = 'rgba(255,64,64,' + pulse.toFixed(2) + ')';
    b.lineWidth = 2;
    b.beginPath();
    b.arc(e.x, e.y, e.r * 1.1 + 5 + Math.sin(run.t * 2.4) * 3, 0, U.TAU);
    b.stroke();
    b.fillStyle = 'rgba(255,90,90,0.75)';
    b.fillRect(e.x - 2, e.y - 2, 4, 4);
  };

  /* ================= 建筑：室内 / 屋顶 ================= */

  var FC = {
    wood: '#5c4229', woodL: '#7a5a37', woodD: '#3a2a1a',
    metal: '#58616b', metalL: '#87919c', metalD: '#333940',
    white: '#b9c2cb', whiteD: '#8d97a1',
    cloth: '#4f5f6e', clothL: '#6b7c8c', dark: '#12161b'
  };

  function fshadow(b, f) {
    b.fillStyle = 'rgba(0,0,0,0.26)';
    b.fillRect(f.x0 + 2, f.y0 + 3, f.w, f.h);
  }

  function lootHint(b, x, y, t, near) {
    var pulse = near ? (0.62 + 0.34 * Math.sin(t * 6)) : (0.38 + 0.20 * Math.sin(t * 4));
    var s = near ? 3.4 : 2.7;
    var prev = b.globalAlpha;
    b.globalAlpha = prev * pulse;
    b.fillStyle = '#2a1e08';
    b.beginPath();
    b.moveTo(x, y - s - 1); b.lineTo(x + s + 1, y); b.lineTo(x, y + s + 1); b.lineTo(x - s - 1, y);
    b.closePath(); b.fill();
    b.fillStyle = '#ffd166';
    b.beginPath();
    b.moveTo(x, y - s); b.lineTo(x + s, y); b.lineTo(x, y + s); b.lineTo(x - s, y);
    b.closePath(); b.fill();
    b.fillStyle = 'rgba(255,255,255,0.85)';
    b.fillRect(x - 1, y - 1, 2, 2);
    b.globalAlpha = prev;
  }
  R.drawLootHint = lootHint;

  /* ---------------- 家具（俯视像素画） ---------------- */

  var FURNISH = {
    bed: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = FC.woodD; b.fillRect(x, y, w, h);
      b.fillStyle = '#7f8b96'; b.fillRect(x + 1, y + 2, w - 2, h - 4);
      b.fillStyle = '#9aa6b2'; b.fillRect(x + 1, y + 2, w - 2, 3);
      b.fillStyle = '#d7dbe0'; b.fillRect(x + 2, y + 2, 5, 3);
      var blanket = f.seed % 3 === 0 ? '#6d3b3b' : (f.seed % 3 === 1 ? '#3d5163' : '#4c5c40');
      b.fillStyle = blanket; b.fillRect(x + 1, y + 7, w - 2, h - 9);
      b.fillStyle = 'rgba(0,0,0,0.20)'; b.fillRect(x + 1, y + 7, w - 2, 1);
      b.fillStyle = 'rgba(0,0,0,0.22)';
      b.fillRect(x + 4 + (f.seed % 5), y + 9, 3, 1);
    },
    couch: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#2f3d4a'; b.fillRect(x, y, w, h);
      b.fillStyle = '#41525f'; b.fillRect(x + 1, y + 3, w - 2, h - 5);
      b.fillStyle = '#4f6270'; b.fillRect(x + 3, y + 4, w / 2 - 4, h - 7);
      b.fillRect(x + w / 2 + 1, y + 4, w / 2 - 4, h - 7);
      b.fillStyle = '#26323c';
      b.fillRect(x, y, 2, h); b.fillRect(x + w - 2, y, 2, h);
      b.fillRect(x + 2, y, w - 4, 2);
      b.fillStyle = 'rgba(210,200,170,0.30)';
      b.fillRect(x + 4 + (f.seed % 4), y + h - 5, 3, 2);
    },
    table: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = FC.woodD; b.fillRect(x, y, w, h);
      b.fillStyle = FC.wood; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = FC.woodL; b.fillRect(x + 2, y + 2, w - 4, 2);
      b.fillStyle = 'rgba(0,0,0,0.30)';
      b.fillRect(x + 1, y + 1, w - 2, 1);
      b.fillRect(x + 1, y + h - 2, w - 2, 1);
      b.fillStyle = '#2a2018';
      b.fillRect(x, y, 1, h); b.fillRect(x + w - 1, y, 1, h);
      if (f.seed % 2 === 0) {
        b.fillStyle = '#c8ccd2'; b.fillRect(x + w - 5, y + 3, 3, 2);
        b.fillStyle = '#8a5a2a'; b.fillRect(x + w - 4, y + 2, 1, 1);
      }
    },
    shelf: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = FC.woodD; b.fillRect(x, y, w, h);
      b.fillStyle = FC.wood; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = FC.woodD;
      b.fillRect(x + 1, y + 1, w - 2, 1);
      b.fillRect(x + 1, y + h - 2, w - 2, 1);
      var rows = Math.max(2, (h / 5) | 0);
      for (var r = 1; r < rows; r++) {
        var ry = y + (h / rows) * r;
        b.fillStyle = '#3a2a1a'; b.fillRect(x + 1, ry, w - 2, 1);
        b.fillStyle = 'rgba(255,255,255,0.05)'; b.fillRect(x + 1, ry + 1, w - 2, 1);
        for (var k = 0; k < 2; k++) {
          if (U.hash(f.seed, r * 7 + k, 1901) < 0.45) continue;
          b.fillStyle = U.hash(f.seed, r * 9 + k, 1903) < 0.5 ? '#8c3a3a' : '#3f5a46';
          b.fillRect(x + 2 + k * 3, ry - 3, 2, 3);
        }
      }
      b.fillStyle = 'rgba(0,0,0,0.22)';
      b.fillRect(x + w - 2, y, 2, h);
    },
    fridge: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = FC.metalD; b.fillRect(x, y, w, h);
      b.fillStyle = '#a7b0b9'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = '#c3cbd2'; b.fillRect(x + 1, y + 1, w - 2, 2);
      b.fillStyle = '#7b858f'; b.fillRect(x + 1, y + (h * 0.38) | 0, w - 2, 1);
      b.fillStyle = '#5f6a74'; b.fillRect(x + w - 3, y + 3, 1, 3);
      b.fillRect(x + w - 3, y + (h * 0.55) | 0, 1, 3);
      b.fillStyle = 'rgba(90,52,32,0.35)';
      b.fillRect(x + 1, y + h - 3, 3, 2);
      b.fillStyle = 'rgba(255,255,255,0.10)';
      b.fillRect(x + 2, y + 2, 1, h - 4);
    },
    cabinet: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = FC.woodD; b.fillRect(x, y, w, h);
      b.fillStyle = '#4a3524'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = 'rgba(255,255,255,0.06)'; b.fillRect(x + 2, y + 2, w - 4, 1);
      b.fillStyle = '#2c2015'; b.fillRect(x + (w / 2) | 0, y + 1, 1, h - 2);
      b.fillStyle = '#b9a56f';
      b.fillRect(x + (w / 2) - 2, y + (h / 2) | 0, 1, 4);
      b.fillRect(x + (w / 2) + 1, y + (h / 2) | 0, 1, 4);
    },
    tv: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#1a1e24'; b.fillRect(x, y, w, h);
      b.fillStyle = '#0d1218'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = '#20303a'; b.fillRect(x + 2, y + 2, w - 4, h - 5);
      b.fillStyle = 'rgba(255,60,60,0.55)'; b.fillRect(x + w - 3, y + h - 3, 1, 1);
      b.strokeStyle = 'rgba(150,190,205,0.20)'; b.lineWidth = 1;
      b.beginPath(); b.moveTo(x + 3, y + 2); b.lineTo(x + w - 4, y + h - 4); b.stroke();
    },
    crate: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = FC.woodD; b.fillRect(x, y, w, h);
      b.fillStyle = FC.wood; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = FC.woodL; b.fillRect(x + 1, y + 1, w - 2, 2);
      b.fillStyle = '#3a2a1a';
      b.fillRect(x + 2, y + 2, w - 4, 1);
      b.fillRect(x + 2, y + h - 3, w - 4, 1);
      b.strokeStyle = 'rgba(0,0,0,0.35)';
      b.lineWidth = 1;
      b.beginPath();
      b.moveTo(x + 2, y + 2); b.lineTo(x + w - 2, y + h - 2);
      b.moveTo(x + w - 2, y + 2); b.lineTo(x + 2, y + h - 2);
      b.stroke();
      b.fillStyle = 'rgba(255,235,200,0.10)';
      b.fillRect(x + 2, y + 2, 2, 1);
    },
    desk: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = FC.woodD; b.fillRect(x, y, w, h);
      b.fillStyle = '#6b4c2e'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = '#8a6742'; b.fillRect(x + 2, y + 2, w - 4, 2);
      b.fillStyle = 'rgba(0,0,0,0.25)'; b.fillRect(x + 1, y + h - 2, w - 2, 1);
      b.fillStyle = '#3d2a1a'; b.fillRect(x + w - 9, y + 3, 7, h - 6);
      b.fillStyle = '#6a717a'; b.fillRect(x + w - 8, y + 4, 5, 1);
      b.fillStyle = 'rgba(225,222,208,0.55)'; b.fillRect(x + 3, y + 3, 5, 3);
      b.fillStyle = '#20252c'; b.fillRect(x + 4, y + 3, 3, 1);
    },
    copier: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#3a4149'; b.fillRect(x, y, w, h);
      b.fillStyle = '#a2adb7'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = '#c2cbd3'; b.fillRect(x + 1, y + 1, w - 2, 3);
      b.fillStyle = '#2b3138'; b.fillRect(x + 3, y + 4, w - 6, 2);
      b.fillStyle = '#7d8994'; b.fillRect(x + 3, y + h - 4, w - 6, 2);
      b.fillStyle = '#8ce99a'; b.fillRect(x + w - 4, y + 3, 1, 1);
      b.fillStyle = 'rgba(0,0,0,0.18)'; b.fillRect(x + 2, y + 7, w - 4, 1);
    },
    rack: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#1a1e23'; b.fillRect(x, y, w, h);
      b.fillStyle = '#2b3138'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      for (var r = 0; r < 4; r++) {
        var ry = y + 3 + r * ((h - 6) / 4);
        b.fillStyle = '#14181d'; b.fillRect(x + 2, ry | 0, w - 4, 2);
        b.fillStyle = r % 2 === 0 ? '#8ce99a' : '#ffd166';
        b.fillRect(x + 3, (ry | 0) + 1, 1, 1);
        b.fillStyle = 'rgba(255,255,255,0.10)'; b.fillRect(x + 5, (ry | 0), w - 8, 1);
      }
    },
    vending: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#231d1a'; b.fillRect(x, y, w, h);
      b.fillStyle = '#8f2f2a'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = '#c9d7e2'; b.fillRect(x + 2, y + 2, w - 4, h - 8);
      b.fillStyle = 'rgba(30,40,50,0.65)'; b.fillRect(x + 2, y + 2, w - 4, 2);
      for (var r = 0; r < 3; r++) {
        for (var k = 0; k < 2; k++) {
          b.fillStyle = (r + k) % 2 === 0 ? '#e08a3c' : '#4a9ac2';
          b.fillRect(x + 3 + k * 3, y + 5 + r * 4, 2, 3);
        }
      }
      b.fillStyle = '#2a1f18'; b.fillRect(x + 2, y + h - 5, w - 4, 3);
      b.fillStyle = 'rgba(255,220,160,0.20)'; b.fillRect(x + 1, y + 1, 1, h - 2);
    },
    planter: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#5a3a28'; b.fillRect(x + 1, y + 2, w - 2, h - 2);
      b.fillStyle = '#7a4a32'; b.fillRect(x + 2, y + 2, w - 4, h - 3);
      b.fillStyle = '#3a2a20'; b.fillRect(x + 2, y + 2, w - 4, 1);
      b.fillStyle = 'rgba(76,98,52,0.75)';
      b.fillRect(x + (w / 2) | 0, y, 1, 3);
      b.fillRect(x + (w / 2) - 2, y + 1, 1, 2);
      b.fillRect(x + (w / 2) + 1, y + 1, 1, 2);
      b.fillStyle = '#8a6742'; b.fillRect(x + 1, y + 1, w - 2, 1);
    },
    cooler: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#9aa4ad'; b.fillRect(x + 1, y + h / 2, w - 2, h / 2);
      b.fillStyle = '#c5cdd5'; b.fillRect(x + 2, y + h / 2 + 1, w - 4, 2);
      b.fillStyle = '#4a9ac2'; b.fillRect(x + 2, y + 2, w - 4, h / 2 - 1);
      b.fillStyle = 'rgba(200,240,255,0.45)'; b.fillRect(x + 3, y + 3, 1, h / 2 - 3);
      b.fillStyle = '#7b858f'; b.fillRect(x + (w / 2) - 1, y + h / 2, 2, 2);
    },
    barrel: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#3a4148'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = '#6a4a2a'; b.fillRect(x + 2, y + 2, w - 4, h - 4);
      b.fillStyle = '#875c33'; b.fillRect(x + 2, y + 2, w - 4, 2);
      b.fillStyle = 'rgba(0,0,0,0.30)';
      b.fillRect(x + 2, y + (h / 3) | 0, w - 4, 1);
      b.fillRect(x + 2, y + (h * 2 / 3) | 0, w - 4, 1);
      b.fillStyle = 'rgba(255,255,255,0.10)'; b.fillRect(x + 3, y + 3, 1, h - 6);
    },
    pallet: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = FC.woodD; b.fillRect(x, y, w, h);
      b.fillStyle = FC.wood;
      for (var k = 0; k < 4; k++) b.fillRect(x + 1, y + 1 + k * ((h - 2) / 4), w - 2, 2);
      b.fillStyle = '#3a2a1a';
      b.fillRect(x + 3, y, 1, h); b.fillRect(x + w - 4, y, 1, h);
      b.fillStyle = 'rgba(255,255,255,0.06)'; b.fillRect(x + 1, y + 1, w - 2, 1);
    },
    workbench: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#2d2620'; b.fillRect(x, y, w, h);
      b.fillStyle = '#6b4c2e'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = '#8a6742'; b.fillRect(x + 2, y + 2, w - 4, 2);
      b.fillStyle = '#4a3a2c'; b.fillRect(x + 1, y + h - 4, w - 2, 3);
      b.fillStyle = '#a8442f'; b.fillRect(x + 3, y + 4, 4, 3);
      b.fillStyle = '#3a3f45'; b.fillRect(x + 4, y + 4, 2, 1);
      b.strokeStyle = '#b9c2cb'; b.lineWidth = 1;
      b.beginPath(); b.moveTo(x + w - 8, y + 5); b.lineTo(x + w - 4, y + 8); b.stroke();
      b.fillStyle = '#b9c2cb'; b.fillRect(x + w - 9, y + 4, 2, 1);
    },
    locker: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#333a41'; b.fillRect(x, y, w, h);
      b.fillStyle = '#5c6670'; b.fillRect(x + 1, y + 1, w - 2, h - 2);
      b.fillStyle = '#48515a'; b.fillRect(x + 2, y + 2, w - 4, h - 4);
      b.fillStyle = '#2a3036'; b.fillRect(x + (w / 2) | 0, y + 1, 1, h - 2);
      b.fillStyle = '#8a97a4';
      b.fillRect(x + 3, y + 3, 1, 3);
      b.fillRect(x + w - 4, y + 3, 1, 3);
      b.fillStyle = 'rgba(0,0,0,0.30)'; b.fillRect(x + 3, y + h - 4, w - 6, 1);
      b.fillStyle = 'rgba(120,70,40,0.35)'; b.fillRect(x + 2, y + h - 3, 2, 1);
    },
    bag: function (b, f) {
      var x = f.x0, y = f.y0, w = f.w, h = f.h;
      fshadow(b, f);
      b.fillStyle = '#4a3b28';
      b.beginPath();
      b.ellipse ? b.ellipse(x + w / 2, y + h / 2, w / 2 - 1, h / 2 - 1, 0, 0, U.TAU)
        : b.arc(x + w / 2, y + h / 2, w / 2 - 1, 0, U.TAU);
      b.fill();
      b.fillStyle = '#6b5539';
      b.beginPath(); b.arc(x + w / 2, y + h / 2 - 1, w / 3, 0, U.TAU); b.fill();
      b.fillStyle = '#2a2118'; b.fillRect(x + w / 2 - 1, y, 2, 2);
      b.fillStyle = 'rgba(255,235,200,0.16)'; b.fillRect(x + 2, y + 2, 1, 2);
    }
  };

  R.drawFurniture = function (b, f, bd) {
    if (f.broken) {
      rubble(b, (f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, 6, f.seed, 2101);
      return;
    }
    var fn = FURNISH[f.kindId] || FURNISH.crate;
    fn(b, f);
    if (f.looted) {
      b.fillStyle = 'rgba(0,0,0,0.20)';
      b.fillRect(f.x0, f.y0, f.w, f.h);
      b.fillStyle = 'rgba(220,220,215,0.25)';
      b.fillRect(f.x0 + 2, f.y0 + 2, 2, 1);
    }
  };

  /** 室内灯光：每栋楼有一点自己的光源，进楼不至于全黑 */
  function interiorLamp(b, bd, t) {
    var sd = bd.seed;
    if (U.hash(sd, 71, 1401) < 0.22) return;
    var x0 = bd.ix0, y0 = bd.iy0, w = bd.ix1 - bd.ix0, h = bd.iy1 - bd.iy0;
    var lx = x0 + w * 0.5 + (U.hash(sd, 72, 1403) - 0.5) * w * 0.46;
    var ly = y0 + h * 0.38 + (U.hash(sd, 73, 1405) - 0.5) * h * 0.32;
    var warm = bd.kind === 'house';
    var fl = 0.72 + 0.28 * Math.sin(t * 2.1 + sd * 0.01);
    if (U.hash(sd, 74, 1407) > 0.86) fl *= 0.45;   // 快坏掉的灯
    var col = warm ? '255,196,120' : '190,220,235';
    for (var ri = 3; ri >= 1; ri--) {
      b.fillStyle = 'rgba(' + col + ',' + (0.045 * ri * fl).toFixed(3) + ')';
      b.beginPath(); b.arc(lx, ly, ri * 9, 0, U.TAU); b.fill();
    }
    b.fillStyle = warm ? '#d8b06a' : '#aebfc9';
    b.fillRect((lx - 3) | 0, (ly - 1) | 0, 6, 2);
    b.fillStyle = 'rgba(255,255,255,0.6)';
    b.fillRect((lx - 2) | 0, (ly - 1) | 0, 4, 1);
  }

  /** 室内楼梯：深色梯井 + 向上的金色箭头 */
  function drawStairs(b, bd, t) {
    var s = bd.stairs;
    if (!s) return;
    b.fillStyle = 'rgba(0,0,0,0.35)';
    b.fillRect(s.x0 + 2, s.y0 + 3, s.w, s.h);
    b.fillStyle = '#0b0e12';
    b.fillRect(s.x0, s.y0, s.w, s.h);
    for (var i = 0; i < 5; i++) {
      b.fillStyle = i % 2 === 0 ? '#313842' : '#242a32';
      b.fillRect(s.x0 + 2, s.y0 + 2 + i * 3, s.w - 4, 2);
    }
    b.fillStyle = '#5d6670';
    b.fillRect(s.x0 + 1, s.y0, 1, s.h);
    b.fillRect(s.x1 - 2, s.y0, 1, s.h);
    b.fillStyle = 'rgba(255,255,255,0.08)';
    b.fillRect(s.x0 + 2, s.y0, s.w - 4, 1);
    var pulse = 0.52 + 0.34 * Math.sin(t * 4 + bd.seed * 0.02);
    b.fillStyle = 'rgba(255,209,102,' + pulse.toFixed(2) + ')';
    b.beginPath();
    b.moveTo(s.x, s.y - 5); b.lineTo(s.x + 4, s.y - 1); b.lineTo(s.x - 4, s.y - 1);
    b.closePath(); b.fill();
    b.fillStyle = 'rgba(255,209,102,' + (pulse * 0.7).toFixed(2) + ')';
    b.fillRect(s.x - 1, s.y + 1, 2, 3);
  }

  function chevron(b, x, y, dx, dy, size, color) {
    b.strokeStyle = color;
    b.lineWidth = 2;
    b.beginPath();
    b.moveTo(x - dx * size - dy * size, y - dy * size + dx * size);
    b.lineTo(x, y);
    b.lineTo(x - dx * size + dy * size, y - dy * size - dx * size);
    b.stroke();
  }

  /* ---------------- 废墟 ---------------- */

  /**
   * 废墟：塌掉的屋顶、断墙、瓦砾堆。整块是实心路障，不能进入。
   * 视觉上要一眼和「完整建筑的屋顶」区分开：没有完整屋面，只有塌陷顶板和残墙。
   */
  R.drawRuin = function (b, bd, run) {
    var pal = bd.pal, sd = bd.seed;
    var x0 = bd.x0, y0 = bd.y0, x1 = bd.x1, y1 = bd.y1;
    var w = bd.w, h = bd.h;
    var i, k;

    /* 落地长影 */
    b.fillStyle = 'rgba(0,0,0,0.30)';
    b.fillRect(x0 + 8, y0 + 11, w, h);

    /* 瓦砾基底：边缘稍微缺角，不要像个完整矩形 */
    b.fillStyle = '#17191d';
    b.fillRect(x0 + 1, y0 + 2, w - 2, h - 3);
    b.fillStyle = '#26282a';
    b.fillRect(x0 + 4, y0 + 4, w - 8, h - 8);
    b.fillStyle = '#2e2b26';
    b.fillRect(x0 + 7, y0 + 6, w - 14, h - 12);

    /* 残存的地板 / 地砖 */
    for (i = 0; i < 7; i++) {
      var fw = 8 + (U.hash(sd, i + 11, 7101) * 24) | 0;
      var fh = 6 + (U.hash(sd, i + 12, 7103) * 16) | 0;
      var fx = x0 + 7 + U.hash(sd, i + 13, 7105) * Math.max(1, w - 14 - fw);
      var fy = y0 + 7 + U.hash(sd, i + 14, 7107) * Math.max(1, h - 14 - fh);
      b.fillStyle = i % 2 === 0 ? U.mix(pal.floor, '#1a1b1e', 0.35) : U.mix(pal.floor2, '#16181b', 0.3);
      b.fillRect(fx | 0, fy | 0, fw, fh);
      b.strokeStyle = 'rgba(0,0,0,0.30)';
      b.lineWidth = 1;
      b.strokeRect((fx | 0) + 0.5, (fy | 0) + 0.5, fw, fh);
      if (U.hash(sd, i + 15, 7109) > 0.5) {
        crack(b, fx + 2, fy + 2, 0.6, Math.min(fw, 14), sd + i, 7111, 'rgba(0,0,0,0.30)', 1);
      }
    }

    /* 泥土 / 灰烬 / 焦痕 */
    for (i = 0; i < 8; i++) {
      var ex = x0 + 8 + U.hash(sd, i + 21, 7121) * (w - 16);
      var ey = y0 + 8 + U.hash(sd, i + 22, 7123) * (h - 16);
      ellipseFill(b, ex, ey, 4 + U.hash(sd, i, 7125) * 9, 3 + U.hash(sd, i, 7127) * 6,
        i % 3 === 0 ? 'rgba(12,10,8,0.30)' : 'rgba(58,48,38,0.22)');
    }
    scorch(b, x0 + w * 0.3 + (U.hash(sd, 31, 7131) - 0.5) * w * 0.3,
      y0 + h * 0.4 + (U.hash(sd, 32, 7133) - 0.5) * h * 0.3,
      9 + U.hash(sd, 33, 7135) * 8, sd + 313);

    /* 塌陷的地板洞：露出下面的黑，边上全是碎块 */
    var hx = x0 + w * (0.3 + U.hash(sd, 34, 7137) * 0.4);
    var hy = y0 + h * (0.3 + U.hash(sd, 35, 7139) * 0.4);
    ellipseFill(b, hx, hy, 8 + U.hash(sd, 36, 7142) * 9, 6 + U.hash(sd, 37, 7144) * 6, '#08090b');
    ellipseFill(b, hx, hy, 5 + U.hash(sd, 38, 7146) * 6, 3 + U.hash(sd, 39, 7148) * 4, '#111317');
    b.strokeStyle = 'rgba(92,78,62,0.45)';
    b.lineWidth = 1;
    b.beginPath();
    b.moveTo(hx - 9, hy + 1); b.lineTo(hx + 9, hy - 2);
    b.moveTo(hx - 4, hy - 5); b.lineTo(hx + 5, hy + 5);
    b.stroke();
    for (i = 0; i < 7; i++) {
      rubble(b, hx + Math.cos(i * 0.9) * 11, hy + Math.sin(i * 0.9) * 7, 2, sd + i, 7140);
    }

    /* 塌下来的顶板：几块形状不规则的屋面，压住半间房 */
    var slabs = 2 + (U.hash(sd, 41, 7141) > 0.55 ? 1 : 0);
    for (i = 0; i < slabs; i++) {
      var sw = w * (0.24 + U.hash(sd, i + 42, 7143) * 0.16);
      var sh = h * (0.20 + U.hash(sd, i + 43, 7145) * 0.14);
      var sx = x0 + 8 + U.hash(sd, i + 44, 7147) * Math.max(1, w - 16 - sw);
      var sy = y0 + 8 + U.hash(sd, i + 45, 7149) * Math.max(1, h - 16 - sh);
      var ang = (U.hash(sd, i + 46, 7151) - 0.5) * 0.46;
      var hw = sw / 2, hh2 = sh / 2;
      var j1 = 1 + U.hash(sd, i + 47, 7153) * 4;
      var j2 = 1 + U.hash(sd, i + 48, 7155) * 4;
      var j3 = 1 + U.hash(sd, i + 49, 7157) * 4;
      b.save();
      b.translate(sx + sw / 2, sy + sh / 2);
      b.rotate(ang);
      /* 投影 */
      b.fillStyle = 'rgba(0,0,0,0.38)';
      b.beginPath();
      b.moveTo(-hw + j1 + 3, -hh2 + j2 + 4);
      b.lineTo(hw - j2 + 3, -hh2 + j3 + 4);
      b.lineTo(hw - j3 + 3, hh2 - j1 + 4);
      b.lineTo(-hw + j2 + 3, hh2 - j2 + 4);
      b.closePath(); b.fill();
      /* 顶板本体 */
      b.fillStyle = U.mix(pal.roof, '#17181a', 0.50);
      b.beginPath();
      b.moveTo(-hw + j1, -hh2 + j2);
      b.lineTo(-hw * 0.25, -hh2 + 1);
      b.lineTo(hw - j2, -hh2 + j3);
      b.lineTo(hw - j3, -hh2 * 0.2);
      b.lineTo(hw - j1, hh2 - j1);
      b.lineTo(hw * 0.25, hh2 - 1);
      b.lineTo(-hw + j2, hh2 - j2);
      b.lineTo(-hw + j3, hh2 * 0.2);
      b.closePath(); b.fill();
      b.strokeStyle = 'rgba(0,0,0,0.40)';
      b.lineWidth = 1;
      b.stroke();
      /* 顶板裂缝与露出的钢筋 */
      b.strokeStyle = 'rgba(12,12,14,0.50)';
      b.beginPath();
      b.moveTo(-hw + 3, -hh2 + 3);
      b.lineTo(-hw + sw * 0.35, -hh2 + sh * 0.55);
      b.lineTo(-hw + sw * 0.2, hh2 - 2);
      b.stroke();
      b.strokeStyle = 'rgba(120,88,58,0.60)';
      for (var rr2 = 0; rr2 < 3; rr2++) {
        b.beginPath();
        b.moveTo(-hw + 4 + rr2 * 4, -hh2 + 2);
        b.lineTo(-hw + 6 + rr2 * 4, -hh2 + 8);
        b.stroke();
      }
      b.fillStyle = 'rgba(255,255,255,0.06)';
      b.fillRect(-hw + 2, -hh2 + 2, sw - 5, 1);
      b.restore();
    }

    /* 残墙：每条墙只留下几段，断口用碎砖收尾 */
    var WALL_T = HS.Buildings.WALL_T;
    var chunkCol = U.mix(pal.trim, '#2a2723', 0.40);
    var chunkCol2 = U.mix(pal.trim, '#17181a', 0.25);
    for (i = 0; i < bd.walls.length; i++) {
      var wl = bd.walls[i];
      var horizontal = (wl.side === 'N' || wl.side === 'S');
      var len = horizontal ? (wl.x1 - wl.x0) : (wl.y1 - wl.y0);
      if (len < 6) continue;
      var segs = 1 + ((U.hash(sd, i + 51, 7161) * 3) | 0);
      for (k = 0; k < segs; k++) {
        if (U.hash(sd, i * 7 + k + 52, 7163) < 0.22) continue;
        var seg = Math.min(len - 2, 6 + U.hash(sd, i * 13 + k + 53, 7165) * 18);
        var off = U.hash(sd, i * 17 + k + 54, 7167) * Math.max(1, len - seg);
        if (horizontal) {
          var wx = wl.x0 + off;
          b.fillStyle = chunkCol;
          b.fillRect(wx | 0, wl.y0, seg | 0, WALL_T);
          b.fillStyle = 'rgba(255,255,255,0.10)';
          b.fillRect(wx | 0, wl.y0, seg | 0, 1);
          b.fillStyle = 'rgba(0,0,0,0.30)';
          b.fillRect(wx | 0, (wl.y0 + WALL_T - 1) | 0, seg | 0, 1);
          if (U.hash(sd, i + k + 55, 7169) > 0.55) {
            b.fillStyle = chunkCol2;
            b.fillRect((wx + seg * 0.45) | 0, wl.y0 + 1, (seg * 0.35) | 0, WALL_T - 2);
          }
          /* 断口碎砖 */
          rubble(b, wx, wl.y0 + 3, 2, sd + i * 19 + k, 7171);
          rubble(b, wx + seg, wl.y0 + 3, 2, sd + i * 23 + k, 7173);
        } else {
          var wy = wl.y0 + off;
          b.fillStyle = chunkCol;
          b.fillRect(wl.x0, wy | 0, WALL_T, seg | 0);
          b.fillStyle = 'rgba(255,255,255,0.10)';
          b.fillRect(wl.x0, wy | 0, 1, seg | 0);
          b.fillStyle = 'rgba(0,0,0,0.30)';
          b.fillRect((wl.x0 + WALL_T - 1) | 0, wy | 0, 1, seg | 0);
          if (U.hash(sd, i + k + 56, 7175) > 0.55) {
            b.fillStyle = chunkCol2;
            b.fillRect(wl.x0 + 1, (wy + seg * 0.45) | 0, WALL_T - 2, (seg * 0.35) | 0);
          }
          rubble(b, wl.x0 + 3, wy, 2, sd + i * 29 + k, 7177);
          rubble(b, wl.x0 + 3, wy + seg, 2, sd + i * 31 + k, 7179);
        }
      }
    }

    /* 一段还站着的外墙：更高更厚，带窗洞，撑起「这里以前是楼房」的轮廓 */
    var standSide = sd % 4;
    var standLen = 18 + (U.hash(sd, 61, 7181) * 24) | 0;
    var sx2, sy2;
    if (standSide === 0) { sx2 = x0 + w * 0.2; sy2 = y0 + 2; }
    else if (standSide === 1) { sx2 = x0 + w * 0.2; sy2 = y1 - WALL_T - 3; }
    else if (standSide === 2) { sx2 = x0 + 2; sy2 = y0 + h * 0.2; }
    else { sx2 = x1 - WALL_T - 3; sy2 = y0 + h * 0.2; }
    b.fillStyle = 'rgba(0,0,0,0.35)';
    if (standSide < 2) b.fillRect(sx2 + 3, sy2 + 5, standLen, 9);
    else b.fillRect(sx2 + 5, sy2 + 3, 9, standLen);
    b.fillStyle = U.mix(pal.wall, '#2a2723', 0.18);
    if (standSide < 2) b.fillRect(sx2, sy2, standLen, 9);
    else b.fillRect(sx2, sy2, 9, standLen);
    b.fillStyle = chunkCol;
    if (standSide < 2) b.fillRect(sx2, sy2, standLen, 4);
    else b.fillRect(sx2, sy2, 4, standLen);
    b.fillStyle = 'rgba(255,255,255,0.12)';
    if (standSide < 2) b.fillRect(sx2, sy2, standLen, 1);
    else b.fillRect(sx2, sy2, 1, standLen);
    b.fillStyle = 'rgba(0,0,0,0.35)';
    if (standSide < 2) b.fillRect(sx2, sy2 + 6, standLen, 2);
    else b.fillRect(sx2 + 6, sy2, 2, standLen);
    /* 窗洞 */
    for (k = 0; k < 2; k++) {
      var wo = 5 + k * 11;
      if (standSide < 2) {
        b.fillStyle = '#131a20';
        b.fillRect((sx2 + wo) | 0, sy2 + 2, 5, 2);
      } else {
        b.fillStyle = '#131a20';
        b.fillRect(sx2 + 2, (sy2 + wo) | 0, 2, 5);
      }
    }
    /* 断掉的上沿钢筋 */
    b.strokeStyle = 'rgba(96,72,52,0.65)';
    b.lineWidth = 1;
    for (k = 0; k < 3; k++) {
      if (standSide < 2) {
        b.beginPath();
        b.moveTo(sx2 + 4 + k * 7, sy2 + 1);
        b.lineTo(sx2 + 6 + k * 7, sy2 - 3);
        b.stroke();
      } else {
        b.beginPath();
        b.moveTo(sx2 + 1, sy2 + 4 + k * 7);
        b.lineTo(sx2 - 3, sy2 + 6 + k * 7);
        b.stroke();
      }
    }

    /* 散落的梁 / 家具残骸 */
    for (i = 0; i < 5; i++) {
      var bx2 = x0 + 10 + U.hash(sd, i + 71, 7191) * (w - 20);
      var by2 = y0 + 10 + U.hash(sd, i + 72, 7193) * (h - 20);
      var ang2 = U.hash(sd, i + 73, 7195) * U.TAU;
      var blen = 8 + U.hash(sd, i + 74, 7197) * 18;
      b.strokeStyle = 'rgba(0,0,0,0.30)';
      b.lineWidth = 3;
      b.beginPath(); b.moveTo(bx2 + 2, by2 + 2); b.lineTo(bx2 + Math.cos(ang2) * blen + 2, by2 + Math.sin(ang2) * blen + 2); b.stroke();
      b.strokeStyle = i % 2 === 0 ? '#4a3524' : '#3a3a38';
      b.lineWidth = 2;
      b.beginPath(); b.moveTo(bx2, by2); b.lineTo(bx2 + Math.cos(ang2) * blen, by2 + Math.sin(ang2) * blen); b.stroke();
      b.strokeStyle = 'rgba(255,220,170,0.10)';
      b.lineWidth = 1;
      b.beginPath(); b.moveTo(bx2, by2 - 1); b.lineTo(bx2 + Math.cos(ang2) * blen, by2 + Math.sin(ang2) * blen - 1); b.stroke();
    }

    /* 密集瓦砾、碎砖、草与血 */
    for (i = 0; i < 14; i++) {
      rubble(b, x0 + 8 + U.hash(sd, i + 81, 7201) * (w - 16),
        y0 + 8 + U.hash(sd, i + 82, 7203) * (h - 16),
        2 + ((U.hash(sd, i, 7205) * 4) | 0), sd + i * 37, 7207);
    }
    for (i = 0; i < 3; i++) {
      weeds(b, x0 + 10 + U.hash(sd, i + 91, 7211) * (w - 20),
        y0 + 10 + U.hash(sd, i + 92, 7213) * (h - 20),
        3 + ((U.hash(sd, i, 7215) * 4) | 0), sd + i * 41, 7217);
    }
    bloodStain(b, x0 + w * (0.3 + U.hash(sd, 93, 7221) * 0.4),
      y0 + h * (0.3 + U.hash(sd, 94, 7223) * 0.4), 6, sd + 723, 7225);

    /* 外圈碎石带：让「实心路障」在视觉上成立 */
    for (i = 0; i < 10; i++) {
      var edge = i % 4;
      var ex2, ey2;
      if (edge === 0) { ex2 = x0 + U.hash(sd, i, 7231) * w; ey2 = y0 + 1; }
      else if (edge === 1) { ex2 = x0 + U.hash(sd, i, 7233) * w; ey2 = y1 - 2; }
      else if (edge === 2) { ex2 = x0 + 1; ey2 = y0 + U.hash(sd, i, 7235) * h; }
      else { ex2 = x1 - 2; ey2 = y0 + U.hash(sd, i, 7237) * h; }
      b.fillStyle = i % 3 === 0 ? '#5a5148' : '#3a3e44';
      b.fillRect(ex2 | 0, ey2 | 0, 2 + ((U.hash(sd, i, 7239) * 3) | 0), 2);
    }

    /* 塌到街上的碎块：别让废墟边缘像用尺子切出来的 */
    for (i = 0; i < 16; i++) {
      var side2 = i % 4;
      var out = 3 + U.hash(sd, i, 7241) * 9;
      var along = U.hash(sd, i, 7243);
      var dbx, dby;
      if (side2 === 0) { dbx = x0 + along * w; dby = y0 - out; }
      else if (side2 === 1) { dbx = x0 + along * w; dby = y1 + out; }
      else if (side2 === 2) { dbx = x0 - out; dby = y0 + along * h; }
      else { dbx = x1 + out; dby = y0 + along * h; }
      b.fillStyle = i % 3 === 0 ? '#5a5148' : (i % 3 === 1 ? '#3a3e44' : '#2e3236');
      b.fillRect(dbx | 0, dby | 0, 1 + ((U.hash(sd, i, 7245) * 3) | 0), 1 + ((U.hash(sd, i, 7247) * 2) | 0));
    }

    /* 废墟里残留的烟尘 */
    if (run) {
      var sm = 0.04 + 0.02 * Math.sin((run.t || 0) * 0.8 + sd);
      b.fillStyle = 'rgba(70,66,62,' + sm.toFixed(3) + ')';
      b.beginPath();
      b.arc(x0 + w * 0.62, y0 + h * 0.55, Math.min(w, h) * 0.26, 0, U.TAU);
      b.fill();
    }
  };

  /* ---------------- 室内基底 ---------------- */

  R.drawBuildingBase = function (b, bd) {
    if (bd.reveal <= 0.02) return;
    var pal = bd.pal, sd = bd.seed;
    var x0 = bd.ix0, y0 = bd.iy0, x1 = bd.ix1, y1 = bd.iy1;
    var w = x1 - x0, h = y1 - y0;
    var t = R._t || 0;
    var i, k;

    b.save();
    b.globalAlpha = Math.min(1, bd.reveal * 2.2);

    /* --- 地板 --- */
    b.fillStyle = pal.floor;
    b.fillRect(x0, y0, w, h);

    if (bd.kind === 'house' || bd.kind === 'motel') {
      for (var fy = y0 + 4; fy < y1; fy += 6) {
        b.fillStyle = pal.floor2;
        b.fillRect(x0, fy, w, 1);
      }
      b.fillStyle = 'rgba(0,0,0,0.13)';
      for (var px = x0 + 9; px < x1; px += 27) b.fillRect(px, y0, 1, h);
      /* 地毯 */
      if (w > 34 && h > 28) {
        var rx = x0 + 7 + U.hash(sd, 81, 1501) * (w - 34);
        var ry = y0 + 7 + U.hash(sd, 82, 1503) * (h - 28);
        b.fillStyle = 'rgba(106,48,42,0.30)';
        b.fillRect(rx, ry, 22, 16);
        b.strokeStyle = 'rgba(220,190,150,0.12)';
        b.lineWidth = 1;
        b.strokeRect(rx + 1.5, ry + 1.5, 19, 13);
      }
    } else if (bd.kind === 'tower') {
      b.fillStyle = pal.floor2;
      for (var ty = y0; ty < y1; ty += 10) b.fillRect(x0, ty, w, 1);
      for (var tx = x0; tx < x1; tx += 10) b.fillRect(tx, y0, 1, h);
      b.fillStyle = 'rgba(58,70,84,0.28)';
      b.fillRect(x0 + 7, y0 + h * 0.3, w - 14, h * 0.4);
      b.strokeStyle = 'rgba(255,255,255,0.07)';
      b.strokeRect(x0 + 7.5, y0 + h * 0.3 + 0.5, w - 15, h * 0.4 - 1);
    } else {
      b.fillStyle = pal.floor2;
      for (var wy = y0; wy < y1; wy += 22) b.fillRect(x0, wy, w, 1);
      for (var wx = x0; wx < x1; wx += 22) b.fillRect(wx, y0, 1, h);
      b.fillStyle = 'rgba(170,150,60,0.12)';
      b.fillRect(x0 + 5, y1 - 8, w - 10, 2);
      b.fillRect(x0 + 5, y0 + 6, w - 10, 2);
    }

    /* 地面污渍 / 纸屑 / 裂缝 */
    for (i = 0; i < 7; i++) {
      var dx = x0 + 4 + U.hash(sd, i + 91, 1511) * (w - 8);
      var dy = y0 + 4 + U.hash(sd, i + 92, 1513) * (h - 8);
      b.fillStyle = i % 3 === 0 ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.09)';
      b.fillRect(dx | 0, dy | 0, 2 + ((U.hash(sd, i, 1515) * 6) | 0), 1 + ((U.hash(sd, i, 1517) * 3) | 0));
    }
    b.fillStyle = 'rgba(210,205,190,0.16)';
    for (i = 0; i < 4; i++) {
      b.fillRect((x0 + 3 + U.hash(sd, i + 101, 1521) * (w - 6)) | 0,
        (y0 + 3 + U.hash(sd, i + 102, 1523) * (h - 6)) | 0, 2, 1);
    }
    crack(b, x0 + w * 0.3, y0 + h * 0.6, 0.7, 20, sd, 1531, 'rgba(0,0,0,0.18)', 1);
    bloodStain(b, x0 + w * 0.62, y0 + h * 0.7, 6, sd, 1541);

    /* 灯光 */
    interiorLamp(b, bd, t);

    /* 门口透进来的暖光 */
    for (i = 0; i < bd.doors.length; i++) {
      var dd = bd.doors[i];
      ellipseFill(b, dd.ix, dd.iy, 15, 10, 'rgba(255,196,120,0.055)');
      ellipseFill(b, dd.ix, dd.iy, 8, 6, 'rgba(255,210,150,0.05)');
      var lx = dd.ix - dd.out.x * 5, ly = dd.iy - dd.out.y * 5;
      b.fillStyle = 'rgba(255,220,160,0.10)';
      b.fillRect((lx - dd.out.y * 2) | 0, (ly - dd.out.x * 2) | 0, 4, 4);
    }

    /* --- 家具 --- */
    for (i = 0; i < bd.furniture.length; i++) {
      var f = bd.furniture[i];
      R.drawFurniture(b, f, bd);
    }

    /* --- 楼梯 --- */
    drawStairs(b, bd, t);

    /* --- 墙 --- */
    var WALL_T = HS.Buildings.WALL_T;
    for (i = 0; i < bd.walls.length; i++) {
      var wl = bd.walls[i];
      if (wl.broken) {
        rubble(b, (wl.x0 + wl.x1) / 2, (wl.y0 + wl.y1) / 2, 7, sd + i, 1601);
        b.strokeStyle = 'rgba(110,80,58,0.55)';
        b.lineWidth = 1;
        b.beginPath();
        b.moveTo((wl.x0 + wl.x1) / 2 - 6, (wl.y0 + wl.y1) / 2 + 2);
        b.lineTo((wl.x0 + wl.x1) / 2 + 5, (wl.y0 + wl.y1) / 2 - 3);
        b.stroke();
        continue;
      }
      b.fillStyle = pal.trim;
      b.fillRect(wl.x0, wl.y0, wl.x1 - wl.x0, wl.y1 - wl.y0);

      /* 墙面受光 / 内侧阴影 */
      if (wl.side === 'N') {
        b.fillStyle = 'rgba(255,255,255,0.07)'; b.fillRect(wl.x0, wl.y0, wl.x1 - wl.x0, 1);
        b.fillStyle = 'rgba(0,0,0,0.24)'; b.fillRect(wl.x0, wl.y1, wl.x1 - wl.x0, 3);
      } else if (wl.side === 'S') {
        b.fillStyle = 'rgba(0,0,0,0.26)'; b.fillRect(wl.x0, wl.y0 - 3, wl.x1 - wl.x0, 3);
        b.fillStyle = 'rgba(255,255,255,0.04)'; b.fillRect(wl.x0, wl.y1 - 1, wl.x1 - wl.x0, 1);
      } else if (wl.side === 'W') {
        b.fillStyle = 'rgba(255,255,255,0.06)'; b.fillRect(wl.x0, wl.y0, 1, wl.y1 - wl.y0);
        b.fillStyle = 'rgba(0,0,0,0.22)'; b.fillRect(wl.x1, wl.y0, 3, wl.y1 - wl.y0);
      } else {
        b.fillStyle = 'rgba(0,0,0,0.24)'; b.fillRect(wl.x0 - 3, wl.y0, 3, wl.y1 - wl.y0);
        b.fillStyle = 'rgba(255,255,255,0.04)'; b.fillRect(wl.x1 - 1, wl.y0, 1, wl.y1 - wl.y0);
      }

      /* 墙面砖缝 */
      b.fillStyle = 'rgba(0,0,0,0.12)';
      if (wl.side === 'N' || wl.side === 'S') {
        for (var wx2 = wl.x0 + 6; wx2 < wl.x1 - 2; wx2 += 12) b.fillRect(wx2, wl.y0, 1, WALL_T);
      } else {
        for (var wy2 = wl.y0 + 6; wy2 < wl.y1 - 2; wy2 += 12) b.fillRect(wl.x0, wy2, WALL_T, 1);
      }

      /* 窗：嵌在墙里的冷光条 */
      var len = (wl.side === 'N' || wl.side === 'S') ? (wl.x1 - wl.x0) : (wl.y1 - wl.y0);
      if (len > 18) {
        var wn = 1 + ((U.hash(sd, i * 5 + 2, 1611) * 2) | 0);
        for (k = 0; k < wn; k++) {
          var fr = 0.26 + U.hash(sd, i * 11 + k + 3, 1613) * 0.48;
          var brokenWin = U.hash(sd, i * 13 + k + 5, 1615) < 0.30;
          if (wl.side === 'N' || wl.side === 'S') {
            var winx = wl.x0 + 3 + fr * Math.max(1, len - 13);
            b.fillStyle = brokenWin ? '#161d23' : 'rgba(132,180,198,0.55)';
            b.fillRect(winx | 0, wl.y0 + 2, 7, 1);
            b.fillStyle = 'rgba(0,0,0,0.45)';
            b.fillRect(winx | 0, wl.y0 + 2, 1, 1);
            b.fillRect((winx + 6) | 0, wl.y0 + 2, 1, 1);
            if (!brokenWin) {
              b.fillStyle = 'rgba(210,240,250,0.55)';
              b.fillRect((winx + 2) | 0, wl.y0 + 2, 3, 1);
            }
          } else {
            var winy = wl.y0 + 3 + fr * Math.max(1, len - 13);
            b.fillStyle = brokenWin ? '#161d23' : 'rgba(132,180,198,0.55)';
            b.fillRect(wl.x0 + 2, winy | 0, 1, 7);
            b.fillStyle = 'rgba(0,0,0,0.45)';
            b.fillRect(wl.x0 + 2, winy | 0, 1, 1);
            b.fillRect(wl.x0 + 2, (winy + 6) | 0, 1, 1);
            if (!brokenWin) {
              b.fillStyle = 'rgba(210,240,250,0.55)';
              b.fillRect(wl.x0 + 2, (winy + 2) | 0, 1, 3);
            }
          }
        }
      }
    }

    /* --- 门洞 / 半开的门 / 出口箭头 --- */
    for (i = 0; i < bd.doors.length; i++) {
      var d = bd.doors[i];
      var gx0, gy0, gx1, gy1;
      if (d.side === 'N' || d.side === 'S') {
        gx0 = d.cx - d.gap / 2; gx1 = d.cx + d.gap / 2;
        gy0 = d.side === 'N' ? bd.y0 : bd.y1 - WALL_T;
        gy1 = gy0 + WALL_T;
      } else {
        gy0 = d.cy - d.gap / 2; gy1 = d.cy + d.gap / 2;
        gx0 = d.side === 'W' ? bd.x0 : bd.x1 - WALL_T;
        gx1 = gx0 + WALL_T;
      }
      /* 门槛 */
      b.fillStyle = '#4a3c2c';
      b.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
      b.fillStyle = 'rgba(255,220,160,0.15)';
      if (d.side === 'N') b.fillRect(gx0, gy1 - 1, gx1 - gx0, 1);
      else if (d.side === 'S') b.fillRect(gx0, gy0, gx1 - gx0, 1);
      else if (d.side === 'W') b.fillRect(gx1 - 1, gy0, 1, gy1 - gy0);
      else b.fillRect(gx0, gy0, 1, gy1 - gy0);

      /* 半开的门板：贴着门框向室内掀开 */
      b.fillStyle = '#5a4430';
      b.fillStyle = '#4e3b28';
      if (d.side === 'N') {
        b.fillRect((gx0 + 1) | 0, gy1, 2, Math.max(2, d.gap - 3));
        b.fillStyle = '#c9b47a'; b.fillRect((gx0 + 2) | 0, gy1 + d.gap - 6, 1, 1);
      } else if (d.side === 'S') {
        b.fillRect((gx0 + 1) | 0, gy0 - Math.max(2, d.gap - 3), 2, Math.max(2, d.gap - 3));
        b.fillStyle = '#c9b47a'; b.fillRect((gx0 + 2) | 0, gy0 - 5, 1, 1);
      } else if (d.side === 'W') {
        b.fillRect(gx1, (gy0 + 1) | 0, Math.max(2, d.gap - 3), 2);
        b.fillStyle = '#c9b47a'; b.fillRect(gx1 + d.gap - 6, (gy0 + 2) | 0, 1, 1);
      } else {
        b.fillRect(gx0 - Math.max(2, d.gap - 3), (gy0 + 1) | 0, Math.max(2, d.gap - 3), 2);
        b.fillStyle = '#c9b47a'; b.fillRect(gx0 - 5, (gy0 + 2) | 0, 1, 1);
      }

      /* 出口方向：一个很小的青绿色箭头 */
      b.fillStyle = 'rgba(126,232,250,0.35)';
      var ox = d.out.x, oy = d.out.y;
      var cx = d.ix - ox * 7, cy = d.iy - oy * 7;
      if (ox !== 0) {
        b.beginPath();
        b.moveTo(cx + ox * 3, cy); b.lineTo(cx, cy - 2); b.lineTo(cx, cy + 2);
        b.closePath(); b.fill();
      } else {
        b.beginPath();
        b.moveTo(cx, cy + oy * 3); b.lineTo(cx - 2, cy); b.lineTo(cx + 2, cy);
        b.closePath(); b.fill();
      }
    }

    /* --- 可搜刮提示 --- */
    for (i = 0; i < bd.furniture.length; i++) {
      var lf = bd.furniture[i];
      if (!lf.lootable || lf.looted || lf.broken) continue;
      var near = U.dist(lf.x, lf.y, R._px || 0, R._py || 0) < 52;
      lootHint(b, lf.x, lf.y - lf.h / 2 - 7, t, near);
    }

    b.restore();
  };

  /* ---------------- 屋顶 ---------------- */

  function rectHit(x, y, w, h, arr) {
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (x < v.x1 + 2 && x + w > v.x0 - 2 && y < v.y1 + 2 && y + h > v.y0 - 2) return true;
    }
    return false;
  }

  R.drawBuildingRoof = function (b, bd, run) {
    var pal = bd.pal, sd = bd.seed;
    var vis = 1 - Math.min(1, bd.reveal);
    var p = run.p;
    var t = R._t || 0;
    var i;

    /* 只在建筑外侧投影，避免淡出时把室内压暗 */
    b.fillStyle = 'rgba(0,0,0,0.30)';
    b.fillRect(bd.x1, bd.y0 + 10, 9, bd.h);
    b.fillRect(bd.x0 + 10, bd.y1, bd.w, 9);

    if (vis <= 0.02) {
      /* 完全进入室内：只留一圈轮廓，提示这里仍是一栋楼 */
      b.strokeStyle = 'rgba(255,255,255,0.10)';
      b.lineWidth = 1;
      b.strokeRect(bd.x0 + 0.5, bd.y0 + 0.5, bd.w - 1, bd.h - 1);
      return;
    }

    b.save();
    b.globalAlpha = vis;

    /* 墙基 + 屋面 */
    b.fillStyle = pal.wall;
    b.fillRect(bd.x0, bd.y0, bd.w, bd.h);
    b.fillStyle = pal.roof;
    b.fillRect(bd.x0 + 4, bd.y0 + 4, bd.w - 8, bd.h - 8);

    /* 屋面材质 */
    if (bd.kind === 'house') {
      /* 错缝搭接的瓦片：没有贯通竖线，才不会被误读成地板 */
      var shRow = 0;
      for (var hy = bd.y0 + 8; hy < bd.y1 - 7; hy += 5) {
        b.fillStyle = 'rgba(0,0,0,0.20)';
        b.fillRect(bd.x0 + 6, hy, bd.w - 12, 1);
        b.fillStyle = 'rgba(255,235,210,0.06)';
        b.fillRect(bd.x0 + 6, hy + 1, bd.w - 12, 1);
        var off = shRow % 2 === 0 ? 0 : 3;
        for (var hx2 = bd.x0 + 8 + off; hx2 < bd.x1 - 7; hx2 += 7) {
          b.fillStyle = 'rgba(0,0,0,0.10)';
          b.fillRect(hx2, hy + 1, 1, 4);
          if (U.hash(sd, shRow * 13 + hx2, 1801) > 0.82) {
            b.fillStyle = 'rgba(30,24,20,0.22)';
            b.fillRect(hx2 + 1, hy + 2, 4, 2);
          }
        }
        shRow++;
      }
      /* 屋脊：一条更深的压顶 */
      if (bd.w > bd.h) {
        b.fillStyle = 'rgba(0,0,0,0.20)';
        b.fillRect(bd.x0 + 8, (bd.y0 + bd.h / 2) | 0, bd.w - 16, 2);
        b.fillStyle = 'rgba(255,240,220,0.08)';
        b.fillRect(bd.x0 + 8, ((bd.y0 + bd.h / 2) | 0) + 2, bd.w - 16, 1);
      } else {
        b.fillStyle = 'rgba(0,0,0,0.20)';
        b.fillRect((bd.x0 + bd.w / 2) | 0, bd.y0 + 8, 2, bd.h - 16);
        b.fillStyle = 'rgba(255,240,220,0.08)';
        b.fillRect(((bd.x0 + bd.w / 2) | 0) + 2, bd.y0 + 8, 1, bd.h - 16);
      }
    } else if (bd.kind === 'warehouse') {
      for (var vx = bd.x0 + 10; vx < bd.x1 - 10; vx += 8) {
        b.fillStyle = 'rgba(0,0,0,0.16)'; b.fillRect(vx, bd.y0 + 6, 2, bd.h - 12);
        b.fillStyle = 'rgba(255,255,255,0.045)'; b.fillRect(vx + 2, bd.y0 + 6, 1, bd.h - 12);
      }
    } else if (bd.kind === 'motel') {
      /* 平顶油毡：一道道卷材接缝，檐口堆着被风吹上来的沙 */
      for (var my2 = bd.y0 + 9; my2 < bd.y1 - 8; my2 += 10) {
        b.fillStyle = 'rgba(0,0,0,0.15)';
        b.fillRect(bd.x0 + 6, my2, bd.w - 12, 1);
        b.fillStyle = 'rgba(255,240,214,0.05)';
        b.fillRect(bd.x0 + 6, my2 + 1, bd.w - 12, 1);
      }
      for (var sd2 = 0; sd2 < 16; sd2++) {
        var sxx = bd.x0 + 6 + U.hash(sd, sd2 + 201, 1811) * (bd.w - 12);
        var syy = bd.y0 + 6 + U.hash(sd, sd2 + 202, 1813) * (bd.h - 12);
        b.fillStyle = 'rgba(120,102,66,0.20)';
        b.fillRect(sxx | 0, syy | 0, 2 + ((U.hash(sd, sd2, 1815) * 4) | 0), 1);
      }
      /* 屋顶上的大招牌：从路上老远就能看见这五个字 */
      var sgw = Math.min(bd.w - 24, 46), sgh = 12;
      var sgx = Math.round(bd.x0 + (bd.w - sgw) / 2);
      var sgy = Math.round(bd.y0 + 12);
      b.fillStyle = 'rgba(0,0,0,0.40)';
      b.fillRect(sgx + 2, sgy + 3, sgw, sgh);
      b.fillStyle = '#6b2a20';
      b.fillRect(sgx, sgy, sgw, sgh);
      b.fillStyle = '#8f3a2c';
      b.fillRect(sgx, sgy, sgw, 2);
      b.fillStyle = '#e8d8a8';
      b.fillRect(sgx + 2, sgy + sgh - 3, sgw - 4, 1);
      b.font = 'bold 8px "Courier New", monospace';
      b.textAlign = 'center';
      b.textBaseline = 'middle';
      b.fillStyle = '#f0e2b8';
      b.fillText('MOTEL', sgx + sgw / 2, sgy + sgh / 2);
      /* 招牌两边的小灯 */
      b.fillStyle = 'rgba(255,220,140,0.45)';
      b.fillRect(sgx - 2, sgy + 3, 1, 1);
      b.fillRect(sgx + sgw + 1, sgy + 3, 1, 1);
    } else {
      for (var gi = 0; gi < 46; gi++) {
        var gx = bd.x0 + 7 + U.hash(sd, gi, 1711) * (bd.w - 14);
        var gy = bd.y0 + 7 + U.hash(sd, gi, 1713) * (bd.h - 14);
        b.fillStyle = gi % 3 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.13)';
        b.fillRect(gx | 0, gy | 0, 1 + ((U.hash(sd, gi, 1715) * 2) | 0), 1);
      }
    }

    /* 修补过的屋面：几块颜色略不同的沥青 / 铁皮补丁 */
    for (i = 0; i < 4; i++) {
      var pw2 = 7 + ((U.hash(sd, i + 61, 1753) * 14) | 0);
      var ph2 = 5 + ((U.hash(sd, i + 62, 1755) * 10) | 0);
      var pxx = bd.x0 + 8 + U.hash(sd, i + 63, 1757) * Math.max(1, bd.w - 16 - pw2);
      var pyy = bd.y0 + 8 + U.hash(sd, i + 64, 1759) * Math.max(1, bd.h - 16 - ph2);
      b.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.045)';
      b.fillRect(pxx | 0, pyy | 0, pw2, ph2);
      b.strokeStyle = 'rgba(0,0,0,0.16)';
      b.lineWidth = 1;
      b.strokeRect((pxx | 0) + 0.5, (pyy | 0) + 0.5, pw2, ph2);
    }

    /* 水渍 / 苔藓 / 裂缝 */
    for (i = 0; i < 3; i++) {
      var sx2 = bd.x0 + 8 + U.hash(sd, i + 21, 1721) * (bd.w - 16);
      var sy2 = bd.y0 + 8 + U.hash(sd, i + 22, 1723) * (bd.h - 16);
      ellipseFill(b, sx2, sy2, 5 + U.hash(sd, i, 1725) * 9, 3 + U.hash(sd, i, 1727) * 5,
        i === 0 ? 'rgba(74,98,66,0.16)' : 'rgba(0,0,0,0.13)');
    }
    for (i = 0; i < 2; i++) {
      var px2 = bd.x0 + 10 + U.hash(sd, i + 31, 1731) * (bd.w - 20);
      var py2 = bd.y0 + 10 + U.hash(sd, i + 32, 1733) * (bd.h - 20);
      ellipseFill(b, px2, py2, 4 + U.hash(sd, i, 1735) * 6, 2.5 + U.hash(sd, i, 1737) * 4, 'rgba(28,38,46,0.32)');
      b.fillStyle = 'rgba(150,190,200,0.14)';
      b.fillRect((px2 - 2) | 0, (py2 - 1) | 0, 4, 1);
    }
    for (i = 0; i < 3; i++) {
      crack(b, bd.x0 + 10 + U.hash(sd, i + 41, 1741) * (bd.w - 20),
        bd.y0 + 10 + U.hash(sd, i + 42, 1743) * (bd.h - 20),
        U.hash(sd, i, 1745) * U.TAU, 10 + U.hash(sd, i, 1747) * 16,
        sd + i, 1751, 'rgba(0,0,0,0.24)', 1);
    }

    /* 天窗 */
    var sk = bd.kind === 'tower' ? 2 : 1;
    for (i = 0; i < sk; i++) {
      var skw = 10 + ((U.hash(sd, i + 51, 1761) * 7) | 0);
      var skh = 6 + ((U.hash(sd, i + 52, 1763) * 4) | 0);
      var skx = bd.x0 + 10 + U.hash(sd, i + 53, 1765) * Math.max(1, bd.w - 22 - skw);
      var sky = bd.y0 + 10 + U.hash(sd, i + 54, 1767) * Math.max(1, bd.h - 22 - skh);
      if (rectHit(skx, sky, skw, skh, bd.roofVents)) continue;
      b.fillStyle = 'rgba(0,0,0,0.32)';
      b.fillRect((skx + 2) | 0, (sky + 2) | 0, skw, skh);
      b.fillStyle = '#2d3b44';
      b.fillRect(skx | 0, sky | 0, skw, skh);
      b.fillStyle = U.hash(sd, i + 55, 1769) < 0.3 ? '#162028' : 'rgba(126,178,196,0.42)';
      b.fillRect((skx + 1) | 0, (sky + 1) | 0, skw - 2, skh - 2);
      b.strokeStyle = 'rgba(210,235,245,0.16)';
      b.lineWidth = 1;
      b.beginPath();
      b.moveTo(skx + 2, sky + 1); b.lineTo(skx + 1, sky + skh - 2);
      b.stroke();
    }

    /* 通风口 / 烟囱 / 水塔 */
    for (i = 0; i < bd.roofVents.length; i++) {
      var v = bd.roofVents[i];

      if (v.isChimney) {
        /* 砖砌烟囱：顶视只看到方形烟道与一圈砖 */
        b.fillStyle = 'rgba(0,0,0,0.34)';
        b.fillRect(v.x0 + 3, v.y0 + 3, v.w, v.h);
        b.fillStyle = '#4a3028';
        b.fillRect(v.x0, v.y0, v.w, v.h);
        b.fillStyle = '#7a4a3a';
        b.fillRect(v.x0 + 1, v.y0 + 1, v.w - 2, v.h - 2);
        b.fillStyle = '#5c352b';
        b.fillRect(v.x0 + 2, v.y0 + 2, v.w - 4, 1);
        b.fillRect(v.x0 + 2, v.y0 + v.h - 3, v.w - 4, 1);
        b.fillStyle = '#201814';
        b.fillRect(v.x0 + 3, v.y0 + 3, v.w - 6, v.h - 6);
        b.fillStyle = 'rgba(30,26,24,0.35)';
        b.fillRect(v.x0 + 3, v.y0 + 3, v.w - 6, 2);
        b.fillStyle = 'rgba(255,220,180,0.10)';
        b.fillRect(v.x0 + 1, v.y0 + 1, v.w - 2, 1);
        b.fillStyle = 'rgba(0,0,0,0.20)';
        for (var cb = 1; cb < 3; cb++) b.fillRect(v.x0 + 1, v.y0 + cb * 3, v.w - 2, 1);
        continue;
      }

      if (v.isTank) {
        /* 屋顶水塔：圆柱 + 支腿 + 梯子 */
        var cx3 = (v.x0 + v.x1) / 2;
        var cy3 = (v.y0 + v.y1) / 2;
        b.fillStyle = 'rgba(0,0,0,0.32)';
        b.fillRect(v.x0 + 4, v.y0 + 5, v.w, v.h);
        b.fillStyle = '#3a3f45';
        b.fillRect(v.x0 + 2, v.y0 + 3, 2, v.h - 3);
        b.fillRect(v.x1 - 4, v.y0 + 3, 2, v.h - 3);
        ellipseFill(b, cx3, cy3 - 1, v.w / 2 - 1, v.h / 2 - 2, '#59616a');
        ellipseFill(b, cx3, cy3 - 2, v.w / 2 - 3, v.h / 2 - 4, '#8b959f');
        ellipseFill(b, cx3, cy3 - 3, v.w / 2 - 5, v.h / 2 - 6, '#a4aeb8');
        b.fillStyle = 'rgba(0,0,0,0.26)';
        b.fillRect((cx3 - v.w / 2 + 2) | 0, cy3 | 0, v.w - 4, 1);
        b.fillRect((cx3 - v.w / 2 + 2) | 0, (cy3 + 4) | 0, v.w - 4, 1);
        b.fillStyle = '#c0c9d1';
        b.fillRect((cx3 - v.w / 2 + 4) | 0, (cy3 - 4) | 0, v.w - 8, 1);
        b.fillStyle = '#2a2f35';
        b.beginPath(); b.arc(cx3, cy3 - 1, 3.5, 0, U.TAU); b.fill();
        b.fillStyle = '#8f9aa5';
        b.beginPath(); b.arc(cx3, cy3 - 2, 2.5, 0, U.TAU); b.fill();
        b.fillStyle = 'rgba(170,80,40,0.28)';
        b.fillRect((cx3 + v.w / 2 - 7) | 0, (cy3 + 1) | 0, 3, 2);
        b.strokeStyle = 'rgba(160,170,180,0.45)';
        b.lineWidth = 1;
        b.beginPath();
        b.moveTo(cx3 + v.w / 2 - 4, v.y0 + 5); b.lineTo(cx3 + v.w / 2 - 4, v.y1 - 3);
        for (var lr = 0; lr < 3; lr++) {
          b.moveTo(cx3 + v.w / 2 - 5, v.y0 + 7 + lr * 3);
          b.lineTo(cx3 + v.w / 2 - 3, v.y0 + 7 + lr * 3);
        }
        b.stroke();
        b.fillStyle = 'rgba(170,80,40,0.18)';
        b.fillRect((cx3 - 2) | 0, (cy3 + 1) | 0, 3, 2);
        continue;
      }

      b.fillStyle = 'rgba(0,0,0,0.32)';
      b.fillRect(v.x0 + 3, v.y0 + 3, v.w, v.h);
      b.fillStyle = '#4a535d';
      b.fillRect(v.x0, v.y0, v.w, v.h);
      b.fillStyle = '#68737f';
      b.fillRect(v.x0 + 1, v.y0 + 1, v.w - 2, v.h - 2);
      b.fillStyle = '#39414a';
      b.fillRect(v.x0 + 2, v.y0 + 2, v.w - 4, 2);
      b.fillStyle = 'rgba(0,0,0,0.32)';
      for (var vb = 0; vb < 3; vb++) b.fillRect(v.x0 + 2, v.y0 + 4 + vb * 3, v.w - 4, 1);
      b.fillStyle = 'rgba(255,255,255,0.10)';
      b.fillRect(v.x0 + 2, v.y0 + 2, v.w - 4, 1);
      b.fillStyle = '#8f9aa5';
      b.fillRect(v.x1 - 4, v.y0 + 2, 2, 2);
    }

    /* 楼梯口 / 检修口 */
    if (bd.stairs) {
      var st = bd.stairs;
      b.fillStyle = 'rgba(0,0,0,0.35)';
      b.fillRect(st.x0 + 2, st.y0 + 2, st.w, st.h);
      b.fillStyle = '#20262e';
      b.fillRect(st.x0, st.y0, st.w, st.h);
      b.fillStyle = '#0a0d11';
      b.fillRect(st.x0 + 2, st.y0 + 2, st.w - 4, st.h - 4);
      for (var sb = 0; sb < 4; sb++) {
        b.fillStyle = sb % 2 === 0 ? '#333b45' : '#242b33';
        b.fillRect(st.x0 + 3, st.y0 + 3 + sb * 3, st.w - 6, 2);
      }
      b.fillStyle = pal.trim;
      b.fillRect(st.x0, st.y0, st.w, 1);
      b.fillRect(st.x0, st.y0, 1, st.h);
      b.fillStyle = '#c9b47a';
      b.fillRect(st.x1 - 4, st.y0 + 3, 2, 2);
      /* 站在楼顶时，楼梯口下方箭头表示可下楼 */
      if (p.roof === bd) {
        var dp = 0.45 + 0.35 * Math.sin(t * 5);
        b.fillStyle = 'rgba(126,232,250,' + dp.toFixed(2) + ')';
        b.beginPath();
        b.moveTo(st.x, st.y - 1); b.lineTo(st.x + 4, st.y + 3); b.lineTo(st.x - 4, st.y + 3);
        b.closePath(); b.fill();
      }
    }

    /* 屋顶物资箱 */
    if (bd.roofCrate && !bd.roofCrate.broken) {
      var rc = bd.roofCrate;
      R.drawFurniture(b, {
        kindId: 'crate', x0: rc.x0, y0: rc.y0, x1: rc.x1, y1: rc.y1,
        x: rc.x, y: rc.y, w: rc.w, h: rc.h, seed: rc.seed,
        lootable: rc.lootable, looted: rc.looted, broken: rc.broken
      }, bd);
      if (rc.lootable && !rc.looted && vis > 0.5) {
        lootHint(b, rc.x, rc.y - rc.h / 2 - 7, t, p.roof === bd);
      }
    }

    /* 塌角：露出内部结构 */
    var corner = (sd >>> 3) % 4;
    var rx = corner % 2 === 0 ? bd.x0 : bd.x1 - 18;
    var ry = corner < 2 ? bd.y0 : bd.y1 - 16;
    b.fillStyle = pal.wall;
    b.fillRect(rx, ry, 18, 16);
    b.fillStyle = '#2c2f34';
    b.fillRect(rx + 1, ry + 1, 16, 14);
    b.strokeStyle = '#4a3324';
    b.lineWidth = 2;
    b.beginPath();
    b.moveTo(rx + 2, ry + 3); b.lineTo(rx + 15, ry + 12);
    b.moveTo(rx + 3, ry + 12); b.lineTo(rx + 13, ry + 3);
    b.stroke();
    for (var r2 = 0; r2 < 6; r2++) {
      b.fillStyle = r2 % 2 === 0 ? '#4a5057' : '#343940';
      b.fillRect((rx + 2 + U.hash(sd, r2, 1781) * 13) | 0,
        (ry + 2 + U.hash(sd, r2, 1783) * 11) | 0, 3, 2);
    }

    /* 女儿墙 + 边缘 */
    b.fillStyle = pal.edge;
    b.fillRect(bd.x0, bd.y0, bd.w, 2);
    b.fillRect(bd.x0, bd.y1 - 2, bd.w, 2);
    b.fillRect(bd.x0, bd.y0, 2, bd.h);
    b.fillRect(bd.x1 - 2, bd.y0, 2, bd.h);
    b.fillStyle = 'rgba(255,255,255,0.10)';
    b.fillRect(bd.x0 + 2, bd.y0 + 2, bd.w - 4, 1);
    b.fillRect(bd.x0 + 2, bd.y0 + 2, 1, bd.h - 4);
    /* 女儿墙投在屋面上的内阴影：给屋顶一点「高差」而不是一张贴纸 */
    b.fillStyle = 'rgba(0,0,0,0.20)';
    b.fillRect(bd.x0 + 2, bd.y0 + 2, bd.w - 4, 3);
    b.fillRect(bd.x0 + 2, bd.y0 + 2, 3, bd.h - 4);
    b.fillRect(bd.x1 - 5, bd.y0 + 2, 3, bd.h - 4);
    b.fillStyle = 'rgba(0,0,0,0.26)';
    b.fillRect(bd.x0 + 2, bd.y1 - 6, bd.w - 4, 4);

    /* 女儿墙四角加厚，屋顶轮廓更明确 */
    b.fillStyle = pal.edge;
    b.fillRect(bd.x0, bd.y0, 4, 4);
    b.fillRect(bd.x1 - 4, bd.y0, 4, 4);
    b.fillRect(bd.x0, bd.y1 - 4, 4, 4);
    b.fillRect(bd.x1 - 4, bd.y1 - 4, 4, 4);
    b.fillStyle = 'rgba(255,255,255,0.12)';
    b.fillRect(bd.x0 + 1, bd.y0 + 1, 2, 1);
    b.fillRect(bd.x1 - 3, bd.y0 + 1, 2, 1);

    /* 工业风的黄黑警示条（大楼 / 仓库，随机贴在一边） */
    if (bd.kind !== 'house' && U.hash(sd, 91, 1791) > 0.35) {
      var hzSide = (sd >>> 5) % 4;
      var hzLen = Math.min(28, (hzSide < 2 ? bd.w : bd.h) - 16);
      for (var hz = 0; hz < hzLen; hz += 4) {
        b.fillStyle = hz % 8 === 0 ? 'rgba(206,176,84,0.55)' : 'rgba(24,26,30,0.55)';
        if (hzSide === 0) b.fillRect(bd.x0 + 8 + hz, bd.y0 + 4, 3, 2);
        else if (hzSide === 1) b.fillRect(bd.x0 + 8 + hz, bd.y1 - 6, 3, 2);
        else if (hzSide === 2) b.fillRect(bd.x0 + 4, bd.y0 + 8 + hz, 2, 3);
        else b.fillRect(bd.x1 - 6, bd.y0 + 8 + hz, 2, 3);
      }
    }

    /* 屋面入口：门洞缺口 + 外面一圈暖光 */
    var WALL_T = HS.Buildings.WALL_T;
    for (i = 0; i < bd.doors.length; i++) {
      var d = bd.doors[i];
      var gx0, gy0, gx1, gy1;
      if (d.side === 'N' || d.side === 'S') {
        gx0 = d.cx - d.gap / 2; gx1 = d.cx + d.gap / 2;
        gy0 = d.side === 'N' ? bd.y0 : bd.y1 - WALL_T;
        gy1 = gy0 + WALL_T;
      } else {
        gy0 = d.cy - d.gap / 2; gy1 = d.cy + d.gap / 2;
        gx0 = d.side === 'W' ? bd.x0 : bd.x1 - WALL_T;
        gx1 = gx0 + WALL_T;
      }
      b.fillStyle = '#090c10';
      b.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
      b.fillStyle = 'rgba(255,200,130,0.22)';
      if (d.side === 'N') b.fillRect(gx0, gy1 - 1, gx1 - gx0, 1);
      else if (d.side === 'S') b.fillRect(gx0, gy0, gx1 - gx0, 1);
      else if (d.side === 'W') b.fillRect(gx1 - 1, gy0, 1, gy1 - gy0);
      else b.fillRect(gx0, gy0, 1, gy1 - gy0);
      ellipseFill(b, d.ox, d.oy, 10, 7, 'rgba(255,190,110,0.08)');
    }

    b.restore();

    /* 入口提示：玩家在附近、还没进楼时，门口浮一个青色箭头（和金色搜刮区别开） */
    if (!p.roof && bd.reveal < 0.2) {
      for (i = 0; i < bd.doors.length; i++) {
        var de = bd.doors[i];
        var dist2 = U.dist(de.ox, de.oy, p.x, p.y);
        if (dist2 > 96) continue;
        var dp2 = 0.45 + 0.35 * Math.sin(t * 5 + i);
        var ax = de.ox, ay = de.oy - de.out.y * 6 - 6;
        b.fillStyle = 'rgba(126,232,250,' + dp2.toFixed(2) + ')';
        b.beginPath();
        b.moveTo(ax, ay + 4); b.lineTo(ax - 4, ay - 1); b.lineTo(ax + 4, ay - 1);
        b.closePath(); b.fill();
        b.fillStyle = 'rgba(126,232,250,' + (dp2 * 0.45).toFixed(2) + ')';
        b.fillRect(ax - 6, ay + 7, 12, 1);
      }
    }

    /* 玩家站在这个屋顶：标出最近的边缘，提示可以跳下 */
    if (p.roof === bd) {
      var INSET = HS.Buildings.INSET;
      var dir = HS.Buildings.edgeDir(p.x, p.y, bd, 24);
      if (dir) {
        var pulse2 = 0.45 + 0.35 * Math.sin(t * 6);
        var col2 = 'rgba(255,209,102,' + pulse2.toFixed(2) + ')';
        var ex, ey;
        b.strokeStyle = col2;
        b.lineWidth = 2;
        b.beginPath();
        if (dir.x !== 0) {
          ex = dir.x < 0 ? bd.x0 + INSET : bd.x1 - INSET;
          b.moveTo(ex, p.y - 10); b.lineTo(ex, p.y + 10);
        } else {
          ey = dir.y < 0 ? bd.y0 + INSET : bd.y1 - INSET;
          b.moveTo(p.x - 10, ey); b.lineTo(p.x + 10, ey);
        }
        b.stroke();
        var cx2 = dir.x !== 0 ? ex + dir.x * 7 : p.x;
        var cy2 = dir.y !== 0 ? ey + dir.y * 7 : p.y;
        chevron(b, cx2, cy2, dir.x, dir.y, 4, col2);
        chevron(b, cx2 + dir.x * 7, cy2 + dir.y * 7, dir.x, dir.y, 4, 'rgba(255,209,102,0.35)');
      }
      /* 楼顶边缘一圈微光 */
      b.strokeStyle = 'rgba(255,235,200,0.10)';
      b.lineWidth = 1;
      b.strokeRect(bd.x0 + INSET + 0.5, bd.y0 + INSET + 0.5,
        bd.w - INSET * 2 - 1, bd.h - INSET * 2 - 1);
    }
  };

  R.drawProp = function (b, o, run) {
    if (o.broken) return;
    S.draw(b, o.frame, o.x, o.y, 1, undefined, o.flip);

    /* 可搜刮提示：靠近才显示，避免满屏都是图标 */
    if (o.lootable && !o.looted) {
      var p = run.p;
      var d = U.dist(o.x, o.y, p.x, p.y);
      if (d < 76) {
        lootHint(b, o.x, o.y - o.h / 2 - 8, run.t, d < 40);
      }
    }
  };

  HS.Render = R;
})();
