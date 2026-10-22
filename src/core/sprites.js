/**
 * 精灵图集客户端
 *
 * 运行时不再生成任何像素：只从 assets/sprites.png 按帧表切片绘制。
 * 帧表由 tools/build-sprites.js 生成（assets/sprites.js -> HS.SheetData）。
 *
 * 帧命名：
 *   player_soldier / player_medic / player_mechanic / player_ghost
 *   walker / runner / crawler / spitter / brute / boss
 *   <enemy>_elite   精英红化版本
 *   <enemy>_hit     受击白闪版本
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var P = HS.P;

  var S = {
    ready: false,
    failed: false,
    img: null,
    frames: null,
    sheetW: 0,
    sheetH: 0,

    init: function () {
      var d = HS.SheetData;
      if (!d) {
        S.failed = true;
        return;
      }
      S.frames = d.frames;
      S.sheetW = d.size ? d.size.w : 0;
      S.sheetH = d.size ? d.size.h : 0;

      P.loadImage(d.image, function (im) {
        if (!im) { S.failed = true; return; }
        S.img = im;
        S.ready = true;
      });
    },

    has: function (name) {
      return !!(S.frames && S.frames[name]);
    },

    /** 返回帧矩形（图集坐标） */
    frame: function (name) {
      return S.frames ? S.frames[name] : null;
    },

    /** 帧的像素尺寸（1x） */
    size: function (name, scale) {
      var f = S.frame(name);
      if (!f) return { w: 0, h: 0 };
      var s = (scale || 1) * (f.s || 1);
      return { w: Math.round(f.w * s), h: Math.round(f.h * s) };
    },

    /**
     * 以中心为锚点绘制
     * @param {number} [scale=1]
     * @param {number} [alpha] 传入则临时改 globalAlpha
     */
    draw: function (ctx, name, x, y, scale, alpha, flip) {
      if (!S.ready) return null;
      var f = S.frames[name];
      if (!f) return null;
      var s = (scale || 1) * (f.s || 1);
      var w = Math.round(f.w * s);
      var h = Math.round(f.h * s);
      var dx = Math.round(x - w / 2);
      var dy = Math.round(y - h / 2);

      var prev = 0;
      if (alpha !== undefined) {
        prev = ctx.globalAlpha;
        ctx.globalAlpha = prev * alpha;
      }
      if (flip) {
        ctx.drawImage(S.img, f.x, f.y, f.w, f.h, dx + w, dy, -w, h);
      } else {
        ctx.drawImage(S.img, f.x, f.y, f.w, f.h, dx, dy, w, h);
      }
      if (alpha !== undefined) ctx.globalAlpha = prev;
      return f;
    },

    /** 左下角锚点（脚底对齐用） */
    drawFoot: function (ctx, name, x, y, scale, alpha) {
      var f = S.frame(name);
      if (!f) return null;
      var s = (scale || 1) * (f.s || 1);
      return S.draw(ctx, name, x, y - Math.round(f.h * s) / 2, scale || 1, alpha);
    }
  };

  HS.Sprites = S;
})();
