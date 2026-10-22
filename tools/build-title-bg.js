/**
 * 生成标题页封面资源：assets/title-bg.jpg → assets/title-bg.js（base64 内联）
 * 用法: node tools/build-title-bg.js
 * 图片来源: assets/title-bg.jpg（手绘封面，约 168KB，内联后 ~225KB）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = path.join(ROOT, 'assets/title-bg.jpg');
const out = path.join(ROOT, 'assets/title-bg.js');

if (!fs.existsSync(src)) {
  console.error('缺少 assets/title-bg.jpg');
  process.exit(1);
}

const b64 = fs.readFileSync(src).toString('base64');
const js = `/* 自动生成：node tools/build-title-bg.js —— 手绘标题封面（data URI 内联） */\n` +
  `(function () {\n` +
  `  var G = typeof GameGlobal !== 'undefined' ? GameGlobal\n` +
  `    : (typeof window !== 'undefined' ? window : globalThis);\n` +
  `  G.HS = G.HS || {};\n` +
  `  G.HS.TitleBgData = { image: 'data:image/jpeg;base64,${b64}' };\n` +
  `})();\n`;

fs.writeFileSync(out, js, 'utf8');
console.log('title-bg.js: ' + Math.round(js.length / 1024) + 'KB');
