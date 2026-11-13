/**
 * 用干净的环境变量启动 Electron。
 *
 * 背景一：某些终端（IDE、沙箱、CI）会预设 ELECTRON_RUN_AS_NODE=1，此时 electron.exe
 * 会退化成纯 Node 进程，加载主进程代码时报
 *   "The requested module 'electron' does not provide an export named 'BrowserWindow'"
 * 或者直接静默退出（退出码 3）。这里在 spawn 前把这个变量删掉。
 *
 * 背景二：部分 Windows 机器上 Chromium 沙箱初始化会失败（受限账户、第三方安全软件、
 * AppContainer 不可用），进程一秒都活不到主进程 JS，表现为「启动没反应」。这类环境必须
 * 用 --no-sandbox 启动。设 FOLIO_STRICT_SANDBOX=1 可以强制保留沙箱。
 */
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];

const needNoSandbox =
  process.platform === 'win32' &&
  process.env.FOLIO_STRICT_SANDBOX !== '1' &&
  !args.includes('--no-sandbox');

if (needNoSandbox) {
  args.push('--no-sandbox');
  console.log('[folio] 已附加 --no-sandbox（若想保留 Chromium 沙箱：FOLIO_STRICT_SANDBOX=1）');
}

const child = spawn(electron, args, { stdio: 'inherit', env });

child.on('error', (error) => {
  console.error('[folio] 启动 Electron 失败：', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
