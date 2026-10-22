/**
 * 平台适配层
 * - 微信小游戏：wx.createCanvas() 第 1 个是上屏画布，后面的是离屏画布
 * - 浏览器：<canvas id="game">
 * - Node：桩实现，供无头冒烟测试使用
 *
 * 渲染策略：
 *   世界先画进 320 x VH 的低分辨率离屏缓冲（像素风 + 省性能），
 *   再整数放大绘制到上屏画布，HUD / UI 用原生分辨率绘制，保证中文清晰。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  G.HS = G.HS || {};
  var HS = G.HS;

  function stubCtx() {
    var noop = function () {};
    return {
      canvas: null,
      save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
      setTransform: noop, resetTransform: noop, transform: noop,
      beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
      ellipse: noop, rect: noop, roundRect: noop, arcTo: noop,
      quadraticCurveTo: noop, bezierCurveTo: noop,
      fill: noop, stroke: noop, clip: noop,
      fillRect: noop, strokeRect: noop, clearRect: noop,
      drawImage: noop, fillText: noop, strokeText: noop,
      measureText: function (t) { return { width: (t ? String(t).length : 0) * 6 }; },
      createLinearGradient: function () { return { addColorStop: noop }; },
      createRadialGradient: function () { return { addColorStop: noop }; },
      createPattern: function () { return null; },
      putImageData: noop,
      getImageData: function () { return { data: [] }; },
      setLineDash: noop,
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
      font: '10px sans-serif', textAlign: 'left', textBaseline: 'top',
      imageSmoothingEnabled: false, globalCompositeOperation: 'source-over',
      lineCap: 'butt', lineJoin: 'miter', shadowBlur: 0, shadowColor: '#000'
    };
  }

  function stubCanvas(w, h) {
    var c = {
      width: w || 1, height: h || 1,
      _ctx: null,
      getContext: function () {
        if (!c._ctx) c._ctx = stubCtx();
        return c._ctx;
      }
    };
    return c;
  }

  var P = {
    isWx: false,
    isNode: false,
    W: 390, H: 844, dpr: 1,
    VW: 320, VH: 690, scale: 1, offY: 0,
    /* 渲染超采样倍率：世界 1 单位画成 SS 个缓冲像素（只影响清晰度，不影响逻辑） */
    SS: 2,
    canvas: null, ctx: null, buffer: null, bctx: null,
    camX: 0, camY: 0,
    safeTop: 0,

    /* 设置项：震动开关 / 低配特效，由 Game.init 从存档同步过来 */
    vibrateOn: true,
    fxLow: false,

    init: function () {
      var canvas = null;
      if (typeof wx !== 'undefined' && typeof wx.createCanvas === 'function') {
        P.isWx = true;
        var info = wx.getSystemInfoSync();
        P.W = info.windowWidth;
        P.H = info.windowHeight;
        P.dpr = Math.min(info.pixelRatio || 1, 2);
        P.safeTop = Math.min(28, Math.max(0, (info.safeArea && info.safeArea.top) ? info.safeArea.top : 0));
        canvas = wx.createCanvas();
      } else if (typeof document !== 'undefined' && document.createElement) {
        P.W = (typeof window !== 'undefined' ? window.innerWidth : 390);
        P.H = (typeof window !== 'undefined' ? window.innerHeight : 844);
        P.dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
        canvas = document.getElementById('game');
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.id = 'game';
          document.body.appendChild(canvas);
        }
      } else {
        P.isNode = true;
        P.W = 390; P.H = 844; P.dpr = 1;
        canvas = stubCanvas(390, 844);
      }

      P.canvas = canvas;
      canvas.width = Math.max(1, Math.floor(P.W * P.dpr));
      canvas.height = Math.max(1, Math.floor(P.H * P.dpr));

      var ctx = canvas.getContext('2d');
      if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
      P.ctx = ctx;

      if (P.isWx) {
        P.buffer = wx.createCanvas();
      } else if (P.isNode) {
        P.buffer = stubCanvas(320, 690);
      } else {
        P.buffer = document.createElement('canvas');
      }

      P.resize();

      // 尺寸变化 / 前后台切换
      var onResize = function () {
        if (P.isWx) {
          var i2 = wx.getSystemInfoSync();
          P.W = i2.windowWidth; P.H = i2.windowHeight;
          P.dpr = Math.min(i2.pixelRatio || 1, 2);
        } else if (typeof window !== 'undefined') {
          P.W = window.innerWidth; P.H = window.innerHeight;
          P.dpr = Math.min(window.devicePixelRatio || 1, 2);
        }
        /* 预览 / 截图时可以钉死逻辑视口，不让窗口尺寸把它改回去 */
        if (P.forceW) { P.W = P.forceW; P.H = P.forceH; }
        P.canvas.width = Math.max(1, Math.floor(P.W * P.dpr));
        P.canvas.height = Math.max(1, Math.floor(P.H * P.dpr));
        P.resize();
      };

      if (P.isWx && wx.onWindowResize) wx.onWindowResize(onResize);
      else if (!P.isNode && typeof window !== 'undefined') window.addEventListener('resize', onResize);
    },

    resize: function () {
      P.VW = 320;
      P.VH = Math.max(360, Math.round(P.VW * P.H / P.W));
      P.scale = P.W / P.VW;
      P.offY = (P.H - P.VH * P.scale) / 2;

      /* 世界坐标 1 单位 = SS 个缓冲像素。
         逻辑（视野、速度、碰撞）仍然按 1 单位算，只有缓冲密度变高，
         于是点阵美术能画下 SS 倍的细节，屏幕尺寸和手感完全不变。 */
      P.buffer.width = P.VW * P.SS;
      P.buffer.height = P.VH * P.SS;
      var b = P.buffer.getContext('2d');
      if ('imageSmoothingEnabled' in b) b.imageSmoothingEnabled = false;
      P.bctx = b;
    },

    /** 离屏画布工厂（微信 / 浏览器 / Node 桩） */
    createCanvas: function (w, h) {
      if (P.isWx) {
        var c = wx.createCanvas();
        c.width = w; c.height = h;
        return c;
      }
      if (P.isNode) return stubCanvas(w, h);
      var c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      return c2;
    },

    /** 世界坐标 -> 屏幕逻辑坐标（HUD 层） */
    sx: function (x) { return (x - P.camX) * P.scale; },
    sy: function (y) { return (y - P.camY) * P.scale + P.offY; },

    /** 钉死逻辑视口（浏览器预览 / 无头截图用；正常游戏不会调用） */
    setViewport: function (w, h) {
      P.forceW = w;
      P.forceH = h;
      P.W = w;
      P.H = h;
      P.canvas.width = Math.max(1, Math.floor(w * P.dpr));
      P.canvas.height = Math.max(1, Math.floor(h * P.dpr));
      P.resize();
    },

    beginFrame: function () {
      var b = P.bctx;
      b.setTransform(P.SS, 0, 0, P.SS, 0, 0);
      b.globalAlpha = 1;
      b.globalCompositeOperation = 'source-over';
    },

    present: function () {
      var ctx = P.ctx;
      ctx.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
      if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#04060a';
      ctx.fillRect(0, 0, P.W, P.H);
      ctx.drawImage(P.buffer, 0, 0, P.buffer.width, P.buffer.height,
        0, P.offY, P.W, P.VH * P.scale);
    },

    /** 存储 */
    get: function (key) {
      try {
        if (P.isWx && wx.getStorageSync) return wx.getStorageSync(key);
        if (typeof localStorage !== 'undefined') {
          var raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : '';
        }
      } catch (e) {}
      return '';
    },
    set: function (key, val) {
      try {
        if (P.isWx && wx.setStorageSync) { wx.setStorageSync(key, val); return; }
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {}
    },

    vibrate: function (type) {
      if (!P.vibrateOn) return;
      try {
        if (P.isWx && wx.vibrateShort) wx.vibrateShort({ type: type || 'light' });
      } catch (e) {}
    },

    /**
     * 加载图片（图集）。微信 / 浏览器 / 无头环境统一接口。
     * 注意：回调一定只触发一次。
     */
    loadImage: function (src, cb) {
      var done = false;
      var finish = function (img) {
        if (done) return;
        done = true;
        cb(img);
      };

      try {
        if (P.isWx && wx.createImage) {
          var im = wx.createImage();
          im.onload = function () { finish(im); };
          im.onerror = function () { finish(null); };
          im.src = src;
          return;
        }
        if (!P.isNode && typeof Image !== 'undefined') {
          var im2 = new Image();
          im2.onload = function () { finish(im2); };
          im2.onerror = function () { finish(null); };
          im2.src = src;
          return;
        }
      } catch (e) {
        finish(null);
        return;
      }

      // Node 无头环境：给个占位对象，让逻辑照常跑
      finish({ width: 1, height: 1, __stub: true });
    }
  };

  HS.P = P;
  HS.Platform = P;
})();
