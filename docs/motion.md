# 动效系统（macOS 风格）

`src/motion.js` 是唯一的动效参数来源：曲线、时长、弹簧、变体都在这里定义，组件只引用 token，不再各自写魔法数字。

## 原则

1. **动效只解释层级**：内容淡入并轻微落位；面板、抽屉、对话框用接近临界阻尼的弹簧滑入。
2. **快进慢出**：入场 220–360ms，退场约为入场的 65%。
3. **距离小、缩放轻**：位移 8–14px，缩放 0.99–1.01；观感是「落定」，不是「飞入」。
4. **弹簧阻尼比 0.88–1.0**：大表面完全不回弹，小控件允许一丝过冲。
5. **降低动效时仍传达层级**：只保留透明度，其余位移/缩放归零。

## Token

| Token | 值 | 用途 |
| --- | --- | --- |
| `EASE` | `cubic-bezier(0.32, 0.72, 0, 1)` | 大表面位移（视图、抽屉、阅读器） |
| `EASE_SOFT` | `cubic-bezier(0.4, 0, 0.2, 1)` | 悬停、按压、颜色 |
| `DUR.page / slow / base / fast / instant` | 360 / 320 / 240 / 180 / 120ms | 页面、遮罩、控件、退场、即时反馈 |
| `SPRING.panel` | k320 / c34 / m0.92（ζ≈0.99） | 侧边面板 |
| `SPRING.card` | k260 / c28 / m0.90（ζ≈0.91） | 卡片、列表项、主视觉 |
| `SPRING.modal` | k380 / c32 / m0.85（ζ≈0.95） | 对话框 |
| `SPRING.toast` | k420 / c30 / m0.80（ζ≈0.82） | 提示条（唯一允许轻微回弹的） |

## 变体与映射

| 变体 | 用在哪 |
| --- | --- |
| `pageVariants` | 书架 ↔ 书籍市场（淡入 + 0.992→1 缩放，退场更快） |
| `zoomInVariants` | 打开阅读器 / 漫画（像窗口从书架里长出来） |
| `sheetVariants('left' \| 'right')` | 目录抽屉、阅读设置、书源面板 |
| `modalVariants` / `backdropVariants` | 快捷键说明、缓存管理、删除确认、日志 |
| `toastVariants` | 右下提示条 |
| `staggerContainer(step, delay)` + `riseItem` | 书架卡片、市场卡片、书源行 |
| `settleItem` | 需要更「贴地」的网格项 |

## 交互节奏

- **视图切换**：`AnimatePresence` 不再 `mode="wait"`，退场与入场重叠（`.view` 是绝对定位），过渡中不会出现空白帧。
- **悬停**：卡片 280ms 上浮 3–5px；按钮只换色，不位移。
- **按压**：卡片封面 `scale(0.985)`、图标按钮 `scale(0.9)`、主按钮 `scale(0.97)`，全部 140ms。
- **阅读器 / 漫画工具栏**：透明度 200ms 先行，位移 280ms 跟随。

## 降低动效

- 设置面板的「减少动效」开关 → `document.documentElement.dataset.motion = off`，CSS 层统一把动画/过渡压到 0.001ms；
- 同时 `<MotionConfig reducedMotion={...}>` 让 framer 只保留透明度动画；
- 另有一份 `@media (prefers-reduced-motion: reduce)` 兜底系统级偏好。

## 改动的文件

`src/motion.js`（新增）、`src/App.jsx`、`src/components/Bookshelf.jsx`、`src/components/BookMarket.jsx`、`src/components/SettingsPanel.jsx`、`src/components/TocPanel.jsx`、`src/components/ShortcutHelp.jsx`、`src/components/LogPanel.jsx`、`src/components/SourcePanel.jsx`、`src/index.css`。
