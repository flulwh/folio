// Electron 的内置模块是 CJS，ESM 下无法静态解析具名导出，必须走 default import。
import electron from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { domainToUnicode } from 'url';
import { createCloudStore } from './cloudstore.js';
import { createLogger } from './logger.js';
import { createLanService, lanAddresses } from './lan.js';
import { readFontMeta as readFontMetaFile, readFontCoverage as readFontCoverageFile, familyFromFilename } from './fontmeta.js';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, protocol, net, clipboard } = electron;

/* ------------------------------------------------------------------ */
/*  重模块懒加载                                                       */
/*  ------------------------------------------------------------------ */
/*  sources.js(111KB) + html.js(15KB) + xpath.js(12KB) + jsengine.js(47KB) */
/*  + replace.js + repo.js 合计约 300KB，只在用户真的去用「书源 / 云端书 / */
/*  净化规则」时才需要。                                                 */
/*                                                                      */
/*  之前是顶层静态 import：应用一启动就得把这 300KB 全部解析执行，        */
/*  白白拖慢开机。现在改成用到时才动态 import —— 启动只付 main.js 自身     */
/*  的解析成本。                                                          */
/*                                                                      */
/*  第一个用到它们的 IPC 会有一次加载延迟（几十毫秒），从体验上察觉不到。  */
/* ------------------------------------------------------------------ */

/** 动态 import 的结果缓存，避免同一模块重复加载。 */
function lazyModule(loader) {
  let promise = null;
  return () => {
    if (!promise) {
      promise = loader().catch((err) => {
        // 失败要清掉缓存，否则一次偶发失败会永久卡住后续调用
        promise = null;
        throw err;
      });
    }
    return promise;
  };
}

const loadSources = lazyModule(() => import('./sources.js').then(async (mod) => {
  mod.setLogger?.(log);
  // sources.js 也静态依赖 jsengine.js，同理补上它的 logger
  const engine = await loadEngine();
  engine.setLogger?.(log);
  return mod;
}));
// replace.js 静态依赖 jsengine.js（要用 runSourceScript），
// 所以加载 replace 时顺手把 jsengine 的 logger 也注上 ——
// 否则「导入净化规则」那条路上的 JS 规则日志会全部丢��。
const loadReplace = lazyModule(() => import('./replace.js').then(async (mod) => {
  const engine = await loadEngine();
  engine.setLogger?.(log);
  return mod;
}));
const loadEngine = lazyModule(() => import('./jsengine.js').then((mod) => {
  mod.setLogger?.(log);
  return mod;
}));
const loadRepo = lazyModule(() => import('./repo.js'));


// 有些 Windows 环境（受限账户、安全软件、缺少 AppContainer 支持）里 Chromium 的
// 沙箱初始化会直接失败，进程一秒都活不到主进程 JS 跑完，表现就是「双击 exe 毫无反应」。
// FOLIO_NO_SANDBOX=1 或命令行带 --no-sandbox 时在这里兜底关掉沙箱。
if (process.env.FOLIO_NO_SANDBOX === '1' || process.argv.includes('--no-sandbox')) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

// 便携模式：FOLIO_DATA_DIR 可把数据目录（books/、progress.json…）指到任意位置，
// 既不污染 %APPDATA%，也方便把书和进度放在 U 盘 / 同步盘里。
// 另外做一次真实写入探测：某些受限环境（沙箱化的 Electron、只读用户目录）里
// %APPDATA% 会返回 EPERM，这时自动退到一个可写的备用目录，避免一启动就崩。
function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function resolveDataDir() {
  const preferred = process.env.FOLIO_DATA_DIR
    ? path.resolve(process.env.FOLIO_DATA_DIR)
    : path.join(app.getPath('userData'), 'ImmersiveReader');
  if (isWritableDir(preferred)) return { dir: preferred, fallback: false, preferred };
  const candidates = [
    path.join(app.getPath('temp'), 'Folio-data'),
    path.join(path.dirname(process.execPath), 'Folio-data'),
  ];
  for (const dir of candidates) {
    if (dir !== preferred && isWritableDir(dir)) return { dir, fallback: true, preferred };
  }
  return { dir: preferred, fallback: false, preferred };
}

const dataDirInfo = resolveDataDir();
const dataDir = dataDirInfo.dir;
const files = {
  books: path.join(dataDir, 'books.json'),
  progress: path.join(dataDir, 'progress.json'),
  settings: path.join(dataDir, 'settings.json'),
  sources: path.join(dataDir, 'sources.json'),
  rules: path.join(dataDir, 'rules.json'),
};
// 书的内容放在这里（每本一个 .txt 副本），books.json 只存元数据。
// 这样书架文件恒定是几十 KB，删掉 json 也不会丢正文，用户还能直接用编辑器打开看。
const booksDir = path.join(dataDir, 'books');
// 云端书的封面缓存：按 URL 的 sha1 命名，一次下载长期复用，断网也能显示。
const coversDir = path.join(dataDir, 'covers');
// 用户安装的字体：字体文件本体放 fonts/，元信息（族名、格式、大小）放 fonts.json。
const fontsDir = path.join(dataDir, 'fonts');
const cloudStore = createCloudStore(path.join(dataDir, 'cloud'));

// 统一日志：写 dataDir/logs/<日期>.log，同时留在内存里给「日志」面板看。
// 出问题时让用户点「导出日志」，比让他复述操作快得多。
const log = createLogger({ dir: dataDir, level: process.env.FOLIO_LOG_LEVEL || 'info' });
// 重模块里的 logger 在模块首次加载时注入（见 loadSources / loadEngine 的包装），
// 这样启动阶段不必为了设置 logger 而提前解析那 300KB。

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(channel, payload);
    } catch {
      /* 窗口可能正在关闭 */
    }
  }
}

/* ---------------------- IPC 统一日志 ---------------------- */
// 给所有 ipcMain.handle 包一层：记参数摘要 + 耗时 + 错误。
// 参数只挑关键字段、长字符串截断，避免把整本书/整页 HTML 写进日志。
const rawIpcHandle = ipcMain.handle.bind(ipcMain);
const IPC_LOG_SKIP = new Set(['store:get-progress']);
const SUMMARY_KEYS = [
  'id', 'ids', 'sourceId', 'sourceIds', 'bookUrl', 'chapterUrl', 'keyword', 'url', 'filePath',
  'index', 'page', 'pageSize', 'mode', 'from', 'to', 'collectionId', 'type', 'enabled', 'limit', 'refresh',
];

function clip(value) {
  if (typeof value !== 'string') return value;
  return value.length > 120 ? `${value.slice(0, 120)}…(${value.length})` : value;
}

function summarizeArgs(args) {
  const list = Array.isArray(args) ? args : [args];
  const mapped = list.map((value) => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return clip(value);
    if (Array.isArray(value)) return { count: value.length };
    if (typeof value === 'object') {
      const picked = {};
      for (const key of SUMMARY_KEYS) {
        if (value[key] !== undefined) picked[key] = Array.isArray(value[key]) ? `[${value[key].length}]` : clip(value[key]);
      }
      if (!Object.keys(picked).length) return `{${Object.keys(value).length} keys}`;
      return picked;
    }
    return typeof value;
  });
  return mapped.length ? (mapped.length === 1 ? mapped[0] : mapped) : undefined;
}

ipcMain.handle = (channel, listener) => {
  // 日志通道自己不打日志，否则面板轮询会把日志刷满
  if (IPC_LOG_SKIP.has(channel) || channel.startsWith('log:')) return rawIpcHandle(channel, listener);
  return rawIpcHandle(channel, async (event, ...args) => {
    const span = log.span('ipc', channel, summarizeArgs(args));
    try {
      const result = await listener(event, ...args);
      return span.end(result);
    } catch (err) {
      span.fail(err);
      throw err;
    }
  });
};

// 自定义协议：渲染进程用 folio-cover://cover/<file> 直接显示本地缓存的封面，
// 这样既不受 file:// 限制（dev 下页面是 http://localhost），也不用把图片转成 base64。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'folio-cover',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
  // 用户安装的字体：渲染进程用 folio-font://font/<文件名> 引用，
  // 这样 @font-face 就能直接吃到本地字体文件，不用转 base64。
  {
    scheme: 'folio-font',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

/* ---------- helpers ---------- */

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function readJson(file, fallback) {
  ensureDataDir();
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function describeFsError(error, file) {
  const code = error?.code || '';
  const dir = path.dirname(file);
  if (code === 'EPERM' || code === 'EACCES') {
    return `没有写入权限（${code}）：${dir}\n如果这个目录被安全软件或系统策略保护，可以设置环境变量 FOLIO_DATA_DIR 指向一个可写目录后重启。`;
  }
  if (code === 'ENOSPC') return `磁盘空间不足，写不进 ${dir}`;
  if (code === 'EROFS') return `目标目录是只读的：${dir}`;
  return `${code || '写入失败'}：${error?.message || error}`;
}

let lastWriteError = null;
let writeWarned = false;

/**
 * 原子写 JSON。写盘失败不应该让整个应用挂掉（以前这里直接抛 EPERM，
 * 被 uncaughtException 抓住弹「启动出错」），所以：
 * 1. tmp+rename 失败 → 清掉半截 tmp，直接写目标文件再试一次；
 * 2. 还是失败 → 记下来、通知用户一次，返回 {ok:false}，内存里的状态照旧。
 */
function writeJson(file, data) {
  const payload = JSON.stringify(data);
  const tmp = `${file}.tmp`;
  try {
    ensureDataDir();
  } catch (error) {
    lastWriteError = { file, message: describeFsError(error, file) };
    return { ok: false, error: lastWriteError.message };
  }
  try {
    backupIfShrinking(file, payload);
    fs.writeFileSync(tmp, payload, 'utf-8');
    fs.renameSync(tmp, file);
    lastWriteError = null;
    return { ok: true };
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    try {
      fs.writeFileSync(file, payload, 'utf-8');
      lastWriteError = null;
      return { ok: true, fallback: true };
    } catch (error2) {
      lastWriteError = { file, message: describeFsError(error2, file) };
      warnWriteFailure(lastWriteError);
      return { ok: false, error: lastWriteError.message };
    }
  }
}

/**
 * 写之前先看一眼旧文件：如果旧内容明显更大而这次要写的短得离谱（典型场景是
 * 启动时内存里还是空的默认值，把整架书当成 [] 盖回去），先留一份 .bak 再写。
 * 这类「空数据覆盖真实数据」的坑代价太高，备份便宜得多。
 */
function backupIfShrinking(file, payload) {
  try {
    const existing = fs.readFileSync(file, 'utf-8');
    if (existing.length < 80) return;
    if (payload.length >= existing.length * 0.5) return;
    if (payload.length > 400) return;
    fs.writeFileSync(`${file}.bak`, existing, 'utf-8');
    // 有了 .bak 就清掉「用户主动清空」的标记：下一次写空才可能是真事故
    fs.rmSync(`${file}.cleared`, { force: true });
  } catch {
    /* 读不到旧文件就不用备份 */
  }
}

/**
 * 用户主动把书架/进度/书源清空时留个指纹：下次启动看到它，就不该用 .bak 复活数据。
 * （否则「删掉最后一本书 → 重启 → 书又回来了」）
 */
function markExplicitlyCleared(file) {
  try {
    // 只留指纹，不删 .bak：万一这次「清空」其实是 bug 写出来的，备份还在磁盘上能人工救回
    fs.writeFileSync(`${file}.cleared`, String(Date.now()), 'utf-8');
  } catch {
    /* ignore */
  }
}

/** 写盘失败只提示一次，避免刷屏，也避免把整个应用拦在启动弹窗上。 */
function warnWriteFailure(info) {
  logCrash(`数据写入失败：${info.message}`);
  if (writeWarned) return;
  writeWarned = true;
  if (!app.isReady() || !mainWindow) return;
  try {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Folio',
      message: '这次修改没能保存到磁盘',
      detail: `${info.message}\n\n应用还能继续用，但重启后这次改动会丢。`,
      buttons: ['知道了'],
    });
  } catch {
    /* ignore */
  }
}

