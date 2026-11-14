/**
 * 云端漫画的取图代理 —— 手机上只拿「第几页」和字节，拿不到也猜不到源站地址。
 *
 * 为什么按页索引而不是按 URL 转发：
 *  1. 源站有 Referer / Cookie 校验，手机直连必 403；
 *  2. 「章节地址不出机器」是桌面端既有原则，漫画页地址同理；
 *  3. 不给手机一个「随便传个 URL 我就去取」的代理口，从根上消除 SSRF。
 *
 * 缓存（都只在内存，绝不落盘）：
 *  - 清单 LRU(32)：`(bookId, 话序号) → 源站图片 URL 列表 + Referer`。
 *  - 字节 LRU(32MiB)：`(bookId, 话, 页) → {buffer, type}`。产品拍板要做，
 *    目的是「翻回上一页」不用重拉源站；弱网下这一下能省 1–2 秒。
 *    缓存只活在这个进程里，退出即消失，符合桌面端「不留缓存副本」的约束。
 */

/** 单页图片上限 6MiB，超过就 413（手机端会显示「这一页太大」）。 */
export const MAX_IMAGE = 6 * 1024 * 1024;
/** 清单缓存条数上限。 */
export const MANIFEST_LIMIT = 32;
/** 图片字节缓存上限 32MiB。 */
export const IMAGE_CACHE_BYTES = 32 * 1024 * 1024;

/**
 * 极简 LRU：Map 的插入顺序就是使用顺序，命中时删了再插回尾部。
 * @param {number} capacity 容量（条数或字节数，由 weigh 决定）
 * @param {(value:any)=>number} [weigh] 单条权重，缺省 1
 */
function createLru(capacity, weigh = () => 1) {
  const map = new Map();
  let used = 0;

  function drop(key) {
    const value = map.get(key);
    if (value === undefined) return;
    map.delete(key);
    used -= weigh(value);
  }

  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      // 命中：删了再塞回去，保证它排在「最新使用」的一端
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      if (map.has(key)) drop(key);
      map.set(key, value);
      used += weigh(value);
      // 超容量就从最旧的一端一路淘汰，至少留一条，避免单条超大把缓存清空
      while (used > capacity && map.size > 1) {
        const oldest = map.keys().next().value;
        drop(oldest);
      }
    },
    clear() {
      map.clear();
      used = 0;
    },
    get size() {
      return map.size;
    },
    get bytes() {
      return used;
    },
  };
}

