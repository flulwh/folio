# Android 客户端

Folio 的手机端，原生 Kotlin + Jetpack Compose，不套 WebView。

**3.0 起它是一台独立的阅读器**，不再是桌面端的遥控器：书可以只存在于手机上，
断网、关掉电脑也能读；桌面端从「必须先开的东西」降级成「可选的搬运工与云端代理」。

**3.1 再加一层「被管理」**：桌面端能看见这台手机、把书推过来 / 拉回去。
手机仍然没有后台任务，只在 App 打开且连上时才执行指令（见「设备管理」）。

`/api/library`（清单）· `/api/book/:id/download`（整文件，支持 Range）·
`/api/upload/chunk`（4MiB 分块）· `/api/toc` + `/api/chapter`（云端书）·
`/api/comic/:id/pages` + `/api/comic/:id/page`（漫画）。全部走
`X-Folio-Token`，桌面端不开也能用本机书。

## 两类书，两套规则

| | 本机书（`origin=LOCAL`） | 云端书（`isCloud`） |
| --- | --- | --- |
| 正文 | 手机私有目录 `books/<id>.txt` | 桌面端书源缓存，按章现取 |
| 断网 | **能读**，进度先存本地 | **不能读**，提示「云端书需要连接桌面端才能阅读」 |
| 同步 | 整文件双向（手机 ↔ 桌面端） | 不搬正文，只同步清单与进度 |
| 缓存 | 文件本身是数据，不叫缓存 | **零磁盘缓存**，正文只在内存待 3 章 |

「没连桌面端」不是错误状态，只是少了搬运能力：书架照常打开、本机书照常翻页，云端书标 `需连接`。

## 本机导入

「导入」走系统 `OpenMultipleDocuments`，可一次选多本（`text/plain`、`text/*`、`application/octet-stream`），单本上限 30MB。

- 编码识别：UTF-8（含 BOM）→ UTF-16 → GB18030，都不行按 UTF-8 硬解并保留原文
- 正文落 `books/<id>.txt`，先写 `.part` 再原子改名，中断不留半本书
- **不重复入架**：`contentHash = sha1(UTF-8 正文)`，撞上已有哈希就提示「《书名》已在书架里」
  并滚到那一本；书 id 还与桌面端下发的 id 归并，同一本书两台设备各导一次最后只剩一条

## 本地书同步

协议细节见 [lan-panel.md](lan-panel.md)，这里只说规则：

- **同一本书用 `contentHash`（sha1）判定**，不看文件名，改过名不会变成两本
- **上传** 4MiB 分块（`/api/upload/chunk`），单块 ≤6MiB；`offset` 不连续时服务端回 409
  带权威 `received`，从断点继续；收齐后服务端重算 sha1 再原子落盘
- **下载**走 `Range: bytes=N-` 续传，写 `.part` 后改名
- **两边都有但哈希不同** → 不猜不覆盖，标 `内容不一致` 挂起，等用户在同步状态页选
- **超过 30MB 不同步**（标 `仅本机`）；小于 20MB 的书连上就顺手搬（可关），
  计费流量下按「仅 Wi-Fi」让路

## 进度

与桌面端 `progress.json` 同构，字段名一字不差：

```jsonc
// 本机书
{ "paraIndex": 42, "chapterTitle": "第二章", "percent": 66.0, "updatedAt": 1794587125373 }
// 云端书 / 漫画（漫画的四个位置字段写的都是「话」）
{ "chapter": 417, "chapterIndex": 417, "windowBase": 417, "paraIndex": 42, "percent": 17.6 }
```

合并只有一条规则：**`updatedAt` 新的一方赢，字段浅合并**，不会用空值抹掉对端已有的信息。写入分三层，
任何一层断开都不丢：内存（滚动即刻更新）→ 本地磁盘（600ms 防抖写 `library/progress.json`）→
桌面端（1.5s 节流 POST `/api/progress`，失败进 `pending.json` 下次补写）。

**漫画按「话」对齐**：`chapter` / `chapterIndex` / `windowBase` / `paraIndex` 都写话序号，
`percent = (话下标 + 页下标 / 本话页数) / 话总数 × 100`（`core/ComicProgress.kt`）。话内页号不进
同步，只落在本机 `books.json` 的 `comicPage` 上 —— 换台设备从话首开始，好过污染两端口径。

## 零缓存

| 内容 | 落盘 | 说明 |
| --- | --- | --- |
| 本机书正文 | ✅ `books/<id>.txt` | 这就是数据本身，不是缓存 |
| 云端文章节 | ❌ | `ChapterMemoryCache` 只留最近 3 章 |
| 漫画图片 / 封面 | ❌ | `ImageLoader` 内存 LRU（≤96MiB，按堆 1/8 取小），不写 `cacheDir` |

