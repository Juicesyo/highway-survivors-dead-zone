/**
 * 卡面文案自检：三选一升级卡的标题 / 副标题 / 描述有没有写不下
 *
 * 卡面只有固定高度（chh = fs(112)），描述最多两行，超了 wrap2 会打「…」——
 * 玩家读到的是半句话；副标题（sub）干脆不换行，太长就直接顶到卡片外面。
 *
 * 宽度口径跟 ui.js 的 levelUp 完全对齐：
 *   cw = W*0.86，文字起点 cx + fs(78)
 *   name / sub 可用到 cw - fs(78) - fs(14)
 *   desc 可用到 cw - fs(78) - fs(22)，且只画两行
 * 估算规则沿用 check-layout：CJK 一个字号宽、ASCII 0.55 个字号宽，
 * 粗体再乘 1.04（真实 canvas 里 600 字重更宽一点）。
 *
 * 用法: node tools/check-cardtext.js [--all]
 *   默认只列越界的；--all 打印全部条目（调文案时用）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
global.GameGlobal = global;
const reqs = [...fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8')
  .matchAll(/require\((['"])(.+?)\1\)/g)].map(m => m[2]);
for (const r of reqs) require(path.join(ROOT, r));
const HS = global.HS;
HS.Main.boot();
const G = HS.Game, P = HS.P, D = HS.Data;
G.testMode = true;

const SHOW_ALL = process.argv.includes('--all');

/* ---------- 文本宽度估算 ---------- */
function estW(str, px, bold) {
  let w = 0;
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    const wide = (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0x3000 && c <= 0x303f);
    w += (wide ? px : px * 0.55);
  }
  return w * (bold ? 1.04 : 1);
}

/** 和 ui.js 的 wrap2 同口径：两行装不下就算截断 */
function wrap2Est(str, maxW, px) {
  const s = String(str || '');
  if (estW(s, px) <= maxW) return [s, ''];
  let cut = s.length;
  for (let i = 1; i <= s.length; i++) {
    if (estW(s.slice(0, i), px) > maxW) { cut = i - 1; break; }
  }
  const l1 = s.slice(0, cut);
  const rest = s.slice(cut);
  if (estW(rest, px) <= maxW) return [l1, rest];
  return [l1, rest + '…(截断)'];
}

/* ---------- 断点：最小屏 320 / 常规 390 各测一遍 ---------- */
const SCREENS = [320, 390];
let bad = 0;
const rows = [];

function audit(width) {
  const fsPx = n => Math.round(n * (width / 390));
  const cw = width * 0.86;
  const nameMax = cw - fsPx(78) - fsPx(14);
  const subMax = cw - fsPx(78) - fsPx(14);
  const descMax = cw - fsPx(78) - fsPx(22);
  /* 底栏（c.foot）从同一 x 起、不换行，能一直画到卡片右内边 */
  const footMax = cw - fsPx(78) - fsPx(14);
  const namePx = fsPx(17), subPx = fsPx(10), descPx = fsPx(10.5), footPx = fsPx(9.5);

  return { fsPx, cw, nameMax, subMax, descMax, footMax, namePx, subPx, descPx, footPx };
}