/** 从 URL 猜图片类型，源站不给 Content-Type 时兜底。 */
function typeFromUrl(url) {
  const match = String(url || '').match(/\.(jpe?g|png|webp|gif|avif|bmp)(?:\?|#|$)/i);
  if (!match) return 'image/jpeg';
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
}

/**
 * 造一个漫画代理。
 *
 * @param {object} opts
 * @param {(book:object, index:number)=>Promise<{urls?:string[], referer?:string, error?:string}>} opts.images
 *        由主进程提供（复用 `cloud:chapter-images` 那条链路），只看得到 book + 话号
 * @param {(url:string, referer:string)=>Promise<{buffer?:Buffer, type?:string, tooLarge?:boolean}|null>} opts.fetchImage
 *        由主进程提供（复用 `fetchCoverResponse`：12s 超时、重试 1 次、带 Referer）
 * @param {(level:string, msg:string, meta?:object)=>void} [opts.log]
 * @param {number} [opts.manifestLimit]
 * @param {number} [opts.byteLimit]
 */
export function createComicService(opts = {}) {
  const {
    images = null,
    fetchImage = null,
    log = () => {},
    manifestLimit = MANIFEST_LIMIT,
    byteLimit = IMAGE_CACHE_BYTES,
  } = opts;

  const manifests = createLru(manifestLimit);
  const bytes = createLru(byteLimit, (item) => item?.buffer?.length || 0);
  // 同一话的清单可能被并发请求（手机预取 + 用户点按），合并成一次抓取
  const pending = new Map();

  const manifestKey = (bookId, index) => `${bookId}|${index}`;
  const imageKey = (bookId, index, page) => `${bookId}|${index}|${page}`;

  /** 校验「这是不是一本能取图的漫画」，返回错误对象或 null。 */
  function guard(book, index) {
    if (!book) return { ok: false, status: 404, error: '书架上没有这本书' };
    if (Number(book.type) !== 2) return { ok: false, status: 400, error: '这不是漫画书' };
    if (!Number.isInteger(index) || index < 0) return { ok: false, status: 400, error: '话号不对' };
    if (typeof images !== 'function' || typeof fetchImage !== 'function') {
      return { ok: false, status: 501, error: '当前版本没有接入漫画取图' };
    }
    return null;
  }

  /**
   * 取「这一话的图片清单」。命中缓存直接回，否则问主进程抓一次。
   * 返回的 urls 永远不出这个函数 —— 对外的 pages() 只回条数。
   */
  async function manifest(book, index) {
    const key = manifestKey(book.id, index);
    const hit = manifests.get(key);
    if (hit) return { ok: true, urls: hit.urls, referer: hit.referer, fromCache: true };
    if (pending.has(key)) return pending.get(key);

    const job = (async () => {
      try {
        const result = await images(book, index);
        if (result?.error && !Array.isArray(result?.urls)) {
          return { ok: false, status: 502, error: String(result.error || '漫画清单获取失败') };
        }
        const urls = Array.isArray(result?.urls)
          ? result.urls.filter((item) => typeof item === 'string' && item).slice(0, 400)
          : [];
        if (!urls.length) {
          return { ok: false, status: 502, error: result?.error || '这一话没解析到图片' };
        }
        const referer = String(result?.referer || '');
        manifests.set(key, { urls, referer });
        return { ok: true, urls, referer, fromCache: false };
      } catch (err) {
        log('warn', `漫画清单抓取失败：${err?.message || err}`);
        return { ok: false, status: 502, error: '漫画清单获取失败，请稍后重试' };
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, job);
    return job;
  }

  /**
   * `GET /api/comic/:id/pages?i=N` —— 只有总数，没有 URL。
   */
  async function pages(book, index) {
    const bad = guard(book, index);
    if (bad) return bad;
    const result = await manifest(book, index);
    if (!result.ok) return result;
    return { ok: true, index, total: result.urls.length, fromCache: result.fromCache };
  }

  /**
   * `GET /api/comic/:id/page?i=N&p=K` —— 单页字节。
   */
  async function image(book, index, page) {
    const bad = guard(book, index);
    if (bad) return bad;
    const result = await manifest(book, index);
    if (!result.ok) return result;
    const total = result.urls.length;
    if (!Number.isInteger(page) || page < 0 || page >= total) {
      return { ok: false, status: 400, error: '页号超出了这一话的总页数', total };
    }

    const key = imageKey(book.id, index, page);
    const cached = bytes.get(key);
    if (cached) {
      return { ok: true, buffer: cached.buffer, type: cached.type, total, page };
    }

    const url = result.urls[page];
    const referer = result.referer || url;
    let fetched = null;
    try {
      fetched = await fetchImage(url, referer);
    } catch (err) {
      log('warn', `漫画取图失败：${err?.message || err}`);
      fetched = null;
    }
    if (fetched?.tooLarge) {
      return { ok: false, status: 413, error: '这一页太大（超过 6MB），手机端无法显示', total };
    }
    const buffer = fetched?.buffer;
    if (!buffer || !buffer.length) {
      return { ok: false, status: 502, error: '源站没有返回这张图', total };
    }
    if (buffer.length > MAX_IMAGE) {
      return { ok: false, status: 413, error: '这一页太大（超过 6MB），手机端无法显示', total };
    }
    const type = String(fetched?.type || '').startsWith('image/') ? fetched.type : typeFromUrl(url);
    bytes.set(key, { buffer, type });
    return { ok: true, buffer, type, total, page };
  }

  /** 诊断用：缓存里现在有多少条、多少字节。绝不包含 URL 或图片内容。 */
  function stats() {
    return { manifests: manifests.size, images: bytes.size, imageBytes: bytes.bytes };
  }

  /** 清空两档缓存（局域网服务停止时调用，内存立刻归还）。 */
  function clear() {
    manifests.clear();
    bytes.clear();
    pending.clear();
  }

  return { pages, image, stats, clear };
}
