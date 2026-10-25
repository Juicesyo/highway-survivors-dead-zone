/**
 * 存档（wx storage / localStorage）
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var P = HS.P;

  var KEY = 'hsdz_save_v1';

  function defaults() {
    return {
      v: 1,
      gold: 0,
      chars: ['soldier'],
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
      unlockedMaps: ['highway'],
      seen: { weapons: [], enemies: [] },
      ach: {},
      sfx: true,
      bgm: true,
      vib: true,
      fxLow: false
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

  var Save = {
    data: null,

    load: function () {
      var raw = P.get(KEY);
      var d = defaults();
      /* 某些环境（旧基础库 / 真机）里 storage 取回来是 JSON 字符串而不是对象，
         这里再解一层；解不开就当作空存档继续启动 —— 坏档绝不能把游戏卡死在启动页 */
      if (typeof raw === 'string' && raw) {
        try { raw = JSON.parse(raw); } catch (e) { raw = null; }
      }
      if (raw && typeof raw === 'object') {
        for (var k in d) {
          if (raw[k] === undefined) continue;
          if (k === 'perm' || k === 'seen') {
            for (var kk in d[k]) if (raw[k][kk] !== undefined) d[k][kk] = raw[k][kk];
          } else {
            d[k] = raw[k];
          }
        }
        migrateMaps(d);
      }
      Save.data = d;
      return d;
    },

    flush: function () {
      if (!Save.data) return;
      P.set(KEY, Save.data);
    },

    reset: function () {
      Save.data = defaults();
      Save.flush();
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

    hasChar: function (id) { return Save.data.chars.indexOf(id) >= 0; },

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
