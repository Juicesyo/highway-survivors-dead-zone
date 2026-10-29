/**
 * 楼顶（上楼 / 下楼）连通性检查
 * 用法: node tools/check-roof.js
 *
 * 背景：丧尸上楼靠"进楼 → 走到楼梯"，下楼靠"楼顶走到检修口"。
 * 楼顶没有地面那套网格寻路，以前是直线冲楼梯，于是出现两类硬伤：
 *   1. 风口压在楼梯上 → 没有可落脚的下楼点；
 *   2. 风口贴着女儿墙 / 彼此贴死 → 楼顶被切成两块，站在另一块的丧尸永远走不到楼梯。
 * 玩家看到的现象就是「能上楼，却下不来」。这里把这两条守住，并实跑一遍下楼。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
for (const r of [...entry.matchAll(/require\(['"](.+?)['"]\)/g)].map(m => m[1])) {
  require(path.join(ROOT, r));
}

const HS = globalThis.HS;
HS.Main.boot();
const Game = HS.Game;
const B = HS.Buildings;
Game.testMode = true;

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  (' + extra + ')' : ''));
  if (!cond) bad++;
}

const MAPS = ['highway', 'night', 'desert', 'flood'];
const KEEP = 12;          // 与 buildings.js 的 KEEP 同量级，留 2px 容差

function collect() {
  const seen = new Set(), list = [];
  for (let bx = -1536; bx < 1536; bx += B.BLOCK) {
    for (let by = -1536; by < 1536; by += B.BLOCK) {
      const arr = B.buildingsAtBlock(bx, by);
      for (let i = 0; i < arr.length; i++) {
        if (!seen.has(arr[i])) { seen.add(arr[i]); list.push(arr[i]); }
      }
    }
  }
  return list;
}

/* ================= 1. 风口不能压楼梯 / 不能贴女儿墙 ================= */
console.log('[1. 楼顶布局]');
{
  let roofs = 0, vents = 0, onStairs = [], onEdge = [];
  for (const m of MAPS) {
    Game.startRun(m, 'whale');
    for (const b of collect()) {
      if (!b.stairs) continue;
      roofs++;
      const s = b.stairs;
      for (const v of b.roofVents) {
        vents++;
        if (v.x0 < s.x1 && v.x1 > s.x0 && v.y0 < s.y1 && v.y1 > s.y0) {
          onStairs.push(m + '/' + b.kind);
        }
        if (v.x0 < b.x0 + KEEP || v.y0 < b.y0 + KEEP ||
            v.x1 > b.x1 - KEEP || v.y1 > b.y1 - KEEP) {
          onEdge.push(m + '/' + b.kind);
        }
      }
    }
  }
  check('风口不压楼梯口', onStairs.length === 0, onStairs.slice(0, 5).join(','));
  check('风口离女儿墙留出通道', onEdge.length === 0, onEdge.slice(0, 5).join(','));
  console.log('    （' + MAPS.length + ' 张图共 ' + roofs + ' 个可上楼顶 / ' + vents + ' 块屋顶构件）');
}

/* ================= 2. 楼顶每一格都能走到楼梯（流场全覆盖） ================= */
console.log('[2. 楼顶连通性]');
{
  let roofs = 0, orphan = [];
  for (const m of MAPS) {
    Game.startRun(m, 'whale');
    for (const b of collect()) {
      if (!b.stairs) continue;
      roofs++;
      /* roofStep 会在第一次调用时建好流场；这里直接翻内部结构复查 */
      const nav = B.roofNav(b);
      if (!nav) { orphan.push(m + '/' + b.kind + ' 无流场'); continue; }
      let dead = 0;
      for (let i = 0; i < nav.next.length; i++) {
        if (!nav.blocked[i] && nav.next[i] < 0) dead++;
      }
      if (dead) orphan.push(m + '/' + b.kind + ' 孤立格 ' + dead);
    }
  }
  check('楼顶没有走不到楼梯的区域', orphan.length === 0, orphan.slice(0, 5).join(','));
  console.log('    （检查 ' + roofs + ' 个楼顶）');
}

/* ================= 3. 实跑：楼顶丧尸必须能自己下来 ================= */
console.log('[3. 实跑下楼]');
{
  let cases = 0, stuck = [], worst = 0;
  for (const m of MAPS.slice(0, 2)) {
    Game.startRun(m, 'whale');
    const run = Game.run, p = run.p;
    const targets = collect().filter(b => b.stairs).slice(0, 10);
    for (const b of targets) {
      for (let k = 0; k < 4; k++) {
        run.enemies.length = 0;
        p.roof = null;
        p.x = b.x0 - 70; p.y = b.y0 + b.h / 2;
        p.invuln = 1e9;
        const e = Game.spawnEnemy('walker', false,
          b.x0 + 10 + (k % 2) * (b.w - 30), b.y0 + 10 + ((k / 2) | 0) * (b.h - 30));
        e.roof = b; e.hp = e.maxHp = 1e9; e.speed = 40;
        cases++;
        let ok = false, frames = 0;
        for (let f = 0; f < 420; f++) {
          HS.Main.tick(1 / 60);
          frames++;
          if (!e.roof) { ok = true; break; }
        }
        if (ok) { if (frames / 60 > worst) worst = frames / 60; }
        else stuck.push(m + '/' + b.kind + ' 起点(' + (k % 2) + ',' + ((k / 2) | 0) + ')');
        e.dead = true;
      }
    }
  }
  check('楼顶丧尸全都能下楼', stuck.length === 0, stuck.slice(0, 5).join(','));
  console.log('    （' + cases + ' 次，最长耗时 ' + worst.toFixed(1) + 's）');
}

console.log('\n' + (bad === 0 ? '全部通过 ✓' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
