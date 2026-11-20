/**
 * 虚拟列表：测量与区间交给 @tanstack/react-virtual。
 *
 * 这里只做两件事：
 *  - `useVirtualRows` 给需要自己掌控 DOM 的常规列表；
 *  - `VirtualList` 给固定/可变行高的常规列表（目录）。
 *
 * 阅读器需要自定义滚动坐标（2^25px 窗口平移），在 useVirtualScroll 里
 * 直接用 useVirtualizer，不走这一层。
 *
 * 滚动容器由调用方提供（`scrollRef`），本层不接管 scrollTop ——
 * 阅读器的 2^25px 窗口平移与位置恢复仍由现有逻辑负责。
 */
import React, { useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export function useVirtualRows({
  count,
  estimate,
  getKey,
  scrollRef,
  overscan = 6,
  onRangeChange,
}) {
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: typeof estimate === 'number' ? () => estimate : estimate,
    getItemKey: getKey,
    overscan,
  });

  const items = virtualizer.getVirtualItems();
  const first = items.length ? items[0].index : 0;
  const last = items.length ? items[items.length - 1].index : -1;

  useEffect(() => {
    onRangeChange?.({ first, last });
  }, [first, last, onRangeChange]);

  return virtualizer;
}

export function VirtualList({
  count,
  estimate,
  getKey,
  scrollRef,
  overscan = 6,
  onRangeChange,
  renderRow,
  className,
  style,
  virtualizerRef,
}) {
  const virtualizer = useVirtualRows({ count, estimate, getKey, scrollRef, overscan, onRangeChange });

  // 让调用方拿到实例做程序化滚动（目录的「定位到当前章 / 键盘上下」）。
  useEffect(() => {
    if (!virtualizerRef) return undefined;
    virtualizerRef.current = virtualizer;
    return () => {
      if (virtualizerRef.current === virtualizer) virtualizerRef.current = null;
    };
  }, [virtualizer, virtualizerRef]);

  return (
    <div
      className={className}
      style={{ position: 'relative', height: virtualizer.getTotalSize(), ...style }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${row.start}px)`,
          }}
        >
          {renderRow(row.index, row)}
        </div>
      ))}
    </div>
  );
}
