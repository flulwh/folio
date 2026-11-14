# docs/

设计说明与审计记录。都是纯文本，随主仓库一起走。

| 文档 | 内容 |
| --- | --- |
| [lan-panel.md](lan-panel.md) | 局域网面板：架构、接口表、双向同步链路、安全边界、故障排查 |
| [android.md](android.md) | Android 客户端：独立阅读器定位、两类书的同步规则、零缓存自证、漫画、构建与测试 |
| [sources.md](sources.md) | 书源与净化规则：规则语法全集、脚本 API、兜底策略、云端阅读、漫画 |
| [architecture.md](architecture.md) | 进程模型、目录职责、关键设计取舍、主题与动效系统 |
| [performance.md](performance.md) | 实测基线、虚拟滚动、高度缓存、书源引擎优化、回归工具 |
| [troubleshooting.md](troubleshooting.md) | 启动白屏、沙箱、npm 11、书源导入报错、代理等常见坑 |
| [themes.md](themes.md) | 主题扩展：自定义主题与主题 JSON 格式 |
| [motion.md](motion.md) | 动效系统：Apple / MIUI 两套语言与参数 |
| [design-brief.md](design-brief.md) | 「纸本 / Editorial」重构简报 |
| [audit-2026-10-24.md](audit-2026-10-24.md) | 代码审计报告与修复清单 |

README 保持精简，只放「怎么用起来」的部分；实现细节都在这里。

## 截图不在这里

README 用到的截图（46 张 PNG）已迁到独立仓库 **[flulwh/folio-assets](https://github.com/flulwh/folio-assets)**，
这样 clone 本仓库时不必为十几张图片多拉 22 MB。

新增截图请上传到那个仓库的 `docs/` 目录，再在 Markdown 里用：

```markdown
![说明](https://raw.githubusercontent.com/flulwh/folio-assets/main/docs/<文件名>.png)
```

GitHub 渲染 README 时会经 camo 缓存外链图片，浏览者实际走的是 GitHub CDN，不受源站速度影响。

> 不要用 `releases/download/...` 这种地址放图片：Release 资产返回
> `Content-Type: application/octet-stream` + `Content-Disposition: attachment`，
> 能否在 `<img>` 里渲染取决于浏览器嗅探，不可靠。
