# Changelog

本文件记录 Folio 的正式版本变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。版本号唯一来源是 `package.json`。

## [Unreleased]

### 界面与交互（Apple 化）

- **两套皮肤并存，Apple 重新上位**：此前 `miui.css` 用 95 处 `!important` 全局压制 `apple.css`，
  实际外观一直是 MIUI Console 风。现在 `miui.css` 被作用域化到 `[data-skin='miui']`
  （生成物 `src/skin-miui.css`，源文件仍是 `src/miui.css`），两套风格可随时切换；
  新增「设置 → 外观 → 界面风格」，默认 **Apple**。
- **分段控件流体化**：新增 `src/components/Segmented.jsx`——选中态是一块用 `layoutId` +
  弹簧（阻尼比 ≈ .99）滑过去的「拇指」，文字颜色交叉淡化，语义为 `tablist`（roving tabindex、
  `aria-selected` 同步）。书架排序、设置页字体/明暗/漫画显示方式、阅读器设置抽屉全部换用。
- **设置页推拉导航**：分区切换按导航顺序决定方向，内容以弹簧位移淡入淡出（`mode="wait"`），
  与 macOS 设置的推入观感一致。
- **漫画放大层手势**（Apple Photos 那一套）：双指捏合缩放（1–4 倍）、放大后拖动平移、
  越界橡皮筋阻尼与松手回弹、双击以点击点为中心放大到 2.5 倍；拖动中即时反馈（无过渡），
  松手后 280ms 缓动归位。捏合/拖动后的那一下 click 不再误关放大层。
- **按下即反馈**：分段项、设置侧栏项、书卡、市场卡片按下瞬间缩放至 0.97，不等抬起才响应。

### 窗口边框

- **macOS 原生边框**：`titleBarStyle: 'hiddenInset'` + `trafficLightPosition: {x:18,y:20}` + `roundedCorners`，
  红黄绿用系统原生控件，非自绘。
- **Windows 自绘交通灯**：同一套视觉用 `titleBarStyle: 'hidden'` + `thickFrame: true` 复刻，
  保留阴影、边缘缩放与 Aero Snap；设置 → 外观新增「macOS 边框」开关。
- **切换需重建窗口**：`titleBarStyle` 无法热改，运行时切换会重建 `BrowserWindow`；
  重建顺序为「先建新窗并显示、再销毁旧窗」，并配合 `pendingUiState` + `window:get-ui-state`
  还原当前视图与阅读进度，全程不会误触 `window-all-closed` 退出。
- **留白令牌化**：新增 `--traffic-reserve`（= 左偏移 + 3 个圆点 + 2 个间隙 + 一个间距 = 94px），
  书架 / 集市 / 阅读器 / 目录 / 设置 / 漫画 / 云端 gate 七个视图的标题栏统一走它，不再散落硬编码像素。
- **层级修正**：交通灯 z-index 提到 200 —— 窗口控件属于「窗口外框」，弹窗打开时也应可点，与 macOS 原生一致。

### 性能

- **Vite 手动分包**：`react` / `motion` / `vendor` 独立 chunk，`build.target: 'chrome124'`（对齐 Electron 30 的
  Chromium 124），开启 `cssCodeSplit` 与哈希化资源名。分包后入口 122 KB（gzip 44 KB）、
  react 142 KB（gzip 45 KB）、motion 115 KB（gzip 38 KB）。
- **路由级懒加载**：书源集市、设置页、云端阅读、漫画阅读四页改为 `React.lazy` + `Suspense`，首屏不再带上。
- **Context 细粒度拆分**：原来单一大 Context 拆成 12 个独立 Context，靠 `Symbol('missing')` 哨兵值兜底，
  单个状态变更不再触发整棵树重渲染。
- **主进程启动优化**：重模块改动态 `import`；外部命令探测改为单次 PATH 扫描（不再逐个 `curl` 试错）；
  字体改为非阻塞加载；开启 `v8CacheOptions: 'code'` 缓存编译产物。

### 打包

- **NSIS 不再依赖「执行安装包」**：新增 `scripts/nsis-static-uninstaller.cjs`，接管
  `NsisTarget.computeScriptAndSignUninstaller`，用 `UninstallerReader` 静态解析出卸载器（纯 JS，不跑 exe），
  解析失败才回退原逻辑；新增 `scripts/build-win.mjs` 以 `NODE_OPTIONS=--require` 注入后调 electron-builder，
  `build` / `build:nsis` / `build:portable` / `build:zip` / `build:dir` 全部改走它。
- **发版门禁扩充**：`npm run check` 增加「macOS 边框切换端到端」可选项（`--with-frame-e2e`），
  基于 CDP 驱动真实 Electron 窗口，验证开关 → 窗口重建 → 视图与进度还原的完整链路。

