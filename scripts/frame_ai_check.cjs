/*
 * frame_ai_check —— 成片抽帧 + glm-5.3-flash 视觉质检。
 *
 * 用法：
 *   set ZHIPU_API_KEY=...   （PowerShell: $env:ZHIPU_API_KEY='...'）
 *   node scripts/frame_ai_check.cjs <video> --script src/aivsart/script_vo.ts [--out out/ai-check]
 *
 * 检查项：字幕裁切/重叠/乱码、主体遮挡、对比度、黑帧/穿帮、画面与台词错位。
 * 输出：<out>/report.json + report.md + frames/*.jpg
 *
 * 说明：API key 只从环境变量/命令行读取，不落盘；模型名固定 glm-5.3-flash。
 */
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {load, cardText} = require('./lib/script_loader.cjs');
const paths = require('./lib/paths.cjs');

const FF = paths.FFMPEG;
const FP = paths.FFPROBE;
const API = 'https://open.bigmodel.cn/api/anthropic/v1/messages';
const MODEL = 'glm-5.3-flash';

const argv = process.argv.slice(2);
const video = argv.find((a) => !a.startsWith('--'));
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
if (!video) {
  console.error('usage: node scripts/frame_ai_check.cjs <video> --script src/aivsart/script_vo.ts [--out dir]');
  process.exit(1);
}
const scriptPath = getArg('--script') || 'src/aivsart/script_vo.ts';
const outDir = getArg('--out') || 'out/ai-check';
const filmTitle = getArg('--title') || '短视频';
const filmDesc = getArg('--desc') || '科普知识短片';
const apiKey = process.env.ZHIPU_API_KEY || getArg('--api-key');
if (!apiKey) {
  console.error('🔴 缺 ZHIPU_API_KEY（或 --api-key）');
  process.exit(1);
}
fs.mkdirSync(path.join(outDir, 'frames'), {recursive: true});

const probe = (args) => execFileSync(FP, args, {encoding: 'utf8'}).trim();
const duration = parseFloat(probe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]));
if (!isFinite(duration) || duration < 1) {
  console.error(`🔴 视频时长异常: ${duration}`);
  process.exit(1);
}
const meta = load(scriptPath);
const cards = meta.CARDS || [];
if (!cards.length) {
  console.error('🔴 剧本没有 CARDS');
  process.exit(1);
}

// 抽帧点：每张卡的显出完成点（min(mid, dur-12)）+ 片尾最后一帧
const times = [];
const labels = [];
for (let i = 0; i < cards.length; i++) {
  const c = cards[i];
  const t = Math.min(duration - 0.05, (c.from + Math.max(18, c.dur - 14)) / (meta.FPS || 30));
  if (t <= 0.02) continue;
  if (times.some((x) => Math.abs(x - t) < 0.35)) continue;
  times.push(+t.toFixed(2));
  labels.push(`c${i} ${cardText(c).replace(/\n/g, ' / ').slice(0, 40)}`);
}
times.push(+(duration - 0.08).toFixed(2));
labels.push('END FRAME');

const frames = [];
for (let i = 0; i < times.length; i++) {
  const file = path.join(outDir, 'frames', `f${String(i).padStart(2, '0')}_${times[i].toFixed(2)}s.jpg`);
  execFileSync(FF, [
    '-v', 'error',
    '-ss', String(times[i]),
    '-i', video,
    '-frames:v', '1',
    '-vf', 'scale=720:540:force_original_aspect_ratio=decrease,pad=720:540:(ow-iw)/2:(oh-ih)/2:color=black',
    '-q:v', '3',
    '-y', file,
  ]);
  frames.push({i, t: times[i], label: labels[i], file});
}
console.log(`抽帧 ${frames.length} 张 → ${outDir}/frames/`);

const b64 = (f) => fs.readFileSync(f).toString('base64');

