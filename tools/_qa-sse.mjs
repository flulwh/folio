/**
 * QA 独立验证：手机上传一本书之后，桌面端的推送链路是否真的发出去了。
 *
 * 链路有两段，这里分开验：
 *   A. SSE（给网页面板）：`finish()` → publish('books',{reason:'upload'}) → /api/events
 *   B. IPC（给 Electron 渲染层书架）：`onBooksChanged` → main.js broadcast('lan:books')
 *      —— B 段本脚本只能验证「主进程确实调了回调」，渲染层是否监听由静态审计给出结论。
 *
 * 用法：node tools/_qa-sse.mjs
 * 退出码 0 = 两段都通；1 = 有失败。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { createLanService } from '../electron/lan.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-qa-sse-'));
const booksDir = path.join(dir, 'books');
fs.mkdirSync(booksDir, { recursive: true });
const files = {
  books: path.join(dir, 'books.json'),
  progress: path.join(dir, 'progress.json'),
  settings: path.join(dir, 'settings.json'),
};
fs.writeFileSync(files.books, JSON.stringify([]), 'utf8');
fs.writeFileSync(files.progress, JSON.stringify({}), 'utf8');
fs.writeFileSync(files.settings, JSON.stringify({}), 'utf8');

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

const TOKEN = 'QASSE1';
const hits = [];
const service = createLanService({
  files,
  booksDir,
  readJson,
  writeJson,
  getVersion: () => '2.6.0-qa',
  log: () => {},
  onBooksChanged: (id) => hits.push(id),
});
const started = await service.start({ port: 20300, token: TOKEN, allowWrite: true });
if (!started.ok) {
  process.stderr.write(`服务启动失败：${started.error}\n`);
  process.exit(2);
}
const base = `http://127.0.0.1:${service.port}`;

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) process.stdout.write(`  ✓ ${name}\n`);
  else {
    failed += 1;
    process.stdout.write(`  ✗ ${name}${extra ? `  ← ${extra}` : ''}\n`);
  }
};

/* ---- 1. 订阅 SSE ---- */
const events = [];
const sseReq = http.get(`${base}/api/events?t=${TOKEN}`, (res) => {
  res.setEncoding('utf8');
  let buf = '';
  res.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const name = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
      const data = /^data:\s*(.+)$/m.exec(block)?.[1]?.trim();
      if (name) events.push({ name, data });
    }
  });
});
sseReq.on('error', () => {});

/** 等某个事件出现（或超时）。 */
function waitEvent(name, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const found = events.find((e) => e.name === name);
      if (found) return resolve(found);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 50);
    };
    tick();
  });
}

await new Promise((r) => setTimeout(r, 250));

/* ---- 2. 上传一本小书（走真实的 chunk + commit） ---- */
const content = Buffer.from('第一章 QA 上传\n这是一本用来验证推送链路的小书。\n第二章 收尾\n完。\n', 'utf8');
const hash = crypto.createHash('sha1').update(content).digest('hex');

const upload = await fetch(`${base}/api/upload/chunk`, {
  method: 'POST',
  headers: {
    'X-Folio-Token': TOKEN,
    'Content-Type': 'application/octet-stream',
    'X-Folio-Hash': hash,
    'X-Folio-Offset': '0',
    'X-Folio-Total': String(content.length),
    'X-Folio-Name': encodeURIComponent('QA推送验证'),
  },
  body: content,
});
const upJson = await upload.json().catch(() => ({}));

process.stdout.write('\nA. SSE（网页面板）\n');
ok('上传返回 done=true', upJson.done === true, JSON.stringify(upJson).slice(0, 160));
ok('上传返回 id', Boolean(upJson.id), String(upJson.id || ''));

const booksEvent = await waitEvent('books');
ok('SSE 收到 books 事件', Boolean(booksEvent), booksEvent ? booksEvent.data : '(4s 内没收到)');
if (booksEvent) {
  let payload = {};
  try {
    payload = JSON.parse(booksEvent.data);
  } catch {
    /* ignore */
  }
  ok('books 事件带 reason=upload', payload.reason === 'upload', JSON.stringify(payload));
  ok('books 事件带新书 id', payload.id === upJson.id, `${payload.id} vs ${upJson.id}`);
}

process.stdout.write('\nB. IPC（Electron 渲染层书架）\n');
ok('主进程 onBooksChanged 回调被调用', hits.length === 1, `hits=${JSON.stringify(hits)}`);
ok('回调带的 id 与响应一致', hits[0] === upJson.id, `${hits[0]} vs ${upJson.id}`);

/* ---- 3. 书架文件真的落了 ---- */
const shelf = readJson(files.books, []);
ok('books.json 里出现新书', shelf.some((b) => b.id === upJson.id), `books=${shelf.length}`);
const landed = shelf.find((b) => b.id === upJson.id) || {};
ok('新书写了 syncedFrom=android', landed.syncedFrom === 'android', String(landed.syncedFrom));
ok('新书写了 contentHash', landed.contentHash === hash, String(landed.contentHash || ''));
ok('新书正文副本存在', fs.existsSync(String(landed.filePath || '')), String(landed.filePath || ''));
ok('.incoming 里没有残留 .part', (() => {
  const inc = path.join(booksDir, '.incoming');
  try {
    return fs.readdirSync(inc).filter((n) => n.endsWith('.part')).length === 0;
  } catch {
    return true;
  }
})());

sseReq.destroy();
await service.stop();
fs.rmSync(dir, { recursive: true, force: true });

process.stdout.write(`\n${failed ? `✗ ${failed} 项失败` : '✓ 全部通过'}\n`);
process.exit(failed ? 1 : 0);
