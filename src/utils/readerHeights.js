/* 正文排版测量的批次与段落高度缓存。
 *
 * 从 Reader.jsx 抽出来：这一块只有「算数 + localStorage」，和 React 无关，
 * 放独立文件才能单测，也让阅读器组件只留渲染与交互。
 */

// 排版测量每批处理多少段（越大越快、越容易掉帧）。
// 真实批大小由 measureChunkSize() 按书的大小放大，小书的行为保持不变。
const MEASURE_CHUNK = 600;
// 单批上限：再大就是一次几百毫秒的长任务，进度条会「卡住」而不是「走得快」。
const MEASURE_CHUNK_MAX = 24000;
// 目标总帧数：整本测量摊到约 16 帧。44 万段的长篇按每帧 600 段要跑 730 多帧（十几秒），
// 放大批次后同样的书约 16 帧就量完 —— 每帧重一点，但总时长少一个数量级。
const MEASURE_FRAMES = 16;
// 超过这个段落数才显示「正在排版」提示，小书瞬间就好
export const MEASURE_HINT_MIN = 400;

/* 段落高度缓存：同一本书 + 同一排版 + 同一栏宽，第二次打开直接命中，不再跑测量。
 *
 * 以前用 JSON 小数数组存，40 万段就要 4MB 左右，既超 localStorage 配额、又被
 * HEIGHT_CACHE_MAX 拦下，于是「超长篇小说永远命中不了缓存，每次打开整本重排」。
 * 现在改成 Uint16 二进制 + base64：40 万段约 880KB（base64 后 1.2MB），
 * 长篇也存得下。第 0 位存栏宽，读取时校验栏宽是否还对得上。
 */
const HEIGHT_CACHE_PREFIX = 'folio:heights:';
const HEIGHT_CACHE_MAX = 1200000;
// 进程内缓存：同一会话里重开书连 localStorage 都不用读。
const heightMemCache = new Map();
const HEIGHT_MEM_MAX = 4;

/** 按书的大小决定每批测量多少段：小书 600，大书放大到 ~16 帧量完。 */
export function measureChunkSize(count) {
  return Math.max(MEASURE_CHUNK, Math.min(MEASURE_CHUNK_MAX, Math.ceil(count / MEASURE_FRAMES)));
}

/**
 * 正文内容指纹：同一本书被书源重新抓取后，段落数可能没变、内容却变了。
 * 只按段落数做缓存键会把旧高度表套到新正文上（换了几段、多截了一章都中招），
 * 所以把「总字数 + 逐段字数的滚动哈希」并进键里。四十万段也只多花几毫秒。
 */
export function contentFingerprint(paragraphs) {
  let total = 0;
  let mix = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const len = (paragraphs[i]?.text || '').length;
    total += len;
    mix = (mix * 31 + len) % 2147483647;
  }
  return `${total.toString(36)}-${mix.toString(36)}`;
}

export function heightStorageKey(key, width) {
  return `${HEIGHT_CACHE_PREFIX}${key}|${width}`;
}

function rememberHeights(storageKey, heights) {
  heightMemCache.set(storageKey, heights);
  if (heightMemCache.size > HEIGHT_MEM_MAX) {
    heightMemCache.delete(heightMemCache.keys().next().value);
  }
}

export function encodeHeights(width, heights) {
  // [0] = 栏宽，[1..] = 每段高度。段落高度不可能超过 65535px，Uint16 够用。
  const bin = new Uint16Array(heights.length + 1);
  bin[0] = Math.max(0, Math.min(65535, Math.round(width)));
  for (let i = 0; i < heights.length; i += 1) {
    bin[i + 1] = Math.max(0, Math.min(65535, Math.round(heights[i] || 0)));
  }
  const bytes = new Uint8Array(bin.buffer);
  // 分块转字符：一次 apply 几十万个参数会直接爆调用栈
  const BLOCK = 0x8000;
  let raw = '';
  for (let i = 0; i < bytes.length; i += BLOCK) {
    raw += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK));
  }
  return btoa(raw);
}

export function decodeHeights(raw) {
  const text = atob(raw);
  const bin = new Uint16Array(text.length >> 1);
  const bytes = new Uint8Array(bin.buffer);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bin;
}

export function loadHeights(key, width) {
  const storageKey = heightStorageKey(key, width);
  const mem = heightMemCache.get(storageKey);
  if (mem) return mem;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const bin = decodeHeights(raw);
    if (bin.length < 2) return null;
    // 栏宽差 1px 以内仍算同一套排版（缩放/滚动条会让宽度抖动 1px）
    if (Math.abs(bin[0] - width) > 1) return null;
    const heights = new Float64Array(bin.length - 1);
    for (let i = 0; i < heights.length; i += 1) heights[i] = bin[i + 1];
    rememberHeights(storageKey, heights);
    return heights;
  } catch {
    return null;
  }
}

/** 这本书 + 这套排版有没有缓存（只查键名，不解码上百万字节）。 */
export function hasHeights(key) {
  const prefix = `${HEIGHT_CACHE_PREFIX}${key}|`;
  for (const storageKey of heightMemCache.keys()) {
    if (storageKey.startsWith(prefix)) return true;
  }
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const storageKey = window.localStorage.key(i);
      if (storageKey && storageKey.startsWith(prefix)) return true;
    }
  } catch {
    /* 拿不到 storage 就当作没有 */
  }
  return false;
}

/** 同一本书只留一份缓存：栏宽变了就丢掉旧栏宽那份，避免换几次窗口宽度把配额塞满。 */
function pruneHeights(key, keepStorageKey) {
  const prefix = `${HEIGHT_CACHE_PREFIX}${key}|`;
  try {
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const storageKey = window.localStorage.key(i);
      if (storageKey && storageKey.startsWith(prefix) && storageKey !== keepStorageKey) {
        doomed.push(storageKey);
      }
    }
    doomed.forEach((storageKey) => window.localStorage.removeItem(storageKey));
  } catch {
    /* 拿不到 storage 就算了 */
  }
}

function dropOtherHeights(keepKey) {
  try {
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(HEIGHT_CACHE_PREFIX) && key !== keepKey) {
        doomed.push(key);
      }
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* 拿不到 storage 就算了 */
  }
}

export function saveHeights(key, width, heights) {
  if (!heights || heights.length > HEIGHT_CACHE_MAX) return;
  const storageKey = heightStorageKey(key, width);
  rememberHeights(storageKey, heights);
  const payload = encodeHeights(width, heights);
  try {
    pruneHeights(key, storageKey);
    window.localStorage.setItem(storageKey, payload);
  } catch {
    // 写不进去多半是配额满了：先把别本书的旧记录清掉再试一次，
    // 否则这本书永远命中不了缓存，每次打开都要重新排版。
    dropOtherHeights(storageKey);
    try {
      window.localStorage.setItem(storageKey, payload);
    } catch {
      /* 还是不行就算了，下次再测 */
    }
  }
}
