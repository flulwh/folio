/**
 * Legado（「阅读」）书源里的 `@js:` 规则需要一段 JS 运行时。
 * 这里用 Node 的 vm 起一个每书源独立的上下文，并补齐「阅读」常用的 API 子集：
 * java.ajax / java.post / java.get / java.put / cookie / cache / source / baseUrl / key / page / result / book / chapter。
 *
 * 注意：`java.ajax` 在「阅读」里是同步的，所以这里用 curl 同步取页（带 cookie jar），
 * 代价是主进程在请求期间会被阻塞几秒——单用户阅读场景可以接受，换来的是脚本兼容性。
 */
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * 探测系统里有没有 curl。
 *
 * 原来这里是 execFileSync('curl', ['--version'])：为了确认一个二进制在不在，
 * 要真的 fork 一个进程，机器上没装 curl 时（Windows Server / 精简版）会一直
 * 等到 4 秒超时才返回，而这段时间主进程是完全卡死的 —— 界面直接冻住。
 *
 * 现在改成直接扫 PATH 找可执行文件：纯文件系统操作，微秒级完成，
 * 不会阻塞事件循环。找不到再退回跑一次 --version 确认（防止 PATH 上是
 * 别的同名程序），那次是真的要用 curl 了，阻塞可以接受。
 */
let curlReady = null;

function findCurlOnPath() {
  const isWindows = process.platform === 'win32';
  const pathVar = process.env.PATH || '';
  const exts = isWindows
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  const names = isWindows ? ['curl.exe', 'curl.cmd', 'curl.bat'] : ['curl'];

  for (const dir of pathVar.split(isWindows ? ';' : ':')) {
    if (!dir) continue;
    for (const name of names) {
      for (const ext of isWindows ? exts : ['']) {
        const candidate = path.join(dir, name + (name.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext));
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        } catch {
          /* 目录不可读就跳过 */
        }
      }
    }
  }
  return '';
}

function hasCurl() {
  if (curlReady !== null) return curlReady;
  const found = findCurlOnPath();
  if (found) {
    curlReady = true;
    return curlReady;
  }
  // PATH 上没扫到（可能是 App 打包后的精简环境），最后确认一次
  try {
    execFileSync('curl', ['--version'], { stdio: 'ignore', timeout: 4000 });
    curlReady = true;
  } catch {
    curlReady = false;
  }
  return curlReady;
}

function buildCurlArgs(url, { method = 'GET', headers = {}, body = null, cookieJar = '', timeout = 8, proxy = '' } = {}) {
  // `--ssl-no-revoke`：部分 Windows 机器上吊销检查会直接失败（CRYPT_E_NO_REVOCATION_CHECK），
  // 不加这个参数所有 HTTPS 源都会挂掉。
  // curl 是同步调用，会阻塞主进程：默认 8 秒、连接超时 5 秒，别让一个死站点拖住整个界面。
  const args = [
    '-sSL',
    '--compressed',
    '--max-time',
    String(timeout),
    '--connect-timeout',
    String(Math.min(5, timeout)),
    '--ssl-no-revoke',
  ];
  if (proxy) args.push('-x', proxy);
  if (cookieJar) args.push('-b', cookieJar, '-c', cookieJar);
  args.push('-A', UA);
  for (const [key, value] of Object.entries(headers || {})) {
    if (!value) continue;
    args.push('-H', `${key}: ${value}`);
  }
  if (method && method.toUpperCase() !== 'GET') {
    args.push('-X', method.toUpperCase());
    if (body != null) {
      // 二进制 body（加密后的 protobuf）不能直接放进 argv：里面可能有 \0，curl 参数会被拒绝
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
      if (buf.includes(0)) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-curl-'));
        const file = path.join(dir, 'payload.bin');
        fs.writeFileSync(file, buf);
        args.push('--data-binary', `@${file}`);
      } else {
        args.push('--data-binary', String(body));
      }
    }
  }
  args.push(url);
  return args;
}

