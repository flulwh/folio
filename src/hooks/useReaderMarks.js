import { useCallback, useMemo, useState } from 'react';
import { chapterIndexForPara } from '../utils/chapters.js';
import { clamp, compactText } from '../utils/format.js';

/**
 * 书签 / 划线 / 笔记：痕迹的锚定与增删改。
 *
 * 从 Reader.jsx 抽出来。这一块只有「把段落号与 mark 互相换算 + 读写 marks 表」，
 * 不碰渲染；跳转所需的滚动动作由 Reader 传进来，避免 hook 直接依赖虚拟滚动。
 */
export function useReaderMarks({
  bookId,
  paragraphs,
  chapters,
  windowBase,
  cloud,
  bookMarks,
  currentPara,
  saveBookMarks,
  notify,
  wakeUI,
  playSettle,
  animateScroll,
  getOffset,
  setCurrentPara,
  setAutoScroll,
  setSelection,
  setActiveHit,
}) {
  const [noteTarget, setNoteTarget] = useState(null);

  // 痕迹锚定在「段落号」上，而不是字符偏移：换字号 / 换栏宽后正文重排，
  // 段落号仍然稳定，划线不会错位。
  const absoluteParaForMark = useCallback(
    (mark) => {
      const local = Number(mark?.paraIndex);
      if (!Number.isFinite(local)) return null;
      if (Number(mark.chapterNo) >= 0) {
        const chapter = chapters[Number(mark.chapterNo) - windowBase];
        if (!chapter) return null;
        return chapter.paraIndex + local;
      }
      return local;
    },
    [chapters, windowBase]
  );

  const buildMark = useCallback(
    (paraIndex, kind, excerpt, note = '') => {
      const ci = chapterIndexForPara(chapters, paraIndex);
      const chapter = chapters[ci];
      const isWindow = !!cloud;
      return {
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `mark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        paraIndex: isWindow ? paraIndex - (chapter?.paraIndex || 0) : paraIndex,
        chapter: chapter?.title || '',
        chapterIndex: ci,
        chapterNo: isWindow ? windowBase + ci : -1,
        excerpt: compactText(excerpt || paragraphs[paraIndex]?.text || '').slice(0, 120),
        note: String(note || '').trim(),
        kind,
        createdAt: Date.now(),
        // 双端同步按 updatedAt 判谁更新；新建时与 createdAt 相同
        updatedAt: Date.now(),
      };
    },
    [chapters, cloud, paragraphs, windowBase]
  );

  // 书签落在「当前位置最近的非空段落」上，空行不会成为一张空白书签。
  const bookmarkTarget = useMemo(() => {
    if (!paragraphs.length) return -1;
    const start = clamp(currentPara, 0, paragraphs.length - 1);
    for (let i = start; i >= 0; i -= 1) {
      if (!paragraphs[i]?.blank) return i;
    }
    for (let i = start + 1; i < paragraphs.length; i += 1) {
      if (!paragraphs[i]?.blank) return i;
    }
    return -1;
  }, [currentPara, paragraphs]);

  const marksByPara = useMemo(() => {
    const map = new Map();
    bookMarks.forEach((mark) => {
      const index = absoluteParaForMark(mark);
      if (index == null || index < 0 || index >= paragraphs.length) return;
      const entry = map.get(index) || { bookmark: false, highlights: [] };
      if (mark.kind === 'bookmark') entry.bookmark = true;
      else entry.highlights.push(mark);
      map.set(index, entry);
    });
    return map;
  }, [absoluteParaForMark, bookMarks, paragraphs.length]);

  const isBookmarked = !!marksByPara.get(bookmarkTarget)?.bookmark;

  const toggleBookmark = useCallback(() => {
    const index = bookmarkTarget;
    if (index < 0) return;
    const existing = bookMarks.find(
      (mark) => mark.kind === 'bookmark' && absoluteParaForMark(mark) === index
    );
    if (existing) {
      saveBookMarks(bookId, bookMarks.filter((mark) => mark.id !== existing.id));
      notify('已取消书签');
    } else {
      saveBookMarks(bookId, [...bookMarks, buildMark(index, 'bookmark')]);
      notify('已加书签');
    }
    wakeUI();
  }, [
    absoluteParaForMark,
    bookId,
    bookMarks,
    bookmarkTarget,
    buildMark,
    notify,
    saveBookMarks,
    wakeUI,
  ]);

  const toggleHighlight = useCallback(
    (paraIndex, excerpt) => {
      const existing = bookMarks.find(
        (mark) => mark.kind === 'highlight' && absoluteParaForMark(mark) === paraIndex
      );
      if (existing) {
        // 带笔记的划线不直接删：先打开笔记框，避免误删用户写过的东西
        if (existing.note) {
          setNoteTarget({ markId: existing.id, paraIndex, excerpt: existing.excerpt });
          return;
        }
        saveBookMarks(bookId, bookMarks.filter((mark) => mark.id !== existing.id));
        notify('已取消划线');
        return;
      }
      saveBookMarks(bookId, [...bookMarks, buildMark(paraIndex, 'highlight', excerpt)]);
      notify('已划线');
      setSelection(null);
    },
    [absoluteParaForMark, bookId, bookMarks, buildMark, notify, saveBookMarks, setSelection]
  );

  const openNoteFor = useCallback(
    (paraIndex, excerpt) => {
      const existing = bookMarks.find(
        (mark) => mark.kind === 'highlight' && absoluteParaForMark(mark) === paraIndex
      );
      setNoteTarget({
        markId: existing?.id || null,
        paraIndex,
        excerpt: existing?.excerpt || excerpt,
      });
      setSelection(null);
    },
    [absoluteParaForMark, bookMarks, setSelection]
  );

  const saveNote = useCallback(
    (text) => {
      const target = noteTarget;
      if (!target) return;
      const note = String(text || '').trim();
      if (target.markId) {
        saveBookMarks(
          bookId,
          bookMarks.map((mark) =>
            mark.id === target.markId ? { ...mark, note, updatedAt: Date.now() } : mark
          )
        );
      } else if (note) {
        saveBookMarks(bookId, [
          ...bookMarks,
          buildMark(target.paraIndex, 'highlight', target.excerpt, note),
        ]);
      }
      setNoteTarget(null);
      notify(note ? '笔记已保存' : '笔记已清空');
    },
    [bookId, bookMarks, buildMark, noteTarget, notify, saveBookMarks]
  );

  const updateNote = useCallback(
    (id, text) => {
      saveBookMarks(
        bookId,
        bookMarks.map((mark) =>
          mark.id === id ? { ...mark, note: String(text || '').trim(), updatedAt: Date.now() } : mark
        )
      );
      notify('笔记已保存');
    },
    [bookId, bookMarks, notify, saveBookMarks]
  );

  const removeMark = useCallback(
    (id) => {
      saveBookMarks(bookId, bookMarks.filter((mark) => mark.id !== id));
      notify('已删除痕迹');
    },
    [bookId, bookMarks, notify, saveBookMarks]
  );

  const jumpToMark = useCallback(
    (mark) => {
      setActiveHit(null);
      const index = absoluteParaForMark(mark);
      if (index == null) {
        if (Number(mark.chapterNo) >= 0) cloud?.onJump?.(Number(mark.chapterNo));
        notify('这一章不在当前窗口，正在跳转');
        return;
      }
      setAutoScroll(false);
      playSettle();
      animateScroll(getOffset(index), 480);
      setCurrentPara(index);
    },
    [
      absoluteParaForMark,
      animateScroll,
      cloud,
      getOffset,
      notify,
      playSettle,
      setActiveHit,
      setAutoScroll,
      setCurrentPara,
    ]
  );

  return {
    noteTarget,
    setNoteTarget,
    bookmarkTarget,
    marksByPara,
    isBookmarked,
    toggleBookmark,
    toggleHighlight,
    openNoteFor,
    saveNote,
    updateNote,
    removeMark,
    jumpToMark,
  };
}
