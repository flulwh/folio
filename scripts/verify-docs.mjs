// 文档事实校验：把最容易过期的那几句写成断言。
// 版本号由 verify-release.mjs 盯着，这里补的是「文档说的和代码是不是一回事」。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : '');

const failures = [];
const assert = (ok, message) => {
  if (!ok) failures.push(message);
};

const readme = read('README.md');
// 安卓 3.0 已删除 WorkManager：README 再提「后台同步」会把用户带偏
assert(!/WorkManager/.test(readme), 'README 仍在提 WorkManager（安卓 3.0 已删除后台同步）');
// lan.js 监听的是 0.0.0.0，不是「只监听内网」
assert(!/只监听内网/.test(readme), 'README 的监听范围与 electron/lan.js 的 0.0.0.0 不一致');

const pkg = JSON.parse(read('package.json') || '{}');
const electronMajor = String(pkg.devDependencies?.electron || '').replace(/[^0-9.]/g, '').split('.')[0];
assert(Boolean(electronMajor), 'package.json 里找不到 electron 版本');
if (electronMajor) {
  assert(read('AGENTS.md').includes(`Electron ${electronMajor}`), `AGENTS.md 的技术栈应写 Electron ${electronMajor}`);
}

const docsDir = join(root, 'docs');
const docsIndex = read('docs/README.md');
const docs = readdirSync(docsDir).filter((file) => file.endsWith('.md') && file !== 'README.md');
for (const file of docs) {
  assert(docsIndex.includes(file), `docs/README.md 缺少索引：${file}`);
}

if (failures.length) {
  console.error('文档校验失败：');
  for (const message of failures) console.error(` - ${message}`);
  process.exit(1);
}
console.log(`文档校验通过：${docs.length} 篇文档，Electron ${electronMajor}`);
