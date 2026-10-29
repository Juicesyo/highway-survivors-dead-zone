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
    /* 锈水高速专属：全场唯一能横穿深水的东西。
       别人（玩家、丧尸、载具）只能绕开的深水，是它的近路 —— 沉下去游过来，
       浮出前水面只剩一道涟漪。别和扑袭者搞混：它不扑，它是"从水里出现"。
       emergeGuard：出水后 0.35 秒打不中（水花糊在身上）。它不是靠血厚活命的怪，
       而是靠"咬完能退回去" —— 血量保持 26，别加。
       潜行时长按距离给（见 combat.js），所以它能一路潜到脚下；
       正因如此单口伤害压到 5、冷却拉到 6 秒 —— 它一句咬得准，按原来的 8 点、
       4.2 秒冷却，锈水高速的机器人平均存活会从 286 秒掉到 99 秒。 */
    drowner: {
      id: 'drowner', name: '水鬼', sprite: 'drowner',
      hp: 26, speed: 34, dmg: 5, r: 5.5, xp: 4, scale: 1,
      gold: 2, waterborne: true, submerge: true, subCd: 6, subDur: 1.5,
      emergeGuard: 0.35,
      desc: '泡在锈水里的感染者，水草缠满四肢。浅水里它比谁都快，还能沉下去横穿深水——水面上那道涟漪，就是它正在靠近。'
    },
    brute: {
      id: 'brute', name: '壮汉', sprite: 'brute',
      hp: 78, speed: 21, dmg: 14, r: 9, xp: 7, scale: 1,
      /* 厚皮：实弹/近战/爆炸吃 15% 减免，火焰与持续伤害无视 —— 破甲属性的主要目标 */
      gold: 4, armor: 0.15, desc: '肌肉膨胀的感染者，挨打也照走。'
    },
    /* 公路隧道专属：肚囊被气撑到透亮的感染者。不远程、不扑、不喷，
       只是闷头往里走 —— 真正的杀招是"死"：被打死的那一刻原地炸开，
       冲击波对玩家和周围丧尸一视同仁。所以别在尸堆里点它。 */
    bomber: {
      id: 'bomber', name: '自爆尸', sprite: 'bomber',
      hp: 26, speed: 37, dmg: 8, r: 5.5, xp: 3, scale: 1,
      gold: 2, bomber: true, blastR: 46, blastDmg: 2.2,
      desc: '肚子鼓得像要透光的感染者。它自己不会炸，是你把它打死的时候炸——冲击波不分敌我，尸堆里打它等于给自己挖坑。'
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
      gold: 150, boss: true, bossType: 'tyrant', armor: 0.2,
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
    },
    axeboss: {
      id: 'axeboss', name: '断堤巨斧', sprite: 'axeboss',
      hp: 2500, speed: 24, dmg: 22, r: 18, xp: 160, scale: 2.25,
      gold: 180, boss: true, bossType: 'axeboss', armor: 0.22,
      desc: '双手各握一柄消防巨斧的巨型丧尸。交叉斩封路，跃劈震出锈水冲击波，还会劈碎桥面与残骸。'
    },
    /* 公路隧道 Boss 甲：尖啸者。这一关是双首领，两只必须都打死。
       它站得远，靠一嗓子把玩家震晕在原地 —— 真正让人掉血的是
       "被晕住那 0.9 秒里扑上来的自爆尸"。贴身时也会用骨爪掏一下。 */
    shrieker: {
      id: 'shrieker', name: '尖啸者', sprite: 'shrieker',
      hp: 2000, speed: 27, dmg: 18, r: 12, xp: 150, scale: 2,
      gold: 150, boss: true, bossType: 'shrieker', armor: 0.18,
      desc: '整个人被拉成了一根管风琴：肋骨外翻、下颌脱臼，喉咙里那口气永远吐不完。超声能把人震得站不住。'
    },
    /* 公路隧道 Boss 乙：育母。走得很慢，但谁也耗不过它 ——
       那颗育囊会一窝一窝地把小自爆尸挤出来，逼你在"打它"和"清崽"之间选。 */
    brood: {
      id: 'brood', name: '育母', sprite: 'brood',
      hp: 2400, speed: 17, dmg: 22, r: 17, xp: 170, scale: 2,
      gold: 180, boss: true, bossType: 'brood', armor: 0.24,
      desc: '头小得几乎看不见，整个人被一颗鼓到透光的育囊压弯。裂开的缝里还在往外挤东西——那些小东西会炸。'
    }
  };

  /** 精英强化系数 */
  HS.Data.elite = {
    hpMul: 6, dmgMul: 1.3, xpMul: 4, goldMul: 4, scale: 1.5,
    tint: '#ff3b3b', tintAmt: 0.34
  };
})();
