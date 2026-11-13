# 动效系统

动效分**两套语言**，跟着皮肤走，不是一套参数换数字。`src/motion-kit.js` 是唯一的取用入口：
组件不再直接 import 某个变体，而是 `const kit = useMotionKit()`，由当前皮肤决定拿到哪套。

```
src/motion.js        Apple  ·「沉降」
src/motion-miui.js   MIUI   ·「回弹 + 推进」
src/motion-kit.js    皮肤 → 套件映射 + useMotionKit() / motionKitFor(skin)
src/miui-motion.css  MIUI 的按下 / 悬停 / 拖动（CSS 层，最后加载）
```

## 两套手感差在哪

| 维度 | Apple（沉降） | MIUI（回弹 + 推进） |
| --- | --- | --- |
| 转场 | 交叉淡化 + 0.992→1 缩放 | 从右侧推入 34px，旧页向左让位 |
| 入书 | 缩放 1.012→1，几乎看不出位移 | 0.94→1 的「长出来」，弹簧过冲 |
| 弹簧阻尼比 | 0.88–1.0（临界阻尼，不晃） | 0.70–0.93（刻意欠阻尼，收尾有回弹） |
| 列表级联 | 20ms 一拍 | 26ms 一拍，能看出「一列列亮起来」 |
| 亮度 | 悬停抬起 3–5px | 悬停不位移，只有按压才位移 |
| 按压 | 0.97，140ms 平滑 | 0.96，按下 80ms 直线、松手 260ms 弹簧 |

### 三条原则（MIUI 侧）

1. **按下是瞬时的，回弹才是弹簧。** 按下 80ms 到位（用户要的是「我按到了」），松手走
   `cubic-bezier(0.34, 1.56, 0.64, 1)`，过冲 1–2%。这一对不对称就是 MIUI 手感的来源；
   两个方向都做 140ms 补间，读起来只是「淡了一下」。
2. **层级越深，位移越大。** 同级推进 34px，入书是「生长」而非平移，弹窗从中心弹出。
   距离本身在解释信息结构。
3. **悬停不位移，只有按压位移。** 一屏 20 张封面同时上飘会让界面显得在抖；
   悬停用底色和阴影说话，位移留给真正的动作。

## Token

### Apple（`src/motion.js`）

| Token | 值 | 用途 |
| --- | --- | --- |
| `EASE` | `cubic-bezier(0.32, 0.72, 0, 1)` | 大表面位移（视图、抽屉、阅读器） |
| `EASE_SOFT` | `cubic-bezier(0.4, 0, 0.2, 1)` | 悬停、按压、颜色 |
| `DUR.page / slow / base / fast / instant` | 360 / 320 / 240 / 180 / 120ms | 页面、遮罩、控件、退场、即时反馈 |
| `SPRING.panel` | k320 / c34 / m0.92（ζ≈0.99） | 侧边面板 |
| `SPRING.card` | k280 / c25 / m0.90（ζ≈0.91） | 卡片、列表项、主视觉 |
| `SPRING.modal` | k400 / c28 / m0.85（ζ≈0.95） | 对话框 |
| `SPRING.toast` | k460 / c26 / m0.80（ζ≈0.82） | 提示条 |

### MIUI（`src/motion-miui.js`）

| Token | 值 | 用途 |
| --- | --- | --- |
| `MI_EASE` | `cubic-bezier(0.2, 0, 0, 1)` | 「standard」：起步极快、尾巴很长 |
| `MI_EASE_IN` | `cubic-bezier(0.4, 0, 1, 1)` | 退场，不拖尾 |
| `MI_DUR.page / slow / base / fast / instant` | 340 / 300 / 220 / 160 / 80ms | 页面、遮罩、控件、颜色、按下 |
| `MI_SPRING.tap` | k700 / c34 / m0.55（ζ≈0.86） | 按压回弹 |
| `MI_SPRING.control` | k520 / c30 / m0.70（ζ≈0.79） | 分段滑块、开关 |
| `MI_SPRING.surface` | k380 / c32 / m0.85（ζ≈0.89） | 面板、整页推进 |
| `MI_SPRING.pop` | k620 / c27 / m0.60（ζ≈0.70） | 弹窗、提示条 |
| `MI_SPRING.chrome` | k420 / c34 / m0.80（ζ≈0.93） | 阅读器上下工具栏 |

两套的键名完全一致（`page / zoom / sheet / backdrop / modal / toast / stagger / rise /
settle / spring / dur / ease / chrome / section`），缺一个切皮肤时就会漏动画。

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

## 为什么 MIUI 的手感单独一个 CSS 层

`skin-miui.css`（视觉层）在 `design/` **之前**加载，而 `design/` 那套编辑排版会重定义控件形态
——顶栏排序是下划线标签、设置页分段是方角小滑块。皮肤层里写的按压、滑块、开关动效和这些规则
同优先级且更早，于是全被盖回去，MIUI 实际只活下来一个主色。

所以手感单独成层 `src/miui-motion.css`，**放在最后加载**：谁也不用和谁比 `!important`，
皮肤想要的那套交互才真的跑得起来。它整套规则仍挂在 `[data-skin='miui']` 下，Apple 不受影响。

高频交互（按下、悬停、拖动）必须是 CSS：按下到变色之间不能有一次 React 渲染的延迟。
位移和转场才交给 framer。

## 降低动效

- 设置里的「减少动效」→ `document.documentElement.dataset.motion = off`，`design/base.css`
  统一把动画/过渡压到 0.01ms；
- `<MotionConfig reducedMotion>` 让 framer 只保留透明度动画（所以每个变体都带 opacity 通道）；
- `@media (prefers-reduced-motion: reduce)` 兜底系统级偏好；
- 橡皮筋开关是靠 `width` 变形的，压掉时长仍会留一个静态宽度，`miui-motion.css` 里单独锁死。

## 改动的文件

`src/motion.js`、`src/motion-miui.js`、`src/motion-kit.js`、`src/miui-motion.css`、
`src/main.jsx`、`src/App.jsx`、`src/components/{Bookshelf,BookMarket,Segmented,Reader,SettingsPage,SettingsPanel,TocPanel,ShortcutHelp,SourcePanel,LogPanel}.jsx`
