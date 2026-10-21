/*
 * 目检拼图：从成片/raw 抽指定帧，拼成网格 PNG——给"渲→看→改"迭代用。
 * 用法：node scripts/frame_sheet.cjs <mp4> <out.png> <frame> [<frame>...] [--cols N] [--w 720]
 * 视觉检查闸门（2026-10-12 第九批）：任何新片/改画面交付前，必须出这张图并
 * 由 Claude 亲眼 Read 检查（字幕带入侵/安全区/密度/精致度），签字才算完。
 */
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./lib/paths.cjs');

const FF = paths.FFMPEG;
const [video, out, ...rest] = process.argv.slice(2);
if (!video || !out || !rest.length) {
  console.error('usage: node scripts/frame_sheet.cjs <mp4> <out.png> <frame> [...] [--cols N] [--w 720]');
  process.exit(1);
}
const flagAt = (name) => rest.indexOf(name);
const cols = flagAt('--cols') >= 0 ? parseInt(rest[flagAt('--cols') + 1], 10) : 2;
const w = flagAt('--w') >= 0 ? parseInt(rest[flagAt('--w') + 1], 10) : 720;
const flagValues = new Set(rest.flatMap((x, i) => (x === '--cols' || x === '--w' ? [i, i + 1] : [])));
const frames = rest.filter((x, i) => /^\d+$/.test(x) && !flagValues.has(i)).map(Number);
if (!frames.length) {
  console.error('没有帧号');
  process.exit(1);
}

const tmp = [];
const got = [];
frames.forEach((f, i) => {
  const png = path.join('out', `_fs_${i}.png`);
  try {
    execFileSync(FF, ['-v', 'error', '-i', path.resolve(video), '-ss', (f / 30).toFixed(3), '-frames:v', '1', '-vf', `scale=${w}:-2`, '-y', png]);
  } catch { /* seek 失败按缺失处理 */ }
  if (fs.existsSync(png)) {
    tmp.push(png);
    got.push(f);
  } else {
    console.error(`⚠ f${f} 抽帧失败（超出有效帧范围？），已跳过`);
  }
});
if (!tmp.length) {
  console.error('全部帧抽取失败');
  process.exit(1);
}
const rows = Math.ceil(tmp.length / cols);
if (tmp.length === 1) {
  fs.copyFileSync(tmp[0], out);
} else {
  const layout = tmp
    .map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * (Math.round((w * 3) / 4) + 2)}`)
    .join('|');
  execFileSync(FF, [
    '-v', 'error', ...tmp.flatMap((p) => ['-i', p]),
    '-filter_complex',
    `${tmp.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${tmp.length}:layout=${layout}`,
    '-frames:v', '1', '-y', out,
  ]);
}
tmp.forEach((p) => fs.rmSync(p, {force: true}));
console.log(`sheet -> ${out}（${frames.length} 帧 × ${cols} 列 @${w}px，帧号: ${frames.join(',')}）`);