/**
 * Decode a text file buffer smartly:
 * UTF-8 BOM -> utf-8; valid utf-8 -> utf-8; otherwise try GBK (common for Chinese txt).
 */
function decodeText(buffer) {
  // UTF-16 BOM：中文 txt 常见（Windows 记事本「Unicode」编码）
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = buffer.subarray(2);
    try {
      return new TextDecoder('utf-16be').decode(body);
    } catch {
      // 少数环境没有 utf-16be：字节对换后用 utf-16le 解
      const swapped = Buffer.from(body);
      swapped.swap16();
      return new TextDecoder('utf-16le').decode(swapped);
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch {
      return buffer.toString('utf-8');
    }
  }
}

const hasUtf16Bom = (buffer) =>
  buffer.length >= 2 &&
  ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff));

function isProbablyBinary(buffer) {
  // UTF-16 文本里有一半是 0x00，先按 BOM 放行，否则会被当成二进制拒绝
  if (hasUtf16Bom(buffer)) return false;
  // ZIP/EPUB magic or a high ratio of control bytes
  if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let control = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 7) control += 1;
  }
  return sample.length > 0 && control / sample.length > 0.05;
}

function booksDirReady() {
  if (!fs.existsSync(booksDir)) fs.mkdirSync(booksDir, { recursive: true });
  return booksDir;
}

function safeBase(name) {
  return (
    String(name || '未命名')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '未命名'
  );
}

function shortHash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 8);
}

/** 把正文写到 books/ 下的副本，返回绝对路径（同名文件会带 hash 后缀，避免互相覆盖） */
function writeBookCopy(id, name, content) {
  booksDirReady();
  const base = safeBase(name);
  let target = path.join(booksDir, `${base}.txt`);
  if (fs.existsSync(target)) {
    const existing = (() => {
      try {
        return fs.readFileSync(target, 'utf-8');
      } catch {
        return null;
      }
    })();
    if (existing !== content) target = path.join(booksDir, `${base}-${shortHash(id || content)}.txt`);
  }
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, target);
  return target;
}

function readBookContent(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (isProbablyBinary(buffer)) {
    return {
      error:
        '暂不支持该二进制格式。当前版本专注于纯文本（TXT / MD）电子书，请导入 TXT 或 Markdown 文件。',
    };
  }
  // 副本是我们自己写的 UTF-8，但老数据/手改过的文件仍按智能解码兜底
  const content = decodeText(buffer);
  return { content, size: buffer.length };
}

/** 从磁盘上的原文件导入：读一次 -> 判断编码/二进制 -> 复制到 books/ -> 只回元数据 */
function importBookFromPath(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (isProbablyBinary(buffer)) {
    return {
      error:
        '暂不支持该二进制格式。当前版本专注于纯文本（TXT / MD）电子书，请导入 TXT 或 Markdown 文件。',
    };
  }
  const stats = fs.statSync(filePath);
  const content = decodeText(buffer);
  if (!content.trim()) return { error: '这本书是空的' };
  const id = `${filePath}::${stats.mtimeMs}`;
  const name = path.basename(filePath, path.extname(filePath));
  const storedPath = writeBookCopy(id, name, content);
  return {
    id,
    name,
    sourcePath: filePath,
    filePath: storedPath,
    size: stats.size,
    addedAt: Date.now(),
  };
}

/** 拖拽 / 示例书：正文在渲染进程里，写到 books/ 后只回元数据 */
function importBookFromContent({ id, name, content }) {
  const text = String(content ?? '');
  if (!text.trim()) return { error: '这本书是空的' };
  const bookId = id || `${name || '未命名'}::${shortHash(text)}`;
  const storedPath = writeBookCopy(bookId, name, text);
  return {
    id: bookId,
    name: name || path.basename(storedPath, '.txt'),
    filePath: storedPath,
    size: Buffer.byteLength(text, 'utf-8'),
    addedAt: Date.now(),
  };
}

/**
 * 旧版本把整本正文内联在 books.json 里（书一多，启动解析要好几秒）。
 * 启动时把它们搬到 books/：有原文件就只丢 content，没有就用 content 生成副本。
 */
function migrateInlineBookContent() {
  const list = readJson(files.books, []);
  if (!Array.isArray(list) || !list.length) return;
  let changed = false;
  const next = list.map((book) => {
    if (!book || typeof book !== 'object') return book;
    if (typeof book.content !== 'string') return book;
    const content = book.content;
    const hasFile = Boolean(book.filePath && fs.existsSync(book.filePath));
    // 已有副本：只把字段删掉（哪怕 content 是空串，也别留在 json 里）
    if (hasFile) {
      changed = true;
      const rest = { ...book };
      delete rest.content;
      return rest;
    }
    if (!content) return book;
    changed = true;
    const rest = { ...book };
    delete rest.content;
    try {
      rest.filePath = writeBookCopy(rest.id, rest.name, content);
      if (rest.size === undefined) rest.size = Buffer.byteLength(content, 'utf-8');
    } catch {
      /* 写失败就先保留 content，下次启动再试 */
      return book;
    }
    return rest;
  });
  if (changed) writeJson(files.books, next);
}

/**
 * 启动自愈：如果某个 json 现在是空的（`[]` / `{}`），而旁边躺着同名的 `.bak` 且其中有内容，
 * 就把备份恢复回来。writeJson 只在「内容可能被误清空」时留 .bak，所以这里恢复是安全的。
 */
function restoreFromBackup() {
  let restored = 0;
  for (const file of Object.values(files)) {
    try {
      const bak = `${file}.bak`;
      // 用户主动清空过（删掉最后一本书等）就别复活，顺手清掉残留备份
      if (fs.existsSync(`${file}.cleared`)) {
        fs.rmSync(`${file}.cleared`, { force: true });
        fs.rmSync(bak, { force: true });
        continue;
      }
      if (!fs.existsSync(file) || !fs.existsSync(bak)) continue;
      const current = fs.readFileSync(file, 'utf-8').trim();
      const isEmpty = current === '[]' || current === '{}' || current === '';
      if (!isEmpty) continue;
      const saved = fs.readFileSync(bak, 'utf-8').trim();
      if (!saved || saved === '[]' || saved === '{}') continue;
      fs.writeFileSync(file, saved, 'utf-8');
      // 恢复只做一次：留着 .bak 会在用户下次清空时又被翻出来
      fs.rmSync(bak, { force: true });
      restored += 1;
      logCrash(`已从备份恢复 ${path.basename(file)}（${saved.length} 字节）`);
    } catch {
      /* 恢复不了就算了，继续用空数据启动 */
    }
  }
  return restored;
}

/* ---------- window ---------- */
let mainWindow = null;
let appReady = false;

/* ------------------------------------------------------------------ */
/*  macOS 风格边框                                                     */
/*  ------------------------------------------------------------------ */
/*  macOS 自带 traffic light（红黄绿三个圆点），Windows 没有。          */
/*  这里做一个跨平台开关：                                                */
/*   - 开启时，Windows 用 titleBarStyle:'hidden' 去掉原生标题栏，         */
/*     由渲染层自绘三个交通灯按钮（走 window:minimize / toggle / close）。 */
/*   - macOS 始终使用原生 traffic light（hiddenInset），行为最原生。      */
/*                                                                      */
/*  Windows 上必须保留 thickFrame:true —— 它给无边框窗口补回 WS_THICKFRAME， */
/*  否则窗口就没有阴影、也不能拖拽调整大小、也失去 Aero Snap。             */
/* ------------------------------------------------------------------ */

// 边框模式由渲染层的设置决定（macosFrame）。但窗口是在渲染层起来之前创建的，
// 所以这里从 settings.json 直接读一次盘上的值；渲染层起来后会再发一次
// 'window:set-frame' 校正，保证两边一致。
//
// 默认值必须和渲染层 AppStore 的 DEFAULT_SETTINGS.macosFrame 一致（都是 true），
// 否则两边默认值不同 → 渲染层一启动就要求切换 → 白白重建一次窗口。
function readFramePref() {
  try {
    const raw = fs.readFileSync(files.settings, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'macosFrame' in parsed) {
      return parsed.macosFrame !== false;
    }
  } catch {
    /* 读不到就按默认值 */
  }
  return true;
}

let macosFrameEnabled = readFramePref();

/** 待恢复的界面状态：切换边框要重建窗口，重建前把「当时看到哪」记下来。 */
let pendingUiState = null;

/** 正在重建窗口（用来挡住 window-all-closed 误退出）。 */
let isRebuilding = false;

/** 按当前模式算出 BrowserWindow 的边框相关选项。 */
function frameWindowOptions() {
  if (process.platform === 'darwin') {
    // macOS 用原生 inset 交通灯：位置贴近左上角，视觉上和自绘版本一致
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 20 },
      roundedCorners: true,
    };
  }
  if (macosFrameEnabled) {
    return {
      // hidden：去掉原生标题栏但保留窗口边框阴影
      titleBarStyle: 'hidden',
      // 无边框窗口在 Windows 上必须靠 WS_THICKFRAME 拿回阴影与可调整大小
      thickFrame: true,
      backgroundColor: '#f6f4ef',
    };
  }
  return {};
}

