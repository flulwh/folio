# Folio 插件系统

插件是一个文件夹，放在数据目录的 `plugins/` 下：

```
<dataDir>/plugins/my-plugin/
├── manifest.json
├── main.js
└── data.json        # 运行时自动生成，插件自己的存储
```

Windows 打包版的数据目录一般是 `release/win-unpacked/Folio-data/`；在「设置 → 插件」里点「插件目录」可以直接打开。

## manifest.json

```json
{
  "id": "reading-clock",
  "name": "阅读时钟",
  "version": "1.0.0",
  "description": "统计今天读了多久",
  "author": "Folio",
  "main": "main.js",
  "permissions": ["notify"],
  "contributes": {
    "commands": [
      { "id": "today", "title": "今日阅读统计", "description": "看看今天的成绩" }
    ]
  }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 小写字母、数字、连字符，2–41 位，必须和文件夹名一致 |
| `name` | 否 | 显示名，缺省用 id |
| `version` | 否 | 语义化版本，缺省 `0.0.0` |
| `main` | 否 | 入口文件，必须在插件目录内，缺省 `main.js` |
| `permissions` | 否 | `books` / `books:write` / `reader` / `settings` / `sources` / `net` / `notify` / `ui` / `clipboard` / `shell` / `themes` 的子集 |
| `contributes.commands` | 否 | 预先声明的命令，运行时会出现在插件卡片上 |

权限含义：

- `books`：读书架列表（`folio.books.list()` / `count()`）
- `net`：`folio.net.get(url)` 发 HTTP 请求
- `notify`：`folio.notify(text)` 弹一条提示
- `ui`：预留给以后的界面扩展

`storage`、`events`、`commands.register` 不需要声明权限。

## main.js

入口导出 `activate(folio)`，可选导出 `deactivate()`：

```js
exports.activate = function activate(folio) {
  folio.log('插件启动了');

  folio.events.on('progress:save', ({ progress }) => {
    folio.storage.set('lastSave', Date.now());
  });

  folio.commands.register('hello', '打个招呼', () => {
    folio.notify('你好，我是插件');
  });
};

