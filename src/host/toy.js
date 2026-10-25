/**
 * B站 Toy 适配器
 *
 * 能力全部来自官方 JS SDK（页面 <head> 引入 toy-sdk.js 后挂到 window.toy）：
 *   - submitScore / getRankList / getMyRank  排行榜（按 Toy + 榜位 + 周期隔离）
 *   - getCloudStorage / setCloudStorage      云存档（按「登录用户 + Toy」隔离）
 *
 * 铁律（官方《频率限制与最佳实践》）：
 *   1. 云存储当存档不当内存，只在结算 / 切后台落盘
 *   2. 批量读写，不逐 key 循环
 *   3. 榜单拉一次本地缓存，不轮询
 *   4. 排行榜按事件提交：结算一次，只增不减、幂等
 *   5. 撞上 307044 限流要指数退避，不能立刻重试
 * 前四条由调用方保证（见 host.js / save.js），第 5 条在本文件里。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var A = HS.HostAdapters || (HS.HostAdapters = {});

  var RETRY_MS = 700;     // 退避基数：700ms → 1400ms
  var RETRY_MAX = 2;      // 最多再试 2 次，别把偶发限流放大成持续限流
  /* SDK 在宿主没准备好时可能既不 resolve 也不 reject，页面会永远停在"加载中"。
     给它一个上限，超时就当网络失败 —— 至少能点到"重试" */
  var TIMEOUT_MS = 8000;

  function sdk() {
    if (typeof window === 'undefined') return null;
    return window.toy || null;
  }

  /** SDK 的报错统一翻译成 { code, msg }，UI 只认这几种 */
  function mapErr(e) {
    if (!e) return { code: 'net', msg: '网络异常，请稍后再试' };
    var msg = String(e.message || e.errMsg || '');
    if (e.code === 307044 || /请求过于频繁|too many/i.test(msg)) {
      return { code: 'busy', msg: '请求太频繁，稍后再试' };
    }
    if (e.type === 'unauthorized' || /未登录|unauthorized/i.test(msg)) {
      return { code: 'login', msg: '登录 B站 后才会出现在榜上' };
    }
    if (e.type === 'denied' || /拒绝|denied/i.test(msg)) {
      return { code: 'denied', msg: '未授权用户信息，无法上榜' };
    }
    if (e.type === 'toy_context_unavailable' || /not available on host/i.test(msg)) {
      return { code: 'host', msg: '不在 B站 里打开，榜单不可用' };
    }
    return { code: 'net', msg: '网络异常，请稍后再试' };
  }

  /** 调 SDK：同步抛错、Promise reject 都收成一个回调，限流走指数退避 */
  function call(fn, cb, attempt) {
    attempt = attempt || 0;
    var t = sdk();
    if (!t) { cb({ code: 'host', msg: '排行榜只在 B站 里可用' }); return; }

    var ret;
    try {
      ret = fn(t);
    } catch (e) {
      cb(mapErr(e));
      return;
    }
    if (!ret || typeof ret.then !== 'function') { cb(null, ret); return; }

    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      cb({ code: 'timeout', msg: '榜单加载超时，点「刷新」再试' });
    }, TIMEOUT_MS);

    ret.then(function (r) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(null, r);
    }, function (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      var err = mapErr(e);
      if (err.code === 'busy' && attempt < RETRY_MAX) {
        setTimeout(function () { call(fn, cb, attempt + 1); }, RETRY_MS * Math.pow(2, attempt));
        return;
      }
      cb(err);
    });
  }

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

  A.toy = {
    id: 'toy',
    label: 'B站 Toy',
    rankSupported: true,

    detect: function () {
      var t = sdk();
      return !!t && typeof t.getRankList === 'function';
    },

    list: function (req, cb) {
      call(function (t) { return t.getRankList(req); }, function (err, rows) {
        if (err) { cb(err); return; }
        var out = [], i, r;
        if (rows && rows.length) {
          for (i = 0; i < rows.length; i++) {
            r = rows[i] || {};
            out.push({
              rank: num(r.rank) || (i + 1),
              score: num(r.score),
              nickname: r.nickname || ('玩家' + (i + 1)),
              avatar: r.avatar || ''
            });
          }
        }
        cb(null, out);
      });
    },

    me: function (req, cb) {
      call(function (t) { return t.getMyRank(req); }, function (err, r) {
        if (err) { cb(err); return; }
        cb(null, {
          ranked: !!(r && r.ranked),
          rank: num(r && r.rank),
          score: num(r && r.score)
        });
      });
    },

    submit: function (req, cb) {
      call(function (t) { return t.submitScore(req); }, function (err, r) {
        if (err) { cb(err); return; }
        cb(null, { score: num(r && r.score) });
      });
    },

    cloud: {
      get: function (keys, cb) {
        call(function (t) { return t.getCloudStorage(keys); }, function (err, map) {
          if (err) { cb(err); return; }
          cb(null, map || {});
        });
      },
      set: function (items, cb) {
        call(function (t) { return t.setCloudStorage(items); }, function (err) {
          cb(err || null);
        });
      }
    }
  };
})();
