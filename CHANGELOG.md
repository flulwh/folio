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

### 本机实测产物

受限环境下交付 **portable 单文件 + zip + 目录版** 三份（`release-2.0.0/`，详见该目录的「产物说明.md」）。
NSIS 安装包需在普通 Windows 机器或 CI（`windows-latest`）上产出：electron-builder 生成 NSIS 时会
**执行刚编译出的安装包**以提取 `uninstaller.exe`（`app-builder-lib/out/targets/nsis/NsisTarget.js:347`），
受限环境该步骤会失败并报 `Exit code: 2`。

## [1.0.0]

初始功能版本：书架与本地 TXT/MD 阅读、虚拟滚动、章节识别、Legado 书源与净化规则、
云端阅读与漫画模式、日志面板。功能清单见 README。
