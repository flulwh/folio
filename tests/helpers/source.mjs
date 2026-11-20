/**
 * 从 electron 主进程源码里取出「未导出」的纯函数，在隔离上下文里执行后返回。
 *
 * 为什么不直接 import：electron/main.js 顶层就会调 app.whenReady() 等副作用，
 * 测试进程里 import 会把整个应用拉起来；而这些函数又不值得为了测试去搬文件。
 * 这里只读取源码文本、按函数名切片，并在 vm 里用 Node 的 TextDecoder/Buffer 执行。
 * 如果将来函数改名或移动，helper 会抛错而不是悄悄测到别的东西。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function sliceFunction(source, name) {
  const start = source.search(new RegExp(`(?:^|\\n)(?:export\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) throw new Error(`未在源码里找到函数 ${name}`);
  const bodyStart = source.indexOf('{', source.indexOf('(', start));
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1).trim();
    }
  }
  throw new Error(`函数 ${name} 的大括号不闭合`);
}

function sliceArrowConst(source, name) {
  const start = source.search(new RegExp(`(?:^|\\n)const\\s+${name}\\s*=`));
  if (start < 0) throw new Error(`未在源码里找到常量 ${name}`);
  const end = source.indexOf(';\n', start);
  if (end < 0) throw new Error(`常量 ${name} 没有结语句`);
  return source.slice(start, end + 1).trim();
}

/**
 * @param {string} relPath 相对仓库根目录的源码路径
 * @param {string[]} names 需要取出的函数名
 * @param {string[]} [arrowConsts] 需要一并取出的单行箭头常量名
 */
export function loadPrivateFunctions(relPath, names, arrowConsts = []) {
  const source = readFileSync(path.join(root, relPath), 'utf8');
  const chunks = names.map((name) => sliceFunction(source, name));
  for (const name of arrowConsts) chunks.push(sliceArrowConst(source, name));
  const script = `${chunks.join('\n')}\n;({ ${names.join(', ')} });`;
  return vm.runInNewContext(script, { TextDecoder, Buffer, console });
}
