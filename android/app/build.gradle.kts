plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.folio.reader"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.folio.reader"
        minSdk = 26
        targetSdk = 35
        // 4.7.2：公告独立成页（书架铃铛 + 公告中心），设置页补作者信息（versionCode 32）。
        // 4.7.1：回到 iOS 11 观感——书架 / 设置 / 同步 / 字体四个页面恢复折叠大标题，
        //        顶栏与 Tab Bar 改回半透明毛玻璃（versionCode 31）。
        // 4.7.0：排版重构——书架封面墙按宽度自适应列数、头部区合并、筛选改横滚胶囊，
        //        设置页拆成排版 / 翻页 / 外观三组，正文在宽屏收进 680dp 的阅读列（versionCode 30）。
        // 4.6.1：发布包开启 R8 与资源压缩、接入 Baseline Profile，后台停止 Compose 收集，
        //        目录扫描移出主线程（versionCode 29）。
        // 4.6.0：设置页新增「检查更新」（查 GitHub Release、跳浏览器下载）与公告列表，
        //        书架首屏顶部显示第一条未读公告横幅，已读按 id 记住（versionCode 28）。
        // 4.5.0：支持导入、阅读本地 CBZ/ZIP 漫画，并与桌面端整包同步（versionCode 27）。
        // 4.4.0：顶栏 / Tab Bar 改不透明实色，去掉折叠大标题与毛玻璃（versionCode 26）。
        // 4.3.0：毛玻璃半径减半、去掉重复全屏背景、封面菜单按需组合，降功耗（versionCode 25）。
        // 4.2.0：顶栏改 iOS 原生折叠大标题，顶栏 / Tab Bar 改毛玻璃（versionCode 24）。
        // 4.1.0：整体换 iOS 配色与排版，首页改大标题 + 分段控件 + 三列封面墙，
        //        设置 / 同步改底部 Tab Bar（versionCode 23）。
        // 4.0.0：界面换 Cupertino、导航换 Voyager、图片换 Coil/Telephoto、新增 EPUB（versionCode 22）。
        // 3.6.1：Release 构建必须带签名，关闭 allowBackup（versionCode 21）。
        versionCode = 32
        versionName = "4.7.2"
        vectorDrawables.useSupportLibrary = true
        // 只保留中英两套库字符串：AndroidX / Readium 自带六十多种语言，
        // 这个 App 的界面只有中文，多出来的 arsc 条目纯属占体积。
        resourceConfigurations += listOf("zh", "en")
    }

    // 依赖元数据只对商店分析有用，侧载 APK 里那一段直接去掉。
    dependenciesInfo {
        includeInApk = false
    }

    signingConfigs {
        // 正式签名只走环境变量。缺密钥时不再回落到 debug 签名：
        // debug 包与正式包签名不同，用户装过一次再换正式包只能卸载重装（本地书库会丢）。
        // 没有密钥的 release 构建会在下面的 taskGraph 校验里直接失败。
        create("release") {
            val storePath = System.getenv("FOLIO_KEYSTORE")
            if (storePath != null) {
                storeFile = file(storePath)
                storePassword = System.getenv("FOLIO_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("FOLIO_KEY_ALIAS")
                keyPassword = System.getenv("FOLIO_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            // R8：删无用代码、内联、缩短标识符，APK 更小、启动与滚动时驻留代码更少。
            // 之前一直关着，等于把最大的一块性能/内存收益让掉了；反射点由 proguard-rules.pro
            // 里的 keep 规则兜住（Readium / JS 桥 / kotlinx.serialization）。
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Readium 3.1.2 的 AAR 要求 core library desugaring（java.time 等）。
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        // 设备头要报真实版本号（T07 收尾）：BuildConfig.VERSION_NAME 是唯一真相，
        // 常量写死迟早和 versionName 漂开。AGP 8 起 buildConfig 默认关，得显式打开。
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
        // 运行时用不到的元数据（Kotlin 模块记录、协程调试探针）不参与打包。
        resources.excludes += setOf(
            "META-INF/*.version",
            "META-INF/*.kotlin_module",
            "DebugProbesKt.bin",
        )
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        // AGP 8.7 自带的 lint 分析 API 与 Kotlin 2.2 不兼容：
        // release 的 lintVital 会在这个 LiveData 规则里抛 IncompatibleClassChangeError 直接崩掉。
        // 本项目没有 LiveData，禁用该规则即可，其余 lintVital 检查照常跑。
        disable += "NullSafeMutableLiveData"
    }
}

// Release 包不带签名就不发：debug 签名的 APK 和正式版签名不同，
// 用户装上后无法直接升级，只能卸载重装（本地书库、进度全丢）。
// 本地只想装测试包时请用 assembleDebug（包名带 .debug 后缀，可与正式版共存）。
gradle.taskGraph.whenReady {
  if (System.getenv("FOLIO_KEYSTORE") == null && allTasks.any { it.name.contains("Release") }) {
    throw GradleException(
      "缺少 Release 签名：请设置 FOLIO_KEYSTORE / FOLIO_KEYSTORE_PASSWORD / FOLIO_KEY_ALIAS / FOLIO_KEY_PASSWORD；" +
        "只想本机测试请改用 assembleDebug。"
    )
  }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.10.1")
    // Baseline Profile 安装器：让 AGP 合并进 APK 的 baseline-prof.txt（Compose / Coil
    // 等库自带）在侧载安装时也能生效，冷启动少一轮 JIT。体积只有几十 KB。
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    // FragmentActivity 宿主（EPUB 的 Readium presenter 需要 Fragment）。
    implementation("androidx.fragment:fragment-ktx:1.8.7")

    implementation(platform("androidx.compose:compose-bom:2025.06.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")

    // 后台周期同步在 3.0 下线：只在「连接成功 / 回前台 / 手动点按」时同步，
    // 不再引 WorkManager（省一个常驻依赖，也省掉系统调度带来的不可控时机）。
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // ---- 4.0.0 重构引入的现成库（不自己写 UI 组件与算法）----
    // compose-cupertino：iOS 风格 Compose 组件（替代 Miuix / Material3 / 自研 HyperKit）。
    implementation("io.github.alexzhirkevich:cupertino:0.1.0-alpha04")
    implementation("io.github.alexzhirkevich:cupertino-icons-extended:0.1.0-alpha04")
    // Coil 3：图片加载（内存缓存、采样、请求去重）。3.6.3 要求 compileSdk 37，故锁 3.3.0。
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    // Telephoto：漫画缩放与大图分块（替代自研 ZoomableImage）。
    implementation("me.saket.telephoto:zoomable-image-coil3:0.19.0")
    // Voyager：导航 + 页面级 ScreenModel（替代 1757 行 AppViewModel 与手写 NavHost）。
    implementation("cafe.adriel.voyager:voyager-navigator:1.1.0-beta03")
    implementation("cafe.adriel.voyager:voyager-screenmodel:1.1.0-beta03")
    implementation("cafe.adriel.voyager:voyager-transitions:1.1.0-beta03")
    // Readium：EPUB 解析、排版、分页、目录（只用于真 EPUB，本机专用）。
    implementation("org.readium.kotlin-toolkit:readium-shared:3.1.2")
    implementation("org.readium.kotlin-toolkit:readium-streamer:3.1.2")
    implementation("org.readium.kotlin-toolkit:readium-navigator:3.1.2")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
