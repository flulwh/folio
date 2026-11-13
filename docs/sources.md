# 书源与净化规则

Folio 不提供服务器，也不代理内容。它吃的是 **Legado（阅读）** 生态的书源与替换规则：
你导入一份书源 JSON，Folio 直接连源站搜索、追更、读正文，流量只在你和源站之间。

本文是书源能力的完整规格。界面上怎么用见 [README](../README.md#书源与云阅读)。

---

## 一、书源（BookSource）

### 导入方式

| 方式 | 说明 |
| --- | --- |
| 订阅链接 | 支持 `legado://import/bookSource?src=…` 写法；GitHub 地址会自动走 jsDelivr / `api.github.com` 镜像 |
| 本地 JSON 文件 | 「选择文件」按钮 |
| 粘贴 JSON | 直接把数组粘进文本框 |

导入时自动识别：**内容是书源数组 → 进「书源」页，是替换规则数组 → 进「净化规则」页**。

### 标准字段

按 Legado `BookSource` 规范解析：

```
bookSourceName / bookSourceUrl / bookSourceGroup / bookSourceType / bookSourceComment
enabled / enabledExplore
searchUrl / exploreUrl
ruleSearch.{bookList,name,author,coverUrl,bookUrl,intro,lastChapter}
ruleBookInfo.{init,name,author,kind,intro,coverUrl,lastChapter,wordCount,tocUrl}
ruleToc.{chapterList,chapterName,chapterUrl,nextTocUrl}
ruleContent.{content,nextContentUrl,sourceRegex,webJs}
header / charset / jsLib / loginUrl / loginCheckJs / bookUrlPattern
concurrentRate / customVariables / weight / customOrder
```

非文本类型（音频 / 图片 / 文件）会在界面上标注出来。

### 规则语法

**选择器链**：`class.list@tag.a.0@href` —— 逐段过滤，每段可组合标签、class、索引、属性。

**索引**：

| 写法 | 含义 |
| --- | --- |
| `tag.a.-1` | 取倒数第一个 |
| `tag.a[2]` | 单下标 |
| `tag.a[!1,3]` | 排除第 1、3 项 |
| `tag.a[0:4:2]` | 区间带步长 |
| `tag.a[-1:0]` | 反向 |
| `tag.li.0:2` | 旧式并列下标：取第 0、2 个 |
| `tag.li.!1` | 旧式排除 |

**切片**（只对取值词生效）：`@text[0:50]`。

**直系与文字匹配**：`children.` 取直系子元素；`text.下一页` 按文字包含匹配选元素。

**属性算子**：`[property$=book_name]`、`[attr~=a|b]`、`^=`、`*=`、`|=`。

**伪类**：`:eq(n)`、`:lt(n)`、`:gt(n)`、`:first`、`:last`、`:nth-child(n)`。

**组合与后处理**：

| 语法 | 含义 |
| --- | --- |
| `\|\|` | 多候选，任一命中即可 |
| `&&` | 首选 |
| `%%` | 按行交错合并 |
| `##正则##替换` | 后处理 |
| `@put:{k:"规则"}` / `@get:{k}` | 变量，可写在规则任意位置 |
| `{{js表达式}}` | 变量内联成 JS 表达式 |
| `<js>…</js>` / `@js:` | 脚本 |
| `@CSS:` | 原生 CSS 选择器 |
| `@@` | 转义 |

**路径与结构化查询**：

- JSONPath：`$.data[*]`、`$..book_data[0]`（递归查找）
- XPath：`@XPath:` 前缀，或以 `/`、`//`、`./` 开头自动识别。支持绝对/相对路径、`//` 后代轴、`*`、`text()`、`@attr`、`[n]` / `[last()]` / `[position()=n]`、`[@attr='v']`、`[contains(@attr,'v')]`、`[starts-with(@href,'/read/')]`、`[text()='v']`、顶层 `|` 并集

**请求选项**：`URL,{ 'method':'POST','body':'…' }`（单引号也认）。

**属性名不被误判**：`@a` / `@li` / `@p` 这类标签名不会被当成属性名。

多结果按 `\n` 连接，属性值自动去重（与 Legado 一致）。

### 脚本 API（`@js:`）

内置一个沙箱 JS 运行时，模拟 Legado 的 `java.*` / `cookie` / `cache` / `source.*`：

- `java.ajax / post / get / put / getString / getElements / getElement / setContent / htmlFormat`
- `java.getString(rule)` —— 在脚本里按规则取当前页面
- `java.htmlFormat(html)` —— 按 Legado 的块级标签规则转纯文本
- `cookie.*`、`cache.*`、`source.*` 常用子集
- `java.getElement(rule)` / `java.setContent(html)` —— 返回 Elements 形态，带 `.length` / `.size()` / `.text()` / `.html()` / `.attr()` / `.select()`
- `org.jsoup.Jsoup.parse(html)` —— 最小实现，带 `.select()` / `.selectFirst()` / `.text()` / `.html()` / `.attr()` / `.getElementById()` / `.getElementsByTag()` / `.getElementsByClass()` / `.body()` / `.head()`。所以脚本里直接写 jsoup 的源也能跑

`java.ajax` 是**同步**调用，Node 原生 `fetch` 做不到，所以实现走 `curl` 子进程（见 [troubleshooting.md](troubleshooting.md#5-书源的-js-规则依赖系统里的-curl)）。

### 目录与正文

| 能力 | 行为 |
| --- | --- |
| **目录分页** | `ruleToc.nextTocUrl`（或 `toc.next`）真正用来翻页：最多 30 页，按章节地址去重后合并 |
| **正文分页** | `ruleContent.nextContentUrl` 同样翻页拼正文（最多 8 页），遇重复/空白内容就停 |
| **详情回填** | `ruleBookInfo` 的 `name/author/kind/intro/coverUrl/lastChapter/wordCount` 在取目录时顺带解析（支持先 `init` 里 `@put` 存变量再各字段 `@get`），只补空字段、不覆盖用户手动改过的 |
| **目录兜底** | 规则没命中 → 自动找「目录 / 全部章节」入口再取一次 → 仍不行就用章节标题特征（`第 N 章`、`序章`、`番外`…）扫描页面链接兜底，并提示「目录由自动匹配生成，可能不完整」 |
| **正文兜底** | 正文不足 20 字时，按常见容器（`#content`、`.content`、`article`…）和长段落重新捞 |
| **章节文件目录探测** | 有些书源的 `tocUrl` 指向「最新章节」页，那里只有几条不带章号的更新记录。这时从页面里的章节文件链接（`.../1418/1418705/157470008.html`）反推出**目录所在的文件夹**（`.../1418/1418705/`），去那里再解析一次 —— 真实站点（`yeudusk`）实测能从 0 章救回 1038 章 |
| **正文脚本（webJs）** | `ruleContent.webJs` 会真正执行：脚本拿到页面 HTML，可配合 `java.getElement` / `org.jsoup` 自己抽正文，抽出来比规则更干净时替换规则结果 |
| **浏览器 API 降级** | 真正开浏览器登录做不到，但 `java.startBrowserAwait` / `java.startBrowser` / `java.webView` 不再中断链路 —— 返回空串并记一条日志，让目录/正文继续走兜底 |

### 正文净化

抓到正文后先剔掉站点家具：

- 导航行（`首页 分类 排行 上一章 下一章 加入书签`）
- `本站所有…` 版权声明
- `小说类别 / 写作状态 / 最后更新 / 最新章节` 元信息
- `[点击阅读]` 推荐位、纯 URL 行
- 站点自己写的 `正文解析错误` 占位文案
- 「一行里挤着一整串章节名」的目录块

再用「中文字数 − 家具行数」给候选容器打分取最优，避免规则命中外层容器时把整页抓进来。

> 已在本地缓存的旧章节需「清理缓存」后重开才会更新 —— 原始文本以未净化形式缓存，净化规则改了不会影响已下载内容。

### 失败提示

站点被墙 / 超时 / 403 / JS 反爬（Cloudflare 那类）都会给出中文原因，而不是一句「无法解析」。
错误信息会带上抓了哪个地址、多少 KB，方便判断是规则问题还是站点问题。错误页的「重试」会跳过目录缓存重新抓。

### 订阅索引

`[{title, url, home_page, tags}]` 这种「书源列表」（aoaostar / XIU2 / shidahuilang 的合集入口都是这个格式）可以直接粘链接导入：

- Folio 逐个下载里面的书源文件再合并，并回报每个订阅新增了多少
- 条目里的相对路径按索引自身的地址补全
- `github.com/<o>/<r>/raw/…` 自动换 jsDelivr / api.github.com 镜像

### 书源健康度

试搜（单个或「全部试搜」，并发 3、一次 12 个）的结果会记到书源上：

| 状态 | 徽标 |
| --- | --- |
| 能用 | `命中 30` |
| 请求成功但没结果 | `无结果` |
| 失败 | `失败` |
| 没测过 | 无徽标 |
| 停用 | 沉底 |

书源列表按「能用 → 没测过 → 失败 → 停用」排序，可一键「只显示能用的」筛掉失效源。
「书籍市场」也按这个排序并发 3 搜索，有活源时直接跳过最近失败的源（界面会说明跳过了哪些），失败源降权到后面。

### 搜索配额

书源上百个时，一轮默认只搜健康度最好的 24 个（并发 3），并在结果下方说明还剩多少，点「搜索全部」再放全量。
没有 `searchUrl` 的书源会标「无搜索」并直接跳过，不会白等。

---

## 二、净化规则（替换规则）

Legado 的替换规则，导入时自动识别（内容是规则数组就进「净化规则」页）。

**字段兼容**：`name` / `group` / `pattern` / `replacement` / `isRegex` / `isEnabled` / `order` / `scopeContent` / `scopeTitle`

**导入方式**：同书源 —— 订阅链接 / 本地 JSON / 粘贴 JSON。例如
`https://legado.aoaostar.com/sources/3f067eb2.json`（20 条规则，删广告尾巴、统一标点）。

**作用时机**：章节标题显示前、正文进阅读器前各跑一次。

**`@js:` 替换**：`replacement` 可以是 `@js:` 脚本，逐匹配调用，`result` 为命中文本。

**正则兼容**：Legado 的规则假设「汉字算 `\w`」，而 JS 的 `\w` 只认 ASCII。
Folio 会把 `\w` / `\W` / `\h` 改写成等价的 Unicode 集合，否则整段中文会被吃掉。

---

## 三、书源仓库

书源面板里的「书源仓库」页对接第三方仓库 [shuyuan.yiove.com](https://shuyuan.yiove.com)
（数据接口 `shuyuan-api.yiove.com`，3 万多个书源、30 多个合集）。
我们只读取它的列表、按需下载书源 JSON，导入后仍然直连源站，不经过任何中转。

| 能力 | 说明 |
| --- | --- |
| **三种导入** | 单条「导入」、整页「导入本页 20 个」（按仓库序号区间 `1-20` 一次取完）、整个合集（如「整合多个仓库」1424 个书源） |
| **浏览** | 书源列表 / 书源合集两个子页签，支持服务端搜索（名称、站点）、分页（书源 1582 页、合集 2 页），每条显示站点、查看次数、收录时间 |
| **已导入识别** | 按书源名称或站点域名匹配本机已有书源，已导入的显示「✓ 已导入」；重复导入走同一套合并逻辑（同 URL 更新规则、同 id 更新启用状态），不长出重复条目 |
| **容错** | 仓库连不上时给出中文原因并提示改用订阅链接；合集很大时下载 + 归一化需要十几秒，按钮显示「导入中…」 |

---

## 四、云端阅读

搜索结果点「读」即加入书架（书卡带 `书源` 角标）。

| 机制 | 行为 |
| --- | --- |
| **窗口加载** | 按 **3 章一个窗口**并行抓取正文，读到底自动续接下一批 |
| **预取** | 阅读时后台预取后续 3 章、前 1 章，滚到底即时续上不断流 |
| **失败不截断** | 某章抓取失败不再截断窗口 —— 文中标出占位，右下角一键重试补齐，阅读位置不丢 |
| **目录补齐** | 目录转圈补齐后可跳到任意章 |
| **进度口径** | 按「窗口起点 + 段落」保存（`chapter` + `paraIndex` + `windowBase`），重开继续读 |
| **全书进度** | 阅读百分比按全书目录折算（章内位置 + 已读章数 / 总章数），书架进度条、「继续阅读」和剩余阅读时长都是全书口径，换窗口不再跳变 |
| **封面缓存** | 书源给的封面下载到数据目录的 `covers/`，之后走本地文件（`folio-cover://` 协议），断网也显示；失败或没封面时退回按书名生成的纯色封面 |
| **本地缓存** | 抓过的目录与正文落本地磁盘，重读同一章不再请求源站；书卡上的「缓存」按钮可查看已缓存章节数 / 目录抓取时间并一键清理；移出书架时缓存一并清除 |

### 漫画 / 图片书

书源的 `bookSourceType` 是 `2`（图片）时，搜索结果带「图片」标记，加入书架后用**漫画阅读器**打开。

- **图片从哪来**：按 `ruleContent.content` 规则取。命中 `<img>` 就逐个取地址；命中容器就把里面所有 `<img>` 收集起来；`@js:` 规则可返回 URL 数组或 HTML。规则什么都没取到时，退化为抓整页 `<img>` 并过滤 logo / 广告 / 占位图 / 小于 120px 的图标
- **懒加载兼容**：按 `data-src` → `data-original` → `data-echo` → `data-url` → `data-lazy-src` → `data-original-src` → `data-lazyload` → `src` 的顺序找真实地址；`src` 是 `blank.png` / `loading` / `placeholder` 这类占位图时会被跳过
- **本地缓存**：图片下载进 `covers/`，通过 `folio-cover://` 协议渲染，翻过的章节断网也能看；回看同一章不会重复抓页面
- **交互**：竖向滚动看页；点图片全屏放大（再点关闭）；`←` / `→`、`PageUp` / `PageDown` 换章；`T` 目录抽屉；工具栏 2.6 秒无操作自动隐藏，点画面唤回；`Esc` 依次关闭「放大 → 目录 → 工具栏 → 退出」
- **进度**：按「第几章」记，回书架点「接着读」直接从上次那章开始
- **注意**：`type` 是搜索时由书源带出来的；旧书架条目如果没有 `type`，重新搜一次再加进书架即可

---

## 五、已知兼容性边界

| 想要 | 现状 |
| --- | --- |
| `@xpath:` 前缀 | 暂不支持，会在书源上标注 |
| 浏览器登录 / 过验证码 | 做不到。相关 API 降级为空串，靠兜底救 |
| EPUB / MOBI | 不支持。只收纯文本（见 README「设计取舍」） |
