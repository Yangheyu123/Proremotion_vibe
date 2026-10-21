/*
 * §1.1 字幕密度重排：按阅读红线拉长卡时长 → 场景随之生长 → 边界吸附新 BGM 节拍
 * → 音效排期按三语义锚定迁移 → 回写 script.ts + sfx 排期。
 *
 * 用法：node scripts/reflow_density.cjs <showcase|harvest> [--apply]
 *   缺省 dry-run（只打印）；--apply 才写文件。
 *
 * 结构不变式（两片均已验证）：
 *   - 卡铺满时间轴（首尾闭合，无空隙）；场景与卡组完美嵌套（场景边界=卡组边界）
 *   - 场景组件的编舞是场景局部帧 → 场景变长 = 编舞后多一段永动层待机，视觉安全
 *
 * 音效迁移三语义（resolveCues 对绝对帧只校验不重锚——旧注释"随卡走"是错的）：
 *   S = 场景局部锚定（默认）：new = 新场景起点 + (旧帧 - 旧场景起点)。伴随场景编舞。
 *   T = 转场锚定：new = 新场景起点 + rel。骑在旧场景边界上的 riser/thud/boom/page/tick。
 *   C = 卡起点锚定：new = 新目标卡起点 + (旧帧 - 旧目标卡起点)。中场景换卡 page。
 *   E = 片尾锚定：new = 新片尾 - (旧片尾 - 旧帧)。结尾收束重音（场景变长时 S 会落中段）。
 *
 * 节拍吸附：右偏（新边界 ≥ 理想边界，取最近拍点）——场景只变长不变短，
 *   超出量加给场景末卡（只增阅读时间，绝不破坏密度红线）。
 */
const fs = require('fs');
const {execFileSync} = require('child_process');
const {load, cardChars, cardText, charStepFor} = require('./lib/script_loader.cjs');
const paths = require('./lib/paths.cjs');

const FPS = 30;
const BGM = paths.BGM_FLAC;
const BGM_DUR = 189.8; // ffprobe 实测

/* ---------- 每片的迁移配置 ---------- */
const CFG = {
  showcase: {
    script: 'src/showcase/script.ts',
    sfx: 'scripts/sfx_mix.cjs',
    sceneOrder: ['hook', 'chaos', 'water', 'sleep', 'muscle', 'notthem', 'dials', 'blocks', 'end'],
    bgmSS: 104, // 原 120s 起切撑不起新片长（bgm 全长 189.8s），向曲子前方借 16s，120-180 乐段完整保留
    fadeD: 4,
    chapters: [['壹', 'hook'], ['贰', 'chaos'], ['叁', 'water', 'sleep', 'muscle'], ['肆', 'notthem', 'dials', 'blocks', 'end']],
    darkScenes: [['chaos'], ['sleep'], ['end']],
    // 非 S（场景局部）锚定的 cue。T=[场景键, 相对边界偏移]；C=目标卡号；E=片尾。
    cueRules: {
      84: ['C', 1],
      131: ['T', ['chaos', -12]], 140: ['T', ['chaos', -3]], 143: ['T', ['chaos', 0]],
      146: ['T', ['chaos', 3]], 147: ['T', ['chaos', 4]], 152: ['T', ['chaos', 9]],
      227: ['C', 3], 316: ['C', 4],
      516: ['T', ['water', -12]], 528: ['T', ['water', 0]], 532: ['T', ['water', 4]],
      780: ['T', ['sleep', -12]], 792: ['T', ['sleep', 0]], 794: ['T', ['sleep', 2]], 796: ['T', ['sleep', 4]],
      1021: ['T', ['muscle', -12]], 1033: ['T', ['muscle', 0]], 1037: ['T', ['muscle', 4]],
      1285: ['T', ['notthem', -12]], 1297: ['T', ['notthem', 0]], 1301: ['T', ['notthem', 4]],
      1405: ['T', ['dials', -12]], 1412: ['T', ['dials', -5]], 1417: ['T', ['dials', 0]], 1421: ['T', ['dials', 4]],
      1549: ['T', ['blocks', -12]], 1561: ['T', ['blocks', 0]], 1565: ['T', ['blocks', 4]],
      1670: ['T', ['end', -12]], 1682: ['T', ['end', 0]], 1686: ['T', ['end', 4]],
      1742: ['E'], 1778: ['E'], 1790: ['E'],
    },
  },
  harvest: {
    script: 'src/harvest/script.ts',
    sfx: 'scripts/sfx_harvest.cjs',
    sceneOrder: ['hook', 'hype', 'strip', 'exchange', 'truth', 'cheap', 'end'],
    bgmSS: 0,
    fadeD: 3.5,
    chapters: null,
    darkScenes: null,
    cueRules: {
      143: ['T', ['hype', -12]], 155: ['T', ['hype', 0]], 159: ['T', ['hype', 4]],
      259: ['C', 2],
      288: ['T', ['strip', -12]], 300: ['T', ['strip', 0]], 310: ['T', ['strip', -14]], 328: ['C', 3],
      432: ['T', ['exchange', -12]], 444: ['T', ['exchange', 0]], 452: ['T', ['exchange', 4]],
      656: ['C', 6],
      744: ['T', ['truth', -12]], 756: ['T', ['truth', 0]], 760: ['T', ['truth', 4]],
      952: ['C', 9],
      1033: ['T', ['cheap', -12]], 1045: ['T', ['cheap', 0]], 1049: ['T', ['cheap', 4]],
      1164: ['C', 11],
      1273: ['T', ['end', -12]], 1285: ['T', ['end', 0]], 1289: ['T', ['end', 4]],
    },
  },
};

