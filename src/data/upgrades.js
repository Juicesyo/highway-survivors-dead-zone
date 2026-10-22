/**
 * 升级数据层：武器专属分支 + 装备联动
 *
 * 专属分支挂在武器实例上（w.up[branchId] = 等级），换武器不会带走。
 * 新增武器时只要 fam 对得上就会自动获得一套模板分支；
 * 想给某把武器更个性化的方向，在 D.gearUpOverride 里写同名分支覆盖即可。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  HS.Data = HS.Data || {};
  var D = HS.Data;

  /* ---------- 按攻击机制分派的专属分支 ----------
   * 优先级：点名覆盖 > 机制模板 > 兼容族模板。
   * 机制模板的第三条基本都带 special（改变攻击行为），
   * 保证「每把武器至少有一条不是纯数值」的分支可选。
   */
  D.upByMech = {
    bullet: [
      { id: 'power', name: '弹头强化', desc: '这把枪伤害 +14%', maxLvl: 3, mod: { dmg: 0.14 } },
      { id: 'pierce', name: '穿甲弹芯', desc: '穿透 +1，伤害 +5%', maxLvl: 3, mod: { pierce: 1, dmg: 0.05 } },
      { id: 'volley', name: '双发扳机', desc: '每次多打出一发（散布略增）', maxLvl: 2, mod: { count: 1, spread: 0.04 }, special: 'volley' }
    ],
    burst: [
      { id: 'power', name: '加量装药', desc: '每发伤害 +14%', maxLvl: 3, mod: { dmg: 0.14 } },
      { id: 'rate', name: '短行程枪机', desc: '点射间隔 -8%，伤害 +3%', maxLvl: 3, mod: { cd: -0.08, dmg: 0.03 } },
      { id: 'burstAdd', name: '延长点射', desc: '每次点射多一发', maxLvl: 2, mod: { count: 1 } }
    ],
    spread: [
      { id: 'pellet', name: '加装霰弹', desc: '每次多 1 颗弹丸', maxLvl: 3, mod: { count: 1 } },
      { id: 'choke', name: '收束枪口', desc: '散布收窄，有效射程 +18%', maxLvl: 2, mod: { spread: -0.06, range: 0.18 } },
      { id: 'dragon', name: '龙息弹', desc: '弹丸命中后点燃目标', maxLvl: 2, mod: { dmg: 0.06 }, special: 'burn' }
    ],
    chain: [
      { id: 'power', name: '升压线圈', desc: '电弧伤害 +16%', maxLvl: 3, mod: { dmg: 0.16 } },
      { id: 'jump', name: '延长电弧', desc: '连锁 +1 个目标', maxLvl: 3, mod: { chains: 1 } },
      { id: 'storm', name: '电弧引爆', desc: '每次连锁命中附带小范围爆炸', maxLvl: 2, mod: { dmg: 0.05 }, special: 'shock' }
    ],
    beam: [
      { id: 'power', name: '功率超载', desc: '光束伤害 +18%', maxLvl: 3, mod: { dmg: 0.18 } },
      { id: 'wide', name: '加宽光栅', desc: '光束加宽，穿透 +1', maxLvl: 2, mod: { width: 2, pierce: 1 } },
      { id: 'burnBeam', name: '灼烧光谱', desc: '被光束扫到的敌人开始燃烧', maxLvl: 2, mod: { dmg: 0.05 }, special: 'burn' }
    ],
    rail: [
      { id: 'power', name: '电容增压', desc: '轨道弹伤害 +20%', maxLvl: 3, mod: { dmg: 0.2 } },
      { id: 'charge', name: '快速充能', desc: '充能间隔 -10%', maxLvl: 3, mod: { cd: -0.1 } },
      { id: 'burnBeam', name: '等离子附着', desc: '贯穿路径上的敌人被点燃', maxLvl: 2, mod: { dmg: 0.05 }, special: 'burn' }
    ],
    /* 长矛是直线突刺，扇形那套「扩大挥砍」对它没意义 */
    thrust: [
      { id: 'power', name: '枪尖强化', desc: '刺击伤害 +16%', maxLvl: 3, mod: { dmg: 0.16 } },
      { id: 'reach', name: '加长枪身', desc: '突刺距离 +14%，枪身同步变宽', maxLvl: 3, mod: { range: 0.14 } },
      { id: 'qi', name: '枪芒', desc: '突刺时射出一道枪芒，够到更远', maxLvl: 2, mod: { dmg: 0.05 }, special: 'beam' }
    ],
    melee: [
      { id: 'power', name: '刃口打磨', desc: '伤害 +15%', maxLvl: 3, mod: { dmg: 0.15 } },
      { id: 'arc', name: '扩大挥砍', desc: '范围 +12%，目标数 +1', maxLvl: 2, mod: { range: 0.12, targets: 1 } },
      { id: 'qi', name: '剑气', desc: '挥砍时甩出远程剑气', maxLvl: 2, mod: { dmg: 0.06 }, special: 'beam' }
    ],
    drill: [
      { id: 'power', name: '合金齿', desc: '钻击伤害 +15%', maxLvl: 3, mod: { dmg: 0.15 } },
      { id: 'spin', name: '提高转速', desc: '绞杀间隔 -10%', maxLvl: 3, mod: { cd: -0.1 } },
      { id: 'sustain', name: '持续绞杀', desc: '连续咬住同一目标时伤害递增', maxLvl: 2, mod: { dmg: 0.05 }, special: 'sustain' }
    ],
    boomerang: [
      { id: 'power', name: '加重刃缘', desc: '伤害 +16%', maxLvl: 3, mod: { dmg: 0.16 } },
      { id: 'count', name: '副刃投掷', desc: '一次多掷 1 把', maxLvl: 2, mod: { count: 1 } },
      { id: 'homing', name: '回旋制导', desc: '飞行途中自动修正方向', maxLvl: 2, mod: { dmg: 0.05 }, special: 'homing' }
    ],
    lob: [
      { id: 'power', name: '高爆装药', desc: '爆炸伤害 +16%', maxLvl: 3, mod: { dmg: 0.16 } },
      { id: 'blast', name: '扩爆弹体', desc: '爆炸半径 +15%', maxLvl: 3, mod: { radius: 0.15 } },
      { id: 'count', name: '多发装填', desc: '每次多投 1 枚', maxLvl: 2, mod: { count: 1 } }
    ],
    missile: [
      { id: 'power', name: '高爆战斗部', desc: '爆炸伤害 +18%', maxLvl: 3, mod: { dmg: 0.18 } },
      { id: 'blast', name: '扩爆战斗部', desc: '爆炸半径 +18%', maxLvl: 3, mod: { radius: 0.18 } },
      { id: 'shard', name: '碎片战斗部', desc: '爆炸后向四周飞出致命碎片', maxLvl: 2, mod: { dmg: 0.05 }, special: 'shard' }
    ],
    flame: [
      { id: 'power', name: '加压燃料', desc: '火焰伤害 +15%', maxLvl: 3, mod: { dmg: 0.15 } },
      { id: 'wide', name: '扇形喷嘴', desc: '喷射距离 +8%，扇面 +0.04', maxLvl: 3, mod: { range: 0.08, arc: 0.04 } },
      { id: 'fuel', name: '缓燃配方', desc: '燃烧持续时间 +20%', maxLvl: 2, mod: { dur: 0.2 } }
    ]
  };

  /* ---------- 各兼容族的默认分支（2~3 条） ---------- */
  D.upTemplates = {
    gun: [
      { id: 'power', name: '威力强化', desc: '这把枪伤害 +16%', maxLvl: 3, mod: { dmg: 0.16 } },
      { id: 'rate', name: '快速射击', desc: '攻击间隔 -10%', maxLvl: 3, mod: { cd: -0.10 } },
      { id: 'pierce', name: '穿甲弹', desc: '穿透 +1', maxLvl: 2, mod: { pierce: 1 } }
    ],
    energy: [
      { id: 'power', name: '能量过载', desc: '伤害 +18%', maxLvl: 3, mod: { dmg: 0.18 } },
      { id: 'chain', name: '导电增幅', desc: '连锁 / 穿透 +1', maxLvl: 2, mod: { chains: 1, pierce: 1 } },
      { id: 'rate', name: '快速充能', desc: '攻击间隔 -10%', maxLvl: 3, mod: { cd: -0.10 } }
    ],
    explosive: [
      { id: 'power', name: '高爆装药', desc: '伤害 +16%', maxLvl: 3, mod: { dmg: 0.16 } },
      { id: 'blast', name: '扩爆弹体', desc: '爆炸半径 +16%', maxLvl: 3, mod: { radius: 0.16 } },
      { id: 'count', name: '多发装填', desc: '每次 +1 发', maxLvl: 2, mod: { count: 1 } }
    ],
    melee: [
      { id: 'power', name: '刃口打磨', desc: '伤害 +16%', maxLvl: 3, mod: { dmg: 0.16 } },
      { id: 'rate', name: '连击训练', desc: '挥砍间隔 -12%', maxLvl: 3, mod: { cd: -0.12 } },
      { id: 'arc', name: '横扫', desc: '范围 +12%，目标数 +1', maxLvl: 2, mod: { range: 0.12, targets: 1 } }
    ],
    thrown: [
      { id: 'power', name: '加重投掷', desc: '伤害 +16%', maxLvl: 3, mod: { dmg: 0.16 } },
      { id: 'count', name: '多发投掷', desc: '投掷数量 +1', maxLvl: 2, mod: { count: 1 } },
      { id: 'rate', name: '快速换手', desc: '投掷间隔 -10%', maxLvl: 3, mod: { cd: -0.10 } }
    ],
    support: [
      { id: 'power', name: '强化装置', desc: '效果 +20%', maxLvl: 3, mod: { heal: 0.2, dmg: 0.2 } },
      { id: 'rate', name: '快速循环', desc: '触发间隔 -12%', maxLvl: 3, mod: { cd: -0.12 } },
      { id: 'radius', name: '扩大作用', desc: '作用范围 +15%', maxLvl: 2, mod: { radius: 0.15, range: 0.15 } }
    ]
  };

  /* ---------- 重点武器的个性化分支（点名覆盖模板） ---------- */
  D.gearUpOverride = {
    lmg: [
      { id: 'power', name: '高速供弹', desc: '射速 +12%，伤害 +8%', maxLvl: 3, mod: { cd: -0.12, dmg: 0.08 } },
      { id: 'pierce', name: '穿甲弹链', desc: '穿透 +1，伤害 +8%', maxLvl: 3, mod: { pierce: 1, dmg: 0.08 } },
      { id: 'sustain', name: '持续压制', desc: '连续开火后伤害递增，弹匣扩容', maxLvl: 2, mod: { dmg: 0.12, width: 1 }, special: 'sustain' }
    ],
    crossbow: [
      { id: 'count', name: '多矢装填', desc: '每次 +1 支弩箭', maxLvl: 3, mod: { count: 1 } },
      { id: 'fan', name: '扇形齐射', desc: '散布扩大，箭数 +1', maxLvl: 2, mod: { count: 1, spread: 0.08 } },
      { id: 'hunt', name: '追踪弩箭', desc: '弩箭会修正方向追杀目标', maxLvl: 2, mod: { dmg: 0.1 }, special: 'homing' }
    ],
    saber: [
      { id: 'range', name: '延长刃光', desc: '挥砍范围 +14%', maxLvl: 3, mod: { range: 0.14 } },
      { id: 'rate', name: '高频振动', desc: '挥砍间隔 -12%', maxLvl: 3, mod: { cd: -0.12 } },
      { id: 'beam', name: '剑气', desc: '挥砍时甩出远程剑气', maxLvl: 2, mod: { dmg: 0.08 }, special: 'beam' }
    ],
    rpg: [
      { id: 'blast', name: '扩大爆炸范围', desc: '爆炸半径 +20%', maxLvl: 3, mod: { radius: 0.2 } },
      { id: 'power', name: '高爆战斗部', desc: '爆炸伤害 +20%', maxLvl: 3, mod: { dmg: 0.2 } },
      { id: 'shard', name: '碎片弹', desc: '爆炸后飞出致命碎片', maxLvl: 2, mod: { dmg: 0.06 }, special: 'shard' }
    ],
    drone: [
      { id: 'rate', name: '提高攻击频率', desc: '开火间隔 -14%', maxLvl: 3, mod: { cd: -0.14 } },
      { id: 'target', name: '多目标锁定', desc: '同时攻击 +1 个目标', maxLvl: 2, mod: { count: 1 } },
      { id: 'track', name: '强化追踪', desc: '优先攻击被标记的敌人', maxLvl: 2, mod: { dmg: 0.12 }, special: 'mark' }
    ],
    firering: [
      { id: 'radius', name: '扩大环绕范围', desc: '环半径 +14%', maxLvl: 3, mod: { radius: 0.14 } },
      { id: 'power', name: '提高持续伤害', desc: '每秒伤害 +20%', maxLvl: 3, mod: { dps: 0.2 } },
      { id: 'burn', name: '附加燃烧', desc: '被烧到的敌人持续掉血', maxLvl: 2, mod: { dps: 0.1 }, special: 'burn' }
    ],
    heavymg: [
      { id: 'power', name: '重型弹链', desc: '伤害 +14%，穿透 +1', maxLvl: 3, mod: { dmg: 0.14, pierce: 1 } },
      { id: 'rate', name: '枪机改造', desc: '射速 +10%', maxLvl: 3, mod: { cd: -0.10 } },
      { id: 'spread', name: '稳压支架', desc: '散布收窄、射程 +15%，连射伤害递增', maxLvl: 2, mod: { spread: -0.03, range: 0.15 }, special: 'sustain' }
    ],
    sniper: [
      { id: 'power', name: '精工枪管', desc: '伤害 +18%', maxLvl: 3, mod: { dmg: 0.18 } },
      { id: 'pierce', name: '穿甲弹', desc: '穿透 +1，伤害 +6%', maxLvl: 3, mod: { pierce: 1, dmg: 0.06 } },
      { id: 'incendiary', name: '燃烧弹头', desc: '命中后目标持续燃烧', maxLvl: 2, mod: { dmg: 0.05 }, special: 'burn' }
    ],
    shotgun: [
      { id: 'pellet', name: '加大装药', desc: '弹丸 +2', maxLvl: 3, mod: { count: 2 } },
      { id: 'choke', name: '收束器', desc: '散布收窄，射程 +20%', maxLvl: 2, mod: { spread: -0.08, range: 0.2 } },
      { id: 'dragon', name: '龙息弹', desc: '弹丸命中点燃目标', maxLvl: 2, mod: { dmg: 0.06 }, special: 'burn' }
    ],
    gatling: [
      { id: 'spin', name: '高扭矩马达', desc: '预热更快，射速 +8%', maxLvl: 3, mod: { cd: -0.08 } },
      { id: 'power', name: '重弹链', desc: '伤害 +14%', maxLvl: 3, mod: { dmg: 0.14 } },
      { id: 'overheat', name: '过热供弹', desc: '持续扫射时伤害递增', maxLvl: 2, mod: { dmg: 0.05 }, special: 'sustain' }
    ],
    /* 旋转飞刀：通用环绕模板只有转速 / 伤害 / 半径三条，凑不出"刀圈合拢"。
       这里点名给四条，其中「加装副刃」是唯一能主动堆刀片数的来源 ——
       配合满级质变（count 10）才可能做到无死角 */
    orbitblade: [
      { id: 'speed', name: '高速自旋', desc: '环绕转速 +32%，伤害 +4%', maxLvl: 3, mod: { spin: 0.32, dmg: 0.04 } },
      { id: 'count', name: '加装副刃', desc: '刀片 +1', maxLvl: 2, mod: { count: 1 } },
      { id: 'power', name: '重刃', desc: '接触伤害 +22%', maxLvl: 3, mod: { dmg: 0.22 } },
      { id: 'radius', name: '外扩轨道', desc: '环绕半径 +12%，转速 +8%', maxLvl: 2, mod: { radius: 0.12, spin: 0.08 } }
    ],
    mortar: [
      { id: 'blast', name: '扩爆装药', desc: '爆炸半径 +16%', maxLvl: 3, mod: { radius: 0.16 } },
      { id: 'power', name: '串联战斗部', desc: '伤害 +16%', maxLvl: 3, mod: { dmg: 0.16 } },
      { id: 'shard', name: '破片弹', desc: '爆炸后甩出致命碎片', maxLvl: 2, mod: { dmg: 0.05 }, special: 'shard' }
    ],
    railgun: [
      { id: 'power', name: '电容阵列', desc: '伤害 +20%', maxLvl: 3, mod: { dmg: 0.2 } },
      { id: 'wide', name: '聚焦线圈', desc: '弹道加宽，穿透 +2', maxLvl: 2, mod: { width: 2, pierce: 2 } },
      { id: 'plasma', name: '等离子附着', desc: '贯穿路径上的敌人被点燃', maxLvl: 2, mod: { dmg: 0.05 }, special: 'burn' }
    ],
    /* 诱饵音响没有火力，通用部署模板里的「强化弹头」对它就是废卡，单独给它一套 */
    decoyspeaker: [
      { id: 'dur', name: '长效电池', desc: '诱饵持续时间 +25%', maxLvl: 3, mod: { dur: 0.25 } },
      { id: 'rate', name: '快速循环', desc: '投放间隔 -14%', maxLvl: 3, mod: { cd: -0.14 } },
      { id: 'radius', name: '大喇叭', desc: '吸引半径 +20%', maxLvl: 2, mod: { radius: 0.2 } }
    ],
    /* 战术诱饵同样没有伤害，通用抛掷模板的「加重投掷」对它是废卡 */
    decoy: [
      { id: 'dur', name: '长效电池', desc: '诱饵持续时间 +25%', maxLvl: 3, mod: { dur: 0.25 } },
      { id: 'rate', name: '快速投放', desc: '投放间隔 -12%', maxLvl: 3, mod: { cd: -0.12 } },
      { id: 'radius', name: '广域喇叭', desc: '吸引半径 +20%', maxLvl: 2, mod: { radius: 0.2 } }
    ],
    /* 火焰喷口：通用部署模板的「强化弹头」放在喷火口上很违和，单独给一套 */
    flamenozzle: [
      { id: 'power', name: '加压燃料', desc: '火焰伤害 +18%', maxLvl: 3, mod: { dmg: 0.18 } },
      { id: 'rate', name: '快速点火', desc: '喷射间隔 -12%', maxLvl: 3, mod: { cd: -0.12 } },
      { id: 'life', name: '长效燃料罐', desc: '耐久度 +22%', maxLvl: 2, mod: { dur: 0.22 } }
    ],
    /* 自动装填装置本身不开火，它唯一的输出通道是全局攻速 */
    autoloader: [
      { id: 'power', name: '供弹强化', desc: '全局攻速加成 +8%', maxLvl: 3, mod: { atk: 0.08 } },
      { id: 'motor', name: '高循环电机', desc: '全局攻速加成 +5%', maxLvl: 2, mod: { atk: 0.05 } },
      { id: 'overclock', name: '过载供弹', desc: '全局攻速加成 +12%（一次性）', maxLvl: 1, mod: { atk: 0.12 } }
    ]
  };

  /** 生成 gearId → { branchId: branch } */
  D.gearUps = {};
  (function buildUps() {
    var id, def, list, i, o, map;
    for (id in D.gear) {
      if (!D.gear.hasOwnProperty(id)) continue;
      def = D.gear[id];
      /* 点名覆盖优先（自动装备也可能有），其次按 kind，再按 evo / mech / fam */
      if (D.gearUpOverride[id]) {
        list = D.gearUpOverride[id];
      } else if (def.slot === 'auto') {
        list = D.autoUps[def.kind] || D.autoUps.follow;
      } else if (def.evo && D.gearUpOverride[def.baseId]) {
        /* 进化形态继承本体那套深度分支，进化之后仍然能继续点 */
        list = D.gearUpOverride[def.baseId];
      } else if (D.upByMech[def.mech]) {
        list = D.upByMech[def.mech];
      } else {
        list = D.upTemplates[def.fam] || D.upTemplates.gun;
      }
      map = {};
      for (i = 0; i < list.length; i++) {
        o = list[i];
        /* 每个分支独立副本，避免不同武器共享 maxLvl 状态 */
        map[o.id] = {
          id: o.id, name: o.name, desc: o.desc,
          maxLvl: o.maxLvl || 3, mod: o.mod || {},
          special: o.special || null
        };
      }
      D.gearUps[id] = map;
    }
  })();

  /* ============================================================
   *  装备联动
   *
   *  req.gear   需要装备（手持或自动）的 id
   *  req.stat   需要通用属性及其等级
   *  effect     判定通过后写进 p.syn 的标记，运行时按标记生效
   * ============================================================ */
  D.synergies = [
    {
      id: 'lmgHeat', name: '枪管过热', icon: 'haste', color: '#ff9f43', rare: true,
      req: { gear: 'lmg', stat: 'crit', statLvl: 2 },
      desc: '轻机枪暴击后 1.2 秒内射速 +35%'
    },
    {
      id: 'xbStack', name: '穿甲箭雨', icon: 'ammo', color: '#dee2e6', rare: true,
      req: { gear: 'crossbow', stat: 'pierce', statLvl: 2 },
      desc: '连弩每穿透一个目标，后续箭矢伤害 +8%（最多 +40%）'
    },
    {
      id: 'rpgCore', name: '聚能装药', icon: 'powder', color: '#ffd166', rare: true,
      req: { gear: 'rpg', stat: 'blast', statLvl: 2 },
      desc: 'RPG 爆炸半径 +25%，中心伤害 +40%'
    },
    {
      id: 'saberQi', name: '剑气共鸣', icon: 'blades', color: '#a8e6ff', rare: true,
      req: { gear: 'saber', stat: 'haste', statLvl: 3 },
      desc: '光剑每命中 8 次，释放一圈剑气'
    },
    {
      id: 'droneMark', name: '协同火力', icon: 'drone', color: '#8ecae6', rare: true,
      req: { gear: 'drone', stat: 'homing', statLvl: 1 },
      desc: '无人机优先攻击被标记的敌人，标记目标受到额外伤害'
    },
    {
      id: 'ringIce', name: '冰火两重天', icon: 'frostring', color: '#9ad0ff', rare: true,
      req: { gear: 'frostring', gear2: 'poisongas' },
      desc: '被冻结的敌人受到的中毒伤害 +40%'
    },
    {
      id: 'shieldWall', name: '铁壁阵线', icon: 'shield', color: '#adb5bd', rare: true,
      req: { gearAny: ['riotshield', 'energyshield', 'shieldaxe'], stat: 'armor', statLvl: 2 },
      desc: '持盾时格挡率额外 +10%，受击后短暂减伤'
    },
    {
      id: 'autoSwarm', name: '集群协议', icon: 'turret', color: '#ffe066', rare: true,
      req: { autoCount: 3 },
      desc: '装备 3 件以上自动装备时，全部伤害 +10%'
    },
    {
      id: 'subSync', name: '双持协同', icon: 'pistol', color: '#ffd166', rare: true,
      req: { stat: 'haste', statLvl: 3, needSub: true },
      desc: '副武器触发间隔 -20%'
    },
    {
      id: 'critBurn', name: '燃点打击', icon: 'critdmg', color: '#ff8fa3', rare: true,
      req: { gearAny: ['firering', 'flamefountain', 'flamer', 'heavyflamer'], stat: 'critdmg', statLvl: 2 },
      desc: '对燃烧 / 冻结目标暴击伤害 +35%'
    },

    /* ---------- 属性组合型：不需要特定的某一件装备 ----------
     * 这类联动是「流派」的主要来源：只要两条通用属性点到位就成立，
     * 所以任何武器组合都能吃到，不会因为没刷到某把枪而整局空转。
     */
    {
      id: 'critRush', name: '暴走', icon: 'haste', color: '#ffd166', rare: true,
      req: { stat: 'crit', statLvl: 2, stat2: 'haste', stat2Lvl: 2 },
      desc: '暴击后 1 秒内攻击间隔 -20%，连续暴击可以一直续'
    },
    {
      id: 'blastMaster', name: '爆破专家', icon: 'powder', color: '#ff9f43', rare: true,
      req: { stat: 'blast', statLvl: 2, fam: 'explosive' },
      desc: '爆炸半径 +12%，中心伤害 +25%（所有爆炸类武器）'
    },
    {
      id: 'closeCombat', name: '近身格斗', icon: 'blades', color: '#c9d1d9', rare: true,
      req: { stat: 'haste', statLvl: 2, fam: 'melee' },
      desc: '近战伤害 +18%，挥砍范围 +10%'
    },
    {
      id: 'ironWall', name: '钢铁意志', icon: 'armor', color: '#adb5bd', rare: true,
      req: { stat: 'armor', statLvl: 2, stat2: 'vigor', stat2Lvl: 2 },
      desc: '生命低于 35% 时受到的伤害 -25%'
    },
    {
      id: 'dualWield', name: '双持精通', icon: 'pistol', color: '#8ecae6', rare: true,
      req: { stat: 'projCount', statLvl: 1, needSub: true },
      desc: '副武器伤害 +20%'
    },
    {
      id: 'scavenger', name: '拾荒专家', icon: 'luck', color: '#e9c46a', rare: true,
      req: { stat: 'greed', statLvl: 1, stat2: 'magnet', stat2Lvl: 1 },
      desc: '经验获取 +12%，金币获取 +15%'
    }
  ];
})();
