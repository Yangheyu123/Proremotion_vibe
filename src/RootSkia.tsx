import React from 'react';
import {Composition} from 'remotion';
import {SkiaLab} from './skialab/SkiaLab';

/** Skia 实验位专用 Root——只挂 Skia 合成，别把普通影片挪进来 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SkiaLab"
      component={SkiaLab}
      durationInFrames={150}
      fps={30}
      width={1440}
      height={1080}
    />
  );
};
