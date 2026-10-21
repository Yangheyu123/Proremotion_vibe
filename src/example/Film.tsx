/**
 * 示例片 Film：卡驱动编舞最小完整样例。
 * 结构 = 场景组件（SCENES 键）+ useSceneCards 卡节拍 + motion2 词汇层 + SubBand。
 * 每张字幕卡对应一次画面状态变化（铁律：卡起 = 画面变）。
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {CARDS, PULSE_ENV, SCENES, SCENE_ORDER} from './script';
import {C, SANS, MONO, tw, pop, hash} from './theme';
import {makePulseFromEnv} from '../lib/audioPulse';
import {drift, sway2, heroIn, motionTransform, seedOf} from '../lib/motion2';
import {TopBar, SubBand} from './chrome';

const beatPulse = makePulseFromEnv(PULSE_ENV);

/** 卡驱动：返回场景内每张卡的局部帧（卡数可变，缺位回退，保证 T[n] 永远有限） */
const useSceneCards = (key: keyof typeof SCENES): number[] => {
  const [from, dur] = SCENES[key];
  const list = CARDS.map((c) => c.from - from).filter((t) => t >= 0 && t < dur);
  const last = list.length ? list[list.length - 1] : 0;
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(i < list.length ? list[i] : Math.min(dur - 12, last + (i - list.length + 1) * 6));
  return out;
};

/** 示例场景：三拍——标题弹入 / 波形线 draw-on / 终场大字 */
const MainScene: React.FC = () => {
  const f = useCurrentFrame();
  const T = useSceneCards('main');
  const seed = seedOf('example');

  /* hero 1（T[0]）：论点标题弹入 + 永动层 */
  const p0 = heroIn(f, T[0] + 6);

  /* hero 2（T[1]）：波形线 draw-on（确定性节点） */
  const draw = tw(f, T[1] + 4, T[1] + 34, 0, 1);
  const pts = Array.from({length: 40}, (_, i) => {
    const x = 220 + i * 25;
    const y = 560 + Math.sin(i * 0.55 + f * 0.02) * 26 * hash(i, seed) * (0.5 + 0.5 * beatPulse(f));
    return `${x},${y.toFixed(1)}`;
  });

  /* hero 3（T[2]）：终场大字（visualOnly 卡，中央呈现） */
  const p2 = heroIn(f, T[2] + 4);

  return (
    <AbsoluteFill style={{background: C.bg}}>
      {/* 底层网格（永动层微动） */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
          backgroundSize: '72px 72px',
          opacity: 0.35,
          transform: motionTransform(f, seed, {ampX: 4, ampY: 4, rot: 0.4}),
        }}
      />

      {/* hero 1：标题 */}
      <div
        style={{
          position: 'absolute',
          left: 130,
          top: 220,
          opacity: p0,
          transform: `translateY(${((1 - p0) * 40).toFixed(1)}px) rotate(${sway2(f, seed + 3, 0.8)}deg)`,
        }}
      >
        <div style={{fontFamily: MONO, fontSize: 22, letterSpacing: 6, color: C.dim, marginBottom: 18}}>EXAMPLE / 01</div>
        <div style={{fontFamily: SANS, fontWeight: 900, fontSize: 92, color: C.white}}>
          这是示例片的<span style={{color: C.cyan}}>第一句话</span>。
        </div>
      </div>

      {/* hero 2：draw-on 波形线 */}
      <svg width={1440} height={1080} style={{position: 'absolute', inset: 0, opacity: f >= T[1] ? 1 : 0}}>
        <polyline
          points={pts.slice(0, Math.max(2, Math.floor(pts.length * draw))).join(' ')}
          fill="none"
          stroke={C.cyan}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <circle cx={220} cy={560} r={7 + 3 * beatPulse(f)} fill={C.amber} />
      </svg>

      {/* hero 3：终场大字（visualOnly 卡） */}
      {f >= T[2] && (
        <AbsoluteFill style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 900,
              fontSize: 110,
              color: C.white,
              opacity: pop(f, T[2] + 4),
              textShadow: `0 0 60px ${C.cyanDim}`,
            }}
          >
            现在，<span style={{color: C.cyan}}>换成你的故事</span>。
          </div>
        </AbsoluteFill>
      )}

      <TopBar title="PROREMOTION VIBE / EXAMPLE" />
      <SubBand />
    </AbsoluteFill>
  );
};

const SCENE_COMPONENT: Record<(typeof SCENE_ORDER)[number], React.FC> = {
  main: MainScene,
};

export const ExampleFilm: React.FC = () => {
  return (
    <AbsoluteFill style={{background: C.bg}}>
      {SCENE_ORDER.map((key) => {
        const Scene = SCENE_COMPONENT[key];
        return <Scene key={key} />;
      })}
    </AbsoluteFill>
  );
};
