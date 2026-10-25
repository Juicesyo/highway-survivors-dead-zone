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
      /* 长刃类（光剑无人环）的终形态要把刃身也拉长 */
      if (def.full.blade) st.blade = def.full.blade;
      if (def.full.ball) st.ball = def.full.ball;
      if (def.full.pulse) st.pulse = def.full.pulse;
      if (def.full.pulseMax) st.pulseMax = def.full.pulseMax;
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
    }
    /* 转管预热：本体带 spinup 字段，进化形态用 flag 继承，两处都要认 */
    if (def.spinup || (def.flags && def.flags.spinup)) st.spinup = 1;

    /* 行为分支 → 弹道字段：这些都是"点了真的会变"的分支，
       以前只写进 st.sp 没人读，等于白点 */
    if (st.sp) {
      if (st.sp.homing) st.homing = 1;
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

    /* 夜图射程惩罚对近战减半：枪在黑夜里要瞄准，刀贴身挥不用瞄 ——
       别让近战在夜图双倍难受（惩罚 -32% 时近战只吃 -16%） */
    if (fam === 'melee') {
      st.range *= 1 + (p.rangeMul - 1) * 0.5;
    } else {
      st.range *= p.rangeMul;
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
      st.count += p.projCount;
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
      st.targets = (st.targets || 1) + p.pierce + p.projCount;
      st.echo = (st.echo || 0) + p.split;
      if (p.bounce) st.arc *= 1 + p.bounce * 0.08;
      if (p.homing) st.dmg *= 1.08;
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
    if (p.veh) return;                 // 驾驶中：手持武器全部收起

    /* 「暴走」联动：暴击后短时间全面加速，装填时统一折算 */
    var rate = 1;
    if (p.rateT > 0) rate *= 1 + (p.rateMul || 0.2);

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
         这里**故意不乘 rate** —— 攻速、暴走、过热加速对它全部无效，
         这是它换取"永远不断火"的代价。 */
      if (def.sustainBeam) {
        w.timer -= dt;
        if (w.timer <= 0) {
          w.timer = def.base.cd || 0.08;
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
        /* 枪管过热是临时状态，不能写进缓存数值里，只能在装填时折算 */
        var cdNow = st.cd;
        if (p.heatT > 0 && p.heatGear) cdNow *= 0.65;
        if (w.spin) cdNow *= 1 - 0.4 * w.spin;
        cdNow /= rate;
        w.timer = Math.max(0.04, cdNow);
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
    var ang, i, n, a, mul = shotMul(w, st);
    var art = MECH_ART[mech] || 'gun';
    w.fireAt = Game.run.t;

    /* 连锁闪电按"开火次数"蓄能：一次齐射/一次挥砍只算一次，持续光束不算 */
    if (!def.sustainBeam && HS.Game.chargeChain) HS.Game.chargeChain(st, mul, def);

    switch (mech) {
      case 'bullet': {
        var t = Game.nearest(p.x, p.y, st.range);
        ang = t ? Math.atan2(t.y - p.y, t.x - p.x) : restAngle(p);
        n = Math.max(1, Math.round(st.count));
        var speed = (st.speed || 320) * p.projSpeedMul;
        for (i = 0; i < n; i++) {
          a = ang + (n > 1 ? (i - (n - 1) / 2) * (st.spread || 0.06) : U.rand(-st.spread, st.spread));
          Game.shoot(p.x, p.y - 3, a, {
            dmg: st.dmg * mul, speed: speed, life: st.range / speed,
            r: st.r || 1.9, pierce: st.pierce | 0, color: def.color,
            split: st.split | 0, bounce: st.bounce | 0,
            homing: st.homing | 0, effect: hitFx(def, st),
            pullStop: def.pullStop, pullK: def.pullK,
            radius: def.base.radius || 0, tag: def.fam
          });
        }
        /* 按武器本人的 art 选音色：手枪脆、左轮沉、冲锋枪密、飞刀是破风声。
           高射速下抽 1/4 不发声，避免糊成一片白噪音 */
        if (Math.random() < 0.75) HS.Audio.weapon(def.art);
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
        if (!def.sustainBeam) HS.Audio.weapon(def.art);
        else if (Game.run.t - (p._beamSfxT || -9) > 0.16) {
          p._beamSfxT = Game.run.t;
          HS.Audio.weapon(def.art);
        }
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
        Gear.swing(p, ang, st, def, mul);
        HS.Audio.weapon('drill');
        break;
      }
      case 'boomerang': {
        ang = aimAt(p, st.range + 10);
        for (i = 0; i < Math.max(1, Math.round(st.count)); i++) {
          Game.shoot(p.x, p.y - 3, ang + i * 0.2 - (st.count > 1 ? 0.1 : 0), {
            dmg: st.dmg * mul, speed: st.speed || 260, life: st.range / (st.speed || 260) * 2,
            r: 2.6, pierce: st.pierce | 0, color: def.color,
            homing: st.homing | 0,
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
        Gear.flame(p, ang, st, def, continuous, mul);
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

    for (var i = 0; i < list.length && hit < maxT; i++) {
      var e = list[i];
      if (e.dead || !Game.sameLevel(e)) continue;
      var dx = e.x - p.x, dy = e.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > range + e.r) continue;
      if ((dx * cosA + dy * sinA) / d < cosLim) continue;
      Game.hurtEnemy(e, st.dmg * mul, { tag: def.fam,
        electric: def.id === 'voltsaw' || def.id === 'voltsaw_x' || def.id === 'stunbaton' || def.id === 'stunbaton_x' ? 1 : 0 });
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

    /* 持续型近战（链锯 / 钻头）每帧都判定，刀光要节流，不然特效会糊成一片 */
    if (!noSlash && run.fx.length < 200 && run.t - (p._slashT || -1) > 0.07) {
      p._slashT = run.t;
      run.fx.push({
        kind: 'slash', x: p.x, y: p.y - 2, ang: ang, r: range,
        arc: arc, life: 0.16, max: 0.16, color: def.color || '#dfe6ee'
      });
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
      Game.hurtEnemy(e, st.dmg * mul, { tag: def.fam });
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
    var n = Math.max(1, Math.min(4, st.count | 0));
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
      if (e.dead || !Game.sameLevel(e)) continue;
      var dx = e.x - bx, dy = e.y - by;
      var along = dx * cosA + dy * sinA;
      if (along < 0 || along > len) continue;
      var perp = Math.abs(-dx * sinA + dy * cosA);
      if (perp > width + e.r) continue;
      Game.hurtEnemy(e, (st.dmg || 0) * mul, { tag: def.fam, silent: !!quiet,
        electric: def.id === 'railgun' || def.id === 'railgun_x' ? 1 : 0 });
      if (st.sp && st.sp.burn) {
        e.burn = Math.max(e.burn || 0, 1.4);
        e.burnDps = Math.max(e.burnDps || 0, (st.dmg || 0) * mul * 0.3);
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
    if (!noVis) {
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
  Gear.flame = function (p, ang, st, def, continuous, mul) {
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

    for (var tongue = 0; tongue < tongues; tongue++) {
    var tAng = tongues > 1 ? ang + (tongue - (tongues - 1) / 2) * tongueStep : ang;
    var cosA = Math.cos(tAng), sinA = Math.sin(tAng);

    for (var i = 0; i < run.enemies.length; i++) {
      var e = run.enemies[i];
      if (e.dead || !Game.sameLevel(e)) continue;
      var dx = e.x - p.x, dy = e.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > range + e.r) continue;
      if ((dx * cosA + dy * sinA) / d < cosLim) continue;
      /* 不是每一次都报数字，但也不能完全不报 */
      var showNum = ((p._flameHit = (p._flameHit || 0) + 1) % 4) === 0;
      var dmg = st.dmg * mul * tongueMul;
      /* 冷冻射流的身份：先手弱、后手强 —— 已经冻住的目标吃 1.6 倍 */
      if (ice && (e.slow || 0) > 0.25) dmg *= 1.6;
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
        e.burn = Math.max(e.burn || 0, burnT);
        /* 燃烧专精只乘 dot，不乘这一下的直伤 */
        e.burnDps = Math.max(e.burnDps || 0, dmg * 0.5 * (p.burnMul || 1));
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
          if (se === e || se.dead || !Game.sameLevel(se)) continue;
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
            sp.burn = Math.max(sp.burn || 0, burnT);
            sp.burnDps = Math.max(sp.burnDps || 0, dmg * 0.5 * (p.burnMul || 1));
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

    if (run.t - (p._flameSfx || -1) > 0.14) {
      p._flameSfx = run.t;
      if (ice) HS.Audio.frost(); else HS.Audio.flame();
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
    /* 管式发射器（榴弹发射器 / 迫击炮）：从枪口打出去，不是抬手扔出去。
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
          color: '#ff6b35', explode: false, delay: k * 0.08
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
