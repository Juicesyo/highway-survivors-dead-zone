/**
 * 无头冒烟测试
 * 用法: node tools/smoke.js
 *
 * 通过 Node 桩画布跑完整游戏循环，验证：
 * 开局 / 移动 / 战斗 / 升级三选一 / 进化 / Boss / 胜负结算 / 局外强化
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
/* 出生点随机化会按随机路口摆玩家，而本文件的用例都假设出生在原点。
   打开 testMode：startRun 固定回 (0,0)，保持整套用例确定性。 */
Game.testMode = true;

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log('  \u2713 ' + name + (extra ? '  (' + extra + ')' : ''));
  } else {
    failures++;
    console.log('  \u2717 ' + name + (extra ? '  (' + extra + ')' : ''));
  }
}
function section(t) { console.log('\n[' + t + ']'); }

function tap(id) { Game.activate(id); }

/** 选一张卡：如果弹出了「替换副武器」确认框，按确认继续（模拟已经想清楚要换） */
function pickAndResolve(idx) {
  Game.pickChoice(idx);
  if (Game.confirm) Game.confirmSwap(true);
}

/* 自动驾驶：绕圈移动，碰到升级就选第一张 */
let ang = 0;
let ticks = 0;
function advance(seconds, opts) {
  opts = opts || {};
  const step = 1 / 60;
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    ang += 0.9 * step;
    if (!opts.still) {
      // 模拟"会走位"的玩家：远离附近的僵尸群，同时保持绕圈
      let vx = Math.cos(ang) * 0.55, vy = Math.sin(ang) * 0.55;
      const run = Game.run;
      if (run) {
        let fx = 0, fy = 0, cnt = 0;
        const en = run.enemies;
        for (let k = 0; k < en.length; k++) {
          const e = en[k];
          if (e.dead) continue;
          const dx = run.p.x - e.x, dy = run.p.y - e.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 110 * 110) {
            const d = Math.sqrt(d2) || 1;
            fx += dx / d * (110 - d) / 110;
            fy += dy / d * (110 - d) / 110;
            cnt++;
          }
        }
        if (cnt > 0) {
          vx += fx * 1.6; vy += fy * 1.6;
        } else if (run) {
          /* 安全时顺路捡经验 */
          let best = null, bd = 130 * 130;
          const gems = run.gems;
          for (let k = 0; k < gems.length; k++) {
            const g = gems[k];
            if (g.dead) continue;
            const dx = g.x - run.p.x, dy = g.y - run.p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = g; }
          }
          if (best && bd > 4) {
            const d = Math.sqrt(bd);
            vx += (best.x - run.p.x) / d * 1.6;
            vy += (best.y - run.p.y) / d * 1.6;
          }
        }
      }
      const l2 = Math.sqrt(vx * vx + vy * vy) || 1;
      HS.Input.joy.active = true;
      HS.Input.joy.dx = vx / l2;
      HS.Input.joy.dy = vy / l2;
      HS.Input.joy.mag = 1;
    } else {
      HS.Input.joy.active = false;
      HS.Input.joy.mag = 0;
    }

    if (opts.god && Game.run) {
      Game.run.p.hp = Game.run.p.maxHp;
      Game.run.p.invuln = 1;
    }

    HS.Main.tick(step);
    ticks++;

    if (Game.state === 'levelup') {
      if (opts.levelChoices) opts.levelChoices.push(Game.run.choices.map(c => c.kind + ':' + c.id));
      pickAndResolve(0);
    }
    /* 搜刮翻到主武器会停下来问；测试里默认"换" */
    if (Game.state === 'lootask') Game.answerLoot(true);
    if (opts.stopOnResult && Game.state === 'result') break;
    if (opts.eachFrame) opts.eachFrame();
  }
}

/* ================= 1. 启动 ================= */
section('启动');
check('模块加载', !!(HS.P && HS.Game && HS.UI && HS.Render && HS.Sprites));
check('无头平台', HS.P.isNode === true);
check('初始状态为标题', Game.state === 'title', Game.state);
HS.Main.tick(1 / 60);
check('标题帧渲染无异常', true);

/* ================= 2. 进入选图与开局 ================= */
section('开局流程');
tap('start');
check('进入选图', Game.state === 'mapselect', Game.state);
tap('map:highway');
tap('launch');
check('进入局内', Game.state === 'run', Game.state);
check('玩家有初始武器', Game.run.p.weapons.length === 1, Game.run.p.weapons.map(w => w.id).join(','));
check('初始生命 > 0', Game.run.p.hp > 0, Game.run.p.hp);

/* ================= 3. 跑 45 秒 ================= */
section('45 秒自动战斗');
const kinds = [];
/* 稳定供靶：在机器人周围放一圈近点靶子。随机刷怪偶尔太少时，
   45 秒可能一个等级都升不上去，导致本段断言连锁误报 ——
   这里验的是"伤害→经验→升级"链路，不该看刷怪运气 */
{
  const p0 = Game.run.p;
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    Game.spawnEnemy('walker', false, p0.x + Math.cos(a) * 55, p0.y + Math.sin(a) * 55);
  }
}
/* 这一段验的是"打得出伤害、拿得到经验、升得了级"，不是存活能力；
   不加 god 的话，机器人偶尔会被尸群围死，导致后面几条断言连锁失败。
   另外把拾取范围临时放大：机器人的走位策略会绕开身边 110px 内的敌人，
   于是"刚打死的怪掉的经验"永远躺在它不愿回去的地方 —— 这会偶发变成 0 次升级。 */
const magSave = Game.run.p.magnet;
Game.run.p.magnet = 320;
advance(45, { levelChoices: kinds, god: true });
Game.run.p.magnet = magSave;
check('产生击杀', Game.run.kills > 0, Game.run.kills + ' kills');
check('获得等级', Game.run.p.level > 1, 'Lv.' + Game.run.p.level);
check('升级卡池非空', kinds.length > 0, kinds.length + ' 次升级');
check('玩家坐标有效', isFinite(Game.run.p.x) && isFinite(Game.run.p.y));
check('敌人数量受控', Game.run.enemies.length <= 160, Game.run.enemies.length);
check('子弹无 NaN', Game.run.bullets.every(b => isFinite(b.x) && isFinite(b.y)));
const growthPts = Game.run.p.weapons.reduce((a, w) =>
  a + (w.lvl || 1) + Object.keys(w.up || {}).length, 0)
  + Game.run.p.autos.reduce((a, w) =>
    a + (w.lvl || 1) + Object.keys(w.up || {}).length, 0)
  + Object.keys(Game.run.p.passives).length
  + Object.keys(Game.run.p.synLv).length;
/* 成长点：换过主武器会把等级清零（每局最多换一次），所以"等级很高但成长点=1"也算正常。
   升级次数 ≥3 时至少有一次加在已有构筑上，用它兜住随机选卡的抖动 */
check('有武器/被动成长', growthPts > 1 || Game.run.p.level > 3 || kinds.length >= 3 ||
  Game.run.p.weapons.length > 1 || Game.run.p.autos.length > 0,
  '武器成长点 ' + growthPts + ' ／ 升级 ' + kinds.length + ' 次 ／ 装备 ' + Game.run.p.weapons.map((w) => w.id + ':' + w.lvl).join(','));
const many = Game.buildChoices(30).map(c => c.kind);
check('升级池包含被动', many.some(k => k.indexOf('passive') === 0),
  many.filter(k => k.indexOf('passive') === 0).length + ' 个被动选项');
check('升级池包含新装备', many.some(k => k === 'weaponNew' || k === 'autoNew'),
  many.filter(k => k === 'weaponNew' || k === 'autoNew').length + ' 个新装备选项');


/* ================= 4. 经验拾取范围（磁石必须有用） ================= */
section('经验拾取范围');
Game.startRun('highway', 'soldier');
const gp = Game.run.p;
Game.run.enemies.length = 0;
const farGem = { x: gp.x + 400, y: gp.y, vx: 0, vy: 0, xp: 1, size: 2, dead: false, t: 99 };
const nearGem = { x: gp.x + gp.magnet * 0.6, y: gp.y, vx: 0, vy: 0, xp: 1, size: 2, dead: false, t: 99 };
Game.run.gems.push(farGem, nearGem);
const magnetR = gp.magnet;
advance(1.2, { still: true });
check('磁石半径内会被吸走', nearGem.dead === true, 'magnet=' + Math.round(magnetR));
const farDist = HS.U.dist(farGem.x, farGem.y, gp.x, gp.y);
check('范围外的经验不会自动飞过来', farGem.dead === false && Math.abs(farDist - 400) < 2,
  'distance=' + Math.round(farDist));

// 提升磁石之后，原本够不到的经验应该被吸到
Game.run.p.passives.magnet = 4;
Game.recalc(Game.run.p);
check('磁石强化后半径变大', Game.run.p.magnet > magnetR * 1.5,
  Math.round(magnetR) + ' -> ' + Math.round(Game.run.p.magnet));


/* ================= 5. 场景障碍：碰撞 / 挡子弹 / 搜刮 ================= */
section('场景障碍与搜刮');
const props = [];
HS.World.queryRect(-700, -700, 700, 700, props);
check('世界生成了道具', props.length > 0, props.length + ' 个');

/* 碰撞盒必须等于精灵帧尺寸。横放用 *_h、竖放用 *_v，一旦把 def.w/h 写成另一个
   方向的尺寸，就会出现"看着一根柱子、撞上去是一堵横墙"的隐形墙。 */
const dimBad = props.filter(o => {
  const s = HS.Sprites.size(o.frame);
  return s.w !== o.w || s.h !== o.h;
});
check('道具碰撞盒与精灵帧尺寸一致', dimBad.length === 0,
  dimBad.slice(0, 3).map(o => o.type + ':' + o.frame + ' ' + o.w + 'x' + o.h).join(' | '));

const carProp = props.find(o => o.type === 'sedan' || o.type === 'van' || o.type === 'barrier');
const crateProp = props.find(o => o.type === 'crate');

// 车挡子弹，木箱不挡
check('车/路障会挡住子弹', carProp ? !!HS.World.hitBlock(carProp.x, carProp.y, 2) : false);
check('木箱不挡子弹', crateProp ? !HS.World.hitBlock(crateProp.x, crateProp.y, 2) : false);

// 走进车里会被推出来
const probe = { x: carProp.x, y: carProp.y };
HS.World.resolve(probe, 5);
/* 车会随机旋转，判定要用同一个旋转矩形（boxHit），不能拿未旋转的 AABB 比 */
const insideAfter = HS.World.boxHit(probe.x, probe.y, 0, carProp);
check('圆形实体不会陷进障碍物', !insideAfter,
  Math.round(probe.x) + ',' + Math.round(probe.y));

// 玩家实际移动也过不去
const pp = Game.run.p;
pp.x = carProp.x;
pp.y = carProp.y + 46;
Game.run.enemies.length = 0;
pp.hp = 9999;
let everInside = false;
for (let k = 0; k < 90; k++) {
  HS.Input.joy.active = true;
  HS.Input.joy.dx = 0; HS.Input.joy.dy = -1; HS.Input.joy.mag = 1;
  Game.update(1 / 60);
  if (Game.state === 'levelup') pickAndResolve(0);
  if (HS.World.boxHit(pp.x, pp.y, 0, carProp)) everInside = true;
}
/* 斜停的车允许玩家贴着边滑过去，但绝不允许穿进车体 */
check('玩家被车挡住（没有穿进车体）', !everInside,
  'y=' + Math.round(pp.y) + ' 车底=' + Math.round(carProp.by1));

// 搜刮
const lootProp = props.find(o => o.lootable && !o.looted);
check('存在可搜刮道具', !!lootProp);
if (lootProp) {
  pp.x = lootProp.x;
  pp.y = lootProp.y + 18;
  pp.hp = 9999;
  Game.update(1 / 60);
  check('靠近后出现搜刮目标', Game.run.lootTarget === lootProp);

  const goldBefore = Game.run.gold;
  Game.beginSearch();
  check('进入搜刮状态', !!Game.run.search);

  Game.run.bullets.length = 0;
  pp.hp = 9999;
  advance(0.6, { still: true });
  check('搜刮时武器不攻击', Game.run.bullets.length === 0, Game.run.bullets.length + ' 颗子弹');

  pp.hp = 9999;
  advance(1.2, { still: true });
  check('搜刮完成', lootProp.looted === true);
  check('搜刮产出（金币或掉落）', Game.run.gold > goldBefore || Game.run.gems.length > 0,
    'gold +' + (Game.run.gold - goldBefore));
  check('搜刮后退出搜刮状态', !Game.run.search);
  check('同一道具不能重复搜刮', (function () {
    const g2 = Game.run.gold;
    Game.run.lootTarget = lootProp;
    Game.beginSearch();
    return !Game.run.search && Game.run.gold === g2;
  })());
}

/* ================= 6. 可进入建筑：门 / 室内 / 楼顶 ================= */
section('可进入建筑');
Game.startRun('highway', 'soldier');
const bp = Game.run.p;
const bArr = [];
HS.Buildings.buildingsInRect(-1600, -1600, 1600, 1600, bArr);
const intactArr = bArr.filter(b => !b.ruin);
const ruinArr = bArr.filter(b => b.ruin);
check('生成了建筑', bArr.length > 0, bArr.length + ' 栋');
check('大部分建筑是废墟', ruinArr.length > intactArr.length,
  '废墟 ' + ruinArr.length + ' / 完整 ' + intactArr.length);
check('可进入建筑数量被压低', intactArr.length < bArr.length * 0.55,
  Math.round(intactArr.length / bArr.length * 100) + '% 可进入');
let overlapped = false;
for (let ai = 0; ai < bArr.length && !overlapped; ai++) {
  for (let aj = ai + 1; aj < bArr.length; aj++) {
    const A = bArr[ai], B = bArr[aj];
    if (A.x0 < B.x1 && A.x1 > B.x0 && A.y0 < B.y1 && A.y1 > B.y0) { overlapped = true; break; }
  }
}
check('建筑之间没有重叠', !overlapped);

/* 废墟是实心路障：推得出、不可进入、挡子弹 */
if (ruinArr.length) {
  const ruin = ruinArr[0];
  const probe2 = { x: ruin.x, y: ruin.y };
  HS.Buildings.resolve(probe2, 5);
  check('废墟会把玩家推出去', HS.Buildings.insideSolid(probe2.x, probe2.y) === false);
  check('废墟不算可进入室内', HS.Buildings.insideOf(ruin.x, ruin.y) === null);
  check('废墟挡子弹', !!HS.Buildings.hitBlock(ruin.x, ruin.y, 2));
}

let bld = null;
for (let i = 0; i < bArr.length; i++) {
  if (!bArr[i].ruin && bArr[i].stairs) { bld = bArr[i]; break; }
}
check('存在带楼梯的多层建筑', !!bld);
if (bld) {
  const sides = {};
  for (let i = 0; i < bld.doors.length; i++) sides[bld.doors[i].side] = 1;
  check('至少两个出口', bld.doors.length >= 2, bld.doors.length + ' 个');
  check('出口分布在不同墙面', Object.keys(sides).length >= 2, Object.keys(sides).join(''));

  /* 从门外走进楼：验证门洞真的能过人 */
  const door = bld.doors[0];
  bp.x = door.ox; bp.y = door.oy; bp.hp = 9999;
  Game.run.enemies.length = 0;
  for (let k = 0; k < 100; k++) {
    HS.Input.joy.active = true;
    HS.Input.joy.dx = -door.out.x;
    HS.Input.joy.dy = -door.out.y;
    HS.Input.joy.mag = 1;
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
    if (HS.Buildings.insideOf(bp.x, bp.y) === bld) break;
  }
  HS.Input.joy.active = false;
  HS.Input.joy.mag = 0;
  check('玩家可以从门洞进入建筑', HS.Buildings.insideOf(bp.x, bp.y) === bld,
    Math.round(bp.x) + ',' + Math.round(bp.y));

  for (let k = 0; k < 24; k++) {
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
  }
  check('进入后屋顶淡出', bld.reveal > 0.8, bld.reveal.toFixed(2));
  check('记录室内状态', Game.run.insideBld === bld);
  HS.Main.tick(1 / 60);
  check('室内画面渲染无异常', true);

  /* 室内搜刮 */
  let lootF = null, lootN = 0;
  for (let i = 0; i < bld.furniture.length; i++) {
    const f = bld.furniture[i];
    if (!f.lootable || f.looted) continue;
    lootN++;
    if (!lootF) lootF = f;
  }
  check('室内至少有 2 个搜刮点', lootN >= 2, lootN + ' 个');
  if (lootF) {
    bp.x = lootF.x; bp.y = lootF.y + 10; bp.hp = 9999;
    Game.run.enemies.length = 0;
    Game.update(1 / 60);
    check('靠近家具出现搜刮按钮', Game.run.lootTarget === lootF);
    Game.beginSearch();
    check('进入室内搜刮', !!Game.run.search);
    const gBefore = Game.run.gold;
    for (let k = 0; k < 90; k++) {
      Game.update(1 / 60);
      if (Game.state === 'levelup') pickAndResolve(0);
    }
    check('室内搜刮完成', lootF.looted === true);
    check('室内搜刮有产出', Game.run.gold > gBefore || Game.run.gems.length > 0,
      'gold +' + (Game.run.gold - gBefore));
  }

  /* 上楼 / 下楼 / 跳下 */
  bp.x = bld.stairs.x; bp.y = bld.stairs.y; bp.hp = 9999;
  Game.update(1 / 60);
  check('靠近楼梯出现上楼按钮', Game.run.stairTarget === bld);
  Game.activate('stairs');
  check('可以登上楼顶', bp.roof === bld);
  Game.update(1 / 60);
  check('楼顶楼梯口可以原路下楼', Game.run.roofHatch === bld);
  HS.Main.tick(1 / 60);
  check('楼顶画面渲染无异常', true);
  Game.activate('stairs');
  check('原路下楼回到室内', bp.roof === null && HS.Buildings.insideOf(bp.x, bp.y) === bld);

  /* 僵尸从门进楼 */
  bp.x = bld.x; bp.y = bld.y;
  HS.Buildings.resolve(bp, bp.r);
  bp.hp = 9999;
  Game.run.p.weapons = [];
  Game.run.enemies.length = 0;
  const door2 = bld.doors[1] || bld.doors[0];
  const walker = Game.spawnEnemy('walker', false, door2.ox, door2.oy - 8);
  let gotIn = false;
  for (let k = 0; k < 300; k++) {
    HS.Input.joy.active = false;
    HS.Input.joy.mag = 0;
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
    if (HS.Buildings.insideOf(walker.x, walker.y) === bld) { gotIn = true; break; }
  }
  check('僵尸会从门进入建筑', gotIn,
    Math.round(walker.x) + ',' + Math.round(walker.y));

  /* 玩家上楼，僵尸跟着爬楼梯 */
  bp.x = bld.stairs.x; bp.y = bld.stairs.y;
  Game.update(1 / 60);
  Game.activate('stairs');
  check('再次登顶', bp.roof === bld);
  const climber = Game.spawnEnemy('walker', false, bld.x0 - 40, bld.y);
  climber.x = bld.stairs.x; climber.y = bld.stairs.y;
  Game.update(1 / 60);
  check('僵尸会顺着楼梯上楼顶', climber.roof === bld);

  /* 跳下：扣血、离开屋顶 */
  bp.x = bld.x1 - 12; bp.y = bld.y;
  bp.hp = 9999;
  Game.update(1 / 60);
  check('楼顶边缘可以跳下', !!Game.run.jumpDir);
  const hpBefore = bp.hp;
  Game.activate('jump');
  check('跳下后离开屋顶', bp.roof === null);
  check('跳下会摔伤扣血', bp.hp < hpBefore, Math.round(hpBefore) + ' -> ' + Math.round(bp.hp));

  /* 玩家离开后，楼顶丧尸会自己下楼 */
  let cameDown = false;
  for (let k = 0; k < 240; k++) {
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
    if (climber.roof === null) { cameDown = true; break; }
  }
  check('玩家离开后楼顶丧尸会下楼', cameDown);
}

