/**
 * 主进程侧的书源引擎客户端。
 *
 * 书源抓取（含同步 curl、HTML/XPath 解析、@js: 规则）全部搬到 utilityProcess，
 * 主进程只负责转发调用、限时和崩溃重启 —— 事件循环永远不被网络请求占住。
 *
 * 生命周期：
 *  - 第一次调用时才 fork，平时不占进程；
 *  - 子进程崩溃/超时 → 本次调用报错，下一次调用自动重新拉起；
 *  - 一分钟内崩溃超过 5 次就停止重启，避免坏规则把机器拖进「崩溃-重启」死循环。
 */
import { utilityProcess } from 'electron';
import { callMessage, isResultMessage } from './source-protocol.js';

const CRASH_WINDOW = 60 * 1000;
const CRASH_LIMIT = 5;
const DEFAULT_TIMEOUT = 120 * 1000;

export function createSourceHost({ workerPath, log, timeout = DEFAULT_TIMEOUT } = {}) {
  let child = null;
  let ready = null;
  let seq = 0;
  let disposed = false;
  let crashes = [];
  const pending = new Map();

  function rejectAll(message) {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error(`${message}（${entry.method}）`));
    }
  }

  function onMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'log') {
      const tag = message.tag || 'source';
      const level = typeof message.level === 'string' ? message.level : 'info';
      const emit = log && typeof log[level] === 'function' ? log[level] : log?.debug;
      try {
        emit?.call(log, tag, message.message, message.extra);
      } catch {
        /* 日志不能影响主流程 */
      }
      return;
    }
    if (!isResultMessage(message)) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) {
      entry.resolve(message.value);
    } else {
      const error = new Error(message.error?.message || '书源引擎出错');
      if (message.error?.code) error.code = message.error.code;
      entry.reject(error);
    }
  }

  function onExit(code) {
    child = null;
    ready = null;
    rejectAll(`书源引擎已退出（code=${code ?? 'unknown'}）`);
    if (!disposed) log?.warn?.('source-worker', `书源引擎退出 code=${code ?? 'unknown'}，下次调用自动重启`);
  }

  function spawn() {
    const now = Date.now();
    crashes = crashes.filter((at) => now - at < CRASH_WINDOW);
    if (crashes.length >= CRASH_LIMIT) {
      throw new Error('书源引擎连续崩溃，已暂停重启；请检查最近导入的书源规则');
    }
    crashes.push(now);

    const proc = utilityProcess.fork(workerPath, [], {
      serviceName: 'Folio 书源引擎',
      // 书源解析是内存大户（整页 HTML + XPath）：给子进程单独设上限，
      // 撑爆时只死这一次抓取，不牵连主进程。
      execArgv: ['--max-old-space-size=768'],
      stdio: 'pipe',
      env: { ...process.env },
    });
    child = proc;

    // 子进程的 stdout/stderr 主要留给崩溃现场（vm 里的原生报错不会走日志转发）
    proc.stdout?.on('data', (chunk) => log?.debug?.('source-worker', String(chunk).trim().slice(0, 400)));
    proc.stderr?.on('data', (chunk) => log?.warn?.('source-worker', String(chunk).trim().slice(0, 400)));

    proc.on('message', onMessage);
    proc.on('exit', onExit);

    ready = new Promise((resolve, reject) => {
      proc.once('spawn', () => resolve(proc));
      proc.once('exit', () => reject(new Error('书源引擎启动失败')));
    });
    return ready;
  }

  function ensure() {
    if (disposed) return Promise.reject(new Error('书源引擎已关闭'));
    if (ready) return ready;
    return spawn();
  }

  function kill() {
    const proc = child;
    child = null;
    ready = null;
    if (proc) {
      try {
        proc.kill();
      } catch {
        /* 已经退出 */
      }
    }
  }

  /** 发一次调用；超时直接重启子进程，别让后续请求排在死进程后面。 */
  async function call(method, args = []) {
    const proc = await ensure();
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`书源引擎超时（${method}）`));
        kill();
        rejectAll('书源引擎超时后已重启');
      }, timeout);
      pending.set(id, { resolve, reject, timer, method });
      try {
        proc.postMessage(callMessage(id, method, args));
      } catch (err) {
        pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  return {
    search: (source, keyword, page, options) => call('search', [source, keyword, page, options]),
    bookInfo: (source, bookUrl, options) => call('bookInfo', [source, bookUrl, options]),
    toc: (source, bookUrl, book, options) => call('toc', [source, bookUrl, book, options]),
    chapter: (source, chapterUrl, bookUrl, chapter, options) =>
      call('chapter', [source, chapterUrl, bookUrl, chapter, options]),
    chapterImages: (source, chapterUrl, vars, options) => call('chapterImages', [source, chapterUrl, vars, options]),
    clean: (text, rules, ctx) => call('clean', [text, rules, ctx]),
    /** 书源被重导/删除后丢掉它的常驻运行时；没起过子进程时什么都不用做。 */
    disposeRuntimes: (ids) => {
      const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
      if (!list.length || !child) return Promise.resolve(0);
      return call('dispose', [list]);
    },
    call,
    dispose() {
      disposed = true;
      rejectAll('书源引擎已关闭');
      kill();
    },
  };
}
