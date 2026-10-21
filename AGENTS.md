# Proremotion_vibe 产线铁律（每 session 强制加载）

> 方法论：`remotion-vibe/METHODOLOGY.md`；台账：`remotion-vibe/PLAN.md`。冲突时以 METHODOLOGY 为准并回写本文件。

## 内容铁律

1. **每张字幕卡起，画面必须有可见变化**——卡驱动编舞（`useSceneCards`，参考 `src/sticky/Film.tsx`），禁止整场一套元素从进撑到出
2. **每个画面变化配音效**：CUES 密度 ≥ 每卡 1-2 条；转场骑边 riser/thud、kw 重音 chime/ding、卡起点 page/pop
3. **动效从词汇层取**（`src/lib/motion2.ts`：drift/sway2/breathe2/orbit/heroIn/heroRise，Perlin seed 驱动、确定性可复现），禁止手写裸 sin 永动。幅度不设死线；纪律只有一条：**同一时刻观众只看一处，每拍至多一个 hero**
   - hero 弹入（气泡/盖章/弹簧）会在丝滑检查产生**孤立 1-2 帧小尖峰**（|d2|<0.5）——抽帧确认是设计事件后 `--allow-jump` 放行，这是正常路径不是事故
4. **前 3 秒钩子前置**（冲突/悬念开场）
5. **结尾评论钩子**（问句上屏 + 配音 + 视觉母题）
6. **每条新片换视觉身份，皮骨都换**：皮 = 配色三元组/字体气质/插画语言/转场语法；骨 = 字幕带形态、顶部 chrome 元素、卡片版式构图——SubBand/TopChrome 等 chrome 组件**禁止照搬上片结构只换色**（位置/形态/出场方式至少两项实质不同，组件也不得沿用上片命名）；衍生版本沿用原身份。**查重对照 `remotion-vibe/IDENTITIES.md` 身份台账**（只对表，禁全量翻旧片源码，撞车才开对应片）；新片收工回写台账一行（new_film.cjs 自动追加 TODO 行）
7. **字幕带不贴边（2026-10-20 定，替代"避让标题区"的过猛版）**：抖音对 4:3/16:9 横版视频的标题文案渲染在**画框之外**（success 发布实测复核，无实际遮挡）；真正的界面遮挡只在 9:16（评论抽屉 55%）。但字幕带**禁止贴边**——底边距画面底 **≥10%**（1080 高 ≈110px）：留呼吸感、避开全面屏圆角/手势条裁切、不与画框外标题视觉相挤。kw 锚点与关键视觉避底部 12%。9:16 仍按评论抽屉标准（见 METHODOLOGY 总纲 9）

## 产出规格

- **三版本**：无BGM / BGM / BGM+AI人声（`buildMix` 的 `skipBgm`；nobgm 变体 `reuseRawFrom` 复用 raw）
- **禁止覆盖成片**：替换前改名归档或独立 deliver；动基座前存 md5 基线
- 发布前：audit `sheet_mask.png` 二审 → 合规快照时效 → 数据截图进闭环。**封面用户自管**（固定底片+提示词模板，每期只改标题关键词，4:3 与 3:4；产线不生成封面）

## 配音产线（vo_build → make <film>vo）

- 节奏 = 配音驱动：卡时长 = 语音 + 0.6s 尾息；改台词/换音色重跑 vo_build，时间轴自动重适配
- **音色身份单一事实源：`voice/voice.json`**（参考音/文字稿/抛光链；模板见 `voice/voice.example.json`）——vo_build_scene 零旗子默认读取，换音色只改此文件
- 微调重训：走 GPT-SoVITS 自带流程（`$GPTSOVITS_HOME`，语料切片→ASR 标注→SoVITS/GPT 训练，约 40 分钟）；参考音**必须用微调语料切片**。训练工具属可选外置能力，框架本体不含
- **合成件语速门内建（< 字数/7s = 退化，自动重试）**：`vo_build` 与 `vo_build_scene` **都有**——后者 2026-10-21 补装（runback card00 两次坏 take：skip 校验落盘 + 门缺失，16 字句子有效语音只有 0.94s，"首句没念出来"的根源）。凡绕过门落盘的音频（--skip-tts / 手工放文件），内容未经门验证，用时必须补验（silencedetect 看语音地图）
- **语速/断句基准（2026-10-20 用户拍板）**：`vo_build_scene` 语速默认 **1.25** 起步（1.12 被判"太慢"）；卡文本按**完整自然句**切（一句一卡或一卡两行从句），禁止把长句剁成碎短句——碎句 = TTS 逐句断死，就是"断句怪"的根源
- **首句留白内建（2026-10-21 用户反馈"第一句话进入太快"）**：`vo_build_scene` 的 leadIn=18f（0.6s）——第一张有声卡的语音延迟开口、卡时长自动加长，**禁止 0 帧开口**；重排尾息收紧时 leadIn 不可被抹掉
- **人声抛光链默认内建**（buildMix vo 默认 postEq：去刺/去齿音/降噪/磁性），显式传 `''` 关闭
- **BGM 标准链路（2026-10-20 拍板，之后所有片都这么做）**：一律 `$ASSET_HOME/bgm.flac` + 去刺耳链 `highshelf=f=2800:g=-5,lowpass=f=12500,volume=0.28`（实测最优听感）；换曲必须用户拍板，不得自行选曲
- 中文 JSON 一律 node fetch（curl -d 会 GBK 乱码）
- TTS 服务：GPT-SoVITS api_v2（`$GPTSOVITS_HOME`，`runtime/python.exe api_v2.py -a 127.0.0.1 -p 9880`）；权重在 `tts_infer.yaml` 持久指向微调产物，热切换 GET `/set_sovits_weights?weights_path=...`

