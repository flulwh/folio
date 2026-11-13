/**
 * 局域网面板回归测试（不依赖 Electron，直接起 lan.js）。
 *
 *   node tools/_lan-check.mjs
 *
 * 覆盖：鉴权（无码 / 带码换 cookie / 错码）、数据视图（不泄漏本地路径）、
 *      本地书正文、云端书拒绝、进度写入、newer-wins、只读模式、SSE 推送。
 * 数据写在系统临时目录里，跑完自动清掉，不碰真实书架。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { createLanService } from '../electron/lan.js';

const PORT = 19788;
const TOKEN = 'TEST42';

let failed = 0;
let passed = 0;

function ok(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${extra ? `  ← ${extra}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-lan-'));
const dataDir = path.join(root, 'data');
const booksDir = path.join(dataDir, 'books');
fs.mkdirSync(booksDir, { recursive: true });

const files = {
  books: path.join(dataDir, 'books.json'),
  progress: path.join(dataDir, 'progress.json'),
  settings: path.join(dataDir, 'settings.json'),
};

const localText = '第一章 测试\n\n这是第一段正文，用来验证手机端能不能读到。\n\n第二段：结束。\n';
fs.writeFileSync(path.join(booksDir, 'local1.txt'), localText, 'utf8');

fs.writeFileSync(
  files.books,
  JSON.stringify([
    {
      id: 'local1',
      kind: 'local',
      name: '本地测试书',
      author: '作者：某人',
      filePath: path.join(booksDir, 'local1.txt'),
      hue: 210,
      addedAt: 1,
    },
    {
      id: 'cloud1',
      kind: 'cloud',
      name: '云端测试书',
      sourceId: 's1',
      bookUrl: 'http://example.com/book',
      cover: 'http://example.com/c.jpg',
      addedAt: 2,
    },
  ]),
  'utf8'
);

fs.writeFileSync(
  files.progress,
  JSON.stringify({ local1: { paraIndex: 0, percent: 0, updatedAt: 1000 } }),
  'utf8'
);
fs.writeFileSync(files.settings, JSON.stringify({ theme: 'night' }), 'utf8');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, data) => {
  try {
    fs.writeFileSync(file, JSON.stringify(data), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

const remoteCalls = [];
const service = createLanService({
  files,
  booksDir,
  readJson,
  writeJson,
  log: (level, message) => {
    if (level === 'warn' || level === 'error') console.log(`    [log:${level}] ${message}`);
  },
  getVersion: () => '0.0.0-test',
  resolveCover: () => ({ url: 'http://example.com/c.jpg' }),
  onRemoteProgress: (progress, bookId) => remoteCalls.push({ progress, bookId }),
});



async function main() {
  const started = await service.start({ port: PORT, token: TOKEN, allowWrite: true });
  if (!started.ok) {
    console.error('服务起不来：', started.error);
    process.exit(1);
  }
  // 端口可能被别的程序占着而自动顺延，base 必须用实际端口
  const base = `http://127.0.0.1:${started.port}`;
  console.log(`服务已启动：${base}（访问码 ${TOKEN}）`);

  /* ---------------- 鉴权 ---------------- */
  section('鉴权');

  const loginRes = await fetch(`${base}/`);
  const loginHtml = await loginRes.text();
  ok('无访问码访问首页 → 返回登录页', loginRes.status === 200 && loginHtml.includes('输入桌面端显示的访问码'));
  ok('登录页不泄漏访问码', !loginHtml.includes(TOKEN));

  const noAuth = await fetch(`${base}/api/state`);
  ok('无访问码调 API → 401', noAuth.status === 401);

  const wrongCode = await fetch(`${base}/api/state`, { headers: { 'X-Folio-Token': 'WRONG1' } });
  ok('错访问码 → 401', wrongCode.status === 401);

  const redirect = await fetch(`${base}/?t=${TOKEN}`, { redirect: 'manual' });
  const setCookie = redirect.headers.get('set-cookie') || '';
  ok('带码访问 → 302 且种 cookie', redirect.status === 302 && setCookie.includes('folio_lan'));
  ok('跳转目标去掉了码', redirect.headers.get('location') === '/', redirect.headers.get('location') || '');

  const cookie = String(setCookie).split(';')[0];
  const panelRes = await fetch(`${base}/`, { headers: { cookie } });
  const panelHtml = await panelRes.text();
  ok('带 cookie 拿到面板页', panelRes.status === 200 && panelHtml.includes('局域网'));
  ok('面板资源带 CSP', (panelRes.headers.get('content-type') || '').includes('text/html'));

  const cssRes = await fetch(`${base}/assets/panel.css`, { headers: { cookie } });
  ok('面板样式可访问', cssRes.status === 200 && (cssRes.headers.get('content-type') || '').includes('css'));

  /* ---------------- 数据视图 ---------------- */
  section('数据视图');

  const stateRes = await fetch(`${base}/api/state`, { headers: { cookie } });
  const stateData = await stateRes.json();
  ok('/api/state 返回两本书', stateData.ok && stateData.books.length === 2);
  ok('不把本地路径送出去', stateData.books.every((b) => !('filePath' in b)));
  ok('封面改成面板自己的地址', stateData.books.find((b) => b.id === 'cloud1').cover === '/api/cover/cloud1');
  ok('带回主题（跟随桌面端）', stateData.theme?.id === 'night');
  ok('server 字段齐全', stateData.server?.version === '0.0.0-test' && stateData.server?.allowWrite === true);

  const textRes = await fetch(`${base}/api/book/local1`, { headers: { cookie } });
  const textData = await textRes.json();
  ok('本地书能读到正文', textData.ok && textData.text.includes('第一段正文'));

  const cloudRes = await fetch(`${base}/api/book/cloud1`, { headers: { cookie } });
  const cloudData = await cloudRes.json();
  ok('云端书返回 cloud 标记', cloudRes.status === 409 && cloudData.cloud === true);

  const missingRes = await fetch(`${base}/api/book/nope`, { headers: { cookie } });
  ok('不存在的书 → 404', missingRes.status === 404);

  const coverRes = await fetch(`${base}/api/cover/cloud1`, { headers: { cookie }, redirect: 'manual' });
  ok('封面没有缓存时 302 到源站', coverRes.status === 302);

  /* ---------------- 进度写入 ---------------- */
  section('进度写入与合并');

  const write = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'local1', data: { paraIndex: 12, percent: 42, updatedAt: Date.now() } }),
  });
  const writeData = await write.json();
  ok('写入进度成功', write.status === 200 && writeData.applied === true);
  ok('落盘了', readJson(files.progress, {}).local1?.percent === 42);
  ok('回推给桌面端', remoteCalls.length === 1 && remoteCalls[0].bookId === 'local1');

  const stale = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'local1', data: { paraIndex: 1, percent: 1, updatedAt: 500 } }),
  });
  const staleData = await stale.json();
  ok('旧时间戳被拒（newer-wins）', staleData.applied === false && staleData.entry.percent === 42);
  ok('旧进度没覆盖磁盘', readJson(files.progress, {}).local1?.percent === 42);

  const ghost = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'not-on-shelf', data: { paraIndex: 1, updatedAt: Date.now() } }),
  });
  ok('书架上没有的书拒绝写入', ghost.status === 404);

  const noCookie = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'local1', data: { paraIndex: 3, updatedAt: Date.now() } }),
  });
  ok('没访问码不能写', noCookie.status === 401);

  /* ---------------- SSE ---------------- */
  section('SSE 推送');

  const controller = new AbortController();
  const events = fetch(`${base}/api/events`, { headers: { cookie }, signal: controller.signal });
  const eventRes = await events;
  ok('SSE 连接建立', eventRes.status === 200 && (eventRes.headers.get('content-type') || '').includes('text/event-stream'));

  const reader = eventRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const readUntil = async (needle, ms = 2000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes(needle)) return true;
    }
    return buffer.includes(needle);
  };

  ok('收到 hello 事件', await readUntil('event: hello'));
  service.publish('progress', { progress: { local1: { percent: 66 } }, origin: 'desktop' });
  ok('收到进度推送', await readUntil('event: progress'));
  ok('推送带上了数据', buffer.includes('"percent":66'));
  controller.abort();
  // 让 undici 把这条被 abort 的长连接从池里摘掉，否则后面复用会 ECONNRESET
  await new Promise((resolve) => setTimeout(resolve, 200));

  /* ---------------- 只读模式 ---------------- */
  section('只读模式');

  service.setAllowWrite(false);
  const readonly = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'local1', data: { percent: 90, updatedAt: Date.now() } }),
  });
  ok('只读模式下拒绝写入', readonly.status === 403);
  const state2 = await fetch(`${base}/api/state`, { headers: { cookie } }).then((r) => r.json());
  ok('只读标记同步给前端', state2.server.allowWrite === false);
  service.setAllowWrite(true);

  /* ---------------- 端口占用与重启 ---------------- */
  section('端口占用 / 重启');

  const secondService = createLanService({
    files,
    booksDir,
    readJson,
    writeJson,
    log: () => {},
    getVersion: () => 'test',
  });
  const second = await secondService.start({ port: PORT, token: 'BBBBBB', allowWrite: true });
  ok('端口被占时自动顺延', second.ok && second.port > started.port, `${started.port} → ${second.port}`);
  await secondService.stop();

  const restarted = await service.start({ port: PORT, token: TOKEN, allowWrite: true });
  ok('重启后回到原端口', restarted.ok && restarted.port === started.port, String(restarted.error || restarted.port));
  // 用裸 http 请求而不是 fetch：undici 会复用重启前那条已经被销毁的长连接，
  // 在同一个 origin 上表现成 ECONNRESET —— 那是客户端连接池的账，不是服务端没起来。
  const ping = await new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/ping', headers: { cookie, connection: 'close' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
  ok('重启后服务可用', ping?.ok === true);

  await service.stop();

  console.log(`\n${failed ? '✗' : '✓'} ${passed} 通过 / ${failed} 失败`);
  return failed === 0;
}

main()
  .then((success) => {
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(success ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('测试异常：', err);
    try {
      await service.stop();
    } catch {
      /* ignore */
    }
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(1);
  });