/* ================= 6.5 丧尸必须走得出房屋（回归） ================= */
section('丧尸出屋');
/* 曾经的 bug：门内点 / 门外点每帧互相顶替，丧尸在门洞里原地抖，
   永远出不来；另外家具会长在门内点上把出口堵死。 */
const exitBlds = [];
for (let i = 0; i < bArr.length && exitBlds.length < 8; i++) {
  if (!bArr[i].ruin && bArr[i].doors.length >= 2) exitBlds.push(bArr[i]);
}
let exitFail = 0, exitWorst = 0;
/* startRun 会重置建筑缓存，bb 是旧对象，只能按坐标比对 */
function inBld(x, y, bb) {
  const b2 = HS.Buildings.insideOf(x, y);
  return !!b2 && Math.abs(b2.x0 - bb.x0) < 0.5 && Math.abs(b2.y0 - bb.y0) < 0.5;
}
for (const bb of exitBlds) {
  Game.startRun('highway', 'soldier');
  const ep = Game.run.p;
  ep.weapons = [];
  ep.hp = 99999;
  ep.x = bb.x1 + 170;
  ep.y = bb.y1 + 170;
  Game.run.enemies.length = 0;

  const zoo = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2;
    const ez = Game.spawnEnemy('walker', false, bb.x1 + 400, bb.y1 + 400);
    ez.x = (bb.ix0 + bb.ix1) / 2 + Math.cos(a) * (bb.ix1 - bb.ix0) * 0.3;
    ez.y = (bb.iy0 + bb.iy1) / 2 + Math.sin(a) * (bb.iy1 - bb.iy0) * 0.3;
    zoo.push(ez);
  }

  let t = 0;
  for (let k = 0; k < 60 * 14; k++) {
    ep.hp = 99999;
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
    t = k / 60;
    let allOut = true;
    for (const ez of zoo) if (!ez.dead && inBld(ez.x, ez.y, bb)) { allOut = false; break; }
    if (allOut) break;
  }
  let left = 0;
  for (const ez of zoo) if (!ez.dead && inBld(ez.x, ez.y, bb)) left++;
  if (left) exitFail++;
  if (t > exitWorst) exitWorst = t;
}
check('6 只丧尸能走出房屋', exitFail === 0,
  exitBlds.length + ' 栋 · 失败 ' + exitFail + ' · 最慢 ' + exitWorst.toFixed(1) + 's');

/* 门内点不许被家具堵住（堵住就等于没门） */
let blockedDoors = 0;
for (let i = 0; i < bArr.length; i++) {
  const bb = bArr[i];
  if (bb.ruin) continue;
  for (let d = 0; d < bb.doors.length; d++) {
    const dr = bb.doors[d];
    for (let f = 0; f < bb.furniture.length; f++) {
      const fu = bb.furniture[f];
      if (!fu.solid) continue;
      if (dr.ix > fu.x0 - 3 && dr.ix < fu.x1 + 3 && dr.iy > fu.y0 - 3 && dr.iy < fu.y1 + 3) { blockedDoors++; break; }
    }
  }
}
check('门内走道没有被家具堵死', blockedDoors === 0, blockedDoors + ' 处');

/* ================= 6.5b 丧尸绕楼（同层追击不许顶死在墙上） ================= */
section('丧尸绕楼');
/* 玩家站在楼的一侧、丧尸全在正对面：直线追击必然被整栋楼挡住。
   以前这里会永久顶死在墙上（追击方向垂直于墙面，切向分量是 0，滑不动），
   或者从门洞钻进去又掉头出来、在门槛上每帧来回翻。 */
const routeBlds = [];
for (let i = 0; i < bArr.length && routeBlds.length < 8; i++) routeBlds.push(bArr[i]);
let routeFail = 0, routeWorst = 0, routeTotal = 0;
function probeFree(x, y) {
  for (let k = 0; k < 60; k++) {
    const a = k * 2.399963, rr = k * 3;
    const nx = x + Math.cos(a) * rr, ny = y + Math.sin(a) * rr;
    if (!HS.World.insideSolid(nx, ny)) return { x: nx, y: ny };
  }
  return null;
}
for (const bb of routeBlds) {
  Game.startRun('highway', 'soldier');
  const rp = Game.run.p;
  rp.weapons = [];
  rp.hp = 1e9;
  Game.run.enemies.length = 0;

  const ps = probeFree(bb.x1 + 62, bb.y);
  if (!ps) continue;
  rp.x = ps.x; rp.y = ps.y;

  const zoo = [];
  for (let k = 0; k < 6; k++) {
    const sz = probeFree(bb.x0 - 62, bb.y + (k - 2.5) * 12);
    if (!sz) continue;
    const ez = Game.spawnEnemy('walker', false, sz.x, sz.y);
    ez.x = sz.x; ez.y = sz.y;
    zoo.push(ez);
  }
  if (!zoo.length) continue;

  const hitAt = zoo.map(() => -1);
  for (let k = 0; k < 60 * 24; k++) {
    rp.hp = 1e9;
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
    for (let i = 0; i < zoo.length; i++) {
      if (hitAt[i] >= 0 || zoo[i].dead) continue;
      const rr = zoo[i].r * 0.4 + 30;
      const dx = zoo[i].x - rp.x, dy = zoo[i].y - rp.y;
      if (dx * dx + dy * dy < rr * rr) hitAt[i] = k / 60;
    }
    if (hitAt.every((v) => v >= 0)) break;
  }

  let bad = 0, m = 0;
  for (let i = 0; i < zoo.length; i++) {
    routeTotal++;
    if (hitAt[i] >= 0) { if (hitAt[i] > m) m = hitAt[i]; }
    else bad++;
  }
  if (bad) routeFail += bad;
  if (m > routeWorst) routeWorst = m;
}
check('丧尸能绕开楼体摸到玩家', routeFail === 0,
  routeTotal + ' 只 · 卡住 ' + routeFail + ' · 最慢 ' + routeWorst.toFixed(1) + 's');

/* 建筑测试结束，重置一局干净的 run */
Game.startRun('highway', 'soldier');
check('建筑测试后状态正常', Game.state === 'run' && Game.run.p.roof === null);

/* ================= 6.6 行走步态（回归） ================= */
section('行走步态');

/* 帧表必须知道腿从哪一行开始，否则一帧没法拆成「上身 + 两条腿」 */
{
  let noLeg = [];
  for (const nm of ['player_soldier', 'walker', 'runner', 'crawler', 'spitter', 'brute', 'boss']) {
    const fr = HS.Sprites.frame(nm);
    if (!fr || !fr.lr || fr.lr >= fr.h || fr.lr < fr.h * 0.3) noLeg.push(nm);
  }
  check('每个角色都有腿部切分行', noLeg.length === 0, noLeg.join(','));
}

/* 玩家：走起来 gait 拉满，松手后归零（不然会看到原地踏步或永远僵着） */
Game.startRun('highway', 'soldier');
{
  const gp = Game.run.p;
  gp.hp = 99999;
  HS.Input.joy.active = true;
  HS.Input.joy.dx = 1; HS.Input.joy.dy = 0; HS.Input.joy.mag = 1;
  for (let k = 0; k < 40; k++) {
    gp.hp = 99999;
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
  }
  check('走动时步态拉满', gp.gait > 0.85, gp.gait.toFixed(2));
  const leanDir = gp.lean;

  HS.Input.joy.mag = 0;
  for (let k = 0; k < 40; k++) {
    gp.hp = 99999;
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
  }
  check('停下后步态归零', gp.gait < 0.1, gp.gait.toFixed(2));
  check('停下后身体回正', Math.abs(gp.lean) < 0.1, gp.lean.toFixed(2));
  check('向右走时身体朝右倾', leanDir > 0.4, leanDir.toFixed(2));
}

/* 丧尸：追人时步态起来；被挤住不动时步态要掉下去 */
Game.startRun('highway', 'soldier');
{
  const p = Game.run.p;
  p.weapons = [];
  p.hp = 99999;
  Game.run.enemies.length = 0;
  const ze = Game.spawnEnemy('walker', false, p.x + 150, p.y);
  for (let k = 0; k < 30; k++) {
    p.hp = 99999; p.weapons = [];
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
  }
  check('丧尸移动时步态起来', ze.gait > 0.7, ze.gait.toFixed(2));
  check('丧尸步频跟速度挂钩', ze.anim > 0.5);
}

/* ================= 6.7 载具 ================= */
section('载具');

Game.startRun('highway', 'soldier');
{
  const run = Game.run, pp = run.p;
  const vs = run.vehicles;
  check('开局附近有可驾驶载具', vs.length > 0, vs.length + ' 辆' + (vs[0] ? ' · ' + vs[0].def.name : ''));
  check('载具数量很少', vs.length <= 2, vs.length + ' 辆');
  const veh = vs[0];

  /* 车是实心的：直接把玩家塞进车里，会被推出来 */
  const probe3 = { x: veh.x, y: veh.y };
  HS.World.resolve(probe3, 5);
  check('停着的载具是实心的',
    Math.abs(probe3.x - veh.x) > 0.5 || Math.abs(probe3.y - veh.y) > 0.5);

  /* 玩家自己的弹幕只会被车壳挡下，不会把车位（和待用的车）打坏 */
  {
    const durBefore = veh.dur;
    run.bullets.length = 0;
    run.bullets.push({
      x: veh.x - 26, y: veh.y, vx: 340, vy: 0,
      dmg: 999, r: 3, life: 1, max: 1, age: 0, delay: 0,
      pierce: 0, tag: 'gun', dead: false
    });
    for (let k = 0; k < 12; k++) { pp.hp = 9999; Game.update(1 / 60); }
    check('玩家子弹不会打坏停着的载具', Math.abs(veh.dur - durBefore) < 0.01,
      durBefore.toFixed(1) + ' -> ' + veh.dur.toFixed(1));
    check('子弹被车壳挡下', run.bullets.length === 0, run.bullets.length + ' 颗残留');
  }

  pp.x = veh.x; pp.y = veh.y + veh.h / 2 + 10; pp.hp = 9999;
  Game.update(1 / 60);
  check('靠近载具出现驾驶目标', run.nearVeh === veh);

  check('可以上车', HS.Vehicle.enter(run, veh) === true && pp.veh === veh);
  check('上车后耐久满值', Math.round(veh.dur) === Math.round(veh.maxDur));

  /* 武器必须停火 */
  run.enemies.length = 0;
  Game.spawnEnemy('walker', false, pp.x + 44, pp.y);
  run.bullets.length = 0;
  for (let k = 0; k < 24; k++) { pp.hp = 9999; Game.update(1 / 60); }
  check('驾驶时武器不开火', run.bullets.length === 0, run.bullets.length + ' 颗子弹');

  /* 开起来。先把车头摆正：这条测的是"直线加速"，车从道路任意朝向起步
     要先掉头（转向现在有惯性，掉头约 1.3s），测出来的就是别的东西了 */
  const x0 = pp.x;
  veh.heading = 0; veh.mvDir = 0; veh.turnV = 0;
  HS.Input.joy.active = true; HS.Input.joy.dx = 1; HS.Input.joy.dy = 0; HS.Input.joy.mag = 1;
  for (let k = 0; k < 100; k++) { pp.hp = 9999; Game.update(1 / 60); }
  check('载具能提速并移动', pp.x - x0 > 40 && pp.veh && Math.abs(pp.veh.speed) > 40,
    'Δx=' + Math.round(pp.x - x0) + ' speed=' + Math.round(pp.veh ? pp.veh.speed : 0));

  /* 车体坐标必须跟着玩家走：渲染 / 耐久条 / 残骸位置全读 v.x/v.y，
     漏掉同步就是"人开走了、车留在上车的地方"（图标不跟随的 bug） */
  const vv = pp.veh;
  check('驾驶时车体坐标跟随玩家',
    !!vv && Math.abs(vv.x - pp.x) < 0.01 && Math.abs(vv.y - pp.y) < 0.01,
    vv ? '偏差 ' + (Math.round(HS.U.dist(vv.x, vv.y, pp.x, pp.y) * 100) / 100) + ' px' : '没车');

  /* 车头碾压：碰撞范围是整根车身胶囊，不是"车中心一个圆" */
  run.enemies.length = 0;
  if (vv) { vv.heading = 0; vv.speed = vv.def.spd * 0.9; }
  const noseZ = Game.spawnEnemy('walker', false, pp.x + 24, pp.y);
  noseZ.x = pp.x + 24; noseZ.y = pp.y; noseZ.ramCd = 0;
  const farZ = Game.spawnEnemy('walker', false, pp.x + 74, pp.y);
  farZ.x = pp.x + 74; farZ.y = pp.y; farZ.ramCd = 0;
  HS.Vehicle.ram(run, vv, 1 / 60);
  check('车头前方 24px 就算碾压（胶囊判定）',
    noseZ.dead === true || noseZ.hp < noseZ.maxHp,
    Math.round(noseZ.hp) + '/' + Math.round(noseZ.maxHp));
  check('车头 74px 外不误判碾压',
    farZ.dead !== true && Math.round(farZ.hp) === Math.round(farZ.maxHp),
    Math.round(farZ.hp) + '/' + Math.round(farZ.maxHp));

  /* 碾压 */
  run.enemies.length = 0;
  const z1 = Game.spawnEnemy('walker', false, pp.x + 26, pp.y);
  z1.x = pp.x + 26; z1.y = pp.y;
  const durBeforeRam = pp.veh ? pp.veh.dur : 0;
  for (let k = 0; k < 24; k++) { pp.hp = 9999; Game.update(1 / 60); }
  check('碾压能撞死丧尸', z1.dead === true);
  check('碾压会磨损车体', pp.veh && pp.veh.dur < durBeforeRam,
    Math.round(durBeforeRam) + ' -> ' + Math.round(pp.veh ? pp.veh.dur : 0));

  /* 撞障碍：要比撞丧尸掉得更多 */
  const solids = [];
  HS.World.queryRect(pp.x - 520, pp.y - 520, pp.x + 520, pp.y + 520, solids);
  let hard = null;
  for (let k = 0; k < solids.length; k++) {
    if (solids[k].solid && !solids[k].broken && (solids[k].def.crash || 0) >= 8) { hard = solids[k]; break; }
  }
  check('附近有硬质障碍', !!hard);
  if (hard && pp.veh) {
    pp.x = hard.x; pp.y = hard.y + hard.h / 2 + 30;
    pp.veh.heading = -Math.PI / 2; pp.veh.speed = 110;
    pp.veh.touching = false; pp.veh.ramCd = 0; pp.veh.stunT = 0;
    HS.Input.joy.dx = 0; HS.Input.joy.dy = -1;
    const durBeforeCrash = pp.veh.dur;
    const lossRam = durBeforeRam - durBeforeCrash;
    for (let k = 0; k < 36; k++) { pp.hp = 9999; Game.update(1 / 60); }
    const lossCrash = pp.veh ? durBeforeCrash - pp.veh.dur : 99;
    check('撞硬物掉耐久明显更多', lossCrash > lossRam,
      '碾压 -' + Math.round(lossRam) + ' / 撞击 -' + Math.round(lossCrash));

    /* 车头扫地：扫地探针半径 = 车壳半径，撞上去之后车头不能埋进障碍里 */
    if (pp.veh) {
      const halfL = (pp.veh.def.h - pp.veh.def.w) / 2;
      const nx = pp.x + Math.cos(pp.veh.heading) * halfL;
      const ny = pp.y + Math.sin(pp.veh.heading) * halfL;
      check('撞墙后车头没有埋进障碍', !HS.World.insideSolid(nx, ny),
        '车头 (' + Math.round(nx) + ',' + Math.round(ny) + ')');
    }
  }

  /* 防护装备：同一"属性族"一轮最多出现 2 张，所以这里只要求至少 1 张 */
  const cards = Game.buildChoices(40);
  const gearCards = cards.filter(c => HS.Data.passives[c.id] && HS.Data.passives[c.id].gear);
  check('升级池包含防护装备', gearCards.length >= 1,
    gearCards.map(c => c.name).join(',') || '一张都没有');
  check('防护卡标注了装备类型', gearCards.length > 0 && gearCards[0].sub.indexOf('防护') >= 0,
    gearCards.length ? gearCards[0].sub : '无');

  const hpBeforeVest = pp.maxHp;
  pp.passives.vest = 2;
  Game.recalc(pp);
  check('防弹背心提高最大生命', pp.maxHp > hpBeforeVest, hpBeforeVest + ' -> ' + pp.maxHp);

  if (pp.veh) {
    const durMaxBefore = pp.veh.maxDur;
    const ratio = pp.veh.dur / pp.veh.maxDur;
    pp.passives.plating = 3;
    Game.recalc(pp);
    check('车体装甲提高载具耐久上限', pp.veh.maxDur > durMaxBefore + 1,
      Math.round(durMaxBefore) + ' -> ' + Math.round(pp.veh.maxDur));
    check('装甲提升不会白送耐久', Math.abs(pp.veh.dur / pp.veh.maxDur - ratio) < 0.02,
      Math.round(pp.veh.dur) + '/' + Math.round(pp.veh.maxDur));
  }

  /* 报废 */
  const deadVeh = pp.veh;
  HS.Vehicle.damage(run, deadVeh, 99999, false);
  check('耐久耗尽即报废', deadVeh.wreck === true && deadVeh.dur === 0);
  check('报废时玩家被甩出车外', pp.veh === null);
  check('报废后仍能继续游戏', Game.state === 'run' && pp.hp > 0, Math.round(pp.hp) + ' HP');
  check('残骸留在世界里', run.vehicles.indexOf(deadVeh) >= 0);
  check('残骸不能再上车', HS.Vehicle.enter(run, deadVeh) === false);

  /* 下车 / 再上车 */
  let fresh = null;
  for (let k = 0; k < 24 && !fresh; k++) {
    const a3 = k / 24 * Math.PI * 2;
    fresh = HS.Vehicle.spawn(run, pp.x + Math.cos(a3) * 90, pp.y + Math.sin(a3) * 90, false);
  }
  check('可以再生成一辆载具', !!fresh);
  if (fresh) {
    pp.x = fresh.x; pp.y = fresh.y + 18; pp.hp = 9999;
    check('再次上车', HS.Vehicle.enter(run, fresh) === true);
    const parkX = fresh.x, parkY = fresh.y;
    check('可以下车', HS.Vehicle.exit(run) === true && pp.veh === null);
    check('下车后车留在原地', Math.abs(fresh.x - parkX) < 0.5 && Math.abs(fresh.y - parkY) < 0.5);
    check('下车后人不在车里',
      Math.abs(pp.x - fresh.x) + Math.abs(pp.y - fresh.y) > 10);
    pp.x = fresh.x; pp.y = fresh.y + 18;
    check('下车后可以再上车', HS.Vehicle.enter(run, fresh) === true);
    HS.Vehicle.exit(run);
  }

  HS.Input.joy.active = false;
  HS.Input.joy.mag = 0;
  HS.Input.joy.dx = 0;
  HS.Input.joy.dy = 0;
  Game.startRun('highway', 'soldier');
  check('载具测试后状态正常', Game.state === 'run' && Game.run.p.veh === null);
}

