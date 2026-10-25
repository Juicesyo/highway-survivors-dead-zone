/**
 * 锈水高速端到端检测
 * 用法: node tools/check-flood.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
global.GameGlobal = global;
const reqs = [...fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8')
  .matchAll(/require\((['"])(.+?)\1\)/g)].map(m => m[2]);
for (const r of reqs) require(path.join(ROOT, r));
const HS = global.HS;
HS.Main.boot();
const G = HS.Game, P = HS.P, D = HS.Data, U = HS.U;
G.testMode = true;

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  (' + extra + ')' : ''));
  if (!cond) bad++;
}

console.log('[地图与生成]');
G.state = 'title';
G.startRun('flood', 'soldier');
check('锈水高速是第四关', D.mapOrder.length === 4 && D.mapOrder[3] === 'flood', D.mapOrder.join(','));
check('主题为 flood', G.run.map.theme === 'flood');
check('通关奖励 110', G.run.map.clearGold === 110);
check('深水形成边界', HS.Water.zone(116, 0, G.run) === 2, HS.Water.zone(116, 0, G.run));
check('立交中央有可通行区', HS.Water.zone(0, 0, G.run) < 2, HS.Water.zone(0, 0, G.run));
check('不会生成城市楼群', HS.World.buildingsInRect(-500, -500, 500, 500, []).length === 0);

/* 深水不许围出孤岛：从玩家位置在 12px 网格上泛洪，范围内所有可走格都必须连得上。
   旧版按 32px 格子随机深浅，会在侧带围出小水塘 —— 怪刷在里面就永远出不来。 */
{
  const N2 = 12, R2 = 480;
  const seen = new Set();
  const kOf = (gx, gy) => gx + ',' + gy;
  const walk = (gx, gy) => HS.Water.zone(gx * N2, gy * N2, G.run) !== 2;
  const q = [[0, 0]]; seen.add(kOf(0, 0));
  let head = 0;
  while (head < q.length) {
    const gx = q[head][0], gy = q[head][1]; head++;
    const nb = [[gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]];
    for (const n of nb) {
      if (n[0] * N2 < -R2 || n[0] * N2 > R2 || n[1] * N2 < -R2 || n[1] * N2 > R2) continue;
      const k = kOf(n[0], n[1]);
      if (seen.has(k) || !walk(n[0], n[1])) continue;
      seen.add(k); q.push(n);
    }
  }
  let allFree = 0;
  for (let gx = -R2 / N2; gx <= R2 / N2; gx++) {
    for (let gy = -R2 / N2; gy <= R2 / N2; gy++) if (walk(gx, gy)) allFree++;
  }
  check('深水没有围出孤岛（可走区域全连通）', seen.size === allFree,
    seen.size + '/' + allFree);
}

/* 桥面上不放水泥隔离墩：竖着的墩子只剩一个灰色长方形，把可走的路切成碎块 */
const fprops = [];
HS.World.queryRect(-700, -700, 700, 700, fprops);
check('桥面不放水泥隔离墩', !fprops.some(o => o.type === 'barrier'),
  fprops.filter(o => o.type === 'barrier').length + ' 个');
const fdim = fprops.filter(o => {
  const s = HS.Sprites.size(o.frame);
  return s.w !== o.w || s.h !== o.h;
});
check('锈水道具有效碰撞盒', fdim.length === 0,
  fdim.slice(0, 3).map(o => o.type + ':' + o.frame + ' ' + o.w + 'x' + o.h).join(' | '));

