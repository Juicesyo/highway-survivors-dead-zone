/**
 * 平衡探测：模拟"会走位但操作一般"的玩家，看能撑多久
 * 用法: node tools/balance.js [局数]
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
const runs = parseInt(process.argv[2] || '3', 10);
const fast = process.argv.indexOf('--fast') >= 0;

/* 第二参数可以指定单张图（默认五张轮着来）：node tools/balance.js 4 tunnel */
const MAPS = ['highway', 'night', 'desert', 'flood', 'tunnel'];
const onlyMap = process.argv[3];
if (onlyMap && MAPS.indexOf(onlyMap) < 0) {
  console.error('未知地图: ' + onlyMap + '（可选 ' + MAPS.join(' / ') + '）');
  process.exit(1);
}
const maps = onlyMap ? [onlyMap] : MAPS;
const stats = [];
let droppedXp = 0, pickedXp = 0;
const _kill = Game.killEnemy;
Game.killEnemy = function (e) { if (!e.dead) droppedXp += (e.xp || 0); return _kill.call(this, e); };
const _gain = Game.gainXp;
Game.gainXp = function (n) { pickedXp += n; return _gain.call(this, n); };

for (let r = 0; r < runs; r++) {
  HS.Save.data.gold = 9999;
  HS.Save.data.perm.hp = 2;
  Game.selChar = 'whale';
  Game.startRun(maps[r % maps.length], 'whale');

  let ang = 0;
  let lastChoice = [];
  const step = 1 / 60;
  let t = 0;

  while (Game.state !== 'result' && t < 420) {
    ang += 0.7 * step;
    const run = Game.run;
    const p = run.p;

    /* 威胁评估：按距离加权逃离。
       近战主流派要贴脸才打得到，逃跑半径必须收窄，否则机器人只会绕圈跑、
       全程 0 输出（之前 melee 局能空转到 420s 就是这么来的）。 */
    const mainE = HS.Gear.mainEntry(p);
    const mdef = mainE ? HS.Data.gear[mainE.id] : null;
    const fleeR = (mdef && mdef.fam === 'melee') ? 46 : 120;
    let fx = 0, fy = 0, near = 1e9;
    const en = run.enemies;
    for (let k = 0; k < en.length; k++) {
      const e = en[k];
      if (e.dead) continue;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < near) near = Math.sqrt(d2);
      if (d2 < fleeR * fleeR) {
        const d = Math.sqrt(d2) || 1;
        fx += dx / d * (fleeR - d) / fleeR;
        fy += dy / d * (fleeR - d) / fleeR;
      }
    }

    let vx = Math.cos(ang) * 0.35, vy = Math.sin(ang) * 0.35;

    /* 安全且旁边有可搜刮的东西就搜一下 */
    if (!run.search && run.lootTarget && near > 95) {
      Game.beginSearch();
    }

    if (near < fleeR) {
      /* 危险：先跑 */
      vx += fx * 2.0;
      vy += fy * 2.0;
    } else {
      /* 安全：像真人一样顺路把经验捡了 */
      let best = null, bd = 100 * 100;
      const gems = run.gems;
      for (let k = 0; k < gems.length; k++) {
        const g = gems[k];
        if (g.dead) continue;
        const dx = g.x - p.x, dy = g.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= bd) continue;
        /* 宝石周围太危险就先不捡 */
        let risky = false;
        for (let j = 0; j < en.length; j++) {
          const e2 = en[j];
          if (e2.dead) continue;
          if ((e2.x - g.x) * (e2.x - g.x) + (e2.y - g.y) * (e2.y - g.y) < 75 * 75) { risky = true; break; }
        }
        if (risky) continue;
        bd = d2; best = g;
      }
      if (best) {
        const d = Math.sqrt(bd) || 1;
        vx += (best.x - p.x) / d * 1.7;
        vy += (best.y - p.y) / d * 1.7;
      } else {
        vx += fx * 1.2;
        vy += fy * 1.2;
      }
    }

    const l = Math.sqrt(vx * vx + vy * vy) || 1;
    HS.Input.joy.active = true;
    HS.Input.joy.dx = vx / l;
    HS.Input.joy.dy = vy / l;
    HS.Input.joy.mag = 1;

    HS.Main.tick(step);
    t += step;

    if (Game.state === 'levelup') {
      lastChoice = run.choices.map(c => c.name);
      /* 模拟有判断力的玩家：
         进化 > 补进化条件 > 把主武器养满 > 空槽补副武器 / 自动装备 >
         行为型专属分支 > 联动 > 通用属性 */
      const p2 = run.p;
      const mainE = HS.Gear.mainEntry(p2), subE = HS.Gear.subEntry(p2);
      const score = (c) => {
        if (c.kind === 'evolve') return 100;
        if (c.kind === 'evoPrep') return 96;
        if (c.kind === 'gearLevel' && mainE && c.id === mainE.id) return 90 - mainE.lvl;
        if (c.kind === 'weaponNew' && !subE) return 82;
        if (c.kind === 'autoNew' && p2.autos.length < 3) return 78;
        if (c.kind === 'gearUp' && mainE && c.id === mainE.id) return c.rare ? 76 : 68;
        if (c.kind === 'synergy') return 64;
        if (c.kind === 'gearLevel') return 60;
        if (c.kind === 'gearUp') return 56;
        if (c.kind === 'passiveNew') return 52;
        if (c.kind === 'passive') return 50;
        return 40;
      };
      let idx = 0, best = -1;
      for (let k = 0; k < run.choices.length; k++) {
        const s = score(run.choices[k]);
        if (s > best) { best = s; idx = k; }
      }
      Game.pickChoice(idx);
      /* 副武器替换会弹确认框；机器人既然选了这张卡，就当它确认 */
      if (Game.confirm) Game.confirmSwap(true);
    }
    /* 搜刮翻到主武器会暂停问一句：旧枪已经养起来就不换，还是一把 Lv1/Lv2 才换 */
    if (Game.state === 'lootask') {
      const m = HS.Gear.mainEntry(Game.run.p);
      Game.answerLoot(!m || m.lvl <= 2);
    }
  }

  const res = Game.run.result;
  const line = {
    map: maps[r % maps.length],
    win: !!(res && res.win),
    timeout: !res,
    time: Math.round(res ? res.time : Game.run.t),
    kills: res ? res.kills : Game.run.kills,
    level: res ? res.level : Game.run.p.level,
    weapons: Game.run.p.weapons.map(w => w.id + ':' + w.lvl).join(',') +
      ' +auto' + Game.run.p.autos.length +
      ' +syn' + Object.keys(Game.run.p.syn).filter(k => Game.run.p.syn[k]).length,
    /* 金币只有「搜刮 + 通关奖励」两处来源，分开记，方便看经济是否合理 */
    scav: Game.run.gold,
    gold: res ? res.gold : 0,
    clear: res ? (res.clearGold || 0) : 0
  };
  stats.push(line);
  console.log(
    `#${r + 1} ${line.map.padEnd(8)} ${line.win ? 'WIN ' : (line.timeout ? 'TIME' : 'DEAD')} ` +
    `${String(line.time).padStart(3)}s  kills=${String(line.kills).padStart(4)}  Lv.${line.level}  ` +
    `gold=${line.gold}(＋${line.clear})  [${line.weapons}]`
  );
}

const wins = stats.filter(s => s.win).length;
const avg = Math.round(stats.reduce((a, s) => a + s.time, 0) / stats.length);
console.log('\n通关 ' + wins + '/' + runs + '   平均存活 ' + avg + 's');
console.log('金币：结算均值 ' + Math.round(stats.reduce((a, s) => a + s.gold, 0) / Math.max(1, stats.length)) +
  '  （其中搜刮 ' + Math.round(stats.reduce((a, s) => a + s.scav, 0) / Math.max(1, stats.length)) + '）');
console.log('经验：掉落 ' + Math.round(droppedXp) + ' / 实收 ' + Math.round(pickedXp) +
  '  (' + Math.round(pickedXp / Math.max(1, droppedXp) * 100) + '%)');
