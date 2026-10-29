/**
 * 装备数据全面审查
 * 用法: node tools/audit-gear.js
 * 覆盖：ID 唯一 / base·g 字段拼写 / mech 分派 / special·flag·effect 真实消费方 /
 *       通用属性消费方 / 联动闭环 / 进化链 / 图标别名 / 卡池覆盖 / 描述数值一致性
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const reqs = [...entry.matchAll(/require\(['"](.+?)['"]\)/g)].map(m => m[1]);
for (const r of reqs) require(path.join(ROOT, r));
const SRC = ['gear', 'combat', 'auto', 'game', 'render', 'vehicle']
  .map(f => fs.readFileSync(path.join(ROOT, 'src/game/' + f + '.js'), 'utf8'))
  .join('\n');

const HS = globalThis.HS;
HS.Main.boot();
HS.Game.testMode = true;
const D = HS.Data;

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  (' + extra + ')' : ''));
  if (!cond) bad++;
}
function has(srcText, token) { return srcText.indexOf(token) >= 0; }

/* ================= 1. ID 唯一性 ================= */
console.log('[1. ID 唯一性]');
{
  const seen = {};
  const dup = [];
  for (const id of Object.keys(D.gear)) {
    if (seen[id]) dup.push(id);
    seen[id] = 1;
  }
  check('gear 无重复 id', dup.length === 0, dup.join(','));
}

/* ================= 2. base / g 字段拼写 ================= */
console.log('[2. base / g 字段拼写]');
{
  const KEY = { cd: 1, dmg: 1, count: 1, speed: 1, spread: 1, range: 1, pierce: 1,
    radius: 1, dur: 1, dps: 1, slow: 1, arc: 1, targets: 1, chains: 1, homing: 1,
    knock: 1, stun: 1, heal: 1, width: 1, effectDur: 1, spin: 1, pull: 1, atk: 1, amp: 1 };
  const GROW = { dmg: 1, dps: 1, cd: 1, count: 1, pierce: 1, chains: 1, targets: 1,
    radius: 1, range: 1, speed: 1, dur: 1, spin: 1, heal: 1, slow: 1, width: 1, arc: 1,
    knock: 1, stun: 1, pull: 1, amp: 1 };
  const typos = [];
  for (const id of Object.keys(D.gear)) {
    const d = D.gear[id];
    if (d.slot === 'auto') continue;
    for (const k in d.base) if (!KEY[k]) typos.push(id + '.base.' + k);
    for (const k in (d.g || {})) if (!GROW[k]) typos.push(id + '.g.' + k);
  }
  check('base / g 无拼错字段', typos.length === 0, typos.slice(0, 8).join(','));
}

/* ================= 3. mech 有 fire 分支 ================= */
console.log('[3. 机制分派]');
{
  const miss = [];
  for (const id of Object.keys(D.gear)) {
    const d = D.gear[id];
    if (d.slot === 'auto') continue;
    if (d.mech === 'buff' || d.mech === 'none') continue;   // 被动型不进 fire 分派
    if (!has(SRC, "case '" + d.mech + "':")) miss.push(id + '(' + d.mech + ')');
  }
  check('每件武器的 mech 都有 fire 分支', miss.length === 0, miss.slice(0, 6).join(','));
}

/* ================= 4. special / flag / effect 真实消费 ================= */
console.log('[4. special / flag / effect 消费方]');
{
  /* 消费方按"token 在游戏源码里出现"判定（st.shard / e.burn / flags.volley2 等形式都算） */
  const TOKEN = ['sustain', 'homing', 'shard', 'mark', 'beam', 'burn', 'shock', 'volley2',
    'echo', 'spinup', 'bounce3', 'split', 'explode', 'pull', 'bleed', 'leech'];
  /* effect 已知分派集合：zone 按通用 dps+slow 结算，lure/fire/ice/gravity 有专属逻辑，
     zap 走 strike 分派；emp/smoke/artillery/mines/mark 是投掷/弹丸落点效果
     （Gear.throwAt → landLob / bulletEffect 分派，已逐条核对消费链） */
  const EFFECT = { lure: 1, poison: 1, fire: 1, ice: 1, gravity: 1, zap: 1,
    emp: 1, smoke: 1, artillery: 1, mines: 1, mark: 1 };
  const dead = [];
  for (const t of TOKEN) {
    if (!has(SRC, t)) dead.push(t);
  }
  /* 数据里实际出现的 effect 必须在已知分派集合内（zone 按通用 dps+slow 结算，
     lure/fire/ice/gravity 有专属逻辑，zap 走 strike 分派） */
  for (const id of Object.keys(D.gear)) {
    const d = D.gear[id];
    if (d.effect && !EFFECT[d.effect]) dead.push(id + '.effect.' + d.effect);
  }
  check('所有开关在源码里真的有消费方', dead.length === 0, dead.slice(0, 8).join(','));
}

