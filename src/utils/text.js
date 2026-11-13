/** Small text helpers shared by shelf + market. */

const TAG_SUFFIX = /\s*\[[^\]]{1,8}\]\s*$/;

/**
 * Source names often carry an exporter tag like `溜达小说[to]`.
 * Drop that bracket suffix for display, keep parentheses (they read as part
 * of the site name: 包子漫画(APP)).
 */
export function cleanSourceName(name) {
  const text = String(name || '').trim();
  if (!text) return '';
  return text.replace(TAG_SUFFIX, '').trim() || text;
}

/** Short uppercase label for a source's origin, used in badges. */
export function sourceInitial(name) {
  const text = cleanSourceName(name);
  return text ? text.slice(0, 1) : '书';
}
