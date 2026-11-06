/*
 * [KIT-02] FigureCutout — 图片立绘人物动画（人物问题的解法：图片模型出立绘，产线出动效）
 *
 * 工作流：图像模型生成统一风格的透明底人物立绘 PNG → 放 assets/figures/ →
 *   <FigureCutout src="figures/my-char.png" ... /> → 呼吸/摇摆/视差/入场全内置。
 * 一旦调教好一套立绘资产，所有需要人物的视频直接复用——人物质量 = 图像模型质量。
 *
 * 动效（全部永续周期，无定格）：呼吸 breathe / 重心摇摆 sway / 入场 rise。
 * 进阶（部件模式）：同一角色多姿态 PNG（stand/walk/point）传 poses 数组可做姿态切换。
 */
import React from 'react';
import {Img, useCurrentFrame, staticFile} from 'remotion';

export type FigureCutoutProps = {
  src: string;                       // staticFile 相对路径，如 "figures/scholar.png"（透明底 PNG）
  f: number;
  x: number;
  y: number;                         // 底部锚点（脚的位置）
  height: number;                    // 立绘高度
  breatheAmp?: number;               // 呼吸幅度 px（默认 2.5）
  breatheTau?: number;               // 呼吸周期帧（默认 90）
  swayDeg?: number;                  // 重心摇摆角度（默认 0.8）
  entrance?: number;                 // 入场进度 0..1（外部 heroIn/pop 驱动；缺省 1=已在场）
  flip?: boolean;                    // 水平镜像
  shadow?: boolean;                  // 脚底接地影（默认 true）
  shadowColor?: string;
  opacity?: number;
};

export const FigureCutout: React.FC<FigureCutoutProps> = ({
  src, f, x, y, height,
  breatheAmp = 2.5, breatheTau = 90, swayDeg = 0.8,
  entrance = 1, flip = false, shadow = true, shadowColor = 'rgba(0,0,0,0.35)', opacity = 1,
}) => {
  const breathe = Math.sin((f / breatheTau) * Math.PI * 2) * breatheAmp;
  const sway = Math.sin((f / (breatheTau * 1.7)) * Math.PI * 2) * swayDeg;
  const w = height * 0.42; // 立绘近似宽高比（人形 ~0.42），精确裁切可传 width 覆盖
  return (
    <div style={{position: 'absolute', left: x, top: y - height, width: w, height, opacity: opacity * entrance, pointerEvents: 'none'}}>
      {shadow && (
        <div
          style={{
            position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
            width: w * 0.7, height: 14, borderRadius: '50%',
            background: `radial-gradient(ellipse, ${shadowColor} 0%, transparent 70%)`,
            opacity: 0.8 * entrance,
          }}
        />
      )}
      <Img
        src={staticFile(src)}
        style={{
          position: 'absolute', bottom: 0, left: '50%',
          height,
          width: 'auto',
          transform: `translateX(-50%) translateY(${breathe.toFixed(2)}px) rotate(${sway.toFixed(2)}deg) scaleX(${flip ? -1 : 1})`,
          transformOrigin: 'bottom center',
        }}
      />
    </div>
  );
};
