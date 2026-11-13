/**
 * 发版门禁：零依赖，本地 `npm run check` 与 CI 共用。
 *
 * 校验：版本单一来源 / lockfile 同步 / 源码语法 / 打包目标配置 / 构建产物。
 * 任何一项失败都以非零码退出，避免带着漂移的版本号或坏语法发版。
 * 使用 `npm run check -- --require-dist` 额外要求 dist 已构建（CI 构建后跑）。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireDist = process.argv.includes('--require-dist');
// macOS 边框开关的端到端验证要真起一个窗口，慢且会抢焦点，默认不跑。
// 加 --with-frame-e2e 开启（发版前手动跑一次）。
const withFrameE2E = process.argv.includes('--with-frame-e2e');
const failures = [];
const lines = [];

const pass = (name) => lines.push(`  ok    ${name}`);
const fail = (name, detail) => {
  failures.push(`${name} — ${detail}`);
  lines.push(`  FAIL  ${name}`);
};
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

let pkg;
let lock;
try {
  pkg = JSON.parse(read('package.json'));
  lock = JSON.parse(read('package-lock.json'));
} catch (err) {
  console.error(`[check] 读不到 package.json / package-lock.json：${err.message}`);
  process.exit(1);
}

/* 1. 版本号格式与 lockfile 同步 */
if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(pkg.version)) {
  fail('版本号格式', `不是语义化版本：${pkg.version}`);
} else {
  pass(`版本号格式 ${pkg.version}`);
}
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
  fail('lockfile 同步', `package-lock=${lock.version}/${lock.packages?.['']?.version}，package.json=${pkg.version}；用 npm version 命令改版本`);
} else {
  pass('lockfile 同步');
}

const readme = read('README.md');
// (?<![\d.]) 排除 IP 的子串，(?!\.\d) 排除 127.0.0.1 这类四段地址；
// 但允许 `Folio-Setup-2.0.0.exe` 后面跟 .exe。
const docVersions = [...new Set([...readme.matchAll(/(?<![\d.])\d+\.\d+\.\d+(?!\.\d)/g)].map((m) => m[0]))];
const stale = docVersions.filter((v) => v !== pkg.version);
if (stale.length) fail('README 版本号', `出现旧版本 ${stale.join(', ')}，请同步到 ${pkg.version}`);
else pass(`README 版本号同步（${pkg.version}）`);

/* 2. 版本号单一来源：Vite define 注入，渲染层不许再硬编码 */
const viteConfig = read('vite.config.js');
if (!viteConfig.includes("readFileSync(path.join(rootDir, 'package.json')") || !viteConfig.includes('__APP_VERSION__')) {
  fail('版本单一来源', 'vite.config.js 缺少从 package.json 注入 __APP_VERSION__ 的 define');
} else {
  pass('版本单一来源（package.json → __APP_VERSION__）');
}

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.workbuddy', '.workbuddy-ai', '.memory',
  'release', 'release-portable', 'release-pack', 'release-v2',
]);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(root);
const versionLiterals = [];
for (const file of allFiles) {
  if (!/\.(js|jsx|mjs|cjs)$/.test(file)) continue;
  if (!file.includes(`${path.sep}src${path.sep}`)) continue;
  const text = readFileSync(file, 'utf8');
  const match = /['"]\d+\.\d+\.\d+['"]/.exec(text);
  if (match) versionLiterals.push(`${path.relative(root, file)} → ${match[0]}`);
}
if (versionLiterals.length) {
  fail('渲染层硬编码版本', `改用 __APP_VERSION__：${versionLiterals.join('；')}`);
} else {
  pass('渲染层无硬编码版本号');
}

/* 3. 源码语法（node --check，跳过 JSX 与文档） */
const jsFiles = allFiles.filter((file) => /\.(js|mjs|cjs)$/.test(file));
const syntaxErrors = [];
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) syntaxErrors.push(`${path.relative(root, file)}：${String(result.stderr || '').split('\n')[0]}`);
}
if (syntaxErrors.length) fail('源码语法', syntaxErrors.slice(0, 5).join('；'));
else pass(`源码语法（${jsFiles.length} 个 JS/CJS/MJS 文件）`);

/* 4. 打包配置 */
const targets = pkg.build?.win?.target;
const needed = ['nsis', 'portable', 'zip', 'dir'];
const list = Array.isArray(targets) ? targets : targets ? [targets] : [];
const missing = needed.filter((t) => !list.includes(t));
if (missing.length) fail('打包目标', `缺少 ${missing.join(', ')}`);
else pass(`打包目标（${needed.join(' / ')}）`);
if (!pkg.build?.files?.includes('electron/**/*') || !pkg.build?.files?.includes('dist/**/*')) {
  fail('打包文件清单', 'build.files 必须同时包含 dist/**/* 与 electron/**/*');
} else {
  pass('打包文件清单');
}

