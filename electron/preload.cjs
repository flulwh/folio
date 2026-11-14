const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('readerAPI', {
  appInfo: () => ipcRenderer.invoke('app:info'),

  // 窗口控制：自绘的 macOS 风格交通灯（红黄绿）需要自己接管这三个动作。
  // 只暴露动作，不暴露窗口对象本身，渲染层拿不到任何特权句柄。
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  windowSetFrame: (enabled, uiState) => ipcRenderer.invoke('window:set-frame', enabled, uiState),
  windowGetUiState: () => ipcRenderer.invoke('window:get-ui-state'),
  pickBook: () => ipcRenderer.invoke('book:pick'),
  addBookContent: (payload) => ipcRenderer.invoke('book:add-content', payload),
  readBookText: (filePath) => ipcRenderer.invoke('book:read', filePath),
  deleteBookFile: (filePath) => ipcRenderer.invoke('book:delete-file', filePath),
  loadBookPath: (filePath) => ipcRenderer.invoke('book:load-path', filePath),
  cacheCover: (payload) => ipcRenderer.invoke('cover:cache', payload),
  cacheCovers: (payload) => ipcRenderer.invoke('cover:cache-many', payload),
  clearCoverCache: () => ipcRenderer.invoke('cover:clear'),
  showInFolder: (filePath) => ipcRenderer.invoke('book:show-in-folder', filePath),
  getBooks: () => ipcRenderer.invoke('store:get-books'),
  setBooks: (books) => ipcRenderer.invoke('store:set-books', books),
  getProgress: () => ipcRenderer.invoke('store:get-progress'),
  setProgress: (progress) => ipcRenderer.invoke('store:set-progress', progress),
  getSettings: () => ipcRenderer.invoke('store:get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('store:set-settings', settings),

  // 局域网面板：手机/平板在同一个 Wi-Fi 下访问书架与阅读进度
  lanStart: (config) => ipcRenderer.invoke('lan:start', config),
  lanStop: () => ipcRenderer.invoke('lan:stop'),
  lanStatus: () => ipcRenderer.invoke('lan:status'),
  lanOpen: (url) => ipcRenderer.invoke('lan:open', url),
  // 手机端写回了进度：主进程把合并后的整份进度推过来，渲染层合并进内存
  onLanProgress: (callback) => {
    const listener = (_event, payload) => {
      try {
        callback?.(payload);
      } catch {
        /* 渲染侧回调出错不影响主进程 */
      }
    };
    ipcRenderer.on('lan:progress', listener);
    return () => ipcRenderer.removeListener('lan:progress', listener);
  },
  // 手机上传落盘后主进程通知书架有变化：渲染层据此重新读一遍 books.json
  onLanBooks: (callback) => {
    const listener = (_event, payload) => {
      try {
        callback?.(payload);
      } catch {
        /* 渲染侧回调出错不影响主进程 */
      }
    };
    ipcRenderer.on('lan:books', listener);
    return () => ipcRenderer.removeListener('lan:books', listener);
  },
  // 老版本设置里没有访问码时，主进程会兜底生成一个；设置页负责写回 settings.json
  onLanToken: (callback) => {
    const listener = (_event, payload) => {
      try {
        callback?.(payload);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on('lan:token', listener);
    return () => ipcRenderer.removeListener('lan:token', listener);
  },
  // 设备在线态变化（SSE 连着/断开、90s 窗口过期）
  onLanDevice: (callback) => {
    const listener = (_event, payload) => {
      try {
        callback?.(payload);
      } catch {
        /* 渲染侧回调出错不影响主进程 */
      }
    };
    ipcRenderer.on('lan:device', listener);
    return () => ipcRenderer.removeListener('lan:device', listener);
  },
  // 桌面端入队/手机回执都会让队列变化，渲染层据此刷新「待执行 N 项」
  onLanCommand: (callback) => {
    const listener = (_event, payload) => {
      try {
        callback?.(payload);
      } catch {
        /* 渲染侧回调出错不影响主进程 */
      }
    };
    ipcRenderer.on('lan:command', listener);
    return () => ipcRenderer.removeListener('lan:command', listener);
  },

  // 设备管理与指令队列（渲染层不走 LAN HTTP，全部经 IPC）
  devices: {
    list: () => ipcRenderer.invoke('devices:list'),
    rename: (payload) => ipcRenderer.invoke('devices:rename', payload),
    remove: (payload) => ipcRenderer.invoke('devices:remove', payload),
    enqueue: (payload) => ipcRenderer.invoke('devices:enqueue', payload),
    cancel: (payload) => ipcRenderer.invoke('devices:cancel', payload),
    clear: (payload) => ipcRenderer.invoke('devices:clear', payload),
    retry: (payload) => ipcRenderer.invoke('devices:retry', payload),
  },

  // 字体
  listFonts: () => ipcRenderer.invoke('font:list'),
  installFonts: () => ipcRenderer.invoke('font:install'),
  removeFont: (id) => ipcRenderer.invoke('font:remove', id),
  clearFonts: () => ipcRenderer.invoke('font:clear'),
  showFontInFolder: (id) => ipcRenderer.invoke('font:show-in-folder', id),

  // 书源
  listSources: () => ipcRenderer.invoke('source:list'),
  saveSources: (list) => ipcRenderer.invoke('source:save', list),
  setSourcesEnabled: (ids, enabled) => ipcRenderer.invoke('source:set-enabled', ids, enabled),
  removeSources: (ids) => ipcRenderer.invoke('source:remove', ids),
  importSourcesText: (payload) => ipcRenderer.invoke('source:import-text', payload),
  importSourcesFile: () => ipcRenderer.invoke('source:import-file'),
  importSourcesUrl: (url) => ipcRenderer.invoke('source:import-url', url),
  testSource: (sourceId, keyword, proxy) => ipcRenderer.invoke('source:test', sourceId, keyword, proxy),
  testAllSources: (keyword, proxy, limit) => ipcRenderer.invoke('source:test-all', keyword, proxy, limit),
  listRepo: (payload) => ipcRenderer.invoke('repo:list', payload),
  importRepo: (payload) => ipcRenderer.invoke('repo:import', payload),

  // 净化规则（Legado 替换规则）
  listRules: () => ipcRenderer.invoke('rules:list'),
  saveRules: (list) => ipcRenderer.invoke('rules:save', list),
  importRulesText: (payload) => ipcRenderer.invoke('rules:import-text', payload),
  importRulesFile: () => ipcRenderer.invoke('rules:import-file'),
  removeRule: (id) => ipcRenderer.invoke('rules:remove', id),
  clearRules: () => ipcRenderer.invoke('rules:clear'),

  // 云端书
  searchCloud: (payload) => ipcRenderer.invoke('cloud:search', payload),
  fetchCloudToc: (payload) => ipcRenderer.invoke('cloud:toc', payload),
  fetchCloudChapter: (payload) => ipcRenderer.invoke('cloud:chapter', payload),
  fetchChapterImages: (payload) => ipcRenderer.invoke('cloud:chapter-images', payload),
  prefetchImages: (payload) => ipcRenderer.invoke('cloud:prefetch-images', payload),
  cancelImagePrefetch: (key) => ipcRenderer.invoke('cloud:prefetch-images-cancel', { key }),
  onImageProgress: (callback) => {
    const listener = (_event, payload) => {
      try {
        callback?.(payload);
      } catch {
        /* 渲染侧回调出错不影响主进程 */
      }
    };
    ipcRenderer.on('cloud:image-progress', listener);
    return () => ipcRenderer.removeListener('cloud:image-progress', listener);
  },
  cloudCacheStats: (payload) => ipcRenderer.invoke('cloud:cache-stats', payload),
  clearCloudCache: (payload) => ipcRenderer.invoke('cloud:clear-cache', payload),

  // 日志（调试用）
  logTail: (payload) => ipcRenderer.invoke('log:tail', payload),
  logInfo: () => ipcRenderer.invoke('log:info'),
  logFiles: () => ipcRenderer.invoke('log:files'),
  logLevel: (name) => ipcRenderer.invoke('log:level', name),
  logClear: () => ipcRenderer.invoke('log:clear'),
  logOpen: () => ipcRenderer.invoke('log:open'),
  logExport: () => ipcRenderer.invoke('log:export'),
  logFromRenderer: (payload) => ipcRenderer.invoke('log:from-renderer', payload),
});
