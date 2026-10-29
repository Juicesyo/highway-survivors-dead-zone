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
G.startRun('flood', 'whale');
check('锈水高速是第四关', D.mapOrder[3] === 'flood', D.mapOrder.join(','));
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

/* 潜行时长按**距离**给，不是固定的 1.5 秒。
   1.5 秒只能游 34×1.75×1.5 ≈ 89px，而它从 250px 外就会起潜 ——
   以前经常"潜到一半自己浮上来"，在半路挨打，玩家看到的是"它凑不到人"。
   现在一路潜到脚下再出水；出水阈值 18 也小于咬击阈值 18.5（否则贴脸浮出却咬空）。 */
{
  const keepX = pp.x, keepY = pp.y, keepInv = pp.invuln;
  pp.x = -120; pp.y = 0; pp.hp = pp.maxHp; pp.invuln = 0;
  G.run.enemies.length = 0;
  let deepX = 60;
  for (let x = 60; x < 240; x += 2) { if (HS.Water.zone(x, 0, G.run) === 2) { deepX = x; break; } }
  const far = G.spawnEnemy('drowner', false, deepX, 0);
  far.x = deepX; far.y = 0; far.subCd = 0;
  const startD = Math.hypot(far.x - pp.x, far.y - pp.y);
  let maxSub = 0, bit = false, outDist = -1;
  for (let i = 0; i < 60 * 20 && !bit; i++) {
    pp.invuln = 0;
    const before = pp.hp;
    G.updateEnemies(1 / 60);
    pp.invuln = 0; pp.x = -120; pp.y = 0;
    if (pp.hp < before) bit = true;
    if (far.submerged) maxSub = Math.max(maxSub, far.subT);
    else if (far.subState === 3 && outDist < 0) outDist = Math.hypot(far.x - pp.x, far.y - pp.y);
  }
  check('潜行时长随距离拉长（不再是固定 1.5 秒）', maxSub > 2,
    Math.round(startD) + 'px → 潜 ' + maxSub.toFixed(2) + 's');
  check('从远处能潜到脚下并咬一口', bit, '出水距离 ' + Math.round(outDist) + 'px');
  check('出水点贴着玩家（<咬击阈值 18.5）', outDist >= 0 && outDist < 18.5,
    outDist.toFixed(1) + 'px');
  far.dead = true;
  pp.x = keepX; pp.y = keepY; pp.invuln = keepInv;
  G.run.enemies.length = 0;
}

/* 拖拽：咬中之后把玩家往最近的深水拽。
   它不靠伤害杀人（一口只有 5 点），靠的是把玩家从干地拖进泥沼 ——
   深水里只剩三成移速，尸群一围就出不来。玩家**不被缴械**：只是多一股位移，摇杆能对抗。 */
{
  pp.x = 0; pp.y = 0; pp.dragT = 0; pp.dragImmune = 0; pp.hp = pp.maxHp; pp.invuln = 1e9;
  G.run.enemies.length = 0;
  const okd = G.dragToWater({ x: 20, y: 0 });
  check('咬中后触发拖拽', okd === true);
  const dspd = Math.hypot(pp.dragVX, pp.dragVY);
  check('拖拽速度低于步行速度（干地上跑得掉）', dspd < pp.base.speed * pp.spdMul,
    '拖 ' + dspd.toFixed(0) + ' < 走 ' + (pp.base.speed * pp.spdMul).toFixed(0));
  check('拖拽快于深水移速（进了水就出不来）', dspd > pp.base.speed * pp.spdMul * 0.34,
    '深水 ' + (pp.base.speed * pp.spdMul * 0.34).toFixed(0));
  check('拖拽不是眩晕（玩家仍能操作、能开枪）', pp.stun === 0 && !pp.dragStun);

  /* 方向必须指向深水；没水的地方（楼顶 / 车里）不拖 */
  const ux = pp.dragVX / dspd, uy = pp.dragVY / dspd;
  let towardDeep = false;
  for (let dd = 20; dd <= 170; dd += 6) {
    if (HS.Water.zone(pp.x + ux * dd, pp.y + uy * dd, G.run) === 2) { towardDeep = true; break; }
  }
  check('拖拽方向指向深水', towardDeep, 'dir=' + ux.toFixed(2) + ',' + uy.toFixed(2));

  pp.dragT = 0;
  pp.roof = 'r1';
  check('楼顶上不拖', G.dragToWater({ x: pp.x, y: pp.y }) === false);
  pp.roof = null;
  pp.veh = { x: 0, y: 0, hp: 9 };
  check('车里不拖', G.dragToWater({ x: pp.x, y: pp.y }) === false);
  pp.veh = null;
  pp.dragT = 0; pp.dragVX = 0; pp.dragVY = 0;
}

