/**
 * FitText — @remotion/layout-utils 接入点（2026-10-19）
 *
 * 版面内自适应文字：渲染时用 measureText 实测宽度，超框自动缩字号，
 * 消掉 AI 写卡最常见的「中文长句溢出」事故。measureText 在渲染浏览器里跑 DOM 量测，headless 安全。
 *
 * 用法：<FitText text={card.title} fontFamily={SANS} baseSize={72} boxW={900} boxH={110} />
 *
 * 适用：卡片标题 / 中央词带 / 气泡对白等**单行**大字；
 * 多行段落用 @remotion/layout-utils 的 fitTextOnNLines（同包已装）。
 */
import React, {useMemo} from 'react';
import {measureText} from '@remotion/layout-utils';

export const FitText: React.FC<{
  text: string;
  boxW: number;
  boxH: number;
  baseSize: number;
  fontFamily: string;
  fontWeight?: string;
  color?: string;
  minSize?: number;
  letterSpacing?: string;
  style?: React.CSSProperties;
}> = ({
  text,
  boxW,
  boxH,
  baseSize,
  fontFamily,
  fontWeight = '700',
  color = '#fff',
  minSize = 18,
  letterSpacing = '0em',
  style,
}) => {
  const fontSize = useMemo(() => {
    let size = baseSize;
    while (size > minSize) {
      const m = measureText({text, fontFamily, fontWeight, fontSize: size, letterSpacing});
      if (m.width <= boxW && m.height <= boxH) break;
      size -= 2;
    }
    return Math.max(minSize, size);
  }, [text, boxW, boxH, baseSize, fontFamily, fontWeight, minSize, letterSpacing]);

  return (
    <div
      style={{
        fontFamily,
        fontWeight,
        fontSize,
        letterSpacing,
        color,
        width: boxW,
        lineHeight: 1.25,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {text}
    </div>
  );
};
