import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { create } from 'zustand';
import { friendlyError } from '../utils/friendly.js';
import { BUILTIN_THEMES, normalizeTheme } from '../themes.js';
import { useFontLoader } from '../hooks/useFontLoader.js';

/* ------------------------------------------------------------------ */
/*  Context 拆分                                                        */
/*  ------------------------------------------------------------------ */
/*  原来所有状态和 action 塞在同一个 Context 里，Reader 每滚动一次      */
/*  就调 saveProgress → setProgress → Provider 的 value 换新引用 →      */
/*  13 个 useApp() 消费点全部重渲染（书架、设置、字体面板、日志面板     */
/*  全都得跟着重画一遍）。                                                */
/*                                                                      */
/*  现在按「谁需要谁订阅」拆成多个细粒度 Context：只有真正关心某个      */
/*  切片��组件才会因为该切片变化而重渲染。progress 这种高频切片单独     */
/*  一层，Reader 滚动时只有 Reader / Bookshelf 会重渲染。                */
/* ------------------------------------------------------------------ */

/**
 * 判断「Provider 缺失」的哨兵值。
 *
 * 不能直接用 null 判断：toast 的初始值就是 null（没有提示条），
 * 用 null 当哨兵会把「正常的空 toast」误判成「不在 Provider 里」，
 * 于是 App 一启动就抛 useToast must be used inside <AppProvider>。
 */
const MISSING = Symbol('missing');

// 数据切片（books / progress / settings / …）由 zustand 管理，只有
// 「字体加载结果」留在 Context：它由 useFontLoader 的 effect 产生，必须在组件树内运行。
const AppActionsContext = createContext(MISSING);
const FontStatusContext = createContext(MISSING);

/* ------------------------------------------------------------------ */
/*  Storage adapter: Electron IPC when available, localStorage in a    */
/*  plain browser (handy for `npm run dev:vite` previews).             */
/* ------------------------------------------------------------------ */

const LS_PREFIX = 'immersive-reader:';

const browserFallback = {
  async getBooks() {
    try {
      return JSON.parse(localStorage.getItem(LS_PREFIX + 'books') || '[]');
    } catch {
      return [];
    }
  },
  async setBooks(books) {
    localStorage.setItem(LS_PREFIX + 'books', JSON.stringify(books));
  },
  async getProgress() {
    try {
      return JSON.parse(localStorage.getItem(LS_PREFIX + 'progress') || '{}');
    } catch {
      return {};
    }
  },
  async setProgress(progress) {
    localStorage.setItem(LS_PREFIX + 'progress', JSON.stringify(progress));
  },
  async getMarks() {
    try {
      return JSON.parse(localStorage.getItem(LS_PREFIX + 'marks') || '{}');
    } catch {
      return {};
    }
  },
  async setMarks(marks) {
    localStorage.setItem(LS_PREFIX + 'marks', JSON.stringify(marks));
  },
  async getSettings() {
    try {
      return JSON.parse(localStorage.getItem(LS_PREFIX + 'settings') || 'null');
    } catch {
      return null;
    }
  },
  async setSettings(settings) {
    localStorage.setItem(LS_PREFIX + 'settings', JSON.stringify(settings));
  },
  async listSources() {
    try {
      return JSON.parse(localStorage.getItem(LS_PREFIX + 'sources') || '[]');
    } catch {
      return [];
    }
  },
  async saveSources(list) {
    localStorage.setItem(LS_PREFIX + 'sources', JSON.stringify(list));
    return list;
  },
  async listRules() {
    try {
      return JSON.parse(localStorage.getItem(LS_PREFIX + 'rules') || '[]');
    } catch {
      return [];
    }
  },
  async saveRules(list) {
    localStorage.setItem(LS_PREFIX + 'rules', JSON.stringify(list));
    return list;
  },
  appInfo: async () => ({ version: __APP_VERSION__, platform: 'browser', dataDir: 'localStorage' }),
  // 浏览器预览模式没有文件系统，装不了字体
  listFonts: async () => [],
  installFonts: async () => null,
  removeFont: async () => ({ ok: false, error: '需要桌面版' }),
  clearFonts: async () => ({ ok: false, error: '需要桌面版' }),
  showFontInFolder: async () => ({ ok: false }),
  getFontCatalog: async () => ({ ok: false, source: 'none', fetchedAt: 0, fonts: [], error: '需要桌面版' }),
  installStoreFont: async () => ({ ok: false, error: '需要桌面版' }),
  onFontStoreProgress: () => () => {},
};

const NEED_ELECTRON = '书源与云端阅读需要桌面版（Electron）才能访问网络';