/* ================= 6.8 武器手持 / 投掷动作 ================= */
section('武器手持与投掷');

Game.startRun('highway', 'soldier');
{
  const run = Game.run, pp = run.p;
  run.enemies.length = 0;

  /* 瞄准角：屏幕上有敌人就朝最近的那个 */
  pp.aimA = 0;
  const tgt = Game.spawnEnemy('walker', false, pp.x - 60, pp.y);
  tgt.x = pp.x - 60; tgt.y = pp.y;
  for (let k = 0; k < 40; k++) Game.updateAim(1 / 60);
  check('持枪瞄准角跟随最近敌人', Math.abs(Math.abs(pp.aimA) - Math.PI) < 0.2,
    'aimA=' + pp.aimA.toFixed(2));

  /* 清场之后枪口收回走位方向 */
  run.enemies.length = 0;
  pp.facing = 1;
  for (let k = 0; k < 90; k++) Game.updateAim(1 / 60);
  check('没有敌人时枪口朝走位方向', Math.abs(pp.aimA) < 0.2, 'aimA=' + pp.aimA.toFixed(2));

  /* 投掷：先抬手，出手帧才真正生成抛物线弹 */
  run.bullets.length = 0;
  pp.throws.length = 0;
  Game.handThrow(pp, pp.x + 60, pp.y, { dmg: 20, radius: 24, explode: true, color: '#e3b23c' });
  check('投掷先登记动作、不立刻出手',
    run.bullets.length === 0 && pp.throws.length === 1,
    pp.throws.length + ' 个待投 / ' + run.bullets.length + ' 发弹药');
  check('待投动作带出手时刻', pp.throws[0].rel > 0 && pp.throws[0].dur > pp.throws[0].rel,
    'rel=' + pp.throws[0].rel.toFixed(2) + 's dur=' + pp.throws[0].dur.toFixed(2) + 's');

  const relT = pp.throws[0].rel;
  for (let k = 0; k < Math.ceil(relT * 60) - 1; k++) Game.updateThrows(1 / 60);
  check('动画没放完之前弹药不出手', run.bullets.length === 0, pp.throws[0].t.toFixed(2) + 's');
  for (let k = 0; k < 4; k++) Game.updateThrows(1 / 60);
  check('出手帧生成抛物线弹', run.bullets.length === 1, run.bullets.length + ' 发');
  const lobB = run.bullets[0];
  check('抛物线弹带爆炸属性', !!lobB && lobB.explode === true && lobB.kind === 'lob',
    lobB ? lobB.kind : '无');
  check('抛物线弹从身前出手',
    !!lobB && HS.U.dist(lobB.sx, lobB.sy, pp.x, pp.y) < 10,
    lobB ? '起点偏移 ' + Math.round(HS.U.dist(lobB.sx, lobB.sy, pp.x, pp.y)) + ' px' : '无');

  for (let k = 0; k < 40; k++) Game.updateThrows(1 / 60);
  check('动作播完自动出队', pp.throws.length === 0, pp.throws.length + ' 个残留');
}

/* ================= 7. 武器进化 ================= */
section('武器进化');
Game.run.p.weapons = [{ id: 'pistol', lvl: 5, timer: 0, up: {}, slot: 'main', evolved: false }];
Game.run.p.passives.crit = 2;
Game.recalc(Game.run.p);
Game.run.p.xpNext = Game.run.p.xp + 1;
Game.gainXp(1);
check('触发升级界面', Game.state === 'levelup', Game.state);
const evoCard = Game.run.choices.find(c => c.kind === 'evolve');
check('出现进化选项', !!evoCard, Game.run.choices.map(c => c.kind + ':' + c.id).join(' | '));
if (evoCard) {
  const idx = Game.run.choices.indexOf(evoCard);
  Game.pickChoice(idx);
  check('武器已进化', Game.run.p.weapons[0].id === 'pistol_x', Game.run.p.weapons[0].id);
  check('进化计数', Game.run.evolutions === 1, Game.run.evolutions);
}
if (Game.state === 'levelup') pickAndResolve(0);
check('回到局内', Game.state === 'run', Game.state);

/* ================= 7.5 装备系统 ================= */
section('装备槽位');
Game.startRun('highway', 'soldier');
{
  const eq = Game.run.p;
  HS.Gear.clearHands(eq);
  eq.autos.length = 0;

  check('主武器可以装备', HS.Gear.take(eq, 'ar') === 'new');
  check('副武器可以装备', HS.Gear.take(eq, 'frag') === 'new');
  check('主槽已占：再装主武器被拒', HS.Gear.canTake(eq, 'shotgun').ok === false);
  check('重武器需要两个空槽', HS.Gear.canTake(eq, 'gatling').ok === false);

  HS.Gear.clearHands(eq);
  check('空手可以装重型武器', HS.Gear.take(eq, 'gatling') === 'new');
  check('重型同时占用主副槽', HS.Gear.mainEntry(eq).slot === 'heavy' && !HS.Gear.subEntry(eq));
  check('重型拖慢移动速度', eq.heavyMove < 1, 'x' + eq.heavyMove.toFixed(2));
  check('重型不会再接受副武器', HS.Gear.canTake(eq, 'frag').ok === false);

  /* 槽位满了也要能换装：升级卡允许替换，不能把玩家锁死在初始武器上 */
  HS.Gear.clearHands(eq);
  HS.Gear.take(eq, 'pistol');
  Game.applyChoice(Game.makeCard({ kind: 'weaponNew', id: 'lmg' }));
  check('主武器可以被新武器替换', eq.weapons.length === 1 && eq.weapons[0].id === 'lmg',
    eq.weapons.map((w) => w.id).join(','));
  Game.applyChoice(Game.makeCard({ kind: 'weaponNew', id: 'gatling' }));
  check('重型可以顶掉现有主武器', eq.weapons.length === 1 && eq.weapons[0].slot === 'heavy',
    eq.weapons.map((w) => w.id + ':' + w.slot).join(','));
  Game.applyChoice(Game.makeCard({ kind: 'weaponNew', id: 'frag' }));
  /* 重武器占满两格：副武器卡不能把它顶掉，否则玩家只剩一把副武器（= 主武器被吞） */
  check('持重型时副武器卡被拒绝', eq.weapons.length === 1 && eq.weapons[0].id === 'gatling',
    eq.weapons.map((w) => w.id + ':' + w.slot).join(','));

  /* 自动装备：重复获取合并升级，同类有件数上限 */
  eq.autos.length = 0;
  check('可以装备自动装备', HS.Gear.take(eq, 'drone') === 'new');
  check('重复获取合并升级', HS.Gear.take(eq, 'drone') === 'level' && eq.autos.length === 1,
    eq.autos.length + ' 件 / Lv' + eq.autos[0].lvl);
  ['railorb', 'saberring', 'reflectshield', 'gravitysat'].forEach((id) => HS.Gear.take(eq, id));
  const orbitCount = eq.autos.filter((a) => HS.Data.gear[a.id].kind === 'orbit').length;
  check('环绕型件数受上限约束', orbitCount <= HS.Data.autoCaps.orbit,
    orbitCount + ' / 上限 ' + HS.Data.autoCaps.orbit);

  /* 自动装备要真的打得动丧尸 */
  HS.Gear.clearHands(eq);
  eq.autos.length = 0;
  HS.Gear.take(eq, 'drone');
  Game.run.enemies.length = 0;
  const dummy = Game.spawnEnemy('walker', false, eq.x + 30, eq.y);
  dummy.hp = 9999; dummy.maxHp = 9999;
  const hp0 = dummy.hp;
  for (let k = 0; k < 120; k++) {
    eq.hp = 99999;
    Game.update(1 / 60);
  }
  check('自动装备会独立开火', dummy.hp < hp0 - 1, Math.round(hp0) + ' → ' + Math.round(dummy.hp));
}

section('属性兼容换算');
Game.startRun('highway', 'soldier');
{
  const p2 = Game.run.p;
  HS.Gear.clearHands(p2);
  p2.autos.length = 0;
  HS.Gear.take(p2, 'saber');
  Game.recalc(p2);
  const before = HS.Gear.stat(p2.weapons[0], p2);
  const t0 = before.targets;
  p2.passives.pierce = 2;
  Game.recalc(p2);
  const after = HS.Gear.stat(p2.weapons[0], p2);
  check('近战把穿透换算成目标数', after.targets === t0 + 2,
    t0 + ' → ' + after.targets);
  check('近战不会凭空得到穿透弹道', (after.pierce || 0) === 0, after.pierce);
}

section('抽取规则');
Game.startRun('highway', 'soldier');
{
  const p3 = Game.run.p;
  p3.weapons = [
    { id: 'lmg', lvl: 3, timer: 0, up: {}, slot: 'main' },
    { id: 'frag', lvl: 2, timer: 0, up: {}, slot: 'sub' }
  ];
  p3.autos = [{ id: 'drone', lvl: 2, timer: 0, up: {}, ang: 0, uid: 901 }];
  p3.passives = { crit: 2, pierce: 2, blast: 1, haste: 2 };
  Game.recalc(p3);

  let badUp = 0, dupId = 0, badEvo = 0;
  const equipped = {};
  p3.weapons.concat(p3.autos).forEach((w) => { equipped[w.id] = 1; });
  for (let k = 0; k < 60; k++) {
    const cs = Game.buildChoices(3);
    const seen = {};
    for (const c of cs) {
      if (c.kind === 'gearUp' && !equipped[c.id]) badUp++;
      if (seen[c.id]) dupId++;
      seen[c.id] = 1;
      if (c.kind === 'evolve') {
        const bd = HS.Data.gear[c.baseId];
        const lvl = (p3.weapons.find((w) => w.id === c.baseId) || {}).lvl || 0;
        if (lvl < 5) badEvo++;
      }
    }
  }
  check('专属升级只出现当前装备的', badUp === 0, badUp + ' 张越界');
  check('同一轮不重复同一装备', dupId === 0, dupId + ' 次重复');
  check('未达 5 级不会出进化', badEvo === 0, badEvo + ' 张越界');
  check('三个选项都有效', Game.buildChoices(3).every((c) => c.name && c.desc),
    Game.buildChoices(3).map((c) => c.src).join('/'));
}

/* ================= 7.6 全部装备可用性 ================= */
section('全部装备可用性');
Game.startRun('highway', 'soldier');
{
  const p = Game.run.p;
  let bad = 0, err = '';
  const ids = Object.keys(HS.Data.gear).filter((id) => !HS.Data.gear[id].evo);

  const exercise = (id) => {
    HS.Gear.clearHands(p);
    p.autos.length = 0;
    const r = HS.Gear.take(p, id);
    if (r === 'none') return 'take-failed';
    Game.recalc(p);
    Game.run.enemies.length = 0;
    Game.run.devices.length = 0;
    for (let k = 0; k < 4; k++) {
      const ez = Game.spawnEnemy('walker', false, p.x + 26 + k * 9, p.y + (k - 2) * 9);
      ez.hp = 4000; ez.maxHp = 4000;
    }
    for (let t = 0; t < 30; t++) {
      p.hp = 99999;
      Game.update(1 / 60);
      if (Game.state === 'levelup') pickAndResolve(0);
    }
    if (!isFinite(p.x) || !isFinite(p.hp)) return 'player-NaN';
    const bs = Game.run.bullets;
    for (let b = 0; b < bs.length; b++) {
      if (!isFinite(bs[b].x) || !isFinite(bs[b].y)) return 'bullet-NaN';
    }
    return null;
  };

  for (const id of ids) {
    let e2 = null;
    try { e2 = exercise(id); } catch (e) { e2 = e.message; }
    if (e2) { bad++; err = id + ' → ' + e2; break; }
  }
  check('全部基础装备都能实际运行', bad === 0, bad ? err : ids.length + ' 件');

  /* 进化形态同样要能跑 */
  let evoBad = 0, evoErr = '';
  const evoIds = Object.keys(HS.Data.gear).filter((id) => HS.Data.gear[id].evo);
  for (const id of evoIds) {
    try {
      HS.Gear.clearHands(p);
      p.autos.length = 0;
      p.weapons.push({ id: id, lvl: 1, timer: 0, up: {}, slot: HS.Data.gear[id].slot === 'sub' ? 'sub' : 'main', evolved: true });
      Game.recalc(p);
      Game.run.enemies.length = 0;
      for (let k = 0; k < 3; k++) {
        const ez = Game.spawnEnemy('walker', false, p.x + 24 + k * 10, p.y);
        ez.hp = 4000; ez.maxHp = 4000;
      }
      for (let t = 0; t < 24; t++) {
        p.hp = 99999;
        Game.update(1 / 60);
        if (Game.state === 'levelup') pickAndResolve(0);
      }
      if (!isFinite(p.hp)) throw new Error('NaN');
    } catch (e) { evoBad++; evoErr = id + ' → ' + e.message; break; }
  }
  check('全部进化形态都能实际运行', evoBad === 0, evoBad ? evoErr : evoIds.length + ' 种');
}

