import { seedPosts, seedSite } from '../server/seed.js';

/* ------------------------------ 工具 ------------------------------ */

const enc = new TextEncoder();

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const fail = (status, message) => json({ error: message }, status);

const toBase64Url = (bytes) => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
};

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(payload, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return toBase64Url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

const sessionSecret = (env) => env.BLOG_SESSION_SECRET || `${env.BLOG_ADMIN_PASSWORD}:folio-blog`;

async function createToken(env) {
  const payload = toBase64Url(enc.encode(JSON.stringify({ exp: Date.now() + 7 * 24 * 3600 * 1000 })));
  return `${payload}.${await hmac(payload, sessionSecret(env))}`;
}

async function isValidToken(env, token) {
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  const expected = await hmac(payload, sessionSecret(env));
  if (signature.length !== expected.length || !timingSafeEqual(enc.encode(signature), enc.encode(expected))) {
    return false;
  }
  try {
    const data = JSON.parse(fromBase64Url(payload));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const isAuthed = async (request, env) => isValidToken(env, readCookie(request, 'blog_sid'));

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('JSON 解析失败');
  }
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

/* ------------------------------ 行映射 ------------------------------ */

const toPost = (row) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt,
  content: row.content,
  tags: JSON.parse(row.tags || '[]'),
  cover: row.cover || null,
  accent: row.accent,
  status: row.status,
  readingMinutes: row.reading_minutes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  publishedAt: row.published_at || null,
});

const toCard = (post) => ({
  id: post.id,
  slug: post.slug,
  title: post.title,
  excerpt: post.excerpt,
  tags: post.tags,
  cover: post.cover,
  accent: post.accent,
  status: post.status,
  readingMinutes: post.readingMinutes,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  publishedAt: post.publishedAt,
});

async function uniqueSlug(env, desired, exceptId) {
  let slug = desired;
  let index = 2;
  for (;;) {
    const row = await env.DB.prepare('SELECT id FROM posts WHERE slug = ?').bind(slug).first();
    if (!row || row.id === exceptId) return slug;
    slug = `${desired}-${index}`;
    index += 1;
  }
}

/* ------------------------------ 初始化 ------------------------------ */

let seeded = false;

