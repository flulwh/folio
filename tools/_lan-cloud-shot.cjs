/**
 * 云端书在手机面板上的端到端验证。
 *
 *   node tools/_lan-cloud-shot.cjs
 *
 * 前提：应用以 --remote-debugging-port=9222 启动（FOLIO_DATA_DIR 指向可写目录），
 *      局域网面板已开启。
 *
 * 不联网：先在磁盘缓存里铺一本「云端书」（toc.json + 章节正文），
 * 主进程走的是真实链路 —— 缓存命中就直接返回，和真书源命中缓存时完全一样。
 * 产物：tools/_lan-cloud-reader.png、tools/_lan-cloud-toc.png
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CDP = Number(process.env.CDP_PORT || 9222);
const DATA_DIR = process.env.FOLIO_DATA_DIR || path.join(__dirname, '..', '.folio-test-data');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const BOOKS_FILE = path.join(DATA_DIR, 'books.json');

const SOURCE_ID = 'testsrc';
const BOOK_URL = 'http://example.test/book/';
const BOOK_ID = `cloud::${SOURCE_ID}::${BOOK_URL}`;
const TOTAL = 30;
const PARAS_PER_CHAPTER = 34;

const getJson = (p) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: CDP, path: p }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve(JSON.parse(b)));
      })
      .on('error', reject);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && extra ? `  ← ${extra}` : ''}`);
  if (!cond) failed += 1;
};

/** 铺一本缓存齐全的云端书，返回章节标题 */
function seedCloudBook() {
  const chapters = Array.from({ length: TOTAL }, (_, i) => ({
    title: `第 ${i + 1} 章 · 缓存测试`,
    url: `${BOOK_URL}c/${i + 1}.html`,
  }));

  const key = crypto.createHash('sha1').update(`${SOURCE_ID}|${BOOK_URL}`).digest('hex').slice(0, 20);
  const dir = path.join(DATA_DIR, 'cloud', key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'toc.json'),
    JSON.stringify({ chapters, fetchedAt: Date.now(), sourceName: '测试源' }),
    'utf8'
  );

  chapters.forEach((item, index) => {
    const suffix = crypto.createHash('sha1').update(item.url).digest('hex').slice(0, 8);
    const paras = Array.from(
      { length: PARAS_PER_CHAPTER },
      (_, p) => `第 ${index + 1} 章第 ${p + 1} 段：手机端要能把这一章完整读出来，翻章时进度也要跟着章节走。`
    );
    fs.writeFileSync(
      path.join(dir, `c-${index}-${suffix}.txt`),
      `${item.title}\n\n${paras.join('\n\n')}\n`,
      'utf8'
    );
  });

  // 书架 + 书源 + 进度
  const books = JSON.parse(fs.readFileSync(BOOKS_FILE, 'utf8'));
  if (!books.some((b) => b.id === BOOK_ID)) {
    books.push({
      id: BOOK_ID,
      kind: 'cloud',
      name: '云端测试书',
      author: '作者：测试',
      sourceId: SOURCE_ID,
      sourceName: '测试源',
      bookUrl: BOOK_URL,
      cover: '',
      hue: 268,
      addedAt: Date.now(),
    });
    fs.writeFileSync(BOOKS_FILE, JSON.stringify(books, null, 2), 'utf8');
  }

  const sourcesFile = path.join(DATA_DIR, 'sources.json');
  let sources = [];
  try {
    sources = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
  } catch {
    sources = [];
  }
  if (!sources.some((s) => s.id === SOURCE_ID)) {
    sources.push({ id: SOURCE_ID, name: '测试源', enabled: true, bookSourceUrl: 'http://example.test' });
    fs.writeFileSync(sourcesFile, JSON.stringify(sources), 'utf8');
  }

  const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  // 每次都重置到第 12 章：上次跑完会停在第 3 章，留着会让「翻下一章」的断言错位
  progress[BOOK_ID] = {
    chapter: 11,
    windowBase: 11,
    chapterTitle: '第 12 章 · 缓存测试',
    paraIndex: 6,
    percent: ((11 + 6 / PARAS_PER_CHAPTER) / TOTAL) * 100,
    updatedAt: Date.now() - 5000,
  };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
  return chapters;
}

