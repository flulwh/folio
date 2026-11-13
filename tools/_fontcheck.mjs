// 验证字体族是否真实可用（而不是静默回退）。
// 用 document.fonts.check 与逐字测量两种方式交叉验证。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDGE =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const PAGE = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;background:#fff;font-size:40px}
  .probe{position:absolute;white-space:nowrap;visibility:hidden}
</style>
<div id="out" style="font:14px monospace;padding:16px"></div>
<script>
const CANDIDATES = [
  'Noto Serif SC', 'Songti SC', 'SimSun', 'NSimSun', 'STSong',
  'Noto Sans SC', 'Microsoft YaHei', 'DengXian', 'KaiTi', 'SimHei'
];
const TEXT = '山居手记 晨雾 Typography';
const el = document.createElement('span');
el.className = 'probe';
el.textContent = TEXT;
document.body.appendChild(el);

function widthWith(family) {
  el.style.fontFamily = JSON.stringify(family);
  return el.getBoundingClientRect().width;
}
// 三个广泛存在的兜底，作为"默认宽度"基准
const BASE = ['monospace', 'serif', 'sans-serif'];
const baseWidths = Object.fromEntries(BASE.map(f => [f, widthWith(f)]));

const rows = CANDIDATES.map(f => {
  const w = widthWith(f);
  const differs = BASE.some(b => Math.abs(w - baseWidths[b]) > 0.5);
  const check = document.fonts.check(\`40px "\${f}"\`);
  return { f, w: Math.round(w * 100) / 100, differs, check };
});

const out = document.getElementById('out');
out.innerHTML = '<pre id="r">' + rows.map(r =>
  \`\${r.f.padEnd(18)} width=\${String(r.w).padEnd(8)} distinct=\${r.differs ? 'YES' : 'no '} fonts.check=\${r.check ? 'YES' : 'no'}\`
).join('\\n') + '</pre>';
</script>`;

const server = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});

const port = server.address().port;
const profile = path.join(os.tmpdir(), `font-probe-${process.pid}`);

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--virtual-time-budget=2500',
    `--user-data-dir=${profile}`,
    '--dump-dom',
    `http://127.0.0.1:${port}/`,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

let out = '';
child.stdout.on('data', (d) => (out += d));
child.on('exit', () => {
  server.close();
  const m = /<pre id="r">([\s\S]*?)<\/pre>/.exec(out);
  console.log(m ? m[1] : 'probe failed');
  fs.rmSync(profile, { recursive: true, force: true });
});
