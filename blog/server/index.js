import http from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, publicPost, DATA_DIR, UPLOAD_DIR } from './store.js';
import {
  ensureAdmin,
  checkPassword,
  createSessionToken,
  sessionCookie,
  clearCookie,
  isAuthed,
} from './auth.js';
import { seedPosts, seedSite } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.BLOG_PORT) || 8787;
const DEV = process.argv.includes('--dev');
const MAX_BODY = 10 * 1024 * 1024;

/* ---------- 数据 ---------- */

const site = readJson('site.json', null) ?? seedSite();
const posts = readJson('posts.json', null) ?? seedPosts();
if (!existsSync(path.join(DATA_DIR, 'site.json'))) writeJson('site.json', site);
if (!existsSync(path.join(DATA_DIR, 'posts.json'))) writeJson('posts.json', posts);

const savePosts = () => writeJson('posts.json', posts);
const saveSite = () => writeJson('site.json', site);

/* ---------- 工具 ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function fail(res, status, message) {
  json(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function slugify(input) {
  const base = String(input || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `post-${Date.now().toString(36)}`;
}

function uniqueSlug(desired, exceptId) {
  let slug = desired;
  let index = 2;
  while (posts.some((post) => post.slug === slug && post.id !== exceptId)) {
    slug = `${desired}-${index}`;
    index += 1;
  }
  return slug;
}

function readingMinutes(markdown) {
  const text = String(markdown || '').replace(/```[\s\S]*?```/g, ' ');
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.match(/[a-zA-Z0-9]+/g) || []).length;
  return Math.max(1, Math.round(cjk / 350 + words / 220));
}

function excerptFrom(markdown) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 110);
}

/* ---------- 登录限速 ---------- */

const attempts = new Map();
const WINDOW = 10 * 60 * 1000;
const LIMIT = 8;

function tooManyAttempts(ip) {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || record.resetAt < now) return false;
  return record.count >= LIMIT;
}

function noteAttempt(ip) {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || record.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW });
    return;
  }
  record.count += 1;
}

/* ---------- 上传 ---------- */

const IMAGE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function saveImage({ name, dataUrl }) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) throw new Error('只支持 PNG / JPEG / WebP / GIF');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('图片不能超过 8MB');
  const stem = slugify(String(name || 'image').replace(/\.[^.]+$/, '')).slice(0, 40);
  const file = `${stem}-${randomBytes(4).toString('hex')}${IMAGE_EXT[match[1]]}`;
  writeFileSync(path.join(UPLOAD_DIR, file), buffer);
  return `/uploads/${file}`;
}

/* ---------- 静态文件 ---------- */

function serveFile(res, file, cache) {
  const ext = path.extname(file).toLowerCase();
  const stat = statSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
  });
  createReadStream(file).pipe(res);
}

