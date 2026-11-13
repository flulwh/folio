/**
 * 复现「设置页切皮肤后，再点其他分区变空白」。
 *
 * 操作序列与用户一致：书架 → 设置 → 外观 → 切 Apple/MIUI → 立刻点另一个分区。
 * 采样 .settings-main-inner 的子节点数、opacity、可见文字长度与导航高亮项。
 *
 * 用法：node tools/_settings-blank.cjs [--fast] [--rounds=N]
 *   --fast  切完皮肤立刻点分区（默认等 800ms 落定）
 */
const http = require('node:http');
const PORT = Number(process.env.CDP_PORT || 9222);

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

const FAST = process.argv.includes('--fast');
const SETTLE = FAST ? 0 : 800;
const ROUNDS = Number((process.argv.find((a) => a.startsWith('--rounds=')) || '').split('=')[1] || 3);
// --no-skin：跳过切皮肤，单独验证「点分区」本身是否也会空白，用来区分根因
const NO_SKIN = process.argv.includes('--no-skin');

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
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  };

  /** 按选择器 + 可选文本定位元素中心；文本用 textContent 精确匹配，避免 nth-child 猜错 */
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
    await call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: r.x,
      y: r.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await sleep(50);
    await call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: r.x,
      y: r.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    return true;
  };

  const snap = () =>
    js(`(() => {
      const inner = document.querySelector('.settings-main-inner');
      if (!inner) return JSON.stringify({ inner: null });
      const kids = [...inner.children];
      const first = kids[0];
      const cs = first ? getComputedStyle(first) : null;
      return JSON.stringify({
        kids: kids.length,
        opacity: cs ? +(+cs.opacity).toFixed(3) : null,
        x: cs ? +new DOMMatrixReadOnly(cs.transform).m41.toFixed(1) : null,
        chars: (inner.textContent || '').replace(/\\s+/g, '').length,
        skin: document.documentElement.dataset.skin || null,
        activeNav: document.querySelector('.settings-nav-item.active')?.textContent?.trim() || null,
        segActive: document.querySelector('.segmented-item.active')?.textContent?.trim() || null,
      });
    })()`).then((s) => JSON.parse(s || '{}'));

  const enterSettings = async () => {
    for (let i = 0; i < 5; i++) {
      if (await js(`!!document.querySelector('.settings-page')`)) return true;
      await click('.shelf-settings-btn');
      await sleep(700);
    }
    return js(`!!document.querySelector('.settings-page')`);
  };

  const goShelf = async () => {
    for (let i = 0; i < 5; i++) {
      if (await js(`!!document.querySelector('.shelf')`)) return true;
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await sleep(600);
    }
    return false;
  };

  const log = [];

  for (let n = 1; n <= ROUNDS; n++) {
    await goShelf();
    if (!(await enterSettings())) {
      log.push(`#${n} 进不去设置页`);
      continue;
    }
    await sleep(400);
    // 回到「外观」（第一个导航项），否则分段控件不在 DOM 里
    await click('.settings-nav-item', null);
    await sleep(600);

    const before = await snap();
    const targetSkin = NO_SKIN ? '(跳过)' : before.skin === 'miui' ? 'Apple' : 'MIUI';
    const switched = NO_SKIN ? true : await click('.segmented-item', targetSkin);
    await sleep(SETTLE);
    const afterSkin = await snap();

    // 点一个不同的分区（外观=1，阅读=2）
    const navClicked = await click('.settings-nav-item:nth-child(2)');
    await sleep(1200);
    const afterNav = await snap();
    await sleep(1400);
    const settled = await snap();

    const blank =
      settled.kids === 0
        ? '空白(无节点)'
        : settled.opacity < 0.5 && settled.chars > 0
          ? '空白(有内容但透明)'
          : 'ok';

    log.push(
      [
        `#${n} 点「${targetSkin}」=${switched ? 'ok' : '点不到'} 点分区=${navClicked ? 'ok' : '点不到'} 皮肤 ${
          before.skin
        }→${settled.skin} | ${blank}`,
        `   切换前   kids=${before.kids} o=${before.opacity} x=${before.x} chars=${before.chars} nav=${before.activeNav}`,
        `   切皮肤后 kids=${afterSkin.kids} o=${afterSkin.opacity} x=${afterSkin.x} chars=${afterSkin.chars} seg=${afterSkin.segActive}`,
        `   点分区后 kids=${afterNav.kids} o=${afterNav.opacity} x=${afterNav.x} chars=${afterNav.chars}`,
        `   静置后   kids=${settled.kids} o=${settled.opacity} x=${settled.x} chars=${settled.chars} nav=${settled.activeNav}`,
      ].join('\n')
    );
  }

  console.log(log.join('\n\n'));
  ws.close();
  process.exit(0);
})();
