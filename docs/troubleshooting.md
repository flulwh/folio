# 排障与常见坑

README 只留最常见的一条，其余在这里。

---

## 1. 双击 exe 没有任何反应（进程也看不到）

少数 Windows 环境里 Chromium 的沙箱初始化会直接失败（受限账户、第三方安全软件、`AppContainer` 不可用等），Electron 进程在跑主进程 JS 之前就退出，于是「双击没反应、任务管理器里也没有进程」。

这类机器必须带 `--no-sandbox` 启动：

- **打包版**：命令行里运行 `Folio.exe --no-sandbox`，或给快捷方式的「目标」末尾追加 `--no-sandbox`
- **源码运行**：`npm start` / `npm run dev` 里的启动脚本已经自动补上这个参数（想保留沙箱就设 `FOLIO_STRICT_SANDBOX=1`）
- **仍然打不开**：用 `npm start` 从源码跑，主进程终端输出与 `<数据目录>/logs/<日期>.log` 会记录退出原因

---

## 2. `ELECTRON_RUN_AS_NODE` 让 Electron 变成纯 Node

环境变量里有 `ELECTRON_RUN_AS_NODE=1`（某些终端 / IDE / 代理工具会注入）时，`npx electron .` 会以 Node 模式启动，报：

```
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
TypeError: Cannot read properties of undefined (reading 'getPath')
```

启动前清掉它：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE
npx electron .
```

---

## 3. npm 11 默认不执行安装脚本，Electron 二进制会缺失

npm 11 只提示 `packages have install scripts not yet covered by allowScripts`，
`node_modules/electron/dist/electron.exe` 不会被下载。两条命令补上（国内网络建议走镜像）：

```powershell
npm install-scripts approve electron esbuild
$env:ELECTRON_MIRROR = 'https://registry.npmmirror.com/-/binary/electron/'
node node_modules\electron\install.js
```

打包（`npm run build`）时 electron-builder 还要下载 winCodeSign / nsis，同样可以用镜像：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/'
```

---

## 4. 导入书源时报 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

说明你粘进来的是**网页**，不是书源 JSON。程序会直接告诉你属于哪一种：

| 你粘了什么 | 怎么改 |
| --- | --- |
| 书源网站的页面地址 | 换成页面上的「订阅链接 / 一键导入」地址，填到「订阅链接」输入框 |
| GitHub 的仓库页面（`github.com/…/blob/…`） | 换成 raw 地址或 jsDelivr 镜像（`cdn.jsdelivr.net/gh/…`），raw 地址现在也会自动走镜像 |
| `legado://import/…` 这类「阅读」的导入协议 | 它只能填在「订阅链接」里，程序会替你解析 |

---

## 5. 书源的 `@js:` 规则依赖系统里的 `curl`

Legado 的脚本 API（`java.ajax`）是同步的，Node 原生 `fetch` 做不到，所以 Folio 用 `curl` 子进程同步取页。

Windows 10/11 与 macOS 自带 `curl`，Linux 装 `curl` 即可；同时它也是「直连失败时走代理重试」的通道。

---

## 6. 部分站点在特定网络下直连不通

例如 `www.pixiv.net` 在部分网络会超时。Folio 会明确提示「连不上 host（连接超时）。若该站点需要代理，请在「书源」面板填写代理地址」，填上本机代理（如 `http://127.0.0.1:7890`）即可。

代理只影响书源抓取，不影响局域网面板。

---

## 7. 启动白屏

**症状**：窗口打开了但一片空白，或首帧卡在 `opacity: 0`。

**根因**：Chromium 的 `backgroundThrottling` 会在窗口不可见时冻结 `requestAnimationFrame`。
首帧设了 `opacity: 0` 等下一帧揭开，但后台窗口拿不到下一帧，于是永远白屏。

**修法**：`electron/main.js` 的 `webPreferences` 里加：

```js
webPreferences: {
  backgroundThrottling: false,
}
```

---

## 8. 切换皮肤后再点其他设置分区，内容空白

**症状**：在设置页把皮肤从 Apple 切到 MIUI（或反过来），再点「阅读 / 书源 / 存储」，分区内容整块消失。

**根因**：`AnimatePresence mode="wait"` 下，旧区块的退出动画与新区块的 presence key 冲突 —— 切皮肤时 key 没变，`mode="wait"` 一直等旧区块退场，而旧区块的退出动画此时已经不存在了。

**修法**：给 presence 树加一个随皮肤变化的 key，强制重建：

```jsx
<AnimatePresence key={settings.skin} mode="wait" initial={false}>
```

回归脚本：`tools/_settings-blank.cjs`。

---

## 9. MIUI 皮肤下主题颜色和设置里描述的不一致

**根因**：`src/miui.css` 里硬编码了蓝色主色，覆盖了主题注入的 `var(--accent)`。

**修法**：删掉硬编码色值，一律读 `var(--accent)`；并按 `data-theme-tone='light' / 'dark'` 分别处理明暗两套阴影与描边。
根节点上要挂上 tone：

```jsx
<div data-theme-tone={activeTheme?.tone} />
```

---

## 10. 局域网面板相关

面板本身的排障（防火墙、虚拟网卡、端口顺延、访问码失效）在 [lan-panel.md](lan-panel.md#排障) 里，这里不重复。

---

## 11. 开发环境的两个常见怪象

| 现象 | 原因 / 处理 |
| --- | --- |
| Vite 页面打不开（`localhost` 连不上） | `vite.config.js` 里 `server.host` 固定为 `127.0.0.1`。用 `localhost` 访问会命中 IPv6 `::1` 而 Vite 只听 IPv4 —— 用 `127.0.0.1` 即可 |
| 沙箱里写不进 `%APPDATA%\immersive-reader` | 部分受限环境下 userData 不可写。验证时用 `FOLIO_DATA_DIR=.folio-test-data` 把数据目录指到工作区 |

主进程本身有兜底：`resolveDataDir()` 发现首选目录不可写时，会退到 `%TEMP%\Folio-data` 或 exe 同级的 `Folio-data`。
