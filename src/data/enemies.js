/**
 * 敌人数据表
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  HS.Data = HS.Data || {};

  HS.Data.enemies = {
    walker: {
      id: 'walker', name: '游荡者', sprite: 'walker',
      hp: 14, speed: 28, dmg: 5, r: 5.5, xp: 2, scale: 1,
      gold: 1, desc: '最常见的感染者，动作迟缓但数量惊人。'
    },
    runner: {
      id: 'runner', name: '疾行者', sprite: 'runner',
      hp: 9, speed: 51, dmg: 4, r: 4.5, xp: 2, scale: 1,
      gold: 1, desc: '被感染后仍在狂奔，脆但很快。'
    },
    crawler: {
      id: 'crawler', name: '爬行者', sprite: 'crawler',
      hp: 8, speed: 42, dmg: 4, r: 4, xp: 2, scale: 1,
      gold: 1, wobble: true, desc: '贴地爬行，轨迹飘忽，很难预判。'
    },
    spitter: {
      id: 'spitter', name: '吐酸者', sprite: 'spitter',
      hp: 22, speed: 23, dmg: 7, r: 5, xp: 3, scale: 1,
      gold: 2, ranged: true, range: 130, cd: 2.4, desc: '远程喷吐酸液，别站在原地。'
    },
    /* 死区之夜专属一：不是走得快，是会"扑"。蓄力半秒猛冲过来，
       扑空了自己踉跄 —— 听到嘶声往侧面挪一步就能罚它 */
    pouncer: {
      id: 'pouncer', name: '扑袭者', sprite: 'pouncer',
      hp: 20, speed: 36, dmg: 9, r: 5, xp: 3, scale: 1,
      gold: 2, pounce: true,
      desc: '肌肉扭曲的跳行者。压低身体嘶叫一声就会猛扑过来，扑空后会踉跄——那是最好的出手时机。'
    },
    /* 死区之夜专属二：远程不吐弹，吐"一片"。凑近了朝面前一条矩形呕吐，
       站在里面持续掉血 —— 别从它正面绕 */
    vomiter: {
      id: 'vomiter', name: '呕酸尸', sprite: 'vomiter',
      hp: 30, speed: 19, dmg: 6, r: 5.5, xp: 4, scale: 1,
      gold: 2, vomit: true, range: 66, cd: 3.4,
      desc: '胃囊撑到快爆的感染者。靠近后会朝面前一大片矩形呕吐毒液，蓄力时脚下会亮出预警框。'
    },
    brute: {
      id: 'brute', name: '壮汉', sprite: 'brute',
      hp: 78, speed: 21, dmg: 14, r: 9, xp: 7, scale: 1,
      gold: 4, desc: '肌肉膨胀的感染者，挨打也照走。'
    },
    /* 荒漠公路专属：不是感染者，是活人。会拉开距离点射，
       所以它比同血量的丧尸更烦人 —— 得先处理掉，不然一直被点。 */
    terrorist: {
      id: 'terrorist', name: '持枪匪徒', sprite: 'terrorist',
      hp: 24, speed: 32, dmg: 5, r: 5, xp: 5, scale: 1,
      gold: 3, ranged: true, gun: true, range: 150, cd: 2.1,
      desc: '守着公路的枪手。远远地站着朝你点射，看见他就别站在开阔地上。'
    },
    boss: {
      id: 'boss', name: '血肉暴君', sprite: 'boss',
      hp: 460, speed: 30, dmg: 20, r: 15, xp: 120, scale: 2,
      gold: 150, boss: true, bossType: 'tyrant',
      desc: '高速公路上的屠宰者，整片死区的源头。'
    },
    /* 死区之夜 Boss：抱着加特林的巨尸。它扫射时别往前顶，
       枪管过热的几秒是唯一的输出窗口 */
    gatling: {
      id: 'gatling', name: '扫射暴君', sprite: 'gatling',
      hp: 1000, speed: 20, dmg: 7, r: 15, xp: 130, scale: 2,
      gold: 150, boss: true, bossType: 'gatling',
      desc: '不知从哪具重机枪手尸体上长出来的巨物。加特林扫射弹幕又大又密，枪管随时可能过热——扫得越久越容易哑火，哑火那几秒它是活靶子。'
    },
    /* 荒漠公路 Boss：变异的狼形态猎杀者。快、狡猾，血越少打得越勤 */
    stalker: {
      id: 'stalker', name: '猎杀者', sprite: 'stalker',
      hp: 2150, speed: 41, dmg: 16, r: 13, xp: 140, scale: 2,
      gold: 150, boss: true, bossType: 'stalker',
      desc: '病毒把它改造成了狼的模样。三段扑杀一环扣一环，狂暴嚎叫还会召来周围所有丧尸——血越少，它越疯狂。'
    }
  };

  /** 精英强化系数 */
  HS.Data.elite = {
    hpMul: 6, dmgMul: 1.3, xpMul: 4, goldMul: 4, scale: 1.5,
    tint: '#ff3b3b', tintAmt: 0.34
  };
})();
