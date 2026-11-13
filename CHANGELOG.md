# Changelog

本文件记录 Folio 的正式版本变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。版本号唯一来源是 `package.json`。

## [2.5.0] — 2026-11-14

Android 原生客户端上线：本地书可以真正离线读，云端书连上桌面端就能读，
双端进度继续用同一套 `updatedAt` 规则对齐。

### 新增 · Android 客户端

原生 Kotlin + Jetpack Compose 实现（`android/`），不套 WebView，APK 约 11 MB。

- **本地书双端离线**：正文缓存到 App 私有目录，断网照常阅读；进度先落本地，
  联网后自动补写桌面端
- **云端书联网即读**：目录与单章正文走桌面端 `/api/toc`、`/api/chapter`，
  支持翻章、目录跳转、按全书比例拖进度条；读过的章节顺手缓存
- **双端进度**：与桌面端 `progress.json` 同构（本地书 `paraIndex`，
  云端书 `chapter` + `windowBase` + `paraIndex`），合并规则为 `updatedAt` 新的赢、
  字段浅合并；失败进 `pending.json`，下次联网补写
- **省电**：无前台服务、无常驻通知、无轮询；后台同步交给 WorkManager
  （15 分钟、需网络、电量不低），阅读页只组合可见段落，封面走 `LruCache`
- **局域网发现**：设置页「搜索桌面端」通过 UDP 广播找同一 Wi-Fi 下的桌面端。
  手机只在用户点按的时候广播一次，桌面端只在被问到时回一条
- **排版与外观**：字号、行距、页边距、主题色即时生效；书架支持搜索、
  全部/本地/云端/可离线筛选

### 桌面端

- `lan.js` 新增 UDP 发现服务（端口 45678，按需应答），供 Android 客户端搜到本机
- 桌面端版本随 Android 一起到 2.5.0；局域网接口与进度协议保持不变，
  2.4.0 的手机浏览器面板不受影响

### 测试

- Android：39 项（进度合并 7、正文解析 10、协议编解码 8、离线章节兜底 6、端到端 8）。
  端到端测试会真的起一个桌面端服务，用客户端代码走 HTTP 与 UDP
- 桌面端：局域网 47 项、发布前检查 12 项全部通过
- 真机（OPPO R11s / Android 11）：安装启动、书架同步、云端书阅读、
  目录、滚动后进度回写桌面端（两端 `updatedAt`、`paraIndex`、`percent` 完全一致）

## [2.4.0] — 2026-11-13

局域网面板从「能看书」重做成「能长期用的手机书房」，同时下线插件系统，
并修掉两个会在真机上遇到的同步缺陷。

### 移除

- **插件系统整体下线**：运行时、商店、面板、脚本一律不再提供，只保留核心阅读能力。
  - 删除文档 `docs/plugins.md`、`docs/store.md`
  - 删除示例插件 `examples/plugins/`（3 个）与商店目录 `store/`（目录清单 + 6 个插件）
  - 删除 `src/apple.css` 中约 500 行插件与商店的死样式
    （插件卡片、插件面板、插件自定义界面、插件 dock、商店列表与详情）
  - 删除 `tools/_timers.py`（针对已不存在的 `electron/plugins.js`）
  - 主题不再有 `owner` 字段与「插件」角标，主题只来自内置 + 自定义
  - 主题 JSON 导入的错误提示改用 `.theme-error`，取 `--danger` 令牌
  - 书源的 `@js:` 规则（`electron/jsengine.js`）与插件无关，保留

### 局域网面板升级

把局域网面板从「能看书」重做成「能长期用的手机书房」：视觉重做，
功能补齐，接口与进度协议保持不变，桌面端无需跟着改。

#### 书架

- **搜索**：书名、作者、书源、当前章节全文匹配，`/` 键直接聚焦
- **筛选**：全部 / 在读 / 未读 / 本地书 / 云端书
- **排序**：最近阅读 / 加入书架 / 书名 / 阅读进度
- **两种布局**：网格与列表，列表用细横线排版，适合长书架
- **开场页重做**：标题区 + 在读/藏书统计 + 继续阅读卡（进度、章节、上次时间）
- **连接状态常驻**：顶栏显示「已同步 / 同步中 / 未连接」，点一下即可重连