/**
 * 切换边框模式。
 *
 * titleBarStyle 不能热改，只能重建窗口。但重建有两个坑，这里都绕开了：
 *
 *  1) 窗口全部关掉会触发 'window-all-closed' → Windows 上 app.quit() → 应用直接退出。
 *     所以先建新窗口、显示它，再关旧窗口，全程至少有一个窗口活着。
 *
 *  2) 重建会丢内存里的界面状态（当前看的书、当前页面）。
 *     所以先把状态存进 pendingUiState，新窗口起来后由渲染层取回。
 *
 * macOS 不受这个开关影响（始终用原生交通灯），直接返回。
 */
function applyFrameMode(enabled, uiState) {
  const next = enabled !== false;
  if (process.platform === 'darwin') {
    macosFrameEnabled = true;
    return { applied: false, mode: macosFrameEnabled };
  }
  if (next === macosFrameEnabled) return { applied: false, mode: macosFrameEnabled };
  macosFrameEnabled = next;
  if (!mainWindow || mainWindow.isDestroyed()) return { applied: false, mode: macosFrameEnabled };

  const old = mainWindow;
  const bounds = old.getBounds();
  const wasMaximized = old.isMaximized();
  pendingUiState = uiState && typeof uiState === 'object' ? uiState : null;

  isRebuilding = true;
  const nextWin = createWindow({
    bounds: wasMaximized ? null : bounds,
    maximized: wasMaximized,
    // 新窗口显示之后才关旧的：中间永远有窗口活着，不会触发 window-all-closed
    onShown: () => {
      isRebuilding = false;
      if (!old.isDestroyed()) old.destroy();
    },
  });
  // 兜底：新窗口要是没能 show（渲染进程崩了），也别把旧窗口一直留着
  setTimeout(() => {
    isRebuilding = false;
    if (!nextWin.isDestroyed() && !nextWin.isVisible()) nextWin.show();
    if (!old.isDestroyed()) old.destroy();
  }, 4000);

  return { applied: true, mode: macosFrameEnabled };
}

// 启动打点：如果双击后 crash.log 里连这一行都没有，说明 Electron 进程根本没跑到 JS
// （通常是沙箱/权限被拦，需要 --no-sandbox 兼容模式启动）。
logCrash(`boot v${app.getVersion()} dev=${isDev} dataDir=${dataDir} argv=${process.argv.slice(1).join(' ')}`, 'info');

function createWindow(options = {}) {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 920,
    minHeight: 620,
    show: false,
    backgroundColor: '#f6f4ef',
    icon: path.join(__dirname, 'icon.png'),
    // macOS 用原生 inset 交通灯；Windows 上可切成自绘的 macOS 风格边框。
    ...frameWindowOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 渲染进程代码缓存：让 Chromium 把编译后的 JS 存到磁盘，
      // 第二次启动解析同一份 JS 会快一截（配合下面的手动分包收益更明显）。
      v8CacheOptions: 'code',
      // 窗口在后台 / 被遮挡时不要把渲染帧降频。
      // 默认 true 会让 Chromium 把这类窗口的 requestAnimationFrame 压到 ~1Hz 甚至 0，
      // 而 framer-motion 的入场动画全靠 rAF 推进：挂载瞬间写下的首帧 opacity:0
      // 之后就再也没有下一帧，表现是「内容都在、整屏透明」的白屏，
      // 直到用户点了窗口（visibility 变回 visible）才突然亮起来。实测 hidden 状态下
      // rAF 为 0 帧/秒、窗口前置后恢复到 ~145 帧/秒。
      // 代价是后台也保留少量定时器开销，对一个本地阅读器可以接受。
      backgroundThrottling: false,
    },
  });

  // 只有「真正成为主窗口」的那一个才赋给 mainWindow：
  // 切换边框时新旧窗口会短暂共存，mainWindow 必须始终指向新的那个。
  mainWindow = win;

  // 恢复上一窗口的位置（切换边框重建时用）
  if (options.bounds) {
    try {
      win.setBounds(options.bounds);
    } catch {
      /* 屏幕分辨率变了之类的极端情况，忽略 */
    }
  }

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 双保险：ready-to-show 在渲染进程崩溃、GPU 初始化失败等情况下不会触发，
  // 窗口会永远藏着，看起来就是「双击没反应」。4 秒后强制显示。
  const reveal = () => {
    if (win.isDestroyed()) return;
    if (options.maximized) {
      try {
        win.maximize();
      } catch {
        /* ignore */
      }
    }
    win.show();
    try {
      options.onShown?.();
    } catch (err) {
      logCrash(`重建窗口回调失败：${err?.message || err}`, 'warn');
    }
  };

  win.once('ready-to-show', reveal);
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) reveal();
  }, 4000);

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    logCrash(`页面加载失败 code=${code} desc=${description} url=${url}`);
    showFatal(`界面加载失败（${code} ${description}）。\n\n${url}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logCrash(`渲染进程退出 reason=${details?.reason} exitCode=${details?.exitCode}`);
    showFatal(`界面进程异常退出（${details?.reason || 'unknown'}）。请重新打开应用。`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/* ---------------------- 崩溃 / 异常落盘（便于用户反馈） ---------------------- */

function logCrash(message, level = 'warn') {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(path.join(dataDir, 'crash.log'), `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {
    /* 写不进就算了，不能因为日志再崩一次 */
  }
  try {
    if (level === 'info') log.info('boot', String(message));
    else log.warn('crash', String(message));
  } catch {
    /* 日志器还没就绪 */
  }
  console.error('[folio]', message);
}

let fatalBoxShown = false;
function showFatal(message) {
  if (fatalBoxShown) return;
  fatalBoxShown = true;
  try {
    dialog.showErrorBox('Folio 启动出错', `${message}\n\n详细信息已写入：\n${path.join(dataDir, 'crash.log')}`);
  } catch {
    /* 无窗口时 dialog 也可能失败 */
  }
}

process.on('uncaughtException', (error) => {
  logCrash(`uncaughtException: ${error?.stack || error}`);
  // 启动阶段（窗口还没起来）才值得弹「启动出错」；
  // 应用已经在跑的时候，写盘之类的异常只记录 + 提示一次，不该把用户拦在弹窗前。
  if (!appReady) {
    showFatal(`主进程出错：${error?.message || error}`);
    return;
  }
  const code = error?.code || '';
  if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOSPC') {
    warnWriteFailure({ file: error?.path || dataDir, message: describeFsError(error, error?.path || dataDir) });
    return;
  }
  warnWriteFailure({ file: error?.path || dataDir, message: error?.message || String(error) });
});

process.on('unhandledRejection', (reason) => {
  logCrash(`unhandledRejection: ${reason?.stack || reason}`);
});

// 单实例：两个进程同时持有 books/progress 全量快照互相覆盖，会丢书、进度回退。
// 注意不要用 app.requestSingleInstanceLock()：它把锁文件写在 userData 下，
// 在 %APPDATA% 写入受限的机器上会直接拿不到锁（Chromium 报 Lock file can not be created!
// Error code: 5），程序会在开窗前就退出。这里改用数据目录里的 pid 文件，天然跟着 FOLIO_DATA_DIR 走。
function acquireInstanceLock() {
  const lockFile = path.join(dataDir, 'instance.json');
  try {
    const info = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
    if (info && Number(info.pid) && Number(info.pid) !== process.pid) {
      try {
        process.kill(Number(info.pid), 0);
        return { ok: false, pid: Number(info.pid) };
      } catch (err) {
        // ESRCH / EPERM：原进程已经不在了，继续接管
        if (err?.code === 'EPERM') return { ok: false, pid: Number(info.pid) };
      }
    }
  } catch {}
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf-8');
  } catch {}
  return { ok: true, lockFile };
}

const instanceLock = acquireInstanceLock();
const gotSingleInstanceLock = instanceLock.ok;
if (!gotSingleInstanceLock) {
  logCrash(`已有实例在运行（pid ${instanceLock.pid}），本次启动退出`);
  app.quit();
}

if (gotSingleInstanceLock) app.whenReady().then(() => {
  appReady = true;
  // 沉浸式阅读不需要菜单栏：Windows / Linux 直接移除，macOS 保留（复制粘贴等系统快捷键依赖它）。
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  // 封面协议：只允许读 covers 目录下的单个文件名，防止路径穿越。
  protocol.handle('folio-cover', async (request) => {
    try {
      const { pathname } = new URL(request.url);
      const name = decodeURIComponent(pathname.replace(/^\/+/, ''));
      if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
        return new Response('bad request', { status: 400 });
      }
      const file = path.join(coversDir, name);
      if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('error', { status: 500 });
    }
  });

  // 字体协议：只允许读 fonts 目录下的单个文件名，防止路径穿越。
  protocol.handle('folio-font', async (request) => {
    try {
      const { pathname } = new URL(request.url);
      const name = decodeURIComponent(pathname.replace(/^\/+/, ''));
      if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
        return new Response('bad request', { status: 400 });
      }
      const file = path.join(fontsDir, name);
      if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('error', { status: 500 });
    }
  });

  try {
    restoreFromBackup();
  } catch {
    /* ignore */
  }
  try {
    migrateInlineBookContent();
  } catch {
    /* 迁移失败不影响启动，下次再试 */
  }
  createWindow();

  // 局域网面板：给冷启动让路，1.2 秒后再监听端口。
  // 服务起不来（端口被占、没权限）只记日志，不影响桌面端使用。
  setTimeout(() => {
    bootLanFromSettings().catch(() => {});
  }, 1200);

  if (dataDirInfo.fallback) {
    logCrash(`数据目录不可写，已改用 ${dataDir}（原：${dataDirInfo.preferred}）`);
    setTimeout(() => {
      try {
        dialog.showMessageBox({
          type: 'info',
          title: 'Folio',
          message: '数据目录不可写，已改用备用位置',
          detail: `${dataDirInfo.preferred}\n写入被拒绝（EPERM / 权限不足）。\n\n本次改用：\n${dataDir}\n\n如果要固定位置，可以设置环境变量 FOLIO_DATA_DIR 指向一个可写目录。`,
          buttons: ['知道了'],
        });
      } catch {
        /* ignore */
      }
    }, 1500);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 切换边框时新旧窗口短暂共存，这一刻不算「全部关闭」。
  // 不加这个判断，Windows 上会在重建窗口的瞬间直接退出应用。
  if (isRebuilding) return;
  if (process.platform !== 'darwin') app.quit();
});

// 书源写盘是 300 ms 防抖的，退出前补一次，别丢掉最后一次试搜 / 启停的结果
app.on('will-quit', () => {
  try {
    if (instanceLock.lockFile) fs.rmSync(instanceLock.lockFile, { force: true });
  } catch {
    /* 锁文件删不掉也不影响下次启动 */
  }
  try {
    flushSources();
  } catch {
    /* 退出阶段写盘失败也无所谓 */
  }
});

