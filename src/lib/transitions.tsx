import type {TransitionPresentation} from '@remotion/transitions';
import {linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import {flip} from '@remotion/transitions/flip';
import {iris} from '@remotion/transitions/iris';
import {pushCut} from '@remotion/transitions/push-cut';
import {clockWipe} from '@remotion/transitions/clock-wipe';
import {filmBurn} from '@remotion/transitions/film-burn';
import {crosswarp} from '@remotion/transitions/crosswarp';
import {dreamyZoom} from '@remotion/transitions/dreamy-zoom';
import {bookFlip} from '@remotion/transitions/book-flip';
import {ripple} from '@remotion/transitions/ripple';
import {zoomBlur} from '@remotion/transitions/zoom-blur';
import {linearBlur} from '@remotion/transitions/linear-blur';
import {blurSlide} from '@remotion/transitions/blur-slide';
import {crossZoom} from '@remotion/transitions/cross-zoom';
import {swap} from '@remotion/transitions/swap';
import {zoomInOut} from '@remotion/transitions/zoom-in-out';
import {dissolve} from '@remotion/transitions/dissolve';

/**
 * 转场预设库（2026-11-03 建）
 *
 * 背景：产线前 25 条片全是手搓转场（撕纸/光扫/眨眼/glitch/燕掠/打印头/板擦/窗格/丝线重绘/
 * 剪影幕落/沙蚀/滚屏/齿孔/iris/弦断/叠纸），而 `@remotion/transitions` 里**已经装了 21 个官方转场**，
 * 其中 filmBurn / crosswarp / dreamyZoom / bookFlip / ripple / clockWipe 就是"华丽档"，一次没用过。
 *
 * 用法（新片一行接一整套）：
 *   import {tierPlan, makeT} from '../lib/transitions';
 *   const plan = tierPlan('lavish');           // 得到一串转场名
 *   <TransitionSeries.Transition {...makeT(plan[i % plan.length])} />
 *
 * ⚠ GPU 转场（gpu: true）走 HtmlInCanvas + WebGL：
 *   headless 可用（2026-11-03 实测 filmBurn / ripple / bookFlip 全过），但**吃填充率**——
 *   1440×1080 + concurrency 8 会在单帧 33s 超时；安全参数见 SAFE_RENDER。
 */

export type TName =
  | 'fade'
  | 'slide'
  | 'wipe'
  | 'flip'
  | 'iris'
  | 'pushCut'
  | 'clockWipe'
  | 'dissolve'
  | 'filmBurn'
  | 'crosswarp'
  | 'dreamyZoom'
  | 'bookFlip'
  | 'ripple'
  | 'zoomBlur'
  | 'linearBlur'
  | 'blurSlide'
  | 'crossZoom'
  | 'swap'
  | 'zoomInOut';

export type TTier = 'soft' | 'cut' | 'lavish' | 'destructive';

type TDef = {
  /** 生成 presentation；opts 直接透传给官方函数 */
  make: (opts?: Record<string, unknown>) => TransitionPresentation<Record<string, unknown>>;
  /** 建议时长（帧 @30fps）；华丽档通常要更长才看得出来 */
  dur: number;
  /** 是否 WebGL（影响渲染并发与超时） */
  gpu: boolean;
  tier: TTier;
  /** 一句话语义：什么时候用它 */
  use: string;
};

const P = (x: unknown) => x as TransitionPresentation<Record<string, unknown>>;

export const TRANSITIONS: Record<TName, TDef> = {
  /* ── 柔性：同一时空里的时间流逝 ── */
  fade: {make: () => P(fade({})), dur: 18, gpu: false, tier: 'soft', use: '最安全；两场同处一地、只是时间过去'},
  dissolve: {make: () => P(dissolve({})), dur: 20, gpu: true, tier: 'soft', use: '溶解带噪点，比 fade 有质感'},
  blurSlide: {make: () => P(blurSlide({})), dur: 22, gpu: true, tier: 'soft', use: '带运动模糊的横移，像镜头甩过去'},

  /* ── 硬切：打断、跳到另一处 ── */
  slide: {make: (o) => P(slide({direction: 'from-right', ...o})), dur: 14, gpu: false, tier: 'cut', use: '换地点；方向即叙事方向'},
  wipe: {make: (o) => P(wipe({direction: 'from-left', ...o})), dur: 14, gpu: false, tier: 'cut', use: '干净的擦除，适合分章'},
  pushCut: {make: (o) => P(pushCut({...o})), dur: 12, gpu: false, tier: 'cut', use: '推着上一场出去，最"剪辑感"'},
  flip: {make: () => P(flip({})), dur: 16, gpu: false, tier: 'cut', use: '翻面；适合"换个角度看同一件事"'},
  iris: {make: (o) => P(iris({width: 1440, height: 1080, ...o})), dur: 18, gpu: false, tier: 'cut', use: '圆开/圆合，聚到一点或从一点炸开'},

  /* ── 华丽：观众会"哇"一下 ── */
  filmBurn: {make: (o) => P(filmBurn({seed: 3, ...o})), dur: 24, gpu: true, tier: 'lavish', use: '烧穿画面；最贵的一档，留给最重要的转折'},
  crosswarp: {make: () => P(crosswarp({})), dur: 24, gpu: true, tier: 'lavish', use: '空间扭曲穿墙；适合"进入另一个世界"'},
  dreamyZoom: {make: (o) => P(dreamyZoom({rotation: 4, scale: 1.6, ...o})), dur: 26, gpu: true, tier: 'lavish', use: '旋转推进；回忆/梦境/失重'},
  bookFlip: {make: (o) => P(bookFlip({direction: 'from-right', ...o})), dur: 24, gpu: true, tier: 'lavish', use: '翻书页；"翻篇"这件事本身'},
  ripple: {make: (o) => P(ripple({amplitude: 0.12, speed: 1.2, ...o})), dur: 22, gpu: true, tier: 'lavish', use: '水波扩散；情绪被打了一下'},
  zoomBlur: {make: () => P(zoomBlur({})), dur: 20, gpu: true, tier: 'lavish', use: '急推拉爆；冲击/惊醒'},
  crossZoom: {make: () => P(crossZoom({})), dur: 22, gpu: true, tier: 'lavish', use: '两个空间对穿；尺度跳变'},
  zoomInOut: {make: () => P(zoomInOut({})), dur: 22, gpu: true, tier: 'lavish', use: '先吸进去再推出来'},

  /* ── 破坏：信号坏了、系统崩了 ── */
  clockWipe: {make: (o) => P(clockWipe({width: 1440, height: 1080, ...o})), dur: 20, gpu: false, tier: 'destructive', use: '时钟式扫除；倒计时/循环'},
  swap: {make: () => P(swap({})), dur: 18, gpu: true, tier: 'destructive', use: '整块对调；错位/荒诞'},
  linearBlur: {make: () => P(linearBlur({})), dur: 18, gpu: true, tier: 'destructive', use: '线性拖影撕裂；故障感'},
};

/** 按档位取一串转场名（同一个档位内部轮换，避免全片一个转场） */
export const tierPlan = (tier: TTier): TName[] =>
  (Object.keys(TRANSITIONS) as TName[]).filter((k) => TRANSITIONS[k].tier === tier);

/** 全片轮换器：给第 i 个转场，返回该档位里第 i 个（循环） */
export const cycleT = (tier: TTier, i: number): TName => {
  const list = tierPlan(tier);
  return list[i % list.length];
};

/**
 * 一步拿到 <TransitionSeries.Transition> 需要的两个 prop。
 * 用法：<TransitionSeries.Transition {...makeT('filmBurn')} />
 */
export const makeT = (name: TName, opts?: Record<string, unknown>, durOverride?: number) => {
  const d = TRANSITIONS[name];
  return {
    presentation: d.make(opts),
    timing: linearTiming({durationInFrames: durOverride ?? d.dur}),
  };
};

/** GPU 转场的安全渲染参数（实测：1440×1080 下 concurrency 8 会单帧超时） */
export const SAFE_RENDER = {
  concurrency: 4,
  timeoutMs: 120000,
  note: '含 gpu:true 转场时用：--concurrency=4 --timeout=120000；concurrency ≥ 8 会 WebGL 争用导致单帧 33s 超时',
};
