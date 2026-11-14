/**
 * 字体商店的目录与下载（主进程）。
 *
 * 目录是一份放在公开仓库里的 catalog.json（见 flulwh/folio-fonts），
 * 字体本体是该仓库 Release 的 assets。这里只做三件事：
 *
 *  1. 拉目录，成功就写本地缓存；网络不通时退回缓存（7 天 TTL，过期也先用着）；
 *  2. 流式下载到 fonts/.download/<id>.<ext>.part，支持 Range 续传；
 *  3. 落盘前校验大小与 sha256，不符就删掉，绝不把半个文件写进 fonts.json。
 *
 * 不代理、不转存：请求直接从用户机器打到 GitHub。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';

const CATALOG_URL = 'https://raw.githubusercontent.com/flulwh/folio-fonts/main/catalog.json';
/** 目录缓存有效期：字体列表变得很慢，7 天足够，也避免每次开面板都发一次请求。 */
const CATALOG_TTL = 7 * 24 * 3600 * 1000;
/** 单款字体上限。目前最大的思源宋体约 24MB，留一倍余量。 */
const MAX_FONT_BYTES = 48 * 1024 * 1024;
/** 目录里的 id 会直接拼进文件名，只允许安全字符。 */
const ID_PATTERN = /^[a-z0-9._-]{1,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/** 把目录条目收敛成两端都认得的形状，坏条目直接丢掉。 */
function normalizeFont(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim();
  if (!ID_PATTERN.test(id)) return null;
  const file = entry.file && typeof entry.file === 'object' ? entry.file : {};
  if (!isHttpUrl(file.url)) return null;
  const format = String(file.format || 'ttf').toLowerCase();
  if (format !== 'ttf' && format !== 'otf') return null;
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FONT_BYTES) return null;
  const sha256 = String(file.sha256 || '').toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) return null;
  return {
    id,
    version: Number(entry.version) || 1,
    name: String(entry.name || id),
    family: String(entry.family || entry.name || id),
    category: String(entry.category || ''),
    description: String(entry.description || ''),
    preview: String(entry.preview || ''),
    homepage: isHttpUrl(entry.homepage) ? entry.homepage : '',
    license: {
      spdx: String(entry.license?.spdx || ''),
      name: String(entry.license?.name || ''),
      url: isHttpUrl(entry.license?.url) ? entry.license.url : '',
    },
    file: { format, url: file.url, size, sha256 },
  };
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * @param {object} opts
 * @param {string} opts.dataDir  缓存目录的父级
 * @param {string} opts.fontsDir 字体落盘目录
 * @param {(level:string,msg:string,meta?:any)=>void} [opts.log]
 * @param {(url:string, init?:object)=>Promise<Response>} opts.fetchImpl
 *        Electron 的 net.fetch：走 Chromium 网络栈，能吃到系统代理
 */