自证靠读数：设置页「存储」里的**磁盘缓存**直接读 `cacheDir` 的实际大小，必须恒为 0，旁边挂
「零缓存」角标；单测 `ChapterMemoryCacheTest.读四章不产生任何磁盘文件` 断言文件数不变。

## 漫画阅读器

竖向整页流，item 先按屏宽等比占位（`aspectRatio`），图片到位前列表不跳高；双指 1–3x、
双击 2x、放大态拖动平移不越界（不引第三方缩放库）；`ImageLoader` 内 `Semaphore(3)` 限并发，
当前页变化预取 ±2 页，读到本话 80% 预取下一话；单页失败只影响那一页（占位显示原因 + 重试）。

## 连接桌面端

1. 桌面端：设置 → 网络 → 打开「局域网面板」，记下地址（形如 `http://192.168.1.3:7788`）与访问码
2. 手机：设置 → 桌面端连接，填地址与访问码，或点「搜索桌面端」
3. 点「测试连接」，看到「桌面端 2.7.0 · api 2 · 端口 7788 · 12ms」即为通

两者要在同一个 Wi-Fi，Windows 防火墙第一次询问选「允许访问」。搜索是 5 秒 UDP 广播，只在点的
时候发；App 没有前台服务、没有轮询，不读的时候不跑循环。

## 设备管理（3.1）

桌面端设置 →「我的手机」里能看到这台手机，并把书推过来 / 拉回去。手机侧只做三件事：
**报身份、收事件、执行指令**。

### 身份

`installId` 在第一次发设备请求时懒生成（UUID），写进 SharedPreferences，永不变更；
重装即换新，桌面端当作新设备。设备名取 `Build.MODEL`。所有请求统一带五个头：

```
X-Folio-Device: <installId>          X-Folio-Device-Name: <URL 编码的型号>
X-Folio-Platform: android            X-Folio-App-Version: 3.3.0
X-Folio-Api-Version: 2
```

不带头的请求能过鉴权但不建档 —— 旧版客户端与旧版桌面端都不受影响。

### 前台在线通道

App 在前台（`ON_START`）时挂一根 `/api/events` 的 SSE 长连接，退到后台（`ON_STOP`）
立即断开。桌面端一入队就 `publish('command')`，手机收到事件立刻拉队列执行，
不用等下一次手动同步。

**这是红线**：没有 WorkManager、没有前台服务、没有轮询。App 一死连接就没了，
桌面端显示「离线」是真的离线，不会出现「对着锁屏手机发指令、等一个永远不执行的队列」。

掉线 3 秒后重连。桌面端没有设备接口（心跳 404）时整条通道**静默关闭**，
既不改连接状态、也不弹错误 —— 只是设备管理不可用。

### 四条路由

| 方法 | 路径 | 手机什么时候调 |
| --- | --- | --- |
| POST | `/api/device/heartbeat` | 连上时、每次重连前；顺便拿 `pending` 条数 |
| GET | `/api/device/commands` | 收到 `command` 事件、或心跳报有积压 |
| POST | `/api/device/commands/:id/receipt` | 每条执行完（`done` / `failed` + `error`） |
| POST | `/api/device/snapshot` | 连接后 / 对齐结束 / 退出阅读器，60s 节流 |

### 指令与失败原因

三类指令逐条串行执行：`push-book`（Range 下载 + sha1 校验）、`remove-book`、
`pull-book`（4MiB 分块上传）。都复用 3.0 已有的传输代码，指令本身不携带字节。

| 回执 `error` | 什么时候出现 |
| --- | --- |
| `insufficient_space` | 剩余空间不够这本书 |
| `too_large` | 超过 30MiB 同步上限 |
| `hash_mismatch` | 下载完 sha1 对不上，已丢弃 |
| `network_interrupted` | 传到一半断了 |
| `user_rejected` | 删唯一副本时用户点了取消 |
| `source_gone` | 桌面端已经没有这份副本 |
| `unsupported` | 手机端版本太旧，不支持这条指令 |

**删唯一副本必须问人**：`remove-book{unique:true}` 会先弹「把《书名》从手机上删掉？」，
红字说明「手机上是唯一副本，手机端会再问你一次。」。点确认才动文件；点取消回执
`user_rejected`，正文一个字节都不改。

过期指令在桌面端清扫，手机领不到；迟到的回执会被 404 拒绝，不会把过期指令「救活」。

### 痕迹同步（3.3.0）

书签 / 划线 / 笔记走 `/api/marks`，与进度分开：一次拉整份，合并后再把差异推回去。
两端 id 不同，按 `kind|chapterNo|paraIndex` 对齐；`updatedAt` 新者胜。

删除不能靠并集判断，所以 `library/marks-sync.json` 保存「上次同步成功」的指纹。
本地有、远端没有、且本地自上次同步后没动过 → 判定为远端删除；反向同理，
由手机把 `remove` 列表显式发给桌面端。没有快照（首次同步）时只做并集，不会误删。

