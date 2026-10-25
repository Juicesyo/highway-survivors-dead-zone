/**
 * 用根目录的 image.png 生成 Toy 图标（512x512，≤512KB）
 * 用法: node tools/make-icon.js
 * 输出: dist/toy-icon.png
 *
 * 为什么单独写：原图 1024x1024 / 1.1MB，超平台 512KB 上限；
 * 像素画必须最近邻缩放（关掉平滑），否则边缘发糊。
 */
const fs = require('fs');
const path = require('path');

function loadPuppeteer() {
  for (const m of ['puppeteer-core', 'puppeteer']) {
    try { return require(m); } catch (e) { /* 继续找 */ }
  }
  console.error('找不到 puppeteer-core，请设置 NODE_PATH 指向含该包的 node_modules');
  process.exit(1);
}

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'image.png');
const OUT = path.join(ROOT, 'dist/toy-icon.png');
const SIZE = 512;
const MAX_BYTES = 512 * 1024;

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('缺少 image.png');
    process.exit(1);
  }
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('找不到 Chrome / Edge'); process.exit(1); }

  const b64 = fs.readFileSync(SRC).toString('base64');
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage();

  const dataUrl = await page.evaluate(async (b64, size) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;      /* 像素画：最近邻，别平滑 */
    ctx.drawImage(img, 0, 0, size, size);
    return cv.toDataURL('image/png');
  }, b64, SIZE);

  await browser.close();

  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (buf.length > MAX_BYTES) {
    console.error('图标仍超过 512KB（' + Math.round(buf.length / 1024) + 'KB），需要再缩');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log('built: dist/toy-icon.png (' + SIZE + 'x' + SIZE + ', ' + Math.round(buf.length / 1024) + ' KB)');
})();
