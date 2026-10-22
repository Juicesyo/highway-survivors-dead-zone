/**
 * 场景道具表
 * solid      : 是否阻挡角色
 * blockBullets: 是否挡子弹（低矮的轮胎堆/木箱可以打过去）
 * loot       : 搜刮表（null 表示不可搜刮）
 * crash      : 载具撞上去的固定耐久损耗（越小越"软"）
 * brittle    : 载具能直接撞碎（碎掉后不再挡路、也不再能搜刮）
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  HS.Data = HS.Data || {};

  HS.Data.props = {
    sedan: {
      id: 'sedan', w: 24, h: 40, pad: 1,
      vFrames: ['car_sedan_v', 'car_blue_v', 'car_burnt_v'], hFrames: ['car_sedan_h', 'car_blue_h', 'car_burnt_h'],
      solid: 1, blockBullets: 1, loot: 'car', lootChance: 0.5, crash: 11,
      weight: { street: 22, gas: 9, garage: 34, desert: 9 }
    },
    van: {
      id: 'van', w: 26, h: 44, pad: 1,
      vFrames: ['car_van_v'], hFrames: ['car_van_h'],
      solid: 1, blockBullets: 1, loot: 'van', lootChance: 0.62, crash: 13,
      weight: { street: 6, gas: 4, garage: 8, desert: 2 }
    },
    barrier: {
      id: 'barrier', w: 34, h: 12, pad: 0,
      vFrames: ['barrier_v'], hFrames: ['barrier_h'],
      solid: 1, blockBullets: 1, loot: null, crash: 8,
      weight: { street: 24, gas: 14, garage: 16, desert: 5 }
    },
    dumpster: {
      id: 'dumpster', w: 24, h: 18, pad: 1,
      vFrames: ['dumpster'], hFrames: ['dumpster'],
      solid: 1, blockBullets: 0, loot: 'dumpster', lootChance: 0.7, crash: 6,
      weight: { street: 16, gas: 12, garage: 12, desert: 0 }
    },
    crate: {
      id: 'crate', w: 16, h: 16, pad: 1,
      vFrames: ['crate'], hFrames: ['crate'],
      solid: 1, blockBullets: 0, loot: 'crate', lootChance: 1, crash: 2, brittle: 1,
      weight: { street: 15, gas: 20, garage: 8, desert: 6 }
    },
    tires: {
      id: 'tires', w: 18, h: 18, pad: 2,
      vFrames: ['tires'], hFrames: ['tires'],
      solid: 1, blockBullets: 0, loot: null, crash: 4,
      weight: { street: 10, gas: 11, garage: 12, desert: 4 }
    },
    cone: {
      id: 'cone', w: 10, h: 12, pad: 0,
      vFrames: ['cone'], hFrames: ['cone'],
      solid: 0, blockBullets: 0, loot: null, crash: 0,
      weight: { street: 19, gas: 14, garage: 4, desert: 10 }
    },

    /* ---------- 荒漠公路专属：让路边不是一片空白 ---------- */

    /* 路边广告牌：木板已经晒白，钉子全锈了。够高，能挡子弹 */
    billboard: {
      id: 'billboard', w: 44, h: 30, pad: 2,
      vFrames: ['billboard'], hFrames: ['billboard'],
      solid: 1, blockBullets: 1, loot: null, crash: 8,
      weight: { desert: 10 }
    },
    /* 公路指示牌：矮、能被车撞倒 */
    signpost: {
      id: 'signpost', w: 16, h: 24, pad: 1,
      vFrames: ['signpost'], hFrames: ['signpost'],
      solid: 1, blockBullets: 0, loot: null, crash: 3, brittle: 1,
      weight: { desert: 13 }
    },
    /* 汽车旅馆的立牌：比路牌高，一眼就能认出"这里有人住过" */
    motelsign: {
      id: 'motelsign', w: 18, h: 30, pad: 1,
      vFrames: ['motelsign'], hFrames: ['motelsign'],
      solid: 1, blockBullets: 0, loot: null, crash: 4, brittle: 1,
      weight: { desert: 4 }
    },
    cactus: {
      id: 'cactus', w: 16, h: 26, pad: 2,
      vFrames: ['cactus'], hFrames: ['cactus'],
      solid: 1, blockBullets: 0, loot: null, crash: 4,
      weight: { desert: 17 }
    },
    rock: {
      id: 'rock', w: 24, h: 18, pad: 2,
      vFrames: ['rock'], hFrames: ['rock'],
      solid: 1, blockBullets: 1, loot: null, crash: 13,
      weight: { desert: 15 }
    },
    /* 牛头骨：纯装饰，不挡路 —— 荒野里"这段没人活着走过"的记号 */
    skull: {
      id: 'skull', w: 12, h: 8, pad: 0,
      vFrames: ['skull'], hFrames: ['skull'],
      solid: 0, blockBullets: 0, loot: null, crash: 0,
      weight: { desert: 9 }
    }
  };

  /* 搜刮产出：血包概率压低（回复靠血包会太稳，逼玩家认真走位），
     金币整体砍掉约四成 —— 金币主要走结算，搜刮只是零头 */
  HS.Data.loot = {
    car: { gold: [2, 5], gem: 0.5, gemN: 4, heart: 0.06, chest: 0.07, name: '轿车' },
    van: { gold: [3, 8], gem: 0.6, gemN: 5, heart: 0.08, chest: 0.12, name: '货车' },
    dumpster: { gold: [2, 6], gem: 0.4, gemN: 3, heart: 0.05, chest: 0.05, name: '垃圾箱' },
    crate: { gold: [2, 5], gem: 0.42, gemN: 3, heart: 0.06, chest: 0.05, name: '木箱' },
    /* 建筑室内：进楼要冒险，产出明显好于路边车壳 */
    home: { gold: [4, 9], gem: 0.78, gemN: 4, heart: 0.1, chest: 0.16, name: '居民房' },
    motel: { gold: [6, 14], gem: 0.86, gemN: 5, heart: 0.1, chest: 0.22, name: '汽车旅馆' },
    office: { gold: [5, 12], gem: 0.86, gemN: 5, heart: 0.07, chest: 0.2, name: '写字楼' },
    warehouse: { gold: [6, 14], gem: 0.82, gemN: 5, heart: 0.08, chest: 0.24, name: '仓库' },
    roof: { gold: [7, 16], gem: 1, gemN: 6, heart: 0.12, chest: 0.34, name: '楼顶物资' }
  };

  /** 每张地图的「有道具的区块比例」 */
  HS.Data.propDensity = { street: 0.55, desert: 0.34 };
})();
