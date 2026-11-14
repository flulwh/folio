/**
 * P2-1 回归：X-Folio-Offset 必须是显式合法整数，缺头不能再被当成 0。
 *
 * 起一个真实的 `_lan-fixture.mjs`（随机端口 + 临时数据目录），实际发 HTTP 请求，
 * 断言上传块的 400 语义，以及下载侧 offset=0 / 中间值 / ==size 的 200 / 206 / 416。
 *
 * 用法：node tools/_qa-offset-header.mjs
 * 退出码：0 = 全部符合预期；1 = 有失败项。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tools', '_lan-fixture.mjs');
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-offset-'));

let passed = 0;
const failures = [];

function check(name, condition, actual = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`[PASS] ${name}\n`);
    return true;
  }
  failures.push(`${name}${actual ? `  ← 实际：${actual}` : ''}`);
  process.stdout.write(`[FAIL] ${name}${actual ? `  ← 实际：${actual}` : ''}\n`);
  return false;
}

const sha1 = (buffer) => crypto.createHash('sha1').update(buffer).digest('hex');

function startFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const port = 22000 + Math.floor(Math.random() * 800);
  const proc = spawn(process.execPath, [fixture, dir, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  proc.stderr.on('data', (chunk) => logs.push(String(chunk)));
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`夹具启动超时：${logs.join('').slice(-400)}`));
    }, 20000);
    proc.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const line = buffer.split('\n')[0];
      if (!buffer.includes('\n')) return;
      clearTimeout(timer);
      let info;
      try {
        info = JSON.parse(line);
      } catch (err) {
        proc.kill();
        reject(new Error(`夹具输出无法解析：${line}`));
        return;
      }
      resolve({ ...info, proc });
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const fix = await startFixture(path.join(workRoot, 'main'));
const base = `http://127.0.0.1:${fix.port}`;
const token = fix.token;
const H = { 'X-Folio-Token': token };

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 发一块上传；headers 允许覆盖/删除 X-Folio-Offset。 */
async function upload({ offset, total = 100, body = Buffer.alloc(10, 0x41), headers = {}, hashSeed = 'a' } = {}) {
  const h = new Headers({
    ...H,
    'Content-Type': 'application/octet-stream',
    'X-Folio-Hash': sha1(Buffer.from(`${hashSeed}:${JSON.stringify(headers)}:${offset}`)).padEnd(40, '0').slice(0, 40),
    'X-Folio-Total': String(total),
    ...headers,
  });
  if (offset !== undefined && !('X-Folio-Offset' in headers)) h.set('X-Folio-Offset', String(offset));
  const res = await fetch(`${base}/api/upload/chunk`, { method: 'POST', headers: h, body });
  return { res, json: await readJson(res) };
}

function expectBadOffset(label, result) {
  const body = result.json || {};
  check(`${label} → 400`, result.res.status === 400, `status=${result.res.status} body=${JSON.stringify(body).slice(0, 120)}`);
  check(
    `${label} → body.error === bad_offset 且有 message`,
    body.error === 'bad_offset' && typeof body.message === 'string' && body.message.length > 0,
    JSON.stringify(body).slice(0, 160),
  );
}

process.stdout.write(`\n=== P2-1 X-Folio-Offset 严格校验 → ${base} ===\n\n`);

/* ---------------- 1. 上传块：非法 offset 一律 400 ---------------- */

process.stdout.write('--- 上传块：非法 X-Folio-Offset ---\n');

{
  // 缺头：修复前 Number('') === 0，会被静默接受为「从头开始」
  const r = await upload({ offset: undefined });
  expectBadOffset('缺 X-Folio-Offset', r);
}

{
  const r = await upload({ headers: { 'X-Folio-Offset': '' } });
  expectBadOffset('空串 X-Folio-Offset', r);
}

{
  const r = await upload({ headers: { 'X-Folio-Offset': '1.5' } });
  expectBadOffset('非整数 X-Folio-Offset=1.5', r);
}

{
  const r = await upload({ headers: { 'X-Folio-Offset': 'abc' } });
  expectBadOffset('非数字 X-Folio-Offset=abc', r);
}

{
  const r = await upload({ headers: { 'X-Folio-Offset': '12abc' } });
  expectBadOffset('尾随垃圾 X-Folio-Offset=12abc（parseInt 会误收成 12）', r);
}

{
  const r = await upload({ headers: { 'X-Folio-Offset': '-1' } });
  expectBadOffset('负数 X-Folio-Offset=-1', r);
}

{
  const r = await upload({ total: 100, headers: { 'X-Folio-Offset': '101' }, body: Buffer.alloc(0) });
  expectBadOffset('超界 X-Folio-Offset=101 / total=100', r);
}

{
  // 重复头在 Node 里会变成 "0, 0"（或数组）；两种形态都必须判 400
  const h = new Headers({
    ...H,
    'Content-Type': 'application/octet-stream',
    'X-Folio-Hash': 'b'.repeat(40),
    'X-Folio-Total': '100',
  });
  h.append('X-Folio-Offset', '0');
  h.append('X-Folio-Offset', '0');
  const res = await fetch(`${base}/api/upload/chunk`, { method: 'POST', headers: h, body: Buffer.alloc(10) });
  expectBadOffset('重复 X-Folio-Offset 头', { res, json: await readJson(res) });
}

