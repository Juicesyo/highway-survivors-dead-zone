/**
 * 输入：动态虚拟摇杆 + 点击 + 键盘（浏览器调试用）
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var P = HS.P;

  var JOY_R = 46;

  var I = {
    enabled: false,
    joy: { active: false, ox: 0, oy: 0, cx: 0, cy: 0, dx: 0, dy: 0, mag: 0 },
    taps: [],
    keys: {},
    _joyId: null,
    _startT: 0,
    _startX: 0,
    _startY: 0,
    _moved: 0,

    init: function () {
      if (P.isWx) {
        wx.onTouchStart(function (e) { I._handlers(e, 'start'); });
        wx.onTouchMove(function (e) { I._handlers(e, 'move'); });
        wx.onTouchEnd(function (e) { I._handlers(e, 'end'); });
        wx.onTouchCancel(function (e) { I._handlers(e, 'end'); });
      } else if (!P.isNode) {
        var cv = P.canvas;
        var rectOf = function () { return cv.getBoundingClientRect ? cv.getBoundingClientRect() : { left: 0, top: 0 }; };
        var pt = function (ev) {
          var r = rectOf();
          var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
          return { x: t.clientX - r.left, y: t.clientY - r.top, id: 1 };
        };
        cv.addEventListener('touchstart', function (e) {
          e.preventDefault();
          var p = pt(e); I._begin(p.id, p.x, p.y);
        }, { passive: false });
        cv.addEventListener('touchmove', function (e) {
          e.preventDefault();
          var p = pt(e); I._move(p.id, p.x, p.y);
        }, { passive: false });
        cv.addEventListener('touchend', function (e) {
          e.preventDefault();
          var p = pt(e); I._end(p.id, p.x, p.y);
        }, { passive: false });

        cv.addEventListener('mousedown', function (e) {
          var p = pt(e); I._begin(1, p.x, p.y);
        });
        cv.addEventListener('mousemove', function (e) {
          if (I._joyId !== null) { var p = pt(e); I._move(1, p.x, p.y); }
        });
        window.addEventListener('mouseup', function (e) {
          if (I._joyId !== null) { var p = pt(e); I._end(1, p.x, p.y); }
        });

        window.addEventListener('keydown', function (e) {
          I.keys[e.key.toLowerCase()] = true;
          if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(e.key.toLowerCase()) >= 0) e.preventDefault();
        });
        window.addEventListener('keyup', function (e) {
          I.keys[e.key.toLowerCase()] = false;
        });
      }
    },

    _handlers: function (e, phase) {
      var list = e.changedTouches || e.touches || [];
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var id = t.identifier !== undefined ? t.identifier : 0;
        var x = t.clientX, y = t.clientY;
        if (phase === 'start') I._begin(id, x, y);
        else if (phase === 'move') I._move(id, x, y);
        else I._end(id, x, y);
      }
    },

    _begin: function (id, x, y) {
      if (I._joyId !== null) return;
      /* 无论菜单还是局内都要记下这次触摸：点击只在"抬手"时报一次。
         以前菜单里（enabled=false）按下、抬起各报一次点击，
         一次点按会排进两个点击 —— 清存档的确认框就是被第二个点击
         当场点掉的（弹窗一闪而过，甚至会误触"确认清除"）。 */
      I._joyId = id;
      I._startT = Date.now();
      I._startX = x; I._startY = y; I._moved = 0;
      I.joy.ox = x; I.joy.oy = y;
      I.joy.cx = x; I.joy.cy = y;
      I.joy.dx = 0; I.joy.dy = 0; I.joy.mag = 0;
      I.joy.active = I.enabled;   // 菜单里不画摇杆，但触摸本身照样跟踪
    },

    _move: function (id, x, y) {
      if (id !== I._joyId) return;
      var dx = x - I._startX, dy = y - I._startY;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > I._moved) I._moved = d;
      if (!I.enabled) return;
      I.joy.cx = x; I.joy.cy = y;
      var m = Math.min(1, d / JOY_R);
      if (m < 0.14) { I.joy.mag = 0; I.joy.dx = 0; I.joy.dy = 0; return; }
      I.joy.mag = m;
      I.joy.dx = dx / d;
      I.joy.dy = dy / d;
    },

    _end: function (id, x, y) {
      if (id !== I._joyId) return;
      var dt = Date.now() - I._startT;
      if (dt < 260 && I._moved < 16) I.taps.push({ x: I._startX, y: I._startY });
      I._joyId = null;
      I.joy.active = false;
      I.joy.mag = 0; I.joy.dx = 0; I.joy.dy = 0;
    },

    axis: function () {
      var out = { dx: 0, dy: 0, mag: 0 };
      if (I.joy.active && I.joy.mag > 0) {
        out.dx = I.joy.dx * I.joy.mag;
        out.dy = I.joy.dy * I.joy.mag;
        out.mag = I.joy.mag;
        return out;
      }
      var kx = 0, ky = 0;
      if (I.keys['a'] || I.keys['arrowleft']) kx -= 1;
      if (I.keys['d'] || I.keys['arrowright']) kx += 1;
      if (I.keys['w'] || I.keys['arrowup']) ky -= 1;
      if (I.keys['s'] || I.keys['arrowdown']) ky += 1;
      if (kx || ky) {
        var l = Math.sqrt(kx * kx + ky * ky);
        out.dx = kx / l; out.dy = ky / l; out.mag = 1;
      }
      return out;
    },

    consumeTaps: function () {
      if (!I.taps.length) return null;
      var t = I.taps;
      I.taps = [];
      return t;
    },

    reset: function () {
      I.taps.length = 0;
      I._joyId = null;
      I.joy.active = false;
      I.joy.mag = 0; I.joy.dx = 0; I.joy.dy = 0;
    },

    joyR: JOY_R
  };

  HS.Input = I;
})();
