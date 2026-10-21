/*
 * paths.cjs — 框架路径层（唯一路径事实源）
 * 解析优先级：环境变量 > 仓库约定位置。全部可选，详见 README「第一次配置」。
 */
const path = require('path');

const ROOT = process.env.PROREMOTION_HOME || path.resolve(__dirname, '..', '..');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const ASSET_HOME = process.env.ASSET_HOME || path.join(ROOT, 'assets');
const BGM_HOME = process.env.BGM_HOME || path.join(ASSET_HOME, 'bgm');
const OUTPUT_HOME = process.env.OUTPUT_HOME || path.join(ROOT, 'output');
const ANALYTICS_HOME = process.env.ANALYTICS_HOME || path.join(ROOT, 'analytics');
const VOICE_HOME = process.env.VOICE_HOME || path.join(ROOT, 'voice');
const TTS_API = process.env.TTS_API || 'http://127.0.0.1:9880/tts';
const GPTSOVITS_HOME = process.env.GPTSOVITS_HOME || '';
const BGM_FLAC = path.join(ASSET_HOME, 'bgm.flac');

module.exports = {
  ROOT, FFMPEG, FFPROBE, ASSET_HOME, BGM_HOME, BGM_FLAC, OUTPUT_HOME,
  ANALYTICS_HOME, VOICE_HOME, VOICE_JSON: path.join(VOICE_HOME, 'voice.json'),
  TTS_API, GPTSOVITS_HOME,
};