const api = {
  getBooks: (...args) => (window.readerAPI?.getBooks ?? browserFallback.getBooks)(...args),
  // 书架 + revision。旧主进程没有这个通道时退回 getBooks，revision 记 0。
  getBooksState: async () => {
    try {
      if (window.readerAPI?.getBooksState) {
        const state = await window.readerAPI.getBooksState();
        if (state && Array.isArray(state.books)) {
          return { books: state.books, revision: Number(state.revision) || 0 };
        }
      }
    } catch {
      /* 旧主进程 / 截图夹具没有这条通道，退回整份读取 */
    }
    const books = await api.getBooks();
    return { books: Array.isArray(books) ? books : [], revision: 0 };
  },
  setBooks: (...args) => (window.readerAPI?.setBooks ?? browserFallback.setBooks)(...args),
  getProgress: (...args) => (window.readerAPI?.getProgress ?? browserFallback.getProgress)(...args),
  setProgress: (...args) => (window.readerAPI?.setProgress ?? browserFallback.setProgress)(...args),
  getSettings: (...args) => (window.readerAPI?.getSettings ?? browserFallback.getSettings)(...args),
  setSettings: (...args) => (window.readerAPI?.setSettings ?? browserFallback.setSettings)(...args),
  getMarks: (...args) => (window.readerAPI?.getMarks ?? browserFallback.getMarks)(...args),
  setMarks: (...args) => (window.readerAPI?.setMarks ?? browserFallback.setMarks)(...args),

  // 局域网面板（只有桌面版有；浏览器预览里退化成「不可用」）
  lanStart: (config) =>
    window.readerAPI?.lanStart
      ? window.readerAPI.lanStart(config)
      : Promise.resolve({ ok: false, error: '局域网面板需要桌面版', running: false }),
  lanStop: () =>
    window.readerAPI?.lanStop ? window.readerAPI.lanStop() : Promise.resolve({ ok: true, running: false }),
  lanStatus: () =>
    window.readerAPI?.lanStatus ? window.readerAPI.lanStatus() : Promise.resolve({ running: false, urls: [] }),
  lanOpen: (url) =>
    window.readerAPI?.lanOpen ? window.readerAPI.lanOpen(url) : Promise.resolve({ ok: false }),
  // 设备管理与指令队列：只有桌面版有；浏览器预览退化成「不可用」。
  // 入队/改名/清空全部经主进程 IPC，渲染层不直连 LAN HTTP。
  devices: {
    list: () =>
      window.readerAPI?.devices?.list
        ? window.readerAPI.devices.list()
        : Promise.resolve({ ok: false, devices: [], error: '需要桌面版' }),
    rename: (payload) =>
      window.readerAPI?.devices?.rename
        ? window.readerAPI.devices.rename(payload)
        : Promise.resolve({ ok: false, error: '需要桌面版' }),
    remove: (payload) =>
      window.readerAPI?.devices?.remove
        ? window.readerAPI.devices.remove(payload)
        : Promise.resolve({ ok: false, error: '需要桌面版' }),
    enqueue: (payload) =>
      window.readerAPI?.devices?.enqueue
        ? window.readerAPI.devices.enqueue(payload)
        : Promise.resolve({ ok: false, error: '需要桌面版' }),
    cancel: (payload) =>
      window.readerAPI?.devices?.cancel
        ? window.readerAPI.devices.cancel(payload)
        : Promise.resolve({ ok: false, error: '需要桌面版' }),
    clear: (payload) =>
      window.readerAPI?.devices?.clear
        ? window.readerAPI.devices.clear(payload)
        : Promise.resolve({ ok: false, error: '需要桌面版' }),
    retry: (payload) =>
      window.readerAPI?.devices?.retry
        ? window.readerAPI.devices.retry(payload)
        : Promise.resolve({ ok: false, error: '需要桌面版' }),
  },
  pickBook: () => window.readerAPI?.pickBook?.(),
  // 正文存成 books/ 下的副本，书架 json 只留元数据
  addBookContent: async (payload) => {
    if (window.readerAPI?.addBookContent) return window.readerAPI.addBookContent(payload);
    // 浏览器预览没有磁盘目录，退化成把正文带在元数据里
    return { ...payload, filePath: null };
  },
  readBookText: async (filePath) => {
    if (window.readerAPI?.readBookText) return window.readerAPI.readBookText(filePath);
    const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'books') || '[]');
    const hit = list.find((b) => b.filePath === filePath);
    return hit ? { content: hit.content || '' } : { error: '浏览器预览模式下读不到文件' };
  },
  // EPUB / PDF：只问大小与格式，正文由阅读器按范围分段取（浏览器预览没有磁盘副本）
  statBookBinary: async (filePath) => {
    if (window.readerAPI?.statBookBinary) return window.readerAPI.statBookBinary(filePath);
    return { error: '浏览器预览模式下读不到电子书文件' };
  },
  readBookRange: async (filePath, offset, length) => {
    if (window.readerAPI?.readBookRange) {
      return window.readerAPI.readBookRange(filePath, offset, length);
    }
    return { error: '浏览器预览模式下读不到电子书文件' };
  },
  addBookBinary: async (payload) => {
    if (window.readerAPI?.addBookBinary) return window.readerAPI.addBookBinary(payload);
    return { error: '需要桌面版' };
  },
  deleteBookFile: (filePath) => window.readerAPI?.deleteBookFile?.(filePath) ?? Promise.resolve({ ok: false }),
  cacheCover: async (payload) => {
    if (window.readerAPI?.cacheCover) return window.readerAPI.cacheCover(payload);
    // 浏览器预览：直接回远端地址，交给 <img> 自己加载
    return payload?.url ? { url: payload.url, cached: false } : null;
  },
  cacheCovers: async (payload) => {
    if (window.readerAPI?.cacheCovers) return window.readerAPI.cacheCovers(payload);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const covers = {};
    for (const item of items) if (item?.url) covers[item.id || item.url] = item.url;
    return { covers };
  },
  clearCoverCache: () => window.readerAPI?.clearCoverCache?.() ?? Promise.resolve({ ok: false }),
  appInfo: () => (window.readerAPI?.appInfo ?? browserFallback.appInfo)(),

  // 字体
  listFonts: async () => {
    // 旧版本主进程没有 font:list 通道，invoke 会 reject，这里兜成空列表
    if (window.readerAPI?.listFonts) {
      try {
        return await window.readerAPI.listFonts();
      } catch {
        return [];
      }
    }
    return browserFallback.listFonts();
  },
  installFonts: async () => {
    if (!window.readerAPI?.installFonts) return browserFallback.installFonts();
    try {
      return await window.readerAPI.installFonts();
    } catch (err) {
      return { ok: false, error: err?.message || '安装失败' };
    }
  },
  removeFont: async (id) => {
    if (!window.readerAPI?.removeFont) return browserFallback.removeFont(id);
    try {
      return await window.readerAPI.removeFont(id);
    } catch (err) {
      return { ok: false, error: err?.message || '删除失败' };
    }
  },
  clearFonts: async () => {
    if (!window.readerAPI?.clearFonts) return browserFallback.clearFonts();
    try {
      return await window.readerAPI.clearFonts();
    } catch (err) {
      return { ok: false, error: err?.message || '清空失败' };
    }
  },
  showFontInFolder: async (id) => {
    if (!window.readerAPI?.showFontInFolder) return browserFallback.showFontInFolder(id);
    try {
      return await window.readerAPI.showFontInFolder(id);
    } catch {
      return { ok: false };
    }
  },

  // 字体商店
  getFontCatalog: async (force = false) => {
    if (!window.readerAPI?.getFontCatalog) return browserFallback.getFontCatalog();
    try {
      return await window.readerAPI.getFontCatalog(force);
    } catch (err) {
      return { ok: false, source: 'none', fetchedAt: 0, fonts: [], error: err?.message || '目录获取失败' };
    }
  },
  installStoreFont: async (id) => {
    if (!window.readerAPI?.installStoreFont) return browserFallback.installStoreFont();
    try {
      return await window.readerAPI.installStoreFont(id);
    } catch (err) {
      return { ok: false, error: err?.message || '安装失败' };
    }
  },
  onFontStoreProgress: (callback) =>
    window.readerAPI?.onFontStoreProgress ? window.readerAPI.onFontStoreProgress(callback) : () => {},

  listSources: (...args) => (window.readerAPI?.listSources ?? browserFallback.listSources)(...args),
  saveSources: (...args) => (window.readerAPI?.saveSources ?? browserFallback.saveSources)(...args),
  setSourcesEnabled: async (ids, enabled) => {
    if (window.readerAPI?.setSourcesEnabled) return window.readerAPI.setSourcesEnabled(ids, enabled);
    const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'sources') || '[]');
    const wanted = new Set(ids);
    const next = list.map((item) => (wanted.has(item.id) ? { ...item, enabled } : item));
    await browserFallback.saveSources(next);
    return next;
  },
  removeSources: async (ids) => {
    if (window.readerAPI?.removeSources) return window.readerAPI.removeSources(ids);
    const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'sources') || '[]');
    const wanted = new Set(ids);
    const next = list.filter((item) => !wanted.has(item.id));
    await browserFallback.saveSources(next);
    return next;
  },
  importSourcesText: async (payload) => {
    if (!window.readerAPI?.importSourcesText) throw new Error(NEED_ELECTRON);
    return window.readerAPI.importSourcesText(payload);
  },
  importSourcesFile: async () => {
    if (!window.readerAPI?.importSourcesFile) throw new Error(NEED_ELECTRON);
    return window.readerAPI.importSourcesFile();
  },
  importSourcesUrl: async (url) => {
    if (!window.readerAPI?.importSourcesUrl) throw new Error(NEED_ELECTRON);
    return window.readerAPI.importSourcesUrl(url);
  },
  testSource: async (sourceId, keyword, proxy) => {
    if (!window.readerAPI?.testSource) throw new Error(NEED_ELECTRON);
    return window.readerAPI.testSource(sourceId, keyword, proxy);
  },
  testAllSources: async (keyword, proxy, limit) => {
    if (!window.readerAPI?.testAllSources) throw new Error(NEED_ELECTRON);
    return window.readerAPI.testAllSources(keyword, proxy, limit);
  },
  listRepo: async (payload) => {
    if (!window.readerAPI?.listRepo) throw new Error(NEED_ELECTRON);
    return window.readerAPI.listRepo(payload);
  },
  importRepo: async (payload) => {
    if (!window.readerAPI?.importRepo) throw new Error(NEED_ELECTRON);
    return window.readerAPI.importRepo(payload);
  },
  searchCloud: async (payload) => {
    if (!window.readerAPI?.searchCloud) throw new Error(NEED_ELECTRON);
    return window.readerAPI.searchCloud(payload);
  },
  fetchCloudToc: async (payload) => {
    if (!window.readerAPI?.fetchCloudToc) throw new Error(NEED_ELECTRON);
    return window.readerAPI.fetchCloudToc(payload);
  },
  fetchCloudChapter: async (payload) => {
    if (!window.readerAPI?.fetchCloudChapter) throw new Error(NEED_ELECTRON);
    return window.readerAPI.fetchCloudChapter(payload);
  },
  fetchChapterImages: async (payload) => {
    if (!window.readerAPI?.fetchChapterImages) throw new Error(NEED_ELECTRON);
    return window.readerAPI.fetchChapterImages(payload);
  },
  /** 并发下载整章图片：主进程边下边通过 onImageProgress 推回本地地址。 */
  prefetchImages: async (payload) => {
    if (!window.readerAPI?.prefetchImages) return null;
    return window.readerAPI.prefetchImages(payload);
  },
  cancelImagePrefetch: async (key) => {
    if (!window.readerAPI?.cancelImagePrefetch) return false;
    return window.readerAPI.cancelImagePrefetch(key);
  },
  onImageProgress: (callback) => {
    if (!window.readerAPI?.onImageProgress) return () => {};
    return window.readerAPI.onImageProgress(callback);
  },
  /** 本地漫画：总页数由主进程读 CBZ 目录得出，单页走 folio-comic:// 协议。 */
  localComicPages: async (bookId) => {
    if (!window.readerAPI?.localComicPages) return { ok: false, error: NEED_ELECTRON };
    return window.readerAPI.localComicPages(bookId);
  },

  cloudCacheStats: async (payload) => {
    if (!window.readerAPI?.cloudCacheStats) return { cached: 0, total: 0 };
    return window.readerAPI.cloudCacheStats(payload);
  },
  clearCloudCache: async (payload) => {
    if (!window.readerAPI?.clearCloudCache) return false;
    return window.readerAPI.clearCloudCache(payload);
  },

  listRules: (...args) => (window.readerAPI?.listRules ?? browserFallback.listRules)(...args),
  saveRules: (...args) => (window.readerAPI?.saveRules ?? browserFallback.saveRules)(...args),
  importRulesText: async (payload) => {
    if (!window.readerAPI?.importRulesText) throw new Error(NEED_ELECTRON);
    return window.readerAPI.importRulesText(payload);
  },
  importRulesFile: async () => {
    if (!window.readerAPI?.importRulesFile) throw new Error(NEED_ELECTRON);
    return window.readerAPI.importRulesFile();
  },
  removeRule: async (id) => {
    if (!window.readerAPI?.removeRule) throw new Error(NEED_ELECTRON);
    return window.readerAPI.removeRule(id);
  },
  clearRules: async () => {
    if (!window.readerAPI?.clearRules) throw new Error(NEED_ELECTRON);
    return window.readerAPI.clearRules();
  },

  // 日志（调试）
  logTail: async (payload) => {
    if (!window.readerAPI?.logTail) return [];
    return window.readerAPI.logTail(payload);
  },
  logInfo: async () => {
    if (!window.readerAPI?.logInfo) return { dir: '', level: 'info', files: [], size: 0 };
    return window.readerAPI.logInfo();
  },
  logLevel: async (name) => {
    if (!window.readerAPI?.logLevel) return 'info';
    return window.readerAPI.logLevel(name);
  },
  logClear: async () => {
    if (!window.readerAPI?.logClear) return { ok: false };
    return window.readerAPI.logClear();
  },
  logOpen: async () => {
    if (!window.readerAPI?.logOpen) return { ok: false, error: '需要桌面版' };
    return window.readerAPI.logOpen();
  },
  logExport: async () => {
    if (!window.readerAPI?.logExport) return { ok: false, error: '需要桌面版' };
    return window.readerAPI.logExport();
  },
  logFromRenderer: (payload) => {
    if (!window.readerAPI?.logFromRenderer) return;
    window.readerAPI.logFromRenderer(payload).catch(() => {});
  },
};

