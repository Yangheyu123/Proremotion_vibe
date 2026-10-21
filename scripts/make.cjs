/*
 * 一键产线：从剧本到成片落库，固定顺序，闸门强制。
 * 用法：node scripts/make.cjs <film> [variant] [选项]
 *   film:    见 films.json（片目注册表；新片由 new_film.cjs 自动登记）
 *   variant: 画幅变体（缺省取第一个）
 *   --skip-proxy      跳过低清预渲（不推荐）
 *   --strict          剧本密度警告升级为拦截（新片建议开）
 *   --no-mix          渲到原始无声片为止（调试用）
 *   --overwrite       成片已存在时允许覆盖（保护已交付片子，默认拒绝覆盖）
 *   --dry-run         只打印将执行的步骤，不动任何文件
 *   --allow-jump      放行场景内断裂（丝滑检查 exit 3）
 *   --strict-loudness 响度偏差升级为拦截（默认只报告——四片实测一致，硬拦会堵死全线）
 *   --allow-loudness  （已废弃：响度默认不拦，无需放行）
 *   --overwrite-published 覆盖 ledger 里已发布的成片需此二次确认（PLAN §3.8）
 *   --allow-stale-rules   规则快照超 30 天被拦（compliance exit 4）时的逃生阀（PLAN §3.10）
 *   --force-render        忽略渲染缓存强制重渲（缓存=DVC「只重建脏阶段」哲学）
 * 强闯开关（2026-10-12 从单一 --force 拆开，各自独立，避免"闯一个全放行"）：
 *   --force-compliance  强闯合规闸门（高危片会限流）
 *   --force-dwell       强闯剧本密度闸门
 * 被强闯的项会记进 make-report.json 的 forced 字段，事后可追溯。
 * 流程（顺序即优先级，合规永远第 0 位；吸收 ffmpeg-skill 模式）：
 *   0 合规一审(RED=停) → 1 剧本体检 → 2 tsc → 3 低清代理预渲+丝滑
 *   → 4 全量渲染 → 4b ffprobe 实测验证 → 5 丝滑检查
 *   → 6 混音落库(拒绝覆盖) → 6b 响度体检 → 7 完播审计 → 报告+JSON 运行记录
 */
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {load, cardText} = require('./lib/script_loader.cjs');
const paths = require('./lib/paths.cjs');

const NODE = process.execPath;
const REMOTION = 'node_modules/@remotion/cli/remotion-cli.js'; // .cmd shim 的真实指向（dist/index.js 会静默退出不出片）
const TSC = 'node_modules/typescript/bin/tsc';
const FF = paths.FFMPEG;
const FP = paths.FFPROBE;
const LEDGER = paths.ANALYTICS_HOME + '/ledger.json'; // 发布台账（PLAN §3.8：覆盖保护要看发布状态）
const CONCURRENCY = 12; // 16 逻辑核实测余量安全值
/** 2026-10-19：Remotion 的 pre-encode 走系统 TEMP，Windows 沙箱/杀软会拒写（Permission denied）。
 *  统一改到仓内 out/tmp，随工作区可写；子进程经 env 继承。 */
const TMP_DIR = path.resolve('out/tmp');
fs.mkdirSync(TMP_DIR, {recursive: true});
const RENDER_ENV = {...process.env, TEMP: TMP_DIR, TMP: TMP_DIR};

/* ---------- 片目注册表 ----------
 * ⚠️ 2026-10-12：从内联常量外置为 films.json —— 原因是 new_film.cjs 只写 Root.tsx、
 * 不碰这里的 FILMS，导致新片出片时报"未知片名"（PLAN §1.3）。
 * 现在两个脚本共读写同一份 films.json，注册表由 new_film.cjs 自动追加。
 *
 * w/h 也不再手写：由 src/<片>/script.ts 导出的 W/H 派生（消除与 Root.tsx 的双重事实）。
 * 变体可用 wOverride/hOverride 显式覆盖（如 43 变体若有特殊尺寸需求）。 */