/* ---------- 云端书封面缓存 ---------- */

const COVER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const COVER_EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};
const COVER_EXTS = ['jpg', 'png', 'webp', 'gif', 'avif', 'svg'];
const COVER_MAX_BYTES = 8 * 1024 * 1024;

function coverKey(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16);
}

function existingCoverFile(key) {
  for (const ext of COVER_EXTS) {
    const file = path.join(coversDir, `${key}.${ext}`);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
    } catch {
      /* 读不到就跳过 */
    }
  }
  return null;
}

function coverUrlFor(fileName) {
  return `folio-cover://cover/${encodeURIComponent(fileName)}`;
}

/**
 * 把远端封面下载到 dataDir/covers 并返回可用的本地地址。
 * 命中缓存直接返回，不再发请求；失败返回 null（界面继续用生成的纯色封面）。
 */
async function fetchCoverResponse(url, { referer, retries = 2, timeout = 15000, signal } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      const headers = { 'User-Agent': COVER_UA, Accept: 'image/*,*/*;q=0.8' };
      let resolvedReferer = referer;
      if (!resolvedReferer) {
        try {
          resolvedReferer = new URL(url).origin + '/';
        } catch {
          resolvedReferer = '';
        }
      }
      if (resolvedReferer) headers.Referer = resolvedReferer;
      return await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    } catch (err) {
      if (signal?.aborted) return null;
      // 弱网下偶发超时/断流，退避重试一两次比直接放弃快
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }
  return null;
}

async function cacheCover(rawUrl, { referer, retries = 2, timeout = 15000, signal } = {}) {
  const url = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const key = coverKey(url);
  const hit = existingCoverFile(key);
  if (hit) return { url: coverUrlFor(path.basename(hit)), cached: true };

  try {
    const res = await fetchCoverResponse(url, { referer, retries, timeout, signal });
    if (!res?.ok) return null;

    const type = String(res.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const fromName = (url.match(/\.(jpe?g|png|webp|gif|avif|svg)(?:\?|#|$)/i) || [])[1];
    const ext =
      COVER_EXT_BY_TYPE[type] ||
      (fromName ? fromName.toLowerCase().replace('jpeg', 'jpg') : '') ||
      'jpg';

    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > COVER_MAX_BYTES) return null;
    // 有些站点出错时返回 HTML，别把网页存成封面
    if (/^\s*<(!doctype|html)/i.test(buffer.subarray(0, 64).toString('utf8'))) return null;

    fs.mkdirSync(coversDir, { recursive: true });
    const fileName = `${key}.${ext}`;
    const target = path.join(coversDir, fileName);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, target);
    return { url: coverUrlFor(fileName), cached: false };
  } catch {
    return null;
  }
}

/** 批量：书架一次要几十张封面时减少往返。 */
async function cacheCovers(list) {
  const items = Array.isArray(list) ? list.slice(0, 80) : [];
  const out = {};
  const queue = [...items];
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item?.url) continue;
      const id = String(item.id || item.url);
      const result = await cacheCover(item.url, { referer: item.referer });
      if (result?.url) out[id] = result.url;
    }
  });
  await Promise.all(workers);
  return { covers: out };
}

/* ---------- 章节图片并发预取（弱网自适应） ---------- */

const IMAGE_PREFETCH_MAX = 600;
const imagePrefetchJobs = new Map();

