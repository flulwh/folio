# 应用图标

| 文件 | 用途 |
| --- | --- |
| `icon.svg` | 主图标（1024 画板，48px 以上使用，含纸纹细节与金色书签） |
| `icon-small.svg` | 16–24px 简化版（更大的书、加宽中缝、无书签和文字线） |
| `icons/icon-*.png` | 16 / 24 / 32 / 48 / 64 / 128 / 256 / 512 / 1024 导出图（透明底） |
| `icon.ico` | Windows 多尺寸图标（16、24 取自简化版，32+ 用主图标） |

色值：底板 `#8674FF → #4330B2`，纸页 `#FFFEF9 → #E7DAC2`，书签 `#FFDD9C → #D68B27`，文字线 `#8B7AE8`。
重命名/改色后重新导出：

```bash
# 需要 Chrome；按尺寸逐个导出（透明背景）
chrome --headless=new --default-background-color=00000000 --window-size=256,256 --screenshot=icons/icon-256.png icon.html
```

`package.json` 的 `build.win.icon` 指向 `build/icon.ico`，`npm run build` 时会把该图标写进 exe 与安装包；运行时窗口图标见 `electron/icon.png`。
