/*
 * 机制库回归基线：把 METHODOLOGY.md 第 6 章「改 lib 前先抓基线，改完必比」从手工纪律变成可执行文件。
 *
 * 用法：
 *   node scripts/baseline.cjs snap              # 抓基线（WAV 统计量 + 关键帧 PSNR 指纹）
 *   node scripts/baseline.cjs verify            # 校验现状 vs 基线；有异常 → exit 非 0
 *   node scripts/baseline.cjs verify --allow-drift   # 只报不拦（改音效后有意变更时用）
 *
 * 设计要点（2026-10-12 新增，起因：bandpass 发散后旧的纯 MD5 基线把垃圾认证成了"正确"）：
 *   1. **MD5 之外必须有独立判据**。纯 MD5 只能回答"变没变"，不能回答"对不对"——
 *      旧的 out/sfx_baseline.md5 就是与损坏文件逐字节一致，于是 18/18 全过。
 *   2. 因此基线同时记录**音频物理量**（rms/min/max/零样本率/时长）与**质量断言**，
 *      verify 先跑质量断言（与基线无关，看的是物理合理性），再比 MD5（看的是"有没有变"。
 *   3. 质量断言就是"像不像一个音效"：双极性、振幅合理、非静音、非满幅噪声。
 *      这四条足以在合成阶段抓住发散、静音、削波三类事故，且不需要人工听。
 */
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const paths = require('./lib/paths.cjs');

const FF = paths.FFMPEG;
const FP = paths.FFPROBE;
const SFX_DIR = 'out/sfx';
const BASELINE = 'out/baseline.json';

const argv = process.argv.slice(2);
const cmd = argv[0];
if (!['snap', 'verify'].includes(cmd)) {
  console.error('usage: node scripts/baseline.cjs snap|verify [--allow-drift]');
  process.exit(1);
}
const allowDrift = argv.includes('--allow-drift');

/* ---------- 音频统计（读 WAV 的 Int16 body） ---------- */
const wavStats = (file) => {
  const b = fs.readFileSync(file);
  const body = b.subarray(44);
  const n = body.length / 2;
  if (n === 0) return null;
  let sum = 0, mn = 0, mx = 0, zero = 0;
  for (let i = 0; i < n; i++) {
    const v = body.readInt16LE(i * 2);
    sum += v * v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    if (v === 0) zero++;
  }
  return {
    rms: +Math.sqrt(sum / n).toFixed(1),
    min: mn,
    max: mx,
    zeroPct: +((zero / n) * 100).toFixed(2),
    ms: +((n / 44100) * 1000).toFixed(1),
  };
};

/**
 * 质量断言 —— 与基线无关，只看"这段波形物理上像不像一个可用音效"。
 * 这几条正是 2026-10-12 那批垃圾文件会全部命中的判据。
 */
const qualityIssues = (name, s) => {
  const errs = [];
  if (!s) return ['文件缺失或为空'];
  if (!(s.max > 0)) errs.push(`峰值非正 (max=${s.max}) —— 单边饱和，滤波器发散特征`);
  if (!(s.min < 0)) errs.push(`峰值非负 (min=${s.min})`);
  if (s.rms > 20000) errs.push(`振幅过高 (rms=${s.rms}) —— 疑似满幅噪声`);
  if (s.rms < 500) errs.push(`振幅过低 (rms=${s.rms}) —— 疑似静音`);
  if (s.zeroPct >= 50) errs.push(`零样本率 ${s.zeroPct}% —— 超过半数静音`);
  return errs;
};

const md5 = (file) => execFileSync('certutil', ['-hashfile', file, 'MD5'], {encoding: 'utf8'})
  .split('\n')[1].trim().toLowerCase();

/* ---------- 音效库快照 ---------- */
const scanSfx = () => {
  if (!fs.existsSync(SFX_DIR)) {
    console.error(`⛔ 找不到 ${SFX_DIR}/ —— 先跑一次 synthAll（任何 sfx 脚本都会触发）`);
    process.exit(1);
  }
  const files = fs.readdirSync(SFX_DIR).filter((f) => f.endsWith('.wav')).sort();
  const out = {};
  for (const f of files) {
    const full = path.join(SFX_DIR, f);
    out[f.replace(/\.wav$/, '')] = {...wavStats(full), md5: md5(full)};
  }
  return out;
};

/* ---------- 关键帧 PSNR 指纹 ----------
 * 静帧抽样：从各 raw 产物各取 3 帧存 PNG，记录其 MD5；verify 时重渲同帧比对。
 * 无 raw 产物时跳过（不阻断），并在报告里注明。 */
const FRAME_SAMPLES = [
  {label: 'coder', raw: 'out/coder-raw.mp4', frames: [300, 800, 1300]},
  {label: 'trader', raw: 'out/trader-raw.mp4', frames: [300, 1200, 2200]},
  // 2026-10-12 扩至四片：motion.ts 抽取（§3.6）需要全片覆盖，两片样本抓不住另两片的回归
  {label: 'showcase', raw: 'out/showcase-raw.mp4', frames: [300, 900, 1500]},
  {label: 'harvest', raw: 'out/harvest-wide-raw.mp4', frames: [300, 800, 1300]},
];

