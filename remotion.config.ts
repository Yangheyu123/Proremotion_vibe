/**
 * Remotion 全局构建配置（2026-10-19 新增）
 *
 * enableSkia：给 webpack 加 .web.* 解析优先级 + 把 canvaskit.wasm 打进 bundle 产物。
 * 对既有影片无行为影响——src 下没有 .web.* 文件，只是打包多拷一个 wasm 资产。
 * 服务于 @remotion/skia 实验位（src/skialab/，入口 src/index.skia.ts）。
 * 若 Skia 样张验证失败要整体回滚：删本文件 + src/index.skia.ts + src/RootSkia.tsx +
 * src/skialab/ + node_modules 里 @remotion/skia 与 @shopify/react-native-skia。
 */
import {Config} from '@remotion/cli/config';
import {enableSkia} from '@remotion/skia/enable';

Config.overrideWebpackConfig((config) => enableSkia(config));
