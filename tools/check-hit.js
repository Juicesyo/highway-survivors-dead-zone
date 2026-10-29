/**
 * 弹道命中自检（扫掠判定 / 穿透 / 单发伤害）
 * 用法: node tools/check-hit.js
 *
 * 解决的问题：伤害数值算得再对，**打不中**也是白搭。
 * 以前弹体每帧只在"终点"上做一次圆判定，而一帧的位移可能比目标还长：
 * 反器材步枪 780px/s，30fps 下每帧飞 26px，游荡者的判定直径只有
 * (5.5 + 1.9) × 2 ≈ 14.8px —— 子弹会整帧跨过它，实测 30fps 只有 46% 的
 * 重弹能落地（60fps 时 100%）。同一个 30fps 设备上狙击步枪掉到 53%，
 * 也就是说"低帧率手机上的重弹流天生少一半伤害"。
 *
 * 现在判定走线段（combat.js 的 segDist2），这里把三件事钉死：
 *   1. 各帧率下命中率一致（30 / 45 / 60 / 120fps 差距不超过 2 个百分点）
 *   2. 穿透按 pierce 真的能穿到后面几只
 *   3. 单发落地伤害 = 面板伤害（不多算、不衰减）
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
global.GameGlobal = global;
const reqs = [...fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8')
  .matchAll(/require\((['"])(.+?)\1\)/g)].map((m) => m[2]);
for (const r of reqs) require(path.join(ROOT, r));

const HS = global.HS;
HS.Main.boot();
const G = HS.Game;
const D = HS.Data;
const Gear = HS.Gear;
G.testMode = true;

/* 隔离掩体 / 载具：这一轮只看弹道判定本身，别让墙替子弹背锅 */
HS.World.hitBlock = function () { return false; };

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  (' + extra + ')' : ''));
  if (!cond) bad++;
}

/** 干净的一局：只带一把武器、木桩满血、关掉暴击 */
function setup(id, lvl) {
  G.startRun('highway', 'whale');
  const p = G.run.p;
  p.x = 0;
  p.y = 0;
  p.invuln = 1e9;
  p.weapons.length = 0;
  p.autos.length = 0;
  const def = D.gear[id];
  const w = { id: id, lvl: lvl, up: {}, slot: def.slot, timer: 0 };
  p.weapons.push(w);
  G.recalc(p);
  /* recalc 之后清掉暴击，这一轮量的是"面板伤害" */
  p.crit = 0;
  p.critMul = 1;
  G.run.enemies.length = 0;
  G.run.vehicles.length = 0;
  G.run.bullets.length = 0;
  return { p: p, w: w, st: Gear.stat(w, p) };
}

/**
 * 打一个静止木桩：返回 开火数 / 命中数 / 总伤害。
 * 收尾多跑 1.5 秒 updateBullets（不再开火），把还在飞的子弹结算完 ——
 * 否则"最后一发打出去、时间到"会被误判成空包弹。
 */
function vsDummy(id, lvl, type, dist, ang, hz, secs) {
  const ctx = setup(id, lvl);
  const p = ctx.p;
  const ex = Math.cos(ang) * dist;
  const ey = Math.sin(ang) * dist;
  const e = G.spawnEnemy(type, false, ex, ey);
  e.speed = 0;
  e.maxHp = 1e9;
  e.hp = 1e9;
  e.armor = 0;

  let shots = 0;
  let hits = 0;
  const origShoot = G.shoot.bind(G);
  G.shoot = function (x, y, a, o) { shots++; return origShoot(x, y, a, o); };
  const origHurt = G.hurtEnemy.bind(G);
  G.hurtEnemy = function (en, d, o) { if (en === e) hits++; return origHurt(en, d, o); };

  const dt = 1 / hz;
  const T = secs || 12;
  let t = 0;
  for (; t < T; t += dt) {
    G.run.t = t;
    p.x = 0; p.y = 0;
    e.x = ex; e.y = ey;
    G.updateWeapons(dt);
    G.updateBullets(dt);
  }
  /* 收尾：只让子弹飞完，不再开火 */
  for (let k = 0; k < Math.round(1.5 * hz); k++) {
    G.run.t = t; t += dt;
    G.updateBullets(dt);
  }
  G.shoot = origShoot;
  G.hurtEnemy = origHurt;
  return { shots: shots, hits: hits, dmg: 1e9 - e.hp, st: ctx.st };
}

/** 命中率：多角度 / 多距离取平均，避免"某一个相位刚好"的巧合 */
function hitRate(id, lvl, type, hz) {
  let shots = 0;
  let hits = 0;
  /* 距离压在射程以内（最远 = range - 10）：射程外的目标本来就不该被锁定 */
  const far = Math.max(70, D.gear[id].base.range - 10);
  for (let i = 0; i < 36; i++) {
    const ang = (i / 36) * Math.PI * 2;
    const dist = 60 + (i % 6) * ((far - 60) / 6);
    const r = vsDummy(id, lvl, type, dist, ang, hz);
    shots += r.shots;
    hits += r.hits;
  }
  return hits / Math.max(1, shots);
}