/* 拖拽不能把玩家一路推到水中央 —— 这是最典型的一类"卡关"：
   深水里玩家只有三成移速、普通丧尸走不进来、BOSS 也过不来，
   于是既打不到东西也死不掉，整局卡死在离公路几十米的水面上。
   两条防护：① 已经在深水里就不再拖；② 松口后有免疫窗口，不许接力拖。 */
{
  pp.dragT = 0; pp.dragImmune = 0; pp.invuln = 1e9;
  pp.x = 0; pp.y = 0;
  let deepX2 = 60;
  for (let x = 60; x < 240; x += 2) { if (HS.Water.zone(x, 0, G.run) === 2) { deepX2 = x; break; } }

  /* 站进深水：不该再被拖 */
  pp.x = deepX2; pp.y = 0; pp.dragT = 0; pp.dragImmune = 0;
  check('已经在深水里就不再拖（否则会一路推到水中央）',
    G.dragToWater({ x: deepX2 + 20, y: 0 }) === false, '水深=' + HS.Water.zone(deepX2, 0, G.run));

  /* 免疫窗口：咬完一口后短时间内不会被接力拖 */
  pp.x = 0; pp.y = 0; pp.dragT = 0; pp.dragImmune = 0;
  const d1 = G.dragToWater({ x: 20, y: 0 });
  const d2 = G.dragToWater({ x: 20, y: 0 });
  check('第一次能拖', d1 === true);
  check('紧接着的第二口不会叠加拖拽（有免疫）', d2 === false);
  check('免疫覆盖"拖拽 + 冷却"', pp.dragImmune > 3.5,
    pp.dragImmune.toFixed(2) + 's');

  /* 最坏情况：12 次机会连续咬，看会被推到多远 */
  pp.x = 0; pp.y = 0; pp.dragT = 0; pp.dragImmune = 0;
  for (let bite = 0; bite < 12; bite++) {
    pp.dragImmune = 0;                 // 假设水鬼每次都等到免疫结束
    G.dragToWater({ x: pp.x + 20, y: pp.y });
    for (let i = 0; i < 120; i++) {
      pp.invuln = 1e9;
      G.update(1 / 60);
    }
  }
  const away = Math.hypot(pp.x, pp.y);
  check('连咬 12 次也不会被越拖越远', away < 260, '离公路 ' + Math.round(away) + 'px');
  /* 关键：拖到深水边缘就顶住，绝不把人推进去 ——
     深水里玩家 0.30 速、丧尸 0.34，进去就是死局（打不到怪也死不掉） */
  check('连咬 12 次也不会被拖进深水', HS.Water.zone(pp.x, pp.y, G.run) !== 2,
    '水深=' + HS.Water.zone(pp.x, pp.y, G.run));
  pp.dragT = 0; pp.dragVX = 0; pp.dragVY = 0; pp.dragImmune = 0;
  pp.x = 0; pp.y = 0;
  G.run.enemies.length = 0;
}

/* 出水保护（emergeGuard）：浮出水面那一拍打不中，0.35 秒后恢复。
   它血量只有 26（这张图折算 32），中期玩家一秒能打掉两百 —— 没有这层保护，
   水鬼辛苦潜过来就是"送经验"：咬完站在脸上必被秒。保护是为了让它能退回去，
   不是为了变肉（血量一点没动）。 */
{
  const g = G.spawnEnemy('drowner', false, 20, 0);
  g.x = 20; g.y = 0; g.speed = 0;
  g.subState = 2; g.submerged = true; g.subT = 0.001; g.subAng = Math.PI;
  G.updateEnemies(1 / 60);
  check('出水后不再算水下', g.submerged === false);
  check('出水时进入保护窗口', g.emergeGuard > 0.3, (g.emergeGuard || 0).toFixed(2));
  const ghp = g.hp;
  G.hurtEnemy(g, 9999, { noCrit: true });
  check('保护期内打不死', !g.dead && g.hp === ghp, 'hp=' + Math.round(g.hp));
  let gf = 0;
  while (g.emergeGuard > 0 && gf < 120) { G.updateEnemies(1 / 60); gf++; }
  check('保护窗口约 0.35 秒', gf >= 15 && gf <= 26, gf + ' 帧');
  G.hurtEnemy(g, 9999, { noCrit: true });
  check('保护过后照常结算', g.dead === true);
}

