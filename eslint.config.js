/**
 * ESLint flat config —— 只做「防低级错误」的最小护栏，不做风格审查。
 *
 * 1. 只启用 react-hooks 的两条规则与 no-unused-vars：
 *    这套代码库历史上没有 lint，一次性全量开启 recommended 会产生大量与
 *    本次任务无关的告警，掩盖真正的问题。
 * 2. no-unused-vars 设为 warn，避免 legacy 代码（书源脚本、工具模块）卡住
 *    发版门禁；`^_` 前缀表示「故意不用」。
 * 3. 构建产物、安卓端、一次性脚本不进 lint 范围。
 */
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // electron-vite 的构建产物目录（主进程 / preload / 渲染层）
      'out/**',
      'release/**',
      'release-*/**',
      'android/**',
      'tools/**',
      'scripts/**',
      'build/**',
      // blog 是独立的 Vite + Worker 子项目，有自己的 package.json / 构建流程，
      // 不归桌面端阅读器的 lint 护栏管。
      'blog/**',
      // 官网的第三方运行时（Three.js 压缩产物）不参与 lint。
      'site/vendor/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // legacy 组件里存在刻意省略依赖的写法，先以 warning 暴露，不阻断发版。
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
];
