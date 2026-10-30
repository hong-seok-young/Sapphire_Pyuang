package com.floatingclock.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.widget.Toast
import androidx.annotation.RequiresApi
import androidx.core.content.IntentCompat
import java.io.File

/**
 * 받은 새 버전 APK를 안드로이드 설치 프로그램에 직접 넘겨서 설치한다.
 * 안드로이드 12 이상은 앱이 자기 자신을 업데이트할 때 설치 확인 창 없이 바로 설치된다
 * (UPDATE_PACKAGES_WITHOUT_USER_ACTION). 폰이 그래도 확인을 원하면 UpdateResultReceiver 가 확인 창을 띄운다.
 * 설치가 끝나면 앱이 닫히고, StartupReceiver 가 새 버전의 첫 화면을 다시 연다.
 */
object UpdateInstaller {

    const val EXTRA_VERSION = "com.floatingclock.app.extra.UPDATE_VERSION"

    /** 확인 없이 설치할 수 있는 폰인지 ('출처를 알 수 없는 앱 설치'를 이 앱에 허용한 안드로이드 12 이상) */
    fun canInstallSilently(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && UpdateChecker.canInstall(ctx)

    /** 설치를 시작한다. 안 되면 예외를 던지고, 그때는 예전처럼 설치 화면을 띄우면 된다 */
    @RequiresApi(Build.VERSION_CODES.S)
    fun install(ctx: Context, apk: File, version: String) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        try {
            installer.openSession(id).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { out ->
                        input.copyTo(out)
                        session.fsync(out)
                    }
                }
                // 설치 프로그램이 결과(EXTRA_STATUS 등)를 채워 넣으므로 MUTABLE 이어야 한다. 받는 곳은 이 앱의 리시버로 정해 둔다
                val result = Intent(ctx, UpdateResultReceiver::class.java).putExtra(EXTRA_VERSION, version)
                val pi = PendingIntent.getBroadcast(
                    ctx, id, result, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(pi.intentSender)
            }
        } catch (e: Exception) {
            runCatching { installer.abandonSession(id) }
            throw e
        }
    }
}

/** 업데이트 설치 결과. 안드로이드 설치 프로그램이 이 앱의 PendingIntent 로만 보낸다 (exported=false) */
class UpdateResultReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // 이 폰은 확인을 원한다: 안드로이드의 설치 확인 화면을 띄운다
                val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                if (confirm != null) runCatching { ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // 새 버전으로 바뀐다. StartupReceiver 가 첫 화면을 다시 연다
            else -> {
                // 안 됐으면 이 버전은 다음부터 업데이트 창으로 받는다
                val prefs = Prefs(ctx)
                prefs.reopenAfterUpdate = false
                intent.getStringExtra(UpdateInstaller.EXTRA_VERSION)?.let { prefs.autoUpdateFailed = it }
                val text = if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
                    ctx.getString(R.string.update_cancelled)
                } else {
                    ctx.getString(R.string.update_failed, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty())
                }
                Toast.makeText(ctx, text, Toast.LENGTH_LONG).show()
            }
        }
    }
}
