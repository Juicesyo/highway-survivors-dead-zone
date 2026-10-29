/**
 * 鲸鱼娘素材生成：从 assets/dafeiyu-chibi-character/*.png 出两张图
 *
 * 用法: node tools/gen-whale.js [--raw]
 *
 *   1. assets/whale.png       48x56 的 7 帧精灵表，进图集当主角：
 *                            0 站立 A / 1 站立 B（呼吸） / 2~5 行走四拍 / 6 开心跳
 *   2. assets/whale-full.png  121x161 立绘，给研究所角色页 / 结算头像用
 *
 * 原图是「2 倍放大的像素画」：单个角色约 487x647，背景是一层近白噪点、没有 alpha，
 * 所以先按亮度从四边泛洪抠背景（直接按亮度切会把白围裙一起抠掉），
 * 再按公共比例缩到 48x56 —— 两张帧共用一个缩放比，换表情时人才不会忽大忽小。
 *
 * 颜色：原图有 7 万种颜色（AI 生成的抖动噪点），直接缩会发灰。
 * 这里对整只角色的像素做 k-means 收敛到 26 色，再逐像素映射，
 * 出来就是干净的点阵色块。--raw 可以跳过这步看原色。
 */
const fs = require('fs');
const path = require('path');
const { readPNG } = require('./imgread');
const { encodePNG } = require('./png');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'assets/dafeiyu-chibi-character');

/* 目标尺寸：px:2 绘制 → 世界 24x28 */
const FW = 48, FH = 56;
const PORTRAIT_W = 121, PORTRAIT_H = 161;
const COLORS = 26;

/* ---------------- 抠图 ---------------- */

function isBg(data, i) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx > 218 && mx - mn < 14;
}

function bgMask(im) {
  const { w, h, data } = im;
  const bg = new Uint8Array(w * h);
  const st = [];
  for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
  while (st.length) {
    const p = st.pop();
    if (bg[p] || !isBg(data, p * 4)) continue;
    bg[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) st.push(p - 1);
    if (x < w - 1) st.push(p + 1);
    if (y > 0) st.push(p - w);
    if (y < h - 1) st.push(p + w);
  }
  return bg;
}

function components(im, bg, minArea) {
  const { w, h } = im;
  const seen = new Uint8Array(w * h);
  const label = new Int32Array(w * h).fill(-1);
  const list = [];

  for (let p0 = 0; p0 < w * h; p0++) {
    if (bg[p0] || seen[p0]) continue;
    const id = list.length;
    const q = [p0];
    seen[p0] = 1;
    let cnt = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    while (q.length) {
      const c = q.pop();
      label[c] = id;
      cnt++;
      const x = c % w, y = (c / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !bg[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; q.push(c - 1); }
      if (x < w - 1 && !bg[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; q.push(c + 1); }
      if (y > 0 && !bg[c - w] && !seen[c - w]) { seen[c - w] = 1; q.push(c - w); }
      if (y < h - 1 && !bg[c + w] && !seen[c + w]) { seen[c + w] = 1; q.push(c + w); }
    }
    list.push({ id, cnt, x0, x1, y0, y1 });
  }
  list.sort((a, b) => b.cnt - a.cnt);
  return { list: list.filter(c => c.cnt >= minArea), label };
}


/* 原图脚底下有一层灰色地面投影，它和靴子是连在一起的（同一个连通域），
   所以按连通域切不掉。做法：取底边几行里出现最多的颜色 = 投影色，
   再从底边往里泛洪，把同色的一整片抹掉。靴子是深藏青，不会被误伤。 */
function stripShadow(im, keep, box) {
  const { w } = im;
  let tol = 16;
  const rows = 3;
  const hist = new Map();
  for (let y = box.y1 - rows + 1; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const p = y * w + x;
      if (!keep[p]) continue;
      const i = p * 4;
      const c = (im.data[i] >> 3 << 10) | (im.data[i + 1] >> 3 << 5) | (im.data[i + 2] >> 3);
      hist.set(c, (hist.get(c) || 0) + 1);
    }
  }
  let best = -1, bestN = -1;
  hist.forEach((v, k) => { if (v > bestN) { bestN = v; best = k; } });
  if (best < 0) return 0;
  const sc = [(best >> 10) << 3, ((best >> 5) & 31) << 3, (best & 31) << 3];
  const near = (p) => {
    const i = p * 4;
    return Math.abs(im.data[i] - sc[0]) <= tol &&
      Math.abs(im.data[i + 1] - sc[1]) <= tol &&
      Math.abs(im.data[i + 2] - sc[2]) <= tol;
  };
  let n = 0;
  /* 两轮：先用紧容差吃掉投影本体，再用松容差扫掉抗锯齿的毛边。
     靴子是深藏青（亮度和色相都差得远），不会被松容差误伤。 */
  const seen = new Uint8Array(im.w * im.h);
  for (const T of [16, 46]) {
    tol = T;
    st = [];
    for (let y = box.y1 - rows + 1; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const p = y * w + x;
        if (keep[p] && near(p)) st.push(p);
      }
    }
    while (st.length) {
      const p = st.pop();
      if (!keep[p] || !near(p)) continue;
      keep[p] = 0;
      n++;
      const x = p % w, y = (p / w) | 0;
      if (x > box.x0) st.push(p - 1);
      if (x < box.x1) st.push(p + 1);
      if (y > box.y0) st.push(p - w);
    }
  }
  return n;
}

