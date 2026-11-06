/*
 * [KIT-03] DrawOn — 粉笔/铅笔/钢笔 糙线 draw-on 板书线（叙事线描）
 * 来源：funes/swallow draw-on + calc 粉笔双笔触。进度 p 驱动（0=未画，1=画完）。
 * 变体：rough 糙线（默认，双笔触抖动）/ smooth 光滑线 / underline 下划线。
 */
import React from 'react';

export type DrawOnProps = {
  p: number;                        // 显出进度 0..1（外部 f 驱动）
  x1: number; y1: number; x2: number; y2: number;
  w?: number;
  color?: string;
  op?: number;
  seed?: number;                    // 抖动种子（确定性）
  variant?: 'rough' | 'smooth';
};

export const DrawOn: React.FC<DrawOnProps> = ({p, x1, y1, x2, y2, w = 3.2, color = '#F2EFE4', op = 0.92, seed = 1, variant = 'rough'}) => {
  if (p <= 0) return null;
  const jitter = (i: number, amp: number) => {
    const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return (x - Math.floor(x) - 0.5) * amp;
  };
  const segs = Math.max(4, Math.round(7 * Math.min(1, Math.abs(x2 - x1) / 400 + 0.4)));
  const drawSegs = Math.max(2, Math.round(segs * p));
  let d = `M ${x1 + jitter(0, 3)} ${y1 + jitter(1, 3)}`;
  for (let i = 1; i <= drawSegs; i++) {
    const t = i / segs;
    d += ` L ${(x1 + (x2 - x1) * t + jitter(i * 2, 3)).toFixed(1)} ${(y1 + (y2 - y1) * t + jitter(i * 2 + 1, 3)).toFixed(1)}`;
  }
  const strokes =
    variant === 'rough'
      ? [
          <path key="a" d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" opacity={op} />,
          <path key="b" d={d} fill="none" stroke={color} strokeWidth={w * 0.45} strokeLinecap="round" opacity={op * 0.4} transform="translate(1.4 0)" />,
        ]
      : [<path key="a" d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" opacity={op} />];
  return <g opacity={1}>{strokes}</g>;
};

/** ChalkCircle — 红笔/粉笔糙圆（围绕内容的批改圈），p 驱动画出 */
export const ChalkCircle: React.FC<{p: number; cx: number; cy: number; r: number; color?: string; w?: number; squishY?: number}> = ({
  p, cx, cy, r, color = '#D96A5E', w = 3.4, squishY = 0.82,
}) => {
  if (p <= 0) return null;
  const segs = 26;
  const pts: string[] = [];
  for (let i = 0; i <= segs * p; i++) {
    const a = (i / segs) * Math.PI * 2 - 0.4;
    const j = Math.sin(i * 127.1 + 77) * 4;
    pts.push(`${(cx + Math.cos(a) * (r + j)).toFixed(1)},${(cy + Math.sin(a) * (r * squishY + j)).toFixed(1)}`);
  }
  if (pts.length < 2) return null;
  return <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" opacity={0.9} />;
};
