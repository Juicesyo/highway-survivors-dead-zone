/**
 * 公路隧道 · 端到端检测
 * 用法: node tools/check-tunnel.js
 *
 * 覆盖：
 *   ① 地图登记（第五张、解锁条件、双首领）
 *   ② 隧道地形（两侧墙挡人挡子弹、走廊连通、刷怪点落在走廊里）
 *   ③ 自爆尸（被打死才炸、炸玩家也炸丧尸、小崽炸得更轻）
 *   ④ 尖啸者（超声扇形命中 → 眩晕；背身不吃）
 *   ⑤ 育母（产崽 3 只小自爆）
 *   ⑥ 双首领必须都打死才通关
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
const D = HS.Data;
const U = HS.U;
Game.testMode = true;

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  (' + extra + ')' : ''));
  if (!cond) bad++;
}
/** 稳定推进：升级界面 / 卡片询问自动过掉，别让测试卡在半路 */
function step(frameDt) {
  Game.run.gems.length = 0;
  if (Game.state === 'levelup') { Game.run.choices = []; Game.pickChoice(0); }
  if (Game.state === 'lootask') Game.answerLoot(false);
  Game.update(frameDt || 1 / 60);
}

/* ================= ① 地图登记 ================= */
console.log('[地图登记]');
const map = D.maps.tunnel;
check('第五张图是公路隧道', D.mapOrder[4] === 'tunnel' && !!map, D.mapOrder.join(' → '));
check('地图顺序五位', D.mapOrder.length === 5, D.mapOrder.length);
check('解锁条件挂着锈水高速', map && map.unlockWins === 4, map && map.unlockWins);
check('通关奖励 140', map && map.clearGold === 140, map && map.clearGold);
check('登记了双首领', map && Array.isArray(map.bossIds) && map.bossIds.length === 2,
  map && (map.bossIds || []).join('+'));
check('两只首领都有定义', !!(D.enemies.shrieker && D.enemies.brood));
check('自爆尸有定义且在隧道刷怪表里', !!D.enemies.bomber);

/* ================= ② 地形 ================= */
console.log('[隧道地形]');
Game.startRun('tunnel', 'whale');
let p = Game.run.p;
check('入口主题是 tunnel', HS.World.tileKind(0, 0) === 0 && Game.run.map.theme === 'tunnel');
check('走廊中线可通行', !HS.World.insideSolid(0, 0));
check('走廊最宽处可通行', !HS.World.insideSolid(78, 0) && !HS.World.insideSolid(-78, 0));
check('左侧墙是实心', HS.World.insideSolid(-110, 0), 'x=-110');
check('右侧墙是实心', HS.World.insideSolid(110, 0), 'x=110');
check('墙外山体也是实心', HS.World.insideSolid(-200, 0) && HS.World.insideSolid(200, 0));
check('墙会挡住子弹', !!HS.World.hitBlock(-100, 40, 2) && !!HS.World.hitBlock(100, 40, 2));

/* 走廊连通：每隔 20px 横着扫一遍，至少要有 4 条可站立的通道。
   （中线允许停着废车 —— 那是掩体，不是断头路） */
let blocked = 0;
for (let y = -900; y <= 900; y += 20) {
  let open = 0;
  for (let x = -80; x <= 80; x += 20) if (!HS.World.insideSolid(x, y)) open++;
  if (open < 4) blocked++;
}
check('走廊从头到尾没有被切断', blocked === 0, blocked + ' 处窄口');

/* 玩家被挤进墙里 → resolve 必须把他收回走廊 */
{
  const probe = { x: 100, y: 120, r: 5 };
  HS.World.resolve(probe, probe.r, 100, 120);
  check('卡进衬砌会被推回走廊', Math.abs(probe.x) < 90, 'x=' + probe.x.toFixed(1));
}

/* 刷怪点：只能在走廊里、且离玩家的 y 更远 */
{
  let outside = 0, tooClose = 0;
  for (let i = 0; i < 200; i++) {
    const pos = Game.spawnPos(0);
    if (Math.abs(pos.x) > 80) outside++;
    if (Math.abs(pos.y - Game.run.p.y) < 200) tooClose++;
  }
  check('刷怪点都落在走廊内', outside === 0, outside + ' 个越界');
  check('刷怪点都在视野外', tooClose === 0, tooClose + ' 个太近');
}

