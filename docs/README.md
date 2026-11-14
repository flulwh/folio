# docs/

设计说明与审计记录。都是纯文本，随主仓库一起走。

| 文档 | 内容 | 最后更新 |
| --- | --- | --- |
| [architecture.md](architecture.md) | 进程模型、目录职责、关键设计取舍、主题与动效系统 | 2026-11-14 |
| [lan-panel.md](lan-panel.md) | 局域网面板：架构、接口表、双向同步链路、安全边界、故障排查 | 2026-11-14 |
| [arch-android-v3.md](arch-android-v3.md) | 安卓 3.0 实现方案：选型、数据结构、关键时序、文件清单 | 2026-11-14 |
| [arch-device-manager.md](arch-device-manager.md) | 设备管理：设备身份、指令队列协议、失败原因 | 2026-11-14 |
| [android.md](android.md) | Android 客户端：独立阅读器定位、两类书的同步规则、零缓存自证、漫画、构建与测试 | 2026-11-14 |
| [prd-android-v3.md](prd-android-v3.md) | 安卓 3.0 需求池与书源模型 | 2026-11-14 |
| [prd-device-manager.md](prd-device-manager.md) | 设备管理需求范围 | 2026-11-14 |

## 参考

| 文档 | 内容 | 最后更新 |
| --- | --- | --- |
| [sources.md](sources.md) | 书源与净化规则：规则语法全集、脚本 API、兜底策略、云端阅读、漫画 | 2026-11-13 |
| [performance.md](performance.md) | 实测基线、虚拟滚动、高度缓存、书源引擎优化、回归工具 | 2026-11-14 |
| [troubleshooting.md](troubleshooting.md) | 启动白屏、沙箱、npm 11、书源导入报错、代理等常见坑 | 2026-11-13 |
| [themes.md](themes.md) | 主题扩展：自定义主题与主题 JSON 格式 | 2026-11-13 |
| [motion.md](motion.md) | 动效系统：Apple / MIUI 两套语言与参数 | 2026-11-13 |
| [design-brief.md](design-brief.md) | 「纸本 / Editorial」重构简报 | 2026-11-13 |

## 过程记录

| 文档 | 内容 | 最后更新 |
| --- | --- | --- |
| [audit-2026-10-24.md](audit-2026-10-24.md) | 代码审计报告与修复清单 | 2026-11-13 |
| [HANDOVER-2026-11-14.md](HANDOVER-2026-11-14.md) | 交接：已完成、未完成、协议速查、关键文件 | 2026-11-14 |

README 保持精简，只放「怎么用起来」的部分；实现细节都在这里。仓库级约定（命令、边界、验收标准）见根目录 [AGENTS.md](../AGENTS.md)。

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