const FILMS_PATH = 'films.json';
if (!fs.existsSync(FILMS_PATH)) {
  console.error(`⛔ 找不到 ${FILMS_PATH} —— 片目注册表缺失。若刚从旧版本升级，见 PLAN §1.3。`);
  process.exit(1);
}
const FILMS_DOC = JSON.parse(fs.readFileSync(FILMS_PATH, 'utf8'));
const FILMS = FILMS_DOC.films || FILMS_DOC;

/** 变体的实际画幅：优先 override，否则从剧本真理源派生。 */
const resolveWH = (film, vk, v) => {
  if (v.wOverride && v.hOverride) return {w: v.wOverride, h: v.hOverride, from: 'override'};
  try {
    const m = load(film.script);
    if (m.W && m.H) return {w: m.W, h: m.H, from: 'script.ts'};
    throw new Error('script.ts 未导出 W/H');
  } catch (e) {
    console.error(`⛔ 无法从 ${film.script} 派生画幅（${e.message}）`);
    console.error(`   请在 films.json 的 ${film.title}[${vk}] 里加 wOverride/hOverride。`);
    process.exit(1);
  }
};

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const pos = argv.filter((a) => !a.startsWith('--'));
const filmKey = pos[0];
const variantKey = pos[1];

const film = FILMS[filmKey];
if (!film) {
  console.error(`未知片名 "${filmKey}"。可用：${Object.keys(FILMS).join(' | ')}`);
  process.exit(1);
}
const variants = Object.keys(film.variants);
const vk = variantKey || variants[0];
if (!film.variants[vk]) {
  console.error(`未知变体 "${vk}"。${filmKey} 可用：${variants.join(' | ')}`);
  process.exit(1);
}
const v = film.variants[vk];
// 画幅从剧本真理源派生后挂回 v（保持下游代码不变）
{
  const wh = resolveWH(film, vk, v);
  v.w = wh.w;
  v.h = wh.h;
  v._whFrom = wh.from;
}

/* ---------- 渲染输入指纹（DVC「只重建脏阶段」哲学，2026-10-12） ----------
 * 对渲染全部输入（剧本/src/lib/片目录/入口/渲染参数）做内容哈希。
 * 渲染成功后落 stamp（out/<film>-<vk>-render-stamp.json）；下次运行哈希一致
 * 且 raw 存在 → 跳过步骤 3/4（省 ~165s），只重跑混音后的轻步骤。--force-render 强制。 */
const crypto = require('crypto');
const hashFile = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const renderHashOf = () => {
  const h = crypto.createHash('md5');
  const dir = path.dirname(film.script);
  const files = [film.script, 'src/index.ts', 'src/Root.tsx', 'package.json'];
  for (const d of ['src/lib', dir]) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isFile()) files.push(p);
    }
  }
  files.sort().forEach((p) => h.update(p + ':' + hashFile(p)));
  h.update(`${v.comp}|${CONCURRENCY}|crf18|scale0.5`);
  return h.digest('hex');
};
const stampPath = `out/${filmKey}-${vk}-render-stamp.json`;
const cacheStatus = () => {
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    return stamp.hash === renderHashOf() && fs.existsSync(v.raw) ? `命中（${stamp.at}）` : '未命中（输入有变或无 stamp）';
  } catch {
    return '未命中（首次渲染）';
  }
};

const t0 = Date.now();
const stepsLog = [];
/** 记录被强闯的闸门，写进 make-report.json —— 事后可追溯哪一版是带着风险出片的。 */
const forcedLog = [];
/** 渲染缓存是否命中（模块层：writeReport 也要读它，别放 main 里——那会 ReferenceError） */
let renderCached = false;
let curStep = null;
/** 把当前步骤以指定结果收进日志（ok 反映"这一步真的跑完了"，与整体 status 无关）。 */
const seal = (ok = true) => {
  if (curStep) stepsLog.push({...curStep, ok, ms: Date.now() - curStep._t});
  curStep = null;
};
const step = (n, name) => {
  seal(true); // 上一阶段被推进到下一阶段 = 它成功了
  curStep = {n, name, _t: Date.now()};
  console.log(`\n━━━ [${n}] ${name} ━━━`);
};
const run = (cmd, args, opts = {}) => execFileSync(NODE, [cmd, ...args], {stdio: 'inherit', ...opts});
const elapsed = () => `(${((Date.now() - t0) / 1000).toFixed(0)}s)`;
/**
 * ⚠️ 2026-10-12 修正：旧实现用 `ok: status === 'done'` 判定最后一步，
 * 导致走 --no-mix 早退时（status='done:no-mix'）把已成功的丝滑检查记成 ok:false
 * （实测 out/dashui-9x16-make-report.json 步骤 5 就是假失败）。
 * 现在改为：最后一步是否成功由 seal() 决定，writeReport 只负责落盘。
 */
