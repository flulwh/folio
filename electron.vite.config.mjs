import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import rendererConfig from './vite.config.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * electron-vite：主进程、preload、渲染层各一套构建配置。
 *
 * - 主进程有两个入口：main.js 与书源子进程 source-worker.js；产物都在 out/main，
 *   两者相对路径不变，main.js 里 `path.join(__dirname, 'source-worker.js')` 仍然成立。
 * - preload 必须保持 CJS（`.cjs`）：Electron 的 ESM preload 需要额外条件，
 *   现有 preload.cjs 就是按 CJS 写的。
 * - 渲染层复用 vite.config.js（CSP、手动分包、别名、define 全部沿用），
 *   只是产物目录从 dist 换成 out/renderer。
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: path.join(rootDir, 'electron/main.js'),
          'source-worker': path.join(rootDir, 'electron/source-worker.js'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(rootDir, 'electron/preload.cjs'),
        output: { format: 'cjs', entryFileNames: 'preload.cjs' },
      },
    },
  },
  renderer: {
    ...rendererConfig,
    // electron-vite 的 findInput 固定找 <root>/src/renderer/index.html，
    // 本项目是「根目录即渲染层」的结构，必须显式给出入口，否则报
    // 「index.html file is not found in /src/renderer directory」。
    root: rootDir,
    build: {
      ...rendererConfig.build,
      outDir: path.join(rootDir, 'out/renderer'),
      rollupOptions: {
        ...rendererConfig.build.rollupOptions,
        input: path.join(rootDir, 'index.html'),
      },
    },
  },
});
