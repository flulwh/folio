/**
 * 局域网面板 UI 冒烟：进设置 → 网络 → 开开关 → 校验服务真的起来了 → 截图。
 *
 *   node tools/_lan-ui.cjs [--keep-on]
 *
 * 默认测完把开关关回默认（不留下监听端口），加 --keep-on 可以保持开启。
 * 需要 Electron 以 --remote-debugging-port=9222 启动。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.CDP_PORT || 9222);
const KEEP_ON = process.argv.includes('--keep-on');
const OUT = path.join(__dirname, '_lan-ui.png');

const getJson = (p) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve(JSON.parse(b)));
      })
      .on('error', reject);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const target = (await getJson('/json/list')).find((t) => t.type === 'page');
  if (!target) return console.error('没有页面目标');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
  await call('Page.bringToFront');

  const js = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  };

  const rectOf = async (sel, text) =>
    JSON.parse(
      (await js(`(() => {
        const all = [...document.querySelectorAll(${JSON.stringify(sel)})];
        const el = ${
          text ? `all.find((n) => (n.textContent || '').trim() === ${JSON.stringify(text)})` : 'all[0]'
        };
        if (!el) return 'null';
        const r = el.getBoundingClientRect();
        if (!r.width) return 'null';
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()`)) || 'null'
    );

  const click = async (sel, text) => {
    const r = await rectOf(sel, text);
    if (!r) return false;
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, button: 'none', buttons: 0 });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
    return true;
  };

  const enterSettings = async () => {
    for (let i = 0; i < 5; i++) {
      if (await js(`!!document.querySelector('.settings-page')`)) return true;
      await click('.shelf-settings-btn');
      await sleep(700);
    }
    return js(`!!document.querySelector('.settings-page')`);
  };

  if (!(await enterSettings())) {
    console.error('进不了设置页');
    process.exit(1);
  }

  if (!(await click('.settings-nav-item', '网络'))) {
    console.error('找不到「网络」分区');
    process.exit(1);
  }
  await sleep(900);

  const snapshot = JSON.parse(
    (await js(`(() => {
      const inner = document.querySelector('.settings-main-inner');
      const text = (inner?.textContent || '').replace(/\\s+/g, ' ').trim();
      return JSON.stringify({
        active: document.querySelector('.settings-nav-item.active')?.textContent?.trim() || null,
        chars: text.length,
        hasTitle: text.includes('局域网面板'),
        hasPort: text.includes('端口'),
        hasToken: text.includes('访问码'),
        urls: [...document.querySelectorAll('.lan-url-row code')].map((n) => n.textContent),
        token: document.querySelector('.lan-token')?.textContent || '',
        switches: document.querySelectorAll('.settings-main-inner .switch').length,
        opacity: Number(getComputedStyle(inner?.firstElementChild || document.body).opacity),
      });
    })()`)) || '{}'
  );
  console.log('分区快照：', JSON.stringify(snapshot, null, 2));

  // 开启面板（第一颗开关）
  await click('.settings-main-inner .switch');
  await sleep(1600);

  const status = await js(`window.readerAPI.lanStatus().then((s) => JSON.stringify(s))`).then((s) => JSON.parse(s || '{}'));
  console.log('lanStatus：', JSON.stringify(status, null, 2));

  const after = JSON.parse(
    (await js(`(() => {
      const rows = [...document.querySelectorAll('.lan-url-row code')].map((n) => n.textContent);
      return JSON.stringify({
        urls: rows,
        token: document.querySelector('.lan-token')?.textContent || '',
        badge: document.querySelector('.settings-group-title .regex-badge')?.textContent || '',
        checked: document.querySelector('.settings-main-inner .switch')?.checked,
      });
    })()`)) || '{}'
  );
  console.log('开启后 UI：', JSON.stringify(after, null, 2));

  // 面板真的能访问吗
  if (status.running && status.urls?.length) {
    const url = status.urls[0];
    const res = await fetch(url, { redirect: 'manual' });
    console.log(`面板入口 ${url.replace(/t=[^&]+/, 't=***')} → HTTP ${res.status}`);
    const html = await res.text();
    console.log('面板是登录页/书架：', html.includes('输入桌面端显示的访问码') || html.includes('局域网'));
  } else {
    console.log('⚠ 服务没起来，面板没法验证');
  }

  const shot = await call('Page.captureScreenshot', { format: 'png' });
  if (shot?.data) {
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('截图：', OUT);
  }

  if (!KEEP_ON) {
    // 关回默认，别在开发机上留下监听端口
    await click('.settings-main-inner .switch');
    await sleep(900);
    const off = await js(`window.readerAPI.lanStatus().then((s) => JSON.stringify(s))`).then((s) => JSON.parse(s || '{}'));
    console.log('已关闭：running =', off.running);
  }

  ws.close();
})();