console.log('[移动与碰撞]');
let shallow = null;
for (let x = -70; x <= 70 && !shallow; x += 4) {
  for (let y = -70; y <= 70; y += 4) {
    if (HS.Water.zone(x, y, G.run) === 1) { shallow = { x, y }; break; }
  }
}
check('能生成浅水区', !!shallow, shallow ? shallow.x + ',' + shallow.y : '无');
const pp = G.run.p;
pp.x = shallow.x; pp.y = shallow.y; pp.roof = null;
check('浅水让玩家减速', Math.abs(HS.Water.speed(pp, G.run) - 0.76) < 0.001, HS.Water.speed(pp, G.run));
const deep = { x: 116, y: 0 };
check('深水区仍然存在（只是不再拦路）', HS.Water.zone(deep.x, deep.y, G.run) === 2);
/* 深水改成"极度缓慢"：不再把实体顶回岸上，但速度掉到 0.3 */
const ent = { x: deep.x, y: deep.y, roof: null };
HS.Water.resolve(ent, 5, 0, 0, G.run);
check('深水不再把人顶回岸上', ent.x === deep.x && ent.y === deep.y, Math.round(ent.x) + ',' + Math.round(ent.y));
const deepSaveX = pp.x, deepSaveY = pp.y;
pp.x = deep.x; pp.y = deep.y;
check('玩家在深水里速度极低（能走但几乎挪不动）', HS.Water.speed(pp, G.run) <= 0.32,
  HS.Water.speed(pp, G.run).toFixed(2));
pp.x = deepSaveX; pp.y = deepSaveY;
let edge = null;
for (let x = 40; x <= 112 && !edge; x += 1) {
  if (HS.Water.zone(x, 0, G.run) !== 2 && HS.Water.zone(x + 28, 0, G.run) === 2) edge = x;
}
const detour = edge === null ? 0 : HS.Water.stepDir(edge, 0, 0, 28, G.run, 1);
check('会沿深水岸线绕行而不是顶死',
  edge !== null && Math.abs(detour) > 0.1 && HS.Water.zone(edge + Math.cos(detour) * 28, Math.sin(detour) * 28, G.run) !== 2,
  edge === null ? '无岸线样本' : 'dir=' + detour.toFixed(2));

console.log('[载具]');
const v0 = G.run.vehicles[0];
check('锈水高速开局有载具', !!v0);
check('载具不会刷在深水里', !!v0 && HS.Water.canPlace(v0.x, v0.y, v0.w, v0.h, G.run),
  v0 ? HS.Water.zone(v0.x, v0.y, G.run) : '无载具');
if (v0) {
  v0.x = 0; v0.y = 0; v0.heading = 0; v0.mvDir = 0; v0.speed = 100;
  pp.x = 0; pp.y = 0; pp.veh = null;
  const entered = HS.Vehicle.enter(G.run, v0);
  check('可以驾驶载具', entered);
  let movedY = 0, maxX = 0;
  for (let i = 0; i < 180; i++) {
    HS.Vehicle.drive(G.run, 1 / 60, { dx: 1, dy: 0, mag: 1 });
    movedY = Math.max(movedY, Math.abs(pp.y));
    maxX = Math.max(maxX, pp.x);
  }
  check('载具会开进深水（岸线不再是墙）', HS.Water.zone(pp.x, pp.y, G.run) === 2,
    Math.round(pp.x) + ',' + Math.round(pp.y));
  check('载具在深水里仍能慢慢开', maxX > 60 && HS.Water.speed(pp, G.run) <= 0.34,
    'maxX=' + maxX.toFixed(1) + ' spd×' + HS.Water.speed(pp, G.run).toFixed(2));
  HS.Vehicle.exit(G.run);
}

