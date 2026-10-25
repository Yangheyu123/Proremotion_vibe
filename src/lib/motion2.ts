/**
 * motion2 — 动效词汇层（2026-10-18 改版核心）
 *
 * 设计哲学：
 *   旧制度 = 手写 sin + 幅度死线（镇静标准）→ 每个元素动得一模一样，产出平淡
 *   新制度 = 词汇层供给多样性（Perlin 噪声/轨迹/hero 预设），设计只发"风格牌"
 *   纪律从「幅度死线」改为「注意力纪律」：同一时刻观众只该看一处——每拍至多一个 hero
 *
 * 全部确定性：seed 驱动，逐帧可复现。幅度参数是设计自由度，不再设死线。
 */
import {makeTransform, rotate, scale, translate, translateY} from '@remotion/animation-utils';
import {noise2D} from '@remotion/noise';
import {spring} from 'remotion';

type Vec = {x: number; y: number};

/** 采样噪声：把 (seed, f) 映到 -1..1 的平滑有机信号（替换 sin） */
export const n1 = (seed: number, f: number, freq = 1): number =>
  noise2D(seed * 12.9898, f * 0.01 * freq, seed * 0.7);

/**
 * drift — 有机漂移（永动层默认风格）：Perlin 双轴，非重复、非对称
 * ampX/ampY 是设计自由度（建议环境层 4-10，hero 10-24），不再是死线
 */
export const drift = (
  f: number,
  seed: number,
  ampX = 8,
  ampY = 6,
  freq = 1,
): Vec => ({
  x: n1(seed, f, freq) * ampX,
  y: n1(seed + 91, f, freq) * ampY,
});

/** sway — 有机摇摆（度）。rotAmp 设计自由度（环境层 1-3，hero 6-12） */
export const sway2 = (f: number, seed: number, rotAmp = 2, freq = 1): number =>
  n1(seed + 17, f, freq) * rotAmp;

/** breathe — 呼吸（透明度），base±amp */
export const breathe2 = (
  f: number,
  seed: number,
  base = 0.85,
  amp = 0.15,
  freq = 1,
): number => base + amp * n1(seed + 33, f, freq);

/** 组合为 CSS transform（drift+sway 一步到位；官方 makeTransform 组合器，杜绝拼接顺序 bug） */
export const motionTransform = (
  f: number,
  seed: number,
  o: {ampX?: number; ampY?: number; rot?: number; freq?: number; baseRot?: number} = {},
): string => {
  const {ampX = 8, ampY = 6, rot = 2, freq = 1, baseRot = 0} = o;
  const d = drift(f, seed, ampX, ampY, freq);
  const r = baseRot + sway2(f, seed, rot, freq);
  return makeTransform([translate(d.x, d.y), rotate(r)]);
};

/** hero — 高冲击入场（弹入 + 过冲），用于每拍的唯一主视觉事件 */
export const heroIn = (
  f: number,
  at: number,
  o: {damping?: number; stiffness?: number; mass?: number} = {},
): number => {
  if (f < at) return 0;
  return spring({
    frame: f - at,
    fps: 30,
    config: {damping: o.damping ?? 11, stiffness: o.stiffness ?? 120, mass: o.mass ?? 0.9},
  });
};

/** heroRise — 从下方带过冲的升起 */
export const heroRise = (f: number, at: number, dist = 60): string => {
  const p = heroIn(f, at);
  return makeTransform([translateY((1 - p) * dist), scale(0.92 + p * 0.08)]);
};

/** orbit — 环绕轨迹（圆/椭圆），中心角速度可控 */
export const orbit = (
  f: number,
  seed: number,
  radius = 10,
  period = 240,
): Vec => {
  const a = (f / period) * Math.PI * 2 + seed;
  return {x: Math.cos(a) * radius, y: Math.sin(a) * radius * 0.6};
};

/** 抽一个确定性 seed（元素稳定使用） */
export const seedOf = (n: number | string): number => {
  const s = String(n);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 10000;
};

/** 每拍一 hero 的注意力闸：返回该帧是否轮到此元素做主视觉（同拍多元素时只有一个 hero） */
export const heroSlot = (beatIdx: number, elemIdx: number): boolean =>
  (beatIdx + elemIdx) % 2 === 0;

/**
 * statesOf — 一卡多态语法层（2026-10-25 拍板：一句话对应多次整屏级状态切换）。
 * 把卡时长均分为 count 个状态窗；每个状态给 {start, dur, p}——p 是该状态的进入进度 0..1，
 * 场景按 p 切换构图（前态退、后态进，整屏级差异 ≥50%）。每态一个焦点。
 *
 * 用法（场景内，localF = 场景局部帧）：
 *   const st = statesOf(localF, card.dur, 3);
 *   st[0].p // 态1 进入进度 → 驱动构图 A；st[1].p > 0 时切构图 B …
 */
export const statesOf = (
  localF: number,
  dur: number,
  count: number,
): {start: number; dur: number; p: number}[] => {
  const each = dur / count;
  const ramp = Math.min(each, 18);
  return Array.from({length: count}, (_, i) => {
    const t = (localF - i * each) / ramp;
    return {start: i * each, dur: each, p: t < 0 ? 0 : t > 1 ? 1 : t};
  });
};