/* ---------------- 缩放 ---------------- */

/** 面积平均缩放：源矩形 → dw x dh，返回 {rgba} */
function shrink(im, keep, box, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx0 = box.x0 + Math.floor(x * bw / dw), sx1 = box.x0 + Math.floor((x + 1) * bw / dw);
      const sy0 = box.y0 + Math.floor(y * bh / dh), sy1 = box.y0 + Math.floor((y + 1) * bh / dh);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          n++;
          const p = sy * im.w + sx;
          if (!keep[p]) continue;
          const i = p * 4;
          r += im.data[i]; g += im.data[i + 1]; b += im.data[i + 2];
          a++;
        }
      }
      if (!n || a / n < 0.5) continue;
      const o = (y * dw + x) * 4;
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
      out[o + 3] = 255;
    }
  }
  return out;
}

/* ---------------- 调色板收敛 ---------------- */

function kmeans(pts, k) {
  let cs = [];
  for (let i = 0; i < k; i++) cs.push(pts[Math.floor(pts.length * (i + 0.5) / k)].slice());
  const d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  for (let it = 0; it < 20; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < k; j++) { const d = d2(p, cs[j]); if (d < bd) { bd = d; bi = j; } }
      const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    for (let j = 0; j < k; j++) {
      const s = sum[j];
      if (s[3]) cs[j] = [Math.round(s[0] / s[3]), Math.round(s[1] / s[3]), Math.round(s[2] / s[3])];
    }
  }
  return cs;
}

function quantize(bufs, palette) {
  const d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  for (const buf of bufs) {
    for (let i = 0; i < buf.length; i += 4) {
      if (!buf[i + 3]) continue;
      const p = [buf[i], buf[i + 1], buf[i + 2]];
      let bi = 0, bd = Infinity;
      for (let j = 0; j < palette.length; j++) { const d = d2(p, palette[j]); if (d < bd) { bd = d; bi = j; } }
      buf[i] = palette[bi][0]; buf[i + 1] = palette[bi][1]; buf[i + 2] = palette[bi][2];
    }
  }
}

/* ---------------- 主流程 ---------------- */

const sheet = readPNG(path.join(SRC_DIR, 'chibi-2.png'));
const bg = bgMask(sheet);
const comp = components(sheet, bg, 40000);
const chars = comp.list;
const top = chars.slice(0, 8).sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
const BOX_NEUTRAL = top[1];          // 第一行中间：默认严肃脸
const BOX_HAPPY = top[0];            // 第一行最左：跳起来的开心脸

/* 只保留"这个角色"的像素：原图里的地面投影、黄星星都是独立连通域，
   不剔掉的话会跟着人物一起进图集（脚下多一条灰影子）。 */
