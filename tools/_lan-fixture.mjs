/**
 * 局域网面板的测试夹具：起一个真实的 Folio 局域网服务 + 一个本地假图源，
 * 打印 `{ port, token, imageBase, ok }` 到 stdout，然后常驻。
 *
 * 给三处用：
 *  1. tools/_lan-sync-check.mjs —— 桌面端 2.6.0 的清单/下载/上传/漫画自查。
 *  2. android/app/src/test/.../LanIntegrationTest.kt —— Android 客户端用
 *     真实的 HTTP 协议跟桌面端对进度、传书、取漫画页。
 *  3. 手工 curl 调试。
 *
 * 用法：node tools/_lan-fixture.mjs <数据目录> [起始端口] [--big] [--comic] [--readonly]
 *   --big       额外造 12MiB / 30MiB / 31MiB 三本大书（下载与上限自查用）
 *   --comic     额外挂一本漫画书 + 一个本地假图源（漫画自查用）
 *   --readonly  以「桌面端关闭了允许写入」的状态启动（403 自查用）
 *
 * 不带任何 flag 时书架恰好两本（local-1 / cloud-1），Android 老用例的断言不受影响。
 * 漫画一律走本地生成的假 PNG，**不打外网**。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createLanService } from '../electron/lan.js';
import { createComicService } from '../electron/lan-comic.js';
import { createDeviceStore } from '../electron/devicestore.js';

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('需要一个数据目录\n');
  process.exit(2);
}
const startPort = Number(process.argv[3] || 20000);
const flags = new Set(process.argv.slice(4));
const wantBig = flags.has('--big');
const wantComic = flags.has('--comic');
const wantDirty = flags.has('--dirty');
const readOnly = flags.has('--readonly');

const booksDir = path.join(dir, 'books');
fs.mkdirSync(booksDir, { recursive: true });

const files = {
  books: path.join(dir, 'books.json'),
  progress: path.join(dir, 'progress.json'),
  settings: path.join(dir, 'settings.json'),
};

/** 1x1 的真 PNG（假图源发的就是它，手机端能真解出来）。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const bookFile = path.join(booksDir, 'local-book.txt');
fs.writeFileSync(
  bookFile,
  '第一章 起风了\n风从江面上来，带着水汽。\n\n第二章 落雨\n雨点敲在窗上，一声接一声。\n',
  'utf8',
);

const shelf = [
  {
    id: 'local-1',
    title: '本地测试书',
    name: '本地测试书',
    author: '夹具',
    kind: 'local',
    filePath: bookFile,
    format: 'txt',
    type: 0,
  },
  {
    id: 'cloud-1',
    title: '云端测试书',
    name: '云端测试书',
    author: '夹具',
    kind: 'cloud',
    sourceName: '夹具书源',
    type: 0,
  },
];

/** 造一本大书：内容是可解析的 ASCII 文本，大小精确到字节。 */
function makeBigBook(id, title, bytes) {
  const file = path.join(booksDir, `${id}.txt`);
  const hash = crypto.createHash('sha1');
  const unit = Buffer.from('这是一本用来测试局域网传输的大部头电子书，正文重复填充。\n', 'utf8');
  const fd = fs.openSync(file, 'w');
  let written = 0;
  try {
    while (written < bytes) {
      const take = Math.min(unit.length, bytes - written);
      const slice = unit.subarray(0, take);
      fs.writeSync(fd, slice);
      hash.update(slice);
      written += take;
    }
  } finally {
    fs.closeSync(fd);
  }
  shelf.push({
    id,
    title,
    name: title,
    author: '夹具',
    kind: 'local',
    filePath: file,
    format: 'txt',
    type: 0,
    size: bytes,
    contentHash: hash.digest('hex'),
  });
  return { id, size: bytes };
}

const big = {};
if (wantBig) {
  big.big12 = makeBigBook('big-12', '十二兆测试书', 12 * 1024 * 1024);
  big.big30 = makeBigBook('big-30', '三十兆测试书', 30 * 1024 * 1024);
  big.bigOver = makeBigBook('big-over', '三十一兆测试书', 31 * 1024 * 1024);
}

/**
 * 三类脏条目，模拟真实用户 books.json 里什么都可能有：
 * 手改过、旧版本残留、同步中途断电。服务端必须扛住（回 404 / syncable=false），
 * 而不是抛异常变 500。
 *
 * **只在 --dirty 时写**：默认清单必须与旧行为一字不差，否则
 * `_lan-sync-check.mjs` 的 117 项和 `LanIntegrationTest` 的书目断言会连锁崩。
 */
if (wantDirty) {
  shelf.push(
    // 有条目但压根没有 filePath
    {
      id: 'dirty-no-filepath',
      title: '缺路径的书',
      name: '缺路径的书',
      author: '夹具',
      kind: 'local',
      format: 'txt',
      type: 0,
    },
    // filePath 指向一个已经不存在的文件（用户手删了 books/ 里的副本）
    {
      id: 'dirty-missing-file',
      title: '文件没了的书',
      name: '文件没了的书',
      author: '夹具',
      kind: 'local',
      filePath: path.join(booksDir, 'this-file-is-gone.txt'),
      format: 'txt',
      type: 0,
    },
    // 连 id 都没有的幽灵条目：清单接口必须跳过它，不能产出无 id 的书
    {
      title: '连 id 都没有的幽灵',
      name: '连 id 都没有的幽灵',
      author: '夹具',
      kind: 'local',
      type: 0,
    },
  );
}

