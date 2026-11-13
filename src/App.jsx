import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { DUR, EASE, pageVariants, toastVariants, zoomInVariants } from './motion.js';
import { useAppActions, useBooks, useLoaded, useSettings, useThemeState, useToast } from './store/AppStore.jsx';
import Bookshelf from './components/Bookshelf.jsx';
import Reader from './components/Reader.jsx';
import ShortcutHelp from './components/ShortcutHelp.jsx';
import TrafficLights from './components/TrafficLights.jsx';
import { IconBook } from './components/Icons.jsx';
import { applyTheme } from './themes.js';

/* ------------------------------------------------------------------ */
/*  路由级代码分割                                                      */
/*  ------------------------------------------------------------------ */
/*  集市、设置、云端书、漫画这四块平时用不到，加载进来却要 200KB+ 的 JS。 */
/*  用 React.lazy 拆成独立 chunk，点进去时才下载 —— 首屏只带书架和阅读器。 */
/* ------------------------------------------------------------------ */
const CloudBook = lazy(() => import('./components/CloudBook.jsx'));
const ComicReader = lazy(() => import('./components/ComicReader.jsx'));
const BookMarket = lazy(() => import('./components/BookMarket.jsx'));
const SettingsPage = lazy(() => import('./components/SettingsPage.jsx'));

/** 懒加载块的占位：保持和真实内容同样的高度，避免布局跳动。 */
function LazyFallback() {
  return <div className="lazy-fallback" aria-hidden="true" />;
}

