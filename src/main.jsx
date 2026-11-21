import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionGlobalConfig } from 'motion/react';
import App from './App.jsx';
import { AppProvider } from './store/AppStore.jsx';
/* 液态玻璃引擎的底座（@vepando/liquid-glass-react）在 index.css 里以
   @import ... layer(vendor) 引入：它必须落在 vendor 层，base 层才能接管
   玻璃的 tint 与亮边，否则未分层的库样式会压过我们所有设计层。 */
import './index.css';
import './apple.css';
import './design/tokens.css';
import './design/base.css';
import './design/shelf.css';
import './design/reader.css';
import './design/library.css';
/* Radix 原语的外观层：只补交互态与定位，皮肤变量全部来自 tokens。 */
import './ui/primitives.css';
/* 液态玻璃材质层：全站最后一张样式表。它要改的是「玻璃的折射、边缘高光与浮动栏」，
   放在所有结构层之后才能用同级选择器覆盖，不必动用 !important。 */
import './design/glass.css';

/* 截图/回归用的确定性开关：?static=1 让 Motion 的补间一律瞬时完成。
   没有它，headless 下 AnimatePresence mode="wait" 的退场动画可能永远不结束，
   面板会截成空白（假 bug）。只影响带参数打开的窗口，正常启动无副作用。 */
if (new URLSearchParams(window.location.search).has('static')) {
  MotionGlobalConfig.skipAnimations = true;
}

/** 渲染层异常也送进主进程日志：用户点「导出日志」时能一并带出来。 */
function report(level, message, stack) {
  try {
    window.readerAPI?.logFromRenderer?.({ level, message, stack });
  } catch {
    /* 没有桌面 API 就只留在控制台 */
  }
}

window.addEventListener('error', (event) => {
  report('error', `window.onerror: ${event.message}`, event.error?.stack || `${event.filename}:${event.lineno}`);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  report(
    'error',
    `unhandledrejection: ${reason?.message || String(reason)}`,
    reason?.stack || undefined,
  );
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
