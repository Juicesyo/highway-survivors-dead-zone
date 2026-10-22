/**
 * 近战"攻击范围"升级是否生效的专项检测
 * 用法: node tools/check-melee-range.js
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

const D = HS.Data;
const Gear = HS.Gear;

Game.startRun('highway', 'soldier');
const p = Game.run.p;

/* 找出所有近战机制的武器 */
const meleeIds = Object.keys(D.gear).filter(id => {
  const d = D.gear[id];
  return !d.evo && (d.mech === 'melee' || d.mech === 'drill' || d.mech === 'boomerang');
});

console.log('近战武器共 ' + meleeIds.length + ' 件\n');

let bad = 0;
for (const id of meleeIds) {
  const def = D.gear[id];
  const fake = { statVer: 1, passives: {}, syn: {}, synLv: {}, weapons: [], autos: [], rangeMul: 1 };
  const rows = [];
  let prev = null;
  for (let lvl = 1; lvl <= (def.maxLvl || 5); lvl++) {
    const st = Gear.stat({ id: id, lvl: lvl }, fake);
    const r = st.range || 0;
    const tag = prev === null ? '' : (r > prev + 0.01 ? ' ✓' : ' ✗ 不变!');
    if (prev !== null && r <= prev + 0.01) bad++;
    rows.push('Lv' + lvl + '=' + r.toFixed(1) + tag);
    prev = r;
  }
  /* 每件近战武器的范围必须逐级上涨（成长集中在 Gear.stat，g.range 只是数据覆盖项） */
  const hasG = def.g && def.g.range;
  console.log((hasG ? '* ' : '  ') + id + ' (' + def.name + ')  g.range=' + (def.g && def.g.range || 0) + '  ' + rows.join(' | '));
}

/* 再验一次"专属升级分支"（扩大挥砍/横扫 +12%）。
   注意 Gear.stat 有 _st 缓存，要换 statVer 让它重算。 */
console.log('\n--- 专属升级分支（mod.range）实测 ---');
const testId = meleeIds[0];
const w = { id: testId, lvl: 1, up: {} };
const r0 = Gear.stat(w, { statVer: 1, passives: {}, syn: {}, synLv: {}, weapons: [], autos: [], rangeMul: 1 }).range;
const upsKeys = Object.keys(D.gearUps[testId] || {});
const rangeKey = upsKeys.find(k => D.gearUps[testId][k].mod && D.gearUps[testId][k].mod.range);
let r2 = r0, usedKey = '(该武器没有含 range 的升级分支)';
if (rangeKey) {
  usedKey = rangeKey;
  w.up[rangeKey] = 2;
  r2 = Gear.stat(w, { statVer: 2, passives: {}, syn: {}, synLv: {}, weapons: [], autos: [], rangeMul: 1 }).range;
}
console.log(testId + ' 基础=' + r0.toFixed(1) + '  升级分支[' + usedKey + ']x2=' + r2.toFixed(1) +
  (r2 > r0 * 1.2 ? '  ✓ 生效' : '  ✗ 未生效'));
if (r2 <= r0 * 1.2) bad++;

console.log('\n' + (bad === 0 ? '全部通过 ✓' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
