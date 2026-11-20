/**
 * 同时拉起 API 服务与 Vite 开发服务器，Ctrl+C 一起退出。
 * 不依赖 concurrently，保持依赖最小。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const children = [
  ['api', [path.join(root, 'server', 'index.js'), '--dev']],
  ['web', [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')]],
].map(([name, args]) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[dev] ${name} 退出，code=${code}`);
      shutdown(code);
    }
  });
  return child;
});

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
