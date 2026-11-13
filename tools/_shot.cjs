// 离屏截图工具：起一个临时 HTTP 服务托管 dist/，注入种子数据后再加载页面。
// 用法：npx electron tools/_shot.cjs --out=x.png [--w=1280] [--h=800] [--theme=night] [--skin=miui] [--wait=1200]
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const argv = process.argv.slice(2).reduce((acc, cur) => {
  const m = /^--([^=]+)=(.*)$/.exec(cur);
  if (m) acc[m[1]] = m[2];
  else if (cur.startsWith('--')) acc[cur.slice(2)] = true;
  return acc;
}, {});

const ROOT = path.join(__dirname, '..', 'dist');
const OUT = argv.out || 'shot.png';
const W = Number(argv.w || 1280);
const H = Number(argv.h || 800);
const THEME = argv.theme || '';
const SKIN = argv.skin || '';
const WAIT = Number(argv.wait || 1100);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      // 虚拟空白页：同源下先写 localStorage，避免污染 dist/
      if (url === '/seed.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>seed</title>');
        return;
      }
      let file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const server = await serve();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });

  // 先落在空白页，写入 localStorage 种子，再进入应用
  await win.loadURL(`${base}/seed.html`).catch(() => {});
  await win.webContents.executeJavaScript(require('./_seed.cjs')('shelf', THEME, '', SKIN)).catch((e) => {
    console.error('seed failed:', e.message);
  });

  await win.loadURL(`${base}/index.html`);
  await new Promise((r) => setTimeout(r, WAIT));

  const image = await win.webContents.capturePage();
  fs.writeFileSync(OUT, image.toPNG());
  const s = image.getSize();
  console.log(`captured ${OUT} ${s.width}x${s.height}`);
  server.close();
  app.quit();
});
