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
  G.startRun('highway', 'whale');
  G.state = 'mapselect';
  snap();
  HS.UI.mapSelect(G);

  const desc = drawn.find(d => /张图的尸群/.test(d.t));
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
G.startRun('highway', 'whale');
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

/* ---------- 3. 搜刮 / 空投的确认框：卡面 + 两个按钮都放得下 ---------- */
{
  G.state = 'title';
  G.startRun('highway', 'whale');
  G.state = 'run';

  /* 描述故意写长（会折成两行），名字也不短 */
  const card = {
    kind: 'gearUp', id: 'saberring', name: '加长刃身', icon: 'saberring',
    color: '#8ee9ff', rare: false, src: '武器专属',
    sub: '光剑无人环  Lv1→2/2',
    desc: '刃身 +8，外沿更远、贴身照样切（线段判定，近身的怪也吃得到）'
  };
  G.lootAsk = card;
  G.lootFrom = '搜刮';
  G.state = 'lootask';
  snap();
  G.hits.length = 0;
  HS.UI.lootAsk(G);

  const pw4 = P.W * 0.86, px4 = (P.W - pw4) / 2;
  const ph4 = fsPx(206), py4 = Math.round((P.H - ph4) / 2);
  const nameLine = drawn.find(d => d.t === card.name);
  const subLine = drawn.find(d => d.t === card.sub);
  const descText = card.desc;
  const descLines = drawn.filter(d => d !== nameLine && d !== subLine && d.t &&
    descText.indexOf(d.t.replace(/…$/, '')) >= 0);
  const boxRight = px4 + pw4 - fsPx(10);

  ck('确认框画出了卡名', !!nameLine, nameLine ? nameLine.t : '缺');
  ck('确认框画出了效果（不是只有名字）', descLines.length > 0,
    descLines.map(d => d.t).join(' / ') || '缺');
  ck('确认框画出了副标题', !!subLine, subLine ? subLine.t : '缺');
  const boxTexts = [nameLine, subLine].concat(descLines).filter(Boolean);
  ck('确认框文字不出右边界', boxTexts.every(d => d.x + d.w <= boxRight + 0.5),
    boxTexts.map(d => (d.x + d.w).toFixed(0)).join(',') + ' ≤ ' + boxRight.toFixed(0));
  const yes = G.hits.find(h => h.id === 'loot:yes'), no = G.hits.find(h => h.id === 'loot:no');
  ck('确认框有两个按钮', !!yes && !!no);
  ck('按钮不重叠', !!yes && !!no && no.x + no.w <= yes.x,
    no && yes ? (no.x + no.w).toFixed(0) + ' ≤ ' + yes.x.toFixed(0) : '缺按钮');
  ck('按钮在面板里', !!yes && !!no && yes.y + yes.h <= py4 + ph4 + 0.5 && no.x >= px4,
    yes ? (yes.y + yes.h).toFixed(0) + ' ≤ ' + (py4 + ph4).toFixed(0) : '缺按钮');
  const lastBoxY = Math.max.apply(null, boxTexts.map(d => d.y));
  ck('卡面不压按钮', !!yes && lastBoxY + fsPx(10) <= yes.y,
    yes ? lastBoxY.toFixed(0) + ' + 10 ≤ ' + yes.y.toFixed(0) : '缺按钮');

  /* 换手持武器的版本：多一段"会失去什么"，也不能压到按钮 */
  G.lootAsk = G.makeCard({ kind: 'weaponNew', id: 'smg' });
  G.state = 'lootask';
  snap();
  G.hits.length = 0;
  HS.UI.lootAsk(G);
  const ph5 = fsPx(262), py5 = Math.round((P.H - ph5) / 2);
  const warn = drawn.find(d => /换掉会连等级和分支一起清空/.test(d.t));
  const yes2 = G.hits.find(h => h.id === 'loot:yes');
  ck('换装确认框写出了"会失去什么"', !!warn, warn ? warn.t : '缺');
  ck('换装确认框的文字不压按钮',
    !!warn && !!yes2 && warn.y + fsPx(10) <= yes2.y,
    warn && yes2 ? warn.y.toFixed(0) + ' + 10 ≤ ' + yes2.y.toFixed(0) : '缺文案');
  ck('换装确认框的按钮也在面板里', !!yes2 && yes2.y + yes2.h <= py5 + ph5 + 0.5);
  G.lootAsk = null;
  G.state = 'run';
}

/* ---------- 4. 暂停页 / 暂停里的设置页：各种屏幕都不越界、不叠 ---------- */
for (const [w, h] of SCREENS) {
  const fs2 = n => Math.round(n * (w / 390));
  P.W = w; P.H = h;
  G.state = 'title';
  G.startRun('highway', 'whale');
  G.state = 'paused';
  G.pauseSet = false;
  G.hits.length = 0;
  snap();
  HS.UI.pause(G);

  const resume = G.hits.find(x => x.id === 'resume');
  const setBtn = G.hits.find(x => x.id === 'pause:set');
  const restart = G.hits.find(x => x.id === 'restart');
  const quit = G.hits.find(x => x.id === 'quit');
  ck(w + 'x' + h + ' 暂停页四个按钮都在', !!resume && !!setBtn && !!restart && !!quit,
    G.hits.map(x => x.id).join(','));
  ck(w + 'x' + h + ' 暂停按钮依次排开不重叠',
    !!resume && !!setBtn && !!restart && !!quit &&
    resume.y + resume.h <= setBtn.y && setBtn.y + setBtn.h <= restart.y &&
    restart.y + restart.h <= quit.y,
    [resume, setBtn, restart, quit].filter(Boolean).map(b => b.y.toFixed(0)).join('/'));
  ck(w + 'x' + h + ' 暂停按钮不压构筑面板',
    !!resume && resume.y >= h * 0.245 + fs2(150) + 1,
    resume ? resume.y.toFixed(0) + ' ≥ ' + (h * 0.245 + fs2(150)).toFixed(0) : '缺');
  ck(w + 'x' + h + ' 暂停按钮不出屏', !!quit && quit.y + quit.h <= h,
    quit ? (quit.y + quit.h).toFixed(0) + ' ≤ ' + h : '缺');

  /* 设置子页 */
  G.pauseSet = true;
  G.hits.length = 0;
  snap();
  HS.UI.pause(G);
  const setIds = G.hits.map(x => x.id);
  const back = G.hits.find(x => x.id === 'pause:back');
  const fxRow = G.hits.find(x => x.id === 'set:fx');
  ck(w + 'x' + h + ' 设置子页四个开关都在',
    ['set:sfx', 'set:bgm', 'set:vib', 'set:fx'].every(id => setIds.indexOf(id) >= 0), setIds.join(','));
  ck(w + 'x' + h + ' 设置子页不再留 HUD 命中区', setIds.indexOf('pause') < 0);
  ck(w + 'x' + h + ' 返回暂停按钮不压最后一行',
    !!back && !!fxRow && fxRow.y + fxRow.h <= back.y,
    back && fxRow ? (fxRow.y + fxRow.h).toFixed(0) + ' ≤ ' + back.y.toFixed(0) : '缺');
  ck(w + 'x' + h + ' 返回暂停按钮不出屏', !!back && back.y + back.h <= h,
    back ? (back.y + back.h).toFixed(0) + ' ≤ ' + h : '缺');
  G.pauseSet = false;
}
P.W = 390; P.H = 844;

console.log(bad ? '\n' + bad + ' 项失败' : '\n全部通过');
process.exit(bad ? 1 : 0);
