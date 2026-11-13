export function formatPercent(value) {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value >= 99.95) return '100%';
  return `${Math.round(value * 10) / 10}%`;
}

export function formatCount(n) {
  if (!n || n < 0) return '0';
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** Rough remaining reading time, based on ~420 CJK chars per minute. */
export function estimateRemainingMinutes(charsLeft, cjkPerMinute = 420) {
  const minutes = Math.max(0, charsLeft) / cjkPerMinute;
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `约 ${Math.round(minutes)} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `约 ${h} 小时${m ? ` ${m} 分钟` : ''}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Decode an ArrayBuffer as UTF-8/UTF-16, falling back to GBK (Chinese txt). */
export function decodeBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    } catch {
      const body = bytes.subarray(2);
      const swapped = new Uint8Array(body.length);
      for (let i = 0; i + 1 < body.length; i += 2) {
        swapped[i] = body[i + 1];
        swapped[i + 1] = body[i];
      }
      return new TextDecoder('utf-16le').decode(swapped);
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

export function isProbablyTextFile(name) {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.markdown') ||
    lower.endsWith('.text')
  );
}
