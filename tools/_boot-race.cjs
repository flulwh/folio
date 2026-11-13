/**
 * 冷启动竞态复现：连续 reload N 次，每次在固定时刻采样 .view 的 opacity。
 * 白屏判据：1500ms 时 opacity < 0.5（内容已挂载但透明）。
 *
 * 用法：node tools/_boot-race.mjs [次数]
 */
const http = require('node:http');
const PORT = 9222;
const ROUNDS = Number(process.argv[2] || 6);

const getJson = (path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve(JSON.parse(b)));
      })
      .on('error', reject);
  });

const OPACITY = `(() => {
  const el = document.querySelector('.view');
  const root = document.getElementById('root');
  return JSON.stringify({
    o: el ? +(+getComputedStyle(el).opacity).toFixed(3) : null,
    k: el?.firstElementChild?.className || null,
    kids: root ? root.childElementCount : -1,
  });
})()`;

(async () => {
  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) return console.error('没有页面目标');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });

  await new Promise((r) => ws.addEventListener('open', r));
  await call('Runtime.enable');
  await call('Page.enable');
  // 默认提到前台（否则取样本身会被节流）；
  // 加 --keep-bg 则保持后台，用来复现"窗口不可见时动画停摆"的场景。
  if (!process.argv.includes('--keep-bg')) await call('Page.bringToFront');

  const read = async () => {
    const r = await call('Runtime.evaluate', { expression: OPACITY, returnByValue: true });
    const v = r?.result?.value;
    return v ? JSON.parse(v) : null;
  };

  let white = 0;
  const rows = [];

  for (let n = 1; n <= ROUNDS; n++) {
    await call('Page.reload', { ignoreCache: true });
    const t0 = Date.now();
    const marks = [];
    for (const at of [400, 900, 1500, 3000]) {
      const wait = at - (Date.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const d = await read();
      marks.push(d ? d.o : 'x');
    }
    const stuck = typeof marks[2] === 'number' && marks[2] < 0.5;
    if (stuck) white++;
    rows.push(
      `#${n}  o@400=${String(marks[0]).padEnd(5)} o@900=${String(marks[1]).padEnd(5)} ` +
        `o@1500=${String(marks[2]).padEnd(5)} o@3000=${String(marks[3]).padEnd(5)}  ${stuck ? '白屏' : 'ok'}`
    );
    console.log(rows[rows.length - 1]);
  }

  console.log(`\n白屏率：${white}/${ROUNDS}`);
  ws.close();
  process.exit(0);
})();
