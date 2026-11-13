# docs/

设计说明与审计记录。都是纯文本，随主仓库一起走。

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
