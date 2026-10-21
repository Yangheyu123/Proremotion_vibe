/**
 * EffectsLab — @remotion/effects 函数式效果验机样张（2026-10-19 接入）
 *
 * 验什么：effects 体系（EffectDescriptor + effects prop）在 headless 渲染下是否出图。
 * 四个面板覆盖四类用法：
 *   A lightLeak        — 暖色漏光（webgl2，进度动画）
 *   B starburst        — 放射星芒（webgl2，旋转动画）
 *   C rings+linearGradient — 效果链组合（数组顺序 = 叠加顺序）
 *   D HtmlInCanvas+glow — DOM 内容进 canvas 再打 webgl 辉光（探 DOM→canvas 桥）
 *
 * 消费范式（各片照抄）：effects={[lightLeak({...})]} 挂在 Solid / Img / Video /
 * HtmlInCanvas 上；参数都是普通对象，随 useCurrentFrame 驱动即成动画。
 * 渲染：npx remotion render src/index.ts EffectsLab out/effectslab-test.mp4
 */
import React from 'react';
import {AbsoluteFill, HtmlInCanvas, Solid, interpolate, useCurrentFrame} from 'remotion';
import {lightLeak, linearGradient, rings, starburst} from '@remotion/effects';
import {glow} from '@remotion/effects/glow';

const W = 1440;
const H = 1080;
const PW = W / 2;
const PH = H / 2;

const Label: React.FC<{text: string; x: number}> = ({text, x}) => (
  <div
    style={{
      position: 'absolute',
      left: x + 20,
      top: 16,
      color: '#9fc3e8',
      fontFamily: 'monospace',
      fontSize: 24,
      letterSpacing: 2,
      pointerEvents: 'none',
    }}
  >
    {text}
  </div>
);

export const EffectsLab: React.FC = () => {
  const f = useCurrentFrame();
  const prog = interpolate(f, [0, 80], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: '#04070d'}}>
      {/* A：lightLeak 暖漏光 */}
      <div style={{position: 'absolute', left: 0, top: 0}}>
        <Solid
          width={PW}
          height={PH}
          color="#0a1220"
          effects={[lightLeak({seed: 7, hueShift: 25, progress: prog})]}
        />
      </div>
      <Label text="lightLeak" x={0} />

      {/* B：starburst 放射星芒 */}
      <div style={{position: 'absolute', left: PW, top: 0}}>
        <Solid
          width={PW}
          height={PH}
          color="#07101d"
          effects={[
            starburst({
              rays: 14,
              colors: ['#7ee3ff', '#0b1826', '#ffb84d', '#0b1826'],
              rotation: f * 0.6,
              smoothness: 0.5,
              origin: [0.5, 0.5],
            }),
          ]}
        />
      </div>
      <Label text="starburst" x={PW} />

      {/* C：rings + linearGradient 效果链组合 */}
      <div style={{position: 'absolute', left: 0, top: PH}}>
        <Solid
          width={PW}
          height={PH}
          color="#050b14"
          effects={[
            linearGradient({start: [0, 0], end: [1, 1], startColor: '#020810', endColor: '#0c2c4e'}),
            rings({colors: ['#dff4ff', '#7cc6ff'], thickness: 26, gap: 16, offset: f * 3}),
          ]}
        />
      </div>
      <Label text="rings + linearGradient" x={0} />

      {/* D：HtmlInCanvas + glow（DOM 进 canvas 再打辉光） */}
      <div style={{position: 'absolute', left: PW, top: PH}}>
        <HtmlInCanvas width={PW} height={PH} effects={[glow({radius: 24, intensity: 1.6, threshold: 0.25, color: '#b9ecff'})]}>
          <div
            style={{
              width: PW,
              height: PH,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#050a12',
            }}
          >
            <div
              style={{
                width: 170,
                height: 170,
                borderRadius: '50%',
                background: '#eaf7ff',
                boxShadow: '0 0 70px #7ee3ff',
              }}
            />
          </div>
        </HtmlInCanvas>
      </div>
      <Label text="HtmlInCanvas + glow" x={PW} />
    </AbsoluteFill>
  );
};
