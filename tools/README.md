# tools/

`tools/` 下是 39 个脚本（外加若干截图产物），按用途分四类。文件名带 `_` 前缀的一律是**手动运行**的工具；不带前缀的只有 `apply-patch.mjs`、`probe-sources.mjs` 与三个 `.bat`。

回归脚本同时挂在 `package.json` 上，日常只需要跑 `npm run check:theme` / `check:lan-edge` / `check:lan-sync`；这三条已由 `.github/workflows/regress.yml` 在 push / PR 到 main 时自动执行。

## 1. 回归自检（可直接跑）

| 文件 | 用途 | 入口 |
| --- | --- | --- |
| `_theme-sync.mjs` | 校验 `src/design/tokens.css` 与 `src/themes.js` 的 5 套主题 × 13 个令牌是否同源 | `npm run check:theme` |
| `_run-lan-edge.mjs` | 一条命令跑完局域网边界自查：起夹具（脏数据 + 大书 + 漫画）→ 跑 `_qa-lan-edge.mjs` → 收摊 | `npm run check:lan-edge` |
| `_qa-lan-edge.mjs` | 局域网接口畸形输入断言（鉴权 / 分块上传 / Range / 30MiB 上限 / 脏清单 / 漫画 / 字体） | 需传 `<baseUrl> <token>`，或走上面的入口 |
| `_lan-sync-check.mjs` | 桌面端局域网接口自查：ping / 清单 / 下载 / 续传 / 上传 / 清单冲突 / 漫画 / 只读（117 项） | `npm run check:lan-sync` |
| `_lan-check.mjs` | 直接起 `electron/lan.js` 的面板回归（鉴权、数据视图、进度、SSE），不依赖 Electron | `node tools/_lan-check.mjs` |
| `_paths-check.mjs` | 路径包含关系回归：Windows 大小写、同前缀相邻目录、`..` 越界 | `node tools/_paths-check.mjs` |
| `_device-check.mjs` | 设备存储与指令队列内核自查，断言全部基于重新读盘的 `devices.json` | `node tools/_device-check.mjs` |
| `_device-http-check.mjs` | 设备管理 HTTP 接口 + SSE 在线态自查（建档 / 心跳 / 指令 / 快照边界） | `node tools/_device-http-check.mjs` |
| `_device-copy-check.mjs` | 设备页文案静态 grep：失败原因、动作入口、禁词 | `node tools/_device-copy-check.mjs` |
| `_qa-lan-books-ipc.mjs` | `lan:books` 从主进程 → preload → 渲染层订阅的链路回归（vm + 假 electron 模块） | `node tools/_qa-lan-books-ipc.mjs` |
| `_qa-offset-header.mjs` | `X-Folio-Offset` 缺头 / 非法值的 400 语义，与下载侧 200 / 206 / 416 | `node tools/_qa-offset-header.mjs` |
| `_qa-sync-e2e.mjs` | 用夹具当假手机跑双向整文件同步：上行、断点续传、幂等冲突、30MiB 边界、云端书 | `node tools/_qa-sync-e2e.mjs` |
| `_qa-sse.mjs` | 手机上传后桌面端推送链路：SSE（网页面板）与 IPC（Electron 书架）两段 | `node tools/_qa-sse.mjs` |
| `_frame-e2e.mjs` | macOS 边框切换端到端验证：重建窗口不退出、交通灯生效、界面状态还原；仅 macOS 可用 | `node tools/_frame-e2e.mjs` |

## 2. 夹具与模拟客户端

| 文件 | 用途 |
| --- | --- |
| `_lan-fixture.mjs` | 测试夹具：起真实局域网服务 + 本地假图源，stdout 打 `{ port, token, imageBase, ok }` 后常驻；供 `_lan-sync-check.mjs`、Android `LanIntegrationTest.kt` 与手工 curl 使用 |
| `_seed.cjs` | 截图种子数据（写入 localStorage，键名与 `AppStore.jsx` 的 browserFallback 对齐），由 `_shot.cjs` 注入后重载页面 |
| `_adb.sh` | adb 无线调试自动重连包装，设备地址由 `FOLIO_ADB_TARGET` 提供 |

## 3. 截图与视觉校验

| 文件 | 用途 |
| --- | --- |
| `_shot.cjs` | 用 Electron 离屏托管渲染层产物（优先 `out/renderer/`）并注入种子数据截图（`--out/--w/--h/--theme/--wait`） |
| `_snap.mjs` | 用系统 Edge headless 截渲染层产物（优先 `out/renderer/`），机制与 `_shot.cjs` 相同（`--out/--route/--theme`） |
| `_probe.mjs` | 读指定选择器的计算样式，诊断 CSS 层叠结果（`--sel/--props/--click`） |
| `_audit.mjs` | 批量验收：一次截出所有表面 × 主题，并做对比度检查 |
| `_vreg.mjs` | 视觉回归：`--save` 保存基线、`--diff` 统计像素差异，不引第三方依赖 |
| `_fontcheck.mjs` | 用 Edge 的 `document.fonts.check` 与逐字测量交叉验证字体真实可用（读 `EDGE_PATH`） |
| `_font-shot.cjs` | 在 Electron 主进程里走真实 IPC 验证字体链路（安装 → `fonts.json` → `font:list` → `FontFace`） |
| `_theme-check.cjs` | CDP 里逐张点主题卡，比对 `.app` 上计算后的 `--accent/--bg/--text` 与 `themes.js` 声明值 |
| `_feel.cjs` | 手感测量：rAF 采样 + CDP 真实鼠标事件，算按下深度、回弹峰值、稳定时间 |
| `_lan-ui.cjs` | 局域网面板 UI 冒烟：设置 → 网络 → 开开关 → 校验服务真的起来并截图（`--keep-on` 保持开启） |
| `_lan-panel-shot.cjs` | 局域网面板 E2E：真浏览器开书、滚动、进度回写桌面端磁盘，产出 `_lan-panel-*.png` |
| `_lan-cloud-shot.cjs` | 云端书（缓存命中）在手机面板的 E2E，产出 `_lan-cloud-*.png` |

以上多数需要 Electron 以 `--remote-debugging-port=9222` 启动。

## 4. 一次性排查

| 文件 | 用途 |
| --- | --- |
| `_boot-race.cjs` | 冷启动竞态复现：连续 reload，按固定时刻采样 `.view` 的 opacity 判断白屏 |
| `_strip-important.mjs` | 一次性剥离 `src/apple.css` 里的 `!important` |
| `_push-via-api.mjs` | git 协议被代理挡掉时，改走 GitHub git data API 推送提交（只打 `api.github.com`） |
| `apply-patch.mjs` | Windows 上编辑器偶发 `ReplaceFileW EIO` 时，按「原文/新文」分块补丁文件做精确替换 |
| `probe-sources.mjs` | 漫画书源端到端探针（search / info / toc / content），只读 `sources.json`，缓存写临时目录 |
| `run-dev.bat` | `npm run dev` 的 Windows 启动器，日志写 `tools/dev-run.log` |
| `诊断启动.bat` | 诊断启动：带 `--no-sandbox --disable-gpu --enable-logging` 启动，日志在 `%TEMP%\folio-diag.log` |
| `Folio-兼容模式.bat` | 受限账户 / 安全软件环境下用 `--no-sandbox --disable-gpu` 启动 `Folio.exe` |

## 截图产物

- `_lan-ui.png`、`_lan-panel-*.png`、`_lan-cloud-*.png` 由上面的截图脚本运行时生成。
- `plugins-timer.png`、`plugins-quality.png` 在仓库内没有任何脚本或文档引用，属历史残留。
