# Lazy Macros — Build & Run

Android app (Capacitor) wrapping the web app in `www/`. App ID `com.lazymacros.app`.

## Prerequisites
- **Node.js** LTS (tested with v22)
- **Android Studio** + Android SDK (Platform-Tools, an SDK Platform, an emulator image)
- **JDK 17** — bundled with Android Studio at `C:\Program Files\Android\Android Studio\jbr`

Environment variables (set once; already configured on the dev machine):
```
ANDROID_HOME      = %LOCALAPPDATA%\Android\Sdk
ANDROID_SDK_ROOT  = %LOCALAPPDATA%\Android\Sdk
JAVA_HOME         = C:\Program Files\Android\Android Studio\jbr
```
`android/local.properties` also pins `sdk.dir` for Gradle (git-ignored, machine-specific).

## Develop / run
- **Web only (fast iteration):** `npx http-server www -p 8080 -c-1` → open http://localhost:8080 (use the browser device toolbar to preview mobile ≤720px).
- **On Android (emulator or attached device):** `npx cap run android`
- **After editing anything in `www/`:** `npx cap sync android` (copies web assets into the native project).

## Tests
- `npm test` — runs `node --test` over `tests/` (assessment view-model unit tests).

## Emulator (WHPX, since Hyper-V/VBS is active on this machine)
The Android Emulator Hypervisor Driver (AEHD) cannot run alongside Hyper-V. Use
**Windows Hypervisor Platform (WHPX)** instead:
1. Enable the "Windows Hypervisor Platform" + "Virtual Machine Platform" Windows
   features (see project chat for exact steps), then reboot.
2. In Android Studio → Virtual Device Manager → Create Device (e.g. Pixel 7, API 34).
3. Start the emulator, then `npx cap run android`.

## App identity
- Name: **Lazy Macros** · Package: **com.lazymacros.app**
- Icon/splash source: `assets/logo.svg`. Regenerate after changing it:
  ```
  npx @capacitor/assets generate --android --iconBackgroundColor "#16324f" --splashBackgroundColor "#16324f"
  ```

## Release build (.aab for Play Console)

### One-time: create the upload keystore
The upload keystore is the **only** way to publish updates to Google Play.
**Back it up and store its password in a password manager. Never commit it.**
```
keytool -genkeypair -v -keystore lazy-macros-release.keystore -alias lazymacros \
  -keyalg RSA -keysize 2048 -validity 10000
```
Then create `android/key.properties` (git-ignored):
```
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=lazymacros
storeFile=../../lazy-macros-release.keystore
```
The signing config in `android/app/build.gradle` reads this file automatically. If
`key.properties` is absent, a release build falls back to debug signing (fine for
local testing, NOT publishable).

### Build the bundle
```
npx cap sync android
cd android
.\gradlew.bat bundleRelease      # macOS/Linux: ./gradlew bundleRelease
```
Artifact: `android/app/build/outputs/bundle/release/app-release.aab`

A debug APK for sideloading is produced by `.\gradlew.bat assembleDebug`
(`android/app/build/outputs/apk/debug/app-debug.apk`).

## Keystore safety (read this)
Losing `lazy-macros-release.keystore` or its password means you can never update
the app on Google Play under the same listing. Back up the keystore file and its
passwords now, in more than one place.
