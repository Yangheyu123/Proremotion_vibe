export const FPS = 30;
/** 示例片 10s @30fps。真实新片建议 60s（TOTAL = 1800）。 */
export const TOTAL = 300;
export const W = 1440;
export const H = 1080;
/** 转场帧数（TransitionSeries 相对时间轴用；示例片单场景，留作升级参考）。 */
export const TRANSITION = 12;

export type Seg = {t: string; kw?: boolean};
export type Card = {
  from: number;
  dur: number;
  lines: Seg[][];
  /** 终场大字卡：不走底部字幕带，直接上画面中央 */
  visualOnly?: boolean;
};

/**
 * 字幕卡真理源。规则（AGENTS 内容铁律）：
 *  - 每 4.5 字/秒密度红线（dwell_check.cjs 会拦）
 *  - 一行 ≤14 字；每卡至少一句完整自然句（配音断句友好）
 *  - kw = 高亮关键词，也是音效重音锚点
 * 配音版：node scripts/vo_build_scene.cjs example --speed 1.25 会逐卡合成并重排 from/dur。
 */
export const CARDS: Card[] = [
  {from: 0, dur: 100, lines: [[{t: '这是示例片的'}, {t: '第一句话', kw: true}, {t: '。'}]]},
  {from: 100, dur: 100, lines: [[{t: '每张卡对应一次画面变化，'}], [{t: '和一条'}, {t: '音效', kw: true}, {t: '。'}]]},
  {from: 200, dur: 100, visualOnly: true, lines: [[{t: '现在，'}, {t: '换成你的故事', kw: true}, {t: '。'}]]},
];

/** 场景 span。sum = TOTAL。 */
export const SCENES = {
  main: [0, 300],
} as const;

export const SCENE_ORDER = ['main'] as const;

export const SCENE_LABELS: Record<(typeof SCENE_ORDER)[number], string> = {
  main: '01 / 示例',
};

/** 旁白逐场原文（配音版逐卡合成）。 */
export const VO_TEXT: Record<(typeof SCENE_ORDER)[number], string> = {
  main: '这是示例片的第一句话。每张卡对应一次画面变化，和一条音效。',
};

/**
 * BGM 能量包络：node scripts/bake_pulse_env.cjs "$ASSET_HOME/bgm.flac" 45 20 300 src/example/script.ts
 * 烘焙前为空数组 = 无节拍呼吸（画面照常渲染）。
 */
export const PULSE_ENV: number[] = [];
