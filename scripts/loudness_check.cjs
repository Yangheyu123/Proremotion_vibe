/*
 * 响度体检：测成片的整体响度与真峰值，对照抖音的播放归一化目标。
 *
 * 用法：node scripts/loudness_check.cjs <成片.mp4> [--target -14] [--tol 2] [--strict]
 * 退出码：0 = 通过/仅报告；3 = 不达标且指定了 --strict；1 = 参数错误
 *
 * ── 为什么需要这个（PLAN §1.7）────────────────────────────────
 * 此前 7 道闸门里**没有一项测音频**：合规查文本、密度查节奏、丝滑查画面、
 * ffprobe 查时长分辨率、审计查停留——音频从头到尾靠耳朵。
 * 而 sfx_lib 的 `vol <= -22 ? vol + 4 : vol` 只是一条**规则**，不是**测量**；
 * METHODOLOGY 第 5 条要求"实测校准必须穿透 BGM"，从未实测过。
 *
 * ── 阈值为什么默认不硬拦（2026-10-12 实测校准，重要）────────────
 * 四片成片实测：-20.2 ~ -21.0 LUFS（偏轻 6~7 LU），真峰值 -5.6~-8.0 dBFS。
 * 高度一致 → 这是**一贯的混音风格**，不是偶发缺陷。
 * 若把 -14±2 设为硬闸门，会让**现有全线出片全部被拦**——这是负向修改。
 * 因此默认行为是**只报告不拦**，把选择权交给使用者：
 *   - 日常出片：看报告，知道自己的响度在哪，不阻塞
 *   - 要冲平台响度：传 --target 设目标 + --strict 硬拦，逐步把混音校准上去
 * 这样"从未测过"的缺口被补上（可见、可追踪），但产线速度不受影响。
 *
 * ── 测量指标 ────────────────────────────────────────────────
 *   - EBU R128 integrated LUFS：整体感知响度（人耳加权），平台归一化的依据
 *   - true peak (dBTP)：考虑采样间峰值的真峰值，> -1 说明有削波风险
 *   - LRA：响度范围，过小说明动态被压平（层次丢失）
 *   - volumedetect 的 mean/max：直观参考，与旧版肉眼判断口径一致，便于对照历史
 */
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./lib/paths.cjs');

const FF = paths.FFMPEG;

const argv = process.argv.slice(2);
const file = argv[0];
if (!file || !fs.existsSync(file)) {
  console.error('usage: node scripts/loudness_check.cjs <成片.mp4> [--target -14] [--tol 2] [--allow]');
  if (file) console.error(`⛔ 找不到文件：${file}`);
  process.exit(1);
}
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] != null ? parseFloat(argv[i + 1]) : dflt;
};
const TARGET = argVal('--target', -14); // 平台归一化目标（LUFS）
const TOL = argVal('--tol', 2); // 允许偏离

/* ---------- 测量工具 ----------
 * ⚠️ 两个坑都踩过，记录在此：
 *   1. ebur128 / volumedetect 的摘要在 **stderr**，不在 stdout
 *   2. execFileSync 在 stderr 有内容时可能走"成功路径"但 stdout 为空 —— 
 *      实测 `execFileSync` 返回长度 0，Summary 全丢；catch 路径也拿不到
 * 所以改用 spawnSync：它能同时稳定返回 stdout 与 stderr，两者合并后解析。 */
const {spawnSync} = require('child_process');
const runFF = (args) => {
  const r = spawnSync(FF, args, {encoding: 'utf8', maxBuffer: 1 << 26});
  return (r.stdout || '') + (r.stderr || '');
};

const proxy = (s, re) => {
  const m = String(s).match(re);
  return m ? parseFloat(m[1]) : null;
};

