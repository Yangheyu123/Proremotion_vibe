/*
 * 抖音合规自检（一审：关键词扫描）。二审=成片全貌的模型判断；三审=全网检索当期审核规则。
 * 用法：node scripts/compliance_check.cjs src/trader/script.ts [src/harvest/script.ts ...]
 * 判级：命中任一 RED = 高危（建议改写/不发）；RED=0 且 YELLOW≥4 = 中风险（可发，限流概率中）；否则绿灯。
 * v2（2026-10-11 产线优化）：
 *   - 扫描范围升级：不再只扫台词——整份源码剥注释后全扫（场景大字/画面文字/标题常量都算数）
 *   - 台词经 script_loader 从 TS 真理源装载（收益数字模式只扫台词，避免代码数字误报）
 *   - 自动引用 analytics/rules/ 最新规则快照日期——快照过期 = 三审（全网检索）该做了
 * 背景：本账号已两次因「虚拟币边缘 + 引诱风险投资」被限流——此检查优先于一切观感优化。
 * 词表维护：每次限流/过审，把新情报追加进 RULES 并在规则快照里记一笔（限流反哺词表）。
 */
const fs = require('fs');
const path = require('path');
const {load, cardText} = require('./lib/script_loader.cjs');
const paths = require('./lib/paths.cjs');

const RULES = [
  {level: 'RED', cat: '虚拟币/交易黑话', words: [
    '币圈', '加密货币', '比特币', '以太坊', '特朗普币', 'meme币', 'MEME', 'Web3', 'web3',
    '杠杆', '爆仓', '平仓', '炒币', '交易所', '合约', '空投', '代币', '虚拟货币', '数字货币',
    '梭哈', '上头', 'K线', '上车', '下车', '仓位', '开单', '盯盘', '行情', '交易员',
  ]},
  {level: 'RED', cat: '赌博暗示', words: ['下注', '翻本', '赔率', '牌桌', '赌桌', '押上', '赌']},
  {level: 'RED', cat: '敏感人物/平台', words: ['孙宇晨', '币安', 'OKX', '马斯克']},
  {level: 'YELLOW', cat: '财经收益（无资质限流）', words: [
    '赚钱', '赚到', '收益', '理财', '基金', '股票', '财富自由', '变现', '收割',
    '本金', '充值', '投资', '存款', '利息', '盈利', '翻倍', '暴富', '涨停', '荐股', '牛股',
  ]},
  {level: 'YELLOW', cat: '诱导互动', words: ['点赞关注', '关注我', '私信', '领取', '评论区扣']},
];

// 收益数字模式（诱导投资高危）——只扫台词文本，不扫代码；桥接字符集排除标点/换行防误连
const MONEY_RE = /赚了?[^0-9。，,、.\n]{0,6}\d+|[+＋]\s*\d{3,}|盈利\s*\d+|赚到\s*\d+/g;

const RULES_DIR = paths.ANALYTICS_HOME + '/rules';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/compliance_check.cjs <script.ts> [...]');
  process.exit(1);
}

/* 规则快照：最新一份的日期 + 龄期（PLAN §3.10：快照过期 = 合规知识过期）
 * 分级：>14 天警告横幅（三审该做了）；>30 天 exit 4 硬拦（词表可能整体过时，
 * 此时一审的"绿灯"不可信）；无快照或文件名无日期 → 只警告（保守不拦，避免误伤）。 */
const DAY = 24 * 3600 * 1000;
let snapName = null;
let snapAge = null;
try {
  const snaps = fs.readdirSync(RULES_DIR).filter((f) => f.endsWith('.md')).sort().reverse();
  if (snaps.length) {
    snapName = snaps[0];
    const d = snaps[0].match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (d) snapAge = Math.floor((Date.now() - new Date(+d[1], +d[2] - 1, +d[3]).getTime()) / DAY);
  }
} catch {}

