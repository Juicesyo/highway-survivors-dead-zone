/**
 * 开火音同步自检：**每一把手持武器（含进化形态）**，开火音必须和这一帧真的发生的攻击同时出现。
 * 用法：node tools/check-fire-sfx.js
 *
 * 为什么要单独一个脚本：音效散在 Gear.fire 的十几个 mech 分支里，只要有一处
 * "判断写在声音之前、声音写在判断之外"，就会出现"没攻击也有声音"。
 * 红莲切割者就是这样：没目标时它照样每 0.08s 走一次 Gear.fire（伤害 0、光束不画），
 * 耳朵里却一直有激光在烧 —— 肉眼看不出，只能靠这一份"音效 vs 动作"的对照表抓。
 *
 * 判定口径：
 *   动作 = 这一帧真的发生了攻击：出弹 / 挥砍 / 突刺 / 喷火 / 光束已点亮 / 爆炸 / 电弧 / 投掷
 *   音效 = Audio.weapon / flame / frost / qi / steam（开火层，不含命中、拾取、UI）
 *   ① 任何一帧出现音效，这一帧必须有动作（无敌人时也不许"对空气开火"出声）
 *   ② 真有敌人时，每把会开火的武器都要出声（防止修过头把声音全关掉）
 *   ③ 音效必须落在**动作同一帧**（不提前、不延后）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const reqs = [...entry.matchAll(/require\(['"](.+?)['"]\)/g)].map((m) => m[1]);
for (const r of reqs) require(path.join(ROOT, r));

const HS = globalThis.HS;
HS.Main.boot();
const Game = HS.Game;
const Gear = HS.Gear;
const D = HS.Data;
Game.testMode = true;

let bad = 0;
function check(name, ok, extra) {
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  (' + extra + ')' : ''));
}

/* ---------------- 帧 + 动作 / 音效采集 ---------------- */
let frame = 0;
let acts = new Set();          // 这一帧发生的动作
let actedFrames = new Set();   // 出现过动作的所有帧（音效在动作之前调用也能对上）
const sounds = [];

function mark() { acts.add(frame); }

/* 动作：包在所有"真的打出去了"的底层出口上，而不是包 Gear.fire ——
   红莲那种"空走 Gear.fire"正是要被抓出来的情况，包 fire 会把它藏起来。 */
const WRAP = [
  [Game, 'shoot'], [Game, 'hurtEnemy'], [Game, 'explode'], [Game, 'chain'],
  [Game, 'lob'], [Game, 'handThrow'], [Game, 'dropMine'], [Game, 'spawnLure'],
  [Gear, 'swing'], [Gear, 'thrust'], [Gear, 'flame']
];
for (const [obj, key] of WRAP) {
  const orig = obj[key];
  if (typeof orig !== 'function') throw new Error('没有这个动作出口: ' + key);
  obj[key] = function () { mark(); return orig.apply(this, arguments); };
}
/* 光束单独处理：红莲的光束是"一直亮着"的（p.beamHold），不往 run.chains 里塞线。
   只有这一帧真的续亮了光束才算动作 —— 空放（没目标）不算。 */
const origBeam = Gear.beam;
Gear.beam = function (p, ang, st, def) {
  if (!def || !def.sustainBeam) mark();
  else if (p.beamHold && p.beamHold.life >= p.beamHold.max - 1e-9) mark();
  return origBeam.apply(this, arguments);
};

const SOUND_FNS = ['weapon', 'flame', 'frost', 'qi', 'steam'];
for (const fn of SOUND_FNS) {
  const orig = HS.Audio[fn];
  HS.Audio[fn] = function () {
    sounds.push({ f: frame, fn: fn, arg: arguments[0] });
    return orig.apply(this, arguments);
  };
}

/* 持续光束的常驻嗡鸣不是"一发一个"的声音，单独记：
   续期次数（每帧一次 = 真的在持续）、起了几次（= 点了几次火）。 */
let beamCalls = 0, beamActive = false, beamStarts = 0;
HS.Audio.beam = function () {
  beamCalls++;
  if (!beamActive) { beamActive = true; beamStarts++; }
};
HS.Audio.beamOff = function () { beamActive = false; };

/* 开火次数（一次 trigger 算一次，多弹丸齐射也只算一次） */
let fires = 0;
const origFire = Gear.fire;
Gear.fire = function () { fires++; return origFire.apply(this, arguments); };

const origTick = HS.Main.tick;
HS.Main.tick = function (dt) {
  frame++;
  acts.clear();
  const r = origTick.call(HS.Main, dt);
  if (acts.size) actedFrames.add(frame);
  return r;
};

