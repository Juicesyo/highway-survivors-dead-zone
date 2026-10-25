/**
 * 宿主适配层（HS.Host）
 *
 * 一套核心代码，两个宿主：微信小游戏 / B站 Toy（浏览器与 Node 是调试环境）。
 * 业务代码只认 HS.Host 的四项能力，绝不直接碰 wx.* 或 window.toy：
 *
 *   1. rank     排行榜（提交分数 / 榜单 / 我的名次）—— 各平台原生能力，天然互不相通
 *   2. cloud    云端存档（跨设备）—— key 带宿主前缀，微信和 Toy 各存各的
 *   3. user     用户身份（昵称 / 头像 / 平台内 id）
 *   4. pageHide 前后台切换回调（切后台要落盘）
 *
 * 用户数据隔离靠三层，不是靠"两个项目"：
 *   - 本地存档：微信走 wx storage，Toy 走页面 localStorage，物理隔离
 *   - 云端存档：key = hsdz1.<宿主>.save，同一个云也撞不上
 *   - 排行榜：平台按「小程序 / Toy + 榜位 + 周期」自己隔离，代码里不用管
 *
 * 新增宿主只要写一个 adapter（见同目录 toy.js / wx.js / web.js），
 * 核心玩法、数值、UI 一行都不用改。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var P = HS.P;

  /* 榜位：平台每个 Toy / 小程序固定 1-3 号榜，含义由作品自定义。
     1 号 = 无尽模式存活时间；2/3 号先空着，留给以后按地图拆榜。 */
  var BOARD = 1;

  /* 分数单位：1/100 秒。存整数才好排序，百分秒足够分出先后；
     上限 16777215 ≈ 46 小时，不可能被玩家打满 */
  var UNIT = 100;
  var MAX_SCORE = 16777215;

  var CACHE_MS = 30000;     // 榜单本地缓存：拉一次复用，不做轮询

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var Host = {
    id: 'web',
    label: '浏览器',
    adapter: null,
    rankSupported: false,
    rankNote: '',
    board: BOARD,
    periods: [
      { id: 'all', name: '总榜' },
      { id: 'week', name: '周榜' },
      { id: 'day', name: '日榜' }
    ],
    user: { nickname: '', avatar: '', id: '' },

    /* 排行榜页面直接读这块状态，UI 不做任何网络调用 */
    rankUI: {
      period: 'all',
      loading: false,
      rows: [],
      my: null,
      err: '',
      errCode: '',
      myErr: '',
      refreshedAt: 0,
      cache: {}
    },

    _hides: [],

    /* ---------------- 初始化 / 选择宿主 ---------------- */

    init: function () {
      var order = ['wx', 'toy', 'web', 'node'];
      var picked = null;
      for (var i = 0; i < order.length; i++) {
        var a = HS.HostAdapters && HS.HostAdapters[order[i]];
        if (a && (!a.detect || a.detect())) { picked = a; break; }
      }
      Host.use(picked || HS.HostAdapters.web);
    },

    use: function (a) {
      if (!a) return;
      Host.adapter = a;
      Host.id = a.id;
      Host.label = a.label;
      Host.rankSupported = !!a.rankSupported;
      Host.rankNote = a.rankNote || '';
      Host.user = a.user || { nickname: '', avatar: '', id: '' };
      Host.rankUI.cache = {};
      Host.rankUI.rows = [];
      Host.rankUI.my = null;
      Host.rankUI.err = '';
      Host.rankUI.errCode = '';
      Host.rankUI.myErr = '';
    },

    /**
     * 重新探测宿主。Toy 的 SDK 是外链脚本，万一先于它加载完成，
     * 这里能把适配器补上（进排行榜页时调一次，不轮询）。
     */
    refresh: function () {
      if (Host.rankSupported) return;
      var a = HS.HostAdapters.toy;
      if (a && a.detect()) Host.use(a);
    },

    canRank: function () { return !!(Host.adapter && Host.adapter.rankSupported); },

    canCloud: function () { return !!(Host.adapter && Host.adapter.cloud); },

    /** 云端 key 前缀：微信 / Toy 各存各的，同一个云也撞不到一起 */
    storageKey: function (name) {
      return 'hsdz1.' + Host.id + '.' + name;
    },

    /* ---------------- 排行榜 ---------------- */

    toScore: function (sec) {
      var v = Math.round((sec || 0) * UNIT);
      if (v < 0) v = 0;
      if (v > MAX_SCORE) v = MAX_SCORE;
      return v;
    },

    fromScore: function (score) { return (score || 0) / UNIT; },

    /** 百分秒 -> M:SS.cc */
    fmtScore: function (score) {
      if (score === null || score === undefined || score < 0) return '--';
      var total = Math.floor(score / UNIT);
      var cs = Math.floor(score % UNIT);
      return Math.floor(total / 60) + ':' + pad2(total % 60) + '.' + pad2(cs);
    },

    periodName: function (id) {
      for (var i = 0; i < Host.periods.length; i++) {
        if (Host.periods[i].id === id) return Host.periods[i].name;
      }
      return '';
    },

    /**
     * 拉榜单 + 我的名次。只走缓存或用户主动触发，不做定时轮询 ——
     * Toy 的云能力是按 Toy 共享额度的，榜单刷得越勤，玩家能摊到的额度越少。
     */
    loadRank: function (period, force) {
      var ui = Host.rankUI;
      if (period) ui.period = period;

      if (!Host.canRank()) {
        ui.loading = false;
        ui.rows = [];
        ui.my = null;
        ui.err = Host.rankNote || '当前环境没有接入排行榜';
        ui.errCode = 'unsupported';
        return;
      }

      var key = ui.period;
      var now = Date.now();
      var hit = ui.cache[key];
      if (hit && !force && (now - hit.t) < CACHE_MS) {
        ui.rows = hit.rows;
        ui.my = hit.my;
        ui.err = '';
        ui.errCode = '';
        ui.myErr = '';
        ui.loading = false;
        ui.refreshedAt = hit.t;
        return;
      }
      if (ui.loading) return;

      ui.loading = true;
      ui.err = '';
      ui.errCode = '';
      ui.myErr = '';

      var left = 2, rows = null, my = null, listErr = null, myErr = null;
      function done() {
        if (--left > 0) return;
        ui.loading = false;
        if (rows) ui.rows = rows;
        ui.my = my;
        if (!rows && listErr) {
          ui.err = listErr.msg || '榜单加载失败';
          ui.errCode = listErr.code || 'net';
        } else {
          ui.err = '';
          ui.errCode = '';
          if (myErr) ui.myErr = myErr.msg || '';
          ui.cache[key] = { rows: ui.rows, my: my, t: Date.now() };
          ui.refreshedAt = Date.now();
        }
      }

      Host.adapter.list({ board: Host.board, period: key, limit: 10 }, function (err, res) {
        if (err) listErr = err; else rows = res;
        done();
      });
      Host.adapter.me({ board: Host.board, period: key }, function (err, res) {
        if (err) myErr = err; else my = res;
        done();
      });
    },

    /**
     * 无尽模式结算：先记本地最佳，再提交榜单。
     * 回调给 result 页用（本次名次 / 失败原因）。
     */
    submitRun: function (run, cb) {
      var res = run ? run.result : null;
      var d = HS.Save.data;
      var score = Host.toScore(run ? run.t : 0);

      if (score > Host.toScore(d.bestEndless || 0)) d.bestEndless = run ? run.t : 0;
      d.endlessRuns = (d.endlessRuns || 0) + 1;
      HS.Save.flush();

      if (res) {
        res.endless = true;
        res.score = score;
        res.bestEndless = d.bestEndless;
        res.rankLoading = Host.canRank();
        res.rankErr = null;
        res.rankMy = null;
      }

      if (!Host.canRank()) {
        if (res) res.rankLoading = false;
        if (cb) cb({ code: 'unsupported', msg: Host.rankNote || '排行榜未接入' });
        return;
      }

      Host.adapter.submit({ board: Host.board, score: score }, function (err, out) {
        if (res) {
          res.rankErr = err || null;
          res.rankBest = out ? out.score : null;
          res.rankLoading = false;
        }
        /* 提交成功 → 顺手问一次名次，结算页直接显示「第 N 名」 */
        if (!err) {
          Host.rankUI.cache = {};   // 下次进榜单拿最新的
          Host.adapter.me({ board: Host.board, period: 'all' }, function (e2, my) {
            if (res) res.rankMy = e2 ? null : my;
            if (cb) cb(null, { score: score, my: e2 ? null : my });
          });
        } else if (cb) {
          cb(err);
        }
      });
    },

    /* ---------------- 云端存档 ---------------- */

    cloudGet: function (keys, cb) {
      if (!Host.canCloud()) { cb({ code: 'unsupported', msg: '当前环境没有云存档' }); return; }
      Host.adapter.cloud.get(keys, cb);
    },

    cloudSet: function (items, cb) {
      if (!Host.canCloud()) { cb({ code: 'unsupported', msg: '当前环境没有云存档' }); return; }
      Host.adapter.cloud.set(items, cb);
    },

    /* ---------------- 前后台 ---------------- */

    onHide: function (cb) { Host._hides.push(cb); },

    fireHide: function () {
      for (var i = 0; i < Host._hides.length; i++) {
        try { Host._hides[i](); } catch (e) {}
      }
    }
  };

  HS.Host = Host;
})();
