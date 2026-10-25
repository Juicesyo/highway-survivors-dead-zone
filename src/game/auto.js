/**
 * 自动攻击装备运行时
 *
 * 五类行为：
 *   follow  跟随飞行，自动索敌开火
 *   orbit   贴身环绕，接触伤害（每敌独立冷却，避免一帧多段）
 *   ring    环绕火/冰带，按条带判定
 *   deploy  部署实体（炮塔 / 喷口 / 地雷 / 诱饵）
 *   zone    在尸群中心生成区域（毒 / 火 / 冰 / 黑洞）
 *   strike  天降雷击
 *   support 周期治疗 / 增幅
 *
 * 数量控制：
 *   同一件装备最多 maxStack 级（重复获取合并升级）
 *   同一 kind 的件数上限见 D.autoCaps
 *   部署型每件最多同时 2 个实体，其它实体的存在时间有限
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  var U = HS.U;
  var D = HS.Data;
  var Game = HS.Game;
  var Gear = HS.Gear;
  var Auto = {};

  var DEV_MAX = 2;              // 每件部署装备的场上实体上限
  var DEPLOY_HP_PER_SEC = 6;    // 部署装置的耐久 = 设计时长 × 6
  var WEAR_IDLE = 4;            // 闲置老化：每秒掉多少耐久
  var WEAR_CROWD = 2.6;         // 每个贴身的丧尸额外增加的每秒掉落

  Auto.countDevices = function (run, owner) {
    var n = 0;
    for (var i = 0; i < run.devices.length; i++) {
      if (run.devices[i].owner === owner && !run.devices[i].dead) n++;
    }
    return n;
  };

  /** 找最近的、同层的敌人（可跳过已被锁定的 uid） */
  function nearestFrom(x, y, range, used, skipLevel) {
    var list = Game.run.enemies, best = null, bd = range * range;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.submerged) continue;
      if (used && used[e.uid]) continue;
      if (skipLevel && !Game.sameLevel(e)) continue;
      var d = U.dist2(e.x, e.y, x, y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** 优先找被标记的敌人（无人机联动） */
  function nearestMarked(x, y, range, used) {
    var list = Game.run.enemies, best = null, bd = range * range;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.submerged || !(e.mark > 0)) continue;
      if (used && used[e.uid]) continue;
      if (!Game.sameLevel(e)) continue;
      var d = U.dist2(e.x, e.y, x, y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** 自动装备的统一伤害入口：吃 p.dmgMul / 暴击 / 联动 */
  /** 点到线段的最短距离平方（光剑是长条，命中判定不能只算基点） */
  function segDist2(px2, py2, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? ((px2 - x1) * dx + (py2 - y1) * dy) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var qx = x1 + dx * t - px2, qy = y1 + dy * t - py2;
    return qx * qx + qy * qy;
  }

  /* 元素类自动装备（火环/冰环/毒雾/火柱）的伤害：dot 与元素本来就不吃护甲 */
  function hurt(e, dmg, tag) {
    Game.hurtEnemy(e, dmg, { tag: tag || 'auto', dot: 1, ignoreArmor: 1 });
  }

  Auto.update = function (run, dt) {
    var p = run.p;
    var i;

    if (p.ampT > 0) {
      p.ampT -= dt;
      if (p.ampT <= 0) p.ampMul = 1;
    }

    /* 驾驶中自动装备也收起，避免和载具逻辑打架；
       但已经落地的装置（地雷 / 炮塔）仍要更新 */
    var active = p.autos && p.autos.length && !p.veh;

    for (i = 0; active && i < p.autos.length; i++) {
      var a = p.autos[i];
      var def = D.gear[a.id];
      if (!def) continue;
      var st = Gear.stat(a, p);
      a.st = st;
      switch (def.kind) {
        case 'follow': Auto.follow(run, p, a, def, st, dt, i); break;
        case 'orbit': Auto.orbit(run, p, a, def, st, dt); break;
        case 'ring': Auto.ring(run, p, a, def, st, dt); break;
        case 'deploy': Auto.deploy(run, p, a, def, st, dt); break;
        case 'zone': Auto.zone(run, p, a, def, st, dt); break;
        case 'strike': Auto.strike(run, p, a, def, st, dt); break;
        case 'support': Auto.support(run, p, a, def, st, dt); break;
        default: break;
      }
    }
    Auto.updateDevices(run, dt);
  };

  /* ---------------- 跟随型 ---------------- */

  Auto.follow = function (run, p, a, def, st, dt, idx) {
    a.ang += dt * (0.9 + idx * 0.15);
    a.x = p.x + Math.cos(a.ang) * st.radius;
    a.y = p.y - 7 + Math.sin(a.ang) * st.radius * 0.62;

    a.timer -= dt;
    if (a.timer > 0) return;
    a.timer = Math.max(0.12, st.cd);

    var n = Math.max(1, Math.round(st.count));
    var used = null;
    for (var k = 0; k < n; k++) {
      /* 联动「协同火力」：优先咬被标记的目标 */
      var t = null;
      if (p.syn && p.syn.droneMark) t = nearestMarked(a.x, a.y, st.range, used);
      if (!t) t = nearestFrom(a.x, a.y, st.range, used, true);
      if (!t) break;
      if (!used) used = {};
      used[t.uid] = 1;
      var ang = Math.atan2(t.y - a.y, t.x - a.x);
      if (def.id === 'wingman') {
        /* 导弹僚机：发射带追踪与爆炸的火箭 */
        run.bullets.push({
          x: a.x, y: a.y, vx: Math.cos(ang) * st.speed, vy: Math.sin(ang) * st.speed,
          dmg: st.dmg, r: 2.4, life: st.range / st.speed, max: st.range / st.speed,
          pierce: 0, color: def.color, kind: 'rocket', hit: null, dead: false,
          radius: st.width, explode: 1, homing: 2, tag: 'auto'
        });
      } else {
        Game.shoot(a.x, a.y, ang, {
          dmg: st.dmg, speed: st.speed, life: st.range / st.speed,
          r: 1.8, color: def.color, pierce: st.pierce | 0,
          /* 「强化追踪」分支：命中的目标被标记，后续伤害更高 */
          effect: st.sp && st.sp.mark ? 'mark' : null,
          homing: p.syn && p.syn.droneMark ? 1 : 0, tag: 'auto'
        });
      }
    }
  };

  /* ---------------- 环绕型 ---------------- */

  Auto.orbit = function (run, p, a, def, st, dt) {
    a.ang += (st.spin || 2.4) * dt;

    /* 周期过载（电磁轨道球）
       这是它的身份，也是它"不弱"的来源：只靠接触判定的话，贴脸的怪在环内、
       球永远够不着 —— 实测单体 DPS 只有 0.6（光刃 2.5）。
       所以每 pulse 秒朝最近的几个目标放一道电弧（最多 pulseMax 个）：
       环内优先，环外没人的话也电一个 90px 内最近的，保证单体也有输出。 */
    if (st.pulse) {
      a.pulseT = (a.pulseT || 0) + dt;
      if (a.pulseT >= st.pulse) {
        a.pulseT = 0;
        var pR = st.radius + (st.ball || 0) + 16;
        var maxT = Math.max(1, st.pulseMax || 4);
        var cand = [], pi, pe;
        for (pi = 0; pi < run.enemies.length; pi++) {
          pe = run.enemies[pi];
          if (pe.dead || !Game.sameLevel(pe)) continue;
          var pd2 = U.dist2(pe.x, pe.y, p.x, p.y);
          if (pd2 <= pR * pR) cand.push({ e: pe, d: pd2 });
        }
        /* 圈里没人 → 拉最近的一个远处目标（90px），免得"贴身时反而没伤害" */
        if (!cand.length) {
          var best = null, bestD = 90 * 90;
          for (pi = 0; pi < run.enemies.length; pi++) {
            pe = run.enemies[pi];
            if (pe.dead || !Game.sameLevel(pe)) continue;
            var bd2 = U.dist2(pe.x, pe.y, p.x, p.y);
            if (bd2 < bestD) { bestD = bd2; best = pe; }
          }
          if (best) cand.push({ e: best, d: bestD });
        }
        cand.sort(function (x, y) { return x.d - y.d; });
        var n2 = Math.min(maxT, cand.length);
        for (pi = 0; pi < n2; pi++) {
          var te = cand[pi].e;
          Game.hurtEnemy(te, st.dmg * 0.5,
            { tag: 'energy', dot: 1, ignoreArmor: 1, electric: 1 });
          if (run.chains.length < 60) {
            run.chains.push({
              pts: [{ x: p.x, y: p.y - 4 }, { x: te.x, y: te.y - 3 }],
              life: 0.2, max: 0.2, color: '#9ef0ff', w: 1
            });
          }
        }
        if (n2) {
          run.fx.push({
            kind: 'ring', x: p.x, y: p.y, r: st.radius * 0.5, max: pR,
            life: 0.3, maxLife: 0.3, color: 'rgba(158,240,255,0.55)'
          });
          HS.Audio.zap();
        }
      }
    }
    var n = Math.max(1, Math.round(st.count));
    var list = run.enemies;
    var now = run.t;

    /* 反弹盾牌：盾珠扫过敌方弹幕时把子弹原路打回去 —— 这才是"反弹"该有的样子。
       反弹弹是玩家子弹（tag auto），伤害取"盾珠伤害 / 来弹伤害 x1.4"的较大者，
       速度 x1.25，可穿透一个目标。 */
    if (def.id === 'reflectshield') {
      var eb = run.ebullets;
      for (var bi = eb.length - 1; bi >= 0; bi--) {
        var bb = eb[bi];
        if (bb.dead) continue;
        for (var k2 = 0; k2 < n; k2++) {
          var ang2 = a.ang + k2 * U.TAU / n;
          var ox = p.x + Math.cos(ang2) * st.radius;
          var oy = p.y + Math.sin(ang2) * st.radius * 0.85;
          if (U.dist2(bb.x, bb.y, ox, oy) > 169) continue;   // 13px 内算撞上盾珠
          run.bullets.push({
            x: bb.x, y: bb.y,
            vx: -bb.vx * 1.25, vy: -bb.vy * 1.25,
            dmg: Math.max(st.dmg, (bb.dmg || 4) * 1.4), r: 2.5,
            life: 1.6, max: 1.6, pierce: 1, color: '#7ee8fa',
            kind: 'reflected', age: 0, hit: null, dead: false, tag: 'auto'
          });
          run.fx.push({
            kind: 'ring', x: bb.x, y: bb.y, r: 2, max: 9,
            life: 0.16, maxLife: 0.16, color: '#7ee8fa'
          });
          HS.Audio.zap();
          bb.dead = true;
          break;
        }
      }
      U.compact(run.ebullets, 'dead');
    }

    for (var k = 0; k < n; k++) {
      var ang = a.ang + k * U.TAU / n;
      var bx = p.x + Math.cos(ang) * st.radius;
      var by = p.y + Math.sin(ang) * st.radius * 0.85;

      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.dead || !Game.sameLevel(e)) continue;
        /* 先按"离玩家的距离"粗筛：刀圈只有 radius 那么大，
           满级十片刀时逐片算距离会把开销乘十倍（后期上百只怪） */
        var edx = e.x - p.x, edy = e.y - p.y;
        var ring = st.radius + (st.blade || 0) + e.r + 10;
        if (edx * edx + edy * edy > ring * ring) continue;
        /* ball：电球有体积（+9px 判定），不像光刃那样是条线，也不该是个点 */
        var rr = e.r + 6 + (st.ball || 0);
        var d2;
        if (st.blade) {
          /* 光剑：以轨道线为中心，往内 40% / 往外 60% 各伸一截。
             只往外伸的话，贴身怪（半径内）永远打不到 —— 环绕武器的本职就是防贴脸。
             椭圆轨道（y 压 0.85）方向也要一起压，否则刃尖会偏出去 */
          var inL = st.blade * 0.4, outL = st.blade * 0.6;
          var sxb = bx - Math.cos(ang) * inL, syb = by - Math.sin(ang) * inL * 0.85;
          var tipx = bx + Math.cos(ang) * outL;
          var tipy = by + Math.sin(ang) * outL * 0.85;
          d2 = segDist2(e.x, e.y, sxb, syb, tipx, tipy);
        } else {
          d2 = U.dist2(e.x, e.y, bx, by);
        }
        if (d2 > rr * rr) continue;
        if (!e.acd) e.acd = {};
        if ((e.acd[a.uid] || 0) > now) continue;
        e.acd[a.uid] = now + 0.38;
        hurt(e, st.dmg, def.tags && def.tags.indexOf('ice') >= 0 ? 'ice' : 'auto');
        /* 命中火花：以前环绕命中只有飘字和音效，看不出"刃真的划过它了" */
        if (run.fx.length < 200) {
          run.fx.push({
            kind: 'p', x: e.x, y: e.y - e.r * 0.5,
            vx: (e.x - p.x) * 0.9, vy: (e.y - p.y) * 0.9 - 14,
            life: 0.2, max: 0.2, color: def.color || '#dfe6ee', size: 2
          });
        }
        if (st.chains) {
          /* 电弧：跳向 70px 内最近的目标。带 electric 才会在积水里继续传导，
             同时画一道电弧 —— 以前只有伤害没有表现，玩家根本不知道它在连锁。 */
          var next = nearestFrom(e.x, e.y, 70, null, true);
          if (next && next !== e) {
            Game.hurtEnemy(next, st.dmg * 0.6,
              { tag: 'energy', dot: 1, ignoreArmor: 1, electric: 1 });
            if (run.chains.length < 60) {
              run.chains.push({
                pts: [{ x: e.x, y: e.y - 3 }, { x: next.x, y: next.y - 3 }],
                life: 0.16, max: 0.16, color: '#9ef0ff', w: 1
              });
            }
          }
        }
        if (st.pull) {
          var dx = p.x - e.x, dy = p.y - e.y;
          var dd = Math.sqrt(dx * dx + dy * dy) || 1;
          e.x += dx / dd * st.pull * 0.12;
          e.y += dy / dd * st.pull * 0.12;
        }
        /* 反弹盾牌的"撞开"：把丧尸朝远离玩家的方向推开一截，Boss 不吃推 */
        if (def.id === 'reflectshield' && !e.boss) {
          var kdx = e.x - p.x, kdy = e.y - p.y;
          var kd = Math.sqrt(kdx * kdx + kdy * kdy) || 1;
          e.x += kdx / kd * 9;
          e.y += kdy / kd * 9;
          run.fx.push({
            kind: 'p', x: e.x, y: e.y - 4,
            vx: kdx / kd * 40, vy: kdy / kd * 40 - 20,
            life: 0.25, max: 0.25, color: '#7ee8fa', size: 2
          });
        }
        /* 旋转飞刀：刀圈要把贴脸的丧尸"削"出去，才算贴身防御。
           以前只有伤害没有位移，丧尸照样贴在身上啃 —— 这就是玩家说的
           "飞刀不弹开丧尸"。推开量要大于丧尸 0.38s 内走回来的距离，
           否则刚推开就被 AI 拉回原位，等于没推。 */
        if (def.id === 'orbitblade' && !e.boss) {
          var bdx = e.x - p.x, bdy = e.y - p.y;
          var bd = Math.sqrt(bdx * bdx + bdy * bdy) || 1;
          e.x += bdx / bd * 15;
          e.y += bdy / bd * 15;
          run.fx.push({
            kind: 'p', x: e.x, y: e.y - 3,
            vx: bdx / bd * 30, vy: bdy / bd * 30 - 16,
            life: 0.2, max: 0.2, color: '#dfe6ee', size: 2
          });
        }
      }
    }
  };

  /* ---------------- 环带型（火焰环 / 冰霜环） ---------------- */

  Auto.ring = function (run, p, a, def, st, dt) {
    a.tick = (a.tick || 0) + dt;
    if (a.tick < 0.4) return;
    a.tick -= 0.4;
    var R = st.radius * (p.areaMul || 1);
    var w = st.width || 7;
    var list = run.enemies;

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || !Game.sameLevel(e)) continue;
      var d = U.dist(e.x, e.y, p.x, p.y);
      if (Math.abs(d - R) > w + e.r) continue;
      hurt(e, (st.dps || 0) * 0.4, def.tags.indexOf('ice') >= 0 ? 'ice' : 'fire');
      if (def.tags.indexOf('ice') >= 0) e.synFrozen = 1;
      if (st.slow) {
        e.slow = Math.max(e.slow || 0, Math.min(0.8, st.slow + (p.chillAdd || 0)));
        e.slowT = Math.max(e.slowT || 0, 0.8 * (p.chillTime || 1));
      }
      if (def.tags.indexOf('fire') >= 0) {
        e.burn = Math.max(e.burn || 0, 1.2);
        e.burnDps = Math.max(e.burnDps || 0, (st.dps || 0) * 0.35 * (p.burnMul || 1));
      }
      if (p.syn && p.syn.critBurn) e.synBurn = 1;
    }
  };

  /* ---------------- 部署型 ---------------- */

  /**
   * 部署型：在脚边放下一个固定装置。
   * 装置不按时间自毁，而是有「耐久度」——放着不开火也会缓慢老化，
   * 被丧尸围住会掉得飞快。所以摆在空地上能撑很久，丢进尸堆里几秒就被拆了。
   */
  Auto.deploy = function (run, p, a, def, st, dt) {
    a.timer -= dt;
    if (a.timer > 0) return;
    if (Auto.countDevices(run, a.uid) >= DEV_MAX) return;
    a.timer = Math.max(3.5, st.cd * 4);

    var ang = Math.random() * U.TAU;
    var dist = 18 + Math.random() * 10;
    var x = p.x + Math.cos(ang) * dist;
    var y = p.y + Math.sin(ang) * dist;
    if (HS.World.insideSolid(x, y)) { x = p.x; y = p.y; }

    var durT = (st.dur || 14) * (p.durMul || 1);
    var hp = durT * DEPLOY_HP_PER_SEC;
    run.devices.push({
      owner: a.uid, gearId: def.id, kind: def.effect === 'lure' ? 'lure' : 'turret',
      x: x, y: y, life: durT, max: durT,
      hp: hp, maxHp: hp, wearT: 0,
      cd: 0, st: st, def: def, ang: Math.random() * U.TAU, dead: false
    });
  };

  /* ---------------- 区域型 ---------------- */

  Auto.zone = function (run, p, a, def, st, dt) {
    a.timer -= dt;
    if (a.timer > 0) return;
    a.timer = Math.max(1.5, st.cd);

    var t = nearestFrom(p.x, p.y, st.range, null, true);
    var x = t ? t.x : p.x + U.rand(-60, 60);
    var y = t ? t.y : p.y + U.rand(-60, 60);
    run.devices.push({
      owner: a.uid, gearId: def.id, kind: 'zone',
      x: x, y: y, r: (st.radius || 40) * (p.areaMul || 1),
      life: (st.dur || 4) * (p.durMul || 1), max: (st.dur || 4) * (p.durMul || 1),
      dps: (st.dps || 0) * p.dmgMul, tick: 0, slow: st.slow, pull: st.pull,
      effect: def.effect, color: def.color, dead: false
    });
  };

  /* ---------------- 打击型 ---------------- */

  Auto.strike = function (run, p, a, def, st, dt) {
    a.timer -= dt;
    if (a.timer > 0) return;
    a.timer = Math.max(0.5, st.cd);

    var n = Math.max(1, Math.round(st.count));
    var used = {};
    var did = 0;
    for (var k = 0; k < n; k++) {
      var t = nearestFrom(p.x, p.y, st.range, used, true);
      if (!t) break;
      used[t.uid] = 1;
      did++;
      run.chains.push({
        pts: [{ x: t.x, y: t.y - 44 }, { x: t.x, y: t.y }],
        life: 0.14, max: 0.14, color: def.color
      });
      Game.explode(t.x, t.y, st.radius, st.dmg, def.color,
        def.id === 'stormdevice' ? { electric: 1 } : null);
    }
    if (did) HS.Audio.zap();
  };

  /* ---------------- 辅助型 ---------------- */

  Auto.support = function (run, p, a, def, st, dt) {
    a.timer -= dt;
    if (a.timer > 0) return;
    a.timer = Math.max(2, st.cd);

    if (def.id === 'automed') {
      if (p.hp >= p.maxHp) return;
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * (st.heal || 0.12));
      Game.bannerShow('自动治疗 +' + Math.round((st.heal || 0.12) * 100) + '%', 1.1);
      HS.Audio.pickup();
    } else {
      p.ampMul = 1 + (st.amp || 0.2);
      p.ampT = (st.dur || 5) * (p.durMul || 1);
      Game.bannerShow('增幅器过载 · 伤害提升', 1.2);
      HS.Audio.levelup();
    }
  };

  /* ---------------- 实体更新 ---------------- */

  Auto.updateDevices = function (run, dt) {
    var list = run.devices;
    if (!list || !list.length) return;
    var p = run.p;

    for (var i = 0; i < list.length; i++) {
      var dv = list[i];
      if (dv.dead) continue;

      /* 布置型走耐久度（放着会老化，被围住掉得更快），其余走倒计时 */
      if (dv.maxHp > 0) {
        dv.wearT += dt;
        if (dv.wearT >= 0.25) {
          var near = 0;
          for (var qi = 0; qi < run.enemies.length && near < 5; qi++) {
            var en = run.enemies[qi];
            if (en.dead || !Game.sameLevel(en)) continue;
            var dz = U.dist2(en.x, en.y, dv.x, dv.y);
            var rad = 15 + en.r;
            if (dz < rad * rad) near++;
          }
          dv.hp -= dv.wearT * (WEAR_IDLE + WEAR_CROWD * near);
          dv.wearT = 0;
          if (dv.hp <= 0) {
            dv.hp = 0;
            dv.dead = true;
            if (run.fx.length < 180) {
              run.fx.push({
                kind: 'p', x: dv.x, y: dv.y - 2,
                vx: U.rand(-26, 26), vy: U.rand(-34, -6),
                life: 0.5, max: 0.5, color: '#6b7686', size: 2
              });
            }
            continue;
          }
        }
      } else {
        dv.life -= dt;
        if (dv.life <= 0) {
          /* 炮击标记：时间到才真正落弹 */
          if (dv.kind === 'delay') {
            Game.explode(dv.x, dv.y, dv.r || 48, dv.dmg || 60, dv.color || '#ffd166');
          }
          dv.dead = true;
          continue;
        }
      }

      if (dv.kind === 'turret') {
        /* 炮台升级后已经在场上的装置也要跟着变强，否则玩家点了半天卡没反应 */
        if (dv.owner) {
          var ownerAuto = null;
          for (var oi = 0; oi < p.autos.length; oi++) {
            if (p.autos[oi].uid === dv.owner) { ownerAuto = p.autos[oi]; break; }
          }
          if (ownerAuto) {
            var ost = Gear.stat(ownerAuto, p);
            if (ost) dv.st = ost;
          }
        }
        var st = dv.st;
        dv.cd -= dt;
        if (dv.cd > 0) continue;
        dv.cd = Math.max(0.1, st.cd);
        var t = nearestFrom(dv.x, dv.y, st.range, null, true);
        if (!t) continue;
        var ang = Math.atan2(t.y - dv.y, t.x - dv.x);
        var gid = dv.gearId;

        if (gid === 'rocketturret') {
          run.bullets.push({
            x: dv.x, y: dv.y - 2, vx: Math.cos(ang) * st.speed, vy: Math.sin(ang) * st.speed,
            dmg: st.dmg, r: 2.4, life: st.range / st.speed, max: st.range / st.speed,
            pierce: 0, color: '#ffd166', kind: 'rocket', hit: null, dead: false,
            radius: st.radius, explode: 1, homing: 2, tag: 'auto'
          });
          HS.Audio.weapon('launcher');
        } else if (gid === 'railturret') {
          run.chains.push({
            pts: [{ x: dv.x, y: dv.y - 2 }, { x: dv.x + Math.cos(ang) * st.range, y: dv.y + Math.sin(ang) * st.range }],
            life: 0.1, max: 0.1, color: '#b6f5ff', straight: 1
          });
          HS.Audio.weapon('railgun');
          for (var q = 0; q < run.enemies.length; q++) {
            var e2 = run.enemies[q];
            if (e2.dead || !Game.sameLevel(e2)) continue;
            var dx = e2.x - dv.x, dy = e2.y - dv.y;
            var along = dx * Math.cos(ang) + dy * Math.sin(ang);
            if (along < 0 || along > st.range) continue;
            if (Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang)) > 5 + e2.r) continue;
            Game.hurtEnemy(e2, st.dmg, { tag: 'energy', dot: 1, ignoreArmor: 1, electric: 1 });
          }
        } else if (gid === 'flamenozzle') {
          for (var q2 = 0; q2 < run.enemies.length; q2++) {
            var e3 = run.enemies[q2];
            if (e3.dead) continue;
            var d3 = U.dist(e3.x, e3.y, dv.x, dv.y);
            if (d3 > st.range + e3.r) continue;
            hurt(e3, st.dmg, 'fire');
            e3.burn = Math.max(e3.burn || 0, 1.2);
            e3.burnDps = Math.max(e3.burnDps || 0, st.dmg * 0.4);
          }
          /* 喷口是"贴地喷火"：往四周喷一圈火苗，不然只有伤害数字，看不见在烧 */
          if (run.fx.length < 200) {
            for (var fp = 0; fp < 4; fp++) {
              var fa = U.rand(0, U.TAU);
              var fd = U.rand(6, 18);
              run.fx.push({
                kind: 'p',
                x: dv.x + Math.cos(fa) * fd, y: dv.y - 1 + Math.sin(fa) * fd * 0.8,
                vx: Math.cos(fa) * U.rand(26, 70), vy: Math.sin(fa) * U.rand(18, 46) - 16,
                life: U.rand(0.24, 0.42), max: 0.42,
                color: Math.random() < 0.4 ? '#ffd166' : (Math.random() < 0.6 ? '#ff8b3d' : '#ff4d2a'),
                size: Math.random() < 0.5 ? 1.5 : 2.5
              });
            }
          }
          if (run.t - (dv.sfxT || -1) > 0.16) {
            dv.sfxT = run.t;
            HS.Audio.flame();
          }
        } else {
          var cnt = Math.max(1, Math.round(st.count));
          for (var k = 0; k < cnt; k++) {
            Game.shoot(dv.x, dv.y - 2, ang + (k - (cnt - 1) / 2) * 0.08, {
              dmg: st.dmg, speed: st.speed, life: st.range / st.speed,
              r: 1.8, color: '#ffd166', pierce: st.pierce | 0, tag: 'auto'
            });
          }
          /* 炮台开火也要有声音，不然只有子弹飞出去 */
          if (run.t - (dv.sfxT || -1) > 0.2) {
            dv.sfxT = run.t;
            HS.Audio.weapon('turret');
          }
        }
      } else if (dv.kind === 'zone') {
        dv.tick += dt;
        if (dv.tick >= 0.35) {
          dv.tick -= 0.35;
          for (var j = 0; j < run.enemies.length; j++) {
            var ez = run.enemies[j];
            if (ez.dead || !Game.sameLevel(ez)) continue;
            var dzz = U.dist(ez.x, ez.y, dv.x, dv.y);
            if (dzz > dv.r + ez.r) continue;
            Game.hurtEnemy(ez, dv.dps * 0.35, { silent: true, dot: 1, ignoreArmor: 1, tag: dv.effect === 'fire' ? 'fire' : 'auto' });
            if (dv.slow) {
              ez.slow = Math.max(ez.slow || 0, Math.min(0.8, dv.slow + (p.chillAdd || 0)));
              ez.slowT = Math.max(ez.slowT || 0, 0.7 * (p.chillTime || 1));
            }
            if (dv.effect === 'fire') {
              ez.burn = Math.max(ez.burn || 0, 1.2);
              ez.burnDps = Math.max(ez.burnDps || 0, dv.dps * 0.3 * (p.burnMul || 1));
            }
            if (dv.effect === 'ice') ez.synFrozen = 1;
            if (dv.pull) {
              var ddx = dv.x - ez.x, ddy = dv.y - ez.y;
              var dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
              ez.x += ddx / dd * dv.pull * 0.1;
              ez.y += ddy / dd * dv.pull * 0.1;
            }
          }
          if (Math.random() < 0.6 && run.fx.length < 180) {
            run.fx.push({
              kind: 'p',
              x: dv.x + U.rand(-dv.r, dv.r) * 0.7,
              y: dv.y + U.rand(-dv.r, dv.r) * 0.6,
              vx: U.rand(-6, 6), vy: U.rand(-16, -4),
              life: 0.5, max: 0.5, color: dv.color || '#8ce99a', size: 1.5
            });
          }
        }
      } else if (dv.kind === 'lure') {
        if (!dv.warned) {
          dv.warned = true;
          Game.bannerShow('诱饵已投放 · 尸群被吸引', 1.4);
        }
      } else if (dv.kind === 'mine') {
        for (var m = 0; m < run.enemies.length; m++) {
          var em = run.enemies[m];
          if (em.dead || !Game.sameLevel(em)) continue;
          if (U.dist2(em.x, em.y, dv.x, dv.y) < (14 + em.r) * (14 + em.r)) {
            dv.dead = true;
            Game.explode(dv.x, dv.y, dv.r, dv.dmg, dv.color);
            break;
          }
        }
      }
    }

    /* 就地压缩，避免每帧新建数组 */
    var n2 = 0;
    for (var w = 0; w < list.length; w++) {
      if (!list[w].dead) list[n2++] = list[w];
    }
    list.length = n2;
  };

  /* ---------------- 投掷类实体 ---------------- */

  Game.spawnLure = function (x, y, dur, radius) {
    this.run.devices.push({
      kind: 'lure', owner: 0, gearId: 'lure', x: x, y: y,
      life: dur, max: dur, r: radius || 30, dead: false
    });
  };

  Game.dropMine = function (p, dmg, radius, color) {
    var run = this.run;
    var ang = Math.random() * U.TAU;
    var x = p.x + Math.cos(ang) * 16;
    var y = p.y + Math.sin(ang) * 16;
    run.devices.push({
      kind: 'mine', owner: 0, gearId: 'mine', x: x, y: y,
      life: 26, max: 26, r: radius || 30, dmg: dmg, color: color || '#e3b23c', dead: false
    });
  };

  HS.Auto = Auto;
})();
