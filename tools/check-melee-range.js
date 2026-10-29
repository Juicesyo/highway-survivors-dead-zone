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

Game.startRun('highway', 'whale');
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

/* --- 打击感：近战命中不许震屏 ---
   挥砍每秒 4~7 下，链锯/钻头每帧判定，一震就一直在震，画面发飘还晕。
   现在是"打在被砍的那只身上"：目标自己抖（e.jolt）+ 命中点爆火花 + 大号数字。
   这条检查是防回归的 —— 以后谁再往近战路径塞 run.shake 会立刻挂。 */
console.log('\n--- 近战命中不许震屏 ---');
{
  const pp = Game.run.p;
  const mid = meleeIds[0];
  const mdef = D.gear[mid];
  Gear.clearHands(pp);
  pp.autos.length = 0;
  pp.passives = {};
  Gear.take(pp, mid);
  Game.recalc(pp);
  const ent = pp.weapons.filter(w => w.id === mid)[0] || pp.weapons[0];
  const st = Gear.stat(ent, pp);
  Game.run.enemies.length = 0;
  Game.run.pools.length = 0;
  Game.run.shake = 0;
  Game.run.fx.length = 0;
  Game.state = 'run';
  const z = Game.spawnEnemy('walker', false, pp.x + Math.min(20, st.range * 0.5), pp.y);
  z.hp = 1e9; z.maxHp = 1e9; z.speed = 0;
  Gear.swing(pp, 0, st, mdef);
  const noShake = Game.run.shake === 0;
  const jolted = (z.jolt || 0) > 0;
  const hurt = z.hp < 1e9;
  /* 命中点必须爆出火花：震屏撤掉后，打击点的"闪光"是唯一的时间锚 */
  const spark = Game.run.fx.filter(f => f.color === '#ffffff').length;
  console.log('  命中=' + hurt + '  震屏=' + Game.run.shake.toFixed(1) +
    '  目标抖动=' + (jolted ? '是' : '无') + '  火花=' + spark + ' 颗');
  if (!noShake || !jolted || !hurt || spark === 0) bad++;

  /* ---- 嗜血：群体吸血 ----
     一个目标只回一点点，扫到一排就该吸得更多（但有衰减，不是线性翻倍）。 */
  /* 嗜血只挂在"带刃"的冷兵器上（def.edge），挑一把有刃的来测 */
  const wid = meleeIds.filter(id => D.gear[id].edge)[0] || meleeIds[0];
  Gear.clearHands(pp);
  pp.autos.length = 0;
  pp.passives = {};
  Gear.take(pp, wid);
  Game.recalc(pp);
  const lent = pp.weapons.filter(w => w.id === wid)[0] || pp.weapons[0];
  lent.up = { leech: 2 };
  Game.recalc(pp);
  const lst = Gear.stat(lent, pp);
  const swingHeal = (n) => {
    Game.run.enemies.length = 0;
    Game.run.fx.length = 0;
    Game.state = 'run';
    pp.hp = 40; pp.maxHp = 100;
    for (let i = 0; i < n; i++) {
      const z2 = Game.spawnEnemy('walker', false, pp.x + 10 + i * 2, pp.y - 6 + i * 3);
      z2.hp = 1e9; z2.maxHp = 1e9; z2.speed = 0;
      /* 出生点周围可能有东西把怪推开，测试里直接钉死在刀口前 */
      z2.x = pp.x + 7 + i * 3; z2.y = pp.y - 3 + i * 2;
    }
    Gear.swing(pp, 0, lst, D.gear[wid]);
    return pp.hp - 40;
  };
  const h1 = swingHeal(1), h5 = swingHeal(5);
  console.log('  嗜血 Lv2：1 个目标回 ' + h1.toFixed(2) + '，5 个目标回 ' + h5.toFixed(2));
  check('嗜血会回血', h1 > 0.2, h1.toFixed(2));
  check('群体吸血：扫到的人越多吸得越多', h5 > h1 * 1.8, (h5 / Math.max(0.01, h1)).toFixed(2) + ' 倍');
  check('群体吸血有衰减（不是线性 5 倍）', h5 < h1 * 4.2, (h5 / Math.max(0.01, h1)).toFixed(2) + ' 倍');
  check('每个被吸的目标都会甩出血线', Game.run.fx.filter(f => f.color === '#e0453c' || f.color === '#a3221e').length >= 5,
    Game.run.fx.filter(f => f.color === '#e0453c' || f.color === '#a3221e').length + ' 滴');
  /* 收拾干净：后面几段都假设手上是它们自己装的那把 */
  Game.run.enemies.length = 0;
  Gear.clearHands(pp);
  pp.autos.length = 0;
  pp.passives = {};
  Game.recalc(pp);
}