/* ================= 7.7 武器深度 ================= */
section('武器深度');
Game.startRun('highway', 'soldier');
{
  const p = Game.run.p;
  const D = HS.Data;

  /* 1. 每件手持装备都有成套的专属分支 */
  let noThree = 0, noSp = 0, tplBad = '';
  const handIds = D.weaponPool.concat(D.subPool, D.heavyPool);
  for (const id of handIds) {
    const ups = D.gearUps[id] || {};
    const bids = Object.keys(ups);
    if (bids.length < 3) { noThree++; tplBad = id; }
    if (!bids.some((b) => ups[b].special)) noSp++;
  }
  check('每件手持装备都有 ≥3 条专属分支', noThree === 0, noThree ? tplBad : handIds.length + ' 件');
  const spRate = 1 - noSp / handIds.length;
  check('多数装备带「改变机制」分支', spRate >= 0.7, (spRate * 100).toFixed(0) + '%');

  /* 2. 进化覆盖：主 / 副 / 重型都有质变路线 */
  let evoMain = 0, evoSub = 0, evoHeavy = 0;
  for (const id of Object.keys(D.evolutions)) {
    const d = D.gear[id];
    if (!d) continue;
    if (d.slot === 'main') evoMain++;
    else if (d.slot === 'sub') evoSub++;
    else if (d.slot === 'heavy') evoHeavy++;
  }
  check('主武器有进化路线', evoMain >= 30, evoMain + ' 条');
  check('副武器也有进化路线', evoSub >= 8, evoSub + ' 条');
  check('重型武器也有进化路线', evoHeavy >= 8, evoHeavy + ' 条');

  /* 3. 进化之后进入「觉醒」：不会变成不能继续投入的死卡 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = { crit: 2, haste: 2 };
  p.weapons = [{ id: 'pistol', lvl: 5, timer: 0, up: {}, slot: 'main' }];
  Game.recalc(p);
  const evoId = D.evolutions.pistol.id;
  Game.applyChoice(Game.makeCard({ kind: 'evolve', id: 'pistol', evo: evoId }));
  check('进化后武器换成进化形态', p.weapons[0].id === evoId, p.weapons[0].id);
  check('进化形态可以继续觉醒', (D.gear[evoId].maxLvl || 1) >= 2, D.gear[evoId].maxLvl);
  let awake = null;
  for (let k = 0; k < 80 && !awake; k++) {
    awake = Game.buildChoices(3).find((c) => c.kind === 'gearLevel' && c.id === evoId);
  }
  check('进化后仍会给出觉醒卡', !!awake, awake ? awake.sub : '未出现');
  const stBefore = HS.Gear.stat(p.weapons[0], p).dmg;
  p.weapons[0].lvl = 3;
  const stAfter = HS.Gear.stat(p.weapons[0], p).dmg;
  check('觉醒等级真的提升数值', stAfter > stBefore * 1.05,
    Math.round(stBefore) + ' -> ' + Math.round(stAfter));

  /* 4. 转管预热：加特林一直开火会真的越来越快 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  Game.recalc(p);
  check('空手能装加特林', HS.Gear.take(p, 'gatling') === 'new');
  Game.recalc(p);
  Game.run.enemies.length = 0;
  const dummyG = Game.spawnEnemy('walker', false, p.x + 90, p.y);
  dummyG.hp = 99999; dummyG.maxHp = 99999;
  const spinW = p.weapons[0];
  for (let k = 0; k < 90; k++) {
    p.hp = 99999;
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
  }
  check('加特林开火后转速上升', (spinW.spin || 0) > 0.4, (spinW.spin || 0).toFixed(2));

  /* 5. 持续绞杀：连射叠伤，停火回落 */
  HS.Gear.clearHands(p);
  check('装轻机枪', HS.Gear.take(p, 'lmg') === 'new');
  p.weapons[0].up = { sustain: 1 };
  Game.recalc(p);
  Game.run.enemies.length = 0;
  const dummyL = Game.spawnEnemy('walker', false, p.x + 80, p.y);
  dummyL.hp = 999999; dummyL.maxHp = 999999;
  const lmgW = p.weapons[0];
  for (let k = 0; k < 60; k++) {
    p.hp = 99999;
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
  }
  check('持续绞杀会叠层', (lmgW.streak || 0) >= 5, lmgW.streak);
  /* 目标清空 + 卡住射速，专门验"停火一段时间后叠层回落" */
  Game.run.enemies.length = 0;
  lmgW.timer = 999;
  for (let k = 0; k < 50; k++) { p.hp = 99999; Game.update(1 / 60); }
  check('停火后叠层回落', (lmgW.streak || 0) === 0, lmgW.streak);

  /* 6. 碎片战斗部：爆炸会甩出破片 */
  Game.run.bullets.length = 0;
  Game.explode(p.x + 300, p.y + 300, 30, 10, '#ffd166', { shard: 3 });
  check('碎片战斗部炸出一圈破片', Game.run.bullets.length === 3, Game.run.bullets.length + ' 片');

  /* 7. 属性组合型联动：属性到位就成立，不需要特定武器 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = { crit: 2, haste: 2 };
  Game.recalc(p);
  check('暴走联动靠属性组合成立', !!p.syn.critRush, Object.keys(p.syn).join(','));
  p.rateT = 0;
  p.crit = 1;
  Game.run.enemies.length = 0;
  const ez = Game.spawnEnemy('walker', false, p.x + 40, p.y);
  ez.hp = 9999;
  Game.hurtEnemy(ez, 1, {});
  check('暴击打开暴走加速窗口', p.rateT > 0.5, p.rateT.toFixed(2));

  p.passives = { greed: 1, magnet: 1 };
  Game.recalc(p);
  check('拾荒专家提高经验倍率', p.xpMul > 1.1, p.xpMul.toFixed(2));

  /* 8. 空槽加成：副武器空着时，新装备要更容易见到 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = {};
  Game.recalc(p);
  let newCards = 0;
  for (let k = 0; k < 60; k++) {
    for (const c of Game.buildChoices(3)) {
      if (c.kind === 'weaponNew' || c.kind === 'autoNew') newCards++;
    }
  }
  check('空槽时新装备出现率更高', newCards >= 20, newCards + ' / 180');

  /* 9. 重抽：换掉三张卡、扣次数，且按钮真的画出来了 */
  p.reroll = 2;
  Game.openLevelUp();
  const beforeChoices = Game.run.choices.map((c) => c.kind + ':' + c.id).join('|');
  HS.Main.tick(1 / 60);
  check('升级界面画出重抽按钮', Game.hits.some((h) => h.id === 'reroll'), Game.hits.length + ' 个可点区域');
  let changed = false;
  for (let k = 0; k < 8 && !changed; k++) {
    tap('reroll');
    const now = Game.run.choices.map((c) => c.kind + ':' + c.id).join('|');
    if (now !== beforeChoices) changed = true;
  }
  check('重抽会换掉当前三张', changed, Game.run.choices.map((c) => c.name).join('/'));
  check('重抽扣掉次数', Game.run.p.reroll < 2, Game.run.p.reroll);
  check('重抽后仍是三张', Game.run.choices.length === 3, Game.run.choices.length);
  pickAndResolve(0);
  check('重抽后能正常回到局内', Game.state === 'run', Game.state);

  /* 收尾：给回一把武器，后面还要打 Boss */
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'pistol');
  Game.recalc(p);
}

