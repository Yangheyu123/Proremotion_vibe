/*
 * bake_pulse_env —— BGM 切片能量包络 → 剧本 PULSE_ENV（30fps 逐帧峰值，归一 + 衰减）。
 * 用法：node scripts/bake_pulse_env.cjs <bgm> <ss> <t> <total> <script.ts>
 * 只回写 PULSE_ENV 块，不动剧本其他内容。换歌/换切片后重跑即可。
 */
const fs = require('fs');
const {execFileSync} = require('child_process');
const paths = require('./lib/paths.cjs');
const FF = paths.FFMPEG;

const [bgm, ssArg, tArg, totalArg, scriptFile] = process.argv.slice(2);
if (!bgm || !scriptFile) {
  console.error('usage: node scripts/bake_pulse_env.cjs <bgm> <ss> <t> <total> <script.ts>');
  process.exit(1);
}
const ss = parseFloat(ssArg || '0');
const t = parseFloat(tArg || '60');
const total = parseInt(totalArg || '1800', 10);

const pcm = execFileSync(
  FF,
  ['-v', 'error', '-ss', String(ss), '-t', String(t), '-i', bgm, '-ac', '1', '-ar', '30', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'],
  {maxBuffer: 1 << 29},
);
const halfN = pcm.length / 2;
if (halfN < total) {
  console.error(`🔴 解码样本 ${halfN} < ${total} 帧——切片太短`);
  process.exit(1);
}
const env = [];
for (let f = 0; f < total; f++) {
  let mx = 0;
  const s0 = Math.floor((f * halfN) / total);
  const e0 = Math.floor(((f + 1) * halfN) / total);
  for (let k = s0; k < e0; k++) {
    const v = Math.abs(pcm.readInt16LE(k * 2));
    if (v > mx) mx = v;
  }
  env.push(mx);
}
const max = Math.max(...env, 1);
for (let i = 0; i < env.length; i++) env[i] = env[i] / max;
for (let i = 0; i < env.length; i++) env[i] = Math.max(env[i], (env[i - 1] ?? 0) * 0.72);
const rounded = env.map((v) => +v.toFixed(3));

let src = fs.readFileSync(scriptFile, 'utf8');
const block = `export const PULSE_ENV: number[] = [\n  ${rounded.join(', ')},\n];`;
if (!/export const PULSE_ENV: number\[\] = \[[\s\S]*?\];/.test(src)) {
  console.error('🔴 剧本里找不到 PULSE_ENV 块');
  process.exit(1);
}
src = src.replace(/export const PULSE_ENV: number\[\] = \[[\s\S]*?\];/, block);
fs.writeFileSync(scriptFile, src);
console.log(`✅ PULSE_ENV 写入 ${scriptFile}：${total} 帧（peak=${max}，非零 ${rounded.filter((v) => v > 0.05).length} 帧）`);
