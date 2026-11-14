# 应用图标

| 文件 | 用途 |
| --- | --- |
| `icon.svg` | 图标源文件（1024 画板：墨底、纸页折角、橙色书签与文本线） |
| `icon.png` | 由 `icon.svg` 渲染出的 1024 图（后续缩放的母版） |
| `icons/icon-*.png` | 16 / 24 / 32 / 48 / 64 / 96 / 128 / 256 / 512 / 1024 导出图（透明底） |
| `icon.ico` | Windows 多尺寸图标（16–256，PNG 压缩条目） |

色值取自 `src/design/tokens.css` 的品牌色：底板 `#141413`，纸页 `#FAF9F5`，书签与折角 `#D97757`，文本线 `#B0AEA5`。

重新导出：

```bash
# 渲染母版（透明背景，1024×1024）
chrome --headless=new --no-sandbox --disable-gpu \
  --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot=icon.png icon.svg

# 其余尺寸由 icon.png 等比缩放，再打包成 16–256 的 icon.ico
```

`package.json` 的 `build.win.icon` 指向 `build/icon.ico`，`npm run build` 时会把该图标写进 exe 与安装包；运行时窗口图标见 `electron/icon.png`。