export const DEFAULT_SETTINGS = {
  theme: 'paper', // 内置主题 id，或 customThemes 里的自定义主题 id
  customThemes: [], // 用户自定义主题（{id,label,tone,tokens}）
  fontSize: 18,
  lineHeight: 1.85,
  fontFamily: 'sans', // sans | serif | mono
  userFont: '', // 用户安装的字体 id（见 useFontLoader），空 = 不使用
  pageWidth: 700,
  paragraphSpacing: 1,
  chapterRegex: '', // '' = auto preset
  indent: false,
  showProgress: true,  autoHideUI: true,
  reduceMotion: false, // 减少动效（也遵循系统「减少动态效果」）
  macosFrame: true, // macOS 风格边框：Windows 上自绘红黄绿交通灯并去掉原生标题栏
  comicFit: 'width', // width | original，漫画默认适应宽度
  proxy: '', // 书源抓取用的 HTTP 代理，如 http://127.0.0.1:7890
  // 局域网面板：同一 Wi-Fi 下的手机/平板可以看书架和进度，并写回阅读位置
  lan: {
    enabled: false,
    port: 7788,
    token: '', // 空 = 首次开启时生成；由渲染层生成并落盘
    allowWrite: true, // 关掉就变成纯只读面板
  },
};

const THEME_NAMES = ['paper', 'sepia', 'night', 'forest'];

const normalizeCustomThemes = (list) =>
  (Array.isArray(list) ? list : []).map((item) => normalizeTheme(item)).filter(Boolean);

function debounce(fn, wait) {
  let timer = null;
  let pending = null;
  const wrapped = (...args) => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const call = pending;
      pending = null;
      if (call) fn(...call);
    }, wait);
  };
  // 退出/切后台时把还没发出去的写入立刻发出去
  wrapped.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    const call = pending;
    pending = null;
    if (call) fn(...call);
  };
  return wrapped;
}

/**
 * 把渲染层的本地意图重放到主进程的最新书架上。
 *
 * base     = 上一次与主进程对齐过的快照（磁盘上确实是这一份）
 * local    = 渲染层当前列表（base + 用户还没落盘的改动）
 * incoming = 主进程现在的权威列表（可能刚被手机加过书）
 *
 * 规则：本地动过的书以本地为准（改标签不被远端旧值覆盖），本地没动过的书
 * 以 incoming 为准（手机补的 contentHash / filePath 能落下来）；本地删掉的书
 * 跟随删除，远端新增的书放到最前（书架本来就是新书在前）。
 */
