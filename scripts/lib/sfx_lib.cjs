/*
 * SFX 共享库（三部片共用的机制层，视觉无关）：
 *   1. 程序化合成基元 + 18 音库 LIB（44.1kHz 16bit 单声 WAV）
 *   2. 排期解析 resolveCues——支持两种写法：
 *        绝对帧：[frame, sound, vol]                        （旧格式，兼容）
 *        对象式：{card: 5, at: 20,  sound: 'stamp', vol: -16}   at = 卡起点后帧数
 *                {card: 5, at: 'end', sound, vol}              卡淡出起点（dur-16）
 *                {card: 5, at: 'kw',  sound, vol}              kw 首字显出估计帧
 *                {scene: 'web3', at: -4, sound, vol}           场景起点前 4 帧（转场 riser 用负偏移）
 *      绝对帧排期若传入 CARDS 上下文，自动锚定到所在卡片——换歌重吸附/延时后音效随卡走，不必整表重写。
 *   3. ffmpeg 混音命令构建 buildMix（execFileSync 数组传参——cmd.exe 8191 字符上限）。
 * 混音规则（实测沉淀）：
 *   - 微动层（vol ≤ -22dB）自动 +4dB：≤-26dB 穿不透 BGM 等于没加
 *   - impact 层 -14~-18dB 与主体并存不抢
 *   - BGM 削尖刺（highshelf -5dB @2.8k + lowpass 12.5k + volume 0.28）
 */
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const paths = require('./paths.cjs');

const FF = paths.FFMPEG;
const FP = paths.FFPROBE;
const SR = 44100;

/* ---------- 合成基元 ---------- */
const sec = (n) => Math.round(n * SR);
const envExp = (buf, tau) => {
  for (let i = 0; i < buf.length; i++) buf[i] *= Math.exp(-i / (SR * tau));
  return buf;
};
const envHann = (buf) => {
  const N = buf.length;
  for (let i = 0; i < N; i++) buf[i] *= 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  return buf;
};
const fade = (buf, fin = 0.01, fout = 0.02) => {
  const a = sec(fin);
  const b = sec(fout);
  for (let i = 0; i < a; i++) buf[i] *= i / a;
  for (let i = 0; i < b; i++) buf[buf.length - 1 - i] *= i / b;
  return buf;
};
const mix = (...parts) => {
  const N = Math.max(...parts.map((p) => p.buf.length + p.at));
  const out = new Float32Array(N);
  for (const p of parts) for (let i = 0; i < p.buf.length; i++) out[i + p.at] += p.buf[i];
  return out;
};
/**
 * RBJ cookbook 带通（b/a0 归一化 + 独立延迟线）。
 * ⚠️ 旧版三处错误致发散（1e15）、三音全废——事故记录见 PLAN_ARCHIVE.md 批 0。
 * 防线：synthAll 落盘回读校验 + baseline.cjs。
 */
const bandpass = (buf, f0, f1, Q = 2) => {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const t = buf.length > 1 ? i / (buf.length - 1) : 0;
    const fc = f0 + (f1 - f0) * t;
    const w = (2 * Math.PI * fc) / SR;
    const cs = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Q);
    // RBJ bandpass (constant skirt gain, peak gain = Q)
    const b0 = alpha, b1 = 0, b2 = -alpha;
    const a0 = 1 + alpha, a1 = -2 * cs, a2 = 1 - alpha;
    const x = buf[i];
    // 必须除以 a0 —— 漏掉这一步就是旧实现的发散根因
    const y =
      (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 -
      (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
};
const sine = (f0, f1, dur, tau) => {
  const buf = new Float32Array(sec(dur));
  let ph = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = i / buf.length;
    const f = f0 + (f1 - f0) * t;
    ph += (2 * Math.PI * f) / SR;
    buf[i] = Math.sin(ph);
  }
  return tau ? envExp(buf, tau) : buf;
};
let seedState = 7;
const rnd = () => {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x3fffffff - 1;
};
const noise = (dur) => {
  const buf = new Float32Array(sec(dur));
  for (let i = 0; i < buf.length; i++) buf[i] = rnd();
  return buf;
};
/**
 * 峰值归一化。⚠️ 2026-10-12：旧守卫 `if (m > 0)` 恰好放过了它本该拦的两种情况——
 * m=Infinity 时 peak/m=0 但 Inf*0=NaN；m=NaN 时 `NaN > 0` 为 false 直接原样返回。
 * 现在非有限即抛错，让坏样本在合成阶段立刻暴露，而不是落盘成垃圾。
 */
