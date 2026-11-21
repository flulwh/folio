# Folio 重构简报 · 「Liquid Glass」

## 一句话方向

这不是 SaaS 后台，而是**一块浮在内容上的玻璃**。视觉上要有折射、边缘高光与足够大的圆角；
结构上让内容从玻璃下方滚过去 —— 没有东西可折射，玻璃就退化成一块半透明色块。

## 必须遵守的约束

1. **玻璃只用于"离地"的层**：书架底部胶囊栏、顶部品牌胶囊、阅读器顶/底栏、抽屉、弹窗、提示条。
   正文页、列表项、设置行仍然平铺在底面上，不加投影。
2. **不加 `!important`**，靠 `@layer` 层序解决。层序在 `src/index.css` 顶部声明一次：
   ```
   @import '@vepando/liquid-glass-react/style.css' layer(vendor);
   @layer vendor, base;
   ```
   玻璃库进 `vendor`，我们全部样式（`index.css`、`apple.css`、`design/*.css`）进 `base`，
   `base` 高于 `vendor`，所以 `--lg-tint` 这类库变量能被设计层接管；`design/glass.css`
   最后加载，负责全站玻璃材质。
3. **只用 tokens**，不写死颜色。可用变量见 `src/design/tokens.css`：
   - 颜色：`--bg` `--bg-elevated` `--bg-sunken` `--bg-hover` `--text` `--text-soft`
     `--text-faint` `--line` `--line-strong` `--accent` `--accent-soft` `--accent-contrast` `--accent-ink`
   - 玻璃：`--glass-tint` `--glass-tint-strong` `--glass-surface` `--glass-inset`
     `--glass-stroke` `--glass-blur` `--glass-shadow` `--glass-shadow-lift`
   - 字体：`--font-display`（宋/衬线，用于标题）`--font-sans`（界面）`--font-mono`（标签/数字）
   - 字号：`--fs-micro`(10.5) `--fs-caption`(11.5) `--fs-small`(12.5) `--fs-body`(13.5)
     `--fs-body-lg`(15) `--fs-title`(17) `--fs-heading`(22) `--fs-display`(30) `--fs-mega`(44)
   - 间距：`--sp-1`..`--sp-8`（4/8/12/16/24/32/48/64）
   - 圆角：`--r-xs`(3) `--r-sm`(4) `--r-md`(6) `--r-lg`(8) `--r-xl`(10) `--r-2xl`(22) `--r-3xl`(28) `--r-pill`
   - 动效：`--ease-out` `--ease-in-out` `--dur-fast` `--dur-base` `--dur-slow`
   - 布局：`--content-max`(1180) `--measure`(68ch)
   - 阴影：`--shadow-soft`（极轻）`--shadow-card`（仅浮层用）`--glass-shadow`
4. **主题兼容**：`[data-theme]` 有 paper / sepia / night / forest 四套。所有颜色走变量，
   深色下自动生效。玻璃的深色版本由 `[data-theme-tone='dark']` 整组覆盖。
5. **减少动效**：`@media (prefers-reduced-motion: reduce)` 与 `[data-motion='off']` 已在 base.css 处理，
   新写动画不必重复处理，但也别用 JS 强制动画。

## 视觉语言

| 维度 | 做法 | 反例（别这么干） |
|---|---|---|
| 玻璃 | 大圆角 + 半透明 tint + 1px 亮边 + 折射（`LiquidGlass`） | 纯色块 + 大投影 |
| 层级 | 浮层靠 y 位移与阴影说话，不做缩放堆叠 | 每层都 scale |
| 标题 | `--font-display` 宋体，字重 600，字距收紧 | 全部无衬线加粗 |
| 标签 | `--font-mono` 小字母距大写 | 普通小字 |
| 强调 | `--accent`，**少量**用：当前项、进度、主操作 | 大面积品牌色块 |
| 主按钮 | 胶囊 + `--accent` 底；次操作是透明胶囊 | 直角方块 |
| 数字 | `tabular-nums`，等宽对齐 | 会让进度百分比跳动 |
| 圆角 | 胶囊 999，浮层 22–28，书封 8 | 所有东西都 4px |
| 投影 | 只有玻璃浮层用 | 每个卡片都投影 |

## 浮动胶囊栏（本轮的硬指标）

书架底部一枚离窗口边缘的玻璃胶囊，`position: absolute; bottom: 24px; 水平居中`：

- 左起：搜索（可输入）、排序分段、书源、书籍市场、导入、运行日志、设置；
- 高度 52px，圆角 999，`--lg-tint: var(--glass-tint-strong)`；
- 书架 `.shelf-body` 底部预留 132px，最后一行书不被盖住；
- 窄窗口按 980 / 760 两档逐级收成图标（文字隐藏、搜索框变窄）。

## 关键修复（务必处理）

**封面灰块 bug**：旧版把 `.cover-art` 的 `background` 设成了纯灰，导致无封面图时整块是灰白板。
现在无封面图时走 `linear-gradient(150deg, var(--cover-a), var(--cover-b))` + 书名排字，
不用灰块。

## 可用工具（自己动手验收）

```bash
# 截图（改完必须看一眼）
node tools/_snap.mjs --out=.shots/xxx.png --theme=paper --w=1280 --h=800
node tools/_snap.mjs --out=.shots/xxx-dark.png --theme=night --w=1280 --h=800
# 读某个选择器的计算样式（诊断层叠）
node tools/_probe.mjs --sel=".book-card" --props="background-color,color" --theme=paper
```

截图前需先 `npm run build:vite`（截图读的是 `out/renderer/`）。
页面尺寸：书架/设置/市场用 1280×800。

## 种子数据说明

截图会注入 8 本书：6 本云端书（无封面图，走渐变回退）、2 本本地书（其中《山居手记》有正文，
可用来验证阅读器）。进度各不相同，含 0%、0.1%、100% 等边界值。
