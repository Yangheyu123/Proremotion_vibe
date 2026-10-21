import React from 'react';
import {Composition} from 'remotion';
import {ExampleFilm} from './example/Film';
import {FPS as FPS_EX, TOTAL as TOTAL_EX} from './example/script';
import {EffectsLab} from './effectslab/EffectsLab';

/**
 * 合成注册表。
 * 新片由 scripts/new_film.cjs 自动在此追加 Composition（勿手改顺序，追加到末尾即可）。
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Example"
        component={ExampleFilm}
        durationInFrames={TOTAL_EX}
        fps={FPS_EX}
        width={1440}
        height={1080}
      />
      {/* 生态验机样张：@remotion/effects 四面板（lightLeak/starburst/rings+linearGradient/HtmlInCanvas+glow） */}
      <Composition
        id="EffectsLab"
        component={EffectsLab}
        durationInFrames={90}
        fps={30}
        width={1440}
        height={1080}
      />
    </>
  );
};
