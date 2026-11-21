# 动效系统

动效只有**一套语言**：Apple 的「沉降」。`src/design/motion.js` 是唯一的取用入口，
组件不直接 import 变体，而是 `const kit = useMotionKit()`。

引擎是 [Motion](https://github.com/motiondivision/motion)（`motion/react`）。它此前叫
framer-motion，12 版起换了包名、重写了内核，API 基本兼容。

```
src/design/motion.js   Apple 套件 + useMotionKit() / motionKitFor()
src/ui/primitives.css  Radix 原语的交互态与定位（颜色全部取 tokens）
src/design/glass.css   液态玻璃材质（折射、亮边、浮动栏），最后加载
```

## 一套手感的原则

1. **大面位移，小面淡化。** 页面、抽屉、阅读器工具栏用 `EASE`（`cubic-bezier(0.32, 0.72, 0, 1)`）
   走位移；悬停、按压、颜色只用 `EASE_SOFT` 的短补间。
2. **临界阻尼，落定不晃。** 弹簧阻尼比压在 0.82–0.99：可以有一点点收尾，但不能来回摆。
3. **玻璃的过渡只改阴影与位移。** 折射是 `backdrop-filter` 与 SVG 位移图算出来的，
   不参与逐帧动画；对玻璃做 scale 会让折射边缘抖动。

## Token

### Apple（`MOTION_KITS.apple`）

| Token | 值 | 用途 |
| --- | --- | --- |
| `EASE` | `cubic-bezier(0.32, 0.72, 0, 1)` | 大表面位移（视图、抽屉、阅读器） |
| `EASE_SOFT` | `cubic-bezier(0.4, 0, 0.2, 1)` | 悬停、按压、颜色 |
| `DUR.page / slow / base / fast / instant` | 360 / 320 / 240 / 180 / 120ms | 页面、遮罩、控件、退场、即时反馈 |
| `SPRING.panel` | k320 / c34 / m0.92（ζ≈0.99） | 侧边面板、底部浮动栏入场 |
| `SPRING.card` | k280 / c25 / m0.90（ζ≈0.91） | 卡片、列表项、主视觉 |
| `SPRING.modal` | k400 / c28 / m0.85（ζ≈0.95） | 对话框 |
| `SPRING.toast` | k460 / c26 / m0.80（ζ≈0.82） | 提示条 |
| `SPRING.control` | k520 / c38 / m0.60（ζ≈1.07） | 分段控件的滑动拇指 |

套件必须提供固定形状的键（`page / zoom / sheet / backdrop / modal / toast / stagger /
rise / settle / spring / dur / ease / chrome / section`），少一个调用处就会漏动画。

## 组件映射

| 套件键 | 用在哪 |
| --- | --- |
| `page` | 书架 ↔ 书籍市场 ↔ 设置 |
| `zoom` | 打开阅读器 / 漫画 / 云端书 |
| `sheet('left' \| 'right')` | 目录抽屉、阅读设置、书源面板 |
| `backdrop` / `modal` | 快捷键说明、缓存管理、删除确认、日志 |
| `toast` | 右下提示条 |
| `stagger(step, delay)` + `rise` | 书架卡片、市场卡片 |
| `chrome` | 阅读器工具栏显隐 |
| `section(dir)` | 设置页分区切换（按导航方向推拉） |

## 为什么书架底部栏用弹簧入场

底部胶囊是「从屏幕外升起来」的：`y: 26 → 0`，`delay: 0.15s`，`SPRING.panel`。
它比页面内容晚 150ms，读起来像玻璃先落位、内容再出现在它后面 —— 这正是液态玻璃的方向感。

## 降低动效

- 设置里的「减少动效」→ `document.documentElement.dataset.motion = off`，`design/base.css`
  统一把动画/过渡压到 0.01ms；
- `<MotionConfig reducedMotion>` 让 Motion 只保留透明度动画（所以每个变体都带 opacity 通道）；
- `@media (prefers-reduced-motion: reduce)` 兜底系统级偏好。

## 实测数据（脚本测得，非目测）

工具：`tools/_feel.cjs`（用 CDP 注入 rAF 采样器 + 真实鼠标事件，逐帧记录一个标量），
`tools/_boot-race.cjs`（连续 reload，固定时刻采 `opacity`，统计白屏率）。

| 控件 | 按下 | 松手回弹 | 稳定 |
|---|---|---|---|
| 主按钮 `.btn` | `1 → 0.96`，约 90ms 到位 | 冲到 `1.004`（+0.39%），约 350ms | ≈430ms |
| 开关 `.switch::after` | `24 → 30px`（+25%），右边缘不动 | 无（宽度走 ease-out，设计如此） | ≈780ms |
| 分段滑块 | 拇指用 `x / width` 弹簧跟随，不再瞬移 | — | 见 `SPRING.control` |

## 已知问题

**冷启动偶发白屏（已修）**

窗口在后台或被遮挡时，Chromium 会把该窗口的 `requestAnimationFrame` 压到约 1Hz 甚至 0。
framer 的入场动画全靠 rAF 推进：挂载瞬间写下的首帧 `opacity: 0` 之后再也没有下一帧，
表现就是「内容都在、整屏透明」，用户点了窗口才突然亮起来。
实测 `visibility: hidden` 时 rAF 为 **0 帧/秒**，窗口前置后恢复到 ~145 帧/秒。

修复在 `electron/main.js` 的 `webPreferences.backgroundThrottling: false`。
验证：`node tools/_boot-race.cjs 6 --keep-bg`（不把窗口提前置），dev 与生产构建各 6 次，白屏率均为 0/6。

> 顺带暴露了一个检查盲区：截图与视觉回归全部带 `?static=1`（`MotionGlobalConfig.skipAnimations`），
> 入场动画被整体跳过，所以 8 张图全绿也发现不了白屏。需要回归时用 `_boot-race.cjs`，它不跳过动画。
