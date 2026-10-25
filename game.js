/**
 * 公路幸存者：死区（Highway Survivors: Dead Zone）
 * 微信小游戏入口文件
 *
 * 说明：所有逻辑模块都挂在全局命名空间 HS 下，
 * 这样同一套代码既能在微信小游戏里跑，也能在浏览器里跑（见 tools/build-browser.js）。
 */
require('./src/core/util.js');
require('./src/core/platform.js');
require('./src/core/input.js');
require('./assets/sprites.js');
require('./assets/title-bg.js');
require('./src/core/sprites.js');
require('./src/core/audio.js');
require('./src/data/enemies.js');
require('./src/data/weapons.js');
require('./src/data/autogear.js');
require('./src/data/upgrades.js');
require('./src/data/passives.js');
require('./src/data/chars.js');
require('./src/data/props.js');
require('./src/data/vehicles.js');
require('./src/data/icons.js');
require('./src/world/buildings.js');
require('./src/world/obstacles.js');
require('./src/world/water.js');
require('./src/game/save.js');
require('./src/game/game.js');
require('./src/game/gear.js');
require('./src/game/auto.js');
require('./src/game/combat.js');
require('./src/game/vehicle.js');
require('./src/game/render.js');
require('./src/game/ui.js');
require('./src/main.js');

HS.Main.boot();
