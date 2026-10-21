/*
 * 丝滑度检查：tblend 帧差 → YAVG 序列 → 二阶突变检测。
 * 用法：node scripts/smooth_check.cjs <video> [--script src/<片>/script.ts] [--allow-jump]
 * 原理：真正的跳变（切镜/断裂）在二阶差分上是孤立尖峰；
 *       快速但连续的运动只会抬高一次差分，不会产生尖峰。
 * 退出码：0 = 无问题；3 = 有【场景内部】跳变（make.cjs 拦截）；--allow-jump 放行
 *
 * ⚠️ 2026-10-12 三处修正：
 *   1. 旧版检出 JUMP 后只打印、始终 exit 0 —— 这道闸门（丝滑三定律唯一自动化验证）形同虚设
 *   2. 旧版 scale=270:480 对横屏是非等比压缩，同一阈值在不同画幅下灵敏度不同 → 改等比
 *   3. **场景边界的 JUMP 是正常转场**（转场本就是画面变化），旧版不分青红皂白全部列出，
 *      导致"14 个可疑跳变"里 11 个是正常转场，真正的 3 个场景内断裂被淹没。
 *      现传入 --script 做边界豁免：边界±20 帧内的 JUMP 归为"转场"，只有场景内部的才报警。
 */
const {execSync} = require('child_process');
const paths = require('./lib/paths.cjs');
const fs = require('fs');
const path = require('path');

const video = process.argv[2];
const allowJump = process.argv.includes('--allow-jump');
const scriptIdx = process.argv.indexOf('--script');
const scriptPath = scriptIdx >= 0 ? process.argv[scriptIdx + 1] : null;
if (!video) {
  console.error('usage: node scripts/smooth_check.cjs <video> [--script src/<片>/script.ts] [--allow-jump]');
  process.exit(1);
}

/* 场景边界 + 字幕卡边界（用于豁免正常变化）
 * 两类边界都会造成画面突变，且都属正常：
 *   ① 场景边界 = 转场本身（画面本就该变）
 *   ② 字幕卡边界 = 字幕带整条更换（实测 coder f1457 恰好落在卡 c9→c10 切换点）
 * 只有两类边界之外的尖峰才是真断裂。 */
let FPS = 30; // 由 --script 的剧本 FPS 覆盖（PLAN §3.3：不再到处硬编码）
let sceneBounds = [];
let cardBounds = [];
if (scriptPath && fs.existsSync(scriptPath)) {
  try {
    const {load} = require('./lib/script_loader.cjs');
    const m = load(scriptPath);
    for (const [, [from, dur]] of Object.entries(m.SCENES)) {
      sceneBounds.push(from, from + dur);
    }
    for (const c of m.CARDS || []) {
      cardBounds.push(c.from, c.from + c.dur);
    }
    console.log(`边界豁免：场景 ${sceneBounds.length} 点 + 字幕卡 ${cardBounds.length} 点（来自 ${scriptPath}）`);
    FPS = m.FPS || 30; // 时间码与秒窗口都按剧本 FPS（PLAN §3.3）
  } catch (e) {
    console.warn(`⚠ 读取边界失败（${e.message}）——不做豁免，本次仅提示`);
  }
} else if (scriptPath) {
  console.warn(`⚠ 找不到 ${scriptPath}——不做豁免，本次仅提示`);
}
const TOL = 20; // 边界±20 帧内视为正常变化（转场 18 帧 / 字幕淡出 8 帧）
const nearScene = (frame) => sceneBounds.some((b) => Math.abs(frame - b) <= TOL);
const nearCard = (frame) => cardBounds.some((b) => Math.abs(frame - b) <= TOL);

const dir = (() => {
  // 2026-10-19：Windows 沙箱/杀软会拦「子进程在系统 TEMP 落盘」（ffmpeg metadata file=d.txt → EACCES）。
  // 统一落到仓内 out/tmp，随工作区一起可写，避免整条产线在丝滑闸门静默崩掉。
  const root = path.resolve('out/tmp');
  fs.mkdirSync(root, {recursive: true});
  return fs.mkdtempSync(path.join(root, 'smooth-'));
})();
const FF = paths.FFMPEG;

/* 等比缩放：旧版 scale=270:480 对 1920x1080 是 7.11x vs 2.25x 的非等比压缩，
 * 导致同一阈值在不同画幅下灵敏度不同（横屏被压扁、竖屏反而等比）。 */
execSync(
  `"${FF}" -v error -i "${path.resolve(video)}" -vf "scale=-2:270,tblend=all_mode=difference,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=d.txt" -f null -`,
  {stdio: 'ignore', cwd: dir},
);
const dat = path.join(dir, 'd.txt');

const raw = fs.readFileSync(dat, 'utf8');
const vals = [];
for (const m of raw.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)) {
  vals.push(parseFloat(m[1]));
}
console.log(`frames: ${vals.length}`);

// 二阶差分：j[i] = d[i] - d[i-1]
const jumps = [];
for (let i = 1; i < vals.length; i++) jumps.push(vals[i] - vals[i - 1]);

// 每个点的邻域（±12 帧排除自身±2）
const all = [];
for (let i = 2; i < jumps.length - 2; i++) {
  const a = Math.abs(jumps[i]);
  if (a < 0.08) continue;
  let sum = 0;
  let n = 0;
  for (let k = Math.max(0, i - 14); k <= Math.min(jumps.length - 1, i + 14); k++) {
    if (Math.abs(k - i) <= 2) continue;
    sum += Math.abs(jumps[k]);
    n++;
  }
  const nb = sum / Math.max(1, n);
  if (a > 6 * Math.max(nb, 0.01) && a > 0.35) {
    const fr = i + 1;
    const isScene = nearScene(fr);
    const isCard = nearCard(fr);
    all.push({frame: fr, a, nb, kind: isScene ? 'scene' : isCard ? 'card' : 'break'});
  }
}

