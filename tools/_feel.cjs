/**
 * 手感测量：不截图，采样真实渲染帧，把"弹回得对不对"变成数字。
 *
 * 做法：
 *   1. 页面里装 rAF 采样器，每帧记录一个标量（scale / 位置 / 宽度 / opacity）；
 *   2. 用 CDP 的 Input.dispatchMouseEvent 发真实按下与松手；
 *   3. 取回时间序列，算：按下深度与到达时刻、松手后的回弹峰值、稳定时间。
 *
 * 两种动作：
 *   hold-cancel  按住 hold 毫秒后把指针移开再松手 —— 不触发 click，不会误开文件框；
 *   click        直接点击 —— 用来触发分段滑块这类要真的切换的控件。
 *
 * 前置：electron 带 --remote-debugging-port=9222 启动。
 * 用法：node tools/_feel.cjs
 */
const http = require('node:http');
const PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

(async () => {
  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) return console.error('没有页面目标（electron 是否带 --remote-debugging-port=9222？）');

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

  const js = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r?.result?.value;
  };

  const rectOf = async (sel) => {
    const raw = await js(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return 'null';
      return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    })()`);
    return raw === 'null' ? null : JSON.parse(raw);
  };

  /** 采样子：prop = scale | x | width | opacity */
  const startRec = (sel, prop, pseudo, ms) =>
    js(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'no-el';
      const t0 = performance.now();
      const rec = (window.__rec = []);
      const read = () => {
        if (${JSON.stringify(prop)} === 'width') {
          return parseFloat(getComputedStyle(el, ${pseudo ? JSON.stringify(pseudo) : 'null'}).width);
        }
        if (${JSON.stringify(prop)} === 'opacity') return +(+getComputedStyle(el).opacity).toFixed(4);
        if (${JSON.stringify(prop)} === 'x') {
          // 每帧重新查询 + 读 transform 的位移量。
          const cur = document.querySelector(${JSON.stringify(sel)});
          return cur ? +new DOMMatrixReadOnly(getComputedStyle(cur).transform).m41.toFixed(3) : NaN;
        }
        return +new DOMMatrixReadOnly(getComputedStyle(el).transform).a.toFixed(5);
      };
      const tick = () => {
        const t = performance.now() - t0;
        rec.push([+t.toFixed(1), read()]);
        if (t < ${ms}) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return 'ok';
    })()`);

  const readRec = async () => JSON.parse(await js('JSON.stringify(window.__rec || [])'));

  const press = (x, y) =>
    call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  const release = (x, y) =>
    call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  const moveTo = (x, y) =>
    call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });

  /**
   * 分析一条时间序列。
   * rest   = 末帧值（稳定值）
   * depth  = 按下阶段离 rest 最远的点（scale 用最小值）
   * peak   = 松手之后越过 rest 的最远点 —— 这才是"过冲"
   * settle = 最后一次偏离 rest 超过容差之后的时刻
   */
  const DUMP = process.argv.includes('--dump');

  function analyze(name, series, releasedAt) {
    if (!series.length) return console.log(`${name.padEnd(12)} 无采样`);
    const rest = series[series.length - 1][1];
    const tol = Math.max(Math.abs(rest) * 0.0008, 0.0004);

    const press = series.filter(([t]) => t <= releasedAt + 16);
    let depth = press[0]?.[1] ?? rest;
    let depthAt = 0;
    for (const [t, v] of press) if (Math.abs(v - rest) > Math.abs(depth - rest)) ((depth = v), (depthAt = t));

    // 回弹只能发生在"越过 rest 之后"：按下是往下压的，回来时冲过 rest 才算过冲。
    // 直接取离 rest 最远的点会把按下的深度也算进去（那是按下量，不是回弹）。
    const after = series.filter(([t]) => t > releasedAt + 16);
    const pressedDown = depth < rest;
    let peak = rest;
    let peakAt = 0;
    for (const [t, v] of after) {
      const beyond = pressedDown ? v > peak : v < peak;
      if (beyond) ((peak = v), (peakAt = t));
    }

    let settle = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (Math.abs(series[i][1] - rest) > tol) {
        settle = series[i + 1]?.[0] ?? null;
        break;
      }
    }

    if (DUMP) {
      const step = process.argv.includes('--all') ? 1 : Math.max(1, Math.floor(series.length / 24));
      const path = series
        .filter((_, i) => i % step === 0)
        .map(([t, v]) => `${Math.round(t)}:${+v.toFixed(3)}`)
        .join('  ');
      console.log(`  [轨迹] ${path}`);
    }

    const overPct = rest !== 0 ? ((peak - rest) / Math.abs(rest)) * 100 : peak - rest;
    const depthPct = rest !== 0 ? ((depth - rest) / Math.abs(rest)) * 100 : depth - rest;
    console.log(
      `${name.padEnd(12)} rest=${String(+rest.toFixed(4)).padEnd(8)} ` +
        `按下=${(depthPct >= 0 ? '+' : '') + depthPct.toFixed(2)}% @${String(Math.round(depthAt)).padStart(3)}ms  ` +
        `回弹=${(overPct >= 0 ? '+' : '') + overPct.toFixed(2)}% @${String(Math.round(peakAt)).padStart(3)}ms  ` +
        `稳定≈${settle === null ? '—' : Math.round(settle) + 'ms'}`
    );
  }

  /** 一次完整测量 */
  async function trial(name, sel, prop, { pseudo = null, action = 'hold-cancel', hold = 180, total = 900 } = {}) {
    const r = await rectOf(sel);
    if (!r) return console.log(`${name.padEnd(12)} 跳过（找不到可点的 ${sel}）`);
    const started = await startRec(sel, prop, pseudo, total);
    if (started !== 'ok') return console.log(`${name.padEnd(12)} 跳过（${started}）`);

    // 先派一次 hover：真实鼠标不可能"凭空出现在按钮上"，
    // 缺这一步时 React 的 hover 状态没建立，布局/动画路径会和真实点击不一致。
    await moveTo(r.x, r.y);
    await press(r.x, r.y);
    await sleep(hold);
    if (action === 'hold-cancel') {
      await moveTo(4, 4); // 移开再松手，不产生 click
      await release(4, 4);
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, button: 'none', buttons: 0 });
    } else {
      await release(r.x, r.y);
    }
    await sleep(total - hold + 200);

    analyze(name, await readRec(), hold);
  }

  /** 专用于分段滑块：逐帧记录内联 transform 的 translateX */
  async function trialThumb(name, clickSel) {
    const r = await rectOf(clickSel);
    if (!r) return console.log(`${name.padEnd(12)} 跳过（找不到 ${clickSel}）`);
    await js(`(() => {
      const t0 = performance.now();
      const rec = (window.__rec = []);
      const tick = () => {
        const el = document.querySelector('.segmented-thumb');
        const tr = el ? (el.style.transform || '') : '';
        const m = /translateX\\(([-0-9.]+)px\\)/.exec(tr);
        rec.push([+(performance.now() - t0).toFixed(1), m ? parseFloat(m[1]) : NaN]);
        if (performance.now() - t0 < 800) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return 'ok';
    })()`);

    await moveTo(r.x, r.y);
    await press(r.x, r.y);
    await sleep(60);
    await release(r.x, r.y);
    await sleep(1000);
    analyze(name, await readRec(), 60);
  }

  // 归位到书架：应用会恢复上次读的书，可能一启动就在阅读器里。
  // 先按 Esc 退出阅读器，再确认 .shelf 出现。
  for (let i = 0; i < 3; i++) {
    const onShelf = await js(`!!document.querySelector('.shelf')`);
    if (onShelf) break;
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise((r) => setTimeout(r, 700));
  }

  console.log(`目标：${page.url}`);
  console.log('─'.repeat(104));
  console.log('控件         稳定值      按下深度          松手回弹          稳定');
  console.log('─'.repeat(104));

  // 1) 主按钮：按下塌陷 + 松手回弹（移开松手，不会真的导入）
  await trial('主按钮', '.btn.primary', 'scale', { hold: 180, total: 800 });

  // 2) 分段滑块：读内联 style 里的 translateX（framer 每帧写的就是这个值）。
  //    不能用 getComputedStyle：在 miui 皮肤下 .segmented-thumb 命中多个节点时，
  //    计算值可能来自那个 display:none 的旧节点，恒为 none → 恒为 0。
  const beforeSort = await js(
    `document.querySelector('.segmented .segmented-item.active')?.textContent?.trim() || '-'`
  );
  await trialThumb('分段滑块', '.segmented .segmented-item:not(.active)');
  const afterSort = await js(
    `document.querySelector('.segmented .segmented-item.active')?.textContent?.trim() || '-'`
  );
  console.log(`            排序：${beforeSort} → ${afterSort}${beforeSort === afterSort ? '（没有切换）' : ''}`);

  // 3) 进设置页，量开关橡皮筋与滑杆
  const gear = await rectOf('.shelf-settings-btn');
  if (gear) {
    await press(gear.x, gear.y);
    await release(gear.x, gear.y);
    await sleep(900);
    const inSettings = await js(`!!document.querySelector('.settings-page')`);
    console.log(`\n[进入设置页：${inSettings ? '是' : '否'}]`);
    if (inSettings) {
      await trial('开关橡皮筋', '.switch', 'width', { pseudo: '::after', hold: 600, total: 1300 });
    }
  }

  ws.close();
  process.exit(0);
})();