const grabFrames = (outDir) => {
  fs.mkdirSync(outDir, {recursive: true});
  const got = [];
  for (const {label, raw, frames} of FRAME_SAMPLES) {
    if (!fs.existsSync(raw)) continue;
    const sel = frames.map((f) => `eq(n\\,${f})`).join('+');
    try {
      execFileSync(
        FF,
        ['-v', 'error', '-i', raw, '-vf', `select='${sel}'`, '-fps_mode', 'passthrough', '-y',
         path.join(outDir, `${label}-%d.png`)],
        {stdio: 'ignore'},
      );
      frames.forEach((f, i) => {
        const png = path.join(outDir, `${label}-${i + 1}.png`);
        if (fs.existsSync(png)) got.push({label, frame: f, md5: md5(png)});
      });
    } catch {}
  }
  return got;
};

/* ---------- snap / verify ---------- */
if (cmd === 'snap') {
  const sfx = scanSfx();
  const frameDir = 'out/baseline-frames';
  fs.rmSync(frameDir, {recursive: true, force: true});
  const frames = grabFrames(frameDir);

  // 抓基线前先跑质量断言：拒绝把坏状态认证成"正确"
  let bad = 0;
  for (const [name, s] of Object.entries(sfx)) {
    const errs = qualityIssues(name, s);
    if (errs.length) {
      console.error(`  🔴 ${name}.wav: ${errs.join('；')}`);
      bad++;
    }
  }
  if (bad) {
    console.error(`\n⛔ 拒绝抓基线：${bad}/${Object.keys(sfx).length} 个音效未通过质量断言。`);
    console.error('   先把合成数值修好（见 PLAN.md §1.0），否则基线会把坏状态固化成"正确"。');
    process.exit(3);
  }

  const doc = {
    note: '回归基线。sfx=音频物理量+MD5；frames=关键帧 PNG 的 MD5（同机同版本渲染应稳定）。',
    created_at: new Date().toISOString(),
    sfx,
    frames,
  };
  fs.writeFileSync(BASELINE, JSON.stringify(doc, null, 1));
  console.log(`\n✅ 基线已抓：${BASELINE}`);
  console.log(`   音效 ${Object.keys(sfx).length} 个（全部通过质量断言）`);
  console.log(`   关键帧 ${frames.length} 张${frames.length ? '' : '（无 raw 产物，已跳过）'}`);
  console.log('\n以后改 src/lib 或 scripts/lib 前：node scripts/baseline.cjs verify');
  process.exit(0);
}

/* verify */
if (!fs.existsSync(BASELINE)) {
  console.error(`⛔ 没有基线（${BASELINE}）——先跑 node scripts/baseline.cjs snap`);
  process.exit(2);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const now = scanSfx();

let failures = 0;
let drifts = 0;

console.log(`基线：${base.created_at}`);
console.log(`\n━━━ 一、质量断言（看物理合理性，与基线无关）━━━`);
for (const [name, s] of Object.entries(now)) {
  const errs = qualityIssues(name, s);
  if (errs.length) {
    console.error(`  🔴 ${name}: ${errs.join('；')}`);
    failures++;
  }
}
if (!failures) console.log(`  ✅ ${Object.keys(now).length} 个音效全部通过`);

console.log(`\n━━━ 二、MD5 比对（看有没有变）━━━`);
for (const [name, s] of Object.entries(now)) {
  const b = base.sfx[name];
  if (!b) {
    console.log(`  ＋ 新增 ${name}`);
    drifts++;
  } else if (b.md5 !== s.md5) {
    console.log(`  ~ 变更 ${name}  rms ${b.rms}→${s.rms}  max ${b.max}→${s.max}`);
    drifts++;
  }
}
for (const name of Object.keys(base.sfx)) {
  if (!now[name]) {
    console.log(`  － 移除 ${name}`);
    drifts++;
  }
}
if (!drifts) console.log('  ✅ 与基线逐字节一致');

console.log(`\n━━━ 三、关键帧比对 ━━━`);
if (!base.frames?.length) {
  console.log('  （基线无关键帧：抓基线时没有 raw 产物，跳过）');
} else {
  const cur = grabFrames('out/baseline-frames-verify');
  let fm = 0;
  for (const bf of base.frames) {
    const cf = cur.find((c) => c.label === bf.label && c.frame === bf.frame);
    if (!cf) {
      console.log(`  ? ${bf.label}@f${bf.frame} 无法比对（当前 raw 缺失）`);
      continue;
    }
    if (cf.md5 !== bf.md5) {
      console.log(`  ~ ${bf.label}@f${bf.frame} 像素有差异`);
      fm++;
    }
  }
  fs.rmSync('out/baseline-frames-verify', {recursive: true, force: true});
  console.log(fm ? `  ${fm}/${base.frames.length} 帧有差异（渲染改动或字体/版本变化）` : `  ✅ ${base.frames.length} 帧完全一致`);
  drifts += fm;
}

console.log(`\n━━━ 结论 ━━━`);
if (failures) {
  console.error(`🔴 质量断言失败 ${failures} 项 —— 音效合成已坏，禁止出片。`);
  process.exit(3);
}
if (drifts && !allowDrift) {
  console.error(`⚠ 与基线有 ${drifts} 处差异。若是有意改动：node scripts/baseline.cjs snap 重抓基线。`);
  process.exit(4);
}
console.log('✅ 通过');
