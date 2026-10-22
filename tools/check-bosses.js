/**
 * 新 Boss 机制端到端检测
 * 用法: node tools/check-bosses.js
 *   扫射暴君：会扫射（弹幕出现且玩家掉血）→ 会过热（弹幕停、冒烟状态）
 *   猎杀者：会三段扑杀（连续三次扑）→ 会嚎叫召尸 → 狂怒层数让冷却变短
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
const U = HS.U;

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  (' + extra + ')' : ''));
  if (!cond) bad++;
}

/* ---------- 扫射暴君 ---------- */
console.log('[扫射暴君 night/gatling]');
Game.startRun('night', 'soldier');
let p = Game.run.p;
p.x = 0; p.y = 0;
const g = Game.spawnEnemy('gatling', false, 300, 0);
g.boss = true; g.x = 300; g.y = 0; g.gSt = 0; g.gCd = 0.01;
let sawBullets = false, playerHurt = false, overheated = false;
const hp0 = p.hp;
/* 概率过热：中位数约 5 档（~6s），给 25s 窗口让偶发不抖 */
for (let f = 0; f < 60 * 25; f++) {
  g.x = 300; g.y = 0;          // 定住 Boss
  p.x = 0; p.y = 0;
  p.hp = p.maxHp;              // 不让它真打死玩家，只看机制
  Game.run.gems.length = 0;    // 别让升级打断测试
  if (Game.state !== 'run') { Game.state = 'run'; Game.run.choices = []; p.xp = 0; }
  Game.update(1 / 60);
  if (Game.run.ebullets.length > 0) sawBullets = true;
  if (g.gSt === 3) overheated = true;
  if (g.gSt === 3) break;
}
/* 过热判定后让毒打一轮验证掉血 */
p.invuln = 0; p.hp = p.maxHp;
const hpA = p.hp;
for (let f = 0; f < 30; f++) { p.x = 0; p.y = 0; Game.update(1 / 60); }
playerHurt = p.hp < hpA;
check('会进入扫射（弹幕出现）', sawBullets, 'gSt=' + g.gSt);
check('打完会过热罢工', overheated, 'gSt=' + g.gSt);
check('弹幕真实伤害玩家', playerHurt, '掉了 ' + (hpA - p.hp).toFixed(1));
check('减伤 20% 生效', g.dmgCut === 0.2, 'dmgCut=' + g.dmgCut);

/* ---------- 猎杀者 ---------- */
console.log('[猎杀者 desert/stalker]');
Game.startRun('desert', 'soldier');
p = Game.run.p;
p.x = 0; p.y = 0;
const s = Game.spawnEnemy('stalker', false, 200, 0);
s.boss = true; s.x = 200; s.y = 0; s.sPounceCd = 0.01; s.sRoarCd = 0.01;   // 两个技能都立刻就绪
let pounces = 0, prevState = 0;
let roared = false;
let roarCount = 0;
for (let f = 0; f < 60 * 25; f++) {
  s.x = Math.max(s.x, 120);   // 别让它扑过头跑没影
  p.x = 0; p.y = 0;
  p.hp = p.maxHp; p.invuln = 0;
  Game.run.gems.length = 0;   // 打死的丧尸别产生经验把测试推进升级界面
  if (Game.state !== 'run') { Game.state = 'run'; Game.run.choices = []; p.xp = 0; }
  Game.update(1 / 60);
  if (s.sSt === 1 && prevState !== 1) pounces++;
  prevState = s.sSt;
  if (s.roarT > 0 && !roared) roared = true;
}
check('三段扑杀：会连续扑（至少 6 次进入蓄力=两轮）', pounces >= 6, pounces + ' 次蓄力');
check('会狂暴嚎叫（狂暴加速标记出现）', roared);

/* 召尸专项：清空其它敌人，逼一发嚎叫，看周围是否长出普通丧尸 */
Game.run.enemies.length = 0;
Game.run.enemies.push(s);
Game.run.boss = s;
s.sRoarCd = 0.01; s.sSt = 0;
let summonedNear = 0;
for (let f = 0; f < 60 * 3; f++) {
  s.x = Math.max(s.x, 120);
  p.x = 0; p.y = 0;
  p.hp = p.maxHp; p.invuln = 0;
  Game.run.gems.length = 0;
  if (Game.state !== 'run') { Game.state = 'run'; Game.run.choices = []; p.xp = 0; }
  Game.update(1 / 60);
  if (s.roarT > 0) {
    // 嚎叫瞬间之后统计新长的丧尸
    for (let q = 0; q < 30; q++) {
      Game.run.gems.length = 0;
      if (Game.state !== 'run') { Game.state = 'run'; Game.run.choices = []; p.xp = 0; }
      Game.update(1 / 60);
    }
    for (const en of Game.run.enemies) {
      if (en !== s && !en.boss && U.dist(en.x, en.y, s.x, s.y) < 140) summonedNear++;
    }
    break;
  }
}
check('嚎叫会召集普通丧尸', summonedNear >= 4, summonedNear + ' 只在身边');

/* 狂怒层数：重伤时技能冷却消耗更快（= 攻击频率更高） */
s.sSt = 0; s.sPounceCd = 10; s.hp = s.maxHp; s.sRoarCd = 999;
for (let f = 0; f < 60; f++) {
  p.hp = p.maxHp; p.invuln = 0;
  Game.run.gems.length = 0;
  if (Game.state !== 'run') { Game.state = 'run'; Game.run.choices = []; p.xp = 0; }
  Game.update(1 / 60);
}
const cd0 = s.sPounceCd;
s.sPounceCd = 10; s.hp = s.maxHp * 0.4;   // 损失 60% → 2 层狂怒 → 消耗 x1.2
for (let f = 0; f < 60; f++) {
  p.hp = p.maxHp; p.invuln = 0;
  Game.run.gems.length = 0;
  if (Game.state !== 'run') { Game.state = 'run'; Game.run.choices = []; p.xp = 0; }
  Game.update(1 / 60);
}
const cd1 = s.sPounceCd;
check('损失生命提高攻击频率',
  Math.abs((cd0 - cd1) - 0.2) < 0.02,
  '满血剩 ' + cd0.toFixed(2) + ' → 重伤剩 ' + cd1.toFixed(2) + '（60% 失血应多消耗 0.2）');

console.log('\n' + (bad === 0 ? '全部通过 ✓' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
