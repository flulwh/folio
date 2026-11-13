/**
 * 局域网面板的测试夹具：起一个真实的 Folio 局域网服务，
 * 打印 { port, token } 到 stdout，然后常驻。
 *
 * 给两处用：
 *  1. tools/_lan-discovery-check.mjs —— 桌面端 UDP 发现自查。
 *  2. android/app/src/test/.../LanIntegrationTest.kt —— Android 客户端用
 *     真实的 HTTP 协议跟桌面端对进度。
 *
 * 用法：node tools/_lan-fixture.mjs <数据目录> [起始端口]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createLanService } from '../electron/lan.js';

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('需要一个数据目录\n');
  process.exit(2);
}

const booksDir = path.join(dir, 'books');
fs.mkdirSync(booksDir, { recursive: true });

const files = {
  books: path.join(dir, 'books.json'),
  progress: path.join(dir, 'progress.json'),
  settings: path.join(dir, 'settings.json'),
};

const bookFile = path.join(booksDir, 'local-book.txt');
fs.writeFileSync(
  bookFile,
  '第一章 起风了\n风从江面上来，带着水汽。\n\n第二章 落雨\n雨点敲在窗上，一声接一声。\n',
  'utf8',
);

fs.writeFileSync(
  files.books,
  JSON.stringify([
    {
      id: 'local-1',
      title: '本地测试书',
      author: '夹具',
      kind: 'local',
      filePath: bookFile,
      format: 'txt',
    },
    {
      id: 'cloud-1',
      title: '云端测试书',
      author: '夹具',
      kind: 'cloud',
      sourceName: '夹具书源',
    },
  ]),
  'utf8',
);

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

const service = createLanService({
  files,
  booksDir,
  readJson,
  writeJson,
  getVersion: () => '2.5.0-fixture',
  log: (level, message) => process.stderr.write(`[${level}] ${message}\n`),
});

const result = await service.start({
  port: Number(process.argv[3] || 20000),
  token: 'TEST123',
  allowWrite: true,
});

if (!result.ok) {
  process.stderr.write(`启动失败：${result.error}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ port: service.port, token: 'TEST123', ok: true })}\n`);

const shutdown = () => {
  service.stop().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
