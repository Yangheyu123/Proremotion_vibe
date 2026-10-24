/*
 * vo_build_scene —— 通用「逐卡配音 → 卡时长重排 → 派生 VO 组件」构建器。
 *
 * 与 vo_build.cjs 的区别：不做场景生长/节拍吸附，只按「每卡语音 + 尾息」重排卡时长，
 * 总长锁死在剧本 TOTAL（新片 60s 硬约束），多余帧均匀分给各卡尾部做呼吸。
 * 与 vo_build_strict.cjs 的区别：strict 按「场」整段合成，本器按「卡」合成，
 * 卡边界与语音严格对齐（字幕卡 = 一句话）。
 *
 * 用法：node scripts/vo_build_scene.cjs <filmKey> [--force] [--skip-tts] [--speed 1.12]
 * 前置：TTS 服务在线（127.0.0.1:9880）；voice/voice.json（paths.VOICE_JSON）= 音色单一事实源。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {load, cardText} = require('./lib/script_loader.cjs');
const paths = require('./lib/paths.cjs');

const FPS = 30;
const FF = paths.FFMPEG;
const FP = paths.FFPROBE;
const TTS_API = paths.TTS_API;
const BGM = paths.BGM_FLAC; // BGM 标准链路（2026-10-20 拍板）：assets/bgm.flac + 去刺耳链，换曲须用户拍板

/* ---------- 片目配置：注册表 = films.json（唯一事实源，2026-10-21 并入，消双登记）----------
 * 约定推导：chrome = <剧本目录>/chrome.tsx；comp = <剧本目录>/Film.tsx；outDir = out/vo_<key>。
 * 可选覆盖写在 films.json 片目的 vo 字段：{bgmSS, tailPad, endCardDur, leadIn}，缺省见 DEFAULT_VO。 */
const FILMS_DOC = JSON.parse(fs.readFileSync('films.json', 'utf8'));
const FILMS_META = FILMS_DOC.films || FILMS_DOC;
const DEFAULT_VO = {bgmSS: 45, tailPad: 0.58, endCardDur: 128, leadIn: 18};
const filmMetaOf = (k) => {
  const e = FILMS_META[k];
  if (!e?.script) return null;
  const dir = e.script.replace(/\/script(_vo)?\.ts$/, '');
  const vo = {...DEFAULT_VO, ...(e.vo || {})};
  return {
    script: e.script,
    chrome: `${dir}/chrome.tsx`,
    comp: `${dir}/Film.tsx`,
    outDir: `out/vo_${k}`,
    bgmSS: vo.bgmSS,
    tailPad: vo.tailPad,
    endCardDur: vo.endCardDur,
    leadIn: vo.leadIn,
  };
};

const argv = process.argv.slice(2);
const key = argv.find((a) => !a.startsWith('--'));
const getArg = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const FORCE = argv.includes('--force');
const SKIP_TTS = argv.includes('--skip-tts');
const SPEED = parseFloat(getArg('--speed') || '1.25');
const BASE = filmMetaOf(key);
if (!BASE) {
  console.error(`usage: node scripts/vo_build_scene.cjs <films.json 里的片 key> [--force] [--skip-tts] [--speed 1.25]`);
  process.exit(1);
}

const OUT_DIR = BASE.outDir;
const SCRIPT_VO = BASE.script.replace(/\.ts$/, '_vo.ts');
const CHROME_VO = BASE.chrome.replace(/\.tsx$/, '_vo.tsx');
const COMP_VO = BASE.comp.replace(/\.tsx$/, 'VO.tsx');
fs.mkdirSync(OUT_DIR, {recursive: true});

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const probeDur = (file) =>
  parseFloat(
    execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'}).trim(),
  );

const voice = JSON.parse(fs.readFileSync(paths.VOICE_JSON, 'utf8'));
const REF = voice.ref_audio;
const PROMPT = voice.prompt_text;
if (!fs.existsSync(REF)) {
  console.error(`🔴 参考音不存在: ${REF}`);
  process.exit(1);
}

const m = load(BASE.script);
if (!m.CARDS?.length || !m.TOTAL) {
  console.error('🔴 剧本缺 CARDS/TOTAL');
  process.exit(1);
}

/** 卡文本 → TTS 文本：行间已带标点就不再加逗号 */
const ttsTextOf = (card) => {
  const lines = cardText(card)
    .split('\n')
    .map((l) => l.replace(/·/g, '、').replace(/\s*—\s*/g, '，').trim())
    .filter(Boolean);
  return lines.reduce((acc, l, i) => {
    if (i === 0) return l;
    return /[，。？！、：…—]$/.test(acc) ? acc + l : acc + '，' + l;
  }, '');
};

