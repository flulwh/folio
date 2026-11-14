/**
 * 设备记录与指令队列内核（桌面端 2.7.0 / 架构文档 `docs/arch-device-manager.md` §1.2、§2、§5）。
 *
 * 只做数据：devices.json 的读写、设备建档/上限/lost、指令 enqueue/去重/领取/回执/清扫。
 * HTTP 状态码由 `lan.js` 决定；这里用带 `code` 的异常把语义交出去：
 *   bad_device / bad_type / bad_payload / bad_hash / bad_state / bad_name
 *   not_found / write_failed
 *
 * 两条硬约束：
 *  1. `online` 与 SSE 计数是纯内存态，**绝不落盘**（§1.2「落盘裁剪」）。
 *  2. `lost` 的 30 天判定是读时派生，不写回文件；只有「同名不同 id → 标 lost」
 *     是显式标记，会落盘 true（文档要求「不删」）。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/** 设备记录上限。 */
export const MAX_DEVICES = 5;

/** 在线弱信号窗口：90s 内有带设备头的认证请求就算在线。 */
export const ONLINE_WINDOW_MS = 90_000;

/** 指令寿命 7 天。 */
export const COMMAND_TTL_MS = 7 * 86_400_000;

/** delivered 超过 1 小时无回执 → 回 pending 幂等重执行（§9 第 2 条）。 */
export const DELIVERED_TIMEOUT_MS = 3_600_000;

/** 「已失联」判定：30 天未出现。 */
export const LOST_AFTER_MS = 30 * 86_400_000;

/** 快照节流：30s 内重复上报只刷 lastSeenAt。 */
export const SNAPSHOT_THROTTLE_MS = 30_000;

/** 最近 50 条执行记录。 */
export const HISTORY_LIMIT = 50;

/** 指令 payload 序列化上限 4KB。 */
export const PAYLOAD_LIMIT = 4096;

const COMMAND_TYPES = new Set(['push-book', 'remove-book', 'pull-book']);
const HASH_RE = /^[0-9a-f]{40}$/i;

/** 抛一个带 code 的异常，供 lan.js 映射成 HTTP 状态码。 */
function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * @param {object} opts
 * @param {string} opts.dataDir 数据目录（devices.json 落这里）
 * @param {(file:string, fallback:any)=>any} [opts.readJson]
 * @param {(file:string, data:any)=>any} [opts.writeJson]
 * @param {()=>number} [opts.now]
 */
