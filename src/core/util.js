/**
 * 基础工具函数
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  G.HS = G.HS || {};
  var HS = G.HS;

  var U = {
    TAU: Math.PI * 2,

    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    chance: function (p) { return Math.random() < p; },

    dist: function (x1, y1, x2, y2) {
      var dx = x2 - x1, dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    },
    dist2: function (x1, y1, x2, y2) {
      var dx = x2 - x1, dy = y2 - y1;
      return dx * dx + dy * dy;
    },

    /** 确定性哈希，用于无限地图的程序化装饰 */
    hash: function (x, y, s) {
      var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(((s | 0) + 7), 1442695041);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h = h ^ (h >>> 16);
      return (h >>> 0) / 4294967296;
    },

    shuffle: function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },

    /** 秒 -> M:SS */
    fmt: function (s) {
      s = Math.max(0, Math.floor(s));
      var m = Math.floor(s / 60);
      var ss = s % 60;
      return m + ':' + (ss < 10 ? '0' : '') + ss;
    },

    /** #rrggbb 混合 */
    mix: function (c1, c2, t) {
      var a = U.hex(c1), b = U.hex(c2);
      var r = Math.round(a[0] + (b[0] - a[0]) * t);
      var g = Math.round(a[1] + (b[1] - a[1]) * t);
      var bl = Math.round(a[2] + (b[2] - a[2]) * t);
      return 'rgb(' + r + ',' + g + ',' + bl + ')';
    },

    hex: function (c) {
      if (c.charAt(0) === '#') c = c.substring(1);
      if (c.length === 3) {
        c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
      }
      var n = parseInt(c, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },

    rgba: function (c, a) {
      var v = U.hex(c);
      return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')';
    },

    /** 数组按 key 移除（就地压缩，返回新长度） */
    compact: function (arr, deadKey) {
      var n = 0;
      for (var i = 0; i < arr.length; i++) {
        if (!arr[i][deadKey]) arr[n++] = arr[i];
      }
      arr.length = n;
      return n;
    }
  };

  HS.U = U;
})();
