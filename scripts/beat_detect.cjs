/*
 * BGM 节拍检测：解码 → RMS 能量包络 → 自相关求 BPM → 相位搜索 → 输出视频帧号节拍表。
 * 用法：node scripts/beat_detect.cjs [切片起点秒=8] [时长秒=62] [音频文件=assets/bgm.flac]
 * 输出：BPM、每拍在视频中的帧号（30fps）、每拍强度（用于挑强拍）→ out/beats.json
 */
const {execSync} = require('child_process');
const fs = require('fs');
const paths = require('./lib/paths.cjs');

const START = parseFloat(process.argv[2] ?? '8');
const LEN = parseFloat(process.argv[3] ?? '62');
const AUDIO = process.argv[4] || paths.BGM_FLAC;
const FPS = 30;
const FF = paths.FFMPEG;

// 1. 解码为单声道 f32le 22050Hz
const raw = execSync(
  `"${FF}" -v error -ss ${START} -t ${LEN} -i "${AUDIO}" -ac 1 -ar 22050 -f f32le -`,
  {maxBuffer: 1 << 28},
);
const N = raw.length / 4;
const pcm = new Float32Array(raw.buffer, raw.byteOffset, N);
const SR = 22050;

// 2. RMS 能量包络：窗 512 (~23ms)，步 256 (~11.6ms)
const HOP = 256;
const WIN = 512;
const env = [];
for (let i = 0; i + WIN < N; i += HOP) {
  let s = 0;
  for (let k = i; k < i + WIN; k++) s += pcm[k] * pcm[k];
  env.push(Math.sqrt(s / WIN));
}
const ENV_RATE = SR / HOP; // ~86.13 Hz

// 3. onset 强度 = 包络正差分（平滑）
const onset = env.map((v, i) => (i ? Math.max(0, v - env[i - 1]) : 0));
const sm = [];
for (let i = 0; i < onset.length; i++) {
  let s = 0;
  let n = 0;
  for (let k = i - 2; k <= i + 2; k++) {
    if (onset[k] !== undefined) {
      s += onset[k];
      n++;
    }
  }
  sm.push(s / n);
}

// 4. 自相关求 BPM（45~190 BPM）
const minLag = Math.floor((60 / 190) * ENV_RATE);
const maxLag = Math.ceil((60 / 45) * ENV_RATE);
let bestLag = 0;
let bestScore = -1;
for (let lag = minLag; lag <= maxLag; lag++) {
  let s = 0;
  for (let i = 0; i + lag < sm.length; i++) s += sm[i] * sm[i + lag];
  s /= sm.length - lag;
  // 轻微偏向 90~150 BPM 的先验
  const bpm = (60 * ENV_RATE) / lag;
  const prior = 1 - Math.abs(bpm - 118) / 400;
  const score = s * prior;
  if (score > bestScore) {
    bestScore = score;
    bestLag = lag;
  }
}
const bpm0 = (60 * ENV_RATE) / bestLag;
// 归一到主拍：100~135 BPM 通常是 67~90 BPM 的 1.5 倍频（附点层级）
if (bpm0 > 100 && bpm0 < 135) {
  bestLag = Math.round(bestLag * 1.5);
}
const bpm = (60 * ENV_RATE) / bestLag;
console.log(`BPM ≈ ${bpm.toFixed(2)} (lag ${bestLag}, raw ${bpm0.toFixed(2)})`);

// 5. 相位搜索：最大化节拍点上的 onset 能量
const beatPeriod = bestLag;
let bestPhase = 0;
let bestPhaseScore = -1;
for (let p = 0; p < beatPeriod; p++) {
  let s = 0;
  for (let t = p; t < sm.length; t += beatPeriod) s += sm[Math.round(t)];
  if (s > bestPhaseScore) {
    bestPhaseScore = s;
    bestPhase = p;
  }
}

// 6. 输出视频帧号节拍表 + 强度
const beats = [];
for (let t = bestPhase; t < sm.length; t += beatPeriod) {
  const i = Math.round(t);
  const timeInSlice = i / ENV_RATE;
  if (timeInSlice < 0 || timeInSlice > LEN - 0.5) continue;
  const strength = sm.slice(i - 1, i + 2).reduce((a, b) => a + b, 0) / 3;
  beats.push({frame: Math.round(timeInSlice * FPS), t: timeInSlice, strength});
}
console.log(`beats: ${beats.length}`);
for (const b of beats) {
  const bar = '#'.repeat(Math.min(50, Math.round(b.strength * 4000)));
  console.log(`f${String(b.frame).padStart(4)} t=${b.t.toFixed(2)}s ${b.strength.toFixed(4)} ${bar}`);
}
fs.writeFileSync(
  'out/beats.json',
  JSON.stringify({bpm, beats}, null, 1),
);
console.log('written out/beats.json');
