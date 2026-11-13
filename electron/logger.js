import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * 一个够用的本地日志器：
 * - 按天写 `logs/YYYY-MM-DD.log`，单文件超过 maxBytes 就续到 `.1`，只保留 keep 个历史
 * - 内存里保留最近 ring 行，界面「日志」面板直接读
 * - 写盘失败（目录不可写）自动退到临时目录，绝不因为日志把主流程搞挂
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const MAX_RING = 2000;

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function stamp(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function safeJson(value) {
  try {
    const text = JSON.stringify(value);
    return text && text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return '"[unserializable]"';
  }
}

export function createLogger({ dir, maxBytes = 4 * 1024 * 1024, keep = 3, level = 'info' } = {}) {
  const wanted = path.join(dir || path.join(os.tmpdir(), 'folio-logs'), 'logs');
  const fallback = path.join(os.tmpdir(), 'folio-logs');
  let logDir = ensureDir(wanted) ? wanted : ensureDir(fallback) ? fallback : null;

  const ring = [];
  let minLevel = LEVELS[level] ?? LEVELS.info;
  let currentFile = null;
  let currentDay = null;
  let failed = false;

  function rotateIfNeeded(file) {
    try {
      const stat = fs.statSync(file);
      if (stat.size <= maxBytes) return file;
    } catch {
      return file;
    }
    // file → file.1 → file.2 … 只保留 keep 份
    try {
      for (let i = keep - 1; i >= 1; i -= 1) {
        const from = `${file}.${i}`;
        const to = `${file}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.renameSync(file, `${file}.1`);
    } catch {
      /* 重命名失败就继续往原文件写 */
    }
    return file;
  }

  function targetFile() {
    const now = new Date();
    const day = dayKey(now);
    if (currentFile && currentDay === day) return currentFile;
    if (!logDir) return null;
    currentDay = day;
    currentFile = rotateIfNeeded(path.join(logDir, `${day}.log`));
    return currentFile;
  }

  function write(levelName, tag, message, extra) {
    const value = LEVELS[levelName] ?? LEVELS.info;
    if (value > minLevel) return;
    const now = new Date();
    const head = `${now.toISOString()} ${levelName.toUpperCase().padEnd(5)} [${tag}] ${message}`;
    const line = extra === undefined ? head : `${head} ${safeJson(extra)}`;
    ring.push(line);
    if (ring.length > MAX_RING) ring.splice(0, ring.length - MAX_RING);
    if (!logDir || failed) return;
    try {
      const file = targetFile();
      if (file) fs.appendFileSync(file, `${line}\n`);
    } catch {
      failed = true;
      logDir = null;
    }
  }

  const api = {
    get dir() {
      return logDir;
    },
    get level() {
      return Object.keys(LEVELS).find((key) => LEVELS[key] === minLevel) || 'info';
    },
    setLevel(name) {
      if (name in LEVELS) minLevel = LEVELS[name];
      return api.level;
    },
    info(tag, message, extra) {
      write('info', tag, message, extra);
    },
    warn(tag, message, extra) {
      write('warn', tag, message, extra);
    },
    error(tag, message, extra) {
      write('error', tag, message, extra);
    },
    debug(tag, message, extra) {
      write('debug', tag, message, extra);
    },
    /** 记录一次耗时调用，失败自动按 warn/error 记（只记错误文本，不记整份结果） */
    span(tag, label, extra) {
      const started = Date.now();
      return {
        end(result) {
          const cost = Date.now() - started;
          const bad = result && (result.error || result.ok === false);
          if (bad) api.warn(tag, `${label} 失败 ${cost}ms`, { ...extra, error: result.error || 'ok:false' });
          else api.info(tag, `${label} ${cost}ms`, extra);
          return result;
        },
        fail(err) {
          const cost = Date.now() - started;
          api.error(tag, `${label} 抛错 ${cost}ms`, { ...extra, error: err?.message || String(err) });
          return err;
        },
      };
    },
    tail({ limit = 400, level: minName = 'debug', keyword = '' } = {}) {
      const min = LEVELS[minName] ?? LEVELS.debug;
      const needle = String(keyword || '').toLowerCase();
      return ring
        .filter((line) => {
          const matched = / (ERROR|WARN|INFO|DEBUG) /.exec(line);
          const value = matched ? LEVELS[matched[1].toLowerCase()] : 2;
          if (value > min) return false;
          if (needle && !line.toLowerCase().includes(needle)) return false;
          return true;
        })
        .slice(-Math.max(1, Math.min(2000, limit)));
    },
    files() {
      if (!logDir) return [];
      try {
        return fs
          .readdirSync(logDir)
          .filter((name) => name.endsWith('.log') || /\.log\.\d+$/.test(name))
          .map((name) => {
            const full = path.join(logDir, name);
            const stat = fs.statSync(full);
            return { name, path: full, size: stat.size, mtime: stat.mtimeMs };
          })
          .sort((a, b) => b.mtime - a.mtime);
      } catch {
        return [];
      }
    },
    clear() {
      ring.length = 0;
      if (!logDir) return { ok: false, error: '日志目录不可用' };
      try {
        for (const file of api.files()) fs.rmSync(file.path, { force: true });
        currentFile = null;
        currentDay = null;
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };

  api.info('log', `logger ready dir=${logDir || 'none'}`);
  return api;
}
