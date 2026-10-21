/**
 * SkiaLab — @remotion/skia 质感层验机样张（实验位，2026-10-19 接入）
 *
 * 验什么：headless 渲染下 CanvasKit 出图是否干净——辉光(BlurMask)、径向渐变、
 * 软粒子、圆帽笔触。过了这关 Skia 才进各片质感词汇；翻车就整体撤。
 *
 * 架构定位（重要）：Skia 只做「质感层」（辉光/粒子/渐变/笔触）；文字仍走 DOM 层
 * ——Skia 的 Text 要字体文件，DOM 文字的版式与度量更成熟，别在 Skia 里排文字。
 *
 * 全部确定性：seed + useCurrentFrame，禁 Math.random。
 * 渲染：npx remotion render src/index.skia.ts SkiaLab out/skialab-test.mp4
 */
import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame} from 'remotion';
import {SkiaCanvas} from '@remotion/skia';
import {
  BlurMask,
  Circle,
  Fill,
  Line,
  Paint,
  RadialGradient,
} from '@shopify/react-native-skia';
import {noise2D} from '@remotion/noise';

const W = 1440;
const H = 1080;

/** 三参包装：seed + 2D 坐标 → -1..1 */
const nz = (seed: number, x: number, y = 0): number => noise2D(seed, x, y);

/* ---- 软粒子场（确定性预生成） ---- */
type Particle = {bx: number; by: number; seed: number; r: number; hue: string};
const PARTICLES: Particle[] = Array.from({length: 90}, (_, i) => ({
  bx: 90 + (nz(i * 1.37 + 7, 0.5) * 0.5 + 0.5) * (W - 180),
  by: 90 + (nz(i * 2.11 + 3, 1.5) * 0.5 + 0.5) * (H - 180),
  seed: i,
  r: 1.6 + (nz(i * 0.77, 9.1) * 0.5 + 0.5) * 3.4,
  hue: i % 7 === 0 ? '#ffd27e' : i % 3 === 0 ? '#8fd8ff' : '#5e7ea8',
}));

/* ---- 氛围 bokeh（大辉光低透明） ---- */
const BOKEH = Array.from({length: 5}, (_, i) => ({
  bx: 160 + (nz(i * 3.3 + 21, 2.2) * 0.5 + 0.5) * (W - 320),
  by: 160 + (nz(i * 4.7 + 11, 3.9) * 0.5 + 0.5) * (H - 320),
  seed: i + 100,
  r: 110 + i * 34,
}));

export const SkiaLab: React.FC = () => {
  const f = useCurrentFrame();

  /* hero：f=30 环爆（三层扩散环 + 12 向辉光射线） */
  const heroP = spring({frame: f - 30, fps: 30, config: {damping: 14, stiffness: 90}});
  const rays = 12;

  /* 笔触：f=60..110 从左往右扫出的一条琥珀圆帽墨线（三层辉光叠加） */
  const bp = interpolate(f, [60, 110], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ease = 1 - Math.pow(1 - bp, 3);
  const x1 = W / 2 - 260;
  const x2 = x1 + 520 * ease;
  const yLine = 810;

  return (
    <AbsoluteFill style={{background: '#04070d'}}>
      <div style={{position: 'absolute', inset: 0}}>
        <SkiaCanvas width={W} height={H}>
        {/* 底：径向渐变洗底 */}
        <Fill>
          <Paint>
            <RadialGradient c={{x: W * 0.62, y: H * 0.32}} r={980} colors={['#12203a', '#05080f']} />
          </Paint>
        </Fill>

        {/* bokeh 氛围层 */}
        {BOKEH.map((b) => {
          const dx = nz(b.seed, f * 0.008) * 26;
          const dy = nz(b.seed + 1, f * 0.008) * 20;
          return (
            <Circle
              key={`bk${b.seed}`}
              c={{x: b.bx + dx, y: b.by + dy}}
              r={b.r}
              color="#3f6ea8"
              opacity={0.07}
            >
              <BlurMask blur={60} style="normal" />
            </Circle>
          );
        })}

        {/* 粒子场：漂移 + 闪烁，辉光随粒子 */}
        {PARTICLES.map((p) => {
          const x = p.bx + nz(p.seed, f * 0.01) * 22;
          const y = p.by + nz(p.seed + 50, f * 0.01) * 16;
          const tw = 0.3 + 0.3 * (nz(p.seed + 90, f * 0.02) * 0.5 + 0.5);
          return (
            <Circle key={`pt${p.seed}`} c={{x, y}} r={p.r} color={p.hue} opacity={tw}>
              <BlurMask blur={7} style="normal" />
            </Circle>
          );
        })}

        {/* hero 环爆 */}
        {[0, 1, 2].map((i) => {
          const pr = spring({frame: f - 30 - i * 7, fps: 30, config: {damping: 15, stiffness: 85}});
          const r = 40 + pr * (200 + i * 110);
          const op = interpolate(pr, [0, 0.2, 1], [0, 0.85, 0.22]) * (1 - i * 0.16);
          if (pr <= 0) return null;
          return (
            <Circle
              key={`rg${i}`}
              c={{x: W / 2, y: 460}}
              r={r}
              color="#7ee3ff"
              style="stroke"
              strokeWidth={3 - i * 0.6}
              opacity={op}
            >
              <BlurMask blur={8} style="normal" />
            </Circle>
          );
        })}
        {Array.from({length: rays}, (_, i) => {
          const a = (i / rays) * Math.PI * 2 + 0.35;
          const pr = spring({frame: f - 30 - i * 2, fps: 30, config: {damping: 16, stiffness: 110}});
          if (pr <= 0) return null;
          const inner = 46;
          const outer = inner + 120 * pr;
          return (
            <Line
              key={`ry${i}`}
              p1={{x: W / 2 + Math.cos(a) * inner, y: 460 + Math.sin(a) * inner}}
              p2={{x: W / 2 + Math.cos(a) * outer, y: 460 + Math.sin(a) * outer}}
              color="#b9ecff"
              style="stroke"
              strokeWidth={2.2}
              strokeCap="round"
              opacity={0.75 * pr}
            >
              <BlurMask blur={5} style="normal" />
            </Line>
          );
        })}

        {/* 琥珀墨线笔触（三层辉光） */}
        {[
          {w: 16, blur: 16, op: 0.28},
          {w: 9, blur: 7, op: 0.5},
          {w: 3.6, blur: 1.2, op: 0.95},
        ].map((L, i) => (
          <Line
            key={`bs${i}`}
            p1={{x: x1, y: yLine}}
            p2={{x: x2, y: yLine}}
            color="#ffb84d"
            style="stroke"
            strokeWidth={L.w}
            strokeCap="round"
            opacity={L.op}
          >
            <BlurMask blur={L.blur} style="normal" />
          </Line>
        ))}
        </SkiaCanvas>
      </div>
    </AbsoluteFill>
  );
};
