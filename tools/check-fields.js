/**
 * 字段消费审计
 * 用法: node tools/check-fields.js
 *
 * 解决的问题：数据表里写了一个 special / mod 分支，但代码里没人读它 ——
 * 玩家照样能点出这张卡，点完什么都不发生。
 *
 * smoke 里也有一条同类检查，但它是**手写白名单**（SPECIAL 表），
 * 新加一个名字只要往表里补一行就"通过"了：`special: 'volley'` 就是那样混过去的。
 * 这里改成**直接扫源码**，字段名必须在 gear / combat / auto / game 里真的被读到。
 *
 * 判定口径（任一命中即算有消费方）：
 *   st.<字段>        数值字段
 *   st.sp.<字段>     命中特效标记
 *   p.<字段>         全局属性
 *   p.<字段>Lv       升级特效的等级（如 chainLvl / steamLv）
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
global.GameGlobal = global;
const reqs = [...fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8')
  .matchAll(/require\((['"])(.+?)\1\)/g)].map(m => m[2]);
for (const r of reqs) require(path.join(ROOT, r));
const HS = global.HS;
HS.Main.boot();
const D = HS.Data;

const SRC = ['gear', 'combat', 'auto', 'game']
  .map((f) => fs.readFileSync(path.join(ROOT, 'src/game', f + '.js'), 'utf8')).join('\n');

/* 只留"读"：`st.sp.shard = 1` 这类赋值是 Gear.stat 在登记开关，
   不是消费方。以前不区分读写，flags 里那句 `st.shard = ...` 就把
   special:'shard' 的检查糊弄过去了（真消费方一个都没有）。 */
const SRC_READ = SRC.replace(/\.sp\.\w+\s*=(?!=)/g, '.sp.__write');

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  (' + extra + ')' : ''));
  if (!cond) bad++;
}

/* ---------- 1. 专属分支的 special ---------- */
const specials = new Set();
for (const id of Object.keys(D.gearUps)) {
  for (const k in D.gearUps[id]) {
    const b = D.gearUps[id][k];
    if (b.special) specials.add(b.special);
  }
}
const deadSp = [];
for (const s of specials) {
  /* special 在 Gear.stat 里只写成 `st.sp[br.special] = 1`（动态 key），
     所以消费方必须**真的读 `.sp.<名字>`**。
     以前还允许 `st.<名字>` 算数：shard 被进化 flag 的 `st.shard` 蒙过去，
     「碎片战斗部 / 碎片弹 / 破片弹」三张卡点了毫无效果。 */
  const pat = new RegExp('\\.sp\\.' + s + '\\b');
  if (!pat.test(SRC_READ)) deadSp.push(s);
}
check('每个 special 都有消费方', deadSp.length === 0,
  deadSp.length ? deadSp.join(', ') : specials.size + ' 个');

/* ---------- 2. 专属分支的 mod 字段 ---------- */
const mods = new Set();
for (const id of Object.keys(D.gearUps)) {
  for (const k in D.gearUps[id]) {
    for (const m in (D.gearUps[id][k].mod || {})) mods.add(m);
  }
}
const deadMod = [];
for (const m of mods) {
  if (!new RegExp('\\bst\\.' + m + '\\b').test(SRC)) deadMod.push(m);
}
check('每个 mod 字段都有读取点', deadMod.length === 0,
  deadMod.length ? deadMod.join(', ') : mods.size + ' 个');

/* ---------- 3. 武器 sp / flags 里声明的命中特效 ---------- */
const spKeys = new Set();
for (const id of Object.keys(D.gear)) {
  const g = D.gear[id];
  if (g.sp) for (const k in g.sp) if (g.sp[k]) spKeys.add(k);
  if (g.flags) for (const k in g.flags) if (g.flags[k]) spKeys.add(k);
}
const deadKey = [];
for (const s of spKeys) {
  const pat = new RegExp('(\\.sp\\.' + s + '\\b)|(\\bst\\.' + s + '\\b)|(\\bp\\.' + s + '\\b)|(\\b' + s + '\\b)');
  if (!pat.test(SRC)) deadKey.push(s);
}
check('武器 sp / flags 的开关都有消费方', deadKey.length === 0,
  deadKey.length ? deadKey.join(', ') : spKeys.size + ' 个');

/* ---------- 4. 全局升级特效（p.xxxLv）必须真的被读 ---------- */
const GLOBAL_FX = ['chainLvl', 'steamLv', 'bladeGuard', 'execCut', 'lifesteal', 'dodge', 'burnMul'];
const deadFx = GLOBAL_FX.filter((k) => !new RegExp('\\bp\\.' + k + '\\b').test(SRC));
check('全局特效都在运行时被读', deadFx.length === 0,
  deadFx.length ? deadFx.join(', ') : GLOBAL_FX.length + ' 个');

/* ---------- 5. 持续光束不能漏掉连锁闪电 ---------- */
{
  const beams = Object.keys(D.gear).filter((id) => D.gear[id].sustainBeam);
  check('持续光束武器已登记', beams.length > 0, beams.join(', '));
  check('持续光束不会绕开连锁闪电',
    !/if \(!def\.sustainBeam && HS\.Game\.chargeChain\)/.test(SRC),
    '不能再用 sustainBeam 整个排除');
}

console.log('\n' + (bad ? '有 ' + bad + ' 项没通过' : '全部通过 ✓'));
process.exit(bad ? 1 : 0);