(async () => {
  const chapters = seedCloudBook();
  console.log(`  铺好 ${chapters.length} 章的云端书缓存`);

  const target = (await getJson('/json/list')).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  await call('Runtime.enable');
  await call('Page.enable');

  const js = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  };
  const shot = async (name) => {
    const res = await call('Page.captureScreenshot', { format: 'png' });
    if (!res?.data) return;
    const file = path.join(__dirname, name);
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    console.log(`  → ${file}`);
  };

  const status = JSON.parse((await js(`window.readerAPI.lanStatus().then((s) => JSON.stringify(s))`)) || '{}');
  ok('局域网服务在运行', status.running === true, JSON.stringify(status));
  if (!status.running) {
    ws.close();
    process.exit(1);
  }
  const token = status.token;
  const base = `http://127.0.0.1:${status.port}`;
  console.log(`  服务：${base}  访问码：${token}`);

  // 重启服务让前端资源重新读一遍（改过 html/js/css 时要走这一步）
  await js(
    `window.readerAPI.lanStart(${JSON.stringify({ enabled: true, port: status.port, token, allowWrite: status.allowWrite })}).then((s) => JSON.stringify(s))`
  );
  await sleep(400);

  /* ---------- 手机视口打开面板 ---------- */
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `${base}/?t=${token}` });
  await sleep(2000);

  const shelf = JSON.parse(
    (await js(`(() => {
      const cards = [...document.querySelectorAll('.card')];
      const cloud = cards.find((c) => c.dataset.bookId === ${JSON.stringify(BOOK_ID)});
      const idx = cloud ? cards.indexOf(cloud) : -1;
      return JSON.stringify({ cards: cards.length, idx, badge: cloud?.querySelector('.card-badge')?.textContent || '' });
    })()`)) || '{}'
  );
  ok('书架上有这本云端书', shelf.idx >= 0, `${shelf.cards} 张卡片`);
  ok('云端书带「云端」标记', shelf.badge === '云端', shelf.badge);

  /* ---------- 打开：目录 + 第 12 章 ---------- */
  await js(`(() => {
    const cards = [...document.querySelectorAll('.card')];
    cards.find((c) => c.dataset.bookId === ${JSON.stringify(BOOK_ID)}).click();
    return true;
  })()`);
  await sleep(2600);

  const opened = JSON.parse(
    (await js(`(() => {
      const view = document.getElementById('readerView');
      const chapter = document.getElementById('readerChapter');
      return JSON.stringify({
        open: view && !view.hidden,
        paras: document.querySelectorAll('#paper p').length,
        chapter: chapter.textContent,
        clickable: chapter.classList.contains('link') && document.getElementById('readerMeta').disabled === false,
        prevHref: !document.getElementById('prevChapter').hidden,
        nextHref: !document.getElementById('nextChapter').hidden,
        pct: document.getElementById('readerPct').textContent,
        scrollTop: Math.round(document.getElementById('readerScroll').scrollTop),
        error: document.querySelector('#paper .reader-error')?.textContent || '',
      });
    })()`)) || '{}'
  );
  ok('阅读视图打开', opened.open === true, opened.error);
  ok('正文渲染出来了', opened.paras > 20, `${opened.paras} 段`);
  ok('章节标题是上次读到的那章', String(opened.chapter).includes('第 12 章'), opened.chapter);
  ok('标题可点开目录', opened.clickable === true);
  ok('底栏出现翻章按钮', opened.prevHref === true && opened.nextHref === true);
  ok('按上次章内位置恢复', opened.scrollTop > 100, `scrollTop=${opened.scrollTop}`);
  await shot('_lan-cloud-reader.png');

  /* ---------- 翻下一章 ---------- */
  await js(`document.getElementById('nextChapter').click();`);
  await sleep(2200);
  const next = JSON.parse(
    (await js(`(() => JSON.stringify({
      chapter: document.getElementById('readerChapter').textContent,
      paras: document.querySelectorAll('#paper p').length,
      first: document.querySelector('#paper p')?.textContent?.slice(0, 24) || '',
      pct: document.getElementById('readerPct').textContent,
    }))()`)) || '{}'
  );
  ok('翻到第 13 章', String(next.chapter).includes('第 13 章'), next.chapter);
  ok('新章正文换了', next.first.includes('第 13 章第 1 段') || next.paras > 20, next.first);

  /* ---------- 目录：打开、当前章高亮、跳章 ---------- */
  await js(`document.getElementById('readerChapter').click();`);
  await sleep(700);
  const sheet = JSON.parse(
    (await js(`(() => {
      const el = document.getElementById('tocSheet');
      const list = document.getElementById('tocList');
      const row = document.querySelector('.toc-row.current');
      const listRect = list.getBoundingClientRect();
      const rowRect = row ? row.getBoundingClientRect() : null;
      return JSON.stringify({
        open: el && !el.hidden,
        rows: document.querySelectorAll('.toc-row').length,
        current: row?.dataset.i || '',
        count: document.getElementById('tocCount').textContent,
        scrollTop: Math.round(list.scrollTop),
        visible: !!rowRect && rowRect.top >= listRect.top - 2 && rowRect.bottom <= listRect.bottom + 2,
      });
    })()`)) || '{}'
  );
  ok('目录打开', sheet.open === true);
  ok('目录章数对得上', sheet.rows === TOTAL, `${sheet.rows} 行`);
  ok('当前章高亮在第 13 章', sheet.current === '12', sheet.current);
  ok('当前章在可视区内', sheet.visible === true, `scrollTop=${sheet.scrollTop}`);
  await shot('_lan-cloud-toc.png');

  await js(`(() => {
    const input = document.getElementById('tocSearch');
    input.value = '第 20 章';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  ok('云端目录也能按标题搜索', (await js(`document.querySelectorAll('.toc-row').length`)) === 1);
  await js(`(() => {
    const input = document.getElementById('tocSearch');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

  await js(`(() => { document.querySelector('.toc-row[data-i="2"]').click(); return true; })()`);
  await sleep(2200);
  const jumped = JSON.parse(
    (await js(`(() => JSON.stringify({
      chapter: document.getElementById('readerChapter').textContent,
      sheetClosed: document.getElementById('tocSheet').hidden,
      paras: document.querySelectorAll('#paper p').length,
    }))()`)) || '{}'
  );
  ok('点目录跳到第 3 章', String(jumped.chapter).includes('第 3 章'), jumped.chapter);
  ok('跳章后目录收起', jumped.sheetClosed === true);
  ok('跳章后有正文', jumped.paras > 20, `${jumped.paras} 段`);

  /* ---------- 滚动 → 进度写回（章号 + 章内位置 + 全书百分比） ---------- */
  await js(`(() => {
    const sc = document.getElementById('readerScroll');
    sc.scrollTop = Math.round(sc.scrollHeight * 0.6);
    sc.dispatchEvent(new Event('scroll'));
    return true;
  })()`);
  await sleep(2400);

  const saved = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))[BOOK_ID] || {};
  ok('写回的章号是第 3 章', saved.chapter === 2 && saved.windowBase === 2, JSON.stringify(saved.chapter));
  ok('章内位置写回了', Number(saved.paraIndex) > 5, String(saved.paraIndex));
  ok('全书百分比跟着章节走', Number(saved.percent) > 5 && Number(saved.percent) < 15, String(saved.percent));
  ok('章名一起写回', String(saved.chapterTitle).includes('第 3 章'), saved.chapterTitle);

  /* ---------- 桌面端接到同一条 ---------- */
  await call('Emulation.clearDeviceMetricsOverride');
  await call('Page.navigate', { url: 'http://127.0.0.1:5173/' });
  await sleep(2600);
  const inApp = JSON.parse(
    (await js(`window.readerAPI.getProgress().then((p) => JSON.stringify(p[${JSON.stringify(BOOK_ID)}] || {}))`)) || '{}'
  );
  ok(
    '桌面端拿到手机写的章号',
    Number(inApp.chapter) === Number(saved.chapter) && Number(inApp.windowBase) === Number(saved.windowBase),
    `chapter ${inApp.chapter} vs ${saved.chapter}`
  );

  /* ---------- 进度条按全书比例跳转 ---------- */
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `${base}/?t=${token}#${encodeURIComponent(BOOK_ID)}` });
  await sleep(2400);
  await js(`(() => {
    const range = document.getElementById('progressRange');
    range.value = '600';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(2600);
  const seeked = JSON.parse(
    (await js(`(() => JSON.stringify({
      chapter: document.getElementById('readerChapter').textContent,
      paras: document.querySelectorAll('#paper p').length,
    }))()`)) || '{}'
  );
  ok('拖动进度条跳到全书 60% 附近', String(seeked.chapter).includes('第 19 章'), seeked.chapter);
  ok('跳转后正文已加载', seeked.paras > 20, `${seeked.paras} 段`);

  console.log(`\n${failed ? '✗' : '✓'} ${failed} 项失败`);
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('验证脚本异常：', err);
  process.exit(1);
});