#### 阅读

- **本地书也有目录**：沿用桌面端的章节识别规则自动切章，支持目录搜索与跳章
- **目录抽屉**：支持搜索标题、当前章高亮并自动居中、一键回到当前章
- **进度条可拖动**：本地书按段落定位，云端书按「章号 + 章内比例」定位全书位置
- **阅读偏好面板**：字号、行距、宋体/黑体、正文宽度、页面配色
- **本机独立配色**：跟随桌面 / 纸白 / 米色 / 夜间，只影响这台设备，不写回桌面端
- **沉浸阅读**：点正文收起工具栏；云端书支持左右滑动翻章
- **桌面端位置提示**：桌面端读了新位置时给出「前往」按钮，不打断当前阅读

#### 可靠性

- **断网可见**：顶部提示条 + 「有一处进度还没同步」，恢复后自动补写
- **视口变化不再写偏**：旋转手机/改变窗口大小时钉住当前段落，
  不把浏览器自动重排当成用户滚动（旧版会偏好几段）
- **视口变化后仍能写回进度**：解锁「忽略滚动」不再只依赖 `requestAnimationFrame`。
  页面在后台时浏览器会节流甚至不触发 rAF，旧版漏掉这一帧就再也不会解锁 ——
  真机表现是「切后台再回来，阅读进度永远不更新」。现在由定时器兜底解锁
- 目录/正文加载失败时给出明确原因，并允许重试

### 修复

- **路径判断大小写敏感**：服务端用 `startsWith` 判断正文是否在书架目录内，
  而 Windows 路径本身大小写不敏感 —— `C:\Users` 与 `c:\Users` 指向同一目录，
  却会被判成越界，用户自己的书读不出来。改为统一的 `path.relative` 判断
  （同时挡得住相邻同前缀目录和 `..` 抬升）
- 新增 `electron/paths.js` 收敛路径判断，`tools/_paths-check.mjs` 守住它（11 项）

### 文档

- **README 重写为双层结构**：README 只保留「怎么用起来」——下载、30 秒上手、核心能力、
  数据位置、快捷键、开发命令；实现细节下沉到 `docs/`
- 新增 `docs/sources.md`：书源与净化规则的完整规格（规则语法全集、脚本 API、
  目录/正文兜底、正文净化、云端阅读、漫画）
- 新增 `docs/architecture.md`：进程模型、目录职责、关键设计取舍、主题与动效系统
- 新增 `docs/performance.md`：实测基线、虚拟滚动分块测量、高度缓存、书源引擎优化、回归工具
- 新增 `docs/troubleshooting.md`：启动白屏、沙箱、`ELECTRON_RUN_AS_NODE`、npm 11、
  书源导入报错、代理等常见坑
- `docs/README.md` 改成文档索引
- `docs/lan-panel.md` 补上面板功能清单与新版交互说明
- `docs/themes.md` 去掉「插件提供主题」一节，改为说明主题的安全边界

## [2.3.0] — 2026-11-13

把局域网面板里云端书的那块空缺补上：现在手机上也能翻目录、读章节，
不只是看个进度条。

### 新增

- **云端书在局域网面板上可读**：本机的书源引擎直接给面板供文
  - 主进程把云端书的目录/章节取数从 IPC handler 抽成可复用函数
    （`loadCloudToc` / `loadCloudChapter`），桌面端与局域网服务共用同一份逻辑
  - 服务端新增 `GET /api/toc/:id`（章名 + 章内段落数）与
    `GET /api/chapter/:id?i=N`（第 N 章正文，缺省取当前章）
  - 面板的云端书阅读视图：顶部显示章节名（可点开目录）、正文渲染、
    底部出现「上一章 / 下一章」
  - **目录抽屉**：当前章高亮并自动滚到可视区中部，点章节跳转后自动收起
  - **进度同一口径**：云端书用 `chapter` + `paraIndex` + `windowBase` 三元组，
    全书百分比按目录折算，翻章时百分比跟着走；写回时保留 `windowBase`
  - 章节正文不落盘，按需现抓；目录与章节走桌面端缓存，连着翻章不反复打源站
  - 抓不到时接口返回 `{error}`，面板明确显示原因，不假装有正文
