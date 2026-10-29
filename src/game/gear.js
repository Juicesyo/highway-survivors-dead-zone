/**
 * 手持装备运行时：数值结算 / 槽位 / 攻击机制
 *
 * 设计要点：
 *   1. 数值一律由数据表算出（Gear.stat），运行时不写死任何武器 id；
 *   2. 通用属性按 fam 做兼容换算（穿透 → 近战目标数，分裂 → 爆炸弹体…），
 *      所以不会出现"点了穿透但对近战毫无作用"的废卡；
 *   3. 冷却与攻速分工：短冷却武器吃攻速，长冷却武器吃冷却缩减；
 *   4. 所有机制都走同一个伤害入口 Game.hurtEnemy，暴击 / 联动只需要一处。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;
  var D = HS.Data;
  var Game = HS.Game;
  var Gear = {};

  var ADD_KEYS = {
    count: 1, pierce: 1, chains: 1, targets: 1, width: 1,
    slow: 1, knock: 1, spread: 1, stun: 1, pull: 1, blade: 1
  };

  /* 全局成长系数：武器 5 级的强度曲线集中在这里调，
     不用去改 95 件装备的 g 字段（单项想更陡就在数据里写更大的 g）
     GROW_DMG 从 1.12 压到 1.0：整体输出下调约 4~5%，怪不再秒融化 */
  var GROW_DMG = 1.0;
  var GROW_CD = 1.1;

  /* 基础节奏（攻击间隔 / 单发伤害同步放大）：
     以前 1 级冲锋枪 0.14s 一发、一秒七枪，"攻速 +10%" 只省下 0.014 秒，
     玩家根本看不出射速变化，攻速卡就成了废卡。把整体间隔拉长 14%、
     伤害同步 +14%（DPS 不变）之后，每一级攻速带来的绝对变化才落到眼里。 */
  var BASE_CD = 1.14;

  /* 持续光束（红莲切割者）不吃攻速，但攻速收益不能凭空蒸发 ——
     玩家点了一堆攻速卡，对这把枪一点反馈都没有，只能觉得是废卡。
     这里把"本该多打出来的节奏"按这个比例折成伤害（打六折：转化总有损耗，
     而且它是"永远不断火"，本来就不该等价于同倍率的爆发）。
     1.0 = 完全等价，0 = 完全不给。 */
  var SUSTAIN_ATK2DMG = 0.6;

  var MECH_ART = {
    bullet: 'gun', burst: 'gun', spread: 'gun',
    beam: 'energy', rail: 'energy', chain: 'energy', flame: 'energy',
    melee: 'melee', drill: 'melee', boomerang: 'melee', thrust: 'melee'
  };

  Gear.def = function (id) { return D.gear[id] || null; };

  /** 版本号变化 → 所有缓存的武器数值重算 */
  Gear.touch = function (p) {
    p.statVer = (p.statVer || 0) + 1;
  };

  function applyMod(st, mod) {
    var k, v;
    for (k in mod) {
      if (!mod.hasOwnProperty(k)) continue;
      v = mod[k];
      if (ADD_KEYS[k]) {
        if (st[k] === undefined) st[k] = 0;
        st[k] += v;
      } else if (k === 'dmg' || k === 'dps') {
        st[k] = (st[k] || 0) * (1 + v);
      } else if (st[k] === undefined) {
        st[k] = v;
      } else {
        st[k] = st[k] * (1 + v);
      }
    }
  }

  /* ================= 数值结算 ================= */

  /**
   * 计算一件装备的最终数值（含等级成长、专属分支、通用属性、兼容换算）
   * 结果缓存在 entry._st 上，p.statVer 变化才会重算。
   */
  Gear.stat = function (w, p) {
    var def = D.gear[w.id];
    if (!def) return null;
    if (w._st && w._ver === p.statVer && w._lvl === w.lvl) return w._st;

    var lvl = Math.max(1, Math.min(w.lvl || 1, def.maxLvl || 5));
    var b = def.base, g = def.g || {};
    var n = lvl - 1;
    var st = {}, k;

    for (k in b) {
      if (b.hasOwnProperty(k)) st[k] = b[k];
    }
    if (g.dmg) st.dmg = b.dmg * (1 + g.dmg * GROW_DMG * n);
    if (g.dps && b.dps) st.dps = b.dps * (1 + g.dps * GROW_DMG * n);
    if (g.cd && b.cd) st.cd = b.cd * Math.pow(1 - Math.min(0.16, g.cd * GROW_CD), n);
    /* 挥砍弧度成长：数据里好几件写了 g.arc（大剑 / 镰刀 / 无限目标的横扫类），
       以前这里不读，等于升级只加伤害、扇面一点不变 —— 死字段 */
    if (g.arc && b.arc) st.arc = b.arc * (1 + g.arc * n);
    if (g.count) st.count = b.count + Math.floor(g.count * n + 0.001);
    if (g.pierce) st.pierce = b.pierce + Math.floor(g.pierce * n + 0.001);
    if (g.chains) st.chains = b.chains + Math.floor(g.chains * n + 0.001);
    if (g.targets) st.targets = b.targets + Math.floor(g.targets * n + 0.001);
    if (g.radius) st.radius = b.radius + g.radius * n;
    if (g.range) st.range = b.range * (1 + g.range * n);
    if (g.speed) st.speed = b.speed * (1 + g.speed * n);
    if (g.dur) st.dur = b.dur + g.dur * n;
    if (g.spin) st.spin = b.spin * (1 + g.spin * n);
    if (g.heal) st.heal = b.heal + g.heal * n;
    if (g.slow) st.slow = b.slow + g.slow * n;
    if (g.width) st.width = b.width + g.width * n;
    if (g.blade && b.blade) st.blade = b.blade + g.blade * n;
    /* 挥砍类近战基础范围统一放大 1.3 倍：屏宽 320 的世界里 24~30px 的刀太憋屈。
       回旋刃是投掷物，不吃基础加成但保留默认成长。
       g 里自己写了 range 的（如冲击波发生器）优先用数据。近战默认成长 3.5%/级。 */
    if (!g.range && b.range &&
        (def.mech === 'melee' || def.mech === 'drill' || def.mech === 'boomerang' ||
         def.mech === 'thrust')) {
      st.range = b.range * (def.mech === 'boomerang' ? 1 : 1.3) * (1 + 0.035 * n);
    }
    /* 被动型装备（自动装填装置）没有弹道数值，靠 def.atk 提高全局攻速 */
    if (def.atk) st.atk = def.atk * (1 + 0.3 * n);

    /* 专属分支（只作用在这一把武器上） */
    var ups = D.gearUps[w.id];
    if (ups && w.up) {
      for (k in w.up) {
        if (!w.up.hasOwnProperty(k) || !w.up[k]) continue;
        var br = ups[k];
        if (!br) continue;
        for (var q = 0; q < w.up[k]; q++) applyMod(st, br.mod);
        if (br.special) {
          st.sp = st.sp || {};
          st.sp[br.special] = 1;
        }
      }
    }

    /* 满级终形态：数据里写了 full 的装备，等级拉满后换成"毕业"数值。
       旋转飞刀靠它把刀片补满一圈（10 片 ≈ 390° 覆盖，真正没有缝隙）。
       放在 Gear.global 之前，伤害仍然吃通用属性 */
    if (def.full && lvl >= (def.maxLvl || 5)) {
      if (def.full.count) st.count = def.full.count;
      if (def.full.spin) st.spin = (st.spin || 1) * def.full.spin;
      if (def.full.radius) st.radius = (st.radius || 1) * def.full.radius;
      if (def.full.dmg) st.dmg = (st.dmg || 0) * def.full.dmg;
      /* 长刃类（光剑无人环）的终形态要把刃身也拉长。
         用 max 而不是直接赋值：刃长是"加点还能继续堆"的字段，
         直接赋值会让玩家满级前点过的「加长刃身」在升到 5 级那一刻被吞掉。 */
      if (def.full.blade) st.blade = Math.max(st.blade || 0, def.full.blade);
      if (def.full.ball) st.ball = def.full.ball;
      if (def.full.pulse) st.pulse = def.full.pulse;
      if (def.full.pulseMax) st.pulseMax = def.full.pulseMax;
      /* 过载麻痹：满级跟着过载一起变长（电磁轨道球 0.55 → 0.75 秒） */
      if (def.full.pulseStun) st.pulseStun = def.full.pulseStun;
      /* 环绕体的终形态：电弧球多一条连锁、重力球吸得更狠 */
      if (def.full.chains) st.chains = def.full.chains;
      if (def.full.pull) st.pull = (st.pull || 0) * def.full.pull;
      st.full = 1;
    }

    /* 进化自带的质变开关 */
    if (def.flags) {
      if (def.flags.echo) st.echo = (st.echo || 0) + 1;
      if (def.flags.beam) { st.sp = st.sp || {}; st.sp.beam = 1; }
      if (def.flags.bounce3) st.bounce = (st.bounce || 0) + 3;
      if (def.flags.split) st.split = (st.split || 0) + 2;
      if (def.flags.burn) { st.sp = st.sp || {}; st.sp.burn = 1; }
      if (def.flags.explode) { st.sp = st.sp || {}; st.sp.explode = 1; }
      if (def.flags.pull) { st.sp = st.sp || {}; st.sp.pull = 1; }
      if (def.flags.shock) { st.sp = st.sp || {}; st.sp.shock = 1; }
      if (def.flags.homing) { st.sp = st.sp || {}; st.sp.homing = 1; }
      if (def.flags.shard) st.shard = (st.shard || 0) + 3;
      /* 穿心 / 裂地 / 钻核（见 weapons.js 的 evolutions） */
      if (def.flags.sure) st.sure = 1;
      if (def.flags.ring) st.ring = 1;
      if (def.flags.core) st.core = 1;
    }
    /* 转管预热：本体带 spinup 字段，进化形态用 flag 继承，两处都要认 */
    if (def.spinup || (def.flags && def.flags.spinup)) st.spinup = 1;

    /* 行为分支 → 弹道字段：这些都是"点了真的会变"的分支，
       以前只写进 st.sp 没人读，等于白点 */
    if (st.sp) {
      if (st.sp.homing) st.homing = 1;
      /* 出血（锯齿刃口）：层数上限跟着分支等级走（3/4/5 层），
         等级要带进运行时，所以单独存一份 bleedLv —— st.sp 只存"有没有" */
      if (st.sp.bleed) st.bleedLv = (w.up && w.up.bleed) || 1;
      /* 嗜血：命中回血的等级（上限与比例都跟着它走） */
      if (st.sp.leech) st.leechLv = (w.up && w.up.leech) || 1;
      /* 碎片战斗部（RPG 的第三条分支）：st.sp 只记"有没有"，
         破片数按分支等级给（1 级 2 片 / 2 级 3 片），和进化自带的 3 片同档。
         以前这里没有翻译，special 只写进 st.sp 就没人读了 ——
         卡面写着"爆炸后飞出致命碎片"，点完一颗都不飞。 */
      if (st.sp.shard) st.shard = (st.shard || 0) + 1 + ((w.up && w.up.shard) || 1);
    }

    /* 通用属性 + 兼容换算 */
    Gear.global(st, def, p);

    /* 基础节奏落在"所有加成之后"：阈值判断（短 cd 吃满攻速）仍然按原始
       攻击间隔走，这里只把最终节奏整体放慢一档，不会让武器意外换档。
       只动手持武器 —— 自动装备的 cd 是"触发 / 投放间隔"，DPS 型（毒雾、火环）
       拉长间隔就是纯削弱，不能跟着一起改 */
    if (def.slot !== 'auto') {
      if (st.cd > 0) st.cd *= BASE_CD;
      if (st.dmg > 0) st.dmg *= BASE_CD;
    }

    /* 毒 / 火 / 冰等标签由运行时读 */
    st.fx = def.effect || null;
    /* 元素：flame 类武器靠它决定挂燃烧还是挂减速（Gear.flame） */
    st.elem = def.elem || null;
    w._st = st;
    w._ver = p.statVer;
    w._lvl = w.lvl;
    return st;
  };

  /** 把通用属性折算进这把武器的数值；不兼容的按 fam 转换 */
  Gear.global = function (st, def, p) {
    var fam = def.fam;
    st.dmg *= p.dmgMul;
    if (st.dps) st.dps *= p.dmgMul;

    /* 攻速 / 冷却缩减分工：短冷却吃攻速，长冷却吃冷却 */
    if (st.cd > 0) {
      var fast = st.cd <= 0.25;
      var rate = p.atkMul;
      st.cd /= fast ? rate : (1 + (rate - 1) * 0.5);
      st.cd *= (1 - p.cdr * (fast ? 0.5 : 1));
      if (st.cd < 0.04) st.cd = 0.04;
    }

    /* 射程：近战吃满「攻击范围」的增益，但夜图的射程惩罚只吃一半
       （枪在黑夜里要瞄准，刀贴身挥不用瞄）。
       以前整条 rangeMul 一起打对折 —— 玩家点「攻击范围」时近战只拿到一半收益，
       等于这张卡对近战永远是半价。 */
    if (fam === 'melee') {
      var rb = (p.rangeBoost === undefined ? p.rangeMul : p.rangeBoost);
      var mapR = (p.mapRangeMul === undefined ? 1 : p.mapRangeMul);
      st.range *= rb * (1 + (mapR - 1) * 0.5);
    } else {
      st.range *= p.rangeMul;
    }
    /* 近战的范围增益要按"这把武器怎么打"换成不同形状，不能一律只拉长半径：
         · 扇形挥砍（刀 / 剑 / 斧 / 镰）→ 半径 + 弧角一起长，挥得更远也扫得更开
         · 长矛 / 钻锯（走 thrust 矩形）→ 只涨长度，刃宽由 Gear.thrust 按长度跟算
         · 拳套 / 冲击波（全周型）→ 只涨半径，弧角已经封顶
         · 回旋刃（投掷）→ 只涨投掷距离
       窄刺类（居合 arc 0.12）几乎不涨弧角 —— 它的身份就是一条线。 */
    if (fam === 'melee' && st.arc && st.arc < 2.8 &&
        def.mech !== 'thrust' && def.mech !== 'drill' && def.mech !== 'boomerang') {
      var grow = Math.max(0, (p.rangeBoost === undefined ? p.rangeMul : p.rangeBoost) - 1);
      if (grow > 0) {
        var share = st.arc < 0.5 ? 0.15 : (def.noCap ? 0.55 : 0.35);
        st.arc = Math.min(3.15, st.arc * (1 + grow * share));
      }
    }
    if (st.radius) st.radius *= p.areaMul;
    if (st.dur) st.dur *= p.durMul;

    /* 环绕型：它没有"射程/弹速/冷却"，只有轨道。通用属性按语义折叠过来，
       否则玩家点了「攻击范围」「弹丸数量」「攻速」，环一点变化都没有 —— 全是废卡。 */
    if (def.kind === 'orbit') {
      /* 攻击范围 → 轨道半径（夜图射程惩罚只吃一半，和近战一致） */
      st.radius *= 1 + (p.rangeMul - 1) * 0.5;
      /* 弹丸数量 → 多一个环绕体 */
      st.count += p.projCount;
      /* 攻速 → 转速（打对折，避免攻速流把环绕直接堆成绞肉机） */
      st.spin = (st.spin || 2.4) * (1 + (p.atkMul - 1) * 0.5);
      /* 分裂 / 弹射 → 命中溅射到旁边的敌人（railorb 本来就有 chains，一起叠） */
      st.chains = (st.chains || 0) + p.split + p.bounce;
      /* 穿透 → 长刃类刃身更长；球类改成多连一个目标 */
      if (st.blade) st.blade += p.pierce * 2;
      else st.chains += p.pierce;
      st.targets = (st.targets || 1) + p.pierce + p.projCount;
      return;
    }

    if (fam === 'gun' || fam === 'thrown') {
      st.count += p.projCount;
      st.pierce += p.pierce;
      st.split = (st.split || 0) + p.split;
      st.bounce = (st.bounce || 0) + p.bounce + (def.bounce || 0);
      st.homing = (st.homing || 0) + p.homing;
    } else if (fam === 'energy') {
      if (def.sustainBeam) {
        /* 持续光束永远只有一道（它的身份是"一道不断的光"）。
           「弹丸数量」在它身上折成伤害，否则那张卡对红莲就是废卡。 */
        st.count = 1;
        if (p.projCount) st.dmg *= 1 + p.projCount * 0.25;
      } else {
        st.count += p.projCount;
      }
      st.pierce += p.pierce;
      st.chains = (st.chains || 0) + p.split + p.bounce;
      st.homing = (st.homing || 0) + p.homing;
    } else if (fam === 'explosive') {
      st.count += p.projCount + p.split;
      st.radius *= 1 + p.pierce * 0.06;
      st.shard = (st.shard || 0) + p.pierce;
      st.homing = (st.homing || 0) + p.homing;
    } else if (fam === 'melee') {
      /* 近战：穿透变成额外目标，分裂变成回响斩，弹射变成更大的挥砍弧度 */
      if (def.noCap) {
        /* 不限目标数的横扫类：再往上加目标数是废属性（扇面里的本来就全吃），
           把「穿透 / 弹丸数量」折成弧度和伤害，卡面才不至于变成死卡 */
        var extra = p.pierce + p.projCount;
        if (extra) {
          st.arc *= 1 + extra * 0.05;
          st.dmg *= 1 + extra * 0.06;
        }
      } else {
        st.targets = (st.targets || 1) + p.pierce + p.projCount;
      }
      st.echo = (st.echo || 0) + p.split;
      if (p.bounce) st.arc *= 1 + p.bounce * 0.08;
      if (p.homing) st.dmg *= 1.08;
      /* 血怒：近战自带流血（不用点「锯齿刃口」），命中流血目标再叠 25% */
      if (p.syn && p.syn.bloodRage) st.bleedLv = Math.max(st.bleedLv || 0, 2);
      /* 血肉磨坊（重型链锯进化）：进化自带"撕裂" —— 不用点「锯齿刃口」，
         每一口咬下去都叠流血，这才是"磨坊"该有的样子 */
      if (def.flags && def.flags.rend) st.bleedLv = Math.max(st.bleedLv || 0, 2);
    } else {
      st.targets = (st.targets || 1) + p.pierce + p.projCount;
    }

    /* 喷火类没有"弹道"，穿透折成火舌厚度（扇形角度）：
       以前 pierce 对喷火是纯死字段，点了火焰扇面一点没变 */
    if (def.mech === 'flame') {
      st.arc = (st.arc || 0.5) + p.pierce * 0.05;
    }
    /* 治疗类（注射器）：伤害加成折一半给治疗量，否则纯辅助流点「伤害」完全无效 */
    if (def.mech === 'heal' && st.heal) {
      st.heal *= 1 + (p.dmgMul - 1) * 0.5;
    }

    /* 联动：副武器协同 / 自动装备集群 / 聚能装药 */
    if (def.slot === 'sub' && p.syn && p.syn.subSync && st.cd > 0) st.cd *= 0.8;
    if (def.slot === 'sub' && p.syn && p.syn.dualWield) st.dmg *= 1.2;
    if (p.syn && p.syn.autoSwarm) st.dmg *= 1.1;
    if (p.syn && p.syn.rpgCore && (def.id === 'rpg' || def.id === 'rpg_x' || def.id === 'heavyrpg')) {
      st.radius *= 1.25 + 0.08 * ((p.synLv.rpgCore || 1) - 1);
      st.centerBonus = 1.4 + 0.1 * ((p.synLv.rpgCore || 1) - 1);
    }
    /* 属性组合型联动：爆破专家 / 近身格斗 */
    if (p.syn && p.syn.blastMaster && fam === 'explosive') {
      st.radius *= 1.12;
      st.centerBonus = Math.max(st.centerBonus || 1, 1.25);
    }
    if (p.syn && p.syn.closeCombat && fam === 'melee') {
      st.dmg *= 1.18;
      st.range *= 1.1;
    }
  };

  /* ================= 槽位 ================= */

  /** 手持或自动装备里找同一件（重复获取时合并升级） */
  Gear.findEntry = function (p, id) {
    var i;
    for (i = 0; i < p.weapons.length; i++) {
      if (p.weapons[i].id === id) return p.weapons[i];
    }
    for (i = 0; i < p.autos.length; i++) {
      if (p.autos[i].id === id) return p.autos[i];
    }
    return null;
  };

  Gear.slotEntry = function (p, id) {
    for (var i = 0; i < p.weapons.length; i++) {
      if (p.weapons[i].id === id) return p.weapons[i];
    }
    return null;
  };

  Gear.mainEntry = function (p) {
    for (var i = 0; i < p.weapons.length; i++) {
      var w = p.weapons[i];
      if (w.slot === 'main' || w.slot === 'heavy') return w;
    }
    return null;
  };

  Gear.subEntry = function (p) {
    for (var i = 0; i < p.weapons.length; i++) {
      if (p.weapons[i].slot === 'sub') return p.weapons[i];
    }
    return null;
  };

  Gear.heavyEntry = function (p) {
    for (var i = 0; i < p.weapons.length; i++) {
      if (p.weapons[i].slot === 'heavy') return p.weapons[i];
    }
    return null;
  };

  Gear.clearHands = function (p) {
    p.weapons.length = 0;
    p.block = 0;
    /* 换手就当作"重新点喷"：不清的话，换上一把喷火枪后第一段会是维持音，
       少了那声起燃的爆点，武器会显得"没点着" */
    p._flameFireT = -9;
    p._flameSfx = -9;
    /* 卸枪 = 光灭了：常驻嗡鸣立刻收掉（否则要等 0.45s 的看门狗） */
    HS.Audio.beamOff();
  };

  /**
   * 能否再拿一件（不包括等级提升）
   * 返回 { ok, reason, merge }
   */
  Gear.canTake = function (p, id) {
    var def = D.gear[id];
    if (!def) return { ok: false, reason: 'unknown' };
    var has = Gear.findEntry(p, id);
    if (has) {
      if (has.lvl >= def.maxLvl) return { ok: false, reason: 'maxed' };
      return { ok: true, merge: true };
    }
    if (def.slot === 'auto') {
      var cap = D.autoCaps[def.kind] || 3;
      var count = 0;
      for (var i = 0; i < p.autos.length; i++) {
        var ad = D.gear[p.autos[i].id];
        if (ad && ad.kind === def.kind) count++;
      }
      if (count >= cap) return { ok: false, reason: 'cap' };
      return { ok: true, merge: false };
    }
    if (def.slot === 'heavy') {
      if (p.weapons.length === 0) return { ok: true };
      return { ok: false, reason: 'hands' };
    }
    /* 重型已经占满两个手持槽，主 / 副都塞不进去 */
    if (Gear.heavyEntry(p)) return { ok: false, reason: 'heavy' };
    if (def.slot === 'main') {
      var m = Gear.mainEntry(p);
      if (!m) return { ok: true };
      return { ok: false, reason: 'mainBusy' };
    }
    var s = Gear.subEntry(p);
    if (!s) return { ok: true };
    return { ok: false, reason: 'subBusy' };
  };

  /**
   * 升级卡用的"可以换装"判定：
   * 槽位被占时允许替换（肉鸽里必须能换武器），但直接 take 仍然严格。
   */
  Gear.canSwap = function (p, id) {
    var def = D.gear[id];
    if (!def) return { ok: false };
    if (Gear.findEntry(p, id)) return Gear.canTake(p, id);
    if (def.slot === 'auto') return Gear.canTake(p, id);
    if (def.slot === 'heavy') return { ok: p.weapons.length <= 1 };
    return { ok: true };
  };

  /** 装备（或合并升级）。返回实际发生的动作 */
  Gear.take = function (p, id) {
    var def = D.gear[id];
    if (!def) return 'none';
    var has = Gear.findEntry(p, id);
    if (has) {
      if (has.lvl >= def.maxLvl) return 'none';
      has.lvl++;
      Gear.refresh(p);
      return 'level';
    }
    var can = Gear.canTake(p, id);
    if (!can.ok) return 'none';

    if (def.slot === 'auto') {
      p.autos.push({ id: id, lvl: 1, timer: 0.35, up: {}, ang: Math.random() * U.TAU, uid: (Gear._uid = (Gear._uid || 0) + 1) });
      Gear.refresh(p);
      return 'new';
    }
    if (def.slot === 'heavy') {
      p.weapons.length = 0;
      p.weapons.push({ id: id, lvl: 1, timer: 0.2, up: {}, slot: 'heavy' });
    } else {
      p.weapons.push({ id: id, lvl: 1, timer: def.slot === 'sub' ? 0.6 : 0.2, up: {}, slot: def.slot });
    }
    Gear.refresh(p);
    return 'new';
  };

  /** 重算格挡 / 移动惩罚等"装备态"属性 */
  Gear.refresh = function (p) {
    var i, def;
    var block = 0, move = 1, atk = 0;
    for (i = 0; i < p.weapons.length; i++) {
      def = D.gear[p.weapons[i].id];
      if (!def) continue;
      if (def.block) block = Math.max(block, def.block);
      if (def.move && def.move < move) move = def.move;
      /* 自动装填装置：攻速加成跟着等级与专属分支走（st.atk 里已算好） */
      if (def.atk) {
        var ast = Gear.stat(p.weapons[i], p);
        atk += (ast && ast.atk) || def.atk;
      }
    }
    /* 护盾类自动装备也算格挡；自动装填装置（slot auto）的攻速加成在这里结算 ——
       以前只扫了手持武器，它在 p.autos 里永远吃不到加成，等于白装 */
    for (i = 0; i < p.autos.length; i++) {
      def = D.gear[p.autos[i].id];
      if (!def) continue;
      if (def.id === 'reflectshield') block = Math.max(block, 0.12 + p.autos[i].lvl * 0.03);
      if (def.atk) {
        var ast2 = Gear.stat(p.autos[i], p);
        atk += (ast2 && ast2.atk) || def.atk;
      }
    }
    if (p.syn && p.syn.shieldWall) block += 0.10;
    p.block = Math.min(0.6, block);
    p.heavyMove = move;
    p.atkFromGear = atk;
    /* 联动「枪管过热」只认轻机枪，别让别的枪白吃 */
    p.heatGear = false;
    for (i = 0; i < p.weapons.length; i++) {
      if (p.weapons[i].id === 'lmg' || p.weapons[i].id === 'lmg_x') p.heatGear = true;
    }
    Gear.touch(p);
  };

  /* ================= 联动判定 ================= */

  Gear.hasGear = function (p, id) {
    if (Gear.slotEntry(p, id)) return true;
    for (var i = 0; i < p.autos.length; i++) {
      if (p.autos[i].id === id) return true;
    }
    return false;
  };

  /** 当前构筑里有哪些兼容族（联动按 fam 判定时用） */
  function famSet(p) {
    var out = {}, i, def;
    for (i = 0; i < p.weapons.length; i++) {
      def = D.gear[p.weapons[i].id];
      if (def) out[def.fam] = 1;
    }
    for (i = 0; i < p.autos.length; i++) {
      def = D.gear[p.autos[i].id];
      if (!def) continue;
      if (def.kind === 'ring' || def.kind === 'zone') out.explosive = 1;
      if (def.kind === 'orbit') out.melee = 1;
    }
    return out;
  }
  Gear.famSet = famSet;

  Gear.checkSynergies = function (p) {
    var syn = p.syn || (p.syn = {});
    var out = {};
    var lv = function (id) { return p.passives[id] || 0; };
    var defs = D.synergies;
    var fams = famSet(p);
    for (var i = 0; i < defs.length; i++) {
      var s = defs[i], req = s.req || {}, ok = true;
      if (req.gear && !Gear.hasGear(p, req.gear)) ok = false;
      if (req.gear2 && !Gear.hasGear(p, req.gear2)) ok = false;
      if (req.gearAny) {
        var any = false;
        for (var j = 0; j < req.gearAny.length; j++) {
          if (Gear.hasGear(p, req.gearAny[j])) { any = true; break; }
        }
        if (!any) ok = false;
      }
      /* 第二件"任一即可"（冰火两重天 = 冰霜环 + 火焰环或毒雾）。
         这里才是真正决定 p.syn 的地方 —— 漏了这段，卡会变成"有冰霜环就自动生效"。 */
      if (req.gearAny2) {
        var any2 = false;
        for (var j2 = 0; j2 < req.gearAny2.length; j2++) {
          if (Gear.hasGear(p, req.gearAny2[j2])) { any2 = true; break; }
        }
        if (!any2) ok = false;
      }
      if (req.stat && lv(req.stat) < (req.statLvl || 1)) ok = false;
      if (req.stat2 && lv(req.stat2) < (req.stat2Lvl || 1)) ok = false;
      if (req.fam && !fams[req.fam]) ok = false;
      if (req.needSub && !Gear.subEntry(p)) ok = false;
      if (req.autoCount && p.autos.length < req.autoCount) ok = false;
      if (ok) out[s.id] = 1;
    }
    /* 保留引用对象，避免每帧判断时重建 */
    for (var k in syn) if (syn.hasOwnProperty(k)) delete syn[k];
    for (var k2 in out) if (out.hasOwnProperty(k2)) syn[k2] = 1;
    return out;
  };

  /* ================= 开火 ================= */

  Game.updateWeapons = function (dt) {
    var run = this.run, p = run.p;
    if (p.veh) {                       // 驾驶中：手持武器全部收起
      HS.Audio.beamOff();              // 上了车就掐掉红莲的嗡鸣，不留尾音
      return;
    }

    /* 「暴走」联动：暴击后短时间全面加速，装填时统一折算 */
    var rate = 1;
    if (p.rateT > 0) rate *= 1 + (p.rateMul || 0.2);

    /* 盾牌反震的冷却 / 拳套连打的断连计时 */
    if (p.counterCd > 0) p.counterCd -= dt;
    if (p.comboT > 0) {
      p.comboT -= dt;
      if (p.comboT <= 0) { p.comboT = 0; p.comboN = 0; }
    }
    /* 蓄能指示器每帧先清空，由下面真正在憋的那件武器重新写 */
    p.chargeVis = 0;
    p.chargeKind = '';

    for (var i = 0; i < p.weapons.length; i++) {
      var w = p.weapons[i];
      var def = D.gear[w.id];
      if (!def) continue;
      var st = Gear.stat(w, p);
      if (!st) continue;

      /* 持续型武器的连击层数：停手 0.75s 就断 */
      if (w.streak && run.t - (w.streakT || 0) > 0.75) w.streak = 0;

      /* 转管预热（加特林 / 加特林机枪进化）：一直在打就越来越快，
         停火 0.35 秒后转速回落——这才是"枪管转起来"的手感 */
      if (st.spinup) {
        if (run.t - (w.fireAt || -9) < 0.35) w.spin = Math.min(1, (w.spin || 0) + dt * 1.2);
        else w.spin = Math.max(0, (w.spin || 0) - dt * 0.9);
      } else if (w.spin) {
        w.spin = 0;
      }

      /* 持续光束（红莲切割者）：不走上膛/冷却那套，固定 0.08s 一跳。
         它换来的是"永远不断火"，代价是攻速 / 冷却缩减 / 暴走 / 过热对它全部无效。
         但**这些收益不白扔**：按 SUSTAIN_ATK2DMG 折算成这一跳的伤害。
         倍率用 p 的原始属性算，不拿 st.cd 做比值 —— st.cd 里掺了 BASE_CD 和
         0.04 下限，比值会算歪（曾经直接拿 def.base.cd / st.cd，结果恒小于 1，
         等于一点加成都没有）。 */
      if (def.sustainBeam) {
        /* 常驻光束（红莲切割者 / 熔核过载）：每帧维护一条"一直亮着"的激光状态。
           以前每跳往 run.chains 塞一条 0.12s 的线，12.5Hz 闪下来在画面上就是
           "还在扣扳机"；它的设定是一道不断的光，所以改成常驻状态 + 渲染层直画
           （见 render 的 drawBeamHold）。角度做插值 —— 换目标时是扫过去，不是瞬移。 */
        var isMelt = !!(def.flags && def.flags.melt);
        var bt = Game.nearest(p.x, p.y, st.range);
        /* 射程里没人就**一下都不打**：
           以前这里不判目标，照样每 0.08s 走一次 Gear.fire —— 伤害是 0、
           画面上一道光都没有（render 只画 p.beamHold，没目标就不会续），
           但每隔 0.16s 就有一声"烧"的激光音，连锁闪电也跟着空枪蓄能。
           玩家听到的是"没人也一直在开枪"，和红莲的观感完全对不上。
           计时归零：目标一进射程立刻接上，不用重新起燃。 */
        if (!bt) {
          HS.Audio.beamOff();        // 光灭了，嗡鸣跟着收（0.26s 淡出）
          w.timer = 0;
          continue;
        }
        var want = Math.atan2(bt.y - p.y, bt.x - p.x);
        var hold = p.beamHold;
        /* 断过 0.16 秒（beamHold 已经淡完）才算"重新点亮"：
           这一下补一个点燃的爆点，之后交给常驻嗡鸣，不再一发一发地响 */
        var fresh = !hold || hold.life <= 0;
        if (!hold) hold = p.beamHold = { ang: want, life: 0, max: 0.16 };
        var da = want - hold.ang;
        while (da > Math.PI) da -= U.TAU;
        while (da < -Math.PI) da += U.TAU;
        hold.ang += da * Math.min(1, dt * 20);
        hold.len = st.range;
        hold.w = st.width || 6;
        hold.color = def.color;
        hold.life = hold.max;
        /* 声音跟着光走：一条不断的嗡鸣（audio.js 的 beam），每帧续期；
           起手那一下用一发短的激光音做"点燃" —— 持续音的 0.2s 淡入
           本身没有攻击感，少了这一下会觉得"按下去没打着"。 */
        HS.Audio.beam(isMelt);
        if (fresh) HS.Audio.weapon(isMelt ? 'meltlaser' : def.art);
        w.timer -= dt;
        if (w.timer <= 0) {
          w.timer = def.base.cd || 0.08;
          /* 本该拿到的节奏倍率：攻速全吃（它是短 cd）+ 冷却缩减（短 cd 打五折）
             + 暴走 + 过热 */
          var spd = p.atkMul / Math.max(0.5, 1 - p.cdr * 0.5) * rate;
          if (p.heatT > 0 && p.heatGear) spd *= 1 / 0.65;
          /* 用 chargeMul 这一发一次性倍率通道，不写进 st 缓存 */
          w.chargeMul = 1 + Math.max(0, spd - 1) * SUSTAIN_ATK2DMG;
          Gear.fire(w, def, st, true);
        }
        continue;
      }

      if (def.mech === 'flame' || def.mech === 'drill') {
        /* 持续型：每帧判定，用 cd 累积成 tick */
        w.timer -= dt;
        if (w.timer <= 0) {
          w.timer = Math.max(0.05, st.cd / rate);
          Gear.fire(w, def, st, true);
        }
        continue;
      }
      if (def.mech === 'buff' || def.mech === 'none') continue;

      w.timer -= dt;
      if (w.timer <= 0) {
        /* 蓄力巨炮（湮灭炮）：`chargeTime` 秒蓄满才放一发，蓄力时脚下有一圈收束光环。
           它不吃攻速/冷却（和持续光束同理：蓄力本身就是节奏），
           所以这里直接读 def.chargeTime，不走 st.cd。 */
        if (def.chargeTime) {
          var cNeed = def.chargeTime;
          w.chargeT = Math.min(cNeed, (w.chargeT || 0) + dt);
          p.chargeVis = w.chargeT;
          p.chargeR = 78;
          p.chargeKind = 'rail';
          if (w.chargeT < cNeed) { w.timer = 0; continue; }
          w.chargeT = 0;
          /* 蓄力**就是**这一发的节奏：不再叠加 st.cd，否则 3 秒蓄力 + 3 秒冷却
             变成 6 秒一发，实测 8 秒只能打出 1 发（DPS 直接腰斩）。 */
          w.timer = 0;
          Gear.fire(w, def, st, false);
          continue;
        }
        /* 蓄能型（冲击波发生器）：到点了但圈里没人，就压着不放。
           以前 4 秒到点必震一次，大半次数震在空气里 —— 这是它垫底的主因。
           压着的时候每多等 1 秒下一发 +35%（最多 +140%），碰到人再一把放开 */
        if (def.charge && !Game.nearest(p.x, p.y, (st.range || 60) + 8)) {
          w.hold = Math.min(4, (w.hold || 0) + dt);
          w.timer = 0;
          p.chargeVis = w.hold;
          p.chargeR = st.range || 58;
          continue;
        }
        /* 枪管过热是临时状态，不能写进缓存数值里，只能在装填时折算 */
        var cdNow = st.cd;
        if (p.heatT > 0 && p.heatGear) cdNow *= 0.65;
        if (w.spin) cdNow *= 1 - 0.4 * w.spin;
        cdNow /= rate;
        w.timer = Math.max(0.04, cdNow);
        /* 蓄能倍率只作用于这一发，开完立刻清掉，不能留在 w 上 */
        w.chargeMul = def.charge ? 1 + 0.35 * (w.hold || 0) : 1;
        w.hold = 0;
        Gear.fire(w, def, st, false);
      }
    }
  };

  /**
   * 开火前的一次性倍率：只有「持续绞杀」这种靠连击叠伤的分支会用到。
   * 不能写进 Gear.stat 的缓存里，否则一次开火就会永久抬高伤害。
   * 没有目标就不叠层——空的连击层数只会让玩家误判。
   */
  function shotMul(w, st) {
    if (!st.sp || !st.sp.sustain) return 1;
    var p = Game.run.p;
    if (!Game.nearest(p.x, p.y, (st.range || 150) + 10)) {
      w.streak = 0;
      return 1;
    }
    w.streak = Math.min(12, (w.streak || 0) + 1);
    w.streakT = Game.run.t;
    return 1 + w.streak * 0.045;
  }

  /** 当前瞄准角：有目标用目标方向，否则沿用 aimA / 朝向 */
  function aimAt(p, range) {
    var t = Game.nearest(p.x, p.y, range);
    if (t) return Math.atan2(t.y - p.y, t.x - p.x);
    return p.aimA || (p.facing > 0 ? 0 : Math.PI);
  }

  /** 站住时朝向也决定枪口：避免「面对左边却往右打」 */
  function restAngle(p) {
    return p.aimA || (p.facing > 0 ? 0 : Math.PI);
  }

  /**
   * 每吸到一个目标就甩两滴血，朝玩家飞过去 ——
   * 这是"群体吸血"唯一能被看见的地方：扫五个目标就有五串血往回抽。
   */
  function leechTrail(p, e, n) {
    var run = Game.run;
    if (!run || run.fx.length >= 210) return;
    var dx = p.x - e.x, dy = p.y - e.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var sp = 120;
    for (var i = 0; i < n; i++) {
      var jx = U.rand(-3, 3), jy = U.rand(-4, 2);
      run.fx.push({
        kind: 'p', x: e.x + jx, y: e.y - 2 + jy,
        vx: dx / d * sp + U.rand(-24, 24), vy: dy / d * sp + U.rand(-34, -8),
        life: 0.26, max: 0.26, color: i ? '#a3221e' : '#e0453c', size: 1.5
      });
    }
  }

  /**
   * 嗜血：把这一刀造成伤害的一小部分转成回血。
   * **群体吸血**：扫到几个目标就按几个回（每个目标多吸一份），
   * 但第 n 个目标只按 0.75^(n-1) 折算 —— 一刀扫十个也不会回一管血，
   * "越多越划算、但有边际递减"。
   * 挥砍 / 突刺在 Gear.swing / Gear.thrust 里结算；**飞行类的刃（回旋刃）
   * 走弹体**，由 combat.js 的命中段按同样的衰减结算（见 updateBullets）。
   */
  Gear.leechTrail = leechTrail;   // 弹体那边也要甩这两滴血，导出给 combat.js
  Gear.leech = function (p, n) {
    if (!(n > 0) || p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + n);
    var run = Game.run;
    if (run && run.fx.length < 200 && Math.random() < 0.5) {
      run.fx.push({
        kind: 'p', x: p.x + U.rand(-4, 4), y: p.y + U.rand(-6, 2),
        vx: U.rand(-10, 10), vy: U.rand(-30, -14),
        life: 0.3, max: 0.3, color: '#c8322c', size: 1.5
      });
    }
  };

  /** 弹着效果：进化 / 分支带来的燃烧、爆炸、拖拽、标记 */
  function hitFx(def, st) {
    if (def.onHit === 'pull') return 'pull';
    if (def.flags && def.flags.burn) return 'burn';
    if (def.flags && def.flags.explode) return 'explode';
    if (st.sp && st.sp.burn) return 'burn';
    if (st.sp && st.sp.explode) return 'explode';
    if (st.sp && st.sp.mark) return 'mark';
    return null;
  }

  Gear.fire = function (w, def, st, continuous) {
    var p = Game.run.p;
    var mech = def.mech;
    var ang, i, n, a, mul = shotMul(w, st) * (w.chargeMul || 1);
    w.chargeMul = 1;
    var art = MECH_ART[mech] || 'gun';
    w.fireAt = Game.run.t;

    /* 连锁闪电按"开火次数"蓄能：一次齐射/一次挥砍只算一次。
       **这里对全部武器一视同仁** —— 之前把持续光束（红莲切割者）整个排除在外，
       等于拿了这张卡对它完全无效。真正的限速放在 Game.chargeChain 里：
       不管蓄能多快，两道电弧之间至少隔 CHAIN_GAP 秒，所以高频武器也刷不起来。 */
    if (HS.Game.chargeChain) HS.Game.chargeChain(st, mul, def);

    switch (mech) {
      case 'bullet': {
        var t = Game.nearest(p.x, p.y, st.range);
        ang = t ? Math.atan2(t.y - p.y, t.x - p.x) : restAngle(p);
        var speed = (st.speed || 320) * p.projSpeedMul;
        /* 弹幕墙（重型机枪进化）：**不瞄准**，每发甩出一整圈，相位逐发旋转。
           一圈 10 发、每发只打一个目标（pierce 0），所以单发伤害被抬到 2.6 倍；
           转速（每发转多少度）用黄金角，十几发之内就能把 360° 铺满且不重复。 */
        if (def.flags && def.flags.spiral) {
          /* 一圈多少发由数据给（spiralN）：太少铺不满，太多就变成一堵墙看不出螺旋 */
          n = Math.max(6, Math.round(def.spiralN || 12));
          w.spiralA = (w.spiralA || 0) + 2.39996;
          for (i = 0; i < n; i++) {
            a = w.spiralA + i * U.TAU / n;
            Game.shoot(p.x, p.y - 3, a, {
              dmg: st.dmg * mul, speed: speed, life: st.range / speed,
              r: 2.1, pierce: st.pierce | 0, color: def.color,
              split: st.split | 0, bounce: st.bounce | 0,
              homing: st.homing | 0, effect: hitFx(def, st),
              radius: def.base.radius || 0, tag: def.fam
            });
          }
          HS.Audio.weapon(def.art);
          break;
        }
        n = Math.max(1, Math.round(st.count));
        var bigShot = !!(def.flags && def.flags.bigBullet);
        for (i = 0; i < n; i++) {
          a = ang + (n > 1 ? (i - (n - 1) / 2) * (st.spread || 0.06) : U.rand(-st.spread, st.spread));
          Game.shoot(p.x, p.y - 3, a, {
            dmg: st.dmg * mul, speed: speed, life: st.range / speed,
            /* 转管风暴：弹丸真的变大（判定 + 视觉一起），不是只换个颜色 */
            r: bigShot ? 2.5 : (st.r || 1.9), pierce: st.pierce | 0, color: def.color,
            split: st.split | 0, bounce: st.bounce | 0,
            homing: st.homing | 0, effect: hitFx(def, st),
            pullStop: def.pullStop, pullK: def.pullK,
            /* 攻城弩阵：每支箭命中即炸（穿透也炸，见 combat.js 的弹体命中） */
            boom: (def.flags && def.flags.arrowBoom) ? 30 : 0,
            big: bigShot ? 1 : 0,
            radius: def.base.radius || 0, tag: def.fam
          });
        }
        /* 按武器本人的 art 选音色：手枪脆、左轮沉、冲锋枪密、飞刀是破风声。
           高射速下抽 1/4 不发声，避免糊成一片白噪音 —— 但**慢枪一发都不许抽**：
           狙击 1.45s / 左轮 0.82s / 破城者 1.89s，抽掉一发就是"扣了扳机没声音"，
           玩家只会以为卡了或者空枪。门槛和 Gear.global 的"快枪"判定一致（0.25s）。 */
        if (!(st.cd < 0.25) || Math.random() < 0.75) HS.Audio.weapon(def.art);
        break;
      }
      case 'burst': {
        var tb = Game.nearest(p.x, p.y, st.range);
        ang = tb ? Math.atan2(tb.y - p.y, tb.x - p.x) : restAngle(p);
        n = Math.max(1, Math.round(st.count));
        var spb = (st.speed || 380) * p.projSpeedMul;
        for (i = 0; i < n; i++) {
          Game.shoot(p.x, p.y - 3, ang + U.rand(-st.spread, st.spread), {
            dmg: st.dmg * mul, speed: spb, life: st.range / spb,
            r: 1.9, pierce: st.pierce | 0, color: def.color,
            split: st.split | 0, bounce: st.bounce | 0, homing: st.homing | 0,
            effect: hitFx(def, st), delay: i * 0.055, tag: def.fam
          });
        }
        HS.Audio.weapon(def.art);
        break;
      }
      case 'spread': {
        var ts = Game.nearest(p.x, p.y, st.range);
        ang = ts ? Math.atan2(ts.y - p.y, ts.x - p.x) : restAngle(p);
        n = Math.max(1, Math.round(st.count));
        var sps = (st.speed || 290) * p.projSpeedMul;
        var vol = (def.flags && def.flags.volley2) ? 2 : 1;
        for (var vv = 0; vv < vol; vv++) {
          for (i = 0; i < n; i++) {
            a = ang + (n > 1 ? (i / (n - 1) - 0.5) * st.spread * 2 : 0) + U.rand(-0.03, 0.03) + vv * 0.05;
            Game.shoot(p.x, p.y - 3, a, {
              dmg: st.dmg * mul, speed: sps, life: st.range / sps,
              r: 1.7, color: def.color, pierce: st.pierce | 0,
              split: st.split | 0, effect: hitFx(def, st),
              radius: def.base.radius || 0, tag: def.fam
            });
          }
        }
        HS.Audio.weapon(def.art);
        break;
      }
      case 'chain': {
        var left = Math.max(1, Math.round(st.chains) + p.chainBonus);
        var used = {};
        var strikes = Math.max(1, Math.round(st.count));
        var did = 0;
        for (var s = 0; s < strikes; s++) {
          var start = Game.nearestExcept(p.x, p.y, st.range, used);
          if (!start) break;
          Game.chain(p, start, st.dmg * mul, left, used, def.color, st.sp && st.sp.shock);
          did++;
        }
        if (did) HS.Audio.weapon(def.art);
        break;
      }
      case 'beam':
      case 'rail': {
        ang = aimAt(p, st.range);
        /* 持续光束每秒 12 跳：伤害数字与开火音都得节流，否则糊成一片 */
        var quiet = false;
        if (def.sustainBeam) {
          p._beamN = (p._beamN || 0) + 1;
          quiet = (p._beamN % 6) !== 0;
        }
        Gear.beam(p, ang, st, def, quiet, mul);
        /* 湮灭炮：开火后光柱不立刻消失 —— 交一份"余辉"给渲染层，
           像冲击波一样往外扩着淡出（见 render 的 drawBeamHold）。 */
        if (def.linger) {
          p.beamHold = {
            ang: ang, len: st.range, w: st.width || 8, color: def.color,
            life: def.linger, max: def.linger, rail: 1
          };
        }
        /* 持续光束（红莲 / 熔核）不开火音：它的声音是 updateWeapons 里
           那条常驻嗡鸣（HS.Audio.beam），起手的一下"点燃"也在那边放。
           这里只负责普通光束 —— 一发一道，和开火同帧。 */
        if (!def.sustainBeam) HS.Audio.weapon(def.art);
        break;
      }
      case 'melee': {
        ang = aimAt(p, st.range + 8);
        /* 刀剑是破风、锤斧是闷响、长矛是刺响 —— 出刀这一下就有辨识度 */
        HS.Audio.weapon(def.art);
        var hasQi = !!(st.sp && st.sp.beam);
        /* 有剑气时不画普通刀光，交给下面那道飞出去的月牙 */
        Gear.swing(p, ang, st, def, mul, hasQi);
        if (hasQi) {
          /* 剑气：一道从刀口向外扩张的月牙（0.7 → 2.2 倍近战距离）。
             以前只在原地画一个更大的刀光弧，玩家根本看不出"飞出去"，
             而且和普通挥砍同色，很容易以为这张卡没生效 */
          var run2 = Game.run;
          var waveR = st.range * 2.2;
          var halfArc = Math.min(1.25, (st.arc || 1.1) * 0.6);
          if (run2.fx.length < 220) {
            run2.fx.push({
              kind: 'wave', x: p.x, y: p.y - 2, ang: ang,
              r0: st.range * 0.7, r1: waveR, arc: halfArc,
              life: 0.22, max: 0.22, color: def.color || '#a8e6ff'
            });
            /* 沿出刀方向甩几颗碎光，读起来才像"剑气离体" */
            for (var qi = 0; qi < 4; qi++) {
              var qa = ang + U.rand(-halfArc * 0.7, halfArc * 0.7);
              var qd = U.rand(st.range * 0.5, waveR * 0.9);
              run2.fx.push({
                kind: 'p', x: p.x + Math.cos(qa) * qd, y: p.y - 2 + Math.sin(qa) * qd,
                vx: Math.cos(qa) * U.rand(30, 70), vy: Math.sin(qa) * U.rand(30, 70),
                life: 0.2, max: 0.2, color: def.color || '#a8e6ff', size: 1.6
              });
            }
          }
          HS.Audio.qi();
          Gear.beam(p, ang, {
            dmg: st.dmg * 0.55 * mul, range: waveR, pierce: 2,
            width: Math.max(6, st.range * 0.1)
          }, def, true, 1, true);
        }
        break;
      }
      case 'thrust': {
        ang = aimAt(p, st.range + 8);
        HS.Audio.weapon(def.art);
        var lance = !!(st.sp && st.sp.beam);
        Gear.thrust(p, ang, st, def, mul, false);
        if (lance) {
          /* 枪芒：顺着刺击方向再射一道更长的直线，只打正前方 */
          var lanceR = st.range * 1.8;
          HS.Audio.qi();
          if (Game.run.fx.length < 220) {
            Game.run.fx.push({
              kind: 'thrust', x: p.x, y: p.y - 2, ang: ang,
              len: lanceR, w: Math.max(4, st.range * 0.12),
              life: 0.2, max: 0.2, color: def.color || '#a8e6ff'
            });
          }
          Gear.beam(p, ang, {
            dmg: st.dmg * 0.5 * mul, range: lanceR, pierce: 1,
            width: Math.max(5, st.range * 0.1)
          }, def, true, 1, true);
        }
        break;
      }
      case 'drill': {
        ang = aimAt(p, st.range + 4);
        /* 机械钻头（lance）走矩形贯穿：钻头是"直线钻进去"的东西，
           扇形判定下它站在尸堆里也只打得到一个，"不限目标数"等于没写。
           链锯 / 电锯剑仍是扇形挥砍，不加 lance 就保持原样 */
        if (def.lance) Gear.thrust(p, ang, st, def, mul, false);
        else Gear.swing(p, ang, st, def, mul);
        HS.Audio.weapon('drill');
        break;
      }
      case 'boomerang': {
        ang = aimAt(p, st.range + 10);
        /* 兜底上限：场上最多留 count×3+3 把（正常往返只有两倍左右）。
           回旋刃的寿命是靠"回到手上"结束的，万一以后又有哪条路径回不来，
           一刀一刀攒成几百把会把逐弹逐敌的扫描拖垮（踩过一次：25 秒 90 把） */
        var liveRang = 0;
        for (var bi = 0; bi < Game.run.bullets.length; bi++) {
          if (Game.run.bullets[bi].boomerang) liveRang++;
        }
        var room = Math.max(0, Math.round(st.count) * 3 + 3 - liveRang);
        for (i = 0; i < Math.max(1, Math.round(st.count)) && i < room; i++) {
          Game.shoot(p.x, p.y - 3, ang + i * 0.2 - (st.count > 1 ? 0.1 : 0), {
            dmg: st.dmg * mul, speed: st.speed || 260, life: st.range / (st.speed || 260) * 2,
            r: 2.6, pierce: st.pierce | 0, color: def.color,
            homing: st.homing | 0,
            /* 回旋刃是"掷出去的刃"，出血同样成立，走弹道的命中特效派发 */
            effect: st.bleedLv ? 'bleed' : null, bleedLv: st.bleedLv || 0,
            /* 嗜血也必须跟着弹体走：只写在 st 里没用 —— 刀打中人一滴血不回，
               玩家点了嗜血完全没感觉（和当年 shard 漏抄同一类坑） */
            leechLv: st.leechLv || 0,
            boomerang: 1, tag: 'melee'
          });
        }
        HS.Audio.weapon('knife');
        break;
      }
      case 'lob': {
        Gear.throwAt(p, st, def, mul);
        break;
      }
      case 'missile': {
        ang = aimAt(p, st.range);
        var n2 = Math.max(1, Math.round(st.count));
        for (i = 0; i < n2; i++) {
          Game.shoot(p.x, p.y - 4, ang + (n2 > 1 ? (i - (n2 - 1) / 2) * 0.16 : 0), {
            dmg: st.dmg * mul, speed: st.speed || 200, life: st.range / (st.speed || 200),
            r: 2.6, color: def.color, kind: 'rocket',
            explode: 1, radius: st.radius, homing: 2,
            centerBonus: st.centerBonus || 0, shard: st.shard | 0,
            split: st.split | 0, tag: 'explosive'
          });
        }
        HS.Audio.weapon('launcher');
        break;
      }
      case 'flame': {
        ang = aimAt(p, st.range);
        Gear.flame(p, ang, st, def, continuous, mul, w);
        break;
      }
      case 'heal': {
        if (p.hp < p.maxHp) {
          p.hp = Math.min(p.maxHp, p.hp + p.maxHp * (st.heal || 0.15));
          Game.bannerShow('治疗 +' + Math.round((st.heal || 0.15) * 100) + '%', 1.2);
          HS.Audio.pickup();
        }
        break;
      }
      default:
        break;
    }
  };

  /** 近战挥砍：扇形内最多 targets 个目标 */
  /**
   * 刃返（稀有卡）：挥砍 / 突刺时击落范围内的敌方子弹。
   *
   * 这一手以前是近战**默认自带**的 —— 等于刀客天生免疫远程，
   * 匪徒和呕酸尸对近战就失去了全部压迫感。现在收进一张稀有卡里：
   * 想要"用身法换安全"，得先付一次升级。
   *
   * 只有真的扫到弹才给反馈（一圈冷白冲击环 + 金属声）：
   * 空挥也闪的话，玩家会误以为这卡一直在生效。
   */
  Gear.sweep = function (p, r) {
    var n = Game.sweepBullets(p, r);
    if (!n) return 0;
    var run = Game.run;
    if (run && run.fx.length < 200) {
      run.fx.push({
        kind: 'ring', x: p.x, y: p.y - 2, r: r * 0.3, max: r,
        life: 0.15, maxLife: 0.15, color: '#cfe9ff'
      });
    }
    if (run && run.t - (p._sweepSfxT || -1) > 0.12) {
      p._sweepSfxT = run.t;
      HS.Audio.zap();
    }
    return n;
  };

  Gear.swing = function (p, ang, st, def, mul, noSlash) {
    var run = Game.run;
    mul = mul || 1;
    var arc = st.arc || 1.1;
    var range = st.range || 30;
    var maxT = Math.max(1, (st.targets | 0));
    var hit = 0;
    var list = run.enemies;
    var cosA = Math.cos(ang), sinA = Math.sin(ang);
    var cosLim = Math.cos(arc / 2);
    /* 近战清弹改成稀有卡「刃返」（见 passives.js）——
       白送的话等于近战天生免疫远程，匪徒/呕酸尸对刀客就没威胁了。
       Lv1 扫身边一圈，Lv2 范围更大。 */
    if (p.bladeGuard) Gear.sweep(p, range + (p.bladeGuard >= 2 ? 26 : 10));
    /* 嗜血：这一刀的回血量先攒着，挥完再按上限结算 */
    var leechAcc = 0;
    /* 连打（拳套）：只要一直打得到人就越打越重，最多 5 层 × 8%。
       换武器、打空、或者 1.5 秒没命中都会清零 —— 它是"节奏"，不是永久加成 */
    var cmb = 1;
    if (def.combo) {
      if (p.comboId !== def.id) { p.comboId = def.id; p.comboN = 0; p.comboT = 0; }
      cmb = 1 + 0.08 * Math.min(5, p.comboN || 0);
    }

    for (var i = 0; i < list.length && hit < maxT; i++) {
      var e = list[i];
      if (e.dead || !Game.sameLevel(e)) continue;
      var dx = e.x - p.x, dy = e.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > range + e.r) continue;
      if ((dx * cosA + dy * sinA) / d < cosLim) continue;
      /* 穿心：同一目标连中 3 下，第 4 下必暴 */
      var sureCrit = 0;
      if (st.sure) {
        if (e.uid === p.sureUid) p.sureN = (p.sureN || 0) + 1;
        else { p.sureUid = e.uid; p.sureN = 1; }
        if (p.sureN >= 4) { sureCrit = 1; p.sureN = 0; }
      }
      if (st.leechLv) {
        leechAcc += st.dmg * mul * cmb * 0.018 * st.leechLv * Math.pow(0.75, hit);
        leechTrail(p, e, 2);
      }
      Game.hurtEnemy(e, st.dmg * mul * cmb, { tag: def.fam, forceCrit: sureCrit,
        /* 破甲：机械钻头这类"护甲形同虚设"的武器真的削护甲，
           以前只在数据里写了个没人读的 pierce（见 weapons.js 的注释） */
        pen: def.pen || 0,
        electric: def.id === 'voltsaw' || def.id === 'voltsaw_x' || def.id === 'stunbaton' || def.id === 'stunbaton_x' ? 1 : 0 });
      /* 锯齿刃口：带刃冷兵器命中叠一层流血（见 combat.js 的 Game.bleed） */
      if (st.bleedLv) Game.bleed(e, st.dmg * mul * cmb, st.bleedLv);
      if (st.stun) e.stun = Math.max(e.stun || 0, st.stun);
      if (st.knock) {
        e.x += dx / d * st.knock;
        e.y += dy / d * st.knock;
      }
      if (def.onHit === 'pull') {
        e.x = p.x + cosA * range * 0.7;
        e.y = p.y + sinA * range * 0.7;
      }
      if (def.onHit === 'shock' || (st.sp && st.sp.shock)) {
        Game.explode(e.x, e.y, 22 + (st.radius || 0), st.dmg * 0.35 * mul, def.color);
      }
      if (st.echo) {
        Game.hurtEnemy(e, st.dmg * 0.5 * st.echo * mul, { tag: def.fam });
      }
      if (p.syn && p.syn.saberQi) {
        p.qiHits = (p.qiHits || 0) + 1;
        if (p.qiHits >= 8) {
          p.qiHits = 0;
          Game.explode(p.x, p.y, 46 * p.areaMul, st.dmg * 0.8, '#a8e6ff');
        }
      }
      hit++;
    }

    /* 嗜血结算：群体吸血，已经按目标数衰减过，这里不再封顶 */
    if (leechAcc > 0) Gear.leech(p, leechAcc);
    /* 裂地（机械拳套进化）：冲击环变成真判定，一圈内的敌人都再吃半刀 */
    if (st.ring && hit > 0) {
      Game.explode(p.x, p.y, (range || 30) * 1.25, st.dmg * 0.5 * mul, def.color, { quiet: true });
    }
    /* 钻核（便携钻头进化）：在身前留一个还在转的钻核，持续 2 秒。
       同时最多 6 个 —— 再多了整片地面会糊成一团灰 */
    if (st.core && run.pools.length < 20) {
      var cores = 0;
      for (var ci2 = 0; ci2 < run.pools.length; ci2++) {
        if (run.pools[ci2].core) cores++;
      }
      if (cores < 6) {
        run.pools.push({
          x: p.x + cosA * (range * 0.55), y: p.y + sinA * (range * 0.55),
          r: 22, life: 2, max: 2, dps: st.dmg * 0.8, tick: 0, dead: false,
          core: 1, tag: 'melee'
        });
      }
    }
    if (def.combo) {
      if (hit > 0) {
        p.comboN = Math.min(5, (p.comboN || 0) + 1);
        p.comboT = 1.5;
      }
      /* 打空**不清零**：拳套自带击退，一拳把人打出去就断连的话，
         这套机制等于自己拆自己。断连只由 1.5 秒的计时决定 */
    }

    /* 持续型近战（链锯 / 钻头）每帧都判定，刀光要节流，不然特效会糊成一片 */
    if (!noSlash && run.fx.length < 200 && run.t - (p._slashT || -1) > 0.07) {
      p._slashT = run.t;
      run.fx.push({
        kind: 'slash', x: p.x, y: p.y - 2, ang: ang, r: range,
        arc: arc, life: 0.16, max: 0.16, color: def.color || '#dfe6ee',
        /* 光剑走"能量刃"那一套画法（外晕 + 白芯），别和刀剑共用一条细线 */
        glow: def.art === 'saber' ? 1 : 0
      });
      /* 拳套系：一拳打的是"一整圈冲击"，只画刀光弧会读成"挥了一下刀"。
         额外给一圈外扩的冲击环，和不限目标数的判定对得上 */
      if (def.punch) {
        run.fx.push({
          kind: 'punch', x: p.x, y: p.y - 2, ang: ang,
          r0: range * 0.35, r1: range * (1.15 + 0.05 * (p.comboN || 0)), arc: arc,
          /* 连打层数越高，冲击环越亮越粗 —— 拳头打在身上的"份量"看得见 */
          q: p.comboN || 0,
          life: 0.24, max: 0.24, color: def.color || '#dfe6ee'
        });
      }
    }
    /* 打击音由 hurtEnemy 统一负责（带节流），这里不再重复 */
  };

  /**
   * 直线突刺（长矛）：沿瞄准方向一条窄长矩形，不是扇形。
   * 判定宽度 = 射程 × 0.17 —— 点「加长枪身」时枪身变长、覆盖也跟着变宽，
   * 保持细长枪形；如果只加长度不加宽，玩家会觉得"范围卡点了没反应"。
   */
  Gear.thrust = function (p, ang, st, def, mul, noVis) {
    var run = Game.run;
    var len = st.range || 48;
    var halfW = Math.max(5, len * 0.17);
    /* 突刺同样只靠「刃返」清弹：枪尖扫一排，范围比挥砍长一截 */
    if (p.bladeGuard) Gear.sweep(p, len + (p.bladeGuard >= 2 ? 18 : 6));
    var leechAcc = 0;
    var maxT = Math.max(1, (st.targets | 0));
    var list = run.enemies;
    var cosA = Math.cos(ang), sinA = Math.sin(ang);
    var hit = 0, i;

    for (i = 0; i < list.length && hit < maxT; i++) {
      var e = list[i];
      if (e.dead || !Game.sameLevel(e)) continue;
      var dx = e.x - p.x, dy = e.y - p.y;
      var along = dx * cosA + dy * sinA;
      if (along < -e.r || along > len + e.r) continue;
      var perp = Math.abs(-dx * sinA + dy * cosA);
      if (perp > halfW + e.r) continue;
      if (st.leechLv) {
        leechAcc += st.dmg * mul * 0.018 * st.leechLv * Math.pow(0.75, hit);
        leechTrail(p, e, 2);
      }
      Game.hurtEnemy(e, st.dmg * mul, { tag: def.fam, pen: def.pen || 0 });
      if (st.bleedLv) Game.bleed(e, st.dmg * mul, st.bleedLv);
      /* 机械钻头：钻开的裂口让目标挨打更痛（可叠 3 层） */
      if (def.rift) Game.rift(e);
      if (st.stun) e.stun = Math.max(e.stun || 0, st.stun);
      if (st.knock) {
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        e.x += dx / d * st.knock;
        e.y += dy / d * st.knock;
      }
      if (def.onHit === 'shock' || (st.sp && st.sp.shock)) {
        Game.explode(e.x, e.y, 22 + (st.radius || 0), st.dmg * 0.35 * mul, def.color);
      }
      hit++;
    }

    /* 突刺贯穿一排，同样按目标数衰减 */
    if (leechAcc > 0) Gear.leech(p, leechAcc);
    if (!noVis && run.fx.length < 200) {
      run.fx.push({
        kind: 'thrust', x: p.x, y: p.y - 2, ang: ang,
        len: len, w: halfW, life: 0.14, max: 0.14,
        color: def.color || '#dfe6ee'
      });
    }
    return hit;
  };

  /** 光束 / 轨道炮：沿瞄准线打穿一排 */
  /**
   * 光束 / 轨道炮：st.count 决定一次射出几道，按小角度扇形排开。
   *
   * 以前这里只认真实一道 —— `Gear.global` 早就把「弹丸数量」加进 energy 的
   * st.count 了，但没人读，等于点了没反应。现在多道光束是真实伤害，
   * 「多重光栅」分支和「弹丸数量」属性都通过这条路生效。
   */
  Gear.beam = function (p, ang, st, def, silent, mul, noVis) {
    /* 持续光束永远只有一道：它的卖点是"一直烧着"，不是并排几道。
       多重光栅 / 弹丸数量在它身上折算成伤害（见 Gear.global 的 energy 分支）。 */
    var n = def.sustainBeam ? 1 : Math.max(1, Math.min(4, st.count | 0));
    /* 多道光束走"平行偏移"而不是扇形：扇形在小角度下会糊成一根更粗的线，
       玩家看不出多了几道；平行错开 5px 才是"三根并列的激光"的观感。
       再加一点点扇形，让远端不至于完全重合。 */
    var nxp = -Math.sin(ang), nyp = Math.cos(ang);
    var gap = 5 + (st.spread || 0) * 18;
    for (var bi = 0; bi < n; bi++) {
      var k = bi - (n - 1) / 2;
      Gear.beamOnce(p, ang + k * 0.022, st, def, mul, noVis, nxp * k * gap, nyp * k * gap, silent);
    }
    if (!silent) Game.run.shake = Math.max(Game.run.shake, 2);
  };

  Gear.beamOnce = function (p, ang, st, def, mul, noVis, ox, oy, quiet) {
    var run = Game.run;
    var bx = p.x + (ox || 0), by = p.y + (oy || 0);
    var len = st.range || 200;
    var width = st.width || 6;
    var maxHit = Math.max(1, (st.pierce | 0) + 1);
    var cosA = Math.cos(ang), sinA = Math.sin(ang);
    var hit = 0;
    mul = mul || 1;

    for (var i = 0; i < run.enemies.length && hit < maxHit; i++) {
      var e = run.enemies[i];
      /* 光束也摸不到水面以下的水鬼（它有 st.sp.burn 会点燃，同一类问题） */
      if (e.dead || e.submerged || !Game.sameLevel(e)) continue;
      var dx = e.x - bx, dy = e.y - by;
      var along = dx * cosA + dy * sinA;
      if (along < 0 || along > len) continue;
      var perp = Math.abs(-dx * sinA + dy * cosA);
      if (perp > width + e.r) continue;
      /* 熔核过载（红莲进化）：同一个目标被连续照着会越来越烫。
         每跳 +9%、最多 8 层（+72%），断火 0.5 秒清零（见 combat.js 的 meltT）。
         持续光束 12.5 跳/秒 → 0.64 秒叠满，打 BOSS 时能明显看到数字在涨。 */
      var meltMul = 1;
      if (def.flags && def.flags.melt) {
        if (e.meltT > 0) e.melt = Math.min(8, (e.melt || 0) + 1);
        else e.melt = 1;
        e.meltT = 0.5;
        meltMul = 1 + 0.09 * e.melt;
      }
      Game.hurtEnemy(e, (st.dmg || 0) * mul * meltMul, { tag: def.fam, silent: !!quiet,
        electric: def.id === 'railgun' || def.id === 'railgun_x' ? 1 : 0 });
      /* 等离子炮 / 恒星炮：命中处炸开一小团。
         `radius` 以前是死字段 —— 卡面一直写着"附带小范围爆炸"，实际只有一道直线判定。
         爆炸按这一跳的 45% 结算（带距离衰减）；quiet 掉震动和音效，
         因为这是"光束顺带带出来的爆"，不该每命中一次就震屏一次。 */
      if (st.radius > 0) {
        Game.explode(e.x, e.y, st.radius, (st.dmg || 0) * mul * 0.45, def.color, { quiet: true });
      }
      if (st.sp && st.sp.burn) {
        /* 光束的"点着"要走 ignite：以前各调用点自己乘系数，
           同一张卡在不同武器上强度差三倍，调平衡根本改不动 */
        Game.ignite(e, (st.dmg || 0) * mul * 0.6, 1.8);
      }
      /* 分裂 / 弹射 → 光束折射：从命中点跳一个电弧到旁边最近的敌人。
         光束没有弹丸可以分裂，这是这两个属性对它的落点（0.3s 每敌限一次） */
      if (st.chains && run.t - (e._beamChainT || -9) > 0.3) {
        var ce = null, cdd = 4900;
        for (var ci = 0; ci < run.enemies.length; ci++) {
          var cx = run.enemies[ci];
          if (cx === e || cx.dead || !Game.sameLevel(cx)) continue;
          var cdx = cx.x - e.x, cdy = cx.y - e.y;
          var c2 = cdx * cdx + cdy * cdy;
          if (c2 < cdd) { cdd = c2; ce = cx; }
        }
        if (ce) {
          e._beamChainT = run.t;
          Game.hurtEnemy(ce, (st.dmg || 0) * mul * 0.6, { tag: 'energy', silent: !!quiet });
          if (!noVis) {
            run.chains.push({
              pts: [{ x: e.x, y: e.y - 2 }, { x: ce.x, y: ce.y - 2 }],
              life: 0.09, max: 0.09, color: def.color, straight: 0
            });
          }
        }
      }
      hit++;
    }
    if (!noVis && !def.sustainBeam) {
      run.chains.push({
        pts: [{ x: bx, y: by - 2 }, { x: bx + cosA * len, y: by + sinA * len }],
        life: 0.12, max: 0.12, color: def.color, straight: 1,
        /* 把判定宽度交给渲染 —— 以前这里不带 w，render 恒定画 3px，
           「加宽光栅 / 聚焦线圈 / 裂解光束」在画面上一点变化都没有，
           玩家只会认为加宽卡是废卡 */
        w: width
      });
    }
  };

  /**
   * 火焰喷射：锥形持续伤害 + 点燃。
   *
   * 手感要点（之前只有伤害，没有反馈，看起来像"没在攻击"）：
   *   1. 设 p.fireT，枪口才有枪口焰；
   *   2. 每 tick 撒一小撮粒子，火舌连成一片，不是零星几颗；
   *   3. 每 4 次命中冒一个伤害数字（全 silent 会让玩家以为没打到）；
   *   4. 补一声低频"呼"，0.14s 节流，不然连续喷会糊成噪音。
   */
  Gear.flame = function (p, ang, st, def, continuous, mul, w) {
    var run = Game.run;
    var arc = st.arc || 0.5, range = st.range || 90;
    var cosLim = Math.cos(arc);
    /* 弹丸数量 → 多一道火舌：扇形并排铺开。
       以前 count 对喷火是死字段（Gear.global 照加、Gear.flame 不读），
       点了「弹丸数量」火焰一点变化都没有。 */
    var tongues = Math.max(1, Math.min(3, st.count | 0));
    var tongueStep = 0.2;
    /* 多道火舌按"分火"算：总量只小幅上升（1→1.5→1.8 倍），大头给覆盖面积，
       否则「弹丸数量」对喷火会变成 3 倍 DPS 的纯数值怪 */
    var tongueMul = 1 / (1 + (tongues - 1) * 0.35);
    var burnT = st.dur || 1.4;      // 「缓燃配方」分支加的就是这个
    /* 元素分支：fire 走燃烧 dot，ice 走减速 + 冻结标记（synFrozen 有现成消费方：
       critBurn 暴击加成、ringIce 区域加伤）。没有 elem 的老武器默认 fire，行为不变。 */
    var ice = st.elem === 'ice';
    /* 低温专精：减速幅度直接加，冻结时长按倍率乘 */
    var slowTo = Math.min(0.85, (st.slow || 0.45) + (p.chillAdd || 0));
    var slowFor = burnT * (p.chillTime || 1);
    mul = mul || 1;

    /* 给渲染层留一份锥形参数：火舌/霜雾除了粒子还要画一层明显的光锥 */
    p.flameArc = arc + (tongues - 1) * tongueStep * 0.5;
    p.flameRange = range;
    p.flameElem = ice ? 'ice' : 'fire';
    /* 光锥余辉盖住整条开火间隔，停火后再淡出 */
    p.coneT = Math.max(p.coneT || 0, Math.min(0.34, (st.cd || 0.16) + 0.10));

    p.fireT = 0.07;
    if (p.recoil < 0.3) p.recoil = 0.3;

    /* 炼狱（重型火焰喷射器进化）：烧过的地方会留一片火 ——
       "整条街都在烧"不能只是伤害数字变大。每 0.45 秒在火舌中段滴一摊，
       池子自己会点着踩进去的敌人（见 updateEnemies 的火池段） */
    if (def.flags && def.flags.inferno) {
      w.poolT = (w.poolT || 0) - (st.cd || 0.14);
      if (w.poolT <= 0) {
        w.poolT = 0.45;
        var pd = range * U.rand(0.5, 0.85);
        if (run.pools.length < 14) {
          run.pools.push({
            x: p.x + Math.cos(ang) * pd, y: p.y + Math.sin(ang) * pd,
            r: 26, life: 1.7, max: 1.7, dps: st.dmg * 1.1, tick: 0,
            dead: false, fire: 1
          });
        }
      }
    }

    for (var tongue = 0; tongue < tongues; tongue++) {
    var tAng = tongues > 1 ? ang + (tongue - (tongues - 1) / 2) * tongueStep : ang;
    var cosA = Math.cos(tAng), sinA = Math.sin(tAng);

    for (var i = 0; i < run.enemies.length; i++) {
      var e = run.enemies[i];
      /* 潜渡中的水鬼在水面以下：火舌和霜雾都摸不到（和 hurtEnemy 同一条规则）。
         以前这里只靠 hurtEnemy 拦直伤，点燃 / 减速却照样挂在它身上 ——
         喷它一滴血不掉，一出水却带着火、还是慢的，逻辑上自相矛盾。 */
      if (e.dead || e.submerged || !Game.sameLevel(e)) continue;
      var dx = e.x - p.x, dy = e.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > range + e.r) continue;
      if ((dx * cosA + dy * sinA) / d < cosLim) continue;
      /* 不是每一次都报数字，但也不能完全不报 */
      var showNum = ((p._flameHit = (p._flameHit || 0) + 1) % 4) === 0;
      var dmg = st.dmg * mul * tongueMul;
      /* 冷冻射流的身份：先手弱、后手强 —— 已冻住的目标吃 1.45 倍。
         以前是 1.6，配合高跳数滚成"越喷越痛"，实测单木桩 DPS 54/91（满级），
         比同档武器高出一大截。降直伤之后它该靠**冻住**吃饭，而不是靠这个倍率。 */
      if (ice && (e.slow || 0) > 0.25) dmg *= 1.45;
      /* ignoreArmor：火焰与冰霜天生无视护甲，破甲对它们没用 */
      Game.hurtEnemy(e, dmg, { silent: !showNum, tag: ice ? 'ice' : 'fire', ignoreArmor: 1 });
      if (ice) {
        e.slow = Math.max(e.slow || 0, slowTo);
        e.slowT = Math.max(e.slowT || 0, slowFor);
        e.synFrozen = 1;
        /* 霜火反应：冰系打到正在燃烧的目标 → 蒸汽爆一次并把火扑掉。
           每个目标烧起来只会被引爆一次（清 burn 就是天然限流），
           再加一道 0.12s 全局节流，防止二十只一起炸糊屏 */
        if (p.steamLv > 0 && e.burn > 0 && run.t - (p._steamT || -9) > 0.12) {
          p._steamT = run.t;
          Game.explode(e.x, e.y, 26, Math.max(10, (e.burnDps || 0) * 6 * (0.5 + 0.5 * p.steamLv)),
            '#cfeaff', { quiet: true });
          e.burn = 0;
          e.burnDps = 0;
          HS.Audio.steam();
        }
      } else {
        /* 燃烧 dot 按这一跳直伤的 1.4 倍算（原来 1.2）：直伤调低之后，
           这把枪该让"烧"来干活 —— 挂着火的时候持续输出占比更高，
           而贴脸那一下的直伤不再是它的主要来源。 */
        Game.ignite(e, dmg * 1.4 * (p.burnMul || 1), burnT);
        /* 龙息喷枪烧死的目标会炸开并点燃周围，见 combat.js killEnemy */
        if (def.napalm) e.napalm = 1;
      }
      /* 分裂 / 弹射 → 火舌溅射：把火星甩到旁边一个敌人身上。
         喷火没有弹道可分裂，这是这两个属性对它唯一说得通的落点。
         每个目标 0.45s 只能被溅一次，否则每 tick 连锁会把开销和伤害一起炸开 */
      if (st.chains && run.t - (e._flameSpreadT || -9) > 0.45) {
        var sp = null, sd = 4900;   // 70px 内最近的一个别的目标
        for (var si = 0; si < run.enemies.length; si++) {
          var se = run.enemies[si];
          if (se === e || se.dead || se.submerged || !Game.sameLevel(se)) continue;
          var sdx = se.x - e.x, sdy = se.y - e.y;
          var sdd = sdx * sdx + sdy * sdy;
          if (sdd < sd) { sd = sdd; sp = se; }
        }
        if (sp) {
          e._flameSpreadT = run.t;
          Game.hurtEnemy(sp, dmg * 0.5, { silent: true, tag: ice ? 'ice' : 'fire', ignoreArmor: 1 });
          if (ice) {
            sp.slow = Math.max(sp.slow || 0, slowTo);
            sp.slowT = Math.max(sp.slowT || 0, slowFor);
            sp.synFrozen = 1;
          } else {
            /* 溅射的火星也点得着：伤害减半，燃烧按同一口径给 */
            Game.ignite(sp, dmg * 0.6 * (p.burnMul || 1), burnT);
          }
        }
      }
    }
    }

    /* 火舌 / 霜雾：每 tick 撒几颗，方向和落点都带一点抖动。
       霜雾比火舌多撒一颗、颗粒更大更白 —— 蓝色在夜色街道上本来就压不住，
       靠"亮 + 大"才看得出是一条锥形。 */
    if (run.fx.length < 220) {
      var cnt = ice ? 9 : 6;
      for (var q = 0; q < cnt; q++) {
        var dd = U.rand(3, range * (ice ? 0.96 : 0.92));
        var aa = ang + U.rand(-arc, arc) * 0.9;
        var px = p.x + Math.cos(aa) * dd, py = p.y - 3 + Math.sin(aa) * dd;
        if (ice) {
          run.fx.push({
            kind: 'p', x: px, y: py,
            vx: cosA * U.rand(6, 30) + U.rand(-8, 8),
            vy: sinA * U.rand(6, 30) + U.rand(-8, 6) + 8,
            life: U.rand(0.4, 0.75), max: 0.75,
            color: Math.random() < 0.4 ? '#f2fbff' : (Math.random() < 0.62 ? '#a8dcf2' : '#6cc3e8'),
            size: Math.random() < 0.45 ? 2 : 3.2
          });
        } else {
          run.fx.push({
            kind: 'p', x: px, y: py,
            vx: cosA * U.rand(16, 54) + U.rand(-12, 12),
            vy: sinA * U.rand(16, 54) + U.rand(-14, 2) - 6,
            life: U.rand(0.2, 0.4), max: 0.4,
            color: Math.random() < 0.42 ? '#ffd166' : (Math.random() < 0.62 ? '#ff8b3d' : '#ff4d2a'),
            size: Math.random() < 0.5 ? 2 : 3.2
          });
        }
      }
    }

    /* 喷射音：**按"气流"走，不按开火节奏走**。
       喷火 cd 0.16s，以前每 0.14s 就播一次 0.22s 的音 —— 三段声音永远叠在一起，
       听起来是一团糊，又吵又听不出在喷东西。
       现在 0.36s 补一段：开头那下带"起燃"（停火 0.5s 以上再喷），之后是更暗更轻的维持段。
       单段 0.40s > 间隔 0.36s，所以气流是连着的 —— 间歇地播，听着却是持续的。 */
    /* "新一轮喷射"的判断要看**开火间隔**，不能看音效间隔：
       龙息 cd 0.22、重型喷火 cd 0.5，音效本身 0.36s 一段，
       拿音效间隔当阈值会把每一段都判成起燃（实测就是这样）。
       这里用"距上次开火 > 两个冷却"来识别停火后重新点喷。 */
    var fireGap = run.t - (p._flameFireT || -9);
    p._flameFireT = run.t;
    if (run.t - (p._flameSfx || -9) > 0.36) {
      p._flameSfx = run.t;
      var fresh = fireGap > Math.max(0.35, (st.cd || 0.16) * 2.2);
      if (ice) HS.Audio.frost(fresh); else HS.Audio.flame(fresh);
    }
  };

  /** 投掷类（燃烧瓶 / 手雷 / 战术装备） */
  Gear.throwAt = function (p, st, def, mul) {
    var t = Game.nearest(p.x, p.y, st.range);
    var n = Math.max(1, Math.round(st.count));
    var ex = def.effect || null;
    var dmg = st.dmg * (mul || 1);

    if (ex === 'mines') {
      for (var i = 0; i < n; i++) {
        Game.dropMine(p, dmg, st.radius, def.color);
      }
      HS.Audio.ui();
      return;
    }
    if (ex === 'lure') {
      Game.spawnLure(p.x, p.y, st.dur || 4.5, st.radius || 30);
      HS.Audio.ui();
      return;
    }
    /* 管式发射器（榴弹发射器）：从枪口打出去，不是抬手扔出去。
       以前它们也走 handThrow，角色会做出一整套"投掷"动作 —— 拿着一根发射管
       却像在甩手雷，动作和武器完全对不上。 */
    if (def.tube) {
      var ang0 = t ? Math.atan2(t.y - p.y, t.x - p.x)
        : (p.facing > 0 ? 0 : Math.PI);
      p.aimA = ang0;
      p.recoil = 1;
      p.fireT = 0.07;                       // 枪口焰（drawGun 按 fireT 画）
      var mx = p.x + Math.cos(ang0) * 11;
      var my = p.y - 4 + Math.sin(ang0) * 11;
      for (var tk = 0; tk < n; tk++) {
        var tx0, ty0;
        if (t) {
          tx0 = t.x + U.rand(-8, 8);
          ty0 = t.y + U.rand(-8, 8);
        } else {
          var td = st.range * (0.68 + 0.28 * Math.random());
          var ta = ang0 + U.rand(-0.1, 0.1);
          tx0 = p.x + Math.cos(ta) * td;
          ty0 = p.y + Math.sin(ta) * td;
        }
        Game.lob(mx, my, tx0, ty0, {
          dmg: dmg, radius: st.radius,
          explode: true, color: def.color,
          effect: ex, slow: st.slow, stun: st.stun, dur: st.dur,
          shard: st.shard | 0, effectDur: st.effectDur || 0,
          id: def.id
        });
      }
      /* 炮口烟：管式武器靠"后顿 + 喷烟"读，而不是抬手 */
      if (Game.run.fx.length < 240) {
        Game.run.fx.push({
          kind: 'p', x: mx, y: my,
          vx: Math.cos(ang0) * 52, vy: Math.sin(ang0) * 52,
          life: 0.12, max: 0.12, color: '#ffd9a0', size: 2.4
        });
      }
      HS.Audio.weapon('launcher');
      return;
    }

    /* 烟雾是自保道具：落在自己身前，别丢到敌人堆里 ——
       它的用法是"站进烟里"，远程才打不中你（见 combat.js 的 inSmoke） */
    var selfDrop = ex === 'smoke';
    /* 注意：st.radius 已经在 Gear.global 里乘过 areaMul，这里不能再乘一次 */
    for (var k = 0; k < n; k++) {
      var tx, ty;
      if (selfDrop) {
        tx = p.x + (p.facing > 0 ? 1 : -1) * 16 + U.rand(-3, 3);
        ty = p.y + U.rand(-4, 4);
      } else {
        tx = t ? t.x + U.rand(-10, 10) : p.x + (p.facing > 0 ? 1 : -1) * 100 + U.rand(-12, 12);
        ty = t ? t.y + U.rand(-10, 10) : p.y + U.rand(-16, 16);
      }
      if (def.id === 'molotov') {
        Game.handThrow(p, tx, ty, {
          dmg: dmg, radius: st.radius, dps: st.dps, dur: st.dur,
          color: '#ff6b35', explode: false, delay: k * 0.08,
          /* fire:1 → 火池会点着站在里面的敌人（离开后继续烧） */
          fire: 1, id: def.id
        });
        continue;
      }
      Game.handThrow(p, tx, ty, {
        dmg: dmg, radius: st.radius,
        explode: true, color: def.color, delay: k * 0.07,
        effect: ex, slow: st.slow, stun: st.stun, dur: st.dur,
        shard: st.shard | 0, effectDur: st.effectDur || 0,
        /* 带上 id：落地特效要按投掷物的种类区分（冰环 / 爆闪 / 电弧） */
        id: def.id
      });
    }
    HS.Audio.weapon('launcher');
  };

  /* ================= 初始化 ================= */

  Gear.initRun = function (p, ch) {
    p.statVer = 1;
    p.weapons = [];
    p.autos = [];
    p.syn = {};
    var mainId = ch.weapon || 'pistol';
    var mdef = D.gear[mainId];
    if (mdef) {
      p.weapons.push({
        id: mainId, lvl: 1, timer: 0.3, up: {},
        slot: mdef.slot === 'heavy' ? 'heavy' : 'main'
      });
    }
    if (ch.sub) {
      var sdef = D.gear[ch.sub];
      if (sdef) p.weapons.push({ id: ch.sub, lvl: 1, timer: 0.6, up: {}, slot: 'sub' });
    }
    if (ch.auto) {
      for (var i = 0; i < ch.auto.length; i++) {
        if (!D.gear[ch.auto[i]]) continue;
        p.autos.push({ id: ch.auto[i], lvl: 1, timer: 0.4, up: {}, ang: Math.random() * U.TAU, uid: i + 1 });
        Gear._uid = Math.max(Gear._uid || 0, i + 1);
      }
    }
    Gear.refresh(p);
  };

  HS.Gear = Gear;
})();
