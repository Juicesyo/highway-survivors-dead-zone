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

  /* 主角贴图是 24x28 世界像素（原图 48x56，px:2），比丧尸高一倍。
     drawActor 以帧中心为锚点，直接按 p.y 画的话脚底会落到 p.y+14，
     而场景里其它角色的站立线在 p.y+6 左右（深度排序也用 p.y）。
     所以整体上抬 7px：脚底落在 p.y+7，和原来 12x14 的小人一致。 */
  var PSPRITE_LIFT = -7;

  /* 鲸鱼娘四向 x 6 帧（0/1 站立、2~5 行走），自己按步频挑帧，
     不走 drawActor 的切腿补间。 */
  function whaleFrame(dir, i) {
    return 'player_whale_' + dir + '_' + i;
  }

  /* 当前该用哪个朝向的贴图：设置里关掉"跟随朝向"就恒为正面 */
  function faceOf(p) {
    if (HS.Game && HS.Game.turnView === false) return 'dn';
    return p.faceDir || 'dn';
  }

  /* 持枪锚点：不同朝向手的位置不一样，正面在腰侧、背面在肩后。
     side 是枪相对身体的横向偏移（世界像素）。 */
  var GUN_ANCHOR = {
    dn: { y: -2.0, side: 1.9 },
    up: { y: -3.2, side: 1.4 },
    lf: { y: -2.0, side: -2.2 },
    rt: { y: -2.0, side: 2.2 }
  };

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

  /* ---------------- 公路隧道地面 ---------------- */

  /**
   * 事故现场的地面痕迹 —— 全部烘焙进区块缓存，所以可以放心画细节：
   *   上游拖过来的刹车痕 → 烟熏焦黑 → 碎玻璃 → 干涸的血 → 散落的零件与油渍。
   * 车本身是 obstacles.js 生成的道具（有碰撞、能搜刮），这里只负责"那摊痕迹"。
   */
  function accidentGround(b, site) {
    var k = site.k, ay = site.y, side = site.side;
    var ROADH = HS.World.TUN_ROAD || 56;
    var hh = function (f) { return U.hash(k, f, 6121); };
    var px = side * (26 + hh(1) * 18);      // 车堆大致中心
    var i, yy;

    /* 1. 刹车痕：从上游 200px 一路擦到车尾，两对轮子、带一点偏摆 ——
       这是"事故现场"最直观的引导线，画淡了就白画（第一版就是看不见） */
    for (var t = 0; t < 2; t++) {
      var sx = px + (t === 0 ? -11 : 11) + (hh(2 + t) - 0.5) * 5;
      var y0 = ay - 200 - hh(4 + t) * 46;
      for (var seg = 0; seg < 20; seg++) {
        yy = y0 + seg * 11;
        if (yy > ay + 10) break;
        var drift = (yy - y0) / 230 * (hh(6 + t) - 0.5) * 34;
        /* 先擦亮一层（胎面把沥青磨白），再在中间压一道胎印 ——
           只画纯黑的话，在深色沥青上等于没画 */
        b.fillStyle = 'rgba(158,168,180,0.14)';
        b.fillRect(Math.round(sx + drift) - 1, Math.round(yy), 5, 12);
        b.fillStyle = t === 0 ? 'rgba(4,5,7,0.46)' : 'rgba(4,5,7,0.38)';
        b.fillRect(Math.round(sx + drift), Math.round(yy), 3, 12);
        if (seg % 3 === 0) b.fillRect(Math.round(sx + drift) + 3, Math.round(yy) + 2, 1, 8);
      }
    }

    /* 2. 烟熏：烧过的地方压一层灰黑，但**不能是一块实心黑斑** ——
       分三块错位叠，边缘才对得上沥青的颗粒（一开始画成一块，远看像个洞） */
    b.fillStyle = 'rgba(12,13,16,0.28)';
    ellipseFill(b, px, ay, 62 + hh(10) * 18, 46 + hh(11) * 14);
    b.fillStyle = 'rgba(6,7,9,0.34)';
    ellipseFill(b, px + side * 8, ay - 10, 40, 28);
    b.fillStyle = 'rgba(6,7,9,0.30)';
    ellipseFill(b, px - side * 20, ay + 18, 30, 20);
    /* 漏出来的燃油：一小片湿黑，反着顶灯的光 */
    b.fillStyle = 'rgba(28,24,34,0.30)';
    ellipseFill(b, px - side * 12, ay + 6, 16, 10);

    /* 2b. 浮灰：撞完扬起来、十几年也没散的那层灰。
       它让这一片比周围亮一点点 —— 远看就知道"这里出过事" */
    b.fillStyle = 'rgba(164,164,156,0.07)';
    ellipseFill(b, px, ay + 4, 74 + hh(12) * 20, 56 + hh(13) * 16);
    b.fillStyle = 'rgba(150,150,142,0.06)';
    ellipseFill(b, px + side * 18, ay - 22, 52, 40);

    /* 3. 碎玻璃：暗处唯一的亮点，也是"这里撞过"最快的读法 */
    for (i = 0; i < 52; i++) {
      var gx = px + (hh(20 + i) - 0.5) * 150;
      var gy = ay + (hh(60 + i) - 0.5) * 160;
      if (Math.abs(gx) > 84) continue;
      b.fillStyle = i % 3 === 0 ? 'rgba(228,242,254,0.55)' : 'rgba(150,168,186,0.26)';
      var gsz = i % 5 === 0 ? 2 : 1;
      b.fillRect(Math.round(gx), Math.round(gy), gsz, gsz);
    }

    /* 4. 干涸的血：从车堆里往外拖出的一道，末端越拖越淡 */
    var bx = px - side * (16 + hh(80) * 16);
    var byy = ay + (hh(81) - 0.5) * 44;
    for (i = 0; i < 9; i++) {
      b.fillStyle = 'rgba(72,14,12,' + (0.42 - i * 0.035).toFixed(3) + ')';
      b.fillRect(Math.round(bx - i * side * 5), Math.round(byy + Math.sin(i * 0.9) * 3),
        Math.max(1, 3 - (i >> 2)), Math.max(1, 2 - (i >> 3)));
    }

    /* 4a. 没跑出来的人：一具横在车头前，另一具有机会被拖到步道上。
       这一笔比任何花纹都管用 —— 有尸体的车堆才是"事故"，没有的只是"乱停车" */
    corpse(b, px - side * (28 + hh(110) * 14), ay + 26 + hh(111) * 22,
      hh(112) * U.TAU, k * 7 + 3);
    if (hh(113) < 0.62) {
      corpse(b, px + side * (30 + hh(114) * 16), ay - 44 - hh(115) * 22,
        hh(116) * U.TAU, k * 7 + 5);
    }
    /* 掉出来的行李箱：深色箱子 + 一道浅色拉杆 */
    for (i = 0; i < 2; i++) {
      var lx = px + (hh(120 + i) - 0.5) * 90;
      var ly = ay + (hh(124 + i) - 0.5) * 96;
      if (Math.abs(lx) > 78) continue;
      b.fillStyle = 'rgba(38,32,30,0.75)';
      b.fillRect(Math.round(lx), Math.round(ly), 5, 4);
      b.fillStyle = 'rgba(150,140,120,0.35)';
      b.fillRect(Math.round(lx) + 1, Math.round(ly) + 1, 3, 1);
    }

    /* 4b. 撞击点：两车咬在一起的地方，卷起来的铁皮上炸开一撮白色玻璃屑 */
    var ix0 = px + side * 6, iy0 = ay + (hh(90) - 0.5) * 18;
    b.fillStyle = 'rgba(16,16,19,0.55)';
    ellipseFill(b, ix0, iy0, 10, 6);
    for (i = 0; i < 12; i++) {
      var ia = hh(300 + i) * U.TAU;
      var il = 3 + hh(320 + i) * 14;
      b.fillStyle = i % 2 ? 'rgba(228,242,254,0.44)' : 'rgba(160,176,192,0.24)';
      b.fillRect(Math.round(ix0 + Math.cos(ia) * il), Math.round(iy0 + Math.sin(ia) * il * 0.8), 1, 1);
    }

    /* 5. 散落的零件：橡胶块、断裂的保险杠、掉出来的行李箱 */
    for (i = 0; i < 9; i++) {
      var dx = px + (hh(100 + i) - 0.5) * 116;
      var dy = ay + (hh(130 + i) - 0.5) * 124;
      if (Math.abs(dx) > 82) continue;
      var kind = hh(160 + i);
      b.fillStyle = kind < 0.45 ? 'rgba(22,22,25,0.62)'
        : (kind < 0.8 ? 'rgba(58,52,46,0.55)' : 'rgba(104,44,32,0.45)');
      b.fillRect(Math.round(dx), Math.round(dy), 1 + Math.round(hh(190 + i) * 3), 1 + Math.round(hh(200 + i) * 2));
    }

    /* 5b. 顶上震下来的混凝土块：比零件大、比车矮，一眼知道这里塌过 */
    for (i = 0; i < 6; i++) {
      var kx = px + (hh(210 + i) - 0.5) * 150;
      var ky = ay + (hh(230 + i) - 0.5) * 150;
      if (Math.abs(kx) > 82) continue;
      b.fillStyle = 'rgba(72,76,84,0.78)';
      b.fillRect(Math.round(kx), Math.round(ky),
        2 + Math.round(hh(250 + i) * 3), 2 + Math.round(hh(252 + i) * 2));
      b.fillStyle = 'rgba(126,132,142,0.42)';
      b.fillRect(Math.round(kx), Math.round(ky), 1, 1);
    }

    /* 6. 被撞歪的检修步道边线：事故点旁边那一小段路缘被蹭掉了 */
    b.fillStyle = 'rgba(0,0,0,0.35)';
    b.fillRect(Math.round(side * (ROADH - 1)), Math.round(ay - 26), 2, 44);
  }

  /**
   * 一条钻进山体的走廊。
   *
   * 几何完全由 x 决定（和前几张直路图一样，沿 y 无限延伸）：
   *   |x| < 56          沥青路面（双车道）
   *   56 ~ 88           检修步道（水泥，比路面亮一档）
   *   88 ~ 132          混凝土衬砌 —— 这一段是实心墙，碰撞在 obstacles.js
   *   |x| > 132         山体（几乎是黑的）
   *
   * 隧道感靠三样东西堆出来：顶部横梁投下的黑带、每 128px 一盏顶灯的光池、
   * 以及墙面那圈被灯照亮的腰线。没有一样是"墙"，但玩家一眼就知道自己在洞里。
   *
   * 破败感同理：墙皮剥落露钢筋、墙根堆碎石、血手印、坏掉的顶灯，
   * 再加上每 1152px 一处的连环追尾（痕迹在 accidentGround，车在 obstacles.js）。
   */
  R.tunnelBlock = function (b, bx, by) {
    var W = HS.World;
    var BL = W.BLOCK;
    var HALF = W.TUN_HALF || 88;
    var WALL = W.TUN_WALL || 44;
    var ROADH = W.TUN_ROAD || 56;
    var sx = Math.round(bx / BL), sy = Math.round(by / BL);
    var h0 = function (i, s) { return U.hash(sx, sy, i * 151 + s); };
    var i, x, y;

    /* ---------- 0. 山体 ---------- */
    b.fillStyle = '#0b0c0e';
    b.fillRect(bx, by, BL, BL);
    /* 岩石纹理：只在墙外侧画，走廊里看不到 */
    for (i = 0; i < 26; i++) {
      var rx = bx + h0(i, 1) * BL;
      if (Math.abs(rx) < HALF + WALL) continue;
      var ry = by + h0(i, 2) * BL;
      var rl = 6 + h0(i, 3) * 22;
      b.strokeStyle = h0(i, 4) < 0.5 ? 'rgba(58,60,66,0.35)' : 'rgba(24,25,28,0.7)';
      b.lineWidth = 1;
      b.beginPath();
      b.moveTo(rx, ry);
      b.lineTo(rx + (h0(i, 5) - 0.5) * rl, ry + rl * 0.7);
      b.stroke();
    }

    /* ---------- 1. 路面 ---------- */
    b.fillStyle = '#1b1d21';
    b.fillRect(-ROADH, by, ROADH * 2, BL);
    /* 沥青颗粒 */
    for (i = 0; i < 60; i++) {
      var ax = (h0(i, 11) - 0.5) * 2 * ROADH;
      var ay = by + h0(i, 12) * BL;
      b.fillStyle = h0(i, 13) < 0.5 ? 'rgba(120,126,136,0.05)' : 'rgba(0,0,0,0.22)';
      b.fillRect(Math.round(ax), Math.round(ay), 1, 1 + (h0(i, 14) > 0.8 ? 1 : 0));
    }
    /* 车辙：两条被压亮的轮迹 */
    for (i = 0; i < 2; i++) {
      var lx = i === 0 ? -20 : 20;
      b.fillStyle = 'rgba(150,158,168,0.035)';
      b.fillRect(lx - 5, by, 10, BL);
      b.fillStyle = 'rgba(0,0,0,0.10)';
      b.fillRect(lx - 9, by, 3, BL);
      b.fillRect(lx + 6, by, 3, BL);
    }

    /* ---------- 2. 检修步道 ---------- */
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      var wx0 = s2 > 0 ? ROADH : -HALF;
      b.fillStyle = '#2b2d31';
      b.fillRect(wx0, by, HALF - ROADH, BL);
      /* 路缘石：靠车道那一侧亮一条 */
      b.fillStyle = 'rgba(196,204,214,0.20)';
      b.fillRect(s2 > 0 ? ROADH : -ROADH - 1, by, 1, BL);
      /* 步道伸缩缝：每 48px 一道横缝 */
      for (y = Math.floor(by / 48) * 48; y < by + BL; y += 48) {
        b.fillStyle = 'rgba(0,0,0,0.35)';
        b.fillRect(wx0, y, HALF - ROADH, 1);
      }
    }

    /* ---------- 3. 混凝土衬砌 ---------- */
    for (var s3 = -1; s3 <= 1; s3 += 2) {
      var ix = s3 > 0 ? HALF : -HALF - WALL;   // 墙矩形左边
      b.fillStyle = '#33363b';
      b.fillRect(ix, by, WALL, BL);
      /* 内壁受光：靠走廊这一侧 5px 亮带，是最重要的一条"立体感" */
      b.fillStyle = 'rgba(198,208,220,0.16)';
      b.fillRect(s3 > 0 ? ix : ix + WALL - 5, by, 5, BL);
      b.fillStyle = 'rgba(120,130,144,0.10)';
      b.fillRect(s3 > 0 ? ix + 5 : ix + WALL - 10, by, 5, BL);
      /* 大面积污浊：一层层低透明度斑块，把"新水泥"泡成"泡了十几年的水泥" */
      for (i = 0; i < 6; i++) {
        var gyy = by + h0(i, 91 + s3 * 10) * BL;
        var gxx = ix + 2 + h0(i, 92 + s3 * 10) * (WALL - 14);
        b.fillStyle = 'rgba(12,13,16,' + (0.06 + h0(i, 93 + s3 * 10) * 0.09).toFixed(3) + ')';
        b.fillRect(Math.round(gxx), Math.round(gyy),
          8 + Math.round(h0(i, 94 + s3 * 10) * 18), 4 + Math.round(h0(i, 95 + s3 * 10) * 13));
      }
      /* 墙板缝：每 64px 一道，缝里塞着黑 */
      for (y = Math.floor(by / 64) * 64; y < by + BL; y += 64) {
        b.fillStyle = 'rgba(0,0,0,0.42)';
        b.fillRect(ix, y, WALL, 2);
        b.fillStyle = 'rgba(198,208,220,0.07)';
        b.fillRect(ix, y + 2, WALL, 1);
      }
      /* 水渍 / 煤烟：从板缝往下淌的一段 */
      for (i = 0; i < 3; i++) {
        var dy0 = by + h0(i, 21 + s3 * 10) * BL;
        var dh = 10 + h0(i, 22 + s3 * 10) * 26;
        b.fillStyle = 'rgba(10,12,14,0.30)';
        b.fillRect(ix + (s3 > 0 ? 3 : WALL - 9), dy0, 6, dh);
      }
      /* 剥落的墙皮：一片比墙更暗的补丁 + 崩开的亮边，有的已经露出钢筋 */
      for (i = 0; i < 2; i++) {
        if (h0(i, 61 + s3 * 10) > 0.60) continue;
        var py2 = by + h0(i, 63 + s3 * 10) * BL;
        var ph2 = 14 + h0(i, 64 + s3 * 10) * 26;
        var pw2 = 9 + h0(i, 65 + s3 * 10) * 15;
        var pox = s3 > 0 ? ix + 4 + h0(i, 66 + s3 * 10) * 16
          : ix + WALL - 5 - pw2 - h0(i, 66 + s3 * 10) * 16;
        /* 掉了一层皮：底色只比墙暗一档（别用近黑，否则远看像墙上开了个洞），
           边缘补一圈亮碴，中间再撒几粒露出来的骨料 */
        b.fillStyle = 'rgba(34,37,42,0.62)';
        b.beginPath();
        b.moveTo(pox, py2);
        b.lineTo(pox + pw2, py2 + 3);
        b.lineTo(pox + pw2 - 2, py2 + ph2);
        b.lineTo(pox + 1, py2 + ph2 - 4);
        b.closePath();
        b.fill();
        b.strokeStyle = 'rgba(202,212,224,0.14)';
        b.lineWidth = 1;
        b.stroke();
        for (var pi = 0; pi < 4; pi++) {
          b.fillStyle = 'rgba(150,160,172,0.20)';
          b.fillRect(Math.round(pox + 2 + h0(pi, 68 + s3 * 10) * (pw2 - 4)),
            Math.round(py2 + 2 + h0(pi, 69 + s3 * 10) * (ph2 - 6)), 1, 1);
        }
        if (h0(i, 67 + s3 * 10) < 0.55) {
          b.strokeStyle = 'rgba(126,78,52,0.50)';
          b.beginPath();
          b.moveTo(pox + 2, py2 + ph2 * 0.46);
          b.lineTo(pox + pw2 - 1, py2 + ph2 * 0.46 + 5);
          b.moveTo(pox + 3, py2 + ph2 * 0.26);
          b.lineTo(pox + pw2 - 2, py2 + ph2 * 0.26 + 3);
          b.stroke();
        }
      }
      /* 墙根堆着的碎石：塌下来的混凝土顺着检修步道散开 */
      for (i = 0; i < 5; i++) {
        if (h0(i, 71 + s3 * 10) > 0.68) continue;
        var rx2 = s3 > 0 ? HALF - 3 - h0(i, 72 + s3 * 10) * 8 : -HALF + 3 + h0(i, 72 + s3 * 10) * 8;
        var ry2 = by + h0(i, 73 + s3 * 10) * BL;
        b.fillStyle = h0(i, 74 + s3 * 10) < 0.5 ? 'rgba(96,100,108,0.62)' : 'rgba(56,60,66,0.70)';
        b.fillRect(Math.round(rx2), Math.round(ry2),
          2 + Math.round(h0(i, 75 + s3 * 10) * 2), 1 + Math.round(h0(i, 76 + s3 * 10) * 2));
      }
      /* 血手印：有人被拖进黑里的时候扶过墙 */
      if (h0(0, 81 + s3 * 10) < 0.20) {
        var hy = by + h0(1, 82 + s3 * 10) * BL;
        var hx = s3 > 0 ? ix + 6 : ix + WALL - 13;
        b.fillStyle = 'rgba(78,14,12,0.48)';
        for (i = 0; i < 3; i++) b.fillRect(hx + (i % 2) * 3, hy + i * 3, 2, 1);
        b.fillStyle = 'rgba(78,14,12,0.22)';
        b.fillRect(hx + 1, hy + 9, 2, 8 + h0(2, 83 + s3 * 10) * 12);
      }
    }

    /* ---------- 4. 车道标线 ---------- */
    /* 中线虚线（白，掉漆） */
    for (y = Math.floor(by / 96) * 96; y < by + BL; y += 96) {
      var mh = U.hash(sx, Math.round(y / 96), 911);
      if (mh < 0.18) continue;
      b.fillStyle = 'rgba(226,232,238,' + (0.16 + mh * 0.12).toFixed(2) + ')';
      b.fillRect(-1, y + 10, 2, 40);
    }
    /* 边线 */
    b.fillStyle = 'rgba(226,232,238,0.10)';
    b.fillRect(-ROADH + 3, by, 1.5, BL);
    b.fillRect(ROADH - 4.5, by, 1.5, BL);

    /* ---------- 5. 地面痕迹 ---------- */
    for (i = 0; i < 4; i++) {
      var ox2 = (h0(i, 31) - 0.5) * 2 * (ROADH - 8);
      var oy2 = by + h0(i, 32) * BL;
      ellipseFill(b, ox2, oy2, 5 + h0(i, 33) * 12, 3 + h0(i, 34) * 6,
        h0(i, 35) < 0.5 ? 'rgba(0,0,0,0.28)' : 'rgba(40,44,50,0.35)');
    }
    for (i = 0; i < 2; i++) {
      var cx2 = (h0(i, 41) - 0.5) * 2 * (ROADH - 10);
      var cy2 = by + h0(i, 42) * BL;
      crack(b, cx2, cy2, h0(i, 43) * 3.14, 10 + h0(i, 44) * 16,
        sx * 17 + i, 921 + i, 'rgba(0,0,0,0.35)', 1);
    }
    /* 顶灯掉下来的碎玻璃：暗处的一点反光 */
    if (h0(0, 51) > 0.55) {
      var gx2 = (h0(1, 52) - 0.5) * 24;
      var gy2 = by + h0(2, 53) * BL;
      b.fillStyle = 'rgba(200,220,240,0.30)';
      for (i = 0; i < 6; i++) {
        b.fillRect(Math.round(gx2 + (h0(i, 54) - 0.5) * 16),
          Math.round(gy2 + (h0(i, 55) - 0.5) * 16), 1, 1);
      }
    }

    /* ---------- 5b. 事故现场的地面痕迹 ----------
       每 1152px 一处连环追尾（车是 obstacles.js 的道具，这里只画那摊痕迹）。
       痕迹铺在标线之上、横梁黑影之下 —— 焦黑要盖住白线，但不该盖住光影。 */
    var accBuf = R._accBuf || (R._accBuf = []);
    HS.World.accidentsIn(by, by + BL, accBuf);
    for (var ai = 0; ai < accBuf.length; ai++) accidentGround(b, accBuf[ai]);

    /* ---------- 6. 顶部横梁的黑影 ----------
       横梁不画实体，只画它投在路面上的影子：一条横向的黑带 + 两侧更黑。
       视觉上把走廊切成一段一段，这是"隧道"最省事也最有效的一笔。 */
    for (y = Math.floor(by / 192) * 192; y < by + BL; y += 192) {
      var bandY = y + 96;
      var grd = b.createLinearGradient(0, bandY - 16, 0, bandY + 16);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.5, 'rgba(0,0,0,0.42)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = grd;
      b.fillRect(-HALF, bandY - 16, HALF * 2, 32);
    }

    /* 顶灯不再烘焙在这里：它要闪，见 R.drawTunnelLamps（每帧重画，灯位贴在车道边） */
  };

  R.tunnel = function (b, cx, cy, vw, vh) {
    var BL = HS.World.BLOCK;
    var x0 = Math.floor(cx / BL) * BL - BL;
    var y0 = Math.floor(cy / BL) * BL - BL;
    var x1 = cx + vw + BL, y1 = cy + vh + BL;

    for (var bx = x0; bx < x1; bx += BL) {
      for (var by = y0; by < y1; by += BL) {
        var key = 't' + bx + '|' + by;
        var cv = R._gcache[key];
        if (!cv) {
          if (R._gcount > 40) { R._gcache = {}; R._gcount = 0; }
          cv = HS.P.createCanvas(BL, BL);
          var c = cv.getContext('2d');
          c.translate(-bx, -by);
          R.tunnelBlock(c, bx, by);
          R._gcache[key] = cv;
          R._gcount++;
        }
        b.drawImage(cv, bx, by);
      }
    }
  };

  /**
   * 隧道压暗：一层固定的冷色底噪（两侧与上下略深），
   * 真正的"越走越黑"由 drawTunnelLamps 的径向圈负责（中心是玩家、半径是经验圈）。
   */
  R.drawTunnelDark = function (b, run) {
    var map = run && run.map;
    if (!map || !map.tunnel) return;
    var vw = P.VW, vh = P.VH;
    if (!R._tunDark || R._tunW !== vw || R._tunH !== vh) {
      R._tunW = vw; R._tunH = vh;
      R._tunDark = P.createCanvas(vw, vh);
      var c = R._tunDark.getContext('2d');
      /* 整体压一层冷灰：隧道里的光是死白的，不是太阳 */
      c.fillStyle = 'rgba(6,9,14,0.22)';
      c.fillRect(0, 0, vw, vh);
      /* 左右两侧再压一道：墙根最暗，视线自然收在走廊中间 */
      var gl = c.createLinearGradient(0, 0, vw, 0);
      gl.addColorStop(0, 'rgba(2,4,8,0.30)');
      gl.addColorStop(0.22, 'rgba(2,4,8,0.05)');
      gl.addColorStop(0.5, 'rgba(2,4,8,0)');
      gl.addColorStop(0.78, 'rgba(2,4,8,0.05)');
      gl.addColorStop(1, 'rgba(2,4,8,0.30)');
      c.fillStyle = gl;
      c.fillRect(0, 0, vw, vh);
      /* 上下也收一点，走廊像一条向远处收的管子 */
      var gv = c.createLinearGradient(0, 0, 0, vh);
      gv.addColorStop(0, 'rgba(2,4,8,0.22)');
      gv.addColorStop(0.14, 'rgba(2,4,8,0)');
      gv.addColorStop(0.86, 'rgba(2,4,8,0)');
      gv.addColorStop(1, 'rgba(2,4,8,0.22)');
      c.fillStyle = gv;
      c.fillRect(0, 0, vw, vh);
    }
    b.drawImage(R._tunDark, 0, 0);
  };

  /* ---------------- 公路隧道顶灯（每帧，会闪） ---------------- */

  /**
   * 隧道顶灯。以前是烘焙在地面缓存里的一条亮线 + 一团光晕，问题有两个：
   *   ① 灯画在走廊正中，读起来像"地面上浮着一根发光的棍子"；
   *   ② 烘焙的东西不可能闪，暗成一片的洞窟里连一点"电还在跑"的活气都没有。
   *
   * 现在：灯贴在**车道边**（路缘石上方，x = ±62），用一根短托架连到衬砌上，
   * 灯罩是金属壳 + 里面两根灯管；亮度和光池每帧按灯位哈希重算 ——
   * 大多数灯是稳的，一小部分接触不良（一阵一阵闪），还有几盏快坏了（低频呼吸）。
   */
  R._lampGlow = null;
  function lampGlow() {
    if (R._lampGlow) return R._lampGlow;
    var gs = 128;
    var cv = P.createCanvas(gs, gs);
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(gs / 2, gs / 2, 1, gs / 2, gs / 2, gs / 2);
    g.addColorStop(0, 'rgba(255,228,182,0.58)');
    g.addColorStop(0.34, 'rgba(255,208,148,0.24)');
    g.addColorStop(0.68, 'rgba(255,196,132,0.07)');
    g.addColorStop(1, 'rgba(255,190,126,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, gs, gs);
    R._lampGlow = cv;
    return cv;
  }

  R._fireGlow = null;
  function fireGlow() {
    if (R._fireGlow) return R._fireGlow;
    var gs = 160;
    var cv = P.createCanvas(gs, gs);
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(gs / 2, gs / 2, 1, gs / 2, gs / 2, gs / 2);
    g.addColorStop(0, 'rgba(255,206,140,0.66)');
    g.addColorStop(0.3, 'rgba(255,150,66,0.30)');
    g.addColorStop(0.62, 'rgba(226,80,24,0.11)');
    g.addColorStop(1, 'rgba(180,44,10,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, gs, gs);
    R._fireGlow = cv;
    return cv;
  }

  R.drawTunnelLamps = function (b, run) {
    var map = run && run.map;
    if (!map || !map.tunnel) return;
    var L = HS.Light;
    var glow = lampGlow();
    var top = P.camY - 70, bot = P.camY + P.VH + 70;
    var lid0 = Math.round((top - L.OFF) / L.STEP);
    var lid1 = Math.round((bot - L.OFF) / L.STEP);
    var lights = R._lampLights || (R._lampLights = []);
    lights.length = 0;

    /* ---- 1. 这一屏有哪几盏灯、各亮多少（和索敌用的是同一个 lampFl） ---- */
    for (var lid = lid0 - 1; lid <= lid1 + 1; lid++) {
      var fl = L.lampFl(lid, run.t);
      var pos = L.lampPos(lid);
      lights.push({ x: pos.x, y: pos.y, fl: fl });
    }

    /* ---- 2. 黑暗层：低分辨率逐像素算暗度，再拉伸贴上来 ----
       走过的弯路（都别再试）：
         ① 离屏 canvas + destination-out 挖洞 —— 浏览器正常，微信小游戏的性能 SDK 会递归爆栈
            （RangeError: Maximum call stack size exceeded @ CanvasRenderingContext2D）；
         ② "矩形 + 每个光源一个逆时针圆"的路径一次 fill —— nonzero 规则下，**两个圆重叠**
            的区域 winding 会变成 −1，反而被填黑，于是灯与灯之间的亮区变成一个大黑球；
         ③ 多层叠暗度 —— alpha 是相乘的，10 层 × 0.094 实际只有 0.62，灯外还能看清东西。
       现在直接算：在 1/3 分辨率上逐像素求"最亮的光源"（等价于索敌用的 vis），
       写成一张黑色 RGBA 小图，putImageData + 拉伸盖上去。
       25k 像素/帧，比两次全屏合成便宜，而且曲线和 Light.vis 完全一致。 */
    var pgx = run.p.x - P.camX, pgy = run.p.y - P.camY;
    var nr = L.nearR(run.p), fr = L.farR(run.p);

    var fires = R._fires || (R._fires = []);
    if (HS.World.firesIn) HS.World.firesIn(P.camY - 320, P.camY + P.VH + 320, fires);

    var DS = 2;
    var SW = Math.ceil(P.VW / DS), SH = Math.ceil(P.VH / DS);
    if (!R._darkCv || R._darkW !== SW || R._darkH !== SH) {
      R._darkW = SW; R._darkH = SH;
      R._darkCv = P.createCanvas(SW, SH);
      R._darkCtx = R._darkCv.getContext('2d');
      R._darkImg = R._darkCtx.createImageData(SW, SH);
    }
    var img = R._darkImg, dpx = img.data;

    /* 火焰亮度只跟时间有关，先算好，别在像素循环里重复调 */
    var fireLit = R._fireLit || (R._fireLit = []);
    fireLit.length = 0;
    for (var fi2 = 0; fi2 < fires.length; fi2++) {
      fireLit.push(L.fireFlick(run.t, fires[fi2].k));
    }
    /* 光形查表：每帧 5 万多个像素，别在循环里反复调函数 */
    if (!R._shapeTab) {
      var st = { n: 33, lamp: [], fire: [] };
      for (var sk = 0; sk < st.n; sk++) {
        st.lamp.push(L.lampShape(sk / (st.n - 1)));
        st.fire.push(L.fireShape(sk / (st.n - 1)));
      }
      R._shapeTab = st;
    }
    var sTab = R._shapeTab, sMax = sTab.n - 1;
    var lampN = lights.length, fireN = fires.length;
    var o = 0;
    for (var py = 0; py < SH; py++) {
      var wy = P.camY + (py + 0.5) * DS;
      for (var px = 0; px < SW; px++, o += 4) {
        var wx = P.camX + (px + 0.5) * DS;
        var v = 0;

        /* 玩家那圈：核心 = 经验吸取范围，往外 smoothstep 收到全黑 */
        var ddx = wx - run.p.x, ddy = wy - run.p.y;
        var dd2 = ddx * ddx + ddy * ddy;
        if (dd2 <= nr * nr) v = 1;
        else {
          var dd = Math.sqrt(dd2);
          var uu = (dd - nr) / (fr - nr);
          if (uu < 1) v = 1 - uu * uu * (3 - 2 * uu);
        }

        for (var li = 0; li < lampN; li++) {
          var lp = lights[li];
          if (lp.fl <= 0.03) continue;
          var lx = wx - lp.x, ly = wy - lp.y;
          var l2 = lx * lx + ly * ly;
          if (l2 >= L.RADIUS * L.RADIUS) continue;
          var lv2 = sTab.lamp[((Math.sqrt(l2) / L.RADIUS) * sMax) | 0] * lp.fl;
          if (lv2 > v) v = lv2;
        }

        for (var fi3 = 0; fi3 < fireN; fi3++) {
          var fp = fires[fi3];
          var fx2 = wx - fp.x, fy2 = wy - fp.y;
          var f2 = fx2 * fx2 + fy2 * fy2;
          if (f2 >= L.FIRE_R * L.FIRE_R) continue;
          var fv = sTab.fire[((Math.sqrt(f2) / L.FIRE_R) * sMax) | 0] * fireLit[fi3];
          if (fv > v) v = fv;
        }

        var da = 0.94 * (1 - v);
        if (da > 0.94) da = 0.94;
        dpx[o] = 2; dpx[o + 1] = 3; dpx[o + 2] = 6;
        dpx[o + 3] = (da * 255) | 0;
      }
    }
    R._darkCtx.putImageData(img, 0, 0);
    var sm = b.imageSmoothingEnabled;
    b.imageSmoothingEnabled = true;
    b.drawImage(R._darkCv, 0, 0, P.VW, P.VH);
    b.imageSmoothingEnabled = sm;

    /* ---- 2b. 黑暗里唯一看得见的东西：自己会发光的 ----
       自爆尸的肚囊本来就透光（这是它的识别特征，也是"快炸了"的预告），
       双首领一个是喉咙冷光、一个是透光的育囊 —— 让它们在黑段里自带一小圈光，
       既合理，也保证 Boss 战不会在纯黑里打。普通丧尸不给光：看不见就锁不上。 */
    if (!R._softDot) {
      var ds = 64;
      var dc = P.createCanvas(ds, ds);
      var dctx = dc.getContext('2d');
      var dg = dctx.createRadialGradient(ds / 2, ds / 2, 1, ds / 2, ds / 2, ds / 2);
      dg.addColorStop(0, 'rgba(255,255,255,0.55)');
      dg.addColorStop(0.4, 'rgba(255,255,255,0.18)');
      dg.addColorStop(1, 'rgba(255,255,255,0)');
      dctx.fillStyle = dg;
      dctx.fillRect(0, 0, ds, ds);
      R._softDot = dc;
    }
    var elist = run.enemies;
    for (var ei = 0; ei < elist.length; ei++) {
      var ee = elist[ei];
      if (ee.dead) continue;
      var ex = ee.x - P.camX, ey = ee.y - P.camY;
      if (ex < -90 || ex > P.VW + 90 || ey < -90 || ey > P.VH + 90) continue;
      if (ee.def && ee.def.bomber && R._bombGlow) {
        var rage = 1 - Math.max(0, ee.hp / ee.maxHp);
        var pl = 0.55 + 0.45 * Math.sin(run.t * (4 + rage * 7) + ee.seed);
        var pr = ee.r * (2.4 + 0.4 * pl);
        b.save();
        b.globalCompositeOperation = 'lighter';
        b.globalAlpha = 0.42 + 0.30 * pl;
        b.drawImage(R._bombGlow, ex - pr, ey - pr, pr * 2, pr * 2);
        b.restore();
      } else if (ee.boss) {
        var br2 = ee.r * 4.6 + 16;
        b.save();
        b.globalCompositeOperation = 'lighter';
        b.globalAlpha = 0.52 + 0.10 * Math.sin(run.t * 2.4 + (ee.seed || 0));
        b.drawImage(R._softDot, ex - br2, ey - br2, br2 * 2, br2 * 2);
        b.restore();
        /* 站进暗处时，首领得看得见 —— 它是变异体，身上本来就有荧光。
           光圈外的 Boss 只留一层半透明剪影，玩家知道"它在那个方向"，但看不清细节：
           既能找位置，又不至于把"黑暗"这件事一笔勾销。 */
        var bv = L.vis(ee.x, ee.y, run);
        if (bv < 0.34) {
          b.save();
          b.globalAlpha = 0.30 + 0.34 * (1 - bv);
          R.drawActor(b, ee.spriteName || 'boss', ex, ey - 4 - (ee.airH || 0),
            ee.scale, ee.anim, ee.gait, ee.lean, ee.hitSprite || 'boss_hit', 0);
          b.restore();
          /* 技能预兆绝不能藏在黑暗里：尖啸者常年站得远，
             它的收束环 / 声压环就是玩家唯一的"要喊了"读法。 */
          if (ee.def && ee.def.bossType === 'shrieker' && (ee.hSt === 1 || ee.hSt === 5)) {
            b.save();
            b.translate(-P.camX, -P.camY);
            b.globalAlpha = 0.92;
            R.drawBossShriek(b, ee, run.p);
            b.restore();
          }
        }
      }
    }

    /* ---- 3. 玩家脚边那点光（手电 / 火机）—— 核心圈之所以是暖的 ---- */
    if (!R._playerGlow) {
      var ps = 96;
      var pc = P.createCanvas(ps, ps);
      var pctx = pc.getContext('2d');
      var pg = pctx.createRadialGradient(ps / 2, ps / 2, 1, ps / 2, ps / 2, ps / 2);
      pg.addColorStop(0, 'rgba(255,232,196,0.42)');
      pg.addColorStop(0.45, 'rgba(255,214,164,0.16)');
      pg.addColorStop(1, 'rgba(255,200,150,0)');
      pctx.fillStyle = pg;
      pctx.fillRect(0, 0, ps, ps);
      R._playerGlow = pc;
    }
    b.save();
    b.globalCompositeOperation = 'lighter';
    b.globalAlpha = 0.62;
    /* 暖光只铺到核心圈略外一圈：再大就盖住了"越往外越黑"的层次 */
    b.drawImage(R._playerGlow, pgx - nr * 1.5, pgy - nr * 1.42, nr * 3, nr * 2.84);
    b.restore();

    /* ---- 4. 再画灯本身（托架 + 灯罩 + 灯管 + 光池） ---- */
    for (var i2 = 0; i2 < lights.length; i2++) {
      var lm = lights[i2];
      var sx = lm.x - P.camX, sy = lm.y - P.camY;
      var sdx = lm.x >= 0 ? 1 : -1;
      if (lm.fl > 0.02) {
        /* 暖光池只补色，不再负责"照亮" —— 挖洞那一步已经把细节放出来了 */
        b.save();
        b.globalCompositeOperation = 'lighter';
        b.globalAlpha = lm.fl * 0.5;
        b.drawImage(glow, sx - 96, sy - 110, 192, 220);
        b.restore();
      }
      /* 托架：从灯罩往衬砌那一侧伸出去，这是"它不是浮在半空"的关键一笔 */
      b.fillStyle = 'rgba(26,29,34,0.96)';
      b.fillRect(sdx > 0 ? sx + 10 : sx - 34, sy - 1, 24, 2);
      b.fillRect(sdx > 0 ? sx + 30 : sx - 36, sy - 3, 6, 6);
      /* 灯罩 */
      b.fillStyle = 'rgba(12,14,18,0.94)';
      b.fillRect(sx - 11, sy - 4, 22, 8);
      b.fillStyle = 'rgba(62,68,76,0.95)';
      b.fillRect(sx - 11, sy - 4, 22, 1);
      b.fillStyle = 'rgba(34,38,44,0.95)';
      b.fillRect(sx - 11, sy + 3, 22, 1);
      /* 灯管：亮的时候偏向暖白，暗的时候是一根灰玻璃 */
      if (lm.fl > 0.06) {
        b.fillStyle = 'rgba(255,246,218,' + (0.30 + 0.65 * lm.fl).toFixed(3) + ')';
        b.fillRect(sx - 8, sy - 1, 16, 2);
        b.fillStyle = 'rgba(255,236,196,' + (0.10 + 0.25 * lm.fl).toFixed(3) + ')';
        b.fillRect(sx - 9, sy - 2, 18, 1);
      } else {
        b.fillStyle = 'rgba(122,132,144,0.22)';
        b.fillRect(sx - 8, sy - 1, 16, 1);
        b.fillStyle = 'rgba(8,10,12,0.6)';           // 裂了一道缝
        b.fillRect(sx - 2, sy - 1, 5, 1);
      }
    }

    /* ---- 5. 事故车堆的火：光晕 + 跳动的火苗 + 火星（画在暗层之上才发亮） ---- */
    var fglow = fireGlow();
    for (var fj = 0; fj < fires.length; fj++) {
      var fr = fires[fj];
      var fx = fr.x - P.camX, fy = fr.y - P.camY;
      if (fx < -170 || fx > P.VW + 170 || fy < -190 || fy > P.VH + 190) continue;
      var fl2 = L.fireFlick(run.t, fr.k);
      b.save();
      b.globalCompositeOperation = 'lighter';
      /* 大光晕：把车堆和周围的地面一起照暖 */
      b.globalAlpha = 0.62 * fl2;
      b.drawImage(fglow, fx - 132, fy - 128, 264, 256);
      /* 火苗：三束高矮不一，各自按不同相位跳 */
      for (var q3 = 0; q3 < 3; q3++) {
        var ph = run.t * (6.5 + q3 * 1.9) + fr.k * 2.3 + q3 * 2.1;
        var wob = Math.sin(ph) * (3 + q3);
        var hgt = 15 + q3 * 7 + Math.sin(ph * 1.4) * 4;
        var wid = 5.4 - q3 * 0.9;
        b.fillStyle = q3 === 0 ? 'rgba(255,226,150,0.88)'
          : (q3 === 1 ? 'rgba(255,156,54,0.72)' : 'rgba(206,64,20,0.58)');
        b.beginPath();
        b.ellipse(fx + wob + (q3 - 1) * 2.5, fy - 6 - hgt * 0.45 - q3 * 1.5,
          wid, hgt * 0.5, 0, 0, U.TAU);
        b.fill();
      }
      /* 火星：不用存状态，相位全靠 hash + 时间 */
      for (var q4 = 0; q4 < 7; q4++) {
        var sp = (run.t * 0.6 + U.hash(fr.k, q4, 7781)) % 1;
        var mx = fx + (U.hash(fr.k, q4, 7783) - 0.5) * 20 + Math.sin(run.t * 3 + q4) * 3;
        var my = fy - 8 - sp * 52;
        b.fillStyle = 'rgba(255,' + Math.round(186 - sp * 96) + ',86,' + (0.9 * (1 - sp)).toFixed(3) + ')';
        b.fillRect(Math.round(mx), Math.round(my), 1.6, 1.6);
      }
      b.restore();
    }
  };

  /* 锈水高速：柏油立交上覆盖浑浊积水。每帧只画可视区，水面反光带轻微流动。 */
  R.drawFlood = function (b, run) {
    if (!run.map.water) return;
    var tile = 16;
    var x0 = Math.floor(P.camX / tile) * tile - tile;
    var y0 = Math.floor(P.camY / tile) * tile - tile;
    var x1 = P.camX + P.VW + tile, y1 = P.camY + P.VH + tile;
    for (var y = y0; y < y1; y += tile) {
      for (var x = x0; x < x1; x += tile) {
        var z = HS.Water.zone(x + 8, y + 8, run);
        if (!z) continue;
        var n = U.hash(x / tile, y / tile, 8819);
        b.fillStyle = z === 2 ? (n < 0.5 ? '#173b3a' : '#1b4240') : 'rgba(60,86,70,0.72)';
        b.fillRect(x, y, tile + 1, tile + 1);
        /* 像素水面反光：短横线错位排列，不做平滑渐变。 */
        if (n < 0.34) {
          var drift = Math.round(Math.sin(run.t * 1.7 + n * 20) * 3);
          b.fillStyle = z === 2 ? 'rgba(135,183,163,0.22)' : 'rgba(197,190,139,0.24)';
          b.fillRect(x + 2 + drift, y + 4 + ((n * 9) | 0), 5 + ((n * 17) % 7), 1);
          b.fillRect(x + 7 - drift, y + 11, 3, 1);
        }
        /* 水草丛只长在浅水边缘，避免深水区看起来像能站。 */
        if (z === 1 && n > 0.84) {
          b.strokeStyle = '#496544'; b.lineWidth = 1;
          b.beginPath();
          b.moveTo(x + 5, y + 14); b.lineTo(x + 3, y + 7);
          b.moveTo(x + 6, y + 14); b.lineTo(x + 9, y + 6);
          b.moveTo(x + 7, y + 14); b.lineTo(x + 7, y + 8);
          b.stroke();
        }
      }
    }
    for (var i = 0; i < run.waterHazards.length; i++) {
      var h = run.waterHazards[i];
      b.fillStyle = 'rgba(8,28,31,0.48)';
      b.beginPath(); b.arc(h.x, h.y, h.r, 0, U.TAU); b.fill();
      b.strokeStyle = 'rgba(113,164,151,0.35)'; b.lineWidth = 1;
      b.beginPath(); b.arc(h.x, h.y, h.r - 2, 0, U.TAU); b.stroke();
    }
    if (run.pumpT > 0) {
      b.strokeStyle = 'rgba(130,220,205,0.58)'; b.lineWidth = 2;
      b.beginPath(); b.arc(run.pumpX, run.pumpY, run.pumpR * (0.96 + Math.sin(run.t * 5) * 0.02), 0, U.TAU); b.stroke();
      b.fillStyle = '#557d70'; b.fillRect(run.pumpX - 7, run.pumpY - 5, 14, 10);
      b.fillStyle = '#b8d9c9'; b.fillRect(run.pumpX - 4, run.pumpY - 8, 8, 3);
    }
    if (run.safeT > 0) {
      var sx = run.safeX, sy = run.safeY, sr = run.safeR;
      /* 桥下安全屋：四根桥墩 + 半透明桥板，圈只是补给范围。 */
      b.fillStyle = 'rgba(37,49,45,0.38)';
      b.fillRect(sx - sr * 0.58, sy - sr * 0.72, sr * 1.16, sr * 1.44);
      b.strokeStyle = 'rgba(137,155,142,0.55)'; b.lineWidth = 2;
      b.strokeRect(sx - sr * 0.58, sy - sr * 0.72, sr * 1.16, sr * 1.44);
      b.fillStyle = '#394a42';
      for (var px2 = -1; px2 <= 1; px2 += 2) {
        for (var py2 = -1; py2 <= 1; py2 += 2) {
          b.fillRect(sx + px2 * sr * 0.54 - 3, sy + py2 * sr * 0.66 - 3, 6, 6);
        }
      }
      b.fillStyle = 'rgba(240,201,110,0.07)';
      b.beginPath(); b.arc(sx, sy, sr, 0, U.TAU); b.fill();
      b.strokeStyle = 'rgba(255,215,125,0.68)'; b.lineWidth = 2;
      b.setLineDash([5, 4]); b.beginPath(); b.arc(sx, sy, sr, 0, U.TAU); b.stroke(); b.setLineDash([]);
      b.fillStyle = '#e8c66f'; b.fillRect(sx - 9, sy - sr * 0.78, 18, 3);
    }
  };

  /**
   * 巨斧砸烂的地面：不规则的碎土坑 + 放射裂纹 + 崩出去的石块。
   * 它只是伤痕，不改通行 —— 玩家能踩着走过去，但一眼看得出这里被砸过。
   */
  R.drawBreaks = function (b, run) {
    var list = run.breaks;
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (g.x < P.camX - 90 || g.x > P.camX + P.VW + 90 ||
          g.y < P.camY - 90 || g.y > P.camY + P.VH + 90) continue;
      var fade = Math.min(1, g.life / 4);
      /* ---- 斧刃划过的弧裂纹（交叉斩）----
         和"砸出来的圆坑"是两种东西：这条是顺着刀刃轨迹的一道缝，
         半径抖动出锯齿，内侧补一道受光边，再挑几处分叉出去。
         **半径不压扁**（别的贴地装饰会乘 0.62 做透视）：这条弧是判定边界的地面投影，
         判定本身是正圆（`U.dist < CL_R`），压扁之后弧的上下两头只剩 62% 半径，
         玩家站在"弧外"却照样被砍到 —— 边界线必须和判定同形。 */
      if (g.arc) {
        var a0 = g.ang - g.span / 2;
        var N2 = 20;
        /* 抖动只给 ±3%：±7% 的时候每段都是尖角，整条读成拉链/心电图，
           不像被斧刃划过 —— 刀口是顺的，只该有轻微的起伏 */
        var jit = function (s3) {
          return 0.97 + 0.06 * U.hash(Math.round(g.x) + s3 * 5, Math.round(g.y), 617);
        };
        b.save();
        b.globalAlpha = 0.9 * fade;
        b.lineCap = 'round';
        var s2, t2, a2, jr, xx, yy;
        /* 主缝：分三段画，中间实、两头虚，收口才像"划开"而不是"画上去" */
        b.strokeStyle = 'rgba(16,12,9,0.88)';
        b.lineWidth = 2.6;
        b.beginPath();
        for (s2 = 0; s2 <= N2; s2++) {
          t2 = s2 / N2;
          a2 = a0 + g.span * t2;
          jr = g.r * jit(s2);
          xx = g.x + Math.cos(a2) * jr;
          yy = g.y + Math.sin(a2) * jr;
          if (s2 === 0) b.moveTo(xx, yy); else b.lineTo(xx, yy);
        }
        b.stroke();
        /* 受光边贴在内侧：光从上方来，裂缝朝上那一侧才有反光 */
        b.strokeStyle = 'rgba(158,140,110,0.30)';
        b.lineWidth = 1;
        b.beginPath();
        for (s2 = 0; s2 <= N2; s2++) {
          t2 = s2 / N2;
          a2 = a0 + g.span * t2;
          jr = g.r * jit(s2) - 2;
          xx = g.x + Math.cos(a2) * jr;
          yy = g.y + Math.sin(a2) * jr;
          if (s2 === 0) b.moveTo(xx, yy); else b.lineTo(xx, yy);
        }
        b.stroke();
        /* 分叉：短、斜、往外偏 —— 四条就够，再多就成蜘蛛网了 */
        b.strokeStyle = 'rgba(16,12,9,0.46)';
        b.lineWidth = 1;
        for (var bk = 0; bk < 4; bk++) {
          var bt2 = (bk + 0.5) / 4;
          var ba2 = a0 + g.span * bt2;
          var brr = g.r * jit(bt2 * N2);
          var skew = (U.hash(bk, Math.round(g.x), 331) - 0.5) * 0.5;
          var outR = 7 + 9 * U.hash(bk, Math.round(g.y), 907);
          b.beginPath();
          b.moveTo(g.x + Math.cos(ba2) * brr, g.y + Math.sin(ba2) * brr);
          b.lineTo(
            g.x + Math.cos(ba2 + skew) * (brr + outR),
            g.y + Math.sin(ba2 + skew) * (brr + outR)
          );
          b.stroke();
        }
        b.restore();
        continue;
      }
      var r = g.r;
      var seedX = Math.round(g.x), seedY = Math.round(g.y);
      b.save();
      b.globalAlpha = 0.9 * fade;
      /* 外圈扬尘：没有它，坑会读成一团黑影 */
      b.fillStyle = 'rgba(122,106,80,0.30)';
      b.beginPath();
      b.ellipse ? b.ellipse(g.x, g.y + 2, r * 1.28, r * 0.92, 0, 0, U.TAU)
        : b.arc(g.x, g.y + 2, r * 1.1, 0, U.TAU);
      b.fill();
      /* 坑底：边缘用 hash 抖出锯齿，避免画成一枚圆章 */
      b.fillStyle = '#2a231b';
      b.beginPath();
      for (var k = 0; k <= 12; k++) {
        var a = k / 12 * U.TAU;
        var jr = r * (0.80 + 0.22 * U.hash(seedX + k * 7, seedY, 991));
        var px = g.x + Math.cos(a) * jr;
        var py = g.y + Math.sin(a) * jr * 0.7;
        if (k === 0) b.moveTo(px, py); else b.lineTo(px, py);
      }
      b.closePath(); b.fill();
      /* 里层更深的一块，做出"被砸凹"的层次 */
      b.fillStyle = 'rgba(14,11,8,0.55)';
      b.beginPath();
      b.arc(g.x, g.y + 1, r * 0.52, 0, U.TAU);
      b.fill();
      /* 放射裂纹：暗缝 + 一道受光的高光边 */
      b.strokeStyle = 'rgba(16,12,9,0.8)';
      b.lineWidth = 1.4;
      for (var c = 0; c < 6; c++) {
        var ca = (c / 6) * U.TAU + (g.seed || 0) * 6.283;
        var len = r * (0.8 + 0.6 * U.hash(c, seedX, 771));
        b.beginPath();
        b.moveTo(g.x + Math.cos(ca) * r * 0.3, g.y + Math.sin(ca) * r * 0.2);
        b.lineTo(g.x + Math.cos(ca) * len, g.y + Math.sin(ca) * len * 0.7);
        b.stroke();
        if (c % 2 === 0) {
          b.strokeStyle = 'rgba(158,140,110,0.30)';
          b.beginPath();
          b.moveTo(g.x + Math.cos(ca) * r * 0.5, g.y + Math.sin(ca) * r * 0.35);
          b.lineTo(g.x + Math.cos(ca) * len * 0.9, g.y + Math.sin(ca) * len * 0.62);
          b.stroke();
          b.strokeStyle = 'rgba(16,12,9,0.8)';
        }
      }
      /* 崩到外圈的石块：一两块大的 + 几粒小的 */
      for (var s2 = 0; s2 < 7; s2++) {
        var ha = U.hash(s2 * 13, seedX, 3301) * U.TAU;
        var hr = r * (0.8 + 0.65 * U.hash(s2 * 7, seedY, 4409));
        var bx = g.x + Math.cos(ha) * hr;
        var by = g.y + Math.sin(ha) * hr * 0.7;
        b.fillStyle = s2 % 3 === 0 ? '#6b5e4c' : (s2 % 3 === 1 ? '#4a4034' : '#332c22');
        b.fillRect(bx, by, s2 % 2 ? 3 : 2, 2);
        if (s2 < 2) {
          b.fillStyle = '#1b1611';
          b.fillRect(bx + 0.5, by + 2, 3, 1);
        }
      }
      b.restore();
    }
  };

  R.ground = function (b, theme, cx, cy, vw, vh) {
    if (theme === 'street') { R.street(b, cx, cy, vw, vh); return; }
    if (theme === 'tunnel') { R.tunnel(b, cx, cy, vw, vh); return; }
    if (theme === 'desert' || theme === 'flood') { R.desert(b, cx, cy, vw, vh); return; }
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
   *
   * **震屏疲劳**（run.shakeBusy，Game.updateRun 里累加）：屏幕连着抖的时候最多打掉
   * 六成幅度。自爆尸连环炸的时候，原来每一发都把镜头顶回 6px、抖个不停；
   * 现在连着炸只会剩下 2px 上下，能看见"在炸"但不晃眼。
   * 单次爆炸只抖 0.1 秒，疲劳度来不及攒起来，所以一击的手感没变。
   */
  R.shakeAmount = function (g) {
    if (!g || !g.run || g.state !== 'run') return 0;
    var v = (g.run.shake || 0) * (1 - 0.6 * (g.run.shakeBusy || 0));
    return v * (P.fxLow ? 0.3 : 1);
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
    R.drawFlood(b, run);
    R.drawBreaks(b, run);

    /* 地面污渍（低配模式直接跳过，屏幕上通常有一两百摊） */
    var i;
    if (!P.fxLow) {
      for (i = 0; i < run.decals.length; i++) {
        var dc = run.decals[i];
        /* 出血留下的那几摊比普通污渍略浅一点点（看起来是"湿的"），
           但同样是灰黑 —— 全游戏不出现红色血，过审口径统一 */
        b.fillStyle = dc.blood
          ? 'rgba(58,58,64,' + Math.max(0, dc.a).toFixed(3) + ')'
          : 'rgba(26,26,30,' + Math.max(0, dc.a).toFixed(3) + ')';
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

      /* 烟幕：三层灰云缓慢翻滚 + 一圈淡淡的边界。
         以前它走的是火池通用分支，画出来是红橙色的圆 —— 玩家会以为那是燃烧地面，
         而它其实是"挡远程的烟" */
      if (pool.smoke) {
        var sFade = Math.min(1, pool.life / 0.5);
        for (var sl = 0; sl < 3; sl++) {
          var srr = pool.r * (0.66 + sl * 0.15);
          var sa = (0.11 - sl * 0.025) * sFade;
          if (sa <= 0) continue;
          b.fillStyle = 'rgba(178,188,198,' + sa.toFixed(3) + ')';
          b.beginPath();
          b.arc(pool.x + Math.sin(run.t * 0.9 + sl * 2.1 + i) * (3 + sl * 2),
            pool.y + Math.cos(run.t * 0.7 + sl * 1.7 + i) * (2 + sl * 2),
            srr, 0, U.TAU);
          b.fill();
        }
        b.strokeStyle = 'rgba(200,210,220,' + (0.13 * sFade).toFixed(3) + ')';
        b.lineWidth = 1;
        b.beginPath(); b.arc(pool.x, pool.y, pool.r - 1, 0, U.TAU); b.stroke();
        continue;
      }

      /* 钻核（便携钻头进化）：灰白的旋转钻痕，不是火 */
      if (pool.core) {
        var cf = Math.min(1, pool.life / 0.4);
        var cr2 = pool.r * (1 - 0.15 * (pool.life / pool.max));
        b.fillStyle = 'rgba(190,205,220,' + (0.10 * cf).toFixed(3) + ')';
        b.beginPath(); b.arc(pool.x, pool.y, cr2, 0, U.TAU); b.fill();
        b.strokeStyle = 'rgba(226,236,245,' + (0.35 * cf).toFixed(3) + ')';
        b.lineWidth = 1.2;
        for (var ci = 0; ci < 3; ci++) {
          var ca3 = run.t * 7 + ci * 2.09;
          b.beginPath();
          b.arc(pool.x, pool.y, cr2 * (0.55 + ci * 0.15), ca3, ca3 + 1.1);
          b.stroke();
        }
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

    /* 玩家脚下的光，同时就是「经验拾取范围」的指示圈。
       以前这里写死 20px，点「拾取范围」圈一点变化都没有，玩家会以为卡是废的。
       外圈直接读 p.magnet（和 combat.js 里真正判定的半径是同一个值），
       边界补一道细环，涨了多少一眼能看出来。 */
    var mgR = p.magnet || 44;
    b.fillStyle = 'rgba(255,205,140,0.045)';
    b.beginPath(); b.arc(p.x, p.y + 3, mgR, 0, U.TAU); b.fill();
    b.strokeStyle = 'rgba(255,225,185,0.16)';
    b.lineWidth = 1;
    b.beginPath(); b.arc(p.x, p.y + 3, mgR - 0.5, 0, U.TAU); b.stroke();
    b.fillStyle = 'rgba(255,235,200,0.07)';
    b.beginPath(); b.arc(p.x, p.y + 3, 11, 0, U.TAU); b.fill();

    /* ---- 障碍物：取可视范围 + 余量 ---- */
    var obsBuf = this._obs || (this._obs = []);
    HS.World.queryRect(P.camX - 60, P.camY - 80, P.camX + P.VW + 60, P.camY + P.VH + 80, obsBuf);
    if (HS.Water) HS.Water.query(P.camX - 60, P.camY - 80, P.camX + P.VW + 60, P.camY + P.VH + 80, run, obsBuf);
    var bBuf = this._bld || (this._bld = []);
    HS.World.buildingsInRect(P.camX - 80, P.camY - 110, P.camX + P.VW + 80, P.camY + P.VH + 110, bBuf);

    /* ---- 敌人 / 道具 / 建筑 / 玩家 一起排序，保证遮挡关系 ---- */
    var list = this._dl || (this._dl = []);
    list.length = 0;
    for (i = 0; i < run.enemies.length; i++) {
      if (!run.enemies[i].dead) list.push(run.enemies[i]);
    }
    /* 隧道衬砌只做碰撞、不参与绘制（地面层已经画过了） */
    for (i = 0; i < obsBuf.length; i++) {
      if (!obsBuf[i].wall) list.push(obsBuf[i]);
    }

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

    /* 元素光锥铺在地面（画在角色之前，免得盖住脸和枪） */
    if (!p.veh) R.drawFlameCone(b, p, run);

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
        /* 眩晕（尖啸者的超声）：脚下抖动的圈 + 头顶绕着转的三颗星。
           没有这一层，玩家只会觉得"我推着摇杆它不动，是不是卡了" */
        if (p.stun > 0) {
          var sk2 = Math.min(1, p.stun / (p.stunMax || 0.9));
          b.strokeStyle = 'rgba(191,233,255,' + (0.35 * sk2 + 0.15).toFixed(3) + ')';
          b.lineWidth = 1.4;
          b.beginPath();
          b.ellipse(p.x, p.y + 6, 13 + Math.sin(run.t * 26) * 1.6, 5, 0, 0, U.TAU);
          b.stroke();
          for (var sd2 = 0; sd2 < 3; sd2++) {
            var sa2 = run.t * 5.2 + sd2 * (U.TAU / 3);
            var sxx = p.x + Math.cos(sa2) * 8;
            var syy = p.y - 20 + Math.sin(sa2) * 2.4;
            b.fillStyle = sd2 === 0 ? '#fff6c4' : 'rgba(255,222,120,0.8)';
            b.fillRect(Math.round(sxx), Math.round(syy), 2, 2);
          }
        }

        /* 蓄能指示（冲击波发生器）：贴地一圈随蓄势向内收束的光环。
           没有它玩家看不出"我在憋"，只会觉得这件武器时好时坏 */
        if (p.chargeVis > 0.05) {
          b.save();
          if (p.chargeKind === 'rail') {
            /* 湮灭炮的 3 秒蓄力：三道收束光环 + 八根辐条 + 中心聚能核。
               它和冲击波发生器共用 p.chargeVis / p.chargeR，但必须一眼分得清 ——
               一个是要"震出去"，一个是要"打穿一条线"。 */
            var rk2 = Math.min(1, p.chargeVis / 3);
            var rR = p.chargeR || 78;
            b.globalCompositeOperation = 'lighter';
            b.strokeStyle = '#8ee9ff';
            for (var ringI = 0; ringI < 3; ringI++) {
              var rr2 = rR * (1 - ringI * 0.26) * (1.15 - rk2 * 0.5);
              b.globalAlpha = (0.10 + rk2 * 0.34) * (1 - ringI * 0.22);
              b.lineWidth = 1 + rk2 * 1.6;
              b.beginPath(); b.arc(p.x, p.y + 2, rr2, 0, U.TAU); b.stroke();
            }
            /* 辐条：朝中心收，转速随蓄力加快 */
            b.globalAlpha = 0.18 + rk2 * 0.5;
            b.lineWidth = 1;
            for (var sp2 = 0; sp2 < 8; sp2++) {
              var sa2 = sp2 * U.TAU / 8 + run.t * (1.2 + rk2 * 3);
              var r0 = rR * (1.05 - rk2 * 0.45);
              b.beginPath();
              b.moveTo(p.x + Math.cos(sa2) * r0, p.y + 2 + Math.sin(sa2) * r0);
              b.lineTo(p.x + Math.cos(sa2) * r0 * 0.62, p.y + 2 + Math.sin(sa2) * r0 * 0.62);
              b.stroke();
            }
            /* 聚能核：蓄满前一圈圈放大，最后闪一下 */
            var coreR = 2 + rk2 * 7 + (rk2 > 0.96 ? Math.sin(run.t * 60) * 1.5 : 0);
            b.globalAlpha = 0.5 + rk2 * 0.5;
            b.fillStyle = '#dffaff';
            b.beginPath(); b.arc(p.x, p.y + 2, coreR, 0, U.TAU); b.fill();
            b.globalAlpha = 0.22 * rk2;
            b.fillStyle = '#8ee9ff';
            b.beginPath(); b.arc(p.x, p.y + 2, coreR * 2.6, 0, U.TAU); b.fill();
          } else {
            var ck = Math.min(1, p.chargeVis / 4);
            var crr = (p.chargeR || 58) * (1.18 - ck * 0.38);
            b.globalCompositeOperation = 'lighter';
            b.strokeStyle = '#8ecae6';
            b.globalAlpha = 0.16 + ck * 0.45;
            b.lineWidth = 1 + ck * 2;
            b.beginPath(); b.arc(p.x, p.y + 2, crr, 0, U.TAU); b.stroke();
            b.globalAlpha = 0.08 + ck * 0.2;
            b.lineWidth = 1;
            b.beginPath(); b.arc(p.x, p.y + 2, crr * 0.62, 0, U.TAU); b.stroke();
          }
          b.restore();
          b.globalAlpha = 1;
        }
        var pAlpha = 1;
        if (p.invuln > 0 && Math.floor(run.t * 18) % 2 === 0) pAlpha = 0.45;
        /* 挨打时整个人被撞得一晃，比单纯闪白更像被咬到 */
        var pJx = p.hurtT > 0 ? Math.sin(p.hurtT * 78) * p.hurtT * 4 : 0;
        var aim = p.aimA || 0;
        /* 背面朝上时枪永远画在人前面（她背对我们，枪在她身前 = 我们看得到）；
           其他朝向朝上瞄时才把枪压到身体后面，做出"手从身侧绕过去"的层次 */
        var gunBehind = (faceOf(p) !== 'up') && Math.sin(aim) < -0.25;

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

        /* 搜刮成功：0.9 秒内原地蹦两下，同时换成开心帧。
           用 |sin| 做连跳（落地即起跳），最后 0.18s 收力，免得突然停住。
           蹦的时候 gait 归零 —— 开心帧是"收腿离地"的姿态，不该被切成走路的腿。 */
        var cheerY = 0, pName = p.sprite, pGait = p.gait;
        /* 设置里关掉"跟随朝向"就永远用正面那套帧 */
        var pDir = faceOf(p);
        if (p.cheerT > 0) {
          /* 搜刮成功的开心跳：抛物线 + 开心帧 */
          var cx0 = p.cheerMax - p.cheerT;
          var fade0 = Math.min(1, p.cheerT / 0.18);
          cheerY = -Math.abs(Math.sin(cx0 * 9.6)) * 6 * fade0;
          pName = p.spriteHappy || p.sprite;
          pGait = 0;
        } else if (p.gait > 0.06) {
          /* 行走：p.anim 随移速走（正常速度约 11 rad/s），0.62 的系数让
             四帧一轮 ≈ 0.58s；被水拖慢时步频自动跟着慢下来 */
          pName = whaleFrame(pDir, 2 + (Math.floor(p.anim * 0.62) & 3));
        } else {
          /* 站着：两帧交替做呼吸（约 1.1s 一次），比完全静止耐看 */
          pName = whaleFrame(pDir, (Math.floor(run.t * 0.9) & 1) ? 1 : 0);
        }

        /* 换向的 0.09s 里横向压一下（横向换向才压）：像素小人转身没有中间帧，
           直接换整套贴图会像"变形"，压一下就读成"扭身"了 */
        var squashX = 1;
        if (p.faceTurnT > 0) {
          squashX = 1 - 0.18 * (p.faceTurnT / 0.09);
        }

        b.globalAlpha = pAlpha;
        if (gunBehind) R.drawGun(b, p, aim);
        /* 压扁以脚底为轴，不然人会跟着"缩"到地下 */
        if (squashX !== 1) {
          b.save();
          b.translate(p.x + pJx, p.y + 7);
          b.scale(squashX, 1);
          b.translate(-(p.x + pJx), -(p.y + 7));
        }
        if (twist !== 0) {
          b.save();
          b.translate(p.x + pJx, p.y + 4);
          b.rotate(twist);
          b.translate(-(p.x + pJx), -(p.y + 4));
          R.drawActor(b, pName, p.x + pJx + lunge, p.y + PSPRITE_LIFT + cheerY, 1, p.anim, pGait, p.lean, null, 0);
          b.restore();
        } else {
          R.drawActor(b, pName, p.x + pJx + lunge, p.y + PSPRITE_LIFT + cheerY, 1, p.anim, pGait, p.lean, null, 0);
        }
        if (squashX !== 1) b.restore();
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
        /* 流血标记：跟着敌人画，和"血珠飞溅"互补（一个是状态，一个是事件） */
        if (it.bleed > 0) R.drawBleedMark(b, it, run);
        /* 裂口标记（机械钻头）：亮色钻痕，和暗色血点分开认 */
        if (it.rift > 0) R.drawRiftMark(b, it, run);
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
        /* 巨斧的起手/收势也要有身体动作：蓄力时往后仰、砍出去时往前压 */
        var bLean = 0;
        if (be.def && be.def.bossType === 'axeboss') {
          if (be.aSt === 1) bLean = -0.16 * (1 - Math.max(0, be.aT) / 0.68);
          else if (be.aSt === 5) bLean = 0.26 * (1 - Math.max(0, be.aT) / 0.26);
          else if (be.aSt === 4) bLean = 0.10 * Math.max(0, Math.min(1, be.aT / 0.72));
        }
        if (bLean) {
          b.save();
          b.translate(be.x, be.y + 2);
          b.rotate(bLean);
          b.translate(-be.x, -(be.y + 2));
          R.drawActor(b, be.spriteName || 'boss', be.x, be.y - 4 - (be.airH || 0), be.scale, be.anim, be.gait,
            be.lean, be.hitSprite || 'boss_hit', Math.min(0.2, be.flash * 0.24));
          b.restore();
        } else {
          R.drawActor(b, be.spriteName || 'boss', be.x, be.y - 4 - (be.airH || 0), be.scale, be.anim, be.gait,
            be.lean, be.hitSprite || 'boss_hit', Math.min(0.2, be.flash * 0.24));
        }
        R.drawStatus(b, be, run.t);
        /* 点阵里那挺横抱的加特林在 32x36 的格子里糊成一坨，玩家认不出是枪，
           就会觉得"它没拿武器却在射子弹"。这里按瞄准角每帧补画一挺转管机炮，
           枪口位置和 combat.js 的出弹点完全一致。 */
        if (be.def && be.def.bossType === 'gatling') R.drawBossGatling(b, be, p);
        if (be.def && be.def.bossType === 'axeboss') R.drawBossAxes(b, be, p);
        if (be.def && be.def.bossType === 'shrieker') R.drawBossShriek(b, be, p);
        if (be.def && be.def.bossType === 'brood') R.drawBossBrood(b, be, p);
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
        /* 大号弹丸（转管风暴）：光晕 + 亮芯 + 一段曳光。
           小弹丸还是原来的两点方块 —— 这是"进化之后子弹变大了"唯一的视觉出口 */
        if (bu.big) {
          var bax = bu.vx, bay = bu.vy;
          var bal = Math.sqrt(bax * bax + bay * bay) || 1;
          bax /= bal; bay /= bal;
          b.fillStyle = 'rgba(255,170,120,0.16)';
          b.beginPath(); b.arc(bu.x, bu.y, bu.r * 2.6, 0, U.TAU); b.fill();
          b.fillStyle = 'rgba(255,120,60,0.30)';
          b.fillRect(bu.x - bax * bu.r * 3 - bu.r, bu.y - bay * bu.r * 3 - bu.r,
            bu.r * 2, bu.r * 2);
          b.fillStyle = bu.color;
          b.fillRect(bu.x - bu.r, bu.y - bu.r, bu.r * 2, bu.r * 2);
          b.fillStyle = 'rgba(255,255,255,0.85)';
          b.fillRect(bu.x - bu.r * 0.6, bu.y - bu.r * 0.6, bu.r * 1.2, bu.r * 1.2);
          b.fillStyle = '#fff6d0';
          b.fillRect(bu.x - 0.5, bu.y - 0.5, 1, 1);
        } else {
          b.fillStyle = bu.color;
          b.fillRect(bu.x - bu.r, bu.y - bu.r, bu.r * 2, bu.r * 2);
          b.fillStyle = 'rgba(255,255,255,0.55)';
          b.fillRect(bu.x - bu.r * 0.5, bu.y - bu.r * 0.5, bu.r, bu.r);
          /* 回旋刃拖一小段尾迹：一颗小方块光看样子看不出是"飞出去又收回来"，
             有尾巴才读得懂去程和回程（也能看清它撞墙后掉头的那一下） */
          if (bu.boomerang) {
            var rgl = Math.sqrt(bu.vx * bu.vx + bu.vy * bu.vy) || 1;
            var rgtx = bu.x - bu.vx / rgl * 7, rgty = bu.y - bu.vy / rgl * 7;
            b.strokeStyle = 'rgba(233,238,245,0.5)';
            b.lineWidth = 1.4;
            b.beginPath();
            b.moveTo(rgtx, rgty);
            b.lineTo(bu.x, bu.y);
            b.stroke();
          }
        }
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

    /* 持续光束（红莲切割者 / 熔核过载）：一条一直亮着的激光。
       它不走下面 chains 那套 0.12s 闪线 —— 12.5Hz 的闪在画面上就是"还在扣扳机"，
       而这把枪的设定是"一道不断的光"。状态由 updateWeapons 每帧续（p.beamHold）。 */
    R.drawBeamHold(b, run);

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
        if (f.glow) {
          /* 光剑刀光：不是一条细线，而是"扫过去的一片能量"。
             用 sa 反推扫过的比例 —— 刃口从起手位置一路划到收手位置，
             后面拖着填充的余晖，最外层是加色混合的白芯弧。
             和刀剑那条恒定形状的细弧在观感上是两种东西。 */
          var swept = 1 - sa;
          var a0 = f.ang - f.arc / 2;
          var a1 = a0 + f.arc * (0.15 + 0.85 * swept);
          b.save();
          b.globalCompositeOperation = 'lighter';
          /* 余晖：刀刃扫过的一圈月牙（内圈挖空），不是"手电筒锥形"——
             从圆心填到外缘会读成一束光，挖掉内侧才像刃口的残影 */
          b.globalAlpha = sa * 0.20;
          b.fillStyle = f.color;
          b.beginPath();
          b.arc(f.x, f.y, f.r * 0.95, a0, a1);
          b.arc(f.x, f.y, f.r * 0.52, a1, a0, true);
          b.closePath();
          b.fill();
          /* 外缘光带 */
          b.strokeStyle = f.color;
          b.globalAlpha = sa * 0.42;
          b.lineWidth = 5 * sa + 1.5;
          b.beginPath(); b.arc(f.x, f.y, f.r * 0.95, a0, a1); b.stroke();
          /* 白芯：贴着外缘的那条最亮的线 */
          b.strokeStyle = '#ffffff';
          b.globalAlpha = sa * 0.95;
          b.lineWidth = 1.1 + sa * 0.9;
          b.beginPath(); b.arc(f.x, f.y, f.r * 0.95, a0, a1); b.stroke();
          /* 刀尖：扫到哪儿亮到哪儿 */
          b.globalAlpha = sa;
          b.fillStyle = '#ffffff';
          b.fillRect(f.x + Math.cos(a1) * f.r * 0.95 - 1.2,
                     f.y + Math.sin(a1) * f.r * 0.95 - 1.2, 2.4, 2.4);
          b.restore();
          b.globalAlpha = 1;
        } else {
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
        }
      } else if (f.kind === 'punch') {
        /* 拳套冲击环：从贴身向外扩的一圈弧，越远越淡。
           拳头的判定是"身前一整圈全吃"，只画刀光弧会读成挥刀。
           q = 连打层数：层数越高环越亮越粗，读得出"越打越重" */
        var pk = 1 - Math.max(0, f.life / f.max);
        var prr = f.r0 + (f.r1 - f.r0) * pk;
        var pA0 = f.ang - f.arc / 2, pA1 = f.ang + f.arc / 2;
        var pq = Math.min(5, f.q || 0);
        b.save();
        b.globalCompositeOperation = 'lighter';
        b.strokeStyle = f.color;
        b.globalAlpha = (1 - pk) * (0.55 + pq * 0.07);
        b.lineWidth = 2.6 - pk * 1.6 + pq * 0.35;
        b.beginPath(); b.arc(f.x, f.y, prr, pA0, pA1); b.stroke();
        b.globalAlpha = (1 - pk) * 0.24;
        b.lineWidth = 1;
        b.beginPath(); b.arc(f.x, f.y, prr * 0.78, pA0, pA1); b.stroke();
        if (pq >= 3) {
          /* 满连打时多一圈白芯，分量感直接翻倍 */
          b.strokeStyle = '#ffffff';
          b.globalAlpha = (1 - pk) * 0.5;
          b.lineWidth = 1.2;
          b.beginPath(); b.arc(f.x, f.y, prr * 0.92, pA0, pA1); b.stroke();
        }
        b.restore();
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
      /* 燃烧 dot 的跳字用小号暖橙：和直伤的白字、暴击的金字一眼分得开，
         玩家才知道"这只是在烧"，而不是"我打了它一下" */
      b.font = (tx.crit ? 'bold 9px' : (tx.dot ? '6px' : (tx.big ? 'bold 8px' : '7px'))) + ' "Courier New", monospace';
      b.fillStyle = tx.hurt ? '#ff5c5c' : (tx.dot ? '#ffa552' : (tx.crit ? '#ffd166' : '#ffffff'));
      b.fillText(tx.txt, tx.x, tx.y);
      b.globalAlpha = 1;
    }

    b.restore();

    /* 暗角：把视线压到画面中心，夜晚的压迫感主要来自这里 */
    R.drawVignette(b, run);
    /* 隧道：整条走廊压冷、两侧压黑（墙外不该看得清） */
    R.drawTunnelDark(b, run);
    /* 隧道顶灯：压在暗色之上重画，才能一闪一闪地"打穿"黑暗 */
    R.drawTunnelLamps(b, run);
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
    launcher: 'launcher', harpoon: 'launcher',
    bow: 'bow', crossbow: 'bow',
    flamer: 'flamer',
    laser: 'laser', tesla: 'laser', plasma: 'laser', railgun: 'laser',
    saber: 'saber', katana: 'blade', greatsword: 'blade', twinblades: 'blade',
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

  /* ---------------- 持续光束 ---------------- */

  /**
   * 红莲切割者 / 熔核过载的那一道激光。
   *
   * 状态是 `p.beamHold`（`updateWeapons` 每帧续满、没目标就淡出），
   * 所以它是**一直亮着的一条**，而不是每 0.08 秒闪一次的短线：
   * 以前 12.5Hz 的闪烁读起来就是"还在扣扳机"，和"持续灼烧"的设定相反。
   *
   * 画三层：外晕 → 主体 → 白芯，宽度跟判定走（`w` 是半宽，和 chains 同一口径），
   * 再加一点点呼吸，免得粗激光看起来像贴上去的一条色带。
   */
  R.drawBeamHold = function (b, run) {
    var p = run.p, h = p && p.beamHold;
    if (!h || h.life <= 0) return;
    var a = Math.min(1, h.life / (h.max || 0.16));
    /* 枪口在身体中段偏上：和 held 武器的位置对得上 */
    var x0 = p.x, y0 = p.y - 3;
    var x1 = x0 + Math.cos(h.ang) * h.len;
    var y1 = y0 + Math.sin(h.ang) * h.len;
    var lw = Math.max(3, (h.w || 6) * 0.62);
    var puls = 1 + Math.sin(run.t * 26) * 0.05;
    var col = h.color || '#ff3b30';
    /* 湮灭炮的余辉：宽度随着淡出继续往外扩，像冲击波推出去的那一层 */
    if (h.rail) {
      var grow = 1 + (1 - a) * 0.55;
      lw *= grow;
      puls = 1 + Math.sin(run.t * 40) * 0.04;
    }

    b.save();
    b.lineCap = 'round';
    /* 外晕：把"这道光有多粗"读出来 */
    b.strokeStyle = U.rgba(col, 0.13 * a);
    b.lineWidth = lw * 3.4 * puls;
    b.beginPath(); b.moveTo(x0, y0); b.lineTo(x1, y1); b.stroke();
    b.strokeStyle = U.rgba(col, 0.30 * a);
    b.lineWidth = lw * 1.9 * puls;
    b.beginPath(); b.moveTo(x0, y0); b.lineTo(x1, y1); b.stroke();
    /* 主体 */
    b.strokeStyle = U.rgba(col, 0.92 * a);
    b.lineWidth = lw * puls;
    b.beginPath(); b.moveTo(x0, y0); b.lineTo(x1, y1); b.stroke();
    /* 白芯：烧到发白的那条线，比主体细一半；湮灭炮的巨粗光柱芯要更实 */
    b.strokeStyle = 'rgba(255,248,244,' + (0.85 * a).toFixed(2) + ')';
    b.lineWidth = Math.max(1.4, lw * (h.rail ? 0.5 : 0.34));
    b.beginPath(); b.moveTo(x0, y0); b.lineTo(x1, y1); b.stroke();
    /* 湮灭炮：光柱两侧各带一条被"拉出来"的电弧，巨粗但不糊成一块色带 */
    if (h.rail) {
      var off = lw * 1.25;
      var nx = -Math.sin(h.ang) * off, ny = Math.cos(h.ang) * off;
      b.strokeStyle = 'rgba(150,240,255,' + (0.5 * a).toFixed(2) + ')';
      b.lineWidth = 1.6;
      for (var sd = -1; sd <= 1; sd += 2) {
        b.beginPath();
        for (var t2 = 0; t2 <= 10; t2++) {
          var tt = t2 / 10;
          var jitter = (U.hash(t2 * 7 + (sd > 0 ? 3 : 0), Math.round(run.t * 30), 913) - 0.5) * lw * 0.5;
          var px2 = x0 + (x1 - x0) * tt + nx * sd + (x1 - x0) * 0 + jitter * 0.3;
          var py2 = y0 + (y1 - y0) * tt + ny * sd + jitter;
          if (t2 === 0) b.moveTo(px2, py2); else b.lineTo(px2, py2);
        }
        b.stroke();
      }
    }
    /* 枪口汇聚点：一条没有源头的线会像"从屏幕外射进来的" */
    b.fillStyle = U.rgba(col, 0.5 * a);
    b.beginPath(); b.arc(x0, y0, lw * 1.5, 0, U.TAU); b.fill();
    b.fillStyle = 'rgba(255,255,255,' + (0.9 * a).toFixed(2) + ')';
    b.beginPath(); b.arc(x0, y0, Math.max(1.2, lw * 0.45), 0, U.TAU); b.fill();
    b.restore();
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
        /* 区域型以前是"一个圆 + 一圈描边"，四种装置只靠颜色区分，
           而黑洞/火柱/冰霜的颜色又都继承了同一个分组色（绿色）——
           看上去和毒雾完全一样。现在每种装置单独画形状。 */
        var zt = run.t, zr = dv.r;
        var zFade = Math.max(0, Math.min(1, dv.life / 0.6));

        if (dv.gearId === 'blackhole') {
          /* 黑洞：紫黑吸积盘 + 向内收的碎屑 + 纯黑内核（没有任何"雾"的感觉） */
          for (var bg2 = 0; bg2 < 3; bg2++) {
            b.fillStyle = 'rgba(70,38,120,' + ((0.08 + bg2 * 0.035) * zFade).toFixed(3) + ')';
            b.beginPath(); b.arc(dv.x, dv.y, zr * (0.95 - bg2 * 0.19), 0, U.TAU); b.fill();
          }
          b.strokeStyle = 'rgba(206,168,255,' + (0.55 * zFade).toFixed(3) + ')';
          b.lineWidth = 1.5;
          for (var sw = 0; sw < 2; sw++) {
            var swa = zt * 2.6 + sw * 3.14;
            b.beginPath(); b.arc(dv.x, dv.y, zr * 0.56, swa, swa + 1.85); b.stroke();
          }
          for (var sp2 = 0; sp2 < 6; sp2++) {
            var sph = (zt * 0.85 + sp2 / 6) % 1;
            var srad = zr * (1 - sph * 0.75);
            var sang = zt * 3.2 + sp2 * 1.047;
            b.fillStyle = 'rgba(212,182,255,' + (0.55 * sph * zFade).toFixed(3) + ')';
            b.fillRect(Math.round(dv.x + Math.cos(sang) * srad) - 1,
              Math.round(dv.y + Math.sin(sang) * srad) - 1, 2, 2);
          }
          b.fillStyle = 'rgba(4,3,8,' + (0.88 * zFade).toFixed(3) + ')';
          b.beginPath(); b.arc(dv.x, dv.y, zr * 0.3, 0, U.TAU); b.fill();
          b.strokeStyle = 'rgba(232,206,255,' + (0.5 * zFade).toFixed(3) + ')';
          b.lineWidth = 1;
          b.beginPath(); b.arc(dv.x, dv.y, zr * 0.3 + 1.5, 0, U.TAU); b.stroke();
        } else if (dv.gearId === 'poisongas') {
          /* 毒雾：几团滚动的绿雾，边界故意做软（这才是"雾"） */
          for (var pg = 0; pg < 4; pg++) {
            var pga = zt * 0.6 + pg * 1.9;
            var pgr = zr * (0.5 + 0.1 * Math.sin(zt * 1.7 + pg));
            b.fillStyle = 'rgba(126,200,160,' + ((0.09 - pg * 0.012) * zFade).toFixed(3) + ')';
            b.beginPath();
            b.arc(dv.x + Math.cos(pga) * zr * 0.26, dv.y + Math.sin(pga * 1.3) * zr * 0.2,
              pgr, 0, U.TAU);
            b.fill();
          }
        } else if (dv.gearId === 'flamefountain') {
          /* 火柱：暖色三层 + 上窜火星 */
          var fpk = 0.85 + 0.15 * Math.sin(zt * 9);
          b.fillStyle = 'rgba(255,80,20,' + (0.12 * zFade).toFixed(3) + ')';
          b.beginPath(); b.arc(dv.x, dv.y, zr, 0, U.TAU); b.fill();
          b.fillStyle = 'rgba(255,150,50,' + (0.15 * zFade).toFixed(3) + ')';
          b.beginPath(); b.arc(dv.x, dv.y, zr * 0.66 * fpk, 0, U.TAU); b.fill();
          b.fillStyle = 'rgba(255,225,130,' + (0.20 * zFade).toFixed(3) + ')';
          b.beginPath(); b.arc(dv.x, dv.y, zr * 0.3 * fpk, 0, U.TAU); b.fill();
          b.fillStyle = 'rgba(255,200,90,0.9)';
          for (var em = 0; em < 5; em++) {
            var lift = (zt * 26 + em * 13) % (zr * 0.9);
            b.fillRect(Math.round(dv.x - 6 + em * 3 + Math.sin(zt * 6 + em) * 2),
              Math.round(dv.y + zr * 0.3 - lift), 2, 2);
          }
        } else if (dv.gearId === 'frostgen') {
          /* 冰霜：淡蓝底 + 放射冰晶，轮廓是"尖"的 */
          b.fillStyle = 'rgba(140,210,255,' + (0.10 * zFade).toFixed(3) + ')';
          b.beginPath(); b.arc(dv.x, dv.y, zr, 0, U.TAU); b.fill();
          b.strokeStyle = 'rgba(214,242,255,' + (0.45 * zFade).toFixed(3) + ')';
          b.lineWidth = 1;
          for (var fs = 0; fs < 8; fs++) {
            var fsa = fs * 0.785 + zt * 0.25;
            var r0 = zr * 0.72, r1 = zr * (0.92 + 0.06 * Math.sin(zt * 3 + fs));
            b.beginPath();
            b.moveTo(dv.x + Math.cos(fsa) * r0, dv.y + Math.sin(fsa) * r0);
            b.lineTo(dv.x + Math.cos(fsa) * r1, dv.y + Math.sin(fsa) * r1);
            b.stroke();
          }
          b.fillStyle = 'rgba(235,250,255,' + (0.14 * zFade).toFixed(3) + ')';
          b.beginPath(); b.arc(dv.x, dv.y, zr * 0.4, 0, U.TAU); b.fill();
        } else {
          var pulse = 0.8 + 0.2 * Math.sin(run.t * 3 + i);
          b.globalAlpha = 0.10 * pulse;
          b.fillStyle = dv.color || '#8ce99a';
          b.beginPath(); b.arc(dv.x, dv.y, dv.r, 0, U.TAU); b.fill();
          b.globalAlpha = 0.42 * pulse;
          b.strokeStyle = dv.color || '#8ce99a';
          b.lineWidth = 1;
          b.beginPath(); b.arc(dv.x, dv.y, dv.r, 0, U.TAU); b.stroke();
          b.globalAlpha = 1;
        }
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
        /* 部署型以前五种共用一个"方机身 + 一根炮管"，只有喷火口多了个橙点。
           现在按 gearId 分开画：弩机没有炮管、电磁炮台是长轨、火箭炮塔带战斗部。 */
        var gid = dv.gearId;
        var tgt = HS.Game.nearest(dv.x, dv.y, 200);
        var tang = tgt ? Math.atan2(tgt.y - dv.y, tgt.x - dv.x) : (dv.ang || 0);
        b.fillStyle = 'rgba(0,0,0,0.28)';
        b.fillRect(dv.x - 5, dv.y + 2, 10, 2);

        if (gid === 'autocrossbow') {
          b.fillStyle = '#4a515c'; b.fillRect(dv.x - 3, dv.y - 5, 6, 7);
          b.fillStyle = '#8a95a3'; b.fillRect(dv.x - 3, dv.y - 6, 6, 2);
          b.save(); b.translate(dv.x, dv.y - 2); b.rotate(tang);
          b.fillStyle = '#6b7178'; b.fillRect(1, -5, 1, 10);
          b.fillStyle = '#b9c2cb'; b.fillRect(1, -6, 1, 1); b.fillRect(1, 5, 1, 1);
          b.fillStyle = '#39404a'; b.fillRect(0, -0.5, 9, 1);
          b.restore();
        } else if (gid === 'railturret') {
          b.fillStyle = '#3b4450'; b.fillRect(dv.x - 3, dv.y - 6, 6, 8);
          b.fillStyle = '#7ec8ff'; b.fillRect(dv.x - 1, dv.y - 5, 2, 2);
          b.save(); b.translate(dv.x, dv.y - 2); b.rotate(tang);
          b.fillStyle = '#2a3038'; b.fillRect(0, -1.5, 13, 3);
          b.fillStyle = '#6fd6ff'; b.fillRect(9, -0.5, 4, 1);
          b.restore();
        } else if (gid === 'rocketturret') {
          b.fillStyle = '#4d5560'; b.fillRect(dv.x - 5, dv.y - 6, 10, 8);
          b.fillStyle = '#9aa6b4'; b.fillRect(dv.x - 4, dv.y - 6, 8, 2);
          b.save(); b.translate(dv.x, dv.y - 2); b.rotate(tang);
          b.fillStyle = '#39404a'; b.fillRect(0, -2, 9, 4);
          b.fillStyle = '#ffd166'; b.fillRect(9, -1.5, 3, 3);
          b.restore();
        } else if (gid === 'flamenozzle') {
          b.fillStyle = '#5a4a3a'; b.fillRect(dv.x - 5, dv.y - 4, 10, 6);
          b.fillStyle = '#8a6a4a'; b.fillRect(dv.x - 4, dv.y - 4, 8, 1);
          b.save(); b.translate(dv.x, dv.y - 1); b.rotate(tang);
          b.fillStyle = '#39404a'; b.fillRect(0, -1.5, 6, 3);
          b.fillStyle = '#ff8b3d'; b.fillRect(6, -2, 2, 4);
          b.restore();
        } else {
          b.fillStyle = '#4a515c'; b.fillRect(dv.x - 4, dv.y - 5, 8, 7);
          b.fillStyle = '#9aa6b4'; b.fillRect(dv.x - 3, dv.y - 5, 6, 2);
          b.fillStyle = '#2b2f36'; b.fillRect(dv.x - 1, dv.y - 4, 2, 2);
          b.save(); b.translate(dv.x, dv.y - 2); b.rotate(tang);
          b.fillStyle = '#39404a'; b.fillRect(0, -1, 7, 2);
          b.fillStyle = '#828d9c'; b.fillRect(0, -1, 5, 1);
          b.restore();
        }
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

    /* 挂在人身上的自动装备（跟随 / 环绕 / 环带 / 支援）在驾驶时全部收起。
       `Auto.update` 早就不跑了（伤害确实停了），但以前照样画 —— 于是光剑环、
       电球、火环会跟着车跑一圈，看着像还在输出，实际一下都不打。
       已经落地的装置（上面那圈 run.devices：炮塔 / 地雷 / 区域）不受影响：
       它们是真的还在工作，也必须一直看得见。 */
    if (!p.autos || !p.autos.length || p.veh) return;

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
        if (def.id === 'floatinggun') {
          /* 浮游炮：一个小机炮，枪口跟着目标转（原来和无人机画得一模一样） */
          b.fillStyle = '#39404a'; b.fillRect(fx - 3, fy - 2, 6, 4);
          b.fillStyle = '#9fd8f5'; b.fillRect(fx - 2, fy - 2, 4, 1);
          var ft = HS.Game.nearest(fx, fy, 170);
          var fa = ft ? Math.atan2(ft.y - fy, ft.x - fx) : 0;
          b.save(); b.translate(fx, fy); b.rotate(fa);
          b.fillStyle = '#2c333b'; b.fillRect(0, -1, 5, 2);
          b.restore();
        } else if (def.id === 'wingman') {
          /* 导弹僚机：短翼 + 两枚挂弹（黄头），不是四旋翼 */
          b.fillStyle = '#4a4048'; b.fillRect(fx - 4, fy - 2, 8, 4);
          b.fillStyle = 'rgba(255,255,255,0.45)'; b.fillRect(fx - 2, fy - 2, 4, 1);
          b.fillStyle = '#ffd166';
          b.fillRect(fx - 3, fy + 2, 2, 2);
          b.fillRect(fx + 1, fy + 2, 2, 2);
        } else {
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
        }
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
          } else if (def.id === 'saberring') {
            /* 光剑：一条发光刃身，以轨道线为中心往内外各伸一段（判定同款），
               不是一个小方块 —— 以前走到默认分支只画 4x4，难怪看不出"光剑"。
               刃长读 st.blade（1 级 16 / 满级 26） */
            var sl = st.blade || 16;
            var inL = sl * 0.4, outL = sl * 0.6;
            b.fillStyle = 'rgba(140,225,255,0.18)';
            b.fillRect(-inL - 2, -3.5, inL + outL + 4, 7);
            b.fillStyle = '#8ee9ff';
            b.fillRect(-inL, -1.5, inL + outL, 3);
            b.fillStyle = '#ffffff';
            b.fillRect(-inL + 2, -0.5, inL + outL - 4, 1);
            /* 剑柄在"内端" */
            b.fillStyle = '#39485a';
            b.fillRect(-inL - 5, -2, 5, 4);
            b.fillStyle = 'rgba(255,255,255,0.35)';
            b.fillRect(-inL - 4, -1, 3, 1);
          } else if (def.id === 'railorb') {
            /* 电球本体：以前走默认分支只画一个 4x4 方块，玩家根本看不见"球"。
               现在是"光晕 + 核心 + 两圈跳动的电弧"，一圈扫过去能看出是个带电的球 */
            var pulse = 0.5 + 0.5 * Math.sin(run.t * 9 + k);
            b.fillStyle = 'rgba(158,240,255,' + (0.10 + 0.10 * pulse).toFixed(3) + ')';
            b.beginPath(); b.arc(0, 0, 7 + pulse * 1.5, 0, U.TAU); b.fill();
            b.fillStyle = '#5fd8f0';
            b.fillRect(-3, -3, 6, 6);
            b.fillStyle = '#9ef0ff';
            b.fillRect(-2, -2, 4, 4);
            b.fillStyle = '#ffffff';
            b.fillRect(-1, -1, 2, 2);
            /* 两小段电弧挂在球体外缘，随转速跳动（纯像素点，不用渐变） */
            b.fillStyle = 'rgba(200,248,255,' + (0.55 + 0.35 * pulse).toFixed(2) + ')';
            b.fillRect(4, -1, 3, 1);
            b.fillRect(-6, 1, 2, 1);
            b.fillRect(1, -5, 1, 2);
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
        /* 满级光剑环：补一圈淡色轨迹，把六把刃连成"光轮" */
        if (st.full && def.id === 'saberring') {
          b.save();
          b.translate(p.x, p.y);
          b.scale(1, 0.85);
          b.strokeStyle = 'rgba(140,225,255,0.16)';
          b.lineWidth = 1;
          b.beginPath(); b.arc(0, 0, st.radius + (st.blade || 0) * 0.5, 0, U.TAU); b.stroke();
          b.restore();
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
        /* 踩在脚下的环带。火焰环和冰霜环是同一个 kind，靠 def.color 分家：
           火是橙、环上窜火星；冰是冷蓝、环上钉冰晶 + 一圈贴地的霜气。
           以前两者共用一组颜色（连图标都映射到同一个不存在的 'ring'），
           在场上根本认不出哪个是冰。
           **两环半径只差 4px、会同时挂在身上**，所以光换色相不够：
           环上"长什么"必须一眼不同 —— 火星是往上窜的橙点，冰晶是钉死在
           环上、静止反光的白十字。 */
        var rr = st.radius * p.areaMul;
        var ph = Math.sin(run.t * 4 + i) * 2;
        var isIce = !!(def.tags && def.tags.indexOf('ice') >= 0);
        var rc = def.color || '#ff8b3d';
        var rk, ka, kx, ky, fa, lift;
        b.fillStyle = U.rgba(rc, isIce ? 0.13 : 0.07);
        b.beginPath();
        b.arc(p.x, p.y, rr, 0, U.TAU);
        b.fill();
        /* 霜气：贴着地面的一圈粗而极淡的冷光，像冷气沉在脚边。
           火焰不加这一层 —— 火是往上走的，冰才往四周铺。 */
        if (isIce) {
          b.strokeStyle = 'rgba(205,238,255,0.10)';
          b.lineWidth = 7;
          b.beginPath();
          b.arc(p.x, p.y, rr + 1, 0, U.TAU);
          b.stroke();
        }
        b.strokeStyle = U.rgba(rc, isIce ? 0.80 : 0.42);
        b.lineWidth = isIce ? 2.6 : 2 + Math.sin(run.t * 3) * 1;
        b.beginPath();
        b.arc(p.x, p.y, rr + ph * 0.2, 0, U.TAU);
        b.stroke();
        b.strokeStyle = U.rgba(rc, isIce ? 0.34 : 0.16);
        b.lineWidth = 1;
        b.beginPath();
        b.arc(p.x, p.y, rr - 3.5, 0, U.TAU);
        b.stroke();
        if (isIce) {
          /* 冰晶：八颗白十字钉在环上缓慢绕行，中心一格高光。
             原来是 2px 的十字 —— 等距看只是几个白点，读不出"冰"。 */
          for (rk = 0; rk < 8; rk++) {
            ka = run.t * 0.45 + rk * (U.TAU / 8);
            kx = Math.round(p.x + Math.cos(ka) * rr);
            ky = Math.round(p.y + Math.sin(ka) * rr);
            b.fillStyle = 'rgba(150,215,255,0.62)';
            b.fillRect(kx - 2, ky, 5, 1);
            b.fillRect(kx, ky - 2, 1, 5);
            b.fillStyle = 'rgba(214,242,255,0.92)';
            b.fillRect(kx - 1, ky - 1, 3, 3);
            b.fillStyle = 'rgba(255,255,255,0.95)';
            b.fillRect(kx, ky, 1, 1);
          }
        } else {
          /* 火星：沿着环往上窜，窜得越高越暗 */
          for (rk = 0; rk < 8; rk++) {
            fa = run.t * 1.1 + rk * (U.TAU / 8);
            lift = (run.t * 9 + rk * 5) % 7;
            b.fillStyle = 'rgba(255,' + Math.round(200 - lift * 12) + ',90,' +
              (0.78 - lift * 0.08).toFixed(2) + ')';
            b.fillRect(Math.round(p.x + Math.cos(fa) * rr),
              Math.round(p.y + Math.sin(fa) * rr - lift), 2, 2);
          }
        }
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
  /**
   * 尖啸者：超声的扇形预警 + 喉咙口的收束光环。
   *
   * 超声是这张图唯一夺走操作权的招式，所以它必须"看得见"：
   * 蓄力 0.85 秒里，地面上会有一片 ±30° 的冷蓝扇区，
   * 边界线随蓄力收紧 —— 玩家读的是"我是不是站在这片扇区里"。
   */
  R.drawBossShriek = function (b, e, p) {
    var a = e.hAng === undefined ? Math.atan2(p.y - e.y, p.x - e.x) : e.hAng;
    var i, t = R._t || 0;
    if (e.hSt === 1) {
      /* 短啸蓄声：**全向**了，就别再画扇形 —— 扇形会让玩家以为"绕背后有用"。
         改成三圈往里收的声压环：收完就炸开，方向不重要，距离才重要。 */
      var k = 1 - Math.min(1, Math.max(0, e.hT / 0.55));
      for (i = 0; i < 3; i++) {
        var r1 = 26 + i * 10 - k * 18;
        if (r1 < 4) r1 = 4;
        b.strokeStyle = 'rgba(178,236,255,' + (0.10 + 0.30 * k * (1 - i * 0.22)).toFixed(3) + ')';
        b.lineWidth = 1.2;
        b.beginPath();
        b.arc(e.x, e.y - 4, r1, 0, U.TAU);
        b.stroke();
      }
      /* 射程提示：一圈很淡的外环，告诉玩家"这个距离以内都会吃" */
      b.strokeStyle = 'rgba(150,220,250,' + (0.05 + 0.10 * k).toFixed(3) + ')';
      b.lineWidth = 1;
      b.beginPath();
      b.arc(e.x, e.y - 4, 250, 0, U.TAU);
      b.stroke();
      /* 喉咙口：三圈往回收的光 */
      for (i = 0; i < 3; i++) {
        var rr = (e.r + 3) + (1 - k) * 11 + i * 4;
        b.strokeStyle = 'rgba(200,240,255,' + (0.45 * k * (1 - i * 0.25)).toFixed(3) + ')';
        b.lineWidth = 1;
        b.beginPath();
        b.arc(e.x + Math.cos(a) * 3, e.y - 7 + Math.sin(a) * 3, rr, 0, U.TAU);
        b.stroke();
      }
    } else if (e.hSt === 3) {
      /* 骨爪：一道收得很紧的白弧，和超声的冷蓝区分开 */
      var ck2 = 1 - Math.max(0, e.hT) / 0.34;
      b.strokeStyle = 'rgba(230,240,255,' + (0.30 + 0.4 * ck2).toFixed(3) + ')';
      b.lineWidth = 2;
      b.beginPath();
      b.arc(e.x, e.y - 2, 40 + ck2 * 20, a - 0.9, a + 0.9);
      b.stroke();
    } else if (e.hSt === 5) {
      /* 长啸：起手是"吸气"（环往里收），持续段是一串往外推的声压环。
         持续段每 0.32s 一拍，画面上的环也是每拍推一次 —— 玩家能数着拍子找车躲 */
      var wind = e.hT > 0;
      if (wind) {
        var wk = 1 - Math.max(0, e.hT) / 0.5;
        for (i = 0; i < 4; i++) {
          var wr = 96 - i * 16 - wk * 26;
          if (wr < 6) wr = 6;
          b.strokeStyle = 'rgba(190,240,255,' + (0.08 + 0.22 * wk).toFixed(3) + ')';
          b.lineWidth = 1.4;
          b.beginPath();
          b.arc(e.x, e.y - 4, wr, 0, U.TAU);
          b.stroke();
        }
      } else {
        for (i = 0; i < 3; i++) {
          var phase = ((t * 2.4 + i * 0.33) % 1);
          var cr = 16 + phase * 210;
          b.strokeStyle = 'rgba(186,238,255,' + (0.30 * (1 - phase)).toFixed(3) + ')';
          b.lineWidth = 1.6;
          b.beginPath();
          b.arc(e.x, e.y - 4, cr, 0, U.TAU);
          b.stroke();
        }
        /* 一圈贴身的强光：这是"我正在喊"的状态灯 */
        b.save();
        b.globalCompositeOperation = 'lighter';
        b.fillStyle = 'rgba(150,226,255,0.10)';
        b.beginPath();
        b.ellipse(e.x, e.y - 4, e.r * 2.2, e.r * 1.8, 0, 0, U.TAU);
        b.fill();
        b.restore();
      }
    }
    /* 蓄声 / 长啸时喉咙里那一点冷光 */
    if (e.hSt === 1 || e.hSt === 2 || e.hSt === 5) {
      b.fillStyle = 'rgba(143,232,255,0.55)';
      b.fillRect(Math.round(e.x - 2), Math.round(e.y - e.r * 1.45), 4, 3);
    }
  };

  /**
   * 育母：育囊的呼吸光 + 产崽前的搏动 + 囊撞的落点预警。
   * 它的"动作"全在肚子上，所以这三样都画在那颗肚子上。
   */
  R.drawBossBrood = function (b, e, p) {
    var t = R._t || 0;
    var wind = e.bSt === 1;
    var k = wind ? 1 - Math.max(0, e.bT) / 0.9 : 0;
    var pulse = 0.5 + 0.5 * Math.sin(t * (wind ? 13 : 3.4) + (e.seed || 0));
    var cy2 = e.y + e.r * 0.06;
    var rr = e.r * (0.62 + 0.10 * pulse + (wind ? 0.20 * k : 0));

    b.save();
    b.globalCompositeOperation = 'lighter';
    b.fillStyle = 'rgba(163,214,110,' + (0.05 + 0.05 * pulse).toFixed(3) + ')';
    b.beginPath(); b.ellipse(e.x, cy2, rr * 1.5, rr * 1.15, 0, 0, U.TAU); b.fill();
    b.fillStyle = 'rgba(227,214,126,' + (0.09 + 0.09 * pulse + (wind ? 0.10 * k : 0)).toFixed(3) + ')';
    b.beginPath(); b.ellipse(e.x, cy2, rr, rr * 0.72, 0, 0, U.TAU); b.fill();
    b.restore();

    /* 产崽瞬间：肚子上裂开的那道缝亮一下（就是"它们从这儿出来"） */
    if (wind) {
      b.strokeStyle = 'rgba(246,242,190,' + (0.25 + 0.5 * k).toFixed(3) + ')';
      b.lineWidth = 1;
      b.beginPath();
      b.moveTo(e.x, cy2 - rr * 0.8);
      b.lineTo(e.x + Math.sin(k * 9) * 2, cy2 + rr * 0.85);
      b.stroke();
    }
    /* 囊撞：脚下那片扇区 */
    if (e.bSt === 3) {
      var sk3 = 1 - Math.max(0, e.bT) / 0.45;
      var ba3 = e.bAng === undefined ? Math.atan2(p.y - e.y, p.x - e.x) : e.bAng;
      b.fillStyle = 'rgba(227,214,126,' + (0.07 + 0.12 * sk3).toFixed(3) + ')';
      b.beginPath();
      b.moveTo(e.x, e.y + 2);
      b.arc(e.x, e.y + 2, 62, ba3 - 1.05, ba3 + 1.05);
      b.closePath();
      b.fill();
      b.strokeStyle = 'rgba(240,232,170,' + (0.30 + 0.4 * sk3).toFixed(3) + ')';
      b.lineWidth = 1;
      b.beginPath(); b.arc(e.x, e.y + 2, 60, ba3 - 1.05, ba3 + 1.05); b.stroke();
    }
    /* 抓投：先是一只"手"往身边的弹药伸过去，再顺着投掷方向甩出去。
       两段各画一道弧 —— 动作本身要看得出来，否则玩家只觉得"天上掉下来一只" */
    if (e.bSt === 5 || e.bSt === 6) {
      var ta = e.bAng === undefined ? Math.atan2(p.y - e.y, p.x - e.x) : e.bAng;
      var tk = e.bSt === 5 ? 1 - Math.max(0, e.bT) / 0.5 : 1;
      var vx2 = e.bVictim && !e.bVictim.dead ? e.bVictim.x : e.x;
      var vy2 = e.bVictim && !e.bVictim.dead ? e.bVictim.y : e.y;
      b.strokeStyle = 'rgba(214,196,140,' + (0.30 + 0.35 * tk).toFixed(3) + ')';
      b.lineWidth = 2;
      b.beginPath();
      if (e.bSt === 5) {
        /* 抓：从育母往弹药伸的一条弧 */
        b.moveTo(e.x, e.y + 2);
        b.quadraticCurveTo((e.x + vx2) / 2, (e.y + vy2) / 2 - 14, vx2, vy2);
      } else {
        /* 甩：朝投掷方向的一段上扬弧线 */
        b.moveTo(e.x, e.y + 2);
        b.quadraticCurveTo(e.x + Math.cos(ta) * 26, e.y + Math.sin(ta) * 26 - 22,
          e.x + Math.cos(ta) * 46, e.y + Math.sin(ta) * 46 - 6);
      }
      b.stroke();
    }
  };

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

  /**
   * 断堤巨斧：两只消防斧按战斗状态换姿态。
   * 预警必须画在角色脚下而不是压在身上，玩家看的是“哪里会挨打”。
   */
  R.drawBossAxes = function (b, e, p) {
    var a = e.aAim === undefined ? Math.atan2(p.y - e.y, p.x - e.x) : e.aAim;
    var wind = e.aSt === 1;
    var leapWind = e.aSt === 2;
    var air = e.aSt === 3;
    var swing = e.aSt === 5;

    /* 起手 / 收势的进度（0→1），斧头姿态全靠它插值 */
    var windK = wind ? 1 - Math.max(0, e.aT) / 0.68 : 0;
    var swingK = swing ? 1 - Math.max(0, e.aT) / 0.26 : 0;

    if (wind || swing) {
      /* 扇形预警：蓄力时慢慢收紧，砍出去那一下铺满整个扫过的范围再淡出 */
      var fillA = wind ? 0.10 + 0.10 * windK : 0.20 * (1 - swingK);
      b.fillStyle = 'rgba(255,102,64,' + fillA.toFixed(3) + ')';
      b.beginPath(); b.moveTo(e.x, e.y); b.arc(e.x, e.y, 118, a - 1.0, a + 1.0); b.closePath(); b.fill();
      b.strokeStyle = 'rgba(255,139,90,' + (wind ? 0.60 : 0.75 * (1 - swingK)).toFixed(3) + ')';
      b.lineWidth = 1;
      b.beginPath(); b.arc(e.x, e.y, 112, a - 0.94, a + 0.94); b.stroke();
    }
    /* 挥砍拖尾：斧刃扫过留下的两道残影 */
    if (swing) {
      for (var tr = 0; tr < 2; tr++) {
        var kk = Math.max(0, swingK - tr * 0.18);
        var ang0 = a - 0.95 + kk * 1.9;
        b.strokeStyle = 'rgba(255,214,170,' + ((0.55 - tr * 0.2) * (1 - swingK)).toFixed(3) + ')';
        b.lineWidth = 2.4 - tr * 0.8;
        b.beginPath();
        b.arc(e.x, e.y - 4, 56 + tr * 9, ang0 - 0.34, ang0 + 0.06);
        b.stroke();
      }
    }
    if (leapWind || air) {
      var tx = e.aTx === undefined ? p.x : e.aTx, ty = e.aTy === undefined ? p.y : e.aTy;
      var lr = e.axeRage ? 76 : 62;
      b.fillStyle = 'rgba(255,110,60,0.09)';
      b.beginPath(); b.arc(tx, ty, lr, 0, U.TAU); b.fill();
      b.strokeStyle = air ? 'rgba(255,220,160,0.85)' : 'rgba(255,120,70,0.72)';
      b.lineWidth = 2; b.setLineDash([5, 4]);
      b.beginPath(); b.arc(tx, ty, lr, 0, U.TAU); b.stroke(); b.setLineDash([]);
    }

    /* 斧头姿态：蓄力越张越开（拉弓），挥出时收拢着扫过去，落地贴地 */
    var open = leapWind ? -0.55 : (air ? 0.1 : 0.32);
    if (wind) open = 0.32 + 0.50 * windK;
    if (swing) open = 0.86 - 0.66 * swingK;
    if (e.aSt === 4) open = 0.12;
    var reach = 0;
    if (wind) reach = -4 * windK;
    else if (swing) reach = Math.sin(Math.min(1, swingK) * Math.PI) * 9;

    b.save();
    b.translate(snap(e.x + Math.cos(a) * reach), snap(e.y - 5 - (e.airH || 0) + Math.sin(a) * reach));
    b.rotate(a);
    if (Math.cos(a) < 0) b.scale(1, -1);
    for (var side = -1; side <= 1; side += 2) {
      b.save();
      b.rotate(side * open);
      /* 斧柄：比身体还高，一眼能认出是双手巨斧 */
      b.fillStyle = '#4b3925'; b.fillRect(-2, side * 9 - 1, 23, 3);
      b.fillStyle = '#8a6538'; b.fillRect(1, side * 9 - 1, 17, 1);
      b.fillStyle = '#2d2115'; b.fillRect(18, side * 9 - 2, 4, 5);
      /* 双刃斧头：上半刃亮、下半刃锈 */
      b.fillStyle = (wind || swing) ? '#ffd0a3' : '#aeb8ad';
      b.beginPath();
      b.moveTo(15, side * 9 - 2);
      b.lineTo(25, side * 9 - 12);
      b.lineTo(29, side * 9 - 3);
      b.lineTo(22, side * 9 + 1);
      b.closePath(); b.fill();
      b.fillStyle = (wind || swing) ? '#e89b66' : '#7d4d32';
      b.beginPath();
      b.moveTo(15, side * 9 + 1);
      b.lineTo(23, side * 9 + 3);
      b.lineTo(27, side * 9 + 12);
      b.lineTo(17, side * 9 + 5);
      b.closePath(); b.fill();
      b.fillStyle = 'rgba(255,255,255,0.55)';
      b.fillRect(20, side * 9 - 9, 6, 1);
      b.fillRect(24, side * 9 + 4, 4, 1);
      b.restore();
    }
    b.restore();

    if (air) {
      b.fillStyle = 'rgba(0,0,0,0.28)';
      b.beginPath(); b.ellipse ? b.ellipse(e.x, e.y + 3, 15, 5, 0, 0, U.TAU) : b.arc(e.x, e.y + 3, 12, 0, U.TAU);
      b.fill();
    }
  };

  R.drawGun = function (b, p, a) {
    var def = heldDef(p);
    if (!def) return;
    var kind = ART_KIND[def.art] || 'rifle';
    if (kind === 'none') return;

    var rec = p.recoil || 0;
    var sway = Math.sin(p.anim) * 0.5 * (p.gait || 0);
    var ca = Math.cos(a), sa = Math.sin(a);
    /* 手的位置跟朝向走：侧身时枪在面朝那一侧的手上，正面/背面看瞄准方向 */
    var fdir = faceOf(p);
    var anc = GUN_ANCHOR[fdir] || GUN_ANCHOR.dn;
    var side = (fdir === 'lf' || fdir === 'rt') ? anc.side : (ca >= 0 ? 1 : -1) * anc.side;
    var hx = p.x + side + ca * (1.8 - rec * 1.4) - sa * sway;
    var hy = p.y + anc.y + sa * (1.6 - rec * 1.2) + ca * sway;

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
      /* 喷火和液氮共用同一套 art，靠 elem 换配色：火焰是军绿 + 深色油罐，
         液氮是冷蓝灰 + 浅蓝冷媒罐 —— 手上这把是什么，不看喷出来的颜色也知道 */
      len = 8;
      var fmIce = def.elem === 'ice';
      b.fillStyle = fmIce ? '#39434e' : '#4a4a3a'; b.fillRect(0, -1, 8, 3);
      b.fillStyle = fmIce ? '#8fb6cc' : '#7d7d5e'; b.fillRect(1, -1, 6, 1);
      b.fillStyle = fmIce ? '#9ad0ff' : '#2a2a20'; b.fillRect(4, 2, 4, 2);
      b.fillStyle = fmIce ? '#e8f7ff' : '#ffb045'; b.fillRect(7, -1, 1, 2);
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
    } else if (kind === 'saber') {
      /* 光剑：握把 + 一段"发光的能量刃"，不能和刀剑一样画成一根细金属条。
         刃身分三层：外晕（lighter 叠加）/ 本体 / 纯白内芯，再叠一点呼吸脉动，
         远看是一道光，近看能分辨剑柄和刃口 —— 和武士刀的实心灰刃完全不同。
         刃长跟基础射程挂钩：巨型光剑比光剑长一截，握在手上就能看出来。 */
      var sabLn = 9 + (def.base.range || 36) * 0.09;
      var pulse = 0.86 + 0.14 * Math.sin((p.anim || 0) * 7.5);
      len = sabLn;
      b.fillStyle = '#20252b'; b.fillRect(-3, 0.5, 5, 3);          // 握把
      b.fillStyle = '#9aa6b4'; b.fillRect(-1, -1.4, 2, 4.4);       // 发射口
      b.fillStyle = def.color; b.fillRect(-2.5, 2.5, 4, 1);        // 握把上的按钮
      b.save();
      b.globalCompositeOperation = 'lighter';
      b.globalAlpha = 0.34 * pulse;
      b.fillStyle = def.color; b.fillRect(0.5, -4.2, sabLn, 8.4);   // 外晕
      b.globalAlpha = 0.72 * pulse;
      b.fillRect(0.6, -1.9, sabLn - 0.2, 3.8);                      // 刃身
      b.globalAlpha = 0.9;
      b.fillStyle = '#ffffff';
      b.fillRect(1.4, -0.5, sabLn - 1.2, 1.0);                      // 白芯（细，才透得出青色）
      b.globalAlpha = 1;
      b.globalCompositeOperation = 'source-over';
      b.restore();
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

    /* 枪口特效。枪械是"两点黄火花 + 一小块白光"，喷火 / 液氮不能沿用这一套 ——
       拿着一根喷管却和步枪一样闪两下黄火花，读起来就是"在开枪"。 */
    if (kind === 'flamer') {
      /* 喷火器 / 液氮喷枪：从喷嘴泼出去一小股，颜色和地面光锥同源
         （fire 橙黄 / ice 冰蓝），长度随 coneT 呼吸 —— 停火即收，不会留着亮。
         尺寸只到几像素，大面积留给 R.drawFlameCone，两层才不会互相盖糊。 */
      if (p.coneT > 0.02) {
        var jice = def.elem === 'ice';
        var jk = Math.min(1, p.coneT / 0.2);
        var jl = 4 + 6 * jk + Math.sin((p.anim || 0) * 26) * 1.2;
        var jc0 = jice ? '#eafaff' : '#fff6cd';
        var jc1 = jice ? '#9fdcf7' : '#ffc255';
        var jc2 = jice ? '#5fa8dd' : '#ff6a2a';
        b.save();
        b.globalCompositeOperation = 'lighter';
        b.fillStyle = jc0;
        b.globalAlpha = 0.85 * jk;
        b.fillRect(len - 0.5, -1.1, 2.4, 2.2);
        b.fillStyle = jc1;
        b.globalAlpha = 0.5 * jk;
        b.beginPath();
        b.moveTo(len, -1.6); b.lineTo(len + jl, -3.4 * jk);
        b.lineTo(len + jl, 3.4 * jk); b.lineTo(len, 1.6);
        b.closePath(); b.fill();
        b.fillStyle = jc2;
        b.globalAlpha = 0.3 * jk;
        b.beginPath();
        b.moveTo(len + 1, -1.2); b.lineTo(len + jl * 1.7, -1.9 * jk);
        b.lineTo(len + jl * 1.7, 1.9 * jk); b.lineTo(len + 1, 1.2);
        b.closePath(); b.fill();
        b.restore();
        b.globalAlpha = 1;
      }
    } else if (p.fireT > 0 && kind !== 'blade' && kind !== 'saber' && kind !== 'knife' &&
        kind !== 'axe' && kind !== 'spear' && kind !== 'saw' && kind !== 'fist' &&
        kind !== 'drill' && kind !== 'shield' && kind !== 'whip' && kind !== 'baton') {
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

  /**
   * 元素状态着色：燃烧 = 橙红光 + 三颗上窜火星；冻结 = 冰蓝底 + 白边 + 冰晶。
   * 以前减速只是 0.16 的半透明方块，几乎看不出来 —— 状态必须一眼可辨，
   * 否则玩家根本不知道自己在烧谁、谁被冻住了。
   */
  R.drawStatus = function (b, e, t) {
    var r = e.r;
    if (e.burn > 0) {
      var pl = 0.5 + 0.5 * Math.sin(t * 17 + e.seed);
      b.fillStyle = 'rgba(255,120,40,' + (0.14 + 0.12 * pl).toFixed(3) + ')';
      b.fillRect(e.x - r, e.y - r, r * 2, r * 2);
      b.strokeStyle = 'rgba(255,150,70,' + (0.45 + 0.25 * pl).toFixed(3) + ')';
      b.lineWidth = 1;
      b.strokeRect(Math.round(e.x - r) + 0.5, Math.round(e.y - r) + 0.5,
        Math.round(r * 2) - 1, Math.round(r * 2) - 1);
      b.fillStyle = 'rgba(255,214,130,0.95)';
      for (var i = 0; i < 3; i++) {
        var lift = (t * 20 + i * 6 + e.seed) % 12;
        b.fillRect(
          Math.round(e.x - r * 0.7 + i * r * 0.7 + Math.sin(t * 9 + e.seed + i * 2) * 1.6),
          Math.round(e.y - r - 1 - lift * 0.55),
          2, 2
        );
      }
    }
    if (e.slow > 0.05 || e.synFrozen) {
      var sk = Math.min(1, (e.slow || 0) + (e.synFrozen ? 0.25 : 0));
      b.fillStyle = 'rgba(120,200,255,' + (0.10 + 0.14 * sk).toFixed(3) + ')';
      b.fillRect(e.x - r, e.y - r, r * 2, r * 2);
      b.strokeStyle = 'rgba(205,240,255,' + (0.30 + 0.35 * sk).toFixed(3) + ')';
      b.lineWidth = 1;
      b.strokeRect(Math.round(e.x - r) + 0.5, Math.round(e.y - r) + 0.5,
        Math.round(r * 2) - 1, Math.round(r * 2) - 1);
      b.fillStyle = 'rgba(235,250,255,0.9)';
      b.fillRect(Math.round(e.x - r * 0.7), Math.round(e.y + r * 0.55), 2, 2);
      b.fillRect(Math.round(e.x + r * 0.5), Math.round(e.y + r * 0.35), 2, 2);
    }
  };

  /**
   * 喷火 / 冷冻射流的地面光锥：三层半透明扇形叠出"从枪口泼出去"的形状。
   * 光靠粒子在夜色街道上太淡（3~9 颗/帧看不出来），这层是让特效"存在"的关键。
   * 参数由 Gear.flame 每帧写进 p.flameArc / p.flameRange / p.flameElem。
   */
  R.drawFlameCone = function (b, p, run) {
    if (!(p.coneT > 0.01) || !p.flameArc) return;
    var a = p.aimA || 0;
    var arc = p.flameArc, range = p.flameRange || 90;
    var k = Math.min(1, p.coneT / 0.16);
    var ice = p.flameElem === 'ice';
    var cr = ice ? 150 : 255, cg = ice ? 216 : 150, cb = ice ? 246 : 60;
    var jit = Math.sin(run.t * 38) * 0.02;
    /* 叠加混合：暗沥青上加色比盖透明更能"亮起来"。用完必须还原，否则后面全亮 */
    b.save();
    b.globalCompositeOperation = 'lighter';
    for (var layer = 0; layer < 3; layer++) {
      var rr = range * (0.42 + layer * 0.29);
      var al = (ice ? 0.10 : 0.12) * k * (1 - layer * 0.18);
      b.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + al.toFixed(3) + ')';
      b.beginPath();
      b.moveTo(p.x, p.y - 3);
      b.arc(p.x, p.y - 3, rr, a - arc + jit, a + arc + jit);
      b.closePath();
      b.fill();
    }
    b.restore();
  };

  /**
   * 流血标记：挂在目标身上的暗色血点，层数越多点越多。
   *
   * 光靠"溅出去的血珠"读不出"这只还在流血"—— 血珠 0.3 秒就没了，
   * 而流血要持续 3 秒。这个标记是**状态**，溅血是**事件**，两者都要有。
   * 位置用 uid + 时间量化算，不会每帧乱跳（乱跳会像噪点），但会慢慢往下淌。
   * 颜色走灰黑（见 combat.js 的 Game.bleed），不带红。
   */
  R.drawBleedMark = function (b, e, run) {
    if (!(e.bleed > 0)) return;
    var st = Math.min(4, e.bleedStacks || 1);
    var step = ((run.t * 5 + e.uid * 0.37) | 0) % 3;
    for (var i = 0; i < st; i++) {
      var k = (e.uid * 13 + i * 37 + step * 5) % 11;
      var ox = ((k % 5) - 2) * (e.r * 0.34);
      var oy = -e.r * 0.35 + (k % 4) * (e.r * 0.38) + step * 0.6;
      b.fillStyle = i === 0 ? '#8a9099' : '#33343a';
      b.fillRect(Math.round(e.x + ox), Math.round(e.y + oy), 1, i === 0 ? 2 : 1);
    }
  };

  /**
   * 裂口标记（机械钻头）：身上两三道发白的钻痕，层数越多划痕越多。
   * 和出血点是两套东西：出血是暗色渗血，裂口是亮色机械创口，一眼能分开。
   */
  R.drawRiftMark = function (b, e, run) {
    if (!(e.rift > 0)) return;
    var n = Math.min(3, e.rift);
    var jit = Math.sin(run.t * 9 + e.uid) * 0.6;
    b.strokeStyle = 'rgba(226,236,245,0.7)';
    b.lineWidth = 1;
    for (var i = 0; i < n; i++) {
      var ox = (i - (n - 1) / 2) * 2.2;
      var oy = -e.r * 0.2 + i * 1.8 + jit;
      b.beginPath();
      b.moveTo(e.x + ox - 1.5, e.y + oy - 2);
      b.lineTo(e.x + ox + 1.5, e.y + oy + 2);
      b.stroke();
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

    /* ---- 水鬼出水保护 ----
       浮出水面后 0.35 秒打不中（combat.js 的 emergeGuard）。这一拍**必须画出来**：
       否则玩家只会觉得"我这几枪丢了"，而不是"它现在打不到"。
       画在精灵下面，所以读起来是一层裹住身体的水膜，而不是一圈飘在远处的光环。 */
    if (e.emergeGuard > 0) {
      var gw = Math.min(1, e.emergeGuard / (e.def.emergeGuard || 0.35));
      var gr = e.r * (1.55 + 0.45 * (1 - gw));
      b.fillStyle = 'rgba(118,212,202,' + (0.34 * gw).toFixed(2) + ')';
      b.beginPath();
      b.ellipse(e.x, e.y - 2, gr, gr * 1.12, 0, 0, U.TAU);
      b.fill();
      b.strokeStyle = 'rgba(196,246,238,' + (0.82 * gw).toFixed(2) + ')';
      b.lineWidth = 1.6;
      b.beginPath();
      b.ellipse(e.x, e.y - 2, gr, gr * 1.12, 0, 0, U.TAU);
      b.stroke();
      /* 外面再套一圈更淡的扩散波：单圈在深绿水面上对比度太低，
         加一层才像"刚从水里顶出来"，而不是一颗发光球 */
      b.strokeStyle = 'rgba(150,228,216,' + (0.36 * gw).toFixed(2) + ')';
      b.lineWidth = 1;
      b.beginPath();
      b.ellipse(e.x, e.y - 2, gr + 3.5, (gr + 3.5) * 1.12, 0, 0, U.TAU);
      b.stroke();
    }

    /* ---- 攻击动作细节 ----
       扑袭者蓄力：下蹲 3px + 脚下红圈随进度收紧（起跳前最亮）。
       呕酸尸蓄力：酸囊充气膨胀 + 脚下画出毒液即将覆盖的矩形预警框，
       框跟着蓄力方向转 —— 玩家看得见"要泼到哪"，躲得有依据。 */
    /* ---- 水鬼潜渡 ----
       水下：整个人消失，只剩外扩的涟漪和一道水痕。涟漪不是装饰，
       是这张图唯一能读到"它从哪边来"的信息。 */
    if (e.submerged) {
      var rp = (e.anim * 22) % 9;
      var sa = e.subAng || 0;
      var kx = Math.cos(sa), ky = Math.sin(sa);
      b.save();
      b.translate(e.x, e.y + 2);
      b.scale(1, 0.42);
      /* 两圈干净的外扩水纹。不要再加深色实心块 —— 那会读成"一张脸浮在水上" */
      b.strokeStyle = 'rgba(150,226,210,' + (0.78 - rp * 0.05).toFixed(2) + ')';
      b.lineWidth = 1.3;
      b.beginPath(); b.arc(0, 0, e.r * 1.15 + rp, 0, U.TAU); b.stroke();
      b.strokeStyle = 'rgba(104,184,170,0.36)';
      b.lineWidth = 1;
      b.beginPath(); b.arc(0, 0, e.r * 0.48 + rp * 0.45, 0, U.TAU); b.stroke();
      b.restore();
      /* 身后两道分开的水痕：像船尾的 V 形浪，一眼看出它在往哪游 */
      b.strokeStyle = 'rgba(186,232,220,0.32)';
      b.lineWidth = 1.6;
      for (var ww = -1; ww <= 1; ww += 2) {
        b.beginPath();
        b.moveTo(e.x - kx * 4 - ky * ww * 3, e.y + 2 - ky * 4 * 0.42 + kx * ww * 3 * 0.42);
        b.lineTo(e.x - kx * 17 - ky * ww * 7, e.y + 2 - ky * 17 * 0.42 + kx * ww * 7 * 0.42);
        b.stroke();
      }
      return;
    }
    /* 下潜预警（0.45s）：身体被水面一点点吞掉，这半秒还是活靶子 */
    if (e.def.submerge && e.subState === 1) {
      var dw2 = 1 - Math.max(0, e.subT / 0.45);
      b.save();
      b.translate(e.x, e.y);
      b.scale(1 + dw2 * 0.12, 1 - dw2 * 0.34);
      b.translate(-e.x, -e.y);
      R.drawActor(b, e.spriteName, e.x, e.y, e.scale, e.anim, 0.2,
        0, e.hitSprite, Math.min(0.45, e.flash * 0.65));
      b.restore();
      b.strokeStyle = 'rgba(150,214,200,' + (0.28 + 0.5 * dw2).toFixed(2) + ')';
      b.lineWidth = 1.3;
      b.beginPath(); b.arc(e.x, e.y + 3, e.r + 5 - 3 * dw2, 0, U.TAU); b.stroke();
      if (e.elite) {
        var bw5 = 18, by5 = e.y - e.r * 2.2 - 6;
        b.fillStyle = 'rgba(0,0,0,0.6)';
        b.fillRect(e.x - bw5 / 2 - 1, by5 - 1, bw5 + 2, 5);
        b.fillStyle = '#ffb86b';
        b.fillRect(e.x - bw5 / 2, by5, bw5 * Math.max(0, e.hp / e.maxHp), 3);
      }
      return;
    }

    /* 被育母扔出去的自爆尸：地上留一道影子，身体按抛物线抬起来、翻滚 */
    if (e.hurlT > 0) {
      var hh = e.hurlH || 0;
      b.fillStyle = 'rgba(0,0,0,0.32)';
      b.beginPath();
      b.ellipse(e.x, e.y + 3, e.r * 1.05, e.r * 0.42, 0, 0, U.TAU);
      b.fill();
      b.save();
      b.translate(e.x, e.y - hh);
      b.rotate((e.hurlSpin || 0) % U.TAU);
      R.drawActor(b, e.spriteName, 0, 0, e.scale, e.anim, 0, 0,
        e.hitSprite, Math.min(0.45, e.flash * 0.65));
      b.restore();
      return;
    }

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

    /* 自爆尸：肚囊透出的荧光。脉冲频率跟着残血走 ——
       越接近被你打炸，它跳得越急，这是唯一的"要炸了"预告。 */
    if (e.def && e.def.bomber) {
      var bRage = 1 - Math.max(0, e.hp / e.maxHp);
      var bPulse = 0.5 + 0.5 * Math.sin(e.anim * (4 + bRage * 7) + e.seed);
      var bRad = e.r * (1.9 + 0.35 * bPulse);
      /* 光晕用一张 64x64 的径向渐变贴图缩放，不要用几个实心圆叠 ——
         实心圆的边缘是一条硬边，远看像"脚下放了个绿盘子" */
      if (!R._bombGlow) {
        var gsz = 64;
        R._bombGlow = P.createCanvas(gsz, gsz);
        var gcx = R._bombGlow.getContext('2d');
        var gg = gcx.createRadialGradient(gsz / 2, gsz / 2, 1, gsz / 2, gsz / 2, gsz / 2);
        gg.addColorStop(0, 'rgba(236,255,140,0.62)');
        gg.addColorStop(0.38, 'rgba(196,236,90,0.26)');
        gg.addColorStop(0.72, 'rgba(150,200,60,0.08)');
        gg.addColorStop(1, 'rgba(120,170,50,0)');
        gcx.fillStyle = gg;
        gcx.fillRect(0, 0, gsz, gsz);
      }
      b.save();
      b.globalCompositeOperation = 'lighter';
      b.globalAlpha = 0.6 + 0.4 * bPulse;
      b.drawImage(R._bombGlow, e.x - bRad, e.y - bRad, bRad * 2, bRad * 2);
      b.restore();
      /* 裂口冒火星：频率也随残血升高 */
      if (Math.random() < 0.04 + bRage * 0.10) {
        var bsa = Math.random() * U.TAU;
        var rs = R._run;
        if (rs && rs.fx.length < 200) {
          rs.fx.push({
            kind: 'p', x: e.x + Math.cos(bsa) * e.r * 0.5, y: e.y + Math.sin(bsa) * e.r * 0.4,
            vx: Math.cos(bsa) * 12, vy: -U.rand(12, 30),
            life: 0.3, max: 0.3, color: '#f6ffb0', size: 1.4
          });
        }
      }
    }

    /* 近战受击抖动：**只晃被砍的这一只**（±1.6px + 轻微放大），镜头不动。
       以前是全屏震 3.5px，挥砍频率一高画面就一直在飘；
       把位移放到目标身上，读起来更像"这一下打在肉上"，也不晕。 */
    var jol = e.jolt > 0 ? Math.min(1, e.jolt / 0.12) : 0;
    if (jol > 0) {
      var jx = Math.sin(e.jolt * 220) * 1.6 * jol;
      var jy = Math.cos(e.jolt * 180) * 0.9 * jol;
      b.save();
      b.translate(jx, jy);
      R.drawActor(b, e.spriteName, e.x, ey2, esc * (1 + 0.07 * jol), e.anim, e.gait,
        e.lean, e.hitSprite, Math.min(0.45, e.flash * 0.65));
      b.restore();
    } else {
      R.drawActor(b, e.spriteName, e.x, ey2, esc, e.anim, e.gait,
        e.lean, e.hitSprite, Math.min(0.45, e.flash * 0.65));
    }
    R.drawStatus(b, e, HS.Game && HS.Game.run ? HS.Game.run.t : 0);
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

  /**
   * 事故车身上的伤：车头/车尾被压瘪的折痕 + 碎掉的挡风玻璃。
   * 车壳本身还是那几张贴图 —— 这一层是"它撞过"的读法，
   * 没有它，一堆斜着停的车看起来只是乱停车。
   */
  R.carDamage = function (b, o) {
    var seed = (o.acc * 977 + Math.round(o.x) * 31 + Math.round(o.y)) | 0;
    var r = function (i) { return U.hash(seed, i, 7321); };
    var hw = o.w / 2, hh = o.h / 2, i;
    /* 整体压暗一档：废车比停在路边的车更暗、更哑 */
    b.fillStyle = 'rgba(0,0,0,0.32)';
    b.fillRect(-hw, -hh, o.w, o.h);
    b.fillStyle = 'rgba(92,62,42,0.16)';    // 一层薄锈色：事故车比"停在路边的车"脏得多
    b.fillRect(-hw, -hh, o.w, o.h);
    /* 折痕：车身前后各一撮短斜线，像被挤皱的铁皮 */
    b.fillStyle = 'rgba(8,8,10,0.50)';
    for (i = 0; i < 4; i++) {
      b.fillRect(Math.round(-hw + 2 + r(i) * (o.w - 5)),
        Math.round(-hh + 2 + r(i + 8) * 5), 3, 1);
      b.fillRect(Math.round(-hw + 2 + r(i + 16) * (o.w - 5)),
        Math.round(hh - 5 + r(i + 24) * 3), 3, 1);
    }
    /* 裂开的挡风玻璃：一条横着的冷白 + 两粒碎屑 */
    b.fillStyle = 'rgba(188,214,236,0.28)';
    b.fillRect(Math.round(-hw + 3), Math.round(-hh + 4 + r(30) * 2), Math.round(o.w - 6), 2);
    b.fillStyle = 'rgba(226,240,252,0.42)';
    b.fillRect(Math.round(-hw + 4 + r(31) * 4), Math.round(-hh + 7), 1, 1);
    b.fillRect(Math.round(hw - 6 - r(32) * 3), Math.round(hh - 9), 1, 1);
  };

  R.drawProp = function (b, o, run) {
    if (o.broken) return;
    /* 事故车先落地一道投影：一堆车挤在一起时，靠它才看得出前后关系 */
    if (o.acc !== undefined) {
      b.fillStyle = 'rgba(0,0,0,0.34)';
      ellipseFill(b, o.x + 1.5, o.y + 3.5, o.w * 0.52, o.h * 0.46);
    }
    if (o.ang) {
      /* 废弃车辆按生成时的随机角旋转；碰撞是同一个旋转矩形，不会"看着歪、撞着正" */
      b.save();
      b.translate(Math.round(o.x), Math.round(o.y));
      b.rotate(o.ang);
      S.draw(b, o.frame, 0, 0, 1, undefined, o.flip);
      if (o.acc !== undefined) R.carDamage(b, o);
      b.restore();
    } else {
      S.draw(b, o.frame, o.x, o.y, 1, undefined, o.flip);
    }

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