- 回归工具 `tools/_lan-cloud-shot.cjs`（22 项）：铺 30 章云端书缓存 → 真浏览器开面板
  → 读正文 → 翻章 → 开目录 → 跳章 → 写回章号/章内位置/全书百分比 → 桌面端读到手机写的章号
- `tools/_lan-check.mjs` 扩到 46 项：新增云端目录/章节接口、越权 id、参数校验与错误分支

### 文档

- `docs/lan-panel.md` 补「本地书与云端书的两条正文路径」对照表（正文来源 / 目录 / 进度锚点）
- README、CHANGELOG、设置页「网络」分区文案同步改为「云端书在手机上也能读」

## [2.2.0] — 2026-11-13

把书架和阅读进度搬到局域网里：手机在同一 Wi-Fi 下用浏览器就能看、能读，读到哪里桌面端就跟到哪里。

### 新增

- **局域网面板**（设置 →「网络」）：同一 Wi-Fi 下，手机/平板打开
  `http://<电脑 IP>:7788/?t=<访问码>` 就能看到书架、每本书读到哪、以及「继续阅读」大卡。
  - **手机上能直接读**：本地 txt 正文由桌面端按需提供（`GET /api/book/:id`），
    滚动到哪都会把 `paraIndex` 写回本机的 `progress.json`
  - **双端实时同步**：桌面端写盘 → SSE 推给手机（只更新进度条，不打断滚动）；
    手机写盘 → IPC 回推桌面端，书架与「继续阅读」立即更新。合并规则统一为 `updatedAt` 新者赢
  - **云端书**在手机上只显示进度（正文依赖书源引擎），本地 txt 完整可读
  - **默认只读可关**：关掉「允许写入阅读进度」后 `POST /api/progress` 直接 403，面板退化成看板
  - 访问码 6 位（去掉 `0/O/1/I/L`），可一键更换；`timingSafeEqual` 比较，`/api/state` 不返回本地路径，
    正文路径必须落在 `books/` 内
  - 端口默认 7788，被占用自动顺延（最多 8 个）；零依赖，只用 Node 内置 `http`，
    面板不参与 vite 构建，打包体积不变
- 文档 `docs/lan-panel.md`：架构、接口表、同步链路、安全边界与防火墙排障
- 回归工具：`tools/_lan-check.mjs`（服务端 34 项，不依赖 Electron）、
  `tools/_lan-ui.cjs`（设置页开关 → 服务真的起来）、
  `tools/_lan-panel-shot.cjs`（真浏览器打开面板 → 读书 → 进度写回磁盘 → 桌面端接住）

### 修复

- 面板静态资源改为按 mtime 缓存：原先缓存在服务实例内，改完 CSS 得重启整个应用才生效
- 面板在 `pagehide` / 切后台时不再重新测量段落位置，改用最后一次滚动确认的 `lastIndex`——
  卸载时滚动条消失会让布局偏移，重算会把进度写偏几段
- 面板 hero 封面缺 `position: relative`，占位图会铺满整屏；书架封面缺显式 `width`，
  `aspect-ratio` 在 flex column 里算不出高度，封面塌成 0

## [2.1.0] — 2026-11-13

把 MIUI 皮肤从"换了个颜色"补成"换了一套动态语言"，并修掉三个会让人放弃使用的缺陷。
三处问题都是先用脚本定量复现、再动手改的，`docs/motion.md` 记了实测数据。

### 界面与交互

- **MIUI 动效独立成语言**：此前 MIUI 只换配色，动效仍是 Apple 那套"沉降"（交叉淡化 +
  `0.992→1` 缩放、临界阻尼）。现在两套语言并存——Apple 走沉降，MIUI 走**回弹 + 推进**：
  页面从右侧推入 34px、入书 `0.94→1`「长出来」、悬停只变色不位移、
  书架级联 26ms（能看出"一列列亮起来"）。
