/**
 * Ordered-array search helpers.
 *
 * Vendored from lodash (MIT) — github.com/lodash/lodash, `baseSortedIndex`
 * / `sortedIndex` / `sortedLastIndex` — reduced to the numeric, in-range form
 * used by this app. Copyright (c) JS Foundation and other contributors.
 * https://github.com/lodash/lodash/blob/main/LICENSE
 *
 * `end` bounds the probe to [0, end) so callers can ignore the trailing
 * sentinel slot of a prefix-offset table; `get` maps objects to a sort key.
 * Values that are null/undefined never compare as a match, which mirrors the
 * behaviour of the hand-rolled binary searches these helpers replace.
 */

function baseSortedIndex(values, value, start, end, get, retHighest) {
  let low = start;
  let high = end;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const computed = get ? get(values[mid]) : values[mid];
    if (computed !== null && (retHighest ? computed <= value : computed < value)) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return high;
}

/** First index in [start, end) whose value is >= value, or end when none. */
export function sortedIndexFrom(values, value, start, end, get = null) {
  return baseSortedIndex(values, value, start, end, get, false);
}

/** First index in [0, end) whose value is > value, or end when none. */
export function sortedLastIndex(values, value, end = values.length, get = null) {
  return baseSortedIndex(values, value, 0, end, get, true);
}
