/**
 * 浏览器 / Node 适配器
 *
 * 没有联机榜单，就把本机历史成绩当榜单用（"本地记录 · 仅自己"）：
 * - 网页 Demo（GitHub Pages）也有一屏能看，不至于点进去是空白
 * - 开发时能真实走通「提交 → 拉榜 → 我的名次」整条链路
 *
 * 看多行效果时把 adapter.mock 置 true（文档截图用，不写存档）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var P = HS.P;
  var A = HS.HostAdapters || (HS.HostAdapters = {});

  var KEY = 'hsdz_rank_local_v1';
  var DAY = 86400000;

  function read() {
    var v = P.get(KEY);
    if (typeof v === 'string' && v) { try { v = JSON.parse(v); } catch (e) { v = null; } }
    return (v && v.length) ? v : [];
  }

  function write(list) {
    P.set(KEY, list);
  }

  function inPeriod(t, period) {
    if (!period || period === 'all') return true;
    var span = period === 'day' ? DAY : DAY * 7;
    return (Date.now() - t) <= span;
  }

  var MOCK = [
    { score: 41200, nickname: '废土老哥' },
    { score: 33800, nickname: '加油站的猫' },
    { score: 28700, nickname: '半箱子弹' },
    { score: 22300, nickname: '水鬼不睡觉' },
    { score: 15900, nickname: '断堤巨斧' }
  ];

  var Web = {
    id: 'web',
    label: '浏览器',
    rankSupported: true,
    localOnly: true,
    rankNote: '本地记录 · 仅统计这台设备',
    /* 文档截图 / 本地调 UI 时置 true：混入几个示例名次，让榜单不至于是空的 */
    mock: false,
    user: { nickname: '我', avatar: '', id: '' },

    detect: function () { return !P.isNode; },

    list: function (req, cb) {
      var list = read(), out = [], i;
      for (i = 0; i < list.length; i++) {
        if (inPeriod(list[i].t, req.period)) out.push(list[i]);
      }
      out.sort(function (a, b) { return b.score - a.score; });
      var rows = [];
      for (i = 0; i < out.length && rows.length < (req.limit || 10); i++) {
        rows.push({ rank: i + 1, score: out[i].score, nickname: out[i].nickname || '我', avatar: '' });
      }
      if (Web.mock) {
        for (i = 0; i < MOCK.length; i++) {
          rows.push({ rank: rows.length + 1, score: MOCK[i].score, nickname: MOCK[i].nickname, avatar: '' });
        }
        rows.sort(function (a, b) { return b.score - a.score; });
        for (i = 0; i < rows.length; i++) rows[i].rank = i + 1;
      }
      cb(null, rows);
    },

    me: function (req, cb) {
      var list = read(), best = 0, i;
      for (i = 0; i < list.length; i++) {
        if (inPeriod(list[i].t, req.period) && list[i].score > best) best = list[i].score;
      }
      if (!best) { cb(null, { ranked: false, rank: 0, score: 0 }); return; }
      /* 自己的名次 = 比自己高的记录数 + 1（开了 mock 就把示例名次也算上） */
      var ahead = 0;
      if (Web.mock) {
        for (i = 0; i < MOCK.length; i++) if (MOCK[i].score > best) ahead++;
      }
      for (i = 0; i < list.length; i++) {
        if (inPeriod(list[i].t, req.period) && list[i].score > best) ahead++;
      }
      cb(null, { ranked: true, rank: ahead + 1, score: best });
    },

    submit: function (req, cb) {
      var list = read();
      list.push({ score: req.score, t: Date.now() });
      list.sort(function (a, b) { return b.score - a.score; });
      if (list.length > 20) list.length = 20;
      write(list);
      cb(null, { score: req.score });
    }
  };

  A.web = Web;

  A.node = {
    id: 'node',
    label: 'Node 测试环境',
    rankSupported: true,
    localOnly: true,
    rankNote: '本地记录 · 仅统计这台设备',
    user: { nickname: '我', avatar: '', id: '' },
    detect: function () { return !!P.isNode; },
    list: Web.list,
    me: Web.me,
    submit: Web.submit
  };
})();
