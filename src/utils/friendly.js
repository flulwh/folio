/**
 * 把底层错误翻译成「人话」：告诉用户发生了什么、下一步能做什么。
 * 只处理已知模式，未知错误原样返回（避免吞掉有用信息）。
 */
const RULES = [
  {
    test: /(fetch failed|failed to fetch|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network error)/i,
    text: '网络连不上。检查网络，或在书源设置里填一个代理后再试。',
  },
  {
    test: /(ETIMEDOUT|timeout|timed out|超时)/i,
    text: '请求超时，这个站点可能比较慢或暂时不可达。稍等再试，或换一个书源。',
  },
  {
    test: /HTTP 5\d\d/i,
    text: (m) => `源站服务器出错了（${m[0]}）。这不是你的问题，稍后再试或换源。`,
  },
  {
    test: /HTTP 4\d\d/i,
    text: (m) => `源站拒绝了请求（${m[0]}）。可能已改版、需要登录，或对当前网络做了限制。`,
  },
  {
    test: /(401|403|unauthorized|forbidden)/i,
    text: '这个源需要登录或授权。可以换一个源，或在书源里补上 Cookie。',
  },
  {
    test: /(404|not found)/i,
    text: '源站上找不到这个地址，书源可能已经失效。',
  },
  {
    test: /(JSON|Unexpected token|not json)/i,
    text: '源站返回的内容不是预期格式，书源规则可能失效了。',
  },
  {
    test: /书源脚本出错/i,
    text: (m) => `${m[0]}。可以换一个书源，或把日志发给我看。`,
  },
  {
    test: /(Cannot read properties|undefined is not a function|not a function)/i,
    text: '书源脚本执行失败（规则不兼容）。换一个书源通常就能继续。',
  },
  {
    test: /(目录|章节)加载失败/i,
    text: '目录没取到。换一个书源，或稍后重试。',
  },
];

export function friendlyError(raw) {
  const message = String(raw ?? '').trim();
  if (!message) return '出了点小问题，请重试。';
  for (const rule of RULES) {
    const match = message.match(rule.test);
    if (!match) continue;
    return typeof rule.text === 'function' ? rule.text(match) : rule.text;
  }
  return message;
}

/** 判断是否是“换个网络/换源”类的错误，界面上可以附带建议按钮。 */
export function isNetworkError(raw) {
  return /(fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout|超时|socket hang up)/i.test(
    String(raw ?? '')
  );
}
