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
import dgram from 'node:dgram';
import { fileURLToPath } from 'url';
import { isInside } from './paths.js';
import { createBooksService } from './lan-books.js';
import { MAX_TRANSFER, MAX_CHUNK_BODY, CHUNK } from './bookfile.js';
import { MAX_IMAGE } from './lan-comic.js';

const MAX_BODY = 512 * 1024; // 请求体上限：进度条目再多也到不了这个量级
const MAX_TEXT = 12 * 1024 * 1024; // 单本正文上限：超过就不往手机上推了
const MAX_COVER = 4 * 1024 * 1024;
// 2.6.0 新增能力的三档上限（架构文档 §8 冻结值，常量在各自模块里，这里只做统一出口）
const LIMITS = { transfer: MAX_TRANSFER, chunk: CHUNK, chunkBody: MAX_CHUNK_BODY, image: MAX_IMAGE };
/** 接口版本：手机端拿它判断「桌面端太旧」。2 = 2.6.0 起的能力集。 */
const API_VERSION = 2;
/** ping 里的能力位：手机据此开关功能，不认识的忽略即可。 */
const API_FEATURES = ['library', 'upload', 'download', 'range', 'comic', 'devices', 'marks'];
const SSE_PING = 25000;
/** 手机快照上限 256KB（PRD §2.1）。 */
const MAX_SNAPSHOT_BODY = 256 * 1024;
const COOKIE_NAME = 'folio_lan';
// 手机端的「搜索桌面端」走一次 UDP 广播，平时不广播、不占线程。
const DISCOVERY_PORT = 45678;
const DISCOVERY_MAGIC = 'folio-discover';

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

/**
 * 取非负整数查询参数。缺参数、非数字、负数一律返回 null（调用方回 400）。
 * 注意 Number(null) === 0，所以必须先分辨「没给」和「给了 0」。
 */
function intParam(url, name) {
  const raw = url.searchParams.get(name);
  if (raw === null || String(raw).trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * 解析上传块的 `X-Folio-Offset`。缺失 / 空串 / 非整数 / 负数 / 超界一律判非法。
 *
 * 不能写成 `Number(req.headers['x-folio-offset'] || 0)`：缺头时 `Number('')`
 * 正好是 0，服务端会把「客户端漏发头」当成「从第 0 字节开始」静默接受，
 * 客户端以为在续传，实际从头收了一遍。
 *
 * @param {string|string[]|undefined} raw Node 给的原始头（重复头可能是数组）
 * @param {number} total 客户端声明的文件总大小；非法时跳过上界检查
 * @returns {{ok:true, value:number}|{ok:false, message:string}}
 */
function parseOffsetHeader(raw, total) {
  if (Array.isArray(raw)) return { ok: false, message: 'X-Folio-Offset 只能有一个值' };
  if (raw === undefined || raw === null) return { ok: false, message: '缺少 X-Folio-Offset 头' };
  const text = String(raw).trim();
  if (!text) return { ok: false, message: 'X-Folio-Offset 不能为空' };
  // 必须整串能读成整数：Number('12abc') / Number('1.5') 都不是整数，
  // 而 parseInt('12abc') 会悄悄得到 12。
  const value = Number(text);
  if (!Number.isInteger(value)) return { ok: false, message: 'X-Folio-Offset 必须是整数' };
  if (value < 0) return { ok: false, message: 'X-Folio-Offset 不能是负数' };
  if (Number.isInteger(total) && total >= 0 && value > total) {
    return { ok: false, message: 'X-Folio-Offset 超出了文件总大小' };
  }
  return { ok: true, value };
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

/**
 * 读二进制请求体。**不要**复用上面的 readBody —— 它结尾做 `toString('utf8')`，
 * 分块上传是任意字节流，过一遍字符串会把非法 UTF-8 序列替换成 U+FFFD，
 * 算出来的 sha1 永远对不上，且不会报错，只在 commit 时莫名其妙 422。
 *
 * 超限时先 pause 再 reject：让调用方还能把 413 写出去，然后自己销毁连接。
 * 若请求带了 Content-Length 且一开始就超限，直接不读 body。
 *
 * @param {import('http').IncomingMessage} req
 * @param {number} [limit] 上限字节数
 * @returns {Promise<Buffer>} 完整请求体
 */
function readBodyBuffer(req, limit = MAX_CHUNK_BODY) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => {
      const err = new Error('payload too large');
      err.code = 'TOO_LARGE';
      return err;
    };
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let over = false;
    const onData = (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        // 不再缓存后面任何一个字节，也不再往下读，交给调用方回 413 并断连接
        over = true;
        chunks.length = 0;
        req.pause();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (over) return;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (over) return;
      over = true;
      reject(err);
    });
  });
}