exports.deactivate = function deactivate() {
  // 清理定时器之类
};
```

也支持 `module.exports = { activate, deactivate }`，或者直接 `module.exports = activate`。

## folio API

| API | 说明 |
| --- | --- |
| `folio.id` / `folio.version` / `folio.permissions` | 插件身份 |
| `folio.log(...args)` | 写日志，tag 为 `plugin:<id>`，在「运行日志」里能看到 |
| `folio.notify(text, tone?)` | 弹提示，`tone` 可选 `info` / `error` |
| `folio.storage.get(key, fallback)` | 读插件存储 |
| `folio.storage.set(key, value)` | 写（自动防抖落盘） |
| `folio.storage.delete(key)` / `all()` | 删除 / 全量读取 |
| `folio.books.list()` / `count()` | 书架（需要 `books` 权限） |
| `folio.net.get(url, { headers })` | HTTP GET，返回 `{ status, ok, text, headers }`（需要 `net` 权限） |
| `folio.events.on(name, handler)` | 监听事件，返回取消函数 |
| `folio.commands.register(id, title, run)` | 注册命令，命令运行时会出现在卡片上 |
| `folio.hasPermission(name)` | 权限判断 |

### 事件

| 事件 | 载荷 | 时机 |
| --- | --- | --- |
| `books:change` | `{ count }` | 书架增删 |
| `progress:save` | `{ progress }` | 保存阅读进度（翻页/滚动节流后） |
| `book:open` | `{ id, kind, name }` | 打开一本书 |

## 权限对照

| 权限 | 能做什么 | 典型 API |
| --- | --- | --- |
| `books` | 只读书架信息 | `folio.books.list()` / `count()` |
| `books:write` | 修改书架 | 预留（当前未开放写接口） |
| `reader` | 打开书籍、读取当前阅读状态 | `folio.books.open(id)` / `folio.reader.current()` |
| `settings` | 读写应用设置 | `folio.settings.get()` / `patch()` |
| `sources` | 查看/启停书源 | `folio.sources.list()` / `toggle()` |
| `net` | 发 HTTP 请求 | `folio.net.get()` |
| `notify` | 弹提示 | `folio.notify()` |
| `ui` | 声明并渲染自定义界面 | `folio.ui.set()` / `open()` |
| `clipboard` | 写剪贴板 | `folio.clipboard.write()` |
| `shell` | 打开外部链接 | `folio.shell.openExternal()` |
| `themes` | 提供配色主题 | `folio.themes.register()` |

没声明的权限调用时会直接抛错（例如「缺少 settings 权限」），不会静默失败。

## 自定义界面（需要 `ui` 权限）

在 manifest 里声明面板：

```json
{
  "permissions": ["ui", "books"],
  "contributes": {
    "ui": {
      "panels": [
        { "id": "dashboard", "title": "阅读面板", "slot": "overlay", "width": "wide", "icon": "📊" }
      ]
    }
  }
}
```

`slot` 决定入口位置：`overlay`（左下角悬浮按钮，默认）、`shelf`、`reader`、`settings`。`width` 可选 `normal` / `wide`。

用声明式节点树描述界面，插件不接触真实 DOM：

```js
folio.ui.set('dashboard', {
  type: 'stack',
  children: [
    { type: 'row', children: [
      { type: 'metric', value: '6', label: '书架上的书' },
      { type: 'metric', value: '38%', label: '平均进度' },
    ]},
    { type: 'progress', value: 38, label: '整体进度' },
    { type: 'divider' },
    { type: 'button', text: '刷新', action: { id: 'refresh' } },
  ],
});
folio.ui.onAction((action) => {
  if (action.id === 'refresh') { /* 重新 set 一遍 */ return '已刷新'; }
});
```

可用节点：`stack` `row` `text` `label` `heading` `divider` `spacer` `progress` `metric` `list` `button` `switch` `select` `input`。
节点上限 400 个、深度 8 层、文本 2000 字；超出的部分会被裁掉，不会让界面崩掉。

`folio.ui` API：

| API | 说明 |
| --- | --- |
| `folio.ui.panels()` | 当前插件声明的面板 |
| `folio.ui.set(panelId, tree)` | 更新面板内容 |
| `folio.ui.open(panelId)` / `ui.close()` | 打开 / 关闭面板 |
| `folio.ui.onAction(handler)` | 接收按钮、开关、输入等交互 |

## 更多能力

| API | 需要权限 | 说明 |
| --- | --- | --- |
| `folio.app.settings.get(key?, fallback?)` | `settings` | 读应用设置（不传 key 返回全部） |
| `folio.app.settings.patch(patch)` | `settings` | 合并写入应用设置 |
| `folio.sources.list()` / `toggle(id, enabled)` | `sources` | 书源列表 / 启停 |
| `folio.reader.current()` | `reader` | 当前阅读状态 |
| `folio.books.open(id)` | `reader` | 让应用打开某本书 |
| `folio.clipboard.write(text)` | `clipboard` | 复制文本到剪贴板 |
| `folio.shell.openExternal(url)` | `shell` | 用系统浏览器打开 http(s) 链接 |

## 版本与兼容

`manifest.json` 可以声明 `apiVersion`（默认 1）。应用只加载 `apiVersion <= 当前支持版本` 的插件，装高版本插件会直接提示「请更新应用」，不会以半坏状态运行。

## 网络白名单

声明了 `net` 权限的插件，建议同时声明可以访问的域名：

```json
"contributes": { "network": { "allow": ["api.example.com", "*.githubusercontent.com"] } }
```

声明后，`folio.net.get()` 访问白名单之外的域名会直接抛错；不声明则不做域名限制（仍然只允许 http(s)）。支持 `*.` 通配一个后缀。

## 存储配额

每个插件的 `data.json` 上限 **64KB**，超出时 `storage.set()` 会抛错并保持旧值，不会写坏文件。这个配额同时覆盖 `storage` 与插件设置，别把大文件塞进来。

## 稳定性：崩溃自动停用

命令、事件、界面动作里抛出的错误会被记录到插件日志，并对该插件累计错误次数：

- 单次出错：只写日志、在插件卡片上标红；
- 连续 3 次出错：自动停用插件（`plugins-state.json` 里落盘），并提示「连续 3 次出错，已自动停用」；
- 重新启用时错误计数清零。

插件出错不会影响应用本身，也不会连带停用其他插件。

## 开发工具

仓库自带一个不依赖第三方包的 CLI：

```bash
npm run plugin:new my-plugin      # 生成 plugins-dev/my-plugin/{manifest.json,main.js}
npm run plugin:check my-plugin    # 校验 manifest、入口语法、权限、面板、体积
npm run plugin:pack my-plugin     # 生成商店用的 bundle JSON 并打印 sha256
```

`plugin:check` 会检查：id 规则、`apiVersion`、入口文件存在且语法正确、权限是否已知、`contributes.ui.panels` 的 slot、网络白名单类型、总体积 ≤200KB。
`plugin:pack` 产出的 JSON 就是商店 `plugins/<id>.json` 的格式，把 sha256 填进商店 `index.json` 即可。

## 安装确认

无论从目录安装还是从商店安装，应用都会先弹一个系统对话框，列出插件名、版本和它申请的权限（`读取书架`、`访问网络`……），点「安装」才会写盘。取消不会留下任何文件。

## 提供主题（需要 `themes` 权限）

```js
folio.themes.register({
  id: 'amber',
  label: '琥珀',
  tone: 'light',            // light | dark，决定阴影/玻璃用哪套外壳
  tokens: { bg: '#fbf3e6', text: '#2a1f12', accent: '#c2681a' },
});
```

注册后会立刻出现在「设置 → 外观」的主题网格里，带「插件」角标；插件停用或卸载时主题自动移除。一个插件最多 8 个主题，id 会自动加插件前缀。`folio.themes.list()` 读当前已注册的，`folio.themes.unregister(id)` 手动移除。完整字段见 `docs/themes.md`。

## 生命周期

1. 应用启动后，主进程扫描 `plugins/`，读取 manifest。
2. 已启用的插件在 `vm` 沙箱里执行入口脚本，调用 `activate(folio)`。
3. 停用 / 重载 / 退出时调用 `deactivate()`，清掉事件与命令。
4. 启用状态存在 `<dataDir>/plugins-state.json`，重启后保持。

单个命令最多执行 8 秒，`activate` 最多 8 秒，`net.get` 最多 15 秒；超时或抛错会写回插件卡片的错误行。

## 沙箱边界

入口脚本拿不到 `require`、`process`、`fs`，只有上图列出的 `folio` 与少量标准对象（`JSON`、`Math`、`Date`、`Promise`、`URL`、`TextEncoder` 等）。要访问网络必须声明 `net` 权限并走 `folio.net.get`。

## 示例

- `reading-clock`：阅读统计
- `daily-quote`：每日书摘
- `book-shuffle`：随机抽书
- `ui-dashboard`：带自定义界面的阅读面板（演示 `folio.ui`）

仓库里的示例都在 `examples/plugins/`：

- `reading-clock`：监听进度保存，累计今日阅读时长与翻过的书。
- `daily-quote`：从插件存储里随机取一句书摘。
- `ui-dashboard`：声明一个面板，用 `folio.ui.set()` 渲染书架概览。

把文件夹整体复制到 `<dataDir>/plugins/`，在设置里点「重新加载」即可；也可以上架到插件商店后一键安装。

## 调试

- 插件日志：设置 → 插件（或阅读器里的日志面板），搜 `plugin:`。
- 插件报错会显示在卡片上，同时写进运行日志。
- 改完入口脚本后点「重新加载」，不需要重启应用。

## 设置项（manifest.settings）

插件可以在 manifest 里声明设置项，Folio 会在插件卡片里自动渲染，值存在插件自己的 `data.json` 里：

```json
{
  "settings": [
    { "key": "dailyGoal", "label": "每日目标（分钟）", "type": "number", "default": 30 },
    { "key": "notifyOnSave", "label": "每次保存进度时提示", "type": "boolean", "default": false },
    { "key": "quotesText", "label": "自定义书摘", "type": "text", "placeholder": "多条用 | 分隔" }
  ]
}
```

`type` 支持 `text` / `number` / `boolean` / `select`（`select` 需要 `options: [{ value, label }]`）。

读取和写入：

```js
const goal = folio.settings.get('dailyGoal', 30); // 带默认值
folio.settings.set('dailyGoal', 45);
folio.settings.all(); // 全部设置
```

用户在前端修改设置时，插件会收到 `settings:change` 事件：

```js
folio.events.on('settings:change', ({ key, value }) => {
  console.log('设置变了', key, value);
});
```

## 安装、卸载与日志

- **安装**：设置 → 插件 → 「安装插件」，选择一个包含 `manifest.json` 的目录，Folio 会把它复制到 `<dataDir>/plugins/<id>` 并立即加载。
- **卸载**：卡片底部「卸载」→ 再点一次确认，会停用并删除插件目录（插件自己的存储一起删掉）。
- **日志**：卡片底部「日志 N」展开最近日志，同时写入运行日志，前缀 `plugin:<id>`。最多保留 60 条。
- **手动安装**：把插件目录放进 `<dataDir>/plugins/`，点「重新加载」。

## 最小示例（带设置）

`reading-clock/manifest.json` 与 `reading-clock/main.js`、`daily-quote/*` 都在 `examples/plugins/`，可以直接复制到插件目录试用。
