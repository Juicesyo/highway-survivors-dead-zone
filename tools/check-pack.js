/**
 * 微信小游戏包体自检：按 project.config.json 的 packOptions.ignore 估算上传体积
 *
 * 用法: node tools/check-pack.js
 *
 * 微信主包上限 4MB（错误码 80051）。踩过一次：把 13MB 的原图素材目录
 * assets/dafeiyu-chibi-character 放进项目却没加进 ignore，真机调试直接上传失败。
 * 这个脚本就是那条规则的回归测试。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIMIT = 4096 * 1024;          // 主包上限 4MB
const cfg = require(path.join(ROOT, 'project.config.json'));
const ignore = (cfg.packOptions && cfg.packOptions.ignore) || [];

function ignored(rel) {
  return ignore.some((r) => {
    if (r.type === 'suffix') return rel.endsWith('.' + String(r.value).replace(/^\./, ''));
    if (r.type === 'folder') return rel === r.value || rel.startsWith(r.value + '/');
    return rel === r.value;
  });
}

const files = [];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (r === '.git' || r.startsWith('.git/')) continue;   // 开发者工具不上传 .git
    if (ignored(r)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, r);
    else files.push({ name: r, size: fs.statSync(p).size });
  }
})(ROOT, '');

files.sort((a, b) => b.size - a.size);
const total = files.reduce((s, f) => s + f.size, 0);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

console.log('上传体积 ' + kb(total) + ' / 上限 4096 KB  （' + files.length + ' 个文件）');
console.log('最大的几个：');
files.slice(0, 6).forEach((f) => console.log('  ' + kb(f.size) + '\t' + f.name));

if (total > LIMIT) {
  console.log('\n✗ 超限 ' + kb(total - LIMIT) + ' —— 把大目录加进 project.config.json 的 packOptions.ignore');
  process.exit(1);
}
/* 只留 10% 余量：贴到 97% 的时候一次美术导图就会爆，早点提醒 */
const WARN = LIMIT * 0.9;
if (total > WARN) {
  console.log('\n⚠ 已经用掉 ' + Math.round(total / LIMIT * 100) + '%，余量不足 10%：' +
    '上面列的大文件考虑加进 packOptions.ignore');
  process.exit(0);
}
console.log('\n✓ 包体没问题');