/* ---------------- 场景 ---------------- */
Game.startRun('highway', 'whale');
const p = Game.run.p;
/* 关掉刷怪导演与随机事件：这里要的是"场上到底有没有目标"完全可控，
   尸潮 / 猎犬群 / 常规刷怪往射程里塞一只，无敌人用例就会被判成"空放"（或者反过来放过真 bug） */
Game.runEvent = function () {};
Game.updateDirector = function () {};
Game.run.eventT = 99999;

const ALL = Object.keys(D.gear).filter((id) => {
  const d = D.gear[id];
  return d && (d.slot === 'main' || d.slot === 'sub' || d.slot === 'heavy');
}).sort();

function prep(id) {
  Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = {};
  p.trade = {};
  Gear.take(p, id);
  Game.recalc(p);
  for (const w of p.weapons) w.timer = 0;
  Game.run.enemies.length = 0;
  Game.run.ebullets.length = 0;
  Game.run.bullets.length = 0;
  p.beamHold = null;
  sounds.length = 0;
  fires = 0;
  beamCalls = 0;
  beamStarts = 0;
  beamActive = false;
  actedFrames = new Set();
}

function putTargets(dist) {
  for (let i = 0; i < 6; i++) {
    const e = Game.spawnEnemy('walker', false, p.x + dist + i * 8, p.y + (i - 3) * 6);
    e.hp = 1e9; e.maxHp = 1e9; e.speed = 0;
  }
}

function sim(seconds) {
  const step = 1 / 60;
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    p.hp = p.maxHp;
    p.invuln = 1;
    HS.Main.tick(step);
    if (Game.state === 'levelup') Game.pickChoice(0);
  }
}

function runOne(id, withTargets, seconds) {
  prep(id);
  if (withTargets) putTargets(40);
  sim(seconds);
  const d = D.gear[id] || {};
  return {
    id: id,
    name: d.name || id,
    mech: d.mech || '?',
    n: sounds.length,
    fires: fires,
    beams: beamCalls,
    beamStarts: beamStarts,
    beamOn: beamActive,
    orphan: sounds.filter((s) => !actedFrames.has(s.f)).length,
    arts: [...new Set(sounds.map((s) => s.arg))],
    canFire: !!(d.mech && ['buff', 'none', 'heal'].indexOf(d.mech) < 0)
  };
}

/* ---------------- 1. 没有敌人：不许有任何"空放"的开火音 ---------------- */
console.log('\n[无敌人] 任何音效都必须伴随真实攻击');
{
  const orphans = [];
  const hums = [];
  for (const id of ALL) {
    const r = runOne(id, false, 1.6);
    if (r.orphan) orphans.push(r.name + '[音' + r.n + ' 空放' + r.orphan + ']');
    if (r.beams) hums.push(r.name + '[' + r.beams + ' 次嗡鸣]');
  }
  check('全部 ' + ALL.length + ' 件武器都没有"没攻击也发声"', orphans.length === 0,
    orphans.length ? orphans.join(' ') : '干净');
  check('没有目标时不会起嗡鸣', hums.length === 0, hums.length ? hums.join(' ') : '安静');
}

/* ---------------- 2. 持续光束：没目标 / 目标在射程外都不许响 ---------------- */
console.log('\n[持续光束] 空放检查');
for (const id of ['redlaser', 'redlaser_x']) {
  const r = runOne(id, false, 1.6);
  check(D.gear[id].name + ' 没目标零音效', r.n === 0 && r.beams === 0,
    r.n + ' 声 / ' + r.beams + ' 次续期');
}
{
  prep('redlaser');
  putTargets(300);              // 远在 235 射程之外
  sim(1.6);
  check('红莲切割者 敌人在射程外也不响', sounds.length === 0 && beamCalls === 0,
    sounds.length + ' 声 / ' + beamCalls + ' 次续期');
}

/* ---------------- 3. 有敌人：音效必须落在动作同一帧，且真的出声 ---------------- */
console.log('\n[有敌人] 音效与开火同帧，且不许把声音修没');
{
  /* 这两件开火时走的是 Audio.ui（放地雷 / 丢诱饵），不是开火层，不参与"必须出声" */
  const uiSfx = ['decoy', 'minelay'];
  const orphanList = [];
  const silent = [];
  let sounded = 0;
  for (const id of ALL) {
    const r = runOne(id, true, 4);
    if (r.orphan) orphanList.push(r.name + '[空放' + r.orphan + '/' + r.n + ']');
    if (r.n > 0) sounded++;
    if (r.canFire && r.n === 0 && uiSfx.indexOf(id) < 0) silent.push(r.name + '(' + r.mech + ')');
  }
  check('没有一件武器"音效和动作对不上帧"', orphanList.length === 0,
    orphanList.length ? orphanList.join(' ') : '全部同帧');
  check('每把会开火的武器都出声了', silent.length === 0,
    silent.length ? silent.join(' ') : sounded + ' 把有声');
}

