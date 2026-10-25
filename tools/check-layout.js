/**
 * 界面排版自检：文案有没有越界 / 有没有压在别的控件上 / 有没有居中
 *
 * 用"中文按 1 个字号宽、ASCII 按 0.55 个字号宽"估算文本宽度
 * （无头环境的 measureText 桩只返回字数×6，中文会被严重低估）。
 *
 * 用法：node tools/check-layout.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
global.GameGlobal = global;
const reqs = [...fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8')
  .matchAll(/require\((['"])(.+?)\1\)/g)].map(m => m[2]);
for (const r of reqs) require(path.join(ROOT, r));
const HS = global.HS;
HS.Main.boot();
const G = HS.Game, P = HS.P;
G.testMode = true;

let bad = 0;
const ck = (n, c, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' ' + n + (x ? '  (' + x + ')' : '')); if (!c) bad++; };
const fsPx = n => Math.round(n * (P.W / 390));

/** 文本宽度估算：CJK / 全角算 1 个字号，ASCII 算 0.55 */
function estW(str, fontPx) {
  let w = 0;
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    const wide = (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0x3000 && c <= 0x303f);
    w += wide ? fontPx : fontPx * 0.55;
  }
  return w;
}

const ctx = P.ctx;
const drawn = [];
ctx.fillText = function (t, x, y) {
  const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font || '');
  const px = m ? parseFloat(m[1]) : 10;
  drawn.push({ t: String(t), x, y, align: ctx.textAlign, px, w: estW(t, px) });
};
const snap = () => { drawn.length = 0; };

/* ---------- 1. 选图页：说明不压开关，且各种屏幕比例都不挤 ---------- */
const SCREENS = [[320, 568], [375, 667], [390, 844], [430, 932]];
for (const [w, h] of SCREENS) {
  P.W = w; P.H = h;
  const fs2 = n => Math.round(n * (P.W / 390));
  G.state = 'title';
  G.startRun('highway', 'soldier');
  G.state = 'mapselect';
  snap();
  HS.UI.mapSelect(G);

  const desc = drawn.find(d => /四张图的尸群/.test(d.t));
  const label = drawn.find(d => d.t === '无尽模式');
  const swLeft = w * 0.88 - fs2(16) - fs2(38);
  const panelRight = w * 0.12 + w * 0.76 - fs2(16);
  const panelTop = h * 0.665;
  const panelBottom = panelTop + fs2(56);
  const n = HS.Data.mapOrder.length;
  const mapTop = h * 0.145, mapGap = fs2(8);
  const cardH = Math.min(fs2(76), (h * 0.61 - mapTop - mapGap * (n - 1)) / n);
  const cardsBottom = mapTop + n * (cardH + mapGap) - mapGap;
  const launchTop = h * 0.775;

  ck(w + 'x' + h + ' 说明行不压开关', !!desc && desc.x + desc.w <= swLeft - 4,
    desc ? (desc.x + desc.w).toFixed(0) + ' < ' + swLeft.toFixed(0) : '缺说明');
  ck(w + 'x' + h + ' 说明行不超出面板', !!desc && desc.x + desc.w <= panelRight,
    desc ? (desc.x + desc.w).toFixed(0) + ' ≤ ' + panelRight.toFixed(0) : '缺说明');
  ck(w + 'x' + h + ' 说明在标题下方', !!desc && !!label && desc.y - label.y >= fs2(14),
    label && desc ? label.y.toFixed(0) + ' → ' + desc.y.toFixed(0) : '缺文案');
  ck(w + 'x' + h + ' 面板不压出发按钮', panelBottom <= launchTop,
    panelBottom.toFixed(0) + ' ≤ ' + launchTop.toFixed(0));
  ck(w + 'x' + h + ' 面板不压地图卡', panelTop >= cardsBottom,
    cardsBottom.toFixed(0) + ' ≤ ' + panelTop.toFixed(0));
}
P.W = 390; P.H = 844;

/* ---------- 2. 升级界面：重抽文案在胶囊正中 ---------- */
G.state = 'title';
G.startRun('highway', 'soldier');
G.run.p.level = 5;
G.state = 'levelup';
G.run.choices = G.buildChoices(3);
snap();
HS.UI.levelUp(G);

const rr = drawn.find(d => /重抽/.test(d.t));
ck('升级界面画出了重抽按钮', !!rr);
if (rr) {
  /* 与 UI.levelUp 同款布局：卡片 → 胶囊 */
  const chh = fsPx(112), gap = fsPx(11);
  const totalH = G.run.choices.length * (chh + gap) - gap;
  const top = Math.max(P.H * 0.18, (P.H - totalH) / 2 + fsPx(14));
  const rh = fsPx(30);
  const ry = Math.min(P.H - fsPx(46), top + totalH + fsPx(14));
  const centerY = ry + rh / 2;
  ck('重抽文案水平居中', Math.abs(rr.x - P.W / 2) < 0.5 && rr.align === 'center',
    'x=' + rr.x.toFixed(1) + ' 画面中心 ' + (P.W / 2));
  ck('重抽文案垂直居中', Math.abs(rr.y - centerY) < 0.6,
    'y=' + rr.y.toFixed(1) + ' 胶囊中心 ' + centerY.toFixed(1));
  ck('重抽文案放得下', rr.w <= fsPx(112) - fsPx(16), rr.w.toFixed(0) + ' ≤ ' + (fsPx(112) - fsPx(16)));
}

console.log(bad ? '\n' + bad + ' 项失败' : '\n全部通过');
process.exit(bad ? 1 : 0);