/** curl 只接受 ASCII URL：把中文/空格/curl 会当成 glob 的字符做百分号编码（保留已有 %XX）。 */
function encodeUnsafeUrl(url) {
  const text = String(url || '').trim();
  return text.replace(/[^\x21-\x7E]|[{}|^`"<>\\]/g, (ch) => encodeURIComponent(ch));
}

/** Legado 的「url,{...}」写法：拆出 URL 与内联选项。 */
function splitInlineOptions(raw) {
  const text = String(raw || '').trim();
  const braceAt = text.indexOf(',{');
  if (braceAt === -1) return { url: text, options: null };
  const url = text.slice(0, braceAt).trim();
  try {
    return { url, options: JSON.parse(text.slice(braceAt + 1)) };
  } catch {
    return { url: text, options: null };
  }
}

/* ------------------------------ 日志 ------------------------------ */

let LOGGER = null;

/** 由主进程注入日志器；没注入时所有日志调用静默跳过。 */
export function setLogger(logger) {
  LOGGER = logger || null;
}

function logLine(level, tag, message, extra) {
  if (!LOGGER) return;
  try {
    LOGGER[level](tag, message, extra);
  } catch {
    /* 日志不能影响主流程 */
  }
}

/** 同步取页，返回字符串（JSON 或 HTML 原样）。 */
export function syncFetch(url, options = {}) {
  const raw = String(url || '').trim();
  const target = encodeUnsafeUrl(raw);
  if (!/^https?:\/\//i.test(target)) throw new Error(`只能请求 http(s) 地址：${raw.slice(0, 60)}`);
  if (!hasCurl()) throw new Error('系统缺少 curl，无法执行书源 JS 里的网络请求');
  const args = buildCurlArgs(target, options);
  const started = Date.now();
  try {
    const out = execFileSync('curl', args, {
      maxBuffer: 24 * 1024 * 1024,
      timeout: (options.timeout || 15) * 1000 + 4000,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logLine('debug', 'curl', `${(options.method || 'GET').toUpperCase()} ${target} ${out.length}B ${Date.now() - started}ms`, {
      proxy: options.proxy || undefined,
    });
    const charset = String(options.charset || '').toLowerCase();
    if (charset && !/^utf-?8$/.test(charset)) {
      try {
        return new TextDecoder(charset === 'gb2312' ? 'gbk' : charset).decode(out);
      } catch {
        /* 解码器不支持就退回 UTF-8 */
      }
    }
    return out.toString('utf8');
  } catch (err) {
    const raw = String(err?.stderr || '');
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const curlLine = [...lines].reverse().find((line) => /^curl:\s*\(\d+\)/.test(line));
    const stderrLine = curlLine || [...lines].reverse().find((line) => !/^\^+$/.test(line) && !/^\s*\d+\s+[\d.]+%/.test(line));
    const status = Number(err?.status ?? err?.code);
    const statusMap = {
      1: '请求被拒绝',
      3: 'URL 格式错误',
      6: '域名解析失败',
      7: '连接被拒绝',
      28: '连接超时',
      35: 'TLS 握手失败',
      52: '服务器返回空响应',
      56: '接收数据失败',
    };
    const detail = stderrLine || statusMap[status] || '请求失败';
    const host = (() => {
      try {
        return new URL(target).host;
      } catch {
        return target;
      }
    })();
    throw new Error(`${host} 请求失败：${detail}`.slice(0, 220));
  }
}

/** 任意值转字符串（Null/undefined 都变空串，与 Legado 的 JS 桥一致）。 */
function asJsString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Legado 的 `HtmlFormatter.format`：把 HTML 压成纯文本，
 * 块级标签转换行 + 两个全角空格缩进，去掉注释/脚本与多余空白。
 */
function htmlFormat(input) {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ensp;|&emsp;/gi, ' ')
    .replace(/&thinsp;|&zwnj;|&zwj;|\u2009|\u200c|\u200d/g, '')
    .replace(/<\/?(?:div|p|br|hr|h\d|article|dd|dl|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n+\s*/g, '\n\u3000\u3000')
    .trim();
}

/** 脚本里的 log/toast 只写控制台（FOLIO_JS_LOG=1 时才输出），不弹窗。 */
function java_log(message) {
  const text = String(message ?? '').slice(0, 200);
  logLine('debug', 'js', text);
  if (process.env.FOLIO_JS_LOG) console.log('[源JS]', text);
}

function md5(text) {
  return crypto.createHash('md5').update(String(text)).digest('hex');
}

function hashKey(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12);
}

/* --------------------------- 每书源运行时 --------------------------- */

const runtimes = new Map();

function cookieDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * 一个书源一个常驻上下文：jsLib 只跑一次，之后每次规则求值复用其中的函数与 java.put 的缓存。
 */
export function getRuntime(source, { cacheRoot, proxy } = {}) {
  if (!source?.id) throw new Error('书源缺少 id');
  const existing = runtimes.get(source.id);
  if (existing) {
    if (proxy !== undefined) existing.setProxy(proxy);
    return existing;
  }

  const dir = cacheRoot ? path.join(cacheRoot, 'js', source.id) : '';
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const cookieJar = dir ? path.join(dir, 'cookies.txt') : '';
  const storeFile = dir ? path.join(dir, 'vars.json') : '';
  const cacheFile = dir ? path.join(dir, 'cache.json') : '';

  const vars = new Map();
  let domBridge = null;
  let jsoupFactory = null;
  if (storeFile && fs.existsSync(storeFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
      for (const [k, v] of Object.entries(saved || {})) vars.set(k, v);
    } catch {
      /* ignore */
    }
  }

  const ttlCache = new Map();
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      for (const [k, item] of Object.entries(saved || {})) {
        if (item && (!item.expire || item.expire > Date.now())) ttlCache.set(k, item);
      }
    } catch {
      /* ignore */
    }
  }

  let saveTimer = null;
  const writeAtomic = (file, data) => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  };
  const scheduleSave = () => {
    if (!dir || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        writeAtomic(storeFile, JSON.stringify(Object.fromEntries(vars)));
        const dump = {};
        for (const [k, item] of ttlCache) {
          if (!item.expire || item.expire > Date.now()) dump[k] = item;
        }
        writeAtomic(cacheFile, JSON.stringify(dump));
      } catch {
        /* ignore */
      }
    }, 400);
  };

  const headers = { ...(source.headers || {}) };
  const state = { proxy: proxy || '' };

  const java = {
    ajax(rawUrl, options) {
      let extraHeaders = {};
      let method = 'GET';
      let body = null;
      let url = rawUrl;
      const inline = splitInlineOptions(rawUrl);
      if (inline.options) {
        url = inline.url;
        extraHeaders = inline.options.headers || {};
        method = String(inline.options.method || 'GET').toUpperCase();
        body = inline.options.body ?? null;
      }
      if (typeof options === 'string' && options.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(options);
          extraHeaders = { ...extraHeaders, ...(parsed.headers || {}) };
          method = String(parsed.method || method).toUpperCase();
          body = parsed.body ?? body;
        } catch {
          /* ignore */
        }
      } else if (options && typeof options === 'object') {
        extraHeaders = { ...extraHeaders, ...(options.headers || {}) };
        method = String(options.method || method).toUpperCase();
        body = options.body ?? body;
      }
      return syncFetch(url, { method, headers: { ...headers, ...extraHeaders }, body, cookieJar, proxy: state.proxy });
    },
    post(url, body, extraHeaders) {
      let payload = body;
      let parsedHeaders = {};
      if (typeof extraHeaders === 'string' && extraHeaders.trim().startsWith('{')) {
        try {
          parsedHeaders = JSON.parse(extraHeaders);
        } catch {
          parsedHeaders = {};
        }
      } else if (extraHeaders && typeof extraHeaders === 'object') {
        parsedHeaders = extraHeaders;
      }
      if (typeof payload === 'string' && payload.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(payload);
          if (parsed.body !== undefined || parsed.headers !== undefined) {
            payload = parsed.body ?? '';
            parsedHeaders = { ...(parsed.headers || {}), ...parsedHeaders };
          }
        } catch {
          /* keep raw */
        }
      }
      return syncFetch(url, {
        method: 'POST',
        headers: { ...headers, ...parsedHeaders },
        body: payload,
        cookieJar,
        proxy: state.proxy,
      });
    },
    get(key) {
      const value = vars.get(String(key));
      return value === undefined ? null : value;
    },
    put(key, value) {
      vars.set(String(key), value);
      scheduleSave();
      return value;
    },    base64Encode(text) {
      return toBytes(text).toString('base64');
    },
    base64Decode(text) {
      return Buffer.from(String(text), 'base64').toString('utf8');
    },
    md5Encode(text) {
      return md5(text);
    },
    md5Encode16(text) {
      return md5(text).slice(8, 24);
    },    hexEncodeToString(text) {
      return toBytes(text).toString('hex');
    },
    hexDecodeToString(text) {
      return Buffer.from(String(text), 'hex').toString('utf8');
    },    encodeURI(text) {
      return encodeURIComponent(String(text));
    },
    // 繁→简：只影响显示，不影响解析；源里多用来统一书名/分类写法
    t2s(text) {
      return String(text ?? '');
    },
    head(rawUrl) {
      if (rawUrl == null) return '';
      syncFetch(String(rawUrl), { method: 'HEAD', headers, cookieJar, proxy: state.proxy });
      return '';
    },
    timeFormat(stamp) {
      const date = new Date(Number(stamp) || Date.now());
      const pad = (n) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },
    log(...args) {
      if (process.env.FOLIO_JS_LOG) console.log('[源JS]', ...args.map((a) => String(a).slice(0, 400)));
      return '';
    },
    toast() {
      return '';
    },
    longToast() {
      return '';
    },
    getString(rule) {
      if (!domBridge) return '';
      if (typeof domBridge.getString !== 'function') return '';
      return asJsString(domBridge.getString(String(rule || '')));
    },
    getElements(rule) {
      if (!domBridge || typeof domBridge.getElements !== 'function') return null;
      return domBridge.getElements(String(rule || ''));
    },
    htmlFormat(text) {
      return htmlFormat(text);
    },
    getElement(rule) {
      if (!domBridge) {
        throw new Error('该脚本用了 DOM 选择器（java.getElement），但没有可用的页面上下文');
      }
      return domBridge.getElement(String(rule || ''));
    },
    setContent(html) {
      if (domBridge) domBridge.setContent(String(html || ''));
      return '';
    },
    connect() {
      return false;
    },
    getCookie(url) {
      return cookie.get(url);
    },
    androidId() {
      return '9774d56d682e549c';
    },
    getVerificationCode() {
      throw new Error('该脚本需要人工验证码（java.getVerificationCode），当前不支持');
    },
    // 真正打开浏览器登录/过验证做不到，但不要中断整条链路：
    // 返回空串，让调用方继续走目录/正文兜底（多数源靠兜底能救回来）。
    startBrowserAwait(url) {
      java_log(`跳过需要浏览器的步骤：${url || ''}`);
      return '';
    },
    startBrowser(url) {
      java_log(`跳过需要浏览器的步骤：${url || ''}`);
      return '';
    },
    webView() {
      return '';
    },
  };

  const cookie = {
    get(url) {
      if (!cookieJar || !fs.existsSync(cookieJar)) return '';
      const domain = cookieDomain(url);
      const lines = fs.readFileSync(cookieJar, 'utf8').split('\n');
      const found = [];
      for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length < 7) continue;
        const host = parts[0].replace(/^\./, '');
        // 域名边界必须带点：example.com 的 cookie 不能发给 notexample.com
        const match = domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`);
        if (match) found.push(`${parts[5]}=${parts[6]}`);
      }
      return found.join('; ');
    },
    set(url, value) {
      if (!cookieJar) return '';
      const domain = cookieDomain(url);
      const now = Math.floor(Date.now() / 1000);
      const expires = now + 60 * 60 * 24 * 30;
      const lines = String(value)
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((pair) => {
          const idx = pair.indexOf('=');
          const name = (idx === -1 ? pair : pair.slice(0, idx)).replace(/[\t\r\n]/g, '');
          const val = (idx === -1 ? '' : pair.slice(idx + 1)).replace(/[\t\r\n]/g, ' ');
          return `${domain}\tFALSE\t/\tFALSE\t${expires}\t${name}\t${val}`;
        });
      const header = '# Netscape HTTP Cookie File\n';
      const exists = fs.existsSync(cookieJar) ? fs.readFileSync(cookieJar, 'utf8') : header;
      fs.writeFileSync(cookieJar, exists.trimEnd() + '\n' + lines.join('\n') + '\n');
      return '';
    },
    remove(key) {
      if (!cookieJar || !fs.existsSync(cookieJar)) return '';
      const needle = String(key || '').trim();
      if (!needle) {
        try {
          fs.writeFileSync(cookieJar, '');
        } catch {
          /* ignore */
        }
        return '';
      }
      try {
        const lines = fs.readFileSync(cookieJar, 'utf8').split('\n');
        const kept = lines.filter((line) => {
          if (!line || line.startsWith('#')) return true;
          const parts = line.split('\t');
          if (parts.length < 7) return true;
          const host = parts[0].replace(/^\./, '');
          return !(needle === host || needle.endsWith(host) || host.endsWith(needle) || needle.includes(host));
        });
        fs.writeFileSync(cookieJar, kept.join('\n'));
      } catch {
        /* ignore */
      }
      return '';
    },
    removeCookie(key) {
      return cookie.remove(key);
    },
    removeAll() {
      return cookie.remove('');
    },
  };

  const cache = {
    get(key) {
      const item = ttlCache.get(hashKey(String(key)));
      if (!item) return null;
      if (item.expire && item.expire <= Date.now()) {
        ttlCache.delete(hashKey(String(key)));
        return null;
      }
      return item.value;
    },
    put(key, value, seconds) {
      const safeKey = hashKey(String(key));
      const expire = Number(seconds) > 0 ? Date.now() + Number(seconds) * 1000 : 0;
      // 只存一份（哈希键），避免 cache.json 体积翻倍
      ttlCache.set(safeKey, { key: String(key), value, expire });
      scheduleSave();
      return '';
    },
    delete(key) {
      ttlCache.delete(String(key));
      ttlCache.delete(hashKey(String(key)));
      scheduleSave();
      return '';
    },
  };

  // `org.jsoup.Jsoup.parse(html)`：给直接用 jsoup 的源一个 Document 形态（select/text/html/attr…）
  const jsoup = {
    Jsoup: {
      parse: (html) => (jsoupFactory ? jsoupFactory(html ?? '') : null),
      parseBodyFragment: (html) => (jsoupFactory ? jsoupFactory(html ?? '') : null),
    },
  };
  const org = { jsoup };

    /* ---- Java 互操作子集（Legado 漫画源常用：签名 / 加解密 / GZIP / 裸连接）---- */
  const toBytes = (value) => {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (Array.isArray(value)) return Buffer.from(value.map((item) => Number(item) & 0xff));
    if (value && typeof value === 'object' && typeof value.getBytes === 'function') {
      return value.getBytes('UTF-8');
    }
    return Buffer.from(String(value ?? ''), 'utf8');
  };

  const JAVA_CHARSETS = {
    'utf-8': 'utf8',
    utf8: 'utf8',
    'iso-8859-1': 'latin1',
    'iso8859-1': 'latin1',
    latin1: 'latin1',
    'us-ascii': 'ascii',
    ascii: 'ascii',
    gbk: 'gbk',
    'gb2312': 'gbk',
    'gb18030': 'gb18030',
    big5: 'big5',
    'utf-16': 'utf16le',
    'utf-16le': 'utf16le',
  };
  const charsetName = (spec) => {
    if (spec && typeof spec === 'object' && spec.name) return String(spec.name);
    return String(spec ?? 'UTF-8');
  };
  const nodeEncoding = (spec) => JAVA_CHARSETS[charsetName(spec).toLowerCase()] || 'utf8';
  const decodeBytes = (value, spec) => {
    if (typeof value === 'string' || value == null) return String(value ?? '');
    const buf = toBytes(value);
    const enc = nodeEncoding(spec);
    // TextDecoder('latin1') 实际是 windows-1252：0x80-0x9F 会被映射成弯引号等字符，
    // 再 getBytes 回来就不是原来的字节了（番茄 TTEnc 签名会因此失效）。latin1/ascii 必须走 Buffer。
    if (enc === 'latin1' || enc === 'ascii') return buf.toString(enc);
    try {
      return new TextDecoder(enc).decode(buf);
    } catch {
      return buf.toString('utf8');
    }
  };
  const streamBytes = (stream) =>
    stream && typeof stream.__bytes === 'function' ? stream.__bytes() : toBytes(stream);
  const streamText = (stream, spec) => {
    if (typeof stream === 'string') return stream;
    if (stream && typeof stream.__text === 'function') return stream.__text();
    return decodeBytes(streamBytes(stream), spec);
  };

  // new Packages.java.lang.String(s).getBytes("UTF-8") / new Packages.java.lang.String(bytes, charset)
  function JavaString(value, charset) {
    const text = typeof value === 'string' || value == null ? String(value ?? '') : decodeBytes(value, charset);
    return {
      value: text,
      getBytes: (spec) => Buffer.from(text, nodeEncoding(spec)),
      toString: () => text,
      length: () => text.length,
    };
  }

  // new Packages.javax.crypto.spec.SecretKeySpec(bytes, "HmacSHA256")
  function SecretKeySpec(bytes, algorithm) {
    const key = toBytes(bytes);
    return {
      algorithm: String(algorithm || ''),
      getEncoded: () => key,
      toString: () => `SecretKeySpec(${String(algorithm || '')})`,
    };
  }

  function createMac(algorithm) {
    const alg = String(algorithm || 'HmacSHA256');
    let key = Buffer.alloc(0);
    const digestName = () =>
      /256/i.test(alg)
        ? 'sha256'
        : /384/i.test(alg)
          ? 'sha384'
          : /512/i.test(alg)
            ? 'sha512'
            : /md5/i.test(alg)
              ? 'md5'
              : 'sha1';
    return {
      algorithm: alg,
      init(secret) {
        key = toBytes(secret);
        return '';
      },
      update() {
        return '';
      },
      doFinal(input) {
        return crypto.createHmac(digestName(), key).update(toBytes(input)).digest();
      },
      getMacLength() {
        return 32;
      },
    };
  }

  /* ---- java.io / java.util.zip：番茄的签名脚本用 ByteArrayOutputStream + GZIP 拼包 ---- */
  function ByteArrayOutputStream() {
    const chunks = [];
    this.write = (bytes, offset = 0, len) => {
      const buf = toBytes(bytes);
      chunks.push(Buffer.from(buf.subarray(offset, len === undefined ? undefined : offset + len)));
    };
    this.writeBytes = this.write;
    this.flush = () => '';
    this.close = () => '';
    this.toByteArray = () => Buffer.concat(chunks);
    this.toString = () => '';
    this.size = () => chunks.reduce((sum, item) => sum + item.length, 0);
  }

  function GZIPOutputStream(target) {
    const chunks = [];
    this.write = (bytes, offset = 0, len) => {
      const buf = toBytes(bytes);
      chunks.push(Buffer.from(buf.subarray(offset, len === undefined ? undefined : offset + len)));
    };
    this.flush = () => '';
    this.close = () => {
      const packed = zlib.gzipSync(Buffer.concat(chunks));
      if (target && typeof target.write === 'function') target.write(packed, 0, packed.length);
    };
  }

  function GZIPInputStream(stream) {
    let bytes = null;
    const unpack = () => {
      if (!bytes) bytes = zlib.gunzipSync(streamBytes(stream));
      return bytes;
    };
    this.__bytes = unpack;
    this.read = () => unpack();
    this.close = () => '';
  }
  function InputStreamReader(stream, charset) {
    const text = streamText(stream, charset);
    this.__text = () => text;
    this.read = () => text;
    this.close = () => '';
    this.toString = () => text;
  }

  function BufferedReader(reader) {
    const lines = streamText(reader).split(/\r?\n/);
    let index = 0;
    this.readLine = () => (index < lines.length ? lines[index++] : null);
    this.close = () => '';
    this.__text = () => lines.join('\n');
  }

  function ByteArrayInputStream(bytes) {
    const buf = toBytes(bytes);
    let pos = 0;
    this.__bytes = () => buf;
    this.read = () => (pos < buf.length ? buf[pos++] : -1);
    this.available = () => buf.length - pos;
    this.close = () => '';
  }

  /* ---- java.security / java.util.Base64 ---- */
  const DIGEST_ALGORITHMS = {
    md5: 'md5',
    'sha-1': 'sha1',
    sha1: 'sha1',
    'sha-256': 'sha256',
    sha256: 'sha256',
    'sha-384': 'sha384',
    'sha-512': 'sha512',
    'sha-512/256': 'sha512-256',
  };
  const messageDigest = {
    getInstance(algorithm) {
      let chunks = [];
      const name = DIGEST_ALGORITHMS[String(algorithm || '').toLowerCase()] || 'sha256';
      return {
        update(bytes) {
          if (bytes !== undefined) chunks.push(toBytes(bytes));
          return '';
        },
        digest(bytes) {
          if (bytes !== undefined) chunks.push(toBytes(bytes));
          const out = crypto.createHash(name).update(Buffer.concat(chunks)).digest();
          chunks = [];
          return out;
        },
        getAlgorithm: () => String(algorithm || ''),
      };
    },
  };

  function SecureRandom() {
    this.generateSeed = (size) => crypto.randomBytes(Math.max(1, Number(size) || 16));
    this.nextBytes = (target) => {
      const size = target && typeof target.length === 'number' ? target.length : 16;
      const bytes = crypto.randomBytes(Math.max(1, size));
      if (target && typeof target.length === 'number') {
        for (let index = 0; index < size; index += 1) target[index] = bytes[index];
        return target;
      }
      return bytes;
    };
  }

  const javaBase64 = {
    getEncoder: () => ({
      encodeToString: (bytes) => toBytes(bytes).toString('base64'),
      encode: (bytes) => toBytes(bytes).toString('base64'),
    }),
    getDecoder: () => ({
      decode: (text) => Buffer.from(String(text ?? ''), 'base64'),
      decodeToString: (text) => Buffer.from(String(text ?? ''), 'base64').toString('utf8'),
    }),
  };
  const androidBase64 = {
    DEFAULT: 0,
    NO_WRAP: 2,
    NO_PADDING: 1,
    decode: (text) => Buffer.from(String(text ?? ''), 'base64'),
    encodeToString: (bytes) => toBytes(bytes).toString('base64'),
    encode: (bytes) => toBytes(bytes).toString('base64'),
  };
  const javaArrays = {
    copyOfRange: (value, from, to) => {
      const source = toBytes(value);
      const start = Math.max(0, Number(from) || 0);
      const end = to === undefined ? source.length : Number(to);
      const out = Buffer.alloc(Math.max(0, end - start));
      if (end > start) source.copy(out, 0, start, Math.min(end, source.length));
      return out;
    },
    copyOf: (value, len) => {
      const source = toBytes(value);
      const size = Math.max(0, Number(len) || 0);
      const out = Buffer.alloc(size);
      source.copy(out, 0, 0, Math.min(size, source.length));
      return out;
    },
    fill: (value) => value,
    equals: (a, b) => Buffer.compare(toBytes(a), toBytes(b)) === 0,
  };
  const uuidClass = {
    randomUUID: () => crypto.randomUUID(),
    fromString: (text) => String(text ?? ''),
    nameUUIDFromBytes: () => crypto.randomUUID(),
  };

  /* ---- javax.crypto：AES-CBC（NoPadding / PKCS5Padding）---- */
  function IvParameterSpec(iv) {
    const bytes = toBytes(iv);
    this.getIV = () => bytes;
    this.iv = bytes;
  }

  const CIPHER_MODES = { ENCRYPT_MODE: 1, DECRYPT_MODE: 2 };
  function createCipher(transformation) {
    const spec = String(transformation || 'AES/CBC/PKCS5Padding');
    const [algoRaw, modeRaw, paddingRaw] = spec.split('/');
    const algo = String(algoRaw || 'AES').toLowerCase();
    const mode = String(modeRaw || 'CBC').toLowerCase();
    const padding = String(paddingRaw || 'PKCS5Padding');
    let key = Buffer.alloc(0);
    let iv = null;
    let encrypt = true;
    const algorithmName = () => {
      const bits = key.length * 8 || 128;
      if (algo === 'aes') return `aes-${bits}-${mode === 'ecb' ? 'ecb' : 'cbc'}`;
      if (algo === 'des') return `des-${mode === 'ecb' ? 'ecb' : 'cbc'}`;
      return `${algo}-${bits}-${mode}`;
    };
    const run = (input, autoPadding) => {
      const data = toBytes(input);
      const ivBuf = mode === 'ecb' ? null : iv || Buffer.alloc(16, 0);
      const cipher = encrypt
        ? crypto.createCipheriv(algorithmName(), key, ivBuf)
        : crypto.createDecipheriv(algorithmName(), key, ivBuf);
      cipher.setAutoPadding(autoPadding);
      return Buffer.concat([cipher.update(data), cipher.final()]);
    };
    return {
      init(modeValue, keySpec, ivSpec) {
        encrypt = Number(modeValue) === 1;
        key = keySpec && typeof keySpec.getEncoded === 'function' ? keySpec.getEncoded() : toBytes(keySpec);
        iv = ivSpec ? (typeof ivSpec.getIV === 'function' ? ivSpec.getIV() : toBytes(ivSpec)) : null;
        return '';
      },
      doFinal(input) {
        return run(input, padding !== 'NoPadding');
      },
      update(input) {
        return run(input, false);
      },
      getAlgorithm: () => spec,
    };
  }
  const cipherClass = { ...CIPHER_MODES, getInstance: (transformation) => createCipher(transformation) };

  /* ---- java.math.BigInteger（BigInt 支撑，只覆盖番茄用到的子集）---- */
  const bigOf = (value) => {
    if (value && typeof value === 'object' && typeof value.big === 'bigint') return value.big;
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.trunc(value));
    const text = String(value ?? '0').trim();
    if (!text) return 0n;
    if (/^0x/i.test(text)) return BigInt(text);
    return BigInt(text);
  };
  function BigInteger(value, radixOrRandom) {
    let big;
    if (typeof value === 'number' && radixOrRandom && typeof radixOrRandom.generateSeed === 'function') {
      const size = Math.max(1, Math.ceil(value / 8));
      const bytes = crypto.randomBytes(size);
      big = BigInt(`0x${bytes.toString('hex')}`) >> BigInt(size * 8 - value);
    } else if (typeof value === 'string') {
      const text = value.trim();
      const radix = typeof radixOrRandom === 'number' ? radixOrRandom : 10;
      if (radix === 16) {
        big = BigInt(`0x${text.replace(/^0x/i, '') || '0'}`);
      } else if (radix === 10) {
        big = BigInt(text || '0');
      } else {
        let acc = 0n;
        for (const ch of text.toLowerCase()) {
          const digit = parseInt(ch, 36);
          if (Number.isNaN(digit)) break;
          acc = acc * BigInt(radix) + BigInt(digit);
        }
        big = acc;
      }
    } else {
      big = bigOf(value);
    }
    this.big = big;
  }
  BigInteger.ZERO = new BigInteger(0);
  BigInteger.ONE = new BigInteger(1);
  BigInteger.TWO = new BigInteger(2);
  BigInteger.TEN = new BigInteger(10);
  BigInteger.valueOf = (value) => new BigInteger(value);
  BigInteger.prototype.add = function (other) {
    return new BigInteger(this.big + bigOf(other));
  };
  BigInteger.prototype.subtract = function (other) {
    return new BigInteger(this.big - bigOf(other));
  };
  BigInteger.prototype.multiply = function (other) {
    return new BigInteger(this.big * bigOf(other));
  };
  BigInteger.prototype.divide = function (other) {
    return new BigInteger(this.big / bigOf(other));
  };
  BigInteger.prototype.mod = function (other) {
    const mod = bigOf(other);
    const rest = this.big % mod;
    return new BigInteger(rest >= 0n ? rest : rest + mod);
  };
  BigInteger.prototype.modPow = function (exponent, modulus) {
    const mod = bigOf(modulus);
    let base = ((this.big % mod) + mod) % mod;
    let exp = bigOf(exponent);
    let result = 1n;
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % mod;
      exp >>= 1n;
      base = (base * base) % mod;
    }
    return new BigInteger(result);
  };
  BigInteger.prototype.compareTo = function (other) {
    const target = bigOf(other);
    return this.big < target ? -1 : this.big > target ? 1 : 0;
  };
  BigInteger.prototype.equals = function (other) {
    return this.big === bigOf(other);
  };
  BigInteger.prototype.toString = function (radix) {
    return this.big.toString(radix === undefined ? 10 : Number(radix));
  };
  BigInteger.prototype.intValue = function () {
    return Number(this.big);
  };

  /* ---- java.lang.System / Thread / nio.charset ---- */
  const systemClass = {
    currentTimeMillis: () => Date.now(),
    nanoTime: () => BigInt(Date.now()) * 1000000n,
    getenv: () => '',
    out: { println: () => '' },
    err: { println: () => '' },
  };
  const threadClass = { sleep: () => '' };
  const charsetClass = {
    forName: (name) => ({
      name: charsetName(name),
      toString: () => charsetName(name),
    }),
  };

  /* ---- org.jsoup.parser.Parser.unescapeEntities ---- */
  const HTML_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
    hellip: '\u2026',
    mdash: '\u2014',
    ndash: '\u2013',
    ldquo: '\u201c',
    rdquo: '\u201d',
    lsquo: '\u2018',
    rsquo: '\u2019',
    middot: '\u00b7',
    copy: '\u00a9',
    reg: '\u00ae',
  };
  const unescapeEntities = (text) =>
    String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (all, body) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      const key = body.toLowerCase();
      return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : all;
    });
  jsoup.parser = {
    Parser: { unescapeEntities, parse: (html) => (jsoupFactory ? jsoupFactory(html ?? '') : null) },
  };

  /* ---- java.net.URL / URLConnection：curl 同步实现（支持 POST、读 body/header、HEAD 测速）---- */
  function javaUrl(href) {
    const text = String(href ?? '');
    return {
      toString: () => text,
      getHost: () => {
        try {
          return new URL(text).host;
        } catch {
          return '';
        }
      },
      openConnection() {
        const state = {
          method: 'GET',
          headers: {},
          body: null,
          doOutput: false,
          connectTimeout: 0,
          readTimeout: 0,
          response: null,
        };
        const perform = (forceGet = false) => {
          const wantsBody = forceGet || state.body != null || state.doOutput;
          const method = wantsBody ? String(state.method || 'GET').toUpperCase() : 'HEAD';
          if (state.response && state.response.method === method) return state.response;
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-java-'));
          const bodyFile = path.join(dir, 'body');
          const headerFile = path.join(dir, 'headers');
          const seconds = Math.max(5, Math.min(60, Math.ceil((state.readTimeout || 20000) / 1000)));
          const args = [
            '-sS',
            '-L',
            '--max-time',
            String(seconds),
            '--connect-timeout',
            String(Math.min(seconds, 10)),
            '--ssl-no-revoke',
            '-A',
            UA,
            '-D',
            headerFile,
            '-o',
            bodyFile,
          ];
          for (const [key, value] of Object.entries({ ...headers, ...state.headers })) {
            if (value) args.push('-H', `${key}: ${value}`);
          }          if (method !== 'GET' && method !== 'HEAD') {
            args.push('-X', method);
            if (state.body != null) {
              const payload = toBytes(state.body);
              if (payload.includes(0)) {
                const file = path.join(dir, 'payload.bin');
                fs.writeFileSync(file, payload);
                args.push('--data-binary', `@${file}`);
              } else {
                args.push('--data-binary', payload.toString('utf8'));
              }
            }
          }
          if (state.proxy) args.push('-x', state.proxy);
          args.push('-w', '%{http_code}', encodeUnsafeUrl(text));
          let status = 0;
          try {
            status = Number(String(execFileSync('curl', args, { timeout: seconds * 1000 + 4000 })).trim() || 0);
          } catch (err) {
            status = Number(String(err.stdout || '').trim() || 0);
            if (process.env.FOLIO_JS_LOG) {
              console.log('[java-url] curl failed', err.message, String(err.stderr || '').slice(0, 400));
            }
          }
          const body = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile) : Buffer.alloc(0);
          const rawHeaders = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, 'utf8') : '';
          const headerMap = {};
          let lastStatus = status;
          for (const line of rawHeaders.split(/\r?\n/)) {
            const statusMatch = /^HTTP\/[\d.]+\s+(\d{3})/i.exec(line);
            if (statusMatch) {
              for (const key of Object.keys(headerMap)) delete headerMap[key];
              lastStatus = Number(statusMatch[1]);
              continue;
            }
            const colon = line.indexOf(':');
            if (colon > 0) headerMap[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
          }
          try {
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {
            /* 临时目录清理失败不影响请求 */
          }
          state.response = { method, status: lastStatus || status, body, headers: headerMap };
          return state.response;
        };
        return {
          setRequestMethod(method) {
            state.method = String(method || 'GET').toUpperCase();
          },
          setDoOutput(value) {
            state.doOutput = !!value;
          },
          setConnectTimeout(ms) {
            state.connectTimeout = Number(ms) || 0;
          },
          setReadTimeout(ms) {
            state.readTimeout = Number(ms) || 0;
          },
          setRequestProperty(name, value) {
            state.headers[String(name)] = String(value);
          },
          setUseCaches() {},
          getOutputStream() {
            const chunks = [];
            const commit = () => {
              state.body = Buffer.concat(chunks);
            };
            return {
              write(bytes, offset = 0, len) {
                const buf = toBytes(bytes);
                chunks.push(Buffer.from(buf.subarray(offset, len === undefined ? undefined : offset + len)));
                commit();
              },
              flush: commit,
              close: commit,
            };
          },
          getResponseCode() {
            return perform().status;
          },
          getHeaderField(name) {
            return perform().headers[String(name).toLowerCase()] || '';
          },
          getInputStream() {
            const response = perform(true);
            return { __bytes: () => response.body };
          },
          getErrorStream() {
            const response = perform(true);
            return response.status >= 400 ? { __bytes: () => response.body } : null;
          },
          disconnect() {},
        };
      },
    };
  }

  const Packages = {
    org,
    android: { util: { Base64: androidBase64 } },
    java: {
      lang: { String: JavaString, System: systemClass, Thread: threadClass },
      net: { URL: javaUrl },
      io: {
        ByteArrayOutputStream,
        ByteArrayInputStream,
        BufferedReader,
        InputStreamReader,
        InputStream: ByteArrayInputStream,
      },
      util: {
        Base64: javaBase64,
        Arrays: javaArrays,
        UUID: uuidClass,
        zip: { GZIPInputStream, GZIPOutputStream },
      },
      security: { MessageDigest: messageDigest, SecureRandom },
      math: { BigInteger },
      nio: { charset: { Charset: charsetClass } },
    },
    javax: {
      crypto: {
        Mac: { getInstance: (algorithm) => createMac(algorithm) },
        Cipher: cipherClass,
        spec: { SecretKeySpec, IvParameterSpec },
      },
    },
  };

  const bookVariableKey = (key) => `book:${String(key)}`;
  const bookStub = {
    name: '',
    author: '',
    bookUrl: '',
    getVariable(key) {
      const value = vars.get(bookVariableKey(key));
      return value === undefined ? null : value;
    },
    putVariable(key, value) {
      vars.set(bookVariableKey(key), value);
      scheduleSave();
      return value;
    },
    getString() {
      return '';
    },
  };

  const bookApi = {
    getVariable(key) {
      const value = vars.get(bookVariableKey(key));
      return value === undefined ? null : value;
    },
    putVariable(key, value) {
      vars.set(bookVariableKey(key), value);
      scheduleSave();
      return value;
    },
    getString() {
      return '';
    },
  };

  function withBookApi(raw) {
    return new Proxy(raw, {
      get(target, prop) {
        if (prop in bookApi) return bookApi[prop];
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
      has(target, prop) {
        return prop in target || prop in bookApi;
      },
    });
  }

  const sandbox = {
    java,
    cookie,
    cache,
    org,
    Packages,
    source: {
      bookSourceUrl: source.bookSourceUrl || source.baseUrl,
      bookSourceName: source.name,
      getKey: () => source.id,
      getVariable: () => java.get('sourceVariable') || '',
      setVariable: (value) => java.put('sourceVariable', value),
      getHeaderMap: () => headers,
      get(key) {
        const value = vars.get(String(key));
        return value === undefined ? null : value;
      },
      put(key, value) {
        vars.set(String(key), value);
        scheduleSave();
        return value;
      },
      // Legado 的 source.getBookSourceUrl()：站点根地址，结尾带 `/`
      getBookSourceUrl: () => {
        const raw = String(source.bookSourceUrl || source.baseUrl || '').trim();
        return raw && !/\/$/.test(raw) ? `${raw.replace(/\/+$/, '')}/` : raw;
      },
    },
    baseUrl: source.baseUrl,
    key: '',
    page: 1,
    result: '',
    book: bookStub,
    chapter: null,
    title: '',
    src: '',
    sleepToast: () => '',
    isLogin: () => true,
    console: {
      log: (...args) => {
        if (process.env.FOLIO_JS_LOG) console.log('[源JS]', ...args.map(String));
      },
      error: () => {},
      warn: () => {},
    },
    JSON,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    setTimeout: undefined,
    fetch: undefined,
  };

  const context = vm.createContext(sandbox, { name: `source:${source.id}` });

  const runtime = {
    id: source.id,
    context,
    sandbox,
    setProxy(value) {
      state.proxy = value || '';
    },
    run(code, bindings = {}, { timeout = 20000, globalScope = false } = {}) {
      const body = String(code || '')
        .replace(/^@js:\s*/i, '')
        .replace(/^\s*<js>([\s\S]*?)<\/js>\s*$/i, '$1')
        .trim();      for (const [k, v] of Object.entries(bindings)) {
        // book 传 null 时保留默认变量句柄（源脚本会调 book.putVariable）
        if (k === 'book' && (v == null || typeof v !== 'object')) {
          if (v != null) sandbox.book = v;
          continue;
        }
        sandbox[k] = k === 'book' && typeof v.putVariable !== 'function' ? withBookApi(v) : v;
      }
      if ('__dom' in bindings) domBridge = bindings.__dom || null;
      if ('__jsoup' in bindings) jsoupFactory = bindings.__jsoup || null;
      if (globalScope) {
        try {
          return vm.runInContext(body, context, { timeout, filename: `${source.id}.js` });
        } catch (err) {
          logLine('error', 'js', '脚本执行失败', { error: err.message });
          throw new Error(`书源脚本出错：${err.message}`);
        }
      }
      // 常驻 vm 上下文里重复跑带顶层 let/const 的脚本会撞名（Legado 每次都是新作用域），
      // 所以用块作用域包裹：块内的 let/const 每次都是新绑定，末表达式的值仍会作为结果返回。
      try {
        return vm.runInContext(`{\n${body}\n}`, context, {
          timeout,
          filename: `${source.id}.js`,
        });
      } catch (err) {
        if (!/already been declared/.test(err.message)) {
          throw new Error(`书源脚本出错：${err.message}`);
        }
        try {
          return vm.runInContext(body, context, { timeout, filename: `${source.id}.js` });
        } catch (retryErr) {
          throw new Error(`书源脚本出错：${retryErr.message}`);
        }
      }
    },
    dispose() {
      runtimes.delete(source.id);
    },
  };

  runtimes.set(source.id, runtime);

  if (source.jsLib) {
    try {
      runtime.run(source.jsLib, {}, { timeout: 20000, globalScope: true });
    } catch (err) {
      runtime.libError = err.message;
    }
  }

  return runtime;
}

export function runSourceScript(source, code, bindings, options = {}) {
  const runtime = getRuntime(source, { cacheRoot: options.cacheRoot, proxy: options.proxy });
  return runtime.run(code, bindings, options);
}

export function disposeRuntimes() {
  runtimes.clear();
}

/** 单个书源被重新导入/删除时，丢掉它的常驻运行时（否则改好的 jsLib 不生效）。 */
export function disposeRuntime(id) {
  if (!id) return;
  runtimes.delete(id);
}
