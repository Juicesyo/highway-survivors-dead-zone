/**
 * 极简 PNG 解码器（只读，供美术处理脚本用）
 *
 * 只支持本项目会用到的子集：8bit 灰度 / 灰度+alpha / RGB / RGBA，非隔行。
 * 返回 { w, h, data }，data 是 RGBA 的 Buffer。
 */
const fs = require('fs');
const zlib = require('zlib');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readPNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG: ' + file);
  let off = 8;
  let w = 0, h = 0, depth = 8, ctype = 6, interlace = 0;
  const idat = [];
  let palette = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; ctype = body[9]; interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error('只支持 8bit，当前 ' + depth);
  if (interlace) throw new Error('不支持隔行 PNG');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error('不支持的颜色类型 ' + ctype);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let pos = 0;

  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error('未知过滤器 ' + filter);
      cur[i] = v & 255;
    }
    cur.copy(prev);

    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      if (ctype === 6) {
        const si = x * 4;
        out[di] = cur[si]; out[di + 1] = cur[si + 1];
        out[di + 2] = cur[si + 2]; out[di + 3] = cur[si + 3];
      } else if (ctype === 2) {
        const si = x * 3;
        out[di] = cur[si]; out[di + 1] = cur[si + 1];
        out[di + 2] = cur[si + 2]; out[di + 3] = 255;
      } else if (ctype === 0) {
        const g = cur[x];
        out[di] = g; out[di + 1] = g; out[di + 2] = g; out[di + 3] = 255;
      } else if (ctype === 4) {
        const g = cur[x * 2];
        out[di] = g; out[di + 1] = g; out[di + 2] = g; out[di + 3] = cur[x * 2 + 1];
      } else if (ctype === 3) {
        const pi = cur[x] * 3;
        out[di] = palette[pi]; out[di + 1] = palette[pi + 1]; out[di + 2] = palette[pi + 2];
        out[di + 3] = trns && cur[x] < trns.length ? trns[cur[x]] : 255;
      }
    }
  }
  return { w: w, h: h, data: out };
}

module.exports = { readPNG };

if (require.main === module) {
  const f = process.argv[2];
  const im = readPNG(f);
  const px = (x, y) => {
    const i = (y * im.w + x) * 4;
    return [im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]];
  };
  console.log(f, im.w + 'x' + im.h);
  console.log('corner', px(0, 0), px(im.w - 1, 0), px(0, im.h - 1), px(im.w - 1, im.h - 1));
  let opaque = 0, semi = 0;
  for (let i = 3; i < im.data.length; i += 4) {
    if (im.data[i] > 250) opaque++; else if (im.data[i] > 8) semi++;
  }
  console.log('opaque', opaque, 'semi', semi, 'of', im.w * im.h);
}