/* ================= 7.8 升级规则 ================= */
section('升级规则');
Game.startRun('highway', 'soldier');
{
  const p = Game.run.p;
  const D = HS.Data;

  /* 1. 背景震动只在局内生效（升级 / 暂停时不抖） */
  check('局内会震屏', HS.Render.shakeAmount({ state: 'run', run: { shake: 9 } }) > 0,
    HS.Render.shakeAmount({ state: 'run', run: { shake: 9 } }).toFixed(1));
  check('升级时背景不震', HS.Render.shakeAmount({ state: 'levelup', run: { shake: 9 } }) === 0);
  check('暂停时背景不震', HS.Render.shakeAmount({ state: 'paused', run: { shake: 9 } }) === 0);

  /* 2. 初始武器阶段：升级池可以给主武器 */
  check('开局主武器未锁定', p.mainLocked === false, String(p.mainLocked));
  let mainCards = 0;
  for (let k = 0; k < 40; k++) {
    for (const c of Game.buildChoices(3)) {
      const d = D.gear[c.id];
      if (c.kind === 'weaponNew' && d && (d.slot === 'main' || d.slot === 'heavy')) mainCards++;
    }
  }
  check('初始阶段升级池能给出主武器', mainCards > 0, mainCards + ' 张');

  /* 3. 换过一次之后：升级池不再给主武器 */
  p.mainLocked = true;
  let lockedMain = 0;
  const curMain = HS.Gear.mainEntry(p);
  for (let k = 0; k < 40; k++) {
    for (const c of Game.buildChoices(3)) {
      const d = D.gear[c.id];
      if (c.kind !== 'weaponNew' || !d) continue;
      if (d.slot !== 'main' && d.slot !== 'heavy') continue;
      if (curMain && curMain.id === c.id) continue;
      lockedMain++;
    }
  }
  /* 换过一次之后仍然会出主武器卡：换掉要清零等级，卡面会写清楚，
     这是个要掂量的选择 —— 彻底封掉的话，一件枪只要开局那段没抽到就永远见不着了 */
  check('锁定后仍能刷到主武器卡', lockedMain > 0, lockedMain + ' 张');
  check('换过之后换装卡明显变少（整档减半）', lockedMain < mainCards * 0.85,
    lockedMain + ' vs ' + mainCards);

  /* 保底：每轮三选一里至少有一张"不动手里武器"的卡（属性 / 分支 / 联动 / 等级），
     否则三张全是换装，玩家只能挑一把不想换的枪，还得把等级清零 */
  let allCommit = 0, noSafe = 0;
  for (let k = 0; k < 120; k++) {
    const ch = Game.buildChoices(3);
    let commit = 0, safe = 0;
    for (const c of ch) {
      if (c.kind === 'weaponNew' || c.kind === 'autoNew') commit++;
      else safe++;
    }
    if (commit === ch.length) allCommit++;
    if (!safe) noSafe++;
  }
  check('三选一不会三张全是换装', allCommit === 0, allCommit + ' / 120');

  /* 4. 锁定后搜刮仍能翻出主武器（低概率） */
  let lootMain = 0;
  for (let k = 0; k < 240; k++) {
    const cards = Game.lootCards();
    const c = cards[0];
    const d = c && D.gear[c.id];
    if (c && c.kind === 'weaponNew' && d && d.slot === 'main') lootMain++;
  }
  check('锁定后搜刮仍能翻出主武器', lootMain > 0, lootMain + ' / 240');

  /* 4.5 搜刮清单本身不会静默换掉手持武器（换装只能靠升级卡 + 确认框） */
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'pistol');
  HS.Gear.take(p, 'frag');
  Game.recalc(p);
  let silentSwap = 0;
  for (let k = 0; k < 120; k++) {
    const c = Game.buildChoices(1, true)[0];
    const d = c && D.gear[c.id];
    if (!c || c.kind !== 'weaponNew' || !d) continue;
    if (d.slot === 'sub' || d.slot === 'main' || d.slot === 'heavy') silentSwap++;
  }
  check('搜刮清单不会静默换手持武器', silentSwap === 0, silentSwap + ' 张');

  /* 4.6 搜刮翻到的主武器要玩家点头：拒绝不换、同意才换并锁定 */
  HS.Gear.clearHands(p);
  p.mainLocked = false;
  HS.Gear.take(p, 'pistol');
  p.weapons[0].lvl = 3;
  Game.recalc(p);
  Game.giveLoot(Game.makeCard({ kind: 'weaponNew', id: 'smg' }), '搜刮');
  check('翻到主武器会停下来问', Game.state === 'lootask' && !!Game.lootAsk, Game.state);
  HS.Main.tick(1 / 60);
  check('询问框有「换上 / 不要」两个按钮',
    Game.hits.some((h) => h.id === 'loot:yes') && Game.hits.some((h) => h.id === 'loot:no'),
    Game.hits.map((h) => h.id).join(','));
  Game.answerLoot(false);
  check('拒绝后主武器不变', HS.Gear.mainEntry(p).id === 'pistol' && p.mainLocked === false,
    HS.Gear.mainEntry(p).id + ' / locked=' + p.mainLocked);
  Game.giveLoot(Game.makeCard({ kind: 'weaponNew', id: 'smg' }), '搜刮');
  Game.answerLoot(true);
  check('同意后换上并锁定', HS.Gear.mainEntry(p).id === 'smg' && p.mainLocked === true,
    HS.Gear.mainEntry(p).id + ' / locked=' + p.mainLocked);

  /* 普通补给（非主武器）直接生效，不打断战斗 */
  Game.state = 'run';
  const lvlBefore = p.passives.power || 0;
  Game.giveLoot(Game.makeCard({ kind: 'passiveNew', id: 'power' }), '搜刮');
  check('普通补给直接生效', Game.state === 'run' && (p.passives.power || 0) === lvlBefore + 1, Game.state);

  /* 5. 副武器：先弹确认，取消不生效，确认才换 */
  p.mainLocked = false;
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  HS.Gear.take(p, 'pistol');
  HS.Gear.take(p, 'frag');
  Game.recalc(p);
  const subBefore = HS.Gear.subEntry(p).id;

  Game.run.choices = [Game.makeCard({ kind: 'weaponNew', id: 'throwingknife' })];
  Game.run.pending = 1;
  Game.state = 'levelup';
  Game.pickChoice(0);
  check('替换副武器会弹确认框', !!Game.confirm && Game.state === 'levelup',
    Game.confirm ? '确认中' : '没有确认');
  HS.Main.tick(1 / 60);
  check('确认框盖住卡片点击', Game.hits.every((h) => h.id.indexOf('card:') !== 0), Game.hits.map((h) => h.id).join(','));

  Game.confirmSwap(false);
  check('取消后副武器没变', HS.Gear.subEntry(p).id === subBefore, HS.Gear.subEntry(p).id);
  check('取消不消耗本次升级', Game.state === 'levelup' && Game.run.pending === 1, Game.run.pending);

  Game.pickChoice(0);
  Game.confirmSwap(true);
  check('确认后副武器换成新的', HS.Gear.subEntry(p).id === 'throwingknife', HS.Gear.subEntry(p).id);
  check('确认后回到局内', Game.state === 'run' && Game.run.pending === 0, Game.state);

  /* 6. 部署型：有耐久度，被围住掉得更快，用光就报废 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = {};
  HS.Gear.take(p, 'pistol');
  HS.Gear.take(p, 'autoturret');
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.run.devices.length = 0;
  Game.state = 'run';
  p.autos[0].timer = 0;
  Game.update(1 / 60);
  const dev = Game.run.devices.filter((d) => d.kind === 'turret')[0];
  check('部署型落地就有耐久度', !!dev && dev.maxHp > 0 && dev.hp === dev.maxHp,
    dev ? Math.round(dev.maxHp) : 'none');

  if (dev) {
    const hp0 = dev.hp;
    for (let k = 0; k < 60; k++) { p.hp = 99999; Game.update(1 / 60); }
    const idleLoss = hp0 - dev.hp;
    check('空地上只有缓慢老化', idleLoss > 0 && idleLoss < hp0 * 0.4,
      '1 秒掉 ' + Math.round(idleLoss) + ' / ' + Math.round(hp0));

    const hp1 = dev.hp;
    Game.run.enemies.length = 0;
    for (let k = 0; k < 3; k++) {
      const e = Game.spawnEnemy('walker', false, dev.x + 8 + k * 5, dev.y + 3);
      e.hp = 1e6; e.maxHp = 1e6; e.speed = 0;
    }
    for (let k = 0; k < 60; k++) { p.hp = 99999; Game.update(1 / 60); }
    const crowdLoss = hp1 - dev.hp;
    check('被丧尸围住耐久掉得更快', crowdLoss > idleLoss * 1.6,
      '围住 ' + Math.round(crowdLoss) + ' vs 空场 ' + Math.round(idleLoss));

    dev.hp = 0.5;
    for (let k = 0; k < 40; k++) { p.hp = 99999; Game.update(1 / 60); }
    check('耐久耗尽后装置报废', dev.dead === true, String(dev.dead));
  }

  /* 7. 火焰喷口：会喷出火苗、能烧到人，升级后在场装置也跟着变强 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = {};
  HS.Gear.take(p, 'pistol');
  HS.Gear.take(p, 'flamenozzle');
  p.autos[0].timer = 0;
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.run.devices.length = 0;
  Game.run.fx.length = 0;
  Game.state = 'run';
  Game.update(1 / 60);
  const fdev = Game.run.devices.filter((d) => d.kind === 'turret')[0];
  check('火焰喷口能落地', !!fdev, fdev ? 'ok' : 'none');
  if (fdev) {
    const burnTarget = Game.spawnEnemy('walker', false, fdev.x + 20, fdev.y);
    burnTarget.hp = 1e9; burnTarget.maxHp = 1e9; burnTarget.speed = 0;
    Game.run.fx.length = 0;
    for (let f = 0; f < 30; f++) {
      p.hp = 99999;
      burnTarget.x = fdev.x + 20; burnTarget.y = fdev.y;
      Game.update(1 / 60);
    }
    check('火焰喷口会喷出火苗', Game.run.fx.length > 0, Game.run.fx.length + ' 颗');
    check('火焰喷口真的能烧到人', burnTarget.hp < 1e9, Math.round(1e9 - burnTarget.hp));

    const dmgLv1 = fdev.st.dmg;
    p.autos[0].lvl = 5;
    Game.recalc(p);
    Game.update(1 / 60);
    check('升级后已经在场的喷口也变强', fdev.st.dmg > dmgLv1 * 1.2,
      dmgLv1.toFixed(1) + ' → ' + fdev.st.dmg.toFixed(1));
  }

  /* 8. 幸运真的会改抽取权重（以前 p.luck 算出来没人用，是废卡） */
  p.passives = { luck: 5 };
  Game.recalc(p);
  check('幸运属性会算进 p.luck', p.luck > 0, p.luck.toFixed(2));
  const w0 = Game.sourceWeights({ luck: 0 }, false, false);
  const w1 = Game.sourceWeights({ luck: p.luck }, false, false);
  check('幸运拉高联动 / 进化、压低通用属性',
    w1.syn > w0.syn && w1.evo > w0.evo && w1.stat < w0.stat,
    '通用 ' + w0.stat + '→' + w1.stat.toFixed(0) +
    ' · 联动 ' + w0.syn + '→' + w1.syn.toFixed(1) +
    ' · 进化 ' + w0.evo + '→' + w1.evo.toFixed(1));
  p.passives = {};
  Game.recalc(p);

  /* 8. 装备槽位不能被任何一张卡搞成空手 */
  let lostAuto = 0;
  for (const aid of D.autoPool) {
    HS.Gear.clearHands(p);
    p.autos.length = 0;
    HS.Gear.take(p, 'heavymg');
    Game.recalc(p);
    Game.applyChoice(Game.makeCard({ kind: 'autoNew', id: aid }));
    if (!p.weapons.length) lostAuto++;
  }
  check('拿自动装备不会卸掉手里的武器', lostAuto === 0, lostAuto + ' 次空手');

  let lostGun = 0;
  const allHand = D.weaponPool.concat(D.subPool, D.heavyPool);
  for (const wid of allHand) {
    HS.Gear.clearHands(p);
    p.autos.length = 0;
    HS.Gear.take(p, 'heavymg');
    Game.recalc(p);
    Game.applyChoice(Game.makeCard({ kind: 'weaponNew', id: wid }));
    if (!p.weapons.length) lostGun++;
  }
  check('任何手持装备卡都不会让人空手', lostGun === 0, lostGun + ' 次 / ' + allHand.length + ' 张');

  /* 9. 手持重武器时，升级池不再给副武器卡；就算给了也不能吞掉重武器 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.mainLocked = false;
  HS.Gear.take(p, 'giantsaber');
  Game.recalc(p);
  let subCards = 0;
  for (let k = 0; k < 60; k++) {
    for (const c of Game.buildChoices(3)) {
      const d = D.gear[c.id];
      if (c.kind === 'weaponNew' && d && d.slot === 'sub') subCards++;
    }
  }
  check('持重武器时不再给副武器卡', subCards === 0, subCards + ' 张');
  Game.applyChoice(Game.makeCard({ kind: 'weaponNew', id: 'shuriken' }));
  check('副武器卡不会吞掉重武器',
    !!(HS.Gear.heavyEntry(p) && HS.Gear.heavyEntry(p).id === 'giantsaber'),
    p.weapons.map((w) => w.id).join(',') || '空手');

  /* 10. 剑刃风暴的剑气：一道向外扩张的月牙（kind:'wave'），
     而不是一条像激光的细直线，也不是原地不动的大刀光 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = {};
  p.weapons.push({ id: 'giantsaber_x', lvl: 1, timer: 0, up: {}, slot: 'heavy', evolved: true });
  Game.recalc(p);
  Game.state = 'run';
  Game.run.enemies.length = 0;
  Game.run.fx.length = 0;
  Game.run.chains.length = 0;
  const gsDummy = Game.spawnEnemy('walker', false, p.x + 50, p.y);
  gsDummy.hp = 1e9; gsDummy.maxHp = 1e9; gsDummy.speed = 0;
  let bigWave = 0, thinLine = 0;
  for (let f = 0; f < 40; f++) {
    p.hp = 99999;
    gsDummy.x = p.x + 50; gsDummy.y = p.y;
    Game.update(1 / 60);
    for (const ef of Game.run.fx) if (ef.kind === 'wave' && ef.r1 > 80) bigWave++;
    for (const ch of Game.run.chains) if (ch.straight) thinLine++;
  }
  check('剑气是向外扩张的月牙', bigWave > 0, '月牙帧 ' + bigWave);
  check('剑气不再画成细直线', thinLine === 0, thinLine + ' 条直线帧');

  /* ---- 红莲切割者：持续输出、但不吃射速 ---- */
  const tickTest = (id, hasteLv, frames) => {
    p.passives = {};
    p.passives.haste = hasteLv;
    HS.Gear.clearHands(p);
    HS.Gear.take(p, id);
    Game.recalc(p);
    Game.run.enemies.length = 0;
    Game.run.chains.length = 0;
    const t1 = Game.spawnEnemy('brute', false, p.x + 100, p.y);
    t1.hp = 1e9; t1.maxHp = 1e9; t1.speed = 0; t1.armor = 0;
    const n0 = p._beamN || 0;
    let chains = 0;
    for (let f = 0; f < frames; f++) {
      p.hp = 99999;
      t1.x = p.x + 100; t1.y = p.y;
      Game.run.chains.length = 0;
      Game.update(1 / 60);
      chains += Game.run.chains.length;
    }
    return { ticks: (p._beamN || 0) - n0, chains: chains, hpLost: 1e9 - t1.hp };
  };

  const red0 = tickTest('redlaser', 0, 120);
  const red5 = tickTest('redlaser', 5, 120);
  check('红莲切割者会持续输出', red0.ticks >= 20 && red0.hpLost > 0,
    red0.ticks + ' 跳 / 2s，伤害 ' + Math.round(red0.hpLost));
  check('红莲切割者不吃射速加成', Math.abs(red5.ticks - red0.ticks) <= 2,
    red0.ticks + ' → ' + red5.ticks + ' 跳');

  /* 其他光束仍然吃射速（回归保护） */
  const las0 = tickTest('laser', 0, 180);
  const las5 = tickTest('laser', 5, 180);
  check('激光步枪仍然吃射速加成', las5.chains > las0.chains,
    las0.chains + ' → ' + las5.chains + ' 道光束 / 3s');

  /* ---- 光剑无人环：长刃线段判定 + 满级六刃 ---- */
  p.passives = {};
  HS.Gear.clearHands(p);          // 手上不留武器，确保伤害只来自光剑
  p.autos.length = 0;
  HS.Gear.take(p, 'saberring');
  for (let l = 1; l < 5; l++) HS.Gear.take(p, 'saberring');
  Game.recalc(p);
  const sw = p.autos.find(a => a.id === 'saberring');
  const sst = HS.Gear.stat(sw, p);
  check('光剑满级是 6 把长刃', (sst.count | 0) === 6 && sst.blade >= 20,
    sst.count + ' 把 / 刃长 ' + sst.blade);

  /* 敌人站在环外、但在刃长范围内：点判定够不着，线段判定应该切得到。
     先把地面火池清掉 —— 前面测燃烧瓶留下的池子会把伤害算进来，污染统计 */
  Game.run.enemies.length = 0;
  Game.run.pools.length = 0;
  Game.run.devices.length = 0;   // 前面测火焰喷口留下的装置会继续烧这块地
  const sabT = Game.spawnEnemy('brute', false, p.x + 58, p.y);
  sabT.hp = 1e9; sabT.maxHp = 1e9; sabT.speed = 0; sabT.armor = 0;
  let hits = 0, lastHp = sabT.hp;
  for (let f = 0; f < 120; f++) {
    p.hp = 99999;
    sabT.x = p.x + 58; sabT.y = p.y;
    Game.update(1 / 60);
    if (sabT.hp < lastHp) {
      hits++;
      lastHp = sabT.hp;
    }
  }
  check('光剑刃身能切到环外的敌人', sabT.hp < 1e9,
    '2 秒 ' + hits + ' 次命中，单次 ' + Math.round(sst.dmg) + ' 伤害');
  p.autos.length = 0;

  /* ---- 环绕类：通用属性要能折叠到"轨道 / 环体 / 转速 / 刃长"上 ---- */
  const orbitStat = (passives, extraLv) => {
    p.passives = passives || {};
    p.autos.length = 0;
    HS.Gear.take(p, 'saberring');
    Game.recalc(p);
    const a = p.autos[0];
    if (extraLv) {
      a.up = { extra: extraLv };
      p.statVer = (p.statVer || 0) + 1;
      Game.recalc(p);
    }
    return HS.Gear.stat(a, p);
  };
  const o0 = orbitStat();
  const oRange = orbitStat({ range: 4 });
  const oProj = orbitStat({ projCount: 2 });
  const oHaste = orbitStat({ haste: 5 });
  const oSplit = orbitStat({ split: 2 });
  const oExtra = orbitStat({}, 2);
  check('环绕类吃「攻击范围」：轨道变大', oRange.radius > o0.radius * 1.1,
    Math.round(o0.radius) + ' → ' + Math.round(oRange.radius));
  check('环绕类吃「弹丸数量」：多一个环体', oProj.count === o0.count + 2,
    o0.count + ' → ' + oProj.count);
  check('环绕类吃「攻速」：转速提升', oHaste.spin > o0.spin * 1.15,
    o0.spin.toFixed(2) + ' → ' + oHaste.spin.toFixed(2));
  check('环绕类吃「分裂」：命中会连锁', (oSplit.chains || 0) >= 2, 'chains=' + oSplit.chains);
  check('「增设环体」分支生效', oExtra.count === o0.count + 2, o0.count + ' → ' + oExtra.count);
  check('每个环绕体都有满级终形态',
    ['orbitblade', 'saberring', 'railorb', 'reflectshield', 'gravitysat']
      .every(id => !!(HS.Data.gear[id].full)), '5/5');
  p.autos.length = 0;

  /* ---- 火焰类：多道火舌 / 火舌溅射 ---- */
  {
    p.passives = {};
    HS.Gear.clearHands(p);
    p.autos.length = 0;
    p.autos.length = 0;
    Game.run.enemies.length = 0;
    Game.run.pools.length = 0;
    Game.run.devices.length = 0;
    const mk = (ang, dist) => {
      const ez = Game.spawnEnemy('brute', false, p.x + Math.cos(ang) * dist, p.y + Math.sin(ang) * dist);
      ez.hp = 1e9; ez.maxHp = 1e9; ez.speed = 0; ez.armor = 0;
      return ez;
    };
    /* 窄扇面 + 3 道火舌：两道偏出中心的敌人应该都吃到 */
    const fL = mk(-0.34, 50), fR = mk(0.34, 50);
    HS.Gear.flame(p, 0, { dmg: 10, range: 90, arc: 0.2, dur: 2, count: 3 }, {}, true, 1);
    check('火焰吃「弹丸数量」：多道火舌覆盖更宽', fL.hp < 1e9 && fR.hp < 1e9,
      '左 ' + Math.round(1e9 - fL.hp) + ' / 右 ' + Math.round(1e9 - fR.hp) + ' 伤害');

    /* 扇面收窄到 1 道时，两侧应该打不到 —— 反证上一条不是别的原因 */
    Game.run.enemies.length = 0;
    const nL = mk(-0.34, 50), nR = mk(0.34, 50);
    HS.Gear.flame(p, 0, { dmg: 10, range: 90, arc: 0.2, dur: 2, count: 1 }, {}, true, 1);
    check('单道火舌打不到扇面外', nL.hp === 1e9 && nR.hp === 1e9, '两侧都未命中');

    /* 火舌溅射：命中 A 时把火星甩给旁边的 B */
    Game.run.enemies.length = 0;
    const sA = mk(0, 40), sB = mk(0, 62);
    HS.Gear.flame(p, 0, { dmg: 10, range: 90, arc: 0.3, dur: 2, count: 1, chains: 1 }, {}, true, 1);
    check('火焰吃「分裂」：命中会溅到旁边', sB.hp < 1e9 || (sB.burn || 0) > 0,
      'B 掉血 ' + Math.round(1e9 - sB.hp) + ' / burn=' + (sB.burn || 0).toFixed(1));
    Game.run.enemies.length = 0;
  }

  /* ---- 光束类：折射（分裂 / 弹射的落点） ---- */
  {
    p.passives = {};
    HS.Gear.clearHands(p);
    p.autos.length = 0;
    Game.run.enemies.length = 0;
    Game.run.pools.length = 0;
    Game.run.devices.length = 0;
    const beamTgt = (x, y) => {
      const ez = Game.spawnEnemy('brute', false, p.x + x, p.y + y);
      ez.hp = 1e9; ez.maxHp = 1e9; ez.speed = 0; ez.armor = 0;
      return ez;
    };
    const bA = beamTgt(100, 0), bB = beamTgt(100, 26);
    HS.Gear.beam(p, 0, { dmg: 10, range: 200, pierce: 0, count: 1, chains: 1, width: 5 },
      { color: '#8ecae6', fam: 'energy' }, false, 1);
    check('光束吃「分裂」：命中会折射到旁边', bB.hp < 1e9,
      'B 掉血 ' + Math.round(1e9 - bB.hp));
    bB.hp = 1e9;
    HS.Gear.beam(p, 0, { dmg: 10, range: 200, pierce: 0, count: 1, chains: 0, width: 5 },
      { color: '#8ecae6', fam: 'energy' }, false, 1);
    check('没有分裂时不会误伤旁边', bB.hp === 1e9, 'B 未命中');
    Game.run.enemies.length = 0;
  }

  /* ---- 烟雾发射器：反远程，不是又一个减速 ---- */
  {
    p.passives = {};
    HS.Gear.clearHands(p);
    p.autos.length = 0;
    HS.Gear.take(p, 'pistol');
    Game.recalc(p);
    Game.run.enemies.length = 0;
    Game.run.ebullets.length = 0;
    Game.run.pools.length = 0;

    /* 落点在脚下：它是自保道具，不该丢到最近的敌人身上 */
    p.throws.length = 0;
    const farTgt = Game.spawnEnemy('walker', false, p.x + 150, p.y);
    farTgt.hp = 1e9; farTgt.maxHp = 1e9; farTgt.speed = 0;
    HS.Gear.throwAt(p, { range: 200, radius: 50, dmg: 4, slow: 0.22, dur: 6, count: 1 },
      HS.Data.gear.smoke, 1);
    const th = p.throws[p.throws.length - 1];
    check('烟雾落在自己脚下而不是敌人身上', th && Math.hypot(th.tx - p.x, th.ty - p.y) < 30,
      '落点距玩家 ' + Math.round(th ? Math.hypot(th.tx - p.x, th.ty - p.y) : -1) + 'px');
    p.throws.length = 0;

    /* 烟幕里的远程弹道会被吃掉，外面的不受影响 */
    Game.run.pools.length = 0;
    Game.run.pools.push({ x: p.x + 20, y: p.y, r: 50, life: 6, max: 6, dps: 0,
      slow: 0.22, tick: 0, dead: false, smoke: 1 });
    check('烟幕范围判定正确',
      Game.inSmoke(p.x + 20, p.y) === true && Game.inSmoke(p.x + 200, p.y) === false, '内真外假');
    Game.run.ebullets.length = 0;
    Game.run.ebullets.push({ x: p.x + 20, y: p.y, vx: 0, vy: 0, life: 1, dmg: 6, r: 2.5, kind: 'gun', rot: 0, dead: false });
    Game.run.ebullets.push({ x: p.x + 200, y: p.y, vx: 0, vy: 0, life: 1, dmg: 6, r: 2.5, kind: 'gun', rot: 0, dead: false });
    Game.updateEnemyBullets(1 / 60);
    check('烟幕吃掉穿过的子弹，外面的照飞', Game.run.ebullets.length === 1,
      '剩 ' + Game.run.ebullets.length + ' 颗');

    /* 烟里的持枪匪徒开不了火；把烟撤掉就会开火（反证） */
    Game.run.enemies.length = 0;
    const gunner = Game.spawnEnemy('terrorist', false, p.x + 30, p.y);
    gunner.hp = 1e9; gunner.maxHp = 1e9; gunner.shootCd = 0;
    let shotsIn = 0;
    for (let f = 0; f < 90; f++) {
      p.hp = 99999; gunner.x = p.x + 30; gunner.y = p.y;
      Game.run.ebullets.length = 0;
      Game.update(1 / 60);
      shotsIn += Game.run.ebullets.length;
    }
    Game.run.pools.length = 0;
    let shotsOut = 0;
    for (let f = 0; f < 90; f++) {
      p.hp = 99999; gunner.x = p.x + 30; gunner.y = p.y;
      Game.run.ebullets.length = 0;
      Game.update(1 / 60);
      shotsOut += Game.run.ebullets.length;
    }
    check('烟里的远程敌人被压制', shotsIn === 0, '烟内开枪 ' + shotsIn + ' 发');
    check('烟散掉后远程恢复射击（反证）', shotsOut > 0, '烟外开枪 ' + shotsOut + ' 发');
    Game.run.enemies.length = 0;
    Game.run.pools.length = 0;
  }

  /* ---- 拾取圈 / 光束数量 ---- */
  p.passives = {};
  p.passives.magnet = 4;
  Game.recalc(p);
  check('拾取范围随属性变大（脚下的圈读的就是这个值）', Math.round(p.magnet) === 86, Math.round(p.magnet));

  /* 弹丸数量：energy 的 st.count 早就加了 p.projCount，光束要真的按 count 射 */
  p.passives.projCount = 2;
  Game.recalc(p);
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'laser');
  Game.recalc(p);
  const lw = p.weapons.find(w => w.id === 'laser');
  let lst = HS.Gear.stat(lw, p);
  check('弹丸数量会变成多道光束', (lst.count | 0) === 3, 'count=' + lst.count);

  Game.run.enemies.length = 0;
  const lt = Game.spawnEnemy('walker', false, p.x + 110, p.y);
  lt.hp = 1e9; lt.maxHp = 1e9; lt.speed = 0;
  let maxChains = 0;
  for (let f = 0; f < 30; f++) {
    p.hp = 99999;
    lt.x = p.x + 110; lt.y = p.y;
    Game.run.chains.length = 0;
    Game.update(1 / 60);
    maxChains = Math.max(maxChains, Game.run.chains.length);
  }
  check('多道光束会画出多条光束', maxChains >= 3, maxChains + ' 道/帧');

  /* 「多重光栅」分支：+1 道/级 */
  p.passives.projCount = 0;
  Game.recalc(p);
  lw.up = { multi: 2 };
  p.statVer = (p.statVer || 0) + 1;
  Game.recalc(p);
  lst = HS.Gear.stat(lw, p);
  check('多重光栅会加光束', (lst.count | 0) === 3, 'count=' + lst.count);
  check('加宽光栅可以点到 3 级', (HS.Data.gearUps.laser.wide.maxLvl || 0) === 3,
    'wide Lv' + HS.Data.gearUps.laser.wide.maxLvl);

  /* 收尾：给回一把武器 */
  Game.run.enemies.length = 0;
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'pistol');
  Game.recalc(p);
}