function keepOf(box, compRef, im) {
  compRef = compRef || comp;
  im = im || sheet;
  const keep = new Uint8Array(im.w * im.h);
  for (let p = 0; p < im.w * im.h; p++) keep[p] = compRef.label[p] === box.id ? 1 : 0;
  return keep;
}
const KEEP_NEUTRAL = keepOf(BOX_NEUTRAL);
const KEEP_HAPPY = keepOf(BOX_HAPPY);
const sh0 = stripShadow(sheet, KEEP_NEUTRAL, BOX_NEUTRAL);
const sh1 = stripShadow(sheet, KEEP_HAPPY, BOX_HAPPY);
console.log('  抹掉地面投影 ' + sh0 + ' / ' + sh1 + ' 像素');

console.log('chibi-2.png ' + sheet.w + 'x' + sheet.h + '，割出 ' + chars.length + ' 个角色');
console.log('  默认脸 ' + (BOX_NEUTRAL.x1 - BOX_NEUTRAL.x0 + 1) + 'x' + (BOX_NEUTRAL.y1 - BOX_NEUTRAL.y0 + 1) +
  ' @' + BOX_NEUTRAL.x0 + ',' + BOX_NEUTRAL.y0);
console.log('  开心帧 ' + (BOX_HAPPY.x1 - BOX_HAPPY.x0 + 1) + 'x' + (BOX_HAPPY.y1 - BOX_HAPPY.y0 + 1) +
  ' @' + BOX_HAPPY.x0 + ',' + BOX_HAPPY.y0);

/* 公共缩放比：两帧都得塞进 48x56 */
function boxSize(b) { return [b.x1 - b.x0 + 1, b.y1 - b.y0 + 1]; }
const [nw, nh] = boxSize(BOX_NEUTRAL);
const [hw, hh] = boxSize(BOX_HAPPY);
const K = Math.max(nw / FW, nh / FH, hw / FW, hh / FH);
console.log('\n公共缩放比 ' + K.toFixed(3) + ' 源像素/目标像素');

function frame(box, keep, im, KS, targetH) {
  im = im || sheet;
  KS = KS || K;
  const [bw, bh] = boxSize(box);
  /* targetH：把这一格的高度对齐到统一行数（三视图和 chibi-2 不是同一张图，
     各自按高度归一会差出好几行，切朝向时人会突然变高变矮）。
     直接按目标高度反推缩放比，一次采样到底，不重采样第二遍。 */
  if (targetH) {
    const KS2 = bh / targetH;
    const dw2 = Math.max(1, Math.round(bw / KS2));
    const small2 = shrink(im, keep, box, dw2, targetH);
    const out2 = new Uint8Array(FW * FH * 4);
    const ox2 = Math.floor((FW - dw2) / 2);
    const oy2 = FH - targetH;
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < dw2; x++) {
        const si2 = (y * dw2 + x) * 4;
        const di2 = ((oy2 + y) * FW + ox2 + x) * 4;
        out2[di2] = small2[si2]; out2[di2 + 1] = small2[si2 + 1];
        out2[di2 + 2] = small2[si2 + 2]; out2[di2 + 3] = small2[si2 + 3];
      }
    }
    return { buf: out2, dw: dw2, dh: targetH, ox: ox2, oy: oy2 };
  }
  const dw = Math.max(1, Math.round(bw / KS));
  const dh = Math.max(1, Math.round(bh / KS));
  const small = shrink(im, keep, box, dw, dh);
  const out = new Uint8Array(FW * FH * 4);
  const ox = Math.floor((FW - dw) / 2);
  const oy = FH - dh;                       // 脚底对齐底边
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const si = (y * dw + x) * 4, di = ((oy + y) * FW + ox + x) * 4;
      out[di] = small[si]; out[di + 1] = small[si + 1];
      out[di + 2] = small[si + 2]; out[di + 3] = small[si + 3];
    }
  }
  return { buf: out, dw, dh, ox, oy };
}

/* ---------------- 动画帧派生 ----------------
 *
 * 原图只给了「正面站姿」和「开心跳」，没有正面行走的分帧，所以行走帧是从站姿
 * 派生出来的：把下半身（裙摆以下）按中线切成左右两条腿，各自平移 / 抬升，
 * 上半身做 1px 起伏。48x56 这个尺寸下人眼看不出"是软件挪的"，
 * 但腿交替踏步、身体随之起伏，比原来贴地平移自然得多。
 */