const planPath = path.join(OUT_DIR, 'plan.json');
const oldPlan = fs.existsSync(planPath) ? JSON.parse(fs.readFileSync(planPath, 'utf8')) : {cards: []};

const synth = async (i, text, file, sp) => {
  const hash = md5(text + '|' + REF + '|' + PROMPT + '|' + sp);
  const prev = (oldPlan.cards || [])[i];
  if (!FORCE && prev && prev.hash === hash && fs.existsSync(file)) {
    return {hash, reused: true, dur: probeDur(file)};
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const body = JSON.stringify({
        text,
        text_lang: 'zh',
        ref_audio_path: REF.replace(/\\/g, '/'),
        prompt_text: PROMPT,
        prompt_lang: 'zh',
        text_split_method: 'cut5',
        speed_factor: sp,
      });
      const res = await fetch(TTS_API, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
        signal: AbortSignal.timeout(240000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error(`响应过小 ${buf.length}B`);
      fs.writeFileSync(file, buf);
      const dur = probeDur(file);
      if (!(dur > 0.3)) throw new Error(`时长异常 ${dur}`);
      /* 语速门（AGENTS 配音产线）：< 字数/7s = 退化生成（TTS 只念了碎片/吞句），
         必须重掷。card00 两次坏 take（有效语音 0.94-1.64s）就是没这道门漏出去的。 */
      const charCount = text.replace(/[，。？！、：…—,.?!;；：\s]/g, '').length;
      const minDur = charCount / 7;
      if (charCount >= 6 && dur < minDur) {
        throw new Error(`语速门：${charCount}字仅 ${dur.toFixed(2)}s（< ${minDur.toFixed(2)}s），疑似退化，重掷`);
      }
      return {hash, reused: false, dur};
    } catch (e) {
      lastErr = e;
      console.warn(`  ⚠ c${i} 第 ${attempt} 次合成失败: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  throw new Error(`c${i} 合成失败: ${lastErr?.message}`);
};

(async () => {
  console.log(`== vo_build_scene [${key}] ${m.CARDS.length} 卡，speed=${SPEED}，ref=${path.basename(REF)} ==`);
  if (!SKIP_TTS) {
    try {
      await fetch('http://127.0.0.1:9880/', {signal: AbortSignal.timeout(3000)});
    } catch {
      console.error('🔴 TTS 服务不在（127.0.0.1:9880）');
      process.exit(1);
    }
  }

  const voices = [];
  for (let i = 0; i < m.CARDS.length; i++) {
    const card = m.CARDS[i];
    const text = card.visualOnly ? '' : ttsTextOf(card);
    /* 逐卡语速（Card.speed）——节奏曲线：钩子快、思辨慢；缺省回落 --speed */
    const sp = card.speed ?? SPEED;
    if (!text) {
      voices.push({i, text: '', file: null, dur: 0, hash: null, reused: true});
      console.log(`  c${i}: 无旁白（visualOnly）`);
      continue;
    }
    const file = path.join(OUT_DIR, `card${String(i).padStart(2, '0')}.wav`).replace(/\\/g, '/');
    const r = SKIP_TTS
      ? fs.existsSync(file)
        ? {hash: 'skip', reused: true, dur: probeDur(file)}
        : (() => {
            throw new Error(`${file} 不存在（--skip-tts）`);
          })()
      : await synth(i, text, file, sp);
    const n = card.lines.reduce((a, l) => a + l.reduce((b, s) => b + s.t.replace(/\s/g, '').length, 0), 0);
    console.log(
      `  c${i}: ${r.dur.toFixed(2)}s / ${n}字（${(n / r.dur).toFixed(1)}字/s）×${sp.toFixed(2)}${r.reused ? ' [缓存]' : ''}`,
    );
    voices.push({i, text, file, dur: r.dur, hash: r.hash, reused: r.reused, speed: sp});
  }

  /* ---------- 1. 卡时长 = 语音 + 尾息；总长锁 TOTAL ---------- */
  /* 首句留白（2026-10-21 用户反馈"第一句话进入太快"）：第一张有声卡的语音延迟
     LEAD_IN 帧开口，给观众落座时间；卡时长同步加长，后续卡自动顺延。禁止 0 帧开口。 */
  const LEAD_IN = BASE.leadIn != null ? BASE.leadIn : 18; // 0.6s @30fps
  const firstVoiced = voices.findIndex((v) => v.file);
  const durs = m.CARDS.map((c, i) => {
    const v = voices[i];
    if (!v.file) return BASE.endCardDur;
    /* 逐卡尾息（Card.tailPad）——急促段收紧、停顿段放开；缺省回落片目 vo.tailPad */
    const tp = c.tailPad ?? BASE.tailPad;
    return Math.max(30, Math.ceil((v.dur + tp) * FPS)) + (i === firstVoiced ? LEAD_IN : 0);
  });
  let sum = durs.reduce((a, b) => a + b, 0);
  if (sum > m.TOTAL) {
    // 尾息收紧（按比例缩到 55%，下限 0.22s；首句留白保留，不许被收紧抹掉）
    for (let i = 0; i < durs.length; i++) {
      if (voices[i].file) {
        const tp = Math.max(0.22, (m.CARDS[i].tailPad ?? BASE.tailPad) * 0.55);
        durs[i] = Math.max(26, Math.ceil((voices[i].dur + tp) * FPS)) + (i === firstVoiced ? LEAD_IN : 0);
      }
    }
    sum = durs.reduce((a, b) => a + b, 0);
  }
  if (sum > m.TOTAL) {
    console.error(`🔴 语音总长 ${sum}f 超出片长 ${m.TOTAL}f —— 需要精简台词（约 ${Math.ceil((sum - m.TOTAL) / FPS)}s）`);
    process.exit(1);
  }
  const leftover = m.TOTAL - sum;
  const per = Math.floor(leftover / durs.length);
  for (let i = 0; i < durs.length; i++) durs[i] += per;
  durs[durs.length - 1] += leftover - per * durs.length;

  const froms = [];
  let acc = 0;
  for (let i = 0; i < durs.length; i++) {
    froms.push(acc);
    acc += durs[i];
  }
  if (acc !== m.TOTAL) {
    console.error(`🔴 卡总长 ${acc} ≠ TOTAL ${m.TOTAL}`);
    process.exit(1);
  }
  console.log(`\n== 重排：${sum}f → ${m.TOTAL}f（余 ${leftover}f 均匀分给 ${durs.length} 卡）==`);
  m.CARDS.forEach((c, i) => console.log(`  c${i}: ${c.from},${c.dur} → ${froms[i]},${durs[i]}（${(durs[i] / FPS).toFixed(1)}s）`));

  /* ---------- 2. 写 script_vo.ts ---------- */
  let src = fs.readFileSync(BASE.script, 'utf8');
  let ci = 0;
  src = src.replace(/\bfrom: \d+, dur: \d+,/g, () => {
    const out = `from: ${froms[ci]}, dur: ${durs[ci]},`;
    ci += 1;
    return out;
  });
  if (ci !== m.CARDS.length) {
    console.error(`🔴 CARDS 替换 ${ci} 处，应有 ${m.CARDS.length} 处`);
    process.exit(1);
  }
  const header = `/**
 * ⚠️ 由 scripts/vo_build_scene.cjs 生成（逐卡配音驱动节奏）——勿手改。
 * 基座 ${BASE.script}；总长锁 ${(m.TOTAL / FPS).toFixed(1)}s。
 */\n`;
  src = src.replace(/^export const TOTAL = [^;]+;/m, `export const TOTAL = ${m.TOTAL};`);

  /* ---------- 2b. 场景边界随卡重排（卡必须留在原场景内）---------- */
  const sceneKeys = m.SCENE_ORDER;
  const cardScene = m.CARDS.map((c) =>
    sceneKeys.find((k) => c.from >= m.SCENES[k][0] && c.from < m.SCENES[k][0] + m.SCENES[k][1]),
  );
  if (cardScene.some((k) => !k)) {
    console.error('🔴 有卡不属于任何场景——基座 SCENES/CARDS 先修');
    process.exit(1);
  }
  const sceneSpans = sceneKeys.map((k) => durs.reduce((a, d, i) => (cardScene[i] === k ? a + d : a), 0));
  const sceneFroms = sceneKeys.map((k) => {
    const first = cardScene.indexOf(k);
    return froms[first];
  });
  const sceneLines = sceneKeys.map((k, i) => `  ${k}: [${sceneFroms[i]}, ${sceneSpans[i]}],`).join('\n');
  if (!/export const SCENES = \{[\s\S]*?\} as const;/.test(src)) {
    console.error('🔴 剧本里找不到 SCENES 块');
    process.exit(1);
  }
  src = src.replace(/export const SCENES = \{[\s\S]*?\} as const;/, `export const SCENES = {\n${sceneLines}\n} as const;`);
  fs.writeFileSync(SCRIPT_VO, header + src.trimStart());

  /* ---------- 3. 拼 vo_full.wav ---------- */
  const inputs = [];
  const chains = [];
  const mixIns = [];
  voices.forEach((v, i) => {
    if (!v.file) return;
    inputs.push('-i', v.file);
    const idx = inputs.length / 2 - 1;
    const lead = i === firstVoiced ? LEAD_IN : 0; // 首句留白：语音在卡内延迟开口
    const delay = Math.round(((froms[i] + lead) / FPS) * 1000);
    const dur = v.dur.toFixed(3);
    chains.push(
      `[${idx}:a]aformat=sample_rates=44100:channel_layouts=mono,afade=t=in:st=0:d=0.03,afade=t=out:st=${Math.max(0, parseFloat(dur) - 0.06).toFixed(3)}:d=0.06,adelay=${delay}:all=1[a${i}]`,
    );
    mixIns.push(`[a${i}]`);
  });
  chains.push(
    `${mixIns.join('')}amix=inputs=${mixIns.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[vout]`,
  );
  const voFull = path.join(OUT_DIR, 'vo_full.wav').replace(/\\/g, '/');
  execFileSync(
    FF,
    ['-v', 'error', ...inputs, '-filter_complex', chains.join(';'), '-map', '[vout]', '-t', (m.TOTAL / FPS).toFixed(3), '-y', voFull],
    {stdio: 'inherit'},
  );
  console.log(`== 配音整轨 ${voFull}（${probeDur(voFull).toFixed(2)}s）==`);

  /* ---------- 4. 派生 chrome_vo / FilmVO ---------- */
  const derive = (inFile, outFile) => {
    let s = fs.readFileSync(inFile, 'utf8');
    const swaps = [
      ["from './script'", "from './script_vo'"],
      ["from './chrome'", "from './chrome_vo'"],
    ];
    let changed = 0;
    for (const [a, b] of swaps) {
      if (s.includes(a)) {
        s = s.split(a).join(b);
        changed++;
      }
    }
    if (!changed) throw new Error(`${inFile} 没有 './script'/'./chrome' import`);
    fs.writeFileSync(outFile, `/** ⚠️ 由 vo_build_scene.cjs 从 ${path.basename(inFile)} 派生（仅换 import） */\n` + s);
  };
  derive(BASE.chrome, CHROME_VO);
  derive(BASE.comp, COMP_VO);

  /* ---------- 5. 自检 ---------- */
  const v = load(SCRIPT_VO);
  const errs = [];
  if (v.TOTAL !== m.TOTAL) errs.push(`TOTAL 漂移 ${v.TOTAL} != ${m.TOTAL}`);
  v.CARDS.forEach((c, i) => {
    if (i > 0 && c.from !== v.CARDS[i - 1].from + v.CARDS[i - 1].dur) errs.push(`c${i} 与前卡不闭合`);
    const leadF = i === firstVoiced ? LEAD_IN : 0;
    if (voices[i].file && voices[i].dur + leadF / FPS + 0.15 > c.dur / FPS) errs.push(`c${i} 语音 ${voices[i].dur.toFixed(2)}s 超出卡 ${(c.dur / FPS).toFixed(2)}s`);
    if (c.dur < 20) errs.push(`c${i} 卡长 ${c.dur}f < 20f`);
  });
  if (v.CARDS[0].from !== 0) errs.push('首卡非 0');
  if (v.CARDS[v.CARDS.length - 1].from + v.CARDS[v.CARDS.length - 1].dur !== v.TOTAL) errs.push('末卡不闭合到 TOTAL');
  for (const k of m.SCENE_ORDER) {
    const s = v.SCENES[k];
    const cardsIn = v.CARDS.filter((c) => c.from >= s[0] && c.from < s[0] + s[1]);
    const ssum = cardsIn.reduce((a, c) => a + c.dur, 0);
    if (ssum !== s[1]) errs.push(`场景 ${k} 卡和 ${ssum} ≠ ${s[1]}`);
    if (!cardsIn.length) errs.push(`场景 ${k} 无卡`);
  }

  fs.writeFileSync(
    planPath,
    JSON.stringify(
      {
        film: key,
        fps: FPS,
        totalFrames: m.TOTAL,
        speed: SPEED,
        ref: REF,
        cards: voices.map((x, i) => ({
          i,
          text: x.text,
          file: x.file,
          hash: x.hash,
          speed: x.speed ?? SPEED,
          tailPad: m.CARDS[i].tailPad ?? BASE.tailPad,
          voiceDur: +x.dur.toFixed(3),
          from: froms[i],
          dur: durs[i],
        })),
      },
      null,
      1,
    ),
  );

  if (errs.length) {
    console.error(`\n🔴 自检失败:\n  ${errs.join('\n  ')}`);
    process.exit(3);
  }
  console.log('\n✅ 自检全绿：卡闭合 / 语音入卡 / 总长锁定');
  console.log(`下一步: node scripts/bake_pulse_env.cjs "${BGM}" ${BASE.bgmSS} 62 ${m.TOTAL} ${SCRIPT_VO}`);
})().catch((e) => {
  console.error('🔴', e.message || e);
  process.exit(1);
});