function countBlade(n) {
  let c = 0;
  for (let k = 0; k < n; k++) {
    for (const card of Game.buildChoices(3)) if (card.id === 'bladeguard') c++;
  }
  return c;
}

function check(name, ok, extra) {
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  (' + extra + ')' : ''));
}

/* --- 范围扩大：近战吃满，且按武器风格换成不同形状 ---
   以前的写法是"整条 rangeMul 打对折"，于是「攻击范围」对近战永远是半价卡；
   而且形状只有半径在长，挥砍宽度一点没变。 */
console.log('\n--- 范围扩大：吃满 + 形状 ---');
{
  const baseP = () => ({ statVer: 1, passives: {}, syn: {}, synLv: {}, weapons: [], autos: [],
    rangeMul: 1, rangeBoost: 1, mapRangeMul: 1 });
  let badRange = 0, badArc = 0, badShape = 0, fanN = 0, lineN = 0;
  for (const id of meleeIds) {
    const def = D.gear[id];
    const s1 = Gear.stat({ id: id, lvl: 1, up: {} }, baseP());
    const p2 = baseP();
    p2.rangeBoost = 1.32; p2.rangeMul = 1.32; p2.statVer = 2;
    const s2 = Gear.stat({ id: id, lvl: 1, up: {} }, p2);
    const rr = s2.range / s1.range;
    if (Math.abs(rr - 1.32) > 0.02) {
      badRange++;
      console.log('  ✗ ' + id + ' 范围只吃到 ×' + rr.toFixed(2) + '（应为 1.32）');
    }
    const fan = !!(s1.arc && s1.arc < 2.8 &&
      def.mech !== 'thrust' && def.mech !== 'drill' && def.mech !== 'boomerang');
    const ar = s1.arc ? s2.arc / s1.arc : 1;
    if (fan) {
      fanN++;
      if (ar <= 1.001) { badArc++; console.log('  ✗ ' + id + ' 扇形但弧角没涨'); }
    } else {
      lineN++;
      if (Math.abs(ar - 1) > 0.001) { badShape++; console.log('  ✗ ' + id + ' 直线/全周型弧角不该变（×' + ar.toFixed(2) + '）'); }
    }
  }
  check('每件近战都吃满范围加成', badRange === 0, badRange + ' 件只吃到一半');
  check('扇形挥砍类同时扩大弧角', badArc === 0, fanN + ' 件扇形');
  check('突刺 / 钻锯 / 全周型不改弧角', badShape === 0, lineN + ' 件');

  /* 夜图射程惩罚仍然只吃一半：近战在夜里不该双倍难受 */
  const pw = baseP();
  pw.mapRangeMul = 0.68; pw.rangeMul = 0.68; pw.rangeBoost = 1; pw.statVer = 3;
  const sw = Gear.stat({ id: meleeIds[0], lvl: 1, up: {} }, pw);
  const s0 = Gear.stat({ id: meleeIds[0], lvl: 1, up: {} }, baseP());
  const nightRatio = sw.range / s0.range;
  check('夜图射程惩罚对近战减半', Math.abs(nightRatio - 0.84) < 0.02, '×' + nightRatio.toFixed(3));

  /* 居合（arc≈0.12）：几乎不涨弧角，身份就是一条线 */
  const kj = D.gear['katana_x'];
  if (kj) {
    const k1 = Gear.stat({ id: 'katana_x', lvl: 1, up: {} }, baseP());
    const kp = baseP(); kp.rangeBoost = 1.32; kp.rangeMul = 1.32; kp.statVer = 4;
    const k2 = Gear.stat({ id: 'katana_x', lvl: 1, up: {} }, kp);
    check('居合的弧角几乎不长', k2.arc / k1.arc < 1.06, '×' + (k2.arc / k1.arc).toFixed(3));
  }
}