const callModel = async (batch, batchIdx, totalBatches) => {
  const content = [
    {
      type: 'text',
      text:
        `你是短视频成片质检员。这是第 ${batchIdx}/${totalBatches} 批关键帧，来自一条 ${duration.toFixed(0)} 秒、1440x1080 的${filmDesc}《${filmTitle}》。\n` +
        `逐帧检查并只输出 JSON（不要 markdown 代码块）：\n` +
        `{"overall":"pass|warn|fail","frames":[{"t":<秒>,"label":"...","issues":["..."],"severity":"none|low|medium|high"}],"summary":"..."}\n` +
        `重点：1) 字幕是否被裁切/超出安全区/与画面文字重叠；2) 是否有乱码、缺字、错位；3) 主体是否被遮挡；4) 对比度是否足够；5) 是否有黑帧、穿帮、明显错帧；6) 画面语义是否与台词冲突。\n` +
        `没有问题就写 issues:[]、severity:"none"。不要评价风格喜好。`,
    },
  ];
  for (const f of batch) {
    content.push({type: 'text', text: `帧 t=${f.t}s · ${f.label}`});
    content.push({type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: b64(f.file)}});
  }
  const body = {
    model: MODEL,
    max_tokens: 12000,
    temperature: 0.1,
    system: '你是严谨的短视频画面质检员，只报告可观察的事实，不臆测。',
    messages: [{role: 'user', content}],
  };
  let res = null;
  let txt = '';
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      });
      txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 600)}`);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 4) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastErr) throw lastErr;
  const j = JSON.parse(txt);
  const text = (j.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return {text, usage: j.usage, stop: j.stop_reason};
};

(async () => {
  const batchSize = 3;
  const batches = [];
  for (let i = 0; i < frames.length; i += batchSize) batches.push(frames.slice(i, i + batchSize));
  const results = [];
  for (let i = 0; i < batches.length; i++) {
    console.log(`  → 模型质检批次 ${i + 1}/${batches.length}（${batches[i].length} 帧）`);
    const r = await callModel(batches[i], i + 1, batches.length);
    results.push({batch: i + 1, frames: batches[i].map((f) => ({t: f.t, label: f.label})), ...r});
  }

  const parsed = [];
  for (const r of results) {
    let obj = null;
    const m = r.text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        obj = null;
      }
    }
    parsed.push({batch: r.batch, frames: r.frames, model: obj, raw: r.text, stop: r.stop, usage: r.usage});
  }
  const allIssues = [];
  for (const p of parsed) {
    for (const f of p.model?.frames || []) {
      if (f.issues?.length) allIssues.push(f);
    }
  }
  const report = {
    video,
    script: scriptPath,
    model: MODEL,
    duration,
    frames: frames.map(({i, t, label}) => ({i, t, label})),
    overall: parsed.some((p) => p.model?.overall === 'fail')
      ? 'fail'
      : parsed.some((p) => p.model?.overall === 'warn') || allIssues.length
        ? 'warn'
        : 'pass',
    issues: allIssues,
    batches: parsed,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));

  const md = [
    `# 成片抽帧质检 · ${path.basename(video)}`,
    '',
    `- 模型：\`${MODEL}\`（智谱 Anthropic 兼容端点）`,
    `- 时长：${duration.toFixed(2)}s`,
    `- 抽帧：${frames.length} 张（每卡显出完成点 + 片尾）`,
    `- 结论：**${report.overall.toUpperCase()}**`,
    '',
    '## 模型逐帧结论',
    ...parsed.map((p) => {
      const lines = [`### 批次 ${p.batch}`];
      if (p.model?.summary) lines.push('', p.model.summary);
      for (const f of p.model?.frames || []) {
        lines.push(`- t=${f.t}s · ${f.label} · **${f.severity || 'none'}**${f.issues?.length ? '：' + f.issues.join('；') : ''}`);
      }
      return lines.join('\n');
    }),
    '',
    '## 原始返回',
    ...parsed.map((p) => `### 批次 ${p.batch}\n\n\`\`\`\n${p.raw}\n\`\`\``),
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'report.md'), md);
  console.log(`\n报告：${outDir}/report.json / report.md`);
  console.log(JSON.stringify({overall: report.overall, issues: allIssues.length}, null, 1));
})().catch((e) => {
  console.error('🔴', e.message || e);
  process.exit(1);
});
