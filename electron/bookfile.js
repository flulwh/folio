/**
 * 书架文件层 —— 文件哈希、原子写、分块上传会话、contentHash 懒补齐。
 *
 * 这一层只碰磁盘，不认识 HTTP，也不认识 Electron。局域网面板（lan.js / lan-books.js）
 * 与主进程启动自愈都用它，所以同一份「上传怎么落盘」只有一处实现。
 *
 * 设计约束：
 *  1. sha1 必须流式算。30MB 的书一次 readFileSync 会把主进程内存顶起来，
 *     这里固定 1MB 缓冲区循环读。
 *  2. 落盘必须原子。先写 `*.tmp` 再 rename，中途断电最坏也只是留下一个 tmp，
 *     不会出现「半本正文」的 books/*.txt。
 *  3. 上传会话按 sha1 命名（`books/.incoming/<hash>.part`）。同内容重复上传天然幂等：
 *     offset 只按已收字节追加，收齐后重算 sha1 再 rename。
 *  4. contentHash 口径固定为 `sha1(books/*.txt 的 UTF-8 字节)`，绝不用用户原始文件字节 ——
 *     GBK 原始文件与桌面端 UTF-8 副本的 sha1 必然不同，会互相判成冲突。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isInside } from './paths.js';

/* ------------------------------------------------------------------ */
/*  常量（与架构文档 §8 共用一份，别的模块从这里 import，别各写一套）      */
/* ------------------------------------------------------------------ */

/** 单本可传输上限 30MiB。超过只能在本机读，永不参与同步。 */
export const MAX_TRANSFER = 30 * 1024 * 1024;
/** 分块大小 4MiB：30MB 最多 8 块，串行发送。 */
export const CHUNK = 4 * 1024 * 1024;
/** 单个分块请求体上限 6MiB（给 4MiB 留出余量，同时不抬高全局 MAX_BODY）。 */
export const MAX_CHUNK_BODY = 6 * 1024 * 1024;
/** 上传会话临时目录名，位于 books/ 下面，保证与最终文件同盘（rename 才原子）。 */
export const INCOMING_DIR = '.incoming';

/** 40 位小写十六进制 —— 与服务端最终内容一一对应。 */
const HASH_RE = /^[0-9a-f]{40}$/;

/**
 * 判断字符串是否为合法的 sha1（40 位小写 hex）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isHash(value) {
  return HASH_RE.test(String(value ?? ''));
}

/* ------------------------------------------------------------------ */
/*  纯函数：哈希 / 原子写 / 文件名                                        */
/* ------------------------------------------------------------------ */

/** 流式读盘用的缓冲区大小。1MB 在「系统调用次数」和「内存占用」之间比较平衡。 */
const READ_CHUNK = 1024 * 1024;

/**
 * 算 sha1。传入 Buffer 直接算内存，传入路径则流式读盘。
 * @param {string|Buffer} target 文件绝对路径，或内存里的字节
 * @returns {string} 40 位小写 hex
 */
export function fileSha1(target) {
  if (Buffer.isBuffer(target)) {
    return crypto.createHash('sha1').update(target).digest('hex');
  }
  const file = String(target || '');
  if (!file) throw new Error('算 sha1 需要一个文件路径或 Buffer');
  const fd = fs.openSync(file, 'r');
  try {
    const hash = crypto.createHash('sha1');
    const buffer = Buffer.allocUnsafe(READ_CHUNK);
    // 逐块读，永远不把整本正文摊进内存
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
    return hash.digest('hex');
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* 关不掉也没别的办法，忽略 */
    }
  }
}

/**
 * 原子写：先写同目录的 `.tmp`，再 rename 到目标。目录不存在会自动建。
 * @param {string} target 目标文件绝对路径
 * @param {string|Buffer} content 内容
 * @returns {string} 目标文件绝对路径
 */
export function atomicWrite(target, content) {
  const file = path.resolve(String(target || ''));
  if (!file) throw new Error('原子写缺少目标路径');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const data = Buffer.isBuffer(content) ? content : String(content ?? '');
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
  return file;
}

