import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppActions, useBooks, useDevices } from '../store/AppStore.jsx';
import { IconChevron } from './Icons.jsx';

/**
 * 设备页图标：`Icons.jsx` 里没有手机，本轮改动范围不含它，
 * 就近在本组件内实现并导出，供 `SettingsPage.jsx` 的导航复用。
 */
export function IconPhone({ size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
      <path d="M10.5 5.5h3" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

/** 回执失败原因 → 桌面端红点文案，与 docs/arch-device-manager.md §5 逐字一致。 */
const FAIL_TEXT = {
  insufficient_space: (mb) => `手机空间不足，需要腾出 ${mb} MB`,
  too_large: () => '超过 30MiB 上限，这本书只能留在本机',
  hash_mismatch: () => '内容校验失败，传输不完整，已丢弃',
  network_interrupted: () => '传输中断，可重试',
  user_rejected: () => '你在手机上拒绝了这次操作',
  source_gone: () => '对端已没有这本书的副本',
  unsupported: () => '手机端版本太旧，不支持这条指令',
};

const TYPE_LABEL = {
  'push-book': '发送到手机',
  'remove-book': '从手机移除',
  'pull-book': '拉到电脑',
};

const MAX_BATCH_BOOKS = 50;
const MAX_BATCH_BYTES = 2 * 1024 * 1024 * 1024;

const HASH_RE = /^[0-9a-f]{40}$/;

const MIB = 1024 * 1024;

const COLOR = {
  ok: '#30b94d',
  off: 'var(--text-faint)',
  danger: '#ff3b30',
};

const cardStyle = {
  borderRadius: 14,
  border: '0.5px solid var(--line)',
  background: 'var(--bg-elevated)',
  padding: '14px 16px',
};

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 0',
  borderBottom: '0.5px solid var(--line)',
};

const dotStyle = (online) => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  flex: 'none',
  background: online ? COLOR.ok : COLOR.off,
  boxShadow: online ? '0 0 0 3px rgba(48, 185, 77, 0.16)' : 'none',
});

function hashOf(book) {
  const hash = String(book?.contentHash || '').toLowerCase();
  return HASH_RE.test(hash) ? hash : '';
}

