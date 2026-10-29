/**
 * 精灵图集客户端
 *
 * 运行时不再生成任何像素：只从 assets/sprites.png 按帧表切片绘制。
 * 帧表由 tools/build-sprites.js 生成（assets/sprites.js -> HS.SheetData）。
 *
 * 帧命名：
 *   player_whale / player_whale_happy   主角（位图帧，来自原图，48x56 px:2）
 *   walker / runner / crawler / spitter / brute / boss
 *   <enemy>_elite   精英红化版本
 *   <enemy>_hit     受击白闪版本
 *
 * 另外单独加载一张立绘（HS.SheetData.portrait）：研究所角色页用，
 * 不进图集 —— 121x161 按 1:1 画出来才是原图的清晰度。
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
    portrait: null,
    portraitReady: false,

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

      if (d.portrait) {
        P.loadImage(d.portrait, function (im) {
          if (!im || im.__stub) return;
          S.portrait = im;
          S.portraitReady = true;
        });
      }
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
    },

    /**
     * 立绘：以左上角为锚点，按 1:1 像素画（关闭插值），
     * 这样 121x161 的原图缩略在 UI 里不会是糊的。
     */
    drawPortrait: function (ctx, x, y, w, h) {
      if (!S.portraitReady) return false;
      var pw = S.portrait.width || S.portrait.naturalWidth || 121;
      var ph = S.portrait.height || S.portrait.naturalHeight || 161;
      w = w || pw;
      h = h || ph;
      var prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(S.portrait, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      ctx.imageSmoothingEnabled = prev;
      return true;
    },

    portraitSize: function () {
      if (!S.portrait) return { w: 121, h: 161 };
      return {
        w: S.portrait.width || S.portrait.naturalWidth || 121,
        h: S.portrait.height || S.portrait.naturalHeight || 161
      };
    }
  };

  HS.Sprites = S;
})();