/** 整块平移（dx, dy），空出来的地方保持透明 */
function shift(buf, dx, dy) {
  const out = new Uint8Array(buf.length);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const si = (y * FW + x) * 4;
      if (!buf[si + 3]) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= FW || ny < 0 || ny >= FH) continue;
      const di = (ny * FW + nx) * 4;
      out[di] = buf[si]; out[di + 1] = buf[si + 1];
      out[di + 2] = buf[si + 2]; out[di + 3] = buf[si + 3];
    }
  }
  return out;
}

function rowSegs(buf, y) {
  const segs = [];
  let inSeg = false, st = 0;
  for (let x = 0; x < FW; x++) {
    const a = buf[(y * FW + x) * 4 + 3] > 8;
    if (a && !inSeg) { inSeg = true; st = x; }
    else if (!a && inSeg) { inSeg = false; segs.push([st, x - 1]); }
  }
  if (inSeg) segs.push([st, FW - 1]);
  return segs;
}

/**
 * 收尾清理：原图投影清完后底部还会剩几粒渣，先按"最低实心行"切齐，
 * 再把整帧下移贴底，保证脚底永远落在 FH-1（drawActor 按帧中心对齐，
 * 脚底位置一变，人在场景里就会浮起来）。
 */
function tidy(f) {
  let lastSolid = -1;
  for (let y = FH - 1; y >= 0; y--) {
    /* 要一整段够宽才算"脚"，零散渣子（影子的残点）不算 */
    const solid = rowSegs(f.buf, y).some((s) => s[1] - s[0] + 1 >= 8);
    if (solid) { lastSolid = y; break; }
  }
  if (lastSolid < 0) return f;
  for (let y = lastSolid + 1; y < FH; y++) {
    for (let x = 0; x < FW; x++) f.buf[(y * FW + x) * 4 + 3] = 0;
  }
  const dy = FH - 1 - lastSolid;
  if (dy !== 0) f.buf = shift(f.buf, 0, dy);
  return f;
}

/**
 * 找腿区：从底边往上收集"窄行"（靴子那几行只有 8~20 px 宽），
 * 一碰到裙摆那种整片宽行就停。正面是两只靴子并成一块，
 * 背面是左右分开的两块 —— 两种都要能处理，所以中线单独算出来。
 */
function findLegs(buf) {
  /* 只认"核心窄行"（宽度 <= 14 的靴块）：裙摆、发尾那些宽行会把中线带偏，
     之前 mid 就偏到了尾巴尖上，等于整块靴子一起横移而不是分腿。 */
  let top = -1, bottom = -1, x0 = 1e9, x1 = -1, gapMid = -1;
  for (let y = FH - 1; y >= 0; y--) {
    const segs = rowSegs(buf, y);
    if (!segs.length) continue;
    const total = segs.reduce((a, s) => a + (s[1] - s[0] + 1), 0);
    if (total > 14) {
      if (bottom >= 0) break;          // 已经进到腿区了，遇到宽行就收
      continue;                        // 底部的零星杂物，跳过
    }
    if (bottom < 0) bottom = y;
    top = y;
    segs.forEach((s) => { x0 = Math.min(x0, s[0]); x1 = Math.max(x1, s[1]); });
    if (segs.length === 2 && gapMid < 0) gapMid = Math.round((segs[0][1] + segs[1][0]) / 2);
  }
  if (bottom < 0 || top >= bottom) return null;
  return {
    top, bottom, x0, x1,
    mid: gapMid > 0 ? gapMid : Math.round((x0 + x1) / 2)
  };
}

/** 派生一帧：腿按中线切成左右两条各自平移/抬升，其余部分整体平移 */
function legPose(base, legs, dxL, dyL, dxR, dyR, bodyDx, bodyDy, bodyCut) {
  const mid = legs ? legs.mid : -1;
  const cut = bodyCut !== undefined ? bodyCut : (legs ? legs.top : FH);
  const out = new Uint8Array(base.length);
  const put = (x, y, si) => {
    if (x < 0 || y < 0 || x >= FW || y >= FH) return;
    const di = (y * FW + x) * 4;
    if (out[di + 3]) return;
    out[di] = base[si]; out[di + 1] = base[si + 1];
    out[di + 2] = base[si + 2]; out[di + 3] = base[si + 3];
  };
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const si = (y * FW + x) * 4;
      if (!base[si + 3]) continue;
      if (mid >= 0 && y >= cut) {
        const left = x <= mid;
        put(x + (left ? dxL : dxR), y + (left ? dyL : dyR), si);
      } else {
        put(x + bodyDx, y + bodyDy, si);
      }
    }
  }
  return out;
}

