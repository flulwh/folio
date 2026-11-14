/**
 * P2-2 回归：`lan:books` 从主进程广播 → preload 暴露 → 渲染层订阅 的链路必须完整。
 *
 * 无头环境点不了 UI，这里分两层验证：
 *  1. 行为层：用 vm + 假 electron 模块真正加载 `preload.cjs`，断言 onLanBooks
 *     能收到 'lan:books' 事件、清理函数能摘掉监听器。
 *  2. 静态层：断言 `AppStore.jsx` 订阅了 onLanBooks、走 api.getBooks 刷新，
 *     并且 useEffect 的 cleanup 里调用了 off?.()。
 *
 * 用法：node tools/_qa-lan-books-ipc.mjs
 * 退出码：0 = 全部符合预期；1 = 有失败项。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preloadPath = path.join(root, 'electron', 'preload.cjs');
const storePath = path.join(root, 'src', 'store', 'AppStore.jsx');
const mainPath = path.join(root, 'electron', 'main.js');

let passed = 0;
const failures = [];

function check(name, condition, actual = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`[PASS] ${name}\n`);
    return true;
  }
  failures.push(`${name}${actual ? `  ← 实际：${actual}` : ''}`);
  process.stdout.write(`[FAIL] ${name}${actual ? `  ← 实际：${actual}` : ''}\n`);
  return false;
}

process.stdout.write('\n=== P2-2 lan:books 链路 ===\n\n');

/* ---------------- 1. preload.cjs 行为验证 ---------------- */

process.stdout.write('--- preload.cjs：真实加载并模拟一次 IPC ---\n');

const listeners = new Map();
const ipcRenderer = {
  on(channel, fn) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(fn);
  },
  removeListener(channel, fn) {
    listeners.get(channel)?.delete(fn);
    return undefined;
  },
  invoke: () => Promise.resolve(null),
};

let exposed = null;
const contextBridge = {
  exposeInMainWorld(name, api) {
    exposed = { name, api };
  },
};

vm.runInNewContext(fs.readFileSync(preloadPath, 'utf8'), {
  require: (name) => {
    if (name === 'electron') return { contextBridge, ipcRenderer };
    throw new Error(`unexpected require: ${name}`);
  },
});

check('preload 通过 contextBridge 暴露了 readerAPI', exposed?.name === 'readerAPI', String(exposed?.name));
check('readerAPI 上有 onLanBooks', typeof exposed?.api?.onLanBooks === 'function', typeof exposed?.api?.onLanBooks);

const received = [];
const off = exposed?.api?.onLanBooks?.((payload) => received.push(payload));
check('订阅后 lan:books 通道有且仅有 1 个监听器', listeners.get('lan:books')?.size === 1, String(listeners.get('lan:books')?.size));

const payload = { id: 'sha1-abc', reason: 'upload', at: 123 };
for (const fn of listeners.get('lan:books') || []) fn({}, payload);
check('监听到 lan:books 事件并原样透传 payload', received.length === 1 && received[0]?.id === payload.id, JSON.stringify(received));

check('onLanBooks 返回清理函数', typeof off === 'function', typeof off);
off?.();
check('调用清理函数后监听器被摘掉', listeners.get('lan:books')?.size === 0, String(listeners.get('lan:books')?.size));
for (const fn of listeners.get('lan:books') || []) fn({}, { id: 'late' });
check('清理后再广播不会触发旧回调', received.length === 1, `calls=${received.length}`);

/* ---------------- 2. AppStore.jsx 静态验证 ---------------- */

process.stdout.write('\n--- AppStore.jsx：订阅 + 刷新 + cleanup ---\n');

const store = fs.readFileSync(storePath, 'utf8');
const at = store.indexOf('onLanBooks');
check('AppStore 订阅了 onLanBooks', at >= 0, at >= 0 ? '' : '没有找到 onLanBooks');

if (at >= 0) {
  const effectStart = store.lastIndexOf('useEffect(() => {', at);
  const effectEnd = store.indexOf('}, []);', at);
  const block = effectStart >= 0 && effectEnd > effectStart ? store.slice(effectStart, effectEnd) : '';
  check('onLanBooks 写在 useEffect 内', effectStart >= 0, `effectStart=${effectStart}`);
  check('收到事件后走 api.getBooks() 刷新（与首次加载同一条路径）', /api\.getBooks\s*\(/.test(block), block.slice(0, 200));
  check('刷新结果写回 setBooks', /setBooks\s*\(/.test(block), '');
  check('useEffect 的 cleanup 里调用了 off?.()', /off\?\.\(\)/.test(block), '');
  check('cleanup 先置 cancelled 再摘监听', /cancelled\s*=\s*true[\s\S]*off\?\.\(\)/.test(block), '');
}

/* ---------------- 3. 主进程广播源仍在 ---------------- */

process.stdout.write('\n--- main.js：广播源 ---\n');
const main = fs.readFileSync(mainPath, 'utf8');
check("main.js 仍然 broadcast('lan:books', …)", /broadcast\(\s*['"]lan:books['"]/.test(main), '');

/* ---------------- 汇总 ---------------- */

process.stdout.write(`\n=== 汇总：${passed + failures.length} 项，通过 ${passed}，失败 ${failures.length} ===\n`);
if (failures.length) {
  process.stdout.write('\n失败明细：\n');
  for (const item of failures) process.stdout.write(` - ${item}\n`);
}
process.exit(failures.length ? 1 : 0);
