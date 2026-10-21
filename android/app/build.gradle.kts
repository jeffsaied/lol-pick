plugins { id("com.android.application") }

android {
    namespace = "br.jeff.pickauto"
    compileSdk = 34
    defaultConfig {
        applicationId = "br.jeff.pickauto"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "1.3"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { checkReleaseBuilds = false }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

dependencies {
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    // o leitor de QR usa o AndroidX, mas nao o traz junto: sem isto o app fecha ao abrir o leitor
    implementation("androidx.appcompat:appcompat:1.6.1")
}