export function createDeviceStore({ dataDir, readJson, writeJson, now } = {}) {
  if (!dataDir) throw new Error('createDeviceStore 需要 dataDir');
  const file = path.join(dataDir, 'devices.json');
  const read = readJson || ((target, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      return fallback;
    }
  });
  const write = writeJson || ((target, data) => {
    fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  });
  const clock = typeof now === 'function' ? now : () => Date.now();

  /** 当前时间；测试注入的 now 若是坏值就退回 Date.now，避免整份文件被 NaN 污染。 */
  function at() {
    const value = Number(clock());
    return Number.isFinite(value) ? value : Date.now();
  }

  /** 每个设备当前打开的 SSE 连接数。只在内存里，重启即归零。 */
  const sseCounts = new Map();

  /**
   * 最近一次「SSE 显式断开」的时间。也只在内存里。
   *
   * 手机只在前台开 SSE，最后一根断开等价于 App 已经不在前台；如果这时还让 90s
   * 弱在线窗口把 online 报成 true，设备页就会对着锁屏手机显示「在线」，用户发的
   * 指令要等到下次打开 App 才可能执行 —— 这是 PRD §6 明确禁止的误导。
   * 下一次 upsertSeen（心跳/任意认证请求）说明 App 还活着，标记随之清除。
   */
  const offlineAt = new Map();

  function sseCount(id) {
    return sseCounts.get(String(id)) || 0;
  }

  /* ---------------- 读写 ---------------- */

  function load() {
    let raw;
    try {
      raw = read(file, { devices: [] });
    } catch {
      raw = { devices: [] };
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.devices)) return { devices: [] };
    // 防御旧文件/手改文件：只保留结构上还能用的记录，字段该补的补。
    const devices = raw.devices
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && item.id)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name || '未命名手机'),
        platform: String(item.platform || 'android'),
        appVersion: String(item.appVersion || ''),
        apiVersion: Number(item.apiVersion) || 0,
        firstSeenAt: Number(item.firstSeenAt) || 0,
        lastSeenAt: Number(item.lastSeenAt) || 0,
        lastIp: String(item.lastIp || ''),
        ...(item.lost === true ? { lost: true } : {}),
        snapshot: item.snapshot && typeof item.snapshot === 'object' ? item.snapshot : null,
        commands: Array.isArray(item.commands) ? item.commands.filter((c) => c && typeof c === 'object') : [],
        history: Array.isArray(item.history) ? item.history.filter((c) => c && typeof c === 'object') : [],
      }));
    return { devices };
  }

  function save(state) {
    // 落盘前剔除所有运行时派生值：online / SSE 计数绝不能进文件。
    const payload = {
      devices: state.devices.map((item) => {
        const copy = clone(item);
        delete copy.online;
        delete copy.sseCount;
        delete copy.deviceSseCount;
        return copy;
      }),
    };
    const result = write(file, payload);
    if (result && result.ok === false) fail('write_failed', result.error || 'devices.json 写入失败');
  }

  function recById(state, id) {
    const key = String(id || '');
    return state.devices.find((item) => item.id === key) || null;
  }

  function onlineIn(rec, ts) {
    if (!rec) return false;
    if (sseCount(rec.id) > 0) return true;
    // 显式断开优先于 90s 弱在线窗口；窗口过期后标记自然失效。
    const dropped = offlineAt.get(rec.id);
    if (dropped != null && ts - dropped <= ONLINE_WINDOW_MS) return false;
    return ts - Number(rec.lastSeenAt || 0) <= ONLINE_WINDOW_MS;
  }

  function publicCommand(command) {
    const out = {
      id: command.id,
      type: command.type,
      payload: clone(command.payload || {}),
      createdAt: command.createdAt,
      expiresAt: command.expiresAt,
      state: command.state,
    };
    if (command.batchId) out.batchId = command.batchId;
    if (command.deliveredAt) out.deliveredAt = command.deliveredAt;
    if (command.finishedAt) out.finishedAt = command.finishedAt;
    if (command.error) out.error = command.error;
    return out;
  }

  /** 对外视图：补 online / lost 派生值，顺手深拷贝避免调用方改到内部结构。 */
  function view(rec, ts) {
    if (!rec) return null;
    const online = onlineIn(rec, ts);
    const lost = rec.lost === true || (!online && ts - Number(rec.lastSeenAt || 0) > LOST_AFTER_MS);
    return {
      id: rec.id,
      name: rec.name,
      platform: rec.platform,
      appVersion: rec.appVersion,
      apiVersion: rec.apiVersion,
      firstSeenAt: rec.firstSeenAt,
      lastSeenAt: rec.lastSeenAt,
      lastIp: rec.lastIp,
      online,
      lost,
      snapshot: clone(rec.snapshot),
      commands: rec.commands.map(publicCommand),
      history: rec.history.map(publicCommand),
      // 设备页的「待执行 N 项」= 未完结指令（pending + 已领取未回执的 delivered）。
      pending: rec.commands.length,
    };
  }

  /* ---------------- 清扫（过期 + 卡死恢复） ---------------- */

  function trimHistory(rec) {
    if (rec.history.length > HISTORY_LIMIT) rec.history.splice(0, rec.history.length - HISTORY_LIMIT);
  }

  function pushHistory(rec, command, state, ts, extra = {}) {
    const entry = {
      ...clone(command),
      state,
      finishedAt: ts,
      ...extra,
    };
    delete entry.deliveredAt;
    rec.history.push(entry);
    trimHistory(rec);
  }

  /**
   * 对一个设备做懒清扫。返回是否改动过（决定要不要落盘）。
   * 顺序：先把过期的 pending 移入 history，再把卡死的 delivered 退回 pending。
   */
  function sweepRecord(rec, ts) {
    let changed = false;
    const keep = [];
    for (const command of rec.commands) {
      if (command.state === 'pending' && ts > Number(command.expiresAt || 0)) {
        pushHistory(rec, command, 'expired', ts);
        changed = true;
        continue;
      }
      if (command.state === 'delivered' && ts - Number(command.deliveredAt || 0) > DELIVERED_TIMEOUT_MS) {
        command.state = 'pending';
        command.createdAt = ts;
        command.expiresAt = ts + COMMAND_TTL_MS;
        delete command.deliveredAt;
        changed = true;
      }
      keep.push(command);
    }
    if (changed) rec.commands = keep;
    return changed;
  }

  function sweep(deviceId) {
    const state = load();
    const ts = at();
    let changed = false;
    const targets = deviceId ? state.devices.filter((item) => item.id === String(deviceId)) : state.devices;
    for (const rec of targets) {
      if (sweepRecord(rec, ts)) changed = true;
    }
    if (changed) save(state);
    return { ok: true, changed };
  }

  /* ---------------- 设备 ---------------- */

  /**
   * 任何带设备头的认证请求都会调它：没有记录就建档，有就只刷 lastSeenAt。
   * `firstSeenAt` 只写一次；桌面端改名后再收到手机上报，不会被手机名覆盖。
   */
  function upsertSeen(input = {}) {
    const id = String(input.id || '').trim();
    if (!id) fail('bad_device', '缺少设备 id');
    // 手机又发请求了：之前「SSE 已断开」的离线标记作废，在线态回到正常派生。
    offlineAt.delete(id);
    const ts = at();
    const state = load();
    let rec = recById(state, id);
    const incomingName = String(input.name || '').trim().slice(0, 80);

    if (!rec) {
      // 重装产生新 installId、但名字没变：旧记录标「已失联」而不是删掉。
      if (incomingName) {
        for (const other of state.devices) {
          if (other.id !== id && other.name === incomingName) other.lost = true;
        }
      }
      if (state.devices.length >= MAX_DEVICES) evictOne(state, ts);
      rec = {
        id,
        name: incomingName || '未命名手机',
        platform: String(input.platform || 'android').slice(0, 32),
        appVersion: String(input.appVersion || '').slice(0, 32),
        apiVersion: Number(input.apiVersion) || 0,
        firstSeenAt: ts,
        lastSeenAt: ts,
        lastIp: String(input.ip || '').slice(0, 64),
        snapshot: null,
        commands: [],
        history: [],
      };
      state.devices.push(rec);
    } else {
      rec.lastSeenAt = ts;
      // 只在还没有名字时补；桌面端改过的名字优先。
      if (incomingName && (!rec.name || rec.name === '未命名手机')) rec.name = incomingName;
      if (input.platform) rec.platform = String(input.platform).slice(0, 32);
      if (input.appVersion) rec.appVersion = String(input.appVersion).slice(0, 32);
      if (input.apiVersion !== undefined && Number.isFinite(Number(input.apiVersion))) {
        rec.apiVersion = Number(input.apiVersion);
      }
      if (input.ip) rec.lastIp = String(input.ip).slice(0, 64);
      // 同一台设备回来了：之前因同名冲突标过的 lost 自动清除。
      if (rec.lost === true) delete rec.lost;
    }

    save(state);
    return view(rec, ts);
  }

  /** 超过 5 台时淘汰最旧的非在线设备；全在线（极端）才退而淘汰最旧的那台。 */
  function evictOne(state, ts) {
    if (!state.devices.length) return null;
    const offline = state.devices.filter((item) => !onlineIn(item, ts));
    const pool = offline.length ? offline : state.devices;
    let victim = pool[0];
    for (const item of pool) {
      if (Number(item.lastSeenAt || 0) < Number(victim.lastSeenAt || 0)) victim = item;
    }
    state.devices = state.devices.filter((item) => item !== victim);
    sseCounts.delete(victim.id);
    offlineAt.delete(victim.id);
    return victim;
  }

  function onlineOf(id) {
    const rec = recById(load(), id);
    return onlineIn(rec, at());
  }

  /** SSE 打开：计数 +1。返回新的计数。 */
  function noteSseOpen(id) {
    const key = String(id || '');
    if (!key) return 0;
    const next = sseCount(key) + 1;
    sseCounts.set(key, next);
    return next;
  }

  /** SSE 关闭：计数 -1（不小于 0），返回新的计数。 */
  function noteSseClose(id) {
    const key = String(id || '');
    if (!key) return 0;
    const next = Math.max(0, sseCount(key) - 1);
    if (next) sseCounts.set(key, next);
    else {
      sseCounts.delete(key);
      // 最后一根连接断了：记下显式离线的时刻，覆盖 90s 弱在线窗口。
      offlineAt.set(key, at());
    }
    return next;
  }

  function rename(id, name) {
    const value = String(name || '').trim().slice(0, 80);
    if (!value) fail('bad_name', '设备名不能为空');
    const state = load();
    const rec = recById(state, id);
    if (!rec) fail('not_found', '设备不存在');
    rec.name = value;
    // 用户手动改过名字：之后手机名不再覆盖它（upsertSeen 只在空名时补）。
    save(state);
    return view(rec, at());
  }

  function remove(id) {
    const state = load();
    const key = String(id || '');
    const next = state.devices.filter((item) => item.id !== key);
    if (next.length === state.devices.length) fail('not_found', '设备不存在');
    state.devices = next;
    sseCounts.delete(key);
    offlineAt.delete(key);
    save(state);
    return { ok: true };
  }

  /**
   * 快照：30s 内重复上报只刷新 lastSeenAt（快照保持旧值），避免抢磁盘。
   * @returns {{ok:true, snapshotAt:number, throttled:boolean}}
   */
  function setSnapshot(deviceId, snapshot) {
    const state = load();
    const rec = recById(state, deviceId);
    const ts = at();
    if (!rec) fail('not_found', '设备不存在');
    rec.lastSeenAt = ts;
    const prevAt = Number(rec.snapshot?.snapshotAt || 0);
    if (prevAt && ts - prevAt < SNAPSHOT_THROTTLE_MS) {
      save(state);
      return { ok: true, snapshotAt: prevAt, throttled: true };
    }
    const books = Array.isArray(snapshot?.books) ? snapshot.books : [];
    rec.snapshot = {
      books: books.slice(0, 5000).map((book) => ({
        hash: String(book?.hash || '').toLowerCase(),
        title: String(book?.title || ''),
        size: Number(book?.size) || 0,
        hasLocalFile: book?.hasLocalFile === true,
      })),
      storageTotal: Number(snapshot?.storageTotal) || 0,
      storageFree: Number(snapshot?.storageFree) || 0,
      booksBytes: Number(snapshot?.booksBytes) || 0,
      snapshotAt: ts,
    };
    save(state);
    return { ok: true, snapshotAt: ts, throttled: false };
  }

  /* ---------------- 指令 ---------------- */

  function normalizePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      fail('bad_payload', '指令 payload 必须是对象');
    }
    let encoded;
    try {
      encoded = JSON.stringify(payload);
    } catch {
      fail('bad_payload', '指令 payload 无法序列化');
    }
    if (Buffer.byteLength(encoded, 'utf8') > PAYLOAD_LIMIT) {
      fail('bad_payload', '指令 payload 超过 4KB');
    }
    const hash = String(payload.hash || '').toLowerCase();
    if (!HASH_RE.test(hash)) fail('bad_hash', 'payload.hash 必须是 40 位十六进制');
    return { ...payload, hash };
  }

  /**
   * 入队。同 `type + payload.hash` 已有 pending → 只刷新时间并返回 duplicate:true。
   * 单批上限（50 本 / 2GB）由上层按 batchId 计算，这里只管单条。
   */
  function enqueue({ deviceId, type, payload, batchId } = {}) {
    const kind = String(type || '');
    if (!COMMAND_TYPES.has(kind)) fail('bad_type', '不支持的指令类型');
    const data = normalizePayload(payload);
    const ts = at();
    const state = load();
    const rec = recById(state, deviceId);
    if (!rec) fail('not_found', '设备不存在');

    const duplicate = rec.commands.find(
      (command) =>
        command.state === 'pending' &&
        command.type === kind &&
        String(command.payload?.hash || '').toLowerCase() === data.hash,
    );
    if (duplicate) {
      duplicate.createdAt = ts;
      duplicate.expiresAt = ts + COMMAND_TTL_MS;
      duplicate.payload = data;
      if (batchId) duplicate.batchId = String(batchId);
      else delete duplicate.batchId;
      save(state);
      return { ok: true, command: publicCommand(duplicate), duplicate: true };
    }

    const command = {
      id: `cmd_${crypto.randomUUID()}`,
      type: kind,
      payload: data,
      createdAt: ts,
      expiresAt: ts + COMMAND_TTL_MS,
      state: 'pending',
    };
    if (batchId) command.batchId = String(batchId);
    rec.commands.push(command);
    save(state);
    return { ok: true, command: publicCommand(command), duplicate: false };
  }

  /** 手机领取：先清扫，再把 pending 标 delivered，按 createdAt 升序返回。 */
  function claim(deviceId) {
    const state = load();
    const ts = at();
    const rec = recById(state, deviceId);
    if (!rec) fail('not_found', '设备不存在');
    sweepRecord(rec, ts);

    const pending = rec.commands
      .filter((command) => command.state === 'pending')
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    for (const command of pending) {
      command.state = 'delivered';
      command.deliveredAt = ts;
    }
    save(state);
    return pending.map((command) => ({
      id: command.id,
      type: command.type,
      payload: clone(command.payload),
      ...(command.batchId ? { batchId: command.batchId } : {}),
      createdAt: command.createdAt,
      expiresAt: command.expiresAt,
    }));
  }

  /** 回执：state 只收 done/failed；指令必须还在 commands 里（过期已在 history → 404）。 */
  function receipt(deviceId, commandId, input = {}) {
    const state = String(input.state || '');
    if (state !== 'done' && state !== 'failed') fail('bad_state', 'state 只能是 done 或 failed');
    const ts = at();
    const data = load();
    const rec = recById(data, deviceId);
    if (!rec) fail('not_found', '设备不存在');
    // 回执也要先清扫：指令若已过期，应回 404 而不是让一次迟到的回执把它「救活」。
    const swept = sweepRecord(rec, ts);
    const index = rec.commands.findIndex((command) => command.id === String(commandId));
    if (index < 0) {
      if (swept) save(data);
      fail('not_found', '指令不存在或已过期');
    }

    const [command] = rec.commands.splice(index, 1);
    const extra = {};
    if (input.error) extra.error = String(input.error).slice(0, 200);
    if (input.detail !== undefined) extra.detail = clone(input.detail);
    pushHistory(rec, command, state, ts, extra);
    save(data);
    return { ok: true, state };
  }

  /** 单条重试：failed/expired/cancelled → pending（新的 createdAt/expiresAt）。 */
  function retry(deviceId, commandId) {
    const ts = at();
    const state = load();
    const rec = recById(state, deviceId);
    if (!rec) fail('not_found', '设备不存在');
    const key = String(commandId || '');

    const current = rec.commands.find((command) => command.id === key);
    if (current) {
      if (current.state === 'done') fail('bad_state', '已完成的指令不能重试');
      current.state = 'pending';
      current.createdAt = ts;
      current.expiresAt = ts + COMMAND_TTL_MS;
      delete current.deliveredAt;
      delete current.finishedAt;
      delete current.error;
      save(state);
      return { ok: true, command: publicCommand(current) };
    }

    const historyIndex = rec.history.findIndex((command) => command.id === key);
    if (historyIndex < 0) fail('not_found', '指令不存在');
    const source = rec.history[historyIndex];
    if (source.state === 'done') fail('bad_state', '已完成的指令不能重试');
    rec.history.splice(historyIndex, 1);
    const next = {
      ...clone(source),
      state: 'pending',
      createdAt: ts,
      expiresAt: ts + COMMAND_TTL_MS,
    };
    delete next.finishedAt;
    delete next.deliveredAt;
    delete next.error;
    delete next.detail;
    rec.commands.push(next);
    save(state);
    return { ok: true, command: publicCommand(next) };
  }

  /** 取消单条未完结指令 → history(cancelled)。 */
  function cancel(deviceId, commandId) {
    const ts = at();
    const state = load();
    const rec = recById(state, deviceId);
    if (!rec) fail('not_found', '设备不存在');
    const index = rec.commands.findIndex((command) => command.id === String(commandId));
    if (index < 0) fail('not_found', '指令不存在');
    const [command] = rec.commands.splice(index, 1);
    pushHistory(rec, command, 'cancelled', ts);
    save(state);
    return { ok: true };
  }

  /** 清空该设备的全部未完结指令 → history(cancelled)。 */
  function clear(deviceId) {
    const ts = at();
    const state = load();
    const rec = recById(state, deviceId);
    if (!rec) fail('not_found', '设备不存在');
    const count = rec.commands.length;
    for (const command of rec.commands) pushHistory(rec, command, 'cancelled', ts);
    rec.commands = [];
    if (count) save(state);
    return { ok: true, cleared: count };
  }

  /** 列表：先对全部设备清扫，再补 online/lost 派生值。 */
  function list() {
    sweep();
    const state = load();
    const ts = at();
    return state.devices.map((rec) => view(rec, ts));
  }

  function get(id) {
    sweep(id);
    const state = load();
    return view(recById(state, id), at());
  }

  function pendingCount(deviceId) {
    const rec = recById(load(), deviceId);
    // 与设备页口径一致：未完结（pending + delivered）都算「待执行」。
    return rec ? rec.commands.length : 0;
  }

  return {
    file,
    list,
    get,
    upsertSeen,
    onlineOf,
    deviceSseCount: sseCount,
    noteSseOpen,
    noteSseClose,
    setSnapshot,
    enqueue,
    claim,
    receipt,
    sweep,
    retry,
    cancel,
    clear,
    rename,
    remove,
    pendingCount,
  };
}
