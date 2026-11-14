/**
 * T01 自查：设备存储与指令队列内核（electron/devicestore.js）。
 *
 * 全部断言都基于**重新从磁盘读取的 devices.json**，不信任内存返回值；
 * 同时显式断言 `online` / SSE 计数从未被写进文件。
 *
 * 用法：node tools/_device-check.mjs
 * 退出码：0 = 全绿；1 = 有失败项。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDeviceStore,
  MAX_DEVICES,
  COMMAND_TTL_MS,
  DELIVERED_TIMEOUT_MS,
  LOST_AFTER_MS,
  HISTORY_LIMIT,
} from '../electron/devicestore.js';

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

function throwsCode(fn, code) {
  try {
    fn();
    return false;
  } catch (err) {
    return err?.code === code;
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-device-'));
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
const now = () => clock;
const advance = (ms) => {
  clock += ms;
};

function newStore(name = 'devices') {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'devices.json');
  return { dir, file, store: createDeviceStore({ dataDir: dir, readJson, writeJson, now }) };
}

const raw = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const deviceById = (file, id) => (raw(file).devices || []).find((item) => item.id === id) || null;
const hashOf = (seed) => seed.toString(16).padStart(40, '0').slice(-40);

process.stdout.write('\n=== T01 devicestore 状态机 ===\n\n');

/* ------------------------------------------------------------------ */
/* 1. 建档 / 重复 upsert / 改名                                          */
/* ------------------------------------------------------------------ */
process.stdout.write('--- 1. 建档与 upsert ---\n');
const a = newStore('main');
const { store, file } = a;

{
  const seen = store.upsertSeen({
    id: 'dev-a',
    name: 'Pixel 8',
    platform: 'android',
    appVersion: '3.1.0',
    apiVersion: 2,
    ip: '192.168.1.23',
  });
  const saved = raw(file);
  check('首次 upsert 建档 1 台', saved.devices.length === 1, `devices=${saved.devices.length}`);
  check('firstSeenAt 写入', saved.devices[0].firstSeenAt === clock, String(saved.devices[0].firstSeenAt));
  check('lastSeenAt 写入', saved.devices[0].lastSeenAt === clock, String(saved.devices[0].lastSeenAt));
  check('在线派生值返回 true', seen.online === true, String(seen.online));
  check('文件里没有 online 字段', !("online" in saved.devices[0]), JSON.stringify(Object.keys(saved.devices[0])));
}

{
  advance(5_000);
  const before = raw(file).devices[0].firstSeenAt;
  const seen = store.upsertSeen({ id: 'dev-a', name: 'Pixel 8', appVersion: '3.1.1', apiVersion: 2, ip: '192.168.1.99' });
  const saved = raw(file);
  check('重复 upsert 不新增记录', saved.devices.length === 1, `devices=${saved.devices.length}`);
  check('firstSeenAt 只写一次', saved.devices[0].firstSeenAt === before, `${saved.devices[0].firstSeenAt} vs ${before}`);
  check('lastSeenAt 每次刷新', saved.devices[0].lastSeenAt === clock, String(saved.devices[0].lastSeenAt));
  check('lastIp 跟随上报更新', saved.devices[0].lastIp === '192.168.1.99', saved.devices[0].lastIp);
  check('appVersion 跟随上报更新', saved.devices[0].appVersion === '3.1.1', saved.devices[0].appVersion);
  check('upsert 返回视图', seen.id === 'dev-a' && seen.lastSeenAt === clock, JSON.stringify(seen).slice(0, 120));
}

{
  store.rename('dev-a', '我的手机');
  const saved = deviceById(file, 'dev-a');
  check('rename 落盘', saved.name === '我的手机', saved.name);
  advance(1_000);
  store.upsertSeen({ id: 'dev-a', name: 'Pixel 8' });
  check('手机上报不会覆盖桌面端改过的名字', deviceById(file, 'dev-a').name === '我的手机', deviceById(file, 'dev-a').name);
}

