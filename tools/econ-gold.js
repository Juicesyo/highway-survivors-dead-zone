/**
 * 金币经济估算：一局「只搜刮」大概能带多少金币回去
 * 用法：node tools/econ-gold.js
 *
 * 统计方式是"每 192x192 区块里可搜刮物件的平均数量与平均金额"，
 * 再按「一局顺手砸 15 / 25 个」给出两个档位的估算。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
global.GameGlobal = global;
const reqs = [...fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8')
  .matchAll(/require\((['"])(.+?)\1\)/g)].map(m => m[2]);
for (const r of reqs) require(path.join(ROOT, r));
const HS = global.HS;
HS.Main.boot();
const G = HS.Game;
G.testMode = true;

const OBS = HS.World;
const buf = [];

for (const mid of ['highway', 'night', 'desert', 'flood']) {
  G.state = 'title';
  G.startRun(mid, 'soldier');

  /* 扫一圈 14x14 个区块（约 2700x2700 世界像素） */
  let n = 0, sum = 0, seen = 0;
  for (let gx = -7; gx < 7; gx++) {
    for (let gy = -7; gy < 7; gy++) {
      OBS.queryRect(gx * 192, gy * 192, gx * 192 + 192, gy * 192 + 192, buf);
      seen++;
      for (const o of buf) {
        if (!o.lootable || !o.def || !o.def.loot) continue;
        const t = HS.Data.loot[o.def.loot];
        if (!t) continue;
        n++;
        sum += (t.gold[0] + t.gold[1]) / 2;
      }
    }
  }
  const perChunk = n / seen;
  const perProp = n ? sum / n : 0;
  const clear = HS.Data.maps[mid].clearGold || 0;

  const f = k => Math.round(perProp * k);
  console.log(
    mid.padEnd(8) +
    '每区块 ' + perChunk.toFixed(2) + ' 个可搜刮' +
    '   平均 ' + perProp.toFixed(1) + ' 金/个' +
    '   一局砸 15 个 ≈ ' + f(15) + ' 金 ／ 25 个 ≈ ' + f(25) + ' 金' +
    '   通关再 +' + clear
  );
}
console.log('\n（击杀掉的金币另算：每次 +3，约 3.5% 的击杀会掉，被磁铁吸走 —— 一局几百杀大概 15~30 金）');