/* ================= 7.9 全部装备都能打出伤害 ================= */
section('全部装备伤害');
Game.startRun('highway', 'soldier');
{
  const p = Game.run.p;
  const D = HS.Data;
  /* 这些本来就没有伤害：治疗 / 增益 / 诱饵 */
  const NO_DMG = { syringe: 1, autoloader: 1, decoy: 1, decoyspeaker: 1, automed: 1, amplifier: 1 };
  const _gain = Game.gainXp;
  Game.gainXp = function () {};        // 别让测试里升级打断输出

  const trial = (id) => {
    HS.Gear.clearHands(p);
    p.autos.length = 0;
    p.passives = {};
    Game.run.enemies.length = 0;
    Game.run.bullets.length = 0;
    Game.run.devices.length = 0;
    Game.run.pools.length = 0;
    Game.run.chains.length = 0;
    Game.run.drops.length = 0;
    Game.run.fx.length = 0;
    p._flameHit = 0;

    const def = D.gear[id];
    if (def.slot === 'auto') p.autos.push({ id: id, lvl: 1, timer: 0, up: {}, ang: 0, uid: 501 });
    else HS.Gear.take(p, id);
    Game.recalc(p);
    Game.state = 'run';
    Game.confirm = null;
    Game.lootAsk = null;

    /* 贴身一圈 + 正前方一排：近战、锥形、地雷、炮击都能覆盖到 */
    const spots = [];
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      spots.push({ x: p.x + Math.cos(a) * 17, y: p.y + Math.sin(a) * 17 });
    }
    [42, 66, 90, 116].forEach((d) => spots.push({ x: p.x + d, y: p.y }));
    const es = spots.map((pos) => {
      const e = Game.spawnEnemy('walker', false, pos.x, pos.y);
      e.hp = 1e9; e.maxHp = 1e9; e.speed = 0; e.r = 6;
      return e;
    });

    let total = 0;
    for (let f = 0; f < 240; f++) {
      p.hp = 99999;
      for (let i = 0; i < es.length; i++) {
        const e = es[i];
        if (e.dead) e.dead = false;
        e.x = spots[i].x; e.y = spots[i].y;   // 顶住击退，保证一直在火线里
      }
      const before = es.map((e) => e.hp);
      Game.update(1 / 60);
      if (Game.state !== 'run') Game.state = 'run';
      for (let i = 0; i < es.length; i++) {
        const dmg = before[i] - es[i].hp;
        if (dmg > 0) total += dmg;
        if (es[i].hp < 0) es[i].hp = 1e9;
      }
    }
    return total;
  };

  const ids = Object.keys(D.gear).filter((id) => !D.gear[id].evo);
  const dead = [];
  for (const id of ids) {
    const t = Math.round(trial(id));
    if (!NO_DMG[id] && t <= 0) dead.push(id + '(' + D.gear[id].name + '/' + D.gear[id].mech + ')');
    if (NO_DMG[id] && t > 0) dead.push(id + ' 不该有伤害却有 ' + t);
  }
  Game.gainXp = _gain;
  check('全部基础装备都能打出伤害', dead.length === 0, dead.length ? dead.join(' , ') : ids.length + ' 件');

  /* 进化形态同样要能打（只抽查全部） */
  const evoBad = [];
  for (const id of Object.keys(D.gear).filter((i) => D.gear[i].evo)) {
    const t = trial(id);
    if (t <= 0) evoBad.push(id + '(' + D.gear[id].name + ')');
  }
  check('全部进化形态都能打出伤害', evoBad.length === 0, evoBad.length ? evoBad.join(' , ') : '全部通过');

  /* 火焰喷射器专项：伤害 + 有枪口焰 + 有粒子 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = {};
  Game.run.enemies.length = 0;
  Game.run.fx.length = 0;
  HS.Gear.take(p, 'flamer');
  Game.recalc(p);
  Game.state = 'run';
  p.hp = 99999;
  const tgt = Game.spawnEnemy('walker', false, p.x + 40, p.y);
  tgt.hp = 1e9; tgt.maxHp = 1e9; tgt.speed = 0;
  let sawFireT = 0;
  for (let f = 0; f < 30; f++) {
    p.hp = 99999;
    tgt.x = p.x + 40; tgt.y = p.y;
    Game.update(1 / 60);
    sawFireT = Math.max(sawFireT, p.fireT || 0);
  }
  check('火焰喷射器有伤害', tgt.hp < 1e9, Math.round(1e9 - tgt.hp));
  check('火焰喷射器有枪口焰', sawFireT > 0, sawFireT.toFixed(2));
  check('火焰喷射器有火舌粒子', Game.run.fx.length > 0, Game.run.fx.length + ' 颗');

  /* 液氮喷枪：挂减速 + 冻结标记；对已冻结目标伤害更高（1.6 倍是它的身份） */
  p.passives = {};      /* 别把上一段测的低温专精带进来 */
  HS.Gear.clearHands(p);
  Game.recalc(p);
  HS.Gear.take(p, 'cryo');
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.run.fx.length = 0;
  const iceA = Game.spawnEnemy('walker', false, p.x + 36, p.y);
  iceA.hp = 1e9; iceA.maxHp = 1e9; iceA.speed = 0;
  for (let f = 0; f < 30; f++) {
    p.hp = 99999;
    iceA.x = p.x + 36; iceA.y = p.y;
    Game.update(1 / 60);
  }
  const froze = (iceA.slow || 0) > 0.3 && iceA.synFrozen === 1;
  /* 干目标 vs 已冻目标：直接调一次 Gear.flame，避开武器开火节奏的干扰 */
  Game.run.enemies.length = 0;
  const dryT = Game.spawnEnemy('walker', false, p.x + 36, p.y);
  const frzT = Game.spawnEnemy('walker', false, p.x + 36, p.y - 6);
  dryT.hp = 1e9; dryT.maxHp = 1e9; dryT.slow = 0;
  frzT.hp = 1e9; frzT.maxHp = 1e9; frzT.slow = 0.6; frzT.slowT = 5;
  /* 关掉暴击再比：暴击 1.6 倍会和"冻结 1.6 倍"撞在一起，两边都变 16 就测不出来 */
  const critSave = p.crit;
  p.crit = 0;
  HS.Gear.flame(p, 0, { dmg: 10, range: 88, arc: 0.44, dur: 1.4, slow: 0.45, elem: 'ice' },
    { napalm: 0 }, true, 1);
  p.crit = critSave;
  const dmgDry = 1e9 - dryT.hp, dmgFrz = 1e9 - frzT.hp;
  check('液氮喷枪会冻住目标', froze, (iceA.slow || 0).toFixed(2));
  check('液氮喷枪对已冻结目标伤害更高', dmgFrz > dmgDry * 1.3,
    Math.round(dmgDry) + ' → ' + Math.round(dmgFrz));

  /* 榴弹发射器：管式发射，不能复用"抬手扔手雷"的动作 */
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'gl');
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.spawnEnemy('walker', false, p.x + 70, p.y);
  p.throws.length = 0;
  Game.run.bullets.length = 0;
  p.recoil = 0;
  const glEnt = HS.Gear.mainEntry(p);
  HS.Gear.fire(glEnt, D.gear[glEnt.id], HS.Gear.stat(glEnt, p), false);
  check('榴弹发射器不做投掷动作', p.throws.length === 0, p.throws.length + ' 次抬手');
  check('榴弹发射器从枪口打出炮弹', Game.run.bullets.length > 0, Game.run.bullets.length + ' 发');
  check('榴弹发射器有后坐与枪口焰', p.recoil > 0.5 && p.fireT > 0,
    'recoil=' + (p.recoil || 0).toFixed(2) + ' fireT=' + (p.fireT || 0).toFixed(2));

  /* 手雷仍然是手投：动作不能被一起改掉 */
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'frag');
  Game.recalc(p);
  p.throws.length = 0;
  Game.run.bullets.length = 0;
  const frEnt = p.weapons[0];
  HS.Gear.fire(frEnt, D.gear[frEnt.id], HS.Gear.stat(frEnt, p), false);
  check('手雷仍然走投掷动作', p.throws.length > 0, p.throws.length + ' 次抬手');

  /* 鱼叉枪：命中要把敌人真的拽近（距离越远拽得越多），并留锁链 + 踉跄 */
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'harpoon');
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.run.chains.length = 0;
  const harT = Game.spawnEnemy('walker', false, p.x + 170, p.y);
  harT.hp = harT.maxHp = 1e9;
  harT.speed = 0;
  const harEntry = HS.Gear.mainEntry(p);
  const harDef = D.gear[harEntry.id];
  const harSt = HS.Gear.stat(harEntry, p);
  const harD0 = Math.hypot(harT.x - p.x, harT.y - p.y);
  HS.Gear.fire(harEntry, harDef, harSt, true);
  for (let f = 0; f < 60 && Game.run.bullets.length; f++) Game.updateBullets(1 / 60);
  const harD1 = Math.hypot(harT.x - p.x, harT.y - p.y);
  check('鱼叉会把敌人拽近', harD1 < harD0 - 40,
    Math.round(harD0) + ' → ' + Math.round(harD1));
  check('拖拽会甩出锁链', Game.run.chains.length > 0, Game.run.chains.length + ' 条');
  check('被拽的敌人有踉跄', harT.stun > 0, (harT.stun || 0).toFixed(2) + 's');
  harT.dead = true;

  /* 链锁钩爪（副武器）：描述是"把远处的拽到面前"，要拽进近战距离 */
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'pistol');
  HS.Gear.take(p, 'grapnel');
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.run.chains.length = 0;
  const grT = Game.spawnEnemy('walker', false, p.x + 150, p.y);
  grT.hp = grT.maxHp = 1e9;
  grT.speed = 0;
  const grEnt = HS.Gear.subEntry(p);
  const grD0 = Math.hypot(grT.x - p.x, grT.y - p.y);
  HS.Gear.fire(grEnt, D.gear[grEnt.id], HS.Gear.stat(grEnt, p), false);
  for (let f = 0; f < 90 && Game.run.bullets.length; f++) Game.updateBullets(1 / 60);
  const grD1 = Math.hypot(grT.x - p.x, grT.y - p.y);
  check('钩爪把敌人拽到近战距离', grD1 < 45 && grD1 < grD0 - 80,
    Math.round(grD0) + ' → ' + Math.round(grD1));
  check('钩爪拖拽也甩锁链', Game.run.chains.length > 0, Game.run.chains.length + ' 条');
  grT.dead = true;

  /* 电磁轨道球：贴脸的敌人要能吃到"过载放电"，不能只能靠球体接触 */
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.autos.push({ id: 'railorb', lvl: 1, timer: 0, up: {}, ang: 0, uid: 77 });
  HS.Gear.refresh(p);
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.run.chains.length = 0;
  const orbT = Game.spawnEnemy('walker', false, p.x + 18, p.y);
  orbT.hp = orbT.maxHp = 1e9;
  orbT.speed = 0;
  const orbHp0 = orbT.hp;
  let orbChains = 0;
  for (let f = 0; f < 180; f++) {
    p.hp = p.maxHp;
    HS.Auto.update(Game.run, 1 / 60);
    Game.run.t += 1 / 60;
    orbChains += Game.run.chains.length;
    Game.run.chains.length = 0;
    Game.run.fx.length = 0;
  }
  check('电磁轨道球能打到贴脸目标', orbHp0 - orbT.hp > 12,
    '3 秒 ' + Math.round(orbHp0 - orbT.hp) + ' 伤害');
  check('过载放电有电弧表现', orbChains > 0, orbChains + ' 帧有电弧');
  orbT.dead = true;
  p.autos.length = 0;
  HS.Gear.refresh(p);
  Game.recalc(p);

  /* 龙息喷枪：命中要把目标标上 napalm，烧死后炸开并点燃周围 */
  HS.Gear.clearHands(p);
  Game.recalc(p);
  HS.Gear.take(p, 'napalm');
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.run.fx.length = 0;
  const napT = Game.spawnEnemy('walker', false, p.x + 40, p.y);
  napT.hp = 1e9; napT.maxHp = 1e9; napT.speed = 0;
  for (let f = 0; f < 20; f++) {
    p.hp = 99999;
    napT.x = p.x + 40; napT.y = p.y;
    Game.update(1 / 60);
  }
  const naped = napT.burn > 0 && napT.napalm === 1;
  const na = Game.spawnEnemy('walker', false, p.x + 120, p.y);
  const nb = Game.spawnEnemy('walker', false, p.x + 126, p.y);
  na.hp = 5; na.napalm = 1; na.burnDps = 20;
  nb.hp = 1e9; nb.maxHp = 1e9;
  Game.hurtEnemy(na, 999, { silent: true });
  check('龙息喷枪会点燃并标上 napalm', naped, 'burn=' + (napT.burn || 0).toFixed(1));
  check('龙息喷枪烧死的目标会炸开并点燃周围', nb.burn > 0, '邻怪 burn=' + (nb.burn || 0).toFixed(1));

  /* ---- 元素 / 针对型属性 ---- */
  Game.run.enemies.length = 0;
  const bruteA = Game.spawnEnemy('brute', false, p.x + 70, p.y);
  bruteA.hp = 1e9; bruteA.maxHp = 1e9;
  let hpA = bruteA.hp;
  Game.hurtEnemy(bruteA, 100, { silent: true, noCrit: true });
  const dmgPlain = hpA - bruteA.hp;
  hpA = bruteA.hp;
  Game.hurtEnemy(bruteA, 100, { silent: true, noCrit: true, ignoreArmor: 1 });
  const dmgElem = hpA - bruteA.hp;
  check('壮汉有护甲，实弹伤害被削', dmgPlain < 100 && dmgPlain > 60, Math.round(dmgPlain));
  check('火焰 / 持续伤害无视护甲', Math.round(dmgElem) === 100, Math.round(dmgElem));

  /* 破甲：把护甲削掉后同一发伤害回升 */
  p.passives.pierceArmor = 4;
  Game.recalc(p);
  hpA = bruteA.hp;
  Game.hurtEnemy(bruteA, 100, { silent: true, noCrit: true });
  check('破甲能削掉护甲减免', hpA - bruteA.hp > dmgPlain + 6,
    Math.round(dmgPlain) + ' → ' + Math.round(hpA - bruteA.hp));

  /* 处决：血线以下一命中就斩杀（不再给高血量目标加伤） */
  check('处决血线随等级提高', HS.Data.execCut(4) > HS.Data.execCut(1) && HS.Data.execCut(0) === 0,
    HS.Data.execCut(1) * 100 + '% → ' + HS.Data.execCut(4) * 100 + '%');
  p.passives.execute = 4;
  Game.recalc(p);
  const cut = HS.Data.execCut(4);
  const eFull = Game.spawnEnemy('walker', false, p.x + 90, p.y);
  eFull.hp = 100; eFull.maxHp = 100; eFull.armor = 0;
  let hpB = eFull.hp;
  Game.hurtEnemy(eFull, 0.5, { silent: true, noCrit: true });
  check('血线以上的目标不会被执行（也没加伤）', !eFull.dead && Math.abs((hpB - eFull.hp) - 0.5) < 0.01,
    Math.round((hpB - eFull.hp) * 100) / 100);

  const eLow = Game.spawnEnemy('walker', false, p.x + 94, p.y);
  eLow.maxHp = 100; eLow.hp = 100 * cut * 0.8; eLow.armor = 0;
  Game.hurtEnemy(eLow, 0.5, { silent: true, noCrit: true });
  check('血线以下的目标被直接处决', eLow.dead === true, 'hp=' + eLow.hp.toFixed(1));

  Game.run.enemies.length = 0;
  const eBoss = Game.spawnEnemy('boss', false, p.x + 120, p.y);
  eBoss.hp = eBoss.maxHp * 0.05;
  Game.hurtEnemy(eBoss, 0.5, { silent: true, noCrit: true, force: true });
  check('Boss 免疫处决', !eBoss.dead, 'hp=' + Math.round(eBoss.hp));
  eBoss.dead = true;

  /* 燃烧专精 / 低温专精 / 霜火反应 */
  p.passives.burnDmg = 4;
  p.passives.chill = 3;
  Game.recalc(p);
  Game.run.enemies.length = 0;
  const eleT = Game.spawnEnemy('walker', false, p.x + 30, p.y);
  eleT.hp = 1e9; eleT.maxHp = 1e9; eleT.armor = 0;
  HS.Gear.flame(p, 0, { dmg: 10, range: 80, arc: 0.6, dur: 2 }, { napalm: 0 }, true, 1);
  check('燃烧专精乘在燃烧 dot 上', eleT.burnDps > 8.5, 'burnDps=' + (eleT.burnDps || 0).toFixed(1));
  eleT.slow = 0; eleT.slowT = 0;
  HS.Gear.flame(p, 0, { dmg: 4, range: 80, arc: 0.6, dur: 1.4, slow: 0.4, elem: 'ice' }, {}, true, 1);
  check('低温专精加深减速', (eleT.slow || 0) > 0.5, 'slow=' + (eleT.slow || 0).toFixed(2));
  check('低温专精延长冻结', (eleT.slowT || 0) > 1.6, 'slowT=' + (eleT.slowT || 0).toFixed(2));
  p.passives.steam = 3;
  Game.recalc(p);
  eleT.burn = 3; eleT.burnDps = 12; eleT.slow = 0; eleT.slowT = 0;
  Game.run.fx.length = 0;
  HS.Gear.flame(p, 0, { dmg: 4, range: 80, arc: 0.6, dur: 1.4, slow: 0.4, elem: 'ice' }, {}, true, 1);
  const steamBoom = Game.run.fx.some(f => f.kind === 'ring');
  check('霜火反应：冰打燃烧目标会爆', steamBoom && eleT.burn === 0,
    'ring=' + steamBoom + ' burn=' + (eleT.burn || 0));

  /* 元素属性的出卡门槛：手上没有对应元素就不该出现 */
  p.passives = {};
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'pistol');
  Game.recalc(p);
  check('没有元素武器时不出元素属性',
    Game.statOk('chill', p) === false && Game.statOk('burnDmg', p) === false &&
    Game.statOk('steam', p) === false, 'pistol');
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'cryo');
  Game.recalc(p);
  check('拿了液氮才出低温专精', Game.statOk('chill', p) === true && Game.statOk('burnDmg', p) === false,
    'cryo');
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'napalm');
  HS.Gear.take(p, 'cryogrenade');
  Game.recalc(p);
  check('冰火同持才出霜火反应', Game.statOk('steam', p) === true && Game.statOk('chill', p) === true,
    'napalm+cryogrenade');

  /* 收尾：给回一把武器 */
  Game.run.enemies.length = 0;
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'pistol');
  Game.recalc(p);
}