const norm = (buf, peak = 1) => {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (!Number.isFinite(m)) {
    throw new Error(`norm: 缓冲区含非有限值（m=${m}）——滤波器或合成基元已发散`);
  }
  if (m === 0) {
    throw new Error('norm: 缓冲区全零——合成基元产出空信号');
  }
  for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
};

/* ---------- 音效库（18 音）---------- */
const LIB = {
  // 低音落地（卡片/转场落点）
  thud: () => mix({buf: norm(sine(88, 44, 0.26, 0.07)), at: 0}, {buf: norm(bandpass(noise(0.02), 900, 900), 0.4), at: 0}),
  boom: () => envExp(sine(58, 30, 0.9), 0.22),
  // 木鱼/积木敲击
  knock: () => mix({buf: norm(bandpass(noise(0.07), 700, 1100, 4), 0.9), at: 0}, {buf: norm(sine(240, 210, 0.1, 0.03), 0.7), at: 0}),
  // UI 轻 tick
  tick: () => mix({buf: norm(bandpass(noise(0.012), 3000, 3000, 3), 0.7), at: 0}, {buf: norm(sine(2100, 1900, 0.03, 0.012), 0.5), at: 0}),
  // 元素弹出
  pop: () => mix({buf: norm(sine(420, 190, 0.09, 0.035), 0.9), at: 0}, {buf: norm(bandpass(noise(0.008), 1500, 1500), 0.35), at: 0}),
  // 转场 swish（短 whoosh）
  swish: () => fade(envHann(bandpass(noise(0.2), 500, 2600, 1.4)), 0.02, 0.05),
  // 转场 riser（长 whoosh 上扬，1.1s）
  riser: () => {
    const n = envHann(bandpass(noise(1.1), 300, 3200, 1.2));
    const s = sine(170, 620, 1.1);
    for (let i = 0; i < n.length; i++) n[i] = n[i] * 0.75 + s[i] * 0.35;
    for (let i = 0; i < n.length; i++) n[i] *= Math.pow(i / n.length, 1.4); // 渐强
    return norm(n, 0.9);
  },
  // 圆点绽放：和音 chime
  chime: () => {
    const b = mix(
      {buf: norm(sine(1040, 1040, 0.5, 0.16), 0.7), at: 0},
      {buf: norm(sine(1560, 1560, 0.45, 0.13), 0.5), at: 0},
      {buf: norm(sine(2350, 2350, 0.35, 0.1), 0.35), at: 0},
    );
    return fade(b, 0.004, 0.2);
  },
  // 充满提示 ding
  ding: () => fade(mix({buf: norm(sine(1320, 1320, 0.8, 0.3), 0.8), at: 0}, {buf: norm(sine(1980, 1980, 0.6, 0.22), 0.4), at: 0}), 0.003, 0.35),
  // 高频微光
  shimmer: () => {
    const parts = [];
    for (let k = 0; k < 5; k++) {
      parts.push({buf: norm(sine(3200 + k * 760, 3200 + k * 760, 0.7, 0.28), 0.16), at: sec(k * 0.045)});
    }
    return fade(mix(...parts), 0.002, 0.4);
  },
  // 印章重击
  stamp: () => mix({buf: norm(sine(120, 62, 0.32, 0.1), 0.95), at: 0}, {buf: norm(bandpass(noise(0.025), 700, 700, 1.5), 0.6), at: 0}),
  // 拨杆 click（两声）
  click: () => mix({buf: norm(sine(1800, 1500, 0.03, 0.01), 0.8), at: 0}, {buf: norm(sine(1600, 1300, 0.03, 0.012), 0.8), at: sec(0.035)}),
  // 倒水（气泡感噪声）
  pour: () => {
    const n = noise(2.0);
    const out = new Float32Array(n.length);
    let lp = 0;
    for (let i = 0; i < n.length; i++) {
      const t = i / n.length;
      const wob = 1 + 0.5 * Math.sin((2 * Math.PI * 6.5 * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 13.2 * i) / SR);
      const alpha = Math.min(0.9, (0.12 * wob * (600 + 900 * t)) / SR * 40);
      lp += alpha * (n[i] - lp);
      out[i] = lp;
    }
    return fade(norm(out, 0.85), 0.15, 0.4);
  },
  // 暗夜氛围垫
  padNight: () => {
    const b = mix(
      {buf: norm(sine(110, 108, 3.4), 0.5), at: 0},
      {buf: norm(sine(165, 163, 3.4), 0.32), at: 0},
      {buf: norm(sine(220, 219, 3.4), 0.22), at: 0},
    );
    const N = b.length;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      b[i] *= Math.min(1, t / 0.35) * Math.min(1, (1 - t) / 0.3);
    }
    return norm(b, 0.8);
  },
  // 纸页轻翻（字幕卡出现）
  page: () => fade(envHann(bandpass(noise(0.16), 1400, 750, 1.2)), 0.01, 0.05),
  // 气息蓬（Zzz/呼吸）
  puff: () => {
    const n = noise(0.9);
    const out = new Float32Array(n.length);
    let lp = 0;
    for (let i = 0; i < n.length; i++) {
      lp += 0.06 * (n[i] - lp);
      out[i] = lp;
    }
    const N = out.length;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      out[i] *= Math.min(1, t / 0.3) * Math.pow(1 - t, 1.5);
    }
    return norm(out, 0.8);
  },
  // 线条描绘（连接线/下划线）
  draw: () => {
    const n = noise(0.3);
    const out = envHann(bandpass(n, 2100, 1500, 3));
    for (let i = 0; i < out.length; i++) {
      out[i] *= 1 + 0.4 * Math.sin((2 * Math.PI * 9 * i) / SR);
    }
    return norm(out, 0.7);
  },
  // 木塔落定
  settle: () => mix({buf: norm(sine(150, 88, 0.3, 0.09), 0.8), at: 0}, {buf: norm(bandpass(noise(0.05), 400, 400, 1.5), 0.5), at: 0}),
};

