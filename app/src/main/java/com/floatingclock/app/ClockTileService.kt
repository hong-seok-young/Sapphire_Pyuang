package com.floatingclock.app

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.provider.Settings
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.content.ContextCompat

/**
 * 알림창 빠른 설정의 '시계' 버튼. 꺼져 있을 때 누르면 시계를 켜고, 켜져 있을 때 누르면 끈다.
 * 게임 감지를 뺀 뒤(v1.12) 게임을 시작하고 마칠 때 앱을 열지 않고 바로 켜고 끄려고 만들었다.
 */
class ClockTileService : TileService() {

    companion object {
        /** 시계가 켜지거나 꺼졌을 때 빠른 설정 버튼 모양을 다시 맞추게 한다 */
        fun refresh(ctx: Context) {
            runCatching { requestListeningState(ctx, ComponentName(ctx, ClockTileService::class.java)) }
        }
    }

    override fun onStartListening() {
        super.onStartListening()
        show(FloatingClockService.isRunning)
    }

    override fun onClick() {
        super.onClick()
        if (FloatingClockService.isRunning) {
            stopClock()
        } else if (isLocked) {
            unlockAndRun { startClock() } // 잠금 화면에서는 풀고 나서 켠다
        } else {
            startClock()
        }
    }

    private fun stopClock() {
        Prefs(this).running = false // 재부팅 뒤에 다시 켜지지 않게
        stopService(Intent(this, FloatingClockService::class.java))
        show(false)
    }

    private fun startClock() {
        // '다른 앱 위에 표시' 권한이 없으면 시계를 띄울 수 없으니 시계 설정 화면을 연다
        if (!Settings.canDrawOverlays(this)) {
            openClockSettings()
            return
        }
        val start = Intent(this, FloatingClockService::class.java).setAction(FloatingClockService.ACTION_START)
        if (runCatching { ContextCompat.startForegroundService(this, start) }.isSuccess) {
            show(true)
        } else {
            openClockSettings()
        }
    }

    private fun show(on: Boolean) {
        val tile = qsTile ?: return
        tile.state = if (on) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = getString(R.string.tile_label_short)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = getString(if (on) R.string.tile_on else R.string.tile_off)
        }
        tile.icon = Icon.createWithResource(this, R.drawable.ic_clock)
        tile.updateTile()
    }

    private fun openClockSettings() {
        val intent = Intent(this, ClockActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val pi = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            startActivityAndCollapse(pi)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
