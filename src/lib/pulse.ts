/**
 * 节拍脉冲引擎：由 BEATS 帧表生成 (f)=>[0..1] 脉冲函数（拍点处 1，指数衰减）。
 * 三部片同构逻辑收敛于此——改衰减/插值一处生效。
 */
export const makeBeatPulse =
  (beats: number[], decay = 0.28): ((f: number) => number) =>
  (f: number): number => {
    let lo = 0;
    let hi = beats.length - 1;
    let last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= f) {
        last = beats[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (last < 0) return 0;
    return Math.exp(-(f - last) * decay);
  };