console.log('[怪物绕水]');
let start = null;
for (let x = 80; x <= 118 && !start; x += 2) {
  for (let y = -76; y <= 76; y += 4) {
    if (HS.Water.zone(x, y, G.run) !== 2) { start = { x, y }; break; }
  }
}
if (start) {
  pp.x = 0; pp.y = 0; pp.veh = null; pp.hp = pp.maxHp; pp.invuln = 999;
  G.run.enemies.length = 0;
  /* 在两者之间放一个深水圆坑，专测“绕过去”而不是“走直线”。 */
  G.run.waterHazards.push({ x: (start.x + pp.x) / 2, y: (start.y + pp.y) / 2, r: 26, life: 99, max: 99 });
  const walker = G.spawnEnemy('walker', false, start.x, start.y);
  walker.x = start.x; walker.y = start.y; walker.hp = 1e9; walker.maxHp = 1e9;
  let d0 = U.dist(walker.x, walker.y, 0, 0), deepT = 0, deepMove = 0, lx = walker.x, ly = walker.y;
  for (let i = 0; i < 1500; i++) {
    pp.invuln = 999;
    G.updateEnemies(1 / 60);
    if (HS.Water.zone(walker.x, walker.y, G.run) === 2) {
      deepT += 1 / 60;
      deepMove += U.dist(walker.x, walker.y, lx, ly);
    }
    lx = walker.x; ly = walker.y;
    if (walker.dead) break;
  }
  const d1 = U.dist(walker.x, walker.y, 0, 0);
  check('怪物能接近玩家（绕行或趟水都行）', d1 < d0 - 35, d0.toFixed(0) + ' → ' + d1.toFixed(0));
  check('趟水时也在前进（不会泡在水里不动）', deepT < 0.2 || deepMove / deepT > 4,
    '深水 ' + deepT.toFixed(1) + 's 走了 ' + deepMove.toFixed(0) + 'px');
  G.run.enemies.length = 0;
  G.run.waterHazards.length = 0;
} else {
  check('怪物会绕过深水接近玩家', false, '找不到测试岸线');
  check('怪物没有卡在深水里', false, '找不到测试岸线');
}

console.log('[导电]');
let wp = null;
for (let gx = -2; gx <= 2 && !wp; gx++) {
  for (let gy = -2; gy <= 2; gy++) {
    const cx = gx * 32 + 16, cy = gy * 32 + 16;
    if (HS.Water.zone(cx, cy, G.run) === 1 && HS.Water.zone(cx + 8, cy, G.run) === 1) {
      wp = { x: cx, y: cy }; break;
    }
  }
}
G.run.enemies.length = 0;
pp.x = wp.x; pp.y = wp.y; pp.hp = pp.maxHp; pp.invuln = 0; pp.veh = null;
const src = G.spawnEnemy('walker', false, wp.x, wp.y);
const near = G.spawnEnemy('walker', false, wp.x + 8, wp.y);
src.x = wp.x; src.y = wp.y;
near.x = wp.x + 8; near.y = wp.y;
G.run.shockSelfT = 0;
const nhp = near.hp, php = pp.hp;
G.hurtEnemy(src, 20, { tag: 'energy', electric: 1, noCrit: true });
check('电击会沿积水跳伤邻近敌人', near.hp < nhp, (nhp - near.hp).toFixed(1));
check('玩家站在水里会遭到反噬', pp.hp < php, (php - pp.hp).toFixed(1));

console.log('[残骸]');
let foundWreck = false;
for (let ox = -600; ox <= 600 && !foundWreck; ox += 192) {
  for (let oy = -600; oy <= 600; oy += 192) {
    pp.x = ox; pp.y = oy;
    HS.Water.ensure(G.run);
    if (G.run.wrecks.length) { foundWreck = true; break; }
  }
}
check('会生成半沉车辆残骸', foundWreck, G.run.wrecks.length + ' 辆');
check('残骸密度受控', G.run.wrecks.length <= 5, G.run.wrecks.length + ' 辆');
if (foundWreck) {
  const w = G.run.wrecks[0];
  const wx0 = w.x, wy0 = w.y, hp0 = w.hp;
  /* 废弃车辆是死物：水鬼、普通尸群、玩家、载具都推不动，只能绕开或砸碎 */
  const movers = [
    ['水鬼', { x: w.x - w.w / 2 - 3, y: w.y, r: 5, uid: 9001, def: D.enemies.drowner, roof: null }],
    ['普通丧尸', { x: w.x - w.w / 2 - 3, y: w.y, r: 5, uid: 9002, def: D.enemies.walker, roof: null }],
    ['玩家', pp],
    ['Boss', { x: w.x - w.w / 2 - 6, y: w.y, r: 18, uid: 9003, boss: true, def: D.enemies.axeboss, roof: null }]
  ];
  for (const [name, mover] of movers) {
    HS.Water.resolveWrecks(mover, mover.r || 5, mover.x - 3, mover.y, G.run);
    HS.Water.resolveWrecks(mover, mover.r || 5, mover.x - 6, mover.y, G.run);
  }
  for (let i = 0; i < 90; i++) HS.Water.update(G.run, 1 / 60);
  check('任何实体都推不动废弃车辆', w.x === wx0 && w.y === wy0 && w.hp === hp0,
    'dx=' + (w.x - wx0).toFixed(2) + ' dy=' + (w.y - wy0).toFixed(2));
  check('残骸把实体挡在外面', Math.abs(movers[1][1].x - w.x) > w.w / 2,
    (movers[1][1].x - w.x).toFixed(1) + ' / 半宽 ' + (w.w / 2));
  check('残骸碰撞盒与坐标一致',
    Math.abs(w.x - (w.bx0 + w.bx1) / 2) < 0.001 && Math.abs(w.by - w.y1) < 0.001);
  check('残骸坐标没有 NaN', isFinite(w.x) && isFinite(w.y), w.x.toFixed(1) + ',' + w.y.toFixed(1));
  HS.Water.smash(w.x, w.y, 4, G.run, 999);
  check('残骸可被 Boss 招式打碎', w.broken === true);
  check('砸碎后原地崩解不位移', w.x === wx0 && w.y === wy0);
}

