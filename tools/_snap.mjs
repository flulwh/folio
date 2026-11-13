// 用系统 Edge 的 headless 模式截取 dist/ 页面，注入种子数据后出图。
// 用法：node tools/_snap.mjs --out=x.png [--w=1280] [--h=800] [--theme=night] [--route=shelf]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'dist');

const argv = process.argv.slice(2).reduce((acc, cur) => {
  const m = /^--([^=]+)=(.*)$/.exec(cur);
  if (m) acc[m[1]] = m[2];
  else if (cur.startsWith('--')) acc[cur.slice(2)] = true;
  return acc;
}, {});

const OUT = path.resolve(argv.out || 'shot.png');
const W = Number(argv.w || 1280);
const H = Number(argv.h || 800);
const THEME = argv.theme || '';
const ROUTE = argv.route || 'shelf';
const WAIT_MS = Number(argv.wait || 1400);
// --click="选择器" ：页面就绪后自动点一下，用于进入设置页/市场页/打开一本书
const CLICK = argv.click || '';
// --eval="JS 表达式"：点击链走完后再执行一段脚本，用于把页面推到某个状态
// （例如把阅读器滚到底，好检查末行有没有被浮层压住）。返回真值即视为完成。
const EVAL = argv.eval || '';
// --css="额外 CSS"：额外注入一段样式。用来在 headless 里强制还原
// 毛玻璃等 headless 不支持的渲染分支（headless 的 prefers-reduced-transparency
// 恒为 reduce，会让所有浮层退化成实底，与真实用户看到的不是一回事）。
const EXTRA_CSS = argv.css || '';

const EDGE =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const seedFactory = require('./_seed.cjs');

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      if (url === '/seed.html') {
        // 同源空白页：先写 localStorage，再跳应用，避免污染 dist/
        const seed = seedFactory(ROUTE, THEME, '', argv.skin || 'apple');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><script>${seed}</script><script>
          location.replace('/index.html?static=1');
        </script>`);
        return;
      }
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
      }
      // 需要点击时才改写 index.html，注入自动点击脚本。
      // 用轮询而非单次 load+timeout：React 挂载时机不确定，元素可能还没渲染出来。
      // CLICK 支持逗号分隔的多个选择器（链式点击），用于进入二级浮层（如阅读页 → 目录）。
      if ((CLICK || EVAL || EXTRA_CSS) && url === '/index.html') {
        let html = fs.readFileSync(file, 'utf8');
        const steps = CLICK.split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const inject = `<style data-shot-extra>${EXTRA_CSS}</style><script>
(function(){
  var steps=${JSON.stringify(steps)}, i=0;
  var evalSrc=${JSON.stringify(EVAL)};
  function runEval(){
    if(!evalSrc) return;
    var tries=0;
    var t=setInterval(function(){
      tries++;
      var ok=false;
      try{ ok=eval(evalSrc); }catch(e){ ok=true; }
      if(ok || tries>60){ clearInterval(t); document.title='done'; }
    },100);
  }
  function next(){
    if(i>=steps.length){ runEval(); return; }
    var sel=steps[i], tries=0;
    var timer=setInterval(function(){
      tries++;
      var el=null;
      try{ el=document.querySelector(sel); }catch(e){}
      if(el && el.offsetParent!==null){
        el.click(); clearInterval(timer); i++; setTimeout(next, 700);
      } else if(tries>50){ clearInterval(timer); i++; document.title='miss:'+sel; setTimeout(next, 300); }
    },100);
  }
  setTimeout(next, 500);
})();
</script>`;
        html = html.replace('</body>', `${inject}</body>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const server = await startServer();
const port = server.address().port;
const url = `http://127.0.0.1:${port}/seed.html`;

const PROFILE = path.join(
  __dirname,
  '..',
  '.shots',
  `profile-${process.pid}-${(argv.theme || 'd').replace(/[^a-z]/gi, '')}`
);

const args = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--force-device-scale-factor=1',
  `--window-size=${W},${H}`,
  `--screenshot=${OUT}`,
  `--virtual-time-budget=${WAIT_MS}`,
  `--user-data-dir=${PROFILE}`,
  url,
];

const child = spawn(EDGE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => {
  stderr += d.toString();
});
child.on('error', (e) => {
  console.error('spawn failed:', e.message);
  server.close();
  process.exit(1);
});
child.on('exit', (code) => {
  server.close();
  if (fs.existsSync(OUT)) {
    const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
    console.log(`ok ${path.basename(OUT)} ${W}x${H} ${kb}KB`);
  } else {
    console.error(`no output (exit=${code})`);
    if (stderr) console.error(stderr.split('\n').slice(0, 6).join('\n'));
    process.exit(2);
  }
});