/* ================= 5. 通用属性消费方 ================= */
console.log('[5. 通用属性消费方]');
{
  const unused = [];
  for (const id of Object.keys(D.passives)) {
    const patterns = ["lv('" + id + "')", "passives['" + id + "']", 'passives.' + id, 'perm.' + id];
    if (!patterns.some(pt => has(SRC, pt))) unused.push(id);
  }
  check('每条通用属性都有结算代码', unused.length === 0, unused.join(','));
}

/* ================= 6. 联动闭环 ================= */
console.log('[6. 联动闭环]');
{
  const miss = [];
  for (const s of D.synergies) {
    if (!has(SRC, 'p.syn.' + s.id) && !has(SRC, "syn['" + s.id + "']")) miss.push(s.id + ' 无生效代码');
    const r = s.req || {};
    for (const gid of [].concat(r.gear || [], r.gear2 || [], r.gearAny || [])) {
      if (!D.gear[gid]) miss.push(s.id + ' 引用不存在的装备 ' + gid);
    }
    for (const st of ['stat', 'stat2']) {
      if (r[st]) {
        if (!D.passives[r[st]]) miss.push(s.id + ' 引用不存在的属性 ' + r[st]);
        else if (r[st + 'Lvl'] > D.passives[r[st]].maxLvl) miss.push(s.id + ' 要求 ' + r[st] + ' 等级超过上限');
      }
    }
  }
  check('联动 id / 引用 / 消费方闭环', miss.length === 0, miss.slice(0, 8).join(','));
}

/* ================= 7. 进化链 ================= */
console.log('[7. 进化链]');
{
  const miss = [];
  for (const baseId of Object.keys(D.evolutions || {})) {
    const evo = D.evolutions[baseId];
    if (!D.gear[baseId]) miss.push('进化引用不存在的本体 ' + baseId);
    if (!D.gear[evo.id]) miss.push('进化形态缺失 ' + evo.id);
    if (D.gear[evo.id] && D.gear[evo.id].baseId !== baseId) miss.push(evo.id + ' 的 baseId 回链断开');
    if (evo.req && evo.req.stat) {
      if (!D.passives[evo.req.stat]) miss.push(evo.id + ' 进化条件引用不存在的属性 ' + evo.req.stat);
      else if (evo.req.statLvl > D.passives[evo.req.stat].maxLvl) miss.push(evo.id + ' 进化条件超出属性上限');
    }
    for (const k in (evo.mul || {})) {
      if (['dmg', 'dps', 'cd', 'count', 'pierce', 'chains', 'targets', 'width', 'radius',
        'range', 'speed', 'dur', 'arc', 'spread', 'knock', 'stun', 'pull', 'slow',
        'spin', 'heal', 'homing'].indexOf(k) < 0) miss.push(evo.id + '.mul 字段可疑 ' + k);
    }
    if (evo.flag && !has(SRC, "'" + evo.flag + "'") && !has(SRC, 'flags.' + evo.flag)) {
      miss.push(evo.id + ' 的 flag ' + evo.flag + ' 无消费方');
    }
  }
  check('进化链完整（本体→形态→觉醒）', miss.length === 0, miss.slice(0, 8).join(','));
}

/* ================= 8. 图标别名 ================= */
console.log('[8. 图标别名]');
{
  /* 图标解析规则：iconAlias[art] || art，直查 HS.Icons 键 */
  const miss = [];
  for (const id of Object.keys(D.gear)) {
    const d = D.gear[id];
    if (!d.art) continue;
    const key = D.iconAlias[d.art] || d.art;
    if (!HS.Icons || !HS.Icons[key]) miss.push(id + ' 的 art ' + d.art + ' 无图标');
  }
  check('每件武器的 art 都有图标', miss.length === 0, miss.join(','));
}