/* ---------------- 4. 持续光束：一直响，不是一发一发 ---------------- */
console.log('\n[持续光束] 持续出声（不是脉冲）');
{
  const r = runOne('redlaser', true, 2);
  check('红莲每帧都在续期（声音不断）', r.beams >= 110, r.beams + ' 次 / 2s');
  check('红莲只点一次火（不噼啪）', r.n === 1, r.n + ' 声');
  const r2 = runOne('redlaser_x', true, 2);
  check('熔核每帧都在续期', r2.beams >= 110, r2.beams + ' 次 / 2s');
  check('熔核起手用自己的音色', r2.arts.indexOf('meltlaser') >= 0 && r2.n === 1,
    r2.arts.join(',') + ' · ' + r2.n + ' 声');
}

/* ---------------- 4b. 断火再点：每次重新点亮只响一声 ---------------- */
console.log('\n[重新点亮] 目标断了再回来');
{
  prep('redlaser');
  putTargets(40);
  sim(1);                       // 打一会儿
  Game.run.enemies.length = 0;  // 目标没了
  sim(0.5);
  const offAfter = beamActive;
  const nMid = sounds.length;
  putTargets(40);               // 再出现
  sim(0.8);
  check('目标消失后嗡鸣关掉', offAfter === false);
  check('重新出现再点亮一次（多一声点火）', sounds.length === nMid + 1,
    (sounds.length - nMid) + ' 声');
  check('点亮次数 = 2', beamStarts === 2, beamStarts + ' 次');
}

/* ---------------- 5. 红莲真的在打的时候，连锁闪电照常蓄能 ---------------- */
console.log('\n[连锁闪电] 持续光束不许被整段排除');
{
  /* 曾经的修法是把 sustainBeam 整个排除在 chargeChain 之外，等于这张卡对红莲无效。
     现在的口径是"按真的开火次数蓄能"：有目标才开火，所以这里天然有蓄能。 */
  let zaps = 0;
  const origZap = HS.Audio.zap;
  HS.Audio.zap = function () { zaps++; return origZap.apply(this, arguments); };
  prep('redlaser');
  p.chainLvl = 1;
  putTargets(40);
  zaps = 0;
  sim(3);
  p.chainLvl = 0;
  HS.Audio.zap = origZap;
  check('红莲有目标时照常放连锁闪电', zaps >= 2, zaps + ' 道 / 3s');
}

/* ---------------- 6. 慢枪：一发一声，不许随机静音 ---------------- */
console.log('\n[慢枪] 开火间隔 ≥0.25s 的枪一发一声');
{
  /* 快枪（SMG / 加特林）抽掉 1/4 是为了不糊成白噪音；慢枪抽掉就是"扣扳机没响"。
     fires ≤ 20（4 秒内）≈ 间隔 ≥0.2s，正好是慢枪那一档。 */
  const ONE = ['bullet', 'spread', 'burst', 'missile', 'boomerang'];
  const miss = [];
  for (const id of ALL) {
    const d = D.gear[id];
    if (!d || ONE.indexOf(d.mech) < 0) continue;
    const r = runOne(id, true, 4);
    if (r.fires > 0 && r.fires <= 20 && r.n < r.fires) {
      miss.push(r.name + ' ' + r.n + '/' + r.fires);
    }
  }
  check('没有"打出去了却没声音"的慢枪', miss.length === 0,
    miss.length ? miss.join(' ') : '每发都响');
}

/* ---------------- 7. 打一半目标没了：嗡鸣要跟着光一起停 ---------------- */
console.log('\n[目标消失] 嗡鸣必须跟着光一起停');
{
  prep('redlaser');
  putTargets(40);
  sim(1);
  const live = beamActive;
  const hummed = beamCalls;
  Game.run.enemies.length = 0;
  sim(0.3);
  check('光束还在打的时候在嗡', live === true && hummed > 30, hummed + ' 次续期 / 1s');
  check('目标清空后立刻停（不留尾音）', beamActive === false);
  check('停了就不再新建声部', beamStarts === 1, beamStarts + ' 次');
}

console.log('\n----------------------------------------');
console.log(bad === 0 ? '全部通过 ✓' : bad + ' 项未通过 ✗');
process.exit(bad ? 1 : 0);
