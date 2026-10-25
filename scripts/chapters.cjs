/*
 * chapters.cjs — 从剧本 SCENES 导出章节时间轴（2026-10-26）
 *
 * 背景：抖音的"自动分章节"是平台 AI 行为（对内容理解友好会触发），无法从文件注入；
 * 但创作者端灰度有手动添加章节入口，且 B站/西瓜/YouTube 的描述时间戳章节是通行标准。
 * 我们每部片的 SCENES+SCENE_LABELS 天然就是结构化章节——本工具一键导出。
 *
 * 用法：node scripts/chapters.cjs <filmKey [--vo]>   （缺省优先 script_vo——章节时间轴应匹配配音版成片）
 * 产出：out/<film>-chapters.txt  （mm:ss 标题 行，直接粘贴到发布页/其他平台描述区）
 */
const fs = require('fs');
const {load} = require('./lib/script_loader.cjs');

const key = process.argv[2] || '';
const USE_VO = process.argv.includes('--vo');
if (!key) {
  console.error('usage: node scripts/chapters.cjs <filmKey> [--vo]');
  process.exit(1);
}
const scriptPath = USE_VO ? `src/${key}/script_vo.ts` : fs.existsSync(`src/${key}/script_vo.ts`) ? `src/${key}/script_vo.ts` : `src/${key}/script.ts`;
const m = load(scriptPath);
const FPS = m.FPS || 30;
let title = key;
try {
  const films = JSON.parse(fs.readFileSync('films.json', 'utf8'));
  title = (films.films || films)[key]?.title || key;
} catch {}
const clean = (s) => String(s || '').trim().replace(/^\d+\s*\/\s*/, '');
const fmt = (fr) => {
  const s = Math.round(fr / FPS);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const lines = [];
lines.push(`${title} 分章节（${(m.TOTAL / FPS).toFixed(0)}s，基于 ${scriptPath}）`);
lines.push('');
for (const k of m.SCENE_ORDER) {
  const [from] = m.SCENES[k];
  lines.push(`${fmt(from)} ${clean(m.SCENE_LABELS?.[k] || k)}`);
}
lines.push('');
lines.push('【多平台描述章节格式（含秒）】');
for (const k of m.SCENE_ORDER) {
  const [from] = m.SCENES[k];
  const s = Math.round(from / FPS);
  lines.push(`${s}s ${clean(m.SCENE_LABELS?.[k] || k)}`);
}

const out = `out/${key}-chapters.txt`;
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\n✅ 已写出 ${out}`);
console.log('抖音：创作者端若有"添加章节"入口直接照抄；平台 AI 自动分章无法注入，但场景边界清晰+每段一个主题会显著提高触发概率。');