/* ================= 9. 卡池覆盖 ================= */
console.log('[9. 卡池覆盖]');
{
  const pools = {};
  for (const id of D.weaponPool) pools[id] = 'main';
  for (const id of D.subPool) pools[id] = pools[id] ? pools[id] + '+sub' : 'sub';
  for (const id of (D.heavyPool || [])) pools[id] = pools[id] ? pools[id] + '+heavy' : 'heavy';
  const miss = [], dup = [];
  for (const id of Object.keys(D.gear)) {
    const d = D.gear[id];
    if (d.evo || d.slot === 'auto' || d.hidden) continue;
    if (!pools[id]) miss.push(id + '(' + d.slot + ')');
    else if (pools[id].indexOf('+') >= 0) dup.push(id + ':' + pools[id]);
  }
  check('每件可拾取武器都在对应卡池', miss.length === 0, miss.join(','));
  check('没有武器同时出现在两个槽位池', dup.length === 0, dup.join(','));
}

/* ================= 10. 描述数值一致性 ================= */
console.log('[10. 描述与数值一致]');
{
  const pairs = [
    ['power', 'passives', 0.08, 'power.desc'],
    ['haste', 'passives', 0.10, 'haste.desc'],
    ['critdmg', 'passives', 0.15, 'critdmg.desc'],
    ['blast', 'passives', 0.10, 'blast.desc'],
    ['duration', 'passives', 0.12, 'duration.desc'],
    ['range', 'passives', 0.08, 'range.desc'],
    ['magnet', 'passives', 24, 'magnet.desc'],
    ['study', 'passives', 9, 'study.desc'],
    ['greed', 'passives', 10, 'greed.desc']
  ];
  const wrong = [];
  for (const [id, , rate, tag] of pairs) {
    const d = D.passives[id];
    const m = d.desc(1).match(/(\d+(?:\.\d+)?)/);
    const stated = m ? parseFloat(m[1]) : -1;
    const expect = rate < 1 ? Math.round(rate * 100) : rate;
    if (Math.abs(stated - expect) > 0.01) wrong.push(tag + ' 写 ' + stated + '% 实际 ' + expect + '%');
  }
  check('通用属性描述与结算一致', wrong.length === 0, wrong.join(','));
  /* 研究所 dmg 描述 vs recalc 常量 */
  const perm = D.perms.find(x => x.id === 'dmg');
  const pdm = perm.desc(1).match(/(\d+)/);
  check('研究所「武器训练」描述与结算一致', pdm && parseInt(pdm[1]) === 3,
    pdm ? pdm[1] + '%' : '?');
}

/* ================= 11. 数值健全性 ================= */
console.log('[11. 数值健全性]');
{
  const odd = [];
  const NO_DMG = { syringe: 1, autoloader: 1, decoy: 1, decoyspeaker: 1, automed: 1, amplifier: 1 };
  for (const id of Object.keys(D.gear)) {
    const d = D.gear[id];
    if (d.slot === 'auto') continue;
    if (NO_DMG[id]) continue;
    if (!(d.base.dmg > 0) && !(d.base.dps > 0)) odd.push(id + ' 无伤害');
    if (!(d.base.cd > 0) && d.mech !== 'buff' && d.mech !== 'none') odd.push(id + ' cd<=0');
    if (d.mech !== 'melee' && d.mech !== 'boomerang' && d.mech !== 'lob' && d.mech !== 'missile' &&
        d.mech !== 'beam' && d.mech !== 'rail' && d.mech !== 'chain' && d.mech !== 'flame' &&
        !(d.base.range > 0) && !(d.base.radius > 0)) odd.push(id + ' 无射程');
  }
  check('每件武器都有伤害 / 冷却 / 作用距离', odd.length === 0, odd.slice(0, 8).join(','));
}

/* ================= 12. 武器音效覆盖 ================= */
console.log('[12. 武器音效覆盖]');
{
  /* 每件装备的 art 都必须在 Audio.ART_SFX 里有音色，否则开火会退回通用枪声
     （近战拿着锤子发出枪响就是这个原因） */
  const map = HS.Audio.ART_SFX || {};
  const miss = {};
  for (const id of Object.keys(D.gear)) {
    const a = D.gear[id].art;
    if (!map[a]) miss[a] = (miss[a] || 0) + 1;
  }
  check('每件武器的 art 都有音色映射', Object.keys(miss).length === 0,
    Object.keys(miss).map(k => k + ' ×' + miss[k]).slice(0, 8).join(','));
}

console.log('\n' + (bad === 0 ? '审查通过，未发现数据 bug ✓' : '发现 ' + bad + ' 处问题 ✗'));
process.exit(bad ? 1 : 0);
