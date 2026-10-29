/**
 * 角色 / 地图 / 局外成长 / 成就
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  HS.Data = HS.Data || {};

  /**
   * 主角只有一个：鲸鱼娘。
   *
   * 以前这里有四个可解锁角色（士兵 / 医生 / 机械师 / 拾荒者），现在全部并掉了 ——
   * 数值沿用原来「退伍士兵」那一套（生命 100 / 速度 64 / 手枪开局 / 伤害 +10%），
   * 所以 tools/balance.js 的平衡基线不受影响，不用重新标定。
   *
   * sprite 由 game.js 拼成 player_whale / player_whale_happy 两张表情帧，
   * 表情切换只看 p.cheerT（搜刮成功后的开心跳），和数值无关。
   */
  HS.Data.chars = {
    whale: {
      id: 'whale', name: '鲸鱼娘', tag: '唯一幸存者',
      desc: '在死区里晃荡的鲸鱼娘。白围裙洗得发亮，枪法比打扫还利索。',
      hp: 100, speed: 64, weapon: 'pistol', dmgMul: 1.10, armor: 0, regen: 0,
      color: '#5f7cba', cost: 0,
      perks: ['伤害 +10%', '手枪开局', '搜刮成功会开心跳一下']
    }
  };

  HS.Data.charOrder = ['whale'];

  /**
   * 五张地图都是「一条公路」：
   *   1. 末世街区 —— 白天，街道 + 车壳
   *   2. 死区之夜 —— 同一片街区，天黑了：视野只有身边一圈，子弹也打不远
   *   3. 荒漠公路 —— 一条笔直的柏油路钻进地平线，路边零星几间屋子 / 旅馆，
   *      守着路的持枪匪徒会朝你点射
   *   4. 锈水高速 —— 沉进锈水的立交，浅水拖脚深水无路
   *   5. 公路隧道 —— 两侧是撞不穿的墙，没有楼没有岔路，只有一条走廊
   *
   * night  : 画面进入夜间模式（render.js 的 drawNight 负责压黑，只留身边的光）
   * vision : 夜视半径（世界像素）。中心到这里是全亮，再往外逐渐被黑吃掉
   * rangeMul: 局内所有武器射程倍率（Gear.global 按 p.rangeMul 结算）
   * gunmen : 刷怪时混入持枪匪徒的基础比例
   * tunnel : 隧道地形（render.js / obstacles.js 各有一套处理）
   * bossIds: 一场多个首领（都打死才通关）；只有一个首领时继续用 bossId
   */
  HS.Data.maps = {
    highway: {
      id: 'highway', name: '末世街区', theme: 'street',
      desc: '城市已经死了。街上的车壳能挡子弹，也能把你堵进死路。',
      spawnMul: 1.0, xpMul: 1.0, goldMul: 1.0, hpMul: 1.0, unlockWins: 0,
      /* 通关奖励：金币现在只从「搜刮」和「通关」两处来，难度越高给得越多 */
      clearGold: 30,
      /* 开荒 boss：血量 x4 + 全伤害 -50%，逼玩家在 6 分钟里把构筑养起来 */
      bossId: 'boss', bossHpMul: 4, bossDmgCut: 0.5,
      sky: '#1b1f24'
    },
    night: {
      id: 'night', name: '死区之夜', theme: 'street', night: true,
      desc: '同一条路，只是天黑了。手电只照出十几步，枪也打不远。',
      spawnMul: 1.15, xpMul: 1.12, goldMul: 1.18, hpMul: 1.08, resist: 0.03, unlockWins: 1, clearGold: 50,
      /* 扫射暴君：远程弹幕型，减伤 20%（bossDmgCut），射程/弹径在 AI 里走 bossType */
      bossId: 'gatling', bossDmgCut: 0.2,
      vision: 84, rangeMul: 0.68,
      sky: '#080b13'
    },
    desert: {
      id: 'desert', name: '荒漠公路', theme: 'desert',
      desc: '笔直的路，两边只有沙。路牌锈了，旅馆空了，枪手还在。',
      spawnMul: 1.05, xpMul: 1.25, goldMul: 1.3, hpMul: 1.16, resist: 0.05, unlockWins: 2, clearGold: 80,
      /* 猎杀者：速度型刺客 Boss，血厚 + 减伤 20%，技能机制在 AI 里走 bossType */
      bossId: 'stalker', bossDmgCut: 0.2,
      gunmen: 0.18,
      sky: '#2a1d12'
    },
    flood: {
      id: 'flood', name: '锈水高速', theme: 'flood',
      desc: '立交沉进锈水。浅水拖慢脚步，深水无路，电流不分敌我。',
      spawnMul: 1.10, xpMul: 1.35, goldMul: 1.4, hpMul: 1.24, resist: 0.08, unlockWins: 3, clearGold: 110,
      bossId: 'axeboss', bossDmgCut: 0.28,
      water: true,
      sky: '#172421'
    },
    /* 第五张：公路隧道。
       tunnel : render.js 走另一套地面（双侧连续隧道墙 + 顶灯光池 + 横梁黑影），
                obstacles.js 沿着 |x| = 88 生成两道不可破坏的墙，
                所以这张图没有楼、没有岔路，只有一条走廊。
       bossIds: 双首领（尖啸者 + 育母），两只都倒下才算通关 ——
                game.js 的 spawnBoss 认这个数组，killEnemy 认 run.bosses 的长度。 */
    tunnel: {
      id: 'tunnel', name: '公路隧道', theme: 'tunnel',
      desc: '钻进山体的旧隧道。墙撞不穿，顶灯三盏坏两盏，尸群只从前后压来。',
      spawnMul: 1.12, xpMul: 1.45, goldMul: 1.5, hpMul: 1.42, resist: 0.13,
      unlockWins: 4, clearGold: 140,
      bossIds: ['shrieker', 'brood'], bossDmgCut: 0.34,
      tunnel: true,
      sky: '#0e1116'
    }
  };

  HS.Data.mapOrder = ['highway', 'night', 'desert', 'flood', 'tunnel'];

  /** 局外永久强化 */
  HS.Data.perms = [
    {
      id: 'hp', name: '强化体质', maxLvl: 5, color: '#ff9f43',
      desc: function (l) { return '出发时生命 +' + (l * 8); },
      cost: function (l) { return 150 + l * 90; }
    },
    {
      id: 'dmg', name: '武器训练', maxLvl: 5, color: '#ff6b6b',
      desc: function (l) { return '所有伤害 +' + (l * 3) + '%'; },
      cost: function (l) { return 180 + l * 110; }
    },
    {
      id: 'spd', name: '战术步法', maxLvl: 5, color: '#7ee8fa',
      desc: function (l) { return '移动速度 +' + (l * 3) + '%'; },
      cost: function (l) { return 140 + l * 80; }
    },
    {
      id: 'luck', name: '幸运星', maxLvl: 3, color: '#ffe066',
      desc: function (l) { return '局内幸运 +' + (l * 8) + '%'; },
      cost: function (l) { return 260 + l * 150; }
    },
    {
      id: 'greed', name: '贪婪', maxLvl: 3, color: '#e9c46a',
      desc: function (l) { return '金币获取 +' + (l * 12) + '%'; },
      cost: function (l) { return 220 + l * 140; }
    },
    {
      id: 'revive', name: '备用血清', maxLvl: 2, color: '#8ce99a',
      desc: function (l) { return '每局可复活 ' + l + ' 次（50% 生命）'; },
      cost: function (l) { return 900 + l * 900; }
    }
  ];

  /** 成就 */
  HS.Data.achievements = [
    {
      id: 'k100', name: '第一桶血', desc: '累计击杀 100 个感染者',
      check: function (s) { return s.totalKills >= 100; }
    },
    {
      id: 'k1000', name: '清道夫', desc: '累计击杀 1000 个感染者',
      check: function (s) { return s.totalKills >= 1000; }
    },
    {
      id: 'win1', name: '活着上高速', desc: '首次击杀区域 Boss',
      check: function (s) { return s.wins >= 1; }
    },
    {
      id: 'win3', name: '老司机', desc: '累计通关 3 次',
      check: function (s) { return s.wins >= 3; }
    },
    {
      id: 'evo', name: '军火商', desc: '完成一次武器进化',
      check: function (s) { return s.evolutions >= 1; }
    },
    {
      id: 'lv20', name: '一夜长大', desc: '单局达到 20 级',
      check: function (s) { return s.bestLevel >= 20; }
    },
    {
      id: 'kills300', name: '屠夫', desc: '单局击杀 300 个感染者',
      check: function (s) { return s.bestKills >= 300; }
    },
    {
      id: 'gold3k', name: '废土富翁', desc: '累计获得 3000 金币',
      check: function (s) { return s.totalGold >= 3000; }
    },
    {
      id: 'runs10', name: '上瘾了', desc: '累计出发 10 次',
      check: function (s) { return s.runs >= 10; }
    }
  ];
})();
