/**
 * 取舍卡 + 机制保底 专项检测
 * 用法: node tools/check-trade.js
 *
 * 两件事必须钉死：
 *   1. 取舍卡的每个 mod 都真的落到了 recalc 上（卡面写什么，数值就得是什么）；
 *   2. 三选一里至少有一张"会改变打法"的卡 —— 否则抽卡会退化成挑百分比。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const reqs = [...entry.matchAll(/require\(['"](.+?)['"]\)/g)].map((m) => m[1]);
for (const r of reqs) require(path.join(ROOT, r));

const HS = globalThis.HS;
HS.Main.boot();
const Game = HS.Game;
const D = HS.Data;
Game.testMode = true;

let bad = 0;
function check(name, ok, extra) {
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  (' + extra + ')' : ''));
}

Game.startRun('highway', 'whale');
const p = Game.run.p;

const SNAP = ['dmgMul', 'atkMul', 'spdMul', 'rangeMul', 'durMul', 'projCount', 'armor', 'maxHp'];
function snap() {
  const o = {};
  for (const k of SNAP) o[k] = p[k];
  return o;
}
function diff(a, b) {
  const o = {};
  for (const k of SNAP) o[k] = b[k] - a[k];
  return o;
}
function pct(a, b) { return a ? (b - a) / a : 0; }

/* ---------- 1. 每张取舍卡的数值都生效 ---------- */
console.log('[取舍卡数值]');
const baseline = (() => {
  p.trade = {};
  Game.recalc(p);
  return snap();
})();

const EXPECT = {
  lightweight: (d) => Math.abs(pct(baseline.spdMul, baseline.spdMul + d.spdMul) - 0.12) < 0.01 &&
    Math.abs(pct(baseline.dmgMul, baseline.dmgMul + d.dmgMul) + 0.06) < 0.01,
  overload: (d) => Math.abs(pct(baseline.dmgMul, baseline.dmgMul + d.dmgMul) - 0.22) < 0.01 &&
    Math.abs(pct(baseline.atkMul, baseline.atkMul + d.atkMul) + 0.08) < 0.01,
  scrapammo: (d) => Math.abs(d.projCount - 1) < 0.001 &&
    Math.abs(pct(baseline.rangeMul, baseline.rangeMul + d.rangeMul) + 0.15) < 0.01,
  heavyrig: (d) => Math.abs(d.armor - 3) < 0.001 &&
    Math.abs(pct(baseline.maxHp, baseline.maxHp + d.maxHp) - 0.12) < 0.01 &&
    Math.abs(pct(baseline.spdMul, baseline.spdMul + d.spdMul) + 0.08) < 0.01,
  scorched: (d) => Math.abs(pct(baseline.durMul, baseline.durMul + d.durMul) - 0.40) < 0.01 &&
    Math.abs(pct(baseline.dmgMul, baseline.dmgMul + d.dmgMul) + 0.08) < 0.01,
  lonewolf: (d) => Math.abs(pct(baseline.dmgMul, baseline.dmgMul + d.dmgMul) - 0.18) < 0.01 &&
    Math.abs(pct(baseline.rangeMul, baseline.rangeMul + d.rangeMul) + 0.12) < 0.01,
  fieldmed: (d) => Math.abs(pct(baseline.maxHp, baseline.maxHp + d.maxHp) - 0.20) < 0.01 &&
    Math.abs(pct(baseline.dmgMul, baseline.dmgMul + d.dmgMul) + 0.08) < 0.01,
  scavvest: (d) => Math.abs(d.armor - 2) < 0.001 &&
    Math.abs(pct(baseline.dmgMul, baseline.dmgMul + d.dmgMul) + 0.06) < 0.01,
  shortbarrel: (d) => Math.abs(pct(baseline.rangeMul, baseline.rangeMul + d.rangeMul) - 0.20) < 0.01 &&
    Math.abs(pct(baseline.dmgMul, baseline.dmgMul + d.dmgMul) + 0.10) < 0.01,
  beltfeed: (d) => Math.abs(pct(baseline.atkMul, baseline.atkMul + d.atkMul) - 0.14) < 0.01 &&
    Math.abs(pct(baseline.dmgMul, baseline.dmgMul + d.dmgMul) + 0.08) < 0.01
};

for (const t of D.tradeoffs) {
  p.trade = {};
  Game.recalc(p);
  const before = snap();
  p.trade[t.id] = 1;
  Game.recalc(p);
  const after = snap();
  const d = diff(before, after);
  const fn = EXPECT[t.id];
  const ok = fn ? fn(d) : true;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + t.id.padEnd(12) + t.desc);
  if (!ok) bad++;
}
p.trade = {};
Game.recalc(p);