/* 5. 主题令牌双源一致（tokens.css 与 themes.js） */
const themeSync = spawnSync(process.execPath, [path.join(root, 'tools', '_theme-sync.mjs')], {
  encoding: 'utf8',
});
if (themeSync.status !== 0) {
  fail('主题令牌一致性', String(themeSync.stderr || '').trim().split('\n').slice(0, 6).join('；'));
} else {
  pass('主题令牌一致性（tokens.css ↔ themes.js）');
}

/* 6. 设计层代码卫生：不允许 !important（reduced-motion 除外）与硬编码色 */
const designFiles = ['base', 'shelf', 'reader', 'library'].map((n) => `src/design/${n}.css`);
const hygieneIssues = [];
for (const rel of designFiles) {
  if (!existsSync(path.join(root, rel))) continue;
  const css = read(rel);
  css.split('\n').forEach((line, i) => {
    // prefers-reduced-motion 块里的 !important 是覆盖用户动画的必要手段
    if (line.includes('!important') && !/animation-duration|animation-iteration-count|transition-duration/.test(line)) {
      hygieneIssues.push(`${rel}:${i + 1} 残留 !important`);
    }
    const hex = line.match(/#[0-9a-fA-F]{3,8}\b/g);
    if (hex) hygieneIssues.push(`${rel}:${i + 1} 硬编码色 ${hex.join(',')}`);
  });
}
if (hygieneIssues.length) fail('设计层代码卫生', hygieneIssues.slice(0, 6).join('；'));
else pass('设计层代码卫生（无 !important / 硬编码色）');

/* 7. 字体 cmap 解析器自检：用系统真实字体验证中文字形判定 */
const fontProbe = spawnSync(
  process.execPath,
  ['--input-type=module', '-e', `
import { readFontCoverage } from './electron/fontmeta.js';
const cases = [
  ['C:/Windows/Fonts/Candara.ttf', false],
  ['C:/Windows/Fonts/simsun.ttc', true],
  ['C:/Windows/Fonts/msyh.ttc', true],
];
let bad = [];
for (const [f, expect] of cases) {
  try {
    const c = readFontCoverage(f);
    if (c.hasCJK !== expect) bad.push(f + ' expected ' + expect + ' got ' + c.hasCJK);
  } catch (e) { bad.push(f + ' threw ' + e.message); }
}
console.log(JSON.stringify(bad));
`],
  { encoding: 'utf8', cwd: root }
);
if (fontProbe.status !== 0) {
  fail('字体 cmap 解析', String(fontProbe.stderr || '').trim().split('\n').slice(0, 4).join('；'));
} else {
  let bad = [];
  try { bad = JSON.parse(String(fontProbe.stdout).trim().split('\n').pop()); } catch { bad = ['输出无法解析']; }
  if (bad.length) fail('字体 cmap 解析', bad.join('；'));
  else pass('字体 cmap 解析（中文判定正确）');
}

/* 6. 构建产物（可选，CI 强制） */
const distIndex = path.join(root, 'dist', 'index.html');
if (existsSync(distIndex)) {
  const html = readFileSync(distIndex, 'utf8');
  if (!/<script\b/.test(html)) fail('dist/index.html', '没有找到入口 script');
  else pass('dist/index.html 与入口 script');
} else if (requireDist) {
  fail('dist 产物', '缺少 dist/index.html，请先跑 npm run build:vite');
} else {
  lines.push('  skip  dist 产物（尚未构建，CI 会带 --require-dist）');
}

/* 7. macOS 边框切换端到端（可选：要真起窗口） */
if (withFrameE2E) {
  const frameE2E = spawnSync(process.execPath, [path.join(root, 'tools', '_frame-e2e.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 300000,
  });
  const out = `${frameE2E.stdout || ''}${frameE2E.stderr || ''}`;
  const badLines = out.split('\n').filter((l) => l.startsWith('FAIL') || l.startsWith('测试异常'));
  if (frameE2E.status !== 0 || badLines.length) {
    fail('macOS 边框切换端到端', badLines.map((l) => l.replace(/^FAIL\s+/, '')).join('；') || '测试进程异常退出');
  } else {
    pass('macOS 边框切换端到端（开关 / 重建 / 状态还原）');
  }
} else {
  lines.push('  skip  macOS 边框端到端（加 --with-frame-e2e 开启）');
}

console.log(`Folio release check · v${pkg.version}`);
console.log(lines.join('\n'));
if (failures.length) {
  console.error(`\n[check] ${failures.length} 项未通过：`);
  for (const item of failures) console.error(`  - ${item}`);
  process.exit(1);
}
console.log(`\n[check] 全部通过（${lines.filter((l) => l.startsWith('  ok')).length} 项）`);
