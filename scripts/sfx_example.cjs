/*
 * 示例片混音器：音效 + BGM → 成片（通用范式：各片只写排期+配置）。
 * 音效合成机制在 scripts/lib/sfx_lib.cjs（thud/boom/knock/tick/pop/swish/riser/chime...18 音）。
 * BGM：默认 $ASSET_HOME/bgm.flac（自备，README 有说明）；nobgm 参数 = 只有音效。
 * 用法：node scripts/sfx_example.cjs [full|nobgm]   （一般不用手跑，make.cjs 会调）
 */
const fs = require('fs');
const path = require('path');
const {synthAll, resolveCues, buildMix} = require('./lib/sfx_lib.cjs');
const {load} = require('./lib/script_loader.cjs');
const paths = require('./lib/paths.cjs');

const MODE = process.argv[2] === 'nobgm' ? 'nobgm' : 'full';
const {CARDS, SCENES, TOTAL, FPS} = load('src/example/script.ts');
if (!CARDS?.length) {
  console.error('🔴 剧本不完整');
  process.exit(1);
}
synthAll('out/sfx');

/* 排期：卡起点 pop、kw 重音 chime、卡尾 puff——语义锚定，卡时长怎么改音效都跟着走 */
const cues = resolveCues(
  [
    {card: 0, at: 0, sound: 'pop', vol: -18},
    {card: 0, at: 'kw', sound: 'chime', vol: -18},
    {card: 1, at: 0, sound: 'page', vol: -20},
    {card: 1, at: 'kw', sound: 'ding', vol: -19},
    {card: 2, at: 0, sound: 'boom', vol: -17},
    {card: 2, at: 'kw', sound: 'shimmer', vol: -21},
  ],
  {CARDS, SCENES, FPS},
);

const sec = TOTAL / (FPS || 30);
const fadeD = 4;
const fadeOutSt = Math.max(0, sec - fadeD).toFixed(1);
const bgmChain = `highshelf=f=2800:g=-5,lowpass=f=12500,volume=0.28,afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOutSt}:d=${fadeD}`;

buildMix({
  fps: FPS || 30,
  video: 'out/example-raw.mp4',
  bgm: paths.BGM_FLAC,
  ss: 45,
  t: 30,
  bgmChain,
  skipBgm: MODE === 'nobgm',
  cues,
  limiterLimit: 0.8,
  limiterLevelIn: 1.4,
  out: path.join(paths.OUTPUT_HOME, '示例片', MODE === 'nobgm' ? '示例片_无BGM版.mp4' : '示例片_4x3.mp4'),
});
