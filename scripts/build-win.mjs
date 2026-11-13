#!/usr/bin/env node
/**
 * Windows 打包入口。
 *
 * 做的事情只有一件：把 `scripts/nsis-static-uninstaller.cjs` 通过 NODE_OPTIONS
 * 注入到 electron-builder 进程里，其余参数原样透传给 electron-builder CLI。
 *
 * 原因见那个补丁文件的头部注释：Windows 上默认那条「执行安装包来生成卸载器」的路，
 * 在部分 Windows 版本（含 Windows 11 Insider）上会让 NSIS stub 以退出码 2 直接退出，
 * 导致 nsis 目标整体构建失败。补丁改成静态解析安装包内的卸载器数据块。
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shim = path.join(here, 'nsis-static-uninstaller.cjs');
const cli = path.join(here, '..', 'node_modules', 'electron-builder', 'cli.js');

// NODE_OPTIONS 里的反斜杠会被当成转义字符，Windows 路径必须换成正斜杠
const shimSpecifier = shim.replace(/\\/g, '/');
const nodeOptions = [process.env.NODE_OPTIONS, `--require=${shimSpecifier}`].filter(Boolean).join(' ').trim();

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code == null ? 1 : code);
});