export function createFontStore({ dataDir, fontsDir, log = () => {}, fetchImpl }) {
  if (typeof fetchImpl !== 'function') throw new Error('font-store 需要 fetchImpl');
  const cacheFile = path.join(dataDir, 'font-cache', 'catalog.json');
  const partDir = path.join(fontsDir, '.download');
  /** 同一款字体重复点「安装」时复用同一个 Promise，避免两个流写同一个 .part。 */
  const running = new Map();

  function readCache() {
    try {
      const raw = fs.readFileSync(cacheFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.fonts)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeCache(fonts, fetchedAt) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAt, fonts }), 'utf-8');
    } catch (err) {
      // 缓存写不进去只影响下次冷启动，不影响本次安装
      log('warn', `字体目录缓存写入失败：${err?.message || err}`);
    }
  }

  /**
   * 取目录。
   * @param {boolean} [force] true = 跳过 TTL，强制走网络
   * @returns {Promise<{source:'network'|'cache', fetchedAt:number, fonts:object[], error?:string}>}
   */
  async function getCatalog(force = false) {
    const cache = readCache();
    const fresh = cache && Date.now() - Number(cache.fetchedAt || 0) < CATALOG_TTL;
    if (cache && fresh && !force) {
      return { source: 'cache', fetchedAt: cache.fetchedAt, fonts: cache.fonts };
    }

    try {
      const res = await fetchImpl(CATALOG_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const fonts = (Array.isArray(raw?.fonts) ? raw.fonts : []).map(normalizeFont).filter(Boolean);
      if (!fonts.length) throw new Error('目录里没有可用字体');
      const fetchedAt = Date.now();
      writeCache(fonts, fetchedAt);
      return { source: 'network', fetchedAt, fonts };
    } catch (err) {
      const message = err?.message || String(err);
      if (cache) {
        log('warn', `字体目录刷新失败，使用缓存：${message}`);
        return { source: 'cache', fetchedAt: cache.fetchedAt, fonts: cache.fonts, error: message };
      }
      throw new Error(`字体目录获取失败：${message}`);
    }
  }

  async function findFont(id) {
    if (!ID_PATTERN.test(String(id || ''))) throw new Error('字体 id 不合法');
    const { fonts } = await getCatalog(false);
    const target = fonts.find((item) => item.id === id);
    if (!target) throw new Error('字体不在目录里');
    return target;
  }

  /**
   * 下载一款字体。
   * @param {string} id
   * @param {(p:{id:string,received:number,total:number})=>void} [onProgress]
   * @returns {Promise<{file:string,path:string,size:number,sha256:string,format:string}>}
   */
  function download(id, onProgress) {
    const key = String(id || '');
    if (running.has(key)) return running.get(key);
    const task = (async () => {
      const entry = await findFont(key);
      const ext = entry.file.format;
      const fileName = `${entry.id}.${ext}`;
      const dest = path.join(fontsDir, fileName);
      const part = path.join(partDir, `${fileName}.part`);
      const total = entry.file.size;

      fs.mkdirSync(partDir, { recursive: true });
      let start = 0;
      try {
        const stat = fs.statSync(part);
        start = stat.size;
      } catch {
        start = 0;
      }
      // .part 比清单还大说明这份残留不可信，从头来
      if (start > total) {
        fs.rmSync(part, { force: true });
        start = 0;
      }

      const headers = start > 0 ? { Range: `bytes=${start}-` } : {};
      const res = await fetchImpl(entry.file.url, { headers, redirect: 'follow', cache: 'no-store' });
      if (res.status === 416 && start > 0) {
        // 已经下满但没改名（上次在收尾阶段挂掉），直接进入校验
        start = total;
      } else if (!res.ok) {
        throw new Error(res.status === 404 ? '字体文件不存在' : `下载失败：HTTP ${res.status}`);
      }

      if (res.ok && !res.body) throw new Error('下载失败：没有响应体');

      let received = start;
      let lastEmit = 0;
      let out = null;
      if (start < total) {
        // 服务端不认 Range 时会把整份发回来，此时必须清空 .part 重新写
        const append = start > 0 && res.status === 206;
        if (!append) start = 0;
        received = start;
        out = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
        try {
          for await (const chunk of Readable.fromWeb(res.body)) {
            received += chunk.length;
            if (received > MAX_FONT_BYTES) throw new Error('字体文件超出大小上限');
            if (!out.write(chunk)) {
              await new Promise((resolve, reject) => {
                out.once('drain', resolve);
                out.once('error', reject);
              });
            }
            const now = Date.now();
            if (onProgress && now - lastEmit > 100) {
              lastEmit = now;
              onProgress({ id: entry.id, received, total });
            }
          }
        } finally {
          await new Promise((resolve) => out.end(resolve));
        }
      } else {
        try {
          res.body?.cancel?.();
        } catch {
          /* 不需要响应体 */
        }
      }

      if (onProgress) onProgress({ id: entry.id, received: total, total });

      const actualSize = fs.statSync(part).size;
      if (actualSize !== total) {
        throw new Error(`文件大小不符（${actualSize} / ${total}）`);
      }
      const actualHash = await hashFile(part);
      if (actualHash !== entry.file.sha256) {
        // 校验失败的重试没有意义，删掉让下次从头下
        fs.rmSync(part, { force: true });
        throw new Error('字体校验失败，请重试');
      }

      fs.rmSync(dest, { force: true });
      fs.renameSync(part, dest);
      return { file: fileName, path: dest, size: actualSize, sha256: actualHash, format: ext };
    })().finally(() => {
      running.delete(key);
    });
    running.set(key, task);
    return task;
  }

  return { getCatalog, download, catalogUrl: CATALOG_URL };
}
