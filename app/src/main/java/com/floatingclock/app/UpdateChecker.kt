package com.floatingclock.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * GitHub 릴리스에서 새 버전을 확인하고 APK를 받아 설치 화면을 띄운다.
 *
 * 배포 방법: 저장소에 태그 v1.2 같은 릴리스를 만들고 APK 파일을 첨부하면 끝.
 * (프로젝트의 publish.cmd 가 빌드 + 릴리스 생성을 한 번에 해준다.)
 */
object UpdateChecker {

    const val REPO = "hong-seok-young/Sapphire_Pyuang"
    private const val LATEST_API = "https://api.github.com/repos/$REPO/releases/latest"

    data class Release(val version: String, val apkUrl: String, val notes: String)

    private val main = Handler(Looper.getMainLooper())

    /** 최신 릴리스 조회. 콜백은 메인 스레드. 실패하면 null. */
    fun fetchLatest(callback: (Release?) -> Unit) {
        thread(name = "update-check") {
            val result = runCatching { fetchLatestBlocking() }.getOrNull()
            main.post { callback(result) }
        }
    }

    private fun fetchLatestBlocking(): Release? {
        val conn = (URL(LATEST_API).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 8000
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("User-Agent", "FloatingClock-Android")
        }
        try {
            if (conn.responseCode != 200) return null
            val json = JSONObject(conn.inputStream.bufferedReader().readText())
            val tag = json.optString("tag_name").removePrefix("v").trim()
            if (tag.isEmpty()) return null
            val assets = json.optJSONArray("assets") ?: return null
            var apkUrl: String? = null
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                if (a.optString("name").endsWith(".apk")) {
                    apkUrl = a.optString("browser_download_url")
                    break
                }
            }
            return Release(tag, apkUrl ?: return null, json.optString("body"))
        } finally {
            conn.disconnect()
        }
    }

    /** "1.2.1" 과 "1.10" 처럼 점으로 나눈 숫자 버전 비교 */
    fun isNewer(remote: String, local: String): Boolean {
        val r = remote.split('.').map { it.filter(Char::isDigit).toIntOrNull() ?: 0 }
        val l = local.split('.').map { it.filter(Char::isDigit).toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(r.size, l.size)) {
            val a = r.getOrElse(i) { 0 }
            val b = l.getOrElse(i) { 0 }
            if (a != b) return a > b
        }
        return false
    }

    /** "출처를 알 수 없는 앱 설치" 허용 여부 (안드로이드 8+) */
    fun canInstall(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.packageManager.canRequestPackageInstalls()

    fun openInstallPermission(ctx: Context) {
        val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
    }

    /**
     * APK 다운로드 후 설치 화면 실행.
     * onProgress(0~100), onDone(성공 여부, 오류 메시지) 는 메인 스레드에서 호출.
     */
    fun downloadAndInstall(
        ctx: Context,
        apkUrl: String,
        onProgress: (Int) -> Unit,
        onDone: (Boolean, String?) -> Unit
    ) {
        thread(name = "update-download") {
            val file = File(ctx.cacheDir, "update.apk")
            val ok = runCatching {
                val conn = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 10000
                    readTimeout = 30000
                    instanceFollowRedirects = true
                    setRequestProperty("User-Agent", "FloatingClock-Android")
                }
                try {
                    if (conn.responseCode != 200) error("HTTP ${conn.responseCode}")
                    val total = conn.contentLength.toLong()
                    var read = 0L
                    var lastPct = -1
                    conn.inputStream.use { input ->
                        file.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                read += n
                                if (total > 0) {
                                    val pct = (read * 100 / total).toInt()
                                    if (pct != lastPct) {
                                        lastPct = pct
                                        main.post { onProgress(pct) }
                                    }
                                }
                            }
                        }
                    }
                } finally {
                    conn.disconnect()
                }
            }
            main.post {
                if (ok.isSuccess) {
                    runCatching { launchInstaller(ctx, file) }
                        .onSuccess { onDone(true, null) }
                        .onFailure { onDone(false, it.message) }
                } else {
                    onDone(false, ok.exceptionOrNull()?.message)
                }
            }
        }
    }

    private fun launchInstaller(ctx: Context, apk: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", apk)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
    }
}
