/**
 * 书源仓库（Yiove 书源仓库）客户端。
 *
 * 仓库站点 https://shuyuan.yiove.com 是纯前端应用，数据来自
 * https://shuyuan-api.yiove.com：
 *   GET /shuyuan/book-sources?page&page_size                 → { items, total, page, size, pages }
 *   GET /shuyuan/book-source-collections?page&page_size      → 同上（合集）
 *   GET /shuyuan/search?search_key&search_type&page&page_size
 *   GET /import/book-source/{uuid}                           → Legado 书源数组（1 条）
 *   GET /import/book-sources/{from}-{to}                     → 按序号区间取（从 1 开始）
 *   GET /import/book-source-collection/{uuid}                → 合集里的全部书源
 *
 * 这里只负责「取数据」，写入/合并仍复用 main.js 里的 importSources / importRules，
 * 这样仓库导入与本地文件、订阅链接导入走完全相同的归一化与去重逻辑。
 */

export const REPO_API = 'https://shuyuan-api.yiove.com';
const REPO_NAME = '书源仓库';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const LIST_TTL = 3 * 60 * 1000;
const MAX_RANGE = 200;

const listCache = new Map();

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url || '').slice(0, 40);
  }
}

function normalizeItem(raw, type) {
  const created = Number(raw?.create_time) || 0;
  return {
    id: String(raw?.id || ''),
    name: String(raw?.name || '').trim() || '未命名',
    url: String(raw?.url || '').trim(),
    host: hostOf(raw?.url),
    description: String(raw?.description || '').trim(),
    valid: raw?.is_valid !== false,
    views: Number(raw?.view_total) || 0,
    count: Number(raw?.total) || 0,
    createdAt: created ? Math.round(created * 1000) : 0,
    type,
  };
}

function networkMessage(err) {
  const raw = String(err?.message || err || '');
  if (/abort|timed? ?out|ETIMEDOUT/i.test(raw)) return `连不上${REPO_NAME}（连接超时）`;
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(raw)) return `连不上${REPO_NAME}（域名解析失败）`;
  if (/ECONNREFUSED/i.test(raw)) return `连不上${REPO_NAME}（连接被拒绝）`;
  if (/HTTP 4\d\d/.test(raw) || /HTTP 5\d\d/.test(raw)) return `${REPO_NAME}${raw.replace(/^仓库/, '')}`;
  return `${REPO_NAME}请求失败：${raw || '未知错误'}`;
}

async function getJson(path, { timeout = 20000 } = {}) {
  const url = path.startsWith('http') ? path : `${REPO_API}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*' },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('返回的不是 JSON');
    }
  } catch (err) {
    throw new Error(networkMessage(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 列出仓库条目。
 * @param {{type?: 'sources'|'collections', keyword?: string, page?: number, pageSize?: number}} options
 */
export async function listRepo({ type = 'sources', keyword = '', page = 1, pageSize = 20 } = {}) {
  const kind = type === 'collections' ? 'collections' : 'sources';
  const size = Math.min(50, Math.max(5, Number(pageSize) || 20));
  const current = Math.max(1, Number(page) || 1);
  const word = String(keyword || '').trim();

  const path = word
    ? `/shuyuan/search?search_key=${encodeURIComponent(word)}&search_type=${
        kind === 'collections' ? 'book-source-collections' : 'book-sources'
      }&page=${current}&page_size=${size}`
    : `${kind === 'collections' ? '/shuyuan/book-source-collections' : '/shuyuan/book-sources'}?page=${current}&page_size=${size}`;

  const hit = listCache.get(path);
  if (hit && Date.now() - hit.at < LIST_TTL) return hit.data;

  const data = await getJson(path);
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const total = Number(data?.total) || rawItems.length;
  const result = {
    ok: true,
    type: kind,
    keyword: word,
    items: rawItems.map((item) => normalizeItem(item, kind)),
    total,
    page: Number(data?.page) || current,
    pageSize: Number(data?.size) || size,
    pages: Number(data?.pages) || Math.max(1, Math.ceil(total / size)),
  };
  listCache.set(path, { at: Date.now(), data: result });
  return result;
}

/**
 * 取仓库里要导入的原始条目（Legado 书源数组或替换规则数组）。
 * @param {{mode?: 'single'|'range'|'collection', id?: string, from?: number, to?: number, collectionId?: string}} payload
 */
export async function fetchRepoPayload({ mode = 'single', id = '', from = 0, to = 0, collectionId = '' } = {}) {
  let path = '';
  if (mode === 'range') {
    const start = Math.max(1, Number(from) || 1);
    const end = Math.max(start, Number(to) || start);
    if (end - start + 1 > MAX_RANGE) throw new Error(`一次最多导入 ${MAX_RANGE} 个书源`);
    path = `/import/book-sources/${start}-${end}`;
  } else if (mode === 'collection') {
    if (!collectionId) throw new Error('缺少合集 id');
    path = `/import/book-source-collection/${encodeURIComponent(collectionId)}`;
  } else {
    if (!id) throw new Error('缺少书源 id');
    path = `/import/book-source/${encodeURIComponent(id)}`;
  }

  const data = await getJson(path, { timeout: 60000 });
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  if (!items.length) throw new Error('仓库没有返回可导入的内容');
  return { items, path };
}

export function clearRepoCache() {
  listCache.clear();
}
