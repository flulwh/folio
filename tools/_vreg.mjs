// 视觉回归：保存/对比基线截图。只做像素级差异统计，不引第三方依赖。
// 用法：
//   node tools/_vreg.mjs --save            保存当前所有表面为基线
//   node tools/_vreg.mjs --diff            与基线对比，输出差异比例
//   node tools/_vreg.mjs --save --only=shelf,reader --theme=paper,night
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SHOTS_DIR = path.join(ROOT, '.shots');
const BASE_DIR = path.join(SHOTS_DIR, 'baseline');

const argv = process.argv.slice(2).reduce((acc, cur) => {
  const m = /^--([^=]+)=(.*)$/.exec(cur);
  if (m) acc[m[1]] = m[2];
  else if (cur.startsWith('--')) acc[cur.slice(2)] = true;
  return acc;
}, {});

const SURFACES = [
  { key: 'shelf', click: '' },
  { key: 'reader', click: '.book-grid .book-card:nth-child(7)' },
  { key: 'settings', click: '[aria-label="设置"]' },
  { key: 'market', click: '.shelf-cloud-btn' },
];

const only = (argv.only || 'shelf,reader,settings,market').split(',').map((s) => s.trim());
const themes = (argv.theme || 'paper,night').split(',').map((s) => s.trim());

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, '_snap.mjs'), ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => resolve({ code, out }));
  });
}

/** 极简 PNG 解码：只支持 8bit RGB/RGBA，非隔行。截图工具产出的就是这个格式。 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced unsupported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth + ' unsupported');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error('colorType ' + colorType + ' unsupported');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** 统计差异：返回差异像素比例与平均色差。 */
function comparePng(a, b) {
  const A = decodePng(a);
  const B = decodePng(b);
  if (A.width !== B.width || A.height !== B.height) {
    return { sizeMismatch: true, ratio: 1, meanDelta: 255 };
  }
  const total = A.width * A.height;
  let diff = 0;
  let sum = 0;
  for (let i = 0; i < A.data.length; i += A.channels) {
    const d =
      Math.abs(A.data[i] - B.data[i]) +
      Math.abs(A.data[i + 1] - B.data[i + 1]) +
      Math.abs(A.data[i + 2] - B.data[i + 2]);
    if (d > 12) diff += 1; // 忽略抗锯齿的微小抖动
    sum += d;
  }
  return { sizeMismatch: false, ratio: diff / total, meanDelta: sum / total / 3 };
}

const saveMode = !!argv.save;
if (saveMode) fs.mkdirSync(BASE_DIR, { recursive: true });

let failures = 0;
for (const s of SURFACES.filter((x) => only.includes(x.key))) {
  for (const theme of themes) {
    const name = `${s.key}-${theme}.png`;
    const live = path.join(SHOTS_DIR, `live-${name}`);
    const base = path.join(BASE_DIR, name);

    const args = [`--out=${live}`, `--theme=${theme}`, '--w=1280', '--h=800', '--wait=2400'];
    if (s.click) args.push(`--click=${s.click}`);
    const r = await run(args);
    if (r.code !== 0) {
      console.log(`FAIL shoot ${name}`);
      failures += 1;
      continue;
    }

    if (saveMode) {
      fs.copyFileSync(live, base);
      console.log(`saved  ${name}`);
      continue;
    }

    if (!fs.existsSync(base)) {
      console.log(`new    ${name}（无基线）`);
      continue;
    }
    try {
      const c = comparePng(fs.readFileSync(base), fs.readFileSync(live));
      const pct = (c.ratio * 100).toFixed(2);
      const flag = c.ratio > 0.02 ? 'CHANGED' : 'same   ';
      if (c.ratio > 0.02) failures += 1;
      console.log(
        `${flag} ${name.padEnd(18)} diff=${pct}% meanDelta=${c.meanDelta.toFixed(1)}${
          c.sizeMismatch ? ' (尺寸不符)' : ''
        }`
      );
    } catch (e) {
      console.log(`ERR    ${name}: ${e.message}`);
      failures += 1;
    }
  }
}

if (!saveMode) {
  console.log(`\n${failures === 0 ? '视觉无回归' : failures + ' 处差异需复核'}`);
}
