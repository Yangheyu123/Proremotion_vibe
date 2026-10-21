# Proremotion_vibe

Remotion 知识短视频产线框架——从剧本到成片的一键流水线：合规一审 → 剧本体检 → 渲染 → 丝滑检查 → 混音 → 响度 → 完播审计，全链闸门化。

> 方法论全文见 [METHODOLOGY.md](METHODOLOGY.md)；每 session 强制加载的铁律见 [AGENTS.md](AGENTS.md)。
> 本仓库是**框架**：不含任何成片、音色、素材与个人数据——那些在 .gitignore 里，你自己往里放。

## 框架能力

| 层 | 机制 | 位置 |
|---|---|---|
| 一键产线 | 合规→体检→代理→渲染→丝滑→混音→审计 闸门链 | `scripts/make.cjs` |
| 剧本真理源 | CARDS/SCENES/VO_TEXT/PULSE_ENV 单文件 | `src/<film>/script.ts` |
| 动效词汇层 | Perlin 驱动 drift/sway2/breathe2/heroIn（禁裸 sin） | `src/lib/motion2.ts` |
| 节拍呼吸 | 渲染时直读 BGM 能量包络（零预处理） | `src/lib/audioPulse.ts` |
| 配音产线 | 逐卡 TTS→时间轴重排→语速门→首句留白 | `scripts/vo_build_scene.cjs` |
| 质感层 | @remotion/effects 60+ webgl 效果 + @remotion/skia | `src/effectslab/` `src/skialab/` |
| 音效合成 | 18 音程序化 PCM + 语义锚定排期 | `scripts/lib/sfx_lib.cjs` |
| 验收闭环 | smooth_check / film_audit / loudness / dwell / compliance | `scripts/` |
| 视觉身份台账 | 每片一行指纹，皮骨查重 | `IDENTITIES.md` |

## 环境要求

- Node 20+、npm
- ffmpeg / ffprobe（进 PATH，或设 `FFMPEG_PATH/FFPROBE_PATH`）
- Chrome（Remotion 渲染用，首次自动下载）
- 可选：GPT-SoVITS（本地配音；`GPTSOVITS_HOME` 指向安装目录）

## 第一次配置

```bash
npm install

# 1) 路径层（全部可选，见 scripts/lib/paths.cjs）——Windows PowerShell 示例：
$env:FFMPEG_PATH   = "C:/tools/ffmpeg/bin/ffmpeg.exe"
$env:FFPROBE_PATH  = "C:/tools/ffmpeg/bin/ffprobe.exe"
$env:GPTSOVITS_HOME = "D:/AI/GPT-SoVITS"      # 想用本地配音才需要

# 2) 音色身份（想用 AI 配音才需要）：
cp voice/voice.example.json voice/voice.json   # 填成你的参考音与文字稿

# 3) BGM：把你有授权的音乐放到 assets/bgm.flac
```

## 试跑

```bash
npx remotion studio                 # 打开合成台，看 Example 示例片 + EffectsLab 生态样张
node scripts/make.cjs example --no-mix   # 一键产线跑到无声 raw（不需要 BGM）
node scripts/make.cjs example            # 完整链（需要 assets/bgm.flac）
```

## 开一部新片

```bash
node scripts/new_film.cjs <key小写> <中文标题> 4x3
# 自动：脚手架 src/<key>/ + films.json 登记 + Root.tsx 注册 + 台账/身份台账追加
# 然后：theme.ts 填视觉提案（对照 IDENTITIES.md 查重）→ script.ts 写卡 → make.cjs <key>
```

## 配音（可选）

```bash
# 前置：GPT-SoVITS api_v2 已在本机 9880 端口
node scripts/vo_build_scene.cjs <film> [--speed 1.25]
node scripts/bake_pulse_env.cjs "$ASSET_HOME/bgm.flac" 45 82 <TOTAL> src/<film>/script_vo.ts
node scripts/make.cjs <film>vo            # 配音版 + 无BGM版
```

## 目录速览

```
scripts/          产线脚本（make / vo_build_scene / sfx_lib / 各检查器）
scripts/lib/      paths.cjs（路径层唯一事实源）+ sfx_lib + script_loader
src/lib/          机制库（motion2 / audioPulse / subtitle / typography / FitText ...）
src/example/      示例片（最小完整样例：卡驱动 + motion2 + 字幕带）
src/effectslab/   @remotion/effects 验机样张
src/skialab/      @remotion/skia 验机样张（独立入口 src/index.skia.ts）
voice/            音色身份（真实 voice.json 不入库）
assets/           素材（BGM 等，不入库）
analytics/        数据台账（个人数据不入库）
```

## 授权说明

框架代码随意用。**你用本框架生产的内容归你**；仓库里的方法论文档（METHODOLOGY/AGENTS）欢迎引用，注明出处更佳。
