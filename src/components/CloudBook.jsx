import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useAppActions, useProgress, useSettings, dataApi } from '../store/AppStore.jsx';
import Reader from './Reader.jsx';
import { IconArrowLeft, IconList, IconRefresh, IconSparkle } from './Icons.jsx';

// 一个窗口里预取几章：多了浪费流量，少了翻页就断。
const WINDOW_SIZE = 3;
// 读到当前窗口时，后台悄悄多抓几章，滚到底能立刻续上。
// 弱网下读一章要好几秒，多预取几张（并发仍由窗口控制）比临时等更快。
const PREFETCH_AHEAD = 3;
const PREFETCH_BACK = 1;

export default function CloudBook({ book, onClose }) {
  const progress = useProgress();
  const settings = useSettings();
  const { saveProgress, notify, updateBook } = useAppActions();
  const saved = progress[book.id] || {};
  const savedBase = Math.max(0, Number(saved.windowBase ?? saved.chapter ?? 0) || 0);

  const [toc, setToc] = useState(null);
  const [base, setBase] = useState(savedBase);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const loadingRef = useRef(false);
  const tocRef = useRef(toc);
  const baseRef = useRef(base);
  const partsRef = useRef(parts);
  const aliveRef = useRef(true);
  const allowResumeRef = useRef(true);
  // index -> Promise：进行中的抓取（去重，预取与续接共享同一次请求）
  const inflightRef = useRef(new Map());
  // index -> { text, error }：预取已完成、等待续接消费的结果
  const readyRef = useRef(new Map());

  tocRef.current = toc;
  baseRef.current = base;
  partsRef.current = parts;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const fetchChapterText = useCallback(
    async (index) => {
      const entry = tocRef.current?.[index] || null;
      const res = await dataApi.fetchCloudChapter({
        sourceId: book.sourceId,
        bookUrl: book.bookUrl,
        index,
        chapter: entry,
        proxy: settings.proxy || '',
        book: {
          name: book.name,
          author: book.author,
          cover: book.cover,
          bookUrl: book.bookUrl,
          raw: book.raw || null,
        },
      });
      if (res?.error) throw new Error(res.error);
      return res.text || '';
    },
    [book.bookUrl, book.sourceId, book.name, book.author, book.cover, book.raw, settings.proxy]
  );

  /**
   * 取单章：优先吃后台预取的结果；进行中的同章请求共享同一个 Promise。
   * 不抛异常，统一返回 { text, error }，由调用方决定怎么展示。
   */
  const fetchOne = useCallback(
    async (index) => {
      const ready = readyRef.current.get(index);
      if (ready) {
        readyRef.current.delete(index);
        return ready;
      }
      const active = inflightRef.current.get(index);
      if (active) return active;
      const task = (async () => {
        let lastError = null;
        // 弱网下第一次超时/断流很常见，隔一会儿再试一次，命中率比直接报错高
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const text = await fetchChapterText(index);
            if (text) return { text, error: null };
            lastError = new Error('源站返回了空正文');
          } catch (err) {
            lastError = err;
          }
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
        }
        return { text: '', error: lastError?.message || '加载失败' };
      })();
      inflightRef.current.set(index, task);
      try {
        return await task;
      } finally {
        inflightRef.current.delete(index);
      }
    },
    [fetchChapterText]
  );

  /** 后台预取窗口之后的几章，结果存进 readyRef 供 loadMore 即时消费。 */
  const prefetchNext = useCallback(() => {
    const chapters = tocRef.current;
    if (!chapters) return;
    const have = new Set(partsRef.current.map((p) => p.index));
    let scheduled = 0;
    for (let i = baseRef.current + partsRef.current.length; i < chapters.length; i += 1) {
      if (scheduled >= PREFETCH_AHEAD) break;
      if (have.has(i) || readyRef.current.has(i) || inflightRef.current.has(i)) continue;
      scheduled += 1;
      fetchOne(i).then((r) => {
        // 消费前一直有效； jumpTo / 重新加载时会整体清空
        readyRef.current.set(i, r);
      });
    }
    // 往回也预热一章：重读上一章不用重新等网络
    for (let i = baseRef.current - 1; i >= 0 && baseRef.current - i <= PREFETCH_BACK; i -= 1) {
      if (have.has(i) || readyRef.current.has(i) || inflightRef.current.has(i)) continue;
      fetchOne(i).then((r) => {
        readyRef.current.set(i, r);
      });
    }
  }, [fetchOne]);

  /** 从 start 开始并行取 count 章；失败的章以 error 占位，不再截断窗口。 */
  const collect = useCallback(
    async (chapters, start, count) => {
      const indices = [];
      for (let i = start; i < Math.min(start + count, chapters.length); i += 1) indices.push(i);
      return Promise.all(
        indices.map(async (i) => ({ index: i, title: chapters[i].title, ...(await fetchOne(i)) }))
      );
    },
    [fetchOne]
  );

  /* ---------------------------- 首次加载 ---------------------------- */

  useEffect(() => {
    let cancelled = false;
    readyRef.current.clear();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const tocRes = await dataApi.fetchCloudToc({
          sourceId: book.sourceId,
          bookUrl: book.bookUrl,
          proxy: settings.proxy || '',
          refresh: attempt > 0,
          book: {
            name: book.name,
            author: book.author,
            cover: book.cover,
            bookUrl: book.bookUrl,
            raw: book.raw || null,
          },
        });
        if (cancelled) return;
        if (tocRes?.error) throw new Error(tocRes.error);
        const chapters = tocRes.chapters || [];
        if (!chapters.length) throw new Error('这本没有目录');
        setToc(chapters);
        tocRef.current = chapters;
        if (tocRes.fallback === 'auto') {
          notify(`目录由自动匹配生成（${chapters.length} 章），可能不完整`);
        } else if (chapters.length < 20) {
          // 书籍页常常只放「最新章节」，真正的目录在另一个页面；没找着入口时提示一下
          notify(`只解析到 ${chapters.length} 章，书籍页可能只显示了最新章节`, 'error');
        }
        // 详情页规则（ruleBookInfo）：补齐书名/作者/简介/封面，只填空字段；
        // 书名例外——如果当前名字就是个网址（从「网上搜书」里直接读的条目），用详情页标题替换
        if (tocRes.info) {
          const info = tocRes.info;
          const patch = {};
          const looksLikeUrl = !book.name || /^https?:\/\//i.test(book.name) || book.name.includes('/%');
          if (info.name && info.name !== book.name && (!book.name || looksLikeUrl)) patch.name = info.name;
          if (info.author && !book.author) patch.author = info.author;
          if (info.intro && !book.intro) patch.intro = info.intro;
          if (info.cover && !book.cover) patch.cover = info.cover;
          if (info.lastChapter) patch.lastChapter = info.lastChapter;
          if (Object.keys(patch).length) updateBook(book.id, patch);
        }

        const start = Math.min(savedBase, chapters.length - 1);
        const count = Math.min(WINDOW_SIZE, chapters.length - start);
        loadingRef.current = true;
        const batch = await collect(chapters, start, count);
        loadingRef.current = false;
        if (cancelled) return;
        if (!batch.length || batch[0].error) {
          throw new Error(batch[0]?.error || '第一章没有抓到正文，检查书源的正文规则');
        }
        const failed = batch.filter((p) => p.error).length;
        setBase(start);
        setParts(batch);
        if (failed) notify(`${failed} 章暂时没取到，文中已标出，可稍后重试`, 'error');
        prefetchNext();
      } catch (err) {
        if (!cancelled) setError(err.message || '加载失败');
      } finally {
        loadingRef.current = false;
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, book.bookUrl, book.sourceId, attempt]);

  /* ---------------------------- 续读 / 跳章 ---------------------------- */

  const loadMore = useCallback(
    async (count = 1) => {
      if (loadingRef.current) return;
      const chapters = tocRef.current;
      if (!chapters) return;
      const start = baseRef.current + partsRef.current.length;
      if (start >= chapters.length) return;

      loadingRef.current = true;
      setLoading(true);
      try {
        const batch = await collect(chapters, start, count);
        if (!aliveRef.current) return;
        if (batch.length) {
          const failed = batch.filter((p) => p.error).length;
          setParts((prev) => [...prev, ...batch]);
          if (failed) notify(`${failed} 章没取到，已标出可重试`, 'error');
          prefetchNext();
        } else {
          notify('这一章没有抓到正文', 'error');
        }
      } catch (err) {
        if (aliveRef.current) notify(err.message || '加载失败', 'error');
      } finally {
        loadingRef.current = false;
        if (aliveRef.current) setLoading(false);
      }
    },
    [collect, notify, prefetchNext]
  );

  /** 重试所有失败章节：成功后原位替换占位段落，段落索引不变、阅读位置不丢。 */
  const retryFailed = useCallback(async () => {
    if (loadingRef.current) return;
    const chapters = tocRef.current;
    const failed = partsRef.current.filter((p) => p.error);
    if (!chapters || !failed.length) return;

    loadingRef.current = true;
    setLoading(true);
    try {
      const results = await Promise.all(
        failed.map(async (p) => ({ index: p.index, ...(await fetchOne(p.index)) }))
      );
      if (!aliveRef.current) return;
      const still = results.filter((r) => r.error).length;
      setParts((prev) =>
        prev.map((p) => {
          const r = results.find((x) => x.index === p.index);
          return r ? { ...p, text: r.text, error: r.error } : p;
        })
      );
      if (still) notify(`仍有 ${still} 章没取到`, 'error');
      else {
        notify('失败的章节已补齐');
        prefetchNext();
      }
    } catch (err) {
      if (aliveRef.current) notify(err.message || '重试失败', 'error');
    } finally {
      loadingRef.current = false;
      if (aliveRef.current) setLoading(false);
    }
  }, [fetchOne, notify, prefetchNext]);

  const jumpTo = useCallback(
    async (index) => {
      if (loadingRef.current) return;
      const chapters = tocRef.current;
      if (!chapters?.length) return;
      const start = Math.max(0, Math.min(index, chapters.length - 1));

      loadingRef.current = true;
      setLoading(true);
      try {
        const count = Math.min(WINDOW_SIZE, chapters.length - start);
        const batch = await collect(chapters, start, count);
        if (!aliveRef.current) return;
        readyRef.current.clear();
        if (!batch.length || batch[0].error) {
          throw new Error(batch[0]?.error || '这一章没有抓到正文');
        }
        saveProgress(book.id, {
          paraIndex: 0,
          percent: (start / chapters.length) * 100,
          chapter: start,
          chapterTitle: chapters[start].title,
          windowBase: start,
        });
        allowResumeRef.current = false;
        setBase(start);
        setParts(batch);
        const failed = batch.filter((p) => p.error).length;
        if (failed) notify(`${failed} 章暂时没取到，文中已标出，可稍后重试`, 'error');
        prefetchNext();
      } catch (err) {
        if (aliveRef.current) notify(err.message || '跳转失败', 'error');
      } finally {
        loadingRef.current = false;
        if (aliveRef.current) setLoading(false);
      }
    },
    [book.id, collect, notify, prefetchNext, saveProgress]
  );

  const content = useMemo(
    () =>
      parts
        .map((part) =>
          part.error
            ? `${part.title}\n\n〔本章暂时取不到：${part.error}〕`
            : `${part.title}\n\n${part.text}`
        )
        .join('\n\n'),
    [parts]
  );

  const cloudChapters = useMemo(() => parts.map((part) => ({ title: part.title })), [parts]);

  const total = toc?.length || 0;
  const hasMore = total > 0 && base + parts.length < total;
  const failedCount = parts.filter((p) => p.error).length;

  const cloud = useMemo(
    () => ({
      chapters: toc || [],
      windowBase: base,
      windowCount: parts.length,
      hasMore,
      loading,
      onLoadMore: () => loadMore(2),
      onJump: (index) => jumpTo(index),
    }),
    [base, hasMore, jumpTo, loadMore, loading, parts.length, toc]
  );

  const readerBook = useMemo(
    () => ({ ...book, content, cloudChapters }),
    [book, cloudChapters, content]
  );

  const gateHead = (
    <header className="cloud-gate-head">
      <button className="icon-btn ghost" onClick={onClose} title="返回书架 (Esc)">
        <IconArrowLeft size={18} />
      </button>
      <div className="cloud-gate-meta">
        <span className="reader-book">{book.name}</span>
        <span className="reader-chapter">{book.sourceName}</span>
      </div>
    </header>
  );

  if (error) {
    return (
      <div className="reader cloud-gate">
        {gateHead}
        <div className="cloud-gate-body">
          <div className="cloud-gate-icon">
            <IconSparkle size={22} />
          </div>
          <h2>这一章没能取到</h2>
          <p className="cloud-gate-detail">{error}</p>
          <div className="cloud-gate-actions">
            <button
              className="btn primary"
              onClick={() => {
                setError(null);
                setParts([]);
                setAttempt((n) => n + 1);
              }}
            >
              重试
            </button>
            <button className="btn ghost" onClick={onClose}>
              返回书架
            </button>
          </div>
          <p className="cloud-gate-hint">
            云端书依赖书源规则。若一直失败，可以在书架里换一个书源搜索同一本书。
          </p>
        </div>
      </div>
    );
  }

  if (!parts.length) {
    return (
      <div className="reader cloud-gate">
        {gateHead}
        <div className="cloud-gate-body">
          <motion.div
            className="cloud-gate-icon"
            animate={{ rotate: 360 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
          >
            <IconList size={20} />
          </motion.div>
          <h2>{toc ? '正在取第一章…' : '正在读取目录…'}</h2>
          <p className="cloud-gate-detail">
            {book.sourceName}
            {toc ? ` · 共 ${toc.length} 章` : ''}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Reader
        key={`${book.id}:${base}`}
        book={readerBook}
        cloud={cloud}
        resume={allowResumeRef.current}
        onClose={onClose}
      />
      {loading && (
        <motion.div
          className="cloud-loading"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className="cloud-loading-dot" />
          正在取后续章节…
        </motion.div>
      )}
      {!loading && failedCount > 0 && (
        <motion.button
          className="cloud-retry"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          onClick={retryFailed}
          title="重新抓取文中标出的失败章节"
        >
          <IconRefresh size={15} />
          重试 {failedCount} 个失败章节
        </motion.button>
      )}
    </>
  );
}
