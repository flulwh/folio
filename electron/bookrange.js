/**
 * EPUB / PDF 的分段读取范围计算。
 *
 * 阅读器不再把整本书读进主进程内存，而是按渲染层要的偏移与长度现读一小段：
 * PDF 的 xref、对象流，EPUB 的 zip 中央目录与单个资源，都只需要自己的那一段。
 *
 * 这里只做纯计算（不碰磁盘），方便单测把边界钉死：
 *   - 偏移、长度必须是安全的非负整数；
 *   - 超出文件末尾的请求截到 EOF，不为不存在的字节分配内存；
 *   - 单次读取不超过上限，防止渲染层用一个大数字把主进程内存打满。
 *
 * 返回值要么 `{ offset, length }`，要么 `{ error }`（error 直接给人看）。
 */

/** 单次范围读取上限：普通章节/页面远小于它，超过说明请求本身不对劲。 */
export const MAX_RANGE_BYTES = 64 * 1024 * 1024;

export function normalizeRange(size, offset, length, maxBytes = MAX_RANGE_BYTES) {
  const total = Number(size);
  if (!Number.isFinite(total) || total < 0) return { error: '文件大小不合法' };

  const start = Number(offset);
  if (!Number.isInteger(start) || start < 0) return { error: '读取位置不合法' };

  const want = Number(length);
  if (!Number.isInteger(want) || want <= 0) return { error: '读取长度不合法' };

  if (start >= total) return { error: '读取位置超出文件末尾' };

  const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_RANGE_BYTES;
  return { offset: start, length: Math.min(want, total - start, cap) };
}