## [2.0.0] — 2026-11-07

「工业级发布」大版本。**业务契约完全不变**：IPC 通道、数据文件格式、UI 交互、书源规则语义均与 1.x 一致，
升级不影响已有书架、进度、书源与净化规则。

### 发布工程化

- 版本号升至 `2.0.0`，`package.json` / `package-lock.json` 同步；Electron 的 `app.getVersion()` 与
  渲染层「关于」页、浏览器预览降级值统一由 `vite.config.js` 的 `__APP_VERSION__` 注入，
  不再有多处硬编码版本号。
- `electron-builder` 从单一 `dir` 目标扩展为 **NSIS 安装包 + portable 单文件 + zip + 免安装目录** 四种产物；
  统一 `artifactName`、`copyright`、图标、执行级别，NSIS 允许改安装目录但卸载时保留用户数据。
- 新增 `npm run build:dir / build:portable / build:nsis / build:zip` 分步构建入口，
  便于在输出目录被安全软件占用时逐个构建到全新目录。
- 新增零依赖发版门禁 `npm run check`：版本格式、lockfile 同步、版本单一来源、
  36 个 JS/CJS/MJS 文件语法、打包目标与文件清单、dist 产物；CI 以 `--require-dist` 强制校验。
- 新增 GitHub Actions Windows CI：安装依赖 → 门禁 → 前端构建 → Electron 打包 → 产物上传；
  打 `v*` 标签时自动创建 Release。
- 新增 `LICENSE`（MIT）与本文件；README 的打包说明、产物名、目录结构与数据目录描述对齐实际实现。
- `appId` 与 `name` 保持不变，避免升级后 `userData` 路径漂移导致用户「书不见了」。

### 核心算法优化（同批次合入）

- `src/utils/chapters.js`：`countWords` 单次扫描替代多次 `match()` + 全文 `replace()`，
  额外空间 O(n) → O(1)；`parseBook` 正则编译 2 次 → 1 次；`chapterIndexForPara` 统一二分。
- `src/hooks/useVirtualScroll.js`：可视末行线性扫描 O(k) → 二分 O(log n)，
  抽出纯函数 `computeVisibleRange` / `indexAtOffset`；hook 对外返回值不变，仅新增 2 个导出。
- `electron/xpath.js`：路径与谓词按文本预编译缓存（lodash / TanStack / fb55 成熟算法内核，见源码注释与许可标注），
  后代轴改迭代 DFS，去掉每层 `filter()` 中间数组。
- `electron/html.js`：预处理从固定三次全文扫描改为按探针按需跳过（普通 HTML 零副本），
  选择器编译缓存、迭代 `walk`、位置伪类单次扫描、数字实体范围检查替代 try/catch。
- 新增 `src/utils/sortedIndex.js` 共享二分模块。未新增任何 npm 运行时依赖。
- 正确性：以 1.x 实现为 oracle 做差分对拍，**56,464 条断言全通过**；
  期间发现并修复一处真实回归（迭代版后代轴写入顺序反转导致 `//li[last()]` 返回首节点）。
  同机实测：`parseBook` 19.1→14.7 ms、短文档 `selectAll` ×5000 9.0→1.7 ms、
  `xpathText` ×300 29.6→13.7 ms、整表可见范围 ×200 14.9→0.1 ms。

### 兼容说明

- 最低 Node 构建版本 `>=18.17`（`engines`）。
- 保留 Electron 完整 locales，不精简语言包：避免打包阶段批量删除 `.pak` 文件影响受限环境的构建稳定性。
- portable 版默认以普通用户权限运行（`requestExecutionLevel: user`），不需要管理员。

### 产物

四种目标全部产出：**NSIS 安装包 + portable 单文件 + zip + 免安装目录**。

> 关于 NSIS：electron-builder 默认会在 Windows 上**执行刚编译出的安装包**，让它自己
> `WriteUninstaller` 出 `uninstaller.exe`（`NsisTarget.js` 的两阶段编译）。这一步在部分系统上会失败
> 并报 `Exit code: 2`——此时 `.onInit` 根本不会被调用，连裸 NSIS 脚本都跑不起来，属环境限制而非配置问题。
> 本项目改用 electron-builder 自带的 `UninstallerReader`（纯 JS 解析 PE 节表 + NSIS 数据块，
> 不执行任何 exe）提取卸载器，详见下方 [Unreleased] 的「打包」小节。

## [1.0.0]

初始功能版本：书架与本地 TXT/MD 阅读、虚拟滚动、章节识别、Legado 书源与净化规则、
云端阅读与漫画模式、日志面板。功能清单见 README。