/**
 * 没分腿的朝向（背面 / 侧面）：腿被长裙盖住，分不出左右两条，
 * 硬切只会把裙子撕开。改成整体上下 1px 起伏 + 肩线以上左右摆 1px ——
 * 脚不动、上身晃，走路时的重心转移照样看得出来。
 */
function bobPose(base, dy, topDx, topCut) {
  const cut = topCut === undefined ? 30 : topCut;
  const out = new Uint8Array(base.length);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const si = (y * FW + x) * 4;
      if (!base[si + 3]) continue;
      const nx = x + (y < cut ? topDx : 0);
      const ny = y + dy;
      if (nx < 0 || nx >= FW || ny < 0 || ny >= FH) continue;
      const di = (ny * FW + nx) * 4;
      if (out[di + 3]) continue;
      out[di] = base[si]; out[di + 1] = base[si + 1];
      out[di + 2] = base[si + 2]; out[di + 3] = base[si + 3];
    }
  }
  return out;
}

/** 水平镜像（右侧面直接由左侧面翻出来，原图第 4 格被裁掉了一截） */
function mirrorX(buf) {
  const out = new Uint8Array(buf.length);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const si = (y * FW + x) * 4;
      if (!buf[si + 3]) continue;
      const di = (y * FW + (FW - 1 - x)) * 4;
      out[di] = buf[si]; out[di + 1] = buf[si + 1];
      out[di + 2] = buf[si + 2]; out[di + 3] = buf[si + 3];
    }
  }
  return out;
}

/**
 * 一个朝向的 6 帧：站立 A / 站立 B（整体下沉 1px 当呼吸）/ 行走四拍。
 * 下沉而不是上浮 —— 裙摆比腿宽，往下压会盖住腿根，不会在裙子和靴子之间露缝。
 */
function deriveSet(base, name, mode) {
  if (mode === 'bob') {
    console.log('  ' + name + ' 用起伏 + 上身摆动');
    return [
      { name: name + '_0', buf: base },
      { name: name + '_1', buf: bobPose(base, -1, 0) },
      { name: name + '_2', buf: bobPose(base, 0, -1) },
      { name: name + '_3', buf: bobPose(base, -1, 0) },
      { name: name + '_4', buf: bobPose(base, 0, 1) },
      { name: name + '_5', buf: bobPose(base, -1, 0) }
    ];
  }
  const legs = findLegs(base);
  if (!legs) return deriveSet(base, name, 'bob');
  console.log('  ' + name + ' 分腿踏步 y' + legs.top + '..' + legs.bottom + ' x' + legs.x0 + '..' + legs.x1 + ' mid' + legs.mid);
  return [
    { name: name + '_0', buf: base },
    { name: name + '_1', buf: legPose(base, legs, 0, 0, 0, 0, 0, 1) },
    { name: name + '_2', buf: legPose(base, legs, -1, 0, 1, 0, 0, 1) },
    { name: name + '_3', buf: legPose(base, legs, 0, -2, 0, 0, 1, 0) },
    { name: name + '_4', buf: legPose(base, legs, 1, 0, -1, 0, 0, 1) },
    { name: name + '_5', buf: legPose(base, legs, 0, 0, 0, -2, -1, 0) }
  ];
}

const f0 = tidy(frame(BOX_NEUTRAL, KEEP_NEUTRAL));
const f1 = tidy(frame(BOX_HAPPY, KEEP_HAPPY));

/* ---------------- 三视图：背面 / 左侧面 ----------------
 *
 * chibi-3 是一张 4 列 x 3 行的三视图（正面 / 背面 / 左侧 / 右侧 x 三种表情）。
 * 取最下面那一行（表情最严肃），按 x 排：正面、背面、左侧、右（被图边裁掉了一截）。
 * 右侧面不用原图第 4 格，直接把左侧面镜像 —— 免得两边的比例对不上。
 */