console.log('[随机事件]');
G.run.pumpT = 0; G.run.safeT = 0;
pp.x = 0; pp.y = 0;
let sawPump = false, sawSafe = false;
for (let i = 0; i < 80 && (!sawPump || !sawSafe); i++) {
  G.run.pumpT = 0; G.run.safeT = 0;
  HS.Water.event(G.run);
  if (G.run.pumpT > 0) sawPump = true;
  if (G.run.safeT > 0) sawSafe = true;
}
check('抽水机事件会排开深水', sawPump);
check('桥下安全屋事件会开放', sawSafe);
G.run.pumpT = 18; G.run.pumpX = 0; G.run.pumpY = 0; G.run.pumpR = 112;
check('抽水机范围内深水变浅/干', HS.Water.zone(100, 0, G.run) < 2, HS.Water.zone(100, 0, G.run));

console.log('[绕水寻路]');
G.run.enemies.length = 0;
G.run.waterHazards.length = 0;
pp.x = 0; pp.y = 0; pp.invuln = 999; pp.hp = pp.maxHp; pp.veh = null;
/* 中间挡住一半桥面：粗网格寻路应该给出绕行点，而不是直冲 */
G.run.waterHazards.push({ x: -26, y: -90, r: 52, life: 20, max: 20 });
const rt = HS.Water.route(0, -190, 0, 0, G.run);
check('粗网格寻路能绕过深水', !!rt, rt ? Math.round(rt.x) + ',' + Math.round(rt.y) : '无');
/* 整条桥面被打穿（Boss 连砸几斧）时应该老实返回空，交给上层换进场点 */
G.run.waterHazards.push({ x: 0, y: -60, r: 140, life: 20, max: 20 });
check('路被彻底封死时寻路返回空', HS.Water.route(0, -190, 0, 0, G.run) === null);
G.run.waterHazards.length = 0;

/* 八方向围攻：每只都要走到玩家身边，且全程不站进深水 */
let tried = 0, arrived = 0, inDeep = 0, worst = null;
for (let i = 0; i < 8; i++) {
  const a = i / 8 * Math.PI * 2;
  const sx = Math.cos(a) * 150, sy = Math.sin(a) * 150;
  if (HS.Water.zone(sx, sy, G.run) === 2 || HS.World.insideSolid(sx, sy)) continue;
  tried++;
  G.run.enemies.length = 0;
  const z = G.spawnEnemy('walker', false, sx, sy);
  z.x = sx; z.y = sy;
  let minD = Math.hypot(sx, sy), deep = false;
  for (let f = 0; f < 720; f++) {
    G.updateEnemies(1 / 60); pp.x = 0; pp.y = 0; pp.hp = pp.maxHp;
    minD = Math.min(minD, Math.hypot(z.x - pp.x, z.y - pp.y));
    if (HS.Water.zone(z.x, z.y, G.run) === 2) deep = true;
  }
  if (minD < 40) arrived++;
  else if (!worst) worst = Math.round(sx) + ',' + Math.round(sy) + ' 最近 ' + minD.toFixed(0);
  if (deep) inDeep++;
}
check('八方向的丧尸都能走到玩家身边', arrived === tried, arrived + '/' + tried + (worst ? ' 卡在 ' + worst : ''));

