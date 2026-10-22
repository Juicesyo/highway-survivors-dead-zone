/**
 * 角色 / 地图 / 局外成长 / 成就
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  HS.Data = HS.Data || {};

  HS.Data.chars = {
    soldier: {
      id: 'soldier', name: '退伍士兵', tag: '均衡',
      desc: '在高速公路上丢了队伍的老兵。伤害稳定，适合第一次上路。',
      hp: 100, speed: 64, weapon: 'pistol', dmgMul: 1.10, armor: 0, regen: 0,
      color: '#5b8ac9', cost: 0,
      perks: ['伤害 +10%', '手枪开局', '副武器槽空着']
    },
    medic: {
      id: 'medic', name: '战地医生', tag: '续航',
      desc: '背着急救包跑得比谁都快，伤口自己会好。',
      hp: 90, speed: 67, weapon: 'smg', sub: 'syringe', dmgMul: 1.0, armor: 0, regen: 0.75,
      color: '#d8dee6', cost: 300,
      perks: ['每秒回复 0.75', '移速更快', '冲锋枪 + 治疗注射器']
    },
    mechanic: {
      id: 'mechanic', name: '废土机械师', tag: '肉盾',
      desc: '把报废零件焊成了旋转刀片，皮糙肉厚，专治贴脸。',
      hp: 122, speed: 59, weapon: 'chainsaw', auto: ['orbitblade'], dmgMul: 1.0, armor: 1, regen: 0,
      color: '#d9a441', cost: 700,
      perks: ['最大生命 +22', '减伤 1 点', '链锯 + 旋转飞刀']
    },
    ghost: {
      id: 'ghost', name: '拾荒者', tag: '高风险',
      desc: '没人知道他的真名。跑得极快，但只有 70 点生命。',
      hp: 70, speed: 78, weapon: 'shotgun', sub: 'throwingknife', dmgMul: 1.22, armor: 0, regen: 0,
      color: '#9b7bd4', cost: 1200,
      perks: ['伤害 +22%', '移速 +22%', '霰弹枪 + 飞刀，生命很低']
    }
  };

  HS.Data.charOrder = ['soldier', 'medic', 'mechanic', 'ghost'];

  /**
   * 三张地图都是「一条公路」：
   *   1. 末世街区 —— 白天，街道 + 车壳
   *   2. 死区之夜 —— 同一片街区，天黑了：视野只有身边一圈，子弹也打不远
   *   3. 荒漠公路 —— 一条笔直的柏油路钻进地平线，路边零星几间屋子 / 旅馆，
   *      守着路的持枪匪徒会朝你点射
   *
   * night  : 画面进入夜间模式（render.js 的 drawNight 负责压黑，只留身边的光）
   * vision : 夜视半径（世界像素）。中心到这里是全亮，再往外逐渐被黑吃掉
   * rangeMul: 局内所有武器射程倍率（Gear.global 按 p.rangeMul 结算）
   * gunmen : 刷怪时混入持枪匪徒的基础比例
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
      spawnMul: 1.15, xpMul: 1.12, goldMul: 1.18, hpMul: 1.02, unlockWins: 1, clearGold: 50,
      /* 扫射暴君：远程弹幕型，减伤 20%（bossDmgCut），射程/弹径在 AI 里走 bossType */
      bossId: 'gatling', bossDmgCut: 0.2,
      vision: 84, rangeMul: 0.68,
      sky: '#080b13'
    },
    desert: {
      id: 'desert', name: '荒漠公路', theme: 'desert',
      desc: '笔直的路，两边只有沙。路牌锈了，旅馆空了，枪手还在。',
      spawnMul: 1.05, xpMul: 1.25, goldMul: 1.3, hpMul: 1.02, unlockWins: 2, clearGold: 80,
      /* 猎杀者：速度型刺客 Boss，血厚 + 减伤 20%，技能机制在 AI 里走 bossType */
      bossId: 'stalker', bossDmgCut: 0.2,
      gunmen: 0.18,
      sky: '#2a1d12'
    }
  };

  HS.Data.mapOrder = ['highway', 'night', 'desert'];

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
      id: 'chars', name: '全员到齐', desc: '解锁全部角色',
      check: function (s) { return s.chars.length >= 4; }
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
