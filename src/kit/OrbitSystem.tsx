/*
 * [KIT-01] OrbitSystem — 永续轨道系统（氛围/永续层）
 * 来源：funes 记忆归档轨道（用户点名"画面一直是动的"的标杆片）。
 * 参数化：全部颜色/尺寸/速度可配——配新色板即新身份，技法永久复用。
 * 语法：轨道点 (f/τ + i*0.13) % 1 永续绕行，永不停止（铁律 3 永续运动密度核心词汇）。
 */
import React from 'react';

export type OrbitSystemProps = {
  f: number;
  cx: number;
  cy: number;
  rings?: {r: number; dotCount: number; speed: number; color: string; opacity?: number; phase?: number}[];
  dotR?: number;
  ringColor?: string;
  ringOpacity?: number;
  squishY?: number;
};

export const OrbitSystem: React.FC<OrbitSystemProps> = ({
  f, cx, cy,
  rings = [{r: 150, dotCount: 7, speed: 60, color: '#F5D76E', phase: 0}],
  dotR = 2.2, ringColor = 'rgba(242,239,228,0.16)', ringOpacity = 0.5, squishY = 0.72,
}) => (
  <g>
    {rings.map((ring, ri) => {
      const orbits = Array.from({length: ring.dotCount}, (_, i) => {
        const head = (f / ring.speed + i * 0.13 + (ring.phase ?? 0)) % 1;
        const ang = head * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={i}
            cx={cx + Math.cos(ang) * ring.r}
            cy={cy + Math.sin(ang) * ring.r * squishY}
            r={dotR}
            fill={ring.color}
            opacity={(ring.opacity ?? 0.8)}
          />
        );
      });
      return (
        <g key={ri}>
          <circle cx={cx} cy={cy} r={ring.r} fill="none" stroke={ringColor} strokeWidth={1} opacity={ringOpacity} transform={`translate(0 ${(1 - squishY) * ring.r}) scale(1 ${squishY}) translate(0 ${-(1 - squishY) * ring.r})`} />
          {orbits}
        </g>
      );
    })}
  </g>
);
