/**
 * macOS 边框切换的端到端验证。
 *
 * 起真实的 Folio 应用，通过 CDP 驱动渲染层，走完整的
 * 「落盘 settings → window:set-frame → 重建窗口」链路，检查：
 *   1) 切换过程中应用不退出（重建不误触发 window-all-closed）
 *   2) 新窗口的边框模式确实生效（交通灯出现/消失）
 *   3) 界面状态（当前视图 / 当前书）被还原
 *
 * 关键：窗口重建后旧 CDP target 会死。断言前必须确认
 * 「旧 target 已消失 + 新 target 已出现」，否则会读到旧窗口的旧状态。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
// 用随机高位端口，避免和上一次残留的 Electron / 其他调试会话撞端口。
// 固定端口在连续跑两次时会偶发「连到旧窗口」，把测试结果搞成假失败。
const PORT = 9400 + Math.floor(Math.random() * 400);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = console.log;
let fail = 0;
const check = (name, ok, detail = '') => {
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fail++;
};

async function cdpTargets() {
  return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiters.has(m.id)) {
        const { res, rej } = c.waiters.get(m.id);
        c.waiters.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.waiters.set(id, { res, rej });
      setTimeout(() => {
        if (this.waiters.has(id)) { this.waiters.delete(id); rej(new Error('CDP timeout ' + method)); }
      }, 15000);
    });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function evalIn(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result.value;
}

/** 连上唯一的应用窗口（按标题确认，避免抓到 devtools 之类的 target） */
async function attachWindow(excludeId = null) {
  for (let i = 0; i < 120; i++) {
    let targets = [];
    try { targets = await cdpTargets(); } catch { await sleep(400); continue; }
    const pages = targets.filter(
      (t) => t.type === 'page' && t.webSocketDebuggerUrl && t.id !== excludeId && /Folio/.test(t.title || ''),
    );
    for (const p of pages) {
      try {
        const c = await CDP.attach(p.webSocketDebuggerUrl);
        await c.send('Runtime.enable');
        const ok = await evalIn(c, `!!(window.readerAPI && document.querySelector('.app'))`);
        if (ok) return { cdp: c, targetId: p.id };
        c.close();
      } catch { /* 这个 target 还不行 */ }
    }
    await sleep(400);
  }
  throw new Error('没有可用窗口');
}

/** 等旧窗口彻底消失、新窗口出现 */
async function waitRebuilt(oldTargetId) {
  for (let i = 0; i < 90; i++) {
    await sleep(400);
    const ts = await cdpTargets().catch(() => []);
    const oldGone = !ts.some((t) => t.id === oldTargetId);
    const newOnes = ts.filter((t) => t.type === 'page' && t.id !== oldTargetId && /Folio/.test(t.title || ''));
    if (oldGone && newOnes.length) return newOnes[0].id;
  }
  return null;
}

const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const DATA = path.join(ROOT, '.e2e-data');
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
env.FOLIO_DATA_DIR = DATA;

// 注入一本本地书（带正文），用于测「正在读一本书时切边框」
fs.mkdirSync(path.join(DATA, 'books'), { recursive: true });
const BOOK_TXT = path.join(DATA, 'books', 'b7.txt');
fs.writeFileSync(BOOK_TXT,
  '第一章\n\n清晨五点，山里的雾还没有散。\n\n第二章 午后\n\n午后是山里一天里最安静的时候。', 'utf-8');
fs.writeFileSync(path.join(DATA, 'books.json'), JSON.stringify([
  { id: 'b7', name: '山居手记', kind: 'local', filePath: BOOK_TXT, addedAt: Date.now() - 86400000, hue: 88 },
]), 'utf-8');

const child = spawn(electron, ['.', '--no-sandbox', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env });
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
let exited = false;
child.on('exit', (code) => { exited = true; say(`!! 应用进程退出 code=${code}`); });

