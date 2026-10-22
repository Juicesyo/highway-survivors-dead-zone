# 开发路线与扩展指南

## 当前版本：v0.9「可玩垂直切片」

一个完整的局内循环 + 局外成长已经跑通：选角色选图 → 打 6 分钟 → 升级 Build → 打 Boss → 结算 → 用金币强化 → 再来一局。
剩下的是「内容量」和「上线配套」。

---

## 阶段 4 待办（按优先级）

### P0 上线必需
1. **换 AppID**：`project.config.json` → `appid`，并在公众平台配置服务器域名（当前无网络请求）。
2. **图标与加载页**：小游戏后台设置，建议用 `assets` 之外的方式（当前无资源目录）。
3. **类目与实名**：小游戏类目选「休闲游戏」，完成实名与防沉迷接入。
4. **真机验收**：iOS 刘海屏（安全区已处理）、Android 低端机（建议 4 核 2G 机型跑 60fps）。

### P1 留存与传播
5. **开放数据域排行榜**：`wx.getOpenDataContext()` + 子域渲染最高存活时间。
6. **分享**：`wx.shareAppMessage`，带「我撑到了 4:32」的战绩文案。
7. **激励视频**：复活一次 / 双倍金币，接 `wx.createRewardedVideoAd`。
8. **新手引导**：第一局开局 10 秒的操作提示（当前只有研究所里的文字版）。

### P2 内容扩充
9. **武器**：已扩到 72 件手持 + 23 件自动；下一批往「机制」而非「数值」加（例如
   可蓄力的蓄能枪、命中后跳到下一个目标的链锯、需要站定才强的重型炮台）。
10. **Boss**：第二张图（死区之夜）配「夜巡者」，第三张图（荒漠公路）配「公路车王」，各带一套机制。
11. **角色**：目标 6 个，每个带一条专属被动（例如「手雷投掷 +1」）。
12. **挑战模式**：固定 Build / 限时 / 只用近战 等 modifier 组合。
13. **流派成就**：把「暴走」「爆破专家」这类联动做成局外可见的构筑图鉴，强化目标感。

---

## 怎么加内容（三步）

### 加一把武器

全数据驱动，一行战斗代码都不用改：

1. `src/data/weapons.js`（或 `autogear.js`）里 `add(slot, cat, common, list)` 的 list 加一条：
   `{ id, name, art, desc, fam, mech, base, g, rarity, maxLvl }`。
   `mech` 决定开火方式（`Gear.fire` 按它分派），`fam` 决定通用属性怎么换算。
2. 图标：在 `D.iconAlias` 里把 `art` 指到已有的 12x12 点阵（`src/data/icons.js`），不用新美术。
3. 专属分支：`mech` 对得上就自动拿到 `D.upByMech[mech]` 那 3 条；
   想改成这把武器独有的方向，在 `D.gearUpOverride[id]` 写一份同名分支列表。
4. 进化（可选）：`D.evolutions[baseId] = { id, name, req:{stat, statLvl}, desc, mul, flag }`。
   `mul` 里 `dmg/cd/radius/range/speed/arc/width/spread` 是乘法，其余（count/pierce/targets/stun…）是加法。
   `flag` 可写 `burn / shard / shock / homing / beam / echo / spinup / bounce3 / split / explode / pull`，
   注意 `flag` 只对**支持它的机制**有意义（例如 `shard` 只对爆炸类生效）。
5. 跑 `node tools/smoke.js`：它会自动遍历所有基础装备与所有进化形态各打一遍，
   新武器只要 `mech` 写错或少了字段就会立刻报出来。

### 加一条联动

在 `src/data/upgrades.js` 的 `D.synergies` 加一条 `req`：

| 条件字段 | 含义 |
| --- | --- |
| `gear` / `gear2` / `gearAny[]` | 需要某件（或任一件）手持 / 自动装备 |
| `stat` + `statLvl` | 需要某条通用属性到几级 |
| `stat2` + `stat2Lvl` | 第二条属性（属性组合型联动） |
| `fam` | 需要某个兼容族的武器（`gun/energy/explosive/melee/thrown/support`） |
| `needSub` | 需要副武器在手 |
| `autoCount` | 需要 N 件自动装备（这类只自然达成，不当卡卖） |

`req` 命中后往 `p.syn` 写一个标记，运行时按标记生效（`Gear.global` / `hurtEnemy` / `damagePlayer`）。
**别忘了在 `Gear.checkSynergies` 加判定、在运行时找一处消费它**——只写数据不写消费方，就是一张废卡。