/* 自爆尸会进刷怪表 */
{
  let n = 0;
  for (let i = 0; i < 4000; i++) if (Game.pickType(120) === 'bomber') n++;
  check('120 秒后尸群里混着自爆尸', n > 200, n + ' / 4000');
  let n2 = 0;
  for (let i = 0; i < 2000; i++) if (Game.pickType(60) === 'bomber') n2++;
  check('60 秒时自爆尸还没铺满', n2 < 1400, n2 + ' / 2000');
}

/* 扑袭者（死区之夜的专属怪）也进隧道刷怪表 —— 但必须压着放：
   走廊只有 |x|<88，一次猛扑在这里几乎躲不掉，比例给大了就是"没法玩"。
   同时确认它还是那只"会扑"的怪，不是被改成普通快丧尸。 */
{
  let before = 0, after = 0, i;
  for (i = 0; i < 3000; i++) if (Game.pickType(90) === 'pouncer') before++;
  for (i = 0; i < 3000; i++) if (Game.pickType(180) === 'pouncer') after++;
  check('90 秒前隧道里没有扑袭者', before === 0, before + ' / 3000');
  check('隧道尸群里混着扑袭者', after > 150, after + ' / 3000');
  check('扑袭者只占少数（<15%）', after < 450, (after / 30).toFixed(1) + '%');
  check('扑袭者仍带猛扑机制', D.enemies.pouncer.pounce === true);
  /* 三种隧道专属怪加起来也不能把普通尸群挤光，否则走廊里只剩"精英开会"。
     只数 bomber / vomiter / pouncer —— spitter 在通用池里也有，数进去会虚高。 */
  let spec = 0;
  for (i = 0; i < 3000; i++) {
    const ty = Game.pickType(200);
    if (ty === 'bomber' || ty === 'vomiter' || ty === 'pouncer') spec++;
  }
  check('隧道专属怪合计 ≤42%', spec < 1260, (spec / 30).toFixed(1) + '%');
}

/* ================= ③ 自爆尸 ================= */
console.log('[自爆尸]');
Game.startRun('tunnel', 'whale');
p = Game.run.p;
{
  p.x = 0; p.y = 0; p.hp = p.maxHp; p.invuln = 0;
  Game.run.enemies.length = 0;
  const b = Game.spawnEnemy('bomber', false, 0, 30);
  b.speed = 0;                       // 定住，只看爆炸
  const near = Game.spawnEnemy('walker', false, 0, 52);
  near.speed = 0;
  const far = Game.spawnEnemy('walker', false, 0, 400);
  far.speed = 0;
  const hpNear0 = near.hp, hpFar0 = far.hp;
  Game.hurtEnemy(b, 9999, { noCrit: true });
  check('打死自爆尸会自爆', b.dead === true);
  check('波及附近的丧尸', near.dead || near.hp < hpNear0, Math.round(near.hp) + '/' + Math.round(hpNear0));
  check('远处的丧尸不受影响', Math.round(far.hp) === Math.round(hpFar0), Math.round(far.hp));
  check('也会伤到玩家', p.hp < p.maxHp, Math.round(p.hp) + '/' + Math.round(p.maxHp));

  /* 站在爆炸半径外不掉血 */
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.x = 0; p.y = 0; p.hp = p.maxHp; p.invuln = 0;
  Game.run.enemies.length = 0;
  const b2 = Game.spawnEnemy('bomber', false, 0, 120);
  Game.hurtEnemy(b2, 9999, { noCrit: true });
  check('爆心 120px 外不掉血', p.hp === p.maxHp, Math.round(p.hp) + '/' + Math.round(p.maxHp));
}

/* 连锁：两只自爆尸贴在一起，炸一只会把另一只也带走 */
{
  Game.startRun('tunnel', 'whale');
  p = Game.run.p; p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0;
  Game.run.enemies.length = 0;
  const a1 = Game.spawnEnemy('bomber', false, 0, 80);
  const a2 = Game.spawnEnemy('bomber', false, 0, 108);
  a1.hp = a1.maxHp; a2.hp = 1;
  Game.hurtEnemy(a1, 9999, { noCrit: true });
  check('自爆会引燃旁边的自爆尸（连锁）', a2.dead === true);
}