async function ensureSeed(env) {
  if (seeded) return;
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM posts').first();
  if (!row || row.total === 0) {
    const insert = env.DB.prepare(
      `INSERT OR IGNORE INTO posts
       (id, slug, title, excerpt, content, tags, cover, accent, status, reading_minutes, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await env.DB.batch(
      seedPosts().map((post) =>
        insert.bind(
          post.id,
          post.slug,
          post.title,
          post.excerpt,
          post.content,
          JSON.stringify(post.tags || []),
          post.cover || null,
          post.accent,
          post.status,
          post.readingMinutes,
          post.createdAt,
          post.updatedAt,
          post.publishedAt,
        ),
      ),
    );
  }
  seeded = true;
}

async function getSite(env) {
  const row = await env.DB.prepare('SELECT * FROM site WHERE id = 1').first();
  if (!row) {
    const fallback = seedSite();
    return fallback;
  }
  return {
    title: row.title,
    subtitle: row.subtitle,
    author: row.author,
    tagline: row.tagline,
    links: JSON.parse(row.links || '[]'),
  };
}

/* ------------------------------ 图片 ------------------------------ */

async function saveImage(env, body) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=]+)$/.exec(body.dataUrl || '');
  if (!match) throw new Error('只支持 PNG / JPEG / WebP / GIF');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('图片不能超过 8MB');
  const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[match[1]];
  const stem = slugify(String(body.name || 'image').replace(/\.[^.]+$/, '')).slice(0, 40);
  const key = `uploads/${stem}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  await env.BLOG_KV.put(key, bytes, { metadata: { contentType: match[1] } });
  return `/${key}`;
}

async function serveImage(env, pathname) {
  const key = pathname.replace(/^\/+/, '');
  if (!key.startsWith('uploads/')) return fail(404, '文件不存在');
  const { value, metadata } = await env.BLOG_KV.getWithMetadata(key, 'arrayBuffer');
  if (!value) return fail(404, '文件不存在');
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

/* ------------------------------ 路由 ------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const method = request.method;

    if (pathname.startsWith('/uploads/')) {
      return serveImage(env, pathname);
    }

    if (!pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    try {
      await ensureSeed(env);
      const authed = await isAuthed(request, env);

      if (pathname === '/api/site' && method === 'GET') {
        return json(await getSite(env));
      }

      if (pathname === '/api/posts' && method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT id, slug, title, excerpt, tags, cover, accent, status, reading_minutes, created_at, updated_at, published_at
           FROM posts WHERE status = 'published'
           ORDER BY COALESCE(published_at, created_at) DESC`,
        ).all();
        return json(results.map((row) => toCard(toPost({ ...row, content: '' }))));
      }

      if (pathname.startsWith('/api/posts/') && method === 'GET') {
        const slug = pathname.slice('/api/posts/'.length);
        const row = await env.DB.prepare(`SELECT * FROM posts WHERE slug = ? AND status = 'published'`)
          .bind(slug)
          .first();
        if (!row) return fail(404, '文章不存在');
        return json(toPost(row));
      }

      if (pathname === '/api/admin/login' && method === 'POST') {
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const key = `login:${ip}`;
        const count = Number(await env.BLOG_KV.get(key)) || 0;
        if (count >= 8) return fail(429, '尝试次数过多，请十分钟后再试');

        const body = await readJson(request);
        const provided = await sha256(String(body.password || ''));
        const expected = await sha256(String(env.BLOG_ADMIN_PASSWORD || ''));
        if (!env.BLOG_ADMIN_PASSWORD || !timingSafeEqual(provided, expected)) {
          await env.BLOG_KV.put(key, String(count + 1), { expirationTtl: 600 });
          return fail(401, '口令不正确');
        }
        await env.BLOG_KV.delete(key);
        return json({ ok: true }, 200, {
          'Set-Cookie': `blog_sid=${encodeURIComponent(await createToken(env))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
        });
      }

      if (pathname === '/api/admin/logout' && method === 'POST') {
        return json({ ok: true }, 200, {
          'Set-Cookie': 'blog_sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        });
      }

      if (pathname === '/api/admin/me' && method === 'GET') {
        return authed ? json({ authenticated: true }) : fail(401, '未登录');
      }

      if (!authed) return fail(401, '未登录');

      if (pathname === '/api/admin/posts' && method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT id, slug, title, excerpt, tags, cover, accent, status, reading_minutes, created_at, updated_at, published_at
           FROM posts ORDER BY updated_at DESC`,
        ).all();
        return json(results.map((row) => toCard(toPost({ ...row, content: '' }))));
      }

      if (pathname === '/api/admin/site' && method === 'PUT') {
        const body = await readJson(request);
        const current = await getSite(env);
        const next = {
          title: typeof body.title === 'string' ? body.title.slice(0, 120) : current.title,
          subtitle: typeof body.subtitle === 'string' ? body.subtitle.slice(0, 120) : current.subtitle,
          author: typeof body.author === 'string' ? body.author.slice(0, 120) : current.author,
          tagline: typeof body.tagline === 'string' ? body.tagline.slice(0, 120) : current.tagline,
        };
        await env.DB.prepare('UPDATE site SET title = ?, subtitle = ?, author = ?, tagline = ? WHERE id = 1')
          .bind(next.title, next.subtitle, next.author, next.tagline)
          .run();
        return json({ ...next, links: current.links });
      }

      if (pathname === '/api/admin/posts' && method === 'POST') {
        const body = await readJson(request);
        if (!String(body.title || '').trim()) return fail(400, '标题不能为空');
        const now = new Date().toISOString();
        const status = body.status === 'published' ? 'published' : 'draft';
        const post = {
          id: `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          slug: await uniqueSlug(env, slugify(body.slug || body.title)),
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
        await env.DB.prepare(
          `INSERT INTO posts
           (id, slug, title, excerpt, content, tags, cover, accent, status, reading_minutes, created_at, updated_at, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            post.id,
            post.slug,
            post.title,
            post.excerpt,
            post.content,
            JSON.stringify(post.tags),
            post.cover,
            post.accent,
            post.status,
            post.readingMinutes,
            post.createdAt,
            post.updatedAt,
            post.publishedAt,
          )
          .run();
        return json(post, 201);
      }

      const postMatch = /^\/api\/admin\/posts\/([\w-]+)$/.exec(pathname);
      if (postMatch) {
        const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(postMatch[1]).first();
        if (!row) return fail(404, '文章不存在');
        const post = toPost(row);

        if (method === 'GET') return json(post);

        if (method === 'PUT') {
          const body = await readJson(request);
          if (typeof body.title === 'string' && body.title.trim()) post.title = body.title.trim().slice(0, 120);
          if (typeof body.slug === 'string' && body.slug.trim()) {
            post.slug = await uniqueSlug(env, slugify(body.slug), post.id);
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

          await env.DB.prepare(
            `UPDATE posts SET slug = ?, title = ?, excerpt = ?, content = ?, tags = ?, cover = ?, accent = ?,
             status = ?, reading_minutes = ?, updated_at = ?, published_at = ? WHERE id = ?`,
          )
            .bind(
              post.slug,
              post.title,
              post.excerpt,
              post.content,
              JSON.stringify(post.tags),
              post.cover,
              post.accent,
              post.status,
              post.readingMinutes,
              post.updatedAt,
              post.publishedAt,
              post.id,
            )
            .run();
          return json(post);
        }

        if (method === 'DELETE') {
          await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(post.id).run();
          return json({ ok: true });
        }
      }

      if (pathname === '/api/admin/upload' && method === 'POST') {
        const body = await readJson(request);
        try {
          return json({ url: await saveImage(env, body) });
        } catch (error) {
          return fail(400, error.message);
        }
      }

      return fail(404, '接口不存在');
    } catch (error) {
      return fail(500, error.message || '服务器内部错误');
    }
  },
};
