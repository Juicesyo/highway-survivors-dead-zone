/**
 * 存档链路端到端检测
 * 用法: node tools/check-save.js
 *   1) 通关第一关 → night 解锁且写入存储
 *   2) 重载存档（模拟重启）→ 解锁仍在
 *   3) 旧格式存档（累计 wins=3，无 mapWins）迁移 → night 直接解锁
 *   4) win 未触发时（死亡结算）不解锁新图
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const reqs = [...entry.matchAll(/require\(['"](.+?)['"]\)/g)].map(m => m[1]);
for (const r of reqs) require(path.join(ROOT, r));

const HS = globalThis.HS;
HS.Main.boot();
const Game = HS.Game;
Game.testMode = true;

/* node 无头环境没有 localStorage 也不是微信，P.set/get 是空操作。
   装一个内存存储垫片，真实模拟"写入 → 重启 → 读回"。 */
const memStore = {};
HS.P.set = function (key, val) { memStore[key] = JSON.parse(JSON.stringify(val)); };
HS.P.get = function (key) { return memStore[key] ? JSON.parse(JSON.stringify(memStore[key])) : ''; };

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  (' + extra + ')' : ''));
  if (!cond) bad++;
}

/* ---------- 1. 通关 → 解锁 → 落盘 ---------- */
console.log('[通关写入与解锁]');
Game.startRun('highway', 'soldier');
Game.run.t = 360;
Game.finishRun(true);
let d = HS.Save.data;
check('通关后 wins=1', d.wins === 1, 'wins=' + d.wins);
check('通关后 mapWins.highway=1', d.mapWins.highway === 1, JSON.stringify(d.mapWins));
check('night 已解锁', d.unlockedMaps.indexOf('night') >= 0, JSON.stringify(d.unlockedMaps));
check('desert 尚未解锁（要过夜图）', d.unlockedMaps.indexOf('desert') < 0, JSON.stringify(d.unlockedMaps));

/* 模拟重启：重新 load */
const saved = JSON.parse(JSON.stringify(d));
HS.Save.data = null;
HS.Save.load();
d = HS.Save.data;
check('重启后 night 解锁仍在', d.unlockedMaps.indexOf('night') >= 0, JSON.stringify(d.unlockedMaps));
check('重启后通关次数还在', d.mapWins.highway === 1 && d.wins === 1, JSON.stringify(d.mapWins));

/* ---------- 2. 旧格式存档迁移 ---------- */
console.log('[旧存档迁移]');
const oldSave = {
  v: 1, gold: 500, chars: ['soldier'], perm: { hp: 0, dmg: 0, spd: 0, luck: 0, greed: 0, revive: 0 },
  wins: 3, runs: 9, totalKills: 500, totalGold: 800, evolutions: 2,
  bestLevel: 18, bestKills: 300, bestTime: 400,
  unlockedMaps: ['highway'],
  seen: { weapons: [], enemies: [] }, ach: {}, sfx: true, vib: true, fxLow: false
};
HS.P.set('hsdz_save_v1', oldSave);
HS.Save.data = null;
HS.Save.load();
d = HS.Save.data;
check('旧档 wins=3 迁移到 mapWins.highway', d.mapWins.highway === 3, JSON.stringify(d.mapWins));
check('旧档 night 自动解锁', d.unlockedMaps.indexOf('night') >= 0, JSON.stringify(d.unlockedMaps));

/* ---------- 3. 死亡不解锁 ---------- */
console.log('[死亡结算不解锁]');
HS.Save.reset();
Game.startRun('highway', 'soldier');
Game.run.t = 200;
Game.finishRun(false);
d = HS.Save.data;
check('死亡后 wins 不变', d.wins === 0, 'wins=' + d.wins);
check('死亡后 night 不解锁', d.unlockedMaps.indexOf('night') < 0, JSON.stringify(d.unlockedMaps));

console.log('\n' + (bad === 0 ? '全部通过 ✓ —— 存档链路本身没有问题' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
