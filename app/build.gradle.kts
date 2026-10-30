import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 서명 키: keystore.properties 가 있으면 그 키로, 없으면 디버그 키로 서명.
// 앱 내 업데이트가 "같은 서명"일 때만 덮어쓰기 설치가 되므로 키를 바꾸면 안 된다.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.floatingclock.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.floatingclock.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 14
        versionName = "1.13"
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    // 단위 테스트에서 안드로이드 함수는 기본값만 돌려주게 (WikiTimers 의 Handler 등)
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

// 위키 자료로 하는 테스트: 자료는 공개 저장소에 없으므로 -PwikiDataDir=폴더 를 줄 때만 돈다
tasks.withType<Test>().configureEach {
    systemProperty("wikiDataDir", (project.findProperty("wikiDataDir") ?: "").toString())
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // 안드로이드의 org.json 은 테스트에서 비어 있다
}
