import {Easing, interpolate, spring} from 'remotion';

/**
 * 机制层动效基元（PLAN §3.6：从四片 theme.ts 抽出，此前同一份代码抄了四遍）。
 * 视觉身份（配色 C / 字体 / 专属元件）留在各片 theme，只 re-export 这里的机制。
 *
 * ⚠️ 改这里之前：node scripts/baseline.cjs verify —— 四片关键帧基线锁着
 * 这几个函数的渲染输出，任何数值漂移都会被 MD5 抓住。
 */

/** 主缓动：快出长尾 */
export const E = Easing.bezier(0.16, 1, 0.3, 1);
/** 收拢/退场缓动 */
export const EI = Easing.in(Easing.cubic);
/** 立方缓出 */
export const EOUT = Easing.out(Easing.cubic);

/** 区间插值，两端 clamp */
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

/**
 * spring 弹入，支持延迟。
 * fps 写死 30：全产线统一 30fps（script.ts 的 FPS 真理源也是 30）；
 * 若将来改 60fps，这里与 sfx_lib/beat_detect 一并改（见 PLAN §3.3 的 9 处清单）。
 */
export const pop = (
  f: number,
  delay = 0,
  damping = 13,
  stiffness = 150,
): number =>
  f < delay
    ? 0
    : spring({frame: f - delay, fps: 30, config: {damping, stiffness, mass: 0.75}});

/** 确定性伪随机（禁 Math.random，任意帧可复现） */
export const hash = (n: number, seed = 1): number => {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const TAU = Math.PI * 2;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