### 加一种敌人

1. `src/data/enemies.js` 加一条：血量/速度/伤害/半径/经验/精灵名。
2. `src/data/spriteDefs.js` 的 `defs` 里加一份点阵，并把它加入 `frameList` 与 `enemyOrder`；
   然后跑 `node tools/build-sprites.js` 重新生成图集（精英/受击变体会自动补齐）。
3. 需要特殊行为（远程、冲刺、分裂）就在 `src/game/combat.js` → `updateEnemies` 里加分支。
4. `src/game/game.js` → `pickType` 里按时间曲线给它分配权重。

### 加一个角色

1. `src/data/chars.js` 的 `HS.Data.chars` 加一条：`hp / speed / weapon / dmgMul / armor / regen / cost`。
2. 把 id 加进 `charOrder`。
3. 解锁、选择、存档、成就判定都是数据驱动的，不需要改 UI。

---

## 数值设计备忘

| 项 | 当前值 | 备注 |
| --- | --- | --- |
| 单局时长 | 360s | Boss 在 360s 刷新，无尽模式 100s 一次循环 |
| 刷怪速率 | `1.0 + 分钟 × 0.45` | Boss 阶段 ×0.3，血月 ×1.9 |
| 敌人上限 | 120 | 低端机可降到 80 |
| 经验曲线 | `3 + 2.0L + 0.1L²` | 单局大约 11~18 级（取决于捡回多少经验，通常回收 30% 左右） |
| 敌人经验 | 2 / 2 / 2 / 3 / 7，Boss 120 | 场上最多 320 颗经验球，超出丢最老的（不合并） |
| 拾取半径 | `44 × (1 + 磁石等级 × 0.24)` | 磁石 Lv4 约 86；范围外必须走过去捡 |
| 场景道具 | 每 192 区块 55~62% 概率刷一个 | 车/墩挡子弹，木箱轮胎不挡；Boss 撞碎一切 |
| 建筑 | 每街区 0~2 栋，约 62% 是废墟 | 大楼 96x88 / 居民房 84x64 / 仓库 100x72；完整建筑可进，废墟实心 |
| 精英 | 每 42s，血量 ×6 | 必掉宝箱或心 |
| Boss | 360 基础血 × 时间缩放 | 26s 后开始暴走提速；掩体吃掉玩家 DPS，血量已补偿 |
| 接触伤害 | 5~20，无敌帧 0.45s | 击退只有 4 像素，避免形成「力场圈」 |
| 升级来源权重 | 通用 40 / 专属 30 / 新装备 8 / 联动 15 / 进化 5 | 副武器、自动装备槽空着时「新装备」临时 +17 |
| 同类候选权重 | 空槽 ×1.5~1.9，已占槽 ×0.3 | 避免整局被「换掉手里的枪」灌满 |
| 主武器更换 | 每局 1 次（升级池）；之后只能靠宝箱 40% 翻出 | `p.mainLocked`，锁定后升级池不再给主武器 |
| 部署型耐久 | 设计时长 × 6，闲置 -4/s，每只贴身丧尸 -2.6/s | 摆空地能撑十几秒，丢进尸堆几秒就被拆 |
| 装备成长 | 5 级；`GROW_DMG 1.12`、`GROW_CD 1.1` | 进化后「觉醒」1→3 级，`g` 继承本体 60% |
| 行为分支 | 连射叠伤上限 +54%；转管预热 -40% 间隔 | 都靠「有目标 / 在开火」维持，停手就回落 |

调完记得跑一遍：

```bash
node tools/smoke.js && node tools/balance.js 6
```

`balance.js` 输出示例（`+auto` 自动装备件数，`+syn` 已生效联动数）：

```
#1 highway  DEAD 230s  kills= 405  Lv.15  [pistol_x:3,sawnoff:2 +auto0 +syn0]
#2 gas      WIN  376s  kills= 472  Lv.12  [pistol:4,decoy:4 +auto0 +syn1]
```

如果 6 局里 0 通关，说明 Boss 阶段太难；如果 6 局全通关且剩余时间充裕，说明后期压力不足。
注意 `balance.js` 里的机器人是「会走位但操作一般」的模拟玩家，它的选卡偏好写在文件末尾，
改完升级池之后最好顺手对一下这个偏好，否则测出来的不是真实强度。