/* ================= ④ 双首领 ================= */
console.log('[双首领]');
Game.startRun('tunnel', 'whale');
p = Game.run.p;
{
  p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0;
  Game.spawnBoss();
  const bosses = Game.run.bosses || [];
  check('同时刷出两只首领', bosses.length === 2, bosses.map(e => e.type).join('+'));
  check('一只尖啸者一只育母',
    bosses.some(e => e.def.bossType === 'shrieker') && bosses.some(e => e.def.bossType === 'brood'));
  check('run.boss 指向其中一只', !!Game.run.boss && Game.run.boss.boss === true,
    Game.run.boss && Game.run.boss.def.name);
  check('两只一上一下包夹', bosses.length === 2 && (bosses[0].y - p.y) * (bosses[1].y - p.y) < 0,
    bosses.map(e => Math.round(e.y - p.y)).join(' / '));
  check('双首领合计血量 > 单图 Boss', bosses.reduce((s, e) => s + e.maxHp, 0) > 2500,
    Math.round(bosses.reduce((s, e) => s + e.maxHp, 0)));

  /* 打死一只：不算通关，另一只顶上 */
  const first = bosses[0], second = bosses[1];
  Game.hurtEnemy(first, 1e9, { noCrit: true });
  check('打死一只不结算', Game.state === 'run', Game.state);
  check('存活列表只剩一只', Game.run.bosses.length === 1, Game.run.bosses.length);
  check('血条指向活着的那只', Game.run.boss === second, Game.run.boss && Game.run.boss.def.name);

  Game.hurtEnemy(second, 1e9, { noCrit: true });
  check('两只都倒下才通关', Game.state === 'result' && Game.run.result.win === true,
    Game.state + ' win=' + (Game.run.result && Game.run.result.win));
  check('通关奖励按隧道算', Game.run.result && Game.run.result.clearGold === 140,
    Game.run.result && Game.run.result.clearGold);
}

