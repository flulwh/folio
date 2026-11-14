# 架构

Folio 的代码量不大，但每一层都有明确的边界。本文说明分层、目录职责和关键设计取舍。

---

## 一、进程模型

```
┌─────────────────────────────────────────────┐
│ 主进程（electron/，Node 环境）              │
│                                             │
│  文件 IO · 编码转换 · JSON 持久化            │
│  书源引擎 · 脚本运行时 · 抓取与缓存          │
│  局域网 HTTP 服务（Node 内置 http）          │
│                                             │
│  ┌──────────┐  IPC   ┌──────────────────┐  │
│  │ 渲染进程 │◀──────▶│ preload (cjs)    │  │
│  │ React    │        │ contextBridge    │  │
│  └──────────┘        └──────────────────┘  │
└─────────────────────────────────────────────┘
```

渲染进程**不碰文件系统**。所有落盘、编码转换、抓取都走 IPC 到主进程；渲染层只拿到已解析好的数据。

`preload` 用 `.cjs`：`package.json` 是 `type: module`，而 Electron 的 sandbox preload 仍按 CommonJS 加载。

---

## 二、目录职责

```
electron/          主进程
├── main.js          窗口、IPC、JSON 存储、日志、崩溃自愈、局域网服务接线
├── preload.cjs      contextBridge 暴露 window.readerAPI
├── html.js          容错 HTML 解析 + 轻量 CSS 选择器（编译缓存）
├── xpath.js         轻量 XPath 求值（预编译路径/谓词、迭代后代轴）
├── sources.js       书源规则解析 / 搜索 / 目录 / 正文
├── replace.js       净化规则（Legado 替换规则）：正则改写 + @js 替换
├── repo.js          书源仓库客户端（yiove 接口 + 区间导入）
├── jsengine.js      Legado @js: 脚本运行时（java.ajax / cookie / cache）
├── cloudstore.js    云端章节磁盘缓存（独立文件，便于 sources.js 整体懒加载）
├── fontmeta.js      字体文件族名解析（ttf/otf/woff，零依赖）
├── logger.js        按天滚动日志 + 内存 ring + IPC 耗时 span
├── devicestore.js   设备记录与指令队列（devices.json）
├── lan.js           局域网 HTTP 服务：鉴权、路由、进度合并、SSE
├── lan-panel.html   面板骨架（不参与 vite 构建）
├── lan-panel.css    面板样式
├── lan-panel.js     面板逻辑：书架、阅读器、分段、进度上报、SSE
└── lan-login.html   输入访问码页

src/                渲染层（React）
├── main.jsx           入口
├── App.jsx            路由（书架 / 书籍市场 / 设置 / 本地阅读 / 云端阅读）、主题注入、Toast
├── store/AppStore.jsx 全局状态与持久化适配器
├── design/            设计令牌与分区样式
│   ├── tokens.css     主题令牌的唯一真相来源
│   ├── base.css       基础层
│   ├── shelf.css      书架
│   ├── library.css    书市 / 书源 / 设置
│   └── reader.css     阅读器
├── index.css          Apple 皮肤
├── miui.css           MIUI 皮肤源文件
├── skin-miui.css      由 miui.css 作用域化生成的产物（勿直接改）
├── miui-motion.css    MIUI 的按下 / 悬停 / 拖动
├── themes.js          主题令牌副本（设置页预览卡 + 运行时注入）
├── motion.js          Apple 动效套件
├── motion-miui.js     MIUI 动效套件
├── motion-kit.js      皮肤 → 套件映射，唯一取用入口
├── hooks/             useVirtualScroll / useCachedCover / usePresence / useFontLoader
├── utils/             chapters / sortedIndex / text / format / friendly / shortcuts
├── data/sampleBook.js 内置示例书《山居手记》
└── components/        Bookshelf / BookMarket / Reader / CloudBook / ComicReader /
                       SourcePanel / RepoBrowser / SettingsPage / SettingsPanel /
                       FontManager / LogPanel / TocPanel / ShortcutHelp / Segmented / Icons

scripts/             构建与发版
├── start-electron.mjs     干净环境变量启动（Windows --no-sandbox 兼容）
├── build-win.mjs          Windows 打包入口（静态解析 NSIS 卸载器）
├── verify-release.mjs     发版门禁（npm run check）
└── nsis-static-uninstaller.cjs

tools/               回归与验证脚本（见 performance.md）
```

