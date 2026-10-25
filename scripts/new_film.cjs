/*
 * 新片脚手架：一条命令开工。
 * 用法：node scripts/new_film.cjs <key小写英文> <中文标题> [4x3|9x16|16x9]  （缺省 4x3，画幅规则见 METHODOLOGY 总纲 9）
 * 生成：src/<key>/（theme/script/chrome/Film，机制走 src/lib）+ Root.tsx 注册
 *      + output/<标题>/数据截图/ + ledger 台账登记
 * 开工前仍必须先写「视觉提案」（METHODOLOGY 第 0 章）——配色/字体/插画/动效/转场/版式骨架与历史片显著不同才开工（皮骨都换，chrome 禁止照搬上片结构只换色）。
 */
const fs = require('fs');
const path = require('path');
const paths = require('./lib/paths.cjs');

const [key, title, aspectArg] = process.argv.slice(2);
if (!key || !title || !/^[a-z][a-z0-9_]*$/.test(key)) {
  console.error('usage: node scripts/new_film.cjs <key小写英文> <中文标题> [4x3|9x16|16x9]');
  process.exit(1);
}
const dir = `src/${key}`;
if (fs.existsSync(dir)) {
  console.error(`⛔ ${dir} 已存在`);
  process.exit(1);
}
const CompId = key.charAt(0).toUpperCase() + key.slice(1);

const SIZES = {'4x3': [1440, 1080], '16x9': [1920, 1080], '9x16': [1080, 1920]};
const [W, H] = SIZES[aspectArg || '4x3'] || SIZES['4x3'];
const TOTAL_F = 60 * 30; // 脚手架默认 60s @30fps

fs.mkdirSync(dir, {recursive: true});

fs.writeFileSync(
  `${dir}/theme.ts`,
  `import {Easing, interpolate, spring} from 'remotion';

// 「${title}」视觉提案（先填满再动工，对照历史片查重：奶油炭黑朱砂 / 荧光黄沥青黑 / 冷黑蓝绿红 已用）：
//   配色三元组 / 字体气质 / 插画语言 / 动效语言 / 转场语法 / 版式骨架（字幕带形态+chrome 元素+卡片构图——禁止照搬上片结构只换色）
export const C = {
  bg: '#111111', // TODO 底色
  ink: '#eeeeee', // TODO 墨色
  accent: '#ff5577', // TODO 强调色
  gray: '#777777',
};

export const SANS = '"Noto Sans SC","Microsoft YaHei UI",sans-serif';
export const MONO = '"Cascadia Mono","Consolas","Courier New",monospace';

export const E = Easing.bezier(0.16, 1, 0.3, 1);

export const tw = (
  f: number,
  a: number,
  b: number,
  from: number,
  to: number,
  easing: (t: number) => number = E,
): number =>
  interpolate(f, [a, b], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });

export const pop = (
  f: number,
  delay = 0,
  damping = 13,
  stiffness = 150,
): number =>
  f < delay
    ? 0
    : spring({frame: f - delay, fps: 30, config: {damping, stiffness, mass: 0.75}});

// 确定性哈希（禁 Math.random）
export const hash = (n: number, seed = 1): number => {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
`,
);

