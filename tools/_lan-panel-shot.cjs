/**
 * 局域网面板端到端验证：真浏览器渲染 → 打开书 → 滚动 → 进度写回桌面端磁盘。
 *
 *   node tools/_lan-panel-shot.cjs
 *
 * 前提：应用以 --remote-debugging-port=9222 启动，且局域网面板已开启。
 * 产物：tools/_lan-panel-desktop.png / _lan-panel-mobile.png / _lan-panel-reader.png
 * 退出码非 0 表示有断言失败。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const CDP = Number(process.env.CDP_PORT || 9222);
const DATA_DIR = process.env.FOLIO_DATA_DIR || path.join(__dirname, '..', '.folio-test-data');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');

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

(async () => {
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

  // 从应用里取服务信息（顺带验证 IPC 面是通的）
  const status = JSON.parse(
    (await js(`window.readerAPI.lanStatus().then((s) => JSON.stringify(s))`)) || '{}'
  );
  ok('局域网服务在运行', status.running === true, JSON.stringify(status));
  if (!status.running) {
    ws.close();
    process.exit(1);
  }
  const token = status.token;
  const base = `http://127.0.0.1:${status.port}`;
  console.log(`  服务：${base}  访问码：${token}`);

  // 重启一次：面板的 html/css/js 由服务端启动时读进内存，改过前端要重新加载才生效
  await js(
    `window.readerAPI.lanStart(${JSON.stringify({
      enabled: true,
      port: status.port,
      token,
      allowWrite: status.allowWrite,
    })}).then((s) => JSON.stringify(s))`
  );
  await sleep(500);

  /* ---------- 面板：桌面宽度 ---------- */
  await call('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `${base}/?t=${token}` });
  await sleep(2200);

  const shelf = JSON.parse(
    (await js(`(() => {
      const text = document.body.innerText;
      return JSON.stringify({
        url: location.href,
        hasBrand: !!document.querySelector('.brand'),
        cards: document.querySelectorAll('.card').length,
        hero: !!document.querySelector('.hero') && !document.querySelector('.hero').hidden,
        text: text.slice(0, 120),
        login: text.includes('输入访问码') || text.includes('访问码'),
      });
    })()`)) || '{}'
  );
  ok('面板打开是书架而不是登录页', shelf.hasBrand === true, shelf.text);
  ok('书架渲染出卡片', shelf.cards >= 1, String(shelf.cards));
  ok('地址栏里的访问码已清掉', !shelf.url.includes('t='), shelf.url);
  await shot('_lan-panel-desktop.png');

  /* ---------- 面板：手机宽度 ---------- */
  await call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(600);
  const mobile = JSON.parse(
    (await js(`(() => {
      const grid = document.querySelector('.grid');
      const cs = grid ? getComputedStyle(grid) : null;
      const first = document.querySelector('.card');
      const r = first?.getBoundingClientRect();
      return JSON.stringify({
        cols: cs ? cs.gridTemplateColumns.split(' ').length : 0,
        cardW: r ? Math.round(r.width) : 0,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      });
    })()`)) || '{}'
  );
  ok('窄屏是多列网格', mobile.cols >= 2, `${mobile.cols} 列`);
  ok('没有横向溢出', mobile.overflowX === false);
  await shot('_lan-panel-mobile.png');

  /* ---------- 打开一本书阅读 ---------- */
  const before = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  const entryBefore = before['lan-demo'] || {};

  await js(`(() => { const c = document.querySelector('.card'); c.click(); return true; })()`);
  await sleep(1600);

  const reader = JSON.parse(
    (await js(`(() => {
      const view = document.getElementById('readerView');
      return JSON.stringify({
        open: view && !view.hidden,
        paras: document.querySelectorAll('#paper p').length,
        title: document.getElementById('readerBook').textContent,
        pct: document.getElementById('readerPct').textContent,
        scrollTop: Math.round(document.getElementById('readerScroll').scrollTop),
      });
    })()`)) || '{}'
  );
  ok('阅读视图打开', reader.open === true);
  ok('正文段落渲染出来了', reader.paras > 50, `${reader.paras} 段`);
  ok('按上次位置恢复（不是从头）', reader.scrollTop > 200, `scrollTop=${reader.scrollTop}`);
  await shot('_lan-panel-reader.png');

  /* ---------- 滚动 → 进度写回磁盘 ---------- */
  // 目标比例要和当前位置拉开距离：重复跑这个脚本时，上次就停在同一个百分比上，
  // 固定滚到 35% 会得到「位置没变」的假失败。
  const currentPct = Number(String(reader.pct).replace(/[^\d.]/g, '')) || 0;
  const targetRatio = currentPct < 55 ? 0.82 : 0.22;
  await js(`(() => {
    const sc = document.getElementById('readerScroll');
    sc.scrollTop = Math.round(sc.scrollHeight * ${targetRatio});
    sc.dispatchEvent(new Event('scroll'));
    return true;
  })()`);
  await sleep(2200);

  const after = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  const entryAfter = after['lan-demo'] || {};
  ok(
    '进度写回了本机 progress.json',
    Number(entryAfter.updatedAt) > Number(entryBefore.updatedAt || 0),
    `${entryBefore.updatedAt} → ${entryAfter.updatedAt}`
  );
  ok(
    '位置跟着滚动更新了',
    Math.abs(Number(entryAfter.paraIndex) - Number(entryBefore.paraIndex || 0)) > 5,
    `paraIndex ${entryBefore.paraIndex} → ${entryAfter.paraIndex}`
  );
  ok('百分比跟着变', Math.abs(Number(entryAfter.percent) - Number(entryBefore.percent)) > 1, String(entryAfter.percent));

  /* ---------- 回到桌面端，看它有没有接住 ---------- */
  await call('Emulation.clearDeviceMetricsOverride');
  await call('Page.navigate', { url: 'http://127.0.0.1:5173/' });
  await sleep(2600);
  const desk = JSON.parse(
    (await js(`(() => {
      const cards = [...document.querySelectorAll('.book-card, .shelf-card, .book-item')];
      const text = document.body.innerText.replace(/\\s+/g, ' ');
      return JSON.stringify({ len: text.length, sample: text.slice(0, 160) });
    })()`)) || '{}'
  );
  ok('桌面端回到书架', desk.len > 50, desk.sample);
  await sleep(400);
  const progressInApp = JSON.parse(
    (await js(`window.readerAPI.getProgress().then((p) => JSON.stringify(p['lan-demo'] || {}))`)) || '{}'
  );
  // 面板离开页面时 pagehide 还会补存一次（同一个位置，但页面宽度切回桌面后
  // 段落会重排，段落号可能差几段，百分比才是稳的口径）。
  ok(
    '桌面端拿到的是手机写进去的位置',
    Math.abs(Number(progressInApp.percent) - Number(entryAfter.percent)) <= 2 &&
      Number(progressInApp.updatedAt) >= Number(entryAfter.updatedAt),
    `百分比 ${Number(progressInApp.percent).toFixed(1)} vs ${Number(entryAfter.percent).toFixed(1)}, at ${progressInApp.updatedAt} vs ${entryAfter.updatedAt}`
  );

  console.log(`\n${failed ? '✗' : '✓'} ${failed} 项失败`);
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('验证脚本异常：', err);
  process.exit(1);
});