let globalBad = 0;
let stale = false; // 快照超 30 天 → 全部文件扫完后统一 exit 4

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`\n⛔ 找不到剧本文件：${file}`);
    console.error('   合规是第 0 道闸门——文件都不在，谈不上扫描。检查路径拼写。');
    process.exit(2);
  }
  const raw = fs.readFileSync(file, 'utf8');
  // 剥注释后整份扫描（场景大字/画面文字/标题常量都算数）
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  let m;
  try {
    m = load(file);
  } catch (e) {
    // ⚠️ 2026-10-12：旧版这里 `catch { m = {} }` 静默降级——剧本装载失败后
    // CARDS 为空、台词不参与扫描，只剩源码文本过一遍，可能给出错误的"绿灯"。
    // 合规是 make.cjs 的第 0 道闸门、唯一的一票否决项，绝不能带着未知状态通过。
    console.error(`\n⛔ 剧本装载失败，无法做合规扫描：${file}`);
    console.error(`   ${e.message}`);
    console.error('   合规检查依赖 CARDS 台词文本——装载失败 = 扫描不全 = 结果不可信。');
    process.exit(2);
  }
  const lines = (m.CARDS || []).map(cardText);
  const spoken = lines.join('\n');

  console.log(`\n======== ${file} ========`);
  console.log(`台词 ${(m.CARDS || []).length} 条 / ${spoken.replace(/\s/g, '').length} 字（整份源码 ${stripped.replace(/\s/g, '').length} 字符入扫）`);

  let red = 0;
  let yellow = 0;
  const found = [];

  for (const rule of RULES) {
    for (const w of rule.words) {
      const n = stripped.split(w).length - 1;
      if (n > 0) {
        found.push(`${rule.level === 'RED' ? '🔴' : '🟡'} [${rule.cat}] "${w}" ×${n}`);
        if (rule.level === 'RED') red += n;
        else yellow += n;
      }
    }
  }

  // 收益数字（台词层）
  const moneyHits = [...spoken.matchAll(MONEY_RE)].map((x) => x[0]);
  if (moneyHits.length) {
    found.push(`🔴 [收益数字] ${moneyHits.join('、')}（诱导投资高危）`);
    red += moneyHits.length;
  }

  if (found.length) console.log(found.join('\n'));
  else console.log('（无命中）');

  let verdict;
  if (red > 0) {
    verdict = `🔴 高危（RED×${red}）——不发抖音，改写后重审（改写方向见 METHODOLOGY 第 8 章）`;
    globalBad++;
  } else if (yellow >= 4) {
    verdict = `🟡 中风险（YELLOW×${yellow}）——可发，限流概率中；建议软化收益表述`;
  } else {
    verdict = '🟢 绿灯';
  }
  console.log(`判定：${verdict}`);
  if (snapAge == null) {
    console.log(`规则快照：${snapName ? `${snapName}（文件名无日期，无法判龄）` : '（无规则快照！先做三审全网检索，并建 analytics/rules/<日期>_规则快照.md）'}`);
    console.log('⚠ 请尽快补三审并落一份快照——没有当期规则，一审词表就是闭眼扫描。');
  } else if (snapAge > 30) {
    console.log(`⛔ 规则快照已 ${snapAge} 天（${snapName}）——词表可能整体过时，一审结果不可信。`);
    stale = true;
  } else if (snapAge > 14) {
    console.log(`⚠ 规则快照已 ${snapAge} 天（${snapName}）——三审（全网检索当期规则）该做了，快照 14 天一换。`);
  } else {
    console.log(`规则快照：${snapName}（${snapAge} 天前）`);
  }
  console.log('二审三审提醒：词表测不出话题立场/画面语义/当期风向——发布前模型重看成片联络表 + 全网检索当期规则。');
}

if (globalBad) process.exit(3);
if (stale) {
  console.error('\n⛔ 规则快照超 30 天——合规知识过期，闸门不放行。全网检索当期规则 → 更新词表 → 落新快照（analytics/rules/）后重跑。');
  console.error('   确实在快照过期状态下出片：make.cjs 加 --allow-stale-rules（会记入报告 forced）。');
  process.exit(4);
}
