/**
 * 更新检查与公告拉取。
 *
 * 数据只来自 GitHub 的静态资源，不经过任何自建服务：
 *  - 版本：GitHub Releases API（桌面端只认 `v*` 标签，安卓端只认 `android-*`）；
 *  - 公告：官网 Pages 上的 `notice.json`。
 *
 * 网络失败一律降级成 `{ ok: false }`，绝不向渲染层抛异常：
 * 离线时检查更新只是「没查到」，不该弹错误框吓用户。
 */

export const RELEASES_URL = 'https://api.github.com/repos/flulwh/folio/releases?per_page=30';
export const NOTICE_URL = 'https://flulwh.github.io/folio/notice.json';

/** 桌面端发版标签；安卓端在 Android 侧用 `/^android-/`。 */
export const DESKTOP_TAG = /^v\d/;

/**
 * 解析版本号：去掉 `v` / `android-` 前缀与预发布后缀，取前导数字段。
 * 例：`v2.15.0` → [2,15,0]，`android-4.5.0` → [4,5,0]。
 */
export function parseVersion(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/^(?:v|android-)/i, '');
  const core = text.split(/[-+]/)[0];
  return core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** 比较两个版本号，返回 1 / 0 / -1。缺省段按 0 处理。 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * 从 Releases 列表里挑出最新的一条：跳过草稿与预发布，按标签版本号排序。
 * 不用接口返回顺序——它按发布时间排，热修一次旧线就会排错。
 */
export function pickRelease(releases, tagPattern = DESKTOP_TAG) {
  if (!Array.isArray(releases)) return null;
  const matched = releases.filter(
    (item) => item && !item.draft && !item.prerelease && tagPattern.test(String(item.tag_name || '')),
  );
  matched.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  return matched[0] || null;
}

async function fetchJson(url, fetchImpl = fetch, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: {
        // GitHub API 拒绝没有 UA 的请求；公告接口也一并带上，便于日志定位。
        'User-Agent': 'Folio-Desktop',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 检查桌面端是否有新版本。
 * @returns {Promise<{ok:boolean,current?:string,latest?:string,hasUpdate?:boolean,name?:string,url?:string,publishedAt?:string,notes?:string,error?:string}>}
 */
export async function checkForUpdates(current, options = {}) {
  const tagPattern = options.tagPattern || DESKTOP_TAG;
  try {
    const data = await fetchJson(RELEASES_URL, options.fetchImpl || fetch);
    const release = pickRelease(data, tagPattern);
    if (!release) return { ok: false, error: '没有找到可用版本' };
    const latest = String(release.tag_name).replace(/^v/i, '');
    return {
      ok: true,
      current: String(current || ''),
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      name: release.name || release.tag_name,
      url: release.html_url || '',
      publishedAt: release.published_at || '',
      notes: String(release.body || '').slice(0, 1500),
    };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? '请求超时' : err?.message || String(err);
    return { ok: false, error: reason };
  }
}

/**
 * 过滤公告：必须有 id 与标题；过期（`expiresAt` 早于今天）或显式
 * `active: false` 的不下发；按日期倒序，最多 10 条。
 */
export function normalizeNotices(payload, now = new Date()) {
  const list = Array.isArray(payload?.notices) ? payload.notices : [];
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return list
    .filter(
      (item) =>
        item &&
        item.active !== false &&
        typeof item.id === 'string' &&
        item.id.length > 0 &&
        typeof item.title === 'string' &&
        item.title.length > 0 &&
        (!item.expiresAt || String(item.expiresAt) >= today),
    )
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      title: item.title,
      body: typeof item.body === 'string' ? item.body : '',
      level: item.level === 'warn' ? 'warn' : 'info',
      date: typeof item.date === 'string' ? item.date : '',
      url: typeof item.url === 'string' && /^https?:\/\//i.test(item.url) ? item.url : '',
    }));
}

/** 拉取公告。断网时返回空列表而不是错误，调用方按「没有公告」处理即可。 */
export async function fetchNotices(options = {}) {
  try {
    const payload = await fetchJson(NOTICE_URL, options.fetchImpl || fetch);
    return { ok: true, notices: normalizeNotices(payload, options.now) };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? '请求超时' : err?.message || String(err);
    return { ok: false, notices: [], error: reason };
  }
}
