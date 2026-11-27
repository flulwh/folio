#!/usr/bin/env node
/**
 * 生成 NSIS 安装包的品牌配图（手动运行，不参与 CI）：
 *
 *   node tools/_gen-installer-art.mjs
 *   node tools/_gen-installer-art.mjs --edge "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
 *
 * 产出：
 *   build/installerSidebar.bmp  164×314  向导左侧竖图（安装 / 卸载共用）
 *   build/installerHeader.bmp   150×57   页面右上角标题图
 *
 * 做法：先把设计写成 HTML，用 Edge 无头截图成 PNG，再在这里解码 PNG
 * （zlib + 反滤波）并写成 24 位 BMP —— NSIS 只认 BMP，而浏览器渲染
 * 中文与圆角比手写像素靠谱。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findEdge() {
  const fromArgs = process.argv.indexOf('--edge');
  if (fromArgs >= 0 && process.argv[fromArgs + 1]) {
    return process.argv[fromArgs + 1];
  }
  const found = EDGE_CANDIDATES.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('找不到 Edge，请用 --edge 指定 msedge.exe 路径');
  return found;
}

/* 图标母版来自 build/icon.svg：墨底、纸页、橙色书签。这里内联成两组尺寸。 */
function logoSvg(size) {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" rx="224" fill="#FAF9F5"/>
  <path d="M328 196H604L684 276V800C684 815.464 671.464 828 656 828H328C312.536 828 300 815.464 300 800V224C300 208.536 312.536 196 328 196Z" fill="#141413"/>
  <path d="M604 196L684 276H624C612.954 276 604 267.046 604 256V196Z" fill="#D97757"/>
  <path d="M496 196H540V496L518 522L496 496V196Z" fill="#D97757"/>
  <rect x="360" y="580" width="240" height="24" rx="12" fill="#B0AEA5"/>
  <rect x="360" y="640" width="240" height="24" rx="12" fill="#B0AEA5"/>
  <rect x="360" y="700" width="164" height="24" rx="12" fill="#B0AEA5"/>
</svg>`;
}

const SIDEBAR_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: 164px; height: 314px; overflow: hidden; }
  body {
    position: relative;
    background:
      radial-gradient(150px 130px at 12% 6%, rgba(217,119,87,.26), transparent 70%),
      radial-gradient(180px 200px at 108% 104%, rgba(217,119,87,.10), transparent 72%),
      linear-gradient(168deg, #1C1B19 0%, #141413 58%, #0E0E0D 100%);
    font-family: 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .logo { position: absolute; left: 26px; top: 28px; }
  .word {
    position: absolute; left: 26px; top: 84px;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 32px; line-height: 1; color: #FAF9F5; letter-spacing: 0.4px;
  }
  .tag {
    position: absolute; left: 27px; top: 128px;
    font-size: 9px; line-height: 1.9; letter-spacing: 1.1px; color: #9C9A91;
  }
  .rule { position: absolute; left: 27px; top: 176px; width: 24px; height: 2px; background: #D97757; }
  .foot {
    position: absolute; left: 26px; bottom: 26px;
    font-size: 8px; line-height: 2; letter-spacing: 0.8px; color: #83817A;
  }
  .foot b { display: block; font-weight: 400; color: #A8A69D; }
</style></head>
<body>
  <div class="logo">${logoSvg(40)}</div>
  <div class="word">Folio</div>
  <div class="tag">本地优先<br>沉浸式阅读器</div>
  <div class="rule"></div>
  <div class="foot"><b>PDF · EPUB · 漫画</b>局域网同步进度</div>
</body></html>`;

const HEADER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: 150px; height: 57px; overflow: hidden; }
  body {
    position: relative; background: #FFFFFF;
    font-family: 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .row { display: flex; align-items: center; gap: 9px; padding: 13px 0 0 6px; }
  .name { font-family: Georgia, 'Times New Roman', serif; font-size: 15px; line-height: 1; color: #141413; }
  .sub { margin-top: 4px; font-size: 6.5px; letter-spacing: 1.6px; color: #B0AEA5; }
  .rule { position: absolute; left: 6px; right: 6px; bottom: 0; height: 2px; background: #D97757; }
</style></head>
<body>
  <div class="row">
    ${logoSvg(26)}
    <div><div class="name">Folio</div><div class="sub">READER</div></div>
  </div>
  <div class="rule"></div>
</body></html>`;

/** 极简 PNG 解码：只处理 Edge 截图会产出的 8 位、非隔行、RGB/RGBA。 */
function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  signature.forEach((byte, index) => {
    if (buffer[index] !== byte) throw new Error('不是 PNG 文件');
  });

  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`不支持的 PNG 格式（bitDepth=${bitDepth} colorType=${colorType}）`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height) throw new Error('PNG 缺少 IHDR');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const prior = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start];
    raw.copy(line, 0, start + 1, start + 1 + stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = prior[x];
      const upLeft = x >= channels ? prior[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = value & 0xff;
    }
    line.copy(pixels, y * stride);
    line.copy(prior);
  }
  return { width, height, channels, pixels };
}

/** 24 位 BMP（BGR、行尾 4 字节对齐、自下而上），NSIS 与 MUI2 都能直接吃。 */
function encodeBmp24({ width, height, channels, pixels }) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const imageSize = rowSize * height;
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + imageSize, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(imageSize, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);

  const body = Buffer.alloc(imageSize);
  for (let y = 0; y < height; y += 1) {
    const target = (height - 1 - y) * rowSize;
    const source = y * width * channels;
    for (let x = 0; x < width; x += 1) {
      const from = source + x * channels;
      const to = target + x * 3;
      body[to] = pixels[from + 2];
      body[to + 1] = pixels[from + 1];
      body[to + 2] = pixels[from];
    }
  }
  return Buffer.concat([header, body]);
}

function render(edge, html, width, height, outFile) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-installer-art-'));
  const page = path.join(work, 'page.html');
  const shot = path.join(work, 'shot.png');
  const profile = path.join(work, 'profile');
  fs.writeFileSync(page, html, 'utf8');

  const result = spawnSync(edge, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    `--screenshot=${shot}`,
    `file:///${page.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore', timeout: 60000 });

  if (!fs.existsSync(shot)) {
    throw new Error(`Edge 截图失败（exit=${result.status}）`);
  }
  const image = decodePng(fs.readFileSync(shot));
  if (image.width !== width || image.height !== height) {
    throw new Error(`截图尺寸不符：期望 ${width}×${height}，实际 ${image.width}×${image.height}`);
  }
  fs.writeFileSync(outFile, encodeBmp24(image));
  fs.rmSync(work, { recursive: true, force: true });
  return outFile;
}

const edge = findEdge();
const jobs = [
  { html: SIDEBAR_HTML, width: 164, height: 314, file: 'installerSidebar.bmp' },
  { html: HEADER_HTML, width: 150, height: 57, file: 'installerHeader.bmp' },
];

for (const job of jobs) {
  const out = render(edge, job.html, job.width, job.height, path.join(buildDir, job.file));
  console.log(`✓ ${path.relative(root, out)}  ${job.width}×${job.height}  ${fs.statSync(out).size} B`);
}
