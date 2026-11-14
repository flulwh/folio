/**
 * 桌面端 2.6.0 局域网接口自查 —— 一条命令跑完清单 / 下载 / 续传 / 上传 / 漫画。
 *
 *   node tools/_lan-sync-check.mjs
 *   node tools/_lan-sync-check.mjs --keep     # 跑完保留临时目录，方便看 books.json
 *
 * 全程只打 127.0.0.1：漫画用夹具里的假图源，不出网、不碰真实书架。
 * 退出码 0 = 全绿；非 0 = 有失败项，失败项会连同实际值一起打出来。
 *
 * 覆盖（对应架构文档 T01–T05 的验收点）：
 *   1. /api/ping 的 apiVersion / features / limits
 *   2. /api/library 的 contentHash 懒补齐 + 写回、syncable 判定、云端书不可同步
 *   3. 12MiB / 30MiB 整文件下载，sha1 与 X-Folio-Hash 一致
 *   4. `Range: bytes=N-` 续传（206 + Content-Range），拼回来 sha1 仍然一致
 *   5. 超限 / 越界 / 非本地书的错误码（413 / 416 / 409）
 *   6. 30MiB 分 8 块上传 → 落盘 → 可下载 → 清单可见
 *   7. offset 不连续 409、改一字节 422、删会话后重传、同内容幂等
 *   8. 同名不同内容的「冲突场景」：两本并存、id 不同
 *   9. 漫画清单只回 total（不泄漏源站地址）、首页字节、越界 400、超限 413、源站失败 502
 *  10. 只读模式下上传/状态接口 403
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tools', '_lan-fixture.mjs');
const keep = process.argv.includes('--keep');

const MiB = 1024 * 1024;
const MAX_TRANSFER = 30 * MiB;

let passed = 0;
const failures = [];
let currentSection = '';

function section(title) {
  currentSection = title;
  process.stdout.write(`\n${title}\n`);
}

/** 断言。失败不中断，跑完全部再汇总，一次看到所有问题。 */
function ok(name, condition, actual = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ✓ ${name}\n`);
    return true;
  }
  const detail = actual === '' ? '' : `  ← 实际：${actual}`;
  failures.push(`${currentSection} / ${name}${detail}`);
  process.stdout.write(`  ✗ ${name}${detail}\n`);
  return false;
}

const sha1 = (buffer) => crypto.createHash('sha1').update(buffer).digest('hex');

/* ------------------------------------------------------------------ */
/*  起夹具                                                              */
/* ------------------------------------------------------------------ */

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-sync-'));

/**
 * 起一个夹具进程，等它把 { port, token } 打到 stdout。
 * @param {string} dir 数据目录
 * @param {string[]} flags 额外参数（--big / --readonly）
 */
function startFixture(dir, flags = []) {
  fs.mkdirSync(dir, { recursive: true });
  // 随机起始端口：并行跑多个自查（CI 里可能同时起好几份）时不容易撞
  const port = 21000 + Math.floor(Math.random() * 800);
  const proc = spawn(process.execPath, [fixture, dir, String(port), ...flags], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
      if (!line || !buffer.includes('\n')) return;
      clearTimeout(timer);
      let info = null;
      try {
        info = JSON.parse(line);
      } catch (err) {
        proc.kill();
        reject(new Error(`夹具输出无法解析：${line}`));
        return;
      }
      resolve({
        ...info,
        proc,
        logs,
        async stop() {
          proc.kill('SIGTERM');
          await new Promise((done) => {
            proc.once('exit', done);
            setTimeout(done, 3000);
          });
        },
      });
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/* ------------------------------------------------------------------ */
/*  HTTP 小工具                                                         */
/* ------------------------------------------------------------------ */

let base = '';
let token = '';

function headers(extra = {}) {
  return { 'X-Folio-Token': token, ...extra };
}

async function apiJson(pathname, options = {}) {
  // 默认带上访问码：除了「401 自查」那几处用裸 fetch，其余请求都必须过鉴权
  const res = await fetch(`${base}${pathname}`, { ...options, headers: headers(options.headers || {}) });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { res, body, text };
}

/** 上传一整本（可分块）。返回每次请求的状态码列表。 */
async function uploadBook({ buffer, title, chunkSize = 4 * MiB, mutateAt = -1, onChunk = null }) {
  const hash = sha1(buffer);
  const total = buffer.length;
  const steps = [];
  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + chunkSize, total);
    let piece = buffer.subarray(offset, end);
    if (mutateAt >= offset && mutateAt < end) {
      // 故意改一个字节：服务端重算 sha1 必须发现，回 422
      const copy = Buffer.from(piece);
      copy[mutateAt - offset] ^= 0xff;
      piece = copy;
    }
    const res = await fetch(`${base}/api/upload/chunk`, {
      method: 'POST',
      headers: headers({
        'Content-Type': 'application/octet-stream',
        'X-Folio-Hash': hash,
        'X-Folio-Offset': String(offset),
        'X-Folio-Total': String(total),
        'X-Folio-Name': encodeURIComponent(title),
      }),
      body: piece,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    steps.push({ status: res.status, body, offset, length: piece.length });
    if (onChunk) onChunk({ status: res.status, body, offset, length: piece.length });
    if (res.status !== 200) break;
    offset = end;
  }
  return { hash, total, steps, last: steps[steps.length - 1] || null };
}

/** 造一本确定内容的「书」：每本内容不同，但同一本每次跑都一样。 */
function makeBook(size, seed) {
  const buffer = Buffer.allocUnsafe(size);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < size; i += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    // 只用可打印 ASCII，保证落盘后也是合法 UTF-8 正文
    buffer[i] = 0x20 + (state % 90);
  }
  for (let i = 0; i < size; i += 4096) buffer[i] = 0x0a; // 掺点换行，像真的 txt
  return buffer;
}

/* ------------------------------------------------------------------ */

async function main() {
  const primary = await startFixture(path.join(workRoot, 'main'), ['--big', '--comic']);
  base = `http://127.0.0.1:${primary.port}`;
  token = primary.token;
  process.stdout.write(`夹具已启动：${base}（imageBase ${primary.imageBase}）\n`);

  /* ---------------- 1. ping ---------------- */
  section('1. /api/ping 能力位');
  const ping = await apiJson('/api/ping');
  ok('ping 返回 ok', ping.body?.ok === true, ping.text.slice(0, 120));
  ok('apiVersion = 2', ping.body?.apiVersion === 2, String(ping.body?.apiVersion));
  const features = Array.isArray(ping.body?.features) ? ping.body.features : [];
  for (const name of ['library', 'upload', 'download', 'range', 'comic']) {
    ok(`能力位含 ${name}`, features.includes(name), features.join(','));
  }
  ok(
    'limits 与架构文档一致',
    ping.body?.limits?.transfer === MAX_TRANSFER && ping.body?.limits?.chunk === 4 * MiB,
    JSON.stringify(ping.body?.limits),
  );
  ok('旧字段 port / version 仍在', typeof ping.body?.port === 'number' && typeof ping.body?.version === 'string');

  /* ---------------- 2. 清单 ---------------- */
  section('2. /api/library 清单');
  const lib1 = await apiJson('/api/library');
  ok('清单返回 ok + apiVersion', lib1.body?.ok === true && lib1.body?.apiVersion === 2);
  const books = Array.isArray(lib1.body?.books) ? lib1.body.books : [];
  const byId = (id) => books.find((item) => item.id === id) || null;
  ok('清单里能看到夹具的 6 本书', books.length === 6, `实际 ${books.length}`);

  const local1 = byId('local-1');
  ok('本地书带上了 contentHash（懒补齐）', /^[0-9a-f]{40}$/.test(String(local1?.contentHash || '')), JSON.stringify(local1));
  ok('本地书 syncable = true', local1?.syncable === true, JSON.stringify(local1));
  const onDisk = JSON.parse(fs.readFileSync(path.join(workRoot, 'main', 'books.json'), 'utf8'));
  ok(
    '补齐的 contentHash 已原子写回 books.json',
    /^[0-9a-f]{40}$/.test(String(onDisk.find((b) => b.id === 'local-1')?.contentHash || '')),
    JSON.stringify(onDisk.find((b) => b.id === 'local-1')),
  );

  ok('云端书不带 contentHash', byId('cloud-1')?.contentHash === undefined);
  ok('云端书 syncable = false 且有原因', byId('cloud-1')?.syncable === false && Boolean(byId('cloud-1')?.syncableReason));
  ok('漫画书 type = 2', byId('comic-1')?.type === 2, String(byId('comic-1')?.type));
  ok('本地书 type = 0', byId('local-1')?.type === 0, String(byId('local-1')?.type));
  ok('清单不泄漏本地路径', !JSON.stringify(lib1.body).includes(workRoot));
  ok('清单带 cover 时才给 /api/cover/:id', books.every((b) => b.cover === undefined || String(b.cover).startsWith('/api/cover/')));

  const big30 = byId('big-30');
  ok('30MiB 的书恰好还算 syncable', big30?.syncable === true, JSON.stringify(big30));
  const bigOver = byId('big-over');
  ok('31MiB 的书 syncable = false', bigOver?.syncable === false, JSON.stringify(bigOver));
  ok(
    '超限原因用了冻结文案（含 30MB 上限）',
    String(bigOver?.syncableReason || '').includes('超过 30MB 上限'),
    String(bigOver?.syncableReason || ''),
  );

  /* ---------------- 3. 整文件下载 ---------------- */
  section('3. 整文件下载');
  const hash12 = String(byId('big-12')?.contentHash || '');
  const dl12 = await fetch(`${base}/api/book/big-12/download`, { headers: headers() });
  const body12 = Buffer.from(await dl12.arrayBuffer());
  ok('12MiB 书返回 200', dl12.status === 200, String(dl12.status));
  ok('字节数对得上', body12.length === 12 * MiB, String(body12.length));
  ok('sha1 与清单里的 contentHash 一致', sha1(body12) === hash12, `${sha1(body12)} vs ${hash12}`);
  ok('X-Folio-Hash 与清单一致', dl12.headers.get('x-folio-hash') === hash12, String(dl12.headers.get('x-folio-hash')));
  ok('X-Folio-Size 正确', dl12.headers.get('x-folio-size') === String(12 * MiB), String(dl12.headers.get('x-folio-size')));
  ok('Accept-Ranges: bytes', dl12.headers.get('accept-ranges') === 'bytes');
  ok('Cache-Control: no-store', String(dl12.headers.get('cache-control') || '').includes('no-store'));
  ok('带 Content-Disposition', String(dl12.headers.get('content-disposition') || '').includes('attachment'));

  const dl30 = await fetch(`${base}/api/book/big-30/download`, { headers: headers() });
  const body30 = Buffer.from(await dl30.arrayBuffer());
  ok('30MiB 书返回 200 且字节数对得上', dl30.status === 200 && body30.length === MAX_TRANSFER, `${dl30.status} / ${body30.length}`);
  ok('30MiB 书 sha1 一致', sha1(body30) === String(byId('big-30')?.contentHash || ''));

  /* ---------------- 4. Range 续传 ---------------- */
  section('4. Range 续传');
  const resume = await fetch(`${base}/api/book/big-12/download`, {
    headers: headers({ Range: 'bytes=1000-' }),
  });
  const tail = Buffer.from(await resume.arrayBuffer());
  ok('Range 请求返回 206', resume.status === 206, String(resume.status));
  ok(
    'Content-Range 正确',
    resume.headers.get('content-range') === `bytes 1000-${12 * MiB - 1}/${12 * MiB}`,
    String(resume.headers.get('content-range')),
  );
  ok('返回的字节数 = 总长 - 起点', tail.length === 12 * MiB - 1000, String(tail.length));
  ok('前 1000 字节 + 剩余 = 整本', sha1(Buffer.concat([body12.subarray(0, 1000), tail])) === hash12);
  ok('206 也带 X-Folio-Hash', resume.headers.get('x-folio-hash') === hash12);

  const midRange = await fetch(`${base}/api/book/big-12/download`, {
    headers: headers({ Range: 'bytes=0-1023' }),
  });
  const head = Buffer.from(await midRange.arrayBuffer());
  ok('带区间的 Range 也能用', midRange.status === 206 && head.length === 1024, `${midRange.status}/${head.length}`);
  ok('区间内容与整本头部一致', head.equals(body12.subarray(0, 1024)));

  /* ---------------- 5. 下载的错误码 ---------------- */
  section('5. 下载的错误码');
  const tooBig = await apiJson('/api/book/big-over/download');
  ok('31MiB 书下载 → 413', tooBig.res.status === 413, String(tooBig.res.status));
  ok('413 错误体是 {ok:false,error}', tooBig.body?.ok === false && typeof tooBig.body?.error === 'string');

  const outOfRange = await fetch(`${base}/api/book/big-12/download`, {
    headers: headers({ Range: `bytes=${12 * MiB}-` }),
  });
  ok('Range 起点等于文件大小 → 416', outOfRange.status === 416, String(outOfRange.status));
  ok(
    '416 带 Content-Range: bytes */size',
    outOfRange.headers.get('content-range') === `bytes */${12 * MiB}`,
    String(outOfRange.headers.get('content-range')),
  );

  const cloudDl = await apiJson('/api/book/cloud-1/download');
  ok('云端书下载 → 409', cloudDl.res.status === 409, String(cloudDl.res.status));
  const missingDl = await apiJson('/api/book/nope/download');
  ok('不存在的书下载 → 404', missingDl.res.status === 404, String(missingDl.res.status));
  const noAuthDl = await fetch(`${base}/api/book/big-12/download`);
  ok('下载同样要访问码 → 401', noAuthDl.status === 401, String(noAuthDl.status));

  /* ---------------- 6. 30MiB 分 8 块上传 ---------------- */
  section('6. 分块上传（30MiB / 8 块）');
  const payload = makeBook(MAX_TRANSFER, 20260601);
  const payloadHash = sha1(payload);
  const status0 = await apiJson(`/api/upload/status?hash=${payloadHash}&size=${payload.length}`);
  ok('未开始时 received = 0', status0.body?.ok === true && status0.body?.received === 0, JSON.stringify(status0.body));
  ok('未开始时 done = false', status0.body?.done === false);

  const up = await uploadBook({ buffer: payload, title: '上传测试书' });
  ok('一共发了 8 块', up.steps.length === 8, String(up.steps.length));
  ok('前 7 块都回 done:false', up.steps.slice(0, 7).every((s) => s.status === 200 && s.body?.done === false));
  ok('最后一块 done:true', up.last?.status === 200 && up.last?.body?.done === true, JSON.stringify(up.last?.body));
  ok('服务端算出同内容 id = sha1-<hash>', up.last?.body?.id === `sha1-${payloadHash}`, String(up.last?.body?.id));
  ok('首次上传 created = true', up.last?.body?.created === true, String(up.last?.body?.created));
  ok('返回的 received 等于总大小', up.last?.body?.received === payload.length, String(up.last?.body?.received));

  const uploaded = (await apiJson('/api/library')).body?.books?.find((b) => b.id === `sha1-${payloadHash}`);
  ok('清单里出现了这本上传的书', uploaded?.contentHash === payloadHash, JSON.stringify(uploaded));
  ok('上传书 syncable = true', uploaded?.syncable === true);
  ok('上传书标题解码正确', uploaded?.title === '上传测试书', String(uploaded?.title));

  const roundTrip = await fetch(`${base}/api/book/${encodeURIComponent(`sha1-${payloadHash}`)}/download`, {
    headers: headers(),
  });
  const roundBody = Buffer.from(await roundTrip.arrayBuffer());
  ok('刚上传的书能整本下回来（往返 sha1 一致）', roundTrip.status === 200 && sha1(roundBody) === payloadHash);

  const savedName = path.join(workRoot, 'main', 'books', `上传测试书-${payloadHash.slice(0, 8)}.txt`);
  ok('落盘文件名带 hash 前 8 位', fs.existsSync(savedName), savedName);
  ok('落盘内容 sha1 与上传一致', fs.existsSync(savedName) && sha1(fs.readFileSync(savedName)) === payloadHash);
  ok('.part 已被 rename 掉', !fs.existsSync(path.join(workRoot, 'main', 'books', '.incoming', `${payloadHash}.part`)));

  /* ---------------- 7. 幂等 / 断点 / 校验失败 ---------------- */
  section('7. 幂等、断点与校验失败');
  const statusDone = await apiJson(`/api/upload/status?hash=${payloadHash}&size=${payload.length}`);
  ok('传完后 status 直接回 done:true（幂等）', statusDone.body?.done === true && statusDone.body?.received === payload.length, JSON.stringify(statusDone.body));

  const again = await apiJson(`/api/upload/status?hash=${sha1(payload)}&size=${payload.length}`);
  ok('同一份内容再问一次仍然是 done', again.body?.done === true);

  // offset 不连续：直接跳到第 3 块（total 留出余量，别被「超出总大小」先拦下）
  const gapHash = sha1(makeBook(64 * 1024, 7));
  const gapRes = await fetch(`${base}/api/upload/chunk`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/octet-stream',
      'X-Folio-Hash': gapHash,
      'X-Folio-Offset': String(3 * 4 * MiB),
      'X-Folio-Total': String(16 * MiB),
      'X-Folio-Name': encodeURIComponent('断点测试书'),
    }),
    body: payload.subarray(0, 1024),
  });
  const gapBody = await gapRes.json();
  ok('offset 不连续 → 409', gapRes.status === 409, String(gapRes.status));
  ok('409 回传权威的 received', gapBody?.received === 0, JSON.stringify(gapBody));

  // 断点：传一块 → 删会话 → status 归零 → 重传整本
  const resumePayload = makeBook(2 * MiB + 12345, 99);
  const resumeHash = sha1(resumePayload);
  await fetch(`${base}/api/upload/chunk`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/octet-stream',
      'X-Folio-Hash': resumeHash,
      'X-Folio-Offset': '0',
      'X-Folio-Total': String(resumePayload.length),
      'X-Folio-Name': encodeURIComponent('断点续传书'),
    }),
    body: resumePayload.subarray(0, 1 * MiB),
  });
  const half = await apiJson(`/api/upload/status?hash=${resumeHash}&size=${resumePayload.length}`);
  ok('传了一半后 status.received = 1MiB', half.body?.received === 1 * MiB, String(half.body?.received));
  const halfResume = await fetch(`${base}/api/upload/chunk`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/octet-stream',
      'X-Folio-Hash': resumeHash,
      'X-Folio-Offset': String(1 * MiB),
      'X-Folio-Total': String(resumePayload.length),
      'X-Folio-Name': encodeURIComponent('断点续传书'),
    }),
    body: resumePayload.subarray(1 * MiB),
  });
  const halfResumeBody = await halfResume.json();
  ok('从 received 处续传能直接收齐', halfResume.status === 200 && halfResumeBody?.done === true, JSON.stringify(halfResumeBody));

  const delPayload = makeBook(256 * 1024, 31);
  const delHash = sha1(delPayload);
  await fetch(`${base}/api/upload/chunk`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/octet-stream',
      'X-Folio-Hash': delHash,
      'X-Folio-Offset': '0',
      'X-Folio-Total': String(delPayload.length),
      'X-Folio-Name': encodeURIComponent('取消上传书'),
    }),
    body: delPayload.subarray(0, 1024),
  });
  const delRes = await fetch(`${base}/api/upload/${delHash}`, { method: 'DELETE', headers: headers() });
  ok('DELETE /api/upload/:hash 回 ok', delRes.status === 200, String(delRes.status));
  const afterDel = await apiJson(`/api/upload/status?hash=${delHash}&size=${delPayload.length}`);
  ok('删掉会话后 received 归零', afterDel.body?.received === 0, String(afterDel.body?.received));
  ok(
    '会话文件真的没了',
    !fs.existsSync(path.join(workRoot, 'main', 'books', '.incoming', `${delHash}.part`)),
  );

  // 改一字节：hash 是原始内容的，字节被改过 → 422
  const badPayload = makeBook(1 * MiB + 7, 555);
  const badUp = await uploadBook({ buffer: badPayload, title: '校验失败书', mutateAt: 4321 });
  ok('改了一字节 → 422', badUp.last?.status === 422, JSON.stringify(badUp.last));
  ok('422 错误体是 {ok:false,error}', badUp.last?.body?.ok === false && typeof badUp.last?.body?.error === 'string');
  const badHash = sha1(badPayload);
  ok(
    '校验失败后 .part 已被清掉',
    !fs.existsSync(path.join(workRoot, 'main', 'books', '.incoming', `${badHash}.part`)),
  );
  const badStatus = await apiJson(`/api/upload/status?hash=${badHash}&size=${badPayload.length}`);
  ok('校验失败后再 status 是 0', badStatus.body?.received === 0, String(badStatus.body?.received));

  /* ---------------- 8. 冲突场景（同名不同内容） ---------------- */
  section('8. 冲突：同名不同内容');
  const conflictA = sha1(payload);
  const otherPayload = makeBook(3 * MiB, 4242);
  const conflictB = sha1(otherPayload);
  const upB = await uploadBook({ buffer: otherPayload, title: '上传测试书' });
  ok('同名不同内容能传上去', upB.last?.status === 200 && upB.last?.body?.done === true, JSON.stringify(upB.last?.body));
  ok('冲突时给出新的 id', upB.last?.body?.id === `sha1-${conflictB}`, String(upB.last?.body?.id));
  ok('两次 hash 不同', conflictA !== conflictB);
  const libAfter = (await apiJson('/api/library')).body?.books || [];
  const sameTitle = libAfter.filter((b) => b.title === '上传测试书');
  ok('两本同名的书并存（桌面端不替手机判冲突）', sameTitle.length === 2, `实际 ${sameTitle.length}`);
  ok(
    '两本的 contentHash 不同、文件名也不同',
    new Set(sameTitle.map((b) => b.contentHash)).size === 2,
    sameTitle.map((b) => b.contentHash).join(','),
  );
  ok(
    '同名两个文件都在磁盘上',
    fs.existsSync(path.join(workRoot, 'main', 'books', `上传测试书-${conflictA.slice(0, 8)}.txt`)) &&
      fs.existsSync(path.join(workRoot, 'main', 'books', `上传测试书-${conflictB.slice(0, 8)}.txt`)),
  );

  /* ---------------- 9. 漫画代理 ---------------- */
  section('9. 漫画取图');
  const pages0 = await apiJson('/api/comic/comic-1/pages?i=0');
  ok('清单返回 total = 3', pages0.body?.ok === true && pages0.body?.total === 3, JSON.stringify(pages0.body));
  ok('清单第一次来自源站（fromCache=false）', pages0.body?.fromCache === false, String(pages0.body?.fromCache));
  ok('清单里没有任何源站地址', !pages0.text.includes('/img/') && !pages0.text.includes(String(primary.imageBase)));
  ok('清单里没有 urls 字段', pages0.body?.urls === undefined);

  const pages0Again = await apiJson('/api/comic/comic-1/pages?i=0');
  ok('第二次命中内存缓存（fromCache=true）', pages0Again.body?.fromCache === true, String(pages0Again.body?.fromCache));

  const page0 = await fetch(`${base}/api/comic/comic-1/page?i=0&p=0`, { headers: headers() });
  const page0Body = Buffer.from(await page0.arrayBuffer());
  ok('首页返回 200', page0.status === 200, String(page0.status));
  ok('Content-Type 是 image/*', String(page0.headers.get('content-type') || '').startsWith('image/'), String(page0.headers.get('content-type')));
  ok('Content-Length 与字节数一致', Number(page0.headers.get('content-length')) === page0Body.length, `${page0.headers.get('content-length')} vs ${page0Body.length}`);
  ok('首页字节是合法 PNG', page0Body.subarray(1, 4).toString('latin1') === 'PNG', page0Body.subarray(0, 8).toString('hex'));
  ok('X-Folio-Page = 1/3', page0.headers.get('x-folio-page') === '1/3', String(page0.headers.get('x-folio-page')));
  ok('图片响应 Cache-Control: no-store', String(page0.headers.get('cache-control') || '').includes('no-store'));

  const stats1 = await (await fetch(`${primary.imageBase}/_stats`)).json();
  ok('取图时带上了源站要求的 Referer', stats1.referers.some((r) => String(r).startsWith(primary.imageBase)), JSON.stringify(stats1.referers));
  const hitsAfterFirst = stats1.total;

  const page0Cached = await fetch(`${base}/api/comic/comic-1/page?i=0&p=0`, { headers: headers() });
  const page0CachedBody = Buffer.from(await page0Cached.arrayBuffer());
  const stats2 = await (await fetch(`${primary.imageBase}/_stats`)).json();
  ok('再取同一页字节一致', page0CachedBody.equals(page0Body));
  ok('再取同一页不再回源（内存字节缓存生效）', stats2.total === hitsAfterFirst, `${hitsAfterFirst} → ${stats2.total}`);

  const outOfBounds = await apiJson('/api/comic/comic-1/page?i=0&p=9');
  ok('页号越界 → 400', outOfBounds.res.status === 400, String(outOfBounds.res.status));
  ok('越界错误体带 total', outOfBounds.body?.total === 3, JSON.stringify(outOfBounds.body));

  const tooBigPage = await apiJson('/api/comic/comic-1/page?i=1&p=1');
  ok('单页 > 6MiB → 413', tooBigPage.res.status === 413, String(tooBigPage.res.status));

  const brokenPage = await apiJson('/api/comic/comic-1/page?i=2&p=0');
  ok('源站失败 → 502', brokenPage.res.status === 502, String(brokenPage.res.status));
  ok(
    '502 文案是「源站没有返回这张图」',
    brokenPage.body?.error === '源站没有返回这张图',
    String(brokenPage.body?.error),
  );

  const htmlPage = await apiJson('/api/comic/comic-1/page?i=3&p=0');
  ok('源站回 HTML 页也当失败（502）', htmlPage.res.status === 502, String(htmlPage.res.status));

  const emptyChapter = await apiJson('/api/comic/comic-1/pages?i=4');
  ok('解析不到图片 → 502', emptyChapter.res.status === 502, String(emptyChapter.res.status));

  const unknownChapter = await apiJson('/api/comic/comic-1/pages?i=99');
  ok('不存在的话 → 502', unknownChapter.res.status === 502, String(unknownChapter.res.status));

  const notComic = await apiJson('/api/comic/local-1/pages?i=0');
  ok('非漫画书 → 400', notComic.res.status === 400, String(notComic.res.status));
  const noIndex = await apiJson('/api/comic/comic-1/pages');
  ok('缺话号 → 400', noIndex.res.status === 400, String(noIndex.res.status));
  const missingComic = await apiJson('/api/comic/nope/pages?i=0');
  ok('不存在的漫画 → 404', missingComic.res.status === 404, String(missingComic.res.status));
  const comicNoAuth = await fetch(`${base}/api/comic/comic-1/pages?i=0`);
  ok('漫画同样要访问码 → 401', comicNoAuth.status === 401, String(comicNoAuth.status));

  /* ---------------- 10. 参数校验 ---------------- */
  section('10. 上传参数校验');
  const badHashParam = await apiJson('/api/upload/status?hash=zzz&size=100');
  ok('hash 不合法 → 400', badHashParam.res.status === 400, String(badHashParam.res.status));
  const tooLargeStatus = await apiJson(`/api/upload/status?hash=${payloadHash}&size=${31 * MiB}`);
  ok('声明大小超过 30MiB → 413', tooLargeStatus.res.status === 413, String(tooLargeStatus.res.status));
  const noSize = await apiJson(`/api/upload/status?hash=${payloadHash}`);
  ok('缺 size → 400', noSize.res.status === 400, String(noSize.res.status));
  const emptyChunk = await fetch(`${base}/api/upload/chunk`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/octet-stream',
      'X-Folio-Hash': payloadHash,
      'X-Folio-Offset': '0',
      'X-Folio-Total': String(MAX_TRANSFER),
      'X-Folio-Name': 'x',
    }),
    body: Buffer.alloc(0),
  });
  ok('空分块 → 400', emptyChunk.status === 400, String(emptyChunk.status));

  // 单块请求体上限 6MiB：给 4MiB 留余量，同时不抬高全局 MAX_BODY
  const hugeHash = sha1(Buffer.from('oversized-chunk-probe', 'utf8'));
  const hugeChunk = await fetch(`${base}/api/upload/chunk`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/octet-stream',
      'X-Folio-Hash': hugeHash,
      'X-Folio-Offset': '0',
      'X-Folio-Total': String(MAX_TRANSFER),
      'X-Folio-Name': encodeURIComponent('超大分块书'),
    }),
    body: Buffer.alloc(7 * MiB, 0x42),
  }).catch((err) => ({ status: -1, error: err }));
  ok('单块超过 6MiB → 413', hugeChunk.status === 413, String(hugeChunk.status));
  const hugeLeftOver = await apiJson(`/api/upload/status?hash=${hugeHash}&size=${MAX_TRANSFER}`);
  ok('413 之后没有留下半截会话', hugeLeftOver.body?.received === 0, String(hugeLeftOver.body?.received));

  /* ---------------- 11. 只读模式 ---------------- */
  section('11. 只读模式（桌面端关闭写入）');
  const ro = await startFixture(path.join(workRoot, 'readonly'), ['--readonly']);
  try {
    const roBase = `http://127.0.0.1:${ro.port}`;
    const roStatus = await fetch(`${roBase}/api/upload/status?hash=${payloadHash}&size=${payload.length}`, {
      headers: { 'X-Folio-Token': ro.token },
    });
    ok('只读模式下 upload/status → 403', roStatus.status === 403, String(roStatus.status));
    const roChunk = await fetch(`${roBase}/api/upload/chunk`, {
      method: 'POST',
      headers: {
        'X-Folio-Token': ro.token,
        'Content-Type': 'application/octet-stream',
        'X-Folio-Hash': payloadHash,
        'X-Folio-Offset': '0',
        'X-Folio-Total': String(payload.length),
        'X-Folio-Name': encodeURIComponent('只读书'),
      },
      body: Buffer.from('abc'),
    });
    ok('只读模式下 upload/chunk → 403', roChunk.status === 403, String(roChunk.status));
    const roDel = await fetch(`${roBase}/api/upload/${payloadHash}`, {
      method: 'DELETE',
      headers: { 'X-Folio-Token': ro.token },
    });
    ok('只读模式下 DELETE 会话 → 403', roDel.status === 403, String(roDel.status));
    const roLib = await fetch(`${roBase}/api/library`, { headers: { 'X-Folio-Token': ro.token } });
    ok('只读模式不影响清单（只读接口照常）', roLib.status === 200, String(roLib.status));
  } finally {
    await ro.stop();
  }

  await primary.stop();
}

/* ------------------------------------------------------------------ */

main()
  .then(() => {
    process.stdout.write(`\n${failures.length ? '✗' : '✓'} ${passed} 通过 / ${failures.length} 失败\n`);
    if (failures.length) {
      process.stdout.write('失败项：\n');
      for (const item of failures) process.stdout.write(`  - ${item}\n`);
    }
    if (!keep) fs.rmSync(workRoot, { recursive: true, force: true });
    else process.stdout.write(`\n临时目录保留在：${workRoot}\n`);
    process.exit(failures.length ? 1 : 0);
  })
  .catch((err) => {
    process.stderr.write(`\n自查异常：${err?.stack || err}\n`);
    if (!keep) fs.rmSync(workRoot, { recursive: true, force: true });
    else process.stderr.write(`临时目录：${workRoot}\n`);
    process.exit(2);
  });
