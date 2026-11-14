/**
 * QA 独立验证：用夹具当「假手机」，把双向整文件同步链路整条跑通。
 *
 * 与 `_lan-sync-check.mjs` 的区别：那个脚本验「接口各自对不对」；
 * 这个脚本模拟手机端的**同步决策与搬运动作**，验「两端合起来效果对不对」：
 *   1. 上行：手机上传一本本地书 → 桌面 books.json 有它（syncedFrom/contentHash/正文一致）
 *   2. 下行：拉 12MiB 大书全量 + 中途断开再 Range 续传 → 整本 sha1 一致
 *   3. 幂等与冲突：同 hash 不重复建条；同名不同 hash 并存且 id 不同
 *   4. 30MiB 边界：31MiB 在清单里不可同步且下载 413
 *   5. 云端书（小说 + 漫画）不可同步、漫画清单不泄漏源站 URL
 *
 * 全程只打 127.0.0.1，用 `_lan-fixture.mjs` 起的真 HTTP 服务，不碰真实书架。
 *
 * 用法：node tools/_qa-sync-e2e.mjs
 * 退出码 0 = 全绿。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'tools', '_lan-fixture.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-qa-sync-'));
const booksDir = path.join(dir, 'books');
const booksJson = path.join(dir, 'books.json');

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    process.stdout.write(`  ✓ ${name}${extra ? `  (${extra})` : ''}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  ✗ ${name}${extra ? `  ← ${extra}` : ''}\n`);
  }
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/* ---------------- 起夹具 ---------------- */
const child = spawn(process.execPath, [fixturePath, dir, '20200', '--big', '--comic'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const info = await new Promise((resolve, reject) => {
  let buf = '';
  const timer = setTimeout(() => reject(new Error(`夹具 20s 没起来：${buf}`)), 20000);
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const line = buf.split('\n').find((l) => l.trim().startsWith('{'));
    if (!line) return;
    try {
      const json = JSON.parse(line);
      clearTimeout(timer);
      resolve(json);
    } catch {
      /* 还没收全 */
    }
  });
  child.on('exit', (code) => reject(new Error(`夹具提前退出 code=${code}`)));
});
const base = `http://127.0.0.1:${info.port}`;
const H = { 'X-Folio-Token': info.token };
process.stdout.write(`\n夹具已启动 ${base}（token ${info.token}）\n`);

const readShelf = () => {
  try {
    return JSON.parse(fs.readFileSync(booksJson, 'utf8'));
  } catch {
    return [];
  }
};

/* ---------------- 1. 上行：模拟手机传一本本机书 ---------------- */
process.stdout.write('\n1. 上行：手机上传本机书 → 桌面书架\n');
{
  const text =
    '第一章 手机上写的书\n这本是 QA 用夹具模拟「手机导入的本机书」，用来验证上行同步。\n' +
    '第二章 收尾\n到这行结束。\n'.repeat(1);
  const content = Buffer.from(text, 'utf8');
  const hash = sha1(content);

  const before = readShelf().length;
  const status = await (await fetch(`${base}/api/upload/status?hash=${hash}&size=${content.length}`, { headers: H })).json();
  ok('上传前 status.received=0 / done=false', status.received === 0 && status.done === false, JSON.stringify(status));

  // 故意分两块发（模拟手机 4MiB 串行分块的形状，书小就用 20 字节切）
  const cut = 20;
  const part1 = content.subarray(0, cut);
  const part2 = content.subarray(cut);
  const r1 = await (
    await fetch(`${base}/api/upload/chunk`, {
      method: 'POST',
      headers: {
        ...H,
        'Content-Type': 'application/octet-stream',
        'X-Folio-Hash': hash,
        'X-Folio-Offset': '0',
        'X-Folio-Total': String(content.length),
        'X-Folio-Name': encodeURIComponent('QA上行书'),
      },
      body: part1,
    })
  ).json();
  ok('第一块 done=false', r1.done === false, JSON.stringify(r1));

  const r2 = await (
    await fetch(`${base}/api/upload/chunk`, {
      method: 'POST',
      headers: {
        ...H,
        'Content-Type': 'application/octet-stream',
        'X-Folio-Hash': hash,
        'X-Folio-Offset': String(cut),
        'X-Folio-Total': String(content.length),
        'X-Folio-Name': encodeURIComponent('QA上行书'),
      },
      body: part2,
    })
  ).json();
  ok('最后一块 done=true 且回 id', r2.done === true && r2.id === `sha1-${hash}`, JSON.stringify(r2));

  const shelf = readShelf();
  const book = shelf.find((b) => b.contentHash === hash);
  ok('桌面 books.json 出现该书', Boolean(book), book ? book.id : '(缺失)');
  ok('条目数只 +1', shelf.length === before + 1, `${before} → ${shelf.length}`);
  ok('syncedFrom=android', book?.syncedFrom === 'android', String(book?.syncedFrom));
  ok('contentHash 与上传内容 sha1 一致', book?.contentHash === hash, String(book?.contentHash));
  ok('size 与上传字节数一致', Number(book?.size) === content.length, `${book?.size} vs ${content.length}`);
  ok('kind=local（可参与后续搬运）', book?.kind === 'local', String(book?.kind));

  const landed = book?.filePath ? fs.readFileSync(book.filePath) : Buffer.alloc(0);
  ok('books/ 下的正文与上传字节逐字节一致', Buffer.compare(landed, content) === 0, `${landed.length}B`);
  ok('落盘文件名带 hash 前 8 位', String(book?.filePath || '').includes(hash.slice(0, 8)), path.basename(String(book?.filePath || '')));
  ok('books/.incoming 无残留 .part', (() => {
    const inc = path.join(booksDir, '.incoming');
    try {
      return fs.readdirSync(inc).filter((n) => n.endsWith('.part')).length === 0;
    } catch {
      return true;
    }
  })());

  // 幂等：同一份内容再传一次
  const again = await (
    await fetch(`${base}/api/upload/chunk`, {
      method: 'POST',
      headers: {
        ...H,
        'Content-Type': 'application/octet-stream',
        'X-Folio-Hash': hash,
        'X-Folio-Offset': '0',
        'X-Folio-Total': String(content.length),
        'X-Folio-Name': encodeURIComponent('QA上行书-改名再来一次'),
      },
      body: content,
    })
  ).json();
  const afterAgain = readShelf();
  ok('同内容重复上传不新增条目', afterAgain.length === shelf.length, `${shelf.length} → ${afterAgain.length}`);
  ok(
    '同内容重复上传复用同一个 id',
    again.id === `sha1-${hash}` && afterAgain.filter((b) => b.contentHash === hash).length === 1,
    JSON.stringify({ id: again.id, created: again.created }),
  );
}

