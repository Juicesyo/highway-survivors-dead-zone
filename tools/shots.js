/**
 * 文档截图工具 —— 用真实浏览器（Edge / Chrome）跑构建好的单文件预览版，按状态出图。
 * 用法: node tools/shots.js            # 全量出图到 docs/screenshots/
 *       node tools/shots.js title boss # 只出指定几张
 *
 * 依赖 puppeteer-core（不装进项目，走全局 / 托管 workspace 的 node_modules）：
 *   NODE_PATH=<...>/node_modules node tools/shots.js
 * 这一步只用于产出文档图，和打包、运行时都无关。
 *
 * 为什么不复用 tools/smoke.js 的画布桩：那是逻辑桩，不栅格化像素，
 * 出不了图。截图必须走真实 canvas 渲染。
 */
const fs = require('fs');
const path = require('path');

function loadPuppeteer() {
  const tries = ['puppeteer-core', 'puppeteer'];
  for (const m of tries) {
    try { return require(m); } catch (e) { /* 继续找 */ }
  }
  console.error('找不到 puppeteer-core。请设置 NODE_PATH 指向含该包的 node_modules，');
  console.error('例如: NODE_PATH=C:/Users/<你>/.workbuddy/binaries/node/workspace/node_modules');
  process.exit(1);
}

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

