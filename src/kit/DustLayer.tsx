/*
 * [KIT-05] DustLayer — 粉笔灰/尘埃/颗粒 环境层（永续氛围，speckle 实现）
 * 来源：calc 板面粉笔灰。叠加在底色之上，稀疏尘点会随 opacity 呼吸。
 * Solid+speckle 范式：色 = 尘色，density = 打孔率（越高越稀疏）。
 */
import React from 'react';
import {Solid} from 'remotion';
import {speckle} from '@remotion/effects/speckle';

export type DustLayerProps = {
  width: number;
  height: number;
  dustColor?: string;               // 尘色（如 #E8E4D4 粉笔灰 / #FFE9B8 暖尘）
  density?: number;                 // 打孔率 0..1（越高越稀疏，默认 0.94）
  size?: number;                    // 尘粒直径（默认 3.2）
  opacity?: number;                 // 层透明度（默认 0.05——氛围级，禁止噪点凑密度）
  inset?: number;                   // 距边距（默认 0）
};

export const DustLayer: React.FC<DustLayerProps> = ({
  width, height, dustColor = '#E8E4D4', density = 0.94, size = 3.2, opacity = 0.05, inset = 0,
}) => (
  <Solid
    width={width - inset * 2}
    height={height - inset * 2}
    color={dustColor}
    effects={[speckle({density, size, randomness: 1})]}
    style={{position: 'absolute', inset, opacity}}
  />
);