/* ================= ⑤ 尖啸者：超声眩晕 ================= */
console.log('[尖啸者 · 超声]');
Game.startRun('tunnel', 'whale');
p = Game.run.p;
{
  Game.state = 'run';
  p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0; p.stun = 0;
  Game.run.enemies.length = 0;
  const s = Game.spawnEnemy('shrieker', false, 0, -160);
  s.boss = true; s.speed = 0; s.hSonicCd = 0.01;
  Game.run.boss = s;
  Game.run.bosses = [s];

  let sawWind = false, stunT = 0, hurt = false;
  for (let f = 0; f < 60 * 6; f++) {
    p.x = 0; p.y = 0;
    s.x = 0; s.y = -160;
    if (p.hp < 99999) hurt = true;
    p.hp = 99999;
    step();
    if (s.hSt === 1) sawWind = true;
    if (p.stun > stunT) stunT = p.stun;
  }
  check('会进入蓄声状态（有预警）', sawWind, 'hSt=' + s.hSt);
  check('超声能让玩家眩晕', stunT > 0.5, 'stun=' + stunT.toFixed(2) + 's');
  check('超声也会掉一点血', hurt);

  /* 眩晕时操作被剥夺：按住摇杆也不动、也不出膛 */
  Game.run.enemies.length = 0;
  Game.run.bullets.length = 0;
  p.stun = 0.8; p.stunMax = 0.8;
  const px0 = p.x, py0 = p.y;
  HS.Input.joy.active = true; HS.Input.joy.dx = 1; HS.Input.joy.dy = 0; HS.Input.joy.mag = 1;
  for (let f = 0; f < 12; f++) { p.hp = 99999; step(); }
  check('眩晕时走不动', Math.abs(p.x - px0) < 0.5 && Math.abs(p.y - py0) < 0.5,
    'dx=' + (p.x - px0).toFixed(2));
  check('眩晕时开不了枪', Game.run.bullets.length === 0, Game.run.bullets.length + ' 颗');
  HS.Input.joy.mag = 0; HS.Input.joy.active = false;

  /* 全向：站在它背后（同一层、视野内）照样被震晕 —— 以前是前方扇形，玩家反馈"不合理" */
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0; p.stun = 0;
  Game.run.enemies.length = 0;
  const s2 = Game.spawnEnemy('shrieker', false, 0, -170);
  s2.boss = true; s2.speed = 0; s2.hSonicCd = 0.01; s2.hChanCd = 99;
  Game.run.boss = s2; Game.run.bosses = [s2];
  let stunBack = 0;
  for (let f = 0; f < 60 * 4; f++) {
    /* 一直贴在它背后（y 更小）—— 全向之后这里也吃 */
    p.x = 0; p.y = -230;
    s2.x = 0; s2.y = -80;
    p.hp = 99999;
    step();
    if (p.stun > stunBack) stunBack = p.stun;
  }
  check('超声是全向的：站在背后照样被震晕', stunBack > 0.5, 'stun=' + stunBack.toFixed(2));

  /* 躲进车后（视线被挡）就吃不到 */
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.hp = 99999; p.invuln = 0; p.stun = 0;
  Game.run.enemies.length = 0;
  const ay0 = HS.World.accidentY(1);
  const s3 = Game.spawnEnemy('shrieker', false, 0, ay0 - 60);
  s3.boss = true; s3.speed = 0; s3.hSonicCd = 0.01; s3.hChanCd = 99;
  Game.run.boss = s3; Game.run.bosses = [s3];
  p.x = 0; p.y = ay0 + 60;
  let stunHidden = 0;
  for (let f = 0; f < 60 * 4; f++) {
    p.x = 0; p.y = ay0 + 60;
    s3.x = 0; s3.y = ay0 - 60;
    p.hp = 99999;
    step();
    if (p.stun > stunHidden) stunHidden = p.stun;
  }
  check('躲进车堆的视线死角就吃不到超声', stunHidden === 0, 'stun=' + stunHidden.toFixed(2));

  /* 长啸：持续眩晕 + 持续掉血 */
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0; p.stun = 0;
  Game.run.enemies.length = 0;
  const s4 = Game.spawnEnemy('shrieker', false, 0, -150);
  s4.boss = true; s4.speed = 0; s4.hSonicCd = 99; s4.hChanCd = 0.01;
  Game.run.boss = s4; Game.run.bosses = [s4];
  let wind4 = false, chanT4 = 0, hpDrain = 0, stunFrames = 0;
  for (let f = 0; f < 60 * 6; f++) {
    p.x = 0; p.y = 0;
    s4.x = 0; s4.y = -150;
    if (s4.hSt === 5) { chanT4++; if (s4.hT > 0) wind4 = true; }
    if (p.stun > 0) stunFrames++;
    p.hp = 99999;
    step();
    if (99999 - p.hp > 0) hpDrain += 99999 - p.hp;
    p.hp = 99999;
  }
  check('长啸有起手蓄气', wind4, '持续帧 ' + chanT4);
  check('长啸会持续把人锁在原地（多段眩晕）', stunFrames > 60, stunFrames + ' 帧被晕');
  check('长啸持续掉血', hpDrain > 4, '累计 ' + hpDrain.toFixed(1));

  /* 长啸被视线打断：躲到车后它应该当场收声 */
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.hp = 99999; p.invuln = 0; p.stun = 0;
  Game.run.enemies.length = 0;
  const s5 = Game.spawnEnemy('shrieker', false, 0, ay0 - 300);
  s5.boss = true; s5.speed = 0; s5.hSonicCd = 99; s5.hChanCd = 0.01;
  Game.run.boss = s5; Game.run.bosses = [s5];
  /* 起手要在空地上（看得见），0.9s 之后躲到车堆下游 —— 视线被车挡住 */
  p.x = 0; p.y = ay0 - 200;
  let chanFrames = 0, broke = false;
  for (let f = 0; f < 60 * 5; f++) {
    p.x = 0; p.y = (f < 54) ? ay0 - 200 : ay0 + 120;
    s5.x = 0; s5.y = ay0 - 300;
    p.hp = 99999;
    step();
    if (s5.hSt === 5) chanFrames++;
    if (chanFrames > 0 && s5.hSt !== 5) broke = true;
  }
  check('长啸一旦断了视线就收声', broke && chanFrames < 200, 'hSt=5 共 ' + chanFrames + ' 帧');
}

/* ================= ⑥ 育母：产崽 ================= */
console.log('[育母 · 产崽]');
Game.startRun('tunnel', 'whale');
p = Game.run.p;
{
  p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0;
  Game.run.enemies.length = 0;
  const m = Game.spawnEnemy('brood', false, 0, -140);
  m.boss = true; m.speed = 0; m.bSpawnCd = 0.01;
  Game.run.boss = m; Game.run.bosses = [m];
  let sawWind = false, minis = 0, sample = null;
  for (let f = 0; f < 60 * 5; f++) {
    p.x = 0; p.y = 0; p.hp = 99999;
    m.x = 0; m.y = -140;
    step();
    if (m.bSt === 1) sawWind = true;
    const alive = Game.run.enemies.filter(e => e.mini && !e.dead);
    if (alive.length > minis) minis = alive.length;
    if (!sample && alive.length) sample = alive[0];
  }
  check('产崽前会鼓一下育囊（有预警）', sawWind, 'bSt=' + m.bSt);
  check('一口气挤出 3 只小自爆尸', minis >= 3, minis + ' 只');
  const mini = sample;
  if (mini) {
    check('小崽是自爆尸', mini.def.bomber === true && mini.type === 'bomber');
    check('小崽比成体脆', mini.maxHp < 40, Math.round(mini.maxHp));
    check('小崽爆炸半径更小', mini.blastR > 0 && mini.blastR < D.enemies.bomber.blastR,
      mini.blastR + ' < ' + D.enemies.bomber.blastR);
  } else {
    check('小崽是自爆尸', false, '一只都没活下来');
  }
}

