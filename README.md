# Folio · 沉浸式阅读器

一个用 **Electron + React** 打造的极简电子书阅读器。主页就是书架，一切交互都为"读进去"服务：克制的排版、干净的界面、随滚动淡出的工具栏、可调的中文排版。

![version](https://img.shields.io/badge/version-2.2.0-2b2e33) ![license](https://img.shields.io/badge/license-MIT-087ea4) ![tech](https://img.shields.io/badge/Electron-30-2b2e33) ![tech](https://img.shields.io/badge/React-18-087ea4) ![tech](https://img.shields.io/badge/Vite-5-646cff) ![tech](https://img.shields.io/badge/Framer%20Motion-11-9d5cff)

---

## 截图

| 书架（空态） | 书架（有书 + 继续阅读） |
| --- | --- |
| ![书架空态](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/shelf-empty.png) | ![书架](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/bookshelf.png) |

| 沉浸阅读 | 自动滚动（可调速） |
| --- | --- |
| ![阅读器](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/reader.png) | ![自动滚动](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/auto-scroll.png) |

| 拖动进度条 | 目录（正则识别） | 阅读设置 | 深色主题 |
| --- | --- | --- | --- |
| ![拖动进度条](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/scrub.png) | ![目录](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/toc.png) | ![设置](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/settings.png) | ![深色](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/night.png) |

| 外部书源 | 净化规则 | 网上搜书 | 云端阅读（书源正文） |
| --- | --- | --- | --- |
| ![书源](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/sources.png) | ![净化规则](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/rules.png) | ![搜书](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/cloud-search.png) | ![云端阅读](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/cloud-reader.png) |

| 书源仓库 | 书源合集 | 云端书封面（本地缓存） |
| --- | --- | --- |
| ![书源仓库](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/repo.png) | ![书源合集](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/repo-collections.png) | ![封面](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/cloud-cover.png) |

| 漫画阅读（图片书） | 运行日志（调试） |
| --- | --- |
| ![漫画阅读](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/comic.png) | ![运行日志](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/logs.png) |

---

## 功能

### 界面风格与手感

- **两套皮肤随时切换**：设置 →「外观 → 界面风格」在 **Apple**（克制、留白、细描边）与
  **MIUI Console**（大圆角、弥散阴影、蓝色主色）之间切换，即时生效、随偏好保存。
  默认 Apple。两套样式互不干扰——MIUI 规则被限定在 `[data-skin='miui']` 下，不再全局压制 Apple。
  > `src/skin-miui.css` 是由 `src/miui.css` 作用域化生成的产物，改样式请改源文件后重跑
  > `node tools/_scope-skin.mjs`。
- **流体交互**：分段控件的选中块是一块会「滑过去」的拇指（弹簧跟随，不是硬切）；
  设置页分区切换按导航方向推拉淡入；漫画放大层支持双指捏合缩放、拖动平移、越界橡皮筋与松手回弹；
  所有可点元素按下即有形变反馈，不等抬起。
- **减弱动效**：跟随系统「减少动态效果」与设置里的开关，滑块退化为颜色切换，滚动与过渡不跳动。

### 书架首页

- 导入本地 `.txt` / `.md` 电子书，支持**编码嗅探**（UTF-8 / UTF-8 BOM / GBK 自动识别）
- 也支持把文件**拖进窗口**直接导入
- 书卡由书名哈希落到六组精心调过的封面配色，悬停浮起 + 扫光
- 继续阅读大卡：一键回到上次读到的那一行
- 搜索（按 `/` 聚焦）、排序（最近阅读 / 添加时间 / 书名）、删除确认
- 内置一本示例书《山居手记》，装好即可体验

### 沉浸式阅读器
- **虚拟滚动**：几百万字的长篇也只渲染视口附近的段落，滚动不掉帧
- **正则章节识别**：默认规则覆盖"第X章 / Chapter N / 序章 / 楔子 / 0001、【标题】"等常见写法，也可在设置里写自己的正则
- **目录抽屉**：章节搜索、当前章高亮、点击平滑跳转
- **进度保存**：以"段落索引"为锚点自动保存，换字号、换宽度后依然能回到原处；同时记录百分比与章节
- **自动滚动**：15 / 25 / 40 / 60 px/s 四档速度，胶囊里的 `−` `+` 或 `[` `]` 随时调速；到底自动停，滚轮即可接管
- 四套主题：浅色 / 暖沙 / 深色 / 冷灰
- 排版可调：字号、行距、正文宽度、段间距、首行缩进、无衬线 / 衬线 / 等宽三体
- 工具栏 **2.5 秒无操作自动隐藏**（zen 模式），进入全屏后只剩文字

### 局域网面板

- **同一 Wi-Fi 下的手机/平板**打开 `http://<电脑 IP>:7788/?t=<访问码>`，就能看到书架和每本书读到哪了
- **手机上能直接读**：本地 txt 正文由桌面端按需提供，滚到哪都会把位置写回本机的 `progress.json`
- **双端同步**：手机上读一段，桌面端书架立刻更新；桌面端读一段，手机上轻提示「桌面端已同步到 xx%」，
  两边都不打断你手上的滚动（合并规则是 `updatedAt` 新的赢）
- 云端书在手机上只显示进度（正文要靠书源引擎），本地 txt 完整可读
- 不想让手机写进度：设置 →「网络 → 允许写入阅读进度」关掉即可，面板退化成只读
- 访问码 6 位、可一键更换；服务只监听内网，数据不经过任何第三方服务器

### 阅读手感
- **缓动滚动**：章节跳转、翻页、回到上次位置都是 240–640ms 的 ease-out 滑行，不再瞬移；任何一次滚轮/触摸都会立刻打断动画，交回手感
- **拖动进度条**：按住底部进度条直接拖动，气泡实时跟随百分比，松手后正文轻轻浮现
- **发丝进度线**：滚动时顶部 2px 的进度发丝亮起，静止 0.9 秒后自动淡出，不占据注意力
- **排印细节**：`text-wrap: pretty` 避免尾行孤字、`hanging-punctuation` 让句读悬挂、`font-feature-settings: 'palt'` 收紧中文标点、`text-autospace` 拉开中西文间距、句读用 `line-break: strict` 处理避头尾
- **字距随字体自适应**：衬线 0.014em、无衬线 0.006em、等宽 0，同一套字号在不同字体下都不会发虚或发挤
- **章节名跨淡**：顶部当前章节随滚动原地淡入，不闪不跳

### 书和进度存在哪里
数据目录（Windows：`%APPDATA%\immersive-reader\ImmersiveReader\`）：

- `books.json` —— **只有元数据**（书名、大小、副本路径、封面色、添加时间）。一本 30 万字的书，这里只占一两百字节
- `books/<书名>.txt` —— 正文副本，导入时从原文件复制一份（重名内容不同会自动加 `-<hash>` 后缀）。可以直接用记事本打开看、备份、搬走
- `progress.json` / `settings.json` / `sources.json` / `rules.json` / `cloud/` —— 进度、排版、书源、净化规则、云端章节缓存
- `covers/<sha1>.<ext>` —— **云端书封面缓存**：书源给的封面地址只下载一次，落盘后书架直接读本地文件（自定义协议 `folio-cover://`），断网也能显示；下载失败则退回程序生成的纯色封面
- 删除书架上的书时，**只删 `books/` 里对应的副本**（主进程会校验路径前缀），不会动你导入时的原文件
- 旧版本曾把整本正文内联在 `books.json` 里（书一多启动解析要十几秒）。启动时会自动把那些 `content` 落盘成 `books/` 副本并删掉字段，books.json 体积随之收敛
- 想做成便携版（数据跟着软件走），启动时给环境变量 `FOLIO_DATA_DIR` 指一个目录即可

### 性能
一本 37 万字、5600 段的长篇，在这套实现下的实测（Ryzen 笔记本 / Electron 30）：

- **分块测量**：打开书时先精确量一遍每段高度（虚拟滚动依赖真实高度，否则滚动会跳）。5600 段一次性塞进 DOM 要冻结 1.8 秒，现在每帧只铺 600 段、量完用 `requestAnimationFrame` 让位给浏览器绘制 —— 首屏文字 **843ms** 就出现，顶部「正在排版 42%」提示进度，可读的区域先可读
- **高度缓存**：量完把 `{栏宽, 每段高度}` 存进 localStorage（键 = 书 ID + 字号 + 行距 + 宽度 + 段距 + 字体 + 缩进 + 段数），下次打开直接复用 —— 复开 **720ms**（原来 1533ms 且全程卡住）。缓存不盲信：先用真实 DOM 量第一批，和缓存逐段比对，偏差 > 2% 就丢弃重测（字体没加载完、窗口宽度变了都会命中这条回退）
- **书源列表瘦身**：书源 JSON 里有 `jsLib`（每个源几十 KB 的脚本）和全部规则文本，370 个源一次 IPC 传输 1.54MB、耗时 37ms。现在列表只传轻量字段（`id/name/host/group/enabled/stat/hasSearch/unsupported`），体积降到 **92KB（-94%）**、耗时 20ms；规则仍留在主进程，改开关不会再写回整表
- **写盘合并**：书源文件 1.6MB，过去每次试搜都整表重写。现在内存常驻 + 300ms 防抖 + 退出前 flush，连续试搜只落盘一次
- **搜索配额**：几百个源时全量搜索要 41 秒，现在按健康度取前 24 个并发搜（3 路），3 秒内出结果，剩下的可点「搜索全部」
- **打包版实测**（同一本 37 万字）：首开 **1035ms**、文字 **576ms** 就出现；复开 **543ms**；从上次位置恢复的误差 24px（文档总高 45 万 px）。开发模式（`npm run dev`）数字会略高，因为没做生产压缩

### 书源 / 云阅读（BYO）
Folio 不提供任何服务器，也不代理内容。你可以导入**第三方「阅读」(Legado) 书源**，直接连源站搜索、追更、读正文：

- **导入方式**：订阅链接（支持 `legado://import/bookSource?src=…` 写法，GitHub 地址会自动走 jsDelivr / `api.github.com` 镜像）、本地 JSON 文件、粘贴 JSON
- **兼容格式**：Legado 的 `bookSourceName` / `searchUrl` / `ruleSearch` / `ruleBookInfo` / `ruleToc` / `ruleContent`，含 `@js:` 脚本规则与 `@json:` 路径规则（内置一个沙箱 JS 运行时，模拟 `java.ajax`、`cookie`、`cache`、`source.*` 等 Legado API）；`@xpath:` 暂不支持，会在书源上标注
- **规则语法**：选择器链（`class.list@tag.a.0@href`）、**索引**（`tag.a.-1` 取倒数、`[2]` 单下标、`[!1,3]` 排除、`[0:4:2]` 区间带步长、`[-1:0]` 反向）、**旧式并列下标**（`tag.li.0:2` 取第 0、2 个，`!1` 排除）、**切片**（只对取值词生效：`@text[0:50]`）、`children.` 直系、`text.下一页` 按文字包含匹配选元素、属性算子（`[property$=book_name]`、`[attr~=a|b]`、`^=`、`*=`、`|=`）、伪类（`:eq(n)`、`:lt(n)`、`:gt(n)`、`:first`、`:last`、`:nth-child(n)`）、`||` 多候选、`&&` 首选、`%%` 按行交错合并、`##正则##替换` 后处理、`@put:{k:"规则"}` / `@get:{k}` 变量（可写在规则任意位置，也可内联成 `{{js表达式}}`）、`<js>…</js>` 与 `@js:` 脚本、`@CSS:` 原生 CSS、`@@` 转义、JSONPath（`$.data[*]`、`$..book_data[0]` 递归查找）、**XPath**（`@XPath:` 前缀，或以 `/`、`//`、`./` 开头自动识别：绝对/相对路径、`//` 后代轴、`*`、`text()`、`@attr`、`[n]`/`[last()]`/`[position()=n]`、`[@attr='v']`、`[contains(@attr,'v')]`、`[starts-with(@href,'/read/')]`、`[text()='v']`、顶层 `|` 并集）、`URL,{ 'method':'POST','body':'…' }` 请求选项（单引号也认）、任意属性名（`@onclick` / `@data-src`）；`@a` / `@li` / `@p` 这类标签名不会再被误当成属性名；多结果按 `\n` 连接、属性值自动去重（与 Legado 一致）
- **脚本 API**：`java.ajax / post / get / put / getString / getElements / getElement / setContent / htmlFormat`、`cookie.*`、`cache.*`、`source.*` 等常用子集；`java.getString(rule)` 可以在脚本里按规则取当前页面，`java.htmlFormat(html)` 按 Legado 的块级标签规则转纯文本；**`org.jsoup.Jsoup.parse(html)`** 有最小实现（返回 `.select()` / `.selectFirst()` / `.text()` / `.html()` / `.attr()` / `.getElementById()` / `getElementsByTag()` / `getElementsByClass()` / `.body()` / `.head()`），所以脚本里直接写 jsoup 的源也能跑
- **标准字段**：按 Legado `BookSource` 规范解析 `bookSourceName` / `bookSourceUrl` / `bookSourceGroup` / `bookSourceType` / `bookSourceComment` / `enabled` / `enabledExplore` / `searchUrl` / `exploreUrl` / `ruleSearch.{bookList,name,author,coverUrl,bookUrl,intro,lastChapter}` / `ruleBookInfo.{init,name,author,kind,intro,coverUrl,lastChapter,wordCount,tocUrl}` / `ruleToc.{chapterList,chapterName,chapterUrl,nextTocUrl}` / `ruleContent.{content,nextContentUrl,sourceRegex,webJs}` / `header` / `charset` / `jsLib` / `loginUrl` / `loginCheckJs` / `bookUrlPattern` / `concurrentRate` / `customVariables` / `weight` / `customOrder`；非文本类型（音频/图片/文件）会标注出来
- **订阅索引**：`[{title, url, home_page, tags}]` 这种「书源列表」（aoaostar / XIU2 / shidahuilang 的合集入口都是这个格式）可以直接粘链接导入，Folio 会逐个下载里面的书源文件再合并，并回报每个订阅新增了多少；条目里的相对路径按索引自身的地址补全，`github.com/<o>/<r>/raw/…` 会自动换 jsDelivr / api.github.com 镜像
- **目录分页**：`ruleToc.nextTocUrl`（或自定义格式的 `toc.next`）会真正被用来翻页——最多翻 30 页，按章节地址去重后合并，所以「下一页」式的分页目录能取全；目录本身取不到时仍走「目录入口探测 → 章节标题扫描」兜底
- **正文分页**：`ruleContent.nextContentUrl` 同样会翻页拼正文（最多 8 页），遇到重复/空白内容就停，避免死循环；拼完再做净化
- **详情回填**：`ruleBookInfo` 的 `name / author / kind / intro / coverUrl / lastChapter / wordCount` 会在取目录时顺带解析（支持先 `init` 里 `@put` 存变量再各字段 `@get`），书名、作者、简介、封面会补到书架与阅读器上（只补空字段，不覆盖你手动改过的）
- **失败提示**：站点被墙 / 超时 / 403 / JS 反爬（Cloudflare 那类）都会给出中文原因，而不是一句「无法解析」
- **规则兜底**：目录规则没命中时，会自动去页面上找「目录 / 全部章节」入口再取一次，仍不行就用章节标题特征（`第 N 章`、`序章`、`番外`…）扫描页面里的链接兜底，并提示「目录由自动匹配生成，可能不完整」；正文规则取到的内容不足 20 字时，按常见正文容器（`#content`、`.content`、`article`…）和长段落兜底。错误信息会带上抓了哪个地址、多少 KB，方便判断是规则问题还是站点问题；错误页的「重试」会跳过目录缓存重新抓
- **章节文件目录探测**：有些书源的 `tocUrl` 指向「最新章节」页（也可能 301 到书籍详情页），那里只有几条不带章号的更新记录，怎么启发式都凑不出目录。这时 Folio 会从页面里那些章节文件链接（`.../1418/1418705/157470008.html`）反推出**目录所在的文件夹**（`.../1418/1418705/`），去那里再解析一次——真实站点（如 `yeudusk`）实测能从 0 章救回 1038 章
- **DOM 脚本**：`java.getElement(rule)` / `java.setContent(html)` 有实现（返回 `.length` / `.size()` / `.text()` / `.html()` / `.attr()` / `.select()` 的 Elements 形态），起点这类用 DOM 选择器取列表的源也能跑；- **正文脚本（webJs）**：`ruleContent.webJs` 会真正执行——脚本拿到页面 HTML，可以配合 `java.getElement` / `org.jsoup` 自己抽正文，抽出来比规则更干净时会替换掉规则结果
- **浏览器 API 降级**：真正打开浏览器登录/过验证做不到，但 `java.startBrowserAwait` / `java.startBrowser` / `java.webView` 不再中断整条链路——它们返回空串并记一条日志，让目录/正文继续走兜底（多数源靠兜底能救回来）
- **正文净化**：抓到正文后先剔掉站点家具——导航行（`首页 分类 排行 上一章 下一章 加入书签`）、`本站所有…` 版权声明、`小说类别 / 写作状态 / 最后更新 / 最新章节` 元信息、`[点击阅读]` 推荐位、纯 URL 行、站点自己写的 `正文解析错误` 占位文案，以及「一行里挤着一整串章节名」的目录块；再用「中文字数 − 家具行数」给候选容器打分取最优，避免规则命中外层容器时把整页抓进来。已在本地缓存的旧章节需「清理缓存」后重开才会更新
- **书源健康度**：试搜（单个或「全部试搜」，并发 3、一次 12 个）的结果会记到书源上（命中数 / 失败 / 时间），书源列表按「能用 → 没测过 → 失败 → 停用」排序，可一键「只显示能用的」筛掉失效源；「网上搜书」也按这个排序并发 3 搜索，有活源时直接跳过最近失败的源（界面会说明跳过了哪些），失败源降权到后面
- **搜索配额**：书源上百个时，一轮默认只搜健康度最好的 24 个并在结果下方说明还剩多少，点「搜索全部」再放全量（也用于一次性把陌生源都试一遍）；没有 `searchUrl` 的书源会标「无搜索」并直接跳过，不会白等
- **Pixiv 书源**：[DowneyRem/PixivSource](https://github.com/DowneyRem/PixivSource) 这类纯 `@js:` 书源可以直接导入运行
- **网络代理**：书源面板里可填 HTTP 代理（如 `http://127.0.0.1:7890`）。`www.pixiv.net` 等站点在部分网络下直连不通，会提示"连不上 host，请填写代理地址"
- **云端阅读**：搜索结果点「读」即加入书架（书卡带 `书源` 角标），按 3 章一个窗口**并行**抓取正文，读到底自动续接下一批；阅读时后台预取后续 2 章，滚到底即时续上不断流；某章抓取失败不再截断窗口——文中标出占位，右下角一键重试补齐，阅读位置不丢；目录转圈补齐后可跳到任意章；进度按"窗口起点 + 段落"保存，重开继续读
- **云端书封面**：书架上的云端书会把书源提供的封面图下载到数据目录的 `covers/`，之后直接用本地文件渲染（`folio-cover://` 协议），一次下载长期有效、断网也显示；下载失败或书源没给封面时，退回按书名生成的纯色封面
- **全书进度**：云端书的阅读百分比按全书目录折算（章内位置 + 已读章数 / 总章数），书架进度条、「继续阅读」和剩余阅读时长都是全书口径，换窗口不再跳变
- **本地缓存**：抓过的目录与正文落在本地磁盘，重读同一章不再请求源站；书架书卡上的「缓存」按钮可查看已缓存章节数 / 目录抓取时间，并可一键清理；把书移出书架时缓存一并清除

### 书源仓库（一键导入）
书源面板里的「书源仓库」页直接对接第三方仓库 [shuyuan.yiove.com](https://shuyuan.yiove.com)（数据接口 `shuyuan-api.yiove.com`，3 万多个书源、30 多个合集）。我们只读取它的列表、按需下载书源 JSON，导入后仍然直连源站，不经过任何中转。

- **三种导入**：单条「导入」、整页「导入本页 20 个」（按仓库序号区间 `1-20` 一次取完）、整个合集（如「整合多个仓库」1424 个书源、「已效验书源383个」383 个）
- **浏览**：书源列表 / 书源合集两个子页签，支持服务端搜索（名称、站点）、分页（书源 1582 页、合集 2 页），每条显示站点、查看次数、收录时间
- **已导入识别**：按书源名称或站点域名匹配本机已有书源，已导入的显示「✓ 已导入」而不是按钮；重复导入走同一套合并逻辑（同 URL 更新规则、同 id 更新启用状态），不会长出重复条目
- **容错**：仓库连不上时给出中文原因并提示改用订阅链接；合集很大时下载 + 归一化需要十几秒，按钮显示「导入中…」

### 书源管理
- **筛选**：按名称 / 域名即时搜索，按分组（`bookSourceGroup`）下拉筛选，并可叠加「只显示能用的」
- **批量**：每行前面有勾选框，可逐条或多选（「全选」针对当前筛出的列表），批量**启用 / 停用 / 删除**
- **概览**：列表上方显示「共 N 个 · 启用 M 个 · 筛出 K 个」，每行带健康度徽标（`命中 30` / `无结果` / `失败`）与规则告警（`N 项规则不支持`、`已失效`、`无搜索`）
- **大列表**：一次渲染 60 行，其余点「显示更多」展开；列表只从主进程取轻量字段（`jsLib` 与各套规则留在主进程），一千多个书源的传输量从几 MB 降到几十 KB
- **排序**：默认「能用 → 没测过 → 失败 → 停用」，同档按命中数降序、再按名称拼音
- **试搜**：单条试搜或「全部试搜」（并发 3、一次 12 个），结果写回书源并在「网上搜书」时用于跳过失效源

### 净化规则（替换规则）

除了书源，Folio 也吃 Legado 的**替换规则**（很多书源合集里叫「净化规则」）。导入时自动识别：内容是书源数组就进「书源」页，是替换规则数组就进「净化规则」页。

- **导入方式**：同书源——订阅链接 / 本地 JSON / 粘贴 JSON。例如 `https://legado.aoaostar.com/sources/3f067eb2.json`（20 条规则，删广告尾巴、统一标点）
- **字段兼容**：`name` / `group` / `pattern` / `replacement` / `isRegex` / `isEnabled` / `order` / `scopeContent` / `scopeTitle`
- **作用时机**：章节标题显示前、正文进阅读器前各跑一次；原始文本仍以未净化形式缓存，规则改了不会影响已下载内容
- **`@js:` 替换**：`replacement` 可以是 `@js:` 脚本（逐匹配调用，`result` 为命中文本）
- **正则兼容**：Legado 的规则假设「汉字算 `\w`」，而 JS 的 `\w` 只认 ASCII。Folio 会把 `\w` / `\W` / `\h` 改写成等价的 Unicode 集合，否则整段中文会被吃掉

### 漫画 / 图片书

书源的 `bookSourceType` 是 `2`（图片）时，搜索结果带上「图片」标记，加入书架后会用**漫画阅读器**打开，而不是文字阅读器。

- **图片从哪来**：按 `ruleContent.content` 规则取。规则命中 `<img>` 就逐个取地址；命中容器就把里面所有 `<img>` 收集起来；`@js:` 规则可以返回 URL 数组或 HTML。规则什么都没取到时，退化为抓整页 `<img>` 并过滤 logo / 广告 / 占位图 / 小于 120px 的图标
- **懒加载兼容**：按 `data-src` → `data-original` → `data-echo` → `data-url` → `data-lazy-src` → `data-original-src` → `data-lazyload` → `src` 的顺序找真实地址；`src` 是 `blank.png` / `loading` / `placeholder` 这类占位图时会被跳过
- **本地缓存**：图片下载进 `covers/`，通过 `folio-cover://` 协议渲染，翻过的章节断网也能看；回看同一章不会重复抓页面
- **交互**：竖向滚动看页；点图片全屏放大（再点关闭）；`←` / `→`、`PageUp` / `PageDown` 换章；`T` 目录抽屉，可直接跳章；工具栏 2.6 秒无操作自动隐藏，点画面唤回；`Esc` 依次关闭「放大 → 目录 → 工具栏 → 退出」
- **进度**：按「第几章」记，回到书架点「接着读」直接从上次那一章开始
- **注意**：`type` 是搜索时由书源带出来的；旧的书架条目如果没有 `type`，重新搜一次再加进书架即可

### 日志（调试用）

书架右上角那个终端图标就是「运行日志」，也可以直接打开 `<数据目录>/logs/<日期>.log`。

- **记什么**：启动参数与版本、每个 IPC 的耗时与错误、每一次网络请求（URL / 状态码 / 字节数 / 编码 / 耗时 / 是否走代理）、目录解析走的每个分支（规则命中多少章、有没有去探测目录入口、章节文件目录探测结果）、正文解析（字数 / 分页数 / 是否走 webJs 兜底）、图片解析（张数）、书源 JS 的异常、渲染层未捕获的报错
- **怎么读**：四个级别（只看错误 / 警告以上 / 常规 / 全部），加关键词过滤，等宽字体对齐，`white-space: pre-wrap` 保留原始格式
- **怎么给我**：点「导出日志」，文件会存到下载目录，直接发我就行；也可以「复制」或「打开目录」自己看。日志只写在本机，不上传
- **不想太啰嗦**：默认「常规」级别；`FOLIO_LOG_LEVEL=debug` 环境变量可以把更细的 HTTP/curl 明细也记下来

### 快捷键

| 按键 | 作用 |
| --- | --- |
| `←` / `→` | 上一章 / 下一章 |
| `Space` / `PageDown` | 向下翻页 |
| `PageUp` | 向上翻页 |
| `A` | 自动滚动开关 |
| `[` / `]` | 自动滚动减速 / 加速 |
| `T` | 目录 |
| `S` | 阅读设置 |
| `F` | 全屏 |
| `+` / `-` | 字号增减 |
| `Esc` | 关闭面板 / 唤醒工具栏 / 返回书架 |
| `/` | 书架页聚焦搜索 |

---

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面壳 | Electron 30 (ESM main) | 主进程负责文件 IO、编码转换、JSON 持久化 |
| UI | React 18 + Vite 5 | 纯 CSS 变量驱动的四套主题 |
| 动画 | Framer Motion 11 | 书架进场、抽屉、章节提示、Toast |
| 虚拟滚动 | 自研 `useVirtualScroll` | 变高段落 + 二分定位 + ResizeObserver 重测 |
| 书源引擎 | 自研 `electron/sources.js` + `html.js` | Legado 规则解析、轻量 CSS 选择器、`@js` / `@json` 取值 |

| 书源仓库 | `electron/repo.js` | 抓 shuyuan-api.yiove.com 的列表 / 搜索 / 区间导入 |
| 脚本运行时 | 自研 `electron/jsengine.js` | Node `vm` + `curl` 同步取页，模拟 Legado 的 `java` / `cookie` / `cache` API |
| 持久化 | 主进程 JSON（原子写） | 浏览器预览时自动降级 localStorage |
| 发版 | electron-builder 24 + GitHub Actions | 四种 Windows 产物，`npm run check` 发版门禁 |

---

## 目录结构

```
.
├── electron/
│   ├── main.js            # 主进程：窗口、文件读取、编码嗅探、IPC、JSON 存储、日志与崩溃自愈
│   ├── preload.cjs        # contextBridge 暴露 window.readerAPI
│   ├── html.js            # 容错 HTML 解析 + 轻量 CSS 选择器（编译缓存）
│   ├── xpath.js           # 轻量 XPath 求值（预编译路径/谓词、迭代后代轴）
│   ├── sources.js         # 书源规则解析 / 搜索 / 目录 / 正文 / 缓存
│   ├── replace.js         # 净化规则（Legado 替换规则）：正则改写 + @js 替换
│   ├── repo.js            # 书源仓库客户端（yiove 接口 + 区间导入）
│   ├── jsengine.js        # Legado @js: 脚本运行时（java.ajax / cookie / cache）
│   └── logger.js          # 按天滚动日志 + 内存 ring + IPC 耗时 span
├── src/
│   ├── main.jsx           # React 入口
│   ├── App.jsx            # 路由（书架 / 本地阅读 / 云端阅读）、主题注入、Toast
│   ├── index.css / apple.css / miui.css  # 设计令牌与主题
│   ├── store/AppStore.jsx # 全局状态与持久化适配器
│   ├── hooks/             # useVirtualScroll（二分定位）/ useCachedCover / usePresence
│   ├── utils/             # chapters / sortedIndex / text / format / friendly / shortcuts
│   ├── data/sampleBook.js
│   └── components/        # Bookshelf / Reader / CloudBook / ComicReader / SourcePanel /
│                          # RepoBrowser / BookMarket / SettingsPage / LogPanel / TocPanel …
├── scripts/
│   ├── start-electron.mjs # 干净环境变量启动（Windows --no-sandbox 兼容）
│   ├── verify-release.mjs # 发版门禁（npm run check）
│   └── check-nonword.mjs
├── .github/workflows/build.yml  # Windows CI：门禁 → 构建 → 打包 → 上传产物
├── CHANGELOG.md / LICENSE       # 变更记录 / MIT 许可
├── index.html
├── vite.config.js         # __APP_VERSION__ 注入
└── package.json           # 版本号唯一来源 + electron-builder 配置
```

---

## 开发与打包

```bash
# 安装依赖（Electron 首次下载较慢）
npm install

# 开发：Vite 热更新 + Electron 窗口
npm run dev

# 只跑浏览器里的 UI（无 Electron 时导入功能自动降级）
npm run dev:vite

# 发版前自检：版本一致性 / 语法 / 打包配置 / 构建产物
npm run check

# 构建前端产物
npm run build:vite

# 一次打出全部 Windows 产物（安装包 + 单文件 + zip + 免安装目录）
npm run build
```

> 版本号只写在 `package.json`（当前 `2.2.0`）。用 `npm version <new> --no-git-tag-version` 改版本，
> 会同步 `package-lock.json`；界面里的版本由 Vite 的 `__APP_VERSION__` 注入，别再手动硬编码。
> CI 会跑 `npm run check -- --require-dist`，版本漂移或语法错误直接红灯。
> 版本变更记录见 [CHANGELOG.md](CHANGELOG.md)，许可证见 [LICENSE](LICENSE)（MIT）。

> 应用数据默认存放在 Electron 的 `userData/ImmersiveReader/` 下（Windows 为
> `%APPDATA%\immersive-reader\ImmersiveReader\`）：
> `books.json`（**只有元数据**，正文副本在 `books/`）、`progress.json`（阅读进度）、
> `settings.json`（排版偏好）、`sources.json` / `rules.json` / `cloud/` / `covers/`。
> 大版本更新中 `appId` 与包名保持不变，升级不会让书架和进度「消失」。

### 打包产物（v2.2.0）

`npm run build` 在 `release/` 下一次产出四份：

| 产物 | 用途 |
| --- | --- |
| `Folio-Setup-2.2.0.exe` | NSIS 安装包：可选安装目录、创建桌面/开始菜单快捷方式，卸载保留用户数据 |
| `Folio-Portable-2.2.0.exe` | 单文件便携版，双击即用；数据默认仍写 userData，可用 `FOLIO_DATA_DIR` 让它跟着 U 盘走 |
| `Folio-2.2.0-win-x64.zip` | 免安装压缩包，解压后运行 `Folio.exe`（zip 是扁平结构，解压出来就是 exe 本体） |
| `win-unpacked/Folio.exe` | 免安装目录版，需连同同目录 dll/pak/locales/resources 一起保留 |

分步构建（输出目录被占用时特别有用）：

```bash
npm run build:dir
npm run build:portable
npm run build:nsis
npm run build:zip

# 换一个全新输出目录，避免 electron-builder 清空 release/ 时撞上文件锁
npm run build:portable -- -c.directories.output=release-v2
```

> **打包入口说明**：Windows 打包统一走 `node scripts/build-win.mjs`（`npm run build*` 已内置）。
> electron-builder 在 Windows 上生成 NSIS 卸载器时，默认要把刚编译出的安装包**执行一遍**，
> 让它自己 `WriteUninstaller` 出 `uninstaller.exe`；这一步在很多 Windows 版本上会直接失败
> （Windows 11 Insider Preview 的某个 Build 上，NSIS 3.0.4.1 的 stub 一启动就退出码 2，`.onInit` 都进不去），
> 于是整个 `nsis` 目标报 `Exit code: 2`。
> 该入口会注入 `scripts/nsis-static-uninstaller.cjs`，改用 electron-builder 自带的
> `UninstallerReader` **静态解析**安装包内的卸载器数据块，完全不执行任何 exe；
> 解析失败才回退到原来的执行方式，对能正常执行的机器行为不变。
>
> 所以：**别直接跑 `npx electron-builder --win nsis`**，用 `npm run build:nsis`。
>
> 双击没反应时按下面第 1 条带 `--no-sandbox`。

### 常见坑

**0. 导入书源时报 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`**

说明你粘进来的是**网页**，不是书源 JSON。常见三种情况，程序现在会直接告诉你属于哪一种：

- 把书源网站的页面地址粘进了「粘贴 JSON」框 → 换成页面上的「订阅链接 / 一键导入」地址，填到「订阅链接」输入框
- 用了 GitHub 的仓库页面（`github.com/…/blob/…`）→ 换成 raw 地址或 jsDelivr 镜像（`cdn.jsdelivr.net/gh/…`），现在 raw 地址填进去也会自动走镜像
- 粘的是 `legado://import/…` 这类「阅读」的导入协议 → 它只能填在「订阅链接」里，程序会替你解析

**1. 双击 exe 没有任何反应（进程也看不到）**

少数 Windows 环境里 Chromium 的沙箱初始化会直接失败（受限账户、第三方安全软件、
`AppContainer` 不可用等），Electron 进程在跑主进程 JS 之前就退出，于是「双击没反应、
任务管理器里也没有进程」。这类机器必须带 `--no-sandbox` 启动：

- 打包版：在命令行里运行 `Folio.exe --no-sandbox`，或给快捷方式的「目标」末尾追加
  `--no-sandbox`；
- 源码运行：`npm start` / `npm run dev` 里的启动脚本已经自动补上这个参数
  （想保留沙箱就设 `FOLIO_STRICT_SANDBOX=1`）；
- 仍然打不开时，用 `npm start` 从源码跑，主进程的终端输出与
  `<数据目录>/logs/<日期>.log` 会记录退出原因。

**2. `ELECTRON_RUN_AS_NODE` 会让 Electron 变成纯 Node**

如果环境变量里有 `ELECTRON_RUN_AS_NODE=1`（某些终端 / IDE / 代理工具会注入），
`npx electron .` 会以 Node 模式启动，报：

```
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
TypeError: Cannot read properties of undefined (reading 'getPath')
```

启动前清掉它即可：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE
npx electron .
```

**3. npm 11 默认不执行安装脚本，Electron 二进制会缺失**

npm 11 只提示 `packages have install scripts not yet covered by allowScripts`，
`node_modules/electron/dist/electron.exe` 不会被下载。两条命令补上（国内网络建议走镜像）：

```powershell
npm install-scripts approve electron esbuild
$env:ELECTRON_MIRROR = 'https://registry.npmmirror.com/-/binary/electron/'
node node_modules\electron\install.js
```

打包（`npm run build`）时 electron-builder 还要下载 winCodeSign / nsis，
同样可以用镜像：`$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://registry.npmmirror.com/-/binary/electron-builder-binaries/'`。

**4. 书源的 `@js:` 规则依赖系统里的 `curl`**

Legado 的脚本 API（`java.ajax`）是同步的，Node 原生 `fetch` 做不到，所以 Folio 用 `curl` 子进程同步取页。
Windows 10/11 与 macOS 自带 `curl`，Linux 装 `curl` 即可；同时它也是"直连失败时走代理重试"的通道。

**5. 部分站点在特定网络下直连不通**

例如 `www.pixiv.net` 在部分网络会超时。Folio 会明确提示"连不上 host（连接超时）。若该站点需要代理，请在「书源」面板填写代理地址"，
填上本机代理（如 `http://127.0.0.1:7890`）即可。

---

## 章节正则怎么写

设置面板里的"章节识别"接受任意合法 JS 正则（不区分大小写）。几组常用写法：

```js
// 中文数字章节
^第[0-9零一二三四五六七八九十百千万两〇]+[章节回卷部集篇话]

// 英文章节
^Chapter\s+\d+

// 数字编号 + 顿号/点号
^\d{1,4}[、.．]\s*\S

// 方括号标题
^【.{1,24}】

// 只认 Markdown 标题
^#{1,3}\s
```

留空则使用内置规则。识别出的标题行会自动套用左对齐、加粗的字重与更紧的字距，并成为目录条目。

---

## 已知问题

2026-10-24 做过一轮系统性代码审计（主进程/IPC 与书源引擎、渲染层、数据一致性三个方向，共 45 条），
修复与遗留清单见 [docs/audit-2026-10-24.md](docs/audit-2026-10-24.md)。其中最需要关注的一条是：
**超长书（数千段）从存档位置恢复时落点可能不准**，正在跟进。

## 设计取舍

- **只收纯文本**：EPUB 本质是 ZIP 容器，需要额外的解析与内联资源处理；本项目把"正则章节匹配"作为核心，纯文本更能把这套机制做透。导入二进制文件会给出明确提示。
- **进度锚在段落而非像素**：字号与栏宽随时可调，段落索引是唯一稳定的坐标。
- **段落间距用 `padding`**：虚拟滚动是绝对定位的，`margin` 不计入 `offsetHeight`，会让相邻段落重叠。
- **自动滚动用浮点游标 + 绝对赋值**：Chromium 会丢弃 `scrollTop += 0.02` 这类亚像素增量，逐帧累加只会原地不动；因此内部维护一个浮点游标，每帧把 `cursor + speed × dt` 直接赋给 `scrollTop`。
- **滚动动画自己写 rAF 而不是 `scroll-behavior: smooth`**：原生平滑滚动的时长不可控、也无法在滚轮介入时干净地被打断；自研缓动可以按距离给 240–640ms、末帧精确对齐偏移表、随时 `cancelAnimationFrame` 交还控制权。
- **preload 用 `.cjs`**：`package.json` 为 `type: module`，而 Electron 的 sandbox preload 仍按 CommonJS 加载。
- **书源不做自建后端**：内容只在你的机器与源站之间流动，Folio 不托管、不中转、不缓存到云端；抓取与缓存都在主进程本地完成。
- **`@js:` 用 `vm` + `curl` 而不是 `jsdom`/`node-fetch`**：Legado 脚本的 `java.ajax` 是同步调用，只有子进程方案能同时满足"同步"和"带 cookie/代理"，而且不必引入重量级依赖。
- **云端阅读按窗口（3 章）加载**：整本抓下来既慢又不礼貌；按窗口加载能让目录跳转、进度恢复、追加章节三者都不破坏段落索引。

---

## License

MIT
