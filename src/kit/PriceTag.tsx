/*
 * [KIT-04] PriceTag — 价签/标签牌 拍上冲击（钩子/重音 hero）
 * 来源：calc 价签拍打（钩子段锚点）。heroIn 外部驱动，标签内文字可配。
 */
import React from 'react';

export type PriceTagProps = {
  p: number;                        // 拍上进度 0..1（heroIn/pop 驱动）
  x: number; y: number;
  title: string;                    // 顶部小字（如 PRICE / 性价比）
  value: string;                    // 主值（如 ¥ ？）
  w?: number; h?: number;
  border?: string;                  // 边框/主色
  bg?: string;                      // 底色
  titleColor?: string;
  valueColor?: string;
  rot?: number;                     // 落定角度（默认 6°）
};

export const PriceTag: React.FC<PriceTagProps> = ({
  p, x, y, title, value, w = 250, h = 130,
  border = '#D96A5E', bg = 'rgba(242,239,228,0.06)', titleColor = 'rgba(128,128,128,0.9)', valueColor = '#D96A5E', rot = 6,
}) => {
  if (p <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h, opacity: p,
        transform: `rotate(${rot + (1 - p) * 14}deg) scale(${(0.6 + 0.4 * p).toFixed(3)})`,
      }}
    >
      <div style={{width: '100%', height: '100%', background: bg, border: `3px solid ${border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6}}>
        <div style={{fontFamily: 'monospace', fontSize: 15, color: titleColor, letterSpacing: 2}}>{title}</div>
        <div style={{fontFamily: 'sans-serif', fontWeight: 900, fontSize: 52, color: valueColor}}>{value}</div>
      </div>
    </div>
  );
};
