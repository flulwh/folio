/**
 * T02 自查：设备管理 HTTP 接口 + SSE 在线态。
 *
 * 起一个真实的局域网服务（临时数据目录 + 真实 devicestore），用 curl 风格请求打：
 *  - 不带设备头：能过鉴权，但不建档、不回指令
 *  - 带设备头：建档、心跳、指令领取、回执、快照
 *  - snapshot > 256KB / receipt 非法 state / 不存在的指令 / 过期指令
 *  - SSE 0→1 / 1→0 的 device 事件
 *
 * 用法：node tools/_device-http-check.mjs
 * 退出码：0 = 全绿；1 = 有失败项。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLanService } from '../electron/lan.js';
import { createDeviceStore } from '../electron/devicestore.js';

let passed = 0;
const failures = [];

function check(name, condition, actual = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`[PASS] ${name}\n`);
    return true;
  }
  failures.push(`${name}${actual ? `  ← 实际：${actual}` : ''}`);
  process.stdout.write(`[FAIL] ${name}${actual ? `  ← 实际：${actual}` : ''}\n`);
  return false;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-device-http-'));
const booksDir = path.join(root, 'books');
fs.mkdirSync(booksDir, { recursive: true });
const files = {
  books: path.join(root, 'books.json'),
  progress: path.join(root, 'progress.json'),
  settings: path.join(root, 'settings.json'),
};
fs.writeFileSync(files.books, '[]', 'utf8');
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true };
};

let clock = 1_700_000_000_000;
const deviceStore = createDeviceStore({ dataDir: root, readJson, writeJson, now: () => clock });
const deviceEvents = [];
const service = createLanService({
  files,
  booksDir,
  readJson,
  writeJson,
  log: () => {},
  getVersion: () => '2.7.0-device-check',
  devices: deviceStore,
  onDeviceChanged: (id, online) => deviceEvents.push({ id, online }),
});

const port = 24000 + Math.floor(Math.random() * 800);
const started = await service.start({ port, token: 'TEST123', allowWrite: true });
if (!started.ok) {
  process.stderr.write(`服务启动失败：${started.error}\n`);
  process.exit(2);
}
const base = `http://127.0.0.1:${service.port}`;
const TOKEN = 'TEST123';
const DEVICE_ID = 'dev-http-1';
const DEVICE_HEADERS = {
  'X-Folio-Device': DEVICE_ID,
  'X-Folio-Device-Name': encodeURIComponent('Pixel 8'),
  'X-Folio-Api-Version': '2',
  'X-Folio-App-Version': '3.1.0',
};

const hashOf = (seed) => seed.toString(16).padStart(40, '0').slice(-40);
const readDevices = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'devices.json'), 'utf8')).devices || [];
  } catch {
    return [];
  }
};
const savedDevice = (id = DEVICE_ID) => readDevices().find((item) => item.id === id) || null;

async function req(pathname, { method = 'GET', headers = {}, body, device = false } = {}) {
  const all = { 'X-Folio-Token': TOKEN, ...headers };
  if (device) Object.assign(all, DEVICE_HEADERS);
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: all,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应 */
  }
  return { res, json, text };
}

/** 打开一条 SSE 连接；返回按事件名取下一帧的工具。 */
async function openSse(deviceId) {
  const controller = new AbortController();
  const headers = { 'X-Folio-Token': TOKEN };
  if (deviceId) headers['X-Folio-Device'] = deviceId;
  const res = await fetch(`${base}/api/events`, { headers, signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    res,
    async next(name, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const split = buffer.indexOf('\n\n');
        if (split >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
          if (event === name) {
            const data = /^data:\s*(.+)$/m.exec(frame)?.[1] || '{}';
            return JSON.parse(data);
          }
          continue;
        }
        const remaining = Math.max(1, deadline - Date.now());
        const chunk = await Promise.race([
          reader.read(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`等待 ${name} 超时`)), remaining)),
        ]);
        if (chunk.done) throw new Error(`SSE 已关闭，没等到 ${name}`);
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      throw new Error(`等待 ${name} 超时`);
    },
    close() {
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
    },
  };
}

