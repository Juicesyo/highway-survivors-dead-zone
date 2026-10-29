/**
 * 燃烧（burn dot）专项检测
 * 用法: node tools/check-burn.js
 *
 * 为什么单独一个脚本：燃烧是唯一一种"看不见来源"的伤害 —— 不跳字、
 * 不闪白、不打断动作，一旦 dot 断了，玩家只会觉得"这枪好像变弱了"，
 * 根本定位不到。这里把三条链各自钉一遍：
 *   1. 喷火枪：开火 → 目标挂上燃烧 → 停火后继续掉血
 *   2. 龙息喷枪：燃烧时长明显长于普通火焰（这是它的身份）
 *   3. 燃烧瓶：火池里的敌人被点着 → 走出火池后还在烧
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

/* 推进 n 秒；无敌 + 自动处理升级 / 搜刮，别的都不做 */
function tick(sec) {
  const step = 1 / 60;
  const n = Math.round(sec / step);
  for (let i = 0; i < n; i++) {
    if (Game.run) { p.hp = p.maxHp; p.invuln = 1; }
    HS.Main.tick(step);
    if (Game.state === 'levelup') Game.choose(Game.run.choices[0].id);
    if (Game.state === 'lootask') Game.answerLoot(true);
  }
}

function clearField() {
  Game.run.enemies.length = 0;
  Game.run.pools.length = 0;
  Game.run.bullets.length = 0;
  Game.run.devices.length = 0;
  Game.run.autos = p.autos;
  Game.state = 'run';
}

function putWeapon(id) {
  Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = {};
  Gear.take(p, id);
  Game.recalc(p);
  /* 手持武器立刻可开火，别等第一轮 CD */
  for (const w of p.weapons) w.timer = 0;
}

console.log('燃烧持续伤害检查\n');

/* ---------- 1. 喷火枪 ---------- */
console.log('[喷火枪]');
putWeapon('flamer');
clearField();
let ez = Game.spawnEnemy('walker', false, p.x + 46, p.y);
ez.hp = 1e9; ez.maxHp = 1e9; ez.speed = 0;
const hp0 = ez.hp;
tick(1.0);
const flamerDps = ez.burnDps || 0;
const flamerBurnT = ez.burn || 0;
check('喷火枪会点燃目标', flamerBurnT > 0, '剩余 ' + flamerBurnT.toFixed(2) + 's');
check('点燃后带上持续伤害', flamerDps > 0, flamerDps.toFixed(1) + '/s');
check('喷火期间目标持续掉血', ez.hp < hp0, '掉了 ' + Math.round(hp0 - ez.hp));

/* 停火：清空武器、把目标挪出射程，只看 dot */
const hp1 = ez.hp;
Gear.clearHands(p);
p.weapons.length = 0;
ez.x = p.x + 500;
tick(1.0);
check('停火后仍在燃烧（dot 独立结算）', ez.hp < hp1, '又掉了 ' + Math.round(hp1 - ez.hp));

/* 燃烧专精：只乘 dot，不乘直伤 */
ez.burn = 0; ez.burnDps = 0; ez.hp = 1e9;
putWeapon('flamer');
p.passives = { burnDmg: 4 };
Game.recalc(p);
ez.x = p.x + 46;
ez.hp = 1e9;
tick(0.8);
const boostedDps = ez.burnDps || 0;
check('燃烧专精加成到 dot', boostedDps > flamerDps * 1.4,
  flamerDps.toFixed(1) + ' → ' + boostedDps.toFixed(1) + ' (×' + (boostedDps / (flamerDps || 1)).toFixed(2) + ')');

/* ---------- 2. 龙息喷枪 ---------- */
console.log('\n[龙息喷枪]');
putWeapon('napalm');
clearField();
let nz = Game.spawnEnemy('walker', false, p.x + 60, p.y);
nz.hp = 1e9; nz.maxHp = 1e9; nz.speed = 0;
tick(0.6);
check('龙息喷枪会点燃目标', (nz.burn || 0) > 0, '剩余 ' + (nz.burn || 0).toFixed(2) + 's');
check('龙息燃烧明显更久', (nz.burn || 0) > flamerBurnT + 0.8,
  '龙息 ' + (nz.burn || 0).toFixed(1) + 's vs 喷火 ' + flamerBurnT.toFixed(1) + 's');
check('龙息 dot 高于普通喷火', (nz.burnDps || 0) > flamerDps,
  (nz.burnDps || 0).toFixed(1) + ' vs ' + flamerDps.toFixed(1));

/* ---------- 3. 燃烧瓶 ---------- */
console.log('\n[燃烧瓶]');
putWeapon('molotov');
clearField();
let mz = Game.spawnEnemy('walker', false, p.x + 40, p.y);
mz.hp = 1e9; mz.maxHp = 1e9; mz.speed = 0;
tick(1.6);
const firePools = Game.run.pools.filter((q) => q.fire && q.life > 0);
check('燃烧瓶砸出火海', firePools.length > 0, firePools.length + ' 片');
const mzBurn = mz.burn || 0;
check('站在火海里的敌人被点着', mzBurn > 0, '剩余 ' + mzBurn.toFixed(2) + 's');

/* 走出火池：先确认池子还在，只是人不在了 */
const hpInFire = mz.hp;
if (firePools.length) { mz.x = firePools[0].x + 300; mz.y = firePools[0].y + 300; }
tick(0.45);
check('离开火海后仍在烧', mz.hp < hpInFire, '又掉了 ' + Math.round(hpInFire - mz.hp));

/* ---------- 4. 火焰环（自动武器） ---------- */
console.log('\n[火焰环]');
Gear.clearHands(p);
p.weapons.length = 0;
p.autos.length = 0;
p.passives = {};
Gear.take(p, 'pistol');
Gear.take(p, 'firering');
Game.recalc(p);
clearField();
p.autos[0].timer = 0;
const ringDef = HS.Data.autos ? HS.Data.autos.firering : null;
let rz = null;
for (let k = 0; k < 20 && !rz; k++) {
  p.autos[0].timer = 0;
  Game.update(1 / 60);
  const a = p.autos[0];
  const R = (a.st && a.st.radius) || 0;
  if (R > 0) {
    rz = Game.spawnEnemy('walker', false, p.x + R, p.y);
    rz.hp = 1e9; rz.maxHp = 1e9; rz.speed = 0;
  }
}
if (rz) {
  for (let k = 0; k < 40; k++) { rz.x = p.x + (p.autos[0].st.radius || 40); rz.y = p.y; p.hp = p.maxHp; Game.update(1 / 60); }
  check('火焰环会点着碰到的敌人', (rz.burn || 0) > 0, '剩余 ' + (rz.burn || 0).toFixed(2) + 's');
} else {
  check('火焰环能落地', false, ringDef ? 'radius 未取到' : '没有 firering');
}

console.log('\n----------------------------------------');
if (bad) {
  console.log(bad + ' 项未通过 ✗');
  process.exit(1);
}
console.log('全部检查通过 ✓');
