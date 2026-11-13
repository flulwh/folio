# Android 客户端

Folio 的手机端，原生 Kotlin + Jetpack Compose，不套 WebView。
它连的是桌面端已经有的那个局域网服务（`electron/lan.js`），协议完全复用，
所以桌面端不需要为手机单独开接口。

```
手机 App  ──HTTP(X-Folio-Token)──▶  桌面端 7788 端口
    │                                  │
    ├─ 书架 / 进度  ◀── /api/state ────┤
    ├─ 本地书正文  ◀── /api/book/:id ──┤
    ├─ 云端书目录  ◀── /api/toc/:id ───┤
    └─ 云端书单章  ◀── /api/chapter/:id?i=N
```

## 三种阅读状态

| 场景 | 数据来源 | 能不能读 |
| --- | --- | --- |
| 本地书，已缓存 | 手机私有目录里的 txt | 断网也能读，进度先存本地 |
| 本地书，未缓存 | 桌面端 `/api/book/:id` | 需要连上桌面端，读完自动缓存 |
| 云端书，联网 | 桌面端抓取后按章下发 | 能读，读过的章节顺手缓存 |
| 云端书，断网 | 已缓存的章节 | 只能读缓存过的部分，目录降级成章号 |

本地书是桌面端书架目录里的 `.txt`/`.md` 文件，正文一次拿全，手机上按与桌面端
同一套规则切段、认章节（`core/TextParser.kt` 对应 `src/utils/chapters.js`）。
段落序号两端一致，进度才能互相认。

云端书有几百章，全量下载既慢又费流量。手动「下载到手机」只缓存前
`OFFLINE_CHAPTER_LIMIT`（12）章，其余章节在联网读到时自动落盘。

## 双端进度

进度条目与桌面端 `progress.json` 完全同构：

```jsonc
// 本地书
{ "paraIndex": 42, "chapterTitle": "第二章", "percent": 66.0, "updatedAt": 1794587125373 }
// 云端书
{ "chapter": 417, "chapterIndex": 417, "windowBase": 417,
  "paraIndex": 42, "chapterTitle": "第十节：为了明天！", "percent": 17.6,
  "updatedAt": 1794587125373 }
```

合并规则与桌面端 `mergeProgressEntry` 一致：**`updatedAt` 新的一方赢，字段浅合并**，
某一端缺字段时不会把对端已有的信息抹掉。

写入路径分三层，任何一层断开都不会丢进度：

1. **内存**：滚动时立刻更新状态，界面不卡
2. **本地磁盘**：600ms 防抖写 `files/library/progress.json`
3. **桌面端**：1.5s 节流 POST `/api/progress`；失败记进 `pending.json`，
   下次联网（手动同步、回到前台、后台周期任务）补写

`updatedAt` 用的是手机系统时间。手机与电脑时区/时间差太大时，以时间更新的
一端为准 —— 这是有意的取舍：宁可偶尔多覆盖一次，也不要有进度卡在旧值上。

## 省电

原生实现本身比 WebView 省一截，但真正耗电的是后台唤醒，所以：

- **没有前台服务、没有常驻通知、没有轮询**。App 不读的时候不跑任何循环。
- **后台同步交给 WorkManager**：15 分钟一次（系统允许的最小间隔），
  约束为「有网络 + 电量不低」，由系统合并唤醒，App 进程可以被随时回收。
- **网络请求只在用户动作时发**：打开书、翻章、拖进度条、点同步。
  HTTP 用系统自带的 `HttpURLConnection`，不引第三方网络库，没有常驻连接池线程。
- **封面按需加载**，`LruCache` 缓存 24 本，滚动时不重复请求。
- **阅读页无动画**，正文是 `LazyColumn`，只组合可见段落；离开页面即停止一切计时器。
- **局域网发现用 UDP 广播**，只在用户点「搜索桌面端」时发一次，手机端不常驻监听。

## 连接桌面端

1. 桌面端：设置 → 网络 → 打开「局域网面板」，记下地址（形如 `http://192.168.1.3:7788`）与访问码
2. 手机：设置 → 桌面端连接，填地址与访问码（或点「搜索桌面端」自动发现）
3. 点「测试连接」，看到「连上了桌面端」即可

手机与电脑要在同一个 Wi-Fi。Windows 防火墙第一次询问时选「允许访问」，
否则手机会看到「连不上桌面端」。

「搜索桌面端」依赖桌面端 2.5.0 起提供的 UDP 发现（`lan.js` 里的 `startDiscovery`）。
旧版桌面端不会回应广播，手动填地址照样能用。

## 构建

需要 JDK 17+、Android SDK（`compileSdk 35`、`build-tools 35`）。

```bash
cd android
./gradlew assembleDebug      # 调试包，包名带 .debug 后缀，可与正式包共存
./gradlew assembleRelease    # 发布包
./gradlew testDebugUnitTest  # 39 项测试
```

签名：默认用 debug 签名，方便直接安装。正式签名走环境变量：

```bash
FOLIO_KEYSTORE=/path/to/folio.jks \
FOLIO_KEYSTORE_PASSWORD=... \
FOLIO_KEY_ALIAS=... \
FOLIO_KEY_PASSWORD=... \
./gradlew assembleRelease
```

产物在 `android/app/build/outputs/apk/`。

## 测试

```bash
cd android && ./gradlew testDebugUnitTest
```

| 测试 | 项数 | 覆盖 |
| --- | --- | --- |
| `ProgressMergerTest` | 7 | updatedAt 胜负、字段浅合并、整份合并 |
| `TextParserTest` | 10 | 切段、硬换行合并、中英文章节、章节归属 |
| `ProgressCodecTest` | 8 | 进度/书架 JSON 与桌面端字段对齐 |
| `ChapterFallbackTest` | 6 | 断网时退到最近的已缓存章节 |
| `LanIntegrationTest` | 8 | **真的起一个桌面端服务**，用客户端代码走 HTTP 与 UDP |

`LanIntegrationTest` 会启动 `tools/_lan-fixture.mjs`（真实 `createLanService`），
验证书架、正文、单章、进度回写、旧进度不覆盖新进度、错误访问码被挡住、UDP 发现。
本机没有 `node` 时自动跳过。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| 书架缓存 | `files/library/books.json` |
| 进度缓存 | `files/library/progress.json` |
| 待补写进度 | `files/library/pending.json` |
| 本地书正文 | `files/offline/<hash>.txt` + `.json`（章节表） |
| 云端书章节 | `files/offline/cloud/<hash>-<章号>.txt` |
| 设置 | `shared_prefs/folio_settings.xml` |

卸载 App 会清掉离线缓存。桌面端的进度不受影响，重装后再同步一次就回来了。

## 已知限制

- **明文 HTTP**。局域网内不加密，换来「扫一眼地址就能用」。访问码是唯一的门，
  不要把端口映射到公网。
- **云端书离线只覆盖读过的部分**。要整本离线请用桌面端，或连着网一章章翻过去。
- **封面依赖桌面端能取到图**。源站图片挂了（如 404）时显示占位图标，不影响阅读。
- **不做书籍导入**。导入、书源管理、书籍市场仍然只在桌面端。
