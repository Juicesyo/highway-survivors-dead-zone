/* 由 tools/build-sprites.js 自动生成，请勿手改。
   重绘 assets/sprites.png 后可只更新帧表，不必重跑生成器。 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var d = {
  "image": "assets/sprites.png",
  "size": {
    "w": 290,
    "h": 578
  },
  "meta": {
    "cellW": 48,
    "cellH": 48,
    "cols": 6,
    "margin": 1,
    "version": 2
  },
  "frames": {
    "player_soldier": {
      "x": 13,
      "y": 11,
      "w": 24,
      "h": 28,
      "s": 0.5,
      "lr": 21
    },
    "player_medic": {
      "x": 61,
      "y": 11,
      "w": 24,
      "h": 28,
      "s": 0.5,
      "lr": 21
    },
    "player_mechanic": {
      "x": 109,
      "y": 11,
      "w": 24,
      "h": 28,
      "s": 0.5,
      "lr": 21
    },
    "player_ghost": {
      "x": 157,
      "y": 11,
      "w": 24,
      "h": 28,
      "s": 0.5,
      "lr": 21
    },
    "walker": {
      "x": 205,
      "y": 13,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 18
    },
    "runner": {
      "x": 255,
      "y": 13,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "crawler": {
      "x": 11,
      "y": 64,
      "w": 28,
      "h": 18,
      "s": 0.5,
      "lr": 12
    },
    "spitter": {
      "x": 61,
      "y": 61,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "pouncer": {
      "x": 111,
      "y": 61,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 13
    },
    "vomiter": {
      "x": 157,
      "y": 60,
      "w": 24,
      "h": 26,
      "s": 0.5,
      "lr": 19
    },
    "brute": {
      "x": 201,
      "y": 55,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "terrorist": {
      "x": 253,
      "y": 59,
      "w": 24,
      "h": 28,
      "s": 0.5,
      "lr": 20
    },
    "drowner": {
      "x": 15,
      "y": 109,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 13
    },
    "boss": {
      "x": 57,
      "y": 103,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "gatling": {
      "x": 105,
      "y": 103,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 27
    },
    "stalker": {
      "x": 156,
      "y": 106,
      "w": 26,
      "h": 30,
      "s": 0.5,
      "lr": 20
    },
    "axeboss": {
      "x": 201,
      "y": 103,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "walker_elite": {
      "x": 253,
      "y": 109,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 18
    },
    "runner_elite": {
      "x": 15,
      "y": 157,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "crawler_elite": {
      "x": 59,
      "y": 160,
      "w": 28,
      "h": 18,
      "s": 0.5,
      "lr": 12
    },
    "spitter_elite": {
      "x": 109,
      "y": 157,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "pouncer_elite": {
      "x": 159,
      "y": 157,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 13
    },
    "vomiter_elite": {
      "x": 205,
      "y": 156,
      "w": 24,
      "h": 26,
      "s": 0.5,
      "lr": 19
    },
    "brute_elite": {
      "x": 249,
      "y": 151,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "terrorist_elite": {
      "x": 13,
      "y": 203,
      "w": 24,
      "h": 28,
      "s": 0.5,
      "lr": 20
    },
    "drowner_elite": {
      "x": 63,
      "y": 205,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 13
    },
    "boss_elite": {
      "x": 105,
      "y": 199,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "gatling_elite": {
      "x": 153,
      "y": 199,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 27
    },
    "stalker_elite": {
      "x": 204,
      "y": 202,
      "w": 26,
      "h": 30,
      "s": 0.5,
      "lr": 20
    },
    "walker_hit": {
      "x": 253,
      "y": 205,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 18
    },
    "runner_hit": {
      "x": 15,
      "y": 253,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "crawler_hit": {
      "x": 59,
      "y": 256,
      "w": 28,
      "h": 18,
      "s": 0.5,
      "lr": 12
    },
    "spitter_hit": {
      "x": 109,
      "y": 253,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "pouncer_hit": {
      "x": 159,
      "y": 253,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 13
    },
    "vomiter_hit": {
      "x": 205,
      "y": 252,
      "w": 24,
      "h": 26,
      "s": 0.5,
      "lr": 19
    },
    "brute_hit": {
      "x": 249,
      "y": 247,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "terrorist_hit": {
      "x": 13,
      "y": 299,
      "w": 24,
      "h": 28,
      "s": 0.5,
      "lr": 20
    },
    "drowner_hit": {
      "x": 63,
      "y": 301,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 13
    },
    "boss_hit": {
      "x": 105,
      "y": 295,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "gatling_hit": {
      "x": 153,
      "y": 295,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 27
    },
    "stalker_hit": {
      "x": 204,
      "y": 298,
      "w": 26,
      "h": 30,
      "s": 0.5,
      "lr": 20
    },
    "axeboss_hit": {
      "x": 249,
      "y": 295,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "car_sedan_v": {
      "x": 13,
      "y": 341,
      "w": 24,
      "h": 40
    },
    "car_sedan_h": {
      "x": 53,
      "y": 349,
      "w": 40,
      "h": 24
    },
    "car_blue_v": {
      "x": 109,
      "y": 341,
      "w": 24,
      "h": 40
    },
    "car_blue_h": {
      "x": 149,
      "y": 349,
      "w": 40,
      "h": 24
    },
    "car_van_v": {
      "x": 204,
      "y": 339,
      "w": 26,
      "h": 44
    },
    "car_van_h": {
      "x": 243,
      "y": 348,
      "w": 44,
      "h": 26
    },
    "car_burnt_v": {
      "x": 13,
      "y": 389,
      "w": 24,
      "h": 40
    },
    "car_burnt_h": {
      "x": 53,
      "y": 397,
      "w": 40,
      "h": 24
    },
    "veh_sedan_v": {
      "x": 109,
      "y": 389,
      "w": 24,
      "h": 40
    },
    "veh_sedan_h": {
      "x": 149,
      "y": 397,
      "w": 40,
      "h": 24
    },
    "veh_pickup_v": {
      "x": 204,
      "y": 387,
      "w": 26,
      "h": 44
    },
    "veh_pickup_h": {
      "x": 243,
      "y": 396,
      "w": 44,
      "h": 26
    },
    "rubble": {
      "x": 14,
      "y": 449,
      "w": 22,
      "h": 16
    },
    "pipe_h": {
      "x": 60,
      "y": 450,
      "w": 26,
      "h": 14
    },
    "pipe_v": {
      "x": 114,
      "y": 444,
      "w": 14,
      "h": 26
    },
    "car_tipped_v": {
      "x": 155,
      "y": 439,
      "w": 28,
      "h": 36
    },
    "car_tipped_h": {
      "x": 199,
      "y": 443,
      "w": 36,
      "h": 28
    },
    "barrier_h": {
      "x": 248,
      "y": 451,
      "w": 34,
      "h": 12
    },
    "barrier_v": {
      "x": 19,
      "y": 488,
      "w": 12,
      "h": 34
    },
    "dumpster": {
      "x": 61,
      "y": 496,
      "w": 24,
      "h": 18
    },
    "crate": {
      "x": 113,
      "y": 497,
      "w": 16,
      "h": 16
    },
    "tires": {
      "x": 160,
      "y": 496,
      "w": 18,
      "h": 18
    },
    "cone": {
      "x": 212,
      "y": 499,
      "w": 10,
      "h": 12
    },
    "billboard": {
      "x": 243,
      "y": 490,
      "w": 44,
      "h": 30
    },
    "signpost": {
      "x": 17,
      "y": 541,
      "w": 16,
      "h": 24
    },
    "motelsign": {
      "x": 64,
      "y": 538,
      "w": 18,
      "h": 30
    },
    "cactus": {
      "x": 113,
      "y": 540,
      "w": 16,
      "h": 26
    },
    "rock": {
      "x": 157,
      "y": 544,
      "w": 24,
      "h": 18
    },
    "skull": {
      "x": 211,
      "y": 549,
      "w": 12,
      "h": 8
    }
  }
};
  G.HS = G.HS || {};
  G.HS.SheetData = d;
  if (typeof module !== 'undefined' && module.exports) module.exports = d;
})();
