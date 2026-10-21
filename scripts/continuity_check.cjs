/*
 * 连贯性审计：统计全片的"硬切率"——有多少转场是上场的元素凭空消失、下场凭空出现。
 *
 * 用法：node scripts/continuity_check.cjs <script.ts> [--cast <cast.ts>]
 * 退出码：0 = 达标或仅报告；3 = --strict 且硬切率超阈值
 *
 * ── 为什么需要这个（PLAN §2.1）────────────────────────────
 * 用户 METHOD.md 的"待改进①"是跨场景元素继承。这条待办已挂了很久，
 * 原因是它**只存在于文档里，没有可测指标** —— 所以永远不会被推进，也无法验收。
 *
 * 本脚本把它变成数字：**硬切率 = 无接力的转场数 / 总转场数**。
 *   - 有了数字，"这版比上版连贯"就能被验证
 *   - 也能设阈值当闸门（新片建议 --strict）
 *
 * ── 判据 ────────────────────────────────────────────────
 * 一个转场算"软接"（有连贯叙事）需满足：上一场有元素接力进下一场。
 * 这需要片方显式声明（src/lib/cast.ts 的 defineCarry）。
 * 未声明则全算硬切 —— 这不是"错误"，而是**如实反映当前状态**，
 * 让"要不要做连贯叙事"变成一个可见的决策点，而不是默认忽略。
 */
const fs = require('fs');
const path = require('path');
const {load} = require('./lib/script_loader.cjs');

const argv = process.argv.slice(2);
const scriptFile = argv.find((a) => !a.startsWith('--'));
if (!scriptFile) {
  console.error('usage: node scripts/continuity_check.cjs <script.ts> [--cast <cast.ts>] [--strict]');
  process.exit(1);
}
const argVal = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const castFile = argVal('--cast', null);
const STRICT = argv.includes('--strict');
const HARD_LIMIT = parseFloat(argVal('--max-hard', '1.0')); // 默认允许全硬切，只报告

const m = load(scriptFile);
const sceneKeys = Object.keys(m.SCENES);
const sceneEntries = sceneKeys.map((k) => ({key: k, from: m.SCENES[k][0], dur: m.SCENES[k][1]}));

console.log(`剧本：${scriptFile}`);
console.log(`场景：${sceneEntries.length} 个\n`);

/* ---------- 读接力声明 ---------- */
let carries = [];
if (castFile) {
  if (!fs.existsSync(castFile)) {
    console.error(`⛔ 找不到 ${castFile}`);
    process.exit(1);
  }
  // 从 TS 源里解析 defineCarry 的条目。
  // ⚠️ 不能按固定字段顺序匹配 —— 声明里字段可能换行、换序、夹注释。
  // 改为**按对象块切分**，再在块内逐字段抽取。
  const src = fs.readFileSync(castFile, 'utf8');
  const body = src.slice(src.indexOf('defineCarry('));
  // 每个 { ... } 块（不含嵌套，本例足够）
  for (const mt of body.matchAll(/\{[^{}]*\}/g)) {
    const blk = mt[0];
    const pick = (key) => {
      const r = blk.match(new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`));
      return r ? r[1] : null;
    };
    const id = pick('id');
    const fromScene = pick('fromScene');
    const toScene = pick('toScene');
    const pathName = pick('path');
    if (id && fromScene && toScene && pathName) {
      carries.push({id, fromScene, toScene, path: pathName});
    }
  }
  console.log(`接力声明：${carries.length} 条（来自 ${castFile}）`);
} else {
  console.log('接力声明：未提供 --cast —— 全片按「无接力」统计');
}
console.log('');

/* ---------- 逐转场判定 ---------- */
const rows = [];
for (let i = 0; i < sceneEntries.length - 1; i++) {
  const a = sceneEntries[i];
  const b = sceneEntries[i + 1];
  const boundary = b.from;
  const matched = carries.filter((c) => c.fromScene === a.key && c.toScene === b.key);
  rows.push({
    from: a.key,
    to: b.key,
    boundary,
    soft: matched.length > 0,
    carries: matched.map((c) => `${c.id}(${c.path})`),
  });
}

const softCount = rows.filter((r) => r.soft).length;
const total = rows.length;
const hardRate = total ? (total - softCount) / total : 0;

console.log('转场清单：');
console.log('  边界帧 | 从            → 到              | 连贯性');
rows.forEach((r) => {
  const mark = r.soft ? '✅ 软接' : '○ 硬切';
  const detail = r.soft ? `  [${r.carries.join(', ')}]` : '';
  console.log(
    `  ${String(r.boundary).padStart(6)} | ${r.from.padEnd(13)} → ${r.to.padEnd(14)} | ${mark}${detail}`,
  );
});

console.log('');
console.log(`合计 ${total} 个转场 = 软接 ${softCount} + 硬切 ${total - softCount}`);
console.log(`硬切率：${(hardRate * 100).toFixed(1)}%`);

/* ---------- 未使用的接力声明（可能是笔误） ---------- */
const usedIds = new Set(rows.flatMap((r) => r.carries.map((c) => c.split('(')[0])));
const unused = carries.filter((c) => !usedIds.has(c.id));
if (unused.length) {
  console.warn(`\n⚠ ${unused.length} 条接力声明未被匹配到任何转场（检查 fromScene/toScene 拼写）：`);
  unused.forEach((c) => console.warn(`    ${c.id}: ${c.fromScene} → ${c.toScene}`));
}

/* ---------- 未知场景 key ---------- */
const known = new Set(sceneKeys);
const badRefs = carries.filter((c) => !known.has(c.fromScene) || !known.has(c.toScene));
if (badRefs.length) {
  console.error(`\n⛔ ${badRefs.length} 条接力引用了不存在的场景 key：`);
  badRefs.forEach((c) => console.error(`    ${c.id}: ${c.fromScene} → ${c.toScene}（可用：${sceneKeys.join('/')}）`));
  process.exit(2);
}

/* ---------- 判定 ---------- */
if (hardRate > HARD_LIMIT) {
  if (STRICT) {
    console.error(`\n⛔ --strict：硬切率 ${(hardRate * 100).toFixed(1)}% 超过阈值 ${(HARD_LIMIT * 100).toFixed(0)}%。`);
    console.error('   给转场加元素接力（见 src/lib/cast.ts 的 defineCarry 示例）。');
    process.exit(3);
  }
  console.log(`\n（硬切率高于阈值，但未指定 --strict —— 仅报告）`);
}
console.log('\n说明：硬切不是错误，是"这一版没做连贯叙事"的如实反映。');
console.log('      要降低硬切率，在 src/lib/cast.ts 为转场声明 defineCarry 接力元素。');