## 验收纪律（禁止一轮交付）

- **目检 = 逐卡对照**：`out/audit/<film>-<vk>/sheet_raw.png` 逐卡确认画面变化/断裂/穿帮
- 丝滑 / 响度 / 截断复核全绿；改剧本或编舞后全链重跑再全检
- 渲染缓存命中 ≠ 正确：内容改动核对 stamp 失效

## 环境事实

- Windows + Git Bash；JSON 含中文用 Node 读写；多输入 ffmpeg 用 execFileSync 数组（cmd.exe 8191 上限）
- **Remotion 全家 4.0.536 对齐**（2026-10-18 升级，冒烟验证通过）。**改组件成片没变 → `rm -rf node_modules/.cache` 再 `--force-render`**
- **headless 渲染限制**：CSS `preserve-3d`/手写 Lottie JSON/裸 three.js+R3F 的 WebGL 在 chrome-headless 截图下不可靠（2026-10-18 三连坑）——视觉元素用**确定性 SVG/CSS 2D** 实现。**例外（2026-10-19 实测）**：Remotion 自家 `@remotion/effects` 的 webgl2 效果管线 headless 完全可靠（EffectsLab 验机全过），放心用；three/R3F 留作真 3D 需求时按官方 ThreeCanvas 模式深入调试
- **@remotion/* 必须同版本对齐**；`@remotion/shader`、`@remotion/animated-images`、`@remotion/vehicles` 在 npm 不存在（幻影包名勿装），GPU 效果在 `@remotion/effects`；@react-three/fiber 锁 v8（v9 要 React 19，产线 React 18.3）
- **生态接入（2026-10-19）**：
  - `@remotion/layout-utils` → 文字自适应组件 `src/lib/FitText.tsx`（单行大字防溢出，渲染时实测宽度自动缩字号；多行段落用同包 fitTextOnNLines）
  - `@remotion/animation-utils` → motion2 内部已换官方 `makeTransform` 组合变换（回归实测 PSNR 49dB，亚像素舍入级，逻辑等价）
  - `@remotion/motion-blur` Trail → 已在 aivsart 启用（快动作 hero 事件专用；渲染时长随模糊层数增加，禁止全片常开）
  - `@remotion/skia` → **headless 验机通过**（CanvasKit CPU 光栅化干净：辉光/径向渐变/软粒子/圆帽笔触全过，样张 `src/skialab/`）。三条铁律：**只做质感层不排文字**（Skia Text 要字体文件，文字走 DOM）；专用入口 `src/index.skia.ts`——LoadSkiaWeb 之后必须**动态 import** Root（Skia.web.js 模块顶层读 global.CanvasKit，静态 import 直接 PictureRecorder 崩）；**颜色/style 直接声明在图元 props 上**（`<Circle color style strokeWidth>` + BlurMask 作子件；子件 `<Paint>` 形式会吞 color/style——1.12 web 实测渲染成黑色实心）。`@shopify/react-native-skia` 锁 1.12.4（1.x = React 18 兼容线，2.x 要 React 19，升 React 时同步升）；`remotion.config.ts` 的 enableSkia 全局生效（.web 解析优先 + canvaskit.wasm 打包，对普通影片无行为影响，回滚=删 remotion.config.ts + skia 入口/目录）
  - `@remotion/effects` → **webgl2 效果 headless 实测通过**（2026-10-19 EffectsLab 四面板全过：lightLeak/starburst/rings+linearGradient 组合/HtmlInCanvas+glow）。范式：`effects={[lightLeak({...})]}` 挂 `Solid`/`Img`/`Video`/`HtmlInCanvas`（都从 `remotion` 导入），参数对象随 useCurrentFrame 驱动即成动画；数组顺序 = 叠加顺序。**主入口只导出 11 个效果，其余 50+ 全在子路径**：`import {glow} from '@remotion/effects/glow'`。质感词汇表：paper 纸纹/speckle 颗粒/vignette 暗角/shine 扫光/roughen-edges 毛边/noise-displacement 噪波/halftone 网点/dot-grid 点阵/scanlines 扫描线/zoom-blur 径向模糊/chromatic-aberration 色差/duotone 双色调/tear 撕裂/liquid-contours 液态等值线/light-trail 光轨。参考样张 `src/effectslab/EffectsLab.tsx`（合成 EffectsLab，主入口直渲）
- 节拍脉冲 = `src/lib/audioPulse.ts`（media-utils 渲染时直读 BGM 能量包络，零预处理；**禁止重建 beat_detect/BEATS 硬编码链**）
- **转场双轨制（2026-10-18 裁定）**：存量片（dashui/sticky）= SceneShell 手搓溶解 + 绝对时间轴（承重结构勿改）；**新片从零 = @remotion/transitions TransitionSeries + @remotion/effects 完整体系**——相对时间轴：转场时长计入总长、卡表/CUES 用序列局部帧、VO 对位按序列计算、effects（lightLeak/starburst/rings/linearGradient 等）挂 TransitionSeries.Presentation。新片启动时先按此架构设计卡表，再动手写代码
- 代理（Clash TUN）多变：大文件下载挂断点续传 + `--speed-limit/--speed-time` 防僵死；**测速必须 curl 加 `-L` 跟随重定向**（无 -L 会把 308 重定向页测成 0 字节——2026-10-18 误诊教训）
- ffmpeg/ffprobe：装好后进 PATH，或设 `FFMPEG_PATH/FFPROBE_PATH`；并发后台任务多时防内存压力（系统会回收后台进程）