const key = process.argv[2];
const apply = process.argv.includes('--apply');
const cfg = CFG[key];
if (!cfg) {
  console.error('usage: node scripts/reflow_density.cjs <showcase|harvest> [--apply]');
  process.exit(1);
}

/* ---------- 1. 载入旧剧本 ---------- */
const m = load(cfg.script);
const oldCards = m.CARDS;
const oldScenes = m.SCENES;
const oldTotal = m.TOTAL;

/* ---------- 2. 目标卡时长（阅读红线 + 0.47s 余量），场景嵌套校验 ---------- */
const wants = oldCards.map((c) => {
  const n = cardChars(c);
  return Math.max(c.dur, Math.ceil((n / 4.5 + 0.8 + 0.47) * FPS));
});
const sceneOfCard = oldCards.map((c) => {
  const k = cfg.sceneOrder.find((k) => {
    const s = oldScenes[k];
    return c.from >= s[0] && c.from < s[0] + s[1];
  });
  if (!k) throw new Error(`卡 from=${c.from} 不属于任何场景——嵌套不变式被破坏`);
  return k;
});
for (const k of cfg.sceneOrder) {
  const sum = oldCards.filter((_, i) => sceneOfCard[i] === k).reduce((a, c) => a + c.dur, 0);
  if (sum !== oldScenes[k][1]) throw new Error(`场景 ${k} 卡和 ${sum} ≠ 场景时长 ${oldScenes[k][1]}——先修结构再重排`);
}

/* ---------- 3. 理想场景边界 → beat_detect 新切片 → 右偏吸附 ---------- */
const idealBounds = cfg.sceneOrder.map((k) =>
  wants.reduce((a, w, i) => (sceneOfCard[i] === k ? a + w : a), 0),
);
const idealTotal = idealBounds.reduce((a, b) => a + b, 0);
console.log(`理想总长 ${(idealTotal / FPS).toFixed(1)}s（旧 ${(oldTotal / FPS).toFixed(1)}s）`);