/* ---------- 1. EBU R128（integrated LUFS + true peak） ---------- */
const ebur = runFF(['-hide_banner', '-i', path.resolve(file), '-af', 'ebur128=peak=true', '-f', 'null', '-']);
// Summary 段落优先；退而取最后一次逐行播报
const summary = ebur.split('Summary:').pop();
const lufs = proxy(summary, /I:\s*(-?[\d.]+)\s*LUFS/) ?? proxy(ebur, /I:\s*(-?[\d.]+)\s*LUFS/g);
const truePeak = proxy(summary, /Peak:\s*(-?[\d.]+)\s*dBFS/) ?? proxy(ebur, /TPK:\s*(-?[\d.]+)\s*dBFS/);
const lra = proxy(summary, /LRA:\s*(-?[\d.]+)\s*LU/);

/* ---------- 2. volumedetect（直观参考，与旧口径对照） ---------- */
const vol = runFF(['-hide_banner', '-i', path.resolve(file), '-af', 'volumedetect', '-f', 'null', '-']);
const meanVol = proxy(vol, /mean_volume:\s*(-?[\d.]+)\s*dB/);
const maxVol = proxy(vol, /max_volume:\s*(-?[\d.]+)\s*dB/);

/* ---------- 报告 ---------- */
console.log(`\n━━━ 响度体检：${path.basename(file)} ━━━`);
console.log(`  目标：${TARGET} LUFS ±${TOL}（平台归一化参考）`);
if (lufs != null) {
  const dev = lufs - TARGET;
  const mark = Math.abs(dev) <= TOL ? '✅' : '⚠';
  console.log(`  整体响度：${lufs.toFixed(1)} LUFS  ${mark}（偏离目标 ${dev >= 0 ? '+' : ''}${dev.toFixed(1)}）`);
} else {
  console.log('  整体响度：无法测量（ebur128 未返回数据）');
}
if (truePeak != null) {
  const pkMark = truePeak <= -1 ? '✅' : '⚠';
  console.log(`  真峰值：  ${truePeak.toFixed(1)} dBFS ${pkMark}（> -1 有削波风险）`);
} else {
  console.log('  真峰值：  无法测量');
}
if (meanVol != null) console.log(`  平均音量：${meanVol.toFixed(1)} dB（参考，与旧口径对照）`);
if (maxVol != null) console.log(`  最大音量：${maxVol.toFixed(1)} dB（参考）`);
if (lra != null) console.log(`  响度范围：${lra.toFixed(1)} LU（动态宽度，过小=被压平）`);

/* ---------- 判定 ---------- */
const strict = argv.includes('--strict');
const problems = [];
if (lufs != null && Math.abs(lufs - TARGET) > TOL) {
  problems.push(
    lufs > TARGET
      ? `整体偏响 ${(lufs - TARGET).toFixed(1)} LU——平台会二次压限，动态与层次会被压平`
      : `整体偏轻 ${(TARGET - lufs).toFixed(1)} LU——平台抬音量会连底噪一起抬`,
  );
}
if (truePeak != null && truePeak > -1) {
  problems.push(`真峰值 ${truePeak.toFixed(1)} dBFS > -1——有削波风险`);
}
if (lufs == null && meanVol == null) {
  problems.push('未能测到任何响度数据（音频流缺失或全部静音？）');
}

// 真峰值超标和"测不到"是硬伤，无论 strict 与否都报错退出
const hardProblems = problems.filter((p) => p.includes('削波') || p.includes('未能测到'));

if (!problems.length) {
  console.log('\n✅ 响度达标');
  process.exit(0);
}

console.error('');
problems.forEach((p) => console.error(`  ${hardProblems.includes(p) ? '🔴' : '⚠'} ${p}`));

if (hardProblems.length) {
  console.error('\n⛔ 硬性问题（削波风险 / 测量失败）——必须处理。');
  process.exit(3);
}

if (!strict) {
  console.log('\n（响度偏差仅报告，未拦截。要硬拦请加 --strict；要改目标用 --target/--tol）');
  process.exit(0);
}

console.error(`\n⛔ --strict：响度偏差超过 ${TOL} LU。调混音（BGM volume / 各音效 dB）后重跑。`);
process.exit(3);
