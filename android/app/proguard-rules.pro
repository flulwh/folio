# Folio 桌面端已经运行在受限的 WebView 里，Android 端也保持最小混淆：
# 只保留数据结构与协程相关的规则，其余依赖不参与反射调用。

-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