/* ---------- 写 WAV / 全库合成 ---------- */
/** 非有限值直接抛错（旧版夹取让 NaN 伪装成 0 落盘，事故见 PLAN_ARCHIVE 批 0）。 */
const writeWav = (dir, name, buf) => {
  const pcm = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) {
      throw new Error(`writeWav(${name}): 样本 ${i} 非有限值（${v}）——拒绝写入垃圾数据`);
    }
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);
  hdr.writeUInt32LE(36 + pcm.length, 4);
  hdr.write('WAVEfmt ', 8);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(SR, 24);
  hdr.writeUInt32LE(SR * 2, 28);
  hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36);
  hdr.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.join(dir, name + '.wav'), Buffer.concat([hdr, pcm]));
};

/**
 * 落盘回读校验：把刚写的 WAV 读回来算统计量，验证它"看起来像音效"。
 * 防的是：合成数值坏掉但封装合法（旧 bandpass 发散正是这种情形）。
 * 判据（对照 15 个已知良好音效实测值）：
 *   - 双极性：max > 0 且 min < 0（单边饱和 = 发散特征）
 *   - 振幅合理：rms 落在 [500, 20000]（满幅噪声 rms>30000，静音接近 0）
 *   - 非全零：零样本率 < 50%
 */
const verifyWav = (file) => {
  const b = fs.readFileSync(file);
  const body = b.subarray(44);
  const n = body.length / 2;
  if (n === 0) throw new Error(`${path.basename(file)}: 空音频`);
  let sum = 0, mn = 0, mx = 0, zero = 0;
  for (let i = 0; i < n; i++) {
    const v = body.readInt16LE(i * 2);
    sum += v * v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    if (v === 0) zero++;
  }
  const rms = Math.sqrt(sum / n);
  const zeros = (zero / n) * 100;
  const errs = [];
  if (!(mx > 0)) errs.push(`峰值非正（max=${mx}，单边饱和=发散特征）`);
  if (!(mn < 0)) errs.push(`峰值非负（min=${mn}）`);
  if (rms < 500) errs.push(`振幅过低（rms=${rms.toFixed(0)}）`);
  if (rms > 20000) errs.push(`振幅过高（rms=${rms.toFixed(0)}，疑似满幅噪声）`);
  if (zeros >= 50) errs.push(`零样本率过高（${zeros.toFixed(1)}%）`);
  return {rms, mn, mx, zeros, errs};
};

