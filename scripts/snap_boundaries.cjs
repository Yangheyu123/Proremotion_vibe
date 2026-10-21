/*
 * 把场景边界与字幕卡吸附到 BGM 切片的节拍格。
 *
 * 用法：
 *   node scripts/snap_boundaries.cjs <script.ts>              # 预览（打印将要写入的内容）
 *   node scripts/snap_boundaries.cjs <script.ts> --write      # 直接回写 script.ts
 *   node scripts/snap_boundaries.cjs <script.ts> --tol 20     # 覆盖吸附容差（默认 15 帧）
 *   node scripts/snap_boundaries.cjs <script.ts> --beats out/beats.json
 *
 * ⚠️ 2026-10-12 重写（PLAN §1.5）。旧版有四个问题：
 *   1. TOTAL=1800 写死在脚本里 —— 对 2700 帧的 trader 直接算错
 *   2. ORIG_SCENES / ORIG_CARDS 是某条 60s 旧片的手抄锚点 —— 与现役片子无关
 *   3. 只 console.log 打印，不回写 —— 而 METHODOLOGY 第 2 章写的是"吸附→回写 script.ts"
 *   4. 无参数，只能对一部片用
 * 新版：锚点从**当前 script.ts 自己**读（SCENES/CARDS 现状即原始锚点），
 * TOTAL 从真理源读，节拍从 out/beats.json 读，--write 时按结构化方式精确替换三块。
 */
const fs = require('fs');
const path = require('path');
const {load} = require('./lib/script_loader.cjs');

const argv = process.argv.slice(2);
const scriptFile = argv.find((a) => !a.startsWith('--'));
if (!scriptFile) {
  console.error('usage: node scripts/snap_boundaries.cjs <script.ts> [--write] [--tol N] [--beats out/beats.json]');
  process.exit(1);
}
if (!fs.existsSync(scriptFile)) {
  console.error(`⛔ 找不到剧本文件：${scriptFile}`);
  process.exit(1);
}
const argVal = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? parseFloat(argv[i + 1]) : d;
};
const WRITE = argv.includes('--write');
const TOL = argVal('--tol', 15);
const beatsFile = (() => {
  const i = argv.indexOf('--beats');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : 'out/beats.json';
})();

if (!fs.existsSync(beatsFile)) {
  console.error(`⛔ 找不到节拍表 ${beatsFile}`);
  console.error('   先跑：node scripts/beat_detect.cjs <切片起点s> <时长s> <音频文件>');
  process.exit(1);
}
const {beats, bpm} = JSON.parse(fs.readFileSync(beatsFile, 'utf8'));

/* ---------- 从当前剧本读锚点（不再手抄） ---------- */
const m = load(scriptFile);
const TOTAL = m.TOTAL;
if (!TOTAL) {
  console.error('⛔ 剧本未导出 TOTAL');
  process.exit(1);
}

const sceneKeys = Object.keys(m.SCENES);
// 场景起点即锚点；末场终点用 TOTAL
const sceneAnchors = sceneKeys.map((k) => m.SCENES[k][0]);
const cardStarts = m.CARDS.map((c) => c.from);

console.log(`剧本：${scriptFile}`);
console.log(`片长：${TOTAL} 帧（${(TOTAL / (m.FPS || 30)).toFixed(1)}s）| 场景 ${sceneKeys.length} 个 | 字幕卡 ${m.CARDS.length} 张`);
console.log(`节拍：${beats.length} 拍，BPM≈${(bpm || 0).toFixed(1)}（${beatsFile}）`);
console.log(`吸附容差：±${TOL} 帧\n`);

/* ---------- 吸附：±TOL 内选 强度×高斯距离权 最大的拍 ---------- */
const snapOne = (anchor, prevSnapped) => {
  let best = anchor;
  let bestScore = -1;
  for (const bt of beats) {
    const d = bt.frame - anchor;
    if (Math.abs(d) > TOL) continue;
    if (bt.frame <= (prevSnapped ?? -Infinity) + 60) continue; // 与上一锚点至少隔 60 帧
    const score = (bt.strength ?? 1) * Math.exp(-((d / 8) ** 2)) + 1e-4;
    if (score > bestScore) {
      bestScore = score;
      best = bt.frame;
    }
  }
  return best;
};

