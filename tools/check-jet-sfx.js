/**
 * 喷射类武器音效节奏检查（喷火 / 液氮 / 龙息 / 重型喷火）
 * 用法: node tools/check-jet-sfx.js
 *
 * 为什么单独一个脚本：这类武器的开火 cd 是 0.16s，声音如果跟着 cd 走，
 * 三段 0.2s 的气流会永远叠在一起 —— 听起来是一团糊，又吵又听不出在喷东西。
 * 这里钉住两件事：
 *   1. 触发间隔 ≥ 0.3s（间歇地播）；
 *   2. 单段是"起燃 + 维持"两段式：停火半秒后再喷要重新起燃。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const reqs = [...entry.matchAll(/require\(['"](.+?)['"]\)/g)].map((m) => m[1]);
for (const r of reqs) require(path.join(ROOT, r));

const HS = globalThis.HS;
HS.Main.boot();
const Game = HS.Game;
const Gear = HS.Gear;
Game.testMode = true;

let bad = 0;
function check(name, ok, extra) {
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  (' + extra + ')' : ''));
}

Game.startRun('highway', 'whale');
const p = Game.run.p;

/* 记录每一次播放：时间和是不是"起燃" */
const log = { flame: [], frost: [] };
const realFlame = HS.Audio.flame;
const realFrost = HS.Audio.frost;
HS.Audio.flame = function (fresh) { log.flame.push({ t: Game.run ? Game.run.t : 0, fresh: fresh !== false }); };
HS.Audio.frost = function (fresh) { log.frost.push({ t: Game.run ? Game.run.t : 0, fresh: fresh !== false }); };

function simulate(id, seconds) {
  log.flame.length = 0;
  log.frost.length = 0;
  Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = {};
  p.trade = {};
  Gear.take(p, id);
  Game.recalc(p);
  for (const w of p.weapons) w.timer = 0;
  Game.run.enemies.length = 0;
  /* 一排不动的靶子：保证每一帧都在喷，而不是偶尔打到人才喷 */
  for (let i = 0; i < 8; i++) {
    const e = Game.spawnEnemy('walker', false, p.x + 30 + i * 6, p.y + (i - 4) * 5);
    e.hp = 1e9; e.maxHp = 1e9; e.speed = 0;
  }
  const step = 1 / 60;
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    p.hp = p.maxHp;
    p.invuln = 1;
    HS.Main.tick(step);
    if (Game.state === 'levelup') Game.choose(Game.run.choices[0].id);
  }
}

function report(label, arr, seconds, wantFresh) {
  if (!arr.length) {
    check(label + ' 有出声', false, '0 次');
    return;
  }
  const gaps = [];
  for (let i = 1; i < arr.length; i++) gaps.push(arr[i].t - arr[i - 1].t);
  const minGap = gaps.length ? Math.min.apply(null, gaps) : 99;
  const freshN = arr.filter((x) => x.fresh).length;
  const perSec = arr.length / seconds;
  check(label + ' 触发不跟开火节奏（≥0.3s 一次）', minGap >= 0.3,
    '最短间隔 ' + minGap.toFixed(2) + 's · 每秒 ' + perSec.toFixed(1) + ' 次');
  check(label + ' 保持连续（不至于断成一截一截）', perSec >= 1.5,
    perSec.toFixed(1) + ' 次/秒');
  if (wantFresh) {
    check(label + ' 只在重新点喷时起燃', freshN <= 2, '起燃 ' + freshN + ' 次 / ' + arr.length + ' 段');
  }
}

console.log('喷射类音效节奏\n');
console.log('[火焰喷射器]');
simulate('flamer', 3);
report('喷火', log.flame, 3, true);

console.log('\n[液氮喷枪]');
simulate('cryo', 3);
report('液氮', log.frost, 3, true);

console.log('\n[龙息喷枪]');
simulate('napalm', 3);
report('龙息', log.flame, 3, true);

console.log('\n[重型火焰喷射器]');
simulate('heavyflamer', 3);
report('重型喷火', log.flame, 3, true);

/* 停火半秒后再喷：必须重新起燃 */
console.log('\n[起燃判定]');
{
  log.flame.length = 0;
  Gear.clearHands(p);
  p.autos.length = 0;
  Gear.take(p, 'flamer');
  Game.recalc(p);
  for (const w of p.weapons) w.timer = 0;
  Game.run.enemies.length = 0;
  for (let i = 0; i < 6; i++) {
    const e = Game.spawnEnemy('walker', false, p.x + 30 + i * 6, p.y);
    e.hp = 1e9; e.maxHp = 1e9; e.speed = 0;
  }
  for (let i = 0; i < 60; i++) { p.hp = p.maxHp; p.invuln = 1; HS.Main.tick(1 / 60); }
  const fired = log.flame.length;
  /* 真正的停火：把武器卸掉（喷火不看有没有目标，清怪它也照喷） */
  Gear.clearHands(p);
  for (let w of p.weapons) w.timer = 0;
  for (let i = 0; i < 72; i++) { p.hp = p.maxHp; p.invuln = 1; HS.Main.tick(1 / 60); }
  const idle = log.flame.length - fired;
  /* 重新拿起来 */
  Gear.take(p, 'flamer');
  Game.recalc(p);
  for (const w of p.weapons) w.timer = 0;
  for (let i = 0; i < 60; i++) { p.hp = p.maxHp; p.invuln = 1; HS.Main.tick(1 / 60); }
  const resumed = log.flame.slice(fired + idle);
  check('停火后不再出声', idle <= 1, idle + ' 次');
  check('重新开喷会起燃', resumed.length > 0 && resumed[0].fresh === true,
    resumed.length ? String(resumed[0].fresh) : '没有声音');
}

HS.Audio.flame = realFlame;
HS.Audio.frost = realFrost;

console.log('\n----------------------------------------');
console.log(bad === 0 ? '全部通过 ✓' : bad + ' 项未通过 ✗');
process.exit(bad ? 1 : 0);
