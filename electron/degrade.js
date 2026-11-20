/**
 * 降级留痕：把「失败就返回默认值」的空 catch 从调用点收口到这里。
 *
 * 为什么需要它：这些 catch 不能抛（抛了整个面板/书架就不可用），但完全静默
 * 又让「为什么封面没缓存」「为什么窗口位置没恢复」永远查不到。折中做法是按
 * scope + 错误码每分钟只记一条 debug —— 默认级别是 info 不会刷屏，把
 * FOLIO_LOG_LEVEL 调成 debug 就能看到。
 *
 * 语义：成功时原样返回 fn() 的结果；失败返回 undefined，默认值由调用方自己给。
 * fn 返回 Promise 时同样兜住 reject，调用方 await 到的仍然是 undefined。
 */
const DEFAULT_WINDOW = 60 * 1000;

/**
 * @param {(scope:string, message:string, meta:object)=>void} logDebug 适配到各自的 logger
 * @param {{windowMs?:number, now?:()=>number}} [options]
 * @returns {(scope:string, fn:()=>any, extra?:object)=>any}
 */
export function createDegrade(logDebug, { windowMs = DEFAULT_WINDOW, now = Date.now } = {}) {
  // key = scope|code，value = 上次记录时间。只留最近窗口内的 key，长期运行也不占内存。
  const seen = new Map();

  function sweep(at) {
    for (const [key, time] of seen) {
      if (at - time > windowMs * 10) seen.delete(key);
    }
  }

  function note(scope, err, extra) {
    const code = err?.code || err?.name || 'error';
    const key = `${scope}|${code}`;
    const at = now();
    const last = seen.get(key);
    if (last !== undefined && at - last < windowMs) return;
    seen.set(key, at);
    if (seen.size > 64) sweep(at);
    try {
      logDebug?.(scope, `已降级：${scope}`, {
        code,
        error: err?.message || String(err),
        ...(extra && typeof extra === 'object' ? extra : {}),
      });
    } catch {
      /* 记日志本身失败绝不能反过来影响主流程 */
    }
  }

  return function degrade(scope, fn, extra) {
    try {
      const result = fn();
      // 数据路径里有不少 await：只靠 try/catch 兜不住异步 reject，这里顺手接上。
      if (result && typeof result.then === 'function') {
        return result.catch((err) => {
          note(scope, err, extra);
          return undefined;
        });
      }
      return result;
    } catch (err) {
      note(scope, err, extra);
      return undefined;
    }
  };
}