const synthAll = (dir = 'out/sfx') => {
  fs.mkdirSync(dir, {recursive: true});
  const names = Object.keys(LIB);
  const report = [];
  for (const name of names) {
    const file = path.join(dir, name + '.wav');
    let buf;
    try {
      buf = norm(LIB[name](), 1);
    } catch (e) {
      throw new Error(`合成 ${name} 失败：${e.message}`);
    }
    writeWav(dir, name, buf);
    const v = verifyWav(file);
    if (v.errs.length) {
      throw new Error(`音效 ${name} 落盘校验失败：${v.errs.join('；')}`);
    }
    report.push({name, ...v});
  }
  const worstRms = Math.max(...report.map((r) => r.rms));
  console.log(`synthesized ${names.length} sfx -> ${dir}/`);
  console.log(`  校验通过：rms ${Math.min(...report.map((r) => r.rms)).toFixed(0)}~${worstRms.toFixed(0)}，全部双极性`);
  return report;
};

/* ---------- 排期解析 ---------- */
/**
 * kw 首字显出帧（PLAN §1.4：与渲染端/审计端同一公式源 charStepFor）。
 * 渲染端实际时序（trader/coder/harvest chrome.tsx）：lineStart = 4 + li*18，
 * 第 gi 字从 lineStart + gi*charStep 起显——kw 段首字的全局序号正是 before，
 * 所在行的行号就是遍历到的 li。旧公式 `6 + before*2.2` 与渲染公式是两套，
 * charStepFor 自适应区间一旦被触发（卡变短/字变多）就会分叉。
 */
const kwRevealOffset = (card) => {
  if (!card.lines) return 10;
  const {charStepFor} = require('./script_loader.cjs');
  let before = 0;
  let total = 0;
  for (const line of card.lines) for (const seg of line) total += seg.t.replace(/\s/g, '').length;
  const step = charStepFor(card.dur, total);
  let li = 0;
  for (const line of card.lines) {
    for (const seg of line) {
      if (seg.kw) return Math.round(4 + li * 18 + before * step);
      before += seg.t.replace(/\s/g, '').length;
    }
    li++;
  }
  return 10; // 无 kw 卡：回退到起步附近
};

/**
 * cues: (number[]|object)[]，ctx: {CARDS?, SCENES?, FPS?}
 * 返回 [{frame, sound, vol}]。绝对帧锚定卡片时校验往返一致，锚不上报错。
 */
