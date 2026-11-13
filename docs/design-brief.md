# Folio 重构简报 · 「纸本 / Editorial」

## 一句话方向

这不是 SaaS 后台，是一本**打开的书**。视觉上要有纸的质感、墨的重量、朱砂的一点红；
结构上靠**发丝线、留白、字号层级**分区，而不是圆角卡片 + 投影。

## 必须遵守的约束

1. **不改 JSX 结构**，除非为了新增纯装饰元素。所有既有 `className` 必须继续被样式覆盖到。
2. **不加 `!important`**。靠加载顺序（新层在最后）+ 特异性解决。新层文件按下面顺序导入：
   ```
   index.css → apple.css → skin-miui.css → design/tokens.css → design/base.css
   → design/shelf.css → design/reader.css → design/library.css
   ```
3. **只用 tokens**，不写死颜色。可用变量见 `src/design/tokens.css`：
   - 颜色：`--bg` `--bg-elevated` `--bg-sunken` `--bg-hover` `--text` `--text-soft`
     `--text-faint` `--line` `--line-strong` `--accent` `--accent-soft` `--accent-contrast` `--accent-ink`
   - 字体：`--font-display`（宋/衬线，用于标题）`--font-sans`（界面）`--font-mono`（标签/数字）
   - 字号：`--fs-micro`(10.5) `--fs-caption`(11.5) `--fs-small`(12.5) `--fs-body`(13.5)
     `--fs-body-lg`(15) `--fs-title`(17) `--fs-heading`(22) `--fs-display`(30) `--fs-mega`(44)
   - 间距：`--sp-1`..`--sp-8`（4/8/12/16/24/32/48/64）
   - 圆角：`--r-xs`(3) `--r-sm`(4) `--r-md`(6) `--r-lg`(8) `--r-xl`(10) `--r-pill`
   - 动效：`--ease-out` `--ease-in-out` `--dur-fast` `--dur-base` `--dur-slow`
   - 布局：`--content-max`(1180) `--measure`(68ch)
   - 阴影：`--shadow-soft`（极轻）`--shadow-card`（仅浮层用）
4. **主题兼容**：`[data-theme]` 有 paper / sepia / night / forest 四套。所有颜色走变量，
   深色下自动生效。若需要深色专属调整，用 `[data-theme='night']` 选择器。
5. **减少动效**：`@media (prefers-reduced-motion: reduce)` 与 `[data-motion='off']` 已在 base.css 处理，
   新写动画不必重复处理，但也别用 JS 强制动画。

## 视觉语言

| 维度 | 做法 | 反例（别这么干） |
|---|---|---|
| 分隔 | 1px 发丝线 `var(--line)`，或整块留白 | 圆角 12px 卡片 + 大投影 |
| 标题 | `--font-display` 宋体，字重 600，字距收紧 | 全部无衬线加粗 |
| 标签 | `--font-mono` 小字母距大写（`.continue-eyebrow` 已是） | 普通小字 |
| 强调 | 朱砂 `--accent`，**少量**用：当前项、进度、主操作 | 大面积品牌色块 |
| 主按钮 | 墨块（`--text` 底 + `--bg` 字），已由 base.css 定义 | 蓝色渐变 |
| 数字 | `tabular-nums`，等宽对齐 | 会让进度百分比跳动 |
| 圆角 | 3–8px | 14px+ 的药丸/大圆角 |
| 投影 | 只有真正浮起的层（面板/弹窗）用 | 每个卡片都投影 |
| 留白 | 宁可多，不可挤。级距用 8 的倍数 | 均匀 12px 铺满 |

## 关键修复（务必处理）

**封面灰块 bug**：`apple.css:1473` 把 `.cover-art` 的 `background` 设成了 `--ios-fill-3`（纯灰），
导致无封面图时整块是灰白板，而且 `--cover-a/--cover-b` 渐变被盖住。需要：
- `.cover-art` 背景改回 `linear-gradient`（用 `--cover-a`/`--cover-b`）
- 无封面图时应当是**素净的纸面 + 书名排字**，不是灰块
- 保留书脊 `.cover-spine`、`.cover-shine` 的层次感

## 可用工具（自己动手验收）

```bash
# 截图（改完必须看一眼）
node tools/_snap.mjs --out=.shots/xxx.png --theme=paper --w=1280 --h=800
node tools/_snap.mjs --out=.shots/xxx-dark.png --theme=night --w=1280 --h=800
# 读某个选择器的计算样式（诊断层叠）
node tools/_probe.mjs --sel=".book-card" --props="background-color,color" --theme=paper
```

截图前需先 `npm run build:vite`（截图读的是 dist/）。
页面尺寸：书架/设置/市场用 1280×800。

## 种子数据说明

截图会注入 8 本书：6 本云端书（无封面图，走渐变回退）、2 本本地书（其中《山居手记》有正文，
可用来验证阅读器）。进度各不相同，含 0%、0.1%、100% 等边界值。
