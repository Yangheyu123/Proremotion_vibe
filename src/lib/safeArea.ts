/**
 * 画幅感知安全区：字幕与关键内容的落位约束，按发布平台的实际遮挡情况分画幅计算。
 *
 * ── 为什么需要集中管理（2026-10-12，PLAN §2.4）──────────────
 * 历史上安全区数字是散落且互相矛盾的：
 *   - src/showcase/chrome.tsx  `bottom: 490`（9:16 专用，为躲抖音底部文案/评论抽屉）
 *   - scripts/new_film.cjs     生成时对非 9:16 一律给 `bottom: '60'`
 *   - scripts/film_audit.cjs   遮罩写死 `ih*0.45`（假设底部 55% 被盖）
 * 后果：4:3 / 16:9 片子沿用了为竖屏设计的数字，而审计遮罩又按竖屏全屏铺满的模型去盖——
 * 两者都错，且不会报错。
 *
 * ── 各画幅的实际遮挡模型（用户 2026-10-12 拍板）────────────
 *   9:16  全屏铺满 → 底部文案区 + 评论抽屉确实压住画面底部，字幕必须抬高（490）
 *   4:3   上下有黑边、画面居中完整显示 → **字幕放底部是安全的**，无需抬高
 *   16:9  通常上下有黑边（抖音横屏）→ 底部安全，但右缘按钮列仍会压住
 *
 * ── 用法 ──────────────────────────────────────────────
 *   import {safeArea} from '../lib/safeArea';
 *   const sa = safeArea(W, H);
 *   // sa.subtitleBottom  字幕条距底部的像素
 *   // sa.maskBottomPct   审计遮罩应盖住的底部比例（0~1）
 *   // sa.maskRightPx     审计遮罩应盖住的右缘像素
 *   // sa.minFontPx       该画幅下的最小可读字号
 */

export type SafeArea = {
  /** 字幕条底部留白（px）——下缘不会落进平台 UI 遮挡区 */
  subtitleBottom: number;
  /** 审计遮罩：应模拟盖住的底部比例（0~1） */
  maskBottomPct: number;
  /** 审计遮罩：应模拟盖住的右缘像素 */
  maskRightPx: number;
  /** 该画幅下的最小可读字号（1080 高基准） */
  minFontPx: number;
  /** 说明，便于报告里打印"为什么是这个数" */
  note: string;
};

/**
 * 按画幅返回安全区参数。
 * @param w 画面宽（px）
 * @param h 画面高（px）
 */
export const safeArea = (w: number, h: number): SafeArea => {
  const ratio = w / h;

  // 竖屏全屏（9:16 附近）：底部被文案区/评论抽屉压住，字幕必须抬到 490
  if (ratio < 0.7) {
    return {
      subtitleBottom: 490,
      maskBottomPct: 0.55, // 底部 55% 会进 UI 区
      maskRightPx: 140, // 右缘按钮列
      minFontPx: 64,
      note: '竖屏全屏：底部与右缘都会被平台 UI 压住，字幕抬到 490',
    };
  }

  // 4:3（1440x1080）：上下有黑边、画面居中完整显示 → 底部安全
  if (ratio < 1.5) {
    return {
      subtitleBottom: Math.round(h * 0.055), // 1080 → 约 59px，只是呼吸留白
      maskBottomPct: 0.16, // 黑边模型下底部几乎不遮挡，只留一点余量
      maskRightPx: 140,
      minFontPx: 64,
      note: '4:3 上下黑边居中：底部安全，字幕只需呼吸留白；右缘按钮列仍会压住',
    };
  }

  // 16:9 横屏：同 4:3，底部安全
  return {
    subtitleBottom: Math.round(h * 0.055),
    maskBottomPct: 0.14,
    maskRightPx: 140,
    minFontPx: 64,
    note: '16:9 横屏：底部安全；右缘按钮列仍会压住',
  };
};
