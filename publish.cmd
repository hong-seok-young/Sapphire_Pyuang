@echo off
REM Build the release APK and publish it as a GitHub release so installed apps pick it up.
REM Usage: publish.cmd [release notes]
REM The version comes from versionName in app\build.gradle.kts (bump versionCode + versionName first).
REM NOTE: keep this file ASCII-only; cmd.exe mangles UTF-8 Korean text.
setlocal
cd /d "%~dp0"

call build.cmd
if errorlevel 1 exit /b 1

for /f "tokens=3 delims== " %%v in ('findstr /c:"versionName" app\build.gradle.kts') do set VER=%%~v
set VER=%VER:"=%
if "%VER%"=="" (
    echo Could not read versionName from app\build.gradle.kts
    exit /b 1
)

set APK=FloatingClock-v%VER%.apk
copy /y app\build\outputs\apk\release\app-release.apk "%APK%" >nul

set NOTES=%*
if "%NOTES%"=="" set NOTES=v%VER%

echo Publishing %APK% as release v%VER% ...
gh release create "v%VER%" "%APK%" --repo hong-seok-young/floating-clock --title "v%VER%" --notes "%NOTES%"
if errorlevel 1 (
    echo Release failed. Is the repo created and gh logged in?
    exit /b 1
)
echo Done: https://github.com/hong-seok-young/floating-clock/releases/tag/v%VER%
