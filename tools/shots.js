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
  HS.Save.data.unlockedMaps = ['highway', 'night', 'desert'];
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
    desc: '选图页：三张地图按通关顺序解锁',
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
    name: 'levelup',
    desc: '升级三选一：卡面 + 底部重抽',
    act: `HS.Game.gainXp(70)`,
    wait: 700
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