function run(width, tag) {
  const M = audit(width);
  const p = G.run.p;
  const cards = [];

  const push = (where, c) => { if (c) cards.push({ where, c }); };

  /* 手上摆一套"最占地方"的配置：主 / 副都有高级武器，
     这样"新装备"卡的 sub 会带上「旧武器 Lv5 → 新武器 Lv1」这串最长的尾巴 */
  const busy = () => {
    p.weapons = [
      { id: 'ar', lvl: 5, timer: 0, up: {}, slot: 'main' },
      { id: 'pistol', lvl: 5, timer: 0, up: {}, slot: 'sub' }
    ];
    p.autos = [];
  };

  for (const id of Object.keys(D.gear)) {
    const def = D.gear[id];
    /* 进化形态永远不作为"新装备"出现（见 weapons.js 的 buildPools），
       只测它的等级 / 分支卡 */
    if (!def.evo) {
      busy();
      push('新装备:' + id, G.makeCard({ kind: def.slot === 'auto' ? 'autoNew' : 'weaponNew', id }));
    }

    /* 等级卡：满级前一档最啰嗦（会挂"已满级 · 进化…"的说明） */
    const slot = def.slot === 'auto' ? 'auto' : (def.slot === 'heavy' ? 'heavy' : def.slot);
    if (slot === 'auto') { p.autos = [{ id, lvl: (def.maxLvl || 5) - 1, up: {} }]; }
    else { p.weapons = [{ id, lvl: (def.maxLvl || 5) - 1, timer: 0, up: {}, slot }]; p.autos = []; }
    push('等级:' + id, G.makeCard({ kind: 'gearLevel', id }));

    /* 每条专属分支都过一遍（分支 lvl 1 时最宽：Lv1→2/2） */
    const ups = D.gearUps[id] || {};
    for (const b in ups) {
      if (slot === 'auto') p.autos = [{ id, lvl: 3, up: { [b]: 1 } }];
      else p.weapons = [{ id, lvl: 3, timer: 0, up: { [b]: 1 }, slot }];
      push('分支:' + id + '.' + b, G.makeCard({ kind: 'gearUp', id, up: b }));
    }
  }

  /* 通用属性卡：1 级与 3 级（副标题长短不同） */
  busy();
  p.passives = {};
  for (const id of Object.keys(D.passives)) {
    p.passives[id] = 0;
    push('属性新:' + id, G.makeCard({ kind: 'passiveNew', id }));
    p.passives[id] = 2;
    push('属性升级:' + id, G.makeCard({ kind: 'passive', id }));
  }
  p.passives = {};

  /* 联动卡：强化 / 缺装备 / 缺属性 三种口径 */
  for (const syn of D.synergies) {
    push('联动强化:' + syn.id, G.makeCard({ kind: 'synergy', id: syn.id, boost: 1 }));
    const req = syn.req || {};
    const gid = req.gear || req.gear2 || (req.gearAny2 && req.gearAny2[0]);
    if (gid) push('联动附赠:' + syn.id, G.makeCard({
      kind: 'synergy', id: syn.id, miss: { type: 'gear', id: gid } }));
    if (req.stat) push('联动附属性:' + syn.id, G.makeCard({
      kind: 'synergy', id: syn.id, miss: { type: 'stat', id: req.stat } }));
  }

  /* 取舍卡 */
  for (const td of D.tradeoffs) push('取舍:' + td.id, G.makeCard({ kind: 'trade', id: td.id }));

  /* 进化 / 进化预备 */
  for (const base in D.evolutions) {
    const ev = D.evolutions[base];
    push('进化:' + base, G.makeCard({ kind: 'evolve', id: base, evo: ev.id }));
    const rq = ev.req || {};
    if (rq.stat) {
      p.passives = { [rq.stat]: (rq.statLvl || 1) - 1 };
      busy();
      push('进化预备:' + base, G.makeCard({ kind: 'evoPrep', id: base, stat: rq.stat }));
      p.passives = {};
    }
  }

  /* ---------- 测量 ---------- */
  for (const { where, c } of cards) {
    const nameW = estW(c.name || '', M.namePx, true);
    const subW = estW(c.sub || '', M.subPx, false);
    const footW = estW(c.foot || '', M.footPx, true);
    const dl = wrap2Est(c.desc || '', M.descMax, M.descPx);
    const subOver = subW > M.subMax;
    const nameOver = nameW > M.nameMax;
    const footOver = footW > M.footMax;
    const descCut = /截断/.test(dl[1] || '');
    const rec = {
      width, where, kind: c.kind, name: c.name, sub: c.sub, desc: c.desc, foot: c.foot,
      nameW, subW, footW, subMax: M.subMax, nameMax: M.nameMax, footMax: M.footMax,
      descLines: dl[1] ? 2 : 1, descCut, descLen: (c.desc || '').length,
      over: nameOver || subOver || footOver || descCut,
      why: [nameOver ? '标题' : '', subOver ? '副标题' : '', footOver ? '底栏' : '',
        descCut ? '描述' : ''].filter(Boolean).join('+')
    };
    rows.push(rec);
    if (rec.over) bad++;
  }
  console.log('—— ' + tag + '（文字区 ' + Math.round(M.subMax) + 'px 宽，描述每行约 ' +
    Math.floor(M.descMax / M.descPx) + ' 个汉字，两行）——');
}

G.startRun('highway', 'whale');
G.state = 'levelup';
for (const w of SCREENS) { P.W = w; P.H = Math.round(w * 2.16); run(w, w + 'px 屏'); }

/* ---------- 输出 ---------- */
if (SHOW_ALL) {
  for (const r of rows) {
    console.log((r.over ? '✗ ' : '  ') + r.where.padEnd(24) +
      ' 名' + Math.round(r.nameW) + ' 副' + Math.round(r.subW) + ' 描' + r.descLen + '字/' + r.descLines + '行');
  }
}
console.log('');
for (const r of rows.filter(x => x.over)) {
  console.log('  ✗ [' + r.width + 'px] ' + r.where + '  ← ' + r.why + '超了');
  console.log('      name: ' + r.name + '  (' + Math.round(r.nameW) + '/' + Math.round(r.nameMax) + ')');
  console.log('      sub : ' + r.sub + '  (' + Math.round(r.subW) + '/' + Math.round(r.subMax) + ')');
  console.log('      desc: ' + r.desc);
  if (r.foot) console.log('      foot: ' + r.foot + '  (' + Math.round(r.footW) + '/' + Math.round(r.footMax) + ')');
}

const uniq = new Set(rows.filter(x => x.over).map(x => x.where));
console.log('\n越界 ' + bad + ' 条（去重 ' + uniq.size + ' 张卡）/ 共 ' + rows.length + ' 条');

/* 卡面必须把"白拿的东西"写出来：联动卡只要卖的是「达成条件」，
   拿卡就会把缺的那件直接塞给你 —— 底栏没写赠品 = 玩家莫名其妙多一件装备。 */
const giftless = [...new Set(rows
  .filter(r => r.kind === 'synergy' && /^达成条件/.test(r.sub || '') && !r.foot)
  .map(r => r.where))];
if (giftless.length) {
  console.log('\n✗ 联动卡没写赠品（' + giftless.length + ' 张）：' + giftless.join('、'));
} else {
  console.log('✓ 所有「达成条件」联动卡都在底栏写明了赠品');
}
process.exit(bad || giftless.length ? 1 : 0);
