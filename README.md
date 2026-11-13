# Folio · 沉浸式阅读器

一个用 **Electron + React** 打造的极简电子书阅读器。主页就是书架，一切交互都为「读进去」服务：
克制的排版、干净的界面、随滚动淡出的工具栏、可调的中文排版。

![version](https://img.shields.io/badge/version-2.5.0-2b2e33) ![license](https://img.shields.io/badge/license-MIT-087ea4) ![platform](https://img.shields.io/badge/Windows-10%20%2F%2011-2b2e33) ![tech](https://img.shields.io/badge/Electron-30-2b2e33) ![tech](https://img.shields.io/badge/React-18-087ea4)

---

## 下载

Windows 10/11 x64。**便携版双击即用，不用装。**

| 产物 | 适用场景 |
| --- | --- |
| [`Folio-Setup-2.5.0.exe`](https://github.com/flulwh/folio/releases/tag/v2.5.0) | **推荐**。NSIS 安装包，可选安装目录，创建桌面/开始菜单快捷方式，卸载保留用户数据 |
| [`Folio-Portable-2.5.0.exe`](https://github.com/flulwh/folio/releases/tag/v2.5.0) | 单文件便携版，双击即用，不写注册表 |
| [`Folio-2.5.0-win-x64.zip`](https://github.com/flulwh/folio/releases/tag/v2.5.0) | 免安装压缩包，解压后运行 `Folio.exe` |
| [`Folio-2.5.0-android.apk`](https://github.com/flulwh/folio/releases/tag/v2.5.0) | **Android 8.0+**。原生客户端，离线读本地书，连上桌面端同步进度 |

历史版本见 [Releases](https://github.com/flulwh/folio/releases)。升级不丢数据：`appId` 与包名不变，`books.json` / `progress.json` / `settings.json` / `sources.json` / `rules.json` 格式保持兼容。

> **双击没反应？** 少数受限 Windows 环境里 Chromium 沙箱起不来，需要带 `--no-sandbox` 启动。见 [排障文档](docs/troubleshooting.md#1-双击-exe-没有任何反应进程也看不到)。

---

## 30 秒上手

1. 打开 Folio，书架是空的 —— 点「**读示例《山居手记》**」先看看沉浸阅读是什么感觉
2. 想读自己的书：点书架右上角「**导入**」，选 `.txt` / `.md`；或把文件**直接拖进窗口**
3. 点书卡进阅读器。滚到底自动续章，`T` 开目录，`A` 开自动滚动，`Esc` 回到书架

想读网络小说：设置 →「书源」导入一份 Legado 书源，然后在「**书籍市场**」搜书 → 点「读」直接进书架。

---

## 截图

| 书架 | 沉浸阅读 | 目录 | 自动滚动 |
| --- | --- | --- | --- |
| ![书架](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/bookshelf.png) | ![阅读器](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/reader.png) | ![目录](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/toc.png) | ![自动滚动](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/auto-scroll.png) |

| 书籍市场 | 云端阅读 | 漫画 | 深色主题 |
| --- | --- | --- | --- |
| ![书市](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/book-market.png) | ![云端阅读](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/cloud-reader.png) | ![漫画](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/comic.png) | ![深色](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/night.png) |

| 设置 · 外观 | 设置 · 阅读 | 运行日志 |
| --- | --- | --- |
| ![外观](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/themes-appearance.png) | ![阅读](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/settings-page-reading.png) | ![日志](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/logs.png) |

---

## 核心能力

### 书架

- 导入本地 `.txt` / `.md`（含 Markdown），支持**编码嗅探**（UTF-8 / UTF-8 BOM / GBK / UTF-16 自动识别）
- 书卡由书名哈希落到六组封面配色，悬停浮起 + 扫光
- **继续阅读**大卡：一键回到上次读到的那一行
- 搜索（按 `/` 聚焦）、排序（最近阅读 / 添加时间 / 书名）、删除确认
- 内置示例书《山居手记》，装好即可体验

### 沉浸式阅读器

- **虚拟滚动**：几百万字的长篇也只渲染视口附近的段落，滚动不掉帧
- **正则章节识别**：默认规则覆盖「第X章 / Chapter N / 序章 / 楔子 / 【标题】」等常见写法，也能在设置里写自己的正则
- **目录抽屉**：章节搜索、当前章高亮、点击平滑跳转
- **进度保存**：以「段落索引」为锚点自动保存，换字号、换宽度后依然能回到原处
- **自动滚动**：15 / 25 / 40 / 60 px/s 四档速度，`[` `]` 随时调速，到底自动停，滚轮即可接管
- **排版可调**：字号、行距、正文宽度、段间距、首行缩进、无衬线 / 衬线 / 等宽
- **用户字体**：可安装自己的 `.ttf` / `.otf` / `.ttc` / `.woff` / `.woff2`，安装时就告诉你这字体含不含中文
- 工具栏 **2.5 秒无操作自动隐藏**（zen 模式），进入全屏后只剩文字
- **缓动滚动**：章节跳转、翻页、回到上次位置都是 240–640ms 的 ease-out 滑行，任何一次滚轮/触摸都立刻打断动画交回手感
- **排印细节**：`text-wrap: pretty` 避免尾行孤字、`hanging-punctuation` 让句读悬挂、`font-feature-settings: 'palt'` 收紧中文标点

### 局域网面板 —— 手机上也能读

同一 Wi-Fi 下，手机/平板的**浏览器**就能打开书架，还能接着往下读。

```
设置 → 网络 → 开启面板
手机打开  http://192.168.1.3:7788/?t=7KQ2MX
```

- **手机能读**：本地 txt 正文由桌面端按需提供；本地书自动切出章节目录，云端书的目录与章节由本机的书源引擎现抓，手机上能翻目录、上下章切换
- **找书更快**：书名/作者/章节搜索，在读/未读/本地/云端筛选，四种排序，网格与列表两种布局
- **读得顺手**：底部进度条可直接拖动定位（本地书按段落、云端书按全书比例），点正文收起工具栏，阅读偏好（字号/行距/字体/宽度/夜间配色）只存在这台设备
- **双端同步**：手机上读一段，桌面端书架立刻更新；桌面端读一段，手机上轻提示「桌面端已同步到 xx%」。合并规则统一为 `updatedAt` 新的赢，两边都不打断手上的滚动
- **断网不丢进度**：顶部提示条明说「有一处进度还没同步」，联网后自动补写
- **只读可关**：设置里关掉「允许写入阅读进度」，面板退化成纯看板
- 访问码 6 位、可一键更换；服务只监听内网，数据不经过任何第三方服务器

> Windows 首次开启会弹防火墙提示，必须允许「**专用网络**」，否则手机连不上。

架构、接口表与安全边界见 [docs/lan-panel.md](docs/lan-panel.md)。

### Android 客户端 —— 真正的离线阅读

浏览器面板胜在不装东西，但锁屏就断、翻页要等网络。原生客户端补上这两块：

```
桌面端：设置 → 网络 → 开启面板，记下地址与访问码
手机： 设置 → 桌面端连接 → 填地址和访问码（或点「搜索桌面端」）
```

- **本地书双端离线**：正文下到手机私有目录，飞机上、地铁里都能读；进度先存本地，连上 Wi-Fi 自动补写
- **云端书联网即读**：目录与章节由桌面端现抓，手机上照常翻章、跳章、拖进度条
- **进度不会打结**：合并规则仍是 `updatedAt` 新的赢，字段浅合并 —— 手机读一段，桌面端书架跟着变，反之亦然
- **省电**：没有前台服务、没有常驻通知、不轮询；后台同步交给系统的 WorkManager（15 分钟一次、要网络、电量不低），阅读页只组合可见段落
- **原生 Kotlin + Compose**，不是套壳 WebView；APK 约 11 MB

实现、同步细节与构建方式见 [docs/android.md](docs/android.md)。

### 外观与主题

- **两套皮肤随时切换**：设置 →「外观 → 界面风格」在 **Apple**（克制、留白、细描边）与 **MIUI Console**（大圆角、弥散阴影、弹簧回弹）之间切换，即时生效、随偏好保存
- **皮肤管形态，主题管颜色** —— 两件事正交。MIUI 皮肤 + 深色主题是合法组合，主色始终来自主题的 `accent`
- 四套内置主题（浅色 / 暖沙 / 深色 / 冷灰），还能「新建主题」调颜色实时预览，或「导入」一段主题 JSON
- **流体交互**：分段控件的选中块是一块会「滑过去」的拇指（弹簧跟随，不是硬切）；设置页分区切换按导航方向推拉淡入；漫画放大层支持双指捏合缩放、拖动平移、越界橡皮筋与松手回弹
- **减弱动效**：跟随系统「减少动态效果」与设置里的开关，滑块退化为颜色切换

### 书源与云阅读

Folio 不提供任何服务器，也不代理内容。你可以导入第三方「阅读」（Legado）书源，直接连源站搜索、追更、读正文。

- **导入**：订阅链接（支持 `legado://import/…`）、本地 JSON、粘贴 JSON
- **书源仓库**：一键从第三方仓库（3 万多个书源、30 多个合集）按单条 / 本页 / 整批导入
- **健康度**：试搜结果记在书源上，按「能用 → 没测过 → 失败 → 停用」排序，一键筛掉失效源
- **云端阅读**：搜到即加入书架，按 3 章一个窗口并行抓取正文，读到底自动续接；后台预取后续章节，不断流；某章抓失败会标占位并可一键重试，阅读位置不丢
- **净化规则**：兼容 Legado 的替换规则，章节标题与正文各跑一次
- **漫画 / 图片书**：`bookSourceType = 2` 的书源用图片阅读器打开，支持双指缩放、目录跳章、断网看已缓存章节

规则语法、脚本 API、兜底策略的完整规格在 **[docs/sources.md](docs/sources.md)**。

### 运行日志

书架右上角的终端图标。每一次网络请求、每一个 IPC 的耗时、目录解析走的每个分支都会记下来。

四个级别（只看错误 / 警告以上 / 常规 / 全部）+ 关键词过滤。点「导出日志」存到下载目录，直接发给别人即可。日志只写本机，不上传。

---

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `←` / `→` | 上一章 / 下一章 |
| `Space` / `PageDown` | 向下翻页 |
| `PageUp` | 向上翻页 |
| `Home` / `End` | 回到开头 / 跳到末尾 |
| `A` | 自动滚动开关 |
| `[` / `]` | 自动滚动减速 / 加速 |
| `T` | 目录 |
| `S` | 阅读设置 |
| `F` | 全屏 |
| `+` / `-` | 字号增减 |
| `Esc` | 关闭面板 / 唤醒工具栏 / 返回书架 |
| `/` | 书架页聚焦搜索 |
| `Ctrl` + `O` | 导入 TXT / Markdown |
| `?` | 快捷键说明面板 |

---

## 数据存在哪里

数据目录（Windows：`%APPDATA%\immersive-reader\ImmersiveReader\`）：

| 文件 | 内容 |
| --- | --- |
| `books.json` | **只有元数据**（书名、大小、副本路径、封面色、添加时间）—— 一本 30 万字的书只占一两百字节 |
| `books/<书名>.txt` | 正文副本，导入时从原文件复制一份。可以直接用记事本打开看、备份、搬走 |
| `progress.json` | 阅读进度 |
| `settings.json` | 排版与偏好 |
| `sources.json` / `rules.json` | 书源与净化规则 |
| `cloud/` | 云端章节缓存 |
| `covers/<sha1>.<ext>` | 云端书封面缓存，一次下载长期有效，断网也能显示 |
| `fonts/` + `fonts.json` | 你安装的字体文件与元信息 |
| `logs/<日期>.log` | 运行日志 |

- 删除书架上的书时**只删 `books/` 里的副本**（主进程会校验路径前缀），不会动你导入时的原文件
- 旧版本曾把整本正文内联在 `books.json` 里（书一多启动解析要十几秒），现在会自动把它们落盘成 `books/` 副本并删掉字段
- 想做便携版（数据跟着软件走），启动时给环境变量 `FOLIO_DATA_DIR` 指一个目录即可

---

## 开发

```bash
npm install       # 首次会下载 Electron，慢
npm run dev       # Vite 热更新 + Electron 窗口
npm run dev:vite  # 只跑浏览器里的 UI（无 Electron 时导入功能自动降级）
npm run check     # 发版门禁：版本一致性 / 语法 / 打包配置
npm run build     # 打出全部 Windows 产物
```

> 版本号只写在 `package.json`（当前 `2.5.0`），用 `npm version <new> --no-git-tag-version` 改。
> 界面里的版本由 Vite 的 `__APP_VERSION__` 注入，不要手动硬编码。

- 架构与目录职责 → [docs/architecture.md](docs/architecture.md)
- 性能实测与机制 → [docs/performance.md](docs/performance.md)
- 排障与常见坑 → [docs/troubleshooting.md](docs/troubleshooting.md)

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/lan-panel.md](docs/lan-panel.md) | 局域网面板：架构、接口表、同步链路、安全边界、故障排查 |
| [docs/sources.md](docs/sources.md) | 书源与净化规则：规则语法、脚本 API、兜底策略、云端阅读 |
| [docs/architecture.md](docs/architecture.md) | 分层与目录职责、关键设计取舍 |
| [docs/performance.md](docs/performance.md) | 实测数据、虚拟滚动、高度缓存、回归工具 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 启动白屏、沙箱、npm、书源导入报错等 |
| [docs/themes.md](docs/themes.md) | 主题扩展：自定义主题与主题 JSON |
| [docs/motion.md](docs/motion.md) | 动效系统：两套皮肤语言与参数 |
| [docs/audit-2026-10-24.md](docs/audit-2026-10-24.md) | 代码审计报告与修复清单 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |

---

## 设计取舍

- **只收纯文本**：EPUB 本质是 ZIP 容器，需要额外的解析与内联资源处理；本项目把「正则章节匹配」作为核心，纯文本更能把这套机制做透
- **进度锚在段落而非像素**：字号与栏宽随时可调，段落索引是唯一稳定的坐标
- **书源不做自建后端**：内容只在你的机器与源站之间流动，Folio 不托管、不中转、不缓存到云端
- **局域网面板零依赖**：只用 Node 内置 `http`，不引 WebSocket、不引任何 npm 包，打包体积不变

更多见 [docs/architecture.md](docs/architecture.md#三几处关键取舍)。

---

## License

MIT