console.log('\n[1. 高速弹体在低帧率下不会穿过敌人]');
for (const id of ['amr', 'sniper']) {
  const rates = {};
  for (const hz of [120, 60, 45, 30]) rates[hz] = hitRate(id, 1, 'walker', hz);
  const lo = Math.min(rates[30], rates[45], rates[60], rates[120]);
  const hi = Math.max(rates[30], rates[45], rates[60], rates[120]);
  const txt = [30, 45, 60, 120].map((hz) => hz + 'fps ' + (rates[hz] * 100).toFixed(0) + '%').join(' / ');
  check(D.gear[id].name + ' 各帧率命中率 ≥95% 且一致', lo >= 0.95 && hi - lo <= 0.02, txt);
}
/* 散射武器（重机枪 / 霰弹）本来就打不满，只要求"帧率之间不缩水" */
{
  const rates = {};
  for (const hz of [60, 30]) rates[hz] = hitRate('hmg', 1, 'walker', hz);
  check('重机枪 命中率不受帧率影响',
    Math.abs(rates[60] - rates[30]) <= 0.03,
    '30fps ' + (rates[30] * 100).toFixed(0) + '% / 60fps ' + (rates[60] * 100).toFixed(0) + '%');
}

console.log('\n[2. 小目标（疾行者 / 爬行者）同样打得中]');
for (const type of ['runner', 'crawler']) {
  const r30 = hitRate('amr', 1, type, 30);
  check(D.enemies[type].name + ' 30fps 命中率 ≥95%', r30 >= 0.95, (r30 * 100).toFixed(0) + '%');
}

console.log('\n[3. 穿透：一发按 pierce 穿到后面几只]');
{
  const ctx = setup('amr', 1);
  const p = ctx.p;
  const list = [];
  for (let i = 0; i < 5; i++) {
    const e = G.spawnEnemy('walker', false, 40 + i * 34, 0);
    e.speed = 0;
    e.maxHp = 1e9;
    e.hp = 1e9;
    e.armor = 0;
    list.push(e);
  }
  const per = list.map(() => 0);
  const origHurt = G.hurtEnemy.bind(G);
  G.hurtEnemy = function (en, d, o) {
    const i = list.indexOf(en);
    if (i >= 0) per[i]++;
    return origHurt(en, d, o);
  };
  const dt = 1 / 60;
  for (let t = 0; t < 12; t += dt) {
    G.run.t = t;
    p.x = 0; p.y = 0;
    for (let i = 0; i < list.length; i++) { list[i].x = 40 + i * 34; list[i].y = 0; }
    G.updateWeapons(dt);
    G.updateBullets(dt);
  }
  G.hurtEnemy = origHurt;
  check('反器材步枪 pierce=4 能穿 5 只', per.every((n) => n > 0), '每只挨打 ' + per.join(' / '));
}

console.log('\n[4. 单发落地伤害 = 面板伤害]');
for (const [id, lvl] of [['amr', 1], ['amr', 5], ['sniper', 1], ['pistol', 1]]) {
  const r = vsDummy(id, lvl, 'brute', 90, 0.3, 60, 12);
  const per = r.dmg / Math.max(1, r.hits);
  check(D.gear[id].name + ' Lv' + lvl + ' 每发 ' + per.toFixed(1) + ' = 面板 ' + r.st.dmg.toFixed(1),
    Math.abs(per - r.st.dmg) < 0.5, r.hits + ' 次命中');
  check(D.gear[id].name + ' Lv' + lvl + ' 命中数 = 开火数（无空包弹）', r.hits === r.shots,
    r.hits + '/' + r.shots);
}

console.log('\n[5. 进化「破城者」命中即爆：波及旁边的敌人]');
{
  const ctx = setup('amr_x', 1);
  const p = ctx.p;
  const a = G.spawnEnemy('walker', false, 90, 0);
  const b = G.spawnEnemy('walker', false, 90, 24);   // 站在爆心旁边
  [a, b].forEach((e) => { e.speed = 0; e.maxHp = 1e9; e.hp = 1e9; e.armor = 0; });
  check('进化形态带 explode 开关', !!(ctx.st.sp && ctx.st.sp.explode), JSON.stringify(ctx.st.sp));
  check('爆炸半径 > 0', ctx.st.radius > 0, ctx.st.radius);
  const dt = 1 / 60;
  for (let t = 0; t < 8; t += dt) {
    G.run.t = t;
    p.x = 0; p.y = 0;
    a.x = 90; a.y = 0;
    b.x = 90; b.y = 24;
    G.updateWeapons(dt);
    G.updateBullets(dt);
  }
  const direct = 1e9 - a.hp;
  const splash = 1e9 - b.hp;
  check('被命中的目标受伤', direct > 0, Math.round(direct));
  check('旁边的敌人吃到溅射', splash > 0, Math.round(splash));
  check('本体伤害 > 溅射', direct > splash, Math.round(direct) + ' > ' + Math.round(splash));
}

console.log('\n' + (bad ? '有 ' + bad + ' 项没通过' : '全部通过 ✓'));
process.exit(bad ? 1 : 0);
