@echo off
REM Build script for Floating Clock APK (portable JDK / Android SDK / Gradle)
REM NOTE: keep this file ASCII-only; cmd.exe mangles UTF-8 Korean text.
set JAVA_HOME=C:\Users\Administrator\android-dev\jdk
set ANDROID_HOME=C:\Users\Administrator\android-dev\sdk
set GRADLE_USER_HOME=C:\Users\Administrator\android-dev\gradle-home
REM Gradle dies with "Unable to establish loopback connection" when TEMP has an 8.3 short name (ADMINI~1), so pin it.
set TEMP=C:\Users\Administrator\android-dev\tmp
set TMP=C:\Users\Administrator\android-dev\tmp
if not exist "%TEMP%" mkdir "%TEMP%"
set PATH=%JAVA_HOME%\bin;%PATH%
cd /d "%~dp0"

if exist gradlew.bat (
    call gradlew.bat assembleRelease --console=plain
) else (
    call C:\Users\Administrator\android-dev\gradle-8.4\bin\gradle.bat assembleRelease --console=plain
)
if errorlevel 1 (
    echo.
    echo BUILD FAILED
    exit /b 1
)
echo.
echo BUILD OK
echo APK: %~dp0app\build\outputs\apk\release\app-release.apk
