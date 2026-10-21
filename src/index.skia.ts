/**
 * Skia 实验位专用入口：先加载 CanvasKit WASM，再挂载 Root。
 * 普通影片一律走 src/index.ts（不加载 Skia，渲染零影响）。
 *
 * ⚠️ 必须用动态 import：RN Skia 的 Skia.web.js 在模块顶层就读 global.CanvasKit，
 * 静态 import 会在 LoadSkiaWeb 完成前求值 → "Cannot read properties of undefined
 * (reading 'PictureRecorder')"。动态 import 保证整棵 Skia 模块树在 CanvasKit 就绪后才求值。
 *
 * 用法：npx remotion render src/index.skia.ts SkiaLab out/skialab-test.mp4
 */
import {LoadSkiaWeb} from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';

LoadSkiaWeb().then(async () => {
  const {registerRoot} = await import('remotion');
  const {RemotionRoot} = await import('./RootSkia');
  registerRoot(RemotionRoot);
});
