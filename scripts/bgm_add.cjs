/*
 * BGM 入库：新歌拷进 $BGM_HOME/，预跑节拍检测，登记 index.json。
 * 用法：node scripts/bgm_add.cjs <音频文件> [--name 库名] [--ss 切片起点秒] [--t 时长秒] [--mood 情绪标签]
 * 入库后换歌三步（见 METHODOLOGY 第 2 章）：
 *   1. node scripts/beat_detect.cjs <ss> <t> $BGM_HOME/<name>.<ext>   # → out/beats.json
 *   2. 按 snap_boundaries.cjs 输出回写 script.ts 的 SCENES/CARDS/BEATS
 *   3. 改该片 sfx 脚本的 bgm/bgmChain/ss/t → node scripts/make.cjs <film> <variant>
 */
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const paths = require('./lib/paths.cjs');

const NODE = process.execPath;
const BGMS = paths.BGM_HOME;
fs.mkdirSync(BGMS, {recursive: true});

const argv = process.argv.slice(2);
const src = argv[0];
if (!src || !fs.existsSync(src)) {
  console.error('usage: node scripts/bgm_add.cjs <音频文件> [--name x] [--ss 60] [--t 90] [--mood 深夜]');
  process.exit(1);
}
const arg = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : dflt;
};

const name = arg('--name') || path.basename(src, path.extname(src));
const ext = path.extname(src) || '.mp3';
const ss = arg('--ss', '8');
const t = arg('--t', '62');
const mood = arg('--mood', '');

const dest = path.join(BGMS, name + ext).replace(/\\/g, '/');
fs.copyFileSync(src, dest);

console.log(`▶ 节拍检测：${dest}（切片 ${ss}s 起 × ${t}s）`);
execFileSync(NODE, ['scripts/beat_detect.cjs', ss, t, dest], {stdio: 'inherit'});

const beats = JSON.parse(fs.readFileSync('out/beats.json', 'utf8'));
const idxPath = path.join(BGMS, 'index.json');
const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : {songs: []};
idx.songs = idx.songs.filter((s) => s.name !== name);
idx.songs.push({
  name,
  file: dest,
  mood,
  ss: parseFloat(ss),
  t: parseFloat(t),
  bpm: Math.round(beats.bpm * 100) / 100,
  beats_cached: beats.beats.map((b) => b.frame),
  added_at: new Date().toISOString().slice(0, 10),
});
fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1));
console.log(`\n✅ 已入库：${name}（BPM≈${beats.bpm.toFixed(1)}${mood ? '，' + mood : ''}）`);
console.log(`索引：${idxPath}`);
console.log('下一步：snap_boundaries 吸附 → 回写 script.ts → 改 sfx 脚本 bgm/ss/t → make.cjs');