fs.writeFileSync(
  `${dir}/script.ts`,
  `import {makeBeatPulse} from '../lib/pulse';

export const FPS = 30;
export const TOTAL = 60 * FPS; // TODO 片长（≥60s 叙事片用 4:3；快节奏 feed 片 16:9）
export const W = ${W};
export const H = ${H};

export type Seg = {t: string; kw?: boolean};
export type Card = {from: number; dur: number; lines: Seg[][]};

/** 字幕卡真理源。密度红线：单卡字数 ≤ 4.5 × 可见秒数（dwell_check.cjs 会拦） */
export const CARDS: Card[] = [
  {
    from: 0, dur: 120,
    lines: [[{t: '第一句文案，'}], [{t: '重点词', kw: true}, {t: '。'}]],
  },
  {
    from: 120, dur: 120,
    lines: [[{t: '第二句文案。'}]],
  },
  {
    from: 240, dur: ${TOTAL_F - 240},
    lines: [[{t: '结尾句 + 评论钩子。'}]],
  },
];

/** 场景区间 [from, dur]——边界吸附 BGM 拍点（snap_boundaries.cjs） */
export const SCENES = {
  intro: [0, ${Math.floor(TOTAL_F / 2)}],
  outro: [${Math.floor(TOTAL_F / 2)}, ${Math.ceil(TOTAL_F / 2)}],
} as const;

/** BGM 节拍帧表（beat_detect.cjs 生成后回填） */
export const BEATS: number[] = [];

export const beatPulse = makeBeatPulse(BEATS);
`,
);

fs.writeFileSync(
  `${dir}/chrome.tsx`,
  `import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {beatPulse, CARDS} from './script';
import {SceneShellLib} from '../lib/sceneShell';
import {flattenChars} from '../lib/subtitle';
import {C, MONO, SANS} from './theme';

/* 场景壳（转场语法按本片视觉提案换 kind：dissolve/wipe/fall + 分割条/急推参数） */
export const SceneShell: React.FC<{
  from: number;
  dur: number;
  hold?: boolean;
  children: React.ReactNode;
}> = ({from, dur, hold, children}) => (
  <Sequence from={from - 9} durationInFrames={dur + 18}>
    <SceneShellLib
      from={from}
      dur={dur}
      hold={hold}
      kind="dissolve"
      frames={18}
      pulseAmt={0.007}
      beatPulse={beatPulse}
    >
      {children}
    </SceneShellLib>
  </Sequence>
);

/* 字幕带：起步骨架（可用），按本片视觉提案重写形态——多种出场方式轮换，kw 同步高亮。
   定位底线（AGENTS 内容铁律 7）：底边距画面底 ≥10%（1080 高 = bottom ≥110）——
   排版呼吸 + 全面屏圆角/手势条安全；横版标题区在画框外，无遮挡问题，但禁贴边。 */
export const SubBand: React.FC = () => {
  const f = useCurrentFrame();
  const card = CARDS.find((c) => f >= c.from && f < c.from + c.dur) ?? CARDS[0];
  const lf = f - card.from;
  const chars = flattenChars(card.lines);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: ${H === 1920 ? '490' : '110'},
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        {chars.map((ch, gi) => (
          <span
            key={gi}
            style={{
              fontFamily: SANS,
              fontWeight: 900,
              fontSize: 58,
              color: ch.kw ? C.accent : C.ink,
              opacity: Math.min(1, Math.max(0, (lf - 3 - gi * 2.3) / 8)),
            }}
          >
            {ch.c}
          </span>
        ))}
      </div>
      <div style={{position: 'absolute', top: 40, left: 60, fontFamily: MONO, fontSize: 22, color: C.gray}}>
        {String(Math.floor(f / 30)).padStart(3, '0')}s
      </div>
    </AbsoluteFill>
  );
};
`,
);

fs.writeFileSync(
  `${dir}/Film.tsx`,
  `import React from 'react';
import {AbsoluteFill} from 'remotion';
import {SCENES} from './script';
import {SceneShell, SubBand} from './chrome';
import {C} from './theme';

export const ${CompId}Film: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    {Object.entries(SCENES).map(([name, [from, dur]], i, arr) => (
      <SceneShell key={name} from={from} dur={dur} hold={i === arr.length - 1}>
        {/* TODO 场景插画：每场一个组件（参考 src/trader/scenesA.tsx 模式），
            全部 SVG/程序化绘制；入场后接永动层（相位错开微动），杜绝静帧 */}
        <AbsoluteFill />
      </SceneShell>
    ))}
    <SubBand />
  </AbsoluteFill>
);
`,
);

