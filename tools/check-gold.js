/**
 * 结算页 / 选图页渲染 + 文案自检（金币改动后跑一遍）
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const fs = require('fs');
global.GameGlobal = global;
const reqs = [...fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8')
  .matchAll(/require\((['"])(.+?)\1\)/g)].map(m => m[2]);
for (const r of reqs) require(path.join(ROOT, r));
const HS = global.HS;
HS.Main.boot();
const G = HS.Game, P = HS.P;
G.testMode = true;

let bad = 0;
const ck = (n, c, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' ' + n + (x ? '  (' + x + ')' : '')); if (!c) bad++; };

function grab(fn) {
  const logs = [];
  const ctx = P.ctx;
  const orig = ctx.fillText;
  ctx.fillText = function (t, x, y) { logs.push({ t: String(t), x: Math.round(x), y: Math.round(y) }); };
  fn();
  ctx.fillText = orig;
  return logs;
}

/* 1. 通关结算页 */
G.startRun('night', 'whale');
G.run.gold = 42; G.run.kills = 500; G.run.t = 360;
G.finishRun(true);
ck('结算状态', G.state === 'result', G.state);
const r = G.run.result;
ck('通关奖励 50（死区之夜）', r.clearGold === 50, String(r.clearGold));
/* 死区之夜的「搜刮 x1.18」只放大搜刮所得，通关奖励是额定值 */
ck('搜刮进结算（吃地图搜刮倍率 1.18）', r.scavGold === Math.floor(42 * 1.18), String(r.scavGold));
ck('总金币 = 搜刮 + 奖励', r.gold === Math.floor(42 * 1.18) + 50, String(r.gold));
let logs = grab(() => HS.UI.result(G));
const cap = logs.find(l => /通关奖励|未通关/.test(l.t));
ck('结算页写出金币来源', !!cap, cap ? cap.t : '没找到');
ck('结算页金币总额正确', logs.some(l => l.t === '+' + r.gold), logs.filter(l => l.t[0] === '+').map(l => l.t).join(','));

/* 2. 未通关结算页 */
G.state = 'title';
G.startRun('highway', 'whale');
G.run.gold = 17; G.run.kills = 800; G.run.t = 300;
G.finishRun(false);
logs = grab(() => HS.UI.result(G));
const cap2 = logs.find(l => /未通关/.test(l.t));
ck('未通关说明"仅搜刮"', !!cap2, cap2 ? cap2.t : '没找到');
ck('未通关金币 = 只有搜刮', G.run.result.gold === 17, String(G.run.result.gold));

/* 3. 选图页写明通关奖励 */
G.state = 'mapselect';
HS.Save.data.unlockedMaps = ['highway', 'night', 'desert', 'flood'];
logs = grab(() => HS.UI.mapSelect(G));
const lines = logs.filter(l => /通关 \+/.test(l.t)).map(l => l.t);
ck('四张图都标了通关奖励', lines.length === 4, lines.join(' | '));
ck('奖励数额 30 / 50 / 80 / 110',
  lines[0].indexOf('+30') > 0 && lines[1].indexOf('+50') > 0 &&
  lines[2].indexOf('+80') > 0 && lines[3].indexOf('+110') > 0);

console.log(bad ? '\n' + bad + ' 项失败' : '\n全部通过');
process.exit(bad ? 1 : 0);