/**
 * 读快照这种「有明确上限、超限也要好好回 400」的 body。
 *
 * 和 `readBodyBuffer` 的区别：一超过 limit 就立刻返回 `over:true`，不把整段
 * 超大 body 收进内存；调用方回 400 后 `req.resume()` 把剩余字节排空即可。
 * 这样客户端收到的是 400，而不是 socket reset。
 *
 * @returns {Promise<{over:boolean, buffer:Buffer}>}
 */
function readBodyCapped(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      resolve(result);
    };
    const onData = (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        finish({ over: true, buffer: Buffer.alloc(0) });
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.once('end', () => finish({ over: false, buffer: Buffer.concat(chunks) }));
    req.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
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

/**
 * 取一个标量请求头。重复头在 Node 里可能是数组（或逗号拼接），设备身份必须是单一值，
 * 这种情况按「没带」处理，避免把 "id1, id2" 建成一台幽灵设备。
 */
function headerText(req, name) {
  const value = req.headers[name];
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return '';
  return String(value).trim();
}

/** `X-Folio-Device`：只收安全字符，UUID 之外的脏值直接当没带。 */
function deviceIdOf(req) {
  const id = headerText(req, 'x-folio-device');
  if (!id || id.length > 128) return '';
  return /^[A-Za-z0-9._:-]+$/.test(id) ? id : '';
}

/** `X-Folio-Device-Name`：可能被客户端 percent-encode，解开失败就原样用。 */
function deviceNameOf(req) {
  const raw = headerText(req, 'x-folio-device-name');
  return raw ? safeDecode(raw).slice(0, 80) : '';
}

/**
 * 解析单区间 Range 头。只支持 `bytes=N-` 与 `bytes=N-M`（手机端只需要 N-）。
 *
 * @param {string|undefined} header
 * @returns {{ok:true, from:number, to:number|null}|{ok:false}|null}
 *          null = 没有 Range 头；{ok:false} = 有但格式不认识
 */
function parseRangeHeader(header) {
  const raw = String(header || '').trim();
  if (!raw) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(raw);
  if (!match) return { ok: false };
  const from = Number(match[1]);
  const to = match[2] === '' ? null : Number(match[2]);
  if (!Number.isFinite(from) || from < 0) return { ok: false };
  if (to !== null && (!Number.isFinite(to) || to < from)) return { ok: false };
  return { ok: true, from, to };
}

/** Content-Disposition：ASCII 兜底 + RFC 5987 的 UTF-8 原名，中文书名不会被截成问号。 */
function contentDisposition(name) {
  const safe = String(name || 'book').replace(/[\\"\r\n]/g, '_').slice(0, 80) || 'book';
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}.txt"; filename*=UTF-8''${encodeURIComponent(`${safe}.txt`)}`;
}

/* ------------------------------------------------------------------ */
/*  服务本体                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  痕迹（书签 / 划线 / 笔记）                                          */
/* ------------------------------------------------------------------ */

/**
 * 同一处痕迹的稳定键，必须与 Android `ReaderMark.syncKey` 完全一致：
 * `kind|chapterNo|paraIndex`。两端的 id 都是各自生成的，不能拿来对齐。
 */
function markKeyOf(mark) {
  return `${mark.kind || 'bookmark'}|${Number(mark.chapterNo) || -1}|${Number(mark.paraIndex) || 0}`;
}

/** 谁更新；老数据没有 updatedAt 时退回 createdAt。 */
function markStampOf(mark) {
  return Number(mark.updatedAt) || Number(mark.createdAt) || 0;
}

/** 只收已知字段并截断长文本，防止远端把 marks.json 灌成几十 MB。 */
function cleanMark(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const paraIndex = Number(raw.paraIndex);
  if (!Number.isFinite(paraIndex) || paraIndex < 0) return null;
  const chapterNo = Number(raw.chapterNo);
  const chapterIndex = Number(raw.chapterIndex);
  const createdAt = Number(raw.createdAt) || Date.now();
  const updatedAt = markStampOf(raw) || createdAt;
  return {
    id: String(raw.id || '').slice(0, 128) || crypto.randomUUID(),
    paraIndex: Math.floor(paraIndex),
    chapter: String(raw.chapter || '').slice(0, 200),
    chapterIndex: Number.isFinite(chapterIndex) ? Math.floor(chapterIndex) : 0,
    chapterNo: Number.isFinite(chapterNo) ? Math.floor(chapterNo) : -1,
    excerpt: String(raw.excerpt || '').slice(0, 2000),
    note: String(raw.note || '').slice(0, 4000),
    kind: raw.kind === 'highlight' ? 'highlight' : 'bookmark',
    createdAt,
    updatedAt,
  };
}

/**
 * @param {object} opts
 * @param {object} opts.files       主进程的 json 路径表（books / progress / settings）
 * @param {string} opts.booksDir    本地书正文副本目录（用于校验读书路径）
 * @param {(file:string, fallback:any)=>any} opts.readJson
 * @param {(file:string, data:any)=>any} opts.writeJson
 * @param {(level:string, msg:string, meta?:any)=>void} [opts.log]
 * @param {(merged:object, bookId:string)=>void} [opts.onRemoteProgress]
 * @param {(all:object, bookId:string)=>void} [opts.onRemoteMarks] 手机写回痕迹后的回推（渲染层刷新）
 * @param {(book:object)=>({file?:string,url?:string}|null)} [opts.resolveCover]
 * @param {()=>string} [opts.getVersion]
 * @param {object|null} [opts.comic] 漫画取图代理（createComicService 的返回值）
 * @param {(id:string)=>void} [opts.onBooksChanged] 上传成功后的书架回推（渲染层刷新）
 * @param {object|null} [opts.devices] 设备存储（createDeviceStore 的返回值）
 * @param {(id:string, online:boolean)=>void} [opts.onDeviceChanged] 设备在线态变化回推（渲染层广播）
 */
export function createLanService(opts) {
  const {
    files,
    booksDir,
    readJson,
    writeJson,
    log = () => {},
    onRemoteProgress = () => {},
    onRemoteMarks = () => {},
    resolveCover = () => null,
    getVersion = () => '',
    // 云端书的目录/正文由主进程提供（那里才有书源引擎与磁盘缓存）。
    // 面板不接触书源，也不需要手机能访问书源站。
    cloud = null,
    // 漫画取图同样是主进程的能力（复用 cloud:chapter-images + fetchCoverResponse）。
    // 没注入就 501，不影响其它接口。
    comic = null,
    // 上传落盘后要让桌面端书架立刻看到新书；由主进程注入 broadcast('lan:books')。
    onBooksChanged = () => {},
    // 设备记录与指令队列；没注入时设备路由回 501，旧桌面行为不变。
    devices = null,
    // 设备在线/离线时通知主进程 broadcast('lan:device')。
    onDeviceChanged = () => {},
  } = opts;

  // 清单/下载/上传的磁盘语义都在这一层，lan.js 只做 HTTP。
  const bookService = createBooksService({
    files,
    booksDir,
    readJson,
    writeJson,
    log,
    publish: (event, payload) => publish(event, payload),
    onBooksChanged,
  });

  const assetsDir = path.dirname(fileURLToPath(import.meta.url));
  const assetCache = new Map();

  let server = null;
  let running = false;
  let actualPort = 0;
  let token = '';
  let allowWrite = true;
  let startedAt = 0;
  let discovery = null;
  // res → deviceId（浏览器面板没有设备头，记 null）。用 Map 才能知道断开的是哪台手机。
  const clients = new Map();
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

  /** 设备在线态变化：面板走 SSE，桌面渲染层走主进程广播。 */
  function emitDevice(id, online) {
    if (!id) return;
    const payload = { id, online, at: Date.now() };
    publish('device', payload);
    try {
      onDeviceChanged(id, online);
    } catch (err) {
      log('warn', `设备在线态回推失败：${err?.message || err}`);
    }
  }

  function publish(event, payload) {
    if (!running || !clients.size) return;
    const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients.keys()) {
      try {
        res.write(chunk);
      } catch {
        clients.delete(res);
      }
    }
  }

  function handleEvents(req, res, deviceId) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, allowWrite, at: Date.now() })}\n\n`);

    const owner = deviceId || null;
    clients.set(res, owner);
    // 0→1：手机前台连上，立刻告诉面板/渲染层「在线」。
    if (owner && devices) {
      const before = devices.deviceSseCount(owner);
      devices.noteSseOpen(owner);
      if (before === 0) emitDevice(owner, true);
    }

    const ping = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* 下次写失败会被清理 */
      }
    }, SSE_PING);

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      clients.delete(res);
      // 1→0：最后一根连接断了，立刻发离线事件（90s 弱在线窗口仍由 onlineOf 负责）。
      if (owner && devices) {
        const after = devices.noteSseClose(owner);
        if (after === 0) emitDevice(owner, false);
      }
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  }

  /* ---------------- 2.6.0：下载 / 上传 / 漫画 ---------------- */

  /**
   * 整文件下载。用 createReadStream(file, {start}) 流式发，绝不把 30MB 读进内存。
   * 200 / 206 由 `Range: bytes=N-` 决定；越界 416，超限 413，非本地书 409。
   */
  function handleDownload(req, res, id) {
    const range = parseRangeHeader(req.headers.range);
    if (range && range.ok === false) {
      sendJson(res, 416, { ok: false, error: '只支持单区间的 Range，形如 bytes=1024-' });
      return;
    }
    const start = range && range.ok ? range.from : 0;
    let opened;
    try {
      opened = bookService.openDownload(id, start);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: `打开正文失败：${err?.message || err}` });
      return;
    }
    if (!opened.ok) {
      const body = JSON.stringify({ ok: false, error: opened.error });
      if (opened.status === 416 && Number.isFinite(opened.size)) {
        // 416 必须带 Content-Range，客户端才知道真实长度
        res.writeHead(416, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Content-Range': `bytes */${opened.size}`,
          'Cache-Control': 'no-store',
        });
        res.end(body);
        return;
      }
      sendJson(res, opened.status || 400, { ok: false, error: opened.error });
      return;
    }

    // 客户端给了上界就尊重它，但绝不越过文件尾
    const end = range && range.ok && range.to !== null ? Math.min(range.to, opened.size - 1) : opened.size - 1;
    const length = Math.max(0, end - start + 1);
    // 只要带了合法 Range 就必须回 206：哪怕起点是 0，body 也只是一段而不是整本
    const partial = Boolean(range && range.ok);
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Folio-Hash': opened.hash || '',
      'X-Folio-Size': String(opened.size),
      'Content-Disposition': contentDisposition(opened.title),
    };
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${opened.size}`;
    res.writeHead(partial ? 206 : 200, headers);
    if (!length) {
      res.end();
      return;
    }

    const stream = fs.createReadStream(opened.file, { start, end });
    stream.on('error', (err) => {
      log('warn', `下载正文中断：${err?.message || err}`);
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    });
    // 手机中途走了就立刻停止读盘，不为一条已经断掉的连接读完 30MB
    res.on('close', () => {
      try {
        stream.destroy();
      } catch {
        /* ignore */
      }
    });
    stream.pipe(res);
  }

  /**
   * 分块上传。body 是 application/octet-stream，只按 offset 追加进 `.part`；
   * 收齐后由 lan-books 校验 sha1、原子落盘、写 books.json。
   */
  async function handleUploadChunk(req, res) {
    if (!allowWrite) {
      sendJson(res, 403, { ok: false, error: '桌面端关闭了「允许写入」' });
      return;
    }
    const header = (name) => {
      const value = req.headers[name];
      return String(Array.isArray(value) ? value[0] : value || '').trim();
    };
    const hash = header('x-folio-hash').toLowerCase();
    const total = Number(header('x-folio-total'));
    const parsedOffset = parseOffsetHeader(req.headers['x-folio-offset'], total);
    if (!parsedOffset.ok) {
      // 先把 body 排空，才能安全复用连接；坏头的块本身没有解析价值。
      try {
        req.resume();
      } catch {
        /* 已经读完就算了 */
      }
      sendJson(res, 400, { error: 'bad_offset', message: parsedOffset.message });
      return;
    }
    const offset = parsedOffset.value;
    const title = safeDecode(header('x-folio-name')) || '手机导入的书';

    let body;
    try {
      body = await readBodyBuffer(req, MAX_CHUNK_BODY);
    } catch (err) {
      if (err?.code === 'TOO_LARGE') {
        try {
          res.setHeader('Connection', 'close');
        } catch {
          /* 已经发过头了也照样试一次 */
        }
        // 413 先发完，再把连接断掉：剩下的字节没有意义，让它把带宽占完更糟。
        // 断在 finish 之后才不会把 413 本身截掉。
        res.once('finish', () => {
          try {
            req.destroy();
          } catch {
            /* ignore */
          }
        });
        sendJson(res, 413, { ok: false, error: '这一块太大了，单块上限 6MB' });
        return;
      }
      sendJson(res, 400, { ok: false, error: '读不到这一块的数据' });
      return;
    }

    const result = bookService.appendChunk({ hash, offset, total, title, chunk: body });
    if (result.ok) {
      sendJson(res, 200, result);
      return;
    }
    const payload = { ok: false, error: result.error };
    if (result.received !== undefined) payload.received = result.received;
    payload.done = false;
    sendJson(res, result.status || 400, payload);
  }

  /**
   * 漫画取图。清单只回 total（源站 URL 不出机器），取图回 `image/*` 字节。
   */
  async function handleComic(res, url, pathname) {
    const rest = pathname.slice('/api/comic/'.length);
    const isPage = rest.endsWith('/page');
    const isPages = rest.endsWith('/pages');
    if (!isPage && !isPages) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    const id = safeDecode(rest.slice(0, rest.length - (isPage ? '/page'.length : '/pages'.length)));
    if (!comic || typeof comic.pages !== 'function' || typeof comic.image !== 'function') {
      sendJson(res, 501, { ok: false, error: '当前版本没有接入漫画取图' });
      return;
    }
    const book = listBooks().find((item) => item?.id === id);
    if (!book) {
      sendJson(res, 404, { ok: false, error: '书架上没有这本书' });
      return;
    }
    const index = intParam(url, 'i');
    if (index === null) {
      sendJson(res, 400, { ok: false, error: '话号不对' });
      return;
    }

    try {
      if (isPages) {
        const result = await comic.pages(book, index);
        if (!result.ok) {
          sendJson(res, result.status || 502, { ok: false, error: result.error });
          return;
        }
        sendJson(res, 200, { ok: true, i: index, total: result.total, fromCache: result.fromCache === true });
        return;
      }

      const page = intParam(url, 'p');
      if (page === null) {
        sendJson(res, 400, { ok: false, error: '页号不对' });
        return;
      }
      const result = await comic.image(book, index, page);
      if (!result.ok) {
        const payload = { ok: false, error: result.error };
        if (result.total !== undefined) payload.total = result.total;
        sendJson(res, result.status || 502, payload);
        return;
      }
      const body = result.buffer;
      if (!body || !body.length) {
        sendJson(res, 502, { ok: false, error: '源站没有返回这张图', total: result.total });
        return;
      }
      if (body.length > MAX_IMAGE) {
        sendJson(res, 413, { ok: false, error: '这一页太大（超过 6MB），手机端无法显示' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': result.type || 'image/jpeg',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        // 1 基的「第几页/共几页」，方便手机端显示页码条
        'X-Folio-Page': `${result.page + 1}/${result.total}`,
      });
      res.end(body);
    } catch (err) {
      log('warn', `漫画取图出错：${err?.message || err}`);
      if (!res.headersSent) sendJson(res, 502, { ok: false, error: '漫画取图失败，请稍后重试' });
      else res.end();
    }
  }

  /* ---------------- 2.7.0：设备管理（手机端 HTTP） ---------------- */

  /** 设备服务没注入时统一回 501：旧桌面不会误报支持。 */
  function noDevices(res) {
    sendJson(res, 501, { ok: false, error: '当前版本没有接入设备管理' });
  }

  /** devicestore 的 code → HTTP 状态码。 */
  function sendDeviceError(res, err) {
    const code = err?.code || '';
    if (['bad_state', 'bad_payload', 'bad_hash', 'bad_type', 'bad_device', 'bad_name'].includes(code)) {
      sendJson(res, 400, { ok: false, error: code, message: err.message });
      return;
    }
    if (code === 'not_found') {
      sendJson(res, 404, { ok: false, error: 'not_found', message: err.message });
      return;
    }
    log('warn', `设备管理出错：${err?.message || err}`);
    sendJson(res, 500, { ok: false, error: err?.message || '设备操作失败' });
  }

  /** POST /api/device/heartbeat —— presence + 待执行条数。 */
  function handleDeviceHeartbeat(req, res, deviceId) {
    if (!devices) return noDevices(res);
    if (!deviceId) {
      req.resume();
      sendJson(res, 400, { ok: false, error: 'missing_device', message: '缺少 X-Folio-Device 头' });
      return;
    }
    req.resume();
    try {
      const device = devices.get(deviceId);
      if (!device) {
        sendJson(res, 404, { ok: false, error: 'not_found' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        device: { id: device.id, name: device.name, online: device.online },
        pending: devices.pendingCount(deviceId),
        serverTime: Date.now(),
      });
    } catch (err) {
      sendDeviceError(res, err);
    }
  }

  /** POST /api/device/snapshot —— 手机书架摘要，30s 节流在 devicestore 里做。 */
  async function handleDeviceSnapshot(req, res, deviceId) {
    if (!devices) {
      req.resume();
      return noDevices(res);
    }
    if (!deviceId) {
      req.resume();
      sendJson(res, 400, { ok: false, error: 'missing_device', message: '缺少 X-Folio-Device 头' });
      return;
    }
    let buffer;
    try {
      const result = await readBodyCapped(req, MAX_SNAPSHOT_BODY);
      if (result.over) {
        // 已经判定超限：把剩余字节排空再回 400，避免 keep-alive 连接里留下半截 body。
        req.resume();
        sendJson(res, 400, { ok: false, error: 'snapshot_too_large', message: '快照最多 256KB' });
        return;
      }
      buffer = result.buffer;
    } catch (err) {
      sendJson(res, 400, { ok: false, error: 'bad_snapshot', message: '读不到快照数据' });
      return;
    }

    let snapshot;
    try {
      snapshot = JSON.parse(buffer.toString('utf8'));
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad_snapshot', message: '快照不是合法 JSON' });
      return;
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.books)) {
      sendJson(res, 400, { ok: false, error: 'bad_snapshot', message: '快照格式不对，books 必须是数组' });
      return;
    }

    try {
      const result = devices.setSnapshot(deviceId, snapshot);
      sendJson(res, 200, {
        ok: true,
        snapshotAt: result.snapshotAt,
        accepted: true,
        ...(result.throttled ? { throttled: true } : {}),
      });
    } catch (err) {
      sendDeviceError(res, err);
    }
  }

  /** GET /api/device/commands —— 读时先清扫，只回 pending，按 createdAt 升序。 */
  function handleDeviceCommands(res, deviceId) {
    if (!devices) return noDevices(res);
    // 旧手机/浏览器面板没有设备头：能过鉴权，但绝不建档、绝不发指令。
    if (!deviceId) {
      sendJson(res, 200, { ok: true, commands: [] });
      return;
    }
    try {
      sendJson(res, 200, { ok: true, commands: devices.claim(deviceId) });
    } catch (err) {
      // 记录刚好被上限淘汰：当作「没有指令」，手机下次心跳会重新建档。
      if (err?.code === 'not_found') {
        sendJson(res, 200, { ok: true, commands: [] });
        return;
      }
      sendDeviceError(res, err);
    }
  }

  /** POST /api/device/commands/:id/receipt —— done/failed 回执，完结进 history。 */
  async function handleDeviceReceipt(req, res, deviceId, commandId) {
    if (!devices) {
      req.resume();
      return noDevices(res);
    }
    if (!deviceId) {
      req.resume();
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }
    let body;
    try {
      body = await readBody(req, 8192);
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad_receipt', message: '读不到回执数据' });
      return;
    }
    let input;
    try {
      input = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad_receipt', message: '回执不是合法 JSON' });
      return;
    }
    try {
      const result = devices.receipt(deviceId, commandId, input || {});
      sendJson(res, 200, { ok: true, state: result.state });
    } catch (err) {
      sendDeviceError(res, err);
    }
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
    // 本次请求携带的设备身份；SSE / 设备路由都从这里拿，浏览器面板为空串。
    let requestDeviceId = '';

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
      // 带设备头的任何认证请求都刷新 lastSeenAt；没带头的旧手机/浏览器完全不受影响。
      const incomingDeviceId = deviceIdOf(req);
      if (incomingDeviceId && devices) {
        requestDeviceId = incomingDeviceId;
        try {
          devices.upsertSeen({
            id: incomingDeviceId,
            name: deviceNameOf(req),
            platform: headerText(req, 'x-folio-platform') || 'android',
            appVersion: headerText(req, 'x-folio-app-version'),
            apiVersion: headerText(req, 'x-folio-api-version'),
            ip: req.socket?.remoteAddress || '',
          });
        } catch (err) {
          log('warn', `设备建档失败：${err?.message || err}`);
        }
      }
    }

    if (pathname === '/api/ping') {
      // 只加字段不改旧字段：老客户端读 ok/port/version 照样能跑。
      sendJson(res, 200, {
        ok: true,
        port: actualPort,
        version: getVersion(),
        apiVersion: API_VERSION,
        features: API_FEATURES.slice(),
        limits: { ...LIMITS },
      });
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

    /* ---------- 2.7.0：设备管理（手机端） ---------- */

    if (pathname === '/api/device/heartbeat' && method === 'POST') {
      handleDeviceHeartbeat(req, res, requestDeviceId);
      return;
    }

    if (pathname === '/api/device/snapshot' && method === 'POST') {
      await handleDeviceSnapshot(req, res, requestDeviceId);
      return;
    }

    if (pathname === '/api/device/commands' && method === 'GET') {
      handleDeviceCommands(res, requestDeviceId);
      return;
    }

    if (pathname.startsWith('/api/device/commands/') && pathname.endsWith('/receipt') && method === 'POST') {
      const commandId = safeDecode(pathname.slice('/api/device/commands/'.length, -'/receipt'.length));
      if (!commandId) {
        req.resume();
        sendJson(res, 404, { ok: false, error: 'not_found' });
        return;
      }
      await handleDeviceReceipt(req, res, requestDeviceId, commandId);
      return;
    }

    /* ---------- 2.6.0：清单 / 整文件下载 / 分块上传 / 漫画取图 ---------- */

    // 清单：手机拿它跟本地 books.json 做 hash 差集，桌面端不存任何「已同步」状态
    if (pathname === '/api/library' && method === 'GET') {
      try {
        sendJson(res, 200, bookService.library());
      } catch (err) {
        sendJson(res, 500, { ok: false, error: `清单读取失败：${err?.message || err}` });
      }
      return;
    }

    // 整文件下载。必须排在 /api/book/:id 前面：那条是前缀匹配，会把
    // `/api/book/<id>/download` 当成 id 为 `<id>/download` 的正文请求。
    if (pathname.startsWith('/api/book/') && pathname.endsWith('/download') && method === 'GET') {
      const id = safeDecode(pathname.slice('/api/book/'.length, -'/download'.length));
      handleDownload(req, res, id);
      return;
    }

    if (pathname === '/api/upload/status' && method === 'GET') {
      if (!allowWrite) {
        sendJson(res, 403, { ok: false, error: '桌面端关闭了「允许写入」' });
        return;
      }
      const result = bookService.uploadStatus({
        hash: url.searchParams.get('hash'),
        size: url.searchParams.get('size'),
      });
      if (result.ok) sendJson(res, 200, result);
      else sendJson(res, result.status || 400, { ok: false, error: result.error });
      return;
    }

    if (pathname === '/api/upload/chunk' && method === 'POST') {
      await handleUploadChunk(req, res);
      return;
    }

    if (pathname.startsWith('/api/upload/') && method === 'DELETE') {
      if (!allowWrite) {
        sendJson(res, 403, { ok: false, error: '桌面端关闭了「允许写入」' });
        return;
      }
      const result = bookService.discardUpload(safeDecode(pathname.slice('/api/upload/'.length)));
      if (result.ok) sendJson(res, 200, { ok: true });
      else sendJson(res, result.status || 500, { ok: false, error: result.error });
      return;
    }

    if (pathname.startsWith('/api/comic/') && method === 'GET') {
      await handleComic(res, url, pathname);
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

    /* ---------- 3.3.0：双端痕迹（书签 / 划线 / 笔记） ---------- */

    if (pathname === '/api/marks' && method === 'GET') {
      sendJson(res, 200, { ok: true, marks: readJson(files.marks, {}) || {} });
      return;
    }

    if (pathname === '/api/marks' && method === 'POST') {
      if (!allowWrite) {
        sendJson(res, 403, { ok: false, error: '桌面端关闭了「允许写入」' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { ok: false, error: 'bad json' });
        return;
      }
      const id = String(payload?.id || '').slice(0, 512);
      if (!id) {
        sendJson(res, 400, { ok: false, error: 'missing id' });
        return;
      }
      const incoming = Array.isArray(payload?.marks) ? payload.marks : [];
      const remove = Array.isArray(payload?.remove) ? payload.remove.map(String) : [];

      const all = readJson(files.marks, {}) || {};
      const byKey = new Map();
      const current = Array.isArray(all[id]) ? all[id] : [];
      for (const item of current) {
        const mark = cleanMark(item);
        if (mark) byKey.set(markKeyOf(mark), mark);
      }

      let added = 0;
      let updated = 0;
      let removed = 0;
      for (const raw of incoming) {
        const mark = cleanMark(raw);
        if (!mark) continue;
        const key = markKeyOf(mark);
        const old = byKey.get(key);
        if (!old) {
          byKey.set(key, mark);
          added += 1;
        } else if (markStampOf(mark) >= markStampOf(old)) {
          // 手机已经做过一次 newer-wins 合并；同毫秒也接受，避免两端来回推
          byKey.set(key, mark);
          updated += 1;
        }
      }
      for (const key of remove) {
        if (byKey.delete(key)) removed += 1;
      }

      const next = Array.from(byKey.values()).sort(
        (a, b) => a.chapterNo - b.chapterNo || a.paraIndex - b.paraIndex || a.createdAt - b.createdAt,
      );
      all[id] = next;
      const result = writeJson(files.marks, all);
      if (result && result.ok === false) {
        sendJson(res, 500, { ok: false, error: result.error || '写入失败' });
        return;
      }
      if (added || updated || removed) {
        log('info', `局域网写入痕迹：${id}`, { added, updated, removed });
        publish('marks', { bookId: id, at: Date.now() });
        try {
          onRemoteMarks(all, id);
        } catch (err) {
          log('warn', `回推痕迹给桌面端失败：${err?.message || err}`);
        }
      }
      sendJson(res, 200, { ok: true, marks: next, added, updated, removed });
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
      handleEvents(req, res, requestDeviceId);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  }

  function describeHint(req) {
    // 只在登录页显示「怎么找到访问码」，不泄漏任何数据。转义交给调用方。
    const host = String(req.headers.host || '').split(':')[0];
    return host ? `访问码在桌面端「设置 → 网络」里，本机地址 ${host}` : '访问码在桌面端「设置 → 网络」里';
  }

  /* ---------------- 局域网发现（UDP） ---------------- */

  /**
   * 选一个手机能连上的本机地址：优先跟请求方同网段的那个。
   * 手机发的是广播，来源地址只能说明对方网段，不能直接拿来当自己的地址。
   */
  function pickHostFor(remote) {
    const list = lanAddresses();
    if (!list.length) return remote;
    const prefix = String(remote || '').split('.').slice(0, 2).join('.');
    const hit = list.find((item) => String(item.address).split('.').slice(0, 2).join('.') === prefix);
    return (hit || list[0]).address;
  }

  /**
   * 桌面端发现服务：手机在设置里点「搜索桌面端」时广播一次，
   * 桌面端回一条地址。平时不广播、不轮询，也不常驻线程。
   */
  function startDiscovery() {
    if (discovery) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('error', (err) => {
      log('warn', `局域网发现不可用：${err?.message || err}`);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      if (discovery === socket) discovery = null;
    });
    socket.on('message', (msg, rinfo) => {
      if (String(msg).trim() !== DISCOVERY_MAGIC) return;
      if (!running || !actualPort) return;
      const payload = JSON.stringify({
        name: 'Folio',
        host: pickHostFor(rinfo.address),
        port: actualPort,
        version: getVersion(),
      });
      socket.send(payload, rinfo.port, rinfo.address, (err) => {
        if (err) log('warn', `发现回复失败：${err.message}`);
      });
    });
    socket.bind(DISCOVERY_PORT, () => {
      discovery = socket;
      log('info', `局域网发现端口 ${DISCOVERY_PORT} 已监听`);
    });
  }

  function stopDiscovery() {
    const socket = discovery;
    discovery = null;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      /* ignore */
    }
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
        startDiscovery();
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
    stopDiscovery();
    // 漫画的内存缓存跟着服务一起释放，别让一个已停止的服务还占着几十 MB
    try {
      comic?.clear?.();
    } catch {
      /* ignore */
    }
    for (const [res, owner] of clients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
      // 服务停了，SSE 计数必须一起归零；否则下次启动 devices.json 的在线态会一直是真的。
      if (owner && devices) devices.noteSseClose(owner);
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