function titleOf(book) {
  return String(book?.title || book?.name || '未命名');
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 MB';
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= MIB) return `${Math.round(value / MIB)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** MM-dd HH:mm，状态条与快照角标共用。 */
function clockText(ts) {
  const value = Number(ts) || 0;
  if (!value) return '——';
  const d = new Date(value);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function relativeTime(ts) {
  const value = Number(ts) || 0;
  if (!value) return '未知';
  const diff = Date.now() - value;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return clockText(value);
}

/** 快照天数：离线时给「N 天前的快照，可能已过期」用，至少 1 天。 */
function daysAgo(ts) {
  const value = Number(ts) || 0;
  if (!value) return 0;
  return Math.max(1, Math.floor((Date.now() - value) / (24 * 60 * 60 * 1000)));
}

/**
 * insufficient_space 的 {X}：优先用回执 detail（当前 publicCommand 不透出 detail，
 * 这里做了兼容），拿不到就用「书大小 - 手机可用空间」估算，估不出来至少显示 1。
 */
function needMbOf(command, snapshot) {
  const detail = command?.detail && typeof command.detail === 'object' ? command.detail : {};
  const direct = Number(detail.needMb ?? (detail.needBytes ? Number(detail.needBytes) / MIB : 0));
  if (Number.isFinite(direct) && direct > 0) return Math.max(1, Math.round(direct));
  const size = Number(command?.payload?.size) || 0;
  const free = Number(snapshot?.storageFree) || 0;
  const gap = size - free;
  return gap > 0 ? Math.max(1, Math.round(gap / MIB)) : 1;
}

function failTextOf(command, snapshot) {
  const code = String(command?.error || '');
  const build = FAIL_TEXT[code];
  if (build) return build(needMbOf(command, snapshot));
  return code || '执行失败，原因未知';
}

export default function DevicesPanel() {
  const devices = useDevices();
  const books = useBooks();
  const { devices: deviceActions, notify } = useAppActions();

  const [selectedId, setSelectedId] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [queueOpen, setQueueOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchAck, setBatchAck] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = Array.isArray(devices) ? devices : [];
  const selected = list.find((item) => item.id === selectedId) || list[0] || null;

  // 每次进设备页拉一次最新记录；AppStore 里另有 lan:device / lan:command 订阅兜底。
  useEffect(() => {
    deviceActions.refresh?.();
  }, [deviceActions]);

  // 换设备时收起所有跟当前设备绑定的一次性面板。
  useEffect(() => {
    setRenaming(false);
    setBatchOpen(false);
    setBatchAck(false);
    setQueueOpen(false);
  }, [selected?.id]);

  const online = Boolean(selected?.online);
  const snapshot = selected?.snapshot || null;
  const snapshotBooks = useMemo(
    () => (Array.isArray(snapshot?.books) ? snapshot.books : []),
    [snapshot]
  );

  /** 本机可发送的书：本地、有 40 位 hash。云端书只能在线读，不参与差集。 */
  const localBooks = useMemo(() => {
    const out = [];
    for (const book of books || []) {
      if (!book || book.kind === 'cloud') continue;
      const hash = hashOf(book);
      if (!hash) continue;
      out.push({ book, hash });
    }
    return out;
  }, [books]);

  const localByHash = useMemo(() => {
    const map = new Map();
    for (const item of localBooks) map.set(item.hash, item.book);
    return map;
  }, [localBooks]);

  const snapshotHashes = useMemo(() => {
    const set = new Set();
    for (const entry of snapshotBooks) {
      const hash = String(entry?.hash || '').toLowerCase();
      if (HASH_RE.test(hash)) set.add(hash);
    }
    return set;
  }, [snapshotBooks]);

  /** 桌面有、手机没有 → A3 补齐差集的候选。 */
  const localOnly = useMemo(
    () => localBooks.filter((item) => !snapshotHashes.has(item.hash)),
    [localBooks, snapshotHashes]
  );

  const batchList = useMemo(() => localOnly.slice(0, MAX_BATCH_BOOKS), [localOnly]);
  const batchBytes = useMemo(
    () => batchList.reduce((sum, item) => sum + (Number(item.book?.size) || 0), 0),
    [batchList]
  );
  const batchTooLarge = localOnly.length > MAX_BATCH_BOOKS || batchBytes > MAX_BATCH_BYTES;

  const commands = Array.isArray(selected?.commands) ? selected.commands : [];
  const history = Array.isArray(selected?.history) ? selected.history : [];
  const failed = useMemo(
    () => history.filter((item) => item && (item.state === 'failed' || item.state === 'expired')),
    [history]
  );
  const pendingCount = Number.isFinite(Number(selected?.pending))
    ? Number(selected.pending)
    : commands.length;

  const enqueueOne = useCallback(
    async (type, payload) => {
      if (!selected) return false;
      const result = await deviceActions.enqueue({ deviceId: selected.id, type, payload });
      if (!result?.ok) {
        const text =
          result?.error === 'bad_hash'
            ? '这本书缺少有效的内容哈希，暂时不能发送'
            : result?.error === 'not_found'
              ? '这台手机的记录已失效，请让它重新连一次'
              : '操作没成功，请稍后再试';
        notify(text, 'error');
        return false;
      }
      notify(
        duplicateText(result, selected) ||
          (online
            ? `已下发到「${selected.name}」`
            : '待执行 · 手机连接后自动执行，7 天内有效')
      );
      return true;
    },
    [deviceActions, notify, online, selected]
  );

  const sendBook = useCallback(
    async (book, hash) => {
      await enqueueOne('push-book', { hash, title: titleOf(book), size: Number(book?.size) || 0 });
    },
    [enqueueOne]
  );

  const pullBook = useCallback(
    async (entry) => {
      const hash = String(entry?.hash || '').toLowerCase();
      if (!HASH_RE.test(hash)) return;
      await enqueueOne('pull-book', {
        hash,
        title: String(entry?.title || '未命名'),
        size: Number(entry?.size) || 0,
      });
    },
    [enqueueOne]
  );

  const askRemove = useCallback((entry) => {
    const hash = String(entry?.hash || '').toLowerCase();
    const title = String(entry?.title || '未命名');
    // 桌面端没有同 hash 的副本，说明手机上是唯一副本，手机端还会再问一次。
    const unique = !localByHash.has(hash);
    setConfirm({
      message: `把《${title}》从手机上删掉？电脑上的副本不受影响。`,
      warning: unique ? '手机上是唯一副本，手机端会再问你一次。' : '',
      confirmText: '删掉',
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        if (!selected) return;
        const result = await deviceActions.enqueue({
          deviceId: selected.id,
          type: 'remove-book',
          payload: { hash, title, unique },
        });
        if (!result?.ok) {
          notify('操作没成功，请稍后再试', 'error');
          return;
        }
        notify(
          online
            ? `已下发到「${selected.name}」`
            : '待执行 · 手机连接后自动执行，7 天内有效'
        );
      },
    });
  }, [deviceActions, localByHash, notify, online, selected]);

  const sendBatch = useCallback(async () => {
    if (!selected || busy || !batchList.length || batchTooLarge || !batchAck) return;
    setBusy(true);
    const batchId = `batch_${Date.now().toString(36)}`;
    let sent = 0;
    for (const item of batchList) {
      const result = await deviceActions.enqueue({
        deviceId: selected.id,
        type: 'push-book',
        batchId,
        payload: { hash: item.hash, title: titleOf(item.book), size: Number(item.book?.size) || 0 },
      });
      if (result?.ok) sent += 1;
    }
    setBusy(false);
    setBatchOpen(false);
    setBatchAck(false);
    notify(
      online
        ? `已下发 ${sent} 本到「${selected.name}」`
        : `待执行 · ${sent} 本已入队，手机连接后自动执行，7 天内有效`
    );
  }, [batchAck, batchList, batchTooLarge, busy, deviceActions, notify, online, selected]);

  const submitRename = useCallback(async () => {
    if (!selected) return;
    const name = nameDraft.trim();
    if (!name) {
      notify('名字不能为空', 'error');
      return;
    }
    const result = await deviceActions.rename({ id: selected.id, name });
    if (!result?.ok) {
      notify(
        result?.error === 'bad_name' ? '名字不能为空' : '改名没成功，请稍后再试',
        'error'
      );
      return;
    }
    setRenaming(false);
    notify(`已改名为「${name}」`);
  }, [deviceActions, nameDraft, notify, selected]);

  const askRemoveDevice = useCallback(() => {
    if (!selected) return;
    setConfirm({
      message: `不再管理「${selected.name}」？手机上的书不受影响。`,
      confirmText: '不再管理',
      danger: true,
      onConfirm: async () => {
        const id = selected.id;
        setConfirm(null);
        const result = await deviceActions.remove({ id });
        if (!result?.ok) {
          notify('移除没成功，请稍后再试', 'error');
          return;
        }
        if (selectedId === id) setSelectedId('');
        notify('已不再管理这台手机');
      },
    });
  }, [deviceActions, notify, selected, selectedId]);

  const askClearQueue = useCallback(() => {
    if (!selected) return;
    setConfirm({
      message: '清空全部待执行指令？',
      hint: '只清空电脑上的队列，手机上的书不受影响。',
      confirmText: '清空',
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        const result = await deviceActions.clear({ deviceId: selected.id });
        if (!result?.ok) {
          notify('清空没成功，请稍后再试', 'error');
          return;
        }
        notify(`已清空 ${Number(result.cleared) || 0} 条待执行指令`);
      },
    });
  }, [deviceActions, notify, selected]);

  const cancelCommand = useCallback(
    async (command) => {
      if (!selected) return;
      const result = await deviceActions.cancel({ deviceId: selected.id, commandId: command.id });
      if (!result?.ok) {
        notify(result?.error === 'not_found' ? '这条指令已经不在了' : '取消失败，请稍后再试', 'error');
        return;
      }
      notify('已取消这条指令');
    },
    [deviceActions, notify, selected]
  );

  const retryCommand = useCallback(
    async (command) => {
      if (!selected) return;
      const result = await deviceActions.retry({ deviceId: selected.id, commandId: command.id });
      if (!result?.ok) {
        notify(result?.error === 'bad_state' ? '已完成的指令不能重试' : '重试失败，请稍后再试', 'error');
        return;
      }
      notify(
        online
          ? `已重新下发到「${selected.name}」`
          : '待执行 · 手机连接后自动执行，7 天内有效'
      );
    },
    [deviceActions, notify, online, selected]
  );

  /* ---------------- 空状态 ---------------- */
  if (!list.length) {
    return (
      <section className="settings-group">
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--text-faint)' }}>
            <IconPhone size={26} />
          </span>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--text)' }}>
            还没有手机连接过。在手机 App 里连上这台电脑，它就会出现在这里。
          </p>
          <p className="settings-hint" style={{ margin: 0 }}>
            手机和电脑连同一个 Wi-Fi，在手机 App 的设置里填上局域网面板的地址与访问码即可。
          </p>
        </div>
      </section>
    );
  }

  /* ---------------- 有设备 ---------------- */
  const lastSeenText = selected?.lastSeenAt
    ? `手机离线 · 上次在线 ${relativeTime(selected.lastSeenAt)}（${clockText(selected.lastSeenAt)}）`
    : '手机离线 · 这台手机还没上报过状态';

  const statusText = online
    ? `手机在线 · ${selected.name} · ${selected.lastIp || '未知地址'} · v${selected.appVersion || '未知版本'}`
    : lastSeenText;

  const snapshotDays = daysAgo(snapshot?.snapshotAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      {/* 设备选择 + 改名 / 移除 */}
      <section className="settings-group">
        <h3 className="settings-group-title">设备</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          {list.map((item) => {
            const active = item.id === selected?.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  height: 30,
                  padding: '0 11px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontSize: 12.5,
                  color: 'var(--text)',
                  border: `0.5px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  opacity: item.lost ? 0.55 : 1,
                }}
              >
                <span style={dotStyle(Boolean(item.online))} />
                <span>{item.name || '未命名手机'}</span>
                {item.lost ? (
                  <span style={{ color: 'var(--text-soft)', fontSize: 11 }}>已失联</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="settings-page-row">
          <div className="settings-page-row-text">
            <span>名称</span>
            <small>只改电脑这侧的显示名，手机上的名字不变。</small>
          </div>
          <div className="settings-page-row-control">
            {renaming ? (
              <input
                className="text-input"
                autoFocus
                value={nameDraft}
                aria-label="设备名称"
                style={{ width: 180 }}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitRename();
                  if (event.key === 'Escape') setRenaming(false);
                }}
              />
            ) : (
              <button
                className="btn ghost small"
                type="button"
                onClick={() => {
                  setNameDraft(selected?.name || '');
                  setRenaming(true);
                }}
              >
                重命名
              </button>
            )}
            <button className="btn ghost small danger" type="button" onClick={askRemoveDevice}>
              移除
            </button>
          </div>
        </div>
      </section>

      {/* 状态条 */}
      <section className="settings-group">
        <div
          style={{
            ...cardStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '11px 14px',
          }}
        >
          <span style={dotStyle(online)} />
          <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, minWidth: 0 }}>{statusText}</span>
          <button
            className="btn ghost small"
            type="button"
            disabled={!online}
            title={online ? '重新读取这台手机最近一次上报的书架' : '需要手机在线'}
            onClick={() => {
              deviceActions.refresh?.();
              notify('已重新读取设备记录');
            }}
          >
            刷新快照
          </button>
        </div>
        {!online ? (
          <p className="settings-hint" style={{ marginTop: 8 }}>
            需要手机在线才能刷新快照；离线时看到的是最近一次上报的结果。
          </p>
        ) : null}
      </section>

      {/* 书架 */}
      <section className="settings-group" style={{ opacity: online ? 1 : 0.62 }}>
        <h3 className="settings-group-title">
          手机书架
          <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
            {snapshotBooks.length} 本
          </span>
          {!online ? (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                fontWeight: 400,
                color: 'var(--text-soft)',
                border: '0.5px solid var(--line)',
                borderRadius: 999,
                padding: '1px 8px',
              }}
            >
              {snapshotDays ? `${snapshotDays} 天前的快照，可能已过期` : '还没有收到书架快照'}
            </span>
          ) : null}
        </h3>

        {snapshotBooks.length ? (
          <div>
            {snapshotBooks.map((entry, index) => {
              const hash = String(entry?.hash || '').toLowerCase();
              const local = localByHash.get(hash);
              const marker = !local
                ? { text: '桌面端没有这本书', tone: 'warn' }
                : Number(entry?.size) && Number(local?.size) && Number(entry.size) !== Number(local.size)
                  ? { text: '两端内容不一致', tone: 'warn' }
                  : null;
              return (
                <div
                  key={`${hash || 'book'}-${index}`}
                  style={{ ...rowStyle, borderBottom: index === snapshotBooks.length - 1 ? 0 : rowStyle.borderBottom }}
                >
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span
                      style={{
                        fontSize: 13,
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {String(entry?.title || '未命名')}
                    </span>
                    <small style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>
                      {formatBytes(entry?.size)}
                      {entry?.hasLocalFile === false ? ' · 手机上没有正文' : ''}
                      {marker ? (
                        <span style={{ color: marker.tone === 'warn' ? '#c78100' : 'var(--text-soft)', marginLeft: 8 }}>
                          {marker.text}
                        </span>
                      ) : null}
                    </small>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    {!local ? (
                      <button className="btn ghost small" type="button" onClick={() => pullBook(entry)}>
                        拉到电脑
                      </button>
                    ) : null}
                    <button className="btn ghost small danger" type="button" onClick={() => askRemove(entry)}>
                      移除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="settings-hint" style={{ margin: 0 }}>
            这台手机还没有上报书架。打开手机 App 并连上这台电脑后，这里会出现它的书。
          </p>
        )}
      </section>

      {/* 存储 */}
      <section className="settings-group" style={{ opacity: online ? 1 : 0.62 }}>
        <h3 className="settings-group-title">
          存储
          {!online ? (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                fontWeight: 400,
                color: 'var(--text-soft)',
                border: '0.5px solid var(--line)',
                borderRadius: 999,
                padding: '1px 8px',
              }}
            >
              {snapshotDays ? `${snapshotDays} 天前的快照，可能已过期` : '还没有收到存储快照'}
            </span>
          ) : null}
        </h3>
        <div
          style={{
            ...cardStyle,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <small style={{ fontSize: 11, color: 'var(--text-soft)' }}>总容量</small>
            <span style={{ fontSize: 15, color: 'var(--text)' }}>{formatBytes(snapshot?.storageTotal)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <small style={{ fontSize: 11, color: 'var(--text-soft)' }}>可用</small>
            <span style={{ fontSize: 15, color: 'var(--text)' }}>{formatBytes(snapshot?.storageFree)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <small style={{ fontSize: 11, color: 'var(--text-soft)' }}>书籍占用</small>
            <span style={{ fontSize: 15, color: 'var(--text)' }}>{formatBytes(snapshot?.booksBytes)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <small style={{ fontSize: 11, color: 'var(--text-soft)' }}>快照时间</small>
            <span style={{ fontSize: 15, color: 'var(--text)' }}>{clockText(snapshot?.snapshotAt)}</span>
          </div>
        </div>
      </section>

      {/* 动作：A3 补齐差集 */}
      <section className="settings-group">
        <h3 className="settings-group-title">动作</h3>
        <div className="settings-page-row">
          <div className="settings-page-row-text">
            <span>补齐差集</span>
            <small>
              {localOnly.length
                ? `电脑上有 ${localOnly.length} 本手机还没有，合计 ${formatBytes(
                    localOnly.reduce((sum, item) => sum + (Number(item.book?.size) || 0), 0)
                  )}`
                : '手机和电脑的本地书已经一致。'}
            </small>
          </div>
          <div className="settings-page-row-control">
            <button
              className="btn primary small"
              type="button"
              disabled={!localOnly.length}
              onClick={() => {
                setBatchAck(false);
                setBatchOpen((prev) => !prev);
              }}
            >
              {batchOpen ? '收起' : '补齐差集'}
            </button>
          </div>
        </div>

        {!online ? (
          <p className="settings-hint" style={{ margin: '8px 0 0' }}>
            待执行 · 手机连接后自动执行，7 天内有效
          </p>
        ) : null}

        {batchOpen ? (
          <div style={{ ...cardStyle, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
              将发送 {batchList.length} 本，合计约 {formatBytes(batchBytes)}
            </div>
            <div style={{ maxHeight: 168, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {batchList.map((item) => (
                <div key={item.hash} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-soft)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {titleOf(item.book)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)', flex: 'none' }}>
                    {formatBytes(item.book?.size)}
                  </span>
                </div>
              ))}
            </div>
            {batchTooLarge ? (
              <p style={{ margin: 0, fontSize: 12, color: COLOR.danger }}>单批最多 50 本 / 2GB，请分批</p>
            ) : null}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={batchAck}
                disabled={batchTooLarge}
                onChange={(event) => setBatchAck(event.target.checked)}
              />
              我知道会占用约 {Math.max(1, Math.round(batchBytes / MIB))} MB
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn ghost small" type="button" onClick={() => setBatchOpen(false)}>
                取消
              </button>
              <button
                className="btn primary small"
                type="button"
                disabled={busy || batchTooLarge || !batchAck || !batchList.length}
                onClick={sendBatch}
              >
                {busy ? '入队中…' : '确认发送'}
              </button>
            </div>
          </div>
        ) : null}

        {localOnly.length ? (
          <div style={{ marginTop: 12 }}>
            <h3 className="settings-group-title">电脑上、手机还没有的书</h3>
            {localOnly.slice(0, 8).map((item, index) => (
              <div
                key={item.hash}
                style={{ ...rowStyle, borderBottom: index === Math.min(localOnly.length, 8) - 1 ? 0 : rowStyle.borderBottom }}
              >
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {titleOf(item.book)}
                  </span>
                  <small style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>
                    {formatBytes(item.book?.size)}
                  </small>
                </div>
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={() => sendBook(item.book, item.hash)}
                >
                  发送到手机
                </button>
              </div>
            ))}
            {localOnly.length > 8 ? (
              <p className="settings-hint" style={{ margin: '8px 0 0' }}>
                还有 {localOnly.length - 8} 本，用上面的「补齐差集」一次发过去。
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 队列 */}
      <section className="settings-group">
        <button
          type="button"
          onClick={() => setQueueOpen((prev) => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: 0,
            border: 0,
            background: 'transparent',
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <span>待执行 {pendingCount} 项</span>
          {failed.length ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 400, color: 'var(--text-soft)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLOR.danger }} />
              {failed.length} 条失败
            </span>
          ) : null}
          <span
            style={{
              marginLeft: 'auto',
              transform: queueOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 160ms ease',
              color: 'var(--text-soft)',
              display: 'inline-flex',
            }}
          >
            <IconChevron size={14} />
          </span>
        </button>

        {queueOpen ? (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!online && commands.length ? (
              <p className="settings-hint" style={{ margin: 0 }}>
                最早一条 {clockText(
                  commands.reduce(
                    (min, item) => Math.min(min, Number(item.createdAt) || Number.MAX_SAFE_INTEGER),
                    Number.MAX_SAFE_INTEGER
                  )
                )}
              </p>
            ) : null}

            {commands.length ? (
              commands.map((command) => (
                <div
                  key={command.id}
                  style={{
                    ...cardStyle,
                    padding: '9px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--text)' }}>
                      {TYPE_LABEL[command.type] || command.type}
                      {command.payload?.title ? ` · ${command.payload.title}` : ''}
                    </span>
                    <small style={{ fontSize: 11, color: 'var(--text-soft)' }}>
                      加入于 {clockText(command.createdAt)}
                      {command.state === 'delivered' ? ' · 已领取' : ''}
                    </small>
                  </div>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => cancelCommand(command)}
                  >
                    取消
                  </button>
                </div>
              ))
            ) : (
              <p className="settings-hint" style={{ margin: 0 }}>
                队列是空的。
              </p>
            )}

            {failed.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
                {failed.map((command) => (
                  <div
                    key={`${command.id}-${command.state}`}
                    style={{
                      ...cardStyle,
                      padding: '9px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: COLOR.danger,
                        flex: 'none',
                        marginTop: 6,
                        alignSelf: 'flex-start',
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--text)' }}>
                        {TYPE_LABEL[command.type] || command.type}
                        {command.payload?.title ? ` · ${command.payload.title}` : ''}
                      </span>
                      <small style={{ fontSize: 11.5, color: COLOR.danger, lineHeight: 1.5 }}>
                        {command.state === 'expired' ? '指令已过期，手机当时不在线' : failTextOf(command, snapshot)}
                      </small>
                    </div>
                    <button className="btn ghost small" type="button" onClick={() => retryCommand(command)}>
                      重试
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {(commands.length || failed.length) ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn ghost small danger" type="button" onClick={askClearQueue}>
                  清空
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {confirm ? (
        <div
          onClick={() => setConfirm(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 360,
              maxWidth: 'calc(100vw - 48px)',
              borderRadius: 16,
              background: 'var(--bg-elevated)',
              border: '0.5px solid var(--line)',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.24)',
              padding: '18px 18px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--text)' }}>{confirm.message}</p>
            {confirm.warning ? (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: COLOR.danger }}>{confirm.warning}</p>
            ) : null}
            {confirm.hint ? (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-soft)' }}>{confirm.hint}</p>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button className="btn ghost small" type="button" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                className={`btn small ${confirm.danger ? 'danger' : 'primary'}`}
                type="button"
                onClick={() => confirm.onConfirm?.()}
              >
                {confirm.confirmText || '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 入队去重时的提示：同一本书已在队列里，不重复下发。 */
function duplicateText(result, device) {
  if (!result?.duplicate) return '';
  const title = result?.command?.payload?.title;
  return title
    ? `《${title}》已经在待执行队列里`
    : `这本已经在「${device.name}」的待执行队列里`;
}
