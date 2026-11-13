# 插件商店

Folio 的插件商店是一个**纯静态站点**：一个 `index.json` 索引 + 每个插件一个 JSON 包（`plugins/<id>.json`）。
应用从站点拉索引，点「安装」时下载对应的包，校验 sha256 后写进 `<数据目录>/plugins/<id>/` 并热加载。

线上地址：<https://flulwh.github.io/folio-store/>（GitHub Pages）

## 分类

商店索引支持 `categories` 字段，应用会渲染成分类标签（含每类数量），并记住上次选择的分类：

```json
"categories": [
  { "id": "reading", "label": "阅读增强" },
  { "id": "stats", "label": "统计" },
  { "id": "interface", "label": "界面" },
  { "id": "tools", "label": "工具" }
]
```

上架时在 `store/catalog.json` 的插件条目里写 `"category": "stats"`，`build-store.mjs` 会把它带进 `index.json` 与商店页。分类 id 不在 `categories` 里时按 `tools` 处理；没有 `categories` 字段的旧索引会自动从插件条目里推导分类。

商店静态页也会按分类分组展示（每组标题带数量）。

## 目录结构

```
store/                      # 源：目录登记 + 只在本仓库维护的插件
  catalog.json              # 上架清单（id / featured / tags / summary）
  plugins/<id>/             # 可选：商店专属插件的源码
scripts/build-store.mjs     # 构建脚本：打包成静态站点 + 内置副本
store-dist/                 # 产物：可直接部署的静态站点（也提交到 folio-store 仓库）
electron/store/             # 产物副本，随 asar 打包，用于离线兜底
```

插件源码优先取 `store/plugins/<id>`，不存在时回退到 `examples/plugins/<id>`。

## 构建

```bash
node scripts/build-store.mjs
```

产物：

- `store-dist/index.json`：`{ version, name, homepage, updatedAt, count, plugins[] }`
- `store-dist/plugins/<id>.json`：`{ manifest, files }`，`files` 是相对路径到文本内容的映射
- `store-dist/index.html`：给人看的商店页
- `electron/store/**`：同内容的副本（应用离线时读取）

索引里每个插件带有 `sha256`（对该 JSON 文件文本计算）和 `size`，应用安装前会校验。

## 上架一个新插件

1. 把插件目录放进 `store/plugins/<id>/`（或 `examples/plugins/<id>/`），至少包含 `manifest.json` 与入口脚本。
2. 在 `store/catalog.json` 的 `plugins` 里加一条：`{ "id": "<id>", "featured": false, "tags": ["..."], "summary": "..." }`。
3. `node scripts/build-store.mjs`
4. 重新部署（见下）。

## 部署（GitHub Pages）

当前仓库：`flulwh/folio-store`，Pages 指向 `main` 分支根目录。

环境限制：这台机器 `git push` 到 `github.com:443` 会超时，但 `api.github.com` 可用，所以用 Contents API 上传：

```bash
node scripts/deploy-store.mjs   # 逐文件 PUT 到 folio-store 仓库
```

首次开启 Pages：

```bash
gh api --method POST repos/flulwh/folio-store/pages --input - <<'JSON'
{"source":{"branch":"main","path":"/"}}
JSON
```

Pages 首次构建约 30–60 秒，之后改动一般 10–30 秒生效。校验：

```bash
curl -s https://flulwh.github.io/folio-store/index.json | head
```

## 在应用里换商店地址

设置 → 商店 → 顶部输入框填站点根地址（末尾 `/` 可省略），点「连接」。地址保存在设置项 `pluginStoreUrl`，默认 `https://flulwh.github.io/folio-store/`。

连不上时会自动回退到内置目录（`electron/store/`），并在页面顶部提示。

## 安装流程与安全边界

- 只接受 `http(s)` 地址；索引必须是带 `plugins` 数组的 JSON。
- 包体校验：`manifest` 必须是对象；`files` 最多 64 个、总计不超过 200KB；路径不允许绝对路径或 `..`。
- 有 `sha256` 时必须匹配，否则报「插件包校验失败」。
- 写入前会卸载同名插件的旧实例，安装完成后热加载并广播刷新。
- 插件运行在 `vm` 沙箱里，只能访问 manifest 声明过的权限（`books` / `net` / `notify` / `ui`）。

## 排查

- 应用日志搜索 `[store]`：索引加载、安装来源（remote/bundled）、失败原因。
- 安装失败的常见原因：`找不到入口文件 main.js`（包里缺少入口文件）、`插件包校验失败`（站点文件被改过）、`连不上商店`（网络）。