const resolveCues = (cues, ctx = {}) => {
  const FPS = ctx.FPS || 30;
  const cards = ctx.CARDS || [];
  const scenes = ctx.SCENES || {};
  const cardAt = (f) => {
    for (let i = cards.length - 1; i >= 0; i--) {
      if (f >= cards[i].from) return i;
    }
    return -1;
  };
  return cues.map((cue, i) => {
    if (Array.isArray(cue)) {
      // 数组格式：[frame, sound, vol] 或 [frame, sound, vol, pitch]
      // pitch 单位 = 半音，可选（机制见 buildMix 的 rubberband 说明）
      const [frame, sound, vol, pitch] = cue;
      if (cards.length) {
        const ci = cardAt(frame);
        if (ci < 0) throw new Error(`cue#${i} @${frame} 不在任何卡片内——先检查 CARDS 覆盖 [0,${frame}]`);
        const back = cards[ci].from + Math.round(frame - cards[ci].from);
        if (back !== frame) throw new Error(`cue#${i} @${frame} 锚定往返不一致（${back}）`);
      }
      return pitch == null ? {frame, sound, vol} : {frame, sound, vol, pitch};
    }
    const {sound, vol = -20, pitch} = cue;
    if (cue.card != null) {
      const c = cards[cue.card];
      if (!c) throw new Error(`cue#${i} card#${cue.card} 不存在（共 ${cards.length} 卡）`);
      let off = cue.at;
      if (cue.at === 'end') off = c.dur - 16;
      else if (cue.at === 'kw') off = kwRevealOffset(c);
      const out = {frame: Math.round(c.from + off), sound, vol};
      return pitch == null ? out : {...out, pitch};
    }
    if (cue.scene != null) {
      const s = scenes[cue.scene];
      if (!s) throw new Error(`cue#${i} scene "${cue.scene}" 不存在`);
      const out = {frame: Math.round(s[0] + cue.at), sound, vol};
      return pitch == null ? out : {...out, pitch};
    }
    throw new Error(`cue#${i} 格式不认识: ${JSON.stringify(cue)}`);
  });
};

/**
 * 排期自检：同 (frame, sound) 重复 = 排期表复制粘贴事故（harvest 曾因此 12 组 pop 叠加 +6dB）。
 * 同时检查同帧音效总数，超过 3 个提示（会推高瞬时峰值、可能触发 alimiter）。
 * 只告警不篡改——是否真的要去掉由人决定，但绝不能静默通过。
 */
