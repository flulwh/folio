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
        // 4.1.0：整体换 iOS 配色与排版，首页改大标题 + 分段控件 + 三列封面墙，
        //        设置 / 同步改底部 Tab Bar（versionCode 23）。
        // 4.0.0：界面换 Cupertino、导航换 Voyager、图片换 Coil/Telephoto、新增 EPUB（versionCode 22）。
        // 3.6.1：Release 构建必须带签名，关闭 allowBackup（versionCode 21）。
        versionCode = 23
        versionName = "4.1.0"
        vectorDrawables.useSupportLibrary = true
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
            isMinifyEnabled = false
            isShrinkResources = false
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