const ROOT = path.resolve(__dirname, '..');
/* 直接截单文件构建产物：图集与 BGM 全内联，file:// 下不用起服务 */
const HTML = path.join(ROOT, 'dist', 'highway-survivors.html');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const VIEW = { width: 390, height: 844, deviceScaleFactor: 2 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 全自动开局：把所有地图解锁，免得截图时还要先通关一次 */
const unlockAll = `(function () {
  HS.Save.data.unlockedMaps = ['highway', 'night', 'desert', 'flood', 'tunnel'];
  HS.Save.data.gold = 460;
  HS.Save.data.chars = HS.Save.data.chars || [];
  return true;
})()`;

/* ---- 每个状态怎么摆 ---- */
/* 站桩太久近身怪会被清空，画面很空；出图前往玩家周围补一圈，
   settle 让它们走两步、武器开一枪再截。 */
const surround = types => `(function () {
  var G = HS.Game, r = G.run; if (!r) return 'no-run';
  var p = r.p, kinds = ${JSON.stringify(types)};
  for (var i = 0; i < 11; i++) {
    var a = i * 0.571 + Math.random() * 0.35;
    var d = 58 + Math.random() * 62;
    G.spawnEnemy(kinds[i % kinds.length], i === 3, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
  }
  return r.enemies.length + ' enemies';
})()`;

const STEPS = [
  {
    name: 'title',
    desc: '标题页：主视觉 + 研究所 / 排行榜 / 设置',
    act: null,
    wait: 900
  },
  {
    name: 'mapselect',
    desc: '选图页：五张地图按通关顺序解锁',
    act: `HS.Game.activate('start')`,
    wait: 500
  },
  {
    name: 'run',
    desc: '末世街区：局内，尸群围上来、主武器自动开火',
    act: `HS.Game.startRun('highway', 'whale')`,
    wait: 6000,
    fill: surround(['walker', 'walker', 'runner', 'brute', 'vomiter']),
    settle: 1300
  },
  {
    name: 'cheer',
    desc: '搜刮成功：鲸鱼娘换开心脸原地蹦一下（默认是严肃脸）',
    act: `HS.Game.startRun('highway', 'whale')`,
    wait: 4200,
    fill: `(function () {
      var G = HS.Game, p = G.run.p;
      G.state = 'run';
      G.run.enemies.length = 0;
      p.cheerT = p.cheerMax * 0.62;      // 停在半空，截到"跳起来"的那一帧
      return 'cheer';
    })()`,
    settle: 60
  },
  {
    name: 'execute',
    desc: '处决：血线以下的敌人一命中就当场斩杀',
    act: `HS.Game.startRun('highway', 'whale')`,
    wait: 5200,
    fill: `(function () {
      var G = HS.Game, p = G.run.p;
      G.state = 'run';
      p.passives.execute = 4; G.recalc(p);
      G.run.enemies.length = 0;
      var ids = [];
      for (var i = 0; i < 5; i++) {
        var e = G.spawnEnemy('walker', false, p.x + 30 + (i % 3) * 20, p.y - 26 + i * 15);
        e.maxHp = 100; e.hp = 18; e.armor = 0;
        ids.push(e.uid);
      }
      /* 只打前三只：血线以下直接处决，后两只留着做对照 */
      for (var k = 0; k < 3; k++) {
        var t = null;
        for (var j = 0; j < G.run.enemies.length; j++) {
          if (G.run.enemies[j].uid === ids[k]) t = G.run.enemies[j];
        }
        if (t) G.hurtEnemy(t, 1, { noCrit: true });
      }
      return 'exec=' + G.run.kills;
    })()`,
    settle: 60
  },
  {
    name: 'railorb',
    desc: '电磁轨道球：过载放电拉出电弧，贴脸的怪也照打',
    act: `HS.Game.startRun('highway', 'whale')`,
    wait: 5200,
    fill: `(function () {
      var G = HS.Game, p = G.run.p, i;
      G.state = 'run';
      p.autos.length = 0;
      p.autos.push({ id: 'railorb', lvl: 5, timer: 0, up: {}, ang: 0, uid: 21 });
      HS.Gear.refresh(p); G.recalc(p);
      G.run.enemies.length = 0;
      G.run.chains.length = 0;
      for (i = 0; i < 6; i++) {
        var a = i / 6 * Math.PI * 2;
        var e = G.spawnEnemy('walker', false, p.x + Math.cos(a) * 42, p.y + Math.sin(a) * 36);
        e.hp = e.maxHp = 1e9;
        e.speed = 0;
      }
      /* 手动触发一次过载，把电弧和扩散环摆到画面里 */
      p.autos[0].pulseT = 99;
      HS.Auto.update(G.run, 1 / 60);
      HS.Auto.update(G.run, 1 / 60);
      return 'chains=' + G.run.chains.length;
    })()`,
    settle: 40
  },
  {
    name: 'levelup',
    desc: '升级三选一：卡面 + 底部重抽',
    act: `(function () {
      var G = HS.Game;
      G.startRun('highway', 'whale');   // 单独出这一张时也要先建局面
      G.state = 'run';
      G.gainXp(70);
      return G.state;
    })()`,
    wait: 900
  },
  {
    name: 'boss',
    desc: 'Boss 入场：顶部血条、精英杂兵、爆炸特效',
    act: `(function () {
      var G = HS.Game, guard = 0;
      if (!G.run) G.startRun('highway', 'whale');   // 单独出这一张时先开局
      while (G.state === 'levelup' && guard++ < 20) {
        G.pickChoice(0);
        if (G.confirm) G.confirmSwap(true);
      }
      G.confirm = null;
      G.state = 'run';
      G.run.t = 352;
      G.run.kills = 96;
      G.spawnBoss();
      var b = G.run.boss, p = G.run.p;
      p.invuln = 90;                                // 截图期间别被 Boss 秒了
      p.hp = p.maxHp;
      if (b) { b.x = p.x - 8; b.y = p.y + 118; }   // 拉到镜头里，别让它在屏幕外走过来
      return (b ? b.def.id : 'none') + ' / ' + G.state;
    })()`,
    wait: 3200,
    fill: surround(['walker', 'runner', 'walker', 'brute']),
    settle: 1100
  },
  {
    name: 'result',
    desc: '结算页：存活时间 / 击杀 / 等级 / 搜刮 + 通关奖励',
    act: `(function () {
      var G = HS.Game;
      if (!G.run) G.startRun('highway', 'whale');
      G.run.t = 347;
      G.run.kills = 612; G.run.eliteKills = 7; G.run.looted = 11; G.run.gold = 58;
      G.run.p.level = 24;
      G.run.bossKilled = true;
      G.finishRun(true);
      if (G.run.result) G.run.result.looted = 11;   // 让结算页的「搜刮处数」跟金币对得上
      return G.state;
    })()`,
    wait: 900
  },
  {
    name: 'night',
    desc: '死区之夜：光照收窄、射程惩罚',
    act: `HS.Game.startRun('night', 'soldier')`,
    wait: 5000,
    fill: surround(['walker', 'runner', 'vomiter', 'walker']),
    settle: 1300
  },
  {
    name: 'desert',
    desc: '荒漠公路：直路 + 路边房屋 + 持枪匪徒',
    act: `HS.Game.startRun('desert', 'hunter')`,
    wait: 5000,
    fill: surround(['terrorist', 'walker', 'terrorist', 'runner']),
    settle: 1500
  },
  {
    name: 'flood',
    desc: '锈水高速：积水反光、半沉车辆、水鬼与呕酸尸',
    act: `HS.Game.startRun('flood', 'soldier')`,
    wait: 5200,
    fill: surround(['drowner', 'walker', 'vomiter', 'drowner', 'brute']),
    settle: 1500
  },
  {
    name: 'flooddive',
    desc: '水鬼潜渡：水下只剩一圈涟漪，正在横穿深水靠近',
    act: `HS.Game.startRun('flood', 'soldier')`,
    wait: 5200,
    fill: `(function () {
      var G = HS.Game, p = G.run.p;
      G.state = 'run';
      var a = G.spawnEnemy('drowner', false, p.x + 96, p.y + 12);
      a.subState = 2; a.subT = 99; a.submerged = true;
      a.subAng = Math.atan2(p.y - a.y, p.x - a.x);
      var b = G.spawnEnemy('drowner', false, p.x - 96, p.y + 34);
      b.subState = 1; b.subT = 0.3;
      var c = G.spawnEnemy('drowner', false, p.x + 22, p.y - 108);
      c.subState = 2; c.subT = 99; c.submerged = true;
      c.subAng = Math.PI * 0.5;
      for (var i = 0; i < 5; i++) G.spawnEnemy('walker', false,
        p.x + (i % 2 ? 1 : -1) * (40 + i * 22), p.y - 62 + i * 18);
      return a.uid + '/' + b.uid + '/' + c.uid;
    })()`,
    settle: 380
  },
  {
    name: 'floodwade',
    desc: '深水能走了：蹚水只剩三成速度，脚下留着涟漪',
    act: `HS.Game.startRun('flood', 'soldier')`,
    wait: 5200,
    fill: `(function () {
      var G = HS.Game, p = G.run.p, i;
      G.state = 'run';
      var spot = null;
      for (i = 0; i < 260 && !spot; i++) {
        var x = 96 + (i % 44) * 2;
        var y = -70 + Math.floor(i / 44) * 16;
        if (HS.Water.zone(x, y, G.run) === 2) spot = { x: x, y: y };
      }
      if (spot) { p.x = spot.x; p.y = spot.y; }
      p.gait = 1;
      /* 连踩两脚：两批波纹错开相位，画面里才看得出"在蹚水" */
      for (i = 0; i < 2; i++) { p.wadeT = 0; HS.Water.update(G.run, 1 / 60); }
      for (i = 0; i < 2; i++) {
        G.spawnEnemy('walker', false, p.x + 74 + i * 16, p.y - 44 + i * 30);
      }
      G.spawnEnemy('drowner', false, p.x - 96, p.y + 26);
      return 'z=' + HS.Water.zone(p.x, p.y, G.run) +
        ' spd=' + HS.Water.speed(p, G.run).toFixed(2);
    })()`,
    settle: 90
  },
  {
    name: 'launcher',
    desc: '榴弹发射器：从枪口打出去（后坐 + 枪口焰），不再做投掷动作',
    act: `HS.Game.startRun('highway', 'whale')`,
    wait: 5200,
    fill: `(function () {
      var G = HS.Game, p = G.run.p;
      G.state = 'run';
      HS.Gear.clearHands(p);
      HS.Gear.take(p, 'gl');
      G.recalc(p);
      G.run.vehicles.length = 0;
      G.run.enemies.length = 0;
      G.spawnEnemy('walker', false, p.x + 96, p.y - 34);
      G.spawnEnemy('walker', false, p.x + 112, p.y + 6);
      p.aimA = -0.2; p.facing = 1;
      p.throws.length = 0;
      var ent = HS.Gear.mainEntry(p);
      HS.Gear.fire(ent, HS.Data.gear[ent.id], HS.Gear.stat(ent, p), false);
      /* 让炮弹飞出去一小段，画面里能看到弹体 */
      for (var f = 0; f < 8; f++) G.updateBullets(1 / 60);
      return 'throws=' + p.throws.length + ' shells=' + G.run.bullets.length;
    })()`,
    settle: 40
  },
  {
    name: 'harpoon',
    desc: '鱼叉枪：命中把敌人拽近，拖出一道锁链',
    act: `HS.Game.startRun('desert', 'soldier')`,
    wait: 5200,
    fill: `(function () {
      var G = HS.Game, p = G.run.p;
      G.state = 'run';
      HS.Gear.clearHands(p);
      HS.Gear.take(p, 'harpoon');
      G.recalc(p);
      G.run.enemies.length = 0;
      G.run.chains.length = 0;
      G.run.vehicles.length = 0;     // 别让路边车挡下这发叉
      var e = G.spawnEnemy('walker', false, p.x + 96, p.y - 96);
      e.hp = e.maxHp = 1e9;
      e.speed = 0;
      p.aimA = -Math.PI / 4; p.facing = 1;   // 斜着射，锁链才不和枪管重叠
      var ent = HS.Gear.mainEntry(p);
      HS.Gear.fire(ent, HS.Data.gear[ent.id], HS.Gear.stat(ent, p), true);
      for (var f = 0; f < 40 && G.run.bullets.length; f++) G.updateBullets(1 / 60);
      var d = Math.hypot(e.x - p.x, e.y - p.y);
      /* 万一这发被道具挡下（街上有隔离墩），直接走命中结算，保证图上有锁链 */
      if (d > 120) { G.bulletEffect({ effect: 'pull' }, e, p); d = Math.hypot(e.x - p.x, e.y - p.y); }
      return 'dist=' + Math.round(d);
    })()`,
    settle: 40
  },
  {
    name: 'floodprops',
    desc: '锈水高速路面道具：侧翻车、瓦砾、排水管，车不再一律顺着路摆',
    act: `HS.Game.startRun('flood', 'soldier')`,
    wait: 5200,
    fill: `(function () {
      var G = HS.Game, p = G.run.p, buf = [];
      G.state = 'run';
      var best = null, bestN = -1;
      for (var x = -900; x <= 900; x += 56) {
        for (var y = -900; y <= 900; y += 56) {
          buf.length = 0;
          HS.World.queryRect(x - 104, y - 82, x + 104, y + 82, buf);
          var n = 0, kinds = '';
          for (var i = 0; i < buf.length; i++) { n++; kinds += buf[i].type + ','; }
          if (kinds.indexOf('tipped') < 0) continue;
          if (n > bestN) { bestN = n; best = { x: x, y: y }; }
        }
      }
      if (best) {
        for (var r = 0; r < 40; r++) {
          var a = r * 2.4, rr = r * 4;
          var tx = best.x + Math.cos(a) * rr, ty = best.y + Math.sin(a) * rr;
          if (HS.Water.zone(tx, ty, G.run) !== 2 && !HS.World.insideSolid(tx, ty)) {
            p.x = tx; p.y = ty; break;
          }
        }
      }
      for (var k = 0; k < 4; k++) {
        G.spawnEnemy('walker', false, p.x + (k % 2 ? 1 : -1) * (48 + k * 14), p.y + 40 + k * 10);
      }
      return (best ? 'props=' + bestN : 'none');
    })()`,
    settle: 420
  },
  {
    name: 'chainbolt',
    desc: '连锁闪电：蓄满几次开火就拉出一道电弧，连跳多个目标',
    act: `HS.Game.startRun('flood', 'soldier')`,
    wait: 5200,
    fill: `(function () {
      var G = HS.Game, p = G.run.p;
      G.state = 'run';
      p.passives.chainbolt = 3; G.recalc(p);
      G.run.enemies.length = 0;
      for (var i = 0; i < 6; i++) {
        G.spawnEnemy('walker', false, p.x + 30 + (i % 3) * 24, p.y - 44 + i * 18);
      }
      G.run.chains.length = 0;
      G.chainBolt(36, 5);
      return 'chains=' + G.run.chains.length;
    })()`,
    settle: 90
  },
  {
    name: 'floodboss',
    desc: '断堤巨斧：双斧交叉斩的扇形预警与深水坑',
    act: `(function () {
      var G = HS.Game, guard = 0;
      G.startRun('flood', 'soldier');
      while (G.state === 'levelup' && guard++ < 20) {
        G.pickChoice(0);
        if (G.confirm) G.confirmSwap(true);
      }
      G.state = 'run';
      G.run.t = 355; G.run.kills = 188;
      G.spawnBoss();
      var b = G.run.boss, p = G.run.p;
      p.invuln = 90; p.hp = p.maxHp;
      if (b) {
        b.x = p.x - 6; b.y = p.y + 104;
        b.aSt = 1; b.aT = 2.2; b.aAim = Math.atan2(p.y - b.y, p.x - b.x);
        HS.Water.breakTerrain(p.x + 84, p.y + 26, 34, G.run);
        HS.Water.breakTerrain(p.x - 96, p.y - 30, 28, G.run);
      }
      return (b ? b.def.id : 'none') + ' / ' + G.state;
    })()`,
    wait: 900,
    fill: surround(['drowner', 'walker', 'drowner']),
    settle: 650
  },
  {
    name: 'floodswing',
    desc: '断堤巨斧：交叉斩挥出去的那一帧 + 被砸烂的地面',
    act: `(function () {
      var G = HS.Game, guard = 0;
      G.startRun('flood', 'soldier');
      while (G.state === 'levelup' && guard++ < 20) {
        G.pickChoice(0);
        if (G.confirm) G.confirmSwap(true);
      }
      G.state = 'run';
      G.run.t = 355;
      G.spawnBoss();
      var b = G.run.boss, p = G.run.p;
      p.invuln = 90; p.hp = p.maxHp;
      if (b) {
        b.x = p.x - 4; b.y = p.y + 96;
        b.aSt = 5; b.aT = 0.13;
        b.aAim = Math.atan2(p.y - b.y, p.x - b.x);
        HS.Water.breakTerrain(p.x + 62, p.y + 26, 30, G.run);
        HS.Water.breakTerrain(p.x - 70, p.y - 34, 24, G.run);
        HS.Water.breakTerrain(p.x + 10, p.y + 62, 20, G.run);
      }
      return (b ? b.def.id : 'none') + ' / breaks=' + G.run.breaks.length;
    })()`,
    wait: 60,
    settle: 60
  },
  {
    name: 'tunnel',
    desc: '公路隧道：双侧连续衬砌 + 顶灯光池 + 自爆尸',
    act: `HS.Game.startRun('tunnel', 'whale')`,
    wait: 5000,
    fill: `(function () {
      var G = HS.Game, p = G.run.p, i;
      G.state = 'run';
      for (i = 0; i < 6; i++) {
        G.spawnEnemy('bomber', false, p.x + (i % 2 ? 1 : -1) * (34 + i * 16), p.y - 40 - i * 20);
      }
      for (i = 0; i < 5; i++) {
        G.spawnEnemy('walker', false, p.x + (i % 2 ? 1 : -1) * (26 + i * 14), p.y + 46 + i * 16);
      }
      var v = G.spawnEnemy('vomiter', false, p.x - 62, p.y - 96);
      v.speed = 0;
      return G.run.map.id;
    })()`,
    settle: 900
  },
  {
    name: 'rings',
    desc: '冰霜环（蓝 + 冰晶）与火焰环（橙 + 火星）分家后的对比',
    act: `(function () {
      var G = HS.Game;
      G.startRun('highway', 'whale');
      G.state = 'run';
      G.run.vehHint = true; G.bannerT = 0; G.run.eventT = 999;
      var p = G.run.p;
      p.invuln = 1e9; p.hp = p.maxHp;
      HS.Gear.clearHands(p);
      p.weapons.length = 0; p.autos.length = 0;
      p.autos.push({ id: 'frostring', lvl: 1, up: {} });
      p.autos.push({ id: 'firering', lvl: 1, up: {} });
      G.recalc(p);
      G.run.enemies.length = 0;
      for (var i = 0; i < 10; i++) {
        var a = i / 10 * Math.PI * 2;
        var e = G.spawnEnemy('walker', false, p.x + Math.cos(a) * 64, p.y + Math.sin(a) * 64);
        e.speed = 0;
        e.hp = e.maxHp;
      }
      return 'rings';
    })()`,
    wait: 700,
    settle: 300
  },
  {
    name: 'meltbeam',
    desc: '熔核过载（红莲进化）：光束烧到发白，穿透整排并叠熔核',
    act: `(function () {
      var G = HS.Game;
      G.startRun('highway', 'whale');
      G.state = 'run';
      var p = G.run.p;
      p.invuln = 1e9;
      p.weapons.length = 0;
      p.weapons.push({ id: 'redlaser_x', lvl: 1, up: {}, slot: 'main', timer: 0 });
      p.autos.length = 0;
      G.recalc(p);
      G.run.enemies.length = 0;
      G.run.eventT = 999;
      /* 一排怪，让"穿透整排"看得见 */
      for (var i = 0; i < 5; i++) {
        var e = G.spawnEnemy('walker', false, p.x + 46 + i * 26, p.y - 4 + i * 2);
        e.speed = 0; e.maxHp = 9999; e.hp = 9999;
      }
      /* 手动推进到"刚放出一跳" */
      for (var k = 0; k < 25; k++) {
        G.run.t = 20 + k * 0.08;
        G.updateWeapons(1 / 60);
      }
      /* 持续光束现在是一条常驻的激光（p.beamHold，见 render 的 drawBeamHold），
         不再靠 run.chains 里 0.12s 的闪线，所以这里不需要延长任何东西 */
      return 'melt beamHold=' + (p.beamHold ? p.beamHold.life.toFixed(2) : 'null') +
        ' w=' + (p.beamHold ? p.beamHold.w : '-');
    })()`,
    wait: 16
  },
  {
    name: 'axecrack',
    desc: '断堤巨斧交叉斩：地上留的是沿斧刃划过的弧裂纹',
    act: `(function () {
      var G = HS.Game;
      G.startRun('flood', 'whale');
      G.state = 'run';
      var p = G.run.p;
      p.invuln = 1e9;
      G.run.enemies.length = 0;
      G.run.eventT = 999;
      var b = G.spawnEnemy('axeboss', false, p.x + 90, p.y + 6);
      /* spawnEnemy 不打 boss 标记，不打的话 BOSS 状态机整个不跑 */
      b.boss = true;
      b.aSt = 1; b.aT = 0.02; b.aAim = Math.PI; b.aCleaveCd = 9; b.aLeapCd = 99;
      for (var i = 0; i < 4; i++) G.updateEnemies(1 / 60);
      b.aSt = 0; b.aCleaveCd = 99; b.aLeapCd = 99; b.speed = 0;
      return 'crack';
    })()`,
    wait: 260
  },
  {
    name: 'evocard',
    desc: '升级三选一里的进化卡：炫彩流动边框',
    act: `(function () {
      var G = HS.Game, D = HS.Data;
      G.startRun('highway', 'whale');
      G.state = 'run';
      var p = G.run.p;
      p.weapons.length = 0;
      p.weapons.push({ id: 'smg', lvl: 5, up: {}, slot: 'main', timer: 0 });
      p.autos.length = 0;
      G.recalc(p);
      var edef = D.gear.smg_x, bdef = D.gear.smg;
      G.run.choices = [
        { kind: 'evolve', id: 'smg_x', baseId: 'smg', name: edef.name,
          sub: '进化 · ' + bdef.name, icon: edef.icon || 'smg', color: edef.color || '#ff9f43',
          desc: edef.desc, rare: true, src: '进化' },
        { kind: 'passive', id: 'haste', name: '快速换弹', sub: '攻速 +10%',
          icon: 'haste', color: '#7ee8fa', desc: '攻击间隔再缩短一档', rare: false },
        { kind: 'gearLevel', id: 'smg', name: '脉冲冲锋枪 Lv.4', sub: '武器专属',
          icon: 'smg', color: '#ff9f43', desc: '这把枪伤害 +16%', rare: false }
      ];
      G.state = 'levelup';
      G.uiT = 2.2;
      return 'evolve';
    })()`,
    wait: 500
  },
  {
    name: 'drownerguard',
    desc: '水鬼出水保护：身上那层淡青水膜就是"现在打不中"的信号',
    act: `(function () {
      var G = HS.Game;
      G.startRun('flood', 'whale');
      G.state = 'run';
      var p = G.run.p;
      p.invuln = 1e9; p.hp = p.maxHp;
      G.run.enemies.length = 0;
      G.run.eventT = 999;
      var e = G.spawnEnemy('drowner', false, p.x + 30, p.y + 4);
      e.x = p.x + 30; e.y = p.y + 4; e.speed = 0;
      /* 直接摆成"刚浮出水面"：subAng 必须自己补，否则 atan2(NaN) 会让它消失 */
      e.subState = 2; e.submerged = true; e.subT = 0.001; e.subAng = Math.PI;
      return 'emerge';
    })()`,
    wait: 55
  },
  {
    name: 'ringcards',
    desc: '三选一里两件环的卡面：冰霜环走冷蓝 + 环形冰晶，火焰环走橙 + 环形火',
    act: `(function () {
      var G = HS.Game;
      G.startRun('highway', 'whale');
      G.state = 'levelup';
      /* 卡面直接指定，不然随机池里两件环很难同时抽到 */
      G.run.choices = [
        G.makeCard({ kind: 'autoNew', id: 'frostring' }),
        G.makeCard({ kind: 'autoNew', id: 'firering' }),
        G.makeCard({ kind: 'synergy', id: 'ringIce' })
      ];
      return 'cards=' + G.run.choices.length;
    })()`,
    wait: 800
  },
  {
    name: 'tunnelcrash',
    desc: '连环追尾：多辆车挤成一团，刹车痕、碎玻璃、干涸的血',
    act: `(function () {
      var G = HS.Game;
      G.startRun('tunnel', 'whale');
      G.state = 'run';
      G.run.vehHint = true; G.bannerT = 0; G.run.eventT = 999; G.run.supplyDropped = true;
      var p = G.run.p;
      p.invuln = 90; p.hp = p.maxHp;
      /* 站到第 2 处事故点的下游：车堆在屏幕上半，玩家在下面看着它 */
      var ay = HS.World.accidentY(1);
      p.x = 6; p.y = ay + 156;
      for (var i = 0; i < 4; i++) G.spawnEnemy('walker', false, (i - 1.5) * 26, p.y - 20 - i * 12);
      return 'y=' + Math.round(ay);
    })()`,
    wait: 400,
    settle: 500
  },
  {
    name: 'tunnelbomber',
    desc: '自爆尸：肚囊荧光，残血时脉冲更急',
    act: `(function () {
      var G = HS.Game;
      G.startRun('tunnel', 'whale');
      G.state = 'run';
      G.run.vehHint = true; G.bannerT = 0;
      var p = G.run.p;
      p.invuln = 90; p.hp = p.maxHp;
      for (var i = 0; i < 6; i++) {
        var b = G.spawnEnemy('bomber', false, p.x + (i % 3 - 1) * 44, p.y - 66 - Math.floor(i / 3) * 36);
        /* 前一排是快被打炸的（脉冲急），后一排还满血 —— 一张图看出两种状态 */
        b.hp = b.maxHp * (i < 3 ? 0.3 : 0.95);
        b.speed = 6;
      }
      return 'bombers';
    })()`,
    wait: 120,
    settle: 150
  },
  {
    name: 'tunnelsonic',
    desc: '尖啸者：全向蓄声（射程环 + 收束的声压环）',
    act: `(function () {
      var G = HS.Game, guard = 0;
      G.startRun('tunnel', 'whale');
      while (G.state === 'levelup' && guard++ < 20) {
        G.pickChoice(0);
        if (G.confirm) G.confirmSwap(true);
      }
      G.state = 'run';
      G.run.t = 356;
      /* 别让教学横幅 / 局内事件横幅压在 Boss 脸上 */
      G.run.vehHint = true; G.bannerT = 0; G.run.eventT = 999;
      G.run.supplyDropped = true;   // t=356 会触发"最后的补给"横幅，出图前先划掉
      G.spawnBoss();
      G.bannerT = 0;            // 「双首领同时出现」的横幅会压在第一只脸上
      var p = G.run.p;
      p.invuln = 90; p.hp = p.maxHp;
      var sk = G.run.bosses[0], br = G.run.bosses[1];
      if (sk) {
        sk.x = p.x + 6; sk.y = p.y - 128;
        sk.hSt = 1; sk.hT = 0.46; sk.hAng = Math.atan2(p.y - sk.y, p.x - sk.x);
      }
      if (br) { br.x = p.x - 14; br.y = p.y + 150; br.bSt = 1; br.bT = 0.55; }
      return G.run.bosses.length + ' bosses';
    })()`,
    wait: 20,
    settle: 20
  },
  {
    name: 'tunnelscream',
    desc: '尖啸者长啸：一圈圈声压，人在原地被锁住',
    act: `(function () {
      var G = HS.Game;
      G.startRun('tunnel', 'whale');
      G.state = 'run';
      G.run.vehHint = true; G.bannerT = 0; G.run.eventT = 999; G.run.supplyDropped = true;
      G.run.t = 356;
      G.spawnBoss();
      G.bannerT = 0;
      var p = G.run.p;
      p.invuln = 90; p.hp = p.maxHp;
      var sk = G.run.bosses[0], br = G.run.bosses[1];
      if (sk) {
        sk.x = p.x; sk.y = p.y - 118;
        sk.hSt = 5; sk.hT = 0; sk.hChanT = 2.4; sk.hChanTick = 0.32;
      }
      if (br) { br.x = p.x + 54; br.y = p.y + 150; br.bSpawnCd = 99; br.bSlamCd = 99; }
      p.stun = 0.5; p.stunMax = 0.5;
      for (var i = 0; i < 5; i++) G.spawnEnemy('walker', false, p.x + (i % 3 - 1) * 32, p.y - 54 - (i >> 2) * 26);
      return 'scream';
    })()`,
    wait: 220,
    settle: 160
  },
  {
    name: 'tunnelthrow',
    desc: '育母抓起身边的自爆尸，朝玩家扔出去',
    act: `(function () {
      var G = HS.Game;
      G.startRun('tunnel', 'whale');
      G.state = 'run';
      G.run.vehHint = true; G.bannerT = 0; G.run.eventT = 999; G.run.supplyDropped = true;
      G.run.t = 356;
      G.spawnBoss();
      G.bannerT = 0;
      var p = G.run.p;
      p.invuln = 90; p.hp = p.maxHp;
      var sk = G.run.bosses[0], br = G.run.bosses[1];
      if (sk) { sk.x = p.x - 60; sk.y = p.y - 130; sk.hSonicCd = 20; sk.hChanCd = 20; }
      var bomb = null;
      if (br) {
        br.x = p.x + 10; br.y = p.y - 150;
        br.bSpawnCd = 99; br.bSlamCd = 99; br.bSt = 6; br.bT = 0.35; br.bThrowCd = 99;
        bomb = G.spawnEnemy('bomber', false, br.x + 6, br.y + 10);
        bomb.hurlT = 0.26; bomb.hurlDur = 0.6;
        bomb.hurlX = br.x + 6; bomb.hurlY = br.y + 10;
        bomb.hurlX2 = p.x; bomb.hurlY2 = p.y;
        bomb.hurlArc = 52; bomb.hurlSpin = 1.2;
      }
      return bomb ? 'throw' : 'no-brood';
    })()`,
    wait: 140,
    settle: 60
  },
  {
    name: 'tunnelboss',
    desc: '双首领：尖啸者在上、育母在下，中间的走廊就是战场',
    act: `(function () {
      var G = HS.Game, guard = 0;
      G.startRun('tunnel', 'whale');
      while (G.state === 'levelup' && guard++ < 20) {
        G.pickChoice(0);
        if (G.confirm) G.confirmSwap(true);
      }
      G.state = 'run';
      G.run.t = 356;
      /* 别让教学横幅 / 局内事件横幅压在 Boss 脸上 */
      G.run.vehHint = true; G.bannerT = 0; G.run.eventT = 999;
      G.run.supplyDropped = true;   // t=356 会触发"最后的补给"横幅，出图前先划掉
      G.spawnBoss();
      G.bannerT = 0;            // 「双首领同时出现」的横幅会压在第一只脸上
      var p = G.run.p;
      p.invuln = 90; p.hp = p.maxHp;
      var sk = G.run.bosses[0], br = G.run.bosses[1];
      if (sk) { sk.x = p.x - 44; sk.y = p.y - 112; sk.hSonicCd = 9; }
      if (br) { br.x = p.x + 52; br.y = p.y + 126; br.bSpawnCd = 9; br.bSlamCd = 9; }
      for (var i = 0; i < 8; i++) {
        G.spawnEnemy('bomber', false, p.x + (i % 2 ? 1 : -1) * (24 + i * 12), p.y + 150 + (i % 3) * 22);
      }
      return G.run.bosses.map(function (b) { return b.def.name; }).join('+');
    })()`,
    wait: 60,
    settle: 500
  },
  {
    name: 'meta',
    desc: '研究所：鲸鱼娘立绘（原图裁切）+ 永久强化',
    act: `(function () {
      HS.Game.state = 'title';
      HS.Game.activate('meta');
      HS.Game.tab = 'char';
      return true;
    })()`,
    wait: 700
  },
  {
    name: 'rank',
    desc: '排行榜：无尽模式存活时间（B站 Toy 是全站榜，网页版只记本机）',
    act: `(function () {
      /* 网页版没有联机榜：打开示例名次，只为截图好看（不写存档、不影响线上） */
      HS.Host.use(HS.HostAdapters.web);
      HS.Host.adapter.mock = true;
      HS.P.set('hsdz_rank_local_v1', [{ score: 9800, nickname: '我', t: Date.now() }]);
      HS.Save.data.bestEndless = 98;
      HS.Game.state = 'title';
      HS.Game.openRank('title');
      HS.Host.loadRank('all', true);
      return 'rows=' + HS.Host.rankUI.rows.length + ' my=' + JSON.stringify(HS.Host.rankUI.my);
    })()`,
    wait: 900
  }
];

(async () => {
  if (!fs.existsSync(HTML)) {
    console.error('缺少 ' + HTML + '，先跑 node tools/build-browser.js');
    process.exit(1);
  }
  const only = process.argv.slice(2);
  const puppeteer = loadPuppeteer();
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('找不到 Chrome / Edge'); process.exit(1); }

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--allow-file-access-from-files', '--mute-audio',
           '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars']
  });
  const page = await browser.newPage();
  await page.setViewport(VIEW);
  page.on('pageerror', e => console.error('  [page error] ' + e.message));

  await page.goto('file:///' + HTML.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForFunction('window.HS && HS.Game && HS.Game.state === "title"', { timeout: 15000 });
  await page.evaluate(unlockAll);

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  for (const s of STEPS) {
    if (only.length && only.indexOf(s.name) < 0) continue;
    if (s.act) {
      const r = await page.evaluate(s.act);
      if (r !== true && r !== undefined && r !== null) console.log('    → ' + r);
    }
    await sleep(s.wait);
    if (s.fill) {
      const r = await page.evaluate(s.fill);
      if (typeof r === 'string') console.log('    → ' + r);
      await sleep(s.settle || 1200);
    }
    const file = path.join(OUT, s.name + '.png');
    await page.screenshot({ path: file });
    const kb = Math.round(fs.statSync(file).size / 1024);
    console.log('  ✓ ' + s.name.padEnd(10) + ' ' + kb + ' KB  ' + s.desc);
  }

  await browser.close();
  console.log('\n输出目录: ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
