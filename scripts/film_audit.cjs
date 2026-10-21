/*
 * 一键完播审计：按卡片表抽帧 → 原图/抖音遮罩图两张联络表 → 可读性 dwell 报告。
 * 用法：node scripts/film_audit.cjs <mp4> <cfg.json>
 * cfg: { fps, total, cards:[{from,dur,text}], impacts?:[frame] }
 * 检查项（= 完播段自检的自动化）：
 *   1. 每张卡"显出完成点"和"淡出前"各一帧 —— 验证能读完
 *   2. 抖音遮罩叠加（底部55%+右缘140px）—— 验证关键内容是否被界面盖住
 *   3. dwell 报告 —— 阅读时间(字数/4.5字每秒)+0.8s > 可见时长 则 WARN
 */
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {charStepFor} = require('./lib/script_loader.cjs');
const paths = require('./lib/paths.cjs');

const FF = paths.FFMPEG;
const [video, cfgPath] = process.argv.slice(2);
if (!video || !cfgPath) {
  console.error('usage: node scripts/film_audit.cjs <mp4> <cfg.json>');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const FPS = cfg.fps || 30;
// PLAN §3.9：按片分目录，历史审计可并列比对；只清自己的子目录，不再整树清空
const outDir = cfg.outDir || 'out/audit';
fs.rmSync(outDir, {recursive: true, force: true});
fs.mkdirSync(outDir, {recursive: true});

/* ---- 目标帧集合：每卡 显出完成点 + 淡出前 ----
 * PLAN §1.4：显出公式不再手写 2.2 常量，直接调渲染端真理源 charStepFor
 * （src/lib/subtitle.ts，经 script_loader 装载）。逐字显出的实际时序
 * （对照 trader/coder/harvest 的 chrome.tsx）：
 *   lineStart = 4 + li*18（行起步），第 gi 字从 lineStart+gi*charStep 起 3 帧显完，
 *   gi 是全卡序号、li 是行号 → 两行卡最后一字 = 4 + 18 + (n-1)*charStep + 3。
 * 注：showcase 的轮换出场（pop/blur/wipe/slide）不是逐字制，此公式对其偏早数帧
 * ——抽帧目标是"显出后可读状态"，偏早只影响抽到的画面状态，目检时知悉即可。 */
const targets = [];
cfg.cards.forEach((c, i) => {
  const len = c.text.replace(/\s/g, '').length;
  const nLines = c.text.split('\n').length;
  const revealEnd =
    c.from + Math.round(4 + 18 * (nLines - 1) + (len - 1) * charStepFor(c.dur, len) + 3);
  targets.push({frame: Math.min(revealEnd, c.from + c.dur - 16), tag: `c${i}+`});
  targets.push({frame: c.from + c.dur - 16, tag: `c${i}-`});
});
// 结尾段每 45f 一帧（完播段连读）
for (let f = Math.max(0, cfg.total - 240); f < cfg.total; f += 45) {
  targets.push({frame: f, tag: 'end'});
}
if (cfg.impacts) cfg.impacts.forEach((fr) => targets.push({frame: fr, tag: 'imp'}));
targets.sort((a, b) => a.frame - b.frame);

const sel = targets.map((t) => `eq(n\\,${t.frame})`).join('+');
const scale = `scale=480:270`;

/* ---- 画幅感知遮罩（PLAN §2.4）----
 * 旧版遮罩写死"底部 55%"，那是**竖屏全屏铺满**的遮挡模型。
 * 对 4:3 / 16:9（上下有黑边、画面居中完整显示）来说底部基本不遮挡，
 * 按 55% 去盖会让人误判"关键内容被挡了"。这里按实际画幅取参数。 */
const vw = cfg.w || null;
const vh = cfg.h || null;
let sa;
if (vw && vh) {
  // 从 src/lib/safeArea.ts 的口径复刻（CJS 侧不 import TS，保持数值一致）
  const ratio = vw / vh;
  sa =
    ratio < 0.7
      ? {bottomPct: 0.55, note: '竖屏全屏：底部/右缘均被平台 UI 压住'}
      : ratio < 1.5
        ? {bottomPct: 0.16, note: '4:3 上下黑边居中：底部安全，右缘按钮列仍压'}
        : {bottomPct: 0.14, note: '16:9 横屏：底部安全，右缘按钮列仍压'};
} else {
  sa = {bottomPct: 0.55, note: '未提供画幅，回退竖屏模型（保守）'};
}
console.log(`遮罩模型：${vw || '?'}x${vh || '?'} → 盖底部 ${(sa.bottomPct * 100).toFixed(0)}% + 右缘 140px`);
console.log(`  ${sa.note}`);

// 原图 + 平台遮罩图一次解码双输出（select+split 必须 -filter_complex + -map）
execFileSync(
  FF,
  [
    '-v', 'error',
    '-i', path.resolve(video),
    '-filter_complex',
    `select='${sel}',${scale},split=2[raw][m];` +
      `[m]drawbox=x=0:y=ih*${(1 - sa.bottomPct).toFixed(2)}:w=iw:h=ih*${sa.bottomPct.toFixed(2)}:color=black@0.55:t=fill,` +
      `drawbox=x=iw-140:y=0:w=140:h=ih:color=black@0.6:t=fill[mask]`,
    '-map', '[raw]', '-fps_mode', 'passthrough', '-y', path.join(outDir, 'raw%d.png'),
    '-map', '[mask]', '-fps_mode', 'passthrough', '-y', path.join(outDir, 'mask%d.png'),
  ],
  {stdio: 'inherit'},
);

/* ---- 联络表（6 列 tile）---- */
const n = targets.length;
const cols = 6;
const rows = Math.ceil(n / cols);
const tile = (pat, out) =>
  execFileSync(
    FF,
    ['-v', 'error', '-i', path.join(outDir, pat), '-vf', `tile=${cols}x${rows}`, '-y', out],
    {stdio: 'ignore'},
  );
tile('raw%d.png', path.join(outDir, 'sheet_raw.png'));
tile('mask%d.png', path.join(outDir, 'sheet_mask.png'));
fs.rmSync(path.join(outDir, 'raw%d.png'), {force: true});
fs.rmSync(path.join(outDir, 'mask%d.png'), {force: true});

/* ---- dwell 可读性报告 ---- */
console.log(`\n帧位图例：idx | frame | 标签（联络表按此顺序）`);
console.log(`联络表: ${outDir}/sheet_raw.png（原图）/ sheet_mask.png（抖音遮罩模拟）\n`);
let warns = 0;
console.log('卡号 | 可见时长 | 字数 | 预估阅读 | 判定');
cfg.cards.forEach((c, i) => {
  const len = c.text.replace(/\s/g, '').length;
  const dwell = (c.dur - 14) / FPS; // 扣除淡出
  const need = len / 4.5 + 0.8;
  const bad = dwell < need;
  if (bad) warns++;
  console.log(
    `c${String(i).padStart(2)} | ${dwell.toFixed(1)}s | ${len}字 | ${need.toFixed(1)}s | ${bad ? '⚠ 偏快' : 'OK'}`,
  );
});
console.log(`\n${warns ? `⚠ ${warns} 张卡偏快，建议延长或精简文案` : 'OK：全部卡片停留时间达标'}`);
console.log(`目标帧 ${n} 个，联络表 ${cols}×${rows}`);
