/**
 * 角色点阵预览：把 src/data/spriteDefs.js 里的角色放大成 PNG，方便肉眼验收美术。
 *
 * 用法:
 *   node tools/preview-sprites.js [输出路径] [放大倍数]
 *
 * 默认输出 docs/sprites-preview.png（放大 10 倍，深色底 + 棋盘格）。
 */
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./png');

const ROOT = path.resolve(__dirname, '..');
const data = require(path.join(ROOT, 'src/data/spriteDefs.js'));

const out = process.argv[2] || path.join(ROOT, 'docs/sprites-preview.png');
const Z = parseInt(process.argv[3] || '10', 10);

function hex(c) {
  if (c.charAt(0) === '#') c = c.substring(1);
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  const n = parseInt(c, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* 先校验点阵：行长度必须一致，字母必须都在调色板里 */
let bad = 0;
for (const name of Object.keys(data.defs)) {
  const d = data.defs[name];
  for (let y = 0; y < d.h; y++) {
    const row = d.rows[y];
    if (row === undefined) { console.log('✗ ' + name + ' 缺第 ' + y + ' 行'); bad++; continue; }
    if (row.length !== d.w) { console.log('✗ ' + name + ' 第 ' + y + ' 行长度 ' + row.length + '，应为 ' + d.w + '：' + row); bad++; }
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      if (d.pal[ch] === undefined) { console.log('✗ ' + name + ' 第 ' + y + ' 行第 ' + x + ' 列未知字母 "' + ch + '" U+' + ch.charCodeAt(0).toString(16)); bad++; }
    }
  }
  if (d.rows.length !== d.h) { console.log('✗ ' + name + ' 共 ' + d.rows.length + ' 行，应为 ' + d.h); bad++; }
}
if (bad) { console.log('\n点阵有 ' + bad + ' 处问题，先修好再生成图集。'); process.exit(1); }

/* 要预览的帧：玩家四角色 + 全部敌人 */
const cells = [];
for (const id of ['soldier', 'medic', 'mechanic', 'ghost']) {
  cells.push({ label: 'player_' + id, def: data.defs.player, pal: data.playerPals[id] });
}
for (const name of data.enemyOrder) {
  cells.push({ label: name, def: data.defs[name] });
}

const PAD = 6;          // 格间距（1x 像素）
const COLS = parseInt(process.argv[4] || '5', 10);
const cellW = Math.max(...cells.map(c => c.def.w)) + PAD * 2;
const cellH = Math.max(...cells.map(c => c.def.h)) + PAD * 2;

const rows = Math.ceil(cells.length / COLS);
const W = cellW * Math.min(COLS, cells.length);
const H = cellH * rows;
const buf = Buffer.alloc(W * H * 4);

function put(x, y, rgb, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
  buf[i + 3] = a === undefined ? 255 : a;
}

/* 棋盘底，方便看透明边缘 */
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const chk = ((x >> 2) + (y >> 2)) & 1;
    put(x, y, chk ? [38, 42, 50] : [30, 34, 40], 255);
  }
}

cells.forEach((cell, idx) => {
  const def = cell.def;
  const ox = (idx % COLS) * cellW + Math.floor((cellW - def.w) / 2);
  const oy = Math.floor(idx / COLS) * cellH + Math.floor((cellH - def.h) / 2);
  for (let y = 0; y < def.h; y++) {
    const row = def.rows[y] || '';
    for (let x = 0; x < def.w; x++) {
      const ch = row.charAt(x);
      if (!ch || !def.pal[ch]) continue;
      let col = def.pal[ch];
      if (cell.pal && cell.pal[ch]) col = cell.pal[ch];
      put(ox + x, oy + y, hex(col), 255);
    }
  }
});

/* 最近邻放大 */
const outW = W * Z, outH = H * Z;
const big = Buffer.alloc(outW * outH * 4);
for (let y = 0; y < outH; y++) {
  const sy = (y / Z) | 0;
  for (let x = 0; x < outW; x++) {
    const sx = (x / Z) | 0;
    const si = (sy * W + sx) * 4;
    const di = (y * outW + x) * 4;
    big[di] = buf[si]; big[di + 1] = buf[si + 1]; big[di + 2] = buf[si + 2]; big[di + 3] = 255;
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePNG(outW, outH, big));
console.log('preview -> ' + out + '  ' + outW + 'x' + outH + ' (' + cells.length + ' 帧, 放大 ' + Z + 'x)');
console.log('顺序: ' + cells.map(c => c.label).join(' | '));