const writeReport = (status, extra = {}, lastStepOk = status.startsWith('done') || status === 'no-mix') => {
  seal(lastStepOk);
  const rep = {
    film: filmKey, variant: vk, title: film.title, status,
    started_at: new Date(t0).toISOString(),
    duration_s: Math.round((Date.now() - t0) / 1000),
    steps: stepsLog.map(({_t, ...s}) => s),
    ...(renderCached ? {render_cached: true, render_cached_note: '渲染输入未变，本帧来自缓存（§第八批 DVC 哲学）'} : {}),
    ...(forcedLog.length ? {forced: forcedLog, forced_note: '这些闸门被显式强闯——出片带已知风险'} : {}),
    ...extra,
  };
  const repPath = `out/${filmKey}-${vk}-make-report.json`;
  fs.writeFileSync(repPath, JSON.stringify(rep, null, 1));
  return repPath;
};

/* ---------- doctor：开工前能力检查（ffmpeg-skill 模式） ---------- */
for (const [label, p] of [['ffmpeg', FF], ['ffprobe', FP], ['remotion cli', REMOTION]]) {
  if (!fs.existsSync(p)) {
    console.error(`⛔ doctor：缺 ${label}（${p}）——先补工具再开工`);
    process.exit(1);
  }
}
if (!fs.existsSync('src/index.ts')) {
  console.error('⛔ doctor：找不到 src/index.ts（要在 remotion-vibe 根目录跑）');
  process.exit(1);
}

console.log(`\n▶ 产线开跑：${film.title} [${vk}] ${v.w}x${v.h}（画幅来自 ${v._whFrom}）`);

// 变体级代理路径：带 vk 后缀，避免不同变体互相覆盖（PLAN §1.0i）
const proxy = `out/${filmKey}-${vk}-proxy.mp4`;

if (flags.has('--dry-run')) {
  const reuseNote = v.reuseRawFrom ? `（复用 ${v.reuseRawFrom} 的 raw，跳过渲染）` : '';
  console.log(`
--dry-run 计划（不执行）：
  0 合规一审     node scripts/compliance_check.cjs ${film.script}
  1 剧本体检     node scripts/dwell_check.cjs ${film.script}
  2 类型检查     tsc --noEmit
${flags.has('--skip-proxy') || v.reuseRawFrom ? '' : `  3 代理预渲     ${v.comp} → ${proxy} (--scale=0.5 --crf=30) + 丝滑
` }  4 全量渲染     ${v.comp} → ${v.raw} (--crf=18 --concurrency=${CONCURRENCY})${reuseNote}
  4b 实测验证    ffprobe 时长/分辨率 vs ${v.w}x${v.h} / ${(load(film.script).TOTAL / (load(film.script).FPS || 30)).toFixed(1)}s
  5 丝滑检查     node scripts/smooth_check.cjs ${v.raw} --script ${film.script}
  渲染缓存       ${cacheStatus()}（--force-render 强制重渲）
  6 混音落库     node ${v.sfx} ${v.sfxArgs.join(' ')} → ${v.deliver}${fs.existsSync(v.deliver) ? ' ⚠ 已存在，需 --overwrite' : ''}
  6b 响度体检    node scripts/loudness_check.cjs（默认只报告；--strict-loudness 才拦）
  7 完播审计     film_audit → out/audit/${filmKey}-${vk}/
  报告           out/${filmKey}-${vk}-make-report.json`);
  process.exit(0);
}