/* ================= 7.10 装备数据自检 ================= */
section('装备数据自检');
Game.startRun('highway', 'soldier');
{
  const D = HS.Data;
  const p = Game.run.p;

  /* 这些是"运行时真的有消费方"的开关。新增 special / flag / effect 时，
     先去 gear.js / combat.js / auto.js 里把消费逻辑写上，再往这里加名字。 */
  const SPECIAL = { sustain: 1, homing: 1, shard: 1, mark: 1, beam: 1, burn: 1, shock: 1, volley: 1 };
  const FLAG = {
    echo: 1, beam: 1, spinup: 1, bounce3: 1, split: 1, burn: 1,
    explode: 1, pull: 1, shock: 1, homing: 1, shard: 1, volley2: 1
  };
  const EFFECT = {
    mines: 1, lure: 1, smoke: 1, artillery: 1, emp: 1,
    poison: 1, fire: 1, ice: 1, gravity: 1, zap: 1
  };
  const MECH = {
    bullet: 1, burst: 1, spread: 1, chain: 1, beam: 1, rail: 1, melee: 1, drill: 1,
    boomerang: 1, lob: 1, missile: 1, flame: 1, heal: 1, buff: 1, none: 1,
    thrust: 1
  };
  const FAMS = { gun: 1, energy: 1, explosive: 1, melee: 1, thrown: 1, support: 1 };
  const MODKEY = {
    dmg: 1, dps: 1, cd: 1, count: 1, pierce: 1, chains: 1, targets: 1, width: 1,
    radius: 1, range: 1, speed: 1, dur: 1, spin: 1, heal: 1, slow: 1, amp: 1, atk: 1,
    spread: 1, knock: 1, stun: 1, pull: 1, arc: 1
  };

  const bad = [];
  for (const id of Object.keys(D.gear)) {
    const d = D.gear[id];
    /* 自动装备走 kind 分派，没有 mech / fam */
    if (d.slot !== 'auto') {
      if (!MECH[d.mech]) bad.push(id + ' 的 mech「' + d.mech + '」没有实现');
      if (!FAMS[d.fam]) bad.push(id + ' 的 fam「' + d.fam + '」没有兼容换算');
    }
    if (d.effect && !EFFECT[d.effect]) bad.push(id + ' 的 effect「' + d.effect + '」没有消费方');
    const ups = D.gearUps[id] || {};
    for (const b in ups) {
      if (ups[b].special && !SPECIAL[ups[b].special]) {
        bad.push(id + '.' + b + ' 的 special「' + ups[b].special + '」没有消费方');
      }
      for (const k in ups[b].mod) {
        if (!MODKEY[k]) bad.push(id + '.' + b + ' 的 mod「' + k + '」不是可用字段');
      }
    }
    if (d.flags) {
      for (const f in d.flags) {
        if (!FLAG[f]) bad.push(id + ' 的 flag「' + f + '」没有消费方');
      }
    }
  }
  check('所有机制 / 开关都接了消费方', bad.length === 0, bad.length ? bad.slice(0, 6).join(' , ') : '无悬空字段');

  /* 每件装备的专属分支必须能真的算出数值（不能全是无效字段） */
  let badUp = 0, upName = '';
  for (const id of Object.keys(D.gearUps)) {
    const ups = D.gearUps[id];
    for (const b in ups) {
      const w1 = { id: id, lvl: 1, up: {}, slot: D.gear[id].slot };
      const w2 = { id: id, lvl: 1, up: {}, slot: D.gear[id].slot };
      w2.up[b] = 1;
      const s1 = HS.Gear.stat(w1, p), s2 = HS.Gear.stat(w2, p);
      if (!s1 || !s2) continue;
      let diff = false;
      for (const k in s2) {
        if (k === 'sp' || k === 'fx') continue;
        if (typeof s2[k] === 'number' && Math.abs(s2[k] - (s1[k] || 0)) > 1e-6) diff = true;
      }
      if (s2.sp && Object.keys(s2.sp).length && !(s1.sp && Object.keys(s1.sp).length)) diff = true;
      if (!diff) { badUp++; upName = id + '.' + b; }
    }
  }
  check('每条专属分支都真的改数值或改机制', badUp === 0, badUp ? upName : '全部有效');

  /* 每件装备 1→5 级必须至少有数值成长 */
  let noGrow = 0, growName = '';
  const growIds = Object.keys(D.gear).filter((id) => !D.gear[id].evo && D.gear[id].maxLvl > 1);
  for (const id of growIds) {
    const a = HS.Gear.stat({ id: id, lvl: 1, up: {} }, p);
    const b = HS.Gear.stat({ id: id, lvl: 5, up: {} }, p);
    if (!a || !b) continue;
    let grew = false;
    for (const k in b) {
      if (typeof b[k] !== 'number') continue;
      if (Math.abs(b[k] - (a[k] || 0)) > 1e-6) grew = true;
    }
    if (!grew) { noGrow++; growName = id; }
  }
  check('每件装备 1→5 级都有成长', noGrow === 0, noGrow ? growName : growIds.length + ' 件');

  /* 火系武器的持续时间字段真的被用上了（「缓燃配方」分支靠它） */
  const f1 = HS.Gear.stat({ id: 'flamer', lvl: 1, up: {} }, p);
  const f2 = HS.Gear.stat({ id: 'flamer', lvl: 1, up: { fuel: 1 } }, p);
  check('「缓燃配方」会延长燃烧时间', f2.dur > f1.dur, f1.dur + ' → ' + f2.dur);

  /* 射速下限是 0.04：一出生就贴底的武器，后面的射速分支会全部白点 */
  const floored = [];
  for (const id of Object.keys(D.gear)) {
    const d0 = D.gear[id];
    if (!(d0.base.cd > 0)) continue;
    const s = HS.Gear.stat({ id: id, lvl: 1, up: {} }, p);
    if (s && s.cd <= 0.0405) floored.push(id + '(' + s.cd.toFixed(3) + ')');
  }
  check('没有武器一出生就撞射速下限', floored.length === 0, floored.join(' , '));
}

/* ================= 7.11 追踪手感 ================= */
section('追踪');
Game.startRun('highway', 'soldier');
{
  const p = Game.run.p;
  Game.state = 'run';
  p.hp = 99999;
  HS.Gear.clearHands(p);
  p.autos.length = 0;
  p.passives = {};
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.run.bullets.length = 0;

  /* 1. 白板子弹不追踪（默认 homing = 0） */
  Game.shoot(p.x, p.y, 0, { dmg: 1, speed: 300, life: 1 });
  check('普通子弹默认不追踪', Game.run.bullets[0].homing === 0, String(Game.run.bullets[0].homing));

  /* 2. 追踪不会掉头去打背后的人 */
  Game.run.bullets.length = 0;
  const behind = Game.spawnEnemy('walker', false, p.x - 70, p.y);
  behind.hp = 1e9; behind.maxHp = 1e9; behind.speed = 0;
  Game.shoot(p.x, p.y, 0, { dmg: 1, speed: 300, life: 1, homing: 1 });
  const hb = Game.run.bullets[0];
  check('追踪不会掉头追背后的目标', Game.homingTarget(hb, 140) === null);

  /* 3. 前方目标会锁定，而且每 0.2 秒只修 0.45rad 以内 */
  Game.run.enemies.length = 0;
  const front = Game.spawnEnemy('walker', false, p.x + 40, p.y - 90);
  front.hp = 1e9; front.maxHp = 1e9; front.speed = 0;
  Game.run.bullets.length = 0;
  Game.shoot(p.x, p.y, 0, { dmg: 1, speed: 300, life: 2, homing: 1 });
  const fb = Game.run.bullets[0];
  check('前方目标会被锁定', Game.homingTarget(fb, 140) === front);
  const a0 = Math.atan2(fb.vy, fb.vx);
  for (let f = 0; f < 12 && !fb.dead; f++) Game.updateBullets(1 / 60);
  const turn = Math.abs(Math.atan2(fb.vy, fb.vx) - a0);
  check('追踪只是缓慢修正（≤0.45rad/0.2s）', turn <= 0.45, turn.toFixed(2) + ' rad');

  /* 4. 火箭仍然咬得死（homing = 2） */
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'rpg');
  Game.recalc(p);
  Game.run.enemies.length = 0;
  Game.run.bullets.length = 0;
  const tgt = Game.spawnEnemy('walker', false, p.x + 60, p.y);
  tgt.hp = 1e9; tgt.maxHp = 1e9; tgt.speed = 0;
  let sawStrong = false;
  for (let f = 0; f < 30; f++) {
    p.hp = 99999;
    Game.update(1 / 60);
    if (Game.run.bullets.some((b) => b.homing === 2)) sawStrong = true;
  }
  check('火箭仍然是强追踪', sawStrong, sawStrong ? 'homing=2' : '没有出现 homing=2 的弹丸');

  Game.run.enemies.length = 0;
  HS.Gear.clearHands(p);
  HS.Gear.take(p, 'pistol');
  Game.recalc(p);
}

/* ================= 7.12 空投位置指引 ================= */
section('空投指引');
Game.startRun('highway', 'soldier');
{
  const p = Game.run.p;
  Game.state = 'run';
  p.hp = 99999;
  Game.run.drops.length = 0;

  const dr = Game.hintDrop({ kind: 'chest', x: p.x + 70, y: p.y, bob: 0, life: 60, dead: false }, 6);
  Game.run.drops.push(dr);
  check('空投箱子带位置指引', dr.hintT === 6 && dr.hintMax === 6, dr.hintT + '/' + dr.hintMax);

  for (let f = 0; f < 60; f++) Game.updatePickups(1 / 60);
  check('指引会随时间衰减', dr.hintT > 0 && dr.hintT < 6, dr.hintT.toFixed(2));

  for (let f = 0; f < 360; f++) Game.updatePickups(1 / 60);
  check('指引用完自动消失', dr.hintT <= 0, dr.hintT.toFixed(2));

  /* 屏幕内 / 屏幕外都要能画（不抛异常、不越界） */
  dr.hintT = 5; dr.hintMax = 6;
  HS.Main.tick(1 / 60);
  dr.x = p.x + 900; dr.y = p.y - 600;
  HS.Main.tick(1 / 60);
  check('指引的屏幕内 / 屏外渲染都正常', true);

  /* 空投事件本身必须挂上指引（随机的，多试几次） */
  let chests = 0, hinted = 0;
  for (let k = 0; k < 40; k++) {
    Game.run.drops.length = 0;
    Game.run.enemies.length = 0;
    Game.runEvent();
    const c = Game.run.drops.filter((d) => d.kind === 'chest')[0];
    if (c) { chests++; if (c.hintT > 0) hinted++; }
  }
  check('空投事件一定带位置指引', chests > 0 && hinted === chests, hinted + ' / ' + chests);

  Game.run.drops.length = 0;
  Game.run.enemies.length = 0;
}

/* ================= 5. 一路打到 Boss ================= */
section('Boss 与胜利');
advance(Math.max(0, 362 - Game.run.t), { god: true });
check('Boss 已刷新', Game.run.bossSpawned === true);
check('Boss 存活', !!Game.run.boss, Game.run.boss ? Math.round(Game.run.boss.hp) : 'null');
check('Boss 血量 > 1000', Game.run.boss && Game.run.boss.maxHp > 1000, Game.run.boss && Math.round(Game.run.boss.maxHp));

if (Game.run.boss) {
  Game.run.boss.hp = 1;
  Game.hurtEnemy(Game.run.boss, 50, { noCrit: true });
}
check('击杀 Boss 后胜利', Game.state === 'result' && Game.run.result && Game.run.result.win === true,
  Game.state + ' win=' + (Game.run.result && Game.run.result.win));
check('结算产出金币', Game.run.result && Game.run.result.gold > 0, Game.run.result && Game.run.result.gold);
check('存档记录通关', HS.Save.data.wins >= 1, HS.Save.data.wins);
check('地图解锁判定', HS.Save.data.unlockedMaps.length >= 2, HS.Save.data.unlockedMaps.join(','));
HS.Main.tick(1 / 60);
check('结算界面渲染无异常', true);

/* ================= 6. 死亡结算 ================= */
section('死亡结算');
const beforeRuns = HS.Save.data.runs;
tap('again');
check('重开进入局内', Game.state === 'run', Game.state);
const p = Game.run.p;
p.hp = 1;
p.invuln = 0;
p.revive = 0;
Game.spawnEnemy('walker', false, p.x + 2, p.y);
advance(3, { still: true, stopOnResult: true });
check('死亡进入结算', Game.state === 'result', Game.state);
check('死亡判负', Game.run.result && Game.run.result.win === false);
check('累计局数增加', HS.Save.data.runs > beforeRuns, HS.Save.data.runs);

/* ================= 7. 局外成长 ================= */
section('局外成长');
HS.Save.data.gold = 5000;
tap('meta');
check('进入研究所', Game.state === 'meta', Game.state);
const goldBefore = HS.Save.data.gold;
tap('perm:hp');
check('购买永久强化', HS.Save.data.perm.hp === 1, HS.Save.data.perm.hp);
check('金币被扣除', HS.Save.data.gold < goldBefore, goldBefore + ' -> ' + HS.Save.data.gold);
tap('tab:up');
HS.Main.tick(1 / 60);
tap('tab:arc');
HS.Main.tick(1 / 60);
tap('tab:char');
HS.Main.tick(1 / 60);
check('研究所三个页签渲染无异常', true);

const medicBefore = HS.Save.data.chars.length;
tap('char:medic');
check('解锁新角色', HS.Save.data.chars.length === medicBefore + 1, HS.Save.data.chars.join(','));
check('选择新角色', Game.selChar === 'medic', Game.selChar);
tap('back');
check('返回标题', Game.state === 'title', Game.state);

/* ================= 8. 夜间公路 / 荒漠公路 ================= */
section('夜间公路');
{
  Game.startRun('night', 'soldier');
  check('夜间地图进入局内', Game.state === 'run' && Game.run.mapId === 'night', Game.run.mapId);
  check('夜间地图标了 night', Game.run.map.night === true && Game.run.map.vision > 0,
    'vision=' + Game.run.map.vision);

  /* 射程：同一个白板武器，夜里必须明显短 */
  const wNight = { id: 'pistol', lvl: 1, up: {}, slot: 'main' };
  const wDay = { id: 'pistol', lvl: 1, up: {}, slot: 'main' };
  const rNight = HS.Gear.stat(wNight, Game.run.p).range;
  Game.startRun('highway', 'soldier');
  const rDay = HS.Gear.stat(wDay, Game.run.p).range;
  check('夜间射程被压缩', rNight < rDay * 0.85,
    Math.round(rDay) + ' -> ' + Math.round(rNight));
  check('白天没有射程惩罚', HS.Game.mapRangeMul() === 1, String(HS.Game.mapRangeMul()));

  /* 夜里不该刷出持枪匪徒 */
  let nightGun = 0;
  for (let i = 0; i < 200; i++) if (Game.pickType(0) === 'terrorist') nightGun++;
  check('夜间不会刷持枪匪徒', nightGun === 0, nightGun + '/200');

  /* 夜视遮罩走一遍渲染管线（有 NaN / 缺画布都会在这里炸） */
  Game.startRun('night', 'soldier');
  HS.Main.tick(1 / 60);
  check('夜间画面渲染无异常', Game.state === 'run');
}