/* --- 刃返：清弹是稀有卡，不是近战白送的能力 --- */
console.log('\n--- 刃返（稀有卡）---');
{
  const gp = Game.run.p;
  const mid2 = meleeIds[0];
  Gear.clearHands(gp);
  gp.autos.length = 0;
  gp.passives = {};
  gp.trade = {};
  Gear.take(gp, mid2);
  Game.recalc(gp);
  const ent2 = gp.weapons.filter(w => w.id === mid2)[0] || gp.weapons[0];
  const st2 = Gear.stat(ent2, gp);
  const mkBullet = () => {
    Game.run.ebullets.length = 0;
    Game.run.ebullets.push({ x: gp.x + 12, y: gp.y, vx: 0, vy: 0, dead: false,
      dmg: 5, r: 2, life: 1, max: 1, color: '#fff', kind: 'bullet' });
    return Game.run.ebullets[0];
  };
  const runSwing = () => {
    Game.run.enemies.length = 0;
    Game.run.fx.length = 0;
    Gear.swing(gp, 0, st2, D.gear[mid2]);
  };

  gp.bladeGuard = 0;
  let b1 = mkBullet();
  runSwing();
  check('没有刃返时挥砍不会清弹', !b1.dead, b1.dead ? '被扫掉了' : '子弹还在');

  gp.bladeGuard = 1;
  let b2 = mkBullet();
  runSwing();
  check('拿了刃返 Lv1 会击落身边子弹', b2.dead === true, b2.dead ? '已击落' : '没反应');

  gp.bladeGuard = 2;
  let far = mkBullet();
  far.x = gp.x + st2.range + 20;   // Lv1 范围外、Lv2 范围内
  runSwing();
  check('刃返 Lv2 范围更大', far.dead === true,
    'Lv1 半径 ' + (st2.range + 10).toFixed(0) + ' / Lv2 半径 ' + (st2.range + 26).toFixed(0));
}

/* --- 刃返的出卡门槛：只有手握近战时才会出现在三选一里 --- */
console.log('\n--- 刃返出卡门槛 ---');
{
  const gp2 = Game.run.p;
  gp2.passives = {};
  Gear.clearHands(gp2);
  gp2.autos.length = 0;
  Gear.take(gp2, meleeIds[0]);
  Game.recalc(gp2);
  const withMelee = countBlade(300);
  check('手握近战会出刃返', withMelee > 0, 300 + ' 轮里 ' + withMelee + ' 张');

  Gear.clearHands(gp2);
  Gear.take(gp2, 'pistol');
  Game.recalc(gp2);
  const noMelee = countBlade(300);
  check('没有近战就不出刃返', noMelee === 0, noMelee + ' 张');

  /* 拿满 2 级后不再出现 */
  gp2.passives = { bladeguard: 2 };
  Gear.clearHands(gp2);
  Gear.take(gp2, meleeIds[0]);
  Game.recalc(gp2);
  const maxed = countBlade(300);
  check('刃返满级后不再出现', maxed === 0, maxed + ' 张');
  gp2.passives = {};
}

console.log('\n' + (bad === 0 ? '全部通过 ✓' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
