import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.BLOG_DATA_DIR
  ? path.resolve(process.env.BLOG_DATA_DIR)
  : path.join(here, '..', 'data');

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });

const cache = new Map();
let writeQueue = Promise.resolve();

function filePath(name) {
  return path.join(DATA_DIR, name);
}

export function readJson(name, fallback) {
  if (cache.has(name)) return cache.get(name);
  const file = filePath(name);
  if (!existsSync(file)) {
    cache.set(name, fallback);
    return fallback;
  }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    cache.set(name, value);
    return value;
  } catch {
    cache.set(name, fallback);
    return fallback;
  }
}

export function writeJson(name, value) {
  cache.set(name, value);
  writeQueue = writeQueue.then(() => {
    const file = filePath(name);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
      renameSync(tmp, file);
    } catch (error) {
      console.error(`[store] 写入 ${name} 失败：${error.message}`);
    }
  });
  return writeQueue;
}

export function publicPost(post) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    tags: post.tags,
    cover: post.cover || null,
    accent: post.accent || 'ember',
    status: post.status,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt,
    readingMinutes: post.readingMinutes,
  };
}
