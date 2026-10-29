/**
 * 自动攻击装备数据表
 *
 * 不占用手持槽位，可同时装备多件，但有硬上限：
 *   kind        跟随 follow / 环绕 orbit / 环带 ring / 部署 deploy / 区域 zone / 打击 strike / 辅助 support
 *   base        1 级数值（radius=环绕或作用半径，cd=触发间隔，range=索敌距离）
 *   g           每级成长
 *   maxStack    同一件装备最多叠到几级（重复获取 = 合并升级，不新增实体）
 * 场上实体上限见 D.autoCaps（按 kind 统计），避免装备越多越卡。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  HS.Data = HS.Data || {};
  var D = HS.Data;

  D.gear = D.gear || {};
  D.slotPool = D.slotPool || { main: [], sub: [], heavy: [], auto: [] };

  var BASE = {
    cd: 1, dmg: 8, count: 1, speed: 300, range: 180, radius: 30,
    dps: 0, dur: 0, slow: 0, pierce: 0, chains: 0, heal: 0,
    pull: 0, stun: 0, amp: 0, spin: 2.4, width: 6
  };

  function add(cat, common, list) {
    var i, k, o;
    for (i = 0; i < list.length; i++) {
      o = list[i];
      for (k in common) {
        if (common.hasOwnProperty(k) && o[k] === undefined) o[k] = common[k];
      }
      o.slot = 'auto';
      o.cat = cat;
      o.maxLvl = o.maxLvl || (o.maxStack || 5);
      o.maxStack = o.maxStack || 5;
      o.rarity = o.rarity || 1;
      o.art = o.art || o.icon || 'drone';
      o.icon = (D.iconAlias && D.iconAlias[o.icon || o.art]) || o.icon || o.art;
      o.color = o.color || '#8ecae6';
      o.tags = o.tags || [];
      o.tags.push('auto');
      o.base = o.base || {};
      o.g = o.g || {};
      for (k in BASE) {
        if (o.base[k] === undefined) o.base[k] = BASE[k];
      }
      D.gear[o.id] = o;
      D.slotPool.auto.push(o.id);
    }
  }

  /* ---------------- 跟随型 ---------------- */
  add('跟随型', { kind: 'follow', color: '#8ecae6', rarity: 1, icon: 'drone' }, [
    {
      id: 'drone', name: '战斗无人机', rarity: 2, desc: '绕着你飞，自动点射最近的敌人',
      base: { cd: 0.95, dmg: 8, range: 190, radius: 26, speed: 380 },
      g: { dmg: 0.18, cd: 0.05 }
    },
    {
      id: 'floatinggun', name: '浮游炮', rarity: 3, desc: '轻快的小型浮游枪，射速很高',
      base: { cd: 0.5, dmg: 4.5, range: 170, radius: 30, speed: 400 },
      g: { dmg: 0.16, cd: 0.04 }
    },
    {
      id: 'wingman', name: '导弹僚机', rarity: 4, desc: '发射追踪导弹，命中后小范围爆炸',
      base: { cd: 2.0, dmg: 16, range: 210, radius: 24, speed: 180, width: 22 },
      g: { dmg: 0.2, cd: 0.05, width: 1.1 }
    }
  ]);

  /* ---------------- 环绕型 ---------------- */
  add('环绕型', { kind: 'orbit', color: '#c9d1d9', rarity: 2, icon: 'blades' }, [
    {
      /* 满级质变（full）：刀片补满一圈 + 提速，变成真正的"无死角刀轮"。
         1 级两片、转速 3rad/s 时圈上有大量空档，贴脸丧尸能从缝里钻进来，
         所以这件装备要么堆数量要么靠满级 —— 见 gear.js 的 def.full 结算 */
      id: 'orbitblade', name: '旋转飞刀', rarity: 1,
      desc: '两片刀片贴身环绕，切开贴脸敌人；满级补成无死角刀轮',
      base: { count: 2, radius: 34, dmg: 9, spin: 3.0 },
      g: { dmg: 0.18, count: 1.0, radius: 1.2, spin: 0.05 },
      full: { count: 10, spin: 1.7, dmg: 1.15 }
    },
    {
      /* 电磁球的问题一直是"球是点、接触靠运气"：转速慢、判定半径只有 6px，
         敌人从环上走过去常常整个错过，Lv3 的实测 DPS 和 Lv1 几乎一样。
         现在给它球体判定（ball）+ 周期过载放电（pulse），接触打不到的由电弧补上。
         过载放电同时**麻痹环内一整圈**（pulseStun）——
         以前只有挨到电弧的那 4 个掉血，旁边站着的照常往前挤，看着不像"发电"。 */
      id: 'railorb', name: '电磁轨道球', rarity: 3, color: '#9ef0ff', desc: '高压电球环绕，过载放电电麻环内一圈',
      base: { count: 1, radius: 30, dmg: 13, spin: 2.6, chains: 2, ball: 4, pulse: 2.4, pulseMax: 4, pulseStun: 0.55 },
      g: { dmg: 0.2, radius: 1.4, ball: 0.25 },
      /* 满级裂成两颗，电弧跳到 3 个目标，过载从 4 个目标扩到 6 个、间隔缩到 1.6 秒，
         麻痹也拉长到 0.75 秒（1.6 秒一轮 → 接近一半时间按着贴脸的怪） */
      full: { count: 2, chains: 3, radius: 1.1, dmg: 1.2, ball: 7, pulse: 1.6, pulseMax: 6, pulseStun: 0.75 }
    },
    {
      /* 光剑：判定是"线段"不是"一个点" —— blade 是刃长（px），
         从环上基点到刃尖整段都能切（见 auto.js 的 orbit 线段判定）。
         以前只有 1 片 + 点判定，一圈扫下来一半时间够不着人，所以才显得弱。
         满级 6 把长刃首尾相接，才配得上「无人环」。 */
      id: 'saberring', name: '光剑无人环', rarity: 4, color: '#8ee9ff',
      desc: '悬浮光刃围着身体转，刃身整条都在切',
      base: { count: 3, radius: 42, dmg: 9, spin: 2.6, blade: 16 },
      g: { dmg: 0.18, count: 0.5, radius: 1.2, spin: 0.03, blade: 1.5 },
      full: { count: 6, blade: 26, spin: 1.4, dmg: 1.15 }
    },
    {
      id: 'reflectshield', name: '反弹盾牌', rarity: 3, desc: '盾珠扫中敌方子弹会原路弹回，还能撞开丧尸',
      base: { count: 2, radius: 30, dmg: 6, spin: 2.6 },
      g: { dmg: 0.15, count: 0.4 },
      /* 满级围成一圈盾墙，撞开力度靠接触伤害一起抬 */
      full: { count: 5, radius: 1.12, dmg: 1.3 }
    },
    {
      id: 'gravitysat', name: '重力卫星', rarity: 4, desc: '重力场把敌人往身边拽，还带持续伤害',
      base: { count: 1, radius: 38, dmg: 5, spin: 2.0, pull: 26 },
      g: { dmg: 0.16, pull: 4 },
      /* 满级两颗对转，吸力更狠 */
      full: { count: 2, radius: 1.15, dmg: 1.2, pull: 1.45 }
    }
  ]);

  add('环绕型', { kind: 'ring', color: '#ff8b3d', rarity: 2, icon: 'firering' }, [
    {
      id: 'firering', name: '火焰环', rarity: 3, desc: '一圈持续燃烧的火墙，谁进来烧谁', tags: ['fire'],
      color: '#ff8b3d', icon: 'firering',
      base: { radius: 42, dps: 9, dmg: 4, width: 7 },
      g: { dps: 0.16, radius: 1.4 }
    },
    {
      /* 冰霜环在分组里继承的是火焰环的橙色和图标 —— 两件环在卡面和场上长得一模一样，
         只能靠名字认。这里给它单独的冷蓝 + 冰晶图标，脚下的环也跟着变蓝（见 render 的 ring 分支）。 */
      id: 'frostring', name: '冰霜环', rarity: 3, desc: '冰冷环带减速并冻伤，配暴击非常凶', tags: ['ice'],
      color: '#6fc8ff', icon: 'icerim',
      base: { radius: 46, dps: 5, dmg: 3, slow: 0.35, width: 7 },
      g: { dps: 0.16, radius: 1.3, slow: 0.03 }
    }
  ]);

  /* ---------------- 部署型 ----------------
   * 固定炮台不占手持槽、火力也猛，代价是**耐久度**：
   * 摆空地上能撑很久，丢进尸堆里几秒就被啃烂（见 auto.js 的 WEAR_*）。
   */
  add('部署型', { kind: 'deploy', color: '#ffd166', rarity: 2, icon: 'turret' }, [
    {
      id: 'autoturret', name: '自动炮塔', rarity: 2, desc: '丢在脚边的小炮塔，自动扫射；火力强但有耐久',
      base: { cd: 0.8, dmg: 9, range: 132, dur: 16, speed: 360 },
      g: { dmg: 0.17, cd: 0.04, dur: 0.08 }
    },
    {
      id: 'rocketturret', name: '火箭炮塔', rarity: 3, desc: '慢速发射火箭，落点会炸；打光耐久就报废',
      base: { cd: 2.1, dmg: 34, range: 168, dur: 16, radius: 28, speed: 170 },
      g: { dmg: 0.2, cd: 0.05 }
    },
    {
      id: 'railturret', name: '电磁炮台', rarity: 4, desc: '充能后射出一束贯穿弹道；本体比炮塔脆',
      base: { cd: 1.8, dmg: 32, range: 185, dur: 15, pierce: 4 },
      g: { dmg: 0.2, cd: 0.05, pierce: 0.5 }
    },
    {
      id: 'flamenozzle', name: '火焰喷口', rarity: 2, desc: '贴地喷火，封住一条走廊', tags: ['fire'],
      base: { cd: 0.22, dmg: 6, range: 78, arc: 0.7, dur: 14 },
      g: { dmg: 0.15, cd: 0.03 }
    },
    {
      id: 'autocrossbow', name: '自动弩机', rarity: 3, desc: '小型弩机，一次两矢；架得住才打得久',
      base: { cd: 1.1, dmg: 19, count: 2, range: 155, dur: 18, speed: 420 },
      g: { dmg: 0.18, cd: 0.05 }
    },
    {
      id: 'decoyspeaker', name: '诱饵音响', rarity: 2, desc: '播放录音，把感染者吸引过去（会被啃坏）',
      base: { cd: 6.5, dur: 5, radius: 34, dmg: 0 },
      g: { dur: 0.08, cd: 0.05 }, effect: 'lure'
    }
  ]);

  /* ---------------- 区域与触发型 ---------------- */
  add('区域与触发型', { kind: 'zone', color: '#7ec8a0', rarity: 3, icon: 'gas' }, [
    {
      id: 'poisongas', name: '毒雾发生器', rarity: 2, desc: '在尸群中心释放持续毒雾',
      base: { cd: 5.5, radius: 44, dps: 9, dur: 5, slow: 0.15, range: 190 },
      g: { dps: 0.16, radius: 1.3, dur: 0.05 }, effect: 'poison'
    },
    {
      id: 'flamefountain', name: '火焰喷泉', rarity: 3, color: '#ff8b3d',
      desc: '地面喷出火柱，持续灼烧', tags: ['fire'],
      base: { cd: 4.5, radius: 40, dps: 13, dur: 3, range: 170 },
      g: { dps: 0.16, radius: 1.2, dur: 0.05 }, effect: 'fire'
    },
    {
      id: 'frostgen', name: '冰霜发生器', rarity: 3, color: '#9ad0ff',
      desc: '大范围降温，冻住整片区域', tags: ['ice'],
      base: { cd: 5, radius: 46, dps: 6, dur: 4, slow: 0.45, range: 175 },
      g: { dps: 0.15, radius: 1.3, slow: 0.02 }, effect: 'ice'
    },
    {
      id: 'blackhole', name: '黑洞发生器', rarity: 5, color: '#a06cff',
      desc: '把周围的敌人吸成一团再撕碎',
      base: { cd: 8, radius: 48, dps: 5, dur: 2.5, pull: 46, range: 200 },
      g: { dps: 0.18, radius: 1.3, pull: 6 }, effect: 'gravity'
    }
  ]);

  add('区域与触发型', { kind: 'strike', color: '#b6f5ff', rarity: 3, icon: 'tesla' }, [
    {
      id: 'stormdevice', name: '闪电风暴装置', rarity: 3, desc: '随机雷击最近的几个目标',
      base: { cd: 2.6, count: 2, dmg: 16, radius: 18, range: 200 },
      g: { dmg: 0.18, cd: 0.05, count: 0.4 }, effect: 'zap'
    }
  ]);

  /* ---------------- 生存与成长型 ---------------- */
  add('生存与成长', { kind: 'support', color: '#8ce99a', rarity: 2, icon: 'heal' }, [
    {
      id: 'automed', name: '自动治疗模块', rarity: 2, desc: '定时注射，回复生命',
      base: { cd: 8, heal: 0.12 },
      g: { heal: 0.015, cd: 0.04 }
    },
    {
      id: 'amplifier', name: '增幅器', rarity: 4, desc: '周期性过载，短时间大幅提高伤害',
      base: { cd: 10, amp: 0.22, dur: 5 },
      g: { amp: 0.02, dur: 0.06 }
    }
  ]);

  /** 场上实体 / 装备件数上限（按 kind） */
  D.autoCaps = {
    follow: 3,
    orbit: 4,
    ring: 3,
    deploy: 5,
    zone: 3,
    strike: 2,
    support: 2
  };

  D.autoPool = D.slotPool.auto.slice();

  /** 自动装备的专属升级模板（按 kind 取） */
  D.autoUps = {
    follow: [
      { id: 'rate', name: '伺服加速', desc: '触发间隔 -14%', maxLvl: 3, mod: { cd: -0.14 } },
      { id: 'power', name: '火力校准', desc: '伤害 +18%', maxLvl: 3, mod: { dmg: 0.18 } },
      { id: 'range', name: '广域索敌', desc: '索敌距离 +20%', maxLvl: 2, mod: { range: 0.2 } }
    ],
    orbit: [
      { id: 'speed', name: '高速自旋', desc: '环绕转速 +25%', maxLvl: 3, mod: { spin: 0.25 } },
      { id: 'power', name: '重刃', desc: '接触伤害 +20%', maxLvl: 3, mod: { dmg: 0.2 } },
      { id: 'radius', name: '外扩轨道', desc: '环绕半径 +14%', maxLvl: 2, mod: { radius: 0.14 } },
      /* 以前环绕类没有任何"变多"的途径，一圈就那几个点，覆盖永远不够 —— 这条补上 */
      { id: 'extra', name: '增设环体', desc: '环绕体 +1，扫过的缝隙更小', maxLvl: 2, mod: { count: 1 } }
    ],
    ring: [
      { id: 'power', name: '烈焰核心', desc: '持续伤害 +18%', maxLvl: 3, mod: { dps: 0.18 } },
      { id: 'radius', name: '扩散环', desc: '环半径 +12%', maxLvl: 2, mod: { radius: 0.12 } },
      { id: 'width', name: '厚壁', desc: '环带加厚，判定更宽', maxLvl: 2, mod: { width: 3 } }
    ],
    deploy: [
      { id: 'rate', name: '快速装填', desc: '开火间隔 -12%', maxLvl: 3, mod: { cd: -0.12 } },
      { id: 'power', name: '强化弹头', desc: '伤害 +18%', maxLvl: 3, mod: { dmg: 0.18 } },
      { id: 'life', name: '长效电池', desc: '耐久度 +20%，能架更久', maxLvl: 2, mod: { dur: 0.2 } }
    ],
    zone: [
      { id: 'power', name: '浓缩毒素', desc: '每秒伤害 +18%', maxLvl: 3, mod: { dps: 0.18 } },
      { id: 'radius', name: '扩散喷嘴', desc: '区域半径 +12%', maxLvl: 2, mod: { radius: 0.12 } },
      { id: 'dur', name: '缓释配方', desc: '持续时间 +18%', maxLvl: 2, mod: { dur: 0.18 } }
    ],
    strike: [
      { id: 'power', name: '高压电弧', desc: '雷击伤害 +20%', maxLvl: 3, mod: { dmg: 0.2 } },
      { id: 'rate', name: '云层催化', desc: '触发间隔 -14%', maxLvl: 3, mod: { cd: -0.14 } },
      { id: 'count', name: '多重落雷', desc: '每次 +1 道雷', maxLvl: 2, mod: { count: 1 } }
    ],
    support: [
      { id: 'power', name: '强化剂量', desc: '效果 +20%', maxLvl: 3, mod: { heal: 0.2, amp: 0.2 } },
      { id: 'rate', name: '快速循环', desc: '触发间隔 -14%', maxLvl: 3, mod: { cd: -0.14 } },
      /* 自愈模块吃 heal、增幅器吃 dur —— 两个都给，避免其中一件拿到废分支 */
      { id: 'dur', name: '延长生效', desc: '持续时间 +20%，治疗量 +15%', maxLvl: 2, mod: { dur: 0.2, heal: 0.15 } }
    ]
  };
})();
