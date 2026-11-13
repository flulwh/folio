/**
 * 字体 UI 的真实验证脚本（跑在 Electron 主进程里）。
 *
 * 与 tools/_snap.mjs（Edge headless）的区别：这里走真实的主进程 IPC，
 * 所以能验证「安装字体 → fonts.json → font:list → 渲染进程 FontFace 加载 → UI 渲染」
 * 整条链路，而不是只截个空列表。
 *
 * 用法：npx electron tools/_font-shot.cjs --no-sandbox
 */
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, '.tmp-font-shot');
const DATA = path.join(TMP, 'data');
const FONTS = path.join(DATA, 'fonts');
const OUT = path.join(ROOT, '.shots');

const LOG = path.join(TMP, 'shot.log');

function log(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  try {
    fs.mkdirSync(TMP, { recursive: true });
    fs.appendFileSync(LOG, line + '\n');
  } catch {
    /* ignore */
  }
}

process.env.FOLIO_DATA_DIR = DATA;
app.disableHardwareAcceleration();

// 提前安装一个真实字体，模拟「用户已经装过字体」的状态
const REAL_FONTS = [
  { src: 'C:/Windows/Fonts/Candara.ttf', name: 'candara.ttf' },
  { src: 'C:/Windows/Fonts/CascadiaCode.ttf', name: 'cascadia.ttf' },
  { src: 'C:/Windows/Fonts/Deng.ttf', name: 'dengxian.ttf' },
];

