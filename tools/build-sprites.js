/**
 * 精灵图集烘焙：src/data/spriteDefs.js  ->  assets/sprites.png + assets/sprites.js/.json
 *
 * 用法: node tools/build-sprites.js
 *
 * 图集规则：
 *   - 固定单元格（默认 18x20），每格放一帧，帧在格内居中
 *   - 帧名即索引，JSON 里记录了每帧的精确矩形
 *   - 透明像素保持完全透明
 *
 * 想换手绘美术：按 assets/sprites.json 的 frames 矩形直接重画 sprites.png 即可，
 * 只要不改变帧矩形与命名，代码一行都不用动。
 */
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./png');
const { readPNG } = require('./imgread');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets');

const data = require(path.join(ROOT, 'src/data/spriteDefs.js'));

/* ---------------- 颜色 ---------------- */

function hex(c) {
  if (c.charAt(0) === '#') c = c.substring(1);
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  const n = parseInt(c, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(c1, c2, t) {
  const a = hex(c1), b = hex(c2);
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

/* ---------------- 布局 ---------------- */

const meta = data.meta;
const cellW = meta.cellW;
const cellH = meta.cellH;
const cols = meta.cols;
const margin = meta.margin;
const list = data.frameList;

const rows = Math.ceil(list.length / cols);
const sheetW = margin * 2 + cols * cellW;
const sheetH = margin * 2 + rows * cellH;
const buf = Buffer.alloc(sheetW * sheetH * 4, 0);

function put(px, py, rgb, a) {
  if (px < 0 || py < 0 || px >= sheetW || py >= sheetH) return;
  const i = (py * sheetW + px) * 4;
  buf[i] = rgb[0];
  buf[i + 1] = rgb[1];
  buf[i + 2] = rgb[2];
  buf[i + 3] = a === undefined ? 255 : a;
}

/* ---------------- 步态切分 ----------------
 * 找出「双腿分叉」的起始行：从底行往上扫，只要这一行的不透明像素
 * 被透明列分成 2 段以上就是腿部，遇到第一行整块（单段）就停。
 * 渲染时按这一行把精灵切成「上半身 / 左腿 / 右腿」，分别做抬腿动画。
 */
function opaque(def, x, y) {
  const row = def.rows[y] || '';
  const ch = row.charAt(x);
  if (!ch) return false;
  return !!def.pal[ch];
}

function legTop(def) {
  let lowest = -1;
  for (let y = def.h - 1; y >= 0; y--) {
    let segs = 0, inSeg = false;
    for (let x = 0; x < def.w; x++) {
      const s = opaque(def, x, y);
      if (s && !inSeg) { segs++; inSeg = true; }
      else if (!s) inSeg = false;
    }
    if (segs >= 2) lowest = y;
    else if (lowest >= 0) return lowest;
  }
  return -1;
}

/* ---------------- 位图帧 ----------------
 * 主角这类「原图直接进图集」的帧：从 data.bitmaps 声明的 PNG 里切一格贴进来，
 * 不经过字符点阵。px 同样只是绘制缩放（px:2 → 世界尺寸减半）。
 */
const bmpCache = {};
function loadBmp(name) {
  if (bmpCache[name]) return bmpCache[name];
  const bm = data.bitmaps && data.bitmaps[name];
  if (!bm) throw new Error('未声明的位图: ' + name);
  const im = readPNG(path.join(ROOT, bm.file));
  bmpCache[name] = im;
  return im;
}

/** 位图帧的腿部起始行：从底往上扫，能被透明列分成 2 段以上的行就是腿 */
function bmpLegTop(im, ox, oy, w, h) {
  const opaque = (x, y) => {
    const i = ((oy + y) * im.w + (ox + x)) * 4;
    return im.data[i + 3] > 8;
  };
  let lowest = -1;
  for (let y = h - 1; y >= 0; y--) {
    let segs = 0, inSeg = false;
    for (let x = 0; x < w; x++) {
      const s = opaque(x, y);
      if (s && !inSeg) { segs++; inSeg = true; }
      else if (!s) inSeg = false;
    }
    if (segs >= 2) lowest = y;
    else if (lowest >= 0) return lowest;
  }
  return -1;
}

/* ---------------- 烘焙 ---------------- */

const frames = {};

for (let idx = 0; idx < list.length; idx++) {
  const item = list[idx];
  const cx = margin + (idx % cols) * cellW;
  const cy = margin + Math.floor(idx / cols) * cellH;

  /* 位图帧 */
  if (item.bmp) {
    const bm = data.bitmaps[item.bmp];
    const im = loadBmp(item.bmp);
    const sx = (item.bi || 0) * bm.w;
    const ox = cx + Math.floor((cellW - bm.w) / 2);
    const oy = cy + Math.floor((cellH - bm.h) / 2);
    for (let y = 0; y < bm.h; y++) {
      for (let x = 0; x < bm.w; x++) {
        const i = (y * im.w + (sx + x)) * 4;
        const a = im.data[i + 3];
        if (a < 8) continue;
        put(ox + x, oy + y, [im.data[i], im.data[i + 1], im.data[i + 2]], a);
      }
    }
    const fr = { x: ox, y: oy, w: bm.w, h: bm.h };
    if (bm.px && bm.px !== 1) fr.s = 1 / bm.px;
    /* legs:false 的位图自己就是一整套姿势帧，不交给 drawActor 切片补间 */
    if (bm.legs !== false) {
      const legRow = bmpLegTop(im, sx, 0, bm.w, bm.h);
      if (legRow > 0) fr.lr = legRow;
    }
    frames[item.name] = fr;
    continue;
  }

  /* 道具帧：用绘制函数直接写像素 */
  if (item.prop) {
    const prop = data.props[item.prop];
    if (!prop) throw new Error('未知道具: ' + item.prop);
    const ox = cx + Math.floor((cellW - prop.w) / 2);
    const oy = cy + Math.floor((cellH - prop.h) / 2);
    const px = function (x, y, w, h, col) {
      const rgb = hex(col);
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) put(ox + xx, oy + yy, rgb, 255);
      }
    };
    prop.draw(px);
    frames[item.name] = { x: ox, y: oy, w: prop.w, h: prop.h };
    continue;
  }

  const def = data.defs[item.def];
  if (!def) throw new Error('未知点阵: ' + item.def);

  const ox = cx + Math.floor((cellW - def.w) / 2);
  const oy = cy + Math.floor((cellH - def.h) / 2);

  for (let y = 0; y < def.h; y++) {
    const row = def.rows[y] || '';
    for (let x = 0; x < def.w; x++) {
      const ch = row.charAt(x);
      if (!ch) continue;
      let col = def.pal[ch];
      if (!col) continue;
      if (item.pal && item.pal[ch]) col = item.pal[ch];

      let rgb;
      if (item.white) rgb = mix(col, '#ffffff', item.white);
      else if (item.tint) rgb = mix(col, item.tint, item.tintAmt);
      else rgb = hex(col);

      put(ox + x, oy + y, rgb, 255);
    }
  }

  /* px=2 表示这张点阵是 2 倍密度：按 0.5 缩放绘制，屏幕占位不变但细节翻倍 */
  const fr = { x: ox, y: oy, w: def.w, h: def.h };
  if (def.px && def.px !== 1) fr.s = 1 / def.px;
  /* lr：腿部起始行。渲染时据此把一帧拆成上下两段做迈步动画 */
  if (fr.lr === undefined) {
    const lr = legTop(def);
    if (lr > 0 && lr < def.h) fr.lr = lr;
  }
  frames[item.name] = fr;
}

/* ---------------- 输出 ---------------- */

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const pngPath = path.join(OUT_DIR, 'sprites.png');
fs.writeFileSync(pngPath, encodePNG(sheetW, sheetH, buf));

const sheet = {
  image: 'assets/sprites.png',
  size: { w: sheetW, h: sheetH },
  meta: meta,
  /* 立绘（研究所角色页）：不进图集，运行时单独加载，按原图逻辑分辨率 1:1 显示 */
  portrait: data.portrait || '',
  frames: frames
};

const json = JSON.stringify(sheet, null, 2);
fs.writeFileSync(path.join(OUT_DIR, 'sprites.json'), json, 'utf8');

const js =
  '/* 由 tools/build-sprites.js 自动生成，请勿手改。\n' +
  '   重绘 assets/sprites.png 后可只更新帧表，不必重跑生成器。 */\n' +
  '(function () {\n' +
  '  var G = typeof GameGlobal !== \'undefined\' ? GameGlobal\n' +
  '    : (typeof window !== \'undefined\' ? window : globalThis);\n' +
  '  var d = ' + json + ';\n' +
  '  G.HS = G.HS || {};\n' +
  '  G.HS.SheetData = d;\n' +
  '  if (typeof module !== \'undefined\' && module.exports) module.exports = d;\n' +
  '})();\n';
fs.writeFileSync(path.join(OUT_DIR, 'sprites.js'), js, 'utf8');

const kb = (fs.statSync(pngPath).size / 1024).toFixed(1);
console.log('atlas : assets/sprites.png  ' + sheetW + 'x' + sheetH + '  (' + kb + ' KB)');
console.log('frames: ' + list.length + ' 张  ->  assets/sprites.js / sprites.json');
console.log('cells : ' + cols + ' 列 x ' + rows + ' 行, 单元 ' + cellW + 'x' + cellH);
