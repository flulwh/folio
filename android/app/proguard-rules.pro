# Folio 安卓端 R8 规则（release 已开启 minify + shrinkResources）。
#
# 原则：只保反射 / 注解 / 序列化真正会按名字查找的类，其余交给 R8。
# 保得越宽，包体和启动收益越小；这里每一条都对应一个真实的运行时入口。

-keepattributes *Annotation*, InnerClasses, EnclosingMethod, Signature,
    RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations,
    RuntimeVisibleFieldAnnotations, AnnotationDefault

# ---- Readium（EPUB）----
# 3.1.2 没有自带 consumer rules；它的 JSON 元数据、导航器与 JS 桥都按类名 / 注解
# 工作，混淆后表现是「EPUB 能打开但目录 / 排版为空」。整体保留换来的是可预期的行为，
# 其余依赖（Compose / Coil / Telephoto 等）仍有 consumer rules，照常参与压缩。
-keep class org.readium.r2.** { *; }
-keep interface org.readium.r2.** { *; }
-dontwarn org.readium.r2.**

# Readium 的 WebView 桥：被注入的 JS 按方法名调用。
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ---- kotlinx.serialization ----
# 生成的 serializer 通过伴生对象按名字查找；Readium 的 Instant / Language 走这条路。
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}

-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}

-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    *** Companion;
}

# ---- 其他 ----
# 枚举按 valueOf 反查（目前只有状态枚举，保留成本可忽略）。
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