const snapped = [];
sceneAnchors.forEach((a, i) => {
  const s = snapOne(a, snapped[i - 1]);
  snapped.push(s);
});
snapped.push(TOTAL); // 末场终点

console.log('SCENES（吸附后）：');
const newScenes = {};
sceneKeys.forEach((k, i) => {
  newScenes[k] = [snapped[i], snapped[i + 1] - snapped[i]];
  const shift = snapped[i] - sceneAnchors[i];
  const mark = shift === 0 ? '（未动）' : `（移动 ${shift > 0 ? '+' : ''}${shift}）`;
  console.log(`  ${k.padEnd(10)} from=${String(snapped[i]).padStart(4)} dur=${String(snapped[i + 1] - snapped[i]).padStart(4)}  ${mark}`);
});

/* ---------- 字幕卡：按所属场景段线性重排，段内首尾闭合 ---------- */
// 每张卡归属"起点 ≤ 它的最后一个场景"
const cardSeg = cardStarts.map((f) => {
  let seg = 0;
  for (let i = 0; i < sceneAnchors.length; i++) {
    if (f >= sceneAnchors[i]) seg = i;
  }
  return seg;
});

const newCards = cardStarts.map((f, i) => {
  const seg = cardSeg[i];
  const sOld = sceneAnchors[seg];
  const sNew = snapped[seg];
  const eOld = sceneAnchors[seg + 1] ?? TOTAL;
  const eNew = snapped[seg + 1] ?? TOTAL;
  // 段内线性映射；段长可能变化，用比例缩放并保证整数
  const k2 = eOld > sOld ? (eNew - sNew) / (eOld - sOld) : 1;
  return Math.round(sNew + (f - sOld) * k2);
});

// dur = 下一卡起点 - 本卡起点；末卡到 TOTAL
const newDurs = newCards.map((f, i) => (newCards[i + 1] ?? TOTAL) - f);

console.log('\nCARDS（吸附后）：');
m.CARDS.forEach((c, i) => {
  const shift = newCards[i] - c.from;
  const mark = shift === 0 ? '' : `  ← 移动 ${shift > 0 ? '+' : ''}${shift}`;
  console.log(`  c${String(i).padStart(2)}  from=${String(newCards[i]).padStart(4)} dur=${String(newDurs[i]).padStart(4)}${mark}`);
});

/* ---------- BEATS 帧表 ---------- */
const beatFrames = beats.map((b) => b.frame).filter((f) => f < TOTAL);
const dropped = beats.length - beatFrames.length;

/* 安全防护：beats.json 是"某次切片"的产物，可能与当前剧本片长不匹配。
 * 若可用拍数远少于期望（按 BPM 与片长推算），说明用错了 beats.json —— 
 * 直接回写会把 BEATS 表截短，导致后半段画面失去节拍呼吸（且不会被任何检查发现）。
 * 这里按 3/4 的宽容量判定：低于期望的 75% 就拒绝回写。 */
const fps = m.FPS || 30;
const estBpm = bpm && bpm > 0 ? bpm : 75;
const expectedBeats = Math.round(((TOTAL / fps) * estBpm) / 60);
const beatsOk = beatFrames.length >= expectedBeats * 0.75;
console.log(
  `\nBEATS：${beatFrames.length} 拍（已过滤 ≥ TOTAL 的 ${dropped} 个；按 BPM≈${estBpm.toFixed(1)} 与 ${(TOTAL / fps).toFixed(0)}s 推算应约 ${expectedBeats} 拍）`,
);
if (!beatsOk) {
  console.error(`\n⛔ 可用拍数明显偏少（${beatFrames.length} < 期望 ${expectedBeats} 的 75%）。`);
  console.error('   很可能是这个 beats.json 来自别的切片（起点/时长不匹配）。');
  console.error('   直接回写会让后半段画面失去节拍呼吸。');
  console.error('   请先按本片片长重跑：node scripts/beat_detect.cjs <起点s> <时长s> <音频>');
  process.exit(1);
}

