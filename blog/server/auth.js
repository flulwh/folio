import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readJson, writeJson } from './store.js';

const SESSION_DAYS = 7;
const SESSION_COOKIE = 'blog_sid';

function secret() {
  const saved = readJson('secret.json', null);
  if (saved && saved.key) return saved.key;
  const created = { key: randomBytes(32).toString('hex') };
  writeJson('secret.json', created);
  return created.key;
}

function hash(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

/** 首次运行时生成管理员口令；优先使用环境变量 BLOG_ADMIN_PASSWORD。 */
export function ensureAdmin() {
  const envPassword = process.env.BLOG_ADMIN_PASSWORD;
  if (envPassword) {
    return { source: 'env', generated: null };
  }
  const saved = readJson('auth.json', null);
  if (saved && saved.hash && saved.salt) {
    return { source: 'file', generated: null };
  }
  const password = randomBytes(6).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  writeJson('auth.json', { salt, hash: hash(password, salt), createdAt: new Date().toISOString() });
  return { source: 'generated', generated: password };
}

export function checkPassword(password) {
  if (typeof password !== 'string' || !password) return false;
  const envPassword = process.env.BLOG_ADMIN_PASSWORD;
  if (envPassword) {
    const a = Buffer.from(password);
    const b = Buffer.from(envPassword);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const saved = readJson('auth.json', null);
  if (!saved || !saved.hash) return false;
  const expected = Buffer.from(saved.hash, 'hex');
  const actual = Buffer.from(hash(password, saved.salt), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000 }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
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

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    SESSION_DAYS * 24 * 3600
  }`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function isAuthed(req) {
  return verifySessionToken(readCookie(req, SESSION_COOKIE));
}
