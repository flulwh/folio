/**
 * 路径包含关系判断的回归测试。
 *
 *   node tools/_paths-check.mjs
 *
 * 守的是三个曾经出过问题的点：
 *   1. Windows 上盘符/目录大小写不同，不能把自家书判成越界。
 *   2. 同前缀的相邻目录（books-evil）不能被误判成在 books/ 里。
 *   3. `..` 抬升出去的路径必须被拦下。
 */
import path from 'path';
import { isInside, isInsideOrEqual, samePath } from '../electron/paths.js';

let failed = 0;
let passed = 0;

function ok(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${extra ? `  ← ${extra}` : ''}`);
  }
}

console.log('\n路径包含关系');

const root = path.resolve('/tmp/folio-books');
const inside = path.join(root, 'a.txt');
const sibling = path.resolve('/tmp/folio-books-evil/a.txt');
const outside = path.resolve('/tmp/elsewhere/a.txt');
const escaped = path.join(root, '..', 'elsewhere', 'a.txt');

ok('子目录里的文件算在里面', isInside(root, inside));
ok('根目录本身不算「里面」', !isInside(root, root));
ok('isInsideOrEqual 允许根目录本身', isInsideOrEqual(root, root));
ok('同前缀的相邻目录被挡下', !isInside(root, sibling));
ok('完全在别处的路径被挡下', !isInside(root, outside));
ok('.. 抬升出去的路径被挡下', !isInside(root, escaped));

console.log('\n大小写（Windows 语义）');

const winRoot = 'C:\\Users\\lwh\\Desktop\\12\\.folio-test-data\\books';
const winFile = 'c:\\users\\lwh\\desktop\\12\\.folio-test-data\\books\\demo.txt';

if (process.platform === 'win32') {
  ok('盘符与目录大小写不同仍算在里面', isInside(winRoot, winFile), winFile);
  ok('samePath 忽略大小写', samePath(winRoot, winRoot.toLowerCase()));
} else {
  ok('非 Windows 上大小写仍是不同路径', !samePath(winRoot, winRoot.toLowerCase()));
  ok('非 Windows 上大小写不同不算里面', !isInside(winRoot, winFile));
}

console.log('\nsamePath');

ok('同一路径相等', samePath(inside, inside));
ok('不同路径不等', !samePath(inside, outside));
ok('空值安全', !samePath('', ''));

console.log(`\n${failed === 0 ? '全部通过' : '有失败项'}：${passed} 通过 / ${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
