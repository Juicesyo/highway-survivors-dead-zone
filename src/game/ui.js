/**
 * UI：标题 / 选图 / 研究所 / HUD / 升级卡 / 暂停 / 结算
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;
  var P = HS.P;
  var D = HS.Data;
  var S = HS.Sprites;

  var FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif';

  var C = {
    bg: '#0b0e13',
    panel: 'rgba(255,255,255,0.055)',
    panel2: 'rgba(255,255,255,0.09)',
    line: 'rgba(255,255,255,0.13)',
    text: '#e9eef5',
    dim: '#8b95a3',
    accent: '#ff5a3c',
    gold: '#ffd166',
    green: '#8ce99a',
    blue: '#7ee8fa',
    purple: '#b197fc'
  };

  var UI = {};

  /* ---------------- 基础绘制 ---------------- */

  function fs(n) { return Math.round(n * (P.W / 390)); }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function text(ctx, str, x, y, size, color, align, weight) {
    ctx.font = (weight === false ? '' : '600 ') + fs(size) + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  function panel(ctx, x, y, w, h, r, fill, stroke) {
    rr(ctx, x, y, w, h, r === undefined ? 14 : r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function measure(ctx, str, size, weight) {
    ctx.font = (weight === false ? '' : '600 ') + fs(size) + 'px ' + FONT;
    return ctx.measureText(str).width;
  }

  /** 文字 + 左侧图标一起居中；返回整体宽度 */
  function iconLabel(ctx, cx, cy, label, iconId, color, size, leftAlign) {
    var tw = measure(ctx, label, size, false);
    var ic = iconId ? fs(size * 1.15) : 0;
    var gap = iconId ? fs(6) : 0;
    var total = ic + gap + tw;
    var x = leftAlign ? cx : cx - total / 2;
    if (iconId) icon(ctx, iconId, x + ic / 2, cy, ic, color);
    text(ctx, label, x + ic + gap, cy + 1, size, color, 'left', false);
    return total;
  }

  function button(g, ctx, id, x, y, w, h, label, kind, small, iconId) {
    g.hits.push({ id: id, x: x, y: y, w: w, h: h });
    var primary = kind === 'primary';
    var danger = kind === 'danger';
    var dim = kind === 'disabled';
    var r = h / 2;
    var cy = y + h / 2;

    if (primary) {
      /* 底下垫一层深色，做出"实体按钮"的厚度 */
      rr(ctx, x, y + fs(3), w, h, r);
      ctx.fillStyle = 'rgba(122,28,14,0.85)';
      ctx.fill();

      var grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, '#ff8158');
      grad.addColorStop(0.46, '#f0502f');
      grad.addColorStop(1, '#cf331b');
      rr(ctx, x, y, w, h, r);
      ctx.fillStyle = grad;
      ctx.fill();

      /* 顶部高光 */
      rr(ctx, x + w * 0.05, y + fs(2), w * 0.90, h * 0.40, h * 0.20);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fill();

      rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
      ctx.strokeStyle = 'rgba(255,196,176,0.34)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (iconId) iconLabel(ctx, x + w / 2, cy + fs(1), label, iconId, '#fff', small ? 15 : 17);
      else text(ctx, label, x + w / 2, cy + fs(1), small ? 15 : 17, '#fff', 'center', true);
    } else if (danger) {
      rr(ctx, x, y, w, h, r);
      /* 危险按钮以前只有 10% 填充，深色背景上像"禁用"；这里补足对比度 */
      ctx.fillStyle = 'rgba(255,86,62,0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,96,66,0.75)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (iconId) iconLabel(ctx, x + w / 2, cy + fs(1), label, iconId, '#ff8a70', small ? 14 : 15);
      else text(ctx, label, x + w / 2, cy + fs(1), small ? 14 : 15, '#ff8a70', 'center');
    } else {
      rr(ctx, x, y, w, h, r);
      ctx.fillStyle = dim ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.075)';
      ctx.fill();
      ctx.strokeStyle = dim ? 'rgba(255,255,255,0.07)' : C.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      var tc = dim ? C.dim : C.text;
      if (iconId) iconLabel(ctx, x + w / 2, cy + fs(1), label, iconId, tc, small ? 14 : 15);
      else text(ctx, label, x + w / 2, cy + fs(1), small ? 14 : 15, tc, 'center');
    }
  }

  function chip(ctx, x, y, label, color) {
    var w = fs(8) * label.length + fs(14);
    var h = fs(17);
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = U.rgba(color, 0.16);
    ctx.fill();
    text(ctx, label, x + w / 2, y + h / 2 + 0.5, 9.5, color, 'center');
    return w;
  }

  /** 右下角的圆形交互按钮：搜刮 / 上楼 / 下楼 / 跳下 */
  function circleAction(g, ctx, id, x, y, size, label, sub, color, danger) {
    var cx = x + size / 2, cy = y + size / 2;
    g.hits.push({ id: id, x: x, y: y, w: size, h: size });
    if (danger) {
      ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, U.TAU);
      ctx.fillStyle = 'rgba(255,86,62,0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,200,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, U.TAU);
      ctx.fillStyle = 'rgba(9,14,20,0.82)';
      ctx.fill();
      ctx.strokeStyle = U.rgba(color, 0.85);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, size / 2 - fs(5), 0, U.TAU);
      ctx.strokeStyle = U.rgba(color, 0.18);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    text(ctx, label, cx, cy - (sub ? fs(5) : 0), 13, danger ? '#fff' : color, 'center', true);
    if (sub) text(ctx, sub, cx, cy + fs(11), 8.5, danger ? 'rgba(255,255,255,0.82)' : 'rgba(233,238,245,0.55)', 'center');
  }

  /* ---------------- 图标 ---------------- */

  /* 点阵图标：主色 + 自动派生的高光/暗部。
     同一图标每帧会被画好几次，所以格子坐标预先按色调分组缓存，
     真正绘制时每种色调只设一次 fillStyle。 */

  var shadeCache = {};

  function shade(color, amt) {
    var key = color + '|' + amt;
    var hit = shadeCache[key];
    if (hit) return hit;
    var out;
    try {
      out = amt > 0 ? U.mix(color, '#ffffff', amt) : U.mix(color, '#000000', -amt);
    } catch (e) {
      out = color;
    }
    shadeCache[key] = out;
    return out;
  }

  var planCache = {};

  function pixPlan(id) {
    var plan = planCache[id];
    if (plan !== undefined) return plan;
    var rows = HS.Icons ? HS.Icons[id] : null;
    if (!rows) { planCache[id] = null; return null; }
    plan = { n: rows.length, a: [], b: [], c: [] };
    for (var r = 0; r < rows.length; r++) {
      var line = rows[r];
      for (var c = 0; c < line.length; c++) {
        var ch = line.charAt(c);
        if (ch === '.') continue;
        var arr = ch === '+' ? plan.b : (ch === '-' ? plan.c : plan.a);
        arr.push(c, r);
      }
    }
    planCache[id] = plan;
    return plan;
  }

  /** 以中心为锚点画点阵图标；返回实际边长 */
  function pix(ctx, id, x, y, size, color) {
    var plan = pixPlan(id);
    if (!plan) return 0;
    var cell = Math.max(1, Math.round(size / plan.n));
    var full = cell * plan.n;
    var x0 = Math.round(x - full / 2);
    var y0 = Math.round(y - full / 2);
    var base = color || C.text;
    var tone = [base, shade(base, 0.46), shade(base, -0.46)];
    for (var t = 0; t < 3; t++) {
      var arr = t === 0 ? plan.a : (t === 1 ? plan.b : plan.c);
      if (!arr.length) continue;
      ctx.fillStyle = tone[t];
      for (var i = 0; i < arr.length; i += 2) {
        ctx.fillRect(x0 + arr[i] * cell, y0 + arr[i + 1] * cell, cell, cell);
      }
    }
    return full;
  }

  function hasIcon(id) { return !!pixPlan(id); }

  /** 图标底框：像物品栏里的槽位，比方块或纯圆更有质感 */
  function badge(ctx, cx, cy, r, color, rare) {
    var s = r * 2;
    var x = Math.round(cx - r), y = Math.round(cy - r);
    var rad = Math.round(r * 0.62);

    /* 深色槽底：图标本身是亮色的，底色越暗越衬得出来 */
    rr(ctx, x, y, s, s, rad);
    var grd = ctx.createLinearGradient(x, y, x, y + s);
    grd.addColorStop(0, 'rgba(15,19,26,0.95)');
    grd.addColorStop(1, 'rgba(5,7,10,0.78)');
    ctx.fillStyle = grd;
    ctx.fill();

    rr(ctx, x, y, s, s, rad);
    var gl = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 1.05);
    gl.addColorStop(0, U.rgba(color, 0.22));
    gl.addColorStop(0.7, U.rgba(color, 0.06));
    gl.addColorStop(1, U.rgba(color, 0));
    ctx.fillStyle = gl;
    ctx.fill();

    rr(ctx, x + 0.5, y + 0.5, s - 1, s - 1, rad);
    ctx.strokeStyle = U.rgba(color, rare ? 0.92 : 0.52);
    ctx.lineWidth = rare ? 1.8 : 1.2;
    ctx.stroke();
  }

  function icon(ctx, id, x, y, size, color) {
    if (hasIcon(id)) { pix(ctx, id, x, y, size, color); return; }
    /* 兜底：没有点阵的 id 画一个菱形，不至于空着 */
    var s = size * 0.38;
    ctx.save();
    ctx.fillStyle = color || C.text;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  UI.icon = icon;
  UI.badge = badge;

  /* ---------------- 背景 ---------------- */

  /* 地平线位置：标题 / 选图 / 设置共用，保证各屏透视一致 */
  function horizonY() { return Math.round(P.H * 0.42); }

  function blob(ctx, cx, cy, rx, ry, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, U.TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /* 静态夜景（天空 / 星 / 血月 / 城市 / 公路）只算一次，按尺寸缓存在离屏画布上；
     每帧只叠动态的雾带和火星，纹丝不动的大块头就不重复画了。 */
  var sceneCv = null;
  var sceneKey = '';

  function sceneCache() {
    var key = Math.round(P.W) + 'x' + Math.round(P.H) + '@' + (P.dpr || 1);
    if (sceneCv && sceneKey === key) return sceneCv;
    var dpr = P.dpr || 1;
    var cv = null;
    try {
      cv = P.createCanvas(Math.max(1, Math.round(P.W * dpr)), Math.max(1, Math.round(P.H * dpr)));
    } catch (e) { cv = null; }
    var c = cv ? cv.getContext('2d') : null;
    if (!c) { sceneCv = null; sceneKey = ''; return null; }
    if ('imageSmoothingEnabled' in c) c.imageSmoothingEnabled = false;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintScene(c);
    sceneCv = cv;
    sceneKey = key;
    return cv;
  }

  function paintScene(c) {
    var W = P.W, H = P.H;
    var hz = horizonY();
    var i;

    /* 夜空 */
    var sky = c.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#05070b');
    sky.addColorStop(0.40, '#0b1119');
    sky.addColorStop(0.74, '#182230');
    sky.addColorStop(1, '#2e2226');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, hz + 1);

    /* 星 */
    for (i = 0; i < 92; i++) {
      var sx = U.hash(i, 3, 9901) * W;
      var sy = U.hash(i, 7, 9907) * hz * 0.88;
      var sa = 0.08 + U.hash(i, 11, 9909) * 0.48;
      var big = U.hash(i, 13, 9911) > 0.88;
      c.fillStyle = 'rgba(210,226,255,' + sa.toFixed(2) + ')';
      c.fillRect(Math.round(sx), Math.round(sy), big ? 2 : 1, big ? 2 : 1);
    }

    /* 血月 */
    var mx = W * 0.80, my = H * 0.072, mr = fs(21);
    var halo = c.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 5.2);
    halo.addColorStop(0, 'rgba(255,104,70,0.13)');
    halo.addColorStop(0.42, 'rgba(255,84,56,0.045)');
    halo.addColorStop(1, 'rgba(255,70,48,0)');
    c.fillStyle = halo;
    c.beginPath();
    c.arc(mx, my, mr * 5.2, 0, U.TAU);
    c.fill();

    var disc = c.createRadialGradient(mx - mr * 0.36, my - mr * 0.36, mr * 0.1, mx, my, mr);
    disc.addColorStop(0, '#e8c6b0');
    disc.addColorStop(0.45, '#bd6a51');
    disc.addColorStop(1, '#6e2416');
    c.fillStyle = disc;
    c.beginPath();
    c.arc(mx, my, mr, 0, U.TAU);
    c.fill();

    /* 城市剪影：两层，越近越黑 */
    skyline(c, hz + 1, fs(64), '#0e1621', 11, null, 0);
    skyline(c, hz + 1, fs(42), '#080c12', 37, 'rgba(255,186,112,0.34)', 0.10);

    /* 地面 */
    var gnd = c.createLinearGradient(0, hz, 0, H);
    gnd.addColorStop(0, '#10151c');
    gnd.addColorStop(0.3, '#0b0f15');
    gnd.addColorStop(1, '#070a0e');
    c.fillStyle = gnd;
    c.fillRect(0, hz, W, H - hz);

    /* 地平线余烬 */
    var haze = c.createLinearGradient(0, hz - fs(26), 0, hz + fs(12));
    haze.addColorStop(0, 'rgba(255,110,70,0)');
    haze.addColorStop(0.74, 'rgba(255,110,70,0.12)');
    haze.addColorStop(1, 'rgba(255,110,70,0)');
    c.fillStyle = haze;
    c.fillRect(0, hz - fs(26), W, fs(38));

    /* 公路 */
    var cxp = W * 0.5;
    var hw0 = W * 0.030;
    var hw1 = W * 0.88;
    var depth = H - hz;

    c.beginPath();
    c.moveTo(cxp - hw0, hz);
    c.lineTo(cxp + hw0, hz);
    c.lineTo(cxp + hw1, H);
    c.lineTo(cxp - hw1, H);
    c.closePath();
    var rg = c.createLinearGradient(0, hz, 0, H);
    rg.addColorStop(0, '#232b35');
    rg.addColorStop(0.5, '#161c24');
    rg.addColorStop(1, '#0d1116');
    c.fillStyle = rg;
    c.fill();

    /* 中线：按透视压缩的虚线 */
    for (i = 0; i < 15; i++) {
      var t0 = Math.pow(i / 15, 2.1);
      var t1 = Math.pow((i + 0.40) / 15, 2.1);
      var y0 = hz + depth * t0;
      var y1 = hz + depth * t1;
      var ww = (hw0 + (hw1 - hw0) * t0) * 0.026;
      c.fillStyle = 'rgba(255,214,130,' + (0.07 + t0 * 0.18).toFixed(2) + ')';
      c.fillRect(cxp - ww / 2, y0, Math.max(1, ww), Math.max(1, y1 - y0));
    }

    /* 路肩 */
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(cxp - hw0, hz); c.lineTo(cxp - hw1, H);
    c.moveTo(cxp + hw0, hz); c.lineTo(cxp + hw1, H);
    c.stroke();

    /* 护栏立柱：越近越高，给公路一点纵深和节奏 */
    for (i = 1; i <= 9; i++) {
      var tt = Math.pow(i / 9.6, 1.9);
      var py2 = hz + depth * tt;
      var half = hw0 + (hw1 - hw0) * tt;
      var ph = fs(3) + tt * fs(15);
      var pw = Math.max(1, Math.round(fs(1.1) + tt * fs(3)));
      c.fillStyle = 'rgba(146,158,176,' + (0.08 + tt * 0.18).toFixed(2) + ')';
      c.fillRect(Math.round(cxp - half - pw), Math.round(py2 - ph), pw, Math.round(ph));
      c.fillRect(Math.round(cxp + half), Math.round(py2 - ph), pw, Math.round(ph));
      c.fillStyle = 'rgba(255,88,58,' + (0.10 + tt * 0.22).toFixed(2) + ')';
      c.fillRect(Math.round(cxp - half - pw), Math.round(py2 - ph), pw, Math.max(1, Math.round(ph * 0.26)));
      c.fillRect(Math.round(cxp + half), Math.round(py2 - ph), pw, Math.max(1, Math.round(ph * 0.26)));
    }

    /* 暗角 */
    var vg = c.createRadialGradient(W * 0.5, H * 0.38, W * 0.30, W * 0.5, H * 0.38, W * 1.10);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.74, 'rgba(0,0,0,0.24)');
    vg.addColorStop(1, 'rgba(0,0,0,0.62)');
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);
  }

  function skyline(c, baseY, maxH, color, seed, winColor, density) {
    var W = P.W;
    var x = -fs(12);
    while (x < W + fs(12)) {
      var bw = fs(13) + U.hash(x | 0, seed, 5501) * fs(26);
      var bh = fs(16) + U.hash(x | 0, seed + 1, 5503) * maxH;
      var by = baseY - bh;

      c.fillStyle = color;
      c.fillRect(Math.round(x), Math.round(by), Math.round(bw), Math.round(bh + 2));

      /* 屋顶杂物 */
      if (U.hash(x | 0, seed + 2, 5507) > 0.66) {
        c.fillRect(Math.round(x + bw * 0.28), Math.round(by - fs(5)), Math.max(2, fs(3)), fs(6));
      }

      if (winColor) {
        var cols = Math.floor(bw / fs(7));
        var rows = Math.floor(bh / fs(9));
        for (var wy = 0; wy < rows; wy++) {
          for (var wx = 0; wx < cols; wx++) {
            var hv = U.hash((x | 0) + wx * 31, wy * 17 + seed, 5509);
            if (hv > 1 - density) {
              c.fillStyle = hv > 0.975 ? 'rgba(255,214,150,0.72)' : winColor;
              c.fillRect(Math.round(x + fs(3) + wx * fs(7)),
                Math.round(by + fs(4) + wy * fs(9)), Math.max(1, fs(2)), Math.max(1, fs(2)));
            }
          }
        }
      }
      x += bw + fs(3);
    }
  }

  /* 每帧动的部分：雾带 + 飘火星 */
  function drift(ctx, g) {
    var W = P.W, H = P.H;
    var t = P.isNode ? 0 : (g.t || 0);
    var hz = horizonY();

    for (var i = 0; i < 4; i++) {
      var span = W * (1.3 + i * 0.5);
      var x = ((t * (7 + i * 5) + i * 190) % (W + span)) - span * 0.5;
      blob(ctx, x, hz - fs(6) + i * fs(9), span * 0.5, fs(9 + i * 3),
        'rgba(148,168,196,' + (0.030 - i * 0.005).toFixed(3) + ')');
    }

    for (var k = 0; k < 12; k++) {
      var seed = k * 71;
      var ph = (t * (0.06 + U.hash(seed, 1, 8101) * 0.07) + U.hash(seed, 2, 8103)) % 1;
      var ex = W * 0.5 + (U.hash(seed, 3, 8105) - 0.5) * W * 1.1 + Math.sin(t * 0.7 + k) * fs(9);
      var ey = hz + fs(30) - ph * fs(130);
      ctx.fillStyle = 'rgba(255,' + (155 + ((seed * 7) % 55)) + ',92,' + ((1 - ph) * 0.42).toFixed(2) + ')';
      ctx.fillRect(Math.round(ex), Math.round(ey), 2, 2);
    }
  }

  function bg(ctx, g, dim) {
    var cv = sceneCache();
    if (cv) ctx.drawImage(cv, 0, 0, P.W, P.H);
    else paintScene(ctx);
    if (dim) {
      ctx.fillStyle = 'rgba(6,8,12,' + dim + ')';
      ctx.fillRect(0, 0, P.W, P.H);
    }
    drift(ctx, g);
  }

  /* ---------------- 标题 ---------------- */

  /** 站姿角色：脚底对齐到 footY，顺手补一个贴地影子 */
  function standActor(ctx, name, cx, footY, scale, alpha) {
    var sz = S.size(name, scale);
    if (!sz.w) return;
    blob(ctx, cx, footY, sz.w * 0.40, Math.max(2, sz.w * 0.13), 'rgba(0,0,0,0.46)');
    S.draw(ctx, name, cx, footY - sz.h / 2, scale, alpha);
  }

  /**
   * 手绘描边标题。tint 可选：{ top, mid, bot, glow } 覆盖默认的冷白渐变，
   * 用来让副标题（死区）走血色。
   */
  function heroTitle(ctx, str, x, y, size, tint) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 ' + fs(size) + 'px ' + FONT;

    ctx.fillStyle = (tint && tint.glow) || 'rgba(255,86,56,0.30)';
    ctx.fillText(str, x, y + fs(3));

    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = 'rgba(6,8,12,0.92)';
    ctx.lineWidth = fs(size * 0.15);
    ctx.strokeText(str, x, y);

    var grd = ctx.createLinearGradient(0, y - fs(size * 0.5), 0, y + fs(size * 0.5));
    grd.addColorStop(0, (tint && tint.top) || '#ffffff');
    grd.addColorStop(0.55, (tint && tint.mid) || '#dfe7f2');
    grd.addColorStop(1, (tint && tint.bot) || '#a8b6c8');
    ctx.fillStyle = grd;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  /* ---- 海报风辅助 ---- */

  var silCache = {};
  /** 把精灵烘成纯色剪影（海报背景用），按 name+scale+color 缓存 */
  function silSprite(name, scale, color) {
    var key = name + '@' + scale + ':' + color;
    var cv = silCache[key];
    if (cv) return cv;
    var sz = S.size(name, scale);
    if (!sz.w) return null;
    cv = P.createCanvas(Math.ceil(sz.w) + 2, Math.ceil(sz.h) + 2);
    var c = cv.getContext('2d');
    S.draw(c, name, cv.width / 2, cv.height / 2, scale, 1);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = color;
    c.fillRect(0, 0, cv.width, cv.height);
    silCache[key] = cv;
    return cv;
  }

  function silActor(ctx, name, cx, footY, scale, color) {
    var cv = silSprite(name, scale, color);
    if (!cv) return;
    var sz = S.size(name, scale);
    blob(ctx, cx, footY, sz.w * 0.4, Math.max(2, sz.w * 0.13), 'rgba(0,0,0,0.5)');
    ctx.drawImage(cv, Math.round(cx - cv.width / 2), Math.round(footY - cv.height + 1));
  }

  /** 斜纹警示条：c1 底 / c2 斜纹 */
  function hazard(ctx, x, y, w, h, c1, c2) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = c1;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = c2;
    var s = h * 1.3;
    ctx.beginPath();
    for (var sx = x - h * 2; sx < x + w + h * 2; sx += s * 2) {
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + h, y);
      ctx.lineTo(sx + h + s, y);
      ctx.lineTo(sx + s, y + h);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  /** 斜切钢板按钮（海报风，不用圆角胶囊） */
  function plate(g, ctx, id, x, y, w, h, label, primary) {
    g.hits.push({ id: id, x: x, y: y, w: w, h: h });
    var sk = Math.min(fs(11), h * 0.32);
    function path(yy) {
      ctx.beginPath();
      ctx.moveTo(x + sk, yy);
      ctx.lineTo(x + w, yy);
      ctx.lineTo(x + w - sk, yy + h);
      ctx.lineTo(x, yy + h);
      ctx.closePath();
    }
    if (primary) {
      path(y + fs(4));
      ctx.fillStyle = 'rgba(92,16,7,0.92)';
      ctx.fill();
      var grd = ctx.createLinearGradient(x, y, x, y + h);
      grd.addColorStop(0, '#ff7c52');
      grd.addColorStop(0.5, '#ef4a2c');
      grd.addColorStop(1, '#c22c15');
      path(y);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,204,186,0.42)';
      ctx.lineWidth = 1;
      ctx.stroke();
      /* 左上斜高光 */
      ctx.beginPath();
      ctx.moveTo(x + sk, y);
      ctx.lineTo(x + w * 0.42, y);
      ctx.lineTo(x + w * 0.42 - sk, y + h * 0.34);
      ctx.lineTo(x + sk * 0.4, y + h * 0.34);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fill();
      text(ctx, label, x + w / 2, y + h / 2 + fs(1), 18, '#fff', 'center', true);
    } else {
      path(y);
      ctx.fillStyle = 'rgba(9,13,19,0.62)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      text(ctx, label, x + w / 2, y + h / 2 + fs(1), 13.5, C.text, 'center');
    }
  }

  /* 标题页封面图：可选资源（assets/title-bg.js 里的 base64），
     加载中 / 加载失败都退回程序化场景，首帧不等图 */
  var titleBg = { im: null, tried: false };
  function drawTitleCover(ctx, W, H, g) {
    if (!titleBg.tried) {
      titleBg.tried = true;
      if (HS.TitleBgData && HS.TitleBgData.image) {
        P.loadImage(HS.TitleBgData.image, function (im) { titleBg.im = im || null; });
      }
    }
    if (titleBg.im) {
      var im = titleBg.im;
      var iw = im.width || 1080, ih = im.height || 594;
      var s = Math.max(W / iw, H / ih);
      var dw = iw * s, dh = ih * s;
      ctx.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
      /* 上下压暗：给标题和按钮让出对比度 */
      var tg = ctx.createLinearGradient(0, 0, 0, H * 0.38);
      tg.addColorStop(0, 'rgba(12,8,12,0.62)');
      tg.addColorStop(1, 'rgba(12,8,12,0)');
      ctx.fillStyle = tg;
      ctx.fillRect(0, 0, W, H * 0.38);
      var bgd = ctx.createLinearGradient(0, H * 0.52, 0, H);
      bgd.addColorStop(0, 'rgba(12,8,12,0)');
      bgd.addColorStop(1, 'rgba(12,8,12,0.7)');
      ctx.fillStyle = bgd;
      ctx.fillRect(0, H * 0.52, W, H * 0.48);
    } else {
      bg(ctx, g);
    }
  }

  UI.title = function (g) {
    var ctx = P.ctx, W = P.W, H = P.H;
    drawTitleCover(ctx, W, H, g);

    /* ---- 标题区：大标题 + 斜贴血色印章 ---- */
    var kw = measure(ctx, 'H I G H W A Y   S U R V I V O R S', 9.5, false);
    text(ctx, 'H I G H W A Y   S U R V I V O R S', W / 2, H * 0.075, 9.5, 'rgba(240,232,224,0.8)', 'center', false);
    ctx.fillStyle = C.accent;
    ctx.fillRect(W / 2 - kw / 2 - fs(16), H * 0.075 - 1, fs(8), 2);
    ctx.fillRect(W / 2 + kw / 2 + fs(8), H * 0.075 - 1, fs(8), 2);

    heroTitle(ctx, '公路幸存者', W / 2, H * 0.148, 52);

    ctx.save();
    ctx.translate(W / 2 + fs(88), H * 0.222);
    ctx.rotate(-0.085);
    var sw = fs(118), sh = fs(38), ssk = fs(9);
    ctx.beginPath();
    ctx.moveTo(-sw / 2 + ssk, -sh / 2);
    ctx.lineTo(sw / 2, -sh / 2);
    ctx.lineTo(sw / 2 - ssk, sh / 2);
    ctx.lineTo(-sw / 2, sh / 2);
    ctx.closePath();
    ctx.fillStyle = '#b81f10';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,160,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text(ctx, '死 区', 0, fs(1), 23, '#ffe9e2', 'center', true);
    ctx.restore();

    text(ctx, 'D E A D   Z O N E', W / 2, H * 0.262, 10.5, C.accent, 'center');
    text(ctx, '像素肉鸽 · 高速打僵尸', W / 2, H * 0.29, 11, 'rgba(240,232,224,0.78)', 'center', false);

    /* ---- 按钮：斜切钢板，压在画面下半的公路上 ---- */
    var bw = W * 0.72, bx = (W - bw) / 2;
    var by = H * 0.595;
    plate(g, ctx, 'start', bx, by, bw, fs(58), '开 始 游 戏', true);
    var hw = (bw - fs(12)) / 2;
    plate(g, ctx, 'meta', bx, by + fs(76), hw, fs(46), '研究所', false);
    plate(g, ctx, 'settings', bx + hw + fs(12), by + fs(76), hw, fs(46), '设置', false);

    /* ---- 记录条：三栏合并成一条钢板 ---- */
    var d = HS.Save.data;
    var cards = [
      ['最佳存活', U.fmt(d.bestTime), C.blue],
      ['通关', d.wins + ' 次', C.green],
      ['金币', String(d.gold), C.gold]
    ];
    var stackBottom = by + fs(76) + fs(46);
    var cy2 = Math.max(stackBottom + fs(18), H * 0.795);
    var cw = bw / 3;
    panel(ctx, bx, cy2, bw, fs(46), fs(4), 'rgba(9,13,19,0.55)', 'rgba(255,255,255,0.14)');
    for (var ci = 0; ci < 3; ci++) {
      var kx = bx + ci * cw;
      if (ci > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.09)';
        ctx.fillRect(Math.round(kx), cy2 + fs(8), 1, fs(30));
      }
      text(ctx, cards[ci][0], kx + cw / 2, cy2 + fs(14), 9, C.dim, 'center', false);
      text(ctx, cards[ci][1], kx + cw / 2, cy2 + fs(31), 14, cards[ci][2], 'center', true);
    }

    text(ctx, '拖动屏幕移动，武器自动开火', W / 2, cy2 + fs(62), 10.5, 'rgba(230,222,214,0.62)', 'center', false);
    text(ctx, 'v' + (HS.VERSION || '1.0.0') + '   手绘封面 · 其余美术与音效由代码生成', W / 2, H - fs(18), 8.6,
      'rgba(139,149,163,0.45)', 'center', false);

    if (g.noticeT > 0) {
      text(ctx, g.noticeText, W / 2, H * 0.75, 13, C.gold, 'center');
    }
  };

  /* ---------------- 选图 ---------------- */

  UI.mapSelect = function (g) {
    var ctx = P.ctx, W = P.W, H = P.H;
    bg(ctx, g, 0.62);
    var d = HS.Save.data;

    text(ctx, '选择死区', W * 0.07, H * 0.09, 24, C.text, 'left', true);
    text(ctx, '存活 6 分钟，击杀区域首领', W * 0.07, H * 0.125, 11.5, C.dim, 'left', false);

    var top = H * 0.16;
    var ch = fs(96), gap = fs(12);

    for (var i = 0; i < D.mapOrder.length; i++) {
      var m = D.maps[D.mapOrder[i]];
      var locked = d.unlockedMaps.indexOf(m.id) < 0;
      var sel = g.selMap === m.id;
      var y = top + i * (ch + gap);

      panel(ctx, W * 0.06, y, W * 0.88, ch, 14,
        sel ? 'rgba(255,90,60,0.13)' : 'rgba(255,255,255,0.045)',
        sel ? 'rgba(255,90,60,0.7)' : C.line);

      text(ctx, m.name, W * 0.06 + fs(16), y + fs(24), 17, locked ? C.dim : C.text, 'left', true);
      /* 地图的特殊规则挂一个标签，别让玩家进去才发现"射程怎么变短了" */
      if (m.night) {
        text(ctx, '夜间 · 射程 -' + Math.round((1 - (m.rangeMul || 1)) * 100) + '%',
          W * 0.06 + W * 0.88 - fs(44), y + fs(24), 10, '#7ee8fa', 'right', true);
      } else if (m.gunmen) {
        text(ctx, '枪手出没', W * 0.06 + W * 0.88 - fs(44), y + fs(24), 10, '#ff9f43', 'right', true);
      }
      var prevName = D.maps[D.mapOrder[Math.max(0, D.mapOrder.indexOf(m.id) - 1)]].name;
      text(ctx, locked ? ('通关「' + prevName + '」解锁')
        : ('经验 x' + m.xpMul.toFixed(2) + '  搜刮 x' + m.goldMul.toFixed(2) + '  通关 +' + (m.clearGold || 0)),
        W * 0.06 + fs(16), y + fs(48), 10.5, locked ? '#d08a5a' : C.gold, 'left', false);
      text(ctx, m.desc, W * 0.06 + fs(16), y + fs(68), 10, C.dim, 'left', false);

      if (!locked) {
        g.hits.push({ id: 'map:' + m.id, x: W * 0.06, y: y, w: W * 0.88, h: ch });
        if (sel) {
          ctx.fillStyle = C.accent;
          ctx.beginPath();
          ctx.arc(W * 0.06 + W * 0.88 - fs(20), y + ch / 2, fs(5), 0, U.TAU);
          ctx.fill();
        }
      }
    }

    /* 无尽模式：标题 + 开关一行，说明单独一行。
       原来说明挤在标题右边、一直顶到开关上（中文宽度被低估，必重叠） */
    var ey = H * 0.665, eh = fs(56);
    panel(ctx, W * 0.12, ey, W * 0.76, eh, 12, 'rgba(255,255,255,0.04)', C.line);
    text(ctx, '无尽模式', W * 0.12 + fs(16), ey + fs(18), 12.5, C.text, 'left', true);
    text(ctx, '不设终点，Boss 一轮比一轮强 · 无通关奖励', W * 0.12 + fs(16), ey + fs(38), 9.5, C.dim, 'left', false);
    var swW = fs(38), swH = fs(20), swX = W * 0.88 - fs(16) - swW, swY = ey + fs(18) - swH / 2;
    rr(ctx, swX, swY, swW, swH, swH / 2);
    ctx.fillStyle = g.endless ? 'rgba(255,90,60,0.85)' : 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(g.endless ? swX + swW - swH / 2 : swX + swH / 2, swY + swH / 2, swH / 2 - fs(3), 0, U.TAU);
    ctx.fill();
    g.hits.push({ id: 'endless', x: W * 0.12, y: ey, w: W * 0.76, h: eh });

    button(g, ctx, 'launch', W * 0.12, H * 0.775, W * 0.76, fs(52), '出发', 'primary');
    button(g, ctx, 'back', W * 0.34, H * 0.875, W * 0.32, fs(38), '返回', 'ghost', true);
  };

  /* ---------------- 研究所 ---------------- */

  UI.meta = function (g) {
    var ctx = P.ctx, W = P.W, H = P.H;
    var d = HS.Save.data;
    bg(ctx, g, 0.68);

    text(ctx, '研究所', W * 0.06, H * 0.075, 24, C.text, 'left', true);
    text(ctx, '金币 ' + d.gold, W * 0.94, H * 0.075, 15, C.gold, 'right', true);
    text(ctx, '存活记录 ' + U.fmt(d.bestTime) + ' · 通关 ' + d.wins, W * 0.06, H * 0.107, 10.5, C.dim, 'left', false);

    /* 标签 */
    var tabs = [
      { id: 'char', label: '角色' },
      { id: 'up', label: '强化' },
      { id: 'arc', label: '档案' }
    ];
    var ty = H * 0.135, tw = (W * 0.88) / 3, tx0 = W * 0.06;
    for (var i = 0; i < tabs.length; i++) {
      var on = g.tab === tabs[i].id;
      var tx = tx0 + i * tw;
      rr(ctx, tx + 2, ty, tw - 4, fs(34), fs(17));
      ctx.fillStyle = on ? 'rgba(255,90,60,0.85)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      text(ctx, tabs[i].label, tx + tw / 2, ty + fs(17), 13, on ? '#fff' : C.dim, 'center');
      g.hits.push({ id: 'tab:' + tabs[i].id, x: tx, y: ty, w: tw, h: fs(34) });
    }

    var cy = H * 0.185;

    if (g.tab === 'char') {
      var cw = W * 0.88, cx = W * 0.06;
      var chh = fs(74), cgap = fs(9);
      for (var j = 0; j < D.charOrder.length; j++) {
        var ch = D.chars[D.charOrder[j]];
        var owned = HS.Save.hasChar(ch.id);
        var sel = g.selChar === ch.id;
        var yy = cy + j * (chh + cgap);

        panel(ctx, cx, yy, cw, chh, 12,
          sel ? 'rgba(126,232,250,0.10)' : 'rgba(255,255,255,0.04)',
          sel ? 'rgba(126,232,250,0.55)' : C.line);

        /* 头像 */
        ctx.fillStyle = U.rgba(ch.color, owned ? 0.16 : 0.07);
        ctx.beginPath();
        ctx.arc(cx + fs(26), yy + chh / 2, fs(19), 0, U.TAU);
        ctx.fill();
        ctx.strokeStyle = U.rgba(ch.color, owned ? 0.5 : 0.18);
        ctx.lineWidth = 1;
        ctx.stroke();
        S.draw(ctx, 'player_' + ch.id, cx + fs(26), yy + chh / 2, 3, owned ? 1 : 0.28);

        text(ctx, ch.name, cx + fs(46), yy + fs(20), 15, owned ? C.text : C.dim, 'left', true);
        var nameW = ctx.measureText(ch.name).width;
        text(ctx, ch.tag, cx + fs(46) + nameW + fs(8), yy + fs(20), 9.5, ch.color, 'left', false);
        /* 特性 / 描述必须收在右侧价格按钮左边：未解锁时右侧有 fs(84) 的按钮，
           以前不限宽会直接压到「解锁 300」底下 */
        var descW = cw - fs(46) - fs(10) - (owned ? fs(70) : fs(84));
        var pls = wrap2(ctx, ch.perks.join(' · '), descW, 10);
        text(ctx, pls[1] ? pls[0].replace(/.$/, '…') : pls[0],
          cx + fs(46), yy + fs(40), 10, C.dim, 'left', false);
        var dls = wrap2(ctx, ch.desc, descW, 9.5);
        text(ctx, dls[1] ? dls[0].replace(/.$/, '…') : dls[0],
          cx + fs(46), yy + fs(56), 9.5, 'rgba(139,149,163,0.8)', 'left', false);

        if (!owned) {
          var label = d.gold >= ch.cost ? ('解锁 ' + ch.cost) : (ch.cost + ' 金币');
          button(g, ctx, 'char:' + ch.id, cx + cw - fs(84), yy + chh / 2 - fs(15), fs(74), fs(30),
            label, d.gold >= ch.cost ? 'primary' : 'disabled', true);
        } else if (sel) {
          text(ctx, '已选择', cx + cw - fs(14), yy + chh / 2, 11, C.blue, 'right');
        } else {
          g.hits.push({ id: 'char:' + ch.id, x: cx, y: yy, w: cw, h: chh });
          text(ctx, '点击选择', cx + cw - fs(14), yy + chh / 2, 10.5, C.dim, 'right');
        }
      }

      var tipY = cy + D.charOrder.length * (chh + cgap) + fs(6);
      panel(ctx, cx, tipY, cw, fs(112), 12, 'rgba(255,209,102,0.06)', 'rgba(255,209,102,0.22)');
      text(ctx, '上路须知', cx + fs(14), tipY + fs(15), 11, C.gold, 'left', true);
      text(ctx, '· 青色门口 = 完整房屋；金色菱形 = 可搜刮家具', cx + fs(14), tipY + fs(33), 9.5, C.dim, 'left', false);
      text(ctx, '· 楼顶能躲地面尸群，但丧尸会爬楼梯上来', cx + fs(14), tipY + fs(49), 9.5, C.dim, 'left', false);
      text(ctx, '· 武器满级 + 对应被动 Lv3 → 触发武器进化', cx + fs(14), tipY + fs(65), 9.5, C.dim, 'left', false);
      var tipMap = D.maps[g.selMap] || D.maps.highway;
      var tipBoss = (D.enemies[tipMap.bossId] || D.enemies.boss).name;
      text(ctx, '· 撑过 6 分钟，' + tipBoss + '会从侧翼入场', cx + fs(14), tipY + fs(81), 9.5, C.dim, 'left', false);
      text(ctx, '· 路边偶有能开的破车：碾压爽，但武器全收起、耐久烧完就报废', cx + fs(14), tipY + fs(97), 9.5, '#ffb08a', 'left', false);
    }

    if (g.tab === 'up') {
      var rw = W * 0.88, rx = W * 0.06;
      var rh = fs(52), rgap = fs(7);
      for (var k = 0; k < D.perms.length; k++) {
        var pm = D.perms[k];
        var lvl = d.perm[pm.id] || 0;
        var maxed = lvl >= pm.maxLvl;
        var cost = maxed ? 0 : pm.cost(lvl);
        var yy2 = cy + k * (rh + rgap);

        panel(ctx, rx, yy2, rw, rh, 12, 'rgba(255,255,255,0.04)', C.line);
        icon(ctx, pm.id === 'revive' ? 'regen' : (pm.id === 'greed' ? 'luck' : (pm.id === 'luck' ? 'luck' : (pm.id === 'spd' ? 'swift' : (pm.id === 'dmg' ? 'power' : 'vigor')))),
          rx + fs(24), yy2 + rh / 2, fs(26), pm.color);

        text(ctx, pm.name + '  Lv' + lvl + '/' + pm.maxLvl, rx + fs(44), yy2 + fs(17), 13, C.text, 'left', true);
        text(ctx, (maxed ? pm.desc(lvl) : pm.desc(lvl + 1)), rx + fs(44), yy2 + fs(34), 9.8, C.dim, 'left', false);

        /* 等级点 */
        for (var q = 0; q < pm.maxLvl; q++) {
          ctx.fillStyle = q < lvl ? pm.color : 'rgba(255,255,255,0.13)';
          ctx.fillRect(rx + fs(44) + q * fs(9), yy2 + rh - fs(12), fs(6), fs(4));
        }

        if (maxed) {
          text(ctx, '已满级', rx + rw - fs(12), yy2 + rh / 2, 10.5, C.green, 'right');
        } else {
          g.hits.push({ id: 'perm:' + pm.id, x: rx, y: yy2, w: rw, h: rh });
          var canBuy = d.gold >= cost;
          rr(ctx, rx + rw - fs(80), yy2 + rh / 2 - fs(14), fs(70), fs(28), fs(14));
          ctx.fillStyle = canBuy ? 'rgba(255,209,102,0.16)' : 'rgba(255,255,255,0.05)';
          ctx.fill();
          text(ctx, cost + '', rx + rw - fs(45), yy2 + rh / 2, 12, canBuy ? C.gold : C.dim, 'center', true);
        }
      }
    }

    if (g.tab === 'arc') {
      var aw = W * 0.88, ax = W * 0.06;
      var ah = fs(26), agap = fs(3);
      text(ctx, '成就', ax, cy + fs(4), 12, C.dim, 'left');
      var ly = cy + fs(18);
      var shown = 0;

      for (var n = 0; n < D.achievements.length; n++) {
        var ach = D.achievements[n];
        var got = !!d.ach[ach.id];
        var y3 = ly + n * (ah + agap);
        /* 成就区封顶在图鉴标题之上，绝不能被下面的图鉴盖住 */
        if (y3 + ah > H * 0.66) break;
        shown++;

        rr(ctx, ax, y3, aw, ah, 8);
        ctx.fillStyle = got ? 'rgba(140,233,154,0.10)' : 'rgba(255,255,255,0.035)';
        ctx.fill();
        ctx.fillStyle = got ? C.green : 'rgba(255,255,255,0.16)';
        ctx.fillRect(ax + fs(8), y3 + ah / 2 - fs(5), fs(4), fs(10));
        text(ctx, ach.name, ax + fs(18), y3 + ah / 2, 11.5, got ? C.text : C.dim, 'left', true);
        text(ctx, ach.desc, ax + aw - fs(8), y3 + ah / 2, 9.5, got ? C.green : 'rgba(139,149,163,0.6)', 'right', false);
      }
      if (shown < D.achievements.length) {
        text(ctx, '还有 ' + (D.achievements.length - shown) + ' 项成就', ax + aw, ly + shown * (ah + agap) + fs(6),
          9, 'rgba(139,149,163,0.55)', 'right', false);
      }

      /* ---- 图鉴 ----
         统计口径必须和"记录口径"一致：seen.weapons 里既有手持也有自动装备，
         还会混进进化形态（laser_x 之类，不在任何池子里）。
         以前直接拿 seen.weapons.length 当分子，分母只数池子，
         进化一次就能把进度顶到 96/95。这里按池子归类后再相加。 */
      var seen = d.seen;
      var seenW = seen.weapons || [], seenE = seen.enemies || [];
      var handTotal = D.weaponPool.length + D.subPool.length + D.heavyPool.length;
      var autoTotal = D.autoPool.length;
      var handSeen = 0, autoSeen = 0, wi, wid;
      for (wi = 0; wi < seenW.length; wi++) {
        wid = seenW[wi];
        if (D.weaponPool.indexOf(wid) >= 0 || D.subPool.indexOf(wid) >= 0 ||
            D.heavyPool.indexOf(wid) >= 0) handSeen++;
        else if (D.autoPool.indexOf(wid) >= 0) autoSeen++;
      }

      var eTotal = 0, bTotal = 0, eSeen = 0, bSeen = 0;
      var eDefs = [], bDefs = [], ek, ed;
      for (ek in D.enemies) {
        if (!D.enemies.hasOwnProperty(ek)) continue;
        ed = D.enemies[ek];
        if (ed.boss) { bTotal++; bDefs.push(ed); } else { eTotal++; eDefs.push(ed); }
      }
      for (wi = 0; wi < seenE.length; wi++) {
        ed = D.enemies[seenE[wi]];
        if (!ed) continue;
        if (ed.boss) bSeen++; else eSeen++;
      }

      var endY = ly + shown * (ah + agap);
      var sy = Math.max(H * 0.68, endY + fs(10));
      text(ctx, '图鉴', ax, sy, 12, C.dim, 'left');

      var rowY = sy + fs(19);
      text(ctx, '手持武器 ' + handSeen + '/' + handTotal, ax, rowY, 11, handSeen ? C.text : C.dim, 'left');
      text(ctx, '自动装备 ' + autoSeen + '/' + autoTotal, ax + aw * 0.46, rowY, 11, autoSeen ? C.text : C.dim, 'left');

      rowY += fs(18);
      text(ctx, '感染者 ' + eSeen + '/' + eTotal, ax, rowY, 11, eSeen ? C.text : C.dim, 'left');
      text(ctx, '首领 ' + bSeen + '/' + bTotal, ax + aw * 0.46, rowY, 11, bSeen ? '#ff8a8a' : C.dim, 'left');

      /* 首领固定三格：没打过的用 ??? 占位，玩家一眼知道还差谁 */
      var bTxt = '', bi, bd;
      for (bi = 0; bi < bDefs.length; bi++) {
        bd = bDefs[bi];
        bTxt += (bTxt ? ' · ' : '') + (seenE.indexOf(bd.id) >= 0 ? bd.name : '???');
      }
      if (bTxt) {
        text(ctx, '· ' + bTxt, ax, rowY + fs(17), 9.5, 'rgba(255,138,138,0.75)', 'left', false);
      }

      /* 感染者名单：每行最多四个，名字多了自动换行，不会顶出屏幕 */
      var eNames = [], eLeft = 0, ei;
      for (ei = 0; ei < eDefs.length; ei++) {
        if (seenE.indexOf(eDefs[ei].id) >= 0) eNames.push(eDefs[ei].name);
        else eLeft++;
      }
      var eLines = [], li;
      for (li = 0; li < eNames.length; li += 4) eLines.push(eNames.slice(li, li + 4).join(' · '));
      if (eLeft > 0) eLines.push('还有 ' + eLeft + ' 种未遭遇');
      if (!eLines.length) eLines.push('尚未遭遇');
      var lineY = rowY + fs(30);
      for (li = 0; li < eLines.length; li++) {
        text(ctx, '· ' + eLines[li], ax, lineY + li * fs(14), 9, 'rgba(139,149,163,0.75)', 'left', false);
      }

      text(ctx, '存活最佳 ' + U.fmt(d.bestTime) + '   最高等级 ' + d.bestLevel +
        '   单局击杀 ' + d.bestKills + '   进化 ' + d.evolutions,
        ax, lineY + eLines.length * fs(14) + fs(6), 10, C.dim, 'left');
    }

    button(g, ctx, 'back', W * 0.34, H * 0.925, W * 0.32, fs(38), '返回', 'ghost', true);

    if (g.noticeT > 0) {
      text(ctx, g.noticeText, W / 2, H * 0.875, 12, C.gold, 'center');
    }
  };

  /* ---------------- 设置 ---------------- */

  function switchBox(ctx, x, y, w, h, on, color) {
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = on ? U.rgba(color, 0.80) : 'rgba(255,255,255,0.10)';
    ctx.fill();
    if (on) {
      rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
      ctx.strokeStyle = U.rgba(color, 0.9);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    var k = Math.max(3, h / 2 - fs(2));
    ctx.beginPath();
    ctx.arc(on ? x + w - h / 2 : x + h / 2, y + h / 2, k, 0, U.TAU);
    ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.45)';
    ctx.fill();
  }

  function sectLabel(ctx, x, y, label) {
    var tw = measure(ctx, label, 10, false);
    text(ctx, label, x, y, 10, 'rgba(139,149,163,0.72)', 'left', false);
    var lx = Math.round(x + tw + fs(10));
    var end = Math.round(P.W - P.W * 0.06 - fs(4));
    if (end > lx + fs(10)) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(lx, Math.round(y), end - lx, 1);
    }
  }

  /** 一行设置：左边图标+标题+说明，右边交给调用方画控件 */
  function setRow(ctx, x, y, w, h, iconId, title, sub, color) {
    panel(ctx, x, y, w, h, fs(12), 'rgba(255,255,255,0.042)', 'rgba(255,255,255,0.07)');
    var cx = x + fs(27), cy = y + h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, fs(17), 0, U.TAU);
    ctx.fillStyle = U.rgba(color || C.text, 0.10);
    ctx.fill();
    icon(ctx, iconId, cx, cy, fs(24), color || C.text);
    text(ctx, title, x + fs(50), y + fs(19), 13, C.text, 'left', true);
    text(ctx, sub, x + fs(50), y + fs(35), 9.2, C.dim, 'left', false);
  }

  UI.settings = function (g) {
    var ctx = P.ctx, W = P.W, H = P.H;
    bg(ctx, g);

    /* 压暗背景，但越往下越透，避免下半屏闷成一块黑 */
    var scrim = ctx.createLinearGradient(0, 0, 0, H);
    scrim.addColorStop(0, 'rgba(6,8,12,0.88)');
    scrim.addColorStop(0.58, 'rgba(6,8,12,0.82)');
    scrim.addColorStop(1, 'rgba(6,8,12,0.52)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, H);

    var top = Math.max(fs(22), P.safeTop + fs(12));
    var bh = fs(32);

    /* 返回 */
    g.hits.push({ id: 'back', x: fs(10), y: top - fs(6), w: fs(74), h: bh + fs(12) });
    icon(ctx, 'chevronL', fs(20), top + bh / 2, fs(15), C.text);
    text(ctx, '返回', fs(31), top + bh / 2 + 1, 12.5, C.text, 'left', false);
    text(ctx, '设置', W / 2, top + bh / 2 + 1, 17, C.text, 'center', true);

    var rx = W * 0.06, rw = W * 0.88;
    var rh = fs(52);
    var y = top + bh + fs(24);

    /* --- 游戏 --- */
    sectLabel(ctx, rx + fs(4), y, '游戏');
    y += fs(16);

    setRow(ctx, rx, y, rw, rh, g.sfxOn ? 'sound' : 'mute', '音效',
      '枪声、爆炸与拾取提示音', g.sfxOn ? C.green : C.dim);
    g.hits.push({ id: 'set:sfx', x: rx, y: y, w: rw, h: rh });
    switchBox(ctx, rx + rw - fs(56), y + rh / 2 - fs(11), fs(44), fs(22), g.sfxOn, C.green);

    y += rh + fs(10);
    setRow(ctx, rx, y, rw, rh, g.bgmOn ? 'music' : 'mute', '背景音乐',
      '仅标题与菜单页播放的循环配乐', g.bgmOn ? C.green : C.dim);
    g.hits.push({ id: 'set:bgm', x: rx, y: y, w: rw, h: rh });
    switchBox(ctx, rx + rw - fs(56), y + rh / 2 - fs(11), fs(44), fs(22), g.bgmOn, C.green);

    y += rh + fs(10);
    setRow(ctx, rx, y, rw, rh, 'vibrate', '震动反馈',
      '受击、碾压、升级时的短震动', g.vibOn ? C.blue : C.dim);
    g.hits.push({ id: 'set:vib', x: rx, y: y, w: rw, h: rh });
    switchBox(ctx, rx + rw - fs(56), y + rh / 2 - fs(11), fs(44), fs(22), g.vibOn, C.blue);

    y += rh + fs(10);
    setRow(ctx, rx, y, rw, rh, 'gauge', '画面特效',
      g.fxLow ? '低配：关闭镜头抖动与污渍' : '高：完整抖动、污渍与粒子', g.fxLow ? C.dim : C.gold);
    g.hits.push({ id: 'set:fx', x: rx, y: y, w: rw, h: rh });
    var fxLabel = g.fxLow ? '低' : '高';
    var fxColor = g.fxLow ? C.dim : C.gold;
    var fxw = fs(44);
    rr(ctx, rx + rw - fxw - fs(12), y + rh / 2 - fs(11), fxw, fs(22), fs(11));
    ctx.fillStyle = g.fxLow ? 'rgba(255,255,255,0.08)' : 'rgba(255,209,102,0.16)';
    ctx.fill();
    text(ctx, fxLabel, rx + rw - fxw / 2 - fs(12), y + rh / 2 + 1, 12, fxColor, 'center', true);

    /* --- 操作（矮屏放不下就跳过，优先保证上面的设置项） --- */
    y += rh + fs(28);
    if (H > fs(700)) {
      sectLabel(ctx, rx + fs(4), y, '操作');
      y += fs(24);

      var tips = [
        ['步行', '拖动屏幕移动，武器自动开火'],
        ['交互', '右下圆钮：搜刮 / 上楼 / 跳下 / 上下车'],
        ['驾驶', '摇杆指哪开哪，推得越远速度越快']
      ];
      for (var ti = 0; ti < tips.length; ti++) {
        var ty2 = y + ti * fs(23);
        text(ctx, tips[ti][0], rx + fs(4), ty2, 10, 'rgba(233,238,245,0.72)', 'left', true);
        text(ctx, tips[ti][1], rx + fs(44), ty2, 10, C.dim, 'left', false);
      }
      y += fs(23) * (tips.length - 1) + fs(30);
    }

    /* --- 存档 --- */
    sectLabel(ctx, rx + fs(4), y, '存档');
    y += fs(16);

    var d = HS.Save.data;
    panel(ctx, rx, y, rw, fs(50), fs(12), 'rgba(255,255,255,0.042)', 'rgba(255,255,255,0.07)');
    var stats = [
      ['最佳存活', U.fmt(d.bestTime)],
      ['通关', d.wins + ' 次'],
      ['金币', String(d.gold)]
    ];
    for (var si = 0; si < 3; si++) {
      var sx = rx + rw * (si + 0.5) / 3;
      text(ctx, stats[si][0], sx, y + fs(17), 9, C.dim, 'center', false);
      text(ctx, stats[si][1], sx, y + fs(34), 13, C.text, 'center', true);
    }

    y += fs(58);
    button(g, ctx, 'wipe', rx, y, rw, fs(42), '清除存档', 'danger', true, 'trash');

    /* --- 关于 --- */
    y += fs(60);
    sectLabel(ctx, rx + fs(4), y, '关于');
    y += fs(20);

    text(ctx, '公路幸存者：死区  v' + (HS.VERSION || '1.0.0'), rx + fs(4), y, 11.5, C.text, 'left', false);
    text(ctx, '美术与音效由代码程序化生成，背景音乐为外部音频。', rx + fs(4), y + fs(22), 9.2, C.dim, 'left', false);
    text(ctx, '拖动屏幕移动，武器自动开火；靠近破车可以上车碾压。', rx + fs(4), y + fs(41), 9.2, C.dim, 'left', false);

    /* --- 记录（底部还剩多少空间就画多少，矮屏直接让位） --- */
    y += fs(70);
    if (y + fs(96) < H - fs(56)) {
      sectLabel(ctx, rx + fs(4), y, '记录');
      y += fs(16);
      panel(ctx, rx, y, rw, fs(74), fs(12), 'rgba(255,255,255,0.042)', 'rgba(255,255,255,0.07)');

      var charTotal = 0, ck;
      for (ck in D.chars) if (D.chars.hasOwnProperty(ck)) charTotal++;

      var rec = [
        ['总局数', d.runs + ' 局'],
        ['最高等级', 'Lv.' + (d.bestLevel || 1)],
        ['单局击杀', String(d.bestKills || 0)],
        ['解锁角色', (d.chars ? d.chars.length : 1) + '/' + charTotal]
      ];
      for (var ri = 0; ri < 4; ri++) {
        var col = ri % 2, line = (ri - col) / 2;
        var rxp = rx + rw * (col + 0.5) / 2;
        var ryp = y + fs(15) + line * fs(31);
        text(ctx, rec[ri][0], rxp, ryp, 9, C.dim, 'center', false);
        text(ctx, rec[ri][1], rxp, ryp + fs(14), 12, C.text, 'center', true);
      }
    }

    /* 底部落款：给下半屏一个收尾，顺便说清这是个纯本地游戏 */
    text(ctx, '不需要联网 · 全部内容在本机生成', W / 2, H - fs(46), 9.5,
      'rgba(139,149,163,0.32)', 'center', false);

    if (g.noticeT > 0) {
      text(ctx, g.noticeText, W / 2, H * 0.9, 12, C.gold, 'center');
    }

    /* ---- 清除存档二次确认（盖住整屏，所以清空命中区） ---- */
    if (g.wipeAsk) {
      g.hits.length = 0;
      ctx.fillStyle = 'rgba(4,6,9,0.84)';
      ctx.fillRect(0, 0, W, H);

      var mw = W * 0.80, mh = fs(224);
      var mx = (W - mw) / 2, my = (H - mh) / 2;
      panel(ctx, mx, my, mw, mh, fs(18), 'rgba(26,20,20,0.98)', 'rgba(255,90,60,0.45)');
      icon(ctx, 'trash', W / 2, my + fs(38), fs(28), '#ff6b5a');
      text(ctx, '清除所有存档？', W / 2, my + fs(74), 16, C.text, 'center', true);
      text(ctx, '金币、角色、地图、成就和全部记录都会归零，', W / 2, my + fs(98), 9.8, C.dim, 'center', false);
      text(ctx, '这个操作没法撤销。', W / 2, my + fs(114), 9.8, C.dim, 'center', false);
      button(g, ctx, 'wipe:yes', mx + fs(18), my + fs(134), mw - fs(36), fs(42), '确认清除', 'primary');
      button(g, ctx, 'wipe:no', mx + fs(18), my + fs(184), mw - fs(36), fs(34), '算了', 'ghost', true);
    }
  };

  /* ---------------- HUD ---------------- */

  /** HUD 装备槽 */
  function slotBox(ctx, x, y, w, h, color, filled) {
    rr(ctx, x, y, w, h, fs(5));
    ctx.fillStyle = filled ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.26)';
    ctx.fill();
    ctx.strokeStyle = filled ? U.rgba(color || '#888', 0.55) : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * 空投 / 补给箱的短时位置指引。
   * 屏幕内：在箱子上方画一个脉冲的金色菱形（和搜刮点的菱形同一套视觉语言）；
   * 屏幕外：贴到屏幕边缘，加一个指向箭头 + 「空投」标签。
   * 只在这个掉落物挂着 hintT 时出现，落地几秒后自动消失。
   */
  function dropGuides(ctx, g) {
    var run = g.run;
    if (!run || !run.drops || !run.drops.length) return;
    var W = P.W, H = P.H;
    var sc = W / P.VW;                       // 屏幕像素 / 世界单位
    var padX = fs(26), padTop = fs(86), padBot = fs(96);
    var t = g.t || 0;

    for (var i = 0; i < run.drops.length; i++) {
      var d = run.drops[i];
      if (d.dead || !(d.hintT > 0)) continue;

      var sx = (d.x - P.camX) * sc;
      var sy = (d.y - P.camY) * sc;
      var k = Math.min(1, d.hintT / (d.hintMax || 6));
      var pulse = 0.62 + 0.38 * Math.sin(t * 8);
      var inside = sx > padX && sx < W - padX && sy > padTop && sy < H - padBot;
      var tx = Math.max(padX, Math.min(W - padX, sx));
      var ty = Math.max(padTop, Math.min(H - padBot, sy));
      var oy = inside ? ty - fs(20) : ty;

      ctx.globalAlpha = Math.min(1, k * 1.6) * pulse;

      /* 屏幕外：先画一个指向真实方向的箭头 */
      if (!inside) {
        var a = Math.atan2(sy - ty, sx - tx);
        ctx.save();
        ctx.translate(tx + Math.cos(a) * fs(14), ty + Math.sin(a) * fs(14));
        ctx.rotate(a);
        ctx.fillStyle = C.gold;
        ctx.beginPath();
        ctx.moveTo(fs(7), 0);
        ctx.lineTo(fs(-2), fs(-5));
        ctx.lineTo(fs(-2), fs(5));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      /* 菱形标记（带一圈深色描边，压在任何地面上都看得见） */
      var s = fs(6) * (0.85 + 0.15 * pulse);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.moveTo(tx, oy - s - 1.6);
      ctx.lineTo(tx + s + 1.6, oy);
      ctx.lineTo(tx, oy + s + 1.6);
      ctx.lineTo(tx - s - 1.6, oy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.moveTo(tx, oy - s);
      ctx.lineTo(tx + s, oy);
      ctx.lineTo(tx, oy + s);
      ctx.lineTo(tx - s, oy);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 1;
      if (!inside) text(ctx, '空投', tx, oy - fs(13), 8.5, C.gold, 'center', true);
    }
  }

  UI.hud = function (g) {
    var ctx = P.ctx, run = g.run, p = run.p;
    var W = P.W, H = P.H;
    var top = Math.max(fs(12), P.safeTop + fs(6));

    /* 受伤红晕 */
    if (p.hurtT > 0) {
      var a = p.hurtT / 0.3 * 0.32;
      var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.62);
      vg.addColorStop(0, 'rgba(255,0,0,0)');
      vg.addColorStop(1, 'rgba(255,20,20,' + a.toFixed(3) + ')');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    /* 低血量 */
    if (p.hp / p.maxHp < 0.3) {
      var pulse = 0.10 + 0.07 * Math.sin(P.isNode ? 0 : g.t * 6);
      var vg2 = ctx.createRadialGradient(W / 2, H / 2, H * 0.16, W / 2, H / 2, H * 0.6);
      vg2.addColorStop(0, 'rgba(255,0,0,0)');
      vg2.addColorStop(1, 'rgba(200,20,20,' + pulse.toFixed(3) + ')');
      ctx.fillStyle = vg2;
      ctx.fillRect(0, 0, W, H);
    }

    /* 血条 */
    var hw = W * 0.42, hh = fs(11);
    var hx = fs(14), hy = top + fs(14);
    rr(ctx, hx, hy, hw, hh, hh / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    var ratio = Math.max(0, p.hp / p.maxHp);
    if (ratio > 0) {
      rr(ctx, hx, hy, Math.max(hh, hw * ratio), hh, hh / 2);
      var hg = ctx.createLinearGradient(hx, 0, hx + hw, 0);
      hg.addColorStop(0, ratio < 0.3 ? '#ff4d4d' : '#ff7a5c');
      hg.addColorStop(1, ratio < 0.3 ? '#c0392b' : '#e03e28');
      ctx.fillStyle = hg;
      ctx.fill();
    }
    text(ctx, Math.ceil(p.hp) + ' / ' + Math.round(p.maxHp), hx + hw / 2, hy + hh / 2 + 0.5, 9, '#fff', 'center');

    /* 等级 */
    text(ctx, 'Lv.' + p.level, hx, hy + hh + fs(13), 12, C.gold, 'left', true);

    /* 武器图标 */
    var wx = hx;
    var wy = hy + hh + fs(24);
    if (p.veh) {
      /* 驾驶中：武器全部收起，这一行换成车体耐久 */
      var vw = W * 0.42, vhh = fs(11);
      var vr = Math.max(0, Math.min(1, p.veh.dur / p.veh.maxDur));
      rr(ctx, wx, wy, vw, vhh, vhh / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
      if (vr > 0) {
        rr(ctx, wx, wy, Math.max(vhh, vw * vr), vhh, vhh / 2);
        var vg2 = ctx.createLinearGradient(wx, 0, wx + vw, 0);
        vg2.addColorStop(0, vr > 0.5 ? '#8ce99a' : (vr > 0.25 ? '#ffd166' : '#ff6b5a'));
        vg2.addColorStop(1, vr > 0.5 ? '#4f9e63' : (vr > 0.25 ? '#c99a2e' : '#c0392b'));
        ctx.fillStyle = vg2;
        ctx.fill();
      }
      text(ctx, Math.ceil(p.veh.dur) + ' / ' + Math.round(p.veh.maxDur), wx + vw / 2, wy + vhh / 2 + 0.5, 9, '#fff', 'center');
      text(ctx, p.veh.def.name + ' · 武器收起', wx, wy + vhh + fs(12), 9.5,
        vr < 0.25 ? '#ff8a70' : 'rgba(255,209,102,0.8)', 'left', false);
      if (vr < 0.25) {
        var warnA = 0.55 + 0.45 * Math.sin(P.isNode ? 0 : g.t * 8);
        ctx.globalAlpha = warnA;
        text(ctx, '即将报废', wx + vw + fs(6), wy + vhh / 2, 9, '#ff5a5a', 'left', true);
        ctx.globalAlpha = 1;
      }
    } else {
      /* 手持槽：主 / 副两格；重型武器占满一格宽 */
      var mainE = null, subE = null, hvyE = null;
      for (var i = 0; i < p.weapons.length; i++) {
        var we = p.weapons[i];
        if (we.slot === 'heavy') hvyE = we;
        else if (we.slot === 'sub') subE = we;
        else mainE = we;
      }

      var slotH = fs(26), slotY = wy - fs(4);
      if (hvyE) {
        var hd = HS.Data.gear[hvyE.id];
        slotBox(ctx, wx, slotY, fs(56), slotH, hd.color, true);
        icon(ctx, hd.icon, wx + fs(13), slotY + slotH / 2, fs(15), hd.color);
        text(ctx, '重型', wx + fs(25), slotY + fs(9), 6.5, C.gold, 'left', true);
        text(ctx, 'Lv' + hvyE.lvl, wx + fs(25), slotY + fs(18), 6.5, 'rgba(233,238,245,0.7)', 'left');
      } else {
        slotBox(ctx, wx, slotY, fs(26), slotH, mainE ? HS.Data.gear[mainE.id].color : '#4a515c', !!mainE);
        if (mainE) {
          var md = HS.Data.gear[mainE.id];
          icon(ctx, md.icon, wx + fs(13), slotY + slotH / 2, fs(15), md.color);
          text(ctx, mainE.evolved ? 'M' : String(mainE.lvl), wx + fs(21), slotY + fs(21), 7, C.gold, 'center');
        } else {
          text(ctx, '主', wx + fs(13), slotY + slotH / 2, 9, 'rgba(255,255,255,0.22)', 'center');
        }

        var sx2 = wx + fs(30);
        slotBox(ctx, sx2, slotY, fs(26), slotH, subE ? HS.Data.gear[subE.id].color : '#4a515c', !!subE);
        if (subE) {
          var sd = HS.Data.gear[subE.id];
          icon(ctx, sd.icon, sx2 + fs(13), slotY + slotH / 2, fs(15), sd.color);
          text(ctx, String(subE.lvl), sx2 + fs(21), slotY + fs(21), 7, C.gold, 'center');
        } else {
          text(ctx, '副', sx2 + fs(13), slotY + slotH / 2, 9, 'rgba(255,255,255,0.22)', 'center');
        }
      }

      /* 自动装备行：小图标 + 等级点，超过 6 件时显示 +N */
      if (p.autos && p.autos.length) {
        var ax2 = wx + fs(62);
        var ay2 = slotY + fs(7);
        var shown = Math.min(6, p.autos.length);
        for (var j = 0; j < shown; j++) {
          var ad = HS.Data.gear[p.autos[j].id];
          if (!ad) continue;
          var abx = ax2 + j * fs(16);
          rr(ctx, abx - fs(6), slotY + fs(5), fs(13), fs(13), fs(3.5));
          ctx.fillStyle = 'rgba(0,0,0,0.34)';
          ctx.fill();
          icon(ctx, ad.icon, abx, ay2, fs(9), ad.color);
          text(ctx, String(p.autos[j].lvl), abx + fs(4), ay2 + fs(5.5), 5.5, 'rgba(255,255,255,0.55)', 'center');
        }
        if (p.autos.length > shown) {
          text(ctx, '+' + (p.autos.length - shown), ax2 + shown * fs(15), ay2, 8, C.dim, 'left');
        }
      }
    }

    /* 计时 */
    var timeLeft = Math.max(0, HS.RUN_TIME - run.t);
    text(ctx, run.bossSpawned ? 'BOSS' : U.fmt(run.endless ? run.t : timeLeft), W / 2, top + fs(18), 19,
      run.bossSpawned ? '#ff5a5a' : C.text, 'center', true);
    text(ctx, (run.endless ? '无尽 · ' : '') + '击杀 ' + run.kills, W / 2, top + fs(38), 9.5, C.dim, 'center');

    /* 所在位置：楼内 / 楼顶 */
    if (p.roof) {
      text(ctx, '楼顶 · ' + (p.roof.floors || 2) + ' 层', W / 2, top + fs(54), 9,
        p.hp / p.maxHp < 0.35 ? C.gold : '#ffb08a', 'center');
    } else if (run.insideBld) {
      text(ctx, '室内 · ' + run.insideBld.doors.length + ' 个出口', W / 2, top + fs(54), 9,
        'rgba(255,209,102,0.8)', 'center');
    }

    /* 暂停按钮 */
    var pb = fs(34);
    rr(ctx, W - fs(14) - pb, top + fs(6), pb, pb, fs(9));
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.fillRect(W - fs(14) - pb + fs(11), top + fs(6) + fs(11), fs(4), fs(12));
    ctx.fillRect(W - fs(14) - pb + fs(20), top + fs(6) + fs(11), fs(4), fs(12));
    g.hits.push({ id: 'pause', x: W - fs(14) - pb, y: top + fs(6), w: pb, h: pb });

    /* 经验条 */
    var xpY = H - fs(8);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, xpY, W, fs(8));
    var xr = Math.min(1, p.xp / p.xpNext);
    var xg = ctx.createLinearGradient(0, 0, W, 0);
    xg.addColorStop(0, '#7ee8fa');
    xg.addColorStop(1, '#4dabf7');
    ctx.fillStyle = xg;
    ctx.fillRect(0, xpY, W * xr, fs(8));
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, xpY, W * xr, fs(2));

    /* Boss 血条（底部，避开顶部 HUD） */
    if (run.boss && !run.boss.dead) {
      var bw = W * 0.7, bh = fs(9);
      var bx2 = (W - bw) / 2, by2 = H - fs(46);
      rr(ctx, bx2, by2, bw, bh, bh / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fill();
      var br = Math.max(0, run.boss.hp / run.boss.maxHp);
      if (br > 0) {
        rr(ctx, bx2, by2, Math.max(bh, bw * br), bh, bh / 2);
        var bg2 = ctx.createLinearGradient(bx2, 0, bx2 + bw, 0);
        bg2.addColorStop(0, '#ff2d2d');
        bg2.addColorStop(1, '#8b0000');
        ctx.fillStyle = bg2;
        ctx.fill();
      }
      /* 名字必须跟着当前这张图的首领走 —— 写死会让第二 / 第三关的 Boss
         顶着"血肉暴君"的头衔打加特林，玩家只会以为选错了关卡 */
      var bossNm = (run.boss.def && run.boss.def.name) || '区域首领';
      text(ctx, bossNm, W / 2, by2 - fs(9), 10, '#ff8a8a', 'center', true);
    }

    /* 右下交互区：搜刮 / 上楼 / 下楼 / 跳下（从下往上叠） */
    if (run.search) {
      var spw = W * 0.52, spx = (W - spw) / 2, spy = H - fs(44);
      rr(ctx, spx, spy, spw, fs(9), fs(4.5));
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fill();
      var spr2 = Math.min(1, run.search.t / run.search.dur);
      rr(ctx, spx, spy, Math.max(fs(9), spw * spr2), fs(9), fs(4.5));
      ctx.fillStyle = C.gold;
      ctx.fill();
      text(ctx, '搜刮中…  移动或挨打会中断', W / 2, spy - fs(11), 10, C.gold, 'center');
    } else {
      var bs = fs(52);
      var actX = W - fs(18) - bs;
      var actY = H - fs(76) - bs;

      /* 载具优先：上车 / 下车 */
      if (p.veh) {
        circleAction(g, ctx, 'exitveh', actX, actY, bs, '下车', '车留在原地', C.gold);
        actY -= bs + fs(10);
      } else if (run.nearVeh) {
        var nv = run.nearVeh;
        var npct = Math.max(0, Math.round(nv.dur / nv.maxDur * 100));
        circleAction(g, ctx, 'drive', actX, actY, bs, '驾驶', npct + '% 耐久', nv.def.color);
        actY -= bs + fs(10);
      }

      if (run.lootTarget) {
        var lcx = actX + bs / 2, lcy = actY + bs / 2;
        var lt = run.lootTarget;
        var dur = lt.isRoofCrate ? '1.6s' : (lt.isFurn ? '1.2s' : '1.4s');
        ctx.beginPath();
        ctx.arc(lcx, lcy, bs / 2, 0, U.TAU);
        ctx.fillStyle = 'rgba(255,209,102,0.94)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        text(ctx, '搜刮', lcx, lcy - fs(4), 13, '#2a1e08', 'center', true);
        text(ctx, dur, lcx, lcy + fs(11), 8.5, 'rgba(42,30,8,0.7)', 'center');
        g.hits.push({ id: 'loot', x: actX, y: actY, w: bs, h: bs });
        actY -= bs + fs(10);
      }

      if (p.roof) {
        if (run.roofHatch) {
          circleAction(g, ctx, 'stairs', actX, actY, bs, '下楼', '室内', C.blue);
          actY -= bs + fs(10);
        }
        if (run.jumpDir) {
          var fd = HS.Game.fallDamage ? HS.Game.fallDamage(p, p.roof) : Math.max(4, Math.round(p.maxHp * 0.12));
          circleAction(g, ctx, 'jump', actX, actY, bs, '跳下', '-' + fd + ' HP', '#ff8a70', true);
          actY -= bs + fs(10);
        }
      } else if (run.stairTarget) {
        circleAction(g, ctx, 'stairs', actX, actY, bs, '上楼',
          (run.stairTarget.floors || 2) + ' 层', C.blue);
        actY -= bs + fs(10);
      }
    }

    /* 空投 / 补给箱的短时位置指引（画在横幅下面） */
    if (g.state === 'run') dropGuides(ctx, g);

    /* 局内横幅 */
    if (g.bannerT > 0) {
      var ba = Math.min(1, g.bannerT * 2);
      ctx.globalAlpha = ba;
      /* 文案长短差很远（"驾驶 锈蚀轿车 · 武器收起，只能靠撞" 一行顶满屏），
         按可用宽度反推字号，别让两端被裁掉 */
      var bsize = 20;
      var bmax = W * 0.9;
      while (bsize > 11 && measure(ctx, g.banner, bsize, true) > bmax) bsize--;
      text(ctx, g.banner, W / 2, H * 0.26, bsize, '#ffb08a', 'center', true);
      ctx.fillStyle = 'rgba(255,90,60,' + (0.6 * ba).toFixed(2) + ')';
      ctx.fillRect(W / 2 - fs(40), H * 0.26 + fs(18), fs(80), 1.5);
      ctx.globalAlpha = 1;
    }

    /* 摇杆 */
    UI.joystick(g);
  };

  UI.joystick = function (g) {
    var I = HS.Input;
    if (!I.joy.active || I.joy.mag <= 0) return;
    var ctx = P.ctx;
    var ox = I.joy.ox, oy = I.joy.oy;
    var r = I.joyR;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox, oy, r, 0, U.TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.arc(ox, oy, r, 0, U.TAU);
    ctx.fill();

    var kx = ox + I.joy.dx * I.joy.mag * r;
    var ky = oy + I.joy.dy * I.joy.mag * r;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(kx, ky, fs(18), 0, U.TAU);
    ctx.fill();
  };

  /** 把长文案折成两行（中文按字断行），超出部分用省略号收尾 */
  function wrap2(ctx, str, maxW, size) {
    if (measure(ctx, str, size, false) <= maxW) return [str, ''];
    var cut = str.length;
    for (var i = 1; i <= str.length; i++) {
      if (measure(ctx, str.substring(0, i), size, false) > maxW) { cut = i - 1; break; }
    }
    var l1 = str.substring(0, cut);
    var rest = str.substring(cut);
    if (measure(ctx, rest, size, false) <= maxW) return [l1, rest];
    var cut2 = rest.length;
    for (var j = 1; j <= rest.length; j++) {
      if (measure(ctx, rest.substring(0, j), size, false) > maxW) { cut2 = j - 1; break; }
    }
    return [l1, rest.substring(0, Math.max(0, cut2 - 1)) + '…'];
  }

  /* ---------------- 升级三选一 ---------------- */

  UI.levelUp = function (g) {
    var ctx = P.ctx, W = P.W, H = P.H, run = g.run;

    ctx.fillStyle = 'rgba(6,8,12,0.82)';
    ctx.fillRect(0, 0, W, H);

    text(ctx, '等级提升', W / 2, H * 0.105, 24, C.text, 'center', true);
    text(ctx, 'Lv.' + run.p.level + '    选择一项强化', W / 2, H * 0.14, 11.5, C.dim, 'center', false);

    var cw = W * 0.86, cx = (W - cw) / 2;
    var chh = fs(112), gap = fs(11);
    var totalH = run.choices.length * (chh + gap) - gap;
    var top = Math.max(H * 0.18, (H - totalH) / 2 + fs(14));

    for (var i = 0; i < run.choices.length; i++) {
      var c = run.choices[i];
      var y = top + i * (chh + gap);
      var rare = c.rare;

      panel(ctx, cx, y, cw, chh, 16,
        rare ? 'rgba(255,209,102,0.12)' : 'rgba(255,255,255,0.055)',
        rare ? 'rgba(255,209,102,0.75)' : C.line);

      if (rare) {
        ctx.fillStyle = 'rgba(255,209,102,0.06)';
        rr(ctx, cx - 4, y - 4, cw + 8, chh + 8, 18);
        ctx.fill();
      }

      /* 图标槽：12x12 点阵按 2 屏幕像素一格，方块感最正 */
      badge(ctx, cx + fs(40), y + chh / 2, fs(28), c.color, rare);
      icon(ctx, c.icon, cx + fs(40), y + chh / 2, fs(24), c.color);

      text(ctx, c.name, cx + fs(78), y + fs(30), 17, rare ? C.gold : C.text, 'left', true);
      text(ctx, c.sub, cx + fs(78), y + fs(52), 10, rare ? C.gold : C.dim, 'left', false);
      var descW = cw - fs(78) - fs(22);
      var dl = wrap2(ctx, c.desc, descW, 10.5);
      text(ctx, dl[0], cx + fs(78), y + fs(74), 10.5, 'rgba(233,238,245,0.8)', 'left', false);
      if (dl[1]) {
        text(ctx, dl[1], cx + fs(78), y + fs(88), 10.5, 'rgba(233,238,245,0.8)', 'left', false);
      } else if (c.hint) {
        text(ctx, c.hint, cx + fs(78), y + fs(90), 8.5, 'rgba(139,149,163,0.9)', 'left', false);
      }

      /* 来源标签：让玩家一眼分清通用 / 专属 / 联动 / 进化 */
      var srcName = c.src || (c.kind === 'evolve' ? '进化' : (c.kind === 'synergy' ? '装备联动'
        : (c.kind === 'gearUp' ? '武器专属' : (c.kind === 'weaponNew' || c.kind === 'autoNew' ? '新装备' : '通用属性'))));
      var srcColor = (c.kind === 'evolve' || c.kind === 'evoPrep') ? C.gold
        : (c.kind === 'synergy' ? '#b197fc'
        : (c.kind === 'gearUp' || c.kind === 'gearLevel' ? '#8ecae6'
        : (c.kind === 'weaponNew' || c.kind === 'autoNew' ? '#ff9f43' : '#8ce99a')));
      var tagW = measure(ctx, srcName, 8, false) + fs(12);
      rr(ctx, cx + cw - fs(14) - tagW, y + fs(12), tagW, fs(15), fs(7.5));
      ctx.fillStyle = U.rgba(srcColor, 0.16);
      ctx.fill();
      text(ctx, srcName, cx + cw - fs(14) - tagW / 2, y + fs(19.5), 8, srcColor, 'center');

      /* 键盘提示 */
      text(ctx, String(i + 1), cx + cw - fs(18), y + fs(40), 10, 'rgba(255,255,255,0.22)', 'center');

      g.hits.push({ id: 'card:' + i, x: cx, y: y, w: cw, h: chh });
    }

    if (run.choices.length === 0) {
      text(ctx, '没有可用选项', W / 2, H * 0.5, 14, C.dim, 'center');
    }

    /* 重抽：位置放在最后一张卡下面，和卡片彻底错开，不会互相吞点击 */
    var left = run.p.reroll || 0;
    if (left > 0 && run.choices.length) {
      var rw = fs(112), rh = fs(30);
      var rx = (W - rw) / 2, ry = Math.min(H - fs(46), top + totalH + fs(14));
      panel(ctx, rx, ry, rw, rh, rh / 2, 'rgba(255,255,255,0.07)', C.line);
      /* 文案按胶囊正中排：textBaseline 已经是 middle，再加偏移会明显偏下 */
      text(ctx, '重抽 · 剩 ' + left, rx + rw / 2, ry + rh / 2, 10.5, C.dim, 'center', true);
      g.hits.push({ id: 'reroll', x: rx, y: ry, w: rw, h: rh });
    }

    /* 副武器替换确认：盖住整屏，先清空底层可点区域，避免点穿到卡片上 */
    if (g.confirm) {
      var cc = g.confirm.card;
      var curE = HS.Gear.subEntry(run.p);
      var curD = curE ? D.gear[curE.id] : null;
      var nUp = 0, uk;
      if (curE && curE.up) {
        for (uk in curE.up) {
          if (curE.up[uk]) nUp += curE.up[uk];
        }
      }
      g.hits.length = 0;

      ctx.fillStyle = 'rgba(6,8,12,0.74)';
      ctx.fillRect(0, 0, W, H);

      var mw = W * 0.84, mx = (W - mw) / 2;
      var mh = fs(198), my = Math.round((H - mh) / 2);
      panel(ctx, mx, my, mw, mh, 16, 'rgba(26,19,17,0.96)', 'rgba(255,138,90,0.6)');

      text(ctx, '替换副武器？', W / 2, my + fs(30), 17, '#ffb36b', 'center', true);
      if (curD) {
        text(ctx, '当前：' + curD.name + ' Lv' + curE.lvl +
          (nUp ? '（已点 ' + nUp + ' 级分支）' : ''),
          W / 2, my + fs(62), 11, C.text, 'center', false);
      }
      text(ctx, '换成：' + cc.name + ' Lv1', W / 2, my + fs(86), 11, C.gold, 'center', false);
      text(ctx, '旧武器上点过的专属分支会全部清空', W / 2, my + fs(112), 10, C.dim, 'center', false);
      text(ctx, '副武器可以随升级反复替换', W / 2, my + fs(130), 9.5, 'rgba(139,149,163,0.85)', 'center', false);

      var bw2 = mw * 0.4, gap2 = mw * 0.08;
      var by2 = my + mh - fs(54);
      button(g, ctx, 'swap:no', mx + mw * 0.06, by2, bw2, fs(38), '取消', 'ghost');
      button(g, ctx, 'swap:yes', mx + mw * 0.06 + bw2 + gap2, by2, bw2, fs(38), '确认替换', 'danger');
    }
  };

  /* ---------------- 搜刮翻到主武器 ---------------- */

  /**
   * 搜刮 / 空投里翻到一把主武器时问一句。
   * 换掉会清空当前武器的等级与分支，是这一局里唯一还能改主武器的机会，
   * 所以不能像普通补给那样直接生效。
   */
  UI.lootAsk = function (g) {
    var ctx = P.ctx, W = P.W, H = P.H, run = g.run, p = run.p;
    var c = g.lootAsk;
    if (!c) return;
    var nd = D.gear[c.id];
    if (!nd) return;

    ctx.fillStyle = 'rgba(6,8,12,0.8)';
    ctx.fillRect(0, 0, W, H);
    g.hits.length = 0;

    var pw = W * 0.86, px = (W - pw) / 2;
    var ph = fs(232), py = Math.round((H - ph) / 2);
    panel(ctx, px, py, pw, ph, 16, 'rgba(22,20,16,0.97)', 'rgba(255,209,102,0.6)');

    text(ctx, '搜刮到主武器', W / 2, py + fs(26), 16, C.gold, 'center', true);
    text(ctx, (g.lootFrom || '搜刮') + '翻出一把还能用的主武器', W / 2, py + fs(46), 9.5, C.dim, 'center', false);

    /* 新武器 */
    var iy = py + fs(80);
    badge(ctx, px + fs(38), iy, fs(24), nd.color, nd.rarity >= 4);
    icon(ctx, nd.icon, px + fs(38), iy, fs(20), nd.color);
    text(ctx, nd.name + '  Lv1', px + fs(66), iy - fs(5), 14, C.text, 'left', true);
    text(ctx, '主武器 · ' + nd.cat, px + fs(66), iy + fs(11), 9.5, C.dim, 'left', false);
    var dl = wrap2(ctx, nd.desc || '', pw - fs(88), 9.5);
    text(ctx, dl[0], px + fs(66), iy + fs(28), 9.5, 'rgba(233,238,245,0.8)', 'left', false);

    /* 当前主武器：把"会失去什么"写清楚 */
    var cur = HS.Gear.mainEntry(p);
    var cy = py + fs(146);
    if (cur) {
      var cd = D.gear[cur.id];
      var nUp = 0, uk;
      if (cur.up) {
        for (uk in cur.up) {
          if (cur.up[uk]) nUp += cur.up[uk];
        }
      }
      text(ctx, '当前：' + cd.name + ' Lv' + cur.lvl + (nUp ? '（已点分支 ' + nUp + ' 级）' : ''),
        W / 2, cy, 10.5, C.text, 'center', false);
      text(ctx, '换掉会连等级和分支一起清空', W / 2, cy + fs(18), 9,
        'rgba(255,138,90,0.95)', 'center', false);
    } else {
      text(ctx, '当前没有主武器', W / 2, cy, 10.5, C.dim, 'center', false);
    }

    var bw = pw * 0.4, gap = pw * 0.08;
    var by = py + ph - fs(52);
    button(g, ctx, 'loot:no', px + pw * 0.06, by, bw, fs(38), '不要', 'ghost');
    button(g, ctx, 'loot:yes', px + pw * 0.06 + bw + gap, by, bw, fs(38), '换上', 'primary');
  };

  /* ---------------- 暂停 ---------------- */

  UI.pause = function (g) {
    var ctx = P.ctx, W = P.W, H = P.H;
    var p = g.run.p;
    ctx.fillStyle = 'rgba(6,8,12,0.84)';
    ctx.fillRect(0, 0, W, H);

    text(ctx, '已暂停', W / 2, H * 0.17, 26, C.text, 'center', true);
    text(ctx, '存活 ' + U.fmt(g.run.t) + ' · 击杀 ' + g.run.kills + ' · Lv.' + p.level,
      W / 2, H * 0.205, 12, C.dim, 'center', false);

    /* 当前构筑：让玩家在暂停时能一眼看清自己这套是什么 */
    var pw = W * 0.84, px = (W - pw) / 2, py = H * 0.245;
    panel(ctx, px, py, pw, fs(150), 14, 'rgba(255,255,255,0.05)', C.line);
    text(ctx, '当前构筑', px + fs(16), py + fs(16), 9, 'rgba(139,149,163,0.9)', 'left');

    var rowY = py + fs(34);
    var mainE = HS.Gear.mainEntry(p), subE = HS.Gear.subEntry(p);
    var D = HS.Data;

    function slotRow(label, ent, y) {
      text(ctx, label, px + fs(16), y, 9.5, C.dim, 'left', false);
      if (!ent) {
        text(ctx, '空', px + fs(46), y, 9.5, 'rgba(255,255,255,0.22)', 'left', false);
        return;
      }
      var d = D.gear[ent.id];
      if (!d) return;
      icon(ctx, d.icon, px + fs(54), y, fs(13), d.color);
      var ups = D.gearUps[ent.id] || {};
      var upTxt = '';
      for (var k in ent.up) {
        if (!ent.up[k] || !ups[k]) continue;
        upTxt += (upTxt ? ' · ' : ' · ') + ups[k].name + ' Lv' + ent.up[k];
      }
      text(ctx, d.name + ' Lv' + ent.lvl + upTxt +
        (label === '主武器' && p.mainLocked ? '（已锁定）' : ''),
        px + fs(64), y, 9.5, ent.evolved ? C.gold : C.text, 'left', true);
    }
    slotRow('主武器', mainE, rowY);
    slotRow('副武器', subE, rowY + fs(22));

    /* 自动装备一行 */
    text(ctx, '自动', px + fs(16), rowY + fs(46), 9.5, C.dim, 'left', false);
    if (!p.autos.length) {
      text(ctx, '空', px + fs(46), rowY + fs(46), 9.5, 'rgba(255,255,255,0.22)', 'left');
    } else {
      for (var i = 0; i < p.autos.length && i < 7; i++) {
        var ad = D.gear[p.autos[i].id];
        if (!ad) continue;
        icon(ctx, ad.icon, px + fs(54) + i * fs(20), rowY + fs(46), fs(11), ad.color);
        text(ctx, String(p.autos[i].lvl), px + fs(58) + i * fs(20), rowY + fs(52), 6,
          'rgba(255,255,255,0.5)', 'center');
      }
    }

    /* 联动 */
    var synNames = [];
    for (var sk in p.syn) {
      if (!p.syn[sk]) continue;
      for (var si = 0; si < D.synergies.length; si++) {
        if (D.synergies[si].id === sk) synNames.push(D.synergies[si].name);
      }
    }
    text(ctx, '联动', px + fs(16), rowY + fs(68), 9.5, C.dim, 'left', false);
    text(ctx, synNames.length ? synNames.join(' · ') : '尚未激活',
      px + fs(46), rowY + fs(68), 9,
      synNames.length ? '#b197fc' : 'rgba(255,255,255,0.22)', 'left', false);

    var bw = W * 0.6, bx = (W - bw) / 2;
    button(g, ctx, 'resume', bx, H * 0.55, bw, fs(50), '继续游戏', 'primary');
    button(g, ctx, 'restart', bx, H * 0.55 + fs(62), bw, fs(44), '重新开始', 'ghost');
    button(g, ctx, 'quit', bx, H * 0.55 + fs(116), bw, fs(44), '放弃并返回', 'danger');
  };

  /* ---------------- 结算 ---------------- */

  UI.result = function (g) {
    var ctx = P.ctx, W = P.W, H = P.H;
    var r = g.run.result;
    if (!r) return;

    ctx.fillStyle = 'rgba(6,8,12,0.92)';
    ctx.fillRect(0, 0, W, H);

    /* 顶部光 */
    var glow = ctx.createRadialGradient(W / 2, H * 0.2, 10, W / 2, H * 0.2, W * 0.7);
    glow.addColorStop(0, r.win ? 'rgba(140,233,154,0.16)' : 'rgba(255,60,40,0.16)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    text(ctx, r.win ? '区域已清空' : '你被撕碎了', W / 2, H * 0.14, 30,
      r.win ? C.green : '#ff5a5a', 'center', true);
    text(ctx, r.mapName + ' · ' + r.charName, W / 2, H * 0.183, 12, C.dim, 'center', false);
    if (r.grade) {
      text(ctx, '评级', W / 2 - fs(16), H * 0.215, 10, C.dim, 'center', false);
      text(ctx, r.grade, W / 2 + fs(8), H * 0.214, 18, r.grade === 'S' ? C.gold : (r.grade === 'A' ? C.green : C.text), 'center', true);
    }

    /* 数据 */
    var panelY = H * 0.245;
    var pw = W * 0.82, px = (W - pw) / 2;
    panel(ctx, px, panelY, pw, fs(140), 16, 'rgba(255,255,255,0.05)', C.line);

    var rows = [
      ['存活时间', U.fmt(r.time)],
      ['击杀数', r.kills + '  (' + r.eliteKills + ' 精英)'],
      ['等级', 'Lv.' + r.level],
      ['武器进化', r.evolutions + ' 次'],
      ['搜刮', (r.looted || 0) + ' 处']
    ];
    for (var i = 0; i < rows.length; i++) {
      var yy = panelY + fs(24) + i * fs(26);
      text(ctx, rows[i][0], px + fs(20), yy, 12, C.dim, 'left', false);
      text(ctx, rows[i][1], px + pw - fs(20), yy, 13, C.text, 'right', true);
    }

    /* 金币 */
    text(ctx, '+' + r.gold, W / 2, panelY + fs(160), 26, C.gold, 'center', true);
    /* 金币来源说清楚：通关奖励是额定值，没通关就只有搜刮那一点 */
    var gcap = r.win
      ? ('通关奖励 +' + (r.clearGold || 0) + '   ·   搜刮 +' + (r.scavGold || 0))
      : ('未通关 · 仅搜刮所得' + (r.scavGold ? ' +' + r.scavGold : ''));
    text(ctx, gcap, W / 2, panelY + fs(180), 10, r.win ? C.gold : 'rgba(139,149,163,0.85)', 'center', false);

    /* 通关后解锁的新区域：明说"下一局去新图"，免得玩家以为进度丢了 */
    if (r.win && r.newMap) {
      var ny = panelY + fs(196);
      text(ctx, '新区域解锁', W / 2, ny, 10.5, C.dim, 'center');
      text(ctx, r.newMap + ' · 下一局自动前往', W / 2, ny + fs(18), 13, C.gold, 'center', true);
    }

    /* 新成就 */
    if (r.newAch && r.newAch.length) {
      var ay = panelY + fs(196) + (r.win && r.newMap ? fs(38) : 0);
      text(ctx, '解锁成就', W / 2, ay, 10.5, C.dim, 'center');
      text(ctx, r.newAch[0].name + (r.newAch.length > 1 ? '  等 ' + r.newAch.length + ' 项' : ''),
        W / 2, ay + fs(18), 13, C.green, 'center', true);
    }

    var bestT = HS.Save.data.bestTime;
    text(ctx, '历史最佳 ' + U.fmt(bestT) + '   ·   累计击杀 ' + HS.Save.data.totalKills + '   ·   金币 ' + HS.Save.data.gold,
      W / 2, H * 0.665, 10.5, 'rgba(139,149,163,0.8)', 'center', false);

    var bw = W * 0.62, bx = (W - bw) / 2;
    button(g, ctx, 'again', bx, H * 0.76, bw, fs(52), '再来一局', 'primary');
    button(g, ctx, 'meta', bx, H * 0.76 + fs(62), bw * 0.48, fs(42), '研究所', 'ghost');
    button(g, ctx, 'title', bx + bw * 0.52, H * 0.76 + fs(62), bw * 0.48, fs(42), '主菜单', 'ghost');
  };

  /* ---------------- 入口 ---------------- */

  UI.draw = function (g) {
    var ctx = P.ctx;
    ctx.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    switch (g.state) {
      case 'title': UI.title(g); break;
      case 'settings': UI.settings(g); break;
      case 'mapselect': UI.mapSelect(g); break;
      case 'meta': UI.meta(g); break;
      case 'run': UI.hud(g); break;
      case 'levelup': UI.levelUp(g); break;   // 升级时收起 HUD，避免和标题打架
      case 'lootask': UI.lootAsk(g); break;   // 搜刮翻到主武器：停下来问一句
      case 'paused': UI.hud(g); UI.pause(g); break;
      case 'result': UI.result(g); break;
      default: UI.title(g);
    }
  };

  HS.UI = UI;
})();
