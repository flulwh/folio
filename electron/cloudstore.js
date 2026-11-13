import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 云端书的磁盘缓存。
 *
 * 单独成文件的原因：它只依赖 Node 内置模块，不碰解析器、不碰 JS 运行时。
 * sources.js 有 111KB（外加 html/xpath/jsengine 一条依赖链），
 * 而这个缓存是主进程启动时就要用的 —— 拆开后 sources.js 就能整体懒加载，
 * 启动时不必解析那 300KB。
 */

function bookKey(sourceId, bookUrl) {
  return crypto.createHash('sha1').update(`${sourceId}|${bookUrl}`).digest('hex').slice(0, 20);
}

/**
 * 章节缓存文件名带上章节地址的短哈希：目录刷新后章节顺序变化，
 * 只按 index 命名会命中另一章的旧正文。
 */
function chapterFile(index, url) {
  const suffix = url ? crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 8) : 'nourl';
  return `c-${Number(index) || 0}-${suffix}.txt`;
}

export function createCloudStore(cacheRoot) {
  const ensure = (dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  };
  const dirFor = (sourceId, bookUrl) => path.join(cacheRoot, bookKey(sourceId, bookUrl));

  const readJsonSafe = (file, fallback) => {
    try {
      if (!fs.existsSync(file)) return fallback;
      const raw = fs.readFileSync(file, 'utf-8');
      return raw.trim() ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJsonSafe = (file, data) => {
    ensure(path.dirname(file));
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    fs.renameSync(tmp, file);
  };

  return {
    key: bookKey,
    readToc(sourceId, bookUrl) {
      return readJsonSafe(path.join(dirFor(sourceId, bookUrl), 'toc.json'), null);
    },
    writeToc(sourceId, bookUrl, payload) {
      writeJsonSafe(path.join(dirFor(sourceId, bookUrl), 'toc.json'), payload);
    },
    readChapter(sourceId, bookUrl, index, url = '') {
      const file = path.join(dirFor(sourceId, bookUrl), chapterFile(index, url));
      try {
        if (!fs.existsSync(file)) return null;
        return fs.readFileSync(file, 'utf-8');
      } catch {
        return null;
      }
    },
    writeChapter(sourceId, bookUrl, index, text, url = '') {
      const file = path.join(dirFor(sourceId, bookUrl), chapterFile(index, url));
      ensure(path.dirname(file));
      // 原子写：写一半被杀掉时不会留下半截正文被永久命中
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, text, 'utf-8');
      fs.renameSync(tmp, file);
    },
    cachedIndexes(sourceId, bookUrl) {
      const dir = dirFor(sourceId, bookUrl);
      try {
        return fs
          .readdirSync(dir)
          .map((f) => /^c-(\d+)\.txt$/.exec(f))
          .filter(Boolean)
          .map((m) => Number(m[1]))
          .sort((a, b) => a - b);
      } catch {
        return [];
      }
    },
    clear(sourceId, bookUrl) {
      const dir = dirFor(sourceId, bookUrl);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}
