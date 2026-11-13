// 读取页面上指定选择器的计算样式，用于精确诊断 CSS 层叠结果。
// 与 _snap.mjs 同一套机制：起本地服务 + 注入脚本，最稳。
// 用法：node tools/_probe.mjs --sel=".book-cover" --props="background-image,border-radius" [--theme=night] [--click=".book-card"]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'dist');

const argv = process.argv.slice(2).reduce((acc, cur) => {
  const m = /^--([^=]+)=(.*)$/.exec(cur);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});

const SEL = argv.sel || '.book-cover';
const PROPS = (argv.props || 'background-color,background-image,border-radius,color,font-size')
  .split(',')
  .map((s) => s.trim());
const THEME = argv.theme || 'paper';
const CLICK = argv.click || '';
const ALL = argv.all === '1'; // 统计匹配数量而非只取第一个
// --eval="JS"：在点击/等待之后执行一段脚本，把返回值（JSON 化）一并打印。
// 用于几何测量这类状态断言，比截图目测可靠。
const EVAL = argv.eval || '';

const EDGE =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const seedFactory = require('./_seed.cjs');

const SERVER = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/seed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><script>${seedFactory('shelf', THEME, '', argv.skin || 'apple')}</script><script>location.replace('/index.html?static=1')</script>`
      );
      return;
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('nf');
      return;
    }
    if (url === '/index.html') {
      let html = fs.readFileSync(file, 'utf8');
      const inject = `<script>
(function(){
  var ID='__probe'+'_out';
  var sel=${JSON.stringify(SEL)}, props=${JSON.stringify(PROPS)}, click=${JSON.stringify(
        CLICK
      )}, all=${ALL}, evalSrc=${JSON.stringify(EVAL)};
  function emit(text){
    var pre=document.createElement('pre');
    pre.id=ID;
    pre.textContent=text;
    document.body.appendChild(pre);
  }
  function report(){
    var lines=[];
    if(evalResult && typeof evalResult.then==='function'){
      evalResult.then(function(v){
        var l=['eval: '+(typeof v==='string'?v:JSON.stringify(v))];
        l.push.apply(l, styleLines());
        emit(l.join('\\n'));
      }).catch(function(e){ emit('EVAL REJECT: '+e.message); });
      return;
    }
    if(evalSrc){
      lines.push('eval: '+(typeof evalResult==='string'?evalResult:JSON.stringify(evalResult)));
    }
    lines.push.apply(lines, styleLines());
    emit(lines.join('\\n'));
  }
  function styleLines(){
    var out=[];
    var nodes=document.querySelectorAll(sel);
    if(!nodes.length){
      out.push('NOT FOUND: '+sel);
      return out;
    }
    if(all) out.push('matched='+nodes.length);
    var cs=getComputedStyle(nodes[0]);
    props.forEach(function(p){ out.push(p+': '+cs.getPropertyValue(p)); });
    return out;
  }
  var evalResult=null;
  var tries=0;
  var t=setInterval(function(){
    tries++;
    if(click && tries>3){
      try{var c=document.querySelector(click); if(c&&c.offsetParent!==null)c.click();}catch(e){}
    }
    if(tries===6){
      clearInterval(t);
      if(evalSrc){
        try{ evalResult=eval(evalSrc); }catch(e){ evalResult='EVAL ERROR: '+e.message; }
      }
      setTimeout(report, ${Number(argv.evalwait || 2500)});
    }
  },150);
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
  s.listen(0, '127.0.0.1', () => resolve(s));
});

const port = SERVER.address().port;
const profile = path.join(os.tmpdir(), `folio-probe-${process.pid}`);

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    '--virtual-time-budget=6000',
    `--window-size=${Number(argv.w || 1280)},${Number(argv.h || 900)}`,
    `--user-data-dir=${profile}`,
    '--dump-dom',
    `http://127.0.0.1:${port}/seed.html`,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

let out = '';
child.stdout.on('data', (d) => (out += d));
child.on('exit', () => {
  SERVER.close();
  const m = /<pre id="__probe_out">([\s\S]*?)<\/pre>/.exec(out);
  console.log(m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : 'probe failed');
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    /* Edge 退出瞬间还占着 Crashpad 目录，删不掉也不影响结论 */
  }
});
