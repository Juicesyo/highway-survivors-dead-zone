/**
 * 存档
 *
 * 本地：微信走 wx storage，浏览器 / Toy 走 localStorage（由 P.get/P.set 分流），
 *       两边物理隔离，微信的档绝不会读到 Toy 的档。
 * 云端：只有具备云存储能力的宿主（目前是 B站 Toy）才有，key 带宿主前缀
 *       （hsdz1.toy.save / hsdz1.wx.save），哪怕共用一个云也撞不上。
 *
 * 云端同步只做两件事，都是"关键节点"：
 *   1. 启动时拉一次，云端比本地新才覆盖（换设备不丢进度）
 *   2. 结算 / 切后台时推一次（不在游玩过程中反复写，Toy 是按作品共享额度的）
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var P = HS.P;

  var KEY = 'hsdz_save_v1';
  var CLOUD_T = 0;

  function defaults() {
    return {
      v: 1,
      gold: 0,
      /* 角色只剩鲸鱼娘一个：这个数组留着是为了老存档能平滑迁移 */
      chars: ['whale'],
      perm: { hp: 0, dmg: 0, spd: 0, luck: 0, greed: 0, revive: 0 },
      wins: 0,
      /* 各地图通关次数：解锁改成"通关前一关"（顺序推进），不再按累计次数 */
      mapWins: {},
      runs: 0,
      totalKills: 0,
      totalGold: 0,
      evolutions: 0,
      bestLevel: 1,
      bestKills: 0,
      bestTime: 0,
      /* 无尽模式：只统计这一个模式，和 6 分钟通关的 bestTime 分开记 */
      bestEndless: 0,
      endlessRuns: 0,
      unlockedMaps: ['highway'],
      seen: { weapons: [], enemies: [] },
      ach: {},
      sfx: true,
      bgm: true,
      vib: true,
      fxLow: false,
      /* 角色朝向跟随移动方向（关掉 = 永远正面朝镜头） */
      turnView: true,
      /* 云存档合并用：谁的时间新用谁的 */
      updatedAt: 0
    };
  }

  /* 老存档里的地图 id：加油站 / 地下停车场 已经被夜景公路 / 荒漠公路替换，
     解锁进度要平移过来，否则老玩家一进来三张图全锁着 */
  var MAP_ALIAS = { gas: 'night', garage: 'desert' };

  function migrateMaps(d) {
    if (!d.unlockedMaps || !d.unlockedMaps.length) return;
    var out = [];
    for (var i = 0; i < d.unlockedMaps.length; i++) {
      var id = d.unlockedMaps[i];
      id = MAP_ALIAS[id] || id;
      if (out.indexOf(id) < 0) out.push(id);
    }
    d.unlockedMaps = out;

    /* 旧存档迁移：mapWins 是新字段。已解锁的图视为"前一关通过关"；
       老的累计 wins 也折给第一张图，通关过就别让玩家重打。 */
    if (!d.mapWins) d.mapWins = {};
    var order = HS.Data.mapOrder || ['highway', 'night', 'desert', 'flood'];
    if (d.wins > 0 && !d.mapWins.highway) d.mapWins.highway = d.wins;
    for (var j = 1; j < order.length; j++) {
      if (out.indexOf(order[j]) >= 0 && !d.mapWins[order[j - 1]]) {
        d.mapWins[order[j - 1]] = 1;
      }
    }
    /* 按当前解锁规则自愈：前一关通关过 → 下一张必然解锁。
       老玩家"通关 N 次却没解锁"的坏档（历史原因留下的）在这里一并修好 */
    for (var j2 = 1; j2 < order.length; j2++) {
      if ((d.mapWins[order[j2 - 1]] || 0) >= 1 && out.indexOf(order[j2]) < 0) {
        out.push(order[j2]);
      }
    }
    d.unlockedMaps = out;
  }

  /* 四个可选角色已经被鲸鱼娘顶掉：老存档里存的 soldier/medic/... 一律并成 whale，
     否则 game.js 里 D.chars[charId] 取不到人，会退回默认值但界面仍显示旧角色名 */
  function migrateChars(d) {
    if (!d.chars || !d.chars.length || d.chars.length !== 1 || d.chars[0] !== 'whale') {
      d.chars = ['whale'];
    }
  }

  /** 把一份原始存档填进目标对象（就地填，保持引用不变） */
  function fill(d, raw) {
    if (typeof raw === 'string' && raw) {
      try { raw = JSON.parse(raw); } catch (e) { raw = null; }
    }
    if (!raw || typeof raw !== 'object') return d;
    for (var k in d) {
      if (raw[k] === undefined) continue;
      if (k === 'perm' || k === 'seen') {
        for (var kk in d[k]) if (raw[k][kk] !== undefined) d[k][kk] = raw[k][kk];
      } else {
        d[k] = raw[k];
      }
    }
    migrateMaps(d);
    migrateChars(d);
    return d;
  }

  var Save = {
    data: null,

    load: function () {
      var raw = P.get(KEY);
      /* 某些环境（旧基础库 / 真机）里 storage 取回来是 JSON 字符串而不是对象，
         这里再解一层；解不开就当作空存档继续启动 —— 坏档绝不能把游戏卡死在启动页 */
      var d = defaults();
      fill(d, raw);
      Save.data = d;
      return d;
    },

    flush: function () {
      if (!Save.data) return;
      Save.data.updatedAt = Date.now();
      P.set(KEY, Save.data);
    },

    reset: function () {
      Save.data = defaults();
      Save.flush();
    },

    /* ---------------- 云存档 ---------------- */

    /** 启动时拉一次：云端比本地新才覆盖。换设备打开就是云端的进度 */
    pullCloud: function (cb) {
      if (!HS.Host || !HS.Host.canCloud || !HS.Host.canCloud()) { if (cb) cb(false); return; }
      var key = HS.Host.storageKey('save');
      HS.Host.cloudGet([key], function (err, map) {
        if (err || !map || map[key] === undefined) { if (cb) cb(false); return; }
        var remote = map[key];
        if (typeof remote === 'string' && remote) {
          try { remote = JSON.parse(remote); } catch (e) { remote = null; }
        }
        if (!remote || typeof remote !== 'object') { if (cb) cb(false); return; }
        var local = Save.data || defaults();
        if ((remote.updatedAt || 0) <= (local.updatedAt || 0) + 1000) { if (cb) cb(false); return; }
        fill(local, remote);
        P.set(KEY, local);
        if (cb) cb(true);
      });
    },

    /** 结算 / 切后台推一次。失败不影响本地存档 */
    pushCloud: function () {
      if (!Save.data) return;
      if (!HS.Host || !HS.Host.canCloud || !HS.Host.canCloud()) return;
      var now = Date.now();
      if (now - CLOUD_T < 2000) return;   // 连点两下结算别打两次
      CLOUD_T = now;
      var items = {};
      items[HS.Host.storageKey('save')] = JSON.stringify(Save.data);
      HS.Host.cloudSet(items, function () {});
    },

    gold: function (n) {
      Save.data.gold = Math.max(0, Save.data.gold + n);
      if (n > 0) Save.data.totalGold += n;
      Save.flush();
    },

    addSeen: function (kind, id) {
      var arr = Save.data.seen[kind];
      if (arr.indexOf(id) < 0) { arr.push(id); Save.flush(); }
    },

    /* 只有一个角色，永远为真；保留接口是因为云存档和旧代码还在调 */
    hasChar: function (id) { return id === 'whale'; },

    unlockMap: function (id) {
      if (Save.data.unlockedMaps.indexOf(id) < 0) {
        Save.data.unlockedMaps.push(id);
        Save.flush();
      }
    },

    checkAch: function () {
      var s = Save.data, got = [];
      for (var i = 0; i < HS.Data.achievements.length; i++) {
        var a = HS.Data.achievements[i];
        if (!s.ach[a.id] && a.check(s)) {
          s.ach[a.id] = 1;
          got.push(a);
        }
      }
      if (got.length) Save.flush();
      return got;
    }
  };

  HS.Save = Save;
})();
