# 局域网面板

同一 Wi-Fi 下，用手机或平板打开浏览器就能看到书架、读到哪了，并且能接着往下读 ——
读到哪，桌面端就同步到哪。

```
设置 → 网络 → 开启面板
手机打开  http://192.168.1.3:7788/?t=7KQ2MX
```

---

## 它是怎么工作的

没有第二份数据，也没有云服务。面板读写的就是桌面端的那两个文件：

```
dataDir/
├── books.json      书架（元信息）
├── progress.json   阅读进度（每本书一条，按 updatedAt 合并）
└── books/*.txt     本地书正文副本
```

```
手机浏览器 ──HTTP──▶ 主进程内嵌的 http 服务 ──读写──▶ books.json / progress.json
                             │
                        SSE 推送 / IPC 回推
                             ▼
                     桌面端渲染层（React state）
```

三个关键设计：

1. **零依赖**：只用 Node 内置 `http`，不引 WebSocket、不引任何 npm 包。打包体积不变。
2. **单端口**：面板是一个 HTML + 一个 CSS + 一个 JS + 一条 SSE 长连接，全部由 `electron/lan.js` 托管。
   面板本身不打包进 `dist/`，也不参与 vite 构建。
3. **只有一份进度**：写入永远是「读盘 → 按 `updatedAt` 合并 → 写盘」，
   所以两端不存在「谁是主」的问题。内存里的渲染层副本靠推送对齐。

### 本地书与云端书的两条正文路径

面板里点开一本书，走哪条路由 `kind` 决定：

| | 本地书 | 云端书 |
| --- | --- | --- |
| 正文来源 | `GET /api/book/:id` 读 `books/` 里的 txt | `GET /api/chapter/:id?i=N`，由本机的书源引擎现抓 |
| 目录 | 无（一本书一段连续正文） | `GET /api/toc/:id`，面板里可翻目录 |
| 进度锚点 | `paraIndex`（全书段落下标） | `chapter` + `paraIndex`（章内段落下标）+ `windowBase` |

云端书的正文不落到 `books/`，每次按需现抓；目录和章节都带缓存（桌面端自己的缓存目录），
所以手机连着翻章不会反复打源站。抓不到时接口返回 `{error}`，面板直接显示原因，不会假装有内容。

进度写回时两种书都走同一个 `POST /api/progress`，云端书额外带上 `chapter` 与 `windowBase`，
合并是浅合并，所以桌面端读到的云端书进度不会被手机上的写入抹掉章口径。

### 双向同步的完整链路

| 方向 | 触发 | 链路 |
| --- | --- | --- |
| 桌面 → 手机 | 桌面端滚动结束（300ms 防抖写盘） | `store:set-progress` → `lan.publish('progress')` → SSE → 面板更新进度条，不打断滚动 |
| 手机 → 桌面 | 手机滚动结束（1.1s 节流） | `POST /api/progress` → 合并写盘 → `webContents.send('lan:progress')` → AppStore 合并 → 书架/继续阅读立即更新 |

两处都是 `updatedAt` 新的一方赢。相同时刻的写入不会覆盖对方的字段（浅合并），
所以云端书独有的 `windowBase` 不会被本地书写回时抹掉。

---

## 接口

所有接口都要访问码：`?t=<token>`、`X-Folio-Token` 头，或 `/auth` 换来的 cookie。
`GET /` 带 `?t=` 时会种一次 cookie 再 302 到 `/`，访问码不会留在地址栏和浏览历史里。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 面板页；没有访问码时返回登录页 |
| POST | `/auth` | 表单提交访问码，换 30 天 cookie |
| GET | `/assets/panel.css` \| `panel.js` | 面板静态资源 |
| GET | `/api/ping` | 健康检查 |
| GET | `/api/state` | 书架（去掉 `filePath`/正文/原始抓取数据）+ 全量进度 + 主题 + 服务信息 |
| GET | `/api/book/:id` | 本地书正文（≤12MB）；云端书返回 `409 {cloud:true}` |
| GET | `/api/toc/:id` | 云端书目录（章名 + 章内段落数），由本机书源引擎取，取不到返回 `{error}` |
| GET | `/api/chapter/:id?i=N` | 云端书第 N 章正文；`i` 省略时取当前章 |
| GET | `/api/cover/:id` | 封面：本地缓存有就发文件，否则 302 到源站 |
| POST | `/api/progress` | `{id, data}`，按 `updatedAt` 合并；只接受书架里存在的书 |
| GET | `/api/events` | SSE：`hello` / `progress` / `books` / `config` |