/* ---------- 主流程 ----------
 * ⚠️ 2026-10-12：整个流程包在 try/catch 里（见文件末尾 main()），
 * 否则步骤 2/4/6 失败时进程直接崩，make-report.json 保持上一次的旧内容，
 * 运维看到"上次成功"会误判——最贵的两步（全量渲染 76s+、混音）尤其危险。 */
const main = () => {

/* ---------- 0 合规一审（一票否决） ---------- */
step(0, '合规一审');
try {
  run('scripts/compliance_check.cjs', [film.script]);
} catch (e) {
  if (e.status === 3 && !flags.has('--force-compliance')) {
    console.error('\n⛔ 合规高危——不发抖音。改写剧本后重跑，或确认风险后 --force-compliance 强闯（会限流）。产线终止。');
    writeReport('aborted:compliance');
    process.exit(3);
  }
  if (e.status === 3) {
    console.log('⚠ --force-compliance 强闯合规闸门——发布后果自负');
    forcedLog.push('compliance');
  }
  // PLAN §3.10：快照超 30 天 = 合规知识过期，独立于内容判级，逃生阀也独立
  if (e.status === 4 && !flags.has('--allow-stale-rules')) {
    console.error('\n⛔ 规则快照超 30 天——先做三审、更新词表、落新快照，或 --allow-stale-rules 强闯（记入报告）。产线终止。');
    writeReport('aborted:stale-rules');
    process.exit(4);
  }
  if (e.status === 4) {
    console.log('⚠ --allow-stale-rules：带着过期规则快照出片——发布前务必手动补三审');
    forcedLog.push('stale-rules');
  }
}

/* ---------- 1 剧本体检 ---------- */
step(1, '剧本体检（密度/行长/kw/闭合）');
try {
  run('scripts/dwell_check.cjs', [film.script]);
} catch (e) {
  // ⚠️ 2026-10-12：--strict 与 --force 解耦。旧实现 `--strict && !--force` 让
  // 两个开关互斥——为了闯合规而加 --force 时，密度硬拦会静默失效。
  // 现在是独立开关：--force-dwell 只放行密度，--strict 只决定密度是否硬拦。
  if (e.status === 2 && flags.has('--strict') && !flags.has('--force-dwell')) {
    console.error('\n⛔ --strict 模式：剧本密度红线不放过。改剧本（延时长/精简文案）后重跑。产线终止。');
    writeReport('aborted:dwell');
    process.exit(2);
  }
  if (e.status === 2) {
    if (flags.has('--force-dwell')) {
      console.log('⚠ --force-dwell 强闯密度闸门');
      forcedLog.push('dwell');
    } else {
      console.log('⚠ 密度偏快（软闸警告，继续）——观众看不清是完播率杀手，新片建议改剧本或 --strict 硬拦');
    }
  }
}

/* ---------- 2 类型检查 ---------- */
step(2, 'tsc 类型检查');
try {
  run(TSC, ['--noEmit']);
} catch (e) {
  console.error('\n⛔ 类型检查失败——先修 TS 错误再出片。');
  writeReport('failed:tsc', {error: String(e.message || e)});
  process.exit(2);
}

/* ---------- 3 低清代理预渲 + 丝滑 ---------- */
const reuseFrom = v.reuseRawFrom;
let skipRender = !!reuseFrom;
if (!skipRender && !flags.has('--force-render')) {
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    if (stamp.hash === renderHashOf() && fs.existsSync(v.raw)) {
      skipRender = true;
      renderCached = true;
      console.log(`⏩ 渲染缓存命中（输入自 ${stamp.at} 起未变）——跳过代理与全量渲染，--force-render 可强制。`);
    }
  } catch { /* 无 stamp 或损坏 → 正常渲染 */ }
}

