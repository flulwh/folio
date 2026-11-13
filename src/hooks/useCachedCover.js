import { useEffect, useMemo, useState } from 'react';
import { useAppActions } from '../store/AppStore.jsx';

/**
 * 云端书封面：先看内存缓存，再让主进程把远端图片下载到 dataDir/covers 并返回
 * folio-cover:// 本地地址。下载失败返回 null，卡片继续用生成的纯色封面。
 *
 * 同一个 URL 在一个会话内只请求一次（成功或失败都会记住）。
 */
const memo = new Map();

export function useCachedCover(book, tick = 0) {
  const { cacheCover } = useAppActions();
  const url = book?.kind === 'cloud' ? String(book.cover || '').trim() : '';

  const initial = useMemo(() => (url ? memo.get(url) ?? null : null), [url]);
  const [src, setSrc] = useState(initial);

  useEffect(() => {
    if (!url) {
      setSrc(null);
      return undefined;
    }
    if (memo.has(url)) {
      setSrc(memo.get(url));
      return undefined;
    }
    let alive = true;
    Promise.resolve(cacheCover({ url }))
      .then((res) => {
        const value = res?.url || null;
        memo.set(url, value);
        if (alive) setSrc(value);
      })
      .catch(() => {
        memo.set(url, null);
      });
    return () => {
      alive = false;
    };
  }, [url, cacheCover, tick]);

  return src;
}

/** 书架挂载时把整架云端书的封面批量拉一次，省掉每张卡一次 IPC。 */
export function usePrimeShelfCovers(books) {
  const { cacheCovers } = useAppActions();

  useEffect(() => {
    const items = (books || [])
      .filter((book) => book.kind === 'cloud' && book.cover && !memo.has(book.cover))
      .map((book) => ({ id: book.id, url: book.cover }))
      .slice(0, 40);
    if (!items.length) return undefined;

    let alive = true;
    Promise.resolve(cacheCovers({ items }))
      .then((res) => {
        if (!alive) return;
        for (const item of items) {
          const value = res?.covers?.[item.id] || null;
          memo.set(item.url, value);
        }
        // 触发一次重渲染：让已经挂载的卡片读到 url -> 本地地址 的映射
        window.dispatchEvent(new CustomEvent('folio:cover-ready'));
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [books, cacheCovers]);
}

/** 订阅批量封面完成事件，让卡片无需重挂载就能拿到新地址。 */
export function useCoverReadyTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onReady = () => setTick((n) => n + 1);
    window.addEventListener('folio:cover-ready', onReady);
    return () => window.removeEventListener('folio:cover-ready', onReady);
  }, []);
  return tick;
}