const needSec = idealTotal / FPS + (cfg.sceneOrder.length * 24) / FPS + 1;
let ss = cfg.bgmSS;
if (ss + needSec > BGM_DUR) {
  ss = Math.max(0, Math.floor(BGM_DUR - needSec));
  console.log(`⚠ bgm 全长 ${BGM_DUR}s 不够 ${cfg.bgmSS}s 起切，改 ss=${ss}`);
}
const len = Math.ceil(needSec) + 2;
console.log(`beat_detect: -ss ${ss} -t ${len}（需 ${needSec.toFixed(1)}s）`);
execFileSync(process.execPath, ['scripts/beat_detect.cjs', String(ss), String(len), BGM], {stdio: ['ignore', 'pipe', 'inherit']});
const beatsDoc = JSON.parse(fs.readFileSync('out/beats.json', 'utf8'));
const beats = beatsDoc.beats.map((b) => b.frame);
console.log(`BPM≈${beatsDoc.bpm.toFixed(1)}，拍点 ${beats.length} 个`);

const cumIdeal = [0];
idealBounds.forEach((d) => cumIdeal.push(cumIdeal[cumIdeal.length - 1] + d));
// 顺序吸附：每个内部边界取 ≥ max(理想值, 前一边界+前场理想时长) 的最近拍点——
// 逐场下界传递，保证任何场景都不会短于理想时长（独立右偏会让相邻边界互相吃掉）
const snapped = [0];
for (let i = 1; i < cumIdeal.length; i++) {
  const floorF = Math.max(cumIdeal[i], snapped[i - 1] + idealBounds[i - 1]);
  if (i === cumIdeal.length - 1) {
    snapped.push(floorF); // 片尾只保底不吸附
    break;
  }
  const cand = beats.find((x) => x >= floorF);
  if (cand == null || cand - floorF > 24) {
    console.log(`  ⚠ 边界 f${floorF} +24f 内无拍点，保留理想值`);
    snapped.push(floorF);
  } else {
    snapped.push(cand);
  }
}
const newSceneDurs = cfg.sceneOrder.map((_, i) => snapped[i + 1] - snapped[i]);
const newTotal = snapped[snapped.length - 1];

/* ---------- 4. 新卡表：理想时长 + 场景吸附余量加给末卡 ---------- */
const newDurs = [...wants];
cfg.sceneOrder.forEach((k, i) => {
  const idxs = oldCards.map((_, ii) => ii).filter((ii) => sceneOfCard[ii] === k);
  const idealSum = idxs.reduce((a, ii) => a + wants[ii], 0);
  const surplus = newSceneDurs[i] - idealSum;
  if (surplus > 0) newDurs[idxs[idxs.length - 1]] += surplus;
});
const newFroms = [0];
newDurs.forEach((d, i) => newFroms.push(newFroms[i] + d));
if (newFroms[newFroms.length - 1] !== newTotal) throw new Error('卡总和 ≠ 总长——吸收逻辑有误');

const newSceneFrom = {};
let acc = 0;
cfg.sceneOrder.forEach((k, i) => {
  newSceneFrom[k] = acc;
  acc += newSceneDurs[i];
});

/* ---------- 5. 音效迁移：旧帧 → 新帧 映射 ---------- */
const oldSceneFrom = {};
cfg.sceneOrder.forEach((k) => (oldSceneFrom[k] = oldScenes[k][0]));
const migrateCue = (old) => {
  const rule = cfg.cueRules[old];
  if (!rule) {
    const k = cfg.sceneOrder.find((k) => old >= oldScenes[k][0] && old < oldScenes[k][0] + oldScenes[k][1]);
    if (!k) throw new Error(`cue @${old} 不在任何场景`);
    return newSceneFrom[k] + (old - oldSceneFrom[k]);
  }
  if (rule[0] === 'T') return newSceneFrom[rule[1][0]] + rule[1][1];
  if (rule[0] === 'C') {
    const ci = rule[1];
    return newFroms[ci] + (old - oldCards[ci].from);
  }
  if (rule[0] === 'E') return newTotal - (oldTotal - old);
  throw new Error(`未知锚定类型 ${rule[0]}`);
};

