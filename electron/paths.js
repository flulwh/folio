/**
 * 路径包含关系判断（大小写不敏感）。
 *
 * 为什么不用 `target.startsWith(root + path.sep)`：
 *   1. Windows 文件系统本身大小写不敏感，`C:\Users` 与 `c:\Users` 指向同一目录，
 *      但字符串比较会判成不同 —— 换个盘符大小写就把自己的书判成「越界」。
 *   2. `startsWith` 对 `..`、符号链接、相邻同前缀目录（books-evil）都容易判错。
 *
 * 统一走 path.relative：得到的是「目标相对根目录的相对路径」，
 * 只在同一棵子树里才会得到既非空、又不以 `..` 开头、也不是绝对路径的结果。
 */

import path from 'path';

const cache = new Map();

/** Windows 下按大小写不敏感比较，其他平台按大小写敏感（与文件系统语义一致）。 */
function normalize(value) {
  if (process.platform !== 'win32') return value;
  let key = value;
  let hit = cache.get(key);
  if (hit === undefined) {
    hit = value.toLowerCase();
    if (cache.size > 512) cache.clear();
    cache.set(key, hit);
  }
  return hit;
}

/**
 * 判断 target 是否位于 dir 之内（不含 dir 本身）。
 * @param {string} dir 根目录
 * @param {string} target 待检查路径
 * @returns {boolean}
 */
export function isInside(dir, target) {
  const root = path.resolve(String(dir || ''));
  const file = path.resolve(String(target || ''));
  if (normalize(root) === normalize(file)) return false;
  const rel = path.relative(root, file);
  if (!rel) return false;
  if (path.isAbsolute(rel)) return false;
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) return false;
  return true;
}

/**
 * 判断 target 是否位于 dir 之内（允许 target 就是 dir 本身）。
 * @param {string} dir
 * @param {string} target
 * @returns {boolean}
 */
export function isInsideOrEqual(dir, target) {
  const root = path.resolve(String(dir || ''));
  const file = path.resolve(String(target || ''));
  if (normalize(root) === normalize(file)) return true;
  return isInside(root, file);
}

/**
 * 判断两个路径是否指向同一个位置（Windows 下忽略大小写）。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function samePath(a, b) {
  if (!a || !b) return false;
  const left = path.resolve(String(a));
  const right = path.resolve(String(b));
  return normalize(left) === normalize(right);
}