/* ---------------- 2. 合法 offset 仍然放行 ---------------- */

process.stdout.write('\n--- 上传块：合法 X-Folio-Offset ---\n');

const whole = Buffer.alloc(100, 0x51);
const wholeHash = sha1(whole);
{
  const h = new Headers({
    ...H,
    'Content-Type': 'application/octet-stream',
    'X-Folio-Hash': wholeHash,
    'X-Folio-Offset': '0',
    'X-Folio-Total': String(whole.length),
    'X-Folio-Name': encodeURIComponent('P2-1 合法 offset'),
  });
  const res = await fetch(`${base}/api/upload/chunk`, { method: 'POST', headers: h, body: whole.subarray(0, 40) });
  const json = await readJson(res);
  check('显式 offset=0 → 200 且 received=40', res.status === 200 && json?.received === 40, `status=${res.status} body=${JSON.stringify(json)}`);
}
{
  const h = new Headers({
    ...H,
    'Content-Type': 'application/octet-stream',
    'X-Folio-Hash': wholeHash,
    'X-Folio-Offset': '40',
    'X-Folio-Total': String(whole.length),
    'X-Folio-Name': encodeURIComponent('P2-1 合法 offset'),
  });
  const res = await fetch(`${base}/api/upload/chunk`, { method: 'POST', headers: h, body: whole.subarray(40) });
  const json = await readJson(res);
  check(
    'offset=40 续传并 commit → 200 done=true',
    res.status === 200 && json?.done === true && json?.received === 100,
    `status=${res.status} body=${JSON.stringify(json).slice(0, 160)}`,
  );
}
// 夹具目录是临时目录，跑完随进程一起丢掉，不用再清书架。

/* ---------------- 3. 下载侧：0 / 中间值 / ==size ---------------- */

process.stdout.write('\n--- 下载：无 Range / bytes=0- / 中间值 / ==size ---\n');

const head = await fetch(`${base}/api/book/local-1/download`, { headers: { ...H, Range: 'bytes=0-0' } });
const size = Number(head.headers.get('x-folio-size') || 0);
await head.arrayBuffer();
check('能读到 local-1 的真实大小', size > 0, `size=${size}`);

{
  const res = await fetch(`${base}/api/book/local-1/download`, { headers: H });
  const buf = Buffer.from(await res.arrayBuffer());
  check('无 Range → 200 全量', res.status === 200, `status=${res.status}`);
  check('无 Range → Content-Length == size 且字节数一致', buf.length === size, `len=${buf.length} size=${size}`);
}

{
  const res = await fetch(`${base}/api/book/local-1/download`, { headers: { ...H, Range: 'bytes=0-' } });
  const buf = Buffer.from(await res.arrayBuffer());
  check('Range bytes=0- → 206（显式 Range 一律按分段回）', res.status === 206, `status=${res.status}`);
  check(
    'Range bytes=0- 的 Content-Range 正确',
    res.headers.get('content-range') === `bytes 0-${size - 1}/${size}`,
    res.headers.get('content-range') || '(none)',
  );
  check('Range bytes=0- 内容仍为全量', buf.length === size, `len=${buf.length} size=${size}`);
}

{
  const mid = Math.max(1, Math.floor(size / 2));
  const res = await fetch(`${base}/api/book/local-1/download`, { headers: { ...H, Range: `bytes=${mid}-` } });
  const buf = Buffer.from(await res.arrayBuffer());
  check(`Range bytes=${mid}- → 206`, res.status === 206, `status=${res.status}`);
  check(
    `Range bytes=${mid}- 的 Content-Range 正确`,
    res.headers.get('content-range') === `bytes ${mid}-${size - 1}/${size}`,
    res.headers.get('content-range') || '(none)',
  );
  check(`Range bytes=${mid}- 只回剩余字节`, buf.length === size - mid, `len=${buf.length} expect=${size - mid}`);
}

{
  const res = await fetch(`${base}/api/book/local-1/download`, { headers: { ...H, Range: `bytes=${size}-` } });
  const json = await readJson(res);
  check('Range bytes=size- → 416', res.status === 416, `status=${res.status} body=${JSON.stringify(json).slice(0, 120)}`);
  check(
    '416 带 Content-Range: bytes */size',
    res.headers.get('content-range') === `bytes */${size}`,
    res.headers.get('content-range') || '(none)',
  );
}

/* ---------------- 收尾 ---------------- */

fix.proc.kill('SIGTERM');
if (!process.argv.includes('--keep')) {
  try {
    fs.rmSync(workRoot, { recursive: true, force: true });
  } catch {
    /* Windows 上夹具刚退出时文件可能还被占用，下次启动会换新临时目录 */
  }
}

process.stdout.write(`\n=== 汇总：${passed + failures.length} 项，通过 ${passed}，失败 ${failures.length} ===\n`);
if (failures.length) {
  process.stdout.write('\n失败明细：\n');
  for (const item of failures) process.stdout.write(` - ${item}\n`);
}
process.exit(failures.length ? 1 : 0);
