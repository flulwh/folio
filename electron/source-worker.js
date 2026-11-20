/**
 * 书源引擎子进程（Electron utilityProcess）。
 *
 * 为什么单独起一个进程：
 *  - 书源规则里的 `java.ajax` 在「阅读」里是同步语义，这里只能继续用 curl 同步取页。
 *    放在主进程里会卡住整个事件循环（单次 8s、上限 19s），期间局域网心跳、进度写盘、
 *    IPC 全部排队；放进子进程后主进程只等一个 Promise，界面和手机端都不受影响。
 *  - 书源 JS 在 vm 里跑，逃逸防线只是纵深防御。脚本真跑出去时，拿到的也只是这个
 *    子进程（还有内存上限），不会直接摸到主进程的 Electron API。
 *
 * 子进程不直接面对渲染层：主进程通过 source-protocol.js 定义的消息协议转发调用，
 * 结果与错误都必须是可结构化克隆的纯数据。
 */
import {
  errorMessage,
  isCallMessage,
  logMessage,
  resultMessage,
} from './source-protocol.js';

const port = process.parentPort;

function send(message) {
  try {
    port.postMessage(message);
  } catch {
    /* 主进程已经退出时发送会抛错，忽略即可 */
  }
}

/** sources.js / jsengine.js 的 logger 接口：把日志转给主进程统一落盘。 */
const logger = {
  debug: (tag, message, extra) => send(logMessage('debug', tag, message, extra)),
  info: (tag, message, extra) => send(logMessage('info', tag, message, extra)),
  warn: (tag, message, extra) => send(logMessage('warn', tag, message, extra)),
  error: (tag, message, extra) => send(logMessage('error', tag, message, extra)),
};

let apiPromise = null;

/** 懒加载：第一次真正调用书源时才解析这条约 300KB 的依赖链。 */
function loadApi() {
  if (!apiPromise) {
    apiPromise = Promise.all([import('./sources.js'), import('./replace.js'), import('./jsengine.js')])
      .then(([sources, replace, engine]) => {
        sources.setLogger?.(logger);
        engine.setLogger?.(logger);
        replace.setLogger?.(logger);
        return {
          searchSource: sources.searchSource,
          fetchBookInfo: sources.fetchBookInfo,
          fetchToc: sources.fetchToc,
          fetchChapter: sources.fetchChapter,
          fetchPage: sources.fetchPage,
          extractImages: sources.extractImages,
          applyRules: replace.applyRules,
          disposeRuntime: engine.disposeRuntime,
        };
      })
      .catch((err) => {
        // 一次偶发失败不能把整个子进程卡死：清掉缓存，下次调用重新加载
        apiPromise = null;
        throw err;
      });
  }
  return apiPromise;
}

function optionsOf(value) {
  return value && typeof value === 'object' ? value : {};
}

async function run(method, args) {
  const api = await loadApi();
  switch (method) {
    case 'search': {
      const [source, keyword, page, options] = args;
      return api.searchSource(source, keyword, page, optionsOf(options));
    }
    case 'bookInfo': {
      const [source, bookUrl, options] = args;
      return api.fetchBookInfo(source, bookUrl, optionsOf(options));
    }
    case 'toc': {
      const [source, bookUrl, book, options] = args;
      return api.fetchToc(source, bookUrl, book || null, optionsOf(options));
    }
    case 'chapter': {
      const [source, chapterUrl, bookUrl, chapter, options] = args;
      return api.fetchChapter(source, chapterUrl, bookUrl, chapter || null, optionsOf(options));
    }
    case 'chapterImages': {
      const [source, chapterUrl, vars, options] = args;
      const opts = optionsOf(options);
      const { url: finalUrl, html } = await api.fetchPage(source, chapterUrl, optionsOf(vars), { proxy: opts.proxy });
      // 番茄等源的章节地址带 #itemId，HTTP 请求会丢掉它，但脚本要靠它取 itemId，
      // 所以规则里的 baseUrl 保留原始章节地址。
      const ruleBaseUrl = String(chapterUrl || '').includes('#') ? chapterUrl : finalUrl;
      const item = opts.chapter || null;
      const urls = api.extractImages(html, source.content?.rule || '', finalUrl, {
        source,
        cacheRoot: opts.cacheRoot,
        proxy: opts.proxy,
        bindings: { chapter: item, title: item?.title || '', bookUrl: opts.bookUrl, baseUrl: ruleBaseUrl },
      });
      return { urls, referer: finalUrl };
    }
    case 'clean': {
      const [text, rules, ctx] = args;
      const options = optionsOf(ctx);
      return api.applyRules(text, rules, {
        scope: options.scope,
        cacheRoot: options.cacheRoot,
        proxy: options.proxy,
      });
    }
    case 'dispose': {
      const [ids] = args;
      const list = Array.isArray(ids) ? ids : [ids];
      for (const id of list) api.disposeRuntime(id);
      return list.length;
    }
    default:
      throw new Error(`未知的书源方法：${method}`);
  }
}

port.on('message', (event) => {
  const message = event?.data;
  if (!isCallMessage(message)) {
    // 协议外的消息直接忽略，避免子进程被当成通用执行器
    if (message && message.kind === 'call') {
      send(errorMessage(message.id, new Error('不支持的书源方法')));
    }
    return;
  }
  run(message.method, message.args).then(
    (value) => send(resultMessage(message.id, value)),
    (error) => send(errorMessage(message.id, error)),
  );
});

function fatal(err) {
  send(logMessage('error', 'source-worker', '书源引擎异常退出', { error: String(err?.message || err).slice(0, 300) }));
  // 状态已经不可信，让主进程按崩溃处理并在下次调用时重新拉起
  process.exit(1);
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);
