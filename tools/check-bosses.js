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
  p.invuln = 0;                // 无敌帧不能挡掉"机制真的能伤人"的采样
  if (p.hp < p.maxHp) playerHurt = true;
  p.hp = p.maxHp;              // 不让它真打死玩家，只看机制
  Game.run.gems.length = 0;    // 别让升级打断测试
  if (Game.state !== 'run') { Game.state = 'run'; Game.run.choices = []; p.xp = 0; }
  Game.update(1 / 60);
  if (Game.run.ebullets.length > 0) sawBullets = true;
  if (g.gSt === 3) overheated = true;
}
/* 过热是概率判定（每 10 发 1%~30% 递增），极小概率整个窗口都不触发。
   为了让这条断言不偶发飘红，补一段把随机数压到 0 的定档重试。 */
if (!overheated) {
  const rnd = Math.random;
  Math.random = function () { return 0; };
  for (let f = 0; f < 60 * 12 && !overheated; f++) {
    g.x = 300; g.y = 0;
    p.x = 0; p.y = 0; p.invuln = 0; p.hp = p.maxHp;
    Game.run.gems.length = 0;
    if (Game.state !== 'run') { Game.state = 'run'; Game.run.choices = []; p.xp = 0; }
    Game.update(1 / 60);
    if (g.gSt === 3) overheated = true;
  }
  Math.random = rnd;
}
/* 弹幕伤害在整个扫射窗口内采样；不再只等过热后那 0.5 秒 */
check('会进入扫射（弹幕出现）', sawBullets, 'gSt=' + g.gSt);
check('打完会过热罢工', overheated, 'gSt=' + g.gSt);
check('弹幕真实伤害玩家', playerHurt, playerHurt ? '扫射窗口内掉血' : '未掉血');
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

/* ---------- 断堤巨斧 ---------- */
console.log('[断堤巨斧 flood/axeboss]');
Game.state = 'title';
Game.startRun('flood', 'soldier');
p = Game.run.p;
p.x = 0; p.y = 0;
const ax = Game.spawnEnemy('axeboss', false, 100, 0);
ax.boss = true; ax.x = 100; ax.y = 0;
Game.run.boss = ax;
const axHp = ax.maxHp;
let cleaved = false, leaped = false, hurtByBoss = false;
let maxBreaks = 0, maxHazards = 0, sawSwing = false;
let sawWind = false, prevASt = 0;
for (let f = 0; f < 60 * 24; f++) {
  p.x = 0; p.y = 0; p.invuln = 0;
  if (p.hp < p.maxHp) hurtByBoss = true;
  p.hp = p.maxHp;
  Game.run.gems.length = 0;
  if (Game.state !== 'run') { Game.state = 'run'; Game.run.choices = []; p.xp = 0; }
  /* 让 Boss 留在近身与中距离两档，逼它把两招都放出来 */
  if (f % 240 > 120) { ax.x = 100; ax.y = 0; } else { ax.x = 210; ax.y = 18; }
  if (f % 180 === 0) { ax.aCleaveCd = 0; ax.aLeapCd = 0; }
  Game.update(1 / 60);
  if (ax.aSt === 1) sawWind = true;
  if (prevASt === 1 && (ax.aSt === 5 || ax.aSt === 0)) cleaved = true;
  if (ax.aSt === 3) leaped = true;
  maxBreaks = Math.max(maxBreaks, (Game.run.breaks || []).length);
  maxHazards = Math.max(maxHazards, Game.run.waterHazards.length);
  if (ax.aSt === 5) sawSwing = true;
  prevASt = ax.aSt;
}
check('巨斧 Boss 血量高于血肉暴君', axHp > 2000, Math.round(axHp));
check('交叉斩有蓄力预警', sawWind);
check('交叉斩有挥砍收势动作', sawSwing);
check('交叉斩会把地面砸烂（留伤痕）', cleaved && maxBreaks > 0, '伤痕=' + maxBreaks);
check('跃劈会砸出地面破坏圈', leaped && maxBreaks > 0, '伤痕=' + maxBreaks);
check('地形破坏不会挖出深水', maxHazards === 0, '深水坑=' + maxHazards);
check('Boss 招式能真实伤到玩家', hurtByBoss);

console.log('\n' + (bad === 0 ? '全部通过 ✓' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
