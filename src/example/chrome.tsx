/*
 * 示例片 chrome 层：顶部信息条 + 底部字幕带（起步骨架）。
 * ⚠️ 新片按视觉提案重写形态（AGENTS 铁律 6：皮骨都换）——但两条定位铁律不可破：
 *  1. 字幕带底边距画面底 ≥10%（1080 高 = bottom ≥110；禁贴边）
 *  2. 文字必须显式设色（黑底继承默认黑 = 隐形事故）
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {CARDS, FPS} from './script';
import {C, SANS, MONO, clamp01} from './theme';

/** 顶部信息条：左侧标题 + 右侧时码（示例形态，新片重新设计） */
export const TopBar: React.FC<{title: string}> = ({title}) => {
  const f = useCurrentFrame();
  return (
    <div style={{position: 'absolute', left: 62, right: 62, top: 44, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
        <div style={{width: 12, height: 12, background: C.cyan, transform: `rotate(45deg)`}} />
        <div style={{fontFamily: MONO, fontSize: 20, letterSpacing: 3, color: C.dim}}>{title}</div>
      </div>
      <div style={{fontFamily: MONO, fontSize: 18, color: C.dim}}>
        {String(Math.floor(f / FPS / 60)).padStart(2, '0')}:{String(Math.floor(f / FPS % 60)).padStart(2, '0')}
      </div>
    </div>
  );
};

/** 底部字幕带：整行淡入（起步骨架）。真实新片换逐字/擦显等多风格轮换（见 METHODOLOGY §4）。 */
export const SubBand: React.FC = () => {
  const f = useCurrentFrame();
  const card = [...CARDS].reverse().find((c) => f >= c.from && (c.from + c.dur) > f);
  if (!card || card.visualOnly) return null;
  const local = f - card.from;
  const text = card.lines.map((l) => l.map((s) => s.t).join('')).join('');
  /* 逐字显出：0.05s/字，显完保留到卡尾 */
  const shown = clamp01((local / FPS) / (text.length * 0.05));
  const visible = text.slice(0, Math.ceil(shown * text.length));
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 110, /* 铁律：≥110（画面高的 10%） */
        display: 'flex',
        justifyContent: 'center',
        paddingBottom: 28,
        paddingTop: 22,
        background: `linear-gradient(180deg, rgba(5,8,15,0) 0%, rgba(5,8,15,0.72) 30%)`,
      }}
    >
      <div style={{fontFamily: SANS, fontWeight: 900, fontSize: 56, color: C.white, whiteSpace: 'pre'}}>
        {visible}
      </div>
    </div>
  );
};
