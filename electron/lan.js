/**
 * 局域网面板 —— 把书架与阅读进度开放给局域网里的其它设备（手机 / 平板 / 另一台电脑）。
 *
 * 设计约束：
 *  1. 零依赖。只用 Node 内置 http / fs / os / crypto，打包体积和启动开销都不变。
 *  2. 单端口、单进程。面板是纯静态页面 + 一个 REST 接口 + 一条 SSE 长连接，
 *     不引入 WebSocket 库，也不用再起一个前端构建产物。
 *  3. 数据只有一份。服务端读写的就是主进程的那几个 json（books.json / progress.json），
 *     不做第二份副本，所以「双端同步」在磁盘层面天然成立，需要额外解决的只有
 *     内存里的渲染层副本 —— 那是靠 SSE + IPC 回推来对齐的。
 *  4. 默认只读。写进度需要显式允许（设置里可关），且服务端永远做一次 newer-wins 合并，
 *     避免两端来回覆盖。
 *
 * 鉴权：一个 6 位访问码。可以放在 ?t=、X-Folio-Token 头里，或在 /auth 换一次 cookie。
 * 局域网内不加密（HTTP），这是明确的取舍：数据不出内网，换取「扫一眼地址就能用」。
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { isInside } from './paths.js';

const MAX_BODY = 512 * 1024; // 请求体上限：进度条目再多也到不了这个量级
const MAX_TEXT = 12 * 1024 * 1024; // 单本正文上限：超过就不往手机上推了
const MAX_COVER = 4 * 1024 * 1024;
const SSE_PING = 25000;
const COOKIE_NAME = 'folio_lan';

/* ------------------------------------------------------------------ */
/*  访问码与地址                                                        */
/* ------------------------------------------------------------------ */

/** 去掉 0/O/1/I/L 这些肉眼分不清的字符，念给别人的时候不会错。 */
const TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateToken(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

// 虚拟网卡：装过 Docker / VMware / WSL / Tailscale 的机器上能列出七八个地址，
// 默认把最有可能是「家里那个 Wi-Fi」的排在前面，用户复制第一个就对。
const VIRTUAL_HINT = /(vmware|virtualbox|vbox|hyper-?v|vethernet|docker|br-|veth|tailscale|zerotier|utun|loopback|tap|tun|npcap|wintun|hamachi)/i;
const PREFERRED_HINT = /(wi-?fi|wlan|wireless|以太网|本地连接|ethernet|en0|eth\d|en\d)/i;

/**
 * 枚举可用于局域网访问的 IPv4 地址，按「像不像家里的网卡」排序。
 * 不丢弃虚拟网卡 —— 用户可能就是通过 Tailscale 访问的，只降权不剔除。
 */
export function lanAddresses() {
  let ifaces = {};
  try {
    ifaces = os.networkInterfaces();
  } catch {
    return [];
  }
  const list = [];
  for (const [name, items] of Object.entries(ifaces)) {
    for (const item of items || []) {
      if (!item || item.family !== 'IPv4' || item.internal) continue;
      if (String(item.address).startsWith('169.254.')) continue; // 自动分配的空地址
      let score = 0;
      if (PREFERRED_HINT.test(name)) score += 20;
      if (VIRTUAL_HINT.test(name)) score -= 30;
      if (/^192\.168\./.test(item.address)) score += 10;
      else if (/^10\./.test(item.address)) score += 6;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(item.address)) score += 4;
      list.push({ name, address: item.address, score });
    }
  }
  list.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  return list;
}

/* ------------------------------------------------------------------ */
/*  进度合并                                                            */
/* ------------------------------------------------------------------ */

/**
 * 单条进度合并：updatedAt 新的一方赢；字段做浅合并，避免某一端缺字段
 * （比如云端书有 windowBase、本地书没有）时把对端已有的信息抹掉。
 */
