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
        // 3.4.8：设置页「本机版本」改读 BuildConfig，不再写死 3.0.0。
        // X-Folio-App-Version 直接读 VERSION_NAME，版本号只有这一处真相。
        versionCode = 14
        versionName = "3.4.8"
        vectorDrawables.useSupportLibrary = true
    }

    signingConfigs {
        // 用 debug 签名，方便直接安装测试；正式签名走环境变量。
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
            signingConfig = if (System.getenv("FOLIO_KEYSTORE") != null) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
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
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")

    implementation(platform("androidx.compose:compose-bom:2025.06.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // Miuix：HyperOS 风格的 Compose 组件库（卡片 / 抽屉 / 开关 / 滑杆 / 顶栏）。
    // 0.4.9 对齐 Compose 1.8.2，本项目的 BOM 是 1.8.3，兼容。
    implementation("top.yukonga.miuix.kmp:miuix:0.4.9")

    // 后台周期同步在 3.0 下线：只在「连接成功 / 回前台 / 手动点按」时同步，
    // 不再引 WorkManager（省一个常驻依赖，也省掉系统调度带来的不可控时机）。
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