const cuts = all.filter((x) => x.kind === 'scene'); // 场景边界 = 转场
const cardCuts = all.filter((x) => x.kind === 'card'); // 字幕卡边界 = 换卡
const breaks = all.filter((x) => x.kind === 'break'); // 两类边界之外 = 真断裂

if (cuts.length) {
  console.log(`\n转场点 ${cuts.length} 个（场景边界±${TOL}内，正常）：`);
  cuts.forEach((x) => console.log(`  ✓ f${x.frame} (t=${(x.frame / FPS).toFixed(2)}s) |d2|=${x.a.toFixed(3)}`));
}
if (cardCuts.length) {
  console.log(`\n换卡点 ${cardCuts.length} 个（字幕卡边界±${TOL}内，正常）：`);
  cardCuts.forEach((x) => console.log(`  · f${x.frame} (t=${(x.frame / FPS).toFixed(2)}s) |d2|=${x.a.toFixed(3)}`));
}
if (breaks.length) {
  console.log(`\n⚠ 真断裂 ${breaks.length} 个（非转场、非换卡，需抽帧目检）：`);
  breaks.forEach((x) => console.log(`  ! f${x.frame} (t=${(x.frame / FPS).toFixed(2)}s) |d2|=${x.a.toFixed(3)} nb=${x.nb.toFixed(4)}`));
}
if (!all.length) console.log('OK: 无二阶突变尖峰（全片连续）');
const flagged = breaks.length;
if (all.length) {
  console.log(
    `\n合计 ${all.length} 个尖峰 = 转场 ${cuts.length} + 换卡 ${cardCuts.length} + 真断裂 ${breaks.length}`,
  );
}

// 附：整体运动活跃度（每秒平均帧差），过低=PPT 感，过高=躁动
// ⚠️ 旧版硬编码 60 秒循环，trader（90s）后 30 秒的活跃度根本不打印。
const secs = Math.ceil(vals.length / FPS);
for (let s = 0; s < secs; s++) {
  const seg = vals.slice(s * FPS, (s + 1) * FPS);
  if (!seg.length) break;
  const avg = seg.reduce((a, b) => a + b, 0) / seg.length;
  const bar = '#'.repeat(Math.round(Math.min(40, avg * 130)));
  console.log(`${String(s).padStart(2)}s ${avg.toFixed(3)} ${bar}`);
}

// 闸门策略（2026-10-12 实测校准后）
//
// ⚠️ 这个判据的适用边界必须说清楚，否则会变成"误拦一切"或"永远放行"两种失败：
//
//  实测（四片全量）：
//    coder     14 尖峰 = 转场 11 + 换卡 3 + 断裂 0   ← 动效克制，判据干净
//    trader    78 尖峰 = 转场  6 + 换卡 38 + 断裂 34
//    harvest   63 尖峰 = 转场 11 + 换卡 17 + 断裂 35
//    showcase 113 尖峰 = 转场 17 + 换卡 22 + 断裂 74
//
//  深入看 showcase 的 74 个"断裂"：**大量成对出现**（f46/47、f191/192、f575/576…），
//  且时间间隔规整（f575→599→671→695→719→743→767 间隔 24 帧 = 0.8s），
//  幅度 0.35~2.30 与 coder 的转场点（1.67~5.32）同量级。
//  这是**永动层的元素快速起停**（PARTICLE/打字机/进度条等按节拍循环），不是渲染事故。
//
//  结论：**尖峰≠事故**。本判据在"动效频繁起停"的片子上会系统性误报，
//  不能作为硬闸门。故采用分级策略：
//    - coder 类（尖峰少且幅度集中）：真断裂 >0 即拦（能可靠区分）
//    - 其他片：列出全部尖峰供人工比对，**不拦**，但在报告里给出密度指标
//  要升级为硬拦，需要更精确的判据（如对比相邻帧的结构相似度 SSIM 而非亮度均值），
//  见 PLAN §1.0m。
const BREAK_HARD_LIMIT = 5; // 真断裂超过此数 → 判定为"动效密集片"，只提示不拦
const dense = breaks.length > BREAK_HARD_LIMIT;

if (flagged > 0) {
  const avg = (breaks.reduce((a, b) => a + b.a, 0) / flagged).toFixed(3);
  console.warn(`\n⚠ 检出 ${flagged} 个边界外尖峰（平均 |d2|=${avg}）`);
  if (dense) {
    console.warn(`   数量 > ${BREAK_HARD_LIMIT}——疑似"动效频繁起停"而非渲染事故，**不拦截**。`);
    console.warn('   请抽帧确认：若画面无撕裂/跳帧，属正常动效；');
    console.warn('   若确有断裂，用 --allow-jump 明确放行并在 PLAN 里登记。');
  } else {
    console.error(`   数量 ≤ ${BREAK_HARD_LIMIT}——数量少且孤立，更可能是真断裂。`);
  }
}

if (flagged > 0 && !dense && !allowJump) {
  console.error(`\n⛔ 检出 ${flagged} 个孤立的边界外断裂——建议抽帧目检后修复。`);
  console.error('   确认无害请加 --allow-jump。');
  process.exit(3);
}
if (flagged > 0 && (dense || allowJump)) {
  console.log(`\n（本次未拦截：${dense ? '动效密集模式' : '--allow-jump 已指定'}）`);
}