// 从 sfx 文件的 CUES 块收集所有旧帧号（一行可能有多条 cue），逐一建立映射
const sfxSrc = fs.readFileSync(cfg.sfx, 'utf8');
const cuesBlock = sfxSrc.match(/const CUES = \[([\s\S]*?)\n\];/);
if (!cuesBlock) throw new Error(`${cfg.sfx} 里找不到 CUES 块`);
const oldFrames = [...cuesBlock[1].matchAll(/\[(\d+),\s*'/g)].map((x) => parseInt(x[1], 10));
const frameMap = new Map();
oldFrames.forEach((f) => frameMap.set(f, migrateCue(f)));
console.log(`\n音效 cue ${oldFrames.length} 条已迁移（S=${oldFrames.length - Object.keys(cfg.cueRules).length}，显式规则 ${Object.keys(cfg.cueRules).length}）`);

/* ---------- 6. 报告 ---------- */
console.log('\n卡时长变化（只列变化卡）:');
oldCards.forEach((c, i) => {
  if (newDurs[i] !== c.dur) console.log(`  c${i}: ${c.dur} → ${newDurs[i]}（+${newDurs[i] - c.dur}）`);
});
console.log('场景变化:');
cfg.sceneOrder.forEach((k, i) => {
  console.log(`  ${k}: [${oldScenes[k][0]},${oldScenes[k][1]}] → [${newSceneFrom[k]},${newSceneDurs[i]}]`);
});
console.log(`总长: ${oldTotal} → ${newTotal}（${(newTotal / FPS).toFixed(1)}s）`);
console.log(`混音切片: -ss ${ss} -t ${len}（原 ss=${cfg.bgmSS}）`);

if (!apply) {
  console.log('\n（dry-run，未写文件。确认后加 --apply）');
  process.exit(0);
}

/* ---------- 7. 写回 script.ts ---------- */
let src = fs.readFileSync(cfg.script, 'utf8');
src = src.replace(/export const TOTAL = [^;]+;/, `export const TOTAL = ${newTotal}; // §1.1 密度重排 ${(newTotal / FPS).toFixed(1)}s（2026-10-12，文案未动）`);
let cardIdx = 0;
// 只匹配卡条目头（后随 kicker/style）——CHAPTERS 的 {from, dur, zh} 同形，必须排除
src = src.replace(/\bfrom: \d+, dur: \d+, (?=kicker:|style:)/g, () => `from: ${newFroms[cardIdx]}, dur: ${newDurs[cardIdx++]}, `);
if (cardIdx !== oldCards.length) throw new Error(`CARDS 替换了 ${cardIdx} 处，应有 ${oldCards.length} 处`);
cfg.sceneOrder.forEach((k, i) => {
  src = src.replace(new RegExp(`(\\b${k}: \\[)\\d+, \\d+(\\])`), `$1${newSceneFrom[k]}, ${newSceneDurs[i]}$2`);
});
const beatsIn = beats.filter((b) => b < newTotal);
src = src.replace(/export const BEATS: number\[\] = \[[\s\S]*?\];/, `export const BEATS: number[] = [\n  ${beatsIn.join(', ')},\n];`);
if (cfg.chapters) {
  const ch = cfg.chapters.map(([zh, ...keys]) => {
    const from = newSceneFrom[keys[0]];
    const dur = keys.reduce((a, k) => a + newSceneDurs[cfg.sceneOrder.indexOf(k)], 0);
    return `  {from: ${from}, dur: ${dur}, zh: '${zh}'},`;
  }).join('\n');
  src = src.replace(/export const CHAPTERS:[\s\S]*?\];/, `export const CHAPTERS: {from: number; dur: number; zh: string}[] = [\n${ch}\n];`);
}
if (cfg.darkScenes) {
  const dk = cfg.darkScenes.map(([k]) => `  [${newSceneFrom[k]}, ${newSceneFrom[k] + newSceneDurs[cfg.sceneOrder.indexOf(k)]}],`).join('\n');
  src = src.replace(/export const DARK_SCENES:[\s\S]*?\];/, `export const DARK_SCENES: [number, number][] = [\n${dk}\n];`);
}
fs.writeFileSync(cfg.script, src);
console.log(`✅ 已写 ${cfg.script}（TOTAL/CARDS/SCENES/BEATS${cfg.chapters ? '/CHAPTERS/DARK_SCENES' : ''}）`);

/* ---------- 7b. 写回 sfx 文件：CUES 原位替换 + ss/t + 淡出 ---------- */
let sfx = fs.readFileSync(cfg.sfx, 'utf8');
// CUES 块内按旧帧号原位替换（[N, 锚点保证不误伤；同号多 cue 映射相同目标，安全）
sfx = sfx.replace(/const CUES = \[([\s\S]*?)\n\];/, (whole, body) => {
  let out = body;
  for (const [oldF, newF] of frameMap) {
    out = out.replace(new RegExp(`\\[${oldF},`, 'g'), `[${newF},`);
  }
  return 'const CUES = [' + out + '\n];';
});
// 淡出终点 = 新片长（用回调避免 RegExp.$1 陈旧值）
sfx = sfx.replace(/afade=t=out:st=([\d.]+):d=([\d.]+)/, (w, st, d) => `afade=t=out:st=${(newTotal / FPS - parseFloat(d)).toFixed(1)}:d=${d}`);
// 切片参数：showcase 现行 buildMix 没传 ss（成片从 bgm 0s 开始混，与 120s 网格半拍错位）——补上
if (!/\bss: \d+/.test(sfx)) {
  sfx = sfx.replace(/(bgm: 'D:\/aivideo\/assets\/bgm\.flac',)/, `$1\n  ss: ${ss}, t: ${len}, // §1.1 重排校准：原 120s 网格，bgm 全长 189.8s 借前 16s；此前漏传 ss 导致成片与节拍表错位`);
}
fs.writeFileSync(cfg.sfx, sfx);
console.log(`✅ 已写 ${cfg.sfx}（CUES×${frameMap.size} + 淡出${!/\bss: \d+/.test(sfx) ? '' : ' + ss/t'}）`);

/* ---------- 8. 自校验（重载真理源复核） ---------- */
const v = load(cfg.script);
const errs = [];
v.CARDS.forEach((c, i) => {
  const n = cardChars(c);
  if ((c.dur - 14) / FPS < n / 4.5 + 0.8) errs.push(`c${i} 密度仍偏快: ${(c.dur - 14) / FPS}s < ${n / 4.5 + 0.8}s`);
  const lines = cardText(c).split('\n').length;
  const reveal = 4 + 18 * (lines - 1) + (n - 1) * charStepFor(c.dur, n) + 3;
  if (c.dur - 16 - reveal < 8) errs.push(`c${i} 显出→淡出余量 ${Math.round(c.dur - 16 - reveal)}f < 8f`);
  if (i > 0 && c.from !== v.CARDS[i - 1].from + v.CARDS[i - 1].dur) errs.push(`c${i} 与前卡不闭合`);
});
if (v.CARDS[0].from !== 0) errs.push('首卡起点非 0');
if (v.CARDS[v.CARDS.length - 1].from + v.CARDS[v.CARDS.length - 1].dur !== v.TOTAL) errs.push('末卡不闭合到 TOTAL');
for (const k of cfg.sceneOrder) {
  const s = v.SCENES[k];
  const sum = v.CARDS.filter((c) => c.from >= s[0] && c.from < s[0] + s[1]).reduce((a, c) => a + c.dur, 0);
  if (sum !== s[1]) errs.push(`场景 ${k} 卡和 ${sum} ≠ ${s[1]}`);
}
if (!v.BEATS.every((b, i) => i === 0 || b > v.BEATS[i - 1])) errs.push('BEATS 非严格递增');
if (v.BEATS.some((b) => b >= v.TOTAL)) errs.push('BEATS 越界');
// 音效帧位抽查：全部 cue 必须落在新卡范围内（resolveCues 会硬校验，这里提前抓）
for (const [oldF, newF] of frameMap) {
  if (newF < 0 || newF >= v.TOTAL) errs.push(`cue ${oldF}→${newF} 越出片长`);
}
console.log(errs.length ? `\n🔴 自校验失败:\n  ${errs.join('\n  ')}` : '\n✅ 自校验全绿（密度/闭合/嵌套/显出余量/BEATS/cue 越界）');
process.exit(errs.length ? 3 : 0);
