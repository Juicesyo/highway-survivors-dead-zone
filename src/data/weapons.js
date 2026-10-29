/**
 * 装备数据表（手持部分：主武器 / 副武器 / 重型武器）+ 进化表
 *
 * 统一数据结构（新增武器只改这里，不要动升级逻辑）：
 *   slot    'main' | 'sub' | 'heavy'      占用手持槽位
 *   cat     展示分类
 *   fam     兼容族：gun / energy / explosive / melee / thrown / support
 *           通用属性按族换算（穿透 → 近战目标数、攻击范围 → 爆炸半径…）
 *   mech    攻击机制：bullet / burst / spread / chain / beam / rail / melee
 *                    lob / missile / flame / boomerang / drill / heal / buff / none
 *   base    1 级基础数值
 *   g       每级成长（dmg/dps 为乘法，cd 为每级乘算缩减，count/pierce 为整数增量）
 *   rarity  1~5，用于抽取权重与卡面颜色
 *   up      专属升级分支 id 数组（不写则按 fam 模板生成，见 upgrades.js）
 *   move    移动速度乘数（重型武器普遍 < 1）
 *   noCap   1 = 不限目标数（扇面里的敌人全吃），见 gear.js 的 Gear.global
 *   edge    1 = 带刀刃的冷兵器 → 能拿「锯齿刃口（出血）」这条专属分支。
 *           光剑 / 能量鞭 / 盾牌 / 冲击波发生器这类打能量与冲击的不算
 *   pen     自带破甲（0~1），走 hurtEnemy 的护甲结算
 *   tags    联动 / 限制用的标签
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  HS.Data = HS.Data || {};
  var D = HS.Data;

  D.gear = D.gear || {};
  D.slotPool = { main: [], sub: [], heavy: [], auto: [] };

  /* art（手持外观）→ 图标点阵。多个武器可以共用同一张图标，新增武器不用加美术 */
  D.iconAlias = {
    pistol: 'pistol', revolver: 'pistol', smg: 'smg',
    rifle: 'rifle', lmg: 'rifle', minigun: 'minigun', sniper: 'sniper',
    shotgun: 'shotgun', launcher: 'launcher', harpoon: 'launcher',
    bow: 'bow', crossbow: 'bow', flamer: 'flamer', laser: 'laser',
    plasma: 'laser', railgun: 'laser', tesla: 'tesla',
    saber: 'blade', katana: 'blade', greatsword: 'blade', twinblades: 'blade',
    scythe: 'blade', glaive: 'blade', shortsword: 'blade', knife: 'blade',
    shuriken: 'blades', axe: 'axe', hammer: 'hammer', spear: 'spear', chainsaw: 'saw',
    fist: 'fist', drill: 'drill', whip: 'whip',
    shield: 'shield', eshield: 'shield', shieldaxe: 'shield', baton: 'baton',
    molotov: 'molotov', grenade: 'grenade', frost: 'frost',
    beacon: 'mine', mine: 'mine', shockwave: 'ring',
    autoloader: 'amp', syringe: 'syringe', drone: 'drone',
    /* 两个环各自的图标（火焰环 = 环形火，冰霜环 = 环形冰晶）。
       以前这里都映射到 'ring'，而 icons.js 里根本没有 'ring' 这个点阵 ——
       结果两件环的卡面都退回默认图形，长得一模一样。 */
    firering: 'firering', frostring: 'icerim',
    railorb: 'orb', gravitysat: 'orb'
  };

  var BASE_KEYS = {
    cd: 1, dmg: 10, count: 1, speed: 300, spread: 0, range: 200,
    pierce: 0, radius: 0, dur: 0, dps: 0, slow: 0,
    arc: 1.1, targets: 1, chains: 0, homing: 0, knock: 0,
    stun: 0, heal: 0, width: 6, effectDur: 0
  };

  /**
   * 批量注册
   * @param slot  槽位
   * @param cat   展示分类
   * @param common 同组默认值（fam / mech / color / rarity / icon ...）
   * @param list  条目
   */
  function add(slot, cat, common, list) {
    var i, k, o;
    for (i = 0; i < list.length; i++) {
      o = list[i];
      for (k in common) {
        if (common.hasOwnProperty(k) && o[k] === undefined) o[k] = common[k];
      }
      o.slot = slot;
      o.cat = cat;
      o.maxLvl = o.maxLvl || 5;
      o.rarity = o.rarity || 1;
      o.fam = o.fam || 'gun';
      o.mech = o.mech || 'bullet';
      o.art = o.art || o.icon || 'pistol';
      o.icon = D.iconAlias[o.icon || o.art] || o.icon || o.art;
      o.color = o.color || '#ffd166';
      o.tags = o.tags || [];
      o.base = o.base || {};
      o.g = o.g || {};
      for (k in BASE_KEYS) {
        if (o.base[k] === undefined) o.base[k] = BASE_KEYS[k];
      }
      /* 近战默认不打投射物：速度 / 散布清零，避免渲染层误判 */
      if (o.fam === 'melee' && o.mech === 'melee') {
        o.base.speed = 0;
        o.base.spread = 0;
      }
      D.gear[o.id] = o;
      D.slotPool[slot].push(o.id);
    }
  }

  /* ============================================================
   *  一、主武器（最多 1 个）
   * ============================================================ */

  add('main', '现代枪械', {
    fam: 'gun', mech: 'bullet', color: '#ffd166', rarity: 1,
    tags: ['gun']
  }, [
    {
      id: 'pistol', name: '手枪', art: 'pistol', desc: '单发点射，自动索敌，最可靠的起步武器',
      base: { cd: 0.55, dmg: 11, speed: 340, range: 235 }, g: { dmg: 0.18, cd: 0.05 }
    },
    {
      id: 'revolver', name: '左轮', art: 'revolver', rarity: 2, desc: '六发重弹，一枪能串开两个感染者',
      base: { cd: 0.82, dmg: 22, speed: 360, range: 255, pierce: 1 }, g: { dmg: 0.2, cd: 0.05, pierce: 0.5 }
    },
    {
      id: 'smg', name: '冲锋枪', art: 'smg', rarity: 1, desc: '高射速压制，精度一般',
      base: { cd: 0.14, dmg: 5, speed: 380, range: 215, spread: 0.10 }, g: { dmg: 0.16, cd: 0.04 }
    },
    {
      id: 'ar', name: '突击步枪', art: 'rifle', rarity: 2, mech: 'burst', desc: '三发点射，中距离稳定输出',
      base: { cd: 0.46, dmg: 8.5, speed: 400, range: 255, spread: 0.05, count: 3 }, g: { dmg: 0.17, cd: 0.05 }
    },
    {
      id: 'lmg', name: '轻机枪', art: 'lmg', rarity: 3, desc: '大弹匣持续扫射，越打越顺',
      base: { cd: 0.09, dmg: 5.5, speed: 390, range: 240, spread: 0.11 }, g: { dmg: 0.16, cd: 0.04 }
    },
    {
      id: 'hmg', name: '重机枪', art: 'lmg', rarity: 3, desc: '弹链供弹，火力凶但拖慢脚步',
      base: { cd: 0.12, dmg: 9, speed: 400, range: 250, spread: 0.12 }, g: { dmg: 0.18, cd: 0.04 },
      move: 0.92
    },
    {
      id: 'shotgun', name: '霰弹枪', art: 'shotgun', rarity: 2, mech: 'spread', desc: '扇面喷射，近距离撕碎成群僵尸',
      base: { cd: 1.12, dmg: 6, speed: 300, range: 122, spread: 0.5, count: 6 }, g: { dmg: 0.15, cd: 0.06, count: 0.5 }
    },
    {
      id: 'autoshotgun', name: '连发霰弹枪', art: 'shotgun', rarity: 3, mech: 'spread', desc: '半自动连喷，火线不断',
      base: { cd: 0.52, dmg: 5, speed: 300, range: 116, spread: 0.46, count: 4 }, g: { dmg: 0.15, cd: 0.05 }
    },
    {
      id: 'sniper', name: '狙击步枪', art: 'sniper', rarity: 3, desc: '一发贯穿一列，慢但致命',
      base: { cd: 1.45, dmg: 55, speed: 700, range: 340, pierce: 2 }, g: { dmg: 0.22, cd: 0.06, pierce: 0.5 }
    },
    {
      id: 'amr', name: '反器材步枪', art: 'sniper', rarity: 4, desc: '打穿整条街的重型弹，后坐惊人',
      base: { cd: 2.1, dmg: 92, speed: 780, range: 380, pierce: 4, radius: 26 }, g: { dmg: 0.24, cd: 0.06, pierce: 0.5 },
      move: 0.95
    }
  ]);

  add('main', '特殊枪械', {
    fam: 'gun', mech: 'bullet', color: '#8ecae6', rarity: 2,
    tags: ['gun']
  }, [
    {
      id: 'crossbow', name: '连弩', art: 'crossbow', desc: '连发弩箭，穿透力强',
      base: { cd: 0.5, dmg: 14, speed: 430, range: 245, pierce: 1 }, g: { dmg: 0.17, cd: 0.05, count: 0.5 }
    },
    {
      id: 'bow', name: '复合弓', art: 'bow', rarity: 3, desc: '蓄力重箭，可贯穿三个目标',
      base: { cd: 0.75, dmg: 26, speed: 500, range: 285, pierce: 2 }, g: { dmg: 0.2, cd: 0.05, pierce: 0.5 }
    },
    {
      id: 'handcrossbow', name: '手弩', art: 'crossbow', desc: '一次三矢扇形散射',
      base: { cd: 0.9, dmg: 13, speed: 410, range: 230, count: 3, spread: 0.16 }, g: { dmg: 0.16, cd: 0.05 }
    },
    {
      id: 'nailgun', name: '钉枪', art: 'pistol', rarity: 1, desc: '射速极快的短钉，钉穿薄甲',
      base: { cd: 0.1, dmg: 3.5, speed: 430, range: 190, pierce: 1 }, g: { dmg: 0.14, cd: 0.03, pierce: 0.5 }
    },
    {
      id: 'harpoon', name: '鱼叉枪', art: 'harpoon', rarity: 3, desc: '重叉拖着锁链飞出，把猎物拽近',
      base: { cd: 1.2, dmg: 30, speed: 380, range: 210, pierce: 3 }, g: { dmg: 0.2, cd: 0.05, pierce: 0.5 },
      onHit: 'pull'
    },
    {
      /* tube：管式发射器，从枪口打出去（不像手雷那样抬手扔） */
      id: 'gl', name: '榴弹发射器', art: 'launcher', fam: 'explosive', mech: 'lob', rarity: 3,
      desc: '抛射榴弹，落地炸开一片', tags: ['explosive'], tube: 1,
      base: { cd: 1.55, dmg: 24, radius: 30, range: 200 }, g: { dmg: 0.18, cd: 0.05, radius: 1.2 }
    },
    {
      id: 'rpg', name: 'RPG', art: 'launcher', fam: 'explosive', mech: 'missile', rarity: 4,
      desc: '火箭弹犁开整条车道', tags: ['explosive'],
      base: { cd: 2.4, dmg: 62, radius: 46, range: 280, speed: 210 }, g: { dmg: 0.2, cd: 0.06, radius: 1.8 }
    },
    {
      id: 'flamer', name: '火焰喷射器', art: 'flamer', fam: 'energy', mech: 'flame', rarity: 3,
      desc: '持续喷火，烧穿贴脸的尸群', tags: ['fire'],
      base: { cd: 0.16, dmg: 4.6, range: 92, arc: 0.52, dps: 0, dur: 2 }, g: { dmg: 0.16, cd: 0.03, range: 0.03 }
    },
    {
      /* 冷冻射流：直伤比火焰低一档，换来的是一整片减速 + 冻结标记。
         已冻住的目标吃 1.6 倍伤害 —— 这把枪先手弱、后手强，和冰霜环/暴击燃烧
         两条联动都能挂上（见 combat.js 的 synFrozen 消费点）。
         art 用 flamer 的手持喷嘴，icon 走 frost，不新增美术。 */
      id: 'cryo', name: '液氮喷枪', art: 'flamer', icon: 'frost', fam: 'energy', mech: 'flame',
      rarity: 3, elem: 'ice', desc: '低温射流冻住一片，越冻越脆', tags: ['ice', 'energy'],
      base: { cd: 0.16, dmg: 3.8, range: 88, arc: 0.44, slow: 0.50, dur: 1.4 },
      g: { dmg: 0.15, cd: 0.03, range: 0.03, slow: 0.02 }
    },
    {
      /* 龙息喷枪：射程和火焰喷射器错开（124 vs 92），扇面更窄、单发更重、
         燃烧时间翻倍以上。烧死的目标会炸开并点燃周围，适合站桩烧一整排。 */
      id: 'napalm', name: '龙息喷枪', art: 'flamer', fam: 'energy', mech: 'flame',
      rarity: 3, elem: 'fire', napalm: 1, desc: '中距离长燃，烧死的会炸开', tags: ['fire', 'energy'],
      base: { cd: 0.22, dmg: 6.8, range: 124, arc: 0.3, dur: 5 },
      g: { dmg: 0.16, cd: 0.03, range: 0.025, dur: 0.08 }
    },
    {
      id: 'taser', name: '电击枪', art: 'tesla', fam: 'energy', mech: 'chain', rarity: 2,
      desc: '电弧在敌群中跳跃', tags: ['energy'],
      base: { cd: 0.9, dmg: 16, range: 130, chains: 3 }, g: { dmg: 0.18, cd: 0.05, chains: 0.5 }
    },
    {
      id: 'laser', name: '激光步枪', art: 'laser', fam: 'energy', mech: 'beam', rarity: 3,
      desc: '瞬时光束，一条线上的敌人一起烧', tags: ['energy'],
      base: { cd: 0.35, dmg: 9, range: 260, pierce: 2, width: 5 }, g: { dmg: 0.16, cd: 0.04, pierce: 0.5 }
    },
    {
      /* 持续光束：没有上膛/冷却这一说，固定 0.08s 一跳，只要有敌人就一直烧着。
         代价是**完全不吃射速与冷却**（攻速 / 暴走 / 过热加速都无效）——
         base.cd 在这里是"跳的间隔"而不是上膛时间，持续型分支直接读它，
         不经过 rate / cdr 折算，所以加快攻速不会让它跳得更密。
         宽度比激光步枪粗一档（8 vs 5），红色判定线一眼能认出是哪把枪。 */
      id: 'redlaser', name: '红莲切割者', art: 'laser', fam: 'energy', mech: 'beam',
      rarity: 4, color: '#ff3b30', sustainBeam: 1,
      desc: '持续不断的红色光束。不吃射速——但多出来的攻速会按六折折算成伤害',
      tags: ['energy'],
      base: { cd: 0.08, dmg: 2.2, range: 235, pierce: 2, width: 8 },
      g: { dmg: 0.21, range: 0.03, width: 0.5 }
    }
  ]);

  add('main', '近战武器', {
    fam: 'melee', mech: 'melee', color: '#c9d1d9', rarity: 2,
    tags: ['melee']
  }, [
    {
      /* 光剑不是"一把金属剑"：刃身是能量场，所以给独立青色 + 专属 art 分支
         （render 的 ART_KIND.saber / Audio 的 saber 音色都按 art 走）。
         刀光、音色、握持形态三样全部和武士刀区分开，玩家一眼能认出是哪把。 */
      id: 'saber', name: '光剑', art: 'saber', rarity: 3, color: '#7ee0ff',
      desc: '高频刃口，一次能扫开一排',
      base: { cd: 0.42, dmg: 18, range: 36, arc: 1.2, targets: 3 }, g: { dmg: 0.18, cd: 0.05, targets: 0.5 }
    },
    {
      /* 一刀扫过身前一片：noCap = 扇形内的敌人全吃，不再点名 N 个人。
         目标数封顶的武器在尸堆里永远只打得到最靠前的两个，
         这是近战"贴脸还打不动"的根子。 */
      id: 'katana', name: '武士刀', art: 'katana', noCap: 1, edge: 1,
      desc: '出手极快，一刀扫过身前一片',
      base: { cd: 0.34, dmg: 15, range: 30, arc: 1.0, targets: 99 },
      g: { dmg: 0.16, cd: 0.06, arc: 0.035 }
    },
    {
      id: 'greatsword', name: '大剑', art: 'greatsword', rarity: 3, edge: 1, desc: '大范围横扫，前摇略长',
      base: { cd: 0.86, dmg: 34, range: 40, arc: 1.6, targets: 4 }, g: { dmg: 0.2, cd: 0.05, arc: 0.03 }
    },
    {
      /* 极快的双段连斩：伤害和攻速一起提，同时改成不限目标数，
         不然"saber 一刀砍三个、双刀只能砍两个"永远说不通 */
      id: 'twinblades', name: '双刀', art: 'twinblades', noCap: 1, edge: 1,
      desc: '极快的双段连斩，刀光扫过一整片',
      base: { cd: 0.2, dmg: 9, range: 28, arc: 0.85, targets: 99 },
      g: { dmg: 0.15, cd: 0.05, arc: 0.03 }
    },
    {
      /* 战斧的卖点是"开道"：伤害和击退一起提，被打飞的那一下也算收益 */
      id: 'axe', name: '战斧', art: 'axe', rarity: 2, edge: 1, desc: '劈砍带击退，一斧能把人抡回巷子里',
      base: { cd: 0.7, dmg: 32, range: 32, arc: 1.15, targets: 3, knock: 12 }, g: { dmg: 0.19, cd: 0.05 }
    },
    {
      id: 'warhammer', name: '战锤', art: 'hammer', rarity: 3, desc: '一击砸出冲击波，慢但极重',
      base: { cd: 1.0, dmg: 42, range: 34, arc: 1.0, targets: 2, knock: 12, radius: 26 }, g: { dmg: 0.21, cd: 0.05 },
      onHit: 'shock'
    },
    {
      id: 'spear', name: '长矛', art: 'spear', mech: 'thrust', edge: 1,
      desc: '直刺一条线，只打正前方；枪身越长，刺出的宽度也越宽',
      base: { cd: 0.55, dmg: 20, range: 48, targets: 3 }, g: { dmg: 0.18, cd: 0.05, targets: 0.5 }
    },
    {
      id: 'chainsaw', name: '链锯', art: 'chainsaw', rarity: 3, mech: 'drill', edge: 1,
      desc: '贴上去就不断绞，持续伤害', tags: ['melee', 'saw'],
      base: { cd: 0.12, dmg: 8, range: 32, arc: 0.8, targets: 2 }, g: { dmg: 0.16, cd: 0.02 }
    },
    {
      id: 'voltsaw', name: '电锯剑', art: 'chainsaw', rarity: 3, mech: 'drill', edge: 1,
      desc: '锯刃带电，切割同时放电', tags: ['melee', 'energy'],
      base: { cd: 0.3, dmg: 12, range: 32, arc: 0.9, targets: 3, chains: 1 }, g: { dmg: 0.17, cd: 0.04 }
    },
    {
      id: 'scythe', name: '长柄镰刀', art: 'scythe', rarity: 4, edge: 1, desc: '巨大弧线收割半个屏幕的近身敌',
      base: { cd: 0.78, dmg: 26, range: 44, arc: 2.0, targets: 5 }, g: { dmg: 0.2, cd: 0.05, arc: 0.04 }
    }
  ]);

  add('main', '特殊近战', {
    fam: 'melee', mech: 'melee', color: '#a5d8ff', rarity: 2,
    tags: ['melee']
  }, [
    {
      /* 拳套：单点爆发 + 不限目标数 —— 一拳打出的一圈冲击波本来就该打到所有人。
         特效走 Gear.swing 的 punch 冲击环，和"只打一个"的观感区分开 */
      id: 'gauntlet', name: '拳套', art: 'fist', noCap: 1, punch: 1, combo: 1,
      desc: '极快的连打，不歇手就越打越重',
      base: { cd: 0.25, dmg: 13, range: 24, arc: 0.9, targets: 99, knock: 5, radius: 22 },
      g: { dmg: 0.16, cd: 0.05, arc: 0.03 }
    },
    {
      /* 机械钻头：以前 base.pierce 对近战是**死字段**（Gear.global 只吃
         被动穿透，不读 def.base.pierce），描述写的"破甲极高"根本没实现。
         现在改成两件真事：不限目标数（钻穿一整排）+ 真·破甲（pen 走
         hurtEnemy 的护甲结算），不再靠一个没人读的字段装样子。 */
      id: 'drill', name: '机械钻头', art: 'drill', rarity: 3, mech: 'drill',
      noCap: 1, pen: 0.8, rift: 1, lance: 1, edge: 1,
      desc: '直线钻穿一整排，钻开的裂口让目标更脆',
      base: { cd: 0.18, dmg: 14, range: 40, arc: 0.4, targets: 99 },
      g: { dmg: 0.17, cd: 0.03, range: 0.02 }
    },
    {
      id: 'whip', name: '能量鞭', art: 'whip', rarity: 3, desc: '长距离横扫，控场很好',
      base: { cd: 0.5, dmg: 12, range: 62, arc: 1.4, targets: 4 }, g: { dmg: 0.17, cd: 0.05, targets: 0.5 }
    },
    {
      id: 'shieldaxe', name: '盾斧', art: 'shieldaxe', rarity: 3, noCap: 1, edge: 1,
      desc: '攻守一体：一斧扫开一圈，同时挡下伤害',
      base: { cd: 0.8, dmg: 31, range: 30, arc: 1.2, targets: 99, knock: 6 },
      g: { dmg: 0.19, cd: 0.05, arc: 0.03 },
      block: 0.22
    },
    {
      id: 'glaive', name: '回旋刃', art: 'glaive', rarity: 3, mech: 'boomerang', edge: 1,
      desc: '掷出后回旋，去程回程都割人',
      base: { cd: 0.9, dmg: 20, range: 165, speed: 260, pierce: 4 }, g: { dmg: 0.18, cd: 0.05 }
    }
  ]);

  /* ============================================================
   *  二、副武器（最多 1 个）
   * ============================================================ */

  add('sub', '轻型枪械', {
    fam: 'gun', mech: 'bullet', color: '#8ecae6', rarity: 1, tags: ['gun']
  }, [
    {
      id: 'microsmg', name: '微型冲锋枪', art: 'smg', desc: '补火力的高速小水枪',
      base: { cd: 0.11, dmg: 3.5, speed: 370, range: 195, spread: 0.13 }, g: { dmg: 0.15, cd: 0.04 }
    },
    {
      id: 'tacpistol', name: '战术手枪', art: 'pistol', desc: '稳定的中距离补枪',
      base: { cd: 0.45, dmg: 8, speed: 360, range: 225 }, g: { dmg: 0.16, cd: 0.05 }
    },
    {
      id: 'sawnoff', name: '短管霰弹枪', art: 'shotgun', mech: 'spread', desc: '近距离一发送走一群',
      base: { cd: 0.95, dmg: 5, speed: 290, range: 104, spread: 0.62, count: 4 }, g: { dmg: 0.15, cd: 0.06 }
    }
  ]);

  add('sub', '投射武器', {
    fam: 'thrown', mech: 'bullet', color: '#b197fc', rarity: 2, tags: ['thrown']
  }, [
    {
      id: 'handxbow', name: '掌上弩', art: 'crossbow', desc: '袖珍弩，出手安静',
      base: { cd: 0.8, dmg: 14, speed: 420, range: 215, pierce: 1 }, g: { dmg: 0.17, cd: 0.05 }
    },
    {
      id: 'throwingknife', name: '飞刀', art: 'knife', desc: '一次两把，快速叠加伤害',
      base: { cd: 0.55, dmg: 9, speed: 400, range: 205, count: 2, spread: 0.1 }, g: { dmg: 0.16, cd: 0.05 }
    },
    {
      id: 'shuriken', name: '手里剑', art: 'shuriken', rarity: 3, desc: '三枚连环，命中会弹射',
      base: { cd: 0.72, dmg: 8, speed: 380, range: 195, count: 3, spread: 0.2, pierce: 1 }, g: { dmg: 0.15, cd: 0.05 },
      bounce: 2
    }
  ]);

  add('sub', '爆炸物', {
    fam: 'explosive', mech: 'lob', color: '#ff9f43', rarity: 2, tags: ['explosive']
  }, [
    {
      id: 'molotov', name: '燃烧瓶', art: 'molotov', color: '#ff6b35', desc: '砸出一片火海，封锁走位',
      tags: ['explosive', 'fire'],
      base: { cd: 4.0, dmg: 12, radius: 34, dps: 10, dur: 3.5, range: 190 }, g: { dmg: 0.16, cd: 0.05, radius: 1.4, dps: 0.15 }
    },
    {
      id: 'frag', name: '手雷', art: 'grenade', rarity: 2, color: '#ffb347', desc: '拉环抛投，落地开花',
      base: { cd: 3.0, dmg: 45, radius: 36, range: 195 }, g: { dmg: 0.18, cd: 0.05, radius: 1.2 }
    },
    {
      id: 'stickybomb', name: '黏性炸弹', art: 'grenade', rarity: 3, color: '#e3b23c', desc: '粘上就炸，中心伤害更高',
      base: { cd: 3.4, dmg: 62, radius: 30, range: 175 }, g: { dmg: 0.2, cd: 0.05, radius: 1.0 }
    },
    {
      id: 'flashbang', name: '闪光弹', art: 'grenade', rarity: 2, color: '#eef4ff', desc: '白屏震眩，打断进攻节奏',
      base: { cd: 4.6, dmg: 6, radius: 46, stun: 1.8, range: 180 }, g: { dmg: 0.12, cd: 0.05, radius: 1.2, stun: 0.12 }
    },
    {
      id: 'cryogrenade', name: '冰冻手雷', art: 'frost', rarity: 3, color: '#9ad0ff', desc: '整片区域冻住，方便拉开距离',
      tags: ['explosive', 'ice'],
      base: { cd: 4.4, dmg: 18, radius: 40, slow: 0.7, dur: 3, range: 180 }, g: { dmg: 0.16, cd: 0.05, radius: 1.2 }
    }
  ]);

  add('sub', '战术装备', {
    fam: 'explosive', mech: 'lob', color: '#7ee8fa', rarity: 3, tags: ['tactic']
  }, [
    {
      id: 'emp', name: '电磁脉冲装置', art: 'tesla', desc: '脉冲定身，成片打断',
      base: { cd: 5.5, dmg: 15, radius: 60, stun: 1.2, range: 170 }, g: { dmg: 0.16, cd: 0.05, radius: 1.4 },
      effect: 'emp'
    },
    {
      id: 'decoy', name: '战术诱饵', art: 'drone', desc: '投出诱饵，把尸群引开',
      base: { cd: 7.5, dmg: 0, radius: 30, dur: 4.5, range: 200 }, g: { cd: 0.06, dur: 0.1 },
      effect: 'lure'
    },
    {
      /* 烟雾的定位是"反远程"，不是又一个减速：
         烟幕会吃掉穿过去的敌方子弹/酸液，烟里的持枪匪徒和吐酸者也开不了火。
         减速只留一点点做附带，免得和冰冻手雷 / 冰霜发生器撞定位。 */
      id: 'smoke', name: '烟雾发射器', art: 'grenade', desc: '烟幕遮断远程攻击，里面看不清你',
      base: { cd: 5.5, dmg: 4, radius: 50, dps: 0, slow: 0.22, dur: 6, range: 200 }, g: { radius: 1.2, dur: 0.08 },
      effect: 'smoke'
    },
    {
      id: 'beacon', name: '便携炮击标记器', art: 'beacon', rarity: 4, desc: '标记落点，稍后炮火覆盖',
      base: { cd: 7.0, dmg: 72, radius: 52, range: 250, effectDur: 1.4 }, g: { dmg: 0.2, cd: 0.05, radius: 1.4 },
      effect: 'artillery'
    },
    {
      id: 'minelay', name: '便携式地雷投放器', art: 'mine', desc: '沿路埋雷，专治追兵',
      base: { cd: 4.5, dmg: 40, radius: 30, count: 2, range: 90 }, g: { dmg: 0.18, cd: 0.05, radius: 1.2 },
      effect: 'mines'
    }
  ]);

  add('sub', '近战装备', {
    fam: 'melee', mech: 'melee', color: '#ced4da', rarity: 1, tags: ['melee']
  }, [
    {
      /* 战斗匕首：贴身割一圈，伤害和攻速一起提，不然"快速短刺"只是听着快 */
      id: 'dagger', name: '战斗匕首', art: 'knife', noCap: 1, edge: 1,
      desc: '贴脸割一圈，出手极快',
      base: { cd: 0.45, dmg: 15, range: 26, arc: 0.9, targets: 99 },
      g: { dmg: 0.16, cd: 0.05, arc: 0.03 }
    },
    {
      id: 'shortsword', name: '短剑', art: 'shortsword', rarity: 2, edge: 1, desc: '更长的刃，一次能带到两个',
      base: { cd: 0.6, dmg: 16, range: 30, arc: 1.1, targets: 2 }, g: { dmg: 0.17, cd: 0.05 }
    },
    {
      id: 'stunbaton', name: '电击警棍', art: 'baton', rarity: 2, desc: '敲中就麻，控住冲脸的，一棍能麻两个',
      base: { cd: 0.8, dmg: 13, range: 28, arc: 0.9, targets: 2, stun: 1.0 }, g: { dmg: 0.15, cd: 0.05, stun: 0.08 }
    },
    {
      id: 'riotshield', name: '战斗盾牌', art: 'shield', rarity: 3, counter: 0.9,
      desc: '顶着盾打：挡下的伤害会反震回去',
      base: { cd: 1.0, dmg: 14, range: 28, arc: 1.0, targets: 2, knock: 8 }, g: { dmg: 0.16, cd: 0.05 },
      block: 0.30
    },
    {
      id: 'energyshield', name: '能量盾', art: 'eshield', rarity: 3, counter: 0.9,
      desc: '能量护盾：挡伤更多，并反震一圈冲击',
      base: { cd: 1.05, dmg: 14, range: 26, arc: 1.0, targets: 2 }, g: { dmg: 0.15, cd: 0.05 },
      block: 0.36
    },
    {
      /* 机械拳套：本来只打 1 个人，一轮"重拳 + 击退"里其实只赚一次伤害。
         现在和不限目标数的拳头一样打身前一圈，特效走 punch 冲击环 */
      id: 'powerfist', name: '机械拳套', art: 'fist', rarity: 2, noCap: 1, punch: 1,
      desc: '重拳砸出一圈冲击，把人打回巷子',
      base: { cd: 0.7, dmg: 27, range: 26, arc: 0.9, targets: 99, knock: 12 },
      g: { dmg: 0.18, cd: 0.05, arc: 0.03 }
    },
    {
      id: 'grapnel', name: '链锁钩爪', art: 'harpoon', rarity: 3, mech: 'bullet', desc: '甩出钩爪，把远处的拽到面前',
      /* 钩爪要拽到"能立刻砍到"的距离：贴身 16px 停手、拽掉剩余距离的 90% */
      pullStop: 16, pullK: 0.9,
      base: { cd: 2.2, dmg: 15, range: 155, speed: 380, pierce: 1 }, g: { dmg: 0.17, cd: 0.06 },
      onHit: 'pull'
    },
    {
      id: 'portdrill', name: '便携钻头', art: 'drill', rarity: 2, mech: 'drill', edge: 1, desc: '近距离持续钻孔',
      base: { cd: 0.2, dmg: 10, range: 24, arc: 0.4, targets: 1 }, g: { dmg: 0.16, cd: 0.03 }
    }
  ]);

  add('sub', '辅助装置', {
    fam: 'support', mech: 'heal', color: '#8ce99a', rarity: 2, tags: ['support']
  }, [
    {
      id: 'syringe', name: '治疗注射器', art: 'syringe', desc: '定时自动注射，回血保命',
      base: { cd: 11, heal: 0.18 }, g: { heal: 0.02, cd: 0.05 }
    },
    {
      id: 'shockwave', name: '冲击波发生器', art: 'shockwave', rarity: 3, mech: 'melee',
      charge: 1, desc: '蓄势震动：圈里没人就一直压着，越憋越狠', fam: 'melee',
      base: { cd: 4.2, dmg: 24, range: 58, arc: 3.15, targets: 99, knock: 14, stun: 0.5 }, g: { dmg: 0.18, cd: 0.05, range: 0.03 }
    },
    {
      id: 'autoloader', name: '自动装填装置', art: 'autoloader', rarity: 3, mech: 'buff',
      desc: '持续提高所有手持武器的射速', fam: 'support',
      base: { cd: 0 }, g: {}, atk: 0.15
    }
  ]);

  /* ============================================================
   *  三、重型武器（同时占用主 + 副两个槽位）
   * ============================================================ */

  add('heavy', '重型武器', {
    fam: 'gun', mech: 'bullet', color: '#ff6b6b', rarity: 4, move: 0.78, tags: ['gun', 'heavy']
  }, [
    {
      id: 'heavymg', name: '重型机枪', art: 'lmg', move: 0.8, desc: '持续压制、弹药充足，但转身很慢',
      base: { cd: 0.07, dmg: 8, speed: 400, range: 250, spread: 0.14 }, g: { dmg: 0.16, cd: 0.03 }
    },
    {
      id: 'gatling', name: '加特林机炮', art: 'minigun', move: 0.7, mech: 'bullet',
      desc: '开火后转速越来越快，停火就会冷下来',
      base: { cd: 0.055, dmg: 6, speed: 420, range: 245, spread: 0.18 }, g: { dmg: 0.15, cd: 0.03 },
      spinup: 1
    },
    {
      id: 'heavyrpg', name: '重型RPG', art: 'launcher', fam: 'explosive', mech: 'missile',
      move: 0.74, desc: '装填极慢，一发清空半个街区', tags: ['explosive', 'heavy'],
      base: { cd: 3.0, dmg: 110, radius: 58, range: 300, speed: 190 }, g: { dmg: 0.2, cd: 0.06, radius: 1.6 }
    },
    {
      id: 'railgun', name: '电磁轨道炮', art: 'railgun', fam: 'energy', mech: 'rail',
      move: 0.76, desc: '一枪贯穿全屏，前摇与冷却都很长', tags: ['energy', 'heavy'],
      base: { cd: 2.6, dmg: 140, range: 380, pierce: 99, width: 8 }, g: { dmg: 0.24, cd: 0.05 }
    },
    {
      id: 'heavyflamer', name: '重型火焰喷射器', art: 'flamer', fam: 'energy', mech: 'flame',
      move: 0.76, desc: '更远更宽的持续火墙', tags: ['fire', 'heavy'],
      base: { cd: 0.14, dmg: 9, range: 118, arc: 0.66, dur: 2.4 }, g: { dmg: 0.16, cd: 0.03, range: 0.02 }
    },
    {
      id: 'siegecrossbow', name: '连发攻城弩', art: 'crossbow', move: 0.82,
      desc: '六矢齐射，箭箭穿透', tags: ['heavy'],
      base: { cd: 1.4, dmg: 22, speed: 430, range: 300, count: 6, spread: 0.24, pierce: 2 }, g: { dmg: 0.18, cd: 0.05 }
    },
    {
      id: 'giantsaber', name: '巨型光剑', art: 'saber', fam: 'melee', mech: 'melee',
      move: 0.84, desc: '超长刃光，一次扫空一圈', tags: ['melee', 'heavy'],
      base: { cd: 0.72, dmg: 55, range: 56, arc: 1.9, targets: 6 }, g: { dmg: 0.2, cd: 0.05, arc: 0.03 }
    },
    {
      id: 'heavychainsaw', name: '重型链锯', art: 'chainsaw', fam: 'melee', mech: 'drill', edge: 1,
      move: 0.74, desc: '贴住就是绞肉机，代价是几乎跑不动', tags: ['melee', 'saw', 'heavy'],
      base: { cd: 0.15, dmg: 18, range: 38, arc: 1.0, targets: 3 }, g: { dmg: 0.17, cd: 0.02 }
    }
  ]);

  /* ============================================================
   *  四、进化表：基础武器 → 质变形态
   *
   *  req: 进化条件（lvl 固定为 5；stat/statLvl 为额外属性门槛）
   *  mul: 相对基础形态的数值变化
   *  flag: 交给运行时的质变开关（spinup / explode / burn / pull / shock / echo / homing / beam / volley2）
   * ============================================================ */

  D.evolutions = {
    pistol: {
      id: 'pistol_x', name: '双持手枪', req: { stat: 'crit', statLvl: 2 },
      desc: '左右开弓，弹丸翻倍且能贯穿', mul: { dmg: 1.35, cd: 0.45, count: 1, pierce: 1 }
    },
    revolver: {
      id: 'revolver_x', name: '审判者', req: { stat: 'critdmg', statLvl: 2 },
      desc: '重弹击穿三个目标，暴击更狠', mul: { dmg: 1.5, cd: 0.85, pierce: 2 }
    },
    smg: {
      id: 'smg_x', name: '脉冲冲锋枪', req: { stat: 'haste', statLvl: 2 },
      desc: '脉冲弹高速连射，顺带穿透', mul: { dmg: 1.4, cd: 0.6, pierce: 2, speed: 1.25 }
    },
    ar: {
      id: 'ar_x', name: '战术步枪', req: { stat: 'pierce', statLvl: 1 },
      desc: '五发点射，枪枪咬住同一条线', mul: { dmg: 1.35, cd: 0.8, count: 2, pierce: 1 }
    },
    lmg: {
      id: 'lmg_x', name: '加特林机枪', req: { stat: 'haste', statLvl: 2 },
      desc: '枪管转起来后射速疯狂攀升', mul: { dmg: 1.3, cd: 0.55 }, flag: 'spinup'
    },
    hmg: {
      id: 'hmg_x', name: '终结者机枪', req: { stat: 'pierce', statLvl: 2 },
      desc: '重弹连穿三人，火力覆盖整条街', mul: { dmg: 1.45, cd: 0.75, pierce: 2 }
    },
    shotgun: {
      id: 'shotgun_x', name: '双联霰弹', req: { stat: 'blast', statLvl: 1 },
      desc: '一次两轮齐射，弹丸更多更远', mul: { dmg: 1.35, cd: 0.8, count: 2, range: 1.2 }, flag: 'volley2'
    },
    autoshotgun: {
      id: 'autoshotgun_x', name: '龙息霰弹', req: { stat: 'crit', statLvl: 2 },
      desc: '弹丸点燃目标，火线扫过一片', mul: { dmg: 1.3, cd: 0.8, count: 2 }, flag: 'burn'
    },
    sniper: {
      id: 'sniper_x', name: '反器材狙击', req: { stat: 'pierce', statLvl: 1 },
      desc: '一枪打穿整列，弹道不会停', mul: { dmg: 1.4, cd: 0.85, pierce: 6 }
    },
    amr: {
      id: 'amr_x', name: '破城者', req: { stat: 'blast', statLvl: 2 },
      desc: '命中即爆，重弹变成小型炮击', mul: { dmg: 1.35, cd: 0.9, radius: 1.6 }, flag: 'explode'
    },
    crossbow: {
      id: 'crossbow_x', name: '自动弩阵', req: { stat: 'pierce', statLvl: 2 },
      desc: '一次三矢齐射，箭矢自动追踪', mul: { dmg: 1.3, cd: 0.85, count: 2 }, flag: 'homing'
    },
    bow: {
      id: 'bow_x', name: '天穹之弓', req: { stat: 'split', statLvl: 1 },
      desc: '重箭穿透后分裂成散射箭雨', mul: { dmg: 1.35, cd: 0.85, pierce: 3 }, flag: 'split'
    },
    handcrossbow: {
      id: 'handcrossbow_x', name: '三连手弩', req: { stat: 'projCount', statLvl: 1 },
      desc: '扇形五矢，近距离无死角', mul: { dmg: 1.3, cd: 0.85, count: 2, spread: 1.1 }
    },
    nailgun: {
      id: 'nailgun_x', name: '钉刺风暴', req: { stat: 'bounce', statLvl: 1 },
      desc: '钉子会在目标之间乱弹', mul: { dmg: 1.4, cd: 0.7 }, flag: 'bounce3'
    },
    harpoon: {
      id: 'harpoon_x', name: '深海巨叉', req: { stat: 'pierce', statLvl: 2 },
      desc: '巨叉贯穿并把猎物拖到面前', mul: { dmg: 1.5, cd: 0.85, pierce: 3 }, flag: 'pull'
    },
    gl: {
      id: 'gl_x', name: '集束榴弹', req: { stat: 'blast', statLvl: 2 },
      desc: '一次抛射三枚，覆盖整条车道', mul: { dmg: 1.25, cd: 0.8, count: 2, radius: 1.15 }
    },
    rpg: {
      id: 'rpg_x', name: '集束火箭', req: { stat: 'blast', statLvl: 2 },
      desc: '三枚火箭同时出膛，落地连爆', mul: { dmg: 1.25, cd: 0.85, count: 2, radius: 1.2 }
    },
    flamer: {
      id: 'flamer_x', name: '烈焰风暴', req: { stat: 'range', statLvl: 2 },
      desc: '火舌更长更宽，一路烧过去', mul: { dmg: 1.5, range: 1.5, arc: 1.4, cd: 0.8 }
    },
    cryo: {
      id: 'cryo_x', name: '永冻核心', req: { stat: 'duration', statLvl: 2 },
      desc: '冷媒无限循环，整片区域一起结霜', mul: { dmg: 1.4, range: 1.25, arc: 1.4, slow: 0.15, cd: 0.85 }
    },
    napalm: {
      id: 'napalm_x', name: '焦土', req: { stat: 'duration', statLvl: 2 },
      desc: '火舌拉成一条焚化带，烧穿整排', mul: { dmg: 1.5, range: 1.3, arc: 1.35, dur: 1.6, cd: 0.85 }
    },
    taser: {
      id: 'taser_x', name: '雷神之怒', req: { stat: 'bounce', statLvl: 1 },
      desc: '电弧连锁全场，几乎没有死角', mul: { dmg: 1.6, cd: 0.75, chains: 4 }
    },
    laser: {
      id: 'laser_x', name: '裂解光束', req: { stat: 'pierce', statLvl: 2 },
      desc: '光束加宽，贯穿线上的一切', mul: { dmg: 1.6, cd: 0.8, width: 2.2, pierce: 4 }
    },
    redlaser: {
      id: 'redlaser_x', name: '熔核过载', req: { stat: 'power', statLvl: 3 },
      /* 穿透**不是**它的卖点：本体那道光束本来就是沿直线打穿一整排，
         再给 pierce 只是把"本来就能做的事"重复卖一次。
         进化换成两样本体没有的：
           ① melt —— 同一目标被连续照射会越来越烫（每跳 +9%、最多 8 层、断火 0.5s 清零）；
           ② 独立音色 meltlaser —— 从"一束脉冲"变成"一直在烧"（见 audio.js）。
         宽度 x1.75（原来 1.3）：进化之后是**一道很粗的持续激光**，
         数量恒为 1（Gear.beam 对 sustainBeam 的钳制），粗是它唯一的形态语言。 */
      desc: '一道不断的光束烧到发白。不再需要开火：连着照会越来越烫',
      color: '#ff9b82',
      flag: 'melt',
      mul: { dmg: 1.45, width: 1.75, range: 1.15 }
    },
    saber: {
      id: 'saber_x', name: '剑气风暴', req: { stat: 'haste', statLvl: 2 },
      desc: '每次挥砍都甩出剑气，远程也能砍',
      mul: { dmg: 1.35, cd: 0.8, range: 1.2, targets: 2 }, flag: 'beam'
    },
    katana: {
      id: 'katana_x', name: '居合', req: { stat: 'haste', statLvl: 3 },
      desc: '快到只剩残影，斩击几乎不间断', mul: { dmg: 1.35, cd: 0.45, arc: 0.12 }
    },
    greatsword: {
      id: 'greatsword_x', name: '破军', req: { stat: 'power', statLvl: 3 },
      desc: '横扫范围扩大到半个屏幕', mul: { dmg: 1.45, arc: 1.35, range: 1.15 }
    },
    twinblades: {
      id: 'twinblades_x', name: '千刃', req: { stat: 'haste', statLvl: 3 },
      desc: '每轮挥出两道刀光', mul: { dmg: 1.2, cd: 0.7 }, flag: 'echo'
    },
    axe: {
      id: 'axe_x', name: '裂颅', req: { stat: 'crit', statLvl: 2 },
      desc: '劈砍更容易暴击，击退更远', mul: { dmg: 1.5, cd: 0.85, knock: 6 }
    },
    warhammer: {
      id: 'warhammer_x', name: '地震锤', req: { stat: 'blast', statLvl: 2 },
      desc: '每锤都带冲击波，震开一圈', mul: { dmg: 1.45, radius: 1.5, cd: 0.9 }, flag: 'shock'
    },
    spear: {
      id: 'spear_x', name: '贯穿之枪', req: { stat: 'pierce', statLvl: 2 },
      desc: '枪出如龙，一条线上没有活口', mul: { dmg: 1.5, range: 1.35, targets: 3, cd: 0.85 }
    },
    chainsaw: {
      id: 'chainsaw_x', name: '绞肉机', req: { stat: 'power', statLvl: 3 },
      desc: '锯链转速翻倍，绞杀不停', mul: { dmg: 1.7, cd: 0.85, targets: 1 }
    },
    voltsaw: {
      id: 'voltsaw_x', name: '雷锯', req: { stat: 'bounce', statLvl: 1 },
      desc: '每一锯都甩出电弧', mul: { dmg: 1.45, chains: 3, cd: 0.85 }
    },
    scythe: {
      id: 'scythe_x', name: '死神镰刀', req: { stat: 'power', statLvl: 3 },
      desc: '弧线扩到几乎一整圈，收割全场', mul: { dmg: 1.5, arc: 1.3, targets: 4 }
    },
    gauntlet: {
      id: 'gauntlet_x', name: '裂山拳', req: { stat: 'critdmg', statLvl: 2 },
      desc: '每拳带冲击波，打得整片后退', mul: { dmg: 1.6, radius: 1.4, knock: 8 }, flag: 'shock'
    },
    drill: {
      id: 'drill_x', name: '地核钻头', req: { stat: 'pierce', statLvl: 2 },
      desc: '钻穿一切，护甲形同虚设', mul: { dmg: 1.7, range: 1.15, cd: 0.9 }
    },
    whip: {
      id: 'whip_x', name: '千鞭', req: { stat: 'haste', statLvl: 2 },
      desc: '鞭影覆盖大半个屏幕', mul: { dmg: 1.4, range: 2.5, arc: 1.6, targets: 4, cd: 0.9 }
    },
    shieldaxe: {
      id: 'shieldaxe_x', name: '铁壁', req: { stat: 'armor', statLvl: 2 },
      desc: '格挡更强，挥砍带范围冲击', mul: { dmg: 1.4, radius: 30 }, block: 0.4
    },
    glaive: {
      id: 'glaive_x', name: '回旋风暴', req: { stat: 'split', statLvl: 1 },
      desc: '一次掷出三枚，回程也不落空', mul: { dmg: 1.3, count: 2, cd: 0.85 }
    },

    /* ---------------- 副槽近战：补齐四件"永远停在数值上"的 ----------------
     * 匕首 / 短剑 / 机械拳套 / 便携钻头 之前没有进化，副槽抽到它们等于少一个质变点。
     * 四条都挂在已有机制上（sure / echo / ring / core），不新增系统。 */
    dagger: {
      id: 'dagger_x', name: '穿心', req: { stat: 'crit', statLvl: 2 },
      desc: '同一目标连中三下，第四下必定暴击',
      mul: { dmg: 1.45, cd: 0.85 }, flag: 'sure'
    },
    shortsword: {
      id: 'shortsword_x', name: '双刃', req: { stat: 'haste', statLvl: 2 },
      desc: '每次挥砍追加一段二段斩',
      mul: { dmg: 1.3, cd: 0.9 }, flag: 'echo'
    },
    powerfist: {
      id: 'powerfist_x', name: '裂地', req: { stat: 'blast', statLvl: 2 },
      desc: '冲击环变成真实判定，一圈内的敌人再吃半刀',
      mul: { dmg: 1.35, cd: 0.9 }, flag: 'ring'
    },
    portdrill: {
      id: 'portdrill_x', name: '钻核', req: { stat: 'pierce', statLvl: 1 },
      desc: '每次钻击在地面留下还在转的钻核，持续 2 秒',
      mul: { dmg: 1.4, cd: 0.9 }, flag: 'core'
    },

    /* ---------------- 副武器 ----------------
     * 副武器同样能进化：主武器是"这一局的路线"，副武器是"这条路线上的质变点" */
    microsmg: {
      id: 'microsmg_x', name: '双持微冲', req: { stat: 'haste', statLvl: 2 },
      desc: '左右手各一把，火力密度翻倍', mul: { dmg: 1.35, cd: 0.62, count: 1 }
    },
    tacpistol: {
      id: 'tacpistol_x', name: '执法者', req: { stat: 'crit', statLvl: 2 },
      desc: '大口径战术弹，一发串两个', mul: { dmg: 1.45, cd: 0.8, pierce: 2 }
    },
    sawnoff: {
      id: 'sawnoff_x', name: '撕裂者', req: { stat: 'blast', statLvl: 1 },
      desc: '弹丸更密、射程更长，贴脸一发清场', mul: { dmg: 1.3, count: 3, spread: 1.15, range: 1.15 }
    },
    handxbow: {
      id: 'handxbow_x', name: '猎手弩', req: { stat: 'pierce', statLvl: 1 },
      desc: '重弩矢，穿透两个目标', mul: { dmg: 1.4, pierce: 2, cd: 0.85 }
    },
    throwingknife: {
      id: 'throwingknife_x', name: '刀扇', req: { stat: 'bounce', statLvl: 1 },
      desc: '一次性甩出五把，刀刀弹射', mul: { dmg: 1.25, count: 3, spread: 1.4 }, flag: 'bounce3'
    },
    shuriken: {
      id: 'shuriken_x', name: '千刃手里剑', req: { stat: 'split', statLvl: 1 },
      desc: '五枚连环，命中即分裂', mul: { dmg: 1.2, count: 2 }, flag: 'split'
    },
    frag: {
      id: 'frag_x', name: '破片手雷', req: { stat: 'blast', statLvl: 2 },
      desc: '炸开之后还会甩出一圈致命破片', mul: { dmg: 1.3, radius: 1.2 }, flag: 'shard'
    },
    molotov: {
      id: 'molotov_x', name: '凝固汽油', req: { stat: 'duration', statLvl: 1 },
      desc: '火海更宽、烧得更久，几乎封死一条街', mul: { dmg: 1.3, radius: 1.25, dps: 1.4, dur: 1.5 }
    },
    cryogrenade: {
      id: 'cryogrenade_x', name: '绝对零度', req: { stat: 'blast', statLvl: 1 },
      desc: '冻得更透、冻得更久，几乎走不动', mul: { dmg: 1.2, radius: 1.3, slow: 0.1, dur: 1.4 }
    },
    shockwave: {
      id: 'shockwave_x', name: '冲击核心', req: { stat: 'armor', statLvl: 1 },
      desc: '震荡半径更大，附带一圈爆裂', mul: { dmg: 1.4, radius: 1.35, knock: 8, stun: 0.2 }, flag: 'shock'
    },
    energyshield: {
      id: 'energyshield_x', name: '谐振壁垒', req: { stat: 'armor', statLvl: 2 },
      desc: '格挡反击扩成一圈谐振冲击，挡得更多也打得更远',
      mul: { dmg: 1.4, range: 1.2 }, block: 0.45
    },
    stunbaton: {
      id: 'stunbaton_x', name: '高压警棍', req: { stat: 'haste', statLvl: 1 },
      desc: '敲中即麻，还会把电流传给旁边的人', mul: { dmg: 1.4, stun: 0.4, targets: 1 }, flag: 'shock'
    },
    riotshield: {
      id: 'riotshield_x', name: '移动堡垒', req: { stat: 'armor', statLvl: 2 },
      desc: '格挡率大幅提高，撞击还能把人顶飞', mul: { dmg: 1.5, knock: 6 }, block: 0.38
    },

    /* ---------------- 重型武器 ----------------
     * 重型本来就占两格，进化给的是"值回这两格"的终点。
     * **每条进化都要有自己的机制 / 特效，不能只是本体的数值放大** ——
     * 见文件末尾的「进化质变登记」，smoke 会核对每个 flag 都有消费方。 */
    heavymg: {
      id: 'heavymg_x', name: '弹幕墙', req: { stat: 'pierce', statLvl: 2 },
      /* 360° 螺旋弹幕：不再朝目标打，而是每发甩出一整圈（36 发），相位逐发旋转。
         节奏从 0.056s 放到 0.30s：一圈 36 发 × 3.3 环/秒 = 110 发/秒，
         比本体（14 发/秒）密得多，但**打在同一个目标上的比例更低**，
         所以单发伤害按 3.25 倍补偿（实测：单体 149 / 扇面 1086 / 环形 1189）。 */
      desc: '不再瞄准：每发甩出一整圈弹幕，相位逐发旋转，360° 没有死角',
      mul: { dmg: 3.25, cd: 4.3, pierce: 1 }, flag: 'spiral', spiralN: 36
    },
    gatling: {
      id: 'gatling_x', name: '转管风暴', req: { stat: 'haste', statLvl: 2 },
      /* 子弹变大 + 伤害再抬一档：转速拉满之后"一梭子砸穿一片"的感觉。
         两个 flag 一起挂：spinup 是它的本体机制，bigBullet 才是进化的新东西。 */
      desc: '转起来之后射速攀升得更快、弹丸更大更狠',
      mul: { dmg: 1.6, cd: 0.86 }, flag: 'spinup', flags: { bigBullet: 1 }
    },
    heavyrpg: {
      id: 'heavyrpg_x', name: '焚城', req: { stat: 'blast', statLvl: 2 },
      desc: '战斗部塞满破片，一发掀掉半条车道', mul: { dmg: 1.3, radius: 1.3, count: 1 }, flag: 'shard'
    },
    railgun: {
      id: 'railgun_x', name: '湮灭炮', req: { stat: 'pierce', statLvl: 2 },
      /* 从"一发快枪"变成"蓄力巨炮"：
         ① 宽度 8 → 27（巨粗），穿透照旧全屏；
         ② 3 秒蓄力（`chargeTime`），蓄力时脚下有一圈收束光环 + 芯部聚能；
         ③ 开火后光柱不立刻消失，像冲击波一样往外扩着淡出 0.6 秒（`linger`）。
         cd 不再是 2.36：蓄力本身就是节奏，`mul.cd` 只作为"蓄满之后的最小间隔"兜底。
         伤害 ×2.4 是补"每 3 秒才一发"的节奏损失（实测单体 ≈ 本体 Lv5 水平，
         扇面 / 直线因为巨粗而明显更高）。 */
      desc: '3 秒蓄力，打出一道巨粗的光柱；开火后光柱还会向外扩散着淡去',
      mul: { dmg: 2.4, width: 3.4, pierce: 10, cd: 1.15 },
      chargeTime: 3, linger: 0.6
    },
    heavyflamer: {
      id: 'heavyflamer_x', name: '炼狱', req: { stat: 'power', statLvl: 3 },
      /* 火舌扫过的地方会留一片火（`inferno`，消费方在 Gear.flame）：
         不然"整条街都在烧"只是一句数值描述 */
      desc: '火舌拉到极限，烧过的地方还留着一片火', mul: { dmg: 1.5, range: 1.3, arc: 1.2 },
      flags: { inferno: 1 }
    },
    siegecrossbow: {
      id: 'siegecrossbow_x', name: '攻城弩阵', req: { stat: 'pierce', statLvl: 2 },
      /* 每支箭都带爆炸，而且**穿透时也炸**（在 combat.js 的弹体命中处结算）。
         补 cd 0.9 之后每箭约 1.04x；再收一点散布（0.24 → 0.13）——
         六箭铺得太开，实测打在同一个目标上的只有一两支。 */
      desc: '八矢齐射，每支箭命中即炸 —— 穿透过去的每一段都炸',
      mul: { dmg: 1.55, count: 2, pierce: 2, cd: 0.9, spread: 0.55 }, flag: 'arrowBoom'
    },
    giantsaber: {
      id: 'giantsaber_x', name: '剑刃风暴', req: { stat: 'haste', statLvl: 2 },
      desc: '每次挥砍都甩出一整道剑气', mul: { dmg: 1.4, range: 1.2, targets: 2 }, flag: 'beam'
    },
    heavychainsaw: {
      id: 'heavychainsaw_x', name: '血肉磨坊', req: { stat: 'power', statLvl: 3 },
      /* 进化自带"撕裂"（`rend`，消费方在 Gear.stat）：不点「锯齿刃口」也有流血 */
      desc: '锯链转到底，咬住就撕开伤口', mul: { dmg: 1.5, targets: 1, cd: 0.85 },
      flags: { rend: 1 }
    }
  };

  /* 进化形态按基础武器派生：只改数值与质变开关，不重复写整条数据 */
  (function buildEvolved() {
    var baseId, evo, src, o, k, mul;
    for (baseId in D.evolutions) {
      if (!D.evolutions.hasOwnProperty(baseId)) continue;
      evo = D.evolutions[baseId];
      src = D.gear[baseId];
      if (!src) continue;
      o = {};
      for (k in src) {
        if (src.hasOwnProperty(k)) o[k] = src[k];
      }
      o.id = evo.id;
      o.name = evo.name;
      o.desc = evo.desc;
      o.evo = true;
      o.hidden = true;
      o.baseId = baseId;
      /* 进化不是终点：1→3 级「觉醒」继续成长，否则进化完只剩通用属性可点，
         卡池会突然变窄，玩家手上那把武器也失去继续投入的理由 */
      o.maxLvl = 3;
      o.awake = true;
      o.rarity = 5;
      o.flags = o.flags || {};
      if (evo.flag) o.flags[evo.flag] = 1;
      /* 一条进化可以带多个质变开关（转管风暴既要 spinup 又要 bigBullet） */
      if (evo.flags) for (k in evo.flags) if (evo.flags[k]) o.flags[k] = 1;
      /* 进化专属的机制字段（不是数值倍率，所以不走 mul）：
         chargeTime = 蓄力几秒才开一炮；linger = 开火后光柱停留多久。
         写在进化条目上，由这里搬进武器数据 —— 本体不该有这些字段。 */
      if (evo.chargeTime) o.chargeTime = evo.chargeTime;
      if (evo.linger) o.linger = evo.linger;
      if (evo.spiralN) o.spiralN = evo.spiralN;
      /* 成长曲线继承本体，但压到 6 成：进化的质变来自 mul，觉醒只是收尾 */
      o.g = {};
      for (k in src.g) {
        if (src.g.hasOwnProperty(k)) o.g[k] = src.g[k] * 0.6;
      }
      o.base = {};
      mul = evo.mul || {};
      for (k in src.base) {
        if (!src.base.hasOwnProperty(k)) continue;
        o.base[k] = src.base[k];
      }
      for (k in mul) {
        if (!mul.hasOwnProperty(k)) continue;
        if (k === 'cd' || k === 'dmg' || k === 'dps' || k === 'radius' || k === 'range' ||
            k === 'speed' || k === 'arc' || k === 'width' || k === 'spread') {
          o.base[k] = src.base[k] * mul[k];
        } else {
          o.base[k] = (src.base[k] || 0) + mul[k];
        }
      }
      if (evo.block) o.block = evo.block;
      /* 进化可以换配色：熔核过载要"烧到发白"，只改数值的话打起来还是同一束红光 */
      if (evo.color) o.color = evo.color;
      if (src.spinup) o.spinup = 1;
      D.gear[o.id] = o;
    }
  })();

  /** 局内可掉落的手持装备池（进化形态不在其中） */
  D.weaponPool = [];
  D.subPool = [];
  D.heavyPool = [];
  (function buildPools() {
    var i, id;
    for (i = 0; i < D.slotPool.main.length; i++) {
      id = D.slotPool.main[i];
      if (!D.gear[id].evo) D.weaponPool.push(id);
    }
    for (i = 0; i < D.slotPool.sub.length; i++) {
      id = D.slotPool.sub[i];
      if (!D.gear[id].evo) D.subPool.push(id);
    }
    for (i = 0; i < D.slotPool.heavy.length; i++) {
      id = D.slotPool.heavy[i];
      if (!D.gear[id].evo) D.heavyPool.push(id);
    }
  })();

  /**
   * 武器强度分（按 1 级基础值算）
   *
   * 抽取权重按"这玩意儿到底打得多狠"来给，而不是按稀有度标签给 ——
   * 稀有度只是个展示属性，真正决定该多常见的应该是它的实际战力：
   *   单体输出   dmg × 弹量 ÷ 冷却
   *   覆盖面     爆炸半径 / 穿透 / 连锁 / 近战目标数
   *   持续控场   燃烧时长 / 减速 / 眩晕
   *   功能价值   治疗量这类不带 DPS 的（否则医疗针会被判成最弱）
   * 短射程是拿命换的（贴身才能打），重型还拖慢脚步，这两项各打一折。
   */
  D.gearPower = function (id) {
    var d = D.gear[id];
    if (!d) return 0;
    if (d._pw !== undefined) return d._pw;
    var b = d.base || {};
    var p = (b.dmg || 0) * (b.count || 1) / Math.max(0.12, b.cd || 0.5);
    p += Math.min(6, b.pierce || 0) * 2;
    p += Math.min(60, b.radius || 0) * 1.2;
    p += (b.chains || 0) * 4;
    /* 不限目标数的横扫按"稳定命中 5 个"估分：targets 写的是 99，
       直接吃 99 会把它们判成全表最强、抽取权重压到 0.45，
       结果就是"改强了反而抽不到" */
    var tg = b.targets || 1;
    if (d.noCap) tg = Math.min(tg, 5);
    p += Math.max(0, tg - 1) * 3;
    p += (b.dur || 0) * 4;
    p += (b.slow || 0) * 14;
    p += (b.stun || 0) * 6;
    p += (b.heal || 0) * 220;
    if (b.range > 0 && b.range < 70) p *= 0.88;
    if (d.move && d.move < 1) p *= 0.9;
    d._pw = p;
    return p;
  };

  /**
   * 抽取权重：强度越高越稀有
   *
   * 40 分（手枪档）当 1.0 基准，越强按 0.85 次幂往下压，最狠的压到 0.45、
   * 最杂鱼的抬到 2.2 —— 也就是"最强的比最弱的少见约 5 倍"。
   * 不设 floor 会让顶级武器变成都市传说，不设 cap 会让杂鱼刷屏。
   */
  D.gearWeight = function (id) {
    var d = D.gear[id];
    if (!d) return 1;
    if (d._gw !== undefined) return d._gw;
    var p = D.gearPower(id);
    var w = Math.pow(40 / Math.max(14, p), 0.85);
    w = Math.max(0.45, Math.min(2.2, w));
    d._gw = Math.round(w * 100) / 100;
    return d._gw;
  };

  /** 稀有度 → 新装备出现权重（历史表格，仅作展示档位参考，抽取已改走 gearWeight） */
  D.rarityWeight = { 1: 10, 2: 6, 3: 3.2, 4: 1.4, 5: 0.4 };

  /** 兼容旧代码：HS.Data.weapons 指向同一张表 */
  D.weapons = D.gear;

  D.weaponDesc = {
    pistol: '单发直射，自动索敌',
    shotgun: '扇形弹幕，近战之王',
    smg: '高射速，持续压制',
    molotov: '范围燃烧，封锁走位',
    taser: '连锁闪电，清群利器',
    crossbow: '穿透弩箭，直线收割',
    saber: '近身横扫，攻守兼备'
  };
})();