const lintCues = (resolved, label = 'cues') => {
  const seen = new Map();
  for (const {frame, sound} of resolved) {
    const k = `${frame}|${sound}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length) {
    console.warn(`\n⚠ ${label}：${dups.length} 组 (frame|sound) 重复——同帧叠加会抬高音量`);
    dups.slice(0, 12).forEach(([k, n]) => console.warn(`    ${k} ×${n}`));
    if (dups.length > 12) console.warn(`    …另有 ${dups.length - 12} 组`);
  }
  const byFrame = new Map();
  for (const {frame} of resolved) byFrame.set(frame, (byFrame.get(frame) || 0) + 1);
  const heavy = [...byFrame.entries()].filter(([, n]) => n > 3);
  if (heavy.length) {
    console.warn(`⚠ ${label}：${heavy.length} 个帧位音效数 >3（可能触发压限）`);
    heavy.slice(0, 8).forEach(([f, n]) => console.warn(`    f${f} 有 ${n} 个音效`));
  }
  return {dups, heavy};
};

/* ---------- ffmpeg 混音 ---------- */
/**
 * opts: {
 *   video: 'out/x-raw.mp4', bgm: paths.BGM_FLAC,
 *   ss?, t?,                       BGM 切片（换歌时改这里）
 *   bgmChain: 'highshelf=...,lowpass=...,volume=0.28,afade=in...,afade=out...',
 *   cues: [...], sfxDir = 'out/sfx', out: '成片路径',
 * }
 */
const buildMix = (opts) => {
  const cues = opts.cues;
  const useBgm = !opts.skipBgm; // 无BGM版：只有音效(+配音)，跳过 BGM 输入与切片校验
  // 防 -shortest 静默截断（第十批事故）：BGM 切片必须覆盖视频全长
  if (useBgm) {
    let vd = NaN;
    try {
      vd = parseFloat(execFileSync(FP, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', opts.video.replace(/\\/g, '/')], {encoding: 'utf8'}));
    } catch { /* 探测失败 → 跳过检查（不拦产线），6c 复核兜底 */ }
        if (isFinite(vd) && !(opts.t >= vd - 0.3)) {
      throw new Error(`BGM 切片 ${opts.t}s 短于视频 ${vd.toFixed(1)}s —— -shortest 会把成片截断。加长 t ≥ 视频时长 + 余量。`);
    }
    if (opts.t == null) {
      console.warn('⚠ buildMix 未收到 t：混音时长将跟随视频，BGM 长于视频时可行，短于则截断。');
    }
  }
  lintCues(cues, path.basename(opts.out || 'mix'));

  const fps = opts.fps || 30;
  if (opts.fps == null) {
    console.warn('⚠ buildMix 未收到 fps，回退 30 —— 请从 script.ts 的 FPS 传入。');
  }
  void fps;

  /** 每种音效只 -i 一次 + asplit 扇出（109→21 路输入）。实测详见 PLAN_ARCHIVE 批 7。 */
  const soundNames = [...new Set(cues.map((c) => c.sound))].sort();
  const soundIdx = new Map(soundNames.map((n, i) => [n, i]));
  // 统计每种音效被用几次（决定 asplit 的分支数）
  const useCount = new Map();
  cues.forEach((c) => useCount.set(c.sound, (useCount.get(c.sound) || 0) + 1));

  const inputs = ['-i', opts.video];
  const sfxBase = useBgm ? 2 : 1; // 音效输入的起始索引（bgm 占 1 号位时后移）
  if (useBgm) {
    if (opts.ss != null) inputs.push('-ss', String(opts.ss));
    if (opts.t != null) inputs.push('-t', String(opts.t));
    inputs.push('-i', opts.bgm);
  }
  soundNames.forEach((n) =>
    inputs.push('-i', path.join(opts.sfxDir || 'out/sfx', n + '.wav').replace(/\\/g, '/')),
  );
  // 配音整轨（vo_build 产物）：单文件进 amix，loudnorm 归一。向后兼容——不传 opts.vo 行为不变
  let voIdx = -1;
  if (opts.vo && opts.vo.file) {
    voIdx = sfxBase + soundNames.length;
    inputs.push('-i', String(opts.vo.file).replace(/\\/g, '/'));
  }

  const chains = [];
  const mixIns = useBgm ? ['[bgm]'] : [];

  // 每种音效先 asplit 出所需的份数（只用 1 次就不必 split）
  const padInput = (n) => String(soundIdx.get(n) + sfxBase);
  const slotOf = new Map(); // sound → 已分配的分支序号
  soundNames.forEach((n) => {
    const need = useCount.get(n);
    if (need <= 1) {
      chains.push(`[${padInput(n)}:a]anull[sp_${n}_0]`);
    } else {
      const outs = Array.from({length: need}, (_, k) => `[sp_${n}_${k}]`).join('');
      chains.push(`[${padInput(n)}:a]asplit=${need}${outs}`);
    }
    slotOf.set(n, 0);
  });

  // 每个 cue 从对应音效的 split 分支取一路，加延迟与音量
  //
  // pitch（2026-10-12，PLAN §2.3）：同一音效反复出现时的音色疲劳问题。
  // showcase 排期里 `tick` 用了 34 次（节奏型卡：电量十格 / 标尺刻度 / 手指数数），
  // 全部同音色，长片里听感会麻。
  //
  // 解法**不改合成器**（保持"18 音一份拷贝"的复用边界），只在混音链上做音高偏移。
  //
  // ⚠️ 实现踩过的坑（都实测过，写下来免得重来）：
  //   1. `asetrate=N` + `aresample` 会**摧毁极短音频** —— tick 只有 30ms，
  //      实测 1323 样本 → 13 样本（几乎为空）。asetrate 只是改"采样率标签"，
  //      配合 aresample 时对短输入行为异常。
  //   2. `atempo` 同样对 30ms 输入失效（1323 → 29 样本）—— 它按窗口处理，太短会丢。
  //   3. `apad` 补长再处理也救不回来（链顺序导致换算错位）。
  //
  // ✅ 可行方案：**`rubberband`**（ffmpeg 内置的 time-stretch / pitch-shift 滤镜）。
  //    它专为此设计，对短音频也正确。受控验证（1000Hz 纯正弦，1 秒）：
  //      pitch=-4 → 794.0Hz（期望 793.7）  时长 1000ms 不变 ✅
  //      pitch=-2 → 890.5Hz（期望 890.9）  时长 1000ms 不变 ✅
  //      pitch=+2 → 1122.0Hz（期望 1122.5） 时长 1000ms 不变 ✅
  //      pitch=+4 → 1259.0Hz（期望 1259.9） 时长 1000ms 不变 ✅
  //    即：音高精确变化、时长严格不变。
  //
  // 用半音而非倍率：写排期时"升高一点"用半音更好把握。
  //   pitch: +2 → 升高 2 个半音（×2^(2/12) ≈ 1.1225）
  cues.forEach(({sound, frame, vol, pitch}, i) => {
    const ms = Math.round((frame / fps) * 1000);
    const k = slotOf.get(sound);
    slotOf.set(sound, k + 1);
    const tag = `s${i}`;
    // 微动层（≤-22dB）整体抬 4dB，保证可感；重音层不动
    const v = vol <= -22 ? vol + 4 : vol;

    let pitchChain = '';
    if (pitch) {
      const ratio = Math.pow(2, pitch / 12); // 半音 → 频率倍率
      // tempo=1 表示"不改时长"，只改音高
      pitchChain = `rubberband=pitch=${ratio.toFixed(6)}:tempo=1,`;
    }

    chains.push(
      `[sp_${sound}_${k}]${pitchChain}adelay=${ms}:all=1,volume=${v}dB,afade=t=in:st=0:d=0.004[${tag}]`,
    );
    mixIns.push(`[${tag}]`);
  });

  // 配音轨：loudnorm 归一（语音进片不压 BGM 也不被压），resample 回 48k 供 amix 协商
  if (voIdx >= 0) {
    // 人声抛光默认链（2026-10-18 验收定版）：去轰鸣/去房间尾音/去刺/去齿音/加磁性——不改音色身份；显式传 '' 可关闭
    const postEq = opts.vo.postEq !== undefined ? opts.vo.postEq : 'highpass=f=75,afftdn=nr=10:nf=-30,equalizer=f=3400:t=q:w=1.4:g=-2.2,highshelf=f=9500:g=-2.5,equalizer=f=180:t=q:w=1.2:g=1.5';
    const postEqStr = postEq ? ',' + postEq : '';
    chains.push(`[${voIdx}:a]aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000${postEqStr}[vo]`);
    mixIns.push('[vo]');
  }

  if (useBgm) chains.push(`[1:a]${opts.bgmChain}[bgm]`);
  // 无 BGM 时 amix 的 longest 只到最后一轨语音结束，-shortest 会把视频截短；
  // apad 把音轨补到视频长度，-shortest 以 120s 视频为准（2026-10-18 配音无BGM版实测修复）。
  chains.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:normalize=0:duration=${useBgm ? 'first' : 'longest'}${useBgm ? '' : ',apad'},alimiter=limit=${opts.limiterLimit ?? 0.89}:level=disabled:level_in=${opts.limiterLevelIn ?? 1}[aout]`);
  // ⚠ level=disabled（2026-10-18）：alimiter 的 auto-level 默认开启，限幅后会把电平抬回满度，
  //   调低 limit 完全无效（配音版实测 TP 恒 0.1dBFS）。关掉后 limit 才是真天花板。
  //   level_in：响度不够时用输入增益顶（limit 封峰），别抬 limit。

  const args = [
    '-v', 'error',
    ...inputs,
    '-filter_complex', chains.join(';'),
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-y',
    opts.out,
  ];
  // execSync 走 cmd.exe 有 8191 字符上限，必须 execFileSync 数组传参
  execFileSync(FF, args, {stdio: 'inherit'});
  console.log('mixed ->', opts.out);
};

module.exports = {SR, LIB, synthAll, writeWav, verifyWav, resolveCues, lintCues, buildMix, kwRevealOffset};