const sheet3 = readPNG(path.join(SRC_DIR, 'chibi-3.png'));
const bg3 = bgMask(sheet3);
const comp3 = components(sheet3, bg3, 40000);
const row3 = comp3.list.slice(0, 12)
  .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0))
  .slice(8, 12)
  .sort((a, b) => a.x0 - b.x0);

/* 高度统一到和正面同一行数（正面帧内容 52 行），换朝向时不跳高矮 */
const H_TARGET = 52;
function viewFrame(box) {
  const keep = keepOf(box, comp3, sheet3);
  stripShadow(sheet3, keep, box);
  return tidy(frame(box, keep, sheet3, 1, H_TARGET));
}
const fBack = viewFrame(row3[1]);
const fSide = viewFrame(row3[2]);
console.log('三视图: 背面 ' + fBack.dw + 'x' + fBack.dh + '  左侧 ' + fSide.dw + 'x' + fSide.dh);

/* 帧序（25 帧）：
 *   0..5   朝下（正面）站立A / 站立B / 行走四拍
 *   6      搜刮成功的开心跳（正面）
 *   7..12  朝上（背面）
 *   13..18 朝左（左侧面）
 *   19..24 朝右（左侧面镜像）
 */
console.log('派生动画帧：');
const SET_DN = deriveSet(f0.buf, 'dn');
const SET_UP = deriveSet(fBack.buf, 'up', 'bob');
const SET_LF = deriveSet(fSide.buf, 'lf', 'bob');
const SET_RT = deriveSet(mirrorX(fSide.buf), 'rt', 'bob');

const FRAMES = SET_DN.concat([{ name: 'cheer', buf: f1.buf }], SET_UP, SET_LF, SET_RT);

/* 调色板：全部帧一起收敛，避免行走帧和站立帧偏色 */
const raw = process.argv.indexOf('--raw') >= 0;
if (!raw) {
  const pts = [];
  for (const f of FRAMES) {
    for (let i = 0; i < f.buf.length; i += 4) {
      if (f.buf[i + 3]) pts.push([f.buf[i], f.buf[i + 1], f.buf[i + 2]]);
    }
  }
  const pal = kmeans(pts, COLORS);
  quantize(FRAMES.map((f) => f.buf), pal);
  console.log('调色板 ' + pal.length + ' 色（k-means）');
}

/* 拼成一条 7*48 x 56 的精灵表 */
const SHEET_W = FW * FRAMES.length;
const whale = Buffer.alloc(SHEET_W * FH * 4);
function blit(dst, dw, src, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = (y * sw + x) * 4;
      if (!src[si + 3]) continue;
      const di = ((dy + y) * dw + dx + x) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
}
FRAMES.forEach((f, i) => blit(whale, SHEET_W, f.buf, FW, FH, i * FW, 0));

fs.writeFileSync(path.join(ROOT, 'assets/whale.png'), encodePNG(SHEET_W, FH, whale));

/* 立绘：原图的逻辑分辨率再半档（487x647 的像素块是 2x2）→ 121x161 */
const portrait = shrink(sheet, KEEP_NEUTRAL, BOX_NEUTRAL, PORTRAIT_W, PORTRAIT_H);
fs.writeFileSync(path.join(ROOT, 'assets/whale-full.png'), encodePNG(PORTRAIT_W, PORTRAIT_H, Buffer.from(portrait)));

const kb = (p) => (fs.statSync(path.join(ROOT, p)).size / 1024).toFixed(1) + ' KB';
console.log('\nassets/whale.png       ' + SHEET_W + 'x' + FH + '  ' + FRAMES.length + ' 帧  ' + kb('assets/whale.png'));
console.log('  帧序: ' + FRAMES.map((f, i) => i + ':' + f.name).join('  '));
console.log('  站立内容 ' + f0.dw + 'x' + f0.dh + '   开心内容 ' + f1.dw + 'x' + f1.dh);
console.log('assets/whale-full.png  ' + PORTRAIT_W + 'x' + PORTRAIT_H + '  ' + kb('assets/whale-full.png'));