let cdp = null;
try {
  let live = await attachWindow();
  cdp = live.cdp;
  let tid = live.targetId;

  const snap = `JSON.stringify({
    frame: document.documentElement.dataset.frame,
    tl: !!document.querySelector('.traffic-lights'),
    view: document.querySelector('.settings-page') ? 'settings'
        : document.querySelector('.reader-header') ? 'reader'
        : document.querySelector('.shelf-header') ? 'shelf' : 'other',
    book: (document.querySelector('.reader-head-titles .reader-book') || {}).textContent || null
  })`;

  const hasToggle = `(() => {
    const rows = [...document.querySelectorAll('.switch-row')];
    const row = rows.find(r => r.textContent.includes('macOS 风格边框'));
    return !!(row && row.querySelector('input.switch'));
  })()`;

  /** 等设置页的边框开关渲染出来（重建后内容是异步挂载的） */
  async function waitToggle() {
    for (let i = 0; i < 40; i++) {
      try {
        if (await evalIn(cdp, hasToggle)) return true;
      } catch { /* 窗口正在重建 */ }
      await sleep(400);
    }
    return false;
  }

  const toggle = `(() => {
    const rows = [...document.querySelectorAll('.switch-row')];
    const row = rows.find(r => r.textContent.includes('macOS 风格边框'));
    if (!row) return 'no-row';
    const cb = row.querySelector('input.switch');
    if (!cb) return 'no-checkbox';
    cb.click();
    return 'clicked';
  })()`;

  say(`启动 target=${tid} 状态=${await evalIn(cdp, snap)}`);

  // ---- 场景 1：在设置页切换 ----
  await evalIn(cdp, `document.querySelector('[aria-label="设置"]').click(); 'ok'`);
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    if (await evalIn(cdp, `!!document.querySelector('.settings-page')`)) break;
  }
  check('设置页边框开关已渲染', await waitToggle());
  const r1 = await evalIn(cdp, toggle);
  check('设置页找到并点击边框开关', r1 === 'clicked', r1);
  await sleep(2500);
  check('设置页切换过程中应用未退出', !exited);

  const newTid1 = await waitRebuilt(tid);
  check('窗口确实被重建（旧 target 已消失，新 target 出现）', !!newTid1);
  live = await attachWindow(tid);
  cdp = live.cdp;
  tid = live.targetId;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try { if (await evalIn(cdp, `!!document.querySelector('.settings-page')`)) break; } catch { /* ignore */ }
  }
  const s1 = JSON.parse(await evalIn(cdp, snap));
  say(`关闭边框后: ${JSON.stringify(s1)}`);
  check('关闭边框后交通灯消失', s1.tl === false);
  check('关闭边框后 data-frame=native', s1.frame === 'native');
  check('重建后视图还原（仍在设置页）', s1.view === 'settings');

  // ---- 场景 2：切回来 ----
  check('回切前边框开关已渲染', await waitToggle());
  const r2 = await evalIn(cdp, toggle);
  check('回切时找到并点击边框开关', r2 === 'clicked', r2);
  await sleep(2500);
  check('回切过程中应用未退出', !exited);
  await waitRebuilt(tid);
  live = await attachWindow(tid);
  cdp = live.cdp;
  tid = live.targetId;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try { if (await evalIn(cdp, `!!document.querySelector('.settings-page')`)) break; } catch { /* ignore */ }
  }
  const s2 = JSON.parse(await evalIn(cdp, snap));
  say(`重新开启后: ${JSON.stringify(s2)}`);
  check('重新开启后交通灯回归', s2.tl === true);
  check('重新开启后 data-frame=macos', s2.frame === 'macos');
  check('回切后视图还原（仍在设置页）', s2.view === 'settings');

  // ---- 场景 3：正在读一本书时切边框 ----
  await evalIn(cdp, `document.querySelector('.settings-page-head .icon-btn').click(); 'back'`);
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { if (await evalIn(cdp, `!!document.querySelector('.shelf-header')`)) break; } catch { /* ignore */ }
  }
  await evalIn(cdp, `document.querySelectorAll('.book-grid .book-card')[0].click(); 'open'`);
  let inReader = false;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { inReader = await evalIn(cdp, `!!document.querySelector('.reader-header')`); } catch { break; }
    if (inReader) break;
  }
  check('进入阅读器', inReader);
  const sBefore = JSON.parse(await evalIn(cdp, snap));
  say(`阅读前: ${JSON.stringify(sBefore)}`);

  // 阅读器里没有设置开关，走等价的 IPC 链路（先落盘再切边框）
  const viaIpc = await evalIn(cdp,
    `window.readerAPI.setSettings(Object.assign({}, JSON.parse(localStorage.getItem('immersive-reader:settings')||'{}'), {macosFrame:false}))
       .then(() => window.readerAPI.windowSetFrame(false, { view:'reader', activeBookId:'b7' }))
       .then(r => JSON.stringify(r))`);
  say(`阅读器内切边框: ${viaIpc}`);
  await sleep(2500);
  check('阅读器内切换过程中应用未退出', !exited);
  await waitRebuilt(tid);
  live = await attachWindow(tid);
  cdp = live.cdp;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { if (await evalIn(cdp, `!!document.querySelector('.reader-header')`)) break; } catch { /* ignore */ }
  }
  const s3 = JSON.parse(await evalIn(cdp, snap));
  say(`阅读器切边框后: ${JSON.stringify(s3)}`);
  check('阅读器内切换后仍在阅读器', s3.view === 'reader');
  check('阅读器内切换后书名保留', s3.book === '山居手记', String(s3.book));
  check('阅读器内切换后边框生效', s3.frame === 'native' && s3.tl === false);
} catch (e) {
  fail++;
  say(`测试异常: ${e.message}`);
} finally {
  if (cdp) cdp.close();
  child.kill();
  await sleep(600);
  say(`\n结果: ${fail === 0 ? '全部通过' : fail + ' 项失败'}`);
}