### 进度合并

```js
// electron/lan.js
mergeProgressEntry(current, incoming) // updatedAt 新的一方赢，字段浅合并
mergeProgress(current, patch)         // 整份合并，只在真有变化时返回新对象
```

面板在 `pagehide` / 切后台时用 `lastIndex`（最后一次滚动确认的段落索引）补存一次，
**不重新测量**：卸载时滚动条消失、视口变化会让布局偏移几段，重算会把位置写偏。

---

## 安全

- 默认 **只读可以关**：设置里「允许写入阅读进度」关掉后，`POST /api/progress` 直接 403 并广播新的 `config`。
- 访问码 6 位，字符集去掉了 `0/O/1/I/L`，念给别人不会错；比较用 `timingSafeEqual`。
- 只监听 `0.0.0.0`（局域网），不做 UPnP、不穿透 NAT。关掉应用即断。
- 不返回本地路径：`books.json` 里的 `filePath` 在 `/api/state` 里被剥掉，
  正文只按书 id 提供，且路径必须落在 `books/` 目录内。
- 请求体上限 512KB、单本正文上限 12MB、封面 4MB，防止误点或恶意请求把内存撑爆。

> HTTP，不加密。这是明确的取舍：数据不出内网，换取「输入一个地址就能用」。
> 公共 Wi-Fi 下建议关掉面板。

---

## 排障

| 现象 | 原因 / 处理 |
| --- | --- |
| 手机打不开、电脑本机可以 | Windows 防火墙拦了。首次开启会弹提示，要勾选「专用网络」；已拒绝的话去「允许应用通过防火墙」里把 Folio 的专用网络勾上 |
| 地址是 `169.254.x.x` | 网卡没拿到 DHCP 地址，重新连一下 Wi-Fi |
| 列表里出现好几个地址 | 装过 Docker / VMware / WSL / Tailscale 会有虚拟网卡。面板按「像不像家里的网」排序，第一个通常就对；虚拟网卡只降权不剔除（你可能真的在用 Tailscale） |
| 端口 7788 被占 | 自动往后顺延最多 8 个（7789…），设置页显示的是实际端口 |
| 改完面板样式没生效 | 静态资源按 mtime 缓存，改文件即生效；改 `lan.js` 本身要重启应用 |
| 换了访问码，手机被踢 | 预期行为。cookie 里存的是旧码，重新输一次即可 |

---

## 相关文件

| 文件 | 职责 |
| --- | --- |
| `electron/lan.js` | HTTP 服务、鉴权、路由、进度合并、SSE、端口顺延 |
| `electron/lan-panel.html` | 面板骨架 |
| `electron/lan-panel.css` | 面板样式（配色由主题注入，结构与桌面端一致） |
| `electron/lan-panel.js` | 面板逻辑：书架渲染、阅读器、分段、进度上报、SSE |
| `electron/lan-login.html` | 输入访问码页 |
| `src/components/SettingsPage.jsx` | 「网络」分区 UI |
| `tools/_lan-check.mjs` | 服务端回归（34 项，不依赖 Electron） |
| `tools/_lan-ui.cjs` | 设置页→开关→服务起来的冒烟 |
| `tools/_lan-panel-shot.cjs` | 端到端：真浏览器打开面板→读书→进度写回磁盘→桌面端接住 |

### 分段规则必须与桌面端一致

`paraIndex` 是两端都用的锚点。面板里的 `splitParagraphs()` 是
`src/utils/chapters.js` 的复刻（空行折叠成 `blank` 段、硬换行的续行合并、标题不并入上一段）。
**改了一边就要改另一边**，否则手机上存的段落号在桌面端会偏。

`tools/_lan-panel-shot.cjs` 里「按上次位置恢复（不是从头）」这条断言就是在守这个约定。
