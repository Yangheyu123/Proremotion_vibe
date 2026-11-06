import type {EffectsProp} from 'remotion';
import {glow} from '@remotion/effects/glow';
import {lightLeak} from '@remotion/effects/light-leak';
import {starburst} from '@remotion/effects/starburst';
import {tvSignalOff} from '@remotion/effects/tv-signal-off';
import {pixelDissolve} from '@remotion/effects/pixel-dissolve';
import {vignette} from '@remotion/effects/vignette';
import {scanlines} from '@remotion/effects/scanlines';
import {speckle} from '@remotion/effects/speckle';

/**
 * 效果配方库（2026-11-03 建）
 *
 * `@remotion/effects` 装了 85 个效果，但**主入口只导出 11 个**，其余全在子路径
 * （`import {lightLeak} from '@remotion/effects/light-leak'`）。
 * 这里挑出"挂上去就有画面感"的一小撮，按用途配成可直接用的 stack。
 * 挂在 Solid / Img / Video / HtmlInCanvas 的 `effects` prop 上，**数组顺序 = 叠加顺序**，参数随 useCurrentFrame 驱动即成动画。
 *
 * 参数名以各包 d.ts 为准（踩过：lightLeak 是 progress 不是 intensity，starburst 必填 rays+colors）。
 */

/** 光晕：给发光物一圈光（radius 像素 / intensity 倍率 / threshold 亮度阈值） */
export const fxGlow = (k = 1, color = '#B4FFDA'): EffectsProp => [
  glow({radius: 20, intensity: 0.8 * k, threshold: 0.25, color}),
];

/** 漏光：胶片漏光划过（转场前 6~10 帧最有效；progress 0→1 走完一轮） */
export const fxLeak = (k = 1, progress = 0.5): EffectsProp => [
  lightLeak({seed: 7, hueShift: 0, progress: 0.5 + 0.4 * (progress - 0.5) * k}),
];

/** 星芒：亮点炸出星芒（"顿悟/重锤"那一下；origin 是 0~1 归一坐标） */
export const fxStar = (k = 1, origin: readonly [number, number] = [0.5, 0.5], colors: readonly string[] = ['#FFE7BC', '#FFC46B']): EffectsProp => [
  starburst({rays: 12, colors, origin, rotation: 0, smoothness: 0.6}),
];

/** 关机：CRT 断电收成一条线（章节结束 / 系统崩了） */
export const fxPowerOff = (amount = 1): EffectsProp => [tvSignalOff({amount})];

/** 像素溶解：整块碎成像素（信号不良 / 数据化；progress 0→1） */
export const fxPixels = (progress = 0.5): EffectsProp => [pixelDissolve({progress, columns: 60, rows: 34, seed: 3, feather: 0.15})];

/** 胶片底子：暗角 + 扫描线 + 颗粒，一次挂上就有"介质"（去 PPT 感最便宜的一招） */
export const fxFilmBase = (k = 1): EffectsProp => [
  vignette({amount: 0.5 * k, radius: 0.65, feather: 0.35}),
  scanlines({amount: 0.18 * k, spacing: 4, thickness: 1, offset: 0}),
  speckle({density: 0.08 * k, size: 3, randomness: 0.8}),
];

export const FX_RECIPES = {
  glow: fxGlow,
  leak: fxLeak,
  star: fxStar,
  powerOff: fxPowerOff,
  pixels: fxPixels,
  filmBase: fxFilmBase,
} as const;
