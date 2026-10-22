/**
 * 打包浏览器预览版：把所有模块内联进单个 HTML
 * 用法: node tools/build-browser.js
 * 输出: dist/highway-survivors.html （可直接双击打开，也可用于截图验收）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const files = [...entry.matchAll(/require\(['"](.+?)['"]\)/g)].map(m => m[1]);

const parts = files.map(rel => {
  const abs = path.join(ROOT, rel);
  const code = fs.readFileSync(abs, 'utf8');
  return `/* ======================== ${rel} ======================== */\n${code}`;
});

/* 图集内联成 data URI：单文件预览不需要额外请求，也不依赖目录结构 */
const sheetPath = path.join(ROOT, 'assets/sprites.png');
if (!fs.existsSync(sheetPath)) {
  console.error('缺少 assets/sprites.png，先运行: node tools/build-sprites.js');
  process.exit(1);
}
const sheetB64 = fs.readFileSync(sheetPath).toString('base64');
const sheetInline = `HS.SheetData.image = 'data:image/png;base64,${sheetB64}';`;

/* 背景音乐同样内联成 data URI：单文件预览不能依赖外部目录，
   而且预览是从 localhost 起的，相对路径会去请求 dist/bgm/ 而 404 */
let bgmInline = '';
const bgmPath = path.join(ROOT, 'bgm/bgm.mp3');
if (fs.existsSync(bgmPath)) {
  const bgmB64 = fs.readFileSync(bgmPath).toString('base64');
  bgmInline = `HS.Audio.BGM_SRC = 'data:audio/mpeg;base64,${bgmB64}';`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#070a0e">
<title>公路幸存者：死区 | Highway Survivors</title>
<style>
  html, body {
    margin: 0; padding: 0; height: 100%; overflow: hidden;
    background: #05070a; -webkit-tap-highlight-color: transparent;
    user-select: none; -webkit-user-select: none;
    font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  #game {
    display: block; width: 100vw; height: 100vh;
    touch-action: none; image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
  }
  #rotate {
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    color: #8b95a3; font-size: 14px; background: #05070a; z-index: 9;
  }
  @media (orientation: landscape) and (max-height: 520px) {
    #rotate { display: flex; }
  }
</style>
</head>
<body>
<canvas id="game"></canvas>
<div id="rotate">本游戏为竖屏体验，请把设备竖过来</div>
<script>
(function(){

window.addEventListener("error", function (e) { document.title = "JSERR: " + e.message; });

${parts.join('\n\n')}

${sheetInline}
${bgmInline}
HS.Main.boot();

/* ---- 预览参数 ---- */
var q = {};
location.search.replace(/[?&]([^=&]+)=([^&]*)/g, function (_, k, v) {
  q[k] = decodeURIComponent(v); return '';
});

/* 强制逻辑视口（无头截图时 headless 窗口有最小宽度限制） */
if (q.w && q.h) {
  (function (fw, fh) {
    var cv = document.getElementById('game');
    cv.style.width = fw + 'px';
    cv.style.height = fh + 'px';
    document.documentElement.style.width = fw + 'px';
    document.documentElement.style.height = fh + 'px';
    document.body.style.width = fw + 'px';
    document.body.style.height = fh + 'px';
    HS.P.setViewport(fw, fh);
  })(parseInt(q.w, 10), parseInt(q.h, 10));
}

function fastForward(sec) {
  var g = HS.Game;
  var st = 1 / 30;
  if (q.god && g.run) { g.run.p.invuln = 0; }
  for (var i = 0; i < sec / st; i++) {
    if (q.god && g.run) {
      g.run.p.hp = g.run.p.maxHp;
      g.run.p.invuln = 0;
      g.run.p.hurtT = 0;
    }
    g.update(st);
    if (g.state === 'levelup') g.pickChoice(0);
    /* 自动换装确认：否则快进会卡在「替换副武器?」弹窗 */
    if (g.confirm) g.confirmSwap(true);
    if (g.state === 'result') break;
  }
}

var g = HS.Game;
try {
  if (q.screen === 'run' || q.screen === 'levelup' || q.screen === 'result' || q.screen === 'pause') {
    g.startRun(q.map || 'highway', q.char || 'soldier');
    if (q.t) fastForward(parseFloat(q.t));
    /* 预览指定装备组合：?gear=gatling,drone,firering */
    if (q.gear && g.run) {
      g.run.p.weapons.length = 0;
      g.run.p.autos.length = 0;
      var gl2 = q.gear.split(',');
      for (var gi2 = 0; gi2 < gl2.length; gi2++) HS.Gear.take(g.run.p, gl2[gi2]);
      HS.Gear.refresh(g.run.p);
      g.recalc(g.run.p);
      g.state = 'run';
    }
    if (q.god && g.run && g.state === 'run') {
      g.run.p.hp = g.run.p.maxHp * 0.55;
      g.run.p.hurtT = 0;
    }
    /* 防护装备卡预览：把六件装备塞进升级界面 */
    if (q.cards === 'gear' && g.run) {
      var gl = HS.Data.gearPool.slice();
      g.run.p.passives = {};
      var made = [];
      for (var gi = 0; gi < gl.length; gi++) {
        made.push(g.makeCard({ kind: 'passiveNew', id: gl[gi] }));
      }
      g.run.choices = made.slice(0, 3);
      g.state = 'levelup';
      g.update = function () {};
      g.render();
      return;
    }
    if (q.screen === 'levelup') {
      g.run.p.xpNext = g.run.p.xp + 1;
      g.gainXp(1);
    }
    if (q.tp && g.run) {
      var tp = q.tp.split(',');
      g.run.p.x = parseFloat(tp[0]);
      g.run.p.y = parseFloat(tp[1]);
      /* 传送只是摆机位：把附近楼房的 reveal 归零，
         否则会拍到"刚才进去过、屋顶还没淡回来"的屋子 */
      var rb = [];
      HS.Buildings.buildingsInRect(g.run.p.x - 700, g.run.p.y - 700,
        g.run.p.x + 700, g.run.p.y + 700, rb);
      for (var ri = 0; ri < rb.length; ri++) rb[ri].reveal = 0;
      g.run.insideBld = null;
    }
    /* 预览建筑内部 / 楼顶：找附近最近的一栋 */
    function nearestBuilding(needStairs, kind, wantRuin) {
      if (!g.run) return null;
      var arr = [];
      HS.Buildings.buildingsInRect(g.run.p.x - 900, g.run.p.y - 900,
        g.run.p.x + 900, g.run.p.y + 900, arr);
      var best = null, bestD = 1e9;
      for (var bi = 0; bi < arr.length; bi++) {
        var bb = arr[bi];
        if (wantRuin) { if (!bb.ruin) continue; }
        else if (bb.ruin) continue;
        if (needStairs && !bb.stairs) continue;
        if (kind && bb.kind !== kind) continue;
        var dd = HS.U.dist(g.run.p.x, g.run.p.y, bb.x, bb.y);
        if (dd < bestD) { bestD = dd; best = bb; }
      }
      return best;
    }
    function freeInside(bb) {
      var best = null, bestD = 1e9;
      for (var yy = bb.iy0 + 3; yy < bb.iy1 - 3; yy += 2) {
        for (var xx = bb.ix0 + 3; xx < bb.ix1 - 3; xx += 2) {
          var pr = { x: xx, y: yy };
          HS.Buildings.resolve(pr, 5);
          if (Math.abs(pr.x - xx) > 0.01 || Math.abs(pr.y - yy) > 0.01) continue;
          var dd = HS.U.dist(xx, yy, bb.x, bb.y);
          if (dd < bestD) { bestD = dd; best = { x: xx, y: yy }; }
        }
      }
      return best;
    }
    if (q.inside && g.run) {
      var ib = nearestBuilding(false, (q.inside !== '1' ? q.inside : null));
      if (ib) {
        var isp = freeInside(ib);
        g.run.p.x = isp ? isp.x : ib.x;
        g.run.p.y = isp ? isp.y : ib.y;
        ib.reveal = 1;
        g.run.insideBld = ib;
      }
    }
    if (q.roof && g.run) {
      var rb = nearestBuilding(true);
      if (rb) {
        g.run.p.roof = rb;
        g.run.p.x = rb.x;
        g.run.p.y = rb.y;
        if (q.edge) { g.run.p.x = rb.x1 - 12; g.run.p.y = rb.y; }
        rb.reveal = 0;
        g.run.insideBld = null;
        g.run.roofHatch = q.edge ? null : (HS.U.dist(g.run.p.x, g.run.p.y, rb.stairs.x, rb.stairs.y) < 24 ? rb : null);
        g.run.jumpDir = HS.Buildings.edgeDir(g.run.p.x, g.run.p.y, rb, 24);
      }
    }
    if (q.door && g.run) {
      var db = nearestBuilding(false);
      if (db && db.doors.length) {
        g.run.p.x = db.doors[0].ox;
        g.run.p.y = db.doors[0].oy;
        db.reveal = 0;
      }
    }
    if (q.ruin && g.run) {
      var ub = nearestBuilding(false, (q.ruin !== '1' ? q.ruin : null), true);
      if (ub) {
        g.run.p.x = ub.x;
        g.run.p.y = ub.y + ub.h / 2 + 38;
        ub.reveal = 0;
        g.run.insideBld = null;
      }
    }
    if (q.loot && g.run) {
      var buf = [];
      HS.World.queryRect(g.run.p.x - 700, g.run.p.y - 700, g.run.p.x + 700, g.run.p.y + 700, buf);
      var tgt = null;
      for (var li = 0; li < buf.length; li++) {
        if (buf[li].lootable && !buf[li].looted) { tgt = buf[li]; break; }
      }
      if (tgt) {
        g.run.p.x = tgt.x; g.run.p.y = tgt.y + 26;
        g.run.lootTarget = HS.World.nearLoot(g.run.p.x, g.run.p.y, 36);
      }
    }
    /* 载具预览：把玩家塞进最近的一辆车里 */
    if (q.veh && g.run && g.run.vehicles.length) {
      var vb = g.run.vehicles.filter(function (x) { return !x.wreck; });
      var target = vb[0] || g.run.vehicles[0];
      g.run.p.x = target.x;
      g.run.p.y = target.y + 20;
      if (!target.wreck) HS.Vehicle.enter(g.run, target);
      g.bannerT = 0;
    }
    if (q.screen === 'result') g.finishRun(q.win === '1');
    if (q.screen === 'pause') { g.state = 'paused'; }
  } else if (q.screen === 'meta') {
    g.state = 'meta';
    g.tab = q.tab || 'char';
  } else if (q.screen === 'settings') {
    g.state = 'settings';
    if (q.wipe === '1') g.wipeAsk = true;
    if (q.fxlow === '1') { g.fxLow = true; HS.P.fxLow = true; }
    if (q.nosfx === '1') { g.sfxOn = false; }
  } else if (q.screen === 'mapselect') {
    g.state = 'mapselect';
  }
  /* 生成一个假的存档，截图时不是全 0 */
  if (q.dummy === '1') {
    var sd = HS.Save.data;
    sd.gold = 1240; sd.wins = 3; sd.bestTime = 421; sd.bestLevel = 24;
    sd.bestKills = 388; sd.totalKills = 2140; sd.runs = 17;
    sd.unlockedMaps = ['highway', 'night', 'desert'];
    sd.chars = ['soldier', 'medic'];
  }
  /* 截图机位自检：把附近楼房的 reveal 写进标题，方便确认"看到的到底是屋顶还是室内" */
  if (q.dbg && g.run) {
    var dbgA = [];
    HS.Buildings.buildingsInRect(g.run.p.x - 300, g.run.p.y - 300,
      g.run.p.x + 300, g.run.p.y + 300, dbgA);
    var dbgS = 'p=' + Math.round(g.run.p.x) + ',' + Math.round(g.run.p.y) + ' | ';
    for (var dj = 0; dj < dbgA.length; dj++) {
      var bb3 = dbgA[dj];
      dbgS += bb3.kind + ' rev=' + bb3.reveal.toFixed(2) + ' roof=' + bb3.pal.roof +
        ' ruin=' + bb3.ruin + ' @' + Math.round(bb3.x) + ',' + Math.round(bb3.y) + '; ';
    }
    document.title = dbgS;
    var dc = HS.P.ctx;
    dc.setTransform(HS.P.dpr, 0, 0, HS.P.dpr, 0, 0);
    dc.font = '12px monospace';
    dc.textAlign = 'left';
    dc.textBaseline = 'top';
    dc.fillStyle = '#ff5a3c';
    dc.fillRect(0, 0, HS.P.W, 46);
    dc.fillStyle = '#fff';
    dc.fillText(dbgS.substring(0, 90), 4, 4);
    dc.fillText(dbgS.substring(90, 180), 4, 20);
  }

  /* 取色器：&px=&py= 读屏幕上那一点的像素色（配合 dbg 用） */
  if (q.dbg2 && g.run) {
    var dpr2 = HS.P.dpr || 1;
    var px2 = Math.round(parseFloat(q.px) * dpr2);
    var py2 = Math.round(parseFloat(q.py) * dpr2);
    var d2 = HS.P.ctx.getImageData(px2, py2, 1, 1).data;
    document.title = 'px(' + q.px + ',' + q.py + ') = ' + d2[0] + ',' + d2[1] + ',' + d2[2];
  }

  /* 调试视图冻结时间，方便截图与逐帧检查 */
  if (q.screen) {
    g.update = function () {};
    g.render();
  }

} catch (e) {
  console.error('[preview]', e);
  document.title = 'ERROR: ' + e.message;
}

/* 微信外的鼠标/触摸聚焦修复 */
document.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });

})();
</script>
</body>
</html>
`;

const outDir = path.join(ROOT, 'dist');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'highway-survivors.html');
fs.writeFileSync(out, html, 'utf8');
console.log('built: ' + out + '  (' + Math.round(html.length / 1024) + ' KB, ' + files.length + ' modules)');
