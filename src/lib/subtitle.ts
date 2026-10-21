/**
 * 字幕机机制层：逐字展平 + 自适应节奏。视觉形态（颜色/字体/出场动画）留在各片。
 */

export type Seg = {t: string; kw?: boolean};

/** 展平逐字序列，保留 kw 标记、所在行 li、行内词组序号 si。 */
export const flattenChars = (lines: Seg[][]): {c: string; kw: boolean; li: number; si: number}[] => {
  const chars: {c: string; kw: boolean; li: number; si: number}[] = [];
  lines.forEach((line, li) => {
    let si = 0;
    line.forEach((seg) => {
      seg.t.split('').forEach((c) => chars.push({c, kw: !!seg.kw, li, si}));
      si++;
    });
  });
  return chars;
};

/**
 * 逐字节奏自适应：长句在短卡里自动加速（1.3~2.3f/字），
 * 保证显完仍留阅读时间——"显完就淡出"= 事故。
 */
export const charStepFor = (dur: number, totalChars: number): number =>
  Math.min(2.3, Math.max(1.3, (dur - 26) / (totalChars || 1)));
