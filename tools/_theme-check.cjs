/**
 * 核对「主题」在 MIUI 皮肤下的实际颜色是否与主题卡描述一致。
 *
 * 做法：进入设置 → 外观，逐个点主题卡，读 .app 上计算后的
 * --accent / --bg / --text，和 themes.js 里该主题声明的值对比。
 *
 * 用法：node tools/_theme-check.cjs
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
  await call('Page.bringToFront');

  const js = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  };

  const rectOf = async (sel, text) =>
    JSON.parse(
      (await js(`(() => {
        const all = [...document.querySelectorAll(${JSON.stringify(sel)})];
        const el = ${text ? `all.find((n) => (n.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'all[0]'};
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

  // 进设置页
  for (let i = 0; i < 6; i++) {
    if (await js(`!!document.querySelector('.settings-page')`)) break;
    await click('.shelf-settings-btn');
    await sleep(700);
  }
  await sleep(400);
  await click('.settings-nav-item');
  await sleep(700);

  const themes = JSON.parse(
    await js(`JSON.stringify(
      [...document.querySelectorAll('.theme-swatch')].map((b) => ({
        label: (b.querySelector('.theme-label')?.textContent || '').trim(),
        active: b.classList.contains('active'),
        preview: getComputedStyle(b.querySelector('.theme-preview')).backgroundColor,
        ink: b.querySelector('.theme-preview')?.style.color || '',
      }))
    )`)
  );

  console.log('主题卡（预览色块 = 主题声明的 bg / accent）:');
  for (const t of themes) console.log(`  ${t.active ? '●' : '○'} ${t.label.padEnd(4)} bg=${t.preview} accent=${t.ink}`);

  const read = () =>
    js(`(() => {
      const app = document.querySelector('.app');
      const cs = getComputedStyle(app);
      const root = document.documentElement;
      return JSON.stringify({
        skin: root.dataset.skin,
        theme: app.dataset.theme,
        themeId: app.dataset.themeId,
        tone: app.dataset.themeTone,
        accent: cs.getPropertyValue('--accent').trim(),
        bg: cs.getPropertyValue('--bg').trim(),
        text: cs.getPropertyValue('--text').trim(),
        miPrimary: cs.getPropertyValue('--mi-primary').trim(),
        miS3: cs.getPropertyValue('--mi-s3').trim(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        appBg: cs.backgroundColor,
      });
    })()`).then(JSON.parse);

  console.log('\n逐个点击主题卡，读 .app 上真正生效的令牌:');
  for (const t of themes) {
    await click('.theme-swatch', t.label);
    await sleep(700);
    const v = await read();
    // 预览色读的是 computed rgb()，令牌是 hex —— 统一用 .app 实算出来的背景色比
    const ok = v.appBg === t.preview;
    console.log(
      `  ${t.label.padEnd(4)} tone=${String(v.tone).padEnd(5)} bg=${v.bg.padEnd(8)} text=${v.text.padEnd(18)} ` +
        `accent=${v.accent.padEnd(10)} mi-primary=${v.miPrimary.padEnd(10)} ${ok ? '与预览一致' : '⚠ 与预览不符'}`
    );
  }

  ws.close();
  process.exit(0);
})();