function Splash() {
  return (
    <motion.div
      className="splash"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="splash-mark"
        animate={{ scale: [1, 1.06, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <IconBook size={30} />
      </motion.div>
      <span className="splash-text">Folio</span>
    </motion.div>
  );
}
function Toast({ toast, onDismiss }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          className={`toast ${toast.tone || 'info'}`}
          key={toast.id}
          role="status"
          aria-live="polite"
          variants={toastVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <span className="toast-dot" aria-hidden="true" />
          <span className="toast-text">{toast.message}</span>
          {toast.action?.label && (
            <button
              className="toast-action"
              onClick={() => {
                onDismiss?.();
                try {
                  toast.action.onClick?.();
                } catch (err) {
                  console.error('toast action failed', err);
                }
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="toast-close" onClick={onDismiss} title="关闭提示" aria-label="关闭提示">
            ×
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  // 只订阅 App 自己真正需要的状态。注意这里刻意不订阅 progress：
  // 阅读进度每滚动一次就变一次，App 一旦订阅它，整个组件树都会跟着重渲染。
  const books = useBooks();
  const settings = useSettings();
  const { activeTheme } = useThemeState();
  const loaded = useLoaded();
  const toast = useToast();
  const { notify, dismissToast, readBookText } = useAppActions();
  const [activeBookId, setActiveBookId] = useState(null);
  const [view, setView] = useState('shelf');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [texts, setTexts] = useState({});
  const readingIds = useRef(new Set());

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) || null,
    [books, activeBookId]
  );

  // 正文不在 books.json 里：打开时按 filePath 从 books/ 目录读一次
  useEffect(() => {
    if (!activeBook) return undefined;
    const { id, kind, content, filePath } = activeBook;
    if (kind !== 'local' || content || !filePath) return undefined;
    if (texts[id] !== undefined || readingIds.current.has(id)) return undefined;
    readingIds.current.add(id);
    let cancelled = false;
    (async () => {
      try {
        const res = await readBookText(filePath);
        if (cancelled) return;
        if (!res || res.error) {
          notify(res?.error || '读不到这本书的正文，文件可能已被删除', 'error');
          setActiveBookId(null);
          return;
        }
        setTexts((map) => ({ ...map, [id]: res.content }));
      } catch (err) {
        if (cancelled) return;
        notify(`读不到这本书的正文：${err.message}`, 'error');
        setActiveBookId(null);
      } finally {
        readingIds.current.delete(id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBook, texts, notify, readBookText]);

  const bookForReader = useMemo(() => {
    if (!activeBook) return null;
    if (activeBook.kind !== 'local') return activeBook;
    if (activeBook.content) return activeBook;
    const cached = texts[activeBook.id];
    return cached ? { ...activeBook, content: cached } : null;
  }, [activeBook, texts]);

  useEffect(() => {
    const platform = /mac/i.test(navigator.userAgent) ? 'darwin' : 'win32';
    document.documentElement.dataset.platform = platform;
  }, []);

  // macOS 风格边框：
  //  - macOS 用系统原生的 traffic light，渲染层不画，只把交通灯该占的位置让出来
  //  - Windows 上把原生标题栏去掉（titleBarStyle:'hidden'），改由渲染层自绘交通灯
  const macosFrame = settings.macosFrame !== false;
  const isDarwin = typeof document !== 'undefined' && /mac/i.test(navigator.userAgent);
  // 只有「Windows + 开了 macOS 边框」才需要自绘；macOS 永远用原生的
  const drawTrafficLights = macosFrame && !isDarwin;
  // 有交通灯就要给标题栏让出位置。macOS 原生交通灯和 Windows 自绘的
  // 占位完全一样，所以两种情况共用同一套留白规则。
  // macOS 上无论开关怎么切都保留原生交通灯，所以恒为 true。
  const hasTrafficLights = isDarwin || macosFrame;

  useEffect(() => {
    // 让 CSS 知道当前要不要给交通灯留位置
    document.documentElement.dataset.frame = hasTrafficLights ? 'macos' : 'native';
  }, [hasTrafficLights]);

  // 切换边框要重建窗口（titleBarStyle 不能热改），重建会丢掉渲染层内存里的
  // 界面状态。所以切换时把「当前在看哪本书、停在哪个页面」一起交给主进程，
  // 新窗口起来后再取回来还原。
  const uiStateRef = useRef({ view: 'shelf', activeBookId: null });
  const settingsRef = useRef(settings);
  useEffect(() => {
    uiStateRef.current = { view, activeBookId };
  }, [view, activeBookId]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    // 等设置真正从磁盘读回来再同步：loaded 之前 settings 还是默认值，
    // 拿默认值去要求主进程切边框会造成一次多余的重建。
    if (!loaded) return;
    const api = window.readerAPI;
    if (!api?.windowSetFrame) return;
    let cancelled = false;
    (async () => {
      // 先把设置落盘再切边框。顺序不能反：
      // 重建后新渲染层会重新读 settings.json，如果盘上还是旧值，
      // 它会以为又要切回旧模式 → 无限重建。
      try {
        await api.setSettings?.(settingsRef.current);
      } catch {
        /* 落盘失败不阻断切换 */
      }
      if (cancelled) return;
      try {
        await api.windowSetFrame(macosFrame, uiStateRef.current);
      } catch {
        /* 窗口正在重建，调用方会随窗口一起销毁 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [macosFrame, loaded]);

  // 新窗口起来后把界面还原回切换前的位置（只在真正重建过之后才有值）
  useEffect(() => {
    const api = window.readerAPI;
    if (!api?.windowGetUiState) return;
    let cancelled = false;
    Promise.resolve(api.windowGetUiState())
      .then((state) => {
        if (cancelled || !state) return;
        if (state.view === 'market' || state.view === 'settings' || state.view === 'shelf') {
          setView(state.view);
        }
        if (typeof state.activeBookId === 'string' && state.activeBookId) {
          setActiveBookId(state.activeBookId);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 双击标题栏空白处 = 最大化 / 还原（macOS 的习惯）
  const handleTitleBarDoubleClick = useCallback(() => {
    if (!drawTrafficLights) return;
    Promise.resolve(window.readerAPI?.windowToggleMaximize?.()).catch(() => {});
  }, [drawTrafficLights]);

  useEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);
  useEffect(() => {
    // loaded 之前 books 还是空的，此时 activeBook 必然是 null。
    // 如果不等到 loaded 就清 activeBookId，重建窗口后刚恢复的书会被立刻清掉。
    if (loaded && activeBookId && !activeBook) setActiveBookId(null);
  }, [activeBook, activeBookId, loaded]);

  useEffect(() => {
    document.documentElement.dataset.motion = settings.reduceMotion ? 'off' : 'on';
  }, [settings.reduceMotion]);

  // 界面风格：apple.css 与 skin-miui.css 并存，靠 html[data-skin] 切换
  useEffect(() => {
    document.documentElement.dataset.skin = settings.skin === 'miui' ? 'miui' : 'apple';
  }, [settings.skin]);

  // 全局「?」打开快捷键说明；输入框里不拦截
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented) return;
      if (event.key !== '?' && !(event.key === '/' && event.shiftKey)) return;
      const tag = (event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return;
      event.preventDefault();
      setShortcutsOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <MotionConfig
      reducedMotion={settings.reduceMotion ? 'always' : 'never'}
      transition={{ duration: DUR.base, ease: EASE }}
    >
    <div className="app" data-theme={activeTheme?.builtin ? activeTheme.id : activeTheme?.tone === 'dark' ? 'night' : 'paper'} data-theme-id={activeTheme?.id}>
      <AnimatePresence initial={false}>
        {!loaded ? (
          <Splash key="splash" />
        ) : activeBook && !bookForReader ? (
          <Splash key="opening" />
        ) : bookForReader ? (
          <motion.div
            key={`reader-${bookForReader.id}`}
            className="view"
            variants={zoomInVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {bookForReader.kind === 'cloud' ? (
              <Suspense fallback={<LazyFallback />}>
                {bookForReader.type === 2 ? (
                  <ComicReader book={bookForReader} onClose={() => setActiveBookId(null)} />
                ) : (
                  <CloudBook book={bookForReader} onClose={() => setActiveBookId(null)} />
                )}
              </Suspense>
            ) : (
              <Reader book={bookForReader} onClose={() => setActiveBookId(null)} />
            )}
          </motion.div>
        ) : view === 'market' ? (
          <motion.div
            key="market"
            className="view"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <Suspense fallback={<LazyFallback />}>
              <BookMarket
                onClose={() => setView('shelf')}
                onOpenBook={(book) => setActiveBookId(book.id)}
              />
            </Suspense>
          </motion.div>
        ) : view === 'settings' ? (
          <motion.div
            key="settings"
            className="view"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <Suspense fallback={<LazyFallback />}>
              <SettingsPage onClose={() => setView('shelf')} />
            </Suspense>
          </motion.div>
        ) : (
          <motion.div
            key="shelf"
            className="view"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <Bookshelf
              onOpenBook={(book) => setActiveBookId(book.id)}
              onOpenMarket={() => setView('market')}
              onOpenSettings={() => setView('settings')}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <Toast toast={toast} onDismiss={dismissToast} />
      <ShortcutHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {drawTrafficLights ? (
        <TrafficLights onDoubleClickBlank={handleTitleBarDoubleClick} />
      ) : null}
    </div>
    </MotionConfig>
  );
}
