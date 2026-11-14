/**
 * 局域网接口的书架适配层 —— 清单、整文件下载、分块上传。
 *
 * 与 lan.js 的分工：
 *   lan.js  只负责 HTTP（解析 Range / 头 / 状态码 / 流式写响应）；
 *   这一层   只负责数据（books.json 怎么读、hash 怎么补、`.part` 怎么收尾）。
 * 这样「状态码语义」和「磁盘语义」各在一处，改哪边都不会漏。
 *
 * 几个硬约束（架构文档 §2 / §8）：
 *  - 清单最多 2000 本，超出带 truncated:true（手机端不会被一份 2MB 的 json 拖死）。
 *  - contentHash 口径固定 sha1(UTF-8 正文字节)，缺失时懒补齐并原子写回 books.json。
 *  - syncable 只对「有正文副本且 ≤30MB 的本地书」成立，云端书永远不可同步。
 *  - 上传落盘 `books/<safeBase(title)>-<hash 前 8>.txt`；同 hash 已有书 → 复用它的 id。
 */

import fs from 'fs';
import path from 'path';
import {
  createBookFileKit,
  fileSha1,
  isHash,
  safeBase,
  MAX_TRANSFER,
} from './bookfile.js';
import { isInside } from './paths.js';

/** 清单一次最多回这么多本，剩下的靠 truncated 让客户端提示用户用桌面端筛。 */
export const LIBRARY_LIMIT = 2000;

/** 30MB 的中文文案，双端逐字一致（架构文档 §8 的冻文案表）。 */
function tooLargeText(size) {
  const mb = Math.max(1, Math.round((Number(size) || 0) / (1024 * 1024)));
  return `这本 ${mb}MB，超过 30MB 上限，只能在本机读`;
}

/**
 * 造一个书架服务。
 *
 * @param {object} opts
 * @param {object} opts.files                   主进程 json 路径表（只用 books）
 * @param {string} opts.booksDir                正文副本目录
 * @param {(file:string, fallback:any)=>any} opts.readJson
 * @param {(file:string, data:any)=>any} opts.writeJson
 * @param {(level:string, msg:string, meta?:object)=>void} [opts.log]
 * @param {(event:string, payload:object)=>void} [opts.publish]  SSE 推送（网页面板）
 * @param {(id:string)=>void} [opts.onBooksChanged]              书架变更回推（渲染层）
 */