/* Root.tsx 注册（幂等）
 * ⚠️ 2026-10-12 加固：旧逻辑只在"文件里没有 ./<key>/Film"时插入，但插入锚点
 * 是固定字符串。若 Root.tsx 被手工改过、或同名 comp 已存在，会插出重复 Composition
 * （React 里重复 id 会渲染冲突，tsc 也会因未定义符号报错）。
 * 现在三重防护：① 已存在则跳过 ② 插入后回读校验 ③ 校验失败则还原。 */
const ROOT = 'src/Root.tsx';
let root = fs.readFileSync(ROOT, 'utf8');
const rootBefore = root;
if (!root.includes(`./${key}/Film`)) {
  const IMP_ANCHOR = "import {Showcase} from './showcase/Showcase';";
  /* 2026-10-25：Root.tsx 可能是 CRLF（finite 开工实测锚点失配），按实际换行符构造 */
  const NL = root.includes('\r\n') ? '\r\n' : '\n';
  const JSN_ANCHOR = `  </>${NL});`;
  if (!root.includes(IMP_ANCHOR) || !root.includes(JSN_ANCHOR)) {
    console.error(`\n⛔ Root.tsx 的插入锚点找不到（import 或 JSX 结尾被改过）。`);
    console.error('   请手工在 src/Root.tsx 里加一行 import + 一个 <Composition>，然后重跑。');
    process.exit(1);
  }
  root = root.replace(
    IMP_ANCHOR,
    `${IMP_ANCHOR}\nimport {${CompId}Film} from './${key}/Film';\nimport {FPS as FPS_${key.toUpperCase()}, TOTAL as TOTAL_${key.toUpperCase()}} from './${key}/script';`,
  );
  root = root.replace(
    JSN_ANCHOR,
    `    <Composition\n      id="${CompId}"\n      component={${CompId}Film}\n      durationInFrames={TOTAL_${key.toUpperCase()}}\n      fps={FPS_${key.toUpperCase()}}\n      width={${W}}\n      height={${H}}\n    />\n${JSN_ANCHOR}`,
  );

  // 回读校验：id 必须恰好出现 1 次
  const idCount = (root.match(new RegExp(`id="${CompId}"`, 'g')) || []).length;
  const importCount = (root.match(new RegExp(`\\./${key}/Film`, 'g')) || []).length;
  if (idCount !== 1 || importCount !== 1) {
    fs.writeFileSync(ROOT, rootBefore); // 还原
    console.error(`\n⛔ Root.tsx 注册校验失败（id 出现 ${idCount} 次、import ${importCount} 次，应各为 1）。`);
    console.error('   已还原原文件，未做改动。请检查 Root.tsx 后重跑。');
    process.exit(1);
  }
  fs.writeFileSync(ROOT, root);
  console.log(`✅ Root.tsx 已注册 Composition "${CompId}"（${W}x${H}）`);
} else {
  console.log(`（Root.tsx 已有 ./${key}/Film，跳过注册）`);
}

/* 产出文件夹 + 数据截图 */
const outDir = `${paths.OUTPUT_HOME}/${title}`;
fs.mkdirSync(`${outDir}/数据截图`, {recursive: true});

/* ---------- films.json 注册（2026-10-12 新增，修复 PLAN §1.3）----------
 * 旧版只写 Root.tsx、不登记 make.cjs 的片目注册表 —— 导致新片渲染入口有了、
 * 但 make.cjs 报"未知片名"，最后一步必卡住，且报错信息指向错误方向。
 * 现在两个脚本共读写同一份 films.json。 */
