/**
 * 打包 B站 Toy 发布包：目录形态（index.html + 外部 JS + 外部 BGM）
 * 用法: node tools/build-toy.js
 * 输出: dist/toy/  （index.html 入口 + app.js + bgm/bgm.mp3）
 *
 * 为什么不直接用 dist/highway-survivors.html：
 * Toy 平台对入口 index.html 有 1MB（解压后）硬上限，单文件版把代码、图集、
 * BGM（base64）全塞进 HTML，约 2MB，提交会被拒（错误码 307000）。
 * 所以这里把模块代码拆到 app.js，BGM 走外部相对路径（Audio.BGM_SRC 默认
 * 就是 'bgm/bgm.mp3'，不需要改源码），入口只剩壳。
 *
 * 图集与封面仍内联（加起来约 240KB，塞在 app.js 里没问题）。
 * 所有路径均为相对路径：页面实际跑在 /toy/<slug>/ 子路径下，绝对路径会 404。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist/toy');

/* ---- 1. 按 game.js 的 require 顺序收集模块 ---- */
const entry = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const files = [...entry.matchAll(/require\(['"](.+?)['"]\)/g)].map(m => m[1]);

const parts = files.map(rel => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error('缺少模块: ' + rel);
    process.exit(1);
  }
  const code = fs.readFileSync(abs, 'utf8');
  return `/* ======================== ${rel} ======================== */\n${code}`;
});

/* ---- 2. 图集内联成 data URI（12KB png → ~17KB base64，不值得单独发请求） ---- */
const sheetPath = path.join(ROOT, 'assets/sprites.png');
if (!fs.existsSync(sheetPath)) {
  console.error('缺少 assets/sprites.png，先运行: node tools/build-sprites.js');
  process.exit(1);
}
const sheetInline = `HS.SheetData.image = 'data:image/png;base64,` +
  fs.readFileSync(sheetPath).toString('base64') + `';`;

/* ---- 3. 模块代码合成 app.js（BGM 走外部文件，不内联） ---- */
const appJs = `/* 公路幸存者：死区 —— 浏览器/Toy 构建产物，由 tools/build-toy.js 生成 */
(function () {

window.addEventListener("error", function (e) { document.title = "JSERR: " + e.message; });

${parts.join('\n\n')}

${sheetInline}
HS.Main.boot();

/* 微信外的鼠标/触摸聚焦修复 */
document.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });

})();
`;

/* ---- 4. 入口 HTML：只留壳，相对路径引 app.js ---- */
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#070a0e">
<title>公路幸存者：死区 | Highway Survivors</title>
<style>
  html, body {
    margin: 0; padding: 0; height: 100%; overflow: hidden;
    background: #05070a; -webkit-tap-highlight-color: transparent;
    user-select: none; -webkit-user-select: none;
    font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  #game {
    display: block; width: 100vw; height: 100vh;
    touch-action: none; image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
  }
  #rotate {
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    color: #8b95a3; font-size: 14px; background: #05070a; z-index: 9;
  }
  @media (orientation: landscape) and (max-height: 520px) {
    #rotate { display: flex; }
  }
</style>
</head>
<body>
<canvas id="game"></canvas>
<div id="rotate">本游戏为竖屏体验，请把设备竖过来</div>
<!-- B站 Toy 官方 SDK：排行榜 / 云存档都走它，必须早于 app.js 加载。
     在站外打开时脚本也能加载，只是调用会 reject（HS.Host 已做降级） -->
<script src="https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js"></script>
<script src="./app.js"></script>
</body>
</html>
`;

/* ---- 5. 落盘 ---- */
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(path.join(OUT, 'app.js'), { force: true });
fs.writeFileSync(path.join(OUT, 'app.js'), appJs, 'utf8');
fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');

/* BGM 以外部文件形式提供（Audio.BGM_SRC 默认 'bgm/bgm.mp3'，相对 index.html） */
const bgmSrc = path.join(ROOT, 'bgm/bgm.mp3');
const bgmDir = path.join(OUT, 'bgm');
if (fs.existsSync(bgmSrc)) {
  fs.mkdirSync(bgmDir, { recursive: true });
  fs.copyFileSync(bgmSrc, path.join(bgmDir, 'bgm.mp3'));
} else {
  console.warn('警告: 缺少 bgm/bgm.mp3，打包结果将没有背景音乐');
}

const kb = n => Math.round(n / 1024) + ' KB';
console.log('built: ' + path.join(OUT, 'index.html') + '  (' + kb(Buffer.byteLength(html)) + ')');
console.log('       ' + path.join(OUT, 'app.js') + '  (' + kb(Buffer.byteLength(appJs)) + ', ' + files.length + ' modules)');
if (fs.existsSync(bgmSrc)) {
  console.log('       ' + path.join(bgmDir, 'bgm.mp3') + '  (' + kb(fs.statSync(bgmSrc).size) + ')');
}
