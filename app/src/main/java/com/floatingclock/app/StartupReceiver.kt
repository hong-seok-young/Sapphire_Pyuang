package com.floatingclock.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * 폰을 다시 켰을 때와 앱이 업데이트됐을 때, 켜 두었던 시계를 다시 시작한다.
 * (업데이트나 재부팅으로 시계가 꺼지면 게임을 켜도 시계가 안 나오기 때문)
 * 앱이 스스로 업데이트하느라 닫혔으면(UpdateUi) 새 버전의 첫 화면도 다시 연다.
 */
class StartupReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                val prefs = Prefs(ctx)
                if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED && prefs.reopenAfterUpdate) {
                    prefs.reopenAfterUpdate = false
                    // 뒤에서 화면을 여는 것은 '다른 앱 위에 표시' 권한이 있을 때만 된다. 안 되면 사용자가 다시 열면 된다
                    val open = Intent(ctx, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        .putExtra(MainActivity.EXTRA_UPDATED, true)
                    runCatching { ctx.startActivity(open) }
                }
                if (!prefs.running) return
                if (!Settings.canDrawOverlays(ctx)) return
                val start = Intent(ctx, FloatingClockService::class.java)
                    .setAction(FloatingClockService.ACTION_START)
                runCatching { ContextCompat.startForegroundService(ctx, start) }
            }
        }
    }
}
