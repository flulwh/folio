import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
// 版本号只认 package.json 一个来源：Electron 的 app.getVersion() 也读它，
// UI 里的回显通过 define 内联，避免各处硬编码的版本号随发版漂移。
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

// 手动分包（rollup manualChunks）。
// 出发点来自社区里成熟的做法：把「几乎不变的重依赖」拆成独立 chunk，
// 让首屏 HTML 只拉必需的代码，其余走 HTTP 缓存；并且多个 chunk 可以并行下载。
//
// 之前只有一个 427KB 的 index-*.js，任何一次改动都会让整包缓存失效。
// 拆成 react / motion / vendor 三块之后：
//   - react + react-dom 几乎不变，长期命中缓存
//   - framer-motion 单独成块，动效相关的改动不会牵连 react
//   - 其余第三方库归入 vendor，业务代码改动只让主 chunk 失效
export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Electron 30 = Chromium 124。写死 target 可以让 esbuild 少做一层降级转译，
    // 产物更小、解析更快（默认 'modules' 还会留一部分兼容代码）。
    target: 'chrome124',
    // 拆包后单块变小，把告警阈值调高以免刷屏
    chunkSizeWarningLimit: 600,
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // 注意匹配顺序：react-dom 的路径里也含 'react'，先判更具体的
          if (/node_modules[\\/](react-dom|react|scheduler)[\\/]/.test(id)) return 'react';
          if (/node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion';
          return 'vendor';
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  server: {
    // 必须显式绑 IPv4。Vite 的默认 host 是 'localhost'，在 Node 18+ 的 Windows 上
    // 会优先解析成 ::1（IPv6），只监听 IPv6 回环；而主进程 electron/main.js 加载的是
    // http://127.0.0.1:5173，dev:electron 的 wait-on 等的也是 127.0.0.1。
    // 结果就是 wait-on 永远等不到、Electron 起不来（或起来后白屏）。
    // 写死 127.0.0.1 让三者用同一个地址族。
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
});