/* 抓投：育母把身边的自爆尸拎起来扔向玩家，落地就炸 */
{
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0;
  Game.run.enemies.length = 0;
  const m2 = Game.spawnEnemy('brood', false, 0, -150);
  m2.boss = true; m2.speed = 0;
  m2.bSpawnCd = 99; m2.bSlamCd = 99; m2.bThrowCd = 0.01;
  Game.run.boss = m2; Game.run.bosses = [m2];
  const bomb = Game.spawnEnemy('bomber', false, 46, -150);
  bomb.speed = 0;
  let grab = false, flyFrames = 0, boom = false, grabbedOne = null;
  for (let f = 0; f < 60 * 5; f++) {
    p.x = 0; p.y = 0; p.hp = 99999;
    m2.x = 0; m2.y = -150;
    if (Game.state === 'levelup') { Game.run.choices = []; Game.pickChoice(0); }
    step();
    if (m2.bSt === 5) { grab = true; if (m2.bVictim) grabbedOne = m2.bVictim; }
    if (bomb.hurlT > 0) flyFrames++;
    if (bomb.dead) boom = true;
  }
  check('育母会伸手抓身边的自爆尸', grab, grabbedOne ? grabbedOne.type : '-');
  check('抓住后把它扔出去（抛物线飞行）', flyFrames > 10, flyFrames + ' 帧在空中');
  check('被扔出去的自爆尸落地就炸', boom && bomb.dead);
}

/* 贴身的普通攻击：两只首领都能打到贴脸的玩家 */
for (const id of ['shrieker', 'brood']) {
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.x = 0; p.y = 0; p.hp = p.maxHp; p.invuln = 0;
  Game.run.enemies.length = 0;
  const b = Game.spawnEnemy(id, false, 0, -34);
  b.boss = true; b.speed = 0;
  Game.run.boss = b; Game.run.bosses = [b];
  let hurt = false;
  for (let f = 0; f < 60 * 5; f++) {
    p.x = 0; p.y = 0; p.invuln = 0;
    b.x = 0; b.y = -34;
    if (p.hp < p.maxHp) hurt = true;
    if (!hurt) p.hp = p.maxHp;
    step();
  }
  check(D.enemies[id].name + ' 贴身能伤到玩家', hurt);
}

/* ================= ⑦ 事故现场 ================= */
/* 每 1152px 一处连环追尾。这里量三件事：车够不够多、路还走不走得过去、
   事故带里有没有混进别的道具（混进去就可能把唯一的通道堵死）。 */
