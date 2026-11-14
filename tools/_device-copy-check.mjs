/**
 * T04 设备页文案自查（纯静态 grep，不启动应用）。
 *
 * 校验三件事：
 *   1. `docs/arch-device-manager.md` §5 的 7 条失败原因，逐字出现在 DevicesPanel.jsx；
 *   2. PRD 点名的 6 个动作入口与确认文案，逐字出现；
 *   3. 两个禁词（正在同步 / 已同步到手机 / 同步中）在设备页与设置页里都不出现。
 *
 * 用法：node tools/_device-copy-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PANEL = path.join(ROOT, 'src/components/DevicesPanel.jsx');
const SETTINGS = path.join(ROOT, 'src/components/SettingsPage.jsx');

const panelSrc = fs.readFileSync(PANEL, 'utf8');
const settingsSrc = fs.readFileSync(SETTINGS, 'utf8');

let total = 0;
let failed = 0;
const failures = [];

function check(name, ok) {
  total += 1;
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
}

/* ---------- 1. 7 条失败原因（回执 error → 桌面端文案，逐字） ---------- */
group('1. 失败原因文案（7 条，逐字）');
const FAIL_COPY = [
  ['insufficient_space', '手机空间不足，需要腾出 '],
  ['too_large', '超过 30MiB 上限，这本书只能留在本机'],
  ['hash_mismatch', '内容校验失败，传输不完整，已丢弃'],
  ['network_interrupted', '传输中断，可重试'],
  ['user_rejected', '你在手机上拒绝了这次操作'],
  ['source_gone', '对端已没有这本书的副本'],
  ['unsupported', '手机端版本太旧，不支持这条指令'],
];
for (const [code, text] of FAIL_COPY) {
  check(`${code} → ${text}`, panelSrc.includes(text));
}
// insufficient_space 的 {X} 是运行时数值，额外确认模板里确实拼了 MB 单位。
check('insufficient_space 文案带 MB 单位', /手机空间不足，需要腾出 \$\{mb\} MB/.test(panelSrc));
check('未知 error 原样显示（不吞成通用文案）', panelSrc.includes('return code || '));

/* ---------- 2. 6 个动作入口与确认文案 ---------- */
group('2. 动作入口与确认文案（A1–A6）');
const ACTION_COPY = [
  ['A1 发送到手机', '发送到手机'],
  ['A2 移除确认', '从手机上删掉？电脑上的副本不受影响。'],
  ['A2 唯一副本红字', '手机上是唯一副本，手机端会再问你一次。'],
  ['A3 占用确认勾选', '我知道会占用约 '],
  ['A3 单批上限', '单批最多 50 本 / 2GB，请分批'],
  ['A4 存储只读（无动作按钮）', '书籍占用'],
  ['A5 清空确认', '清空全部待执行指令？'],
  ['A6 拉到电脑', '拉到电脑'],
];
for (const [label, text] of ACTION_COPY) {
  check(`${label}：${text}`, panelSrc.includes(text));
}
check('A3 确认按钮在勾选前禁用', /disabled=\{busy \|\| batchTooLarge \|\| !batchAck/.test(panelSrc));

/* ---------- 3. 两态呈现与差异标记 ---------- */
group('3. 两态呈现与差异标记');
check('在线状态条', panelSrc.includes('手机在线 · '));
check('离线状态条', panelSrc.includes('手机离线 · 上次在线 '));
check('离线快照角标', panelSrc.includes('天前的快照，可能已过期'));
check('差异标记：桌面端没有这本书', panelSrc.includes('桌面端没有这本书'));
check('差异标记：两端内容不一致', panelSrc.includes('两端内容不一致'));
check('离线入队文案', panelSrc.includes('待执行 · 手机连接后自动执行，7 天内有效'));
check('刷新快照离线禁用且说明需要手机在线', panelSrc.includes('需要手机在线'));
check('两态只靠 online 一个布尔（dimmed 用 online 取反）', /opacity: online \? 1 : 0\.62/.test(panelSrc));

/* ---------- 4. 多设备 / 空状态 ---------- */
group('4. 多设备与空状态');
check('失联标记', panelSrc.includes('已失联'));
check('改名：Enter 保存 / Esc 取消', panelSrc.includes("event.key === 'Enter'") && panelSrc.includes("event.key === 'Escape'"));
check('移除设备确认', panelSrc.includes('不再管理「') && panelSrc.includes('？手机上的书不受影响。'));
check(
  '空状态文案',
  panelSrc.includes('还没有手机连接过。在手机 App 里连上这台电脑，它就会出现在这里。')
);

/* ---------- 5. 禁词 ---------- */
group('5. 禁词（必须为 0 命中）');
const BANNED = ['正在同步', '已同步到手机', '同步中'];
for (const word of BANNED) {
  const inPanel = panelSrc.includes(word);
  const inSettings = settingsSrc.includes(word);
  check(`禁词「${word}」未出现`, !inPanel && !inSettings);
}

/* ---------- 6. 设置页接线 ---------- */
group('6. SettingsPage 接线');
check("SECTIONS 含 devices 分区", settingsSrc.includes("{ key: 'devices', label: '我的手机', Icon: IconPhone }"));
check('已挂载 <DevicesPanel />', settingsSrc.includes('<DevicesPanel />'));
check('IconPhone 从 DevicesPanel 导入', settingsSrc.includes('IconPhone') && settingsSrc.includes("from './DevicesPanel.jsx'"));

/* ---------- 7. 组件不直接碰 window.readerAPI ---------- */
group('7. 组件边界');
check('DevicesPanel 不直接用 window.readerAPI', !panelSrc.includes('window.readerAPI'));
check('DevicesPanel 走 useDevices()', panelSrc.includes('useDevices()'));
check('DevicesPanel 走 actions.devices.*', panelSrc.includes('devices: deviceActions'));

console.log(`\n${total - failed}/${total} 通过${failed ? `，${failed} 条失败` : ''}`);
if (failed) {
  console.log('失败项：');
  for (const name of failures) console.log(`  - ${name}`);
  process.exitCode = 1;
}