function rebaseBooks(base, local, incoming) {
  const baseList = Array.isArray(base) ? base : [];
  const localList = Array.isArray(local) ? local : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const idOf = (book) => (book && book.id != null ? String(book.id) : '');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const index = (list) => {
    const map = new Map();
    for (const book of list) {
      const id = idOf(book);
      if (id) map.set(id, book);
    }
    return map;
  };
  const baseById = index(baseList);
  const localById = index(localList);
  const incomingById = index(incomingList);

  const result = [];
  // 远端新增（本地既没有 base 记录、也没自己加过）：新书在前；没有 id 的脏条目原样保留
  for (const book of incomingList) {
    const id = idOf(book);
    if (!id) {
      result.push(book);
      continue;
    }
    if (!baseById.has(id) && !localById.has(id)) result.push(book);
  }

  for (const book of localList) {
    const id = idOf(book);
    if (!id) {
      result.push(book);
      continue;
    }
    const inBase = baseById.has(id);
    const localChanged = !inBase || !same(baseById.get(id), book);
    if (!localChanged) {
      // 本地没动过：以主进程为准；主进程删了它（incoming 没有）就跟随删除
      if (incomingById.has(id)) result.push(incomingById.get(id));
      continue;
    }
    // 本地新增 / 修改：保留本地版本；即便远端删了，也不让用户的改动凭空消失
    result.push(book);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  数据切片（zustand）                                                 */
/*  ------------------------------------------------------------------ */
/*  每个 hook 只订阅自己需要的那一片；setX 同时支持「直接给值」和       */
/*  「给一个 updater」两种写法，和原来的 useState 行为一致。            */
/* ------------------------------------------------------------------ */

const resolveNext = (value, prev) => (typeof value === 'function' ? value(prev) : value);

const useAppStore = create((set) => {
  const slice = (key) => (value) => set((state) => ({ [key]: resolveNext(value, state[key]) }));
  return {
    books: [],
    devices: [],
    progress: {},
    settings: DEFAULT_SETTINGS,
    marks: {},
    sources: [],
    rules: [],
    fonts: [],
    loaded: false,
    toast: null,
    setBooks: slice('books'),
    setDevices: slice('devices'),
    setProgress: slice('progress'),
    setSettings: slice('settings'),
    setMarks: slice('marks'),
    setSources: slice('sources'),
    setRules: slice('rules'),
    setFonts: slice('fonts'),
    setLoaded: slice('loaded'),
    setToast: slice('toast'),
  };
});

// zustand 的 setX 引用恒定；放在模块作用域，回调里用它们不会触发 exhaustive-deps 告警。
const {
  setBooks,
  setDevices,
  setProgress,
  setSettings,
  setMarks,
  setSources,
  setRules,
  setFonts,
  setLoaded,
  setToast,
} = useAppStore.getState();

export function AppProvider({ children }) {
  const books = useAppStore((state) => state.books);
  const progress = useAppStore((state) => state.progress);
  const settings = useAppStore((state) => state.settings);
  const marks = useAppStore((state) => state.marks);
  const rules = useAppStore((state) => state.rules);
  const fonts = useAppStore((state) => state.fonts);
  const loaded = useAppStore((state) => state.loaded);

  const booksRef = useRef(books);
  const progressRef = useRef(progress);
  const settingsRef = useRef(settings);
  // 与主进程对齐过的书架快照 + 当时的 revision：整份保存时回传，用来发现「手机刚改过」。
  const booksBaseRef = useRef([]);
  const booksRevisionRef = useRef(0);
  // notify 在下面才定义，保存逻辑要提示「已刷新」时通过 ref 取最新实现
  const notifyRef = useRef(() => {});

  booksRef.current = books;
  progressRef.current = progress;
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 各项独立容错：早期用 Promise.all，任何一项失败（比如新加的 font:list
      // 在旧版本主进程里没注册）就会让整批数据都读不到 —— 用户会看到空书架、
      // 设置全部回退默认值。现在每项自己兜底，互不影响。
      const safe = async (fn, fallback) => {
        try {
          return await fn();
        } catch (err) {
          console.warn('load failed', err);
          return fallback;
        }
      };

      const [
        storedBooksState,
        storedProgress,
        storedMarks,
        storedSettings,
        storedSources,
        storedRules,
        storedFonts,
      ] = await Promise.all([
        safe(api.getBooksState, { books: [], revision: 0 }),
        safe(api.getProgress, {}),
        safe(api.getMarks, {}),
        safe(api.getSettings, null),
        safe(api.listSources, []),
        safe(api.listRules, []),
        safe(api.listFonts, []),
      ]);
      if (cancelled) return;
      const storedBooks = Array.isArray(storedBooksState?.books) ? storedBooksState.books : [];
      // 读盘期间若已经收到更新的局域网广播，别用更旧的快照盖回去
      const storedRevision = Number(storedBooksState?.revision) || 0;
      if (storedRevision >= booksRevisionRef.current) {
        booksBaseRef.current = storedBooks;
        booksRevisionRef.current = storedRevision;
        setBooks(storedBooks);
      }
      setProgress(storedProgress && typeof storedProgress === 'object' ? storedProgress : {});
      setMarks(storedMarks && typeof storedMarks === 'object' ? storedMarks : {});
      setSettings({ ...DEFAULT_SETTINGS, ...(storedSettings || {}) });
      setSources(Array.isArray(storedSources) ? storedSources : []);
      setRules(Array.isArray(storedRules) ? storedRules : []);
      setFonts(Array.isArray(storedFonts) ? storedFonts : []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 整份保存书架。带上一次对齐的 revision：
   * - 主进程接受 → 记住新 revision；
   * - 主进程说过期 → 基于最新列表重放本地意图，再写一次（最多 3 轮）；
   *   仍然失败就提示并刷新，绝不静默丢改动。
   */
  async function saveBooksSnapshot() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const value = booksRef.current;
      let result;
      try {
        result = await api.setBooks(value, booksRevisionRef.current);
      } catch {
        // 主进程正在退出 / 通道不可用：等下一次防抖再试
        return;
      }
      if (!result || result.ok !== false) {
        // 旧主进程返回 undefined 或 {ok:true}，没有 revision 就保持原值
        const revision = Number(result?.revision);
        if (Number.isFinite(revision)) {
          if (revision < booksRevisionRef.current) return; // 已被更新的广播超越
          booksRevisionRef.current = revision;
        }
        booksBaseRef.current = value;
        return;
      }
      if (!result.stale || !Array.isArray(result.books)) {
        notifyRef.current?.(result.error || '书架保存失败', 'error');
        return;
      }
      const revision = Number(result.revision);
      if (Number.isFinite(revision) && revision < booksRevisionRef.current) return;
      // 主进程的最新列表 + 本地意图：本地改过的书以本地为准，远端新增的书保留
      const merged = rebaseBooks(booksBaseRef.current, booksRef.current, result.books);
      if (Number.isFinite(revision)) booksRevisionRef.current = revision;
      booksBaseRef.current = result.books;
      if (JSON.stringify(merged) === JSON.stringify(booksRef.current)) continue;
      // 状态一变，下一轮防抖会带着刚拿到的 revision 再保存一次
      setBooks(merged);
      return;
    }
    notifyRef.current?.('书架刚被其他设备改过，已刷新', 'info');
    setBooks(booksBaseRef.current);
  }

  // Debounced persistence
  // 「移出书架」后保留 10 秒删除窗口，期间点「撤销」可以原样找回（含本地正文与云端缓存）
  const pendingDeletes = useRef(new Map());
  const persistBooks = useRef(debounce(() => saveBooksSnapshot(), 400)).current;
  const persistProgress = useRef(debounce((value) => api.setProgress(value), 300)).current;
  const persistMarks = useRef(debounce((value) => api.setMarks(value), 300)).current;
  const persistSettings = useRef(debounce((value) => api.setSettings(value), 300)).current;

  useEffect(() => {
    if (loaded) persistBooks(books);
  }, [books, loaded, persistBooks]);
  useEffect(() => {
    if (loaded) persistProgress(progress);
  }, [progress, loaded, persistProgress]);
  useEffect(() => {
    if (loaded) persistMarks(marks);
  }, [marks, loaded, persistMarks]);
  useEffect(() => {
    if (loaded) persistSettings(settings);
  }, [settings, loaded, persistSettings]);

  // 主进程兜底生成的访问码（老设置里没有这个字段时会发生）。
  // 收到就落进 settings，让它成为唯一真相 —— 否则下次启动又会换一张码，
  // 已经连上的手机全被踢下线。
  useEffect(() => {
    const off = window.readerAPI?.onLanToken?.((payload) => {
      const token = String(payload?.token || '');
      if (!token) return;
      setSettings((prev) => {
        const lan = prev.lan || {};
        if (lan.token === token) return prev;
        return { ...prev, lan: { ...lan, token } };
      });
    });
    return () => {
      try {
        off?.();
      } catch {
        /* 窗口正在销毁 */
      }
    };
  }, []);

  // 关窗/切到后台时把防抖里还没落盘的书架、进度、设置冲刷掉
  useEffect(() => {
    const flushAll = () => {
      persistBooks.flush();
      persistProgress.flush();
      persistMarks.flush();
      persistSettings.flush();
    };
    window.addEventListener('pagehide', flushAll);
    window.addEventListener('beforeunload', flushAll);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAll();
    });
    return () => {
      window.removeEventListener('pagehide', flushAll);
      window.removeEventListener('beforeunload', flushAll);
      flushAll();
    };
  }, [persistBooks, persistProgress, persistMarks, persistSettings]);

  // 局域网面板（手机）写回来的进度。
  // 规则和主进程一致：updatedAt 新的一方赢，字段做浅合并；
  // 合并结果与内存里完全一样时不动 state —— 否则正在读的桌面端会白重渲染一次。
  useEffect(() => {
    const off = window.readerAPI?.onLanProgress?.((payload) => {
      const incoming = payload?.progress;
      if (!incoming || typeof incoming !== 'object') return;
      setProgress((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, entry] of Object.entries(incoming)) {
          if (!entry || typeof entry !== 'object') continue;
          const old = prev[id];
          if (!old) {
            next[id] = entry;
            changed = true;
            continue;
          }
          const newer = (Number(entry.updatedAt) || 0) >= (Number(old.updatedAt) || 0);
          const merged = newer ? { ...old, ...entry } : old;
          if (JSON.stringify(merged) !== JSON.stringify(old)) {
            next[id] = merged;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      try {
        off?.();
      } catch {
        /* 窗口正在销毁时 removeListener 可能抛错 */
      }
    };
  }, []);

  // 手机写回书签 / 划线 / 笔记：主进程已经合并落盘，这里只换掉那一本书。
  // 不整份替换：别的书在桌面端可能还有防抖里没落盘的改动。
  useEffect(() => {
    const off = window.readerAPI?.onLanMarks?.((payload) => {
      const incoming = payload?.marks;
      const bookId = String(payload?.bookId || '');
      if (!incoming || typeof incoming !== 'object' || !bookId) return;
      const list = incoming[bookId];
      if (!Array.isArray(list)) return;
      setMarks((prev) => {
        if (JSON.stringify(prev[bookId] || []) === JSON.stringify(list)) return prev;
        return { ...prev, [bookId]: list };
      });
    });
    return () => {
      try {
        off?.();
      } catch {
        /* 窗口正在销毁时 removeListener 可能抛错 */
      }
    };
  }, []);

  // 主进程的 books 权威副本变了（手机上传增书）：事件带整份列表与 revision，
  // 这里按「本地没落盘的改动优先」合并，手机刚加的书与桌面端刚改的标签都不会被抹掉。
  // 旧主进程只会推 lan:books（只有 id），退回 api.getBooks() 读一遍再走同一套合并。
  useEffect(() => {
    let cancelled = false;
    const apply = (payload) => {
      const hasState =
        payload && Array.isArray(payload.books) && Number.isFinite(Number(payload.revision));
      if (hasState && Number(payload.revision) <= booksRevisionRef.current) return;
      const load = hasState
        ? Promise.resolve({ books: payload.books, revision: Number(payload.revision) })
        : Promise.resolve(api.getBooks()).then((stored) => ({
            books: Array.isArray(stored) ? stored : [],
            revision: booksRevisionRef.current,
          }));
      load
        .then((next) => {
          if (cancelled || !next) return;
          const current = booksRef.current;
          const merged = rebaseBooks(booksBaseRef.current, current, next.books);
          booksBaseRef.current = next.books;
          if (hasState) booksRevisionRef.current = next.revision;
          if (JSON.stringify(merged) !== JSON.stringify(current)) setBooks(merged);
        })
        .catch(() => {
          /* 读失败就等下一次事件，不打断正在进行的操作 */
        });
    };
    const subscribe = window.readerAPI?.onBooksChanged || window.readerAPI?.onLanBooks;
    const off = subscribe?.((payload) => apply(payload));
    return () => {
      cancelled = true;
      try {
        off?.();
      } catch {
        /* 窗口正在销毁时 removeListener 可能抛错 */
      }
    };
  }, []);

  // 设备列表：IPC 的读接口，所有 action 完成后也复用它刷新。
  const refreshDevices = useCallback(async () => {
    const result = await api.devices.list();
    if (result?.ok && Array.isArray(result.devices)) setDevices(result.devices);
    return result;
  }, []);

  // 设备在线/离线（lan:device）与队列变化（lan:command）都重拉一次；
  // 和 onLanBooks 一样，cleanup 必须摘监听，否则热更新会叠加。
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.devices
        .list()
        .then((result) => {
          if (cancelled || !result?.ok || !Array.isArray(result.devices)) return;
          setDevices(result.devices);
        })
        .catch(() => {
          /* 主进程还没注册 devices:list（旧版本）时静默忽略 */
        });
    };
    load();
    const offDevice = window.readerAPI?.onLanDevice?.(load);
    const offCommand = window.readerAPI?.onLanCommand?.(load);
    return () => {
      cancelled = true;
      try {
        offDevice?.();
      } catch {
        /* 窗口正在销毁 */
      }
      try {
        offCommand?.();
      } catch {
        /* 窗口正在销毁 */
      }
    };
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);
  const notify = useCallback((message, tone = 'info', options = {}) => {
    const id = Math.random().toString(36).slice(2);
    const text = tone === 'error' ? friendlyError(message) : message;
    const duration = options.duration || (tone === 'error' ? 4600 : 2600);
    setToast({ id, message: text, tone, action: options.action || null });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), duration);
  }, []);
  // 保存逻辑可能在 notify 定义前就挂上（防抖首次渲染），这里接上最新实现
  notifyRef.current = notify;

  const addBook = useCallback(
    (book) => {
      if (!book || book.error) {
        notify(book?.error || '导入失败', 'error');
        return null;
      }
      const entry = {
        id: book.id,
        kind: book.kind || 'local',
        name: book.name || '未命名',
        filePath: book.filePath || null,
        sourcePath: book.sourcePath || null,
        size: book.size || book.content?.length || 0,
        addedAt: book.addedAt || Date.now(),
        hue: Math.floor(Math.random() * 360),
      };
      // 电子书格式：缺省视为纯文本，旧数据/旧端读到未知字段会忽略
      if (book.format === 'epub' || book.format === 'pdf' || book.format === 'cbz') {
        entry.format = book.format;
      }
      // 本地漫画：type 2 与云端漫画同口径，打开时才会进 ComicReader
      if (book.format === 'cbz') entry.type = 2;
      // 有磁盘副本时不再把正文塞进 books.json（浏览器预览没有副本才内联）
      if (!entry.filePath) entry.content = book.content || '';
      setBooks((prev) => {
        const exists = prev.find((b) => b.id === entry.id || (b.filePath && b.filePath === entry.filePath));
        if (exists) return prev;
        return [entry, ...prev];
      });
      notify(`已加入书架《${entry.name}》`);
      return entry;
    },
    [notify]
  );

  /* ---------------- 云端（书源）---------------- */

  const addCloudBook = useCallback(
    (item) => {
      if (!item?.bookUrl) {
        notify('这个搜索结果缺少书籍地址', 'error');
        return null;
      }
      const id = `cloud::${item.sourceId}::${item.bookUrl}`;
      const exists = booksRef.current.find((b) => b.id === id);
      if (exists) {
        notify(`《${exists.name}》已经在书架上了`);
        return exists;
      }
      const entry = {
        id,
        kind: 'cloud',
        name: item.name || '未命名',
        author: item.author || '',
        cover: item.cover || '',
        sourceId: item.sourceId,
        sourceName: item.sourceName || '',
        bookUrl: item.bookUrl,
        intro: item.intro || '',
        // 书源类型：2 = 图片（漫画），决定用哪个阅读器
        type: item.type || 0,
        typeLabel: item.typeLabel || '',
        raw: item.raw || null,
        content: '',
        addedAt: Date.now(),
        hue: Math.floor(Math.random() * 360),
      };
      setBooks((prev) => [entry, ...prev]);
      notify(`已加入书架《${entry.name}》· ${entry.sourceName}`);
      return entry;
    },
    [notify]
  );

  const applyImport = useCallback((result) => {
    if (result?.sources) setSources(result.sources);
    if (result?.asRules && result?.rules) setRules(result.rules);
    return result;
  }, []);

  const importSources = useCallback(
    async (payload) => applyImport(await api.importSourcesText(payload)),
    [applyImport]
  );

  const importSourcesFromFile = useCallback(
    async () => applyImport(await api.importSourcesFile()),
    [applyImport]
  );

  const importSourcesFromUrl = useCallback(
    async (url) => applyImport(await api.importSourcesUrl(url)),
    [applyImport]
  );

  /**
   * 启用/停用只改本地状态 + 按 id 通知主进程（列表里是瘦身后的对象，
   * 整表写回会把 jsLib / 规则内容抹掉）。
   */
  const toggleSource = useCallback(async (id, enabled) => {
    setSources((prev) => prev.map((item) => (item.id === id ? { ...item, enabled } : item)));
    const next = await api.setSourcesEnabled([id], enabled);
    if (Array.isArray(next)) setSources(next);
  }, []);

  const removeSource = useCallback(async (id) => {
    setSources((prev) => prev.filter((item) => item.id !== id));
    const next = await api.removeSources([id]);
    if (Array.isArray(next)) setSources(next);
  }, []);

  /** 试搜一个书源：结果会带回更新后的书源列表（含健康度 stat）。 */
  const testSource = useCallback(async (id, keyword = '的') => {
    // 代理读 ref 而不是闭包捕获 settings：这样回调本身可以永远保持同一个引用，
    // actions 这个 Context 的 value 永远不变，只关心 action 的组件就不会被
    // 任何状态变化带着重渲染。
    const res = await api.testSource(id, keyword, settingsRef.current.proxy || '');
    if (res?.sources) setSources(res.sources);
    return res;
  }, []);

  /** 批量试搜（并发 3），用于给书源排序、找出还活着的源。 */
  const testAllSources = useCallback(async (keyword = '的', limit = 12) => {
    const res = await api.testAllSources(keyword, settingsRef.current.proxy || '', limit);
    if (res?.sources) setSources(res.sources);
    return res;
  }, []);

  /** 书源仓库：分页/搜索列表（不落盘，纯读取）。 */
  const listRepo = useCallback(async (payload) => api.listRepo(payload), []);

  /** 书源仓库：一键导入单条 / 序号区间 / 整个合集。 */
  const importRepo = useCallback(async (payload) => {
    const res = await api.importRepo(payload);
    if (res?.sources) setSources(res.sources);
    if (res?.asRules && res?.rules) setRules(res.rules);
    return res;
  }, []);

  /** 批量启用/停用。 */
  const setSourcesEnabled = useCallback(async (ids, enabled) => {
    const wanted = new Set(ids);
    setSources((prev) => prev.map((item) => (wanted.has(item.id) ? { ...item, enabled } : item)));
    const next = await api.setSourcesEnabled(ids, enabled);
    if (Array.isArray(next)) setSources(next);
    return next;
  }, []);

  /** 批量删除。 */
  const removeSources = useCallback(async (ids) => {
    const wanted = new Set(ids);
    setSources((prev) => prev.filter((item) => !wanted.has(item.id)));
    const next = await api.removeSources(ids);
    if (Array.isArray(next)) setSources(next);
    return next;
  }, []);

  /* ---------- 净化规则 ---------- */

  const importRulesText = useCallback(async (payload) => {
    const result = await api.importRulesText(payload);
    if (result?.rules) setRules(result.rules);
    return result;
  }, []);

  const importRulesFromFile = useCallback(async () => {
    const result = await api.importRulesFile();
    if (result?.rules) setRules(result.rules);
    return result;
  }, []);

  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const toggleRule = useCallback(async (id, enabled) => {
    // 不要在 setState 的 updater 里算 next 再保存：React 批处理时 updater 还没执行，
    // 拿到的 next 是空数组，会把规则整表写成 [] 并清掉备份。
    const next = rulesRef.current.map((item) => (item.id === id ? { ...item, enabled } : item));
    rulesRef.current = next;
    setRules(next);
    await api.saveRules(next);
  }, []);

  const removeRule = useCallback(async (id) => {
    const next = await api.removeRule(id);
    setRules(Array.isArray(next) ? next : []);
  }, []);

  const clearRules = useCallback(async () => {
    const next = await api.clearRules();
    setRules(Array.isArray(next) ? next : []);
  }, []);

  const addBookFromPicker = useCallback(async () => {
    if (!window.readerAPI?.pickBook) {
      notify('文件选择功能需要在 Electron 窗口中运行', 'error');
      return null;
    }
    const result = await window.readerAPI.pickBook();
    if (!result) return null;
    if (result.error) {
      notify(result.error, 'error');
      return null;
    }
    // 多选时主进程回 { books, errors }
    if (Array.isArray(result.books)) {
      let first = null;
      result.books.forEach((item) => {
        const added = addBook(item);
        if (!first) first = added;
      });
      result.errors?.forEach((message) => notify(message, 'error'));
      return first;
    }
    return addBook(result);
  }, [addBook, notify]);

  /** 拖拽 / 示例书：正文先写到 books/ 副本，再进书架 */
  const addBookFromText = useCallback(
    async ({ id, name, content }) => {
      try {
        const meta = await api.addBookContent({ id, name, content });
        if (!meta || meta.error) {
          notify(meta?.error || '这本书保存失败', 'error');
          return null;
        }
        return addBook(meta);
      } catch (err) {
        notify(`保存《${name}》失败：${err.message}`, 'error');
        return null;
      }
    },
    [addBook, notify]
  );

  /** 拖拽 EPUB / PDF：二进制直接写进 books/ 副本，再进书架 */
  const addBookFromBinary = useCallback(
    async ({ name, data }) => {
      try {
        const meta = await api.addBookBinary({ name, data });
        if (!meta || meta.error) {
          notify(meta?.error || '这本书保存失败', 'error');
          return null;
        }
        return addBook(meta);
      } catch (err) {
        notify(`保存《${name}》失败：${err.message}`, 'error');
        return null;
      }
    },
    [addBook, notify]
  );

  const removeBook = useCallback((id) => {
    // 副作用不能写在 setBooks 的 updater 里：StrictMode 下 updater 会被调用两次，
    // 并发渲染也可能延后执行，而下面要拿被删的那本书去排清理定时器。
    const removed = booksRef.current.find((b) => b.id === id) || null;
    setBooks((prev) => prev.filter((b) => b.id !== id));
    // 延迟 10 秒再真正删掉正文 / 云端缓存；撤销时取消这次清理
    if (removed) {
      const timer = setTimeout(() => {
        pendingDeletes.current.delete(id);
        if (removed.filePath) api.deleteBookFile(removed.filePath).catch(() => {});
        // 云端书没有正文副本，但主进程 cloud/ 里留有目录与章节缓存，一并清掉
        if (removed.kind === 'cloud' && removed.sourceId && removed.bookUrl) {
          api.clearCloudCache({ sourceId: removed.sourceId, bookUrl: removed.bookUrl }).catch(() => {});
        }
        // 书真的删掉之后再清痕迹；撤销窗口内 restoreBook 会取消这个定时器
        setMarks((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 10000);
      pendingDeletes.current.set(id, timer);
    }
    setProgress((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);
  /** 撤销「移出书架」：把书与阅读进度一起放回去。 */
  const restoreBook = useCallback((book, progressEntry) => {
    if (!book) return;
    const timer = pendingDeletes.current.get(book.id);
    if (timer) {
      clearTimeout(timer);
      pendingDeletes.current.delete(book.id);
    }
    setBooks((prev) => (prev.some((b) => b.id === book.id) ? prev : [book, ...prev]));
    if (progressEntry) {
      setProgress((prev) => (prev[book.id] ? prev : { ...prev, [book.id]: progressEntry }));
    }
  }, []);

  const updateBook = useCallback((id, patch) => {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const saveProgress = useCallback((bookId, data) => {
    setProgress((prev) => ({
      ...prev,
      [bookId]: { ...(prev[bookId] || {}), ...data, updatedAt: Date.now() },
    }));
  }, []);

  /** 整本替换某本书的痕迹列表；传空数组即清空。 */
  const saveBookMarks = useCallback((bookId, list) => {
    if (!bookId) return;
    setMarks((prev) => {
      const next = { ...prev };
      if (Array.isArray(list) && list.length) next[bookId] = list;
      else delete next[bookId];
      return next;
    });
  }, []);

  const patchSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetSettings = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  /* ---------- 字体 ---------- */

  // 字体加载集中在 store 里，全应用只有一份 FontFace 注册表
  const { loaded: loadedFonts, failed: failedFonts, cjk: fontCJK } = useFontLoader(fonts);

  const installFonts = useCallback(async () => {
    const res = await api.installFonts();
    if (!res) return { ok: false, cancelled: true };
    if (Array.isArray(res.fonts)) setFonts(res.fonts);
    const errors = Array.isArray(res.errors) ? res.errors : [];
    const count = Array.isArray(res.installed) ? res.installed.length : 0;
    if (count > 0) {
      notify(`已安装 ${count} 个字体`, 'info');
    } else if (errors.length > 0) {
      notify(errors[0], 'error');
    }
    return { ok: errors.length === 0, installed: count, errors };
  }, [notify]);

  const removeFont = useCallback(
    async (id) => {
      const res = await api.removeFont(id);
      if (Array.isArray(res?.fonts)) setFonts(res.fonts);
      // 删掉正在用的字体要立刻回退到基础字体，否则正文会掉进无衬线
      setSettings((prev) => (prev.userFont === id ? { ...prev, userFont: '' } : prev));
      if (res?.ok) notify('字体已删除', 'info');
      else if (res?.error) notify(res.error, 'error');
      return res;
    },
    [notify]
  );

  const clearFonts = useCallback(async () => {
    const res = await api.clearFonts();
    if (Array.isArray(res?.fonts)) setFonts(res.fonts);
    setSettings((prev) => ({ ...prev, userFont: '' }));
    if (res?.ok) notify('已清空全部字体', 'info');
    return res;
  }, [notify]);

  const selectFont = useCallback((id) => {
    setSettings((prev) => ({ ...prev, userFont: id || '' }));
  }, []);

  /* ---------- 字体商店 ---------- */

  const refreshFontCatalog = useCallback((force = false) => api.getFontCatalog(force), []);

  const installStoreFont = useCallback(
    async (id) => {
      const res = await api.installStoreFont(id);
      if (Array.isArray(res?.fonts)) setFonts(res.fonts);
      if (res?.ok) notify(res.already ? '这款字体已经装过了' : '字体已安装，可在「已安装」里选用', 'info');
      else if (res?.error) notify(res.error, 'error');
      return res;
    },
    [notify]
  );

  // 安装进度：订阅主进程的 100ms 节流事件，返回取消函数
  const onFontStoreProgress = useCallback((callback) => api.onFontStoreProgress(callback), []);

  const customThemes = useMemo(() => normalizeCustomThemes(settings.customThemes), [settings.customThemes]);

  const themes = useMemo(
    () => [...BUILTIN_THEMES, ...customThemes],
    [customThemes],
  );

  const saveCustomTheme = useCallback((theme) => {
    const normalized = normalizeTheme(theme);
    if (!normalized) return null;
    setSettings((prev) => {
      const list = normalizeCustomThemes(prev.customThemes).filter((item) => item.id !== normalized.id);
      return { ...prev, customThemes: [...list, normalized], theme: normalized.id };
    });
    return normalized;
  }, []);

  const removeCustomTheme = useCallback((id) => {
    setSettings((prev) => {
      const list = normalizeCustomThemes(prev.customThemes).filter((item) => item.id !== id);
      return { ...prev, customThemes: list, theme: prev.theme === id ? 'paper' : prev.theme };
    });
  }, []);

  const cycleTheme = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: THEME_NAMES[(THEME_NAMES.indexOf(prev.theme) + 1) % THEME_NAMES.length],
    }));
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Context 切片的 value                                               */
  /*  ------------------------------------------------------------------ */
  /*  所有 action 都是 useCallback 且依赖为空（内部改读 ref），所以这个   */
  /*  对象在整个应用生命周期里引用不变 —— 任何状态变化都不会让「只关心   */
  /*  action」的组件重渲染。                                                 */
  const actions = useMemo(
    () => ({
      notify,
      dismissToast,
      addBook,
      addBookFromPicker,
      addBookFromText,
      addBookFromBinary,
      readBookText: api.readBookText,
      statBookBinary: api.statBookBinary,
      readBookRange: api.readBookRange,
      cacheCover: api.cacheCover,
      cacheCovers: api.cacheCovers,
      clearCoverCache: api.clearCoverCache,
      addCloudBook,
      removeBook,
      restoreBook,
      updateBook,
      saveProgress,
      saveBookMarks,
      patchSettings,
      resetSettings,
      installFonts,
      removeFont,
      clearFonts,
      selectFont,
      refreshFontCatalog,
      installStoreFont,
      onFontStoreProgress,
      cycleTheme,
      saveCustomTheme,
      removeCustomTheme,
      importSources,
      importSourcesFromFile,
      importSourcesFromUrl,
      toggleSource,
      removeSource,
      testSource,
      testAllSources,
      listRepo,
      importRepo,
      setSourcesEnabled,
      removeSources,
      importRulesText,
      importRulesFromFile,
      toggleRule,
      removeRule,
      clearRules,
      lanStart: api.lanStart,
      lanStop: api.lanStop,
      lanStatus: api.lanStatus,
      lanOpen: api.lanOpen,
      // 设备页：list 直接读 IPC，改写类 action 成功后顺手刷新设备列表。
      devices: {
        list: api.devices.list,
        refresh: refreshDevices,
        rename: async (payload) => {
          const result = await api.devices.rename(payload);
          if (result?.ok) refreshDevices();
          return result;
        },
        remove: async (payload) => {
          const result = await api.devices.remove(payload);
          if (result?.ok) refreshDevices();
          return result;
        },
        enqueue: async (payload) => {
          const result = await api.devices.enqueue(payload);
          if (result?.ok) refreshDevices();
          return result;
        },
        cancel: async (payload) => {
          const result = await api.devices.cancel(payload);
          if (result?.ok) refreshDevices();
          return result;
        },
        clear: async (payload) => {
          const result = await api.devices.clear(payload);
          if (result?.ok) refreshDevices();
          return result;
        },
        retry: async (payload) => {
          const result = await api.devices.retry(payload);
          if (result?.ok) refreshDevices();
          return result;
        },
      },
      appInfo: api.appInfo,
      logTail: api.logTail,
      logInfo: api.logInfo,
      logLevel: api.logLevel,
      logClear: api.logClear,
      logOpen: api.logOpen,
      logExport: api.logExport,
      logFromRenderer: api.logFromRenderer,
    }),
    [
      notify,
      dismissToast,
      addBook,
      addBookFromPicker,
      addBookFromText,
      addBookFromBinary,
      addCloudBook,
      removeBook,
      restoreBook,
      updateBook,
      saveProgress,
      saveBookMarks,
      patchSettings,
      resetSettings,
      installFonts,
      removeFont,
      clearFonts,
      selectFont,
      refreshFontCatalog,
      installStoreFont,
      onFontStoreProgress,
      cycleTheme,
      saveCustomTheme,
      removeCustomTheme,
      importSources,
      importSourcesFromFile,
      importSourcesFromUrl,
      toggleSource,
      removeSource,
      testSource,
      testAllSources,
      listRepo,
      importRepo,
      setSourcesEnabled,
      removeSources,
      importRulesText,
      importRulesFromFile,
      toggleRule,
      removeRule,
      clearRules,
      refreshDevices,
    ]
  );

  // 字体加载结果由 useFontLoader 内部维护，和 fonts 列表分开订阅：
  // 安装/删除字体会改 fonts，但加载成功与否是另一件事。
  const fontStatus = useMemo(
    () => ({ loadedFonts, failedFonts, fontCJK }),
    [loadedFonts, failedFonts, fontCJK]
  );

  return (
    <AppActionsContext.Provider value={actions}>
      <FontStatusContext.Provider value={fontStatus}>
        {children}
      </FontStatusContext.Provider>
    </AppActionsContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  细粒度 hooks                                                        */
/*  ------------------------------------------------------------------ */
/*  用法：只订阅自己真正需要的那一片状态。                               */
/*  例：日志面板只要 action，就用 useAppActions()，                      */
/*  阅读进度怎么变都不会让它重渲染。                                     */
/* ------------------------------------------------------------------ */

function useSlice(context, name) {
  const value = useContext(context);
  if (value === MISSING) throw new Error(`${name} must be used inside <AppProvider>`);
  return value;
}

/** 所有 action（引用永不变）。 */
export function useAppActions() {
  return useSlice(AppActionsContext, 'useAppActions');
}

/** 书架条目。 */
export const useBooks = () => useAppStore((state) => state.books);

/** 已连接过的手机/平板（含 online/lost/pending 派生值）。 */
export const useDevices = () => useAppStore((state) => state.devices);

/** 阅读进度（高频：滚动时频繁变化）。 */
export const useProgress = () => useAppStore((state) => state.progress);

/** 偏好设置。 */
export const useSettings = () => useAppStore((state) => state.settings);

/** 书签 / 划线 / 笔记：{ 书 id: [mark, ...] }。 */
export const useMarks = () => useAppStore((state) => state.marks);

/** 主题集合与当前主题（由 settings 派生）。 */
export function useThemeState() {
  const settings = useSettings();
  return useMemo(() => {
    const customThemes = normalizeCustomThemes(settings.customThemes);
    const themes = [...BUILTIN_THEMES, ...customThemes];
    const activeTheme = themes.find((theme) => theme.id === settings.theme) || BUILTIN_THEMES[0];
    return { themes, activeTheme, customThemes };
  }, [settings.customThemes, settings.theme]);
}

/** 书源列表。 */
export const useSources = () => useAppStore((state) => state.sources);

/** 净化规则列表。 */
export const useRules = () => useAppStore((state) => state.rules);

/** 已安装字体列表。 */
export const useFonts = () => useAppStore((state) => state.fonts);

/** 字体加载结果：{ loadedFonts, failedFonts, fontCJK }。 */
export function useFontStatus() {
  return useSlice(FontStatusContext, 'useFontStatus');
}

/** 初始数据是否加载完成。 */
export const useLoaded = () => useAppStore((state) => state.loaded);

/** 当前提示条。 */
export const useToast = () => useAppStore((state) => state.toast);

/**
 * 兼容旧写法：一次性拿到全部。
 * 会订阅所有切片 —— 任何状态变化都会重渲染，请优先用上面的细粒度 hook。
 */
export function useApp() {
  const actions = useAppActions();
  const books = useBooks();
  const devices = useDevices();
  const progress = useProgress();
  const settings = useSettings();
  const marks = useMarks();
  const themeState = useThemeState();
  const sources = useSources();
  const rules = useRules();
  const fonts = useFonts();
  const fontStatus = useFontStatus();
  const loaded = useLoaded();
  const toast = useToast();
  return useMemo(
    () => ({
      ...actions,
      books,
      devices,
      progress,
      settings,
      marks,
      ...themeState,
      sources,
      rules,
      fonts,
      ...fontStatus,
      loaded,
      toast,
    }),
    [
      actions,
      books,
      devices,
      progress,
      settings,
      marks,
      themeState,
      sources,
      rules,
      fonts,
      fontStatus,
      loaded,
      toast,
    ]
  );
}

export { api as dataApi, NEED_ELECTRON };