export function mergeProgressEntry(current, incoming) {
  if (!incoming || typeof incoming !== 'object') return current || null;
  if (!current) return { ...incoming };
  const a = Number(current.updatedAt) || 0;
  const b = Number(incoming.updatedAt) || 0;
  if (b < a) return current;
  return { ...current, ...incoming };
}

/** 整份进度按 bookId 合并。只在真有变化时才返回新对象，方便调用方判断要不要落盘。 */
export function mergeProgress(current, incoming) {
  const base = current && typeof current === 'object' ? current : {};
  const patch = incoming && typeof incoming === 'object' ? incoming : {};
  let changed = false;
  const next = { ...base };
  for (const [id, entry] of Object.entries(patch)) {
    const merged = mergeProgressEntry(base[id], entry);
    if (!merged) continue;
    if (JSON.stringify(merged) !== JSON.stringify(base[id] || null)) {
      next[id] = merged;
      changed = true;
    }
  }
  return { progress: changed ? next : base, changed };
}

/* ------------------------------------------------------------------ */
/*  小工具                                                              */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    // 路径里带没转义的 % 时 decodeURIComponent 会抛，退回原样
    return String(value || '');
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function coverMime(file) {
  return MIME[path.extname(String(file || '')).toLowerCase()] || 'application/octet-stream';
}

/* ------------------------------------------------------------------ */
/*  服务本体                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {object} opts
 * @param {object} opts.files       主进程的 json 路径表（books / progress / settings）
 * @param {string} opts.booksDir    本地书正文副本目录（用于校验读书路径）
 * @param {(file:string, fallback:any)=>any} opts.readJson
 * @param {(file:string, data:any)=>any} opts.writeJson
 * @param {(level:string, msg:string, meta?:any)=>void} [opts.log]
 * @param {(merged:object, bookId:string)=>void} [opts.onRemoteProgress]
 * @param {(book:object)=>({file?:string,url?:string}|null)} [opts.resolveCover]
 * @param {()=>string} [opts.getVersion]
 */