/* ---------------- 2. 下行：12MiB 全量 + 断点续传 ---------------- */
process.stdout.write('\n2. 下行：12MiB 整本 + 中途断开 Range 续传\n');
{
  const meta = await fetch(`${base}/api/book/big-12/download`, { headers: { ...H, Range: 'bytes=0-0' } });
  const size = Number(meta.headers.get('x-folio-size') || 0);
  const expectHash = meta.headers.get('x-folio-hash') || '';
  await meta.arrayBuffer();
  ok('能拿到 X-Folio-Size / X-Folio-Hash', size === 12 * 1024 * 1024 && expectHash.length === 40, `${size}B hash=${expectHash.slice(0, 8)}…`);

  // 2.1 全量
  const full = Buffer.from(await (await fetch(`${base}/api/book/big-12/download`, { headers: H })).arrayBuffer());
  ok('全量下载字节数 = 12MiB', full.length === size, `${full.length}`);
  ok('全量下载 sha1 与 X-Folio-Hash 一致', sha1(full) === expectHash, sha1(full).slice(0, 8) + '…');

  // 2.2 前半段（模拟传到一半断了）
  const half = Math.floor(size / 2);
  const head = await fetch(`${base}/api/book/big-12/download`, { headers: { ...H, Range: `bytes=0-${half - 1}` } });
  ok('前半段响应 206', head.status === 206, String(head.status));
  const headBuf = Buffer.from(await head.arrayBuffer());
  ok('前半段长度正确', headBuf.length === half, `${headBuf.length}`);

  // 2.3 从 half 续传
  const tail = await fetch(`${base}/api/book/big-12/download`, { headers: { ...H, Range: `bytes=${half}-` } });
  ok('续传响应 206', tail.status === 206, String(tail.status));
  const tailBuf = Buffer.from(await tail.arrayBuffer());
  const joined = Buffer.concat([headBuf, tailBuf]);
  ok('拼回来的整本长度 = 原文件', joined.length === size, `${joined.length}`);
  ok('拼回来的整本 sha1 仍然一致', sha1(joined) === expectHash, sha1(joined).slice(0, 8) + '…');
  ok('两次分段不重叠（字节完全一致）', Buffer.compare(joined, full) === 0);

  // 2.4 续传起点等于文件大小 → 416
  const past = await fetch(`${base}/api/book/big-12/download`, { headers: { ...H, Range: `bytes=${size}-` } });
  ok('续传起点 == 文件大小 → 416', past.status === 416, String(past.status));
  await past.arrayBuffer();
}

