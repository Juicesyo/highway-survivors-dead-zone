/**
 * 启动器：初始化 + 主循环
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var P = HS.P;

  var Main = {
    booted: false,
    last: 0,
    fps: 0,
    _frames: 0,
    _fpsT: 0,

    boot: function () {
      if (Main.booted) return;
      Main.booted = true;

      P.init();
      HS.Host.init();
      HS.Input.init();
      HS.Sprites.init();
      HS.Audio.init();
      HS.Game.init();

      /* 宿主无关的"要落盘了"钩子：结算推云、切后台推云都在这里挂 */
      HS.Host.onHide(function () {
        HS.Save.flush();
        HS.Save.pushCloud();
      });

      /* 前后台切换 */
      if (P.isWx) {
        if (wx.onHide) {
          wx.onHide(function () {
            var g = HS.Game;
            if (g.state === 'run') { g.state = 'paused'; HS.Input.enabled = false; }
            HS.Audio.pauseBgm();
            HS.Host.fireHide();
          });
        }
        if (wx.onShow) {
          wx.onShow(function () {
            HS.Audio.resume();
          });
        }
      } else if (!P.isNode && typeof document !== 'undefined') {
        /* 浏览器 / B站 Toy：切标签页、切后台、页面卸载都要落盘 */
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') HS.Host.fireHide();
        });
        window.addEventListener('pagehide', function () { HS.Host.fireHide(); });
        window.addEventListener('beforeunload', function () { HS.Host.fireHide(); });
      }

      /* 浏览器调试：1/2/3 选卡，Esc 暂停 */
      if (!P.isWx && !P.isNode && typeof window !== 'undefined') {
        window.addEventListener('keydown', function (e) {
          var g = HS.Game;
          if (g.state === 'levelup') {
            var n = parseInt(e.key, 10);
            if (n >= 1 && n <= g.run.choices.length) g.pickChoice(n - 1);
          } else if (g.state === 'lootask') {
            if (e.key === 'Escape') g.answerLoot(false);
            else if (e.key === 'Enter' || e.key === '1') g.answerLoot(true);
          } else if (e.key === 'Escape') {
            if (g.state === 'run') { g.state = 'paused'; HS.Input.enabled = false; }
            else if (g.state === 'paused') { g.state = 'run'; HS.Input.enabled = true; }
          }
        });
      }

      var raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : null;
      if (!raf) return;   // 无头环境由外部调用 tick

      var loop = function (ts) {
        var now = (typeof ts === 'number') ? ts : Date.now();
        if (!Main.last) Main.last = now;
        var dt = (now - Main.last) / 1000;
        Main.last = now;
        if (dt > 0.1) dt = 0.1;      // 切后台回来不要瞬移
        if (dt <= 0) dt = 0.016;
        Main.tick(dt);
        raf(loop);
      };
      raf(loop);
    },

    tick: function (dt) {
      var t0 = Date.now();
      HS.Game.update(dt);
      HS.Game.render();

      Main._frames++;
      Main._fpsT += dt;
      if (Main._fpsT >= 1) {
        Main.fps = Math.round(Main._frames / Main._fpsT);
        Main._frames = 0;
        Main._fpsT = 0;
      }
      Main.lastFrameMs = Date.now() - t0;
    }
  };

  HS.Main = Main;
})();