/* 范围持续输出（喷火 / 液氮 / 火焰环 / 冰霜环 / 地面火池 / 光束）对潜水的它
   必须**完全**无效 —— 不只是直伤被拦，点燃、减速、冻结标记也不能挂上去。
   以前只靠 hurtEnemy 拦直伤，状态照样生效：喷它一滴血不掉，一出水却带着火。 */
{
  const wet = () => {
    G.run.enemies.length = 0;
    pp.x = 0; pp.y = 0; pp.hp = pp.maxHp; pp.invuln = 1e9;
    const d = G.spawnEnemy('drowner', false, 26, 0);
    d.x = 26; d.y = 0; d.speed = 0;
    d.submerged = true; d.subState = 2; d.subT = 99; d.subAng = Math.PI;
    return d;
  };
  const breathe = (id, sub) => {
    const d = wet();
    if (sub) { d.submerged = false; d.subState = 0; d.subT = 0; }
    const st = HS.Gear.stat({ id, lvl: 1, up: {} }, pp);
    for (let k = 0; k < 8; k++) HS.Gear.flame(pp, 0, st, D.gear[id], true, 1);
    return d;
  };

  const f1 = breathe('flamer');
  check('喷火枪打不到水下的水鬼', Math.round(f1.hp) === Math.round(f1.maxHp), 'hp=' + Math.round(f1.hp));
  check('火焰不会点燃水下的水鬼', !f1.burn, 'burn=' + (f1.burn || 0));
  check('喷火枪出水后照常点着', (() => { const d = breathe('flamer', true); return d.burn > 0; })());

  const c1 = breathe('cryo');
  check('液氮打不到水下的水鬼', Math.round(c1.hp) === Math.round(c1.maxHp), 'hp=' + Math.round(c1.hp));
  check('液氮不会冻住水下的水鬼', !c1.slow && !c1.synFrozen,
    'slow=' + (c1.slow || 0) + ' frozen=' + (c1.synFrozen || 0));

  for (const id of ['firering', 'frostring']) {
    const d = wet();
    const def = D.gear[id];
    const st = HS.Gear.stat({ id, lvl: 1, up: {} }, pp);
    const a = { id, lvl: 1, up: {}, tick: 0 };
    d.x = st.radius * (pp.areaMul || 1);       // 正好站在环带上
    for (let k = 0; k < 6; k++) { a.tick = 0; HS.Auto.ring(G.run, pp, a, def, st, 0.4); }
    check(def.name + '碰不到水下的水鬼', Math.round(d.hp) === Math.round(d.maxHp) &&
      !d.burn && !d.slow && !d.synFrozen,
      'hp=' + Math.round(d.hp) + ' burn=' + (d.burn || 0));
  }

  /* 地面火池（燃烧瓶 / 火焰喷泉） */
  {
    const d = wet();
    d.x = 26; d.y = 0;
    G.run.pools.push({ x: 26, y: 0, r: 40, life: 9, max: 9, dps: 20, fire: 1, tick: 0.9, dead: false });
    G.updateFx(0.1);
    check('地面火池烧不到水下的水鬼', Math.round(d.hp) === Math.round(d.maxHp) && !d.burn,
      'hp=' + Math.round(d.hp) + ' burn=' + (d.burn || 0));
    G.run.pools.length = 0;
  }

  G.run.enemies.length = 0;
  G.run.enemies.push(G.spawnEnemy('walker', false, 200, 200));
}
G.run.waterHazards.length = 0;
G.run.t = 360; G.run.nextBossAt = 360; G.run.boss = null; G.run.bossSpawned = false;
G.spawnBoss();
check('锈水 Boss 是断堤巨斧', G.run.boss && G.run.boss.def.id === 'axeboss', G.run.boss && G.run.boss.def.name);
check('巨斧 Boss 高耐久', G.run.boss.maxHp > 2000, Math.round(G.run.boss.maxHp));
check('Boss 名称进入图鉴数据', !!D.enemies.axeboss && D.enemies.axeboss.boss === true);