/* ------------------------------------------------------------------ */
/* 2. online 派生 / SSE 计数不落盘                                       */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 2. online 派生与 SSE 计数 ---\n');
{
  // 显式断开优先于 90s 弱在线窗口：心跳后 1s 就关掉 SSE，列表必须立刻离线。
  advance(1_000);
  store.upsertSeen({ id: 'dev-a', name: 'Pixel 8' });
  store.noteSseOpen('dev-a');
  store.noteSseClose('dev-a');
  const justClosed = store.list().find((item) => item.id === 'dev-a');
  check(
    'SSE 关闭后 list 立刻 offline（距 lastSeenAt 仅 1s）',
    justClosed?.online === false,
    JSON.stringify({ online: justClosed?.online, lastSeenAt: justClosed?.lastSeenAt }),
  );
  advance(1_000);
  store.upsertSeen({ id: 'dev-a', name: 'Pixel 8' });
  const back = store.list().find((item) => item.id === 'dev-a');
  check('随后一次心跳 → list 恢复 online', back?.online === true, JSON.stringify({ online: back?.online }));

  advance(90_000);
  check('lastSeenAt 恰好 90s → 仍在线', store.onlineOf('dev-a') === true, String(store.onlineOf('dev-a')));
  advance(1);
  check('lastSeenAt 超过 90s → 离线', store.onlineOf('dev-a') === false, String(store.onlineOf('dev-a')));
  store.noteSseOpen('dev-a');
  check('SSE 计数 1 → 在线', store.onlineOf('dev-a') === true, String(store.onlineOf('dev-a')));
  store.noteSseOpen('dev-a');
  check('重复打开计数累加到 2', store.deviceSseCount('dev-a') === 2, String(store.deviceSseCount('dev-a')));
  store.noteSseClose('dev-a');
  check('关一条仍在线', store.onlineOf('dev-a') === true, String(store.onlineOf('dev-a')));
  store.noteSseClose('dev-a');
  check('全部关闭且超窗口 → 离线', store.onlineOf('dev-a') === false, String(store.onlineOf('dev-a')));
  store.noteSseClose('dev-a');
  check('多余 close 不会把计数压成负数', store.deviceSseCount('dev-a') === 0, String(store.deviceSseCount('dev-a')));

  const text = fs.readFileSync(file, 'utf8');
  check('devices.json 不含 online 字段', !/"online"\s*:/.test(text), text.match(/"online"[^,]*/)?.[0] || '');
  check('devices.json 不含 sseCount/deviceSseCount', !/sseCount/i.test(text), '');
}