function serveStatic(req, res, pathname) {
  if (pathname.startsWith('/uploads/')) {
    const name = path.basename(pathname);
    const file = path.join(UPLOAD_DIR, name);
    if (!existsSync(file)) return fail(res, 404, '文件不存在');
    return serveFile(res, file, 'public, max-age=31536000, immutable');
  }
  if (DEV) return fail(res, 404, '开发模式请访问 Vite 端口');

  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(DIST, safe);
  const insideDist = file === DIST || file.startsWith(DIST + path.sep);
  if (insideDist && existsSync(file) && statSync(file).isFile()) {
    return serveFile(res, file, /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
  }
  const index = path.join(DIST, 'index.html');
  if (existsSync(index)) return serveFile(res, index, 'no-cache');
  return fail(res, 404, '尚未构建前端，请先 npm run build');
}

/* ---------- 路由 ---------- */

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method || 'GET';
  const authed = isAuthed(req);

  if (!pathname.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') return fail(res, 405, '不支持的方法');
    return serveStatic(req, res, pathname);
  }

  /* 公开接口 */

  if (pathname === '/api/site' && method === 'GET') {
    return json(res, 200, site);
  }

  if (pathname === '/api/posts' && method === 'GET') {
    const list = posts
      .filter((post) => post.status === 'published')
      .sort((a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt)))
      .map(publicPost);
    return json(res, 200, list);
  }

  if (pathname.startsWith('/api/posts/') && method === 'GET') {
    const slug = pathname.slice('/api/posts/'.length);
    const post = posts.find((item) => item.slug === slug && item.status === 'published');
    if (!post) return fail(res, 404, '文章不存在');
    return json(res, 200, post);
  }

  /* 后台接口 */

  if (pathname === '/api/admin/login' && method === 'POST') {
    const ip = req.socket.remoteAddress || 'local';
    if (tooManyAttempts(ip)) return fail(res, 429, '尝试次数过多，请十分钟后再试');
    const body = await readBody(req);
    if (!checkPassword(body.password)) {
      noteAttempt(ip);
      return fail(res, 401, '口令不正确');
    }
    attempts.delete(ip);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(createSessionToken()) });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
  }

  if (pathname === '/api/admin/me' && method === 'GET') {
    if (!authed) return fail(res, 401, '未登录');
    return json(res, 200, { authenticated: true });
  }

  if (!authed) return fail(res, 401, '未登录');

  if (pathname === '/api/admin/posts' && method === 'GET') {
    const list = [...posts]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(publicPost);
    return json(res, 200, list);
  }

  if (pathname === '/api/admin/site' && method === 'PUT') {
    const body = await readBody(req);
    for (const key of ['title', 'subtitle', 'author', 'tagline']) {
      if (typeof body[key] === 'string') site[key] = body[key].slice(0, 120);
    }
    saveSite();
    return json(res, 200, site);
  }

  if (pathname === '/api/admin/posts' && method === 'POST') {
    const body = await readBody(req);
    if (!String(body.title || '').trim()) return fail(res, 400, '标题不能为空');
    const now = new Date().toISOString();
    const status = body.status === 'published' ? 'published' : 'draft';
    const post = {
      id: `p_${randomBytes(6).toString('hex')}`,
      slug: uniqueSlug(slugify(body.slug || body.title)),
      title: String(body.title).trim().slice(0, 120),
      excerpt: String(body.excerpt || '').trim().slice(0, 200) || excerptFrom(body.content),
      content: String(body.content || ''),
      tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 6) : [],
      cover: body.cover || null,
      accent: ['ember', 'sage', 'ink', 'sky'].includes(body.accent) ? body.accent : 'ember',
      status,
      readingMinutes: readingMinutes(body.content),
      createdAt: now,
      updatedAt: now,
      publishedAt: status === 'published' ? now : null,
    };
    posts.push(post);
    await savePosts();
    return json(res, 201, post);
  }

  const adminPostMatch = /^\/api\/admin\/posts\/([\w-]+)$/.exec(pathname);
  if (adminPostMatch) {
    const post = posts.find((item) => item.id === adminPostMatch[1]);
    if (!post) return fail(res, 404, '文章不存在');

    if (method === 'GET') {
      return json(res, 200, post);
    }

    if (method === 'PUT') {
      const body = await readBody(req);
      if (typeof body.title === 'string') {
        post.title = body.title.trim().slice(0, 120) || post.title;
      }
      if (typeof body.slug === 'string' && body.slug.trim()) {
        post.slug = uniqueSlug(slugify(body.slug), post.id);
      }
      if (typeof body.content === 'string') {
        post.content = body.content;
        post.readingMinutes = readingMinutes(body.content);
      }
      if (typeof body.excerpt === 'string') {
        post.excerpt = body.excerpt.trim().slice(0, 200) || excerptFrom(post.content);
      }
      if (Array.isArray(body.tags)) {
        post.tags = body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 6);
      }
      if (typeof body.cover === 'string' || body.cover === null) post.cover = body.cover || null;
      if (['ember', 'sage', 'ink', 'sky'].includes(body.accent)) post.accent = body.accent;
      if (body.status === 'published' || body.status === 'draft') {
        post.status = body.status;
        if (body.status === 'published' && !post.publishedAt) post.publishedAt = new Date().toISOString();
      }
      post.updatedAt = new Date().toISOString();
      await savePosts();
      return json(res, 200, post);
    }

    if (method === 'DELETE') {
      const index = posts.findIndex((item) => item.id === post.id);
      posts.splice(index, 1);
      await savePosts();
      return json(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/admin/upload' && method === 'POST') {
    const body = await readBody(req);
    try {
      const src = saveImage(body);
      return json(res, 200, { url: src });
    } catch (error) {
      return fail(res, 400, error.message);
    }
  }

  return fail(res, 404, '接口不存在');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[api]', error);
    if (!res.headersSent) fail(res, 500, error.message || '服务器内部错误');
    else res.end();
  });
});

const admin = ensureAdmin();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  纸间 API  ·  http://127.0.0.1:${PORT}${DEV ? '（开发模式，仅接口）' : ''}`);
  console.log(`  数据目录  ·  ${DATA_DIR}`);
  if (admin.generated) {
    console.log(`\n  ──────────────────────────────────────────────`);
    console.log(`  首次启动，后台口令：${admin.generated}`);
    console.log(`  已保存到 data/auth.json，请立即记下并妥善保管`);
    console.log(`  ──────────────────────────────────────────────\n`);
  } else if (admin.source === 'env') {
    console.log('  管理员口令来自环境变量 BLOG_ADMIN_PASSWORD');
  }
  console.log('');
});
