/**
 * 主进程 ⇄ 书源子进程（utilityProcess）的消息协议。
 *
 * 只有三种消息，全部是 structured clone 能带过去的纯数据：
 *  - call     主进程 → 子进程：{ kind: 'call', id, method, args }
 *  - result   子进程 → 主进程：{ kind: 'result', id, ok: true, value }
 *                         或 { kind: 'result', id, ok: false, error: { message, code } }
 *  - log      子进程 → 主进程：{ kind: 'log', level, tag, message, extra }
 *
 * 这里刻意保持无副作用、无 Electron 依赖，方便单测直接覆盖协议边界。
 */

/** 允许从主进程调用的方法。白名单之外一律拒绝，避免把子进程变成通用执行器。 */
export const SOURCE_METHODS = Object.freeze([
  'search', // 搜索
  'bookInfo', // 详情页脚本（Legado info.init）
  'toc', // 目录
  'chapter', // 正文
  'chapterImages', // 漫画图片清单（抓页 + 解析）
  'clean', // 净化规则（可能含 @js:）
  'dispose', // 丢掉指定书源的常驻运行时
]);

const METHOD_SET = new Set(SOURCE_METHODS);
const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

export function isSourceMethod(method) {
  return typeof method === 'string' && METHOD_SET.has(method);
}

export function callMessage(id, method, args = []) {
  return { kind: 'call', id, method, args: Array.isArray(args) ? args : [args] };
}

export function resultMessage(id, value) {
  return { kind: 'result', id, ok: true, value };
}

/** 错误只保留消息与 code：栈里可能带本机路径，跨进程传过去也会被写进日志。 */
export function serializeError(error) {
  const message = String((error && error.message) || error || '书源引擎出错').slice(0, 500);
  const code = error && error.code != null ? String(error.code).slice(0, 40) : '';
  return code ? { message, code } : { message };
}

export function errorMessage(id, error) {
  return { kind: 'result', id, ok: false, error: serializeError(error) };
}

export function logMessage(level, tag, message, extra) {
  return {
    kind: 'log',
    level: LEVELS.has(level) ? level : 'info',
    tag: String(tag || 'source').slice(0, 40),
    message: String(message == null ? '' : message).slice(0, 800),
    extra: extra && typeof extra === 'object' ? extra : undefined,
  };
}

export function isCallMessage(message) {
  return Boolean(
    message &&
      message.kind === 'call' &&
      Number.isInteger(message.id) &&
      message.id > 0 &&
      isSourceMethod(message.method),
  );
}

export function isResultMessage(message) {
  return Boolean(message && message.kind === 'result' && Number.isInteger(message.id) && message.id > 0);
}