console.log('[事故现场]');
{
  Game.startRun('tunnel', 'whale');
  const sites = [];
  HS.World.accidentsIn(0, 4200, sites);
  check('隧道里每隔一段就有事故现场', sites.length >= 3, sites.length + ' 处');
  check('事故点不会压在出生点上', sites.every(s => Math.abs(s.y) > 200),
    sites.map(s => Math.round(s.y)).join(','));

  const buf = [];
  let worstGap = 999, worstY = 0, minCars = 99, lootCars = 0, allSolid = true, allBlock = true;
  for (const s of sites) {
    buf.length = 0;
    /* 窗口取 ±165：事故带本身是 ±170，再往外就是正常道具了 */
    HS.World.queryRect(-100, s.y - 165, 100, s.y + 165, buf);
    const cars = buf.filter(o => o.acc === s.k);
    /* queryRect 是按区块给的，会把区块里带外的道具也带出来 —— 这里按 y 再筛一次 */
    const others = buf.filter(o => o.acc === undefined && !o.wall && o.type !== 'tunnelrock' &&
      Math.abs(o.y - s.y) <= 170);
    minCars = Math.min(minCars, cars.length);
    for (const c of cars) {
      if (!c.solid) allSolid = false;
      if (!c.blockBullets) allBlock = false;
      if (c.lootable || c.looted) lootCars++;
    }
    /* 通道宽度：沿 y 采样五条横线，取"每条横线上都通"的最宽连续区间 */
    let best = 0, run = 0;
    for (let x = -88; x <= 88; x += 2) {
      let solid = false;
      for (let dy = -44; dy <= 44; dy += 22) if (HS.World.insideSolid(x, s.y + dy)) { solid = true; break; }
      if (solid) { run = 0; } else { run += 2; if (run > best) best = run; }
    }
    if (best < worstGap) { worstGap = best; worstY = Math.round(s.y); }
    if (others.length) check('事故带 y=' + Math.round(s.y) + ' 里不该混别的道具', false, others.length + ' 件');
  }
  check('每处事故至少有 5 辆车', minCars >= 5, minCars + ' 辆');
  check('事故车都是实心的', allSolid);
  check('事故车会挡子弹', allBlock);
  check('事故车够搜刮（半数以上）', lootCars >= sites.length * 2.5, lootCars + ' 辆可搜');
  check('车堆旁边永远留着一道能过人的缝（≥46px）', worstGap >= 46, worstGap + 'px @y=' + worstY);

  /* 每处事故恰好一辆车还在烧，那火光就是现场的照明 */
  let noFire = 0, badFire = 0, dimFire = 0, minLit = 9;
  for (const s of sites) {
    const f = HS.World.accidentFire(s.k);
    if (!f) { noFire++; continue; }
    if (Math.abs(f.y - s.y) > 60) badFire++;
    const lit = HS.Light.level(f.x, f.y, Game.run.t);
    if (lit < minLit) minLit = lit;
    if (lit < 0.5) dimFire++;
  }
  check('每处事故都有一辆在烧', noFire === 0, noFire + ' 处没有火源');
  check('火源就在车堆中间', badFire === 0, badFire + ' 处偏了');
  check('车堆被自己的火光照亮（level ≥ 0.5）', dimFire === 0, '最暗 ' + minLit.toFixed(2));
  check('火光的照明半径比玩家光圈大', HS.Light.FIRE_R > HS.Light.farR(p),
    HS.Light.FIRE_R + ' / ' + Math.round(HS.Light.farR(p)));
}

/* ================= ⑦b 黑暗里的敌人锁不上 ================= */
/* 用户要的"看不见就不能索敌"：灯与灯之间几乎全黑，那里的敌人不进锁定；
   贴身（玩家自带那点光）和灯下必须照常锁得住。 */
