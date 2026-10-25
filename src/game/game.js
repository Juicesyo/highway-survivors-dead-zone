/**
 * 游戏主状态机：标题 / 局内 / 升级 / 暂停 / 结算
 * 负责 run 生命周期、经验升级、刷怪导演、局内事件、结算存档
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;
  var P = HS.P;
  var D = HS.Data;

  var RUN_TIME = 360;      // 6 分钟后 Boss 登场
  var MAX_ENEMIES = 120;
  var MAX_WEAPONS = 2;     // 手持槽位：主 + 副（重型一人独占两个）
  var MAX_PASSIVES = 9;    // 通用属性最多 9 条，避免全都要
  var MAX_AUTOS = 9;       // 自动装备件数上限（另有按类型细分的上限）

  /* 无尽模式刷怪表：[类型, 首次出场秒数, 基础权重]
     三张图的专属怪（扑袭者 / 呕酸尸 / 持枪匪徒）在无尽里全都会来，
     只是各自有解锁时间，避免开局就一锅乱炖 */
  var ENDLESS_TYPES = [
    ['walker', 0, 1.15],
    ['runner', 0, 0.60],
    ['crawler', 18, 0.42],
    ['spitter', 50, 0.30],
    ['terrorist', 80, 0.26],
    ['pouncer', 100, 0.30],
    ['vomiter', 130, 0.28],
    ['drowner', 105, 0.34],
    ['brute', 170, 0.38]
  ];

  var Game = {
    state: 'title',
    run: null,
    save: null,
    selChar: 'soldier',
    selMap: 'highway',
    tab: 'char',
    endless: false,
    hits: [],
    t: 0,
    uiT: 0,
    banner: '',
    bannerT: 0,
    noticeText: '',
    noticeT: 0,
    scrollY: 0,
    sfxOn: true,
    bgmOn: true,
    _bgmMenu: null,
    vibOn: true,
    fxLow: false,
    wipeAsk: false,
    confirm: null,     // 副武器替换的二次确认 { i, card }
    lootAsk: null,     // 搜刮翻到的主武器，等玩家点头
    lootFrom: '',

    /* ================= 初始化 ================= */

    init: function () {
      this.save = HS.Save.load();
      this.selChar = this.save.chars[0] || 'soldier';
      if (this.save.unlockedMaps.indexOf(this.selMap) < 0) this.selMap = 'highway';
      this.sfxOn = this.save.sfx !== false;
      this.bgmOn = this.save.bgm !== false;
      this.vibOn = this.save.vib !== false;
      this.fxLow = this.save.fxLow === true;
      HS.Audio.enabled = this.sfxOn;
      HS.Audio.setBgm(this.bgmOn);
      P.vibrateOn = this.vibOn;
      P.fxLow = this.fxLow;
      this.state = 'title';
    },

    notice: function (text, dur) {
      this.noticeText = text;
      this.noticeT = dur || 2.2;
    },

    /**
     * 给掉落物挂一个"短时位置指引"：
     * 世界里有一根信号柱，HUD 上有一个脉冲菱形（屏幕外会贴边变成箭头）。
     * 空投落点有时在建筑背后，光靠地上的小箱子很容易错过。
     */
    hintDrop: function (dr, sec) {
      if (!dr) return dr;
      dr.hintT = sec || 6;
      dr.hintMax = dr.hintT;
      return dr;
    },

    bannerShow: function (text, dur) {
      this.banner = text;
      this.bannerT = dur || 2.4;
    },

    /* ================= 开局 ================= */

    startRun: function (mapId, charId) {
      var d = HS.Save.data;
      var ch = D.chars[charId] || D.chars.soldier;
      var mp = D.maps[mapId] || D.maps.highway;

      var baseHp = ch.hp + (d.perm.hp || 0) * 8;

      var p = {
        x: 0, y: 0, r: 5,
        sprite: 'player_' + ch.id,
        hp: baseHp, maxHp: baseHp,
        base: {
          hp: baseHp,
          speed: ch.speed,
          dmgMul: ch.dmgMul,
          crit: 0.03,
          regen: ch.regen,
          armor: ch.armor || 0
        },
        level: 1, xp: 0, xpNext: 10,
        invuln: 0, facing: 1, anim: 0, hurtT: 0,
        /* 瞄准角（手里的枪按这个角度摆）、枪口焰 / 后坐、待投请求 */
        aimA: 0, fireT: 0, coneT: 0, recoil: 0, throws: [],
        /* 步态：gait 随移动平滑升降（0 站住 / 1 正常走），lean 是身体前倾 */
        gait: 0, lean: 0, dustT: 0,

        /* 装备：手持（主 / 副 / 重型）与自动装备分开存 */
        weapons: [], autos: [],
        passives: {},
        syn: {},              // 已生效的联动
        synLv: {},            // 联动强化等级
        statVer: 1,           // 数值版本号，变了就重算武器缓存

        /* 通用属性结算出的角色数值 */
        dmgMul: 1, atkMul: 1, areaMul: 1, spdMul: 1, rangeMul: 1, durMul: 1,
        crit: 0.03, critMul: 1.6, armor: 0, regen: 0, dodge: 0, lifesteal: 0,
        magnet: 34, luck: 0, xpMul: 1, cdr: 0, projCount: 0,
        pierce: 0, split: 0, bounce: 0, homing: 0,
        block: 0, heavyMove: 1, atkFromGear: 0,
        chainBonus: 0, slowBonus: 0, orbitBonus: 0, projSpeedMul: 1,

        revive: d.perm.revive || 0, goldMul: 1,
        reroll: 2,            // 每局两次重抽：升级抽到全废卡时的安全阀
        mainLocked: false,    // 换过一次主武器之后，升级池不再提供换主武器
        bladeAngle: 0, bladeTick: 0, frostTick: 0,
        ampT: 0, ampMul: 1, heatT: 0, xbT: 0, xbStack: 0, qiHits: 0,
        rateT: 0, rateMul: 0.2,   // 「暴走」联动的临时攻速窗口
        roof: null,
        /* 当前驾驶的载具（null = 步行）；装备加成在这里落成具体数值 */
        veh: null, vehDurMul: 1, vehRamMul: 1, vehWearCut: 1,
        vehHurtCut: 1, ejectCut: 1, invulnBonus: 0, rangedCut: 0
      };

      this.run = {
        t: 0, p: p, map: mp, mapId: mp.id, char: ch, charId: ch.id,
        enemies: [], bullets: [], ebullets: [], gems: [], drops: [],
        pools: [], chains: [], fx: [], texts: [], decals: [],
        devices: [],           // 自动装备部署物 / 地雷 / 诱饵 / 延迟炮击
        kills: 0, eliteKills: 0, evolutions: 0, gold: 0,
        pending: 0, choices: [], choiceT: 0,
        spawnAcc: 0, eliteT: 0, eventT: 46,
        boss: null, bossSpawned: false, bossKilled: false,
        nextBossAt: RUN_TIME, bossCount: 0, endless: !!this.endless,
        search: null, lootTarget: null, lootedCount: 0,
        insideBld: null, enteredHint: false, roofHint: false, roofClimbHint: false,
        stairTarget: null, roofHatch: null, jumpDir: null,
        /* 载具：世界里停着的车 / 已扫过的区块 / 报废计数 */
        vehicles: [], vehSeen: {}, nearVeh: null, vehHint: false, vehDestroyed: 0,
        shake: 0, frenzyT: 0,
        result: null, uiT: 0
      };

      HS.World.reset(mp.theme);
      HS.Water.reset(this.run);

      /* 出生点随机化：世界按坐标确定性生成，换个出生点等于换一片街区。
         街区主题随机挑一个路口中心，荒漠沿公路随机一段；最后 resolve 一次，
         把可能压在废车 / 隔离墩上的位置顶出来。要在 Vehicle.onStart 之前定好，
         开局那辆保障车才会刷在玩家旁边。
         testMode（smoke 等确定性测试）下固定回原点：很多用例按原点摆靶子。 */
      if (this.testMode) {
        p.x = 0;
        p.y = 0;
      } else if (mp.theme === 'desert' || mp.theme === 'flood') {
        p.x = 0;
        p.y = U.randInt(-2, 2) * HS.World.BLOCK + U.rand(-60, 60);
      } else {
        p.x = U.randInt(-3, 3) * HS.World.BLOCK + HS.World.ROAD * 0.5;
        p.y = U.randInt(-3, 3) * HS.World.BLOCK + HS.World.ROAD * 0.5;
      }
      HS.World.resolve(p, p.r, p.x, p.y);
      HS.Water.resolve(p, p.r, p.x, p.y, this.run);

      HS.Vehicle.onStart(this.run);
      this.confirm = null;
      this.lootAsk = null;

      /* 装备初始化：角色自带主武器（部分角色还有副武器 / 自动装备） */
      HS.Gear.initRun(p, ch);

      this.recalc(p);
      p.hp = p.maxHp;
      p.goldMul = (1 + (d.perm.greed || 0) * 0.12) * mp.goldMul * (1 + (p.passives.greed || 0) * 0.10);

      // 记录图鉴
      HS.Save.addSeen('weapons', ch.weapon);

      this.state = 'run';
      this.banner = '';
      this.bannerT = 0;
      /* 开局先讲清楚这张图"不一样的地方"，不然玩家会以为是 bug */
      if (mp.night) {
        this.bannerShow('入夜 · 射程 -' + Math.round((1 - (mp.rangeMul || 1)) * 100) + '% · 当心扑袭者与呕酸尸', 4);
      } else if (mp.gunmen) {
        this.bannerShow('荒漠公路 · 当心路边的枪手', 3.2);
      } else if (mp.water) {
        this.bannerShow('锈水高速 · 浅水减速 / 深水禁行 / 电流敌我皆伤', 4);
      }
      HS.Input.enabled = true;
      HS.Input.reset();
      HS.Audio.resume();
      d.runs++;
      HS.Save.flush();
    },

    /* ================= 属性结算 ================= */

    recalc: function (p) {
      var d = HS.Save.data;
      var lv = function (id) { return p.passives[id] || 0; };
      var oldMax = p.maxHp;

      /* 先把装备态算出来：重型减速、自动装填、格挡率都要用到 */
      HS.Gear.refresh(p);

      /* 体质是固定值，防弹背心是百分比；先加固定值再乘倍率 */
      p.maxHp = Math.max(1, Math.round(
        (p.base.hp + lv('vigor') * 14) * (1 + lv('vest') * 0.12)
      ));
      if (p.hp > 0 && p.maxHp > oldMax) p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - oldMax));

      p.dmgMul = p.base.dmgMul
        * (1 + (d.perm.dmg || 0) * 0.03)
        * (1 + lv('power') * 0.08);

      /* 攻速：持续射击吃满，独立冷却武器只吃一半（在 Gear.global 里分账） */
      p.atkMul = 1 + lv('haste') * 0.10 + (p.atkFromGear || 0);
      p.cdr = Math.min(0.40, lv('cdr') * 0.06);

      p.crit = Math.min(0.60, p.base.crit + lv('crit') * 0.05 + (d.perm.luck || 0) * 0.01);
      p.critMul = 1.6 + lv('critdmg') * 0.15;

      /* 弹道类：具体换算交给每把武器的 fam */
      p.pierce = lv('pierce');
      p.projCount = lv('projCount');
      p.split = lv('split');
      p.bounce = lv('bounce');
      p.homing = lv('homing') > 0 ? 1 : 0;
      /* 连锁闪电：等级决定蓄能间隔与跳数，真实触发在 Gear.fire → Game.chargeChain */
      p.chainLvl = lv('chainbolt');
      if (p.chainN === undefined) p.chainN = 0;

      p.rangeMul = (1 + lv('range') * 0.08) * this.mapRangeMul();
      p.areaMul = 1 + lv('blast') * 0.10;
      p.durMul = 1 + lv('duration') * 0.12;

      /* 元素与针对型属性。这里只算倍率，"谁吃得到"由武器 / 敌人那边决定：
         burnMul 只乘燃烧 dot，chillAdd 只加冰系减速，armorPen 只削实弹护甲 */
      p.armorPen = Math.min(0.60, lv('pierceArmor') * 0.15);
      p.burnMul = 1 + lv('burnDmg') * 0.20;
      p.chillAdd = lv('chill') * 0.06;
      p.chillTime = 1 + lv('chill') * 0.10;
      /* 处决：不再给满血目标加伤，改成"血线以下一命中就斩杀"（见 combat.js） */
      p.execCut = HS.Data.execCut ? HS.Data.execCut(lv('execute')) : 0;
      p.steamLv = lv('steam');

      p.armor = Math.min(8, p.base.armor + lv('armor'));
      p.dodge = Math.min(0.24, lv('dodge') * 0.08);
      p.lifesteal = lv('lifesteal') * 0.6;
      p.regen = p.base.regen + lv('regen') * 0.45;

      p.magnet = 44 * (1 + lv('magnet') * 0.24);
      p.xpMul = (1 + lv('study') * 0.09) * (this.run && this.run.map ? this.run.map.xpMul || 1 : 1);
      p.luck = (d.perm.luck || 0) * 0.08 + lv('luck') * 0.08;
      p.goldMul = (1 + (d.perm.greed || 0) * 0.12) * (this.run && this.run.map ? this.run.map.goldMul : 1) * (1 + lv('greed') * 0.10);

      /* 移动：重型武器会拖慢脚步，这是它的代价之一 */
      p.spdMul = (1 + (d.perm.spd || 0) * 0.03 + lv('swift') * 0.06) * (p.heavyMove || 1);

      p.projSpeedMul = 1;
      p.chainBonus = 0;
      p.slowBonus = 0;
      p.orbitBonus = 0;

      /* 联动：条件满足即生效，升级卡只是把它推得更远 */
      HS.Gear.checkSynergies(p);
      if (p.syn.shieldWall) p.block = Math.min(0.6, (p.block || 0) + 0.10 + 0.03 * ((p.synLv.shieldWall || 1) - 1));
      /* 拾荒专家：属性组合型联动没有"一件装备"做锚点，直接折进成长倍率 */
      if (p.syn.scavenger) {
        p.xpMul *= 1.12;
        p.goldMul *= 1.15;
      }

      /* --- 防护装备 --- */
      p.invulnBonus = lv('helmet') * 0.15;
      p.rangedCut = Math.min(0.6, lv('respirator') * 0.20);
      p.vehDurMul = 1 + lv('plating') * 0.20;
      p.vehRamMul = 1 + lv('ram') * 0.25;
      p.vehWearCut = Math.max(0.35, 1 - lv('ram') * 0.10);
      p.vehHurtCut = Math.max(0.4, 1 - lv('harness') * 0.09);
      p.ejectCut = Math.max(0.1, 1 - lv('harness') * 0.30);
      /* 已经在车上：立刻把装甲上限补上，不用下车再上 */
      if (p.veh) HS.Vehicle.applyGear(p);

      /* 所有武器的缓存数值失效，下一帧按新属性重算 */
      HS.Gear.touch(p);
    },

    xpFor: function (lvl) {
      return Math.floor(3 + 2.0 * lvl + 0.1 * lvl * lvl);
    },

    /**
     * 地图对射程的整体倍率。
     * 夜里看不清远处，枪自然也打不远（map.rangeMul，例如 0.76）；
     * 折进 p.rangeMul 而不是逐件武器改数值，是因为 Gear.global 只认这一个出口，
     * 手持 / 自动装备 / 近战挥砍都会一起缩短。
     */
    mapRangeMul: function () {
      var map = this.run && this.run.map;
      return (map && map.rangeMul) ? map.rangeMul : 1;
    },

    /* ================= 主循环 ================= */

    update: function (dt) {
      this.t += dt;
      this.uiT += dt;
      if (this.bannerT > 0) this.bannerT -= dt;
      if (this.noticeT > 0) this.noticeT -= dt;

      if (this.state === 'run') {
        this.updateRun(dt);
      } else if (this.state === 'levelup') {
        if (this.run) this.run.uiT += dt;
      } else if (this.state === 'result') {
        if (this.run) this.run.uiT += dt;
      }

      var taps = HS.Input.consumeTaps();
      if (taps) this.handleTaps(taps);

      /* 背景音乐只做菜单氛围：标题 / 选图 / 研究所 / 设置。
         进局内、暂停、结算一律停 —— 局内的紧张感交给音效，配乐会和枪声打架 */
      var bgmMenu = this.state === 'title' || this.state === 'mapselect' ||
        this.state === 'meta' || this.state === 'settings' || this.state === 'rank';
      if (bgmMenu !== this._bgmMenu) {
        this._bgmMenu = bgmMenu;
        HS.Audio.setBgmScene(bgmMenu);
      }
    },

    updateRun: function (dt) {
      var run = this.run, p = run.p;
      run.t += dt;
      run.uiT += dt;

      if (run.shake > 0) run.shake = Math.max(0, run.shake - dt * 28);
      if (run.frenzyT > 0) run.frenzyT -= dt;

      /* 搜刮中：不动、不攻击，移动或挨打都会中断 */
      if (run.search) {
        run.search.t += dt;
        if (HS.Input.axis().mag > 0.5) {
          this.cancelSearch('移动中断了搜刮');
        } else if (run.search.t >= run.search.dur) {
          this.finishSearch();
        }
      }

      /* 移动 */
      var ax = run.search ? { dx: 0, dy: 0, mag: 0 } : HS.Input.axis();
      var moving = ax.mag > 0.05;
      var pSpd = p.base.speed * p.spdMul * HS.Water.speed(p, run);
      var px0 = p.x, py0 = p.y;
      if (p.veh) {
        /* 开车：速度、转向、碰撞、碾压都在载具模块里 */
        HS.Vehicle.drive(run, dt, ax);
        p.gait += (0 - p.gait) * Math.min(1, dt * 16);
        p.lean += (0 - p.lean) * Math.min(1, dt * 9);
        p.anim += dt * 1.4;
      } else if (moving) {
        p.x += ax.dx * pSpd * dt;
        p.y += ax.dy * pSpd * dt;
        /* 步频跟着速度走：被减速时会自动变成慢步（约 3.5 步/秒，像在跑而不是小碎步） */
        p.anim += dt * (3.5 + pSpd * 0.12);
        if (Math.abs(ax.dx) > 0.15) p.facing = ax.dx > 0 ? 1 : -1;
      } else {
        p.anim += dt * 1.6;
      }

      if (!p.veh) {
        /* 地面：墙、家具、车、隔离墩、垃圾箱；楼顶：女儿墙与通风口 */
        if (p.roof) HS.Buildings.resolveRoof(p, p.roof);
        else HS.World.resolve(p, p.r, px0, py0);

        /* 步态强度取自「这一帧真正挪动了多少」，而不是「有没有按键」：
           顶着墙、卡在车头时腿会停下，不会原地踏步。
           前倾仍用输入方向，所以贴墙时人是"顶"在墙上的姿态。 */
        var wantP = pSpd * dt;
        var mvxP = p.x - px0, mvyP = p.y - py0;
        var ratioP = wantP > 0.00001 ? Math.sqrt(mvxP * mvxP + mvyP * mvyP) / wantP : 0;
        if (ratioP > 1) ratioP = 1;
        p.gait += (ratioP - p.gait) * Math.min(1, dt * 16);
        var leanT = moving ? ax.dx * 0.9 * ratioP : 0;
        p.lean += (leanT - p.lean) * Math.min(1, dt * 9);

        /* 脚步扬尘：跟着落脚节奏甩出一点沙土，让移动有"抓地"感 */
        p.dustT -= dt;
        if (moving && ratioP > 0.35 && p.dustT <= 0) {
          p.dustT = 0.19;
          run.fx.push({
            kind: 'p',
            x: p.x - ax.dx * 3 + U.rand(-2, 2),
            y: p.y + p.r * 0.9 + U.rand(-1, 1),
            vx: -ax.dx * 9 + U.rand(-5, 5),
            vy: -ax.dy * 9 + U.rand(-11, -3),
            life: 0.32, max: 0.32,
            color: 'rgba(168,158,138,0.55)', size: 1
          });
        } else if (p.dustT < -0.4) {
          p.dustT = 0;
        }
      }

      this.updateBuildings(dt);
      HS.Water.update(run, dt);

      p.invuln = Math.max(0, p.invuln - dt);
      p.hurtT = Math.max(0, p.hurtT - dt);
      p.fireT = Math.max(0, p.fireT - dt);
      /* 元素光锥的余辉比枪口焰长：喷射武器 0.16~0.22s 才点一次，
         只跟 0.07s 的枪口焰会让锥形闪一下就消失 */
      if (p.coneT > 0) p.coneT = Math.max(0, p.coneT - dt);
      p.recoil = Math.max(0, p.recoil - dt * 7);
      if (p.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
      if (p.heatT > 0) p.heatT -= dt;
      if (p.rateT > 0) p.rateT -= dt;
      if (p.xbT > 0) {
        p.xbT -= dt;
        if (p.xbT <= 0) p.xbStack = 0;
      }

      if (!p.veh) this.updateAim(dt);
      if (!run.search && !p.veh) this.updateWeapons(dt);
      HS.Auto.update(run, dt);
      this.updateThrows(dt);
      this.updateBullets(dt);
      this.updateEnemyBullets(dt);
      this.updateEnemies(dt);
      HS.Vehicle.sync(run, dt);
      HS.Vehicle.updateWorld(run, dt);
      this.updatePickups(dt);
      this.updateFx(dt);
      this.updateDirector(dt);

      run.lootTarget = (run.search || p.veh) ? null : HS.World.nearLoot(p.x, p.y, 38, run);
      run.stairTarget = (!p.roof && !run.search && !p.veh && run.insideBld) ?
        HS.Buildings.nearStairs(p.x, p.y, 26) : null;
      run.roofHatch = (p.roof && !run.search) ?
        HS.Buildings.nearRoofHatch(p.x, p.y, p.roof, 24) : null;
      run.jumpDir = p.roof ? HS.Buildings.edgeDir(p.x, p.y, p.roof, 22) : null;

      /* 车旁提示：第一次靠近时教一次，之后交给右下角按钮 */
      run.nearVeh = p.veh ? null : HS.Vehicle.nearest(run, p.x, p.y, 34);
      if (run.nearVeh && !run.vehHint) {
        run.vehHint = true;
        this.bannerShow('载具 · 点右下「驾驶」上车：能碾压丧尸，但武器会收起', 3.2);
      }

      if (p.roof && !run.roofHint) {
        run.roofHint = true;
        this.bannerShow('楼顶 · 靠近边缘可以跳下（会摔伤）', 2.8);
      }

      if (p.hp <= 0) this.onPlayerDown();
    },

    /**
     * 瞄准角：有敌人就对准最近的，没有就朝身前。
     * 手里的枪按这个角度摆，所以"枪口对着谁"和"子弹飞向谁"是同一件事；
     * 转动有阻尼，敌人绕到身后时枪是划过去的，不会瞬移。
     */
    updateAim: function (dt) {
      var p = this.run.p;
      var t = this.nearest(p.x, p.y, 250);
      var want = t ? Math.atan2(t.y - p.y, t.x - p.x) : (p.facing > 0 ? 0 : Math.PI);
      var d = want - p.aimA;
      while (d > Math.PI) d -= U.TAU;
      while (d < -Math.PI) d += U.TAU;
      p.aimA += d * Math.min(1, dt * 14);
      if (p.aimA > Math.PI) p.aimA -= U.TAU;
      else if (p.aimA < -Math.PI) p.aimA += U.TAU;
    },

    /* 建筑进入 / 屋顶虚化；Boss 破墙而入时也会把屋顶淡出 */
    updateBuildings: function (dt) {      var run = this.run, p = run.p;
      var inside = p.roof ? null : HS.Buildings.insideOf(p.x, p.y);
      if (inside !== run.insideBld) {
        run.insideBld = inside;
        if (inside) {
          if (!run.enteredHint) {
            run.enteredHint = true;
            this.bannerShow(inside.stairs ?
              '进入建筑 · 搜刮家具，楼梯可以上到楼顶' :
              '进入建筑 · 搜刮家具，或从另一侧出口离开', 3);
          }
          HS.Audio.ui();
        }
      }

      var near = HS.Buildings.buildingsNear(p.x, p.y);
      var bossB = (run.boss && !run.boss.dead) ? HS.Buildings.insideOf(run.boss.x, run.boss.y) : null;
      for (var i = 0; i < near.length; i++) {
        var b = near[i];
        var target = 0;
        if (b === p.roof) target = 0;
        else if (b === run.insideBld) target = 1;
        else if (b === bossB) target = 0.86;

        if (b.reveal < target) b.reveal = Math.min(target, b.reveal + dt * 8);
        else if (b.reveal > target) b.reveal = Math.max(target, b.reveal - dt * 6);
      }
    },

    /* ================= 楼顶 ================= */

    /** 摔落伤害：楼越高越疼（居民房 2 层 / 大楼 3 层） */
    fallDamage: function (p, b) {
      var floors = (b && b.floors) || 2;
      return Math.max(4, Math.round(p.maxHp * (0.06 + floors * 0.028)));
    },

    climbRoof: function (b) {
      var run = this.run;
      if (!run || this.state !== 'run' || !b || !b.stairs) return;
      var p = run.p;
      if (p.roof) return;
      if (U.dist(p.x, p.y, b.stairs.x, b.stairs.y) > 30) return;

      this.cancelSearch();
      p.roof = b;
      p.x = b.stairs.x;
      p.y = b.stairs.y;
      p.invuln = Math.max(p.invuln, 0.8);
      run.insideBld = null;
      run.stairTarget = null;
      run.roofHatch = b;
      b.reveal = 0;
      run.shake = Math.max(run.shake, 2);
      for (var i = 0; i < 5; i++) {
        run.fx.push({
          kind: 'p', x: p.x + U.rand(-5, 5), y: p.y + U.rand(2, 8),
          vx: U.rand(-20, 20), vy: U.rand(-18, -4),
          life: 0.35, max: 0.35, color: '#8d8478', size: 1.5
        });
      }
      HS.Audio.ui();
      P.vibrate('light');
      this.bannerShow('登上 ' + (b.floors || 2) + ' 层楼顶 · 靠近边缘可跳下', 2.6);
    },

    /** 从楼顶楼梯口原路回到室内（避免上楼后只能摔下去） */
    descendRoof: function () {
      var run = this.run;
      if (!run || this.state !== 'run') return;
      var p = run.p, b = p.roof;
      if (!b || !b.stairs) return;
      if (U.dist(p.x, p.y, b.stairs.x, b.stairs.y) > 28) return;

      p.roof = null;
      p.x = b.stairs.x;
      p.y = b.stairs.y;
      p.invuln = Math.max(p.invuln, 0.5);
      run.roofHatch = null;
      run.jumpDir = null;
      run.insideBld = b;
      run.shake = Math.max(run.shake, 1.5);
      HS.Audio.ui();
      this.bannerShow('回到室内 · ' + (b.floors || 2) + ' 层楼', 1.8);
    },

    jumpDown: function () {
      var run = this.run;
      if (!run || this.state !== 'run') return;
      var p = run.p, b = p.roof;
      if (!b) return;

      var dir = HS.Buildings.edgeDir(p.x, p.y, b, 24);
      if (!dir) {
        this.bannerShow('再靠近楼顶边缘才能跳下', 1.4);
        return;
      }

      var dist = 26;
      var lx = p.x + dir.x * dist, ly = p.y + dir.y * dist;
      var bestX = lx, bestY = ly, found = false;
      var offs = [0, -9, 9, -18, 18, -28, 28];
      for (var i = 0; i < offs.length; i++) {
        var tx = lx + (dir.x === 0 ? offs[i] : 0);
        var ty = ly + (dir.y === 0 ? offs[i] : 0);
        if (HS.World.insideSolid(tx, ty)) continue;
        if (HS.Buildings.insideOf(tx, ty)) continue;
        bestX = tx; bestY = ty; found = true;
        break;
      }

      p.roof = null;
      p.x = bestX;
      p.y = bestY;
      if (!found) HS.World.resolve(p, p.r);
      run.insideBld = HS.Buildings.insideOf(p.x, p.y);
      run.stairTarget = null;
      run.roofHatch = null;
      run.jumpDir = null;

      var dmg = this.fallDamage(p, b);
      this.damagePlayer(dmg, { ignoreInvuln: true, ignoreArmor: true });
      p.invuln = Math.max(p.invuln, 0.8);
      run.shake = Math.max(run.shake, 7);
      run.fx.push({
        kind: 'ring', x: p.x, y: p.y, r: 4, max: 24,
        life: 0.28, maxLife: 0.28, color: '#c8b48a'
      });
      for (var k = 0; k < 10; k++) {
        run.fx.push({
          kind: 'p', x: p.x + U.rand(-6, 6), y: p.y + U.rand(-2, 8),
          vx: U.rand(-60, 60), vy: U.rand(-40, -5),
          life: U.rand(0.25, 0.5), max: 0.5, color: '#8d8478', size: U.rand(1, 2)
        });
      }
      HS.Audio.hurt();
      this.bannerShow('从 ' + (b.floors || 2) + ' 层楼顶跳下 · 摔伤 -' + dmg, 2);
      if (p.hp <= 0) this.onPlayerDown();
    },

    /* ================= 刷怪导演 ================= */

    updateDirector: function (dt) {
      var run = this.run;
      var frenzy = run.frenzyT > 0 ? 1.9 : 1;
      var rate = (1.0 + run.t / 60 * 0.46) * run.map.spawnMul * frenzy;
      // Boss 登场后杂兵只留少量，让 Boss 战读得清
      if (run.bossSpawned) rate *= 0.3;

      run.spawnAcc += dt * rate;
      var guard = 0;
      while (run.spawnAcc >= 1 && guard++ < 12) {
        run.spawnAcc -= 1;
        if (run.enemies.length >= MAX_ENEMIES) { run.spawnAcc = 0; break; }
        this.spawnRandom();
      }

      /* 精英 */
      if (run.t > 100) {
        run.eliteT += dt;
        if (run.eliteT > 42) { run.eliteT = 0; this.spawnElite(); }
      }

      /* Boss 前的最后一次补给：落在屏幕边缘附近，逼玩家挪两步去拿 */
      if (!run.supplyDropped && run.t >= RUN_TIME - 30) {
        run.supplyDropped = true;
        var sa = Math.random() * U.TAU;
        var sd = 150 + Math.random() * 40;
        run.drops.push(this.hintDrop({ kind: 'chest', x: run.p.x + Math.cos(sa) * sd, y: run.p.y + Math.sin(sa) * sd, bob: 0, life: 90, dead: false }, 8));
        run.drops.push({ kind: 'heart', x: run.p.x + Math.cos(sa + 2.2) * sd, y: run.p.y + Math.sin(sa + 2.2) * sd, bob: 0, life: 90, dead: false });
        this.bannerShow('最后的补给已空投', 2.6);
      }

      /* 局内事件 */
      run.eventT -= dt;
      if (run.eventT <= 0) {
        run.eventT = 44 + Math.random() * 16;
        this.runEvent();
      }

      /* Boss：普通模式 6 分钟一次；无尽模式循环刷新且逐次增强 */
      if (!run.boss && run.t >= run.nextBossAt) this.spawnBoss();
    },

    pickType: function (t) {
      /* 无尽模式：三张图的杂兵全上台，按时间解锁 + 权重缓升 */
      if (this.run && this.run.endless) return this.pickTypeEndless(t);

      /* 荒漠公路：活人枪手混在尸群里。比例随局内时间缓慢上升（最多 +20%），
         但始终是少数 —— 满屏枪手就没法玩了 */
      var map = (this.run && this.run.map) || {};
      if (map.water) {
        var rw = Math.random();
        if (t > 20 && rw < 0.22) return 'drowner';
        if (t > 55 && rw < 0.36) return 'vomiter';
      }
      if (map.gunmen && Math.random() < map.gunmen + Math.min(0.2, t / 900)) return 'terrorist';

      /* 死区之夜专属：扑袭者 40s 后进场且占比缓升，呕酸尸 75s 后跟着尸群出现。
         两者合计不超过 ~1/4，夜图的压迫感来自"组合"，不是数量 */
      if (map.night) {
        var rn = Math.random();
        if (t > 40 && rn < 0.10 + Math.min(0.08, t / 1500)) return 'pouncer';
        if (t > 75 && rn < 0.26) return 'vomiter';
      }

      var r = Math.random();
      if (t < 50) return r < 0.78 ? 'walker' : (r < 0.93 ? 'runner' : 'crawler');
      if (t < 120) return r < 0.55 ? 'walker' : (r < 0.78 ? 'runner' : (r < 0.90 ? 'crawler' : 'spitter'));
      if (t < 210) return r < 0.40 ? 'walker' : (r < 0.62 ? 'runner' : (r < 0.76 ? 'crawler' : (r < 0.88 ? 'spitter' : 'brute')));
      return r < 0.30 ? 'walker' : (r < 0.50 ? 'runner' : (r < 0.62 ? 'crawler' : (r < 0.80 ? 'spitter' : 'brute')));
    },

    /**
     * 无尽模式的刷怪表：三张图的专属怪全部参与抽取。
     * 每行 = [类型, 首次出场秒数, 基础权重]。
     * 解锁后有 3 分钟爬坡（40% → 100%），特殊怪的权重再随存活时间缓慢上抬，
     * 所以前期是普通尸群，8 分钟后开始"什么都来一点"。
     */
    pickTypeEndless: function (t) {
      var pool = ENDLESS_TYPES;
      var total = 0, i, w, row;
      for (i = 0; i < pool.length; i++) {
        row = pool[i];
        row[3] = 0;
        if (t < row[1]) continue;
        w = row[2] * Math.min(1, 0.4 + (t - row[1]) / 180 * 0.6);
        if (i >= 3) w *= Math.min(1.6, 1 + (t - row[1]) / 600);
        row[3] = w;
        total += w;
      }
      if (total <= 0) return 'walker';
      var r = Math.random() * total;
      for (i = 0; i < pool.length; i++) {
        if (!pool[i][3]) continue;
        r -= pool[i][3];
        if (r <= 0) return pool[i][0];
      }
      return 'walker';
    },

    spawnPos: function (extra) {
      var p = this.run.p;
      var mx = P.VW / 2 + 22 + (extra || 0);
      var my = P.VH / 2 + 22 + (extra || 0);
      // 左右两侧更近，权重更高，保证怪物能及时压上来
      var r = Math.random();
      var side = r < 0.36 ? 0 : (r < 0.72 ? 1 : (r < 0.87 ? 2 : 3));
      var x, y;
      if (side === 0) { x = p.x + U.rand(-mx, mx); y = p.y - my; }
      else if (side === 1) { x = p.x + U.rand(-mx, mx); y = p.y + my; }
      else if (side === 2) { x = p.x - mx; y = p.y + U.rand(-my * 0.8, my * 0.8); }
      else { x = p.x + mx; y = p.y + U.rand(-my * 0.8, my * 0.8); }
      return { x: x, y: y };
    },

    spawnEnemy: function (typeId, elite, px, py) {
      var run = this.run;
      var def = D.enemies[typeId] || D.enemies.walker;
      var pos = (px === undefined) ? this.spawnPos(0) : { x: px, y: py };
      /* 深水能走但慢到 0.3 倍：别把刷怪名额丢在水里（出生点挪到最近的干地） */
      if (HS.Water && HS.Water.dryNear && run.map.water) {
        var dry = HS.Water.dryNear(pos.x, pos.y, run);
        pos.x = dry.x; pos.y = dry.y;
      }

      /* 别在墙里 / 楼里刷怪：向外找一圈空地 */
      if (HS.World.insideSolid(pos.x, pos.y)) {
        var found = false;
        for (var st = 0; st < 14; st++) {
          var sa = Math.random() * U.TAU;
          var sr = 16 + st * 9;
          var nx = pos.x + Math.cos(sa) * sr;
          var ny = pos.y + Math.sin(sa) * sr;
          if (!HS.World.insideSolid(nx, ny)) {
            pos.x = nx; pos.y = ny; found = true; break;
          }
        }
        if (!found) {
          for (var st2 = 0; st2 < 8; st2++) {
            var sa2 = Math.random() * U.TAU;
            var nx2 = this.run.p.x + Math.cos(sa2) * (P.VW / 2 + 14);
            var ny2 = this.run.p.y + Math.sin(sa2) * (P.VH / 2 + 14);
            if (!HS.World.insideSolid(nx2, ny2)) { pos.x = nx2; pos.y = ny2; break; }
          }
        }
      }

      var hpScale = 1 + (run.t / 60) * 0.52;
      /* 越靠后的地图，小兵越耐打：hpMul 只给小兵，Boss 另有 bossHpMul / bossDmgCut */
      var hp = def.hp * hpScale * (def.boss ? 1 : (run.map.hpMul || 1));
      if (def.boss && run.map.bossHpMul) hp *= run.map.bossHpMul;
      var dmg = def.dmg * (1 + (run.t / 60) * 0.10);
      var scale = def.scale;
      var tint = def.tint, tintAmt = def.tintAmt;

      if (elite) {
        var el = D.elite;
        hp *= el.hpMul;
        dmg *= el.dmgMul;
        scale = def.scale * el.scale;
        tint = el.tint; tintAmt = el.tintAmt;
      }

      var e = {
        uid: (Game._uid = (Game._uid || 0) + 1),
        type: typeId, def: def,
        x: pos.x, y: pos.y,
        hp: hp, maxHp: hp,
        r: def.r * (elite ? 1.25 : 1) * (def.scale > 1 ? 1 : 1),
        speed: def.speed * (1 + (run.t / 60) * 0.045),
        dmg: dmg,
        xp: def.xp * (elite ? 4 : 1),
        gold: (def.gold || 1) * (elite ? 4 : 1),
        flash: 0, slow: 0, slowT: 0,
        /* 受到伤害的减免比例（当前只给末世街区的 Boss 用） */
        dmgCut: (def.boss && run.map.bossDmgCut) || 0,
        /* 护甲：只挡实弹 / 近战 / 爆炸，火焰与持续伤害自带无视；
           精英比同类再厚一层，破甲（p.armorPen）能削掉一部分 */
        /* 地图抗性：锈水高速的小兵凭空多一层"打不动"，
           只挡实弹/近战/爆炸 —— 火焰、冰霜、持续伤害照样吃满，破甲也能削 */
        armor: Math.min(0.5,
          (def.armor || 0) + (elite ? 0.08 : 0) + (def.boss ? 0 : (run.map.resist || 0))),
        anim: Math.random() * 10,
        /* 步态：gait 是"迈腿强度"，lean 是朝移动方向的前倾 */
        gait: 0, lean: 0,
        seed: Math.random() * 100,
        elite: !!elite, boss: false,
        scale: scale, tint: tint, tintAmt: tintAmt,
        spriteName: def.sprite + (elite && def.sprite !== 'boss' ? '_elite' : ''),
        hitSprite: def.sprite + '_hit',
        dead: false, hitT: 0, shootCd: 1.2, aimT: 0, chargeT: 0, chargeCd: 5, ramCd: 0,
        /* 扑袭者 / 呕酸尸的动作状态机（combat.js 按 def.pounce / def.vomit 驱动） */
        pounceState: 0, pounceCd: 1.6, pounceWind: 0, pounceT: 0, pounceRec: 0,
        pounceAng: 0, pvx: 0, pvy: 0,
        vomitState: 0, vomitCd: 2.4, vomitWind: 0, sprayT: 0, vomitAng: 0,
        /* 穿门寻路状态（由 HS.Buildings.doorNav 维护） */
        navB: null, navDoor: -1, navOut: false,
        navBest: 0, navStuck: 0, navTry: 0, navX: 0, navY: 0,
        /* 绕行 / 脱困状态（由 combat.js 的 wallRoute + Buildings.route* 维护） */
        blockT: 0, wpB: null, wpIdx: 0, wpDir: 1, wpHop: 0,
        wpX: 0, wpY: 0, wpT: 0, wallT: 0, wallSide: 0
      };
      run.enemies.push(e);
      HS.Save.addSeen('enemies', typeId);
      return e;
    },

    spawnRandom: function () {
      var type = this.pickType(this.run.t);
      return this.spawnEnemy(type, false);
    },

    spawnElite: function () {
      var type = this.run.t < 140 ? 'walker' : (Math.random() < 0.6 ? 'brute' : 'runner');
      /* 荒漠公路的精英更可能是"带枪的老大"，打掉他之前别贴脸 */
      if (this.run.map && this.run.map.gunmen && Math.random() < 0.45) type = 'terrorist';
      if (this.run.map && this.run.map.water && Math.random() < 0.5) type = Math.random() < 0.65 ? 'drowner' : 'vomiter';
      var e = this.spawnEnemy(type, true);
      e.xp *= 2;
      this.bannerShow('精英感染者出现', 1.8);
      HS.Audio.hurt();
      return e;
    },

    spawnBoss: function () {
      var run = this.run;
      run.bossSpawned = true;
      run.bossCount = (run.bossCount || 0) + 1;
      var p = run.p;
      var side = Math.random() < 0.5 ? -1 : 1;
      var pos = {
        x: p.x + side * (P.VW / 2 + 34),
        y: p.y + U.rand(-P.VH * 0.28, P.VH * 0.28)
      };
      var bossId = run.map.bossId || 'boss';
      /* 无尽模式：三张图的首领轮流出场 —— 从本图这只开始，然后依次换。
         每只都照吃 bossCount 的血量 / 伤害加成，越往后越难啃 */
      if (run.endless) {
        var bossRing = ['boss', 'gatling', 'stalker', 'axeboss'];
        var ringFrom = bossRing.indexOf(bossId);
        if (ringFrom < 0) ringFrom = 0;
        bossId = bossRing[(ringFrom + run.bossCount - 1) % bossRing.length];
      }
      var bossDef = D.enemies[bossId] || D.enemies.boss;
      var e = this.spawnEnemy(bossId, false, pos.x, pos.y);
      if (run.endless) {
        /* 轮换的三只首领取同一个血量基准，只随场次增长。
           否则血肉暴君(460) / 扫射暴君(1000) / 猎杀者(2150) 的原始血量差 4 倍，
           第二只反而比第一只好打，轮换就变成"捡便宜"了。
           差异化交给招式（冲锋 / 扫射 / 扑杀）和基础伤害 */
        var eBase = 1300 * Math.pow(1.45, run.bossCount - 1);
        e.maxHp = eBase;
        e.hp = eBase;
        e.dmg *= 1 + 0.12 * (run.bossCount - 1);
        e.speed *= 1 + 0.05 * (run.bossCount - 1);
      } else if (run.bossCount > 1) {
        var boost = Math.pow(1.45, run.bossCount - 1);
        e.maxHp *= boost;
        e.hp = e.maxHp;
        e.dmg *= 1 + 0.15 * (run.bossCount - 1);
        e.speed *= 1 + 0.06 * (run.bossCount - 1);
      }
      e.boss = true;
      run.boss = e;

      /* 登场震场：清掉贴身杂兵，给 Boss 一个能看清的舞台 */
      for (var bi = 0; bi < run.enemies.length; bi++) {
        var bo = run.enemies[bi];
        if (bo === e || bo.boss || bo.dead) continue;
        if (U.dist(bo.x, bo.y, e.x, e.y) < 115) {
          bo.dead = true;
          run.fx.push({
            kind: 'p', x: bo.x, y: bo.y,
            vx: U.rand(-60, 60), vy: U.rand(-70, 10),
            life: 0.5, max: 0.5, color: '#3a3a42', size: 2
          });
        }
      }

      this.bannerShow(run.bossCount > 1
        ? ('第 ' + run.bossCount + ' 只 ' + bossDef.name)
        : (bossDef.name + ' 已进入死区'), 3);
      run.shake = 8;
      HS.Audio.doom();
    },

    runEvent: function () {
      var run = this.run;
      var r = Math.random();
      if (run.map.water && r < 0.56) {
        HS.Water.event(run);
      } else if (r < 0.4) {
        /* 尸潮 */
        this.bannerShow('尸潮来袭', 2.2);
        var n = 12 + Math.floor(run.t / 40);
        for (var i = 0; i < n; i++) {
          var pos = this.spawnPos(10);
          this.spawnEnemy(Math.random() < 0.8 ? 'walker' : 'runner', false, pos.x, pos.y);
        }
      } else if (r < 0.7) {
        /* 猎犬群 */
        this.bannerShow('疾行者成群逼近', 2);
        for (var j = 0; j < 8; j++) {
          var p2 = this.spawnPos(30);
          this.spawnEnemy('runner', false, p2.x, p2.y);
        }
      } else if (r < 0.88) {
        /* 空投：落在屏幕外沿附近（150~190px），有信号柱 + HUD 菱形指引 6 秒，
           原来贴脸 70px 落地，等于白送 */
        this.bannerShow('补给空投已落地 · 跟着信号柱', 2.2);
        var a = Math.random() * U.TAU;
        var ad = 150 + Math.random() * 40;
        run.drops.push(this.hintDrop({
          kind: 'chest', x: run.p.x + Math.cos(a) * ad, y: run.p.y + Math.sin(a) * ad,
          bob: 0, life: 999, dead: false
        }, 6));
      } else {
        /* 血月 */
        run.frenzyT = 12;
        this.bannerShow('血月：感染加速', 2.4);
      }
    },

    /* ================= 经验 / 升级 ================= */

    gainXp: function (n) {
      var run = this.run, p = run.p;
      p.xp += n * p.xpMul;
      var gained = 0;
      while (p.xp >= p.xpNext && gained < 20) {
        p.xp -= p.xpNext;
        p.level++;
        p.xpNext = this.xpFor(p.level);
        gained++;
      }
      if (gained > 0) {
        run.pending += gained;
        if (this.state === 'run') this.openLevelUp();
      }
    },

    openLevelUp: function () {
      var run = this.run;
      this.confirm = null;
      run.choices = this.buildChoices(3);
      run.choiceT = 0;
      this.state = 'levelup';
      HS.Input.enabled = false;
      HS.Audio.levelup();
    },

    /** 重抽：把当前三张换掉。次数有限，所以不会变成无脑刷手牌 */
    doReroll: function () {
      var run = this.run;
      if (!run || this.state !== 'levelup') return;
      var p = run.p;
      if ((p.reroll || 0) <= 0) return;
      p.reroll--;
      run.choices = this.buildChoices(3);
      run.choiceT = 0;
      HS.Audio.ui();
    },

    /**
     * 各来源的当前权重。
     * 「幸运」（每级 +8%）会把权重从通用属性挪向专属 / 联动 / 进化 —— 之前 p.luck
     * 算出来却没人用，等于一张废卡，这里接上。
     */
    sourceWeights: function (p, noSub, autoGap) {
      var luck = p.luck || 0;
      /* 已经换过主武器 = 这把枪是要一路养下去的，换装卡整档减半：
         换掉要清零等级，不该在每次升级里反复劝你换一把不想换的枪 */
      var mainCut = p.mainLocked ? 0.5 : 1;
      return {
        stat: Math.max(12, 40 * (1 - luck * 0.55)),
        gear: 30,
        /* 新装备按槽位分账。以前四种槽位合并成一档 8 点权重：38 件主武器挤在
           27 件副武器 + 23 件自动装备中间被一起稀释，单把主武器一整局能露面的
           概率不到一成 —— 喷火枪 / 液氮喷枪就是这么"永远刷不出来"的。 */
        gearMain: (14 + (noSub ? 2 : 0)) * mainCut,
        gearSub: 6 + (noSub ? 10 : 0),
        gearHeavy: 2.4 * mainCut,
        gearAuto: 4.5 + (autoGap ? 4 : 0),
        syn: 15 * (1 + luck * 0.8),
        evo: 5 * (1 + luck * 0.6)
      };
    },

    /**
     * 升级三选一
     *
     * 抽取流程：
     *   1. 先筛有效候选（进化条件 / 槽位 / 属性兼容 / 上限）
     *   2. 满足条件的进化必定占一张（质变节点不能被随机吞掉）
     *   3. 剩余位置按 sourceWeights() 抽来源（默认 通用 40 / 专属 30 / 新装备 8+ / 联动 15 / 进化 5）
     *   4. 同来源最多 2 张、同效果族最多 2 张，避免三张卡长得一样
     */
    buildChoices: function (n, forLoot) {
      var run = this.run, p = run.p;
      var out = [];
      var used = {}, famUsed = {}, srcCount = {};

      var srcs = {
        stat: [], gear: [], syn: [], evo: [],
        gearMain: [], gearSub: [], gearHeavy: [], gearAuto: []
      };
      var i, j, id, def, w, entry;

      /* ---------- 1. 进化 ---------- */
      for (i = 0; i < p.weapons.length; i++) {
        w = p.weapons[i];
        def = D.gear[w.id];
        if (!def || w.evolved || !D.evolutions[w.id]) continue;
        if (w.lvl < 5) continue;
        var ev = D.evolutions[w.id];
        var req = ev.req || {};
        if (req.stat && (p.passives[req.stat] || 0) < (req.statLvl || 1)) {
          /* 满级但差一条属性：给一张"进化预备"，把缺口补上。
             进化本身仍然只在条件满足后才进池。 */
          var sreq = p.passives[req.stat] || 0;
          if ((req.statLvl || 1) - sreq <= 3) {
            srcs.evo.push({ kind: 'evoPrep', id: w.id, stat: req.stat, w: 1 });
          }
          continue;
        }
        srcs.evo.push({ kind: 'evolve', id: w.id, evo: ev.id, w: 1 });
      }
      /* 武器满级后，进化（或补足条件的预备卡）必定占一张：
         质变节点不能被随机吞掉，否则整局都看不到进化 */
      if (srcs.evo.length) {
        var first = srcs.evo[Math.floor(Math.random() * srcs.evo.length)];
        out.push(this.makeCard(first));
        used['id:' + first.id] = 1;
        famUsed.evo = 1;
        srcCount.evo = 1;
      }

      /* ---------- 2. 通用属性 ---------- */
      var owned = 0;
      for (id in p.passives) {
        if (p.passives[id]) owned++;
      }
      for (i = 0; i < D.passivePool.length; i++) {
        id = D.passivePool[i];
        def = D.passives[id];
        if (!def) continue;
        var lvl = p.passives[id] || 0;
        if (lvl >= def.maxLvl) continue;
        if (!lvl && owned >= MAX_PASSIVES) continue;
        if (!this.statOk(id, p)) continue;
        srcs.stat.push({
          kind: lvl ? 'passive' : 'passiveNew', id: id,
          w: lvl ? 1.5 : 1.0, fam: 'stat:' + def.cat
        });
      }
      for (i = 0; i < D.gearPool.length; i++) {
        id = D.gearPool[i];
        def = D.passives[id];
        if (!def) continue;
        var glv = p.passives[id] || 0;
        if (glv >= def.maxLvl) continue;
        if (!glv && owned >= MAX_PASSIVES) continue;
        srcs.stat.push({
          kind: glv ? 'passive' : 'passiveNew', id: id,
          w: glv ? 1.5 : 1.3, fam: 'stat:' + def.cat
        });
      }

      /* ---------- 3. 武器专属 / 新装备 ---------- */
      var addGearUps = function (list) {
        for (var a = 0; a < list.length; a++) {
          var ent = list[a];
          var gdef = D.gear[ent.id];
          /* 基础成长：武器等级 1→5，伤害 / 射速 / 弹量都在这条线上走，
             进化门槛（Lv5）也靠它达成 */
          if (gdef && ent.lvl < (gdef.maxLvl || 5)) {
            srcs.gear.push({
              kind: 'gearLevel', id: ent.id, w: 6.0,
              fam: 'lvl:' + ent.id
            });
          }
          var ups = D.gearUps[ent.id];
          if (!ups) continue;
          for (var bid in ups) {
            if (!ups.hasOwnProperty(bid)) continue;
            var br = ups[bid];
            var cl = (ent.up && ent.up[bid]) || 0;
            if (cl >= br.maxLvl) continue;
            srcs.gear.push({
              kind: 'gearUp', id: ent.id, up: bid, w: 0.9,
              fam: 'up:' + ent.id + ':' + bid
            });
          }
        }
      };
      addGearUps(p.weapons);
      addGearUps(p.autos);

      var pools = [
        { list: D.weaponPool, slot: 'main' },
        { list: D.subPool, slot: 'sub' },
        { list: D.heavyPool, slot: 'heavy' },
        { list: D.autoPool, slot: 'auto' }
      ];
      /* 空槽位加权：副武器位 / 自动装备位空着的时候，新装备必须更容易见到，
         否则整局都在给同一把枪点数值，构筑永远是"一把枪 + 一堆属性" */
      var noSub = !HS.Gear.subEntry(p);
      var noMain = !HS.Gear.mainEntry(p);
      var autoGap = p.autos.length < 3;
      for (i = 0; i < pools.length; i++) {
        for (j = 0; j < pools[i].list.length; j++) {
          id = pools[i].list[j];
          def = D.gear[id];
          if (!def) continue;
          if (pools[i].slot === 'auto' && p.autos.length >= MAX_AUTOS) continue;
          /* 重武器占满主副两格：副武器根本塞不进去，别给这种卡（会被当成"吞掉主武器"） */
          if (def.slot === 'sub' && HS.Gear.heavyEntry(p)) continue;
          /* 已经握在手里的主武器不用再"换成它自己" */
          if ((def.slot === 'main' || def.slot === 'heavy') && p.mainLocked) {
            var curMain = HS.Gear.mainEntry(p);
            if (curMain && curMain.id === id) continue;
          }
          /* 搜刮是当场生效的，没有确认框：绝不静默换掉手里的手持武器 */
          if (forLoot) {
            var busyE = def.slot === 'sub' ? HS.Gear.subEntry(p)
              : ((def.slot === 'main' || def.slot === 'heavy') ? HS.Gear.mainEntry(p) : null);
            if (busyE && busyE.id !== id) continue;
          }
          var can = HS.Gear.canSwap(p, id);
          if (!can.ok) continue;
          /* 已经拿过的自动装备走合并升级，权重更高一点 */
          if (can.merge) {
            /* 已经有这件装备：当作成长卡，而不是"又掉了一把" */
            srcs.gear.push({ kind: 'gearLevel', id: id, w: 3.0, fam: 'lvl:' + id });
            continue;
          }
          /* 权重按武器强度给（见 weapons.js 的 D.gearWeight）：
             打得越狠的枪越少露面，杂鱼武器出得勤。 */
          var wt = D.gearWeight(id);
          /* 幸运让高稀有装备更容易露面 */
          if (def.rarity >= 3) wt *= 1 + (p.luck || 0) * 0.5;
          /* 空槽 → 抬权重（这是"长出新火力"，纯收益）；
             已占槽 → 降权重（这是"换掉手里的"，会清空已经点过的分支，不该高频出现）。
             主武器是例外：还没锁定的时候，换枪是这一局唯一一次"改路线"的机会，
             不给足曝光就等于没有这个选择。 */
          if (def.slot === 'sub') wt *= noSub ? 1.9 : 0.3;
          else if (def.slot === 'main') wt *= noMain ? 1.5 : (p.mainLocked ? 0.3 : 0.6);
          else if (def.slot === 'auto') wt *= autoGap ? 1.7 : 0.6;
          else if (def.slot === 'heavy') wt *= 0.5;
          var bucket = def.slot === 'auto' ? 'gearAuto'
            : (def.slot === 'sub' ? 'gearSub'
            : (def.slot === 'heavy' ? 'gearHeavy' : 'gearMain'));
          srcs[bucket].push({
            kind: def.slot === 'auto' ? 'autoNew' : 'weaponNew',
            id: id, w: wt, fam: 'gear:' + id
          });
        }
      }

      /* ---------- 4. 联动 / 特殊强化 ---------- */
      for (i = 0; i < D.synergies.length; i++) {
        var syn = D.synergies[i];
        if (p.syn[syn.id]) {
          var slv = p.synLv[syn.id] || 1;
          if (slv >= 3) continue;
          srcs.syn.push({ kind: 'synergy', id: syn.id, boost: 1, w: 1.1, fam: 'syn:' + syn.id });
        } else {
          var miss = this.synMissing(p, syn);
          if (!miss) continue;
          srcs.syn.push({ kind: 'synergy', id: syn.id, miss: miss[0], w: 1.2, fam: 'syn:' + syn.id });
        }
      }

      /* ---------- 5. 抽卡 ---------- */
      /* 40 / 30 / 8 / 15 / 5：专属升级占大头，新装备单独一档，
         否则"新武器候选"太多，主武器永远升不上去（构筑会散掉）。
         副武器位 / 自动装备位空着时，新装备这一档临时抬权重；
         「幸运」会把权重从通用属性挪向专属 / 联动 / 进化。 */
      var SRC_W = this.sourceWeights(p, noSub, autoGap);
      var order = ['stat', 'gear', 'gearMain', 'gearSub', 'gearHeavy', 'gearAuto', 'syn', 'evo'];
      var guard = 0;

      while (out.length < n && guard++ < n * 12 + 40) {
        /* 先按来源权重抽，抽空了就换下一个来源 */
        var total = 0, k;
        for (k = 0; k < order.length; k++) {
          var key = order[k];
          if (!srcs[key].length) continue;
          total += SRC_W[key] * ((srcCount[key] || 0) >= 2 ? 0.25 : 1);
        }
        if (total <= 0) break;

        var roll = Math.random() * total, pickSrc = null;
        for (k = 0; k < order.length; k++) {
          key = order[k];
          if (!srcs[key].length) continue;
          var ww = SRC_W[key] * ((srcCount[key] || 0) >= 2 ? 0.25 : 1);
          roll -= ww;
          if (roll <= 0) { pickSrc = key; break; }
        }
        if (!pickSrc) pickSrc = order[0];

        var picked = this.pickFrom(srcs[pickSrc], used, famUsed);
        if (!picked) {
          /* 这一来源全被去重挡住了 → 清空它，让下一轮换来源 */
          srcs[pickSrc] = [];
          continue;
        }
        out.push(this.makeCard(picked));
        used['id:' + picked.id] = 1;
        var fam = picked.fam || (picked.kind + ':' + picked.id);
        famUsed[fam] = (famUsed[fam] || 0) + 1;
        srcCount[pickSrc] = (srcCount[pickSrc] || 0) + 1;
      }

      if (!out.length) {
        out.push({
          kind: 'heal', id: 'heal', name: '急救包', sub: '没有可强化的项目',
          desc: '回复 30% 生命', color: '#8ce99a', icon: 'regen'
        });
      }

      /* 保底：三张里至少留一张"不动手里武器"的卡（属性 / 专属分支 / 联动 / 等级）。
         否则一轮三张全是换装，玩家只能挑一把自己不想换的枪，还得把等级清零。 */
      if (n >= 3 && out.length) {
        var hasCommit = false, hasSafe = false, oi;
        for (oi = 0; oi < out.length; oi++) {
          if (out[oi].kind === 'weaponNew' || out[oi].kind === 'autoNew') hasCommit = true;
          else hasSafe = true;
        }
        if (hasCommit && !hasSafe) {
          var safePool = srcs.stat.concat(srcs.syn, srcs.gear);
          var safePick = safePool.length ? this.pickFrom(safePool, used, famUsed) : null;
          /* 把最后一张换装卡换掉；换不动（候选全被去重挡住）就保持原样，
             总比塞一张用不了的卡强 */
          if (safePick) out[out.length - 1] = this.makeCard(safePick);
        }
      }
      return out;
    },

    /** 在候选里按权重抽一个，跳过重复与"三张同族" */
    pickFrom: function (list, used, famUsed) {
      if (!list || !list.length) return null;
      for (var attempt = 0; attempt < 14; attempt++) {
        var total = 0, i;
        for (i = 0; i < list.length; i++) total += list[i].w || 1;
        var roll = Math.random() * total, idx = 0;
        for (i = 0; i < list.length; i++) {
          roll -= list[i].w || 1;
          if (roll <= 0) { idx = i; break; }
        }
        var c = list[idx];
        /* 同一件装备 / 同一条属性，一轮里只出现一次 */
        var key = 'id:' + c.id;
        var fam = c.fam || (c.kind + ':' + c.id);
        if (used[key]) continue;
        if ((famUsed[fam] || 0) >= 2) continue;
        return c;
      }
      return null;
    },

    /** 通用属性是否对当前构筑有意义（不兼容的直接不进池） */
    statOk: function (id, p) {
      var fam = { gun: false, energy: false, explosive: false, melee: false, thrown: false, support: false };
      var radius = false, longCd = false, hasDur = false, cdAuto = false;
      var elems = { fire: false, ice: false };
      /* 追踪要有"会飞的弹"才有意义：光束 / 喷火 / 电链 / 抛掷落点都没有弹道可修正 */
      var canHoming = false;
      var HOMING_MECH = { bullet: 1, burst: 1, spread: 1, missile: 1, melee: 1,
        thrust: 1, drill: 1, boomerang: 1 };
      var i, def, tags;
      var mark = function (d) {
        if (!d) return;
        tags = d.tags || [];
        if (d.elem === 'fire' || d.effect === 'fire' || tags.indexOf('fire') >= 0) elems.fire = true;
        if (d.elem === 'ice' || d.effect === 'ice' || tags.indexOf('ice') >= 0) elems.ice = true;
      };
      for (i = 0; i < p.weapons.length; i++) {
        def = D.gear[p.weapons[i].id];
        if (!def) continue;
        fam[def.fam] = true;
        if (def.base.radius > 0) radius = true;
        if (def.base.cd >= 0.3) longCd = true;
        if (def.base.dur > 0 || def.base.dps > 0) hasDur = true;
        if (HOMING_MECH[def.mech]) canHoming = true;
        mark(def);
      }
      for (i = 0; i < p.autos.length; i++) {
        def = D.gear[p.autos[i].id];
        if (!def) continue;
        if (def.kind === 'zone' || def.kind === 'orbit' || def.kind === 'ring') radius = true;
        if (def.kind === 'deploy') longCd = true;
        /* 只有吃冷却的类型才算「有冷却」—— 环绕/环带靠转速和接触，冷却对它们没意义 */
        if (def.kind !== 'orbit' && def.kind !== 'ring') cdAuto = true;
        mark(def);
      }

      /* 元素类属性：手上没有对应元素就别出卡（数据里写 needs，这里统一判） */
      def = D.passives[id];
      if (def && def.needs) {
        if (def.needs === 'fire' && !elems.fire) return false;
        if (def.needs === 'ice' && !elems.ice) return false;
        if (def.needs === 'both' && !(elems.fire && elems.ice)) return false;
      }

      if (id === 'pierce' || id === 'split' || id === 'bounce' || id === 'homing' || id === 'projCount') {
        return !!(fam.gun || fam.energy || fam.explosive || fam.melee || fam.thrown);
      }
      if (id === 'homing') return canHoming;
      if (id === 'blast') return !!(fam.explosive || radius);
      if (id === 'duration') return hasDur;
      if (id === 'cdr') return !!(longCd || cdAuto);
      return true;
    },

    /** 联动还差什么。返回 null 表示现在不该卖这张卡 */
    synMissing: function (p, syn) {
      var req = syn.req || {};
      var miss = [];

      if (req.gear && !HS.Gear.hasGear(p, req.gear)) miss.push({ type: 'gear', id: req.gear });
      if (req.gear2 && !HS.Gear.hasGear(p, req.gear2)) miss.push({ type: 'gear', id: req.gear2 });
      if (req.gearAny) {
        var any = false;
        for (var i = 0; i < req.gearAny.length; i++) {
          if (HS.Gear.hasGear(p, req.gearAny[i])) { any = true; break; }
        }
        if (!any) return null;
      }
      /* 按兼容族判定的联动：手上没有这一族武器就根本不出现 */
      if (req.fam && !HS.Gear.famSet(p)[req.fam]) return null;
      if (req.needSub && !HS.Gear.subEntry(p)) return null;
      /* 件数型联动只能自然达成，不当作卡卖 */
      if (req.autoCount) return null;
      var needStat = function (id, need) {
        var cur = p.passives[id] || 0;
        if (cur >= need) return true;
        /* 差两级以上就先别卖，免得卡面全是"还差一点" */
        if (cur + 1 < need) return false;
        miss.push({ type: 'stat', id: id });
        return true;
      };
      if (req.stat && !needStat(req.stat, req.statLvl || 1)) return null;
      if (req.stat2 && !needStat(req.stat2, req.stat2Lvl || 1)) return null;
      if (miss.length !== 1) return null;
      if (miss[0].type === 'gear' && !HS.Gear.canTake(p, miss[0].id).ok) return null;
      return miss;
    },

    hasWeapon: function (id) {
      var ws = this.run.p.weapons;
      for (var i = 0; i < ws.length; i++) {
        if (ws[i].id === id) return true;
        var def = D.gear[ws[i].id];
        if (def && def.baseId === id) return true;
      }
      var as = this.run.p.autos;
      for (var j = 0; j < as.length; j++) {
        if (as[j].id === id) return true;
      }
      return false;
    },

    makeCard: function (item) {
      var p = this.run.p;
      var i, def, lvl;

      if (item.kind === 'evolve') {
        var baseDef = D.gear[item.id];
        var edef = D.gear[item.evo];
        if (!edef) return { kind: 'heal', id: 'heal', name: '急救包', sub: '', desc: '', icon: 'regen', color: '#8ce99a' };
        return {
          kind: 'evolve', id: item.evo, baseId: item.id,
          name: edef.name, sub: '进化 · ' + baseDef.name,
          icon: edef.icon, color: edef.color,
          desc: edef.desc, rare: true, src: '进化'
        };
      }

      if (item.kind === 'evoPrep') {
        var bDef = D.gear[item.id];
        var evoDef = D.gear[(D.evolutions[item.id] || {}).id];
        var sDef = D.passives[item.stat];
        var curS = p.passives[item.stat] || 0;
        return {
          kind: 'evoPrep', id: item.id, stat: item.stat,
          name: '进化预备 · ' + bDef.name,
          sub: '进化条件 · ' + sDef.name + ' ' + curS + ' → ' + (curS + 1),
          icon: sDef.icon, color: '#ffd166',
          desc: evoDef ? (evoDef.name + '：' + evoDef.desc) : sDef.desc(curS + 1),
          rare: true, src: '进化'
        };
      }

      if (item.kind === 'passive' || item.kind === 'passiveNew') {
        def = D.passives[item.id];
        var clv = p.passives[item.id] || 0;
        return {
          kind: clv ? 'passive' : 'passiveNew', id: item.id,
          name: def.name,
          sub: '通用属性 · ' + (def.cat || '强化') + '  ' +
            (clv ? ('Lv' + clv + ' → Lv' + (clv + 1)) : '新'),
          hint: def.apply || '',
          icon: def.icon, color: def.color,
          desc: def.desc(clv + 1),
          rare: false, src: '通用属性'
        };
      }

      if (item.kind === 'gearLevel') {
        def = D.gear[item.id];
        var ent2 = null;
        for (i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === item.id) ent2 = p.weapons[i];
        for (i = 0; i < p.autos.length; i++) if (p.autos[i].id === item.id) ent2 = p.autos[i];
        var lv2 = ent2 ? ent2.lvl : 0;
        var maxL = def.maxLvl || 5;
        var slotTxt = def.slot === 'auto' ? '自动装备' : (def.slot === 'heavy' ? '重型武器' : (def.slot === 'sub' ? '副武器' : '主武器'));
        var growTxt = def.evo ? '觉醒' : '基础成长';
        var tail;
        if (lv2 + 1 >= maxL) {
          var evoDef2 = D.evolutions[item.id];
          if (evoDef2 && !def.evo) {
            var rq = evoDef2.req || {};
            var rn = (rq.stat && D.passives[rq.stat]) ? D.passives[rq.stat].name : '';
            tail = '（已满级 · 进化「' + evoDef2.name + '」' +
              (rn ? '需 ' + rn + ' Lv' + (rq.statLvl || 1) : '条件已满足') + '）';
          } else {
            tail = '（觉醒已满）';
          }
        } else {
          tail = def.evo ? '（进化后继续变强）' : '（基础伤害 / 射速提升）';
        }
        return {
          kind: 'gearLevel', id: item.id,
          name: def.name,
          sub: growTxt + ' Lv' + lv2 + '→' + (lv2 + 1) + '/' + maxL + ' · ' + slotTxt,
          icon: def.icon, color: def.color,
          desc: def.desc + tail,
          rare: false, src: def.evo ? '觉醒' : '武器成长'
        };
      }

      if (item.kind === 'gearUp') {
        def = D.gear[item.id];
        var br = D.gearUps[item.id] && D.gearUps[item.id][item.up];
        if (!br) return { kind: 'heal', id: 'heal', name: '急救包', sub: '', desc: '', icon: 'regen', color: '#8ce99a' };
        var ent = null;
        for (i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === item.id) ent = p.weapons[i];
        for (i = 0; i < p.autos.length; i++) if (p.autos[i].id === item.id) ent = p.autos[i];
        lvl = (ent && ent.up && ent.up[item.up]) || 0;
        return {
          kind: 'gearUp', id: item.id, up: item.up,
          name: br.name,
          sub: def.name + '  ' +
            (lvl ? ('Lv' + lvl + '→' + (lvl + 1)) : 'Lv1') + '/' + br.maxLvl +
            (br.special ? ' · 改变机制' : ''),
          icon: def.icon, color: def.color,
          desc: br.desc,
          rare: !!br.special, src: '武器专属'
        };
      }

      if (item.kind === 'synergy') {
        var syn = null;
        for (i = 0; i < D.synergies.length; i++) if (D.synergies[i].id === item.id) syn = D.synergies[i];
        var slv2 = p.synLv[item.id] || 1;
        return {
          kind: 'synergy', id: item.id, boost: item.boost, miss: item.miss,
          name: syn.name,
          sub: '装备联动 · ' + (item.boost ? ('强化 Lv' + slv2 + ' → Lv' + (slv2 + 1)) : '达成条件'),
          icon: syn.icon, color: syn.color,
          desc: syn.desc,
          rare: true, src: '装备联动'
        };
      }

      /* 新装备 */
      def = D.gear[item.id];
      var slotName = def.slot === 'auto' ? '自动装备'
        : (def.slot === 'heavy' ? '重型武器' : (def.slot === 'sub' ? '副武器' : '主武器'));
      var cn = '';
      var curMain = HS.Gear.mainEntry(p), curSub = HS.Gear.subEntry(p);
      if (def.slot === 'heavy') {
        cn = (curMain ? ' · 顶替 ' + D.gear[curMain.id].name : '') + ' · 占满两个槽位';
      } else if (def.slot === 'main' && curMain) {
        cn = ' · 替换 ' + D.gear[curMain.id].name + ' Lv' + curMain.lvl + ' · 新枪从 Lv1 起';
      } else if (def.slot === 'sub' && curSub) {
        cn = ' · 替换 ' + D.gear[curSub.id].name + ' Lv' + curSub.lvl;
      }
      return {
        kind: item.kind, id: item.id,
        name: def.name,
        sub: slotName + ' · ' + def.cat + cn,
        icon: def.icon, color: def.color,
        desc: def.desc,
        rare: def.rarity >= 4, src: '新装备'
      };
    },

    pickChoice: function (i) {
      if (this.state !== 'levelup') return;
      var run = this.run;
      var c = run.choices[i];
      if (!c) return;
      /* 副武器可以随便换，但换掉会清空已经点过的专属分支：先弹一次警告 */
      if (this.needsSwapWarn(c)) {
        this.confirm = { i: i, card: c };
        HS.Audio.ui();
        return;
      }
      this.finishChoice(c);
    },

    /** 这张卡会不会"丢掉手里那把已经养过的副武器" */
    needsSwapWarn: function (c) {
      var def = c && D.gear[c.id];
      if (!def || def.slot !== 'sub') return false;
      var cur = HS.Gear.subEntry(this.run.p);
      return !!(cur && cur.id !== c.id);
    },

    /** 确认框：yes=true 真的换，false 只是关掉 */
    confirmSwap: function (yes) {
      if (this.state !== 'levelup' || !this.confirm) return;
      var c = this.confirm.card;
      this.confirm = null;
      if (yes) this.finishChoice(c);
      else HS.Audio.ui();
    },

    /** 真正落卡：扣一次待选次数，还有剩就继续开界面 */
    finishChoice: function (c) {
      var run = this.run;
      if (!run || !c) return;
      this.applyChoice(c);
      run.pending--;
      HS.Audio.ui();
      if (run.pending > 0) this.openLevelUp();
      else {
        this.state = 'run';
        HS.Input.enabled = true;
      }
    },

    applyChoice: function (c) {
      var run = this.run, p = run.p;
      var i, r;

      if (c.kind === 'heal') {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
        return;
      }

      if (c.kind === 'evolve') {
        for (i = 0; i < p.weapons.length; i++) {
          if (p.weapons[i].id !== c.baseId) continue;
          p.weapons[i].id = c.id;
          p.weapons[i].lvl = 1;
          p.weapons[i].up = {};
          p.weapons[i].evolved = true;
          p.weapons[i].timer = 0;
        }
        run.evolutions++;
        this.bannerShow('武器进化 · ' + c.name, 2.6);
        HS.Audio.win();
        HS.Save.addSeen('weapons', c.id);
        HS.Gear.refresh(p);
        this.recalc(p);
        return;
      }

      if (c.kind === 'evoPrep') {
        p.passives[c.stat] = (p.passives[c.stat] || 0) + 1;
        this.bannerShow('进化条件已满足 · 下次升级可进化', 2.2);
        this.recalc(p);
        return;
      }

      if (c.kind === 'passive' || c.kind === 'passiveNew') {
        p.passives[c.id] = (p.passives[c.id] || 0) + 1;
        this.recalc(p);
        return;
      }

      if (c.kind === 'gearLevel') {
        var ent3 = null;
        for (i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === c.id) ent3 = p.weapons[i];
        for (i = 0; i < p.autos.length; i++) if (p.autos[i].id === c.id) ent3 = p.autos[i];
        if (ent3) {
          var gd = D.gear[c.id];
          if (ent3.lvl < (gd.maxLvl || 5)) ent3.lvl++;
        }
        HS.Gear.refresh(p);
        this.recalc(p);
        return;
      }

      if (c.kind === 'gearUp') {
        var ent = null;
        for (i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === c.id) ent = p.weapons[i];
        for (i = 0; i < p.autos.length; i++) if (p.autos[i].id === c.id) ent = p.autos[i];
        if (ent) {
          if (!ent.up) ent.up = {};
          ent.up[c.up] = (ent.up[c.up] || 0) + 1;
        }
        HS.Gear.refresh(p);
        this.recalc(p);
        return;
      }

      if (c.kind === 'weaponNew' || c.kind === 'autoNew') {
        var nd = D.gear[c.id];
        /* 只有"手持装备"才会动槽位。自动装备绝对不能碰 p.weapons ——
           以前这里用 `nd.slot !== 'heavy'` 判断，拿自动装备时会把手上的
           重型一起卸掉，玩家直接变成空手。 */
        var hand = !!(nd && (nd.slot === 'main' || nd.slot === 'sub' || nd.slot === 'heavy'));
        if (hand) {
          /* 手里是重型（占两格）时，副武器卡不能把它顶掉 —— 否则玩家会变成
             "只有一把副武器"的空手状态，看起来就像主武器被吞了 */
          if (nd.slot === 'sub' && HS.Gear.heavyEntry(p)) return;
          /* 换重型：清空双手；重型在手时换主 / 副：也要先卸掉重型 */
          if (nd.slot === 'heavy' && p.weapons.length) {
            p.weapons.length = 0;
          } else if (nd.slot !== 'heavy' && HS.Gear.heavyEntry(p)) {
            p.weapons.length = 0;
          }
          if (nd.slot === 'main' || nd.slot === 'sub') {
            var busy = nd.slot === 'main' ? HS.Gear.mainEntry(p) : HS.Gear.subEntry(p);
            if (busy && HS.Gear.canTake(p, c.id).ok === false) {
              var idx = p.weapons.indexOf(busy);
              if (idx >= 0) p.weapons.splice(idx, 1);
            }
          }
        }
        r = HS.Gear.take(p, c.id);
        if (r === 'none') {
          /* 兜底：不管哪一步失败，都不允许空手继续打 */
          if (!p.weapons.length) HS.Gear.take(p, 'pistol');
          return;
        }
        /* 拿到一把新的主武器（或重型）之后，本局升级池不再提供换主武器 */
        if (hand && (nd.slot === 'main' || nd.slot === 'heavy')) p.mainLocked = true;
        HS.Save.addSeen('weapons', c.id);
        HS.Gear.refresh(p);
        this.recalc(p);
        return;
      }

      if (c.kind === 'synergy') {
        if (c.boost) {
          p.synLv[c.id] = (p.synLv[c.id] || 1) + 1;
        } else if (c.miss && c.miss.type === 'stat') {
          p.passives[c.miss.id] = (p.passives[c.miss.id] || 0) + 1;
        } else if (c.miss && c.miss.type === 'gear') {
          r = HS.Gear.take(p, c.miss.id);
          if (r === 'none') return;
        }
        HS.Gear.refresh(p);
        this.recalc(p);
        return;
      }
    },

    /* ================= 搜刮 ================= */

    beginSearch: function () {
      var run = this.run;
      if (!run || this.state !== 'run' || run.search) return;
      var o = run.lootTarget;
      if (!o || o.looted || o.broken) return;
      if (U.dist(o.x, o.y, run.p.x, run.p.y) > 40) return;
      var dur = 1.4;
      if (o.isRoofCrate) dur = 1.6;
      else if (o.isFurn) dur = 1.2;
      run.search = { obs: o, t: 0, dur: dur };
      HS.Audio.ui();
    },

    cancelSearch: function (msg) {
      var run = this.run;
      if (!run || !run.search) return;
      run.search = null;
      if (msg) this.bannerShow(msg, 1.4);
    },

    finishSearch: function () {
      var run = this.run;
      if (!run || !run.search) return;
      var o = run.search.obs;
      run.search = null;
      this.lootObstacle(o);
    },

    lootObstacle: function (o) {
      var run = this.run, p = run.p;
      if (!o || o.looted) return;
      o.looted = true;
      run.lootedCount++;
      var lootId = o.lootType || (o.def && o.def.loot);
      var table = D.loot[lootId];
      if (!table) return;

      var gold = U.randInt(table.gold[0], table.gold[1]);
      run.gold += gold;
      if (run.texts.length > 30) run.texts.shift();
      run.texts.push({
        x: o.x, y: o.y - o.h * 0.5 - 6, vy: -26, life: 0.9, max: 0.9,
        txt: '+' + gold + 'G', crit: true
      });
      HS.Audio.pickup();

      if (Math.random() < table.gem) {
        var n = U.randInt(2, table.gemN);
        for (var i = 0; i < n; i++) {
          run.gems.push({
            x: o.x + U.rand(-9, 9), y: o.y + U.rand(-9, 9),
            vx: U.rand(-24, 24), vy: U.rand(-24, 24),
            xp: 2, size: 1.9, dead: false, t: 0
          });
        }
      }
      if (Math.random() < table.heart) {
        run.drops.push({ kind: 'heart', x: o.x + 7, y: o.y + 7, bob: 0, life: 24, dead: false });
      }
      if (Math.random() < table.chest) {
        var cards = this.lootCards();
        this.giveLoot(cards[0], '搜刮');
      }
    },

    /**
     * 搜刮 / 宝箱的产出。
     * 主武器换过之后，升级池不再提供换主武器，这里留一条低概率的例外
     * （搜刮本来就要冒险，翻到一把新枪是最有分量的回报）。
     */
    lootCards: function () {
      var p = this.run.p;
      if (p.mainLocked && Math.random() < 0.4) {
        var c = this.rollMainDrop();
        if (c) return [c];
      }
      return this.buildChoices(1, true);
    },

    /** 搜刮产出落地：主武器要玩家点头，其它直接生效。返回是否弹了询问框 */
    giveLoot: function (card, label) {
      if (!card) return false;
      var d = card.kind === 'weaponNew' ? D.gear[card.id] : null;
      if (d && (d.slot === 'main' || d.slot === 'heavy')) {
        this.lootAsk = card;
        this.lootFrom = label || '搜刮';
        this.state = 'lootask';
        HS.Input.enabled = false;
        HS.Audio.levelup();
        return true;
      }
      this.applyChoice(card);
      this.bannerShow('搜刮到补给：' + card.name, 2.2);
      return false;
    },

    /** 搜刮翻到的主武器：yes=换上（旧主武器连同分支一起丢掉） */
    answerLoot: function (yes) {
      if (this.state !== 'lootask') return;
      var c = this.lootAsk;
      this.lootAsk = null;
      this.state = 'run';
      HS.Input.enabled = true;
      if (yes && c) {
        this.applyChoice(c);
        this.bannerShow('已换装 · ' + c.name, 2.4);
        HS.Audio.win();
      } else {
        HS.Audio.ui();
      }
    },

    /** 随机翻出一把当前没有的主武器（重型只在双手都空的时候算） */
    rollMainDrop: function () {
      var p = this.run.p;
      var cur = HS.Gear.mainEntry(p);
      var list = [], total = 0, i, id, def;
      var push = function (wid) {
        var w = D.gearWeight(wid);
        list.push({ id: wid, w: w });
        total += w;
      };
      for (i = 0; i < D.weaponPool.length; i++) {
        id = D.weaponPool[i];
        def = D.gear[id];
        if (!def || (cur && cur.id === id)) continue;
        push(id);
      }
      if (!p.weapons.length) {
        for (i = 0; i < D.heavyPool.length; i++) push(D.heavyPool[i]);
      }
      if (!list.length || total <= 0) return null;
      var roll = Math.random() * total, picked = list[list.length - 1].id;
      for (i = 0; i < list.length; i++) {
        roll -= list[i].w;
        if (roll <= 0) { picked = list[i].id; break; }
      }
      return this.makeCard({ kind: 'weaponNew', id: picked });
    },

    /* ================= 结束 ================= */

    onPlayerDown: function () {
      var run = this.run, p = run.p;
      if (p.revive > 0) {
        p.revive--;
        p.hp = Math.max(1, p.maxHp * 0.5);
        p.invuln = 2.5;
        run.shake = 10;
        this.bannerShow('备用血清生效', 2.2);
        /* 震开周围敌人 */
        for (var i = 0; i < run.enemies.length; i++) {
          var e = run.enemies[i];
          if (U.dist(e.x, e.y, p.x, p.y) < 90 && !e.boss) this.hurtEnemy(e, 999, { noCrit: true });
        }
        HS.Audio.levelup();
        return;
      }
      HS.Audio.die();
      this.finishRun(false);
    },

    finishRun: function (win) {
      if (this.state === 'result') return;
      var run = this.run, p = run.p, d = HS.Save.data;

      /* 结算金币只有两处来源，别再加"击杀 / 存活 / 精英折算"：
         ① 局内搜刮（run.gold）；② 通关奖励（每张图按难度给 30 / 50 / 80）。
         没通关就只剩搜刮那一点 —— 金币要稀缺，通关才有实感。
         通关奖励是额定值，不吃 goldMul（那是"搜刮更多"的加成，不该放大奖励）。 */
      var scavGold = Math.floor(run.gold * (p.goldMul || 1));
      var clearGold = win ? (run.map.clearGold || 0) : 0;
      var gold = scavGold + clearGold;

      d.totalKills += run.kills;
      d.gold += gold;
      d.totalGold += gold;
      d.evolutions += run.evolutions;
      if (win) d.wins++;
      if (p.level > d.bestLevel) d.bestLevel = p.level;
      if (run.kills > d.bestKills) d.bestKills = run.kills;
      if (run.t > d.bestTime) d.bestTime = run.t;

      /* 地图解锁：顺序推进 —— 通关当前这张，才解锁下一张。
         每张图单独记通关次数（mapWins），刷哪张算哪张的。 */
      if (win) {
        d.mapWins = d.mapWins || {};
        d.mapWins[run.map.id] = (d.mapWins[run.map.id] || 0) + 1;
      }
      var newMaps = [];
      for (var i = 1; i < D.mapOrder.length; i++) {
        var m = D.maps[D.mapOrder[i]];
        var prev = D.maps[D.mapOrder[i - 1]];
        if ((d.mapWins[prev.id] || 0) >= 1) {
          if (d.unlockedMaps.indexOf(m.id) < 0) newMaps.push(m);
          HS.Save.unlockMap(m.id);
        }
      }
      HS.Save.flush();

      var newAch = HS.Save.checkAch();

      /* 通关且解锁了下一张图 → selMap 直接指到新图，「再来一局」就是新区域 */
      if (win && !run.endless && newMaps.length) {
        var mi = D.mapOrder.indexOf(run.map.id);
        if (mi >= 0 && mi + 1 < D.mapOrder.length) {
          var next = D.maps[D.mapOrder[mi + 1]];
          if (d.unlockedMaps.indexOf(next.id) >= 0) this.selMap = next.id;
        }
      }

      var score = run.kills * 0.6 + p.level * 10 + run.t * 0.2 + (win ? 120 : 0);
      var grade = score >= 1000 ? 'S' : (score >= 800 ? 'A' : (score >= 600 ? 'B' : 'C'));

      run.result = {
        grade: grade,
        score: Math.round(score),
        win: win,
        endless: !!run.endless,
        gold: gold,
        scavGold: scavGold,
        clearGold: clearGold,
        time: run.t,
        kills: run.kills,
        eliteKills: run.eliteKills,
        level: p.level,
        evolutions: run.evolutions,
        looted: run.lootedCount || 0,
        newAch: newAch,
        newMap: newMaps.length ? newMaps[0].name : null,
        charName: run.char.name,
        mapName: run.map.name
      };
      this.state = 'result';
      this.run.uiT = 0;
      HS.Input.enabled = false;
      if (win) HS.Audio.win();
      HS.Save.flush();

      /* 无尽模式才进榜：普通关卡的 6 分钟是固定流程，比不出高下。
         提交是异步的，结果页先显示"上榜中"，回调把名次补进去 */
      if (run.endless) HS.Host.submitRun(run);
      else HS.Save.pushCloud();
    },

    /* ================= 排行榜 ================= */

    /**
     * 打开排行榜。数据全部由 HS.Host 提供：
     * B站 Toy 走平台榜单，微信侧未接入时展示个人最佳，网页走本地记录。
     */
    openRank: function (from) {
      this.rankFrom = from || (this.state === 'result' ? 'result' : 'title');
      HS.Host.refresh();          // Toy 的 SDK 可能是后加载的
      HS.Host.loadRank('all', false);
      this.state = 'rank';
      HS.Audio.ui();
    },

    /* ================= 点击分发 ================= */

    handleTaps: function (taps) {
      /* 首次点击才算"拿到手势"：
         1) resume() 把 AudioContext 从 suspended 里唤醒 —— 少了这一步，
            音效节点全都建在挂起的上下文里，等于全程静音（听不见的元凶）；
         2) unlockBgm() 之后由场景决定 BGM 放不放 */
      HS.Audio.resume();
      HS.Audio.unlockBgm();
      var i, j, hit, t;
      for (i = 0; i < taps.length; i++) {
        t = taps[i];
        hit = null;
        for (j = 0; j < this.hits.length; j++) {
          var r = this.hits[j];
          if (t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h) { hit = r; break; }
        }
        if (hit) this.activate(hit.id);
      }
    },

    activate: function (id) {
      var d = HS.Save.data;
      if (id === 'start') { this.state = 'mapselect'; return; }
      if (id === 'meta') { this.state = 'meta'; this.tab = 'char'; return; }
      if (id === 'rank') { this.openRank(); return; }
      if (id.indexOf('rank:period:') === 0) {
        HS.Host.loadRank(id.substring(12), false);
        HS.Audio.ui();
        return;
      }
      if (id === 'rank:retry') { HS.Host.loadRank(null, true); HS.Audio.ui(); return; }
      if (id === 'back') {
        /* 从结算页进来的，返回时回结算页；否则回标题 */
        this.state = (this.state === 'rank' && this.rankFrom === 'result') ? 'result' : 'title';
        return;
      }
      if (id === 'title') { this.state = 'title'; return; }
      if (id.indexOf('tab:') === 0) { this.tab = id.substring(4); return; }

      if (id === 'endless') { this.endless = !this.endless; HS.Audio.ui(); return; }
      if (id === 'loot') { this.beginSearch(); return; }
      if (id === 'drive') { HS.Vehicle.enter(this.run, this.run.nearVeh); return; }
      if (id === 'exitveh') { HS.Vehicle.exit(this.run); return; }
      if (id === 'stairs') {
        if (!this.run) return;
        if (this.run.p.roof) this.descendRoof();
        else this.climbRoof(this.run.stairTarget);
        return;
      }
      if (id === 'jump') { this.jumpDown(); return; }

      if (id === 'settings') { this.state = 'settings'; this.wipeAsk = false; HS.Audio.ui(); return; }
      if (id === 'set:sfx') {
        this.sfxOn = !this.sfxOn;
        HS.Audio.enabled = this.sfxOn;
        d.sfx = this.sfxOn;
        HS.Save.flush();
        if (this.sfxOn) HS.Audio.ui();
        return;
      }
      if (id === 'set:bgm') {
        this.bgmOn = !this.bgmOn;
        HS.Audio.setBgm(this.bgmOn);
        d.bgm = this.bgmOn;
        HS.Save.flush();
        if (this.bgmOn) HS.Audio.ui();
        return;
      }
      if (id === 'set:vib') {
        this.vibOn = !this.vibOn;
        P.vibrateOn = this.vibOn;
        d.vib = this.vibOn;
        HS.Save.flush();
        if (this.vibOn) HS.Audio.ui();
        return;
      }
      if (id === 'set:fx') {
        this.fxLow = !this.fxLow;
        P.fxLow = this.fxLow;
        d.fxLow = this.fxLow;
        HS.Save.flush();
        HS.Audio.ui();
        return;
      }
      if (id === 'wipe') {
        this.wipeAsk = true;
        /* 记下弹窗打开的时刻：清除按钮和弹窗按钮在不少屏幕上位置重叠，
           手快连点两下时第二下会落进"确认清除"——不加保险就是误删档 */
        this.wipeAskT = this.t;
        HS.Audio.ui();
        return;
      }
      if (id === 'wipe:no') { this.wipeAsk = false; HS.Audio.ui(); return; }
      if (id === 'wipe:yes') {
        if (this.t - (this.wipeAskT || -9) < 0.3) return;   // 刚弹出来，忽略连点
        HS.Save.reset();
        this.save = HS.Save.data;
        this.selChar = 'soldier';
        this.selMap = 'highway';
        this.sfxOn = true;
        this.bgmOn = true;
        HS.Audio.setBgm(true);
        this.vibOn = true;
        this.fxLow = false;
        HS.Audio.enabled = true;
        P.vibrateOn = true;
        P.fxLow = false;
        this.wipeAsk = false;
        this.notice('存档已清除');
        HS.Audio.hurt();
        return;
      }

      if (id.indexOf('map:') === 0) {
        this.selMap = id.substring(4);
        HS.Audio.ui();
        return;
      }
      if (id === 'launch') {
        if (d.unlockedMaps.indexOf(this.selMap) < 0) {
          this.notice('这张地图还没解锁（通关 ' + D.maps[this.selMap].unlockWins + ' 次）');
          return;
        }
        HS.Audio.ui();
        this.startRun(this.selMap, this.selChar);
        return;
      }

      if (id.indexOf('char:') === 0) {
        var cid = id.substring(5);
        if (HS.Save.hasChar(cid)) {
          this.selChar = cid;
          HS.Audio.ui();
        } else {
          var ch = D.chars[cid];
          if (d.gold >= ch.cost) {
            d.gold -= ch.cost;
            d.chars.push(cid);
            HS.Save.flush();
            this.selChar = cid;
            this.notice('已解锁 ' + ch.name);
            HS.Audio.win();
            HS.Save.checkAch();
          } else {
            this.notice('金币不足，还差 ' + (ch.cost - d.gold));
            HS.Audio.hurt();
          }
        }
        return;
      }

      if (id.indexOf('perm:') === 0) {
        var pid = id.substring(5);
        var def = null;
        for (var i = 0; i < D.perms.length; i++) if (D.perms[i].id === pid) def = D.perms[i];
        if (!def) return;
        var lvl = d.perm[pid] || 0;
        if (lvl >= def.maxLvl) return;
        var cost = def.cost(lvl);
        if (d.gold >= cost) {
          d.gold -= cost;
          d.perm[pid] = lvl + 1;
          HS.Save.flush();
          this.notice(def.name + ' 强化至 Lv' + (lvl + 1));
          HS.Audio.win();
          HS.Save.checkAch();
        } else {
          this.notice('金币不足，还差 ' + (cost - d.gold));
          HS.Audio.hurt();
        }
        return;
      }

      if (id === 'pause') {
        if (this.state === 'run') { this.state = 'paused'; HS.Input.enabled = false; }
        return;
      }
      if (id === 'resume') {
        if (this.state === 'paused') {
          this.state = 'run'; HS.Input.enabled = true; HS.Input.reset();
        }
        return;
      }
      if (id === 'restart') { this.startRun(this.selMap, this.selChar); return; }
      if (id === 'quit') { this.state = 'title'; HS.Input.enabled = false; return; }
      if (id === 'again') { this.startRun(this.selMap, this.selChar); return; }

      if (id.indexOf('card:') === 0) { this.pickChoice(parseInt(id.substring(5), 10)); return; }
      if (id === 'reroll') { this.doReroll(); return; }
      if (id === 'swap:yes') { this.confirmSwap(true); return; }
      if (id === 'swap:no') { this.confirmSwap(false); return; }
      if (id === 'loot:yes') { this.answerLoot(true); return; }
      if (id === 'loot:no') { this.answerLoot(false); return; }
    },

    render: function () {
      this.hits = [];
      if (this.state === 'run' || this.state === 'levelup' ||
          this.state === 'paused' || this.state === 'lootask') {
        HS.Render.world(this);
      }
      HS.UI.draw(this);
    }
  };

  HS.Game = Game;
  HS.RUN_TIME = RUN_TIME;
  HS.MAX_WEAPONS = MAX_WEAPONS;
  HS.MAX_PASSIVES = MAX_PASSIVES;
  HS.VERSION = '1.1.0';
})();