/* ---------------- 3. 同名不同内容：并存 + id 不同 ---------------- */
process.stdout.write('\n3. 冲突：同名不同 hash 并存\n');
{
  const a = Buffer.from('《同名书》甲版本\n这是 A 版内容。\n', 'utf8');
  const b = Buffer.from('《同名书》乙版本，内容完全不同，长度也不同长度也不同。\n', 'utf8');
  const hashA = sha1(a);
  const hashB = sha1(b);
  const send = (buf, hash, name) =>
    fetch(`${base}/api/upload/chunk`, {
      method: 'POST',
      headers: {
        ...H,
        'Content-Type': 'application/octet-stream',
        'X-Folio-Hash': hash,
        'X-Folio-Offset': '0',
        'X-Folio-Total': String(buf.length),
        'X-Folio-Name': encodeURIComponent(name),
      },
      body: buf,
    }).then((res) => res.json());

  const ra = await send(a, hashA, '同名书');
  const rb = await send(b, hashB, '同名书');
  ok('两版都上传成功且 created=true', ra.created === true && rb.created === true, `${ra.id} / ${rb.id}`);
  ok('两条 id 不同', ra.id !== rb.id, `${ra.id} vs ${rb.id}`);

  const shelf = readShelf();
  const both = shelf.filter((x) => x.contentHash === hashA || x.contentHash === hashB);
  ok('书架里两本并存', both.length === 2, `${both.length}`);
  ok('两本各自保留自己的 contentHash', both.some((x) => x.contentHash === hashA) && both.some((x) => x.contentHash === hashB));
  ok(
    '两本正文各自独立（没有互相覆盖）',
    (() => {
      const fa = both.find((x) => x.contentHash === hashA)?.filePath;
      const fb = both.find((x) => x.contentHash === hashB)?.filePath;
      return fa && fb && fs.readFileSync(fa).equals(a) && fs.readFileSync(fb).equals(b);
    })(),
  );
}

/* ---------------- 4. 30MiB 边界 ---------------- */
process.stdout.write('\n4. 30MiB 边界\n');
{
  const shelf = await (await fetch(`${base}/api/library`, { headers: H })).json();
  const byId = (id) => shelf.books.find((x) => x.id === id) || {};
  const exact = byId('big-30');
  const over = byId('big-over');
  ok('正好 30MiB → syncable=true', exact.syncable === true, `size=${exact.size}`);
  ok('31MiB → syncable=false', over.syncable === false, `size=${over.size}`);
  ok('31MiB 带中文原因', /30MB/.test(String(over.syncableReason || '')), String(over.syncableReason || ''));

  const dl = await fetch(`${base}/api/book/big-over/download`, { headers: H });
  const body = await dl.json().catch(() => ({}));
  ok('31MiB 下载 → 413', dl.status === 413, JSON.stringify(body).slice(0, 120));

  const st = await fetch(`${base}/api/upload/status?hash=${'9'.repeat(40)}&size=${30 * 1024 * 1024 + 1}`, { headers: H });
  ok('31MiB 上传探测 → 413', st.status === 413, String(st.status));
  await st.arrayBuffer();
}

/* ---------------- 5. 云端书（小说 + 漫画）不可同步 ---------------- */
process.stdout.write('\n5. 云端书：不可整文件同步，漫画清单不泄漏源站地址\n');
{
  const shelf = await (await fetch(`${base}/api/library`, { headers: H })).json();
  const cloud = shelf.books.find((x) => x.id === 'cloud-1') || {};
  const comic = shelf.books.find((x) => x.id === 'comic-1') || {};
  ok('云端小说 syncable=false', cloud.syncable === false, String(cloud.syncableReason || ''));
  ok('云端漫画 syncable=false', comic.syncable === false, String(comic.syncableReason || ''));
  ok('云端漫画 type=2（客户端据此进漫画阅读器）', comic.type === 2, String(comic.type));

  const dlCloud = await fetch(`${base}/api/book/cloud-1/download`, { headers: H });
  ok('云端书走整文件下载 → 409（不是 200/500）', dlCloud.status === 409, String(dlCloud.status));
  await dlCloud.arrayBuffer();

  const pages = await (await fetch(`${base}/api/comic/comic-1/pages?i=0`, { headers: H })).json();
  ok('漫画清单只回 total', pages.ok === true && pages.total === 3, JSON.stringify(pages));
  ok('清单里没有 urls / 源站地址', !('urls' in pages) && !JSON.stringify(pages).includes('http'), Object.keys(pages).join(','));
  ok('清单里没有 referer（防盗链头不出机器）', !('referer' in pages) && !JSON.stringify(pages).includes('referer'));

  const page = await fetch(`${base}/api/comic/comic-1/page?i=0&p=0`, { headers: H });
  const bytes = Buffer.from(await page.arrayBuffer());
  ok('单页返回真 PNG', page.status === 200 && bytes[0] === 0x89 && bytes[1] === 0x50, `${bytes.length}B`);
  ok('单页响应 no-store（配合手机端零缓存）', page.headers.get('cache-control') === 'no-store', String(page.headers.get('cache-control')));
}

/* ---------------- 收尾 ---------------- */
child.kill();
await new Promise((r) => setTimeout(r, 300));
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* 临时目录删不掉不影响结论 */
}

process.stdout.write(`\n=== 汇总：${passed + failed} 项，通过 ${passed}，失败 ${failed} ===\n`);
process.exit(failed ? 1 : 0);
