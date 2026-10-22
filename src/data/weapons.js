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
    shotgun: 'shotgun', launcher: 'launcher', mortar: 'launcher', harpoon: 'launcher',
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
    firering: 'ring', frostring: 'ring', railorb: 'orb', gravitysat: 'orb'
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
      id: 'gl', name: '榴弹发射器', art: 'launcher', fam: 'explosive', mech: 'lob', rarity: 3,
      desc: '抛射榴弹，落地炸开一片', tags: ['explosive'],
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
      base: { cd: 0.16, dmg: 5.5, range: 92, arc: 0.52, dps: 0, dur: 2 }, g: { dmg: 0.16, cd: 0.03, range: 0.03 }
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
    }
  ]);

  add('main', '近战武器', {
    fam: 'melee', mech: 'melee', color: '#c9d1d9', rarity: 2,
    tags: ['melee']
  }, [
    {
      id: 'saber', name: '光剑', art: 'saber', rarity: 3, desc: '高频刃口，一次能扫开一排',
      base: { cd: 0.42, dmg: 18, range: 36, arc: 1.2, targets: 3 }, g: { dmg: 0.18, cd: 0.05, targets: 0.5 }
    },
    {
      id: 'katana', name: '武士刀', art: 'katana', desc: '出手极快的斩击',
      base: { cd: 0.34, dmg: 13, range: 30, arc: 1.0, targets: 2 }, g: { dmg: 0.16, cd: 0.06, targets: 0.5 }
    },
    {
      id: 'greatsword', name: '大剑', art: 'greatsword', rarity: 3, desc: '大范围横扫，前摇略长',
      base: { cd: 0.86, dmg: 34, range: 40, arc: 1.6, targets: 4 }, g: { dmg: 0.2, cd: 0.05, arc: 0.03 }
    },
    {
      id: 'twinblades', name: '双刀', art: 'twinblades', desc: '极快的双段连斩',
      base: { cd: 0.22, dmg: 8, range: 28, arc: 0.85, targets: 2 }, g: { dmg: 0.15, cd: 0.05 }
    },
    {
      id: 'axe', name: '战斧', art: 'axe', rarity: 2, desc: '劈砍带击退，适合开道',
      base: { cd: 0.7, dmg: 28, range: 32, arc: 1.15, targets: 3, knock: 8 }, g: { dmg: 0.19, cd: 0.05 }
    },
    {
      id: 'warhammer', name: '战锤', art: 'hammer', rarity: 3, desc: '一击砸出冲击波，慢但极重',
      base: { cd: 1.0, dmg: 42, range: 34, arc: 1.0, targets: 2, knock: 12, radius: 26 }, g: { dmg: 0.21, cd: 0.05 },
      onHit: 'shock'
    },
    {
      id: 'spear', name: '长矛', art: 'spear', mech: 'thrust',
      desc: '直刺一条线，只打正前方；枪身越长，刺出的宽度也越宽',
      base: { cd: 0.55, dmg: 20, range: 48, targets: 3 }, g: { dmg: 0.18, cd: 0.05, targets: 0.5 }
    },
    {
      id: 'chainsaw', name: '链锯', art: 'chainsaw', rarity: 3, mech: 'drill',
      desc: '贴上去就不断绞，持续伤害', tags: ['melee', 'saw'],
      base: { cd: 0.12, dmg: 8, range: 32, arc: 0.8, targets: 2 }, g: { dmg: 0.16, cd: 0.02 }
    },
    {
      id: 'voltsaw', name: '电锯剑', art: 'chainsaw', rarity: 3, mech: 'drill',
      desc: '锯刃带电，切割同时放电', tags: ['melee', 'energy'],
      base: { cd: 0.3, dmg: 12, range: 32, arc: 0.9, targets: 3, chains: 1 }, g: { dmg: 0.17, cd: 0.04 }
    },
    {
      id: 'scythe', name: '长柄镰刀', art: 'scythe', rarity: 4, desc: '巨大弧线收割半个屏幕的近身敌',
      base: { cd: 0.78, dmg: 26, range: 44, arc: 2.0, targets: 5 }, g: { dmg: 0.2, cd: 0.05, arc: 0.04 }
    }
  ]);

  add('main', '特殊近战', {
    fam: 'melee', mech: 'melee', color: '#a5d8ff', rarity: 2,
    tags: ['melee']
  }, [
    {
      id: 'gauntlet', name: '拳套', art: 'fist', desc: '极快的连打，单点爆发',
      base: { cd: 0.25, dmg: 10, range: 24, arc: 0.9, targets: 1, knock: 5, radius: 22 }, g: { dmg: 0.16, cd: 0.05 }
    },
    {
      id: 'drill', name: '机械钻头', art: 'drill', rarity: 3, mech: 'drill', desc: '钻穿单个目标，破甲极高',
      base: { cd: 0.18, dmg: 14, range: 24, arc: 0.4, targets: 1, pierce: 2 }, g: { dmg: 0.17, cd: 0.03 }
    },
    {
      id: 'whip', name: '能量鞭', art: 'whip', rarity: 3, desc: '长距离横扫，控场很好',
      base: { cd: 0.5, dmg: 12, range: 62, arc: 1.4, targets: 4 }, g: { dmg: 0.17, cd: 0.05, targets: 0.5 }
    },
    {
      id: 'shieldaxe', name: '盾斧', art: 'shieldaxe', rarity: 3, desc: '攻守一体：挥砍同时挡下伤害',
      base: { cd: 0.8, dmg: 26, range: 30, arc: 1.2, targets: 2, knock: 6 }, g: { dmg: 0.19, cd: 0.05 },
      block: 0.22
    },
    {
      id: 'glaive', name: '回旋刃', art: 'glaive', rarity: 3, mech: 'boomerang',
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
      id: 'molotov', name: '燃烧瓶', art: 'molotov', desc: '砸出一片火海，封锁走位',
      base: { cd: 4.0, dmg: 12, radius: 34, dps: 10, dur: 3.5, range: 190 }, g: { dmg: 0.16, cd: 0.05, radius: 1.4, dps: 0.15 }
    },
    {
      id: 'frag', name: '手雷', art: 'grenade', rarity: 2, desc: '拉环抛投，落地开花',
      base: { cd: 3.0, dmg: 45, radius: 36, range: 195 }, g: { dmg: 0.18, cd: 0.05, radius: 1.2 }
    },
    {
      id: 'stickybomb', name: '黏性炸弹', art: 'grenade', rarity: 3, desc: '粘上就炸，中心伤害更高',
      base: { cd: 3.4, dmg: 62, radius: 30, range: 175 }, g: { dmg: 0.2, cd: 0.05, radius: 1.0 }
    },
    {
      id: 'flashbang', name: '闪光弹', art: 'grenade', rarity: 2, desc: '白屏震眩，打断进攻节奏',
      base: { cd: 4.6, dmg: 6, radius: 46, stun: 1.8, range: 180 }, g: { dmg: 0.12, cd: 0.05, radius: 1.2, stun: 0.12 }
    },
    {
      id: 'cryogrenade', name: '冰冻手雷', art: 'frost', rarity: 3, desc: '整片区域冻住，方便拉开距离',
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
      id: 'smoke', name: '烟雾发射器', art: 'grenade', desc: '烟雾里它们会慢下来',
      base: { cd: 6.5, dmg: 4, radius: 48, dps: 0, slow: 0.35, dur: 6, range: 200 }, g: { radius: 1.2, dur: 0.08 },
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
      id: 'dagger', name: '战斗匕首', art: 'knife', desc: '快速短刺，贴脸补刀',
      base: { cd: 0.5, dmg: 12, range: 26, arc: 0.9, targets: 1 }, g: { dmg: 0.16, cd: 0.05 }
    },
    {
      id: 'shortsword', name: '短剑', art: 'shortsword', rarity: 2, desc: '更长的刃，一次能带到两个',
      base: { cd: 0.6, dmg: 16, range: 30, arc: 1.1, targets: 2 }, g: { dmg: 0.17, cd: 0.05 }
    },
    {
      id: 'stunbaton', name: '电击警棍', art: 'baton', rarity: 2, desc: '敲中就麻，控住冲脸的',
      base: { cd: 0.8, dmg: 8, range: 28, arc: 0.9, targets: 2, stun: 0.8 }, g: { dmg: 0.15, cd: 0.05, stun: 0.08 }
    },
    {
      id: 'riotshield', name: '战斗盾牌', art: 'shield', rarity: 3, desc: '顶着盾打，减少正面伤害',
      base: { cd: 1.0, dmg: 10, range: 28, arc: 1.0, targets: 2, knock: 8 }, g: { dmg: 0.16, cd: 0.05 },
      block: 0.25
    },
    {
      id: 'energyshield', name: '能量盾', art: 'eshield', rarity: 3, desc: '能量护盾，挡伤更多',
      base: { cd: 1.2, dmg: 8, range: 26, arc: 1.0, targets: 2 }, g: { dmg: 0.15, cd: 0.05 },
      block: 0.32
    },
    {
      id: 'powerfist', name: '机械拳套', art: 'fist', rarity: 2, desc: '重拳击退，把人打回巷子',
      base: { cd: 0.7, dmg: 22, range: 26, arc: 0.9, targets: 1, knock: 12 }, g: { dmg: 0.18, cd: 0.05 }
    },
    {
      id: 'grapnel', name: '链锁钩爪', art: 'harpoon', rarity: 3, mech: 'bullet', desc: '甩出钩爪，把远处的拽过来打',
      base: { cd: 2.2, dmg: 15, range: 155, speed: 380, pierce: 1 }, g: { dmg: 0.17, cd: 0.06 },
      onHit: 'pull'
    },
    {
      id: 'portdrill', name: '便携钻头', art: 'drill', rarity: 2, mech: 'drill', desc: '近距离持续钻孔',
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
      desc: '周期性震开身边所有敌人', fam: 'melee',
      base: { cd: 5, dmg: 20, range: 58, arc: 3.15, targets: 99, knock: 14, stun: 0.5 }, g: { dmg: 0.18, cd: 0.05, range: 0.03 }
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
      id: 'mortar', name: '迫击炮', art: 'mortar', fam: 'explosive', mech: 'lob',
      move: 0.72, desc: '抛射到远处落点，覆盖一整片', tags: ['explosive', 'heavy'],
      base: { cd: 2.9, dmg: 82, radius: 68, range: 300 }, g: { dmg: 0.18, cd: 0.05, radius: 1.6 }
    },
    {
      id: 'plasmacannon', name: '等离子炮', art: 'plasma', fam: 'energy', mech: 'beam',
      move: 0.8, desc: '高热光束穿透一排，附带小范围爆炸', tags: ['energy', 'heavy'],
      base: { cd: 1.6, dmg: 70, range: 290, pierce: 3, width: 10, radius: 26 }, g: { dmg: 0.2, cd: 0.05, pierce: 0.5 }
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
      id: 'heavychainsaw', name: '重型链锯', art: 'chainsaw', fam: 'melee', mech: 'drill',
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
    taser: {
      id: 'taser_x', name: '雷神之怒', req: { stat: 'bounce', statLvl: 1 },
      desc: '电弧连锁全场，几乎没有死角', mul: { dmg: 1.6, cd: 0.75, chains: 4 }
    },
    laser: {
      id: 'laser_x', name: '裂解光束', req: { stat: 'pierce', statLvl: 2 },
      desc: '光束加宽，贯穿线上的一切', mul: { dmg: 1.6, cd: 0.8, width: 2.2, pierce: 4 }
    },
    saber: {
      id: 'saber_x', name: '剑气风暴', req: { stat: 'haste', statLvl: 2 },
      desc: '每次挥砍都甩出剑气，远程也能砍',
      mul: { dmg: 1.35, cd: 0.8, range: 1.2, targets: 2 }, flag: 'beam'
    },
    katana: {
      id: 'katana_x', name: '居合', req: { stat: 'haste', statLvl: 3 },
      desc: '快到只剩残影，斩击几乎不间断', mul: { dmg: 1.35, cd: 0.45, targets: 1 }
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
      desc: '钻穿一切，护甲形同虚设', mul: { dmg: 1.7, pierce: 4, cd: 0.9 }
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
    stunbaton: {
      id: 'stunbaton_x', name: '高压警棍', req: { stat: 'haste', statLvl: 1 },
      desc: '敲中即麻，还会把电流传给旁边的人', mul: { dmg: 1.4, stun: 0.4, targets: 1 }, flag: 'shock'
    },
    riotshield: {
      id: 'riotshield_x', name: '移动堡垒', req: { stat: 'armor', statLvl: 2 },
      desc: '格挡率大幅提高，撞击还能把人顶飞', mul: { dmg: 1.5, knock: 6 }, block: 0.38
    },

    /* ---------------- 重型武器 ----------------
     * 重型本来就占两格，进化给的是"值回这两格"的终点 */
    heavymg: {
      id: 'heavymg_x', name: '弹幕墙', req: { stat: 'pierce', statLvl: 2 },
      desc: '弹链连穿三人，火力覆盖整条街', mul: { dmg: 1.3, pierce: 2, cd: 0.8 }
    },
    gatling: {
      id: 'gatling_x', name: '转管风暴', req: { stat: 'haste', statLvl: 2 },
      desc: '转起来之后射速攀升得更快、更狠', mul: { dmg: 1.35, cd: 0.86 }, flag: 'spinup'
    },
    heavyrpg: {
      id: 'heavyrpg_x', name: '焚城', req: { stat: 'blast', statLvl: 2 },
      desc: '战斗部塞满破片，一发掀掉半条车道', mul: { dmg: 1.3, radius: 1.3, count: 1 }, flag: 'shard'
    },
    mortar: {
      id: 'mortar_x', name: '火雨', req: { stat: 'blast', statLvl: 2 },
      desc: '一次抛射三发，覆盖一整个街区', mul: { dmg: 1.25, radius: 1.25, count: 2 }
    },
    railgun: {
      id: 'railgun_x', name: '湮灭炮', req: { stat: 'pierce', statLvl: 2 },
      desc: '弹道加宽，整列敌人一起汽化', mul: { dmg: 1.4, width: 1.6, pierce: 10 }
    },
    plasmacannon: {
      id: 'plasmacannon_x', name: '恒星炮', req: { stat: 'blast', statLvl: 2 },
      desc: '光柱更宽，命中处炸成一片火海', mul: { dmg: 1.4, width: 1.5, radius: 1.4 }
    },
    heavyflamer: {
      id: 'heavyflamer_x', name: '炼狱', req: { stat: 'power', statLvl: 3 },
      desc: '火舌拉到极限，整条街都在烧', mul: { dmg: 1.5, range: 1.3, arc: 1.2 }
    },
    siegecrossbow: {
      id: 'siegecrossbow_x', name: '攻城弩阵', req: { stat: 'pierce', statLvl: 2 },
      desc: '八矢齐射，箭箭贯穿', mul: { dmg: 1.25, count: 2, pierce: 2 }
    },
    giantsaber: {
      id: 'giantsaber_x', name: '剑刃风暴', req: { stat: 'haste', statLvl: 2 },
      desc: '每次挥砍都甩出一整道剑气', mul: { dmg: 1.4, range: 1.2, targets: 2 }, flag: 'beam'
    },
    heavychainsaw: {
      id: 'heavychainsaw_x', name: '血肉磨坊', req: { stat: 'power', statLvl: 3 },
      desc: '锯链转到底，啃进去就不松口', mul: { dmg: 1.5, targets: 1, cd: 0.85 }
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

  /** 稀有度 → 新装备出现权重 */
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