export function createLanService(opts) {
  const {
    files,
    booksDir,
    readJson,
    writeJson,
    log = () => {},
    onRemoteProgress = () => {},
    resolveCover = () => null,
    getVersion = () => '',
    // 云端书的目录/正文由主进程提供（那里才有书源引擎与磁盘缓存）。
    // 面板不接触书源，也不需要手机能访问书源站。
    cloud = null,
  } = opts;

  const assetsDir = path.dirname(fileURLToPath(import.meta.url));
  const assetCache = new Map();

  let server = null;
  let running = false;
  let actualPort = 0;
  let token = '';
  let allowWrite = true;
  let startedAt = 0;
  const clients = new Set();
  const sockets = new Set();

  /**
   * 读面板静态资源。按 mtime 做缓存：文件没改就复用上次的内容，
   * 改了就重新读 —— 否则改完 CSS 得重启整个应用才生效（store 的缓存
   * 挂在服务实例上，restart 并不会重建实例）。
   */
  function asset(name) {
    const file = path.join(assetsDir, name);
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      const cached = assetCache.get(name);
      if (cached) return cached.content;
      log('warn', `局域网面板资源缺失：${name}`);
      return '';
    }
    const hit = assetCache.get(name);
    if (hit && hit.mtime === mtime) return hit.content;
    try {
      const content = fs.readFileSync(file, 'utf8');
      assetCache.set(name, { mtime, content });
      return content;
    } catch (err) {
      log('warn', `局域网面板资源读取失败：${name}`, { error: err?.message });
      return hit?.content || '';
    }
  }

  function urls(useToken = true) {
    const suffix = useToken && token ? `/?t=${encodeURIComponent(token)}` : '/';
    return lanAddresses().map((item) => `http://${item.address}:${actualPort}${suffix}`);
  }

  function status() {
    return {
      running,
      port: actualPort,
      token,
      allowWrite,
      urls: running ? urls() : [],
      addresses: lanAddresses(),
      clients: clients.size,
      startedAt,
    };
  }

  /* ---------------- 鉴权 ---------------- */

  function tokenOf(req, url) {
    const q = url.searchParams.get('t');
    if (q) return q;
    const header = req.headers['x-folio-token'];
    if (header) return String(header);
    return parseCookies(req.headers.cookie)[COOKIE_NAME] || '';
  }

  function authorized(req, url) {
    const given = tokenOf(req, url);
    if (!given || !token) return false;
    const a = Buffer.from(String(given));
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function setCookie(res, value) {
    const cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
    res.setHeader('Set-Cookie', cookie);
  }

  /* ---------------- 数据视图 ---------------- */

  function listBooks() {
    const list = readJson(files.books, []);
    return Array.isArray(list) ? list : [];
  }

  function slimBook(book) {
    if (!book || typeof book !== 'object') return null;
    // 正文、原始抓取数据、书源原始对象都不往浏览器送：
    // 正文走 /api/book/:id 单独按需取，其余是桌面端内部结构。
    const { content, raw, ...rest } = book;
    const out = { ...rest };
    if (typeof out.cover === 'string' && !out.cover.startsWith('data:')) {
      // 远程封面统一走 /api/cover/:id：服务端有缓存就发文件，没有就 302 到源站，
      // 避免手机直连书源站被 Referer 拦掉。
      out.cover = `/api/cover/${encodeURIComponent(book.id)}`;
    }
    if (typeof out.cover === 'string' && out.cover.length > 200 * 1024) delete out.cover;
    delete out.filePath; // 本地路径不出机器
    return out;
  }

  function themeInfo() {
    const settings = readJson(files.settings, {}) || {};
    // 面板只跟随配色，不跟随排版；自定义主题把 tokens 一并给它，观感和桌面端一致。
    const custom = Array.isArray(settings.customThemes) ? settings.customThemes : [];
    return {
      id: settings.theme || 'paper',
      skin: settings.skin === 'miui' ? 'miui' : 'apple',
      custom: custom.map((item) => ({
        id: item?.id,
        label: item?.label,
        tone: item?.tone,
        tokens: item?.tokens,
      })),
    };
  }

  function resolveLocalBook(id) {
    const book = listBooks().find((item) => item?.id === id);
    if (!book) return { error: '书架上没有这本书', status: 404 };
    if (book.kind !== 'local') return { error: 'cloud', status: 409, book };
    const file = String(book.filePath || '');
    if (!file) return { error: '这本书没有正文副本', status: 404, book };
    const target = path.resolve(file);
    // Windows 路径大小写不敏感，用 path.relative 判断包含关系，
    // 避免 C:\Users 与 c:\Users 被误判成越界。
    if (!isInside(booksDir, target)) {
      return { error: '正文不在书架目录里', status: 403, book };
    }
    return { book, target };
  }

  /* ---------------- SSE ---------------- */

  function publish(event, payload) {
    if (!running || !clients.size) return;
    const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try {
        res.write(chunk);
      } catch {
        clients.delete(res);
      }
    }
  }

  function handleEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, allowWrite, at: Date.now() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* 下次写失败会被清理 */
      }
    }, SSE_PING);
    const cleanup = () => {
      clearInterval(ping);
      clients.delete(res);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  }

  /* ---------------- 路由 ---------------- */

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://folio.lan');
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad url' });
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method || 'GET';

    // 首页：带 ?t= 进来的话种一次 cookie 再跳到干净的地址，
    // 免得访问码留在地址栏和浏览历史里。
    if (pathname === '/' && method === 'GET') {
      if (!authorized(req, url)) {
        const html = asset('lan-login.html').replace('{{HINT}}', escapeHtml(describeHint(req)));
        sendText(res, 200, html, MIME['.html']);
        return;
      }
      if (url.searchParams.get('t')) {
        setCookie(res, token);
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      sendText(res, 200, asset('lan-panel.html'), MIME['.html']);
      return;
    }

    // 换 cookie：表单提交访问码
    if (pathname === '/auth' && method === 'POST') {
      const raw = await readBody(req, 4096);
      const form = new URLSearchParams(raw);
      const code = String(form.get('code') || '').trim().toUpperCase();
      const given = Buffer.from(code);
      const real = Buffer.from(token);
      if (given.length === real.length && crypto.timingSafeEqual(given, real)) {
        setCookie(res, token);
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      sendText(res, 401, asset('lan-login.html').replace('{{HINT}}', '<span class="bad">访问码不对，再试一次</span>'), MIME['.html']);
      return;
    }

    // 静态资源
    if (pathname.startsWith('/assets/')) {
      if (!authorized(req, url)) {
        sendText(res, 401, 'unauthorized');
        return;
      }
      const name = pathname.slice('/assets/'.length);
      const map = { 'panel.css': 'lan-panel.css', 'panel.js': 'lan-panel.js' };
      const file = map[name];
      if (!file) {
        sendText(res, 404, 'not found');
        return;
      }
      const body = asset(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-cache',
      });
      res.end(body);
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (!authorized(req, url)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
    }

    if (pathname === '/api/ping') {
      sendJson(res, 200, { ok: true, port: actualPort, version: getVersion() });
      return;
    }

    if (pathname === '/api/state' && method === 'GET') {
      const books = listBooks().map(slimBook).filter(Boolean);
      sendJson(res, 200, {
        ok: true,
        books,
        progress: readJson(files.progress, {}) || {},
        theme: themeInfo(),
        server: {
          version: getVersion(),
          allowWrite,
          port: actualPort,
          urls: urls(false),
          now: Date.now(),
        },
      });
      return;
    }

    if (pathname.startsWith('/api/book/') && method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/book/'.length));
      const hit = resolveLocalBook(id);
      if (hit.error) {
        sendJson(res, hit.status, {
          ok: false,
          error: hit.error,
          cloud: hit.error === 'cloud',
          book: hit.book ? slimBook(hit.book) : null,
        });
        return;
      }
      try {
        const stat = fs.statSync(hit.target);
        if (stat.size > MAX_TEXT) {
          sendJson(res, 413, { ok: false, error: '这本书太大，局域网读取请回桌面端' });
          return;
        }
        const text = fs.readFileSync(hit.target, 'utf8');
        sendJson(res, 200, { ok: true, book: slimBook(hit.book), text });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: `读不到正文：${err?.message || err}` });
      }
      return;
    }

    /* ---------- 云端书：目录与单章正文 ---------- */

    if (pathname.startsWith('/api/toc/') && method === 'GET') {
      const book = listBooks().find((item) => item?.id === safeDecode(pathname.slice('/api/toc/'.length)));
      if (!book) {
        sendJson(res, 404, { ok: false, error: '书架上没有这本书' });
        return;
      }
      if (book.kind !== 'cloud') {
        sendJson(res, 400, { ok: false, error: '这不是云端书' });
        return;
      }
      if (typeof cloud?.toc !== 'function') {
        sendJson(res, 501, { ok: false, error: '当前版本没有接入云端书' });
        return;
      }
      try {
        const result = await cloud.toc(book);
        const chapters = Array.isArray(result?.chapters) ? result.chapters : [];
        if (!chapters.length) {
          sendJson(res, 502, { ok: false, error: result?.error || '目录获取失败' });
          return;
        }
        // 章节地址属于书源内部结构，不往浏览器送；面板只需要序号和标题。
        sendJson(res, 200, {
          ok: true,
          total: chapters.length,
          chapters: chapters.map((item, index) => ({
            i: index,
            title: String(item?.title || `第 ${index + 1} 章`),
          })),
          sourceName: book.sourceName || '',
          lastChapter: book.lastChapter || '',
          fromCache: result.fromCache !== false,
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: `目录获取失败：${err?.message || err}` });
      }
      return;
    }

    if (pathname.startsWith('/api/chapter/') && method === 'GET') {
      // 章节号走 ?i=，不放进路径：云端书的 id 里带 :: 和 /（书源地址），
      // 塞进路径会被切碎。
      const id = safeDecode(pathname.slice('/api/chapter/'.length));
      const book = listBooks().find((item) => item?.id === id);
      if (!book) {
        sendJson(res, 404, { ok: false, error: '书架上没有这本书' });
        return;
      }
      if (book.kind !== 'cloud') {
        sendJson(res, 400, { ok: false, error: '这不是云端书' });
        return;
      }
      if (typeof cloud?.chapter !== 'function') {
        sendJson(res, 501, { ok: false, error: '当前版本没有接入云端书' });
        return;
      }
      // Number(null) 是 0，缺参数必须先分辨出来，否则「没给章号」会被当成第 0 章
      const rawIndex = url.searchParams.get('i');
      const index = rawIndex === null || rawIndex.trim() === '' ? NaN : Number(rawIndex);
      if (!Number.isInteger(index) || index < 0) {
        sendJson(res, 400, { ok: false, error: '章节号不对' });
        return;
      }
      try {
        const result = await cloud.chapter(book, index);
        const text = String(result?.text || '');
        if (!text.trim()) {
          sendJson(res, 502, { ok: false, error: result?.error || '这一章没有抓到正文' });
          return;
        }
        if (text.length > MAX_TEXT) {
          sendJson(res, 413, { ok: false, error: '这一章太大，局域网读取请回桌面端' });
          return;
        }
        sendJson(res, 200, { ok: true, index, text, fromCache: result.fromCache !== false });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: `正文获取失败：${err?.message || err}` });
      }
      return;
    }

    if (pathname.startsWith('/api/cover/') && method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/cover/'.length));
      const book = listBooks().find((item) => item?.id === id);
      if (!book) {
        sendText(res, 404, 'not found');
        return;
      }
      if (typeof book.cover === 'string' && book.cover.startsWith('data:')) {
        const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(book.cover);
        if (!match) {
          sendText(res, 404, 'bad cover');
          return;
        }
        const type = match[1] || 'image/jpeg';
        const buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
        if (buffer.length > MAX_COVER) {
          sendText(res, 413, 'cover too large');
          return;
        }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': buffer.length, 'Cache-Control': 'public, max-age=86400' });
        res.end(buffer);
        return;
      }
      let resolved = null;
      try {
        resolved = resolveCover(book);
      } catch {
        resolved = null;
      }
      if (resolved?.file && fs.existsSync(resolved.file)) {
        try {
          const buffer = fs.readFileSync(resolved.file);
          if (buffer.length > MAX_COVER) {
            sendText(res, 413, 'cover too large');
            return;
          }
          res.writeHead(200, {
            'Content-Type': coverMime(resolved.file),
            'Content-Length': buffer.length,
            'Cache-Control': 'public, max-age=86400',
          });
          res.end(buffer);
          return;
        } catch {
          /* 落到下面的 302 */
        }
      }
      if (resolved?.url) {
        res.writeHead(302, { Location: resolved.url, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      sendText(res, 404, 'not found');
      return;
    }

    if (pathname === '/api/progress' && method === 'POST') {
      if (!allowWrite) {
        sendJson(res, 403, { ok: false, error: '桌面端关闭了「允许写入进度」' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { ok: false, error: 'bad json' });
        return;
      }
      const id = String(payload?.id || '');
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : null;
      if (!id || !data) {
        sendJson(res, 400, { ok: false, error: 'missing id or data' });
        return;
      }
      // 只接受书架里存在的书：避免远端往 progress.json 里灌无关键。
      if (!listBooks().some((item) => item?.id === id)) {
        sendJson(res, 404, { ok: false, error: '书架上没有这本书' });
        return;
      }
      const clean = {
        ...data,
        updatedAt: Number(data.updatedAt) || Date.now(),
      };
      const current = readJson(files.progress, {}) || {};
      const { progress: merged, changed } = mergeProgress(current, { [id]: clean });
      if (changed) {
        const result = writeJson(files.progress, merged);
        if (result && result.ok === false) {
          sendJson(res, 500, { ok: false, error: result.error || '写入失败' });
          return;
        }
        log('info', `局域网写入进度：${id}`, { percent: Math.round(clean.percent || 0) });
        publish('progress', { progress: merged, origin: 'remote', at: Date.now() });
        try {
          onRemoteProgress(merged, id);
        } catch (err) {
          log('warn', `回推进度给桌面端失败：${err?.message || err}`);
        }
      }
      sendJson(res, 200, { ok: true, entry: merged[id] || null, applied: changed });
      return;
    }

    if (pathname === '/api/events' && method === 'GET') {
      handleEvents(req, res);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  }

  function describeHint(req) {
    // 只在登录页显示「怎么找到访问码」，不泄漏任何数据。转义交给调用方。
    const host = String(req.headers.host || '').split(':')[0];
    return host ? `访问码在桌面端「设置 → 网络」里，本机地址 ${host}` : '访问码在桌面端「设置 → 网络」里';
  }

  /* ---------------- 生命周期 ---------------- */

  function listen(port, host) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        handle(req, res).catch((err) => {
          log('warn', `局域网面板请求出错：${err?.message || err}`);
          if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' });
          else res.end();
        });
      });
      srv.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      srv.on('clientError', (_err, socket) => {
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
      });
      srv.once('error', reject);
      srv.listen(port, host, () => {
        srv.removeListener('error', reject);
        srv.on('error', (err) => log('error', `局域网面板服务异常：${err?.message || err}`));
        resolve(srv);
      });
    });
  }

  async function start(config = {}) {
    const desiredPort = Math.max(1, Math.min(65535, Number(config.port) || 7788));
    token = String(config.token || '').trim() || generateToken();
    allowWrite = config.allowWrite !== false;
    if (running) {
      // 端口/访问码可能变了：直接重启，逻辑最简单也最不容易留下半开状态。
      await stop();
    }
    let lastError = null;
    for (let offset = 0; offset < 8; offset += 1) {
      const port = desiredPort + offset;
      if (port > 65535) break;
      try {
        server = await listen(port, '0.0.0.0');
        actualPort = port;
        running = true;
        startedAt = Date.now();
        log('info', `局域网面板已启动：http://${lanAddresses()[0]?.address || '127.0.0.1'}:${port}`);
        return { ok: true, ...status() };
      } catch (err) {
        lastError = err;
        if (err?.code !== 'EADDRINUSE') break;
      }
    }
    running = false;
    server = null;
    const reason =
      lastError?.code === 'EADDRINUSE'
        ? `端口 ${desiredPort}～${desiredPort + 7} 都被占用了，换一个端口试试`
        : lastError?.code === 'EACCES'
          ? `没有权限监听端口 ${desiredPort}（换一个 1024 以上的端口）`
          : lastError?.message || '启动失败';
    log('warn', `局域网面板启动失败：${reason}`);
    return { ok: false, error: reason, ...status() };
  }

  async function stop() {
    for (const res of clients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    clients.clear();
    const srv = server;
    server = null;
    running = false;
    if (srv) {
      await new Promise((resolve) => {
        srv.close(() => resolve());
        // SSE 长连接会拖住 close，直接销毁所有 socket，不给它挂住的机会
        for (const socket of sockets) {
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
        }
        sockets.clear();
        setTimeout(resolve, 1500);
      });
    }
    actualPort = 0;
    return status();
  }

  return {
    start,
    stop,
    status,
    publish,
    setAllowWrite(value) {
      allowWrite = Boolean(value);
      publish('config', { allowWrite, at: Date.now() });
    },
    get running() {
      return running;
    },
    get port() {
      return actualPort;
    },
    get token() {
      return token;
    },
  };
}