const FILMS_PATH = 'films.json';
let filmsRegistered = false;
try {
  const doc = fs.existsSync(FILMS_PATH)
    ? JSON.parse(fs.readFileSync(FILMS_PATH, 'utf8'))
    : {_note: '片目注册表', films: {}};
  const films = doc.films || doc;
  if (films[key]) {
    console.log(`（films.json 已存在 "${key}"，跳过注册）`);
  } else {
    films[key] = {
      title,
      script: `src/${key}/script.ts`,
      aspect: aspectArg || '4x3',
      variants: {
        [aspectArg || '4x3']: {
          comp: CompId,
          raw: `out/${key}-raw.mp4`,
          sfx: `scripts/sfx_${key}.cjs`,
          sfxArgs: [],
          deliver: `${outDir}/${title}_${aspectArg || '4x3'}.mp4`,
        },
      },
    };
    fs.writeFileSync(FILMS_PATH, JSON.stringify(doc, null, 2));
    filmsRegistered = true;
    console.log(`✅ films.json 已登记 "${key}"（变体 ${aspectArg || '4x3'}，comp ${CompId}）`);
  }
} catch (e) {
  console.error(`\n⛔ films.json 注册失败：${e.message}`);
  console.error('   不修的话出片时 make.cjs 会报"未知片名"。');
  process.exit(1);
}

/* ledger 登记 */
const LEDGER = paths.ANALYTICS_HOME + '/ledger.json';
try {
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  if (!ledger.films.some((f) => f.id === key)) {
    ledger.films.push({
      id: key,
      title,
      file: `${outDir}/（make.cjs 产出后回填）`,
      aspect: aspectArg || '4x3',
      compliance: 'PENDING（compliance_check.cjs 过审后更新）',
      published_at: null,
      records: [],
    });
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  }
} catch (e) {
  console.log('（ledger 登记跳过：', e.message, '）');
}

/* 身份台账登记：新片自动追加 TODO 行，收工填满（查重对照表，禁全量翻旧片源码） */
const IDENTITY = 'IDENTITIES.md';
try {
  const idPath = path.resolve(__dirname, '..', IDENTITY);
  fs.appendFileSync(
    idPath,
    `\n| ${key} | ${title} | TODO 底·墨·强调 | TODO 字体 | TODO 插画 | TODO 转场 | TODO 字幕带/chrome 形态 |\n`,
  );
} catch (e) {
  console.log('（身份台账登记跳过：', e.message, '）');
}


console.log(`
✅ 脚手架就绪：${dir}/（comp id: ${CompId}，${W}x${H}）
   产出目录：${outDir}/（含 数据截图/）
   片目登记：films.json${filmsRegistered ? '（已写入）' : '（已存在，沿用）'}

动工检查单（按顺序）：
  1. 视觉提案：theme.ts 顶部 TODO 填满，对照 IDENTITIES.md 身份台账查重（皮骨都查，只对表不翻旧片源码，撞车才开对应片）
     （皮骨都换：chrome 组件禁止照搬上片结构只换色——字幕带位置/形态/出场方式至少两项实质不同；收工填满台账本片行）
  2. 剧本：script.ts CARDS 写满 → node scripts/dwell_check.cjs ${dir}/script.ts 过密度红线
  3. 合规：node scripts/compliance_check.cjs ${dir}/script.ts 一审（RED=改写）
  4. BGM：node scripts/bgm_add.cjs <新歌> → node tools/bake_pulse_env.cjs 烘焙 PULSE_ENV（渲染时 audioPulse 直读包络，无硬编码节拍链）
  5. 场景：每场一个组件，SVG 程序化绘制。**编码时每场必须自备**（不是检查后补）：
     ① 入场编排（错峰弹入）② ≥1 个持续微动（永动层，motion2 词汇层取式，每拍至多一个 hero）
     ③ ≥1 个视觉锚点（大数字 / 辉光 / 闪烁星 / 堆叠层次 之一）④ 与字幕带零重叠。四项缺一 = 写完不合格
  6. 出片：先 node scripts/make.cjs ${key} --dry-run 看清单，再正式跑（新片建议加 --strict）
  7. 音效：参考现有 scripts/sfx_<片>.cjs 写排期（机制在 scripts/lib/sfx_lib.cjs）
`);
