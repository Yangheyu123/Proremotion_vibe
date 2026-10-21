/*
 * paths.cjs — 框架路径层（Proremotion_vibe 唯一的路径事实源）
 *
 * 所有脚本不得硬编码绝对路径——一律从这里取。解析优先级：环境变量 > 仓库约定位置。
 *
 * 环境变量（全部可选，见 README「第一次配置」）：
 *   PROREMOTION_HOME  仓库根（缺省=本文件向上两级）
 *   FFMPEG_PATH / FFPROBE_PATH  ffmpeg/ffprobe（缺省=走 PATH 里的 ffmpeg/ffprobe）
 *   ASSET_HOME        素材根：bgm.flac 放 $ASSET_HOME/bgm.flac（缺省=$ROOT/assets）
 *   BGM_HOME          音乐库根（缺省=$ASSET_HOME/bgm）
 *   OUTPUT_HOME       成片交付根（缺省=$ROOT/output）
 *   ANALYTICS_HOME    数据台账根（缺省=$ROOT/analytics）
 *   VOICE_HOME        音色身份根：voice.json 放 $VOICE_HOME/voice.json（缺省=$ROOT/voice）
 *   TTS_API           GPT-SoVITS api_v2 地址（缺省 http://127.0.0.1:9880/tts）
 *   GPTSOVITS_HOME    GPT-SoVITS 安装目录（仅训练/ASR 工具用）
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
const BGM_FLAC = path.join(ASSET_HOME, 'bgm.flac'); // BGM 标准链路的默认曲目

module.exports = {
  ROOT,
  FFMPEG,
  FFPROBE,
  ASSET_HOME,
  BGM_HOME,
  BGM_FLAC,
  OUTPUT_HOME,
  ANALYTICS_HOME,
  VOICE_HOME,
  VOICE_JSON: path.join(VOICE_HOME, 'voice.json'),
  TTS_API,
  GPTSOVITS_HOME,
};