/* ------------------------------------------------------------------ */
/* 3. 指令入队 / 去重 / 校验                                             */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 3. enqueue 与去重 ---\n');
let cmdA;
let cmdB;
{
  const result = store.enqueue({
    deviceId: 'dev-a',
    type: 'push-book',
    payload: { hash: hashOf(1), title: '第一本', size: 100 },
  });
  cmdA = result.command;
  const saved = deviceById(file, 'dev-a');
  check('入队落盘 1 条 pending', saved.commands.length === 1 && saved.commands[0].state === 'pending', JSON.stringify(saved.commands).slice(0, 160));
  check('expiresAt = createdAt + 7d', cmdA.expiresAt - cmdA.createdAt === COMMAND_TTL_MS, `${cmdA.expiresAt - cmdA.createdAt}`);
  check('首次入队 duplicate=false', result.duplicate === false, String(result.duplicate));
}
{
  advance(10_000);
  const again = store.enqueue({
    deviceId: 'dev-a',
    type: 'push-book',
    payload: { hash: hashOf(1), title: '第一本（改名）', size: 100 },
  });
  const saved = deviceById(file, 'dev-a');
  check('同 type+hash 去重，不新增', saved.commands.length === 1, `commands=${saved.commands.length}`);
  check('去重返回 duplicate=true', again.duplicate === true, String(again.duplicate));
  check('去重刷新 createdAt/expiresAt', again.command.createdAt === clock && again.command.expiresAt === clock + COMMAND_TTL_MS, JSON.stringify(again.command));
  check('去重刷新 payload', again.command.payload.title === '第一本（改名）', again.command.payload.title);
}
{
  const second = store.enqueue({
    deviceId: 'dev-a',
    type: 'remove-book',
    payload: { hash: hashOf(2), title: '第二本', unique: true },
  });
  cmdB = second.command;
  check('不同 hash 新增第 2 条', deviceById(file, 'dev-a').commands.length === 2, String(deviceById(file, 'dev-a').commands.length));
}
{
  check(
    '非法 hash → bad_hash',
    throwsCode(() => store.enqueue({ deviceId: 'dev-a', type: 'push-book', payload: { hash: 'zzz', title: 'x' } }), 'bad_hash'),
  );
  check(
    '未知 type → bad_type',
    throwsCode(() => store.enqueue({ deviceId: 'dev-a', type: 'nope', payload: { hash: hashOf(3) } }), 'bad_type'),
  );
  check(
    'payload > 4KB → bad_payload',
    throwsCode(
      () => store.enqueue({ deviceId: 'dev-a', type: 'push-book', payload: { hash: hashOf(4), title: 'x'.repeat(5000) } }),
      'bad_payload',
    ),
  );
  check(
    '不存在的设备入队 → not_found',
    throwsCode(() => store.enqueue({ deviceId: 'nobody', type: 'push-book', payload: { hash: hashOf(5) } }), 'not_found'),
  );
}

/* ------------------------------------------------------------------ */
/* 4. claim / receipt                                                   */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 4. claim 与 receipt ---\n');
{
  const claimed = store.claim('dev-a');
  const saved = deviceById(file, 'dev-a');
  check('claim 返回 2 条', claimed.length === 2, `len=${claimed.length}`);
  check('claim 按 createdAt 升序', claimed[0].createdAt <= claimed[1].createdAt, `${claimed.map((c) => c.createdAt).join(',')}`);
  check('claim 后文件里全是 delivered', saved.commands.every((c) => c.state === 'delivered'), saved.commands.map((c) => c.state).join(','));
  check('deliveredAt 写入', saved.commands.every((c) => c.deliveredAt === clock), '');
  check('claim 响应只含协议字段', claimed.every((c) => c.state === undefined), JSON.stringify(Object.keys(claimed[0])));
  check('重复 claim 拿不到（已 delivered）', store.claim('dev-a').length === 0, '');
}
{
  const done = store.receipt('dev-a', cmdA.id, { state: 'done', detail: { size: 100 } });
  const saved = deviceById(file, 'dev-a');
  check('receipt done 返回 state', done.ok === true && done.state === 'done', JSON.stringify(done));
  check('done 后从 commands 移除', saved.commands.length === 1 && saved.commands[0].id === cmdB.id, `commands=${saved.commands.length}`);
  check('done 进入 history', saved.history.length === 1 && saved.history[0].state === 'done', JSON.stringify(saved.history.map((h) => h.state)));
  check('history 记录 finishedAt', saved.history[0].finishedAt === clock, String(saved.history[0].finishedAt));
}
{
  const failed = store.receipt('dev-a', cmdB.id, {
    state: 'failed',
    error: 'insufficient_space',
    detail: { needBytes: 1024 },
  });
  const saved = deviceById(file, 'dev-a');
  check('receipt failed 正确', failed.state === 'failed', JSON.stringify(failed));
  check('failed 进入 history 且带 error', saved.history.length === 2 && saved.history[1].error === 'insufficient_space', JSON.stringify(saved.history.map((h) => h.error)));
  check('commands 清空', saved.commands.length === 0, `commands=${saved.commands.length}`);
  check(
    '非法 state → bad_state',
    throwsCode(() => store.receipt('dev-a', cmdA.id, { state: 'cancelled' }), 'bad_state'),
  );
  check(
    '不存在的指令回执 → not_found',
    throwsCode(() => store.receipt('dev-a', 'cmd_missing', { state: 'done' }), 'not_found'),
  );
}