console.log('[照明与索敌]');
{
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  Game.run.enemies.length = 0;
  Game.state = 'run';
  const L = HS.Light;
  check('隧道有照明场模块', !!L && typeof L.seen === 'function');
  check('光圈半径跟着经验吸取范围走', Math.abs(L.nearR(p) - p.magnet) < 1e-6 ||
    (p.magnet < 40 && L.nearR(p) === 40), 'magnet=' + p.magnet.toFixed(1) + ' r=' + L.nearR(p).toFixed(1));

  /* 灯光只跟 y 有关（灯沿走廊排成一列），所以"离灯最远"的就是两灯中点。
     走廊只有 176 宽，纵向永远有一盏灯在 130px 内 —— 测"锁不上"要用横向距离。 */
  let farY = 0, farLv = 9, litY = -1, litX = 0;
  for (let y = 0; y < 3000; y += 2) {
    const lv = L.level(0, y, Game.run.t);
    if (lv < farLv) { farLv = lv; farY = y; }
  }
  /* 灯正下方：直接找一盏还亮着的灯（灯在车道边 x=±62，站在它下面才是全亮） */
  for (let k = 0; k < 40 && litY < 0; k++) {
    if (L.lampFl(k, Game.run.t) > 0.9) {
      const lp = L.lampPos(k);
      if (L.level(lp.x, lp.y, Game.run.t) > 0.9) { litY = lp.y; litX = lp.x; }
    }
  }
  check('隧道里有照不到灯的路段', farLv < 0.36, 'y=' + Math.round(farY) + ' lv=' + farLv.toFixed(2));
  check('也有灯正下方的路段', litY >= 0, 'y=' + Math.round(litY));
  /* 用户要的"路灯比玩家自己那圈照得更远" */
  check('灯的照明半径比玩家光圈大', L.RADIUS > L.farR(p),
    '灯 ' + L.RADIUS + ' / 玩家 ' + Math.round(L.farR(p)));

  /* 灯闪不能刺眼：以前"接触不良"是把 sin 硬切成 0.04/0.22/1.0，单帧跳变接近满亮。
     现在要求任何一档灯在 1/60 秒内的亮度跳变都很小，峰值也不许冲到满亮。 */
  let worstJump = 0, worstLid = 0, dirtyMax = 0;
  for (let k = 0; k < 80; k++) {
    const rv = HS.U.hash(0, k, 933);
    let prev = L.lampFl(k, 0);
    for (let f = 1; f < 180; f++) {
      const v = L.lampFl(k, f / 60);
      const dj = Math.abs(v - prev);
      if (dj > worstJump) { worstJump = dj; worstLid = k; }
      if (rv >= 0.38 && rv < 0.50 && v > dirtyMax) dirtyMax = v;
      prev = v;
    }
  }
  check('灯闪不刺眼（单帧亮度跳变 < 0.12）', worstJump < 0.12,
    '最大 ' + worstJump.toFixed(3) + ' @灯' + worstLid);
  check('接触不良的灯不会闪到满亮（峰值 ≤ 0.65）', dirtyMax <= 0.65, dirtyMax.toFixed(2));

  /* 光圈里：全亮，贴身一定能锁 */
  p.x = 0; p.y = 1000;
  const eN = Game.spawnEnemy('walker', false, 0, 1000 + 20);
  eN.speed = 0; eN.x = 0; eN.y = 1000 + 20;
  check('光圈内的敌人一进范围就锁上', !!Game.nearest(0, 1000, 260));
  check('光圈内是亮的（压暗为 0）', L.radial(0, 1000 + 20, p) > 0.99,
    L.radial(0, 1000 + 20, p).toFixed(2));

  /* 光圈外足够远：把玩家贴到一侧、靶子放另一侧（横向 160 > 光圈边缘 105），
     那一带的灯光贡献又不足以点亮 —— 锁不上。 */
  p.x = 80; p.y = farY;
  eN.x = -80; eN.y = farY;
  check('光圈外、灯光又照不到的敌人锁不上', !Game.nearest(80, farY, 400),
    'vis=' + L.vis(-80, farY, Game.run).toFixed(2) + ' d=160');
  check('越往外越黑（vis 单调下降）', (function () {
    let last = 2, ok = true;
    for (let d = 0; d <= 200; d += 10) {
      const v = L.radial(p.x, p.y + d, p);
      if (v > last + 1e-6) ok = false;
      last = v;
    }
    return ok;
  })());

  /* 灯下：光圈外的目标也能锁 —— 灯是主光源，路灯要真的照亮路况。
     靶子放在**亮着的那盏灯正下方**，玩家退到走廊另一侧（横向 140，远在光圈外）。 */
  const pxFar = litX > 0 ? -78 : 78;
  p.x = pxFar; p.y = litY;
  eN.x = litX; eN.y = litY;
  check('灯下的远处目标能锁（灯是光源）', !!Game.nearest(pxFar, litY, 400),
    'vis=' + L.vis(litX, litY, Game.run).toFixed(2) + ' d=' + Math.round(Math.abs(pxFar - litX)));
  check('玩家自己光圈够不到那里（说明是灯在起作用）', L.radial(litX, litY, p) === 0,
    'd=' + Math.round(Math.abs(pxFar - litX)));
  /* 灯照到的地方要"看得清"，不是一层朦胧的雾：往回走 80px 仍要够亮 */
  check('灯照范围的中段也看得见', L.level(litX, litY + 80, Game.run.t) > 0.3,
    L.level(litX, litY + 80, Game.run.t).toFixed(2));

  /* 点拾取范围 = 看得更远：升几级磁铁之后，原来锁不上的距离能锁了。
     同一个位置、同一只怪，只改 magnet —— 这样比较才说明是光圈在起作用。 */
  Game.startRun('tunnel', 'whale');
  const p2 = Game.run.p;
  Game.run.enemies.length = 0;
  p2.x = 80; p2.y = farY;
  const e2 = Game.spawnEnemy('walker', false, -80, farY);
  e2.speed = 0; e2.x = -80; e2.y = farY;
  const before = !!Game.nearest(80, farY, 400);
  p2.passives.magnet = 4;
  Game.recalc(p2);
  const after = !!Game.nearest(80, farY, 400);
  check('堆拾取范围 = 看得更远（4 级磁铁后同一距离能锁）',
    !before && after, 'd=160 magnet ' + L.nearR(p2).toFixed(0) + ' 边缘 ' + L.farR(p2).toFixed(0));
}