/* 直接把一只丧尸丢进深水：它应该能慢慢趟出来，而不是被判成"卡死" */
let deepStart = null;
for (let x = 92; x <= 132 && !deepStart; x += 2) {
  if (HS.Water.zone(x, 0, G.run) === 2) deepStart = { x, y: 0 };
}
if (deepStart) {
  G.run.enemies.length = 0;
  pp.x = 0; pp.y = 0; pp.veh = null; pp.hp = pp.maxHp;
  const w2 = G.spawnEnemy('walker', false, deepStart.x, 0);
  w2.x = deepStart.x; w2.y = 0; w2.hp = w2.maxHp = 1e9;
  for (let f = 0; f < 600; f++) {
    G.updateEnemies(1 / 60); pp.x = 0; pp.y = 0; pp.hp = pp.maxHp;
  }
  check('丢进深水的丧尸能自己趟出来', Math.hypot(w2.x, w2.y) < deepStart.x - 20,
    deepStart.x + ' → ' + Math.hypot(w2.x, w2.y).toFixed(0));
} else {
  check('丢进深水的丧尸能自己趟出来', false, '找不到深水样本');
}
G.run.enemies.length = 0;

console.log('[刷怪与 Boss]');
G.run.enemies.length = 0;
let drowners = 0, vomiters = 0;
for (let i = 0; i < 400; i++) {
  const t = G.pickType(120);
  if (t === 'drowner') drowners++;
  if (t === 'vomiter') vomiters++;
}
check('水鬼进入锈水刷怪池', drowners > 0, drowners + '/400');
check('呕酸尸也混在锈水尸群', vomiters > 0, vomiters + '/400');
check('水鬼拥有水栖标记', D.enemies.drowner.waterborne === true);
check('水鬼不再共用扑袭者的猛扑', !D.enemies.drowner.pounce && D.enemies.pouncer.pounce === true,
  'pounce=' + D.enemies.drowner.pounce);

console.log('[水鬼潜渡]');
G.run.enemies.length = 0;
G.run.waterHazards.length = 0; G.run.pumpT = 0;
let wet = null;
for (let x = -70; x <= 70 && !wet; x += 3) {
  for (let y = -70; y <= 70; y += 3) {
    if (HS.Water.zone(x, y, G.run) === 1) { wet = { x, y }; break; }
  }
}
let stand = null;
for (let a = 0; a < 12 && !stand; a++) {
  for (let r = 70; r <= 112; r += 10) {
    const sx = wet.x + Math.cos(a * Math.PI / 6) * r;
    const sy = wet.y + Math.sin(a * Math.PI / 6) * r;
    if (HS.Water.zone(sx, sy, G.run) !== 2 && !HS.World.insideSolid(sx, sy)) { stand = { x: sx, y: sy }; break; }
  }
}
pp.x = stand.x; pp.y = stand.y; pp.veh = null; pp.roof = null;
pp.hp = pp.maxHp; pp.invuln = 999;
/* 在水鬼与玩家之间制造一段深水坑：它必须横穿过去 */
G.run.waterHazards.push({ x: (wet.x + stand.x) / 2, y: (wet.y + stand.y) / 2, r: 30, life: 20, max: 20 });
const dr = G.spawnEnemy('drowner', false, wet.x, wet.y);
dr.x = wet.x; dr.y = wet.y; dr.subState = 0; dr.submerged = false; dr.subCd = 0;
let sawDive = false, sawSub = false, sawDeep = false, sawSurface = false;
for (let i = 0; i < 170; i++) {
  G.updateEnemies(1 / 60);
  if (dr.subState === 1) sawDive = true;
  if (dr.submerged) {
    sawSub = true;
    if (HS.Water.zone(dr.x, dr.y, G.run) === 2) sawDeep = true;
  } else if (sawSub) sawSurface = true;
}
check('水鬼会下潜（冒泡预警）', sawDive);
check('水鬼会进入水下突进', sawSub);
check('潜渡能横穿深水', sawDeep, 'x=' + Math.round(dr.x) + ',' + Math.round(dr.y));
check('水鬼会重新浮出水面', sawSurface && !dr.submerged);