桌面端 `/api/marks` 返回 404（2.8.x 及更早）时整段同步静默跳过，
书架与进度照常，不把「老桌面端」判成同步失败。

## 构建

JDK 17+、Android SDK（`compileSdk 35`、`build-tools 35`）。

```bash
cd android && ./gradlew assembleDebug testDebugUnitTest
```

调试包包名带 `.debug` 后缀，可与正式包共存。正式签名走 `FOLIO_KEYSTORE` / `FOLIO_KEYSTORE_PASSWORD` / `FOLIO_KEY_ALIAS` / `FOLIO_KEY_PASSWORD`
四个环境变量，默认用 debug 签名。产物在 `android/app/build/outputs/apk/`。

## 测试

共 153 项，`./gradlew testDebugUnitTest` 一次跑完。`LanIntegrationTest` 21 项**真的起一个桌面端服务**
（ping / 清单 / 下载 / 分块上传 / 漫画取图 / 进度回写 / 错误访问码 / UDP 发现，
以及设备流的心跳建档 / 推书下载与 sha1 校验 / 过期清扫 / 唯一副本拒绝 / 快照上报），
缺 `node` 或 UDP 45678 被占用时跳过、不算失败；其余是纯函数与协议测试：
`CommandExecutorTest` 16、`SyncDiffTest` 13、`TextParserTest` 10、`SnapshotThrottleTest` 10、
`ProgressCodecTest` 8、`TextDecoderTest` 7、`BookImporterTest` 7、`SampleSizeTest` 7、
`ChapterMemoryCacheTest` 7（含「读四章不产生任何磁盘文件」）、`ProgressMergerTest` 7、
`ComicProgressTest` 6、`DeviceHeadersTest` 6、`HashUtilsTest` 5、`SyncEngineCloudTest` 5、
`ShelfSectionsTest` 5、`DeviceChannelTest` 5（Lifecycle 翻转 → 连接数 0→1→0）、
`ComicPageKeyTest` 4、`DeleteConfirmQueueTest` 4。

## 数据位置

`files/library/` 下四份 json：书架真相 `books.json`、进度 `progress.json`、待补写 `pending.json`、每本书的 `sync-state.json`；
本机正文在 `files/books/<id>.txt`（导入中为 `.txt.part`），设置在 `shared_prefs/folio_settings.xml`。
`cacheDir` 下没有 Folio 的文件 —— 这是红线，不是巧合。从 2.5 升上来时 `Migration` 会把老
`library/books.json` 的 `{"books":[...]}` 迁成顶层数组，并删掉 `offline/` 里那批章节副本。

## UI 架构（3.4.0 / Miuix）

界面层统一用 [Miuix](https://github.com/miuix-kotlin-multiplatform/miuix)（HyperOS 风格的 Compose 组件库），
`FolioTheme` 同时提供 `MiuixTheme` 与 `MaterialTheme`：组件用 Miuix，色板仍是纸 / 墨 / 朱，
圆角 10–28dp，强调色只出现在进度、开关与当前项。

| 文件 | 职责 |
| --- | --- |
| `ui/miuix/HyperKit.kt` | HyperOS 底部面板（弹簧上滑、下拉关闭）、分组卡片、行、开关、滑杆、胶囊分段、动作格 |
| `ui/ReaderScreen.kt` | 阅读页：浮动 HUD、点击 / 音量键翻页、滚动与翻页双模式切换 |
| `ui/reader/ReaderPager.kt` | 翻页模式：按章用 `TextMeasurer` 分页，超长段落按行切分，页脚显示页码 |
| `ui/reader/*Sheet.kt` | 目录 / 搜索 / 痕迹 / 排版四套面板，全部基于 `HyperSheet` |
| `ui/ShelfScreen.kt` | 书架：大标题、胶囊筛选、圆角书卡、底部浮动工具条 |
| `ui/SettingsScreen.kt` | 设置：分组卡片 + 开关 / 滑杆 / 分段 |
| `ui/SyncStatusScreen.kt` | 同步报告：状态卡、逐本账本、等宽诊断 |
| `ui/ComicReaderScreen.kt` | 漫画：深色图片区 + 浮动顶底栏 + 话目录面板 |

阅读方式存在 `folio_settings.xml` 的 `reading_mode`（`scroll` / `paged`），默认滚动。
翻页模式只对「当前章」分页，四十多万段的长篇也不会在打开时整本排版；
分页随字号 / 行距 / 页边距 / 屏幕尺寸变化自动重算。

## 已知限制

- **明文 HTTP**：局域网内不加密，访问码是唯一的门，别把端口映射到公网。
- **云端书必须连着桌面端**：想整本离线请用本机导入（云端书不做离线副本）。
- **超过 30MB 的书不同步**，只在本机读；封面取不到时退回首字色块。
