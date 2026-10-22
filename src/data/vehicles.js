/**
 * 可驾驶载具数据表
 *
 * 载具是「一次性资源」：街上很少见，开上去能碾压尸群，但武器全部收起，
 * 撞车 / 撞墙 / 撞丧尸都会磨损耐久，耐久归零就报废，人会从车里被甩出来。
 *
 * 数值口径（速度单位与角色一致：单位/秒）：
 *   maxDur  基础耐久（受「车体装甲」加成）
 *   spd     最高速度
 *   accel   加速度（越大起步越猛）
 *   turn    最大转向角速度（弧度/秒，速度越高转向越迟钝）
 *   ramDmg  碾压基准伤害（再乘速度系数 / 撞角加成 / 时间成长）
 *   crashMul 撞障碍物时的耐久损耗倍率（皮卡更结实）
 *   r       车体碰撞半径
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var HS = G.HS;
  HS.Data = HS.Data || {};

  HS.Data.vehicles = {
    sedan: {
      id: 'sedan', name: '锈蚀轿车',
      spriteV: 'veh_sedan_v', spriteH: 'veh_sedan_h',
      w: 24, h: 40, r: 9,
      maxDur: 86, spd: 132, accel: 200, turn: 3.15,
      ramDmg: 26, crashMul: 1.0,
      color: '#8fae7d',
      desc: '轻、快、脆。踩到底很爽，撞两下就开始冒黑烟。'
    },
    pickup: {
      id: 'pickup', name: '报废皮卡',
      spriteV: 'veh_pickup_v', spriteH: 'veh_pickup_h',
      w: 26, h: 44, r: 11,
      maxDur: 148, spd: 106, accel: 152, turn: 2.45,
      ramDmg: 36, crashMul: 0.82,
      color: '#c08a4a',
      desc: '很重、很慢、很耐撞。车头能硬吃一整排尸群。'
    }
  };

  HS.Data.vehicleOrder = ['sedan', 'pickup'];

  HS.Data.vehicleSpawn = {
    /* 每个 192x192 区块的生成概率，越小越稀有（0.015 ≈ 每 67 个区块一辆）——
       以前 0.035 满地都是车，载具从"稀有资源"变成了"随手可丢的消耗品" */
    rate: 0.015,
    /* 单局世界里最多同时存在多少辆（含已经报废的残骸） */
    max: 14,
    /* 出生点附近固定摆一辆，保证第一局就能摸到方向盘 */
    starter: true,
    /* 皮卡的生成占比 */
    pickupChance: 0.42
  };
})();
