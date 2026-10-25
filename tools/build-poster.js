/**
 * 生成 Toy 发布用的封面（1200x900）与图标（512x512）
 * 用法: node tools/build-poster.js
 * 输出: dist/toy-poster.png / dist/toy-icon.png
 *
 * 依赖 puppeteer-core（同 tools/shots.js，不装进项目，走 NODE_PATH）。
 * 封面用 assets/title-bg.jpg 铺满 + 标题文字，保证 4:3 不裁掉主体。
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
const puppeteer = loadPuppeteer();

/* 封面：底层铺封面画，上层压暗 + 标题字 */
const posterHtml = (b64) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:900px;overflow:hidden;background:#05070a}
  .bg{position:absolute;inset:0;background:url(data:image/jpeg;base64,${b64}) center/cover no-repeat;
      transform:scale(1.06)}
  .shade{position:absolute;inset:0;background:
     radial-gradient(120% 80% at 50% 40%, rgba(5,7,10,0) 0%, rgba(5,7,10,.55) 70%, rgba(5,7,10,.92) 100%),
     linear-gradient(180deg, rgba(5,7,10,.55) 0%, rgba(5,7,10,0) 28%, rgba(5,7,10,.15) 55%, rgba(5,7,10,.95) 100%)}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
        justify-content:center;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
  .kicker{color:#ff6a3d;letter-spacing:8px;font-size:20px;font-weight:700;margin-bottom:18px;
          text-shadow:0 2px 10px rgba(0,0,0,.9)}
  .title{color:#f4f6f8;font-size:118px;font-weight:900;letter-spacing:6px;
         text-shadow:0 4px 0 #171a20, 0 10px 40px rgba(0,0,0,.95);line-height:1.05}
  .bar{margin-top:26px;display:flex;align-items:center;gap:22px}
  .line{width:70px;height:3px;background:linear-gradient(90deg,rgba(255,106,61,0),#ff4a2e)}
  .line.r{background:linear-gradient(90deg,#ff4a2e,rgba(255,106,61,0))}
  .zone{background:#e02b1d;color:#fff;font-size:44px;font-weight:900;letter-spacing:6px;
        padding:8px 26px;transform:skewX(-8deg);
        box-shadow:0 10px 30px rgba(224,43,29,.45)}
  .sub{margin-top:34px;color:#c3cbd6;font-size:24px;letter-spacing:4px;
       text-shadow:0 2px 12px rgba(0,0,0,.9)}
</style></head><body>
<div class="bg"></div><div class="shade"></div>
<div class="wrap">
  <div class="kicker">HIGHWAY SURVIVORS</div>
  <div class="title">公路幸存者</div>
  <div class="bar"><div class="line"></div><div class="zone">死区</div><div class="line r"></div></div>
  <div class="sub">像素肉鸽 · 高速打丧尸</div>
</div>
</body></html>`;

/* 图标：正方形裁切封面画 + 右下角红色方块，1024 内取 512 */
const iconHtml = (b64) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:512px;height:512px;overflow:hidden;background:#05070a}
  .bg{position:absolute;inset:0;background:url(data:image/jpeg;base64,${b64}) center/cover no-repeat}
  .shade{position:absolute;inset:0;background:
     radial-gradient(90% 90% at 50% 45%, rgba(5,7,10,.05) 0%, rgba(5,7,10,.72) 100%)}
  .z{position:absolute;left:0;right:0;bottom:54px;text-align:center;
     font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:104px;font-weight:900;
     color:#fff;letter-spacing:8px;text-shadow:0 6px 0 #171a20,0 0 40px rgba(0,0,0,.9)}
</style></head><body>
<div class="bg"></div><div class="shade"></div><div class="z">死区</div>
</body></html>`;

(async () => {
  const bgPath = path.join(ROOT, 'assets/title-bg.jpg');
  if (!fs.existsSync(bgPath)) {
    console.error('缺少 assets/title-bg.jpg');
    process.exit(1);
  }
  const b64 = fs.readFileSync(bgPath).toString('base64');
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) { console.error('找不到 Chrome / Edge'); process.exit(1); }

  const outDir = path.join(ROOT, 'dist');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage();

  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
  await page.setContent(posterHtml(b64), { waitUntil: 'load' });
  await page.screenshot({ path: path.join(outDir, 'toy-poster.png') });

  await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
  await page.setContent(iconHtml(b64), { waitUntil: 'load' });
  await page.screenshot({ path: path.join(outDir, 'toy-icon.png') });

  await browser.close();
  const poster = fs.statSync(path.join(outDir, 'toy-poster.png')).size;
  const icon = fs.statSync(path.join(outDir, 'toy-icon.png')).size;
  console.log('built: dist/toy-poster.png (' + Math.round(poster / 1024) + ' KB, 1200x900)');
  console.log('       dist/toy-icon.png (' + Math.round(icon / 1024) + ' KB, 512x512)');
})();
