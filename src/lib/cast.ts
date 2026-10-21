/**
 * 转场元素接力（cast）：让上一场的东西"飞进"下一场，把叙事串起来。
 *
 * ── 要解决的问题（用户 METHOD.md 待改进①）─────────────────
 * 当前转场只有"壳的运动"（溶解/擦除/坠落/升起），**场景内容之间零连续性**：
 * 上场的沙漏消失，下场的跑道上凭空出现小人。观众感到的是"一页页翻 PPT"，
 * 而不是"一件事在展开"。
 *
 * 用户原话：
 *   "可做跨场景元素继承（如沙漏的沙落入下一场景变成跑道上的小人、
 *     螺旋漩涡在转场时吸入整屏）增强连贯叙事。"
 *
 * ── 机制设计（最小侵入）───────────────────────────────────
 * 不侵入现有 4 片（它们已交付、已验收）。本模块提供**可选**的接力描述：
 *
 *   const CARRY = defineCarry([
 *     {id: 'coin', fromScene: 'web3', toScene: 'liquid', path: 'fly-in'},
 *   ]);
 *
 * 用法要点：
 *   1. **声明式**：只描述"哪个元素从哪一场到哪一场"，不写坐标动画
 *   2. **路径内置**：常用轨迹（fly-in / sink / absorb / drift）内置缓动
 *   3. **可测**：continuity_check.cjs 读同一份描述，统计全片硬切率
 *
 * ── 为什么不在 SceneShellLib 里直接改 ─────────────────────
 * 那会让 4 片已验收的转场行为全部变化（回归风险）。
 * 正确路径是：新片用它、老片按需迁移，且每次迁移都能用 smooth_check
 * + 基线帧比对验证没有破坏既有观感。
 */

import {Easing, interpolate} from 'remotion';

/** 内置接力轨迹 */
export type CarryPath =
  /** 从上一场退场位置飞入下一场（默认） */
  | 'fly-in'
  /** 垂直下沉，落入下一场底部（如沙漏的沙） */
  | 'sink'
  /** 缩放吸收，被下一场某个点吸走（如漩涡吸入） */
  | 'absorb'
  /** 缓慢漂移，位置感连续（如云/光点） */
  | 'drift';

export type CarryItem = {
  /** 唯一 id，用于调试与 continuity_check 配对 */
  id: string;
  /** 上一场的场景 key（SCENES 的 key） */
  fromScene: string;
  /** 下一场的场景 key */
  toScene: string;
  /** 轨迹类型 */
  path: CarryPath;
  /**
   * 接力窗口：覆盖"上一场末尾 + 下一场开头"的帧数（相对转场边界）。
   * 默认 30 帧（1 秒）：边界前 15 帧退场、边界后 15 帧入场。
   */
  span?: number;
};

/** 声明式定义（保留 id 唯一性校验） */
export const defineCarry = (items: CarryItem[]): CarryItem[] => {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) {
      throw new Error(`defineCarry: id "${it.id}" 重复——接力元素必须唯一标识`);
    }
    seen.add(it.id);
  }
  return items;
};

/** 轨迹的位移与透明度曲线（相对接力的 0~1 进度） */
export const carryTransform = (
  path: CarryPath,
  p: number,
): {translateX: number; translateY: number; scale: number; opacity: number} => {
  // p: 0 = 接力窗口开始（上一场还在），1 = 窗口结束（下一场已稳定）
  // 线性缓动是"丝滑三定律"的要求（转场不得用非线性缓动）
  const t = interpolate(p, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.linear,
  });

  switch (path) {
    case 'sink':
      // 下沉：从上方落入，越往下越透明（像沙落入下一场）
      return {
        translateX: 0,
        translateY: interpolate(t, [0, 1], [-40, 60]),
        scale: interpolate(t, [0, 1], [1, 0.7]),
        opacity: interpolate(t, [0, 0.7, 1], [0, 1, 0]),
      };
    case 'absorb':
      // 吸收：向中心收缩并消失
      return {
        translateX: 0,
        translateY: 0,
        scale: interpolate(t, [0, 1], [1, 0.05]),
        opacity: interpolate(t, [0, 0.6, 1], [0, 1, 0]),
      };
    case 'drift':
      // 漂移：几乎不位移，只做透明度交接
      return {
        translateX: interpolate(t, [0, 1], [-30, 30]),
        translateY: 0,
        scale: 1,
        opacity: interpolate(t, [0, 0.4, 0.6, 1], [0, 1, 1, 0]),
      };
    case 'fly-in':
    default:
      // 飞入：从左侧外飞入并稳定
      return {
        translateX: interpolate(t, [0, 1], [-120, 0]),
        translateY: interpolate(t, [0, 1], [20, 0]),
        scale: interpolate(t, [0, 0.6, 1], [0.6, 1.08, 1]),
        opacity: interpolate(t, [0, 0.35, 1], [0, 1, 1]),
      };
  }
};

/**
 * 计算某个接力元素在当前帧的接力进度。
 * @param item 接力描述
 * @param boundaryFrame 转场边界帧（一般 = toScene 的 from）
 * @param f 当前帧
 * @returns p ∈ [0,1]；不在窗口内返回 null（调用方不渲染该元素）
 */
export const carryProgress = (
  item: CarryItem,
  boundaryFrame: number,
  f: number,
): number | null => {
  const span = item.span ?? 30;
  const start = boundaryFrame - span / 2;
  const end = boundaryFrame + span / 2;
  if (f < start || f > end) return null;
  return (f - start) / span;
};
