/**
 * 呕酸尸毒液伤害端到端检测
 * 用法: node tools/check-vomiter.js
 * 验证：1) 站在毒液带内会掉血  2) 毒液远端(>80px)也命中  3) 玩家在毒液后方/侧面不掉血
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

Game.startRun('night', 'whale');
const p = Game.run.p;

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  (' + extra + ')' : ''));
  if (!cond) bad++;
}

/* 直接构造一块毒液带：喷口在玩家西侧 10px，朝东喷 124px */
function sprayAt(ang, mouthDist) {
  Game.run.pools.push({
    spray: 1,
    x: p.x - mouthDist, y: p.y,
    ang: ang, len: 124, wid: 36,
    life: 1.5, max: 1.5, dps: 9, tick: 0, dead: false
  });
}

function tickDamage(sec) {
  const hp0 = p.hp;
  p.invuln = 0;            // damagePlayer 有无敌帧，测试要清掉，否则上一轮的伤害把后面全挡住
  const frames = Math.round(sec * 60);
  for (let f = 0; f < frames; f++) {
    p.x = p.x; p.y = p.y;   // 玩家不动
    Game.updateFx(1 / 60);
  }
  return hp0 - p.hp;
}

/* 1) 玩家站在毒液中段（喷口前方 60px）：0.5 秒应至少掉 2 次跳伤 */
p.x = 0; p.y = 0;
sprayAt(0, 10);            // 喷口在 -10，玩家在 +50 → 位于带内
const d1 = tickDamage(0.5);
check('毒液带内持续掉血', d1 > 0, '0.5s 掉 ' + d1.toFixed(1));

/* 2) 玩家站在毒液远端（喷口前方 110px，旧的中心对称判定打不到这里） */
Game.run.pools.length = 0;
p.hp = p.maxHp;
p.x = 0; p.y = 0;
sprayAt(0, 110);           // 喷口在 -110，玩家在 0 → 前方 110px 处，带长 124 覆盖
const d2 = tickDamage(0.5);
check('毒液远端也命中', d2 > 0, '0.5s 掉 ' + d2.toFixed(1));

/* 3) 玩家站在毒液侧后方：不应掉血 */
Game.run.pools.length = 0;
p.hp = p.maxHp;
p.x = 0; p.y = 0;
sprayAt(0, 10);
p.x = -40; p.y = 0;        // 喷口(-10)后方 30px，带外
const d3 = tickDamage(0.5);
check('毒液后方不会误伤', d3 === 0, '掉了 ' + d3.toFixed(1));

/* 4) 真实呕酸尸走一遍完整攻击流程 */
Game.run.pools.length = 0;
p.hp = p.maxHp;
p.x = 0; p.y = 0;
const v = Game.spawnEnemy('vomiter', false, 60, 0);   // 玩家东侧 60px（range=66 内）
v.x = 60; v.y = 0; v.vomitCd = 0;
let sprayed = false, hurt = false;
const hp4 = p.hp;
for (let f = 0; f < 60 * 4; f++) {
  v.x = 60; v.y = 0;       // 定住，别让它走开
  p.x = 0; p.y = 0;
  Game.update(1 / 60);
  if (Game.run.pools.some(pl => pl.spray)) sprayed = true;
  if (p.hp < hp4) hurt = true;
  if (sprayed && hurt) break;
}
check('真实呕酸尸会进入喷吐', sprayed, 'vomitState=' + v.vomitState + ' pools=' + Game.run.pools.length);
check('毒液真实造成伤害', hurt, '玩家掉了 ' + (hp4 - p.hp).toFixed(1) + ' 血');

console.log('\n' + (bad === 0 ? '全部通过 ✓' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