/* ---------- 2. 拿过的取舍卡不再出现 ---------- */
console.log('\n[抽取规则]');
p.trade = { lightweight: 1, overload: 1 };
let hitTaken = 0;
let tradeSeen = 0;
let mechMiss = 0;
let samples = 400;
let noSafe = 0;
for (let k = 0; k < samples; k++) {
  /* 这一段只验"保底逻辑"：手里只有手枪、又不拿卡时，可用的机制卡只有取舍卡，
     而取舍卡有"一局最多兜底 6 次"的上限（见 game.js 的 run.tradeForce）。
     不重置它，第 7 轮之后必然没有机制卡 —— 那是上限在起作用，不是保底坏了。 */
  Game.run.tradeForce = 0;
  const cards = Game.buildChoices(3);
  if (cards.length < 3) { bad++; }
  let mech = false;
  for (const c of cards) {
    if (c.kind === 'trade') {
      tradeSeen++;
      if (c.id === 'lightweight' || c.id === 'overload') hitTaken++;
    }
    if (Game.isMechCard(c)) mech = true;
  }
  if (!mech) mechMiss++;
  if (!cards.some((c) => c.kind !== 'weaponNew' && c.kind !== 'autoNew')) noSafe++;
}
check('已拿过的取舍卡不再出现', hitTaken === 0, hitTaken + ' 次');
check('取舍卡仍会出现在池子里', tradeSeen > 0, samples + ' 轮里 ' + tradeSeen + ' 张');
check('每轮三选一都有机制卡', mechMiss === 0, mechMiss + ' 轮缺失');
check('每轮三选一都有非换装卡', noSafe === 0, noSafe + ' 轮缺失');

/* ---------- 3. 机制卡判定覆盖 ---------- */
console.log('\n[机制卡判定]');
check('联动算机制卡', Game.isMechCard({ kind: 'synergy' }) === true);
check('进化算机制卡', Game.isMechCard({ kind: 'evolve' }) === true);
check('取舍卡算机制卡', Game.isMechCard({ kind: 'trade' }) === true);
check('纯属性不算机制卡', Game.isMechCard({ kind: 'passive' }) === false);
check('纯等级不算机制卡', Game.isMechCard({ kind: 'gearLevel' }) === false);
{
  /* 带 special 的专属分支才算机制卡 */
  let spec = null, plain = null;
  for (const gid in D.gearUps) {
    for (const bid in D.gearUps[gid]) {
      const br = D.gearUps[gid][bid];
      if (br.special && !spec) spec = { kind: 'gearUp', id: gid, up: bid };
      if (!br.special && !plain) plain = { kind: 'gearUp', id: gid, up: bid };
    }
    if (spec && plain) break;
  }
  check('带 special 的分支算机制卡', Game.isMechCard(spec) === true, spec && (spec.id + '/' + spec.up));
  check('纯数值分支不算机制卡', Game.isMechCard(plain) === false, plain && (plain.id + '/' + plain.up));
}

/* ---------- 4. 取舍卡不占通用属性槽 ---------- */
console.log('\n[不挤占属性槽]');
p.trade = {};
for (const t of D.tradeoffs) p.trade[t.id] = 1;
const ownedBefore = Object.keys(p.passives).filter((k) => p.passives[k]).length;
check('拿满取舍卡不影响已占属性槽', ownedBefore === 0, '属性槽 ' + ownedBefore);
check('取舍卡不进 p.passives', Object.keys(p.passives).length === 0);

/* ---------- 5. 跑一局 20 次升级：机制卡到底够不够 ---------- */
console.log('\n[一局内的覆盖率]');
/* 单局是随机的：取舍卡偶尔只出 1 张（机制卡那一档被联动 / 进化占满时），
   所以跑 3 局看**平均**，单局再给一个宽松上限兜住"每次都硬塞" */
const RUNS = 3, ROUNDS = 20;
let tradeSum = 0, noMechSum = 0, tradeMax = 0;
const kinds = {};
for (let run = 0; run < RUNS; run++) {
  Game.startRun('highway', 'whale');
  const p2 = Game.run.p;
  let noMechRounds = 0, tradeRounds = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const cards = Game.buildChoices(3);
    let mech = false;
    for (const c of cards) {
      if (Game.isMechCard(c)) mech = true;
      if (c.kind === 'trade') tradeRounds++;
      kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    }
    if (!mech) noMechRounds++;
    /* 模拟玩家：随机拿一张（真实玩家不会每轮都吃取舍卡 —— 它有代价） */
    const pick = cards[Math.floor(Math.random() * cards.length)];
    if (pick) Game.applyChoice(pick);
  }
  tradeSum += tradeRounds;
  noMechSum += noMechRounds;
  tradeMax = Math.max(tradeMax, tradeRounds);
}
const tradeAvg = tradeSum / RUNS;
check('20 次升级里机制卡覆盖率 ≥ 70%', noMechSum <= 6 * RUNS,
  (ROUNDS * RUNS - noMechSum) + '/' + (ROUNDS * RUNS));
check('取舍卡平均每局 2~10 次', tradeAvg >= 2 && tradeAvg <= 10,
  tradeAvg.toFixed(1) + ' 张 / 局（最多一局 ' + tradeMax + ' 张）');
check('单局不会把取舍卡硬塞到 12 张以上', tradeMax <= 12, tradeMax + ' 张');
console.log('  卡型分布: ' + JSON.stringify(kinds));

console.log('\n----------------------------------------');
console.log(bad === 0 ? '全部通过 ✓' : bad + ' 项未通过 ✗');
process.exit(bad ? 1 : 0);