process.stdout.write(`\n=== T02 设备 HTTP 接口 → ${base} ===\n\n`);

try {
  /* ---------------- 0. 能力位 ---------------- */
  process.stdout.write('--- 0. ping 能力位 ---\n');
  {
    const { res, json } = await req('/api/ping');
    check('apiVersion 保持 2', json?.apiVersion === 2, String(json?.apiVersion));
    check('features 含 devices', Array.isArray(json?.features) && json.features.includes('devices'), JSON.stringify(json?.features));
    check('ping 仍 200', res.status === 200, String(res.status));
  }

  /* ---------------- 1. 不带设备头：能过鉴权，但不建档、不回指令 ---------------- */
  process.stdout.write('\n--- 1. 不带 X-Folio-Device ---\n');
  {
    const hb = await req('/api/device/heartbeat', { method: 'POST' });
    check('heartbeat 无设备头 → 400', hb.res.status === 400, `status=${hb.res.status} body=${hb.text.slice(0, 100)}`);

    const snap = await req('/api/device/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ books: [], storageTotal: 1, storageFree: 1, booksBytes: 0 }),
    });
    check('snapshot 无设备头 → 400', snap.res.status === 400, `status=${snap.res.status}`);

    const commands = await req('/api/device/commands');
    check(
      'commands 无设备头 → 200 且空数组',
      commands.res.status === 200 && Array.isArray(commands.json?.commands) && commands.json.commands.length === 0,
      `status=${commands.res.status} body=${commands.text.slice(0, 100)}`,
    );

    const receipt = await req('/api/device/commands/cmd_none/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    check('receipt 无设备头 → 404', receipt.res.status === 404, `status=${receipt.res.status}`);

    check('以上请求一台设备都没建', readDevices().length === 0, `devices=${readDevices().length}`);
  }

  /* ---------------- 2. 带设备头：建档 / 在线 ---------------- */
  process.stdout.write('\n--- 2. 带 X-Folio-Device ---\n');
  {
    const hb = await req('/api/device/heartbeat', { method: 'POST', device: true });
    const json = hb.json || {};
    const saved = savedDevice();
    check('heartbeat 带设备头 → 200', hb.res.status === 200, `status=${hb.res.status} body=${hb.text.slice(0, 120)}`);
    check('返回 device.id 正确', json.device?.id === DEVICE_ID, JSON.stringify(json.device));
    check('device 名从 X-Folio-Device-Name 解出', json.device?.name === 'Pixel 8', String(json.device?.name));
    check('首次心跳 online=true', json.device?.online === true, String(json.device?.online));
    check('pending 初始为 0', json.pending === 0, String(json.pending));
    check('devices.json 建档 1 台', readDevices().length === 1, `devices=${readDevices().length}`);
    check('建档平台/版本正确', saved?.platform === 'android' && saved?.appVersion === '3.1.0' && saved?.apiVersion === 2, JSON.stringify({ p: saved?.platform, a: saved?.appVersion, v: saved?.apiVersion }));
    check('lastIp 已记录', Boolean(saved?.lastIp), String(saved?.lastIp));
    check('devices.json 不含 online', !("online" in (saved || {})), JSON.stringify(Object.keys(saved || {})));

    const firstSeen = saved?.firstSeenAt;
    clock += 5_000;
    const again = await req('/api/device/heartbeat', { method: 'POST', device: true });
    check('重复心跳不重复建档', readDevices().length === 1, `devices=${readDevices().length}`);
    check('firstSeenAt 不变', savedDevice()?.firstSeenAt === firstSeen, `${savedDevice()?.firstSeenAt} vs ${firstSeen}`);
    check('lastSeenAt 刷新', savedDevice()?.lastSeenAt === clock, String(savedDevice()?.lastSeenAt));
    check('重复心跳仍 200', again.res.status === 200, String(again.res.status));
  }

  /* ---------------- 3. 指令领取 / 回执 ---------------- */
  process.stdout.write('\n--- 3. 指令与回执 ---\n');
  let commandId = '';
  {
    const queued = deviceStore.enqueue({
      deviceId: DEVICE_ID,
      type: 'push-book',
      payload: { hash: hashOf(1), title: 'HTTP 测试书', size: 128 },
    });
    commandId = queued.command.id;
    const hb = await req('/api/device/heartbeat', { method: 'POST', device: true });
    check('心跳 pending 反映入队', hb.json?.pending === 1, String(hb.json?.pending));

    const claimed = await req('/api/device/commands', { device: true });
    check('GET commands → 200 且 1 条', claimed.res.status === 200 && claimed.json?.commands?.length === 1, `status=${claimed.res.status} body=${claimed.text.slice(0, 160)}`);
    check('领取的是刚才入队的指令', claimed.json?.commands?.[0]?.id === commandId, String(claimed.json?.commands?.[0]?.id));
    check('领取响应含 type/payload/expiresAt', Boolean(claimed.json?.commands?.[0]?.type && claimed.json?.commands?.[0]?.payload && claimed.json?.commands?.[0]?.expiresAt), JSON.stringify(claimed.json?.commands?.[0]).slice(0, 160));
    check('文件里状态转 delivered', savedDevice()?.commands?.[0]?.state === 'delivered', savedDevice()?.commands?.[0]?.state);
    check('重复领取为空', (await req('/api/device/commands', { device: true })).json?.commands?.length === 0, '');
    const claimedHb = await req('/api/device/heartbeat', { method: 'POST', device: true });
    check('delivered 仍算未完结（pending=1）', claimedHb.json?.pending === 1, String(claimedHb.json?.pending));

    const badState = await req(`/api/device/commands/${encodeURIComponent(commandId)}/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'cancelled' }),
      device: true,
    });
    check('receipt 非法 state → 400', badState.res.status === 400, `status=${badState.res.status} body=${badState.text.slice(0, 120)}`);

    const missing = await req('/api/device/commands/cmd_missing/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
      device: true,
    });
    check('receipt 不存在 → 404', missing.res.status === 404, `status=${missing.res.status} body=${missing.text.slice(0, 120)}`);

    const done = await req(`/api/device/commands/${encodeURIComponent(commandId)}/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'done', detail: { size: 128 } }),
      device: true,
    });
    check('receipt done → 200', done.res.status === 200 && done.json?.state === 'done', `status=${done.res.status} body=${done.text.slice(0, 120)}`);
    check('done 后进 history', savedDevice()?.history?.some((h) => h.id === commandId && h.state === 'done') === true, JSON.stringify(savedDevice()?.history?.map((h) => h.state)));
  }

  /* ---------------- 4. 快照 ---------------- */
  process.stdout.write('\n--- 4. 快照 ---\n');
  {
    const okSnap = await req('/api/device/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        books: [
          { hash: hashOf(1), title: '第一本', size: 128, hasLocalFile: true },
          { hash: hashOf(2), title: '第二本', size: 256, hasLocalFile: false },
        ],
        storageTotal: 128_000_000_000,
        storageFree: 64_000_000_000,
        booksBytes: 384,
        appVersion: '3.1.0',
        apiVersion: 2,
      }),
      device: true,
    });
    check('snapshot 正常 → 200 accepted', okSnap.res.status === 200 && okSnap.json?.accepted === true, `status=${okSnap.res.status} body=${okSnap.text.slice(0, 160)}`);
    check('snapshot 落盘 2 本', savedDevice()?.snapshot?.books?.length === 2, JSON.stringify(savedDevice()?.snapshot?.books));
    check('snapshotAt 已写', Number(savedDevice()?.snapshot?.snapshotAt) === clock, String(savedDevice()?.snapshot?.snapshotAt));

    const huge = JSON.stringify({
      books: [{ hash: hashOf(3), title: 'x'.repeat(300 * 1024), size: 1, hasLocalFile: true }],
      storageTotal: 1,
      storageFree: 1,
      booksBytes: 1,
    });
    const tooBig = await req('/api/device/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: huge,
      device: true,
    });
    check('snapshot > 256KB → 400', tooBig.res.status === 400, `status=${tooBig.res.status} body=${tooBig.text.slice(0, 120)}`);
    check('超大快照没有覆盖旧快照', savedDevice()?.snapshot?.books?.length === 2, String(savedDevice()?.snapshot?.books?.length));
  }

  /* ---------------- 5. 过期指令 ---------------- */
  process.stdout.write('\n--- 5. 过期指令 ---\n');
  {
    const expired = deviceStore.enqueue({ deviceId: DEVICE_ID, type: 'remove-book', payload: { hash: hashOf(4), title: '过期书', unique: false } });
    clock += 8 * 86_400_000;
    const expiredReceipt = await req(`/api/device/commands/${encodeURIComponent(expired.command.id)}/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
      device: true,
    });
    check('过期指令回执 → 404', expiredReceipt.res.status === 404, `status=${expiredReceipt.res.status} body=${expiredReceipt.text.slice(0, 120)}`);
    const claimed = await req('/api/device/commands', { device: true });
    check('过期后 claim 拿不到', claimed.res.status === 200 && claimed.json?.commands?.length === 0, `status=${claimed.res.status} body=${claimed.text.slice(0, 120)}`);
    check('过期指令进 history(expired)', savedDevice()?.history?.some((h) => h.state === 'expired') === true, JSON.stringify(savedDevice()?.history?.map((h) => h.state)));
  }

  /* ---------------- 6. SSE 在线翻转 ---------------- */
  process.stdout.write('\n--- 6. SSE 0→1 / 1→0 ---\n');
  {
    const observer = await openSse(null);
    // 先确认观察者本身连上了
    await observer.next('hello');
    const phone = await openSse(DEVICE_ID);
    const online = await observer.next('device');
    check('SSE 打开 → device online:true', online?.id === DEVICE_ID && online?.online === true, JSON.stringify(online));
    check('onDeviceChanged 收到 true', deviceEvents.some((e) => e.id === DEVICE_ID && e.online === true), JSON.stringify(deviceEvents));

    phone.close();
    const offline = await observer.next('device');
    check('SSE 关闭 → device online:false', offline?.id === DEVICE_ID && offline?.online === false, JSON.stringify(offline));
    check('onDeviceChanged 收到 false', deviceEvents.some((e) => e.id === DEVICE_ID && e.online === false), JSON.stringify(deviceEvents));
    const listed = deviceStore.list().find((item) => item.id === DEVICE_ID);
    check('SSE 关闭后 list() 也立即 offline', listed?.online === false, JSON.stringify({ online: listed?.online }));

    observer.close();
    const after = await req('/api/device/heartbeat', { method: 'POST', device: true });
    check('SSE 关闭后心跳仍可用', after.res.status === 200, `status=${after.res.status}`);
    check('心跳后 list() 恢复 online', deviceStore.list().find((item) => item.id === DEVICE_ID)?.online === true, '');
    check('全程只建了 1 台设备', readDevices().length === 1, `devices=${readDevices().length}`);
  }
} finally {
  try {
    await service.stop();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows 文件占用时留给系统清理 */
  }
}

process.stdout.write(`\n=== 汇总：${passed + failures.length} 项，通过 ${passed}，失败 ${failures.length} ===\n`);
if (failures.length) {
  process.stdout.write('\n失败明细：\n');
  for (const item of failures) process.stdout.write(` - ${item}\n`);
}
process.exit(failures.length ? 1 : 0);