/** 先测一张图估算链路速度：弱网自动降到 3 并发，避免把带宽全占满。 */
async function runImagePool({ key, sender, items, referer, concurrency, signal }) {
  const urls = {};
  let cursor = 0;
  let done = 0;
  let failed = 0;
  const total = items.length;
  const worker = async () => {
    while (!signal.aborted) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (!item) return;
      const result = await cacheCover(item.url, { referer: item.referer || referer, signal });
      if (signal.aborted) return;
      if (result?.url) urls[item.id] = result.url;
      else failed += 1;
      done += 1;
      try {
        sender?.send?.('cloud:image-progress', {
          key,
          id: item.id,
          url: result?.url || '',
          done,
          total,
        });
      } catch {
        /* 窗口已关闭 */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return { urls, done, failed };
}

ipcMain.handle('cloud:prefetch-images', async (event, { key, items, referer, concurrency } = {}) => {
  const list = (Array.isArray(items) ? items : [])
    .filter((item) => item && /^https?:\/\//i.test(String(item.url || '')))
    .slice(0, IMAGE_PREFETCH_MAX)
    .map((item, i) => ({
      id: String(item.id ?? i),
      url: String(item.url),
      referer: item.referer || '',
    }));
  const jobKey = String(key || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  if (!list.length) return { key: jobKey, urls: {}, done: 0, failed: 0, slow: false };

  imagePrefetchJobs.get(jobKey)?.abort?.();
  const controller = new AbortController();
  imagePrefetchJobs.set(jobKey, controller);
  const sender = event.sender;
  try {
    const started = Date.now();
    const probe = await cacheCover(list[0].url, { referer: list[0].referer || referer, signal: controller.signal });
    const slow = Date.now() - started > 4000;
    if (probe?.url && sender) {
      try {
        sender.send('cloud:image-progress', { key: jobKey, id: list[0].id, url: probe.url, done: 1, total: list.length });
      } catch {
        /* ignore */
      }
    }
    const limit = slow ? 3 : Math.max(2, Math.min(Number(concurrency) || 8, 10));
    const rest = list.slice(1);
    const pooled = rest.length
      ? await runImagePool({ key: jobKey, sender, items: rest, referer, concurrency: limit, signal: controller.signal })
      : { urls: {}, done: 0, failed: 0 };
    const urls = probe?.url ? { [list[0].id]: probe.url, ...pooled.urls } : pooled.urls;
    return {
      key: jobKey,
      urls,
      done: pooled.done + (probe?.url ? 1 : 0),
      failed: pooled.failed + (probe?.url ? 0 : 1),
      slow,
    };
  } finally {
    if (imagePrefetchJobs.get(jobKey) === controller) imagePrefetchJobs.delete(jobKey);
  }
});

ipcMain.handle('cloud:prefetch-images-cancel', (_e, { key } = {}) => {
  const jobKey = String(key || '');
  const job = imagePrefetchJobs.get(jobKey);
  if (job) {
    try {
      job.abort();
    } catch {
      /* ignore */
    }
    imagePrefetchJobs.delete(jobKey);
  }
  return true;
});

/* ---------- 局域网面板 ---------- */

// 同一个 Wi-Fi 下，手机/平板用浏览器打开「http://<本机 IP>:<端口>/?t=<访问码>」
// 就能看到书架、读到哪了，还能接着往下读 —— 进度写回 progress.json，
// 桌面端通过 IPC 收到通知后合并进内存状态，两端始终是同一份数据。

const LAN_DEFAULT_PORT = 7788;

function normalizeLanConfig(raw) {
  const lan = raw && typeof raw === 'object' ? raw : {};
  const port = Number(lan.port);
  return {
    enabled: lan.enabled === true,
    port: Number.isFinite(port) ? Math.max(1024, Math.min(65535, Math.round(port))) : LAN_DEFAULT_PORT,
    token: String(lan.token || '').trim().slice(0, 32),
    allowWrite: lan.allowWrite !== false,
  };
}

let lanService = null;
let lanConfig = normalizeLanConfig(null);

function lanLog(level, message, meta) {
  const fn = log[level] || log.info;
  try {
    fn.call(log, 'lan', message, meta);
  } catch {
    /* 日志失败不能影响服务 */
  }
}

function ensureLanService() {
  if (lanService) return lanService;
  lanService = createLanService({
    files,
    booksDir,
    readJson,
    writeJson,
    log: lanLog,
    getVersion: () => app.getVersion(),
    // 封面：本地缓存里有就直接发文件，没有就 302 到源站 ——
    // 不在服务端代下封面，免得把桌面端的抓取队列搬到手机请求上。
    resolveCover: (book) => {
      const url = String(book?.cover || '').trim();
      if (!/^https?:\/\//i.test(url)) return null;
      const file = existingCoverFile(coverKey(url));
      return file ? { file, url } : { url };
    },
    // 手机写进来的进度：落盘由 lan.js 做，这里把结果推给桌面窗口，
    // 正在看的书架 / 阅读器立刻跟上。
    onRemoteProgress: (progress, bookId) => {
      broadcast('lan:progress', { progress, bookId, at: Date.now() });
    },
  });
  return lanService;
}

async function applyLanConfig(raw) {
  lanConfig = normalizeLanConfig(raw);
  if (!lanConfig.enabled) {
    if (lanService?.running) await lanService.stop();
    return lanService ? lanService.status() : { running: false, port: 0, urls: [], token: lanConfig.token, clients: 0 };
  }
  const result = await ensureLanService().start(lanConfig);
  // 访问码由主进程兜底生成时（老版本设置里没有这个字段），先告诉渲染层，
  // 由设置页负责写回 settings.json —— 磁盘上的设置永远只有一个写入方。
  if (result.ok && !lanConfig.token) {
    broadcast('lan:token', { token: result.token });
  }
  return result;
}

/** 启动时按磁盘上的设置恢复服务；失败只记日志，绝不拦启动。 */
async function bootLanFromSettings() {
  let settings = {};
  try {
    settings = readJson(files.settings, {}) || {};
  } catch {
    return;
  }
  lanConfig = normalizeLanConfig(settings.lan);
  if (!lanConfig.enabled) return;
  try {
    await applyLanConfig(lanConfig);
  } catch (err) {
    lanLog('warn', `局域网面板自动启动失败：${err?.message || err}`);
  }
}

/* ---------- IPC ---------- */

ipcMain.handle('lan:start', (_e, config) => applyLanConfig(config));
ipcMain.handle('lan:stop', () => applyLanConfig({ ...lanConfig, enabled: false }));
ipcMain.handle('lan:status', () => {
  const base = {
    running: false,
    port: 0,
    urls: [],
    token: lanConfig.token,
    allowWrite: lanConfig.allowWrite,
    clients: 0,
    addresses: lanAddresses(),
  };
  if (!lanService) return base;
  return { ...base, ...lanService.status() };
});
ipcMain.handle('lan:open', async (_e, url) => {
  const target = String(url || '');
  if (!/^https?:\/\//i.test(target)) return { ok: false };
  try {
    await shell.openExternal(target);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dataDir,
}));

/* ---------- 窗口控制（自绘的 macOS 风格交通灯用） ---------- */

// 自绘交通灯需要自己接管最小化 / 最大化 / 关闭。
// 这三个动作只在主进程做，渲染层通过 preload 的薄封装调用，
// 不给渲染层任何 Node 能力。
ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  return true;
});

ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  return true;
});

ipcMain.handle('window:is-maximized', () => {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized());
});

// 渲染层起来后会带着真实的设置值来校正边框模式。
// 第二个参数是「切换前用户在看什么」，重建窗口后要靠它把界面还原回去。
ipcMain.handle('window:set-frame', (_e, enabled, uiState) => applyFrameMode(enabled, uiState));

// 新窗口起来后问主进程要回「切换前的界面状态」。
// 只给一次，给完就清掉，避免下次启动又还原到上次的位置。
ipcMain.handle('window:get-ui-state', () => {
  const state = pendingUiState;
  pendingUiState = null;
  return state;
});

/* ---------- 日志 ---------- */

ipcMain.handle('log:tail', (_e, payload = {}) => log.tail(payload));
ipcMain.handle('log:files', () => log.files());
ipcMain.handle('log:level', (_e, name) => (name ? log.setLevel(name) : log.level));
ipcMain.handle('log:clear', () => log.clear());
ipcMain.handle('log:info', () => ({ dir: log.dir, level: log.level, files: log.files(), size: log.tail({ limit: 2000 }).length }));
ipcMain.handle('log:from-renderer', (_e, payload = {}) => {
  const level = ['error', 'warn', 'info', 'debug'].includes(payload.level) ? payload.level : 'error';
  log[level]('ui', String(payload.message || '').slice(0, 500), {
    stack: payload.stack ? String(payload.stack).split('\n').slice(0, 6).join(' | ') : undefined,
    ...(payload.extra && typeof payload.extra === 'object' ? { extra: payload.extra } : {}),
  });
  return { ok: true };
});
ipcMain.handle('log:open', async () => {
  if (!log.dir) return { ok: false, error: '日志目录不可用' };
  const err = await shell.openPath(log.dir);
  return err ? { ok: false, error: err } : { ok: true, dir: log.dir };
});
ipcMain.handle('log:export', async () => {
  const stampText = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出日志',
    defaultPath: path.join(app.getPath('downloads'), `folio-log-${stampText}.txt`),
    filters: [{ name: '文本', extensions: ['txt', 'log'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const head = [
    `Folio ${app.getVersion()}`,
    `时间 ${new Date().toISOString()}`,
    `平台 ${process.platform} ${process.arch}`,
    `数据目录 ${dataDir}`,
    `Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
    `参数 ${process.argv.slice(1).join(' ')}`,
    '',
  ].join('\n');
  const body = log.tail({ limit: 2000, level: 'debug' }).join('\n');
  try {
    fs.writeFileSync(filePath, `${head}\n${body}\n`, 'utf8');
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cover:cache', async (_e, payload = {}) => cacheCover(payload.url, { referer: payload.referer }));
ipcMain.handle('cover:cache-many', async (_e, payload = {}) => cacheCovers(payload.items));
ipcMain.handle('cover:clear', async () => {
  try {
    fs.rmSync(coversDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return { ok: true };
});

ipcMain.handle('book:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入电子书',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '纯文本电子书', extensions: ['txt', 'md', 'markdown', 'text'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  // 逐个导入：一个文件读失败不该让其余书都进不来
  const list = [];
  for (const filePath of result.filePaths) {
    try {
      list.push(importBookFromPath(filePath));
    } catch (err) {
      list.push({ error: `${path.basename(filePath)}：${err.message}` });
    }
  }
  const failed = list.filter((item) => item?.error);
  if (list.length === 1) return list[0];
  return { books: list.filter((item) => !item?.error), errors: failed.map((f) => f.error) };
});

ipcMain.handle('book:add-content', async (_e, payload) => {
  try {
    return importBookFromContent(payload || {});
  } catch (err) {
    return { error: err.message };
  }
});

/** 只允许读 books/ 里的副本，或 books.json 里登记过的 filePath（防渲染层读任意文件）。 */
function isKnownBookPath(filePath) {
  const target = path.resolve(String(filePath || ''));
  const root = path.resolve(booksDir) + path.sep;
  if (target.startsWith(root)) return true;
  const list = readJson(files.books, []);
  return Array.isArray(list) && list.some((book) => book?.filePath && path.resolve(book.filePath) === target);
}

ipcMain.handle('book:read', async (_e, filePath) => {
  try {
    if (!isKnownBookPath(filePath)) {
      return { error: '这个文件不在书架目录里，拒绝读取' };
    }
    return readBookContent(filePath);
  } catch (err) {
    return { error: `读不到这本书的正文（${path.basename(String(filePath || ''))}）：${err.message}` };
  }
});

ipcMain.handle('book:load-path', async (_e, filePath) => {
  try {
    return importBookFromPath(filePath);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('book:delete-file', async (_e, filePath) => {
  // 只删 books/ 里的副本，避免误删用户的原文件
  try {
    const target = path.resolve(String(filePath || ''));
    const root = path.resolve(booksDir) + path.sep;
    if (!target.startsWith(root)) return { ok: false, reason: 'not-in-books-dir' };
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('book:show-in-folder', (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

/* ---------- 字体 ---------- */

// 允许安装的字体扩展名。woff2 的族名解析成本高（见 fontmeta.js），但仍可安装，
// 只是列表里显示文件名而不是真实族名。
const FONT_EXTENSIONS = ['ttf', 'otf', 'ttc', 'woff', 'woff2', 'fon'];

function fontMetaPath() {
  return path.join(dataDir, 'fonts.json');
}

/** 读字体元信息列表；顺手剔除已经被手动删掉的字体文件。 */
function readFontMeta() {
  const list = readJson(fontMetaPath(), []);
  if (!Array.isArray(list)) return [];
  const kept = [];
  for (const item of list) {
    if (!item?.id || !item?.file) continue;
    const file = path.join(fontsDir, item.file);
    if (!fs.existsSync(file)) continue;
    kept.push(item);
  }
  if (kept.length !== list.length) writeJson(fontMetaPath(), kept);
  return kept;
}

/** 生成一个不会撞车的字体 id。 */
function makeFontId(fileName) {
  const base = path.basename(fileName, path.extname(fileName)).replace(/[^\w一-龥-]/g, '_');
  const stamp = Date.now().toString(36);
  return `${base || 'font'}-${stamp}`;
}

ipcMain.handle('font:list', () => readFontMeta());

ipcMain.handle('font:install', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '安装字体',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '字体文件', extensions: FONT_EXTENSIONS },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const installed = [];
  const errors = [];
  const list = readFontMeta();

  for (const src of result.filePaths) {
    const ext = path.extname(src).toLowerCase().replace('.', '');
    if (!FONT_EXTENSIONS.includes(ext)) {
      errors.push(`${path.basename(src)}：不是受支持的字体格式（${FONT_EXTENSIONS.join(' / ')}）`);
      continue;
    }
    try {
      fs.mkdirSync(fontsDir, { recursive: true });

      const id = makeFontId(src);
      const fileName = `${id}.${ext}`;
      const dest = path.join(fontsDir, fileName);
      fs.copyFileSync(src, dest);

      const meta = readFontMetaFile(src);
      // 记录字符覆盖情况，界面据此提前提示「这款不含中文」
      const coverage = readFontCoverageFile(src);
      const record = {
        id,
        file: fileName,
        family: meta.family || familyFromFilename(src),
        format: ext,
        size: fs.statSync(dest).size,
        addedAt: Date.now(),
        hasCJK: coverage.hasCJK,
        cjkRatio: coverage.cjkRatio,
        hasLatin: coverage.hasLatin,
      };
      list.push(record);
      installed.push(record);
    } catch (err) {
      errors.push(`${path.basename(src)}：${err.message || '复制失败'}`);
    }
  }

  writeJson(fontMetaPath(), list);
  return { fonts: readFontMeta(), installed, errors };
});

ipcMain.handle('font:remove', (_e, id) => {
  const list = readFontMeta();
  const target = list.find((f) => f.id === id);
  if (!target) return { ok: false, error: '字体不存在' };
  try {
    const file = path.join(fontsDir, target.file);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    return { ok: false, error: err.message || '删除失败' };
  }
  writeJson(
    fontMetaPath(),
    list.filter((f) => f.id !== id)
  );
  return { ok: true, fonts: readFontMeta() };
});

ipcMain.handle('font:clear', () => {
  const list = readFontMeta();
  for (const item of list) {
    try {
      const file = path.join(fontsDir, item.file);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* 单个文件删不掉不影响其余 */
    }
  }
  writeJson(fontMetaPath(), []);
  return { ok: true, fonts: [] };
});

ipcMain.handle('font:show-in-folder', (_e, id) => {
  const target = readFontMeta().find((f) => f.id === id);
  if (!target) return { ok: false };
  const file = path.join(fontsDir, target.file);
  if (!fs.existsSync(file)) return { ok: false };
  shell.showItemInFolder(file);
  return { ok: true };
});

ipcMain.handle('store:get-books', () => readJson(files.books, []));
ipcMain.handle('store:set-books', (_e, books) => {
  const safe = Array.isArray(books) ? books : [];
  const result = writeJson(files.books, safe);
  if (!safe.length) markExplicitlyCleared(files.books);
  // 书架变了就通知局域网面板重拉一次（新增/移出书都会走到这里）
  if (lanService?.running) {
    try {
      lanService.publish('books', { at: Date.now(), count: safe.length });
    } catch {
      /* 推送失败不影响落盘 */
    }
  }
  return result;
});
ipcMain.handle('store:get-progress', () => readJson(files.progress, {}));
ipcMain.handle('store:set-progress', (_e, progress) => {
  const safe = progress && typeof progress === 'object' ? progress : {};
  const result = writeJson(files.progress, safe);
  if (!Object.keys(safe).length) markExplicitlyCleared(files.progress);
  // 桌面端读完一段，手机上正开着的那一页也要更新
  if (lanService?.running) {
    try {
      lanService.publish('progress', { progress: safe, origin: 'desktop', at: Date.now() });
    } catch {
      /* 推送失败不影响落盘 */
    }
  }
  return result;
});
ipcMain.handle('store:get-settings', () => readJson(files.settings, null));
ipcMain.handle('store:set-settings', (_e, settings) => {
  const result = writeJson(files.settings, settings);
  // 网络配置变了（开关 / 端口 / 访问码 / 只读）就立刻生效，不用重启应用。
  // 放到 setImmediate 里做：起停服务要几十毫秒，不能拖慢设置本身的保存。
  const next = normalizeLanConfig(settings?.lan);
  if (JSON.stringify(next) !== JSON.stringify(lanConfig)) {
    setImmediate(() => {
      applyLanConfig(next).catch((err) => lanLog('warn', `应用网络配置失败：${err?.message || err}`));
    });
  }
  return result;
});

/* ---------- 书源 ---------- */

// sources.json 里有上万个书源时单个文件能到 1.6 MB，读一次要 20~40 ms。
// 渲染进程的很多 IPC（试搜、导入、云端搜索…）都会回带 sources，所以把解析结果缓存在内存里，
// 只在真正写盘时更新缓存 + 用 300 ms 防抖合并连续写入（批量试搜会连续回写 stat）。
let sourcesCache = null;
let sourcesFlushTimer = null;
let slimCache = null;
let slimCacheOf = null;

const readSources = () => {
  if (sourcesCache) return sourcesCache;
  const list = readJson(files.sources, []);
  sourcesCache = Array.isArray(list) ? list : [];
  return sourcesCache;
};

function flushSources() {
  if (sourcesFlushTimer) {
    clearTimeout(sourcesFlushTimer);
    sourcesFlushTimer = null;
  }
  if (sourcesCache) writeJson(files.sources, sourcesCache);
  slimCache = null;
  slimCacheOf = null;
}

function writeSources(list) {
  sourcesCache = Array.isArray(list) ? list : [];
  slimCache = null;
  slimCacheOf = null;
  if (sourcesFlushTimer) clearTimeout(sourcesFlushTimer);
  sourcesFlushTimer = setTimeout(() => {
    sourcesFlushTimer = null;
    if (sourcesCache) writeJson(files.sources, sourcesCache);
  }, 300);
  return sourcesCache;
}

/**
 * 列表页只需要"看得见"的字段：去掉 jsLib / exploreUrl / 各套规则，
 * 否则 1000+ 书源的 payload 会有好几 MB（单个 jsLib 可达 24 KB）。
 */
function slimSource(item) {
  const host = (() => {
    try {
      return domainToUnicode(new URL(item.baseUrl).host);
    } catch {
      return '';
    }
  })();
  return {
    id: item.id,
    name: item.name,
    baseUrl: item.baseUrl,
    host,
    group: item.group || '',
    charset: item.charset || '',
    enabled: item.enabled !== false,
    type: item.type ?? 0,
    typeLabel: item.typeLabel || '文本',
    dialect: item.dialect || 'legado',
    weight: item.weight || 0,
    hasSearch: Boolean(item.search?.url),
    stat: item.stat || null,
    unsupported: item.unsupported || [],
  };
}

const slimSources = () => {
  const list = readSources();
  if (slimCache && slimCacheOf === list) return slimCache;
  slimCache = list.map(slimSource);
  slimCacheOf = list;
  return slimCache;
};

async function parseSourcePayload(payload) {
  // 兼容两种调用方式：直接传字符串，或传 { text } / { content } 对象
  const raw = payload && typeof payload === 'object'
    ? (payload.text ?? payload.content ?? payload.body ?? payload)
    : payload;
  const text = String(raw ?? '').trim();
  if (!text) return { error: '内容为空' };

  // 粘错东西是最常见的失败：网页、导入协议链接、GitHub 页面地址
  if (/^legado:\/\//i.test(text) || /^yuedu:\/\//i.test(text)) {
    return {
      error: '这是「阅读」的导入链接（legado://），不是书源 JSON。把它填到上面的「订阅链接」输入框，或改成 http(s) 开头的地址。',
    };
  }
  if (/^\s*(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<\?xml)/i.test(text) || /<body[\s>]/i.test(text.slice(0, 4000))) {
    return {
      error:
        '这段内容是网页（HTML），不是书源 JSON。请改用网页上的「订阅链接 / 一键导入」地址：GitHub 要用 raw 或 jsDelivr 的 .json 地址，别用仓库网页地址。',
    };
  }
  if (/^https?:\/\/\S+$/i.test(text) && !/\n/.test(text)) {
    return { error: '这是一条网址，不是书源 JSON。请把它填到上面的「订阅链接」输入框。' };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const preview = text.slice(0, 32).replace(/\s+/g, ' ');
    const hint = /^\s*\[?\s*\{/.test(text) ? '（括号没闭合或多了逗号）' : '';
    return { error: `JSON 解析失败${hint}：${err.message}。内容开头是「${preview}…」` };
  }
  const items = Array.isArray(data) ? data : [data];
  if (!items.length) return { error: '没有可导入的内容' };
  // GitHub API / 站点接口的错误对象，直接说清楚
  if (!Array.isArray(data) && typeof data === 'object' && data.message && !data.bookSourceName && !data.bookSourceUrl && !data.name) {
    return { error: `地址返回的是错误信息：${data.message}。检查一下链接是不是 404 或需要登录。` };
  }
  // looksLikeFeedIndex 在 sources.js，detectPayloadKind 在 replace.js —— 两个都是懒加载的模块
  const { looksLikeFeedIndex } = await loadSources();
  const { detectPayloadKind } = await loadReplace();
  if (looksLikeFeedIndex(items)) {
    return { items, kind: 'feeds', feeds: items.filter((item) => item && typeof item.url === 'string') };
  }
  return { items, kind: detectPayloadKind(items) };
}

/* ---------- 替换规则（净化） ---------- */

const readRules = () => {
  const list = readJson(files.rules, []);
  return Array.isArray(list) ? list : [];
};

async function importRules(items) {
  const existing = readRules();
  const byId = new Map(existing.map((item) => [item.id, item]));
  const errors = [];
  let added = 0;
  let updated = 0;
  const { normalizeRule } = await loadReplace();

  items.forEach((item, index) => {
    const normalized = normalizeRule(item, index);
    if (normalized.error) {
      errors.push({ index, name: item?.name || `#${index + 1}`, message: normalized.error });
      return;
    }
    if (byId.has(normalized.id)) {
      const previous = byId.get(normalized.id);
      byId.set(normalized.id, { ...normalized, enabled: previous.enabled !== false });
      updated += 1;
    } else {
      byId.set(normalized.id, normalized);
      added += 1;
    }
  });

  const merged = [...byId.values()].sort((a, b) => (a.order || 0) - (b.order || 0));
  writeJson(files.rules, merged);
  return { rules: merged, errors, added, updated };
}

/** 把已启用的规则套到正文/标题上。 */
async function cleanText(text, scope) {
  const raw = String(text ?? '');
  if (!raw) return raw;
  const enabled = readRules().filter((rule) => rule.enabled !== false);
  // 没有启用任何规则时不必加载 replace.js（它连着 jsengine 一整条链）
  const cleaned = enabled.length
    ? (await loadReplace()).applyRules(raw, enabled, { scope, cacheRoot: dataDir })
    : raw;
  if (scope !== 'title') return cleaned;
  // 目录标题里常混着「免费」之类的角标和换行，压平成一行
  return String(cleaned).replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

ipcMain.handle('rules:list', () => readRules());

ipcMain.handle('rules:save', (_e, list) => {
  const safe = Array.isArray(list) ? list : [];
  writeJson(files.rules, safe);
  if (!safe.length) markExplicitlyCleared(files.rules);
  return safe;
});

ipcMain.handle('rules:import-text', async (_e, payload) => {
  const parsed = await parseSourcePayload(payload);
  if (parsed.error) return { error: parsed.error, rules: readRules(), errors: [] };
  return importRules(parsed.items);
});

ipcMain.handle('rules:import-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入净化规则',
    properties: ['openFile'],
    filters: [
      { name: '规则 JSON', extensions: ['json', 'txt'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    const payload = decodeText(fs.readFileSync(result.filePaths[0]));
    const parsed = await parseSourcePayload(payload);
    if (parsed.error) return { error: parsed.error, rules: readRules(), errors: [] };
    return { ...(await importRules(parsed.items)), fileName: path.basename(result.filePaths[0]) };
  } catch (err) {
    return { error: err.message || '读取失败', rules: readRules(), errors: [] };
  }
});

ipcMain.handle('rules:remove', (_e, id) => {
  const next = readRules().filter((rule) => rule.id !== id);
  writeJson(files.rules, next);
  return next;
});

ipcMain.handle('rules:clear', () => {
  writeJson(files.rules, []);
  return [];
});

async function importSources(items) {
  const existing = readSources();
  const byId = new Map(existing.map((item) => [item.id, item]));
  const errors = [];
  let added = 0;
  let updated = 0;
  const touchIds = new Set();
  const { normalizeSource } = await loadSources();

  items.forEach((item, index) => {
    let normalized;
    try {
      normalized = normalizeSource(item);
    } catch (err) {
      // 一条坏源不该拖垮整批导入
      normalized = { error: err?.message || '这条书源无法解析' };
    }
    if (normalized.error) {
      errors.push({ index, name: item?.name || item?.bookSourceName || `#${index + 1}`, message: normalized.error });
      return;
    }
    touchIds.add(normalized.id);
    if (byId.has(normalized.id)) {
      const previous = byId.get(normalized.id);
      byId.set(normalized.id, { ...normalized, enabled: previous.enabled !== false });
      updated += 1;
    } else {
      byId.set(normalized.id, { ...normalized, enabled: normalized.enabled !== false });
      added += 1;
    }
  });

  const merged = [...byId.values()];
  writeSources(merged);
  // 覆盖导入的源要把旧运行时丢掉，否则改好的 jsLib/headers 不生效
  if (touchIds.size) {
    const { disposeRuntime } = await loadEngine();
    for (const id of touchIds) disposeRuntime(id);
  }
  return { sources: merged, errors, added, updated };
}

/** 订阅索引（`[{title,url,home_page,tags}]`）：逐个下载里面的书源文件再合并。 */
async function importFeeds(feeds, indexUrl = '') {
  const resolve = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (!indexUrl) return '';
    try {
      return new URL(raw, indexUrl).toString();
    } catch {
      return '';
    }
  };
  const list = (Array.isArray(feeds) ? feeds : [])
    .map((feed) => (feed ? { ...feed, url: resolve(feed.url) } : null))
    .filter((feed) => feed && /^https?:\/\//i.test(String(feed.url || '').trim()))
    .slice(0, 8);
  const report = [];
  let added = 0;
  let updated = 0;

  for (const feed of list) {
    const rawUrl = String(feed.url).trim();
    const title = String(feed.title || '').trim() || rawUrl;
    try {
      let payload = null;
      let used = rawUrl;
      const failures = [];
      for (const candidate of [rawUrl, ...deriveMirrors(rawUrl)]) {
        try {
          const body = await downloadText(candidate, 20000);
          const text = String(body || '').trim();
          if (!text) throw new Error('内容为空');
          if (text.startsWith('<')) throw new Error('返回的是网页而不是 JSON');
          payload = text;
          used = candidate;
          break;
        } catch (err) {
          failures.push(err?.name === 'AbortError' ? '请求超时' : err?.message || '网络错误');
        }
      }
      if (!payload) throw new Error(failures.join('；') || '下载失败');

      const parsed = await parseSourcePayload(payload);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.kind === 'feeds') throw new Error('订阅里套订阅，暂不支持');
      if (parsed.kind === 'rules') {
        const ruleResult = await importRules(parsed.items);
        report.push({ title, url: used, rules: ruleResult.rules.length, added: ruleResult.added });
        continue;
      }
      const result = await importSources(parsed.items);
      added += result.added;
      updated += result.updated;
      report.push({
        title,
        url: used,
        added: result.added,
        updated: result.updated,
        failed: result.errors.length,
        error: result.errors.length ? result.errors[0].message : '',
      });
    } catch (err) {
      report.push({ title, url: rawUrl, error: String(err?.message || err).slice(0, 120) });
    }
  }

  return { feeds: report, added, updated, asFeeds: true, sources: slimSources() };
}

ipcMain.handle('source:list', () => slimSources());

ipcMain.handle('source:save', (_e, list) => {
  const safe = Array.isArray(list) ? list : [];
  writeSources(safe);
  if (!safe.length) markExplicitlyCleared(files.sources);
  return safe;
});

/** 列表页只改启用状态 / 删除，都按 id 在主进程改，避免把瘦身后的对象写回磁盘。 */
ipcMain.handle('source:set-enabled', (_e, ids, enabled) => {
  const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
  const list = readSources().map((item) =>
    wanted.has(item.id) ? { ...item, enabled: enabled !== false } : item,
  );
  writeSources(list);
  return slimSources();
});

ipcMain.handle('source:remove', async (_e, ids) => {
  const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
  const list = readSources().filter((item) => !wanted.has(item.id));
  writeSources(list);
  // 删掉的源不必再留着 JS 运行时和它的 vars/cache
  if (wanted.size) {
    const { disposeRuntime } = await loadEngine();
    for (const id of wanted) disposeRuntime(id);
  }
  return slimSources();
});

ipcMain.handle('source:import-text', async (_e, payload) => {
  const parsed = await parseSourcePayload(payload);
  if (parsed.error) return { error: parsed.error, sources: slimSources(), errors: [] };
  if (parsed.kind === 'rules') {
    const result = await importRules(parsed.items);
    return { ...result, asRules: true, sources: slimSources() };
  }
  if (parsed.kind === 'feeds') return importFeeds(parsed.feeds);
  return importSources(parsed.items);
});

ipcMain.handle('source:import-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入书源',
    properties: ['openFile'],
    filters: [
      { name: '书源 JSON', extensions: ['json', 'txt'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    const payload = decodeText(fs.readFileSync(result.filePaths[0]));
    const parsed = await parseSourcePayload(payload);
    if (parsed.error) return { error: parsed.error, sources: slimSources(), errors: [] };
    const fileName = path.basename(result.filePaths[0]);
    if (parsed.kind === 'rules') return { ...(await importRules(parsed.items)), asRules: true, fileName, sources: slimSources() };
    if (parsed.kind === 'feeds') return { ...(await importFeeds(parsed.feeds)), fileName };
    return { ...(await importSources(parsed.items)), fileName };
  } catch (err) {
    return { error: err.message, sources: slimSources(), errors: [] };
  }
});

const UA_DOWNLOAD =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** `legado://import/bookSource?src=https://…` 这类导入链接，取出真正的 JSON 地址。 */
function unwrapImportUrl(raw) {
  const text = String(raw || '').trim();
  if (!/^legado:\/\//i.test(text)) return text;
  try {
    const parsed = new URL(text);
    return parsed.searchParams.get('src') || parsed.searchParams.get('url') || text;
  } catch {
    const match = /[?&]src=([^&]+)/i.exec(text);
    return match ? decodeURIComponent(match[1]) : text;
  }
}

/** 从 GitHub 系地址推导可用镜像：raw → jsDelivr → api.github.com（base64）。 */
function deriveMirrors(url) {
  const mirrors = [];
  try {
    const parsed = new URL(url);
    let owner = '';
    let repo = '';
    let branch = '';
    let file = [];
    if (parsed.hostname === 'raw.githubusercontent.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      [owner, repo, branch, ...file] = parts;
    } else if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      owner = parts[0];
      repo = parts[1];
      branch = parts[3];
      file = parts.slice(4);
    } else if (parsed.hostname === 'github.com' && /\/raw\//.test(parsed.pathname)) {
      // https://github.com/<o>/<r>/raw/<branch>/<path> 或 .../raw/refs/heads/<branch>/<path>
      const parts = parsed.pathname.split('/').filter(Boolean);
      owner = parts[0];
      repo = parts[1];
      let rest = parts.slice(3);
      if (rest[0] === 'refs' && rest[1] === 'heads') rest = rest.slice(2);
      branch = rest[0];
      file = rest.slice(1);
    } else if (parsed.hostname === 'cdn.jsdelivr.net' && parsed.pathname.startsWith('/gh/')) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      owner = parts[1];
      const repoPart = parts[2] || '';
      const at = repoPart.indexOf('@');
      repo = at === -1 ? repoPart : repoPart.slice(0, at);
      branch = at === -1 ? 'main' : repoPart.slice(at + 1);
      file = parts.slice(3);
    }
    if (owner && repo && branch && file.length) {
      const filePath = file.join('/');
      mirrors.push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`);
      mirrors.push(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`,
      );
    }
  } catch {
    /* ignore */
  }
  return mirrors.filter((item) => item !== url);
}

async function downloadText(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA_DOWNLOAD, Accept: '*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // api.github.com 返回的是 base64 包裹的 JSON
    if (/^https:\/\/api\.github\.com\//i.test(url)) {
      try {
        const meta = JSON.parse(text);
        if (meta && meta.encoding === 'base64' && meta.content) {
          return Buffer.from(meta.content, 'base64').toString('utf8');
        }
      } catch {
        /* fall through */
      }
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

ipcMain.handle('source:import-url', async (_e, rawUrl) => {
  const text = unwrapImportUrl(rawUrl);
  if (!/^https?:\/\//i.test(text)) {
    return { error: '请填写 http(s) 开头的书源订阅地址', sources: slimSources(), errors: [] };
  }

  const candidates = [text, ...deriveMirrors(text)];
  const failures = [];
  let payload = null;
  let usedUrl = text;

  for (const candidate of candidates) {
    try {
      const body = await downloadText(candidate);
      const trimmed = String(body || '').trim();
      if (!trimmed) throw new Error('内容为空');
      if (trimmed.startsWith('<') || /^\uFEFF?\s*</.test(trimmed)) throw new Error('返回的是网页而不是 JSON');
      payload = trimmed;
      usedUrl = candidate;
      break;
    } catch (err) {
      const reason = err?.name === 'AbortError' ? '请求超时' : err?.message || '网络错误';
      failures.push(`${new URL(candidate).host}：${reason}`);
    }
  }

  if (payload == null) {
    return {
      error: `下载书源失败：${failures.join('；')}。若地址在 GitHub 上，可尝试粘贴 jsDelivr 镜像地址。`,
      sources: slimSources(),
      errors: [],
    };
  }

  const parsed = await parseSourcePayload(payload);
  if (parsed.error) return { error: parsed.error, sources: slimSources(), errors: [] };

  const host = (() => {
    try {
      return new URL(usedUrl).host;
    } catch {
      return usedUrl;
    }
  })();
  const mirrorsUsed = usedUrl !== text;
  if (parsed.kind === 'rules') {
    return { ...(await importRules(parsed.items)), asRules: true, fromUrl: usedUrl, host, mirrorsUsed, sources: slimSources() };
  }
  if (parsed.kind === 'feeds') {
    return { ...(await importFeeds(parsed.feeds, usedUrl)), fromUrl: usedUrl, host, mirrorsUsed };
  }
  return { ...(await importSources(parsed.items)), fromUrl: usedUrl, host, mirrorsUsed };
});

/** 把试搜结果记到书源上（书源健康度），供书架/书源面板排序展示。 */
function recordSourceStat(sourceId, patch) {
  try {
    const list = readSources();
    const index = list.findIndex((item) => item.id === sourceId);
    if (index === -1) return null;
    const stat = { at: Date.now(), ...patch };
    list[index] = { ...list[index], stat };
    writeSources(list);
    return list[index];
  } catch {
    return null;
  }
}

async function runSourceTest(source, keyword, proxy) {
  try {
    const { searchSource } = await loadSources();
    const results = await searchSource(source, keyword || '的', 1, { cacheRoot: dataDir, proxy });
    return {
      ok: true,
      count: results.length,
      sample: results.slice(0, 3).map((item) => ({ name: item.name, author: item.author })),
      message: results.length
        ? `搜索「${keyword || '的'}」命中 ${results.length} 条`
        : '请求成功，但没有解析到结果（可能是选择器不匹配）',
    };
  } catch (err) {
    return { ok: false, count: 0, message: err?.message || '请求失败' };
  }
}

ipcMain.handle('source:test', async (_e, sourceId, keyword, proxy) => {
  const source = readSources().find((item) => item.id === sourceId);
  if (!source) return { ok: false, message: '书源不存在' };
  const result = await runSourceTest(source, keyword, proxy);
  // ok 表示「请求打通了」，count 为 0 只是这个词没结果，不能当成书源坏了
  recordSourceStat(sourceId, { ok: result.ok, count: result.count, message: result.message });
  return { ...result, sources: slimSources() };
});

ipcMain.handle('source:test-all', async (_e, keyword, proxy, limit = 12) => {
  const pool = readSources().filter((item) => item.enabled !== false).slice(0, Math.max(1, Number(limit) || 12));
  const queue = [...pool];
  const done = [];
  const worker = async () => {
    while (queue.length) {
      const source = queue.shift();
      if (!source) break;
      const result = await runSourceTest(source, keyword, proxy);
      recordSourceStat(source.id, { ok: result.ok, count: result.count, message: result.message });
      done.push({ id: source.id, name: source.name, ...result });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { sources: slimSources(), results: done };
});

/* ---------- 书源仓库（Yiove） ---------- */

ipcMain.handle('repo:list', async (_e, payload = {}) => {
  try {
    const { listRepo } = await loadRepo();
    return await listRepo(payload);
  } catch (err) {
    return { ok: false, message: err?.message || '书源仓库读取失败', items: [], total: 0, page: 1, pages: 1, pageSize: 20 };
  }
});

ipcMain.handle('repo:import', async (_e, payload = {}) => {
  try {
    const { fetchRepoPayload } = await loadRepo();
    const { items } = await fetchRepoPayload(payload);
    const parsed = await parseSourcePayload(JSON.stringify(items));
    if (!parsed.items?.length) return { error: parsed.error || '仓库返回的内容无法识别（既不是书源也不是替换规则）', sources: slimSources() };
    const requested = items.length;
    if (parsed.kind === 'rules') {
      const res = await importRules(parsed.items);
      return { ...res, asRules: true, requested, sources: slimSources(), rules: readRules() };
    }
    const res = await importSources(parsed.items);
    return { ...res, requested, sources: slimSources() };
  } catch (err) {
    return { error: err?.message || '从书源仓库导入失败', sources: slimSources() };
  }
});

/* ---------- 云端书 ---------- */

const findSource = (sourceId) => readSources().find((item) => item.id === sourceId);

ipcMain.handle('cloud:search', async (_e, { keyword, sourceIds, page, proxy, limit } = {}) => {
  const pool = readSources().filter(
    (item) =>
      item.enabled !== false &&
      (!Array.isArray(sourceIds) || sourceIds.length === 0 || sourceIds.includes(item.id)),
  );
  if (!pool.length) return { results: [], errors: [{ sourceId: '', sourceName: '', message: '还没有启用的书源' }] };

  // 按书源健康度排序并降权/跳过：最近试搜失败的源排最后，有活源时直接跳过它们。
  const hasSearch = (source) => Boolean(source.search?.url);
  const searchable = pool.filter(hasSearch);
  const noSearch = pool.filter((source) => !hasSearch(source));
  if (!searchable.length) {
    return {
      results: [],
      errors: [{ sourceId: '', sourceName: '', message: '启用的书源里没有搜索规则' }],
      skipped: noSearch.map((source) => ({
        sourceId: source.id,
        sourceName: source.name,
        message: '该书源没有搜索规则（可能只支持发现/直链）',
      })),
    };
  }

  // 按书源健康度排序并降权/跳过：最近试搜失败的源排最后，有活源时直接跳过它们。
  const healthy = (source) => source.stat && source.stat.ok && source.stat.count > 0;
  const failed = (source) => source.stat && source.stat.ok === false;
  const rankOf = (source) => {
    if (healthy(source)) return 0;
    if (!source.stat) return 1;
    if (source.stat.ok) return 2;
    return 3;
  };
  const hasHealthy = searchable.some(healthy);
  const skipped = [
    ...noSearch.map((source) => ({
      ...source,
      stat: { ...(source.stat || {}), message: '该书源没有搜索规则（可能只支持发现/直链）' },
    })),
    ...(hasHealthy ? searchable.filter(failed) : []),
  ];
  const active = searchable
    .filter((source) => !(hasHealthy && failed(source)))
    .sort((a, b) => {
      const diff = rankOf(a) - rankOf(b);
      if (diff !== 0) return diff;
      return (b.stat?.count || 0) - (a.stat?.count || 0);
    });

  const settled = [];
  // 书源动辄上百个，一轮全搜既慢又打扰源站：默认只搜健康度最好的前 N 个。
  const cap = Number(limit) > 0 ? Math.floor(Number(limit)) : 0;
  const queue = cap ? active.slice(0, cap) : [...active];
  const planned = queue.length;
  const remaining = active.length - planned;
  const worker = async () => {
    while (queue.length) {
      const source = queue.shift();
      if (!source) break;
      try {
        const { searchSource } = await loadSources();
        const results = await searchSource(source, keyword, page || 1, { cacheRoot: dataDir, proxy });
        settled.push({ status: 'fulfilled', source, results });
      } catch (error) {
        settled.push({ status: 'rejected', source, reason: error });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const results = [];
  const errors = [];
  settled.forEach((entry) => {
    const { source } = entry;
    if (entry.status === 'fulfilled') {
      results.push(...entry.results);
      recordSourceStat(source.id, {
        // 打通但 0 条 ≠ 书源坏了：保持 ok，排序时排到「成功但空」那档
        ok: true,
        count: entry.results.length,
        message: entry.results.length
          ? `搜索「${keyword}」命中 ${entry.results.length} 条`
          : '请求成功，但没有解析到结果',
      });
    } else {
      errors.push({ sourceId: source.id, sourceName: source.name, message: entry.reason?.message || '搜索失败' });
      recordSourceStat(source.id, { ok: false, count: 0, message: entry.reason?.message || '搜索失败' });
    }
  });

  return {
    results,
    errors,
    searched: planned,
    remaining,
    skipped: skipped.map((source) => ({
      sourceId: source.id,
      sourceName: source.name,
      message: source.stat?.message || '最近一次试搜失败',
    })),
  };
});

ipcMain.handle('cloud:toc', async (_e, { sourceId, bookUrl, book, refresh, proxy } = {}) => {
  const source = findSource(sourceId);
  if (!source) return { error: '书源不存在或已删除' };

  if (!refresh) {
    const cached = cloudStore.readToc(sourceId, bookUrl);
    // 只有几章的缓存多半是当初只抓到「最新章节」：不用等用户点重试，直接重新解析一次
    const enough = Array.isArray(cached?.chapters) && cached.chapters.length >= 20;
    if (cached?.chapters?.length && enough) return { ...cached, fromCache: true };
  }

  try {
    const { fetchBookInfo, fetchToc } = await loadSources();
    // Legado 的书籍详情脚本（Pixiv 靠它拿 catalogUrl）
    let bookInfo = null;
    if (source.info?.init) {
      try {
        bookInfo = await fetchBookInfo(source, bookUrl, { cacheRoot: dataDir, proxy });
      } catch {
        bookInfo = null;
      }
    }
    const toc = await fetchToc(source, bookUrl, book || null, {
      cacheRoot: dataDir,
      proxy,
      bookInfo,
    });
    const { chapters } = toc;
    if (!chapters.length) {
      return {
        error: toc.message || '目录为空，可能是目录规则不匹配该页面',
        pages: toc.pages || [],
      };
    }
    const cleaned = await Promise.all(chapters.map(async (item) => ({ ...item, title: await cleanText(item.title, 'title') })));
    const payload = {
      chapters: cleaned,
      fetchedAt: Date.now(),
      sourceName: source.name,
      fallback: toc.fallback || null,
      info: toc.info || null,
    };
    cloudStore.writeToc(sourceId, bookUrl, payload);
    return { ...payload, fromCache: false };
  } catch (err) {
    const cached = cloudStore.readToc(sourceId, bookUrl);
    if (cached?.chapters?.length) return { ...cached, fromCache: true, warning: err.message };
    return { error: err?.message || '目录获取失败' };
  }
});

ipcMain.handle('cloud:chapter', async (_e, { sourceId, bookUrl, index, url, chapter, book, proxy } = {}) => {
  const source = findSource(sourceId);
  if (!source) return { error: '书源不存在或已删除' };

  const toc = cloudStore.readToc(sourceId, bookUrl);
  const entry = toc?.chapters?.[index] || null;
  const chapterUrl = url || entry?.url;
  if (!chapterUrl) return { error: '缺少章节地址' };

  const cached = cloudStore.readChapter(sourceId, bookUrl, index, chapterUrl);
  if (cached) return { text: await cleanText(cached, 'content'), index, fromCache: true };

  try {
    const { fetchChapter } = await loadSources();
    const { text, fallback, htmlLength } = await fetchChapter(source, chapterUrl, bookUrl, chapter || entry || null, {
      cacheRoot: dataDir,
      proxy,
    });
    if (!text) {
      const kb = Math.max(1, Math.round((htmlLength || 0) / 1024));
      return { error: `正文为空（抓取了 ${chapterUrl} 共 ${kb} KB，规则与兜底都没取到）` };
    }
    cloudStore.writeChapter(sourceId, bookUrl, index, text, chapterUrl);
    return { text: await cleanText(text, 'content'), index, fromCache: false, fallback: fallback || null };
  } catch (err) {
    return { error: err?.message || '正文获取失败' };
  }
});

ipcMain.handle('cloud:chapter-images', async (_e, { sourceId, bookUrl, index, url, chapter, book, proxy } = {}) => {
  const source = findSource(sourceId);
  if (!source) return { error: '书源不存在或已删除' };

  const toc = cloudStore.readToc(sourceId, bookUrl);
  const entry = toc?.chapters?.[index] || null;
  const chapterUrl = url || entry?.url;
  if (!chapterUrl) return { error: '缺少章节地址' };

  const cacheFile = path.join(
    dataDir,
    'cloud-images',
    `${crypto.createHash('sha1').update(`${sourceId}|${chapterUrl}`).digest('hex').slice(0, 20)}.json`,
  );
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    if (Array.isArray(cached?.urls) && cached.urls.length) return { ...cached, fromCache: true, index };
  } catch {
    /* 没有缓存或缓存坏了：重新抓 */
  }

  try {
    const { fetchPage, extractImages } = await loadSources();
    const { url: finalUrl, html } = await fetchPage(source, chapterUrl, { bookUrl }, { proxy });
    const item = chapter || entry || null;
    // 番茄等源的章节地址是 https://…/page/<bid>#<itemId>，HTTP 请求会丢掉 # 片段，
    // 但正文/图片脚本要靠它取 itemId，所以规则里的 baseUrl 保留原始章节地址。
    const ruleBaseUrl = String(chapterUrl || '').includes('#') ? chapterUrl : finalUrl;
    const urls = extractImages(html, source.content?.rule || '', finalUrl, {
      source,
      cacheRoot: dataDir,
      proxy,
      bindings: { chapter: item, title: item?.title || '', bookUrl, baseUrl: ruleBaseUrl },
    });
    if (!urls.length) return { error: '这一章没解析到图片（正文页可能不是图片，或规则取的是文字）', referer: finalUrl };
    const payload = { urls: urls.slice(0, 400), referer: finalUrl, index, total: urls.length };
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(payload), 'utf-8');
    } catch {
      /* 清单缓存失败不影响阅读 */
    }
    return payload;
  } catch (err) {
    return { error: err?.message || '图片列表获取失败' };
  }
});

ipcMain.handle('cloud:cache-stats', (_e, { sourceId, bookUrl, total } = {}) => {
  const indexes = cloudStore.cachedIndexes(sourceId, bookUrl);
  const toc = cloudStore.readToc(sourceId, bookUrl);
  return {
    cached: indexes.length,
    total: total || 0,
    indexes,
    tocChapters: toc?.chapters?.length || 0,
    tocFetchedAt: toc?.fetchedAt || 0,
  };
});

ipcMain.handle('cloud:clear-cache', (_e, { sourceId, bookUrl } = {}) => {
  cloudStore.clear(sourceId, bookUrl);
  return true;
});