/* ---------- 回写 ---------- */
if (!WRITE) {
  console.log('\n（预览模式：未写入任何文件。加 --write 直接回写 script.ts）');
  console.log('  回写会替换三块：SCENES / CARDS 的 from,dur / BEATS');
  process.exit(0);
}

// 备份
const bak = `${scriptFile}.bak-${Date.now()}`;
fs.copyFileSync(scriptFile, bak);

let src = fs.readFileSync(scriptFile, 'utf8');
let applied = [];

/* 1) SCENES 块：替换每个 key 的 [from, dur] */
{
  const re = /export const SCENES = \{[\s\S]*?\} as const;/;
  if (re.test(src)) {
    const body = sceneKeys
      .map((k) => `  ${k}: [${newScenes[k][0]}, ${newScenes[k][1]}],`)
      .join('\n');
    src = src.replace(re, `export const SCENES = {\n${body}\n} as const;`);
    applied.push('SCENES');
  }
}

/* 2) CARDS 的 from/dur：逐卡精确替换
 * 用 "from: <old>, dur: <old>" 定位，避免误伤其他数字 */
{
  let count = 0;
  m.CARDS.forEach((c, i) => {
    const oldPat = new RegExp(`from:\\s*${c.from},\\s*dur:\\s*${c.dur}`);
    if (oldPat.test(src)) {
      src = src.replace(oldPat, `from: ${newCards[i]}, dur: ${newDurs[i]}`);
      count++;
    }
  });
  applied.push(`CARDS(${count}/${m.CARDS.length})`);
  if (count !== m.CARDS.length) {
    console.error(`\n⚠ 只替换了 ${count}/${m.CARDS.length} 张卡 —— from/dur 写法与预期不符。`);
    console.error(`  已还原 ${scriptFile}`);
    fs.copyFileSync(bak, scriptFile);
    fs.rmSync(bak, {force: true});
    process.exit(1);
  }
}

/* 3) BEATS 数组 */
{
  const re = /export const BEATS: number\[\] = \[[\s\S]*?\];/;
  if (re.test(src)) {
    // 每行 16 个数，保持可读
    const lines = [];
    for (let i = 0; i < beatFrames.length; i += 16) {
      lines.push('  ' + beatFrames.slice(i, i + 16).join(', ') + ',');
    }
    src = src.replace(re, `export const BEATS: number[] = [\n${lines.join('\n')}\n];`);
    applied.push('BEATS');
  }
}

fs.writeFileSync(scriptFile, src);

/* ---------- 回读校验：确认能正常 load 且数值正确 ---------- */
try {
  const check = load(scriptFile);
  const sceneOk = sceneKeys.every((k) => check.SCENES[k][0] === newScenes[k][0] && check.SCENES[k][1] === newScenes[k][1]);
  const cardOk = check.CARDS.every((c, i) => c.from === newCards[i] && c.dur === newDurs[i]);
  if (!sceneOk || !cardOk) throw new Error(`回读不一致（SCENES ${sceneOk ? 'ok' : '✗'} / CARDS ${cardOk ? 'ok' : '✗'}）`);
  console.log(`\n✅ 已回写 ${scriptFile}`);
  console.log(`   替换：${applied.join(' + ')}`);
  console.log(`   回读校验通过（SCENES/CARDS 与预期一致）`);
  console.log(`   备份：${bak}`);
  console.log('\n下一步：node scripts/dwell_check.cjs ' + scriptFile + '  （确认密度仍达标）');
  fs.rmSync(bak, {force: true});
} catch (e) {
  fs.copyFileSync(bak, scriptFile);
  console.error(`\n⛔ 回读校验失败：${e.message}`);
  console.error(`   已还原 ${scriptFile}（备份保留：${bak}）`);
  process.exit(1);
}
