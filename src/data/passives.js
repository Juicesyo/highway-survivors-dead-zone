/**
 * 通用属性（原「被动装备」层）
 *
 * 这一层只做「整体战斗能力」的强化，不绑定具体武器。
 * 每个 id 都在 game.js 的 recalc 里有对应结算，装备字段：
 *   cat   属性类别（伤害 / 攻击 / 弹道 / 范围 / 生存 / 机动与成长）
 *   apply 适用范围说明（升级卡副标题用它解释"这条对谁有用"）
 *   cap   生效上限提示（真实封顶在 recalc 里）
 *   gear  1 = 防护装备，进 gearPool，卡面标「防护装备」
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  HS.Data = HS.Data || {};

  HS.Data.passives = {
    /* ---------------- 伤害 ---------------- */
    power: {
      id: 'power', name: '伤害加成', icon: 'power', color: '#ff6b6b', maxLvl: 5,
      cat: '伤害', apply: '全部武器',
      desc: function (l) { return '所有武器伤害 +' + (l * 8) + '%'; }
    },
    crit: {
      id: 'crit', name: '暴击率', icon: 'crit', color: '#ff4d6d', maxLvl: 5,
      cat: '伤害', apply: '全部武器', cap: '上限 60%',
      desc: function (l) { return '暴击率 +' + (l * 5) + '%（封顶 60%）'; }
    },
    critdmg: {
      id: 'critdmg', name: '暴击伤害', icon: 'critdmg', color: '#ff8fa3', maxLvl: 5,
      cat: '伤害', apply: '全部武器',
      desc: function (l) { return '暴击伤害 +' + (l * 15) + '%'; }
    },

    /* ---------------- 攻击 ---------------- */
    haste: {
      id: 'haste', name: '攻击速度', icon: 'haste', color: '#ffd166', maxLvl: 5,
      cat: '攻击', apply: '持续射击 / 近战',
      desc: function (l) { return '攻击速度 +' + (l * 10) + '%（对冷却类武器减半）'; }
    },
    cdr: {
      id: 'cdr', name: '冷却缩减', icon: 'coolant', color: '#a5d8ff', maxLvl: 4,
      cat: '攻击', apply: '有独立冷却的武器', cap: '上限 40%',
      desc: function (l) { return '技能冷却 -' + (l * 6) + '%（上限 40%）'; }
    },
    projCount: {
      id: 'projCount', name: '弹丸数量', icon: 'barrel', color: '#e9c46a', maxLvl: 2,
      cat: '攻击', apply: '枪械 / 投掷 / 近战目标数',
      desc: function (l) { return '每次攻击 +' + l + ' 发弹丸 / 道光束（近战转目标数）'; }
    },

    /* ---------------- 弹道 ---------------- */
    pierce: {
      id: 'pierce', name: '穿透', icon: 'ammo', color: '#dee2e6', maxLvl: 3,
      cat: '弹道', apply: '枪械 / 能量 / 近战目标数',
      desc: function (l) { return '穿透 +' + l + ' 个目标（近战转为目标数 +' + l + '）'; }
    },
    split: {
      id: 'split', name: '分裂', icon: 'blades', color: '#c9d1d9', maxLvl: 2,
      cat: '弹道', apply: '枪械 / 爆炸 / 近战回响',
      desc: function (l) { return '命中后分裂出 ' + l + ' 枚次级弹（近战为回响斩）'; }
    },
    bounce: {
      id: 'bounce', name: '弹射', icon: 'tesla', color: '#7ee8fa', maxLvl: 2,
      cat: '弹道', apply: '枪械 / 能量',
      desc: function (l) { return '命中后弹射到 ' + l + ' 个新目标'; }
    },
    chainbolt: {
      id: 'chainbolt', name: '连锁闪电', icon: 'tesla', color: '#a8f3ff', maxLvl: 3,
      cat: '弹道', apply: '全部武器 · 按开火次数蓄能',
      desc: function (l) {
        return '每 ' + HS.Data.chainNeed(l) + ' 次开火放出一道连锁闪电，跳 ' + (2 + l) +
          ' 个目标（每跳 ' + Math.round((40 + 20 * l)) + '% 武器伤害）';
      }
    },
    homing: {
      id: 'homing', name: '追踪', icon: 'magnet', color: '#b197fc', maxLvl: 1,
      cat: '弹道', apply: '枪械 / 导弹',
      desc: function () { return '弹丸会缓慢修正方向追击最近目标'; }
    },

    /* ---------------- 范围 ---------------- */
    range: {
      id: 'range', name: '攻击范围', icon: 'gauge', color: '#74c0fc', maxLvl: 4,
      cat: '范围', apply: '全部武器',
      desc: function (l) { return '攻击距离 / 挥砍半径 +' + (l * 8) + '%'; }
    },
    blast: {
      id: 'blast', name: '爆炸半径', icon: 'powder', color: '#d9a15b', maxLvl: 4,
      cat: '范围', apply: '爆炸物 / 光环 / 区域',
      desc: function (l) { return '爆炸与区域半径 +' + (l * 10) + '%'; }
    },
    duration: {
      id: 'duration', name: '持续时间', icon: 'fuel', color: '#ff8b3d', maxLvl: 3,
      cat: '范围', apply: '燃烧地面 / 区域 / 增益',
      desc: function (l) { return '地面效果与增益持续时间 +' + (l * 12) + '%'; }
    },

    /* ---------------- 元素 ----------------
     * 这几条只对"吃得到"的武器生效，`needs` 会在 game.js 的 statOk 里当门槛用：
     * 手上没有对应元素的武器就不会出这张卡，避免刷出点了没用的废卡。
     * （火焰 / 冰霜 / 持续伤害自带无视护甲，所以破甲对它们无效。） */
    burnDmg: {
      id: 'burnDmg', name: '燃烧专精', icon: 'flamer', color: '#ff8b3d', maxLvl: 4,
      cat: '元素', apply: '火焰 / 燃烧类', needs: 'fire',
      desc: function (l) { return '燃烧与火焰持续伤害 +' + (l * 20) + '%'; }
    },
    chill: {
      id: 'chill', name: '低温专精', icon: 'frost', color: '#9ad0ff', maxLvl: 3,
      cat: '元素', apply: '冰霜 / 减速类', needs: 'ice',
      desc: function (l) { return '减速 +' + (l * 6) + '%，冻结时长 +' + (l * 10) + '%'; }
    },
    steam: {
      id: 'steam', name: '霜火反应', icon: 'ring', color: '#cfefff', maxLvl: 3,
      cat: '元素', apply: '冰火同持', needs: 'both',
      desc: function (l) { return '冰打燃烧目标时爆一次，附带 ' + (l * 60) + '% 燃烧伤害'; }
    },

    /* ---------------- 伤害 ---------------- */
    pierceArmor: {
      id: 'pierceArmor', name: '破甲', icon: 'ammo', color: '#d9a15b', maxLvl: 4,
      cat: '伤害', apply: '实弹 / 近战 / 爆炸',
      desc: function (l) { return '无视 ' + (l * 15) + '% 护甲（火焰/持续伤害不吃）'; }
    },
    execute: {
      id: 'execute', name: '处决', icon: 'critdmg', color: '#ff6b6b', maxLvl: 4,
      cat: '伤害', apply: '直接伤害 / 燃烧',
      desc: function (l) {
        return '生命值低于 ' + Math.round(HS.Data.execCut(l) * 100) + '% 的敌人直接被处决' +
          '（Boss 免疫，精英阈值减半）';
      }
    },

    /* ---------------- 生存 ---------------- */
    vigor: {
      id: 'vigor', name: '体质', icon: 'vigor', color: '#ff9f43', maxLvl: 5,
      cat: '生存', apply: '角色',
      desc: function (l) { return '最大生命 +' + (l * 14) + '，并立即回复'; }
    },
    armor: {
      id: 'armor', name: '护甲', icon: 'armor', color: '#adb5bd', maxLvl: 4,
      cat: '生存', apply: '角色', cap: '减伤上限 8',
      desc: function (l) { return '每次受到的伤害 -' + l + '（上限 8）'; }
    },
    dodge: {
      id: 'dodge', name: '闪避', icon: 'swift', color: '#63e6be', maxLvl: 3,
      cat: '生存', apply: '角色', cap: '上限 24%',
      desc: function (l) { return '受击时 ' + (l * 8) + '% 概率完全闪避（上限 24%）'; }
    },
    lifesteal: {
      id: 'lifesteal', name: '击杀回复', icon: 'regen', color: '#8ce99a', maxLvl: 3,
      cat: '生存', apply: '角色',
      desc: function (l) { return '每次击杀回复 ' + (l * 0.6).toFixed(1) + ' 点生命'; }
    },
    regen: {
      id: 'regen', name: '再生', icon: 'regen', color: '#8ce99a', maxLvl: 4,
      cat: '生存', apply: '角色',
      desc: function (l) { return '每秒回复 ' + (l * 0.45).toFixed(1) + ' 生命'; }
    },

    /* ---------------- 机动与成长 ---------------- */
    swift: {
      id: 'swift', name: '移动速度', icon: 'swift', color: '#7ee8fa', maxLvl: 5,
      cat: '机动', apply: '角色',
      desc: function (l) { return '移动速度 +' + (l * 6) + '%'; }
    },
    magnet: {
      id: 'magnet', name: '拾取范围', icon: 'magnet', color: '#b197fc', maxLvl: 4,
      cat: '成长', apply: '经验宝石',
      desc: function (l) { return '经验拾取范围 +' + (l * 24) + '%，范围外要自己捡'; }
    },
    study: {
      id: 'study', name: '经验获取', icon: 'study', color: '#74c0fc', maxLvl: 4,
      cat: '成长', apply: '角色',
      desc: function (l) { return '获得经验 +' + (l * 9) + '%'; }
    },
    greed: {
      id: 'greed', name: '金币获取', icon: 'luck', color: '#e9c46a', maxLvl: 3,
      cat: '成长', apply: '结算 / 掉落',
      desc: function (l) { return '金币获取 +' + (l * 10) + '%'; }
    },
    luck: {
      id: 'luck', name: '幸运', icon: 'luck', color: '#ffe066', maxLvl: 5,
      cat: '成长', apply: '升级抽卡',
      desc: function (l) { return '更容易出现专属 / 联动 / 进化选项'; }
    },

    /* ---------------- 防护装备（gear:1） ---------------- */
    helmet: {
      id: 'helmet', name: '防暴头盔', icon: 'helmet', color: '#9fb3c8', maxLvl: 3, gear: 1,
      cat: '防护', apply: '角色',
      desc: function (l) { return '受击后的无敌时间 +' + (l * 0.15).toFixed(2) + ' 秒'; }
    },
    vest: {
      id: 'vest', name: '防弹背心', icon: 'vest', color: '#7f9cb8', maxLvl: 4, gear: 1,
      cat: '防护', apply: '角色',
      desc: function (l) { return '最大生命 +' + (l * 12) + '%'; }
    },
    respirator: {
      id: 'respirator', name: '防毒面罩', icon: 'respirator', color: '#7ec8a0', maxLvl: 3, gear: 1,
      cat: '防护', apply: '角色',
      desc: function (l) { return '酸液 / 投掷物伤害 -' + (l * 20) + '%'; }
    },
    plating: {
      id: 'plating', name: '车体装甲', icon: 'plating', color: '#b8a06a', maxLvl: 4, gear: 1,
      cat: '防护', apply: '载具',
      desc: function (l) { return '载具最大耐久 +' + (l * 20) + '%'; }
    },
    ram: {
      id: 'ram', name: '焊接撞角', icon: 'ram', color: '#e08c4a', maxLvl: 3, gear: 1,
      cat: '防护', apply: '载具',
      desc: function (l) { return '碾压伤害 +' + (l * 25) + '%，撞击磨损 -' + (l * 10) + '%'; }
    },
    harness: {
      id: 'harness', name: '四点安全带', icon: 'harness', color: '#d8c37a', maxLvl: 3, gear: 1,
      cat: '防护', apply: '载具',
      desc: function (l) { return '车内受损 -' + (l * 9) + '%，报废时甩出伤害 -' + (l * 30) + '%'; }
    }
  };

  /**
   * 处决血线：生命值低于这个比例的敌人一命中就直接收掉。
   * 1~4 级 12% / 17% / 22% / 28% —— 它不是"加伤"，是把残血怪一次性收干净的斩杀线。
   */
  HS.Data.execCut = function (lvl) {
    var t = [0, 0.12, 0.17, 0.22, 0.28];
    return t[lvl] || 0;
  };

  /** 连锁闪电的蓄能间隔（开火次数） */
  HS.Data.chainNeed = function (lvl) {
    if (lvl >= 3) return 3;
    if (lvl === 2) return 4;
    return 6;
  };

  /** 通用属性池（不含防护装备） */
  HS.Data.passivePool = [
    'power', 'crit', 'critdmg',
    'burnDmg', 'chill', 'steam', 'pierceArmor', 'execute',
    'haste', 'cdr', 'projCount',
    'pierce', 'split', 'bounce', 'chainbolt', 'homing',
    'range', 'blast', 'duration',
    'vigor', 'armor', 'dodge', 'lifesteal', 'regen',
    'swift', 'magnet', 'study', 'greed', 'luck'
  ];

  /** 防护装备池：只在"还有属性位"时出现 */
  HS.Data.gearPool = ['helmet', 'vest', 'respirator', 'plating', 'ram', 'harness'];
})();
