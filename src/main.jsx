import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionGlobalConfig } from 'motion/react';
import App from './App.jsx';
import { AppProvider } from './store/AppStore.jsx';
import './index.css';
import './apple.css';
import './skin-miui.css';
import './design/tokens.css';
import './design/base.css';
import './design/shelf.css';
import './design/reader.css';
import './design/library.css';
/* Radix 原语的外观层：只补交互态与定位，皮肤变量全部来自 tokens。
   放在通用层之后、皮肤层之前，皮肤仍能覆盖形态。 */
import './ui/primitives.css';
/* 黑曜皮肤放在 design/ 之后：它要改的是"材质与纵深"，而通用层负责排版骨架，
   顺序在后才能用同级选择器覆盖，不必动用 !important。 */
import './skin-obsidian.css';
/* MIUI 的手感层必须最后加载：它要和 design/ 抢同一批控件的形态与反馈，
   放在最后才不必用 !important 硬顶。作用域仍限定在 [data-skin='miui']，
   Apple 皮肤完全不受影响。见文件头注释。 */
import './miui-motion.css';

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