- **弹簧阻尼比刻意欠阻尼**：MIUI 五档 ζ≈.70–.93，过冲 1–2%；Apple 仍是 0.88–1.00 的临界阻尼。
- **按压不对称**：按下 80ms 直线到位（"我按到了"），松手 260ms 走
  `cubic-bezier(0.34,1.56,0.64,1)` 过冲。两个方向都做对称补间只会"淡一下"，这是此前 MIUI 手感发闷的根因。
- **控件手感重做**：开关橡皮筋（24→30px，位移补偿让右边缘不动）、进度拖动圆点放大 1.55 倍 +
  7px 光圈、滑杆 4px 轨道 18px 拇指、焦点环由内向外撑开、遮罩 10px 毛玻璃。
- **新增三个文件**：`src/motion-miui.js`（MIUI 动效词汇）、`src/motion-kit.js`
  （`useMotionKit()` 皮肤 → 套件映射，两套 kit 键名严格一致）、`src/miui-motion.css`
  （手感层，在 design/ 之后最后加载）。10 个组件改为按 `settings.skin` 取用。

### 修复

- **启动白屏**：窗口在后台时 Chromium 把 `requestAnimationFrame` 完全冻住（实测 0 帧/秒），
  而 framer 挂载时已同步写入首帧 `opacity: 0`。动画没有下一帧，整屏停在透明——内容全在，就是看不见。
  修复为 `webPreferences.backgroundThrottling: false`；实测 dev 3/6 白屏 → 0/6。
- **切皮肤后设置页空白**：切 Apple/MIUI 再点其他分区，内容停在上一个分区的 exit 终态
  （`opacity: 0`、位移 12/20px），`AnimatePresence mode="wait"` 等不到退场回调，新分区永不挂载。
  修复为 presence 树随 `key={skin}` 重建 + variants 引用固定 + 分区方向与分区合并为单次状态更新。
- **MIUI 下主题颜色与描述不符**：`--accent` 被硬写成 MIUI 蓝、`--bg/--text` 写死纯白纯黑、
  且 `forest`（冷灰，light 主题）被归进深色分支导致整套变黑。现在**皮肤只负责形态，配色交还主题**，
  灰阶用 `color-mix` 从 `text/bg` 派生，所有按主题 id 分深浅的地方改按 `data-theme-tone`。
- **`npm run dev` 在 IPv6 优选的 Windows 上起不来**：Vite 默认 host 解析为 `::1` 只监听 IPv6，
  而 `wait-on` 与主进程都连 `127.0.0.1`，两边永远对不上。已在 `vite.config.js` 显式 `host: '127.0.0.1'`。

### 行为变化

- **MIUI 皮肤不再固定蓝色**。默认（浅色主题）下为朱砂红，暖沙为米色棕调，冷灰为浅灰绿。
  皮肤风格改由圆角、灰阶、密度、动效承担，与主题卡的描述一致。

### 工具

- 新增四个回归脚本：`tools/_boot-race.cjs`（启动白屏率）、`tools/_feel.cjs`（逐帧手感测量）、
  `tools/_settings-blank.cjs`（切皮肤后分区切换）、`tools/_theme-check.cjs`（四主题令牌核对）。
  前两个补的是真盲区——截图与视觉回归全带 `?static=1`（`skipAnimations`），入场动画被整体跳过，
  于是 8 张图全绿但用户拿到白屏。

### 已知问题

- **分段滑块是瞬移而非滑动**：两套皮肤、生产构建均如此，`layoutId` 的共享布局动画在这套结构里未生效。
  修法需拆分语义——书架里拇指是 1px 下划线，设置页是胶囊，统一到容器层驱动会把下划线变成实色块。
- Apple 的 `SPRING` 缺 `control` 键，`Segmented` 取 `kit.spring.control` 时拿到 `undefined`。

## [2.0.0] — 2026-11-07

「工业级发布」大版本。**业务契约完全不变**：IPC 通道、数据文件格式、UI 交互、书源规则语义均与 1.x 一致，
升级不影响已有书架、进度、书源与净化规则。

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
> 不执行任何 exe）提取卸载器，详见上方「打包」小节。

## [1.0.0]

初始功能版本：书架与本地 TXT/MD 阅读、虚拟滚动、章节识别、Legado 书源与净化规则、
云端阅读与漫画模式、日志面板。功能清单见 README。
