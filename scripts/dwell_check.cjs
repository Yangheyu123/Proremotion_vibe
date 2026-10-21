/*
 * 剧本静态体检（零渲染，写完剧本立刻跑，渲染前拦截可读性事故）。
 * 用法：node scripts/dwell_check.cjs src/<片>/script.ts [--maxline N]
 * 检查项（= METHODOLOGY 密度红线 + 卡片结构）：
 *   1. 单卡可读性：字数/4.5字每秒 + 0.8s ≤ 可见时长（扣 14f 淡出）
 *   2. 全片密度：总字数 ≤ 4.5 × (片长-3s)
 *   3. 单行长度：1080 宽 ≤14 字 / 1920 宽 ≤22 字（--maxline 覆盖）
 *   4. kw 覆盖：全片至少一张卡有 kw 高亮
 *   5. 卡片闭合：from 连续无缝隙重叠、首卡 0 起、末卡到 TOTAL
 * 退出码：0 = 通过；2 = 有 ⚠（make.cjs 闸门拦截，确认接受可 --force 跳过）
 */
const {load, cardChars, cardText} = require('./lib/script_loader.cjs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/dwell_check.cjs <script.ts> [--maxline N]');
  process.exit(1);
}
const maxLineArg = process.argv.includes('--maxline')
  ? parseFloat(process.argv[process.argv.indexOf('--maxline') + 1])
  : null;

const m = load(file);
const FPS = m.FPS || 30;
const cards = m.CARDS;
if (!cards?.length) {
  console.error('未找到 CARDS 导出——确认是剧本真理源文件');
  process.exit(1);
}
const W = m.W || 1080;
const maxLine = maxLineArg ?? (W >= 1920 ? 22 : 14);

console.log(`======== ${file} ========`);
console.log(`片长 ${(m.TOTAL / FPS).toFixed(0)}s | ${cards.length} 卡 | 画幅 ${W}`);

let warns = 0;
const fail = (msg) => {
  console.log('⚠ ' + msg);
  warns++;
};

/* 1. 单卡可读性 */
console.log('\n卡号 | 字数 | 可见 | 需阅读 | 判定');
cards.forEach((c, i) => {
  const chars = cardChars(c);
  const dwell = (c.dur - 14) / FPS;
  const need = chars / 4.5 + 0.8;
  const bad = dwell < need;
  if (bad) warns++;
  console.log(
    `c${String(i).padStart(2)} | ${String(chars).padStart(3)}字 | ${dwell.toFixed(1)}s | ${need.toFixed(1)}s | ${bad ? '⚠ 偏快' : 'OK'}`,
  );
});

/* 2. 全片密度 */
const totalChars = cards.reduce((a, c) => a + cardChars(c), 0);
const limit = 4.5 * (m.TOTAL / FPS - 3);
console.log(
  `\n全片 ${totalChars} 字 / 上限 ${Math.round(limit)} 字（4.5字/s × ${(m.TOTAL / FPS - 3).toFixed(0)}s）—— ${totalChars > limit ? '⚠ 超密度' : 'OK'}`,
);
if (totalChars > limit) warns++;

/* 3. 单行长度 */
cards.forEach((c, i) => {
  (c.lines || []).forEach((l, li) => {
    const len = l.map((s) => s.t).join('').replace(/\s/g, '').length;
    if (len > maxLine) fail(`卡${i} 行${li + 1} ${len}字 > 单行上限 ${maxLine}（${W} 宽）`);
  });
});

/* 4. kw 覆盖 */
const kwCards = cards.filter((c) => (c.lines || []).some((l) => l.some((s) => s.kw))).length;
if (kwCards === 0) fail('全片无 kw 高亮——重点词必须上屏');
else console.log(`kw 覆盖 ${kwCards}/${cards.length} 卡`);

/* 5. 卡片闭合 */
let prevEnd = 0;
cards.forEach((c, i) => {
  if (c.from !== prevEnd) fail(`卡${i} from=${c.from} 与上一卡末尾 ${prevEnd} 不闭合（缝隙/重叠）`);
  prevEnd = c.from + c.dur;
});
if (prevEnd !== m.TOTAL) fail(`末卡止于 ${prevEnd} ≠ TOTAL ${m.TOTAL}（尾段空转 ${m.TOTAL - prevEnd} 帧）`);
else console.log('卡片闭合 OK（0 起、无缝、到 TOTAL）');

console.log(warns ? `\n结论：⚠ ${warns} 处可读性/结构问题——先改剧本再渲染` : '\n结论：✅ 剧本体检全过，可进渲染');
process.exit(warns ? 2 : 0);