/* ================= ⑧ 车堆不卡怪 ================= */
/* 一串车把走廊掐成 S 弯之后，丧尸必须还能绕过来 —— 这是"一堆车把怪卡在角落"的回归测试。 */
console.log('[车堆寻路]');
{
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.weapons.length = 0; p.autos.length = 0;
  p.hp = 1e9; p.invuln = 1e9;
  const ay = HS.World.accidentY(1);
  p.x = 0; p.y = ay + 120;
  Game.run.enemies.length = 0;
  Game.run.spawnAcc = -1e9;
  const marks = [];
  for (let i = 0; i < 12; i++) {
    const e = Game.spawnEnemy('walker', false, -60 + (i % 6) * 24, ay - 150 - Math.floor(i / 6) * 26);
    e.speed = 34;
    marks.push(e);
  }
  for (let f = 0; f < 60 * 16; f++) {
    HS.Input.joy.active = false; HS.Input.joy.mag = 0;
    p.hp = 1e9;
    step();
  }
  let near = 0;
  for (const e of marks) if (!e.dead && HS.U.dist(e.x, e.y, p.x, p.y) < 45) near++;
  check('车堆挡路时丧尸仍能绕到玩家身边（≥10/12）', near >= 10, near + ' / 12');

  /* 空投 / 补给的落点必须还在走廊里 */
  let out = 0;
  for (let i = 0; i < 200; i++) {
    const sp = Game.dropSpot(HS.U.rand(-70, 70), ay + HS.U.rand(-70, 70), 180);
    if (Math.abs(sp.x) > 80) out++;
    if (HS.World.insideSolid(sp.x, sp.y)) out++;
  }
  check('空投落点会被收回走廊里', out === 0, out + ' 个越界/卡进墙');
}

/* ================= ⑨ 新机制的音效指纹 ================= */
/* 自爆尸 / 超声 / 产崽必须各有专属音色。全借 zap / boom 的话，
   玩家在尸潮里分不出"是我把它点炸了"和"油桶炸了"（喷火降噪那次踩过同类问题）。 */
console.log('[新机制音效]');
{
  const calls = [];
  const bak = {};
  for (const n of ['pop', 'scream', 'spit', 'tinnitus', 'boom', 'zap']) {
    bak[n] = HS.Audio[n];
    HS.Audio[n] = function (a) { calls.push(n + '=' + a); };
  }
  const has = (s) => calls.some((c) => c.indexOf(s) === 0);   // 前缀匹配：tinnitus / spit 不带参数

  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0;
  Game.run.enemies.length = 0;
  calls.length = 0;
  Game.hurtEnemy(Game.spawnEnemy('bomber', false, 0, 60), 9999, { noCrit: true });
  check('自爆尸用专属爆音，不再借通用 boom', has('pop=false') && !has('boom'), calls.join(' '));

  const mm = Game.spawnEnemy('bomber', false, 60, -60);
  mm.mini = true; mm.blastR = 30;
  calls.length = 0;
  Game.bomberBlast(mm);
  check('小崽的爆音更轻一档', has('pop=true') && !has('boom'), calls.join(' '));

  /* 尖啸者：蓄声一段、放声一段 */
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0;
  Game.run.enemies.length = 0;
  const sk = Game.spawnEnemy('shrieker', false, 0, -160);
  sk.boss = true; sk.speed = 0; sk.hSonicCd = 0.01;
  Game.run.boss = sk; Game.run.bosses = [sk];
  let stunSeen = 0;
  calls.length = 0;
  for (let f = 0; f < 60 * 4; f++) {
    p.x = 0; p.y = 0; p.hp = 99999;
    sk.x = 0; sk.y = -160;
    step();
    if (p.stun > stunSeen) stunSeen = p.stun;
  }
  check('蓄声有独立的低频预警音', has('scream=true'), calls.slice(0, 6).join(' '));
  check('放声用超声尖啸，不是 zap', has('scream=false') && !has('zap'), calls.join(' '));
  check('被震晕时有耳鸣音', has('tinnitus') && stunSeen > 0.5, 'stun=' + stunSeen.toFixed(2));

  /* 育母：产崽是"撕开"的湿响，不是电流声 */
  Game.startRun('tunnel', 'whale');
  p = Game.run.p;
  p.x = 0; p.y = 0; p.hp = 99999; p.invuln = 0;
  Game.run.enemies.length = 0;
  const br = Game.spawnEnemy('brood', false, 0, -140);
  br.boss = true; br.speed = 0; br.bSpawnCd = 0.01;
  Game.run.boss = br; Game.run.bosses = [br];
  calls.length = 0;
  for (let f = 0; f < 60 * 3; f++) {
    p.x = 0; p.y = 0; p.hp = 99999;
    br.x = 0; br.y = -140;
    step();
  }
  check('产崽用育囊湿响，不是 zap', has('spit') && !has('zap'), calls.join(' '));

  for (const n of Object.keys(bak)) HS.Audio[n] = bak[n];
}

console.log('\n' + (bad === 0 ? '全部通过 ✓' : bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
