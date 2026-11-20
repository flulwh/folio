import { useCallback, useEffect, useRef, useState } from 'react';
import { findMatchRange, searchBook } from '../utils/search.js';

/**
 * 全文搜索：防抖检索、命中游标与跳转。
 *
 * 从 Reader.jsx 抽出来。滚动动作由 Reader 注入（阅读位置归虚拟滚动管），
 * 这里只管「搜什么、命中第几条、跳过去时高亮哪一段」。
 */
export function useReaderSearch({
  open,
  paragraphs,
  chapters,
  setAutoScroll,
  playSettle,
  animateScroll,
  getOffset,
  setCurrentPara,
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState([]);
  const [cursor, setCursor] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [activeHit, setActiveHit] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!open || !query.trim()) {
      setHits([]);
      setCursor(-1);
      setSearching(false);
      setActiveHit(null);
      return undefined;
    }
    setSearching(true);
    setActiveHit(null);
    const keyword = query.trim();
    timer.current = setTimeout(() => {
      const found = searchBook(paragraphs, chapters, keyword);
      setHits(found);
      setCursor(found.length ? 0 : -1);
      setSearching(false);
    }, 260);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, query, paragraphs, chapters]);

  // 卸载时清掉排队中的防抖任务
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const jumpToHit = useCallback(
    (hit, index) => {
      if (!hit) return;
      const text = paragraphs[hit.paraIndex]?.text || '';
      const range = findMatchRange(text, query) || {
        start: Math.max(0, hit.start),
        end: Math.max(1, hit.end),
      };
      setActiveHit({ paraIndex: hit.paraIndex, start: range.start, end: range.end });
      setCursor(index);
      setAutoScroll(false);
      playSettle();
      animateScroll(getOffset(hit.paraIndex), 420);
      setCurrentPara(hit.paraIndex);
    },
    [animateScroll, getOffset, paragraphs, playSettle, query, setAutoScroll, setCurrentPara]
  );

  const stepHit = useCallback(
    (direction) => {
      if (!hits.length) return;
      const base = cursor < 0 ? (direction > 0 ? -1 : 0) : cursor;
      const next = (base + direction + hits.length) % hits.length;
      jumpToHit(hits[next], next);
    },
    [jumpToHit, cursor, hits]
  );

  return { query, setQuery, hits, cursor, searching, activeHit, setActiveHit, jumpToHit, stepHit };
}
