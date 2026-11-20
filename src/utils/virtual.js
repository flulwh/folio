import { sortedLastIndex } from './sortedIndex.js';

/**
 * 虚拟滚动的纯计算：前缀偏移表 ↔ 段落索引。
 *
 * 滚动容器只在书里开一个窗口，scrollTop 是窗口内的物理位置；真正的
 * 「逻辑偏移」还要加上 origin。这两者之间的换算放在这里，恢复位置、
 * 可视范围计算和落位断言共用同一套规则，避免各算各的。
 */

// scrollTop 是小数（显示缩放），落在段落边界下方一点点会被误判成上一段。
// 1px 容差把「刚好在边界上」归到下一段，与 getScrollState 的口径一致。
const TOLERANCE = 1;

/** 逻辑偏移 top 落在哪一段：最后一个 offset <= top 的段落。 */
export function indexAtOffset(offsets, count, top, tolerance = TOLERANCE) {
  if (!count || count <= 0) return 0;
  // 尾部哨兵（offsets[count]）是总高，不参与探测；上界探针取「最后一个 <= top」。
  const upper = sortedLastIndex(offsets, top + tolerance, count);
  return upper > 0 ? upper - 1 : 0;
}

/**
 * 段落索引 → 顶部逻辑偏移。
 * 索引越界（存档来自其它版本/其它段落数）时夹到 [0, count-1]，
 * 不能让它读到哨兵槽，否则会滚到「书尾之后」。
 */
export function offsetOfIndex(offsets, index, count) {
  if (!count || count <= 0) return 0;
  const raw = Number.isFinite(index) ? Math.trunc(index) : 0;
  const clamped = Math.max(0, Math.min(raw, count - 1));
  return offsets[clamped] ?? 0;
}

/** scrollTop（窗口内物理像素）+ origin（窗口起点）→ 段落索引。 */
export function indexAtScrollTop(offsets, count, scrollTop, origin = 0, tolerance = TOLERANCE) {
  return indexAtOffset(offsets, count, (origin || 0) + (scrollTop || 0), tolerance);
}

/** 把任意索引夹进 [0, count-1]；空书返回 0。 */
export function clampIndex(index, count) {
  if (!count || count <= 0) return 0;
  const raw = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.max(0, Math.min(raw, count - 1));
}