async function seedFonts() {
  fs.mkdirSync(FONTS, { recursive: true });
  const { readFontMeta, readFontCoverage } = await import(
    pathToFileURL(path.join(ROOT, 'electron', 'fontmeta.js')).href
  );
  const list = [];
  for (const f of REAL_FONTS) {
    if (!fs.existsSync(f.src)) continue;
    const dest = path.join(FONTS, f.name);
    fs.copyFileSync(f.src, dest);
    const meta = readFontMeta(dest);
    const coverage = readFontCoverage(dest);
    list.push({
      id: path.basename(f.name, '.ttf'),
      file: f.name,
      family: meta.family || f.name,
      format: 'ttf',
      size: fs.statSync(dest).size,
      addedAt: Date.now(),
      hasCJK: coverage.hasCJK,
      cjkRatio: coverage.cjkRatio,
      hasLatin: coverage.hasLatin,
    });
  }
  fs.writeFileSync(path.join(DATA, 'fonts.json'), JSON.stringify(list));
  log('seeded fonts:', list.map((f) => `${f.family}(cjk=${f.hasCJK})`).join(', '));
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seedFonts();

  protocol.handle('folio-font', async (request) => {
    try {
      const { pathname } = new URL(request.url);
      const name = decodeURIComponent(pathname.replace(/^\/+/, ''));
      if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
        return new Response('bad request', { status: 400 });
      }
      const file = path.join(FONTS, name);
      if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('error', { status: 500 });
    }
  });

  // 复刻 main.js 的字体 IPC
  ipcMain.handle('font:list', () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA, 'fonts.json'), 'utf8'));
    } catch {
      return [];
    }
  });
  ipcMain.handle('font:install', async () => null);
  ipcMain.handle('font:remove', () => ({ ok: true }));
  ipcMain.handle('font:clear', () => ({ ok: true }));
  ipcMain.handle('font:show-in-folder', () => ({ ok: true }));
  const BOOK_TEXT = [
    '第一章 夜航',
    '夜色像一张摊开的纸，风从窗缝里翻页。Handgloves 漂流记 ABC 123。',
    '她把手电筒举高，光柱在雾里散成一根细白的线。',
    '海面上没有船，只有浪一遍一遍擦过生锈的舷灯。',
    '「我们还要走多久？」没有人回答。',
    '航程表上的数字早就对不上了，船长把表盘转向自己那一侧。',
    '第二天清晨，雾散了一点。远处浮出一座岛的轮廓，像一块被水泡软的墨。',
    '岛上有灯塔，白色的塔身已经剥落了大半。Typography Sample 2468。',
    '她记起小时候读过的书，说灯塔的光每隔七秒眨一次眼。',
    '现在没有灯塔。只有海，还有海。',
  ].join('\n\n');

  ipcMain.handle('store:get-books', () => [
    { id: 'b1', kind: 'local', name: '山居手记', filePath: 'x.txt', content: BOOK_TEXT, percent: 0.3 },
    { id: 'b2', kind: 'local', name: '夜航西飞', filePath: 'y.txt', content: BOOK_TEXT, percent: 0.6 },
  ]);
  ipcMain.handle('book:read', () => ({ content: BOOK_TEXT }));
  ipcMain.handle('store:get-progress', () => ({}));
  ipcMain.handle('store:set-progress', () => {});
  ipcMain.handle('source:list', () => []);
  ipcMain.handle('rules:list', () => []);
  ipcMain.handle('log:info', () => ({ dir: '', level: 'info', files: [], size: 0 }));
  ipcMain.handle('log:from-renderer', () => {});
  ipcMain.handle('store:set-books', () => {});
  ipcMain.handle('store:get-settings', () => ({
    theme: process.env.FOLIO_THEME || 'paper',
    fontSize: 18,
    lineHeight: 1.85,
    fontFamily: 'sans',
    userFont: '',
    pageWidth: 700,
    paragraphSpacing: 1,
    indent: false,
    reduceMotion: true,
    autoHideUI: false,
    skin: 'apple',
  }));
  ipcMain.handle('store:set-settings', () => {});
  ipcMain.handle('app:info', () => ({ version: '2.0.0' }));

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    show: false,
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 窗口必须真正显示过，否则 capturePage 拿到的是旧帧（合成器没产帧）。
  // showInactive 不抢焦点，但会触发渲染。
  win.showInactive();
  await new Promise((r) => setTimeout(r, 600));

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await new Promise((r) => setTimeout(r, 2500));

  // 进入设置页
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const btns = [...document.querySelectorAll('button')];
      const btn = btns.find(b => (b.getAttribute('aria-label') || '').includes('设置'))
        || btns.find(b => (b.title || '').includes('设置'));
      if (btn) { btn.click(); return 'clicked:' + (btn.getAttribute('aria-label') || btn.title); }
      return 'not-found; buttons=' + btns.map(b=>b.getAttribute('aria-label')||b.title||'').filter(Boolean).join('|');
    })()
  `);
  log('click:' + clicked);
  await new Promise((r) => setTimeout(r, 1800));

  // 采集状态
  const state = await win.webContents.executeJavaScript(`
    (() => {
      const rows = [...document.querySelectorAll('.font-user-row')].map(r => ({
        name: r.querySelector('.font-user-name')?.textContent,
        meta: r.querySelector('.font-user-meta')?.textContent,
        active: r.classList.contains('active'),
      }));
      const faces = [...document.fonts].map(f => ({ family: f.family, status: f.status }));
      return {
        hasManager: !!document.querySelector('.font-manager'),
        baseCount: document.querySelectorAll('.font-base-option').length,
        rows,
        faces,
        installBtn: !!document.querySelector('.font-install-row .btn'),
      };
    })()
  `);
  log('STATE:' + JSON.stringify(state));

  const img = await win.webContents.capturePage();
  const THEME = process.env.FOLIO_THEME || 'paper';
  fs.writeFileSync(path.join(OUT, `font-settings-${THEME}.png`), img.toPNG());
  log('saved font-settings-' + THEME + '.png');

  // 滚动到字体区，让安装按钮进画面（center 而不是 end，避免贴着视口底边被裁）
  await win.webContents.executeJavaScript(`
    (() => {
      const row = document.querySelector('.font-install-row');
      const mgr = document.querySelector('.font-manager');
      if (!row && !mgr) return 'no-manager';
      (row || mgr).scrollIntoView({ block: 'center' });
      return 'scrolled';
    })()
  `);
  await new Promise((r) => setTimeout(r, 900));
  const img3 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'font-install-row.png'), img3.toPNG());
  log('saved font-install-row.png');

  // 选中第一个用户字体，验证正文切换
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.querySelector('.font-user-main');
      if (!btn) return 'no-row';
      btn.click();
      return 'selected';
    })()
  `);
  await new Promise((r) => setTimeout(r, 1200));

  const after = await win.webContents.executeJavaScript(`
    (() => {
      const active = document.querySelector('.font-user-row.active');
      const sample = document.querySelector('.font-user-row.active .font-user-sample');
      return {
        activeName: active?.querySelector('.font-user-name')?.textContent || null,
        sampleFont: sample ? getComputedStyle(sample).fontFamily : null,
        settingsUserFont: localStorage.getItem('immersive-reader:settings') || '',
      };
    })()
  `);
  log('AFTER:' + JSON.stringify(after));

  const img2 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'font-selected.png'), img2.toPNG());
  log('saved font-selected.png');

  // 关键验证：阅读器正文是否真的用上了用户字体
  // 做法：直接在页面里打开书（点书卡），不经过设置页返回，避免误触返回按钮
  const reader = await win.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // 若当前在设置页，先回书架
      if (document.querySelector('.settings-page')) {
        const back = [...document.querySelectorAll('button')]
          .find(b => (b.getAttribute('aria-label')||'').includes('返回')
                 || (b.title||'').includes('返回')
                 || b.className.includes('settings-back'));
        if (back) back.click();
        await sleep(900);
      }

      const card = document.querySelector('.book-card');
      if (!card) return { err: 'no-book-card' };
      card.click();
      await sleep(1800);
      const root = document.querySelector('.reader');
      // 注意：.reader 里还有一层离屏测量容器（渲染全部段落算高度），
      // 它的 .para 不在屏幕上。真正的可见正文在 .vp-item 里。
      const para = document.querySelector('.vp-item .para:not(.chapter-title)')
        || document.querySelector('.reader .para:not(.chapter-title)');
      if (!root) return { err: 'no-reader' };

      const cs = getComputedStyle(root);
      const before = para ? getComputedStyle(para).fontFamily : null;
      const width = para ? Math.round(para.getBoundingClientRect().width) : null;

      // 诊断：段落的父链 + 每层继承到的 --reader-font
      const chain = [];
      let n = para;
      while (n && chain.length < 8) {
        chain.push({
          cls: n.className && n.className.baseVal === undefined ? String(n.className).slice(0, 40) : String(n.className || n.tagName),
          readerFont: getComputedStyle(n).getPropertyValue('--reader-font').trim().slice(0, 40) || '(none)',
          fontFamily: getComputedStyle(n).fontFamily.slice(0, 40),
        });
        n = n.parentElement;
      }
      const allParas = [...document.querySelectorAll('.para')].length;
      const innerParas = [...document.querySelectorAll('.reader-inner .para')].length;
      const visibleParas = [...document.querySelectorAll('.vp-item .para')].length;
      const measure = document.querySelector('.measure-list, .measure-item');
      const measureInfo = measure ? (() => {
        const r = measure.getBoundingClientRect();
        const cs = getComputedStyle(measure);
        return { cls: String(measure.className).slice(0,30), rect: [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], vis: cs.visibility, op: cs.opacity, pos: cs.position };
      })() : null;

      // 测量「天地玄黄」在用户字体下的实际宽度，与 fallback 对比
      const span = document.createElement('span');
      span.style.cssText = 'position:absolute;left:-9999px;font-size:100px;white-space:pre';
      span.textContent = 'Handgloves';
      document.body.appendChild(span);
      span.style.fontFamily = cs.getPropertyValue('--reader-font');
      const userWidth = span.getBoundingClientRect().width;
      span.style.fontFamily = 'sans-serif';
      const sansWidth = span.getBoundingClientRect().width;
      span.remove();

      return {
        readerFontVar: cs.getPropertyValue('--reader-font').trim(),
        paraFont: before,
        paraWidth: width,
        userWidth: Math.round(userWidth),
        sansWidth: Math.round(sansWidth),
        differs: Math.abs(userWidth - sansWidth) > 0.5,
        allParas,
        innerParas,
        visibleParas,
        measureInfo,
        chain,
      };
    })()
  `);
  log('READER:' + JSON.stringify(reader));

  const views = await win.webContents.executeJavaScript(`
    (() => {
      return [...document.querySelectorAll('.view')].map(v => {
        const cs = getComputedStyle(v);
        return {
          cls: String(v.className).slice(0, 30),
          display: cs.display,
          opacity: cs.opacity,
          visibility: cs.visibility,
          zIndex: cs.zIndex,
          position: cs.position,
          rect: (() => { const r = v.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
        };
      });
    })()
  `);
  log('VIEWS:' + JSON.stringify(views));

  const imgReader = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'font-reader.png'), imgReader.toPNG());
  log('saved font-reader.png');

  app.exit(0);
});

setTimeout(() => {
  log('TIMEOUT');
  app.exit(3);
}, 40000);

/* 对比度检查：把 WCAG 计算挂在窗体里，量化「删除按钮/提示文字/字体名」的可读性 */
