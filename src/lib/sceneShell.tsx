import React from 'react';
import {AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame} from 'remotion';

/**
 * 场景壳机制层：借帧转场 + 节拍脉动。三部片同构逻辑收敛于此。
 *
 * 硬规则（丝滑三定律，固化在实现里，杜绝伪切事故 d2≈80）：
 *   - Sequence 前移 frames/2 借帧，转场骑在场景边界上
 *   - 入场一律 Easing.linear（dissolve/fall）；wipe 的急推用 bezier(0.16,1,0.3,1)（历史行为）
 *   - beatPulse 喂全局帧，全片每拍微呼吸（≤0.7%）
 * 视觉身份（往哪擦、往哪坠、分割条长什么样）由 props 注入，留在各片。
 */

/** 影调缓动：与各片 theme.ts 的 E 一致（历史 wipe 急推用） */
const E_BEZIER = Easing.bezier(0.16, 1, 0.3, 1);

const lin = (f: number, a: number, b: number, from: number, to: number): number =>
  interpolate(f, [a, b], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.linear,
  });

const easeE = (f: number, a: number, b: number, from: number, to: number): number =>
  interpolate(f, [a, b], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: E_BEZIER,
  });

export type ShellKind = 'dissolve' | 'wipe' | 'fall' | 'rise';

export const SceneShellLib: React.FC<{
  from: number;
  dur: number;
  hold?: boolean;
  /** dissolve=线性交叉溶解 wipe=横向擦除+分割条 fall=竖直坠落 */
  kind: ShellKind;
  /** 转场帧数（偶数；Sequence 借 frames/2 帧） */
  frames: number;
  /** 节拍呼吸幅度（0.006~0.007） */
  pulseAmt?: number;
  beatPulse?: (f: number) => number;
  /** dissolve：入场缓推 {起始缩放, 帧数}（showcase 1.02/24） */
  settleZoom?: {from: number; frames: number};
  /** wipe：入场急推 {起始缩放, 帧数}（harvest 1.045/14） */
  punchZoom?: {from: number; frames: number};
  /** wipe：分割条颜色/辉光（视觉身份） */
  edgeColor?: string;
  edgeGlow?: string;
  edgeWidth?: number;
  /** fall：落地沉坠 px（trader 3） */
  landBump?: number;
  children: React.ReactNode;
}> = ({
  from,
  dur,
  hold,
  kind,
  frames,
  pulseAmt = 0.006,
  beatPulse,
  settleZoom,
  punchZoom,
  edgeColor,
  edgeGlow,
  edgeWidth = 14,
  landBump = 3,
  children,
}) => {
  const f = useCurrentFrame();
  const p = lin(f, 0, frames, 0, 1);
  const pulse = 1 + pulseAmt * (beatPulse ? beatPulse(f + from - 9) : 0);

  if (kind === 'dissolve') {
    // 入场 18f 线性升透明 + 出场 18f 线性降（两半骑在边界上）；入场缓推 1.02→1
    const o =
      lin(f, 0, frames, 0, 1) * (hold ? 1 : lin(f, dur, dur + frames, 1, 0));
    const s =
      (settleZoom ? lin(f, 0, settleZoom.frames, settleZoom.from, 1) : 1) * pulse;
    return <AbsoluteFill style={{opacity: o, transform: `scale(${s})`}}>{children}</AbsoluteFill>;
  }

  if (kind === 'wipe') {
    const zoom = punchZoom ? easeE(f, 0, punchZoom.frames, punchZoom.from, 1) : 1;
    const edge = (1 - p) * 100; // 百分比定位，宽度自适应
    return (
      <AbsoluteFill
        style={{
          clipPath: hold ? undefined : `inset(0 0 0 ${(1 - p) * 100}%)`,
          transform: `scale(${(hold ? 1 : zoom) * pulse})`,
        }}
      >
        {children}
        {!hold && p < 1 && (
          <div
            style={{
              position: 'absolute',
              left: `calc(${edge}% - ${edgeWidth - 2}px)`,
              top: 0,
              bottom: 0,
              width: edgeWidth,
              background: edgeColor,
              boxShadow: edgeGlow,
            }}
          />
        )}
      </AbsoluteFill>
    );
  }

  // fall / rise：新景自上方坠落（fall）或自下方升起（rise）盖下，落地瞬间沉坠 landBump px
  const drop = hold ? 0 : (1 - p) * (kind === 'fall' ? -100 : 100);
  /**
   * 落地回弹（2026-10-12 修正，PLAN §1.0f）。
   *
   * 旧实现是 `f === frames ? landBump : 0` —— 单帧硬跳：前一帧 0、当帧 +3px、
   * 下一帧又回 0，在一阶差分上制造去-回跳变，正是 smooth_check 要抓的二阶尖峰。
   * METHODOLOGY 第 4 条要求"重音用微震（≤3px **衰减**）"，而旧版只有"一震"没有"衰减"。
   *
   * 现改为**阻尼衰减脉冲**：落地后 6 帧内按余弦衰减回零。
   * 好处：① 连续、无尖峰 ② 保留"落地一沉"的触感 ③ 6 帧（0.2s）在感知上仍是瞬态。
   */
  const LAND_FRAMES = 6;
  const d = f - frames;
  const land =
    hold || d < 0 || d >= LAND_FRAMES
      ? 0
      : landBump * (1 - d / LAND_FRAMES) * Math.cos((d * Math.PI) / (2 * LAND_FRAMES));
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <AbsoluteFill
        style={{transform: `translateY(${drop}%) translateY(${land}px) scale(${pulse})`}}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
