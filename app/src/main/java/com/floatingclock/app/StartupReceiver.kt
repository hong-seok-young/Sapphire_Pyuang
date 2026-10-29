package com.floatingclock.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * 폰을 다시 켰을 때와 앱이 업데이트됐을 때, 켜 두었던 시계를 다시 시작한다.
 * (업데이트나 재부팅으로 시계가 꺼지면 게임을 켜도 시계가 안 나오기 때문)
 */
class StartupReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                if (!Prefs(ctx).running) return
                if (!Settings.canDrawOverlays(ctx)) return
                val start = Intent(ctx, FloatingClockService::class.java)
                    .setAction(FloatingClockService.ACTION_START)
                runCatching { ContextCompat.startForegroundService(ctx, start) }
            }
        }
    }
}