fs.writeFileSync(files.books, JSON.stringify(shelf, null, 2), 'utf8');

fs.writeFileSync(
  files.progress,
  JSON.stringify({
    'local-1': { paraIndex: 1, chapterTitle: '第一章 起风了', percent: 12.5, updatedAt: 1000 },
  }),
  'utf8',
);
fs.writeFileSync(files.settings, JSON.stringify({ theme: 'paper', skin: 'apple' }), 'utf8');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true };
};

/* ------------------------------------------------------------------ */
/*  本地假图源：漫画自查只打这台机器，不出网                                */
/*  只有 --comic 才真的起服务、才往书架里加漫画书 ——                      */
/*  不带 flag 时书架仍旧是 local-1 / cloud-1 两本                        */
/* ------------------------------------------------------------------ */

const imageHits = { total: 0, referers: [], paths: [] };
let imageServer = null;
let imageBase = '';

/**
 * 假的书源「取图片清单」。
 * 话号决定这一话长什么样，方便断言各种失败分支：
 *   0 → 3 张正常图      1 → 第 0 张正常、第 1 张 7MiB（413）
 *   2 → 第 0 张源站 500  3 → 第 0 张是 HTML（当失败处理）
 *   4 → 清单为空         其它 → 报错（502）
 */
const COMIC_SHAPES = {
  0: ['ok/0.png', 'ok/1.png', 'ok/2.png'],
  1: ['ok/0.png', 'toobig/1.png'],
  2: ['broken/0.png'],
  3: ['html/0.png'],
  4: [],
};

async function comicImages(book, index) {
  const shape = COMIC_SHAPES[index];
  if (!shape) return { error: '这一话不存在' };
  if (!shape.length) return { error: '这一话没解析到图片' };
  return {
    urls: shape.map((item) => `${imageBase}/img/${item}`),
    referer: `${imageBase}/reader/1`,
    index,
    total: shape.length,
  };
}

/** 假的主进程取图：真的发 HTTP（带 Referer），超时与重试由 lan-comic 管。 */
async function comicFetchImage(url, referer) {
  const res = await fetch(url, { headers: referer ? { Referer: referer } : {} });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (/^\s*<(!doctype|html)/i.test(buffer.subarray(0, 64).toString('utf8'))) return null;
  return { buffer, type: res.headers.get('content-type') || 'image/png' };
}

if (wantComic) {
  imageServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/_stats') {
      const body = JSON.stringify(imageHits);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    imageHits.total += 1;
    imageHits.referers.push(String(req.headers.referer || ''));
    imageHits.paths.push(url.pathname);

    if (url.pathname.startsWith('/img/broken/')) {
      // 源站 500：客户端应拿到 502「源站没有返回这张图」
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
      return;
    }
    if (url.pathname.startsWith('/img/toobig/')) {
      // 7MiB 的「图」：客户端应拿到 413
      const body = Buffer.alloc(7 * 1024 * 1024, 0x41);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.length });
      res.end(body);
      return;
    }
    if (url.pathname.startsWith('/img/html/')) {
      // 有些源站出错时回一个 HTML 页：不能被当成图片
      const body = Buffer.from('<!doctype html><html><body>404</body></html>', 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': TINY_PNG.length });
    res.end(TINY_PNG);
  });
  await new Promise((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
  imageBase = `http://127.0.0.1:${imageServer.address().port}`;
  shelf.push({
    id: 'comic-1',
    title: '漫画测试书',
    name: '漫画测试书',
    author: '夹具',
    kind: 'cloud',
    sourceName: '夹具书源',
    sourceId: 'fixture',
    bookUrl: 'http://127.0.0.1/fixture/comic',
    type: 2,
  });
  // 上面 push 过，重新落一次 books.json
  fs.writeFileSync(files.books, JSON.stringify(shelf, null, 2), 'utf8');
}

const log = (level, message) => process.stderr.write(`[${level}] ${message}\n`);

const service = createLanService({
  files,
  booksDir,
  readJson,
  writeJson,
  getVersion: () => '2.6.0-fixture',
  log,
  // 上传成功 → 真实主进程会 broadcast('lan:books')；夹具只记录，供自查断言
  onBooksChanged: (id) => process.stderr.write(`[lan:books] ${id}\n`),
  // 设备管理：真实主进程用 dataDir 下的 devices.json；夹具同样落盘，Android 端
  // 才能拿这台夹具跑完整的设备流（心跳→入队→领取→回执→过期）。
  // 不注入的话 /api/ping 仍宣称 features 里有 devices，但四条路由会回 501。
  devices: createDeviceStore({ dataDir: dir, readJson, writeJson }),
  onDeviceChanged: (id, online) => process.stderr.write(`[lan:device] ${id} ${online}\n`),
  // 没开 --comic 就完全不给漫画能力（此时 /api/comic/* 回 501，和其它未接入的桌面端一致）
  comic: wantComic ? createComicService({ images: comicImages, fetchImage: comicFetchImage, log }) : null,
});

const result = await service.start({
  port: startPort,
  token: 'TEST123',
  allowWrite: !readOnly,
});

if (!result.ok) {
  process.stderr.write(`启动失败：${result.error}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({ port: service.port, token: 'TEST123', ok: true, imageBase, big })}\n`,
);

const shutdown = () => {
  Promise.resolve()
    .then(() => service.stop())
    .catch(() => {})
    .finally(() => {
      try {
        imageServer?.close();
      } catch {
        /* ignore */
      }
      process.exit(0);
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
