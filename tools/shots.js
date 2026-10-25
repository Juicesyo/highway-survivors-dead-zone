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
const HTML = path.join(ROOT, 'dist', 'demo', 'index.html');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const VIEW = { width: 390, height: 844, deviceScaleFactor: 2 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 全自动开局：把所有地图解锁，免得截图时还要先通关一次 */
const unlockAll = `(function () {
  HS.Save.data.unlockedMaps = ['highway', 'night', 'desert', 'flood'];
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
    desc: '标题页：主视觉 + 两个入口',
    act: null,
    wait: 900
  },
  {
    name: 'mapselect',
    desc: '选图页：四张地图按通关顺序解锁',
    act: `HS.Game.activate('start')`,
    wait: 500
  },
  {
    name: 'run',
    desc: '末世街区：局内，尸群围上来、主武器自动开火',
    act: `HS.Game.startRun('highway', 'soldier')`,
    wait: 6000,
    fill: surround(['walker', 'walker', 'runner', 'brute', 'vomiter']),
    settle: 1300
  },
  {
    name: 'execute',
    desc: '处决：血线以下的敌人一命中就当场斩杀',
    act: `HS.Game.startRun('highway', 'soldier')`,
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
    act: `HS.Game.startRun('highway', 'soldier')`,
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
      G.startRun('highway', 'soldier');   // 单独出这一张时也要先建局面
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
      if (!G.run) G.startRun('highway', 'soldier');   // 单独出这一张时先开局
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
      if (!G.run) G.startRun('highway', 'soldier');
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
    act: `HS.Game.startRun('highway', 'soldier')`,
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
    name: 'meta',
    desc: '研究所：金币买永久强化、解锁角色',
    act: `(function () {
      HS.Game.state = 'title';
      HS.Game.activate('meta');
      HS.Game.tab = 'char';
      return true;
    })()`,
    wait: 700
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