if (skipRender && !renderCached) {
  const src = film.variants[reuseFrom];
  if (!src) {
    console.error(`⛔ ${filmKey}[${vk}] 的 reuseRawFrom="${reuseFrom}" 指向不存在的变体。`);
    process.exit(1);
  }
  if (!fs.existsSync(src.raw)) {
    console.error(`⛔ ${filmKey}[${vk}] 需复用 ${reuseFrom} 的 raw（${src.raw}），但该文件不存在。`);
    console.error(`   先跑：node scripts/make.cjs ${filmKey} ${reuseFrom}`);
    process.exit(1);
  }
  step(3, `跳过渲染（复用 ${reuseFrom} 的 ${src.raw}）`);
  console.log(`   reuseRawFrom=${reuseFrom}：本变体只做混音，不重复渲染。`);
  step(4, `跳过全量渲染（复用 ${src.raw}）`);
}
if (renderCached) {
  step(3, '跳过代理预渲（渲染缓存命中）');
  step(4, '跳过全量渲染（渲染缓存命中）');
}

if (!skipRender && !flags.has('--skip-proxy')) {
  step(3, `低清代理预渲 → ${proxy}`);
  run(REMOTION, [
    'render', 'src/index.ts', v.comp, proxy,
    '--codec=h264', '--crf=30', '--scale=0.5', `--concurrency=${CONCURRENCY}`, '--log=error',
  ], {env: RENDER_ENV});
  step('3b', '代理丝滑检查（转场断裂早发现）');
  // --allow-jump 透传：hero 弹入等设计事件在代理级也会产生孤立小尖峰（终检闸门同样放行）
  run('scripts/smooth_check.cjs', [proxy, '--script', film.script, ...(flags.has('--allow-jump') ? ['--allow-jump'] : [])]);
  console.log('（代理如有 JUMP：先抽帧定位，改完再全量，省一轮 5 分钟渲染）');
  console.log('（代理如有 JUMP：先抽帧定位，改完再全量，省一轮 5 分钟渲染）');
}

/* ---------- 4 全量渲染 ---------- */
if (!skipRender) {
  step(4, `全量渲染 → ${v.raw}`);
  try {
    run(REMOTION, [
      'render', 'src/index.ts', v.comp, v.raw,
      '--codec=h264', '--crf=18', `--concurrency=${CONCURRENCY}`, '--log=error',
    ], {env: RENDER_ENV});
  } catch (e) {
    console.error(`\n⛔ 全量渲染失败（${v.comp} → ${v.raw}）——这是最贵的一步，报告已落盘以便定位。`);
    writeReport('failed:render', {error: String(e.message || e)});
    process.exit(4);
  }
  // 渲染成功 → 落输入指纹 stamp（下次同输入直接命中缓存）
  fs.writeFileSync(stampPath, JSON.stringify({hash: renderHashOf(), raw: v.raw, at: new Date().toISOString().slice(0, 16)}, null, 1));
}

/* ---------- 4b 实测验证：不信任退出码，验产物（ffmpeg-skill 模式） ---------- */
step('4b', 'ffprobe 实测验证（时长/分辨率）');
const scriptMeta = load(film.script);
const expectDur = scriptMeta.TOTAL / (scriptMeta.FPS || 30);
const probe = execFileSync(
  FP,
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'default=nw=1', v.raw],
  {encoding: 'utf8'},
);
const meta = Object.fromEntries(probe.trim().split('\n').map((l) => l.split('=')));
const durErr = Math.abs(parseFloat(meta.duration || '0') - expectDur);
if (!meta.width || parseInt(meta.width, 10) !== v.w || parseInt(meta.height, 10) !== v.h || durErr > 0.2) {
  console.error(`⛔ 产物与预期不符！实测 ${meta.width}x${meta.height} ${meta.duration}s，预期 ${v.w}x${v.h} ${expectDur.toFixed(1)}s`);
  writeReport('failed:verify');
  process.exit(4);
}
console.log(`实测 OK：${meta.width}x${meta.height} ${parseFloat(meta.duration).toFixed(2)}s（预期 ${expectDur.toFixed(1)}s）`);

