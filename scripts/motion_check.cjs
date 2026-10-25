/*
 * motion_check.cjs — 永续运动密度 / 动效锚点密度 静态度量（2026-10-25 立规）
 *
 * 背景：funes(密度1:2.2, 用户赞"画面一直是动的") vs stable(1:12.6, 用户评"表现力一般")
 * ——执行方差 5 倍，靠记忆守不住，用工具验收。规则见 METHODOLOGY §12.2 / AGENTS 铁律 3。
 *
 * 用法：node scripts/motion_check.cjs <filmKey | Film.tsx 路径> [--strict]
 * 度量（静态启发式，报告工具 + 人判读）：
 *   svgNodes  视觉图元数（circle/path/rect/ellipse/line/polygon/polyline）
 *   periodic  帧驱动周期表达式（f*n、f/n、sin(f、cos(f、noise2D、drift、sway2、orbit、% 1）
 *   anchors   动效锚点（pop/heroIn/spring）——仅情报，非硬线
 * 硬线（唯一）：全片永续运动密度 = 全片periodic / 全片svgNodes ≥ 1/3（标杆 funes 1:2.2）
 *   每场景行仅为情报（不同动效语法密度分布不同，如 draw-on 语法 pop 少周期多）。
 * 退出码：0 达标（或软警告）/ 1 --strict 且低于 1/3
 */
const fs = require('fs');
const path = require('path');

const arg = process.argv[2] || '';
const STRICT = process.argv.includes('--strict');
if (!arg) {
  console.error('usage: node scripts/motion_check.cjs <filmKey | Film.tsx 路径> [--strict]');
  process.exit(1);
}
const filmFile = /[/\\]/.test(arg) ? arg : path.join('src', arg, 'Film.tsx');
if (!fs.existsSync(filmFile)) {
  console.error(`🔴 找不到 ${filmFile}`);
  process.exit(1);
}
const src = fs.readFileSync(filmFile, 'utf8');

const count = (s, re) => (s.match(re) || []).length;
const RE_NODES = /<circle|<path |<rect|<ellipse|<line |<polygon|<polyline/g;
const RE_PERIODIC = /f \* ?[\d.]+|f \/ ?[\d.]+|Math\.sin\(f|Math\.cos\(f|noise2D\(|\bdrift\(|\bsway2\(|\borbit\(|% 1/g;
const RE_ANCHORS = /\bpop\(|heroIn\(|\bspring\(/g;

/* 按场景切分（只认 *Scene 组件；根组件 Film 与辅助件不计，行级仅情报） */
const sceneRe = /const (\w+Scene): React\.FC = /g;
const marks = [];
let mm;
while ((mm = sceneRe.exec(src)) !== null) marks.push({name: mm[1], at: mm.index});
if (marks.length < 2) marks = [{name: path.basename(filmFile), at: 0}];

console.log(`== motion_check ${path.basename(filmFile)}（静态启发式，报告+人判读）==`);
console.log('场景 | 图元 | 周期 | 密度 | 锚点(情报)');
let totN = 0, totP = 0, totA = 0;
for (let i = 0; i < marks.length; i++) {
  const seg = src.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : undefined);
  const nodes = count(seg, RE_NODES);
  const periodic = count(seg, RE_PERIODIC);
  const anchors = count(seg, RE_ANCHORS);
  if (nodes + periodic + anchors === 0) continue;
  totN += nodes; totP += periodic; totA += anchors;
  const density = periodic / Math.max(1, nodes);
  console.log(
    `${marks[i].name.padEnd(16)} ${String(nodes).padStart(4)} ${String(periodic).padStart(4)}   ${density.toFixed(2)}  ${String(anchors).padStart(4)}   ${density >= 1 / 3 ? '✓' : '⚠ 低'}`,
  );
}
const gDensity = totP / Math.max(1, totN);
console.log(`-- 全片: 图元 ${totN} / 周期 ${totP}（密度 ${gDensity.toFixed(2)}）/ 锚点 ${totA}`);
if (gDensity < 1 / 3) {
  console.error('⛔ 全片永续运动密度低于 1/3（标杆 funes 1:2.2）——补周期表达式或削减静止图元');
  if (STRICT) process.exit(1);
  console.log('⚠ 软警告（--strict 硬拦）');
} else {
  console.log('✅ 全片永续运动密度达标（≥1/3，标杆 funes 1:2.2）');
}
