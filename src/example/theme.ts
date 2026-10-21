import {Easing, interpolate, spring} from 'remotion';
import {SANS, MONO} from '../lib/typography';

/**
 * 「示例片」视觉提案（模板）
 * ⚠️ 这套配色只是示例。你的新片必须换身份（皮骨都换，对照 IDENTITIES.md 查重）。
 * 身份：深夜工作台——石墨蓝底 + 荧光青强调 + 琥珀点缀。
 * 配色：石墨蓝 #0C1220 / 纸白 #EAF2F5 / 荧光青 #3EE8C8 / 琥珀 #F5A623。
 * 字体：Noto Sans SC（黑体）+ 等宽（标注）。
 * 插画：程序化 SVG（示例里只放一根波形线和节点圆，展示 draw-on 思路）。
 * 动效：motion2 词汇层（drift/sway2/heroIn），Perlin 种子驱动，hero 每拍最多一个。
 */
export const C = {
  bg: '#0C1220',
  bg2: '#101828',
  panel: '#141D30',
  white: '#EAF2F5',
  cyan: '#3EE8C8',
  cyanDim: 'rgba(62,232,200,0.35)',
  amber: '#F5A623',
  dim: '#7C8DA6',
  line: 'rgba(62,232,200,0.25)',
  ink: '#05080F',
};

export {SANS, MONO};

export const E = Easing.bezier(0.16, 1, 0.3, 1);

/** 时间→值插值（区间倒置/重合保护） */
export const tw = (
  f: number,
  a: number,
  b: number,
  from: number,
  to: number,
  easing: (t: number) => number = E,
): number => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const b2 = hi > lo ? hi : lo + 1;
  return interpolate(f, [lo, b2], [a <= b ? from : to, a <= b ? to : from], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
};

export const pop = (f: number, delay = 0, damping = 12, stiffness = 130): number =>
  f < delay ? 0 : spring({frame: f - delay, fps: 30, config: {damping, stiffness, mass: 0.8}});

/** 确定性哈希（禁 Math.random） */
export const hash = (n: number, seed = 1): number => {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