export function createBooksService(opts = {}) {
  const {
    files,
    booksDir,
    readJson,
    writeJson,
    log = () => {},
    publish = () => {},
    onBooksChanged = () => {},
  } = opts;

  const kit = createBookFileKit({ booksDir, files, readJson, writeJson, log });

  /** 读整份书架；读不出来当空架处理（只影响清单，不影响写入门禁）。 */
  function list() {
    return kit.readBooks() || [];
  }

  /** 正文副本是否可用（存在且是文件）。 */
  function copyOf(book) {
    const file = String(book?.filePath || '');
    if (!file) return null;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) return null;
      return { file: path.resolve(file), size: stat.size };
    } catch {
      return null;
    }
  }

  /** 这本书的 contentHash，缺失就补（懒补齐 + 写回）。 */
  function hashOf(book) {
    return kit.ensureContentHash(book) || '';
  }

  /* ---------------- GET /api/library ---------------- */

  /**
   * 全量清单。桌面端不存任何「已同步」状态，差集完全由手机算，
   * 所以这里只回客观事实：id / 标题 / 大小 / 哈希 / 能不能传。
   *
   * @returns {{ok:true, apiVersion:number, now:number, books:object[], truncated?:boolean}}
   */
  function library() {
    const all = list();
    const truncated = all.length > LIBRARY_LIMIT;
    const slice = truncated ? all.slice(0, LIBRARY_LIMIT) : all;
    let patched = false;
    const books = [];

    for (const book of slice) {
      if (!book || typeof book !== 'object' || !book.id) continue;
      const kind = book.kind === 'cloud' ? 'cloud' : 'local';
      const title = String(book.title || book.name || '未命名');
      const copy = kind === 'local' ? copyOf(book) : null;
      let size = copy ? copy.size : Number(book.size) || 0;

      let contentHash = '';
      if (copy) {
        const stored = String(book.contentHash || '');
        if (isHash(stored)) {
          contentHash = stored;
        } else {
          // 懒补齐：只算不写，循环结束后统一写一版 json
          const next = kit.ensureContentHash(book, { persist: false });
          if (next) {
            contentHash = next;
            patched = true;
          }
        }
      }

      const item = {
        id: String(book.id),
        title,
        author: String(book.author || ''),
        size,
        type: Number(book.type) === 2 ? 2 : 0,
        kind,
        syncable: false,
      };
      if (contentHash) item.contentHash = contentHash;

      if (kind !== 'local') {
        item.syncableReason = '云端书只能连桌面端在线读';
      } else if (!copy) {
        item.syncableReason = '这本书没有正文副本';
      } else if (!size) {
        item.syncableReason = '这本书是空的';
      } else if (size > MAX_TRANSFER) {
        item.syncableReason = tooLargeText(size);
      } else {
        item.syncable = true;
      }

      // 封面统一走 /api/cover/:id：data: 内联封面可能几百 KB，不能放进清单
      if (book.cover) item.cover = `/api/cover/${encodeURIComponent(String(book.id))}`;

      books.push(item);
    }

    if (patched) {
      const result = kit.saveBooks(all);
      // 写回失败不阻断：下次请求会再算一次，功能照旧
      if (!result.ok) log('warn', `清单 contentHash 写回失败：${result.error}`);
    }

    const payload = { ok: true, apiVersion: 2, now: Date.now(), books };
    if (truncated) payload.truncated = true;
    return payload;
  }

  /* ---------------- GET /api/book/:id/download ---------------- */

  /**
   * 打开一个下载。不返回流，只把「打开的姿势」交给 HTTP 层 ——
   * 状态码与 head 由 lan.js 决定，这里只判断能不能下、从哪开始。
   *
   * @param {string} id
   * @param {number} start Range 起点（0 基），无 Range 传 0
   * @returns {{ok:true, file:string, size:number, start:number, end:number, partial:boolean, hash:string, title:string}|{ok:false, status:number, error:string, size?:number}}
   */
  function openDownload(id, start) {
    const book = list().find((item) => item?.id === id);
    if (!book) return { ok: false, status: 404, error: '书架上没有这本书' };
    if (book.kind !== 'local') {
      return { ok: false, status: 409, error: '这本书在云端，只能按章读取' };
    }
    const copy = copyOf(book);
    if (!copy) return { ok: false, status: 404, error: '这本书没有正文副本' };
    if (!isInside(booksDir, copy.file)) {
      return { ok: false, status: 403, error: '正文不在书架目录里' };
    }
    const size = copy.size;
    if (size > MAX_TRANSFER) return { ok: false, status: 413, error: tooLargeText(size), size };
    const from = Number.isFinite(Number(start)) ? Math.max(0, Math.trunc(Number(start))) : 0;
    if (from >= size) {
      return { ok: false, status: 416, error: '要的起点超出了文件大小', size };
    }
    return {
      ok: true,
      file: copy.file,
      size,
      start: from,
      end: size - 1,
      partial: from > 0,
      // 下载必须带 hash：手机靠它决定这本地副本算不算已同步
      hash: hashOf(book),
      title: String(book.title || book.name || '未命名'),
    };
  }

  /* ---------------- GET /api/upload/status ---------------- */

  /**
   * 续传探测。done 的语义是「桌面端已经有这份内容」——
   * 靠 books.json 里的 contentHash 判断，而不是靠 `.part` 是否还在（commit 后它必然不在了）。
   *
   * @param {{hash:string, size:number}} query
   * @returns {{ok:true, hash:string, received:number, done:boolean}|{ok:false, status:number, error:string}}
   */
  function uploadStatus(query = {}) {
    const hash = String(query.hash || '').trim().toLowerCase();
    if (!isHash(hash)) return { ok: false, status: 400, error: 'hash 不对，应为 40 位十六进制' };
    const total = Number(query.size);
    if (!Number.isFinite(total) || total <= 0) return { ok: false, status: 400, error: '缺少文件大小' };
    if (total > MAX_TRANSFER) return { ok: false, status: 413, error: tooLargeText(total) };
    if (hasContent(hash)) return { ok: true, hash, received: Math.trunc(total), done: true };
    const received = Math.min(kit.partSize(hash), Math.trunc(total));
    return { ok: true, hash, received, done: false };
  }

  /** 桌面端是否已有这份内容（比对 contentHash）。 */
  function hasContent(hash) {
    return list().some((book) => String(book?.contentHash || '') === hash);
  }

  /* ---------------- POST /api/upload/chunk ---------------- */

  /**
   * 追加一块；收齐了就 commit 并登记到 books.json。
   *
   * @param {object} input
   * @param {string} input.hash
   * @param {number} input.offset
   * @param {number} input.total
   * @param {string} input.title  已经 decodeURIComponent 过
   * @param {Buffer} input.chunk
   * @returns {object} 直接可 JSON 化的结果（含 status）
   */
  function appendChunk(input = {}) {
    const hash = String(input.hash || '').trim().toLowerCase();
    if (!isHash(hash)) return { ok: false, status: 400, error: 'hash 不对，应为 40 位十六进制' };
    const total = Number(input.total);
    if (!Number.isFinite(total) || total <= 0) return { ok: false, status: 400, error: '缺少文件总大小' };
    if (total > MAX_TRANSFER) return { ok: false, status: 413, error: tooLargeText(total) };
    const chunk = Buffer.isBuffer(input.chunk) ? input.chunk : Buffer.from(input.chunk || '');
    if (!chunk.length) return { ok: false, status: 400, error: '这一块是空的' };

    const offset = Number(input.offset);
    if (!Number.isFinite(offset) || Math.trunc(offset) !== offset || offset < 0) {
      return { ok: false, status: 400, error: '上传偏移不对' };
    }
    if (offset + chunk.length > total) {
      return { ok: false, status: 400, error: '这一块超出了文件总大小' };
    }

    const appended = kit.appendChunk(hash, offset, chunk);
    if (!appended.ok) {
      return {
        ok: false,
        status: 409,
        error: '上传位置对不上，请先查一下已收到的字节数',
        received: appended.received,
      };
    }
    if (appended.received < total) {
      return { ok: true, received: appended.received, done: false };
    }

    const title = String(input.title || '').trim() || '手机导入的书';
    // 落盘文件名固定带 hash 前 8 位：同名不同内容并存，且短得能一眼认出
    const target = path.join(booksDir, `${safeBase(title)}-${hash.slice(0, 8)}.txt`);
    const commit = kit.commitUpload(hash, { target });
    if (!commit.ok) {
      if (commit.reason === 'hash') {
        return { ok: false, status: 422, error: '文件校验没过，请重新上传整本' };
      }
      if (commit.reason === 'missing') {
        return { ok: false, status: 409, error: '上传会话已失效，请重新上传', received: 0 };
      }
      return { ok: false, status: 500, error: commit.error || '正文落盘失败' };
    }

    return register({ hash, size: commit.size, file: commit.path, title });
  }

  /**
   * 把刚落盘的书登记进 books.json。
   * 幂等三件套之二：同内容（同 hash）已有条目就复用它的 id —— 手机据此把本地 id
   * 与进度 key 迁到桌面 id，不会凭空多出一本重复书。
   */
  function register({ hash, size, file, title }) {
    const all = list();
    let existing = all.find((book) => book?.id === `sha1-${hash}`) || null;
    if (!existing) {
      existing = all.find((book) => String(book?.contentHash || '') === hash) || null;
    }
    // 老书没有 contentHash：先按大小筛，只对「大小正好相同」的算 sha1，
    // 避免每次上传都把整架书的哈希重算一遍。
    let adopted = false;
    if (!existing) {
      for (const book of all) {
        if (!book || book.kind !== 'local') continue;
        if (String(book.contentHash || '').length) continue;
        const copy = copyOf(book);
        if (!copy || copy.size !== size) continue;
        let actual = '';
        try {
          actual = fileSha1(copy.file);
        } catch {
          continue;
        }
        if (actual !== hash) continue;
        book.contentHash = hash;
        adopted = true;
        existing = book;
        break;
      }
    }

    if (existing) {
      // adopted 也是「有变化」：补上的 contentHash 必须落盘，否则下次还得再算一遍
      let changed = adopted;
      if (String(existing.contentHash || '') !== hash) {
        existing.contentHash = hash;
        changed = true;
      }
      if (Number(existing.size) !== size) {
        existing.size = size;
        changed = true;
      }
      // 老条目指向的副本可能早被删了（用户手删过 books/），把这次的新副本挂上去
      if (!copyOf(existing)) {
        existing.filePath = file;
        changed = true;
      }
      if (changed) {
        const saved = kit.saveBooks(all);
        if (!saved.ok) return { ok: false, status: 500, error: saved.error || '写入 books.json 失败' };
      }
      finish(existing.id);
      return {
        ok: true,
        received: size,
        done: true,
        id: String(existing.id),
        title: String(existing.title || existing.name || title),
        created: false,
      };
    }

    const id = `sha1-${hash}`;
    const book = {
      id,
      kind: 'local',
      name: title,
      author: '',
      filePath: file,
      size,
      contentHash: hash,
      format: 'txt',
      type: 0,
      addedAt: Date.now(),
      syncedFrom: 'android',
      contentVersion: 1,
    };
    all.push(book);
    const saved = kit.saveBooks(all);
    if (!saved.ok) {
      // 元数据写不进去就把刚落盘的副本删掉，避免留下「有文件没书」的孤儿
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
      return { ok: false, status: 500, error: saved.error || '写入 books.json 失败' };
    }
    finish(id);
    return { ok: true, received: size, done: true, id, title, created: true };
  }

  /** 上传完成的副作用：SSE 给网页面板 + IPC 给渲染层书架。 */
  function finish(id) {
    try {
      publish('books', { reason: 'upload', id });
    } catch (err) {
      log('warn', `上传完成推送失败：${err?.message || err}`);
    }
    try {
      onBooksChanged(id);
    } catch (err) {
      log('warn', `上传完成回推渲染层失败：${err?.message || err}`);
    }
  }

  /* ---------------- DELETE /api/upload/:hash ---------------- */

  /**
   * 取消一次上传（只清 `.part`，绝不碰已落盘的书）。
   * @param {string} hash
   */
  function discardUpload(hash) {
    const value = String(hash || '').trim().toLowerCase();
    if (!isHash(value)) return { ok: false, status: 400, error: 'hash 不对，应为 40 位十六进制' };
    const result = kit.discardUpload(value);
    if (!result.ok) return { ok: false, status: 500, error: result.error || '清理失败' };
    return { ok: true };
  }

  return {
    kit,
    library,
    openDownload,
    uploadStatus,
    appendChunk,
    discardUpload,
    hasContent,
  };
}
