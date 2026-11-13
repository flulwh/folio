// 批量验收：一次截出所有表面 × 主题，并做对比度检查。
// 用法：node tools/_audit.mjs [--only=shelf,reader,settings,market] [--theme=paper,night]
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2).reduce((acc, cur) => {
  const m = /^--([^=]+)=(.*)$/.exec(cur);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});

const SHOTS = [
  { key: 'shelf', click: '', w: 1280, h: 800 },
  { key: 'reader', click: '.book-grid .book-card:nth-child(7)', w: 1280, h: 800, wait: 3600 },
  { key: 'settings', click: '[aria-label="设置"]', w: 1280, h: 800, wait: 3000 },
  { key: 'market', click: '.shelf-cloud-btn', w: 1280, h: 800, wait: 3200 },
];

const only = (argv.only || 'shelf,reader,settings,market').split(',').map((s) => s.trim());
const themes = (argv.theme || 'paper,night').split(',').map((s) => s.trim());

const outDir = path.join(ROOT, '.shots');
fs.mkdirSync(outDir, { recursive: true });

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, '_snap.mjs'), ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => resolve({ code, out: out.trim() }));
  });
}

const results = [];
for (const shot of SHOTS.filter((s) => only.includes(s.key))) {
  for (const theme of themes) {
    const file = path.join(outDir, `audit-${shot.key}-${theme}.png`);
    const args = [
      `--out=${file}`,
      `--theme=${theme}`,
      `--w=${shot.w}`,
      `--h=${shot.h}`,
      `--wait=${shot.wait || 1800}`,
    ];
    if (shot.click) args.push(`--click=${shot.click}`);
    const r = await run(args);
    results.push({ ...shot, theme, ok: r.code === 0, file, msg: r.out.split('\n').pop() });
    console.log(`${r.code === 0 ? 'ok  ' : 'FAIL'} ${shot.key.padEnd(9)} ${theme.padEnd(7)} ${r.out.split('\n').pop()}`);
  }
}

// 对比度检查：从 tokens 里读前景/背景色，算 WCAG 对比度
function parseHex(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
function lum([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const l1 = lum(fg);
  const l2 = lum(bg);
  return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
}

const tokensCss = fs.readFileSync(path.join(ROOT, 'src', 'design', 'tokens.css'), 'utf8');
const themeBlocks = {};
for (const m of tokensCss.matchAll(/\[data-theme='(\w+)'\]\s*\{([\s\S]*?)\n\}/g)) {
  const vars = {};
  for (const v of m[2].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) vars[v[1]] = v[2];
  themeBlocks[m[1]] = vars;
}

console.log('\n对比度（正文 / 次要文字 对 背景）：');
for (const [name, vars] of Object.entries(themeBlocks)) {
  if (!vars['--bg'] || !vars['--text']) continue;
  const bg = parseHex(vars['--bg']);
  const text = ratio(parseHex(vars['--text']), bg);
  const soft = vars['--text-soft'] ? ratio(parseHex(vars['--text-soft']), bg) : 'n/a';
  const faint = vars['--text-faint'] ? ratio(parseHex(vars['--text-faint']), bg) : 'n/a';
  const accent = vars['--accent'] ? ratio(parseHex(vars['--accent']), bg) : 'n/a';
  const flag = (v) => (Number(v) >= 4.5 ? '' : Number(v) >= 3 ? ' ⚠仅大字' : ' ✗不足');
  console.log(
    `  ${name.padEnd(8)} text ${String(text).padStart(6)}${flag(text)} | soft ${String(soft).padStart(6)}${flag(soft)} | faint ${String(faint).padStart(6)}${flag(faint)} | accent ${String(accent).padStart(6)}${flag(accent)}`
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n截图 ${results.length - failed.length}/${results.length} 成功`);
process.exit(failed.length ? 1 : 0);
