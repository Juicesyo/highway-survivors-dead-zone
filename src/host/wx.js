/**
 * 微信小游戏适配器
 *
 * 存档：wx storage（P.get/P.set 已在 platform.js 里走这条路），天然和 Toy 隔离。
 * 排行榜：本期还没接 —— 微信的排行榜有两条路，选哪条要先定：
 *
 *   A. 开放数据域好友榜（推荐给「好友之间比一比」）
 *      - 主域 wx.setUserCloudStorage 写 KV，再在开放数据域里 getFriendCloudStorage 拉好友成绩
 *      - 需要一个独立子工程 openDataContext/（单独的 canvas + 单独的 wx API 环境）
 *      - 只能在微信开发者工具 / 真机里验证，网页端跑不了
 *   B. 云开发（推荐给「全服榜、和 Toy 排行榜同构」）
 *      - 云函数 rank（提交 + 分页查询），排行榜数据放云数据库
 *      - 需要小游戏 appid 下开通云开发环境，本文档不代填 env
 *
 * 两条路都只动这个文件 + 一个平台侧工程，核心玩法与 UI 不用改：
 * rankSupported 改 true，实现 list/me/submit 即可（返回结构与 toy.js 一致）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var A = HS.HostAdapters || (HS.HostAdapters = {});

  function off(msg) { return { code: 'unsupported', msg: msg }; }

  A.wx = {
    id: 'wx',
    label: '微信小游戏',
    rankSupported: false,
    rankNote: '微信排行榜待接入（开放数据域好友榜 / 云开发，二选一）',

    detect: function () {
      return typeof wx !== 'undefined' && !!wx.getSystemInfoSync;
    },

    list: function (req, cb) { cb(off('微信排行榜还没接')); },
    me: function (req, cb) { cb(off('微信排行榜还没接')); },
    submit: function (req, cb) { cb(off('微信排行榜还没接')); }
  };
})();
