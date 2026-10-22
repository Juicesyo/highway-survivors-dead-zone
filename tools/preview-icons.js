/**
 * 图标校验 + 预览图
 * 用法: node tools/preview-icons.js
 * 输出: docs/icons.png（黑底，每个图标 96px，6 列）
 *
 * 顺便校验每个图标必须是 12 行 x 12 列，字符只允许 '#+-.'
 */
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./png.js');

const ROOT = path.resolve(__dirname, '..');

/* 用 vm 在全局里跑一遍，拿到 HS.Icons */
const vm = require('vm');
const sandbox = { HS: {}, Math, console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/data/icons.js'), 'utf8'), sandbox);
const PIX = sandbox.HS.Icons;

const N = 12;
let bad = 0;
const names = Object.keys(PIX);
for (const k of names) {
  const rows = PIX[k];
  if (!Array.isArray(rows) || rows.length !== N) {
    console.error(`✗ ${k}: 行数 ${rows ? rows.length : 0}，应为 ${N}`);
    bad++;
    continue;
  }
  rows.forEach((r, i) => {
    if (r.length !== N) { console.error(`✗ ${k} 第 ${i} 行长度 ${r.length}：${r}`); bad++; }
    if (/[^#+\-.]/.test(r)) { console.error(`✗ ${k} 第 ${i} 行含非法字符：${r}`); bad++; }
  });
}
if (bad) { console.error(`\n共 ${bad} 处问题`); process.exit(1); }
console.log(`✓ ${names.length} 个图标格式正确`);

/* --- 渲染 --- */
const CELL = 8;              // 每格 8px
const PAD = 12;
const ICON = N * CELL;
const COLS = 7;
const ROWS = Math.ceil(names.length / COLS);
const W = COLS * (ICON + PAD) + PAD;
const H = ROWS * (ICON + PAD) + PAD;

const buf = Buffer.alloc(W * H * 4);
/* 背景 */
for (let i = 0; i < W * H; i++) {
  const x = i % W, y = (i / W) | 0;
  const checker = (((x / 12) | 0) + ((y / 12) | 0)) % 2 === 0;
  const v = checker ? 22 : 18;
  buf[i * 4] = v; buf[i * 4 + 1] = v + 3; buf[i * 4 + 2] = v + 7; buf[i * 4 + 3] = 255;
}

function parse(hex) {
  return [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)];
}
function shade(c, amt) {
  const t = amt > 0 ? 255 : 0, k = Math.abs(amt);
  return [0, 1, 2].map(i => Math.round(c[i] + (t - c[i]) * k));
}
function px(x, y, rgb, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  const al = a === undefined ? 1 : a;
  buf[o] = Math.round(buf[o] * (1 - al) + rgb[0] * al);
  buf[o + 1] = Math.round(buf[o + 1] * (1 - al) + rgb[1] * al);
  buf[o + 2] = Math.round(buf[o + 2] * (1 - al) + rgb[2] * al);
}

/* 取真实配色，让预览和图内一致 */
const PALETTE = {
  pistol: '#ffd166', shotgun: '#ff9f43', smg: '#8ecae6', molotov: '#ff6b35',
  tesla: '#7ee8fa', frost: '#9ad0ff', blades: '#c9d1d9', grenade: '#e3b23c',
  power: '#ff6b6b', haste: '#ffd166', swift: '#7ee8fa', vigor: '#ff9f43',
  regen: '#8ce99a', magnet: '#b197fc', crit: '#ff4d6d', critdmg: '#ff8fa3',
  armor: '#adb5bd', luck: '#ffe066', study: '#74c0fc',
  ammo: '#e9c46a', barrel: '#ced4da', coolant: '#a5d8ff', fuel: '#ff8b3d',
  battery: '#66d9e8', core: '#99e9f2', belt: '#c0a37a', powder: '#d9a15b',
  helmet: '#9fb3c8', vest: '#7f9cb8', respirator: '#7ec8a0',
  plating: '#b8a06a', ram: '#e08c4a', harness: '#d8c37a',
  sliders: '#e9eef5', sound: '#8ce99a', mute: '#8b95a3', vibrate: '#7ee8fa',
  gauge: '#ffd166', trash: '#ff5a5a', chevronL: '#e9eef5'
};

names.forEach((k, idx) => {
  const cx = PAD + (idx % COLS) * (ICON + PAD);
  const cy = PAD + ((idx / COLS) | 0) * (ICON + PAD);
  const base = parse(PALETTE[k] || '#e9eef5');
  const lt = shade(base, 0.42);
  const dk = shade(base, -0.45);
  const rows = PIX[k];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      const col = ch === '+' ? lt : (ch === '-' ? dk : base);
      for (let yy = 0; yy < CELL; yy++) {
        for (let xx = 0; xx < CELL; xx++) {
          px(cx + c * CELL + xx, cy + r * CELL + yy, col);
        }
      }
    }
  }
});

const out = path.join(ROOT, 'docs/icons.png');
fs.writeFileSync(out, encodePNG(W, H, buf));
console.log(`✓ 预览图: ${out}  (${W}x${H}, ${names.length} 个图标)`);
console.log('顺序:');
names.forEach((k, i) => process.stdout.write((i % COLS === 0 ? '\n  ' : '') + k.padEnd(12)));
console.log('');