/* ------------------------------------------------------------------ */
/* 5. 过期清扫                                                          */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 5. 过期清扫 ---\n');
{
  const late = store.enqueue({ deviceId: 'dev-a', type: 'pull-book', payload: { hash: hashOf(6), title: '过期书' } });
  advance(COMMAND_TTL_MS + 1);
  check(
    '过期指令回执 → not_found',
    throwsCode(() => store.receipt('dev-a', late.command.id, { state: 'done' }), 'not_found'),
  );
  const claimed = store.claim('dev-a');
  const saved = deviceById(file, 'dev-a');
  check('过期指令 claim 拿不到', claimed.length === 0, `len=${claimed.length}`);
  check('过期指令移入 history(expired)', saved.commands.length === 0 && saved.history.some((h) => h.id === late.command.id && h.state === 'expired'), JSON.stringify(saved.history.slice(-1)));
}

/* ------------------------------------------------------------------ */
/* 6. delivered 卡死恢复（1h）                                          */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 6. delivered 超 1h 恢复 ---\n');
{
  const stuck = store.enqueue({ deviceId: 'dev-a', type: 'push-book', payload: { hash: hashOf(7), title: '卡死书' } });
  store.claim('dev-a');
  check('领取后状态 delivered', deviceById(file, 'dev-a').commands[0].state === 'delivered', '');
  advance(DELIVERED_TIMEOUT_MS + 1);
  store.sweep('dev-a');
  const saved = deviceById(file, 'dev-a');
  check('超过 1h 回 pending', saved.commands[0].state === 'pending', saved.commands[0].state);
  check('恢复时刷新 createdAt/expiresAt', saved.commands[0].createdAt === clock && saved.commands[0].expiresAt === clock + COMMAND_TTL_MS, JSON.stringify(saved.commands[0]));
  check('恢复后可以再次 claim', store.claim('dev-a').length === 1, '');
  check('原 id 不变', saved.commands[0].id === stuck.command.id, '');
  // 收尾：done 掉，避免影响后面的 history 计数
  store.receipt('dev-a', stuck.command.id, { state: 'done' });
}

/* ------------------------------------------------------------------ */
/* 7. retry / cancel / clear                                            */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 7. retry / cancel / clear ---\n');
{
  const failed = deviceById(file, 'dev-a').history.find((h) => h.state === 'failed');
  advance(1_000);
  const retried = store.retry('dev-a', failed.id);
  const saved = deviceById(file, 'dev-a');
  check('retry 把 failed 指令放回 pending', retried.command.state === 'pending', retried.command.state);
  check('retry 刷新 createdAt', retried.command.createdAt === clock, String(retried.command.createdAt));
  check('retry 后 history 里不再有该条', !saved.history.some((h) => h.id === failed.id), JSON.stringify(saved.history.map((h) => h.id)));
  check('retry 后 commands 里有该条', saved.commands.some((c) => c.id === failed.id), '');
}
{
  const target = deviceById(file, 'dev-a').commands[0];
  const res = store.cancel('dev-a', target.id);
  const saved = deviceById(file, 'dev-a');
  check('cancel 返回 ok', res.ok === true, JSON.stringify(res));
  check('cancel 后移入 history(cancelled)', !saved.commands.some((c) => c.id === target.id) && saved.history.some((h) => h.id === target.id && h.state === 'cancelled'), '');
  check(
    '取消不存在的指令 → not_found',
    throwsCode(() => store.cancel('dev-a', 'cmd_missing'), 'not_found'),
  );
}
{
  store.enqueue({ deviceId: 'dev-a', type: 'push-book', payload: { hash: hashOf(8), title: '清空1' } });
  store.enqueue({ deviceId: 'dev-a', type: 'remove-book', payload: { hash: hashOf(9), title: '清空2' } });
  const before = deviceById(file, 'dev-a').commands.length;
  const res = store.clear('dev-a');
  const saved = deviceById(file, 'dev-a');
  check('clear 清空 commands', saved.commands.length === 0, `before=${before} after=${saved.commands.length}`);
  check('clear 全部转 history(cancelled)', res.cleared === before && saved.history.filter((h) => h.state === 'cancelled').length >= before, JSON.stringify(res));
}

