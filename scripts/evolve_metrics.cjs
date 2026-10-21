/*
 * 自我演化指标仪表（正反馈数据源）。
 * 用法：node scripts/evolve_metrics.cjs [--json out/evolve_metrics.json]
 * 每次演化迭代跑一次，输出与上一次的差值 —— 数字不动 = 迭代无效。
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const count = (re, files) => files.reduce((a, f) => {
  const p = path.join(ROOT, f);
  return a + (fs.existsSync(p) ? (fs.readFileSync(p, 'utf8').match(re) || []).length : 0);
}, 0);

const film = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'luma';
const sceneFiles = fs.existsSync(`src/${film}`)
  ? fs.readdirSync(`src/${film}`).filter((x) => x.endsWith('.tsx')).map((x) => `src/${film}/${x}`)
  : [];

const metrics = {
  at: new Date().toISOString().slice(0, 16),
  film,
  motion_density: count(/Math\.sin\(/g, sceneFiles),            // 永动层表达式（基线 ≥15）
  jsx_elements: count(/<[a-z]+[ >]/g, sceneFiles),              // 画面元素总量
  card_beats: count(/pop\(f, \d+/g, sceneFiles),                // 卡节拍锚点数
  doc_bytes: ['PLAN.md', 'PLAN_ARCHIVE.md', 'METHODOLOGY.md'].reduce((a, f) => a + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0),
  sfx_lib_bytes: fs.statSync('scripts/lib/sfx_lib.cjs').size,
};

const OUT = 'out/evolve_metrics.json';
let prev = null;
if (fs.existsSync(OUT)) {
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* 无历史 */ }
}
console.log(`── 演化指标 @ ${metrics.at} ──`);
for (const k of Object.keys(metrics).slice(2)) {
  const d = prev ? metrics[k] - prev[k] : 0;
  const arrow = prev ? (d > 0 ? `↑+${d}` : d < 0 ? `↓${d}` : '=') : '(基线)';
  console.log(`  ${k.padEnd(16)} ${String(metrics[k]).padStart(7)}  ${arrow}`);
}
if (process.argv.includes('--json')) fs.writeFileSync(OUT, JSON.stringify(metrics, null, 1));
