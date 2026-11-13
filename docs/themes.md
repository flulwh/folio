# 主题扩展

Folio 的主题是「一组 CSS 变量」。内置四套（浅色 / 暖沙 / 深色 / 冷灰）写在 `src/index.css` 与 `src/apple.css` 里；除此之外，还可以：

- 在 **设置 → 外观 → 新建主题** 里调颜色，实时生效；
- 用 **导入** 粘贴一段主题 JSON；
- 装带 `themes` 权限的插件，由插件提供配色（例如商店里的「配色包」）。

自定义主题和插件主题都会出现在主题网格里，插件提供的会带一个「插件」角标。

## 主题 JSON

```json
{
  "id": "amber",
  "label": "琥珀",
  "tone": "light",
  "tokens": {
    "bg": "#fbf3e6",
    "bgElevated": "#fffaf0",
    "bgSunken": "#f3e7d2",
    "bgHover": "rgba(140, 96, 40, 0.1)",
    "text": "#2a1f12",
    "textSoft": "rgba(64, 46, 26, 0.62)",
    "textFaint": "rgba(64, 46, 26, 0.34)",
    "line": "rgba(110, 80, 42, 0.24)",
    "accent": "#c2681a",
    "accentSoft": "rgba(194, 104, 26, 0.14)",
    "accentContrast": "#fffaf0",
    "sheetBg": "rgba(255, 250, 240, 0.88)",
    "toolbarBg": "rgba(251, 243, 230, 0.84)"
  }
}
```

- `id`：小写字母、数字、连字符，2–41 位；插件提供的会自动加 `<插件id>-` 前缀。
- `label`：显示名，最多 24 字。
- `tone`：`light` 或 `dark`。它决定用哪套「外壳」承载阴影、描边、滚动条这类结构性样式（`light` → 浅色外壳，`dark` → 深色外壳）。
- `tokens`：至少要有 `bg` 与 `text`，其余缺省会由这两项和 `tone` 推导。支持 `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` / `hsl()` / `hsla()` / 颜色关键字。

### 令牌含义

| 令牌 | CSS 变量 | 用途 |
| --- | --- | --- |
| `bg` | `--bg` | 页面底色 |
| `bgElevated` | `--bg-elevated` | 卡片、弹层 |
| `bgSunken` | `--bg-sunken` | 输入框、凹槽 |
| `bgHover` | `--bg-hover` | hover 底色 |
| `text` | `--text` | 主文字 |
| `textSoft` | `--text-soft` | 次级文字 |
| `textFaint` | `--text-faint` | 弱化文字、占位 |
| `line` | `--line` | 发丝线 |
| `accent` | `--accent` | 强调色（主按钮、进度、选中） |
| `accentSoft` | `--accent-soft` | 强调色的弱底 |
| `accentContrast` | `--accent-contrast` | 强调色上的文字 |
| `sheetBg` | `--sheet-bg` | 面板/弹层玻璃底 |
| `toolbarBg` | `--toolbar-bg` | 工具栏玻璃底 |

## 实现方式

主题生效时，应用会把令牌写到 `<html>` 的行内样式（`--bg`、`--text` …），行内样式优先级最高，所以对内置主题之外的自定义主题同样有效。同时：

- `html[data-theme]` 被设成外壳主题（`paper` / `night`），保证阴影、滚动条、玻璃等结构性样式跟着明暗走；
- `html[data-theme-id]` 是真实主题 id，`data-theme-tone` 是 `light`/`dark`，便于写针对性的样式。

切换回内置主题时会清掉所有行内变量，完全回到 CSS 定义。

## 插件提供主题

插件需要 `themes` 权限：

```json
{ "permissions": ["themes"] }
```

```js
module.exports.activate = (folio) => {
  folio.themes.register({
    id: 'amber',
    label: '琥珀',
    tone: 'light',
    tokens: { bg: '#fbf3e6', text: '#2a1f12', accent: '#c2681a' },
  });
};
```

- 一个插件最多提供 8 个主题；id 会自动加插件前缀，不会和内置/其他插件冲突。
- 插件被停用或卸载时，它提供的主题会自动消失；如果当时正用着该主题，界面会回落到浅色。
- 主题令牌只接受颜色字符串，超出白名单的键会被忽略，不能借主题注入任意 CSS。

## 相关文件

- `src/themes.js`：内置令牌、规范化、`applyTheme`、JSON 导入导出。
- `src/store/AppStore.jsx`：`themes` / `activeTheme` / `saveCustomTheme` / `removeCustomTheme`，以及插件主题订阅。
- `src/components/SettingsPage.jsx`：主题网格、编辑器、导入导出。
- `electron/plugins.js`：`folio.themes` 与主题校验。