/* 交叉斩留的是"沿刀口划过的弧裂纹"，不是斧尖砸出来的圆坑。
   圆坑读起来是砸（跃劈），交叉斩是挥 —— 两种招式在地上要能分辨。
   而且这条弧**是判定边界本身**：玩家站在弧外必须真的打不到，
   所以半径只能等于"这一刀砍得到哪"，不能等于起手距离（132）。 */
{
  G.run.enemies.length = 0;
  G.run.breaks.length = 0;
  pp.x = 0; pp.y = 0; pp.invuln = 1e9;
  const B = G.spawnEnemy('axeboss', false, 90, 0);
  B.boss = true; B.speed = 0;          // spawnEnemy 不打 boss 标记
  B.aSt = 1; B.aT = 0.01; B.aAim = Math.PI;
  for (let i = 0; i < 6; i++) { pp.invuln = 1e9; G.updateEnemies(1 / 60); }
  const arcs = G.run.breaks.filter((b) => b.arc);
  check('交叉斩在地面留下弧裂纹（不是圆坑）', arcs.length >= 1, arcs.length + ' 条');
  check('两道斧各划一道（不被去重合并）', arcs.length === 2, arcs.length + ' 条');
  check('弧裂纹有角度和弧长', arcs.length > 0 && arcs[0].span > 1 && arcs[0].ang !== undefined,
    arcs.length ? 'span=' + arcs[0].span.toFixed(2) : '无');
  check('弧长铺满判定扇形（半角 0.86 × 2）',
    arcs.length > 0 && Math.abs(arcs[0].span - 1.72) < 1e-9,
    arcs.length ? 'span=' + arcs[0].span.toFixed(2) + '（判定 ±0.86）' : '无');
  B.dead = true;
  G.run.breaks.length = 0;

  /* 边界校准：玩家摆在弧内外各 0.5px，看这一刀到底打不打得到。
     同时把裂纹半径读出来 —— 三个数字必须指向同一条线。
     注意：前面的检查可能把玩家打升级了（state = 'levelup'），
     而 damagePlayer 只在 'run' 里结算 —— 这里必须自己摆回战斗态，
     否则这一条会随机变成"打不中还 0 伤害"。 */
  const cleaveAt = (dist) => {
    G.state = 'run';
    G.run.enemies.length = 0;
    G.run.breaks.length = 0;
    pp.x = 0; pp.y = 0; pp.invuln = 0; pp.hp = pp.maxHp;
    const bb = G.spawnEnemy('axeboss', false, dist, 0);
    bb.boss = true; bb.speed = 0;
    /* spawnEnemy 会把落点收进可走区（桥上 x 只到 ~105），
       这里直接摆到指定距离：测的必须是判定边界本身，不是地形 */
    bb.x = dist; bb.y = 0;
    bb.aSt = 1; bb.aT = 0.01; bb.aAim = Math.PI;
    const hp0 = pp.hp;
    for (let i = 0; i < 6; i++) G.updateEnemies(1 / 60);
    const lost = hp0 - pp.hp;
    const arc = G.run.breaks.filter((b) => b.arc)[0];
    const d = U.dist(bb.x, bb.y, pp.x, pp.y);
    bb.dead = true;
    G.run.enemies.length = 0;
    return { lost, r: arc ? arc.r : null, d };
  };
  const justIn = cleaveAt(117.5);
  const justOut = cleaveAt(118.5);
  check('边界测试的站位没被地形挪动',
    Math.abs(justIn.d - 117.5) < 0.01 && Math.abs(justOut.d - 118.5) < 0.01,
    justIn.d.toFixed(1) + ' / ' + justOut.d.toFixed(1));
  check('交叉斩：判定边界内会掉血', justIn.lost > 0, '距 117.5 → -' + justIn.lost.toFixed(1));
  check('交叉斩：判定边界外不吃伤害', justOut.lost === 0, '距 118.5 → -' + justOut.lost.toFixed(1));
  check('弧裂纹半径 = 判定边界（不是起手距离 132）',
    justIn.r === 118 && justOut.r === 118,
    '裂纹 r=' + justIn.r + '，判定边界在 117.5~118.5 之间');

  pp.hp = pp.maxHp; pp.invuln = 1e9;
  G.run.breaks.length = 0;
}

console.log('[渲染]');
G.state = 'run';
let renderOK = true;
try { G.render(); } catch (e) { renderOK = false; console.log('    ' + e.stack); }
check('锈水高速渲染无异常', renderOK);
check('水面层存在', typeof HS.Render.drawFlood === 'function');
check('双斧绘制层存在', typeof HS.Render.drawBossAxes === 'function');

console.log('\n' + (bad === 0 ? '全部通过 ✓' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