section('荒漠公路');
{
  Game.startRun('desert', 'soldier');
  let dp = Game.run.p;
  check('荒漠地图进入局内', Game.run.mapId === 'desert', Game.run.mapId);

  /* 一条笔直的公路：x=0 处无论走多远都是路面，离开就是荒野 */
  check('公路沿 x=0 笔直延伸',
    HS.World.isRoad(0, 4000) && HS.World.isRoad(0, -9000) && HS.World.isRoad(34, 1234));
  check('远离公路就是荒野',
    !HS.World.isRoad(240, 4000) && !HS.World.isRoad(-300, -1500));

  /* 建筑：稀疏，而且都贴在公路两边 */
  const dbs = [];
  HS.Buildings.buildingsInRect(-2000, -2000, 2000, 2000, dbs);
  Game.startRun('highway', 'soldier');
  const sbs = [];
  HS.Buildings.buildingsInRect(-2000, -2000, 2000, 2000, sbs);
  Game.startRun('desert', 'soldier');
  dp = Game.run.p;
  check('荒漠建筑比街区稀疏得多', dbs.length > 0 && dbs.length < sbs.length * 0.45,
    '荒漠 ' + dbs.length + ' 栋 / 街区 ' + sbs.length + ' 栋');
  let offRoad = 0;
  for (const b of dbs) if (Math.abs(b.x) < 44 + b.w / 2 - 1) offRoad++;
  check('建筑不会盖在公路上', offRoad === 0, offRoad + ' 栋压路');
  check('荒漠有可进入的屋子', dbs.some((b) => !b.ruin && b.doors.length >= 2));

  /* 汽车旅馆：能进、有家具、有搜刮点、搜刮表接上了。
     房子只在公路两侧生成，所以沿着公路扫一段长路去找 */
  const roadBs = [];
  HS.Buildings.buildingsInRect(-260, -8000, 260, 8000, roadBs);
  const hotel = roadBs.filter((b) => b.kind === 'motel' && !b.ruin)[0];
  check('荒漠里能生成汽车旅馆', !!hotel, hotel ? 'ok' : '没有完整的旅馆');
  if (hotel) {
    const lootPts = hotel.furniture.filter((f) => f.lootable).length;
    check('旅馆有门和家具', hotel.doors.length >= 2 && hotel.furniture.length >= 4,
      hotel.doors.length + ' 门 / ' + hotel.furniture.length + ' 家具');
    check('旅馆有搜刮点', lootPts >= 2, lootPts + ' 个');
    check('旅馆搜刮表存在', !!HS.Data.loot[hotel.furniture.filter((f) => f.lootable)[0].lootType],
      hotel.furniture.filter((f) => f.lootable)[0].lootType);
  }

  /* 道具：荒漠分区生成——路肩附近是人造障碍，荒野只有仙人掌。
     告示牌/广告牌的存在性改成查图集帧（刷不刷得进窗口本来就靠运气） */
  const dprops = [];
  HS.World.queryRect(-900, -900, 900, 900, dprops);
  const kinds = {};
  for (const o of dprops) kinds[o.type] = (kinds[o.type] || 0) + 1;
  check('荒漠道具已生成', dprops.length > 0, dprops.length + ' 个');
  check('告示牌 / 广告牌美术已烘焙',
    !!(HS.Sprites.frames.billboard && HS.Sprites.frames.signpost && HS.Sprites.frames.motelsign));
  const MAN_MADE = { sedan: 1, van: 1, barrier: 1, crate: 1, tires: 1, cone: 1,
    billboard: 1, signpost: 1, motelsign: 1 };
  const nearRoad = dprops.filter((o) => Math.abs(o.x) <= 104);
  const wild = dprops.filter((o) => Math.abs(o.x) > 104);
  check('路肩附近有人造障碍', nearRoad.some((o) => MAN_MADE[o.type]),
    nearRoad.map((o) => o.type).join(','));
  check('荒野只有仙人掌', wild.every((o) => o.type === 'cactus'),
    wild.length + ' 株 / ' + [...new Set(wild.map((o) => o.type))].join(','));

  /* 持枪匪徒 */
  check('匪徒精灵已烘焙', !!(HS.Sprites.frames && HS.Sprites.frames.terrorist &&
    HS.Sprites.frames.terrorist_hit && HS.Sprites.frames.terrorist_elite));
  let gunSpawn = 0;
  for (let i = 0; i < 200; i++) if (Game.pickType(0) === 'terrorist') gunSpawn++;
  check('荒漠会刷持枪匪徒', gunSpawn > 10 && gunSpawn < 140, gunSpawn + '/200');

  Game.run.enemies.length = 0;
  Game.run.ebullets.length = 0;
  Game.run.fx.length = 0;
  Game.run.vehicles.length = 0;   // 清掉载具：新车体会挡子弹，这条测的是"匪徒子弹能打中人"
  dp.hp = 99999;
  const gunner = Game.spawnEnemy('terrorist', false, dp.x + 96, dp.y);
  gunner.hp = 1e9; gunner.maxHp = 1e9; gunner.speed = 0; gunner.shootCd = 0;
  let sawBullet = 0, sawFlash = 0, hurt = 0;
  for (let i = 0; i < 120; i++) {
    const hp0 = dp.hp;
    dp.hp = 99999;
    gunner.x = dp.x + 96; gunner.y = dp.y;
    Game.update(1 / 60);
    if (Game.state === 'levelup') pickAndResolve(0);
    if (Game.run.ebullets.some((b) => b.kind === 'gun')) sawBullet++;
    if (Game.run.fx.length > 0) sawFlash++;
    if (dp.hp < 99999) hurt++;
    dp.hp = hp0;
  }
  check('匪徒会朝玩家开枪', sawBullet > 0, sawBullet + ' 帧有子弹');
  check('开枪有枪口焰 / 粒子', sawFlash > 0, sawFlash + ' 帧');
  check('匪徒的子弹真的会打掉血', hurt > 0, hurt + ' 帧受伤');
  check('匪徒子弹飞完会消失', Game.run.ebullets.filter((b) => !b.dead).length < 8,
    Game.run.ebullets.length + ' 颗残留');

  /* 荒漠画面同样要能渲染 */
  HS.Main.tick(1 / 60);
  check('荒漠画面渲染无异常', Game.state === 'run');
  HS.Main.tick(1 / 60);
}

/* ================= 9. 长时间稳定性 ================= */
section('稳定性：3 分钟不间断');
Game.state = 'title';
tap('start');
tap('map:night');
tap('launch');
advance(180, { god: true });
check('长时间运行无崩溃', true, ticks + ' ticks');
check('坐标未发散', Math.abs(Game.run.p.x) < 1e6 && Math.abs(Game.run.p.y) < 1e6);
check('实体数组未失控', Game.run.enemies.length + Game.run.bullets.length + Game.run.gems.length < 800,
  Game.run.enemies.length + '+' + Game.run.bullets.length + '+' + Game.run.gems.length);
check('特效数组收敛', Game.run.fx.length <= 200 && Game.run.texts.length <= 60,
  Game.run.fx.length + '/' + Game.run.texts.length);

/* ================= 9. 暂停 ================= */
section('暂停与恢复');
tap('pause');
check('暂停生效', Game.state === 'paused', Game.state);
advance(1, { still: true });
check('暂停时计时停止', Game.state === 'paused');
tap('resume');
check('恢复游戏', Game.state === 'run', Game.state);

/* ================= 10. 无尽模式 ================= */
section('无尽模式');
Game.endless = true;
Game.startRun('highway', 'soldier');
advance(1, { god: true });
check('无尽标记生效', Game.run.endless === true);
Game.run.nextBossAt = 0;
advance(2, { god: true });
check('无尽模式 Boss 出现', !!Game.run.boss);
if (Game.run.boss) {
  Game.run.boss.hp = 1;
  Game.hurtEnemy(Game.run.boss, 999, { noCrit: true });
}
check('击杀 Boss 后不结算', Game.state === 'run', Game.state);
check('下一只 Boss 已排期', Game.run.nextBossAt > Game.run.t, Game.run.nextBossAt);
check('掉落补给', Game.run.drops.length > 0, Game.run.drops.length);
Game.endless = false;

/* ================= 10.5 结算金币 ================= */
section('结算金币');
{
  /* 金币只从两处来：局内搜刮 + 通关奖励。
     击杀 / 存活 / 精英一律不折算 —— 这两条断言就是防它被"优化"回去 */
  Game.state = 'title';
  Game.startRun('highway', 'soldier');
  const r = Game.run;
  r.kills = 600; r.t = 300; r.eliteKills = 2; r.gold = 60;
  const g0 = HS.Save.data.gold;
  Game.finishRun(false);
  const lost = HS.Save.data.gold - g0;
  check('未通关只结搜刮金币', lost === 60, lost + ' 金（600 杀 / 300 秒都不算钱）');

  /* 通关奖励按难度 30 / 50 / 80，且不吃击杀数 */
  const want = { highway: 30, night: 50, desert: 80, flood: 110 };
  const got = {};
  for (const mid of Object.keys(want)) {
    Game.state = 'title';
    Game.startRun(mid, 'soldier');
    Game.run.kills = 999; Game.run.t = 400; Game.run.eliteKills = 5; Game.run.gold = 0;
    const b = HS.Save.data.gold;
    Game.finishRun(true);
    got[mid] = HS.Save.data.gold - b;
  }
  check('通关奖励按难度 30 / 50 / 80 / 110',
    got.highway === 30 && got.night === 50 && got.desert === 80 && got.flood === 110, JSON.stringify(got));

  Game.state = 'title';
  Game.startRun('highway', 'soldier');
  Game.run.kills = 3000; Game.run.t = 900; Game.run.eliteKills = 40; Game.run.gold = 0;
  const b2 = HS.Save.data.gold;
  Game.finishRun(true);
  check('通关奖励是额定值，不随战绩膨胀', HS.Save.data.gold - b2 === 30, (HS.Save.data.gold - b2) + ' 金');
}

/* ================= 11. 设置界面 ================= */
section('设置');
Game.state = 'title';
Game.render();
tap('settings');
check('进入设置', Game.state === 'settings', Game.state);

const sfxWas = Game.sfxOn;
tap('set:sfx');
check('音效开关生效', Game.sfxOn === !sfxWas && HS.Audio.enabled === !sfxWas,
  String(Game.sfxOn) + '/' + String(HS.Audio.enabled));
check('音效写入存档', HS.Save.data.sfx === !sfxWas, String(HS.Save.data.sfx));
tap('set:sfx');
check('音效可恢复', Game.sfxOn === sfxWas && HS.Audio.enabled === sfxWas);

/* 背景音乐是独立开关：关掉音效不该连带停掉 BGM，反过来也一样 */
const bgmWas = Game.bgmOn;
tap('set:bgm');
check('背景音乐开关生效', Game.bgmOn === !bgmWas && HS.Audio.bgmOn === !bgmWas,
  String(Game.bgmOn) + '/' + String(HS.Audio.bgmOn));
check('背景音乐写入存档', HS.Save.data.bgm === !bgmWas, String(HS.Save.data.bgm));
tap('set:bgm');
check('背景音乐可恢复', Game.bgmOn === bgmWas && HS.Audio.bgmOn === bgmWas);

tap('set:vib');
check('震动开关生效', Game.vibOn === false && HS.P.vibrateOn === false, String(Game.vibOn));
check('震动写入存档', HS.Save.data.vib === false, String(HS.Save.data.vib));
tap('set:vib');

tap('set:fx');
check('低特效开关生效', Game.fxLow === true && HS.P.fxLow === true, String(Game.fxLow));
check('低特效写入存档', HS.Save.data.fxLow === true, String(HS.Save.data.fxLow));

/* 低特效下镜头抖动会被压掉，血迹也不再画 */
Game.state = 'title';
Game.startRun('highway', 'soldier');
Game.run.shake = 10;
Game.render();
check('低特效下渲染无异常', true);
Game.fxLow = false; HS.P.fxLow = false;

/* 清除存档：先确认弹窗，再取消，最后真的清 */
Game.state = 'settings';
Game.wipeAsk = false;
HS.Save.data.gold = 777;
Game.render();
tap('wipe');
check('弹出清除确认', Game.wipeAsk === true);
Game.render();
check('确认弹窗时只保留弹窗按钮', Game.hits.length === 2, Game.hits.length);
tap('wipe:no');
check('取消清除', Game.wipeAsk === false && HS.Save.data.gold === 777, HS.Save.data.gold);

Game.state = 'settings';
Game.render();
tap('wipe');
/* 手快连点：确认弹窗刚弹出 0.3s 内点"确认清除"必须被忽略，
   否则清除按钮和弹窗按钮位置重叠的机型上，双击就误删档 */
tap('wipe:yes');
check('弹窗刚弹出时确认被忽略', Game.wipeAsk === true && HS.Save.data.gold === 777,
  'gold=' + HS.Save.data.gold);
for (let k = 0; k < 30; k++) HS.Main.tick(1 / 60);   // 过 0.5s 再点才有效
tap('wipe:yes');
check('确认后存档归零', HS.Save.data.gold === 0 && HS.Save.data.wins === 0, HS.Save.data.gold);
check('清除后回到安全默认', Game.fxLow === false && HS.P.fxLow === false && Game.sfxOn === true);
check('角色回到初始', HS.Save.data.chars.length === 1 && HS.Save.data.chars[0] === 'soldier',
  HS.Save.data.chars.join(','));
check('地图回到初始', HS.Save.data.unlockedMaps.length === 1 && HS.Save.data.unlockedMaps[0] === 'highway',
  HS.Save.data.unlockedMaps.join(','));

Game.state = 'settings';
Game.render();
tap('back');
check('从设置返回标题', Game.state === 'title', Game.state);

/* ================= 连锁闪电 / 关卡强度 ================= */
section('连锁闪电与关卡强度');
{
  /* 连锁闪电：每 X 次开火放一道，X 随等级缩短 */
  Game.startRun('highway', 'soldier');
  const p = Game.run.p;
  p.passives.chainbolt = 1;
  Game.recalc(p);
  const needL1 = HS.Data.chainNeed(1);
  p.passives.chainbolt = 3;
  Game.recalc(p);
  const needL3 = HS.Data.chainNeed(3);
  check('连锁闪电等级越高蓄能越短', needL3 < needL1, needL1 + ' 次 → ' + needL3 + ' 次');

  const entry = p.weapons[0];
  const st = HS.Gear.stat(entry, p);
  Game.run.enemies.length = 0;
  for (let i = 0; i < 6; i++) {
    Game.spawnEnemy('walker', false, 40 + i * 16, (i % 2 ? -1 : 1) * 18);
  }
  Game.run.enemies.forEach(e => { e.hp = e.maxHp = 999; });
  Game.run.chains.length = 0;
  p.chainN = 0;
  const hp0 = Game.run.enemies.map(e => e.hp);
  for (let i = 0; i < needL3; i++) HS.Gear.fire(entry, HS.Data.gear[entry.id], st, false);
  check('蓄满就放出一道连锁闪电', Game.run.chains.length === 1, Game.run.chains.length + ' 道');
  const hit = Game.run.enemies.filter((e, i) => e.hp < hp0[i]).length;
  check('连锁闪电会跳到多个目标', hit >= 3, hit + ' 个');

  /* 关卡强度：越靠后的小兵越硬；Boss 只吃自己的倍率 */
  const probe = (mid) => {
    Game.startRun(mid, 'soldier');
    Game.run.enemies.length = 0;
    const e = Game.spawnEnemy('walker', false, 60, 0);
    const b = Game.spawnEnemy('boss', false, 80, 0);
    return { hp: e.maxHp, armor: e.armor, boss: b.maxHp };
  };
  const h = probe('highway'), n = probe('night'), d = probe('desert'), f = probe('flood');
  check('小兵血量随关卡递增', h.hp < n.hp && n.hp < d.hp && d.hp < f.hp,
    [h, n, d, f].map(o => Math.round(o.hp)).join(' < '));
  check('后期关卡小兵带抗性', f.armor > h.armor && f.armor >= 0.08,
    (h.armor * 100).toFixed(0) + '% → ' + (f.armor * 100).toFixed(0) + '%');
  check('地图强度不作用于 Boss', Math.round(h.boss / 4) === Math.round(n.boss),
    Math.round(h.boss) + ' / ' + Math.round(n.boss));
}

/* ================= 结果 ================= */
console.log('\n----------------------------------------');
console.log('总帧数: ' + ticks + '   敌人峰值: ' + (Game.run ? Game.run.enemies.length : 0));
if (failures === 0) {
  console.log('全部检查通过 ✓');
  process.exit(0);
} else {
  console.log(failures + ' 项检查失败 ✗');
  process.exit(1);
}
