/*
 * 剧本装载器：把 src/<片>/script.ts 转译并在沙盒里求值，取回导出
 * （CARDS / SCENES / TOTAL / FPS / BEATS …）。
 * 用途：dwell_check / compliance_check / sfx 排期锚定——
 * 工具链直接消费唯一真理源，剧本数据零拷贝，改剧本工具自动跟进。
 * 用法：const {CARDS, SCENES, TOTAL, FPS} = require('./lib/script_loader').load('src/trader/script.ts');
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const load = (relFile) => {
  const file = path.resolve(__dirname, '..', '..', relFile);
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = {exports: {}};
  // react/remotion → 空对象；项目内相对导入（如 ../lib/pulse）→ noop 链代理——
  // 工具链只消费 CARDS/SCENES/TOTAL/FPS 等数据，不需要真实的运行时行为
  const noopChain = new Proxy(function () {}, {
    get: () => noopChain,
    apply: () => noopChain,
  });
  const req = (name) => {
    if (name === 'react' || name === 'remotion') return {};
    if (name.startsWith('.')) return noopChain;
    throw new Error(`script_loader: 剧本文件不应依赖外部模块: ${name}`);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', '__filename', '__dirname', js)(
    req,
    mod,
    mod.exports,
    file,
    path.dirname(file),
  );
  return mod.exports;
};

/** 卡片纯文本（去空白前）。兼容 lines: Seg[][] 形态与 {t} 形态。 */
const cardText = (card) => {
  if (card.lines) return card.lines.map((l) => l.map((s) => s.t).join('')).join('\n');
  return card.t || '';
};

/** 卡片总字数（去空白） */
const cardChars = (card) => cardText(card).replace(/\s/g, '').length;

/**
 * 显出节奏公式（PLAN §1.4：验收工具链的唯一显出公式）。
 * 直接从 src/lib/subtitle.ts 装载——渲染端用什么，验收端就用什么，两套公式并存必漂移。
 * subtitle.ts 是零依赖纯函数，沙盒求值安全；装载失败必须炸出来，
 * 宁可工具不可用也不能静默回退到旧的 2.2 常量（那正是分叉的起点）。
 */
let _charStepFor = null;
const charStepFor = (dur, totalChars) => {
  if (!_charStepFor) {
    const m = load('src/lib/subtitle.ts');
    if (typeof m.charStepFor !== 'function') {
      throw new Error('script_loader: src/lib/subtitle.ts 未导出 charStepFor——显出公式真理源被移走了？');
    }
    _charStepFor = m.charStepFor;
  }
  return _charStepFor(dur, totalChars);
};

module.exports = {load, cardText, cardChars, charStepFor};
