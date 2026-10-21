/**
 * 字体身份集中定义。
 *
 * ── 集中化的理由（2026-10-12，PLAN §1.2）─────────────────
 * 四片 theme.ts 各自复制同一份字体字符串，且 `new_film.cjs` 生成第五份。
 * 任何字体调整都要改 N 处，漏一处就产生视觉不一致。现收敛到这里。
 *
 * ── 族名为什么写 "Noto Sans SC Black" ────────────────────
 * **实测澄清（重要，避免误解）**：
 * 本机 `C:\Windows\Fonts` 只有 `NotoSansSC-VF.ttf`（**变量字体**），
 * 它注册了 6 个族名（Noto Sans SC / Black / DemiLight / Light / Medium / Thin）。
 * 变量字体声明了 wght 轴，所以 `font-weight: 900` **本来就能正确解析到 900 字重**，
 * 并不是浏览器合成加粗。
 *
 * 用同一帧做过 A/B 渲染对比（frame 295-305，两种写法各渲一次）：
 *   → **像素 MD5 完全相同**（CF9CBF373830C17CA0DEF50A21968403）
 * 即：本机上两种写法视觉无差异。
 *
 * 那为什么仍写成 Black？——**跨机兜底**：
 *   1. 换到没装 Noto 的机器，原写法会静默 fallback 到 Microsoft YaHei（字形差异大），
 *      而 Black 族名同样会 fallback，但至少在多环境枚举时更容易被发现
 *   2. 若将来换成**静态字重**字体文件（.otf 按字重分文件），Black 族名是唯一正确写法
 * 这是**防御性**写法，不是修复了一个已发生的渲染错误。
 *
 * ── 真正的跨机确定性（未做，列为待办）──────────────────
 * 彻底方案是 `@font-face` + `staticFile` 引用仓库内字体文件，
 * 让渲染不依赖系统装没装字体。见 PLAN §1.2。
 */

/** 黑体（标题/字幕主力）。族名优先 900 实体，再退回基础族。 */
export const SANS =
  '"Noto Sans SC Black","Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif';

/** 常规字重的黑体（正文/次要信息）。 */
export const SANS_REGULAR =
  '"Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif';

/** 衬线（展示性大字）。 */
export const SERIF =
  '"Noto Serif SC Black","Noto Serif SC","Source Han Serif SC","SimSun",serif';

/** 等宽（代码/数字/终端质感）。 */
export const MONO = '"Cascadia Mono","Consolas","Courier New",monospace';

/**
 * 给需要 900 字重的元素用的样式片段。
 * 用法：`style={{...heavyStyle, fontSize: 64}}`
 */
export const heavyStyle = {fontWeight: 900 as const};
