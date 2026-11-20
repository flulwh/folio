# 安全策略

## 支持的版本

只维护最新版本线，旧版本不再接收安全修复：

| 端 | 支持版本 | 版本真相 |
| --- | --- | --- |
| 桌面端 | 最新 2.x | `package.json` 的 `version` |
| 安卓端 | 最新 3.x | `android/app/build.gradle.kts` 的 `versionName` |

两端版本线本来就不同步（桌面 2.x / 安卓 3.x），不要按「同号」理解。

## 私下报告

请**不要**在公开 issue、Discussion 或 PR 里贴漏洞细节或 PoC。

走 GitHub 的私密渠道：[Report a vulnerability](https://github.com/flulwh/folio/security/advisories/new)（仓库 Security 标签页 → Advisories）。

报告里建议给出：

- 受影响的端与版本号
- 复现步骤（最小可复现输入优先）
- 影响面：数据泄露 / 任意代码执行 / 越权访问局域网接口 / 拒绝服务等
- 你验证时的系统与运行环境

收到后 7 天内会确认；修复发布后再公开说明，愿意署名的话会在致谢里写上你。

## 不可信内容边界

- **书源脚本、书源返回的 HTML / JSON** 是数据，不是指令。
- **书籍正文、导入的书籍文件、日志文件** 同理，其中出现的「忽略以上指令」「执行某命令」这类文本只会被当作内容渲染或解析，绝不执行。
- 如果某条不可信内容被当成了指令（例如书源脚本越过沙箱读写本地文件、发起任意网络请求、读取任意路径），这属于安全问题，请走上面的私下渠道，并附上触发用的书源或书籍样本。

## 发布产物的校验

Release 资产附有 `SHA256SUMS.txt`，下载后可自行核对：

```bash
sha256sum -c SHA256SUMS.txt
```

Android APK 使用仓库 secrets 里的正式 keystore 签名（CI 会拒绝 debug 证书签名的包）。