/* ---------- 5 丝滑检查 ---------- */
step(5, '全量丝滑检查');
try {
  run('scripts/smooth_check.cjs', [v.raw, '--script', film.script, ...(flags.has('--allow-jump') ? ['--allow-jump'] : [])]);
} catch (e) {
  if (e.status === 3 && !flags.has('--allow-jump')) {
    console.error('\n⛔ 检出场景内断裂——抽帧目检后修复；确认无害加 --allow-jump。产线终止。');
    writeReport('aborted:jump', {raw: v.raw});
    process.exit(3);
  }
  if (e.status === 3) console.log('⚠ --allow-jump：放行断裂。');
}

if (flags.has('--no-mix')) {
  const p = writeReport('done:no-mix', {raw: v.raw});
  console.log(`\n--no-mix：停在原始无声片 ${v.raw} ${elapsed()}（报告：${p}）`);
  process.exit(0);
}

/* ---------- 6 混音落库（拒绝覆盖已交付成片，ffmpeg-skill 模式） ---------- */
step(6, `混音 → ${v.deliver}`);
if (fs.existsSync(v.deliver) && !flags.has('--overwrite')) {
  console.error(`⛔ 成片已存在：${v.deliver}`);
  console.error('   已交付片子不悄悄覆盖——确认要重出就加 --overwrite（旧片会被顶掉）。产线终止。');
  writeReport('aborted:deliver-exists');
  process.exit(5);
}
// PLAN §3.8：覆盖保护原来只看文件存在——已发布的片子（ledger 有 published_at）
// 被顶掉等于线上内容被换，必须比 --overwrite 更高的确认门槛。
try {
  const entry = (JSON.parse(fs.readFileSync(LEDGER, 'utf8')).films || []).find((x) => x.id === filmKey);
  if (entry && entry.published_at && !flags.has('--overwrite-published')) {
    console.error(`⛔ ${filmKey} 已于 ${entry.published_at} 发布（analytics/ledger.json）——重出会顶掉线上版本。`);
    console.error('   确认要覆盖已发布成片：加 --overwrite-published（会记入报告 forced）。产线终止。');
    writeReport('aborted:published-overwrite');
    process.exit(5);
  }
  if (entry && entry.published_at && flags.has('--overwrite-published')) {
    console.log('⚠ --overwrite-published：覆盖已发布成片——后果记录在案');
    forcedLog.push('published-overwrite');
  }
} catch (e) {
  console.warn(`⚠ ledger.json 读取失败（${e.message}）——发布状态保护本次跳过（不拦产线，但请修台账）`);
}
try {
  run(v.sfx, v.sfxArgs);
} catch (e) {
  console.error(`\n⛔ 混音失败（${v.sfx}）——raw 产物 ${v.raw} 完好，修好脚本可直接重跑混音。`);
  writeReport('failed:mix', {error: String(e.message || e), raw: v.raw});
  process.exit(6);
}
/* 6c 防 -shortest 截断复核（第十批事故）：容器时长与音轨时长差 > 0.5s = 视频被截 */
{
  const fmt = parseFloat(execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', v.deliver], {encoding: 'utf8'}));
  const adur = parseFloat(execFileSync(FP, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', v.deliver], {encoding: 'utf8'}));
  if (isFinite(fmt) && isFinite(adur) && Math.abs(fmt - adur) > 0.5) {
    console.error(`⛔ 成片疑似被截断：容器 ${fmt.toFixed(1)}s vs 音轨 ${adur.toFixed(1)}s——检查 sfx 脚本的 t 是否 ≥ 视频时长。`);
    writeReport('failed:truncated');
    process.exit(8);
  }
  console.log(`截断复核 OK：容器/音轨 ${fmt.toFixed(1)}s / ${adur.toFixed(1)}s`);
}

/* ---------- 6b 响度体检（新增：此前 7 道闸门无一项测音频） ----------
 * 默认只报告不拦（四片实测 -20~-21 LUFS，是一贯风格；设硬闸门会堵死全线）。
 * --strict-loudness 才升级为拦截 —— 这是"先看见、再决定"的渐进路径。 */
step('6b', '响度体检（LUFS / true peak）');
try {
  run('scripts/loudness_check.cjs', [v.deliver, ...(flags.has('--strict-loudness') ? ['--strict'] : [])]);
} catch (e) {
  if (e.status === 3) {
    console.error('\n⛔ 响度硬性问题（削波风险或测量失败）——必须处理。产线终止。');
    writeReport('aborted:loudness', {deliver: v.deliver});
    process.exit(7);
  }
}

/* ---------- 7 完播审计 ---------- */
step(7, '完播审计（联络表 + 抖音遮罩 + dwell）');
const m = scriptMeta;
// PLAN §3.9：审计按片分目录（历史联络表可并列比对），不再整树清空 out/audit
const auditDir = `out/audit/${filmKey}-${vk}`;
const cfgPath = `out/${filmKey}-audit-cfg.json`;
fs.writeFileSync(
  cfgPath,
  JSON.stringify(
    {
      fps: m.FPS || 30,
      total: m.TOTAL,
      w: v.w, // 供 film_audit 按画幅选遮罩模型（PLAN §2.4）
      h: v.h,
      outDir: auditDir,
      cards: m.CARDS.map((c) => ({from: c.from, dur: c.dur, text: cardText(c)})),
    },
    null,
    1,
  ),
);
run('scripts/film_audit.cjs', [v.deliver, cfgPath]);

/* ---------- 7b 连贯性审计（元素接力 / 硬切率） ----------
 * 把 METHOD.md 的"待改进①（跨场景元素继承）"变成可测数字。
 * cast.ts 的路径从**剧本路径**推导（script: 'src/<dir>/script.ts'），
 * 比用 filmKey 猜目录可靠 —— dashui/feihua 的 key 与其源码目录名并不一致。 */
step('7b', '连贯性审计（硬切率）');
{
  const scriptDir = path.dirname(film.script);
  const castFile = path.join(scriptDir, 'cast.ts');
  const args = [film.script];
  if (fs.existsSync(castFile)) {
    args.push('--cast', castFile);
  } else {
    console.log(`（${castFile} 不存在 —— 按无接力统计，硬切率会显示 100%）`);
  }
  try {
    run('scripts/continuity_check.cjs', args);
  } catch (e) {
    console.log('（连贯性审计未通过——仅报告，不阻断产线）');
  }
}

/* ---------- 报告 ---------- */
const repPath = writeReport('done', {deliver: v.deliver, raw: v.raw});
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 产线完成 ${elapsed()}（运行记录：${repPath}）
  成片：${v.deliver}
  审计：${auditDir}/sheet_raw.png（原图）/ sheet_mask.png（抖音遮罩模拟）
  丝滑：上方 JUMP=0 即全片连续；有 JUMP 抽帧目检

发布前还差三件事（机器管不了的）：
  1. 二审：自己重看 sheet_mask.png——"这条片会被审核员理解成什么？"
  2. 三审：检索当期抖音规则（快照超 14 天必做）
  3. 封面：用户自管（output/ 底片+提示词模板，每期只改标题；产线不生成封面）
发布后：数据截图放进该片文件夹的 数据截图/，进数据闭环。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

};

/* ---------- 顶层兜底 ----------
 * 任何未预期异常都要留下报告痕迹：否则 make-report.json 会保持上一次的旧内容，
 * 让人误以为"上一轮是成功的"。 */
try {
  main();
} catch (e) {
  console.error(`\n⛔ 产线异常终止于步骤 [${curStep ? curStep.n : '?'}] ${curStep ? curStep.name : ''}`);
  console.error(`   ${e.message || e}`);
  try {
    const p = writeReport(`failed:step${curStep ? curStep.n : '?'}`, {
      error: String(e.message || e),
      stack: String(e.stack || '').split('\n').slice(0, 5).join('\n'),
    }, false);
    console.error(`   失败报告已落盘：${p}`);
  } catch (e2) {
    console.error(`   （报告落盘也失败：${e2.message}）`);
  }
  process.exit(9);
}
