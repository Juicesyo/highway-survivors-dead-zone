/**
 * 像素美术源（String Pixel Art）
 *
 * 这里是「画」的地方：每张图是用字符表示的点阵 + 调色板。
 * 运行时不读这个文件 —— 它只被 tools/build-sprites.js 读取，
 * 烘焙成 assets/sprites.png 图集 + assets/sprites.js 帧表。
 *
 * 想改画面：改这里的点阵，然后跑 node tools/build-sprites.js
 * 想换成手绘图：直接按 assets/sprites.js 里的帧矩形重画 assets/sprites.png 即可。
 *
 * 密度（px 字段）：
 *   角色是 2 倍密度点阵（px: 2），绘制时按 0.5 缩放，屏幕占位等同 1 倍的
 *   12x14 / 12x12 等，但像素细节翻倍。配套的世界缓冲超采样在 platform.js 的 P.SS。
 *   道具（车 / 箱子）仍是 1 倍密度，不带 px 字段。
 *
 * 角色重画流程：
 *   node tools/gen-sprites-2x.js        （按行生成点阵，自动校验行宽）
 *   node tools/preview-sprites.js       （放大成 PNG 看效果）
 *   node tools/build-sprites.js         （烘焙进图集）
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
    : (typeof window !== 'undefined' ? window : globalThis);

  /* ---------------- 点阵 ---------------- */

  /*
   * 通用字母约定（各精灵按需取用，缺的字母不用写进 pal）：
   *   o 剪影描边   g/G/h 皮肤 主/亮/暗      d 皮肤阴影
   *   k 眼窝       e 瞳孔高光               m 口腔        x 牙/骨
   *   t/T/D 衣物 主/亮/暗                  w 血污 / 伤口
   *   c/C/n 头部装备 主/亮/暗              j/J/h2 外套 主/亮/暗
   *   s/S 裸露皮肤 主/亮                   b/B 鞋 主/亮
   *
   * 画法约定：光从左上打过来 → 左侧用亮色、右侧用暗色；整个剪影包一圈深色描边，
   * 让人物在灰色柏油路面上不会糊成一团。
   */

  var defs = {
    /* 主角 14x16：军帽压眉 / 带高光的眼睛 / 收腰夹克+领口拉链 / 腰带 / 双腿 */
    player: {
      w: 24, h: 28, px: 2,
      pal: {
        '.': null,
        o: '#0e1218',
        c: '#2f4f6f', C: '#4a719a', n: '#1d3350',
        s: '#e8b98d', S: '#ffd9b0', d: '#b98a63', k: '#15181f', e: '#eef4fa', m: '#7d4a38',
        j: '#3b5b8a', J: '#527bb0', h: '#27405f', q: '#c3cedb', a: '#7a5232',
        p: '#39404f', P: '#4b5368', b: '#1d222b', B: '#272d37'
      },
      rows: [
        '.....oCCCCCCCCCCCCo.....',
        '.....oCCCCCCCCCCCCo.....',
        '.....oCccccccccccCo.....',
        '.....oCccccecccccCo.....',
        '...onnnnnnnnnnnnnnnno...',
        '....odssssssssssssdo....',
        '....osssssssssssssso....',
        '....osskekksskkkksso....',
        '....osssssssssssssso....',
        '....osssssmmmmssssso....',
        '.....odssssssssssdo.....',
        '......oojjjjjjjjoo......',
        'oJJJJJJJJJJJJJJJJJJJJJJo',
        'oJJhhJJJJaaqqqqJJJJhhJJo',
        '.ohJJJJJJJaajjjjjjJJJho.',
        '.ohJJJJJJJJaajjjjJJJJho.',
        '.ohJJJJJJJJJJaajjjJJJho.',
        '.osjjjjjjjjjjjjjjjjjjso.',
        '.oBBBBBBBBBBBBBBBBBBBBo.',
        '......oppppppppppo......',
        '..oppppppppppppppppppo..',
        '..opppppppp..ppppppppo..',
        '..opppPPppp..pppPPpppo..',
        '..opppppppp..ppppppppo..',
        '..opppppppp..ppppppppo..',
        '.opppppppp....ppppppppo.',
        '..obbbbbbb....bbbbbbbo..',
        '..obbbbbbb....bbbbbbbo..'
      ]
    },

    /* 游荡者 14x14：歪头、双眼红光、咧到耳根的烂嘴露着牙、烂衣露肚 */
    walker: {
      w: 24, h: 24, px: 2,
      pal: {
        '.': null,
        o: '#0d1109',
        g: '#6f9a4a', G: '#8cb864', h: '#4c6b32', d: '#48632f',
        k: '#141a10', e: '#e0503c', m: '#1b0f0f', x: '#d8cfa8',
        t: '#4a5a3a', T: '#5f7249', D: '#33402a', w: '#3a3a40', b: '#141a12'
      },
      rows: [
        '..........oooo..........',
        '........oGGGGGGGGGo.....',
        '........oGgggggggGo.....',
        '........oggggggggggo....',
        '........ogkkeggkkego....',
        '........oggggggggggo....',
        '........ogdmmmmmmdgo....',
        '........ogdxxxxxxdgo....',
        '.......oggggggggo.......',
        '.........oddddo.........',
        '....otttgxgxgtttttgo....',
        '....ottgxgxgxgttttgo....',
        '....otttgxgxgtttttgo....',
        '....ottttwwtttttttgo....',
        '....otttttttttttttto....',
        '....otttttttttttttto....',
        '.....otttttttttttto.....',
        '.....oddddddddddddo.....',
        '....odddddd..ddddddo....',
        '....odddddd..ddddddo....',
        '.....oddddd..dddddo.....',
        '.....oddddd..dddddo.....',
        '.....obbbbb..bbbbbo.....',
        '.....obbbbb..bbbbbo.....'
      ]
    },

    /* 疾行者 12x14：前倾冲刺、两排露出的肋骨、侧腹撕裂 */
    runner: {
      w: 20, h: 24, px: 2,
      pal: {
        '.': null,
        o: '#0d110b',
        g: '#7ba85a', G: '#9cc772', h: '#547a3a',
        k: '#141a10', e: '#ffd166', m: '#1b0f0f',
        t: '#8a3a3a', T: '#a54c4c', D: '#632727', w: '#54545c', d: '#48632f',
        x: '#cfc7a0',
        b: '#222a21', B: '#2c362a'
      },
      rows: [
        '.......oooooo.......',
        '.....oGGGGGGGGo.....',
        '.....oGggggggGo.....',
        '....oggggggggggo....',
        '....ogkkeggkkego....',
        '....ogdmmmmmmdgo....',
        '.....oggggggggo.....',
        '......ogggdddo......',
        '...otttttttttttto...',
        '..oTTtttttttttDDgo..',
        '..ogttxxtxxtxxttgo..',
        '..ogtttxtxtxttttgo..',
        '..ogtttwwtttttttgo..',
        '..ogttttttttttttgo..',
        '...otttttttttttto...',
        '....oddddddddddo....',
        '....oddddddddddo....',
        '...oddddd.dddddo....',
        '...odddd...ddddo....',
        '...odddd...ddddo....',
        '..odddd.....ddddo...',
        '..odddd.....ddddo...',
        '..obbbb.....bbbbo...',
        '..obbbb.....bbbbo...'
      ]
    },

    /* 爬行者 16x10：低伏贴地、头前伸、脊背弓起、四肢撑开 */
    crawler: {
      w: 28, h: 18, px: 2,
      pal: {
        '.': null,
        o: '#0d1109',
        g: '#8aa85a', G: '#a6c273', h: '#5d7a3a', d: '#4c6740',
        k: '#141a10', e: '#e0503c', m: '#1b0f0f', w: '#3a3a40', x: '#d8cfa8',
        t: '#4a5a3a', T: '#5f7249', D: '#33402a', b: '#18231a'
      },
      rows: [
        '............oooo............',
        '..........oGGGGGGo..........',
        '.........oGggggggGo.........',
        '.........okkeggkkeo.........',
        '.........ogdmmmmdgo.........',
        '..........oggggggo..........',
        '....oxxttttxxttttxxtttto....',
        '...oTTTttttttttttttttDDDo...',
        '..ottttttwwtttttttttttttto..',
        '..ogttttttttttttttttttttgo..',
        '..ogttttttttttttttttttttgo..',
        '...oddddddddddddddddddddo...',
        '....odddd..ddddd..ddddo.....',
        '....odddd..ddddd..ddddo.....',
        '.....oddd..ddddd..dddo......',
        '.....obbb..bbbbb..bbbo......',
        '.....obbb..bbbbb..bbbo......',
        '......obb...bbbb...bbo......'
      ]
    },

    /* 吐酸者 14x14：脸颊鼓气、酸囊占满半个身子、细腿撑不住的重量感 */
    spitter: {
      w: 24, h: 24, px: 2,
      pal: {
        '.': null,
        o: '#0b100e',
        g: '#5f8f6a', G: '#7cb089', h: '#3f6650', d: '#385c47',
        k: '#101514', e: '#ffd166', m: '#170b0b',
        t: '#3e4a3a', T: '#4e5d4a', D: '#2a332a', b: '#16201b',
        l: '#9be04a', L: '#c8f57a'
      },
      rows: [
        '........oooooooo........',
        '......oGGGGGGGGGGo......',
        '.....oGggggggggggGo.....',
        '.....oggggggggggggo.....',
        '.....oggkkggggkkggo.....',
        '.....oglLLggegLLlgo.....',
        '.....oggdmmmmmmdggo.....',
        '.....ogggdmmlmdgggo.....',
        '....otttttttttttttto....',
        '...otttLLLLLLLLtttTto...',
        '...otLLllllllllllLLto...',
        '...otLLlllLllLlllLLto...',
        '...otLLllllllllllLLto...',
        '...ottLLLLLLLLLLLLtto...',
        '....ottttLLLLLLtttto....',
        '.....otttttttttttto.....',
        '.....oddddddddddddo.....',
        '.....odddd....ddddo.....',
        '.....odddd....ddddo.....',
        '.....odddd....ddddo.....',
        '.....oddd.....dddo......',
        '.....obbb.....bbbo......',
        '.....obbb.....bbbo......',
        '.....obbb.....bbbo......'
      ]
    },

    /* 扑袭者 10x12（2 倍密度）：死区之夜专属。弓背缩成一团蓄力的跳行者，
       细长的弹簧腿 + 两排前伸的骨爪，红瞳 —— 夜里只能先看见两点红光 */
    pouncer: {
      w: 20, h: 24, px: 2,
      pal: {
        '.': null,
        o: '#0d0d12',
        g: '#6a6478', G: '#847e94', d: '#4a4556',
        k: '#141218', e: '#ff4a3c', m: '#1c0f12', x: '#d8cfa8',
        t: '#3a3644', T: '#4c4758', w: '#3a3a40', b: '#1a1720'
      },
      rows: [
        '.......oooooo.......',
        '......oGGGGGGo......',
        '......oGggggGo......',
        '......ogkeekgo......',
        '......ogxmmxgo......',
        '......oggggggo......',
        '....otttttttttto....',
        '...ottTTTttttTto....',
        '...ogttttttttttgo...',
        '..ogtttwwtttttxgo...',
        '...ogttttttttttxo...',
        '...otttttttttttto...',
        '....oddddddddddo....',
        '....odddd..ddddo....',
        '.....oddd..dddo.....',
        '......odd..ddo......',
        '......odd..ddo......',
        '......odd..ddo......',
        '......obb..bbo......',
        '.....obbb..bbbo.....',
        '.....obbb..bbbo.....',
        '.....obbb..bbbo.....',
        '.....obbb..bbbo.....',
        '.....obbb..bbbo.....'
      ]
    },

    /* 呕酸尸 12x13（2 倍密度）：死区之夜专属。头往后仰、下巴整个脱臼挂着，
       占满半身的酸囊盘着血管，细脖子细腿 —— 一看就是"肚子要炸了" */
    vomiter: {
      w: 24, h: 26, px: 2,
      pal: {
        '.': null,
        o: '#0d120c',
        g: '#7a9a4a', G: '#95b862', d: '#4c6330',
        k: '#141a10', e: '#e0503c', m: '#170c0c', x: '#d8cfa8',
        t: '#46523a', T: '#58684a',
        l: '#9be04a', L: '#c8f57a', b: '#182014'
      },
      rows: [
        '.........oooooo.........',
        '........oGGGGGGo........',
        '........oGggggGo........',
        '.......ogkeggkgo........',
        '......ogdmmmmmmdgo......',
        '......ogxxxxxxxxgo......',
        '.......oggddddggo.......',
        '........otttttto........',
        '......otttttttttto......',
        '.....otLLLLLLLLLLto.....',
        '....otLLllllllllLLto....',
        '...otLLllLllllLllLLto...',
        '....otLLllllllllLLto....',
        '....otLllLllllLllLto....',
        '....ottLLLLLLLLLLtto....',
        '....otttLLLLLLLLttto....',
        '....otttttttttttttto....',
        '....ogttttttttttttgo....',
        '.....oddddddddddddo.....',
        '.....odddd....ddddo.....',
        '.....odddd....ddddo.....',
        '......oddd....dddo......',
        '......oddd....dddo......',
        '......obbb....bbbo......',
        '......obbb....bbbo......',
        '......obbb....bbbo......'
      ]
    },

    /* 壮汉 18x20：小脑袋陷在肩里、巨臂垂到膝盖、咧嘴一排烂牙 */
    brute: {
      w: 32, h: 36, px: 2,
      pal: {
        '.': null,
        o: '#0b0f0a',
        g: '#5d7a3a', G: '#76974b', h: '#41562a', d: '#405829',
        k: '#10150c', e: '#ff5533', m: '#1a0d0d', x: '#d8cfa8',
        t: '#3d4a32', T: '#4f5f42', D: '#29331f', w: '#3c3c42',
        s: '#74914c', S: '#8fae62',
        b: '#252520', B: '#36362c'
      },
      rows: [
        '............oooooooo............',
        '...........oGGGGGGGGo...........',
        '...........oGggggggGo...........',
        '..........oggggggggggo..........',
        '..........ogkkkgggkxgo..........',
        '..........oggggggggggo..........',
        '..........ogdmmxxxmmdo..........',
        '...........oggggggggo...........',
        '...........ogddddddgo...........',
        '.oxxttttttttttttttttttttttttxxo.',
        'oxxTTTttttttttttttttttttttTTTxxo',
        'oggttttttttttttttttttttttttttggo',
        '.oggttttttttttttttttttttttttggo.',
        '.oggttttttttttttttttttttttttggo.',
        '.oggttttttwwxxxxwwttttttttttggo.',
        '.oggtttttttwxxxxwtttttttttttggo.',
        '.oggttttttttwwwwttttttttttttggo.',
        'ossttttttttttttttttttttttttttsso',
        '..otttttttttttttttttttttttttto..',
        '...otttttttttttttttttttttttto...',
        '....otttttttttttttttttttttto....',
        '.....oddddddddddddddddddddo.....',
        '.....oddddddddddddddddddddo.....',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......odddddd.....ddddddo.......',
        '......odddddd.....ddddddo.......',
        '......obbbbbb.....bbbbbbo.......',
        '......obbbbbb.....bbbbbbo.......',
        '......obbbbbb.....bbbbbbo.......',
        '......obbbbbb.....bbbbbbo.......'
      ]
    },

    /* 扫射暴君 16x18（2 倍密度）：死区之夜 Boss。体型与血肉暴君相当，
       钢盔压眉，双手横抱一挺巨型加特林 —— 枪身上带着干涸的血迹，
       枪管过热时会冒烟。scale 2 放大显示 */
    gatling: {
      w: 32, h: 36, px: 2,
      pal: {
        '.': null,
        o: '#0a0d0a',
        c: '#3a4430', C: '#4e5a3e', n: '#242c1c',
        g: '#7a8a5a', G: '#93a470', d: '#4a5530',
        k: '#101408', e: '#ffd166', m: '#1c0d0d', x: '#d8cfa8',
        t: '#3d4432', T: '#4e5740', D: '#282e1f', w: '#6b1f1f',
        r: '#2c3138', R: '#4a525c',
        s: '#74914c', b: '#1c1f16'
      },
      rows: [
        '............oooooooo............',
        '...........oCCCCCCCCCCo.........',
        '..........oCccccccccccCo........',
        '.........onCCCCCCCCCCCCno.......',
        '..........oggggggggggggo........',
        '..........ogkkkggggkkkgo........',
        '..........ogeeGGGGGGeeo.........',
        '..........oggggggggggggo........',
        '..........oggdmmmmmmmdgo........',
        '..........oggxxxxxxxxggo........',
        '...........oggggggggggo.........',
        '............ogddddddgo..........',
        '.oTTTttttttttttttttttttttTTTo...',
        '.oggtttttttttttttttttttttttggo..',
        '.orrRRRRRRRRRRRRRRRRRRRRRRwwo...',
        '.oggrRRRRRRRRRRRRRRRRRRRRRRggo..',
        '.orrRRRRRRRRRRRRRRRRRRRRRRwwo...',
        '.oggrRRRRRRRRRRRRRRRRRRRRRRggo..',
        '.orrRRRRRRRRRRRRRRRRRRRRRRwwo...',
        '.oggtttttttttttttttttttttttggo..',
        '.oggttttttwwwwtttttttttttttggo..',
        '.oggtttttttttttttttttttttttggo..',
        '.osstttttttttttttttttttttttsso..',
        '..otttttttttttttttttttttttttto..',
        '..oDDDDDDDDDDDDDDDDDDDDDDDDDDo..',
        '..oDDDDDDDDDDDDDDDDDDDDDDDDDDo..',
        '.....oddddddddddddddddddo.......',
        '.....oddddddd....dddddddo.......',
        '.....oddddddd....dddddddo.......',
        '.....oddddddd....dddddddo.......',
        '.....oddddddd....dddddddo.......',
        '.....oddddddd....dddddddo.......',
        '.....oddddddd....dddddddo.......',
        '.....odddddd.....ddddddo........',
        '.....obbbbbb.....bbbbbbo........',
        '.....obbbbbb.....bbbbbbo........'
      ]
    },

    /* 猎杀者 13x15（2 倍密度）：荒漠公路 Boss。丧尸病毒变异出的狼形态：
       立耳、外翻的獠牙、爪臂、弓起的背 —— 比其它 Boss 瘦但更长，
       站起来的时候像人，扑起来的时候是野兽。scale 2 放大显示 */
    stalker: {
      w: 26, h: 30, px: 2,
      pal: {
        '.': null,
        o: '#0c0a0d',
        g: '#5f4f43', G: '#776556', d: '#43362d',
        k: '#120e10', e: '#ffd166', m: '#1a0c0c', x: '#e0d7b8',
        t: '#4a3d33', T: '#5c4d40', w: '#3a3a40', b: '#1a1512'
      },
      rows: [
        '.......oo........oo.......',
        '......oGGo....ooGGo.......',
        '.....ooGGGGGGGGGGoo.......',
        '....oGGgggggggggGGo.......',
        '....ogkeeggggeekggo.......',
        '.....ogggggggggggo........',
        '.....ogdmmmmmmdggo........',
        '.....ogxmmmmmmxggo........',
        '......ogggggggggo.........',
        '......oggddddggo..........',
        '....otttttttttttto........',
        '...ottttttttttttttto......',
        '..ogttTTTTttttTTTTtgo.....',
        '..ogtttttttttttttttgo.....',
        '..ogtttttwwttttttttgo.....',
        '..ogttttttttttttttxxgo....',
        '...ottttttttttttttto......',
        '....otttttttttttto........',
        '....oddddddddddddo........',
        '.....oddddddddddo.........',
        '.....oddddd..ddddo........',
        '.....oddddd..ddddo........',
        '.....oddddd..ddddo........',
        '.....oddddd..ddddo........',
        '.....oddddd..ddddo........',
        '.....oddddd..ddddo........',
        '.....obbbbb..bbbbo........',
        '....obbbbb....bbbbbo......',
        '....obbbb......bbbbo......',
        '...obbbb........bbbbo.....'
      ]
    },

    /* 持枪匪徒 12x14（2 倍密度）：套头帽只露一条眼缝，战术背心上一条弹带，
       横在胸前的步枪是最好认的特征 —— 枪口从左伸到右，和丧尸的剪影完全不同 */
    terrorist: {
      w: 24, h: 28, px: 2,
      pal: {
        '.': null,
        o: '#0b0d10',
        c: '#1e2228', C: '#2e343d', n: '#13161a',
        k: '#080a0c', e: '#ffe9b0',
        y: '#8f3a2c', Y: '#b04a36',
        t: '#4a4030', T: '#5f5340', D: '#332b20',
        j: '#22262c', J: '#31363e', q: '#b8894a',
        s: '#c99a72', d: '#a87d58',
        u: '#5a3a22', U: '#7a5232', r: '#2c3138', R: '#5d6875',
        p: '#2f3440', P: '#3f4552', b: '#16181c', B: '#2a2d33'
      },
      rows: [
        '.........oooooo.........',
        '........oCCCCCCCCo......',
        '......oCccccccccCo......',
        '......occcccccccco......',
        '......oCkeekkeekCo......',
        '......occcccccccco......',
        '......onccccccccno......',
        '......oyyyyyyyyyyo......',
        '......oyYyyyyyyYyo......',
        '....oJjjjjjjjjjjjDo.....',
        '.oJJjjjjjjjjjjjjjjjjDDo.',
        '.oJJjjjjjjjjjjjjjjjjDDo.',
        '.oJjUUjjjUUjjjUUjjjjDDo.',
        '.oJjUUjjjUUjjjUUjjjjDDo.',
        '.oDRRRRRRRRRRRRRRRRRDo..',
        '.osRRRRRRRqqRRRRRRRRso..',
        '.oJjjjjjjjjjjjjjjjjjjDo.',
        '....oJjjjjjjjjjjjjDo....',
        '....ojjnnnnnnnnnnjjo....',
        '.....oppppppppppppo.....',
        '.....oppppp..pppppo.....',
        '.....oppppp..pppppo.....',
        '.....oppppp..pppppo.....',
        '.....oppppp..pppppo.....',
        '.....oppppp..pppppo.....',
        '.....obbbbb..bbbbbo.....',
        '.....obbbbb..bbbbbo.....',
        '.....obbbbb..bbbbbo.....'
      ]
    },

    /* Boss：血肉暴君，头顶双骨刺、苍白尸皮、灰黑围裙、脓包溃烂（scale 2 放大显示） */
    boss: {
      w: 32, h: 36, px: 2,
      pal: {
        '.': null,
        o: '#0a0a0c',
        g: '#87936e', G: '#a3ad8b', h: '#6a7357', d: '#5c6450',
        k: '#120c0c', e: '#ffe066', m: '#240606', x: '#e8e0c0',
        t: '#3a3a40', T: '#4a4a52', D: '#26262b', w: '#6b4a3a',
        s: '#9aa57e', S: '#b3bd97',
        b: '#1e1c1c', B: '#2e2a2a'
      },
      rows: [
        '....oxxo................oxxo....',
        '....oxxo................oxxo....',
        '.......oGGGGGGGGGGGGGGGGo.......',
        '......oGGggggggggggggggGGo......',
        '......oGGggggggggggggggGGo......',
        '......oggggggggggggggggggo......',
        '......oggkkkkggggggkkkkggo......',
        '......oggggggggggggggggggo......',
        '......oggdmmmmmmmmmmmmdggo......',
        '......oggdxxxxxxxxxxxxdggo......',
        '......oggggggddddddggggggo......',
        '.........oddddddddddddo.........',
        'oxxTTttttttttttttttttttttttTTxxo',
        'oggttttxtxxtxxtxxtxttttttttttggo',
        'oggttttxtxtxtxtxtttttttttttttggo',
        '.oggttttttttwwttttttttttttttggo.',
        '.oggttttttttttttttttttttttttggo.',
        '.oggttttttttttttttttttttttttggo.',
        'ossttttttttttttttttttttttttttsso',
        '.otttttttttttttttttttttttttttto.',
        '..oDDDDDDDDDDDDDDDDDDDDDDDDDDo..',
        '..oDDDDDDDDDDDDDDDDDDDDDDDDDDo..',
        '.....oddddddddddddddddddddo.....',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......oddddddd....dddddddo......',
        '......odddddd.....ddddddo.......',
        '......odddddd.....ddddddo.......',
        '......obbbbbb.....bbbbbbo.......',
        '......obbbbbb.....bbbbbbo.......',
        '......obbbbbb.....bbbbbbo.......',
        '......obbbbbb.....bbbbbbo.......'
      ]
    }
  };

  /* 锈水高速：水鬼沿用扑袭者的低伏剪影，换成泡烂的青灰皮肤，
     靠近浅水时会和浑浊水面融在一起；巨斧 Boss 用暴君骨架，改成锈红尸皮，
     双斧由 render.js 按动作状态叠加绘制。 */
  defs.drowner = {
    w: 20, h: 24, px: 2,
    pal: {
      '.': null, o: '#07100f',
      g: '#426d63', G: '#5d8b7d', h: '#31564f', d: '#29453f',
      k: '#06100e', e: '#d8ffcf', m: '#180e0c', x: '#d8d2ac',
      t: '#355846', T: '#47705a', w: '#61766b', b: '#101b18'
    },
    rows: defs.pouncer.rows
  };
  defs.axeboss = {
    w: 32, h: 36, px: 2, boss: true,
    pal: {
      '.': null, o: '#090b0a',
      g: '#776951', G: '#94856a', h: '#584c3b', d: '#463d31',
      k: '#110c0b', e: '#ff7a45', m: '#240807', x: '#e0d2a8',
      t: '#343b36', T: '#48534a', D: '#222824', w: '#8a4b33',
      s: '#8f7f62', S: '#aa9877', b: '#1d1c1a', B: '#2d2b26'
    },
    rows: defs.boss.rows
  };

  /* ---------------- 角色配色 ---------------- */

  /* 每套服装都要给出完整的明暗阶，否则帽檐/领口会留着上一套的颜色 */
  var playerPals = {
    soldier: {
      c: '#2f4f6f', C: '#4a719a', n: '#1d3350',
      j: '#3b5b8a', J: '#527bb0', h: '#27405f', q: '#c3cedb',
      p: '#39404f', P: '#4b5368'
    },
    medic: {
      c: '#a83e3e', C: '#c95959', n: '#78292a',
      j: '#c9d0d8', J: '#e6ecf2', h: '#97a3ae', q: '#f2f6fa',
      p: '#464c57', P: '#5c6472'
    },
    mechanic: {
      c: '#8a5a1a', C: '#b07a2a', n: '#5f3d0f',
      j: '#d9a441', J: '#f0c66a', h: '#a87a24', q: '#f2e3c2',
      p: '#464034', P: '#5e5446'
    },
    ghost: {
      c: '#4b3a72', C: '#6d56a6', n: '#32265a',
      j: '#8f76c9', J: '#ab93e2', h: '#6a559d', q: '#d8cdf0',
      p: '#38314a', P: '#494060'
    }
  };

  /* ---------------- 场景道具（程序化绘制，同样进图集） ---------------- */

  function T(px) {
    return function (x, y, w, h, c) { px(y, x, h, w, c); };
  }

  var PAL = {
    sedan: { body: '#7d3a34', dark: '#3a1c18', roof: '#8f4a42', glass: '#2b3a46' },
    sedan2: { body: '#3c4c5e', dark: '#1d2530', roof: '#4a5c70', glass: '#2b3a46' },
    van: { body: '#5c5a46', dark: '#2c2a20', roof: '#6e6c54', glass: '#2b3a46' },
    burnt: { body: '#26262a', dark: '#121215', roof: '#303035', glass: '#17171b' },
    /* 可驾驶载具：比路边废车多一圈车顶架 / 黄黑警示条 / 明显的车灯，
       一眼能和"只能搜刮的车壳"区分开。
       配色整体往"被雨泡了半年"压：饱和度低、明度散，锈迹比原厂漆还多。 */
    vehSedan: {
      body: '#4a5341', bodyL: '#5d6850', dark: '#222a23', roof: '#3e4736',
      glass: '#242c33', glassL: '#3d4b57', rust: '#6d4425', rust2: '#8a5a30',
      stripe: '#b8863a', tire: '#0f1114', metal: '#333a42',
      hole: '#14120e', prim: '#6b5c4a', tape: '#9d968a'
    },
    vehPickup: {
      body: '#7d5734', bodyL: '#946740', dark: '#33210f', roof: '#73502f',
      glass: '#252d34', glassL: '#3d4b57', rust: '#8e5527', rust2: '#ad7434',
      stripe: '#a9b0b6', tire: '#0f1114', metal: '#333a42',
      hole: '#14120e', prim: '#6b5c4a', tape: '#9d968a'
    }
  };

  /* 俯视轿车 24x40（横向用 T() 转置） */
  function carBody(px, o) {
    px(0, 7, 2, 7, '#12141a');
    px(22, 7, 2, 7, '#12141a');
    px(0, 26, 2, 7, '#12141a');
    px(22, 26, 2, 7, '#12141a');
    px(1, 8, 1, 3, o.dark);
    px(22, 8, 1, 3, o.dark);
    px(2, 1, 20, 38, o.body);
    px(2, 0, 20, 2, o.dark);
    px(2, 38, 20, 2, o.dark);
    px(4, 2, 4, 2, '#f2e4b0');
    px(16, 2, 4, 2, '#f2e4b0');
    px(4, 6, 16, 5, o.glass);
    px(4, 11, 16, 15, o.roof);
    px(4, 26, 16, 4, o.glass);
    px(4, 30, 16, 5, o.body);
    px(2, 25, 2, 5, o.dark);
    px(20, 25, 2, 5, o.dark);
    px(4, 35, 4, 2, '#9c3030');
    px(16, 35, 4, 2, '#9c3030');
    px(6, 20, 3, 2, '#6b4a2a');
    px(14, 13, 2, 3, '#5e3f26');
    px(9, 31, 5, 3, '#5e2b26');
  }

  /* 厢式货车 26x44 */
  function vanBody(px, o) {
    px(0, 8, 2, 8, '#12141a');
    px(24, 8, 2, 8, '#12141a');
    px(0, 28, 2, 8, '#12141a');
    px(24, 28, 2, 8, '#12141a');
    px(2, 1, 22, 42, o.body);
    px(2, 0, 22, 2, o.dark);
    px(2, 41, 22, 2, o.dark);
    px(5, 3, 16, 5, o.glass);
    px(4, 9, 18, 28, o.roof);
    px(4, 18, 18, 1, o.dark);
    px(4, 30, 18, 1, o.dark);
    px(5, 1, 4, 2, '#f2e4b0');
    px(17, 1, 4, 2, '#f2e4b0');
    px(5, 39, 4, 2, '#9c3030');
    px(17, 39, 4, 2, '#9c3030');
    px(6, 22, 4, 3, '#6b4a2a');
  }

  /* 可驾驶轿车 24x40：车头朝上。
     这是一辆被人丢在路上的车：左前胎瘪了、右大灯碎了、左边车门是拆车件、
     风挡裂成蜘蛛网还贴着胶带，引擎盖上有干掉的血手印。 */
  function vehSedan(px, o) {
    /* 轮胎：左前瘪掉一截，右后轮毂不见了 */
    px(0, 8, 2, 6, o.tire);
    px(22, 7, 2, 7, o.tire);
    px(0, 26, 2, 7, o.tire);
    px(22, 26, 2, 7, o.tire);
    px(0, 12, 2, 2, o.dark);
    px(1, 9, 1, 2, o.metal);
    px(22, 9, 1, 2, o.metal);
    px(1, 28, 1, 3, o.metal);
    px(22, 28, 1, 3, o.hole);
    /* 车身 */
    px(2, 1, 20, 38, o.body);
    px(2, 0, 20, 2, o.dark);
    px(2, 38, 20, 2, o.dark);
    px(2, 1, 2, 38, o.bodyL);
    px(20, 1, 2, 38, o.dark);
    px(3, 0, 3, 1, o.hole);
    px(17, 39, 5, 1, o.hole);
    /* 后视镜：右边只剩个支架 */
    px(0, 10, 2, 2, o.metal);
    px(22, 10, 1, 1, o.metal);
    /* 引擎盖：褪色的警示条 + 凹坑 + 血手印 */
    px(4, 2, 16, 1, o.stripe);
    px(4, 3, 4, 1, o.prim);
    px(9, 3, 3, 1, o.rust);
    px(13, 3, 7, 1, o.prim);
    px(4, 4, 16, 3, o.bodyL);
    px(5, 4, 2, 1, o.dark);
    px(6, 5, 1, 1, o.rust);
    px(10, 6, 6, 1, '#35322f');
    px(11, 5, 3, 1, '#45413d');
    /* 车灯：左边还亮，右边碎了 */
    px(4, 1, 4, 2, '#d8c894');
    px(16, 1, 4, 2, '#5b5347');
    px(16, 2, 1, 1, o.hole);
    px(18, 1, 1, 1, o.hole);
    /* 前风挡：蜘蛛网裂纹，左下角缠着胶带 */
    px(4, 8, 16, 5, o.glass);
    px(5, 8, 6, 1, o.glassL);
    px(13, 8, 1, 5, '#6d7a85');
    px(10, 10, 4, 1, '#6d7a85');
    px(15, 11, 1, 2, '#6d7a85');
    px(5, 9, 1, 4, o.tape);
    px(6, 10, 3, 1, o.tape);
    /* 车顶 + 歪掉的行李架（左边断成两截） */
    px(4, 13, 16, 15, o.roof);
    px(4, 14, 16, 1, o.dark);
    px(3, 13, 1, 5, o.metal);
    px(3, 21, 1, 3, o.metal);
    px(19, 13, 1, 15, o.metal);
    px(8, 16, 7, 1, o.metal);
    px(9, 21, 7, 1, o.metal);
    px(8, 26, 7, 1, o.metal);
    /* 左边车门是拆车件：颜色对不上，边上一条焊疤 */
    px(2, 19, 2, 9, '#5c5540');
    px(3, 19, 1, 9, o.dark);
    px(2, 18, 2, 1, o.rust);
    /* 车顶捆着一只备用油桶：这是"要跑长途的人"才会干的事 */
    px(9, 17, 6, 5, '#6b2f24');
    px(9, 17, 6, 1, '#8f3f30');
    px(9, 17, 1, 5, '#7d3829');
    px(13, 17, 2, 5, o.dark);
    px(11, 16, 2, 1, o.metal);
    px(12, 15, 1, 1, o.rust2);
    px(10, 19, 2, 1, '#3a1a14');
    /* 锈穿 / 弹孔 */
    px(5, 16, 3, 2, o.rust);
    px(5, 16, 1, 1, o.hole);
    px(15, 23, 3, 2, o.rust2);
    px(16, 23, 1, 1, o.hole);
    px(21, 31, 1, 6, o.rust2);
    px(6, 33, 2, 2, o.rust);
    px(6, 33, 1, 1, o.hole);
    px(17, 27, 1, 1, o.hole);
    /* 后窗 + 后备箱 */
    px(4, 28, 16, 4, o.glass);
    px(5, 28, 5, 1, o.glassL);
    px(15, 28, 1, 4, o.tape);
    px(4, 32, 16, 5, o.body);
    px(4, 32, 16, 1, o.prim);
    px(5, 34, 3, 1, o.rust2);
    px(13, 35, 4, 1, o.dark);
    /* 尾灯：左边亮着，右边撞没了 */
    px(4, 36, 4, 2, '#8f2b2b');
    px(16, 36, 3, 2, o.hole);
  }

  /* 可驾驶皮卡 26x44：前半驾驶室、后半敞篷货斗。
     后挡板整个掉了、货斗底板锈穿，备胎是瘪的，上面搭着一块脏帆布。 */
  function vehPickup(px, o) {
    px(0, 8, 2, 8, o.tire);
    px(24, 8, 2, 8, o.tire);
    px(0, 29, 2, 8, o.tire);
    px(24, 29, 2, 8, o.tire);
    px(0, 35, 2, 2, o.dark);
    px(1, 9, 1, 4, o.metal);
    px(24, 9, 1, 4, o.metal);
    px(1, 30, 1, 4, o.metal);
    px(24, 30, 1, 3, o.metal);
    /* 车身 */
    px(2, 1, 22, 42, o.body);
    px(2, 0, 22, 2, o.dark);
    px(2, 42, 22, 2, o.dark);
    px(2, 1, 2, 42, o.bodyL);
    px(22, 1, 2, 42, o.dark);
    px(4, 0, 3, 1, o.hole);
    /* 车头：右大灯碎了，保险杠歪进去一块 */
    px(4, 1, 6, 2, '#d8c894');
    px(16, 1, 5, 2, '#4d463c');
    px(17, 1, 1, 1, o.hole);
    px(20, 1, 2, 1, o.prim);
    px(4, 3, 18, 2, o.dark);
    px(4, 5, 18, 5, o.bodyL);
    px(5, 6, 4, 1, o.rust);
    px(13, 8, 6, 1, '#4a211f');
    /* 驾驶室：风挡裂了，胶带糊在左下角 */
    px(4, 10, 18, 5, o.glass);
    px(5, 10, 8, 1, o.glassL);
    px(14, 10, 1, 5, '#6d7a85');
    px(10, 12, 4, 1, '#6d7a85');
    px(6, 11, 1, 3, o.tape);
    px(7, 12, 3, 1, o.tape);
    px(4, 15, 18, 8, o.roof);
    px(4, 16, 18, 1, o.dark);
    px(7, 18, 3, 2, o.rust);
    px(15, 21, 2, 1, o.rust2);
    /* 后窗：一发子弹打了个洞 */
    px(5, 23, 16, 2, o.glass);
    px(5, 23, 5, 1, o.glassL);
    px(13, 23, 2, 2, o.hole);
    /* 侧门警示条只剩一半 */
    px(2, 18, 2, 3, o.stripe);
    px(22, 19, 2, 2, o.stripe);
    px(2, 20, 2, 1, o.rust);
    /* 防滚架：横杆被撞歪，右边翘起来 */
    px(3, 25, 14, 2, o.metal);
    px(17, 24, 5, 1, o.metal);
    px(3, 26, 2, 2, o.dark);
    px(21, 26, 2, 2, o.dark);
    /* 货斗：底板锈穿 */
    px(4, 27, 18, 13, '#3a382f');
    px(4, 27, 18, 1, '#242320');
    px(4, 39, 18, 1, '#242320');
    px(9, 28, 1, 11, '#292720');
    px(16, 28, 1, 11, '#292720');
    px(6, 29, 4, 3, o.rust);
    px(6, 29, 2, 2, o.hole);
    px(18, 34, 3, 3, o.rust2);
    px(19, 35, 1, 1, o.hole);
    px(9, 36, 3, 1, '#4a211f');
    /* 后挡板整个掉了：直接看见路面 */
    px(4, 40, 18, 2, o.hole);
    px(4, 40, 3, 1, o.rust);
    px(19, 40, 3, 1, o.rust);
    /* 备胎（瘪的），上面搭着一块帆布 */
    px(11, 31, 5, 4, o.tire);
    px(12, 31, 3, 1, '#5a5a4a');
    px(12, 32, 3, 2, o.metal);
    px(13, 31, 1, 1, o.rust2);
    /* 货斗里还剩下的家当：一只弹药箱 + 半卷帆布 */
    px(5, 33, 4, 4, '#4a5138');
    px(5, 33, 4, 1, '#5f6847');
    px(6, 34, 1, 2, o.dark);
    px(8, 34, 1, 2, o.dark);
    px(6, 35, 2, 1, o.rust2);
    px(20, 29, 2, 7, '#5c5a4a');
    px(20, 29, 2, 1, '#6d6b58');
    /* 尾灯：只剩一个 */
    px(4, 41, 5, 1, '#8f2b2b');
    px(17, 41, 5, 1, o.hole);
  }

  /* 水泥隔离墩 34x12 */  function barrier(px) {
    px(0, 3, 34, 8, '#7f858d');
    px(0, 3, 34, 2, '#a3a9b2');
    px(0, 10, 34, 1, '#5c6169');
    px(2, 10, 5, 2, '#5c6169');
    px(27, 10, 5, 2, '#5c6169');
    var cols = ['#d9a441', '#e6ebf0'];
    for (var i = 0; i < 4; i++) {
      px(3 + i * 8, 5, 5, 4, cols[i % 2]);
    }
  }

  /* 垃圾箱 24x18 */
  function dumpster(px) {
    px(2, 15, 4, 3, '#14161a');
    px(18, 15, 4, 3, '#14161a');
    px(1, 3, 22, 13, '#2f4a3a');
    px(0, 1, 24, 4, '#3d5c48');
    px(0, 4, 24, 1, '#22382c');
    px(3, 6, 5, 1, '#1a2620');
    px(16, 6, 5, 1, '#1a2620');
    px(6, 9, 3, 2, '#5a3a24');
    px(12, 12, 2, 2, '#5a3a24');
    px(9, 1, 6, 1, '#4d6d57');
  }

  /* 木箱 16x16 */
  function crate(px) {
    px(0, 0, 16, 16, '#5a3d22');
    px(1, 1, 14, 14, '#7a5631');
    px(1, 6, 14, 1, '#4a3018');
    px(1, 11, 14, 1, '#4a3018');
    px(2, 2, 2, 2, '#9a7448');
    px(4, 3, 2, 2, '#9a7448');
    px(6, 4, 2, 2, '#9a7448');
    px(8, 6, 2, 2, '#9a7448');
    px(1, 1, 2, 2, '#3a3a3a');
    px(13, 1, 2, 2, '#3a3a3a');
    px(1, 13, 2, 2, '#3a3a3a');
    px(13, 13, 2, 2, '#3a3a3a');
  }

  /* 轮胎堆 18x18 */
  function tires(px) {
    var spots = [[1, 1], [10, 2], [5, 9]];
    for (var i = 0; i < spots.length; i++) {
      var x = spots[i][0], y = spots[i][1];
      px(x, y, 7, 7, '#1a1c20');
      px(x + 1, y, 5, 1, '#2e3238');
      px(x + 2, y + 3, 3, 2, '#101216');
    }
  }

  /* ---------------- 锈水高速道具 ---------------- */

  /* 瓦砾堆 22x16：桥面被泡散的碎块，钢筋还翘着 */
  function rubble(px) {
    px(1, 10, 20, 5, '#3a322a');
    px(2, 8, 8, 4, '#5c5148');
    px(10, 6, 9, 6, '#6b5f52');
    px(5, 4, 7, 4, '#7a6c5c');
    px(13, 3, 6, 4, '#8a7a68');
    px(3, 11, 5, 2, '#2c261f');
    px(11, 11, 6, 2, '#2c261f');
    px(16, 8, 4, 2, '#8f5a3a');
    px(4, 9, 2, 2, '#8f5a3a');
    px(7, 1, 1, 4, '#8a8f96');
    px(18, 3, 1, 4, '#767b82');
    px(6, 13, 3, 1, '#4a4038');
    px(15, 12, 4, 1, '#4a4038');
  }

  /* 水泥排水管 26x14：半埋在水里，管口是黑的 */
  function pipe(px) {
    px(0, 2, 26, 10, '#6b7178');
    px(0, 2, 26, 2, '#868d95');
    px(0, 10, 26, 2, '#4c5158');
    px(1, 5, 22, 1, '#5a616a');
    /* 管口 */
    px(0, 2, 5, 10, '#3a3f45');
    px(1, 3, 3, 8, '#14181c');
    /* 锈水痕 + 缺口 */
    px(9, 6, 2, 4, '#5e4a30');
    px(17, 5, 3, 1, '#4c5158');
    px(21, 8, 2, 2, '#5e4a30');
    px(13, 11, 3, 1, '#3a3f45');
  }

  /* 侧翻轿车 28x36：车顶着地、轮子朝外，车身压在下面 */
  function carTipped(px) {
    /* 车顶（朝左，被压扁） */
    px(2, 5, 8, 26, '#23262b');
    px(3, 6, 6, 24, '#31363d');
    px(4, 8, 4, 8, '#1b2f31');
    px(4, 21, 4, 8, '#1b2f31');
    /* 车身侧面 */
    px(10, 3, 13, 30, '#3f3a33');
    px(11, 4, 11, 28, '#514a40');
    px(10, 3, 2, 30, '#635b4d');
    /* 朝上的两个轮子 */
    px(23, 6, 5, 9, '#121418');
    px(24, 7, 3, 7, '#242a32');
    px(23, 20, 5, 9, '#121418');
    px(24, 21, 3, 7, '#242a32');
    /* 车门 / 凹痕 / 锈斑 */
    px(13, 9, 7, 1, '#2e2822');
    px(13, 22, 7, 1, '#2e2822');
    px(13, 10, 1, 12, '#2e2822');
    px(15, 14, 3, 3, '#7a4a2a');
    px(18, 26, 2, 2, '#7a4a2a');
    px(12, 17, 1, 4, '#5c5344');
    px(19, 5, 2, 2, '#8a8378');
    /* 压出的水痕 */
    px(3, 31, 22, 3, '#2b3a36');
    px(5, 32, 16, 1, '#3a4e48');
  }

  /* 路锥 10x12（纯装饰，不挡路） */
  function cone(px) {
    px(3, 10, 4, 2, '#c25a1c');
    px(1, 11, 8, 1, '#a84a14');
    px(4, 2, 2, 8, '#e8792b');
    px(3, 4, 4, 2, '#e8792b');
    px(3, 7, 4, 2, '#e8792b');
    px(3, 5, 4, 1, '#f0f0f0');
    px(3, 8, 4, 1, '#f0f0f0');
    px(4, 2, 1, 2, '#ffa552');
  }

  /* ---------------- 荒漠道具 ---------------- */

  /* 路边广告牌 44x30：两块木桩撑起一块晒白的板子。
     板上原本是油漆大字，现在只剩几道红漆和褪成土黄的底 —— 远看就是一块大牌子。 */
  function billboard(px) {
    /* 两根桩子（右边那根歪了半格），底下压着沙 */
    px(9, 15, 4, 14, '#4a3018');
    px(9, 15, 1, 14, '#6b4a2a');
    px(31, 16, 4, 13, '#3f2814');
    px(31, 16, 1, 13, '#5c3d1f');
    px(6, 27, 11, 2, '#2a1c10');
    px(28, 28, 10, 2, '#2a1c10');
    /* 板框 */
    px(0, 0, 44, 18, '#2f2113');
    px(1, 1, 42, 16, '#b8a67c');
    px(1, 1, 42, 2, '#cfbf94');
    px(1, 15, 42, 2, '#8f7c52');
    /* 红漆横幅 + 四个大字块（远看就是"有字"，不必真能读） */
    px(3, 3, 38, 8, '#8f3a28');
    px(3, 3, 38, 1, '#a8492f');
    px(3, 10, 38, 1, '#6d2b1e');
    px(5, 4, 6, 6, '#e8d8b0');
    px(13, 4, 5, 6, '#e8d8b0');
    px(20, 4, 7, 2, '#e8d8b0');
    px(20, 8, 7, 2, '#e8d8b0');
    px(29, 4, 6, 6, '#e8d8b0');
    px(30, 6, 4, 1, '#8f3a28');
    /* 下面一行小字 */
    px(4, 12, 10, 1, '#5e4a2c');
    px(16, 12, 14, 1, '#5e4a2c');
    px(32, 12, 4, 1, '#5e4a2c');
    /* 锈斑 / 弹孔 / 钉子 / 掉漆 */
    px(35, 13, 5, 3, '#7a5c33');
    px(37, 14, 1, 1, '#1a1208');
    px(6, 12, 2, 2, '#4a3018');
    px(2, 2, 1, 1, '#e8dcc0');
    px(40, 2, 1, 1, '#e8dcc0');
    px(1, 8, 1, 7, '#c8b88c');
    px(24, 14, 3, 2, '#6b4a2a');
  }

  /* 公路指示牌 16x24：一块斜挂的旧牌子，箭头指向公路尽头 */
  function signpost(px) {
    px(7, 9, 2, 14, '#4c5158');
    px(7, 9, 1, 14, '#6b717a');
    px(5, 22, 6, 2, '#2c3036');
    /* 牌面 */
    px(1, 2, 14, 9, '#2b2f35');
    px(2, 3, 12, 7, '#b8a878');
    px(2, 3, 12, 1, '#d8c898');
    px(2, 8, 12, 1, '#8a7c54');
    /* 箭头 + 一行字 */
    px(4, 5, 2, 3, '#7a3a26');
    px(6, 5, 4, 1, '#7a3a26');
    px(6, 7, 4, 1, '#7a3a26');
    px(10, 5, 1, 3, '#7a3a26');
    px(12, 5, 1, 3, '#5e5a44');
    /* 锈水从螺丝往下淌 */
    px(3, 4, 1, 1, '#6b4a2a');
    px(11, 9, 1, 3, '#6b4a2a');
  }

  /* 汽车旅馆立牌 18x30：霓虹早就不亮了，只剩铁皮上的漆 */
  function motelsign(px) {
    px(4, 14, 3, 15, '#3a3438');
    px(11, 14, 3, 15, '#3a3438');
    px(2, 27, 5, 2, '#241f22');
    px(11, 27, 5, 2, '#241f22');
    px(10, 16, 3, 3, '#2a2528');
    /* 铁皮箱 */
    px(0, 1, 18, 15, '#241a1c');
    px(1, 2, 16, 13, '#8f3a2c');
    px(1, 2, 16, 1, '#b8563f');
    px(1, 13, 16, 2, '#6b2a20');
    /* MOTEL 五个方块字 */
    px(2, 5, 2, 5, '#e8d8a8');
    px(4, 5, 2, 2, '#e8d8a8');
    px(4, 8, 2, 2, '#e8d8a8');
    px(7, 5, 2, 5, '#e8d8a8');
    px(10, 5, 2, 5, '#e8d8a8');
    px(12, 5, 2, 2, '#e8d8a8');
    px(12, 8, 2, 2, '#e8d8a8');
    px(15, 5, 1, 5, '#e8d8a8');
    px(2, 3, 14, 1, '#c8b078');
    /* 灯泡底座 + 锈 */
    px(3, 11, 1, 1, '#4a3a20');
    px(8, 11, 1, 1, '#4a3a20');
    px(13, 11, 1, 1, '#4a3a20');
    px(5, 9, 2, 2, '#5a2a1e');
    px(14, 3, 2, 1, '#5a2a1e');
  }

  /* 仙人掌 16x26：两臂上举，太阳晒得发黄 */
  function cactus(px) {
    px(5, 1, 6, 25, '#2f4a2c');
    px(5, 1, 2, 25, '#436b3c');
    px(6, 0, 4, 1, '#436b3c');
    px(10, 1, 1, 25, '#24381f');
    /* 左臂 */
    px(1, 9, 2, 7, '#2f4a2c');
    px(1, 9, 1, 7, '#3f6438');
    px(2, 14, 4, 2, '#2f4a2c');
    px(2, 14, 4, 1, '#3f6438');
    /* 右臂 */
    px(13, 6, 2, 8, '#26401f');
    px(13, 6, 1, 8, '#3a5832');
    px(10, 12, 4, 2, '#26401f');
    px(10, 12, 4, 1, '#365230');
    /* 刺 */
    px(7, 4, 1, 1, '#7a9458');
    px(6, 9, 1, 1, '#6b8450');
    px(8, 15, 1, 1, '#6b8450');
    px(7, 21, 1, 1, '#5a7044');
    px(4, 3, 1, 1, '#7a9458');
    /* 根部沙土 */
    px(3, 24, 10, 2, '#4a3c26');
    px(4, 25, 8, 1, '#5c4a2e');
  }

  /* 巨石 24x18：左边受光，右边埋在沙里 */
  function rock(px) {
    px(3, 4, 18, 12, '#3c352c');
    px(4, 3, 15, 1, '#4a4238');
    px(2, 6, 1, 8, '#4a4238');
    px(5, 5, 9, 6, '#5a5145');
    px(6, 5, 6, 3, '#6b6153');
    px(8, 4, 4, 1, '#7d7263');
    px(19, 8, 2, 6, '#2c261f');
    px(4, 14, 16, 3, '#332d24');
    px(7, 11, 3, 2, '#4a4238');
    px(14, 9, 2, 2, '#2f2a22');
    /* 底部的沙 */
    px(2, 16, 20, 2, '#4a3c26');
    px(5, 17, 14, 1, '#5c4a2e');
  }

  /* 牛头骨 12x8：风干成白色， horns 张开 */
  function skull(px) {
    px(2, 0, 3, 2, '#c8bda0');
    px(7, 0, 3, 2, '#c8bda0');
    px(1, 1, 2, 3, '#b0a488');
    px(9, 1, 2, 3, '#b0a488');
    px(4, 1, 4, 5, '#ddd2b4');
    px(4, 1, 2, 1, '#efe6cc');
    px(4, 4, 1, 1, '#2a2418');
    px(7, 4, 1, 1, '#2a2418');
    px(4, 6, 4, 2, '#c8bda0');
    px(5, 7, 2, 1, '#8f8468');
    px(3, 5, 1, 1, '#a89c80');
    px(8, 5, 1, 1, '#a89c80');
  }

  var props = {
    car_sedan_v: { w: 24, h: 40, draw: function (px) { carBody(px, PAL.sedan); } },
    car_sedan_h: { w: 40, h: 24, draw: function (px) { carBody(T(px), PAL.sedan); } },
    car_blue_v: { w: 24, h: 40, draw: function (px) { carBody(px, PAL.sedan2); } },
    car_blue_h: { w: 40, h: 24, draw: function (px) { carBody(T(px), PAL.sedan2); } },
    car_van_v: { w: 26, h: 44, draw: function (px) { vanBody(px, PAL.van); } },
    car_van_h: { w: 44, h: 26, draw: function (px) { vanBody(T(px), PAL.van); } },
    car_burnt_v: { w: 24, h: 40, draw: function (px) { carBody(px, PAL.burnt); } },
    car_burnt_h: { w: 40, h: 24, draw: function (px) { carBody(T(px), PAL.burnt); } },
    veh_sedan_v: { w: 24, h: 40, draw: function (px) { vehSedan(px, PAL.vehSedan); } },
    veh_sedan_h: { w: 40, h: 24, draw: function (px) { vehSedan(T(px), PAL.vehSedan); } },
    veh_pickup_v: { w: 26, h: 44, draw: function (px) { vehPickup(px, PAL.vehPickup); } },
    veh_pickup_h: { w: 44, h: 26, draw: function (px) { vehPickup(T(px), PAL.vehPickup); } },
    rubble: { w: 22, h: 16, draw: function (px) { rubble(px); } },
    pipe_h: { w: 26, h: 14, draw: function (px) { pipe(px); } },
    pipe_v: { w: 14, h: 26, draw: function (px) { pipe(T(px)); } },
    car_tipped_v: { w: 28, h: 36, draw: function (px) { carTipped(px); } },
    car_tipped_h: { w: 36, h: 28, draw: function (px) { carTipped(T(px)); } },
    barrier_h: { w: 34, h: 12, draw: function (px) { barrier(px); } },
    barrier_v: { w: 12, h: 34, draw: function (px) { barrier(T(px)); } },
    dumpster: { w: 24, h: 18, draw: function (px) { dumpster(px); } },
    crate: { w: 16, h: 16, draw: function (px) { crate(px); } },
    tires: { w: 18, h: 18, draw: function (px) { tires(px); } },
    cone: { w: 10, h: 12, draw: function (px) { cone(px); } },
    billboard: { w: 44, h: 30, draw: function (px) { billboard(px); } },
    signpost: { w: 16, h: 24, draw: function (px) { signpost(px); } },
    motelsign: { w: 18, h: 30, draw: function (px) { motelsign(px); } },
    cactus: { w: 16, h: 26, draw: function (px) { cactus(px); } },
    rock: { w: 24, h: 18, draw: function (px) { rock(px); } },
    skull: { w: 12, h: 8, draw: function (px) { skull(px); } }
  };

  /* ---------------- 图集帧表 -------------- */

  /* 敌人基础帧顺序，精英/受击变体按这个顺序自动补（boss 系不做精英变体） */
  var enemyOrder = ['walker', 'runner', 'crawler', 'spitter', 'pouncer', 'vomiter', 'brute', 'terrorist', 'drowner', 'boss', 'gatling', 'stalker', 'axeboss'];

  var frameList = [];
  var i;

  for (i = 0; i < 4; i++) {
    var cid = ['soldier', 'medic', 'mechanic', 'ghost'][i];
    frameList.push({ name: 'player_' + cid, def: 'player', pal: playerPals[cid] });
  }
  for (i = 0; i < enemyOrder.length; i++) {
    frameList.push({ name: enemyOrder[i], def: enemyOrder[i] });
  }
  for (i = 0; i < enemyOrder.length; i++) {
    if (defs[enemyOrder[i]] && defs[enemyOrder[i]].boss) continue;   // Boss 系不用精英变体
    frameList.push({
      name: enemyOrder[i] + '_elite', def: enemyOrder[i],
      tint: '#ff3b3b', tintAmt: 0.34
    });
  }
  for (i = 0; i < enemyOrder.length; i++) {
    frameList.push({ name: enemyOrder[i] + '_hit', def: enemyOrder[i], white: 0.88 });
  }
  for (var pn in props) {
    frameList.push({ name: pn, prop: pn });
  }

  var data = {
    defs: defs,
    playerPals: playerPals,
    enemyOrder: enemyOrder,
    frameList: frameList,
    props: props,
    /* 图集排布：每格固定大小，方便美术按格子重画 */
    meta: { cellW: 48, cellH: 48, cols: 6, margin: 1, version: 2 }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  G.HS = G.HS || {};
  G.HS.SpriteDefs = data;
})();