/* 深水不再拦任何人，差别只剩速度：水鬼几乎不减速，普通丧尸慢到 1/3 */
dr.submerged = false; dr.subState = 0; dr.x = 150; dr.y = 0;
check('水鬼在深水里几乎不减速', HS.Water.speed(dr, G.run) > 0.9,
  HS.Water.speed(dr, G.run).toFixed(2));
const zw = G.spawnEnemy('walker', false, 150, 0);
zw.x = 150; zw.y = 0;
check('普通丧尸在深水里极慢', HS.Water.speed(zw, G.run) < 0.4,
  HS.Water.speed(zw, G.run).toFixed(2));
zw.dead = true;

/* 水鬼从深水侧直接摸到岸上的玩家 */
G.run.enemies.length = 0;
pp.x = 0; pp.y = 0; pp.invuln = 999; pp.hp = pp.maxHp; pp.veh = null;
const flank = G.spawnEnemy('drowner', false, 108, 30);
flank.x = 108; flank.y = 30; flank.subCd = 99; flank.submerged = false; flank.subState = 0;
let flankReach = false, flankDeep = false;
for (let i = 0; i < 420; i++) {
  G.updateEnemies(1 / 60); pp.x = 0; pp.y = 0; pp.hp = pp.maxHp;
  if (HS.Water.zone(flank.x, flank.y, G.run) === 2) flankDeep = true;
  if (Math.hypot(flank.x - pp.x, flank.y - pp.y) < 14) flankReach = true;
}
check('水鬼会从两侧深水区接近玩家', flankDeep && flankReach,
  '深水=' + flankDeep + ' 到达=' + flankReach);
flank.dead = true;

/* 水下无法被选中 / 无法被伤害，但爆炸是例外 */
dr.hp = dr.maxHp;
dr.submerged = true;
const hpA = dr.hp;
G.hurtEnemy(dr, 40, { tag: 'auto' });
check('水下打不到它', dr.hp === hpA, 'hp=' + dr.hp.toFixed(1));

dr.dead = false; dr.hp = dr.maxHp;
dr.submerged = true; dr.subState = 2; dr.subT = 1.5;
if (G.run.enemies.indexOf(dr) < 0) G.run.enemies.push(dr);
const hpB = dr.hp;
G.explode(dr.x, dr.y, 44, 30, '#ffb86b', null);
check('榴弹/炸弹能炸到水下的水鬼', dr.hp < hpB, 'hp=' + dr.hp.toFixed(1));
check('被炸后震出水面', dr.submerged === false && dr.subState === 3,
  'submerged=' + dr.submerged + ' state=' + dr.subState);
G.hurtEnemy(dr, 6, { tag: 'auto' });
check('浮出后照常吃伤害', dr.hp < hpB, 'hp=' + dr.hp.toFixed(1));
dr.dead = true;
G.run.waterHazards.length = 0;
G.run.t = 360; G.run.nextBossAt = 360; G.run.boss = null; G.run.bossSpawned = false;
G.spawnBoss();
check('锈水 Boss 是断堤巨斧', G.run.boss && G.run.boss.def.id === 'axeboss', G.run.boss && G.run.boss.def.name);
check('巨斧 Boss 高耐久', G.run.boss.maxHp > 2000, Math.round(G.run.boss.maxHp));
check('Boss 名称进入图鉴数据', !!D.enemies.axeboss && D.enemies.axeboss.boss === true);

console.log('[渲染]');
G.state = 'run';
let renderOK = true;
try { G.render(); } catch (e) { renderOK = false; console.log('    ' + e.stack); }
check('锈水高速渲染无异常', renderOK);
check('水面层存在', typeof HS.Render.drawFlood === 'function');
check('双斧绘制层存在', typeof HS.Render.drawBossAxes === 'function');

console.log('\n' + (bad === 0 ? '全部通过 ✓' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
