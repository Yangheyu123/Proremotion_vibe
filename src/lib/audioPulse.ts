/**
 * makePulseFromEnv — 能量包络 → pulse(frame) 0..1（含 2 帧衰减平滑）
 * env 来源：各片 script.ts 的 PULSE_ENV（bake_pulse_env.cjs / vo_build 从 BGM 切片
 * 以 ffmpeg -ar 30 逐帧解码峰值计算，归一化后烘入）。零运行时 fetch，零解码。
 */
export const makePulseFromEnv = (env: number[]): ((frame: number) => number) => {
  const decayed = env.map((v, i) =>
    Math.max(v, (env[i - 1] ?? 0) * 0.8, (env[i - 2] ?? 0) * 0.64),
  );
  return (frame: number): number => {
    const i = Math.max(0, Math.min(decayed.length - 1, Math.round(frame)));
    return decayed[i] ?? 0;
  };
};