/**
 * 把书名压成一个安全的文件名主干。与 main.js 里的 safeBase 保持同一套规则，
 * 不 import main.js 是因为那个文件会拉起整个 Electron 应用。
 * @param {string} name
 * @returns {string}
 */
export function safeBase(name) {
  return (
    String(name || '未命名')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '未命名'
  );
}

/** 文件大小，读不到就当 0。 */
function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** 判断文件是否存在且是普通文件。 */
function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  会话套件（绑定一个 books/ 目录 + 一份 books.json）                    */
/* ------------------------------------------------------------------ */

/**
 * 造一套绑定好目录的上传/哈希工具。
 *
 * @param {object} opts
 * @param {string} opts.booksDir 正文副本目录（也就是 `.incoming/` 的父目录）
 * @param {object} [opts.files]  主进程的 json 路径表，只用其中的 `books`
 * @param {(file:string, fallback:any)=>any} [opts.readJson]
 * @param {(file:string, data:any)=>any} [opts.writeJson]
 * @param {(level:string, msg:string, meta?:object)=>void} [opts.log]
 */
export function createBookFileKit(opts = {}) {
  const booksDir = path.resolve(String(opts.booksDir || ''));
  if (!booksDir) throw new Error('bookfile 需要 booksDir');
  const incomingDir = path.join(booksDir, INCOMING_DIR);
  const booksFile = String(opts.files?.books || path.join(path.dirname(booksDir), 'books.json'));
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const readJson =
    typeof opts.readJson === 'function'
      ? opts.readJson
      : (file, fallback) => {
          try {
            const raw = fs.readFileSync(file, 'utf8');
            return raw.trim() ? JSON.parse(raw) : fallback;
          } catch {
            return fallback;
          }
        };
  const writeJson =
    typeof opts.writeJson === 'function'
      ? opts.writeJson
      : (file, data) => {
          try {
            atomicWrite(file, JSON.stringify(data));
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err?.message || String(err) };
          }
        };

  /** 按需建 `.incoming/`（只在真要传东西时才建，空书架不留垃圾目录）。 */
  function ensureIncoming() {
    fs.mkdirSync(incomingDir, { recursive: true });
    return incomingDir;
  }

  /**
   * 上传会话的临时文件路径：`books/.incoming/<hash>.part`。
   * @param {string} hash 40 位小写 hex
   * @returns {string}
   */
  function incomingPath(hash) {
    if (!isHash(hash)) throw new Error(`上传会话 hash 不合法：${hash}`);
    ensureIncoming();
    return path.join(incomingDir, `${hash}.part`);
  }

  /** 已收到的字节数；没有会话就是 0。 */
  function partSize(hash) {
    if (!isHash(hash)) return 0;
    return sizeOf(path.join(incomingDir, `${hash}.part`));
  }

  /**
   * 追加一块。offset 必须严格等于当前已收字节数，否则判为「有空洞」，
   * 把权威的 received 回给客户端，让它先查 status 再续传。
   *
   * @param {string} hash
   * @param {number} offset 客户端认为的已传偏移
   * @param {Buffer} buf 这一块的字节
   * @returns {{ok:true, received:number}|{ok:false, gap:true, received:number}}
   */
  function appendChunk(hash, offset, buf) {
    const chunk = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
    const target = incomingPath(hash);
    const received = sizeOf(target);
    const at = Number(offset);
    if (!Number.isFinite(at) || Math.trunc(at) !== at || at < 0) {
      return { ok: false, gap: true, received };
    }
    if (at !== received) return { ok: false, gap: true, received };
    // 拼接写：`.part` 只按 offset 追加，不做任何随机写
    fs.appendFileSync(target, chunk);
    return { ok: true, received: received + chunk.length };
  }

  /**
   * 收齐后提交：重算 `.part` 的 sha1，相等才 rename 到最终路径。
   * 校验不过直接删 `.part`，让客户端重传整本（残留半截文件比多传一次更麻烦）。
   *
   * @param {string} hash
   * @param {{target?:string}} [options] 最终落点，缺省 `books/<hash>.txt`
   * @returns {{ok:true,size:number,path:string}|{ok:false,reason:'hash'|'missing'|'io',error?:string}}
   */
  function commitUpload(hash, options = {}) {
    if (!isHash(hash)) return { ok: false, reason: 'missing', error: 'hash 不合法' };
    const part = path.join(incomingDir, `${hash}.part`);
    if (!fileExists(part)) return { ok: false, reason: 'missing', error: '没有待提交的上传会话' };
    let actual = '';
    let size = 0;
    try {
      size = sizeOf(part);
      actual = fileSha1(part);
    } catch (err) {
      return { ok: false, reason: 'io', error: err?.message || String(err) };
    }
    if (actual !== hash) {
      discardUpload(hash);
      log('warn', `上传内容校验没过，已丢弃：${hash.slice(0, 8)}（实际 ${actual.slice(0, 8)}）`);
      return { ok: false, reason: 'hash' };
    }
    const target = path.resolve(String(options.target || path.join(booksDir, `${hash}.txt`)));
    // 目标必须落在 books/ 里：书名来自客户端，不能让 `../` 逃出去
    if (!isInside(booksDir, target)) {
      return { ok: false, reason: 'io', error: '目标路径不在书架目录里' };
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(part, target);
      return { ok: true, size, path: target };
    } catch (err) {
      return { ok: false, reason: 'io', error: err?.message || String(err) };
    }
  }

  /**
   * 丢掉某个上传会话（客户端取消、或校验失败后的清理）。
   * @param {string} hash
   * @returns {{ok:true}|{ok:false,error:string}}
   */
  function discardUpload(hash) {
    if (!isHash(hash)) return { ok: true };
    try {
      fs.rmSync(path.join(incomingDir, `${hash}.part`), { force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /** 清掉所有悬挂的会话（启动时没用完的残片，超过一天就没人会续了）。 */
  function sweepIncoming(maxAgeMs = 24 * 60 * 60 * 1000) {
    let removed = 0;
    let names = [];
    try {
      names = fs.readdirSync(incomingDir);
    } catch {
      return 0;
    }
    const now = Date.now();
    for (const name of names) {
      if (!name.endsWith('.part')) continue;
      const full = path.join(incomingDir, name);
      try {
        if (now - fs.statSync(full).mtimeMs < maxAgeMs) continue;
        fs.rmSync(full, { force: true });
        removed += 1;
      } catch {
        /* 删不掉就下次再删 */
      }
    }
    return removed;
  }

  /** 读整份书架；读不出来返回 null（调用方据此拒绝写入，避免把书架清空）。 */
  function readBooks() {
    const list = readJson(booksFile, null);
    return Array.isArray(list) ? list : null;
  }

  /** 写整份书架。写失败只回 {ok:false}，由调用方决定怎么报错。 */
  function saveBooks(list) {
    try {
      const result = writeJson(booksFile, list);
      if (result && result.ok === false) return { ok: false, error: result.error || '写入 books.json 失败' };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /** 把某本书的补丁合并进最新的 books.json，其余条目原样保留。 */
  function patchBook(id, patch) {
    const list = readBooks();
    if (!list) return { ok: false, error: 'books.json 读不出来' };
    let hit = false;
    const next = list.map((book) => {
      if (!book || typeof book !== 'object' || book.id !== id) return book;
      hit = true;
      return { ...book, ...patch };
    });
    if (!hit) return { ok: false, error: '书架上没有这本书' };
    return saveBooks(next);
  }

  /**
   * 补齐一本书的 contentHash（口径：books/*.txt 的 UTF-8 字节）。
   *
   * @param {object} book books.json 里的条目（会被就地补上 contentHash / size）
   * @param {{persist?:boolean}} [options] persist=false 时只算不写，供批量场景用
   * @returns {string|null} 补上（或已有）的 hash；云端书/没有副本的书返回 null
   */
  function ensureContentHash(book, options = {}) {
    if (!book || typeof book !== 'object') return null;
    if (book.kind !== 'local') return null; // 云端书没有正文副本，不写这个字段
    const stored = String(book.contentHash || '');
    if (isHash(stored)) return stored;
    const file = String(book.filePath || '');
    if (!file || !fileExists(file)) return null;
    let hash = '';
    try {
      hash = fileSha1(file);
    } catch (err) {
      log('warn', `算正文哈希失败：${path.basename(file)}`, { error: err?.message });
      return null;
    }
    book.contentHash = hash;
    // size 老数据部分缺失，顺手补上（已有就尊重原值，不覆盖）
    if (book.size === undefined || book.size === null || !Number.isFinite(Number(book.size))) {
      book.size = sizeOf(file);
    }
    if (options.persist !== false) {
      const result = patchBook(book.id, { contentHash: hash, size: book.size });
      // 写不进去只记日志：同步会退化成「下次再说」，不能因此让阅读失败
      if (!result.ok) log('warn', `contentHash 写回 books.json 失败：${result.error}`);
    }
    return hash;
  }

  /**
   * 启动时后台批量补齐：一次读、一次写，几百本书也只写一版 json。
   * @returns {{ok:boolean, total:number, changed:number, error?:string}}
   */
  function backfillContentHashes() {
    const list = readBooks();
    if (!list) return { ok: false, total: 0, changed: 0, error: 'books.json 读不出来' };
    let changed = 0;
    for (const book of list) {
      if (!book || typeof book !== 'object') continue;
      if (book.kind !== 'local') continue;
      if (isHash(String(book.contentHash || ''))) continue;
      const before = book.contentHash;
      const after = ensureContentHash(book, { persist: false });
      if (after && after !== before) changed += 1;
    }
    if (!changed) return { ok: true, total: list.length, changed: 0 };
    const result = saveBooks(list);
    if (!result.ok) {
      log('warn', `contentHash 批量写回失败：${result.error}`);
      return { ok: false, total: list.length, changed: 0, error: result.error };
    }
    return { ok: true, total: list.length, changed };
  }

  return {
    booksDir,
    booksFile,
    incomingDir,
    incomingPath,
    partSize,
    appendChunk,
    commitUpload,
    discardUpload,
    sweepIncoming,
    readBooks,
    saveBooks,
    patchBook,
    ensureContentHash,
    backfillContentHashes,
  };
}

/* ------------------------------------------------------------------ */
/*  默认套件：给「只想算个哈希」的一次性脚本用                              */
/* ------------------------------------------------------------------ */

let defaultKit = null;

/**
 * 配置默认套件。lan 服务在构造时调用一次，之后 module 级的便捷函数就能直接用。
 * @param {object} opts 同 createBookFileKit
 */
export function configureBookFile(opts) {
  defaultKit = createBookFileKit(opts);
  return defaultKit;
}

/** 取当前默认套件（没配置就抛，避免静默写到错误目录）。 */
export function bookFileKit() {
  if (!defaultKit) throw new Error('bookfile 还没配置：先调用 configureBookFile({ booksDir })');
  return defaultKit;
}

/**
 * `books/.incoming/<hash>.part`。
 * @param {string} hash
 */
export function incomingPath(hash) {
  return bookFileKit().incomingPath(hash);
}

/**
 * 追加一块，offset 必须等于已收字节数。
 * @param {string} hash
 * @param {number} offset
 * @param {Buffer} buf
 */
export function appendChunk(hash, offset, buf) {
  return bookFileKit().appendChunk(hash, offset, buf);
}

/**
 * 校验并原子落盘。
 * @param {string} hash
 * @param {{target?:string}} [options]
 */
export function commitUpload(hash, options) {
  return bookFileKit().commitUpload(hash, options);
}

/**
 * 丢掉未完成的上传会话。
 * @param {string} hash
 */
export function discardUpload(hash) {
  return bookFileKit().discardUpload(hash);
}

/**
 * 给一本书补齐 contentHash（会原子写回 books.json）。
 * @param {object} book
 */
export function ensureContentHash(book) {
  return bookFileKit().ensureContentHash(book);
}