/* ------------------------------------------------------------------ */
/* 8. history 裁到 50                                                   */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 8. history 裁剪 ---\n');
{
  const before = deviceById(file, 'dev-a').history.length;
  const need = Math.max(0, HISTORY_LIMIT + 5 - before);
  for (let i = 0; i < need; i += 1) {
    const item = store.enqueue({
      deviceId: 'dev-a',
      type: 'push-book',
      payload: { hash: hashOf(1000 + i), title: `裁 ${i}` },
    });
    store.claim('dev-a');
    store.receipt('dev-a', item.command.id, { state: 'done' });
  }
  const saved = deviceById(file, 'dev-a');
  check(`history 裁到 ${HISTORY_LIMIT} 条`, saved.history.length === HISTORY_LIMIT, `history=${saved.history.length}`);
  const last = saved.history[saved.history.length - 1];
  check('裁掉的是最旧记录（最新一条仍在）', last?.state === 'done' && String(last?.payload?.title || '').startsWith('裁 '), JSON.stringify(last).slice(0, 160));
}

/* ------------------------------------------------------------------ */
/* 9. 快照与 30s 节流                                                   */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 9. 快照落盘与节流 ---\n');
{
  const first = store.setSnapshot('dev-a', {
    books: [{ hash: hashOf(1), title: '第一本', size: 100, hasLocalFile: true, leakPath: '/sdcard/x' }],
    storageTotal: 128_000_000_000,
    storageFree: 64_000_000_000,
    booksBytes: 100,
  });
  const saved = deviceById(file, 'dev-a');
  check('快照首次 accepted（未节流）', first.throttled === false, JSON.stringify(first));
  check('快照 books 落盘', Array.isArray(saved.snapshot?.books) && saved.snapshot.books.length === 1, JSON.stringify(saved.snapshot));
  check('快照不含手机本地路径', !("leakPath" in (saved.snapshot?.books?.[0] || {})), JSON.stringify(saved.snapshot?.books?.[0]));
  check('snapshotAt 写入', saved.snapshot.snapshotAt === clock, String(saved.snapshot.snapshotAt));

  advance(10_000);
  const second = store.setSnapshot('dev-a', { books: [{ hash: hashOf(2), title: '新书', size: 1 }], storageFree: 1 });
  const saved2 = deviceById(file, 'dev-a');
  check('30s 内第二次快照被节流', second.throttled === true && second.snapshotAt === saved.snapshot.snapshotAt, JSON.stringify(second));
  check('节流时快照内容不被覆盖', saved2.snapshot.books[0].title === '第一本', saved2.snapshot.books[0].title);
  check('节流时 lastSeenAt 仍刷新', saved2.lastSeenAt === clock, String(saved2.lastSeenAt));

  advance(30_000);
  const third = store.setSnapshot('dev-a', { books: [{ hash: hashOf(2), title: '新书', size: 1 }] });
  check('超过 30s 后快照恢复写入', third.throttled === false && deviceById(file, 'dev-a').snapshot.books[0].title === '新书', JSON.stringify(third));
}

