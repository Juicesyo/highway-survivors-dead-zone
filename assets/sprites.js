/* 由 tools/build-sprites.js 自动生成，请勿手改。
   重绘 assets/sprites.png 后可只更新帧表，不必重跑生成器。 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);
  var d = {
  "image": "assets/sprites.png",
  "size": {
    "w": 290,
    "h": 530
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
    "boss": {
      "x": 9,
      "y": 103,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "gatling": {
      "x": 57,
      "y": 103,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 27
    },
    "stalker": {
      "x": 108,
      "y": 106,
      "w": 26,
      "h": 30,
      "s": 0.5,
      "lr": 20
    },
    "walker_elite": {
      "x": 157,
      "y": 109,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 18
    },
    "runner_elite": {
      "x": 207,
      "y": 109,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "crawler_elite": {
      "x": 251,
      "y": 112,
      "w": 28,
      "h": 18,
      "s": 0.5,
      "lr": 12
    },
    "spitter_elite": {
      "x": 13,
      "y": 157,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "pouncer_elite": {
      "x": 63,
      "y": 157,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 13
    },
    "vomiter_elite": {
      "x": 109,
      "y": 156,
      "w": 24,
      "h": 26,
      "s": 0.5,
      "lr": 19
    },
    "brute_elite": {
      "x": 153,
      "y": 151,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "terrorist_elite": {
      "x": 205,
      "y": 155,
      "w": 24,
      "h": 28,
      "s": 0.5,
      "lr": 20
    },
    "boss_elite": {
      "x": 249,
      "y": 151,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "gatling_elite": {
      "x": 9,
      "y": 199,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 27
    },
    "stalker_elite": {
      "x": 60,
      "y": 202,
      "w": 26,
      "h": 30,
      "s": 0.5,
      "lr": 20
    },
    "walker_hit": {
      "x": 109,
      "y": 205,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 18
    },
    "runner_hit": {
      "x": 159,
      "y": 205,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "crawler_hit": {
      "x": 203,
      "y": 208,
      "w": 28,
      "h": 18,
      "s": 0.5,
      "lr": 12
    },
    "spitter_hit": {
      "x": 253,
      "y": 205,
      "w": 24,
      "h": 24,
      "s": 0.5,
      "lr": 17
    },
    "pouncer_hit": {
      "x": 15,
      "y": 253,
      "w": 20,
      "h": 24,
      "s": 0.5,
      "lr": 13
    },
    "vomiter_hit": {
      "x": 61,
      "y": 252,
      "w": 24,
      "h": 26,
      "s": 0.5,
      "lr": 19
    },
    "brute_hit": {
      "x": 105,
      "y": 247,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "terrorist_hit": {
      "x": 157,
      "y": 251,
      "w": 24,
      "h": 28,
      "s": 0.5,
      "lr": 20
    },
    "boss_hit": {
      "x": 201,
      "y": 247,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 23
    },
    "gatling_hit": {
      "x": 249,
      "y": 247,
      "w": 32,
      "h": 36,
      "s": 0.5,
      "lr": 27
    },
    "stalker_hit": {
      "x": 12,
      "y": 298,
      "w": 26,
      "h": 30,
      "s": 0.5,
      "lr": 20
    },
    "car_sedan_v": {
      "x": 61,
      "y": 293,
      "w": 24,
      "h": 40
    },
    "car_sedan_h": {
      "x": 101,
      "y": 301,
      "w": 40,
      "h": 24
    },
    "car_blue_v": {
      "x": 157,
      "y": 293,
      "w": 24,
      "h": 40
    },
    "car_blue_h": {
      "x": 197,
      "y": 301,
      "w": 40,
      "h": 24
    },
    "car_van_v": {
      "x": 252,
      "y": 291,
      "w": 26,
      "h": 44
    },
    "car_van_h": {
      "x": 3,
      "y": 348,
      "w": 44,
      "h": 26
    },
    "car_burnt_v": {
      "x": 61,
      "y": 341,
      "w": 24,
      "h": 40
    },
    "car_burnt_h": {
      "x": 101,
      "y": 349,
      "w": 40,
      "h": 24
    },
    "veh_sedan_v": {
      "x": 157,
      "y": 341,
      "w": 24,
      "h": 40
    },
    "veh_sedan_h": {
      "x": 197,
      "y": 349,
      "w": 40,
      "h": 24
    },
    "veh_pickup_v": {
      "x": 252,
      "y": 339,
      "w": 26,
      "h": 44
    },
    "veh_pickup_h": {
      "x": 3,
      "y": 396,
      "w": 44,
      "h": 26
    },
    "barrier_h": {
      "x": 56,
      "y": 403,
      "w": 34,
      "h": 12
    },
    "barrier_v": {
      "x": 115,
      "y": 392,
      "w": 12,
      "h": 34
    },
    "dumpster": {
      "x": 157,
      "y": 400,
      "w": 24,
      "h": 18
    },
    "crate": {
      "x": 209,
      "y": 401,
      "w": 16,
      "h": 16
    },
    "tires": {
      "x": 256,
      "y": 400,
      "w": 18,
      "h": 18
    },
    "cone": {
      "x": 20,
      "y": 451,
      "w": 10,
      "h": 12
    },
    "billboard": {
      "x": 51,
      "y": 442,
      "w": 44,
      "h": 30
    },
    "signpost": {
      "x": 113,
      "y": 445,
      "w": 16,
      "h": 24
    },
    "motelsign": {
      "x": 160,
      "y": 442,
      "w": 18,
      "h": 30
    },
    "cactus": {
      "x": 209,
      "y": 444,
      "w": 16,
      "h": 26
    },
    "rock": {
      "x": 253,
      "y": 448,
      "w": 24,
      "h": 18
    },
    "skull": {
      "x": 19,
      "y": 501,
      "w": 12,
      "h": 8
    }
  }
};
  G.HS = G.HS || {};
  G.HS.SheetData = d;
  if (typeof module !== 'undefined' && module.exports) module.exports = d;
})();