---

## 三、几处关键取舍

| 决定 | 原因 |
| --- | --- |
| **只收纯文本** | EPUB 本质是 ZIP 容器，需要额外的解析与内联资源处理。本项目把「正则章节匹配」作为核心，纯文本更能把这套机制做透。导入二进制文件会给出明确提示 |
| **进度锚在段落而非像素** | 字号与栏宽随时可调，段落索引是唯一稳定的坐标 |
| **段落间距用 `padding`** | 虚拟滚动是绝对定位的，`margin` 不计入 `offsetHeight`，会让相邻段落重叠 |
| **自动滚动用浮点游标 + 绝对赋值** | Chromium 会丢弃 `scrollTop += 0.02` 这类亚像素增量，逐帧累加只会原地不动；内部维护浮点游标，每帧把 `cursor + speed × dt` 直接赋给 `scrollTop` |
| **滚动动画自研 rAF，不用 `scroll-behavior: smooth`** | 原生平滑滚动时长不可控、也无法在滚轮介入时干净地被打断；自研缓动可按距离给 240–640ms、末帧精确对齐偏移表、随时 `cancelAnimationFrame` 交还控制权 |
| **书源不做自建后端** | 内容只在你的机器与源站之间流动，Folio 不托管、不中转、不缓存到云端；抓取与缓存都在主进程本地完成 |
| **`@js:` 用 `vm` + `curl`** | Legado 脚本的 `java.ajax` 是同步调用，只有子进程方案能同时满足「同步」和「带 cookie/代理」，且不必引入重量级依赖 |
| **云端阅读按窗口（3 章）加载** | 整本抓下来既慢又不礼貌；按窗口加载能让目录跳转、进度恢复、追加章节三者都不破坏段落索引 |
| **局域网面板零依赖** | 只用 Node 内置 `http`，不引 WebSocket、不引任何 npm 包；面板不参与 vite 构建，打包体积不变 |
| **局域网面板与桌面端共用取数函数** | `loadCloudToc` / `loadCloudChapter` 从 IPC handler 里抽出来共用，避免章节与段落口径在两端漂移 |

---

## 四、局域网面板为什么是「一份数据」

面板没有自己的存储，也没有云服务。它读写的就是桌面端的那几份文件：

```
dataDir/
├── books.json      书架（元信息）
├── progress.json   阅读进度（每本书一条，按 updatedAt 合并）
├── devices.json    设备档案、指令队列、最近 50 条 history
└── books/*.txt     本地书正文副本
```

写入永远是「读盘 → 按 `updatedAt` 合并 → 写盘」，所以两端不存在「谁是主」的问题。
内存里的渲染层副本靠 SSE / IPC 推送对齐。

设备管理（2.7）也共用同一套 SSE：`/api/events` 除 `book` / `progress` 外再发
`device`（在线翻转）与 `command`（指令入队）两种事件；手机侧四条路由
（`/api/device/heartbeat`、`/api/device/snapshot`、`/api/device/commands`、
`/api/device/commands/:id/receipt`）只做「收指令 / 收回执」，文件本身仍走 2.6 的
分块上传与 Range 下载。`apiVersion` 保持 2，能力靠 `features` 里的 `devices` 表达。
设备的 `online` 是派生值，不落盘。

详细架构、接口表与安全边界见 [lan-panel.md](lan-panel.md)；
设备管理的协议与状态机见 [arch-device-manager.md](arch-device-manager.md)。

---

## 五、主题系统

主题 = 一组 CSS 变量。令牌的唯一真相来源是 `src/design/tokens.css`；
`src/themes.js` 保留一份同样的令牌，用于设置页预览卡（预览卡要显示真实强调色）与运行时注入。

改 `tokens.css` 后要同步 `src/themes.js`，并跑 `npm run check:theme` 核对。

皮肤管**形态**（圆角、阴影、动效语言），主题管**颜色**。两者正交：
MIUI 皮肤 + 深色主题是合法组合，主色始终来自主题的 `accent`。

扩展方式见 [themes.md](themes.md)。

---

## 六、动效系统

动效分两套语言，跟着皮肤走，不是一套参数换数字。`src/motion-kit.js` 是唯一的取用入口。

细节见 [motion.md](motion.md)。