/* ------------------------------------------------------------------ */
/* 10. 上限 5 台 / 淘汰 / 同名 lost                                     */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 10. 设备上限、淘汰与 lost ---\n');
const b = newStore('limit');
{
  // 5 台，lastSeenAt 依次递增
  for (let i = 0; i < MAX_DEVICES; i += 1) {
    b.store.upsertSeen({ id: `old-${i}`, name: `旧机 ${i}`, platform: 'android', apiVersion: 2 });
    advance(1_000);
  }
  check('先建满 5 台', raw(b.file).devices.length === MAX_DEVICES, String(raw(b.file).devices.length));

  // 先把其余设备推出 90s 弱在线窗口，再让 old-0 靠 SSE 保持在线 —— 淘汰时应跳过它
  advance(91_000);
  b.store.noteSseOpen('old-0');
  const sixth = b.store.upsertSeen({ id: 'new-6', name: '第六台', platform: 'android', apiVersion: 2 });
  const saved = raw(b.file);
  check('新增第 6 台后仍为 5 条', saved.devices.length === MAX_DEVICES, `devices=${saved.devices.length}`);
  check('淘汰的是最旧的非在线设备（old-1）', !saved.devices.some((d) => d.id === 'old-1'), saved.devices.map((d) => d.id).join(','));
  check('在线的 old-0 被保留', saved.devices.some((d) => d.id === 'old-0'), '');
  check('新设备已建档', saved.devices.some((d) => d.id === 'new-6') && sixth.id === 'new-6', '');
  b.store.noteSseClose('old-0');
}
{
  // 同名不同 id：旧记录标 lost 而不是删
  const before = raw(b.file).devices.length;
  b.store.upsertSeen({ id: 'reinstall-6', name: '第六台', platform: 'android', apiVersion: 2 });
  const saved = raw(b.file);
  const old = saved.devices.find((d) => d.id === 'new-6');
  check('同名新 id 产生新记录', saved.devices.some((d) => d.id === 'reinstall-6'), '');
  check('同名旧记录未被删除', Boolean(old), saved.devices.map((d) => d.id).join(','));
  check('同名旧记录落盘 lost:true', old?.lost === true, JSON.stringify(old));
  check('设备总数仍不超上限', saved.devices.length <= MAX_DEVICES, `devices=${saved.devices.length} before=${before}`);
}
{
  // 30 天未见 → 读时派生 lost，但 derived 值不落盘
  advance(LOST_AFTER_MS + 1);
  const list = b.store.list();
  const target = list.find((item) => item.id === 'reinstall-6');
  check('30 天未见 → list 派生 lost=true', target?.lost === true, JSON.stringify(target && { lost: target.lost, online: target.online }));
  const stored = deviceById(b.file, 'reinstall-6');
  check('派生 lost 没有写回文件', stored?.lost !== true, JSON.stringify(stored?.lost));
}

/* ------------------------------------------------------------------ */
/* 11. rename / remove                                                  */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 11. rename / remove ---\n');
{
  b.store.rename('reinstall-6', '客厅手机');
  check('rename 落盘', deviceById(b.file, 'reinstall-6').name === '客厅手机', deviceById(b.file, 'reinstall-6').name);
  b.store.remove('reinstall-6');
  check('remove 真的删掉记录', !deviceById(b.file, 'reinstall-6'), '');
}

/* ------------------------------------------------------------------ */
/* 12. 全文件扫描：派生值绝不落盘                                        */
/* ------------------------------------------------------------------ */
process.stdout.write('\n--- 12. 派生值落盘扫描 ---\n');
{
  for (const target of [file, b.file]) {
    const text = fs.readFileSync(target, 'utf8');
    check(`${path.basename(path.dirname(target))}/devices.json 无 online`, !/"online"\s*:/.test(text), '');
    check(`${path.basename(path.dirname(target))}/devices.json 无 SSE 计数`, !/sseCount/i.test(text), '');
    check(`${path.basename(path.dirname(target))}/devices.json 无 offlineAt`, !/offlineAt/i.test(text), '');
  }
}

/* ---------------- 汇总 ---------------- */

try {
  fs.rmSync(root, { recursive: true, force: true });
} catch {
  /* Windows 上文件可能还被占用，临时目录下次会换新的 */
}

process.stdout.write(`\n=== 汇总：${passed + failures.length} 项，通过 ${passed}，失败 ${failures.length} ===\n`);
if (failures.length) {
  process.stdout.write('\n失败明细：\n');
  for (const item of failures) process.stdout.write(` - ${item}\n`);
}
process.exit(failures.length ? 1 : 0);
