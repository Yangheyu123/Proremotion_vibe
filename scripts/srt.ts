// 生成与视频时间轴完全一致的 SRT 字幕：npx tsx scripts/srt.ts 或 node --experimental-strip-types
import {writeFileSync, mkdirSync} from 'node:fs';
import {FPS, TIMED} from '../src/script';

const ts = (frame: number) => {
  const ms = Math.round((frame / FPS) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
};

const srt = TIMED.map(
  (l, i) => `${i + 1}\n${ts(l.from)} --> ${ts(l.from + l.dur - 10)}\n${l.text}\n`,
).join('\n');

mkdirSync('out', {recursive: true});
writeFileSync('out/vibe.srt', '\ufeff' + srt, 'utf8');
console.log(srt);
