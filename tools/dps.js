/**
 * 武器 DPS 对照表
 * 用法: node tools/dps.js                 # 默认几把常用武器
 *       node tools/dps.js redlaser cryo   # 指定武器 id
 *
 * 单个木桩、站定、关掉暴击 —— 只比"这把枪自己打出去的直伤"。
 * 用来回答"某把枪伤害是不是偏低"，比拍脑袋强。
 * 注意它**不测**范围/多目标的收益：光束、喷火、霰弹打一群时实际收益高得多，
 * 这里量的是"单体下限"。
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
const G = HS.Game, D = HS.Data, Gear = HS.Gear;
G.testMode = true;

function dps(id, lvl) {
  G.startRun('highway', 'whale');
  const p = G.run.p;
  p.x = 0; p.y = 0; p.invuln = 1e9;
  p.weapons.length = 0;
  p.autos.length = 0;
  p.crit = 0; p.critMul = 1.6;          // 先排除暴击变量
  const def = D.gear[id];
  const w = { id, lvl, up: {}, slot: def.slot, timer: 0 };
  p.weapons.push(w);
  G.recalc(p);

  /* 木桩：站得够近，血量拉满，不吃任何状态 */
  G.run.enemies.length = 0;
  const e = G.spawnEnemy('walker', false, Math.min(70, D.gear[id].base.range * 0.6), 0);
  e.speed = 0; e.maxHp = 1e7; e.hp = 1e7; e.armor = 0;
  const hp0 = e.hp;

  const dt = 1 / 60;
  for (let t = 0; t < 8; t += dt) {
    G.run.t = t;
    p.x = 0; p.y = 0;
    e.x = Math.min(70, D.gear[id].base.range * 0.6); e.y = 0;
    G.updateWeapons(dt);
    G.updateBullets(dt);
    for (const b of G.run.bullets) b.life = Math.max(b.life, 0.01);
  }
  const dealt = hp0 - e.hp;
  return { dps: dealt / 8, hp: Math.round(dealt) };
}

const ids = process.argv.slice(2);
const list = ids.length ? ids : ['redlaser', 'pistol', 'smg', 'laser', 'plasma', 'flamer', 'cryo'];
console.log('武器            1级DPS   5级DPS   满级/1级');
for (const id of list) {
  const d = D.gear[id];
  if (!d) { console.log(id + ' 不存在'); continue; }
  const a = dps(id, 1);
  const b = dps(id, 5);
  console.log(d.name.padEnd(14) + a.dps.toFixed(1).padStart(7) +
    b.dps.toFixed(1).padStart(9) +
    (b.dps / Math.max(0.1, a.dps)).toFixed(2).padStart(10));
}
