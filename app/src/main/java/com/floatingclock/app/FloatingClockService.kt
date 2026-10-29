package com.floatingclock.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/**
 * 다른 앱(게임) 위에 시계를 띄우는 포그라운드 서비스.
 * 초가 바뀌는 순간마다 갱신하며, 드래그로 위치를 옮길 수 있다.
 * '게임 실행 중에만 표시'가 켜져 있으면 고른 게임이 화면 앞에 있을 때만 보인다.
 *
 * 게임 화면을 읽거나, 게임에 입력을 보내거나, 게임 파일/메모리/통신에 손대지 않는다. (CLAUDE.md 참고)
 */
class FloatingClockService : Service() {

    companion object {
        const val ACTION_START = "com.floatingclock.app.START"
        const val ACTION_STOP = "com.floatingclock.app.STOP"
        const val ACTION_REFRESH = "com.floatingclock.app.REFRESH" // 설정 변경 반영
        private const val CHANNEL_ID = "floating_clock"
        private const val NOTI_ID = 1

        /** 화면 앞에 떠 있는 앱을 확인하는 간격 */
        private const val WATCH_INTERVAL_MS = 500L

        @Volatile
        var isRunning = false
            private set
    }

    private lateinit var wm: WindowManager
    private lateinit var prefs: Prefs
    private var clockView: TextView? = null
    private var params: WindowManager.LayoutParams? = null
    private val handler = Handler(Looper.getMainLooper())
    private var fmt: SimpleDateFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    private var tracker: GameDetector.ForegroundTracker? = null
    private var shown = true

    private val tick = object : Runnable {
        override fun run() {
            clockView?.text = fmt.format(Date())
            // 다음 초가 시작되는 시점에 맞춰 예약 -> 초가 바뀌는 순간 바로 갱신
            val now = System.currentTimeMillis()
            handler.postAtTime(this, SystemClock.uptimeMillis() + (1000 - now % 1000))
        }
    }

    private val watch = object : Runnable {
        override fun run() {
            updateVisibility()
            handler.postDelayed(this, WATCH_INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        prefs = Prefs(this)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                prefs.running = false
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_REFRESH -> {
                if (clockView != null) {
                    applyStyle()
                    applyPosition()
                    updateVisibility()
                    refreshNotification()
                    return START_STICKY
                }
            }
        }
        startAsForeground()
        if (clockView == null) addClockView()
        isRunning = true
        prefs.running = true
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        handler.removeCallbacks(watch)
        clockView?.let { runCatching { wm.removeView(it) } }
        clockView = null
        isRunning = false
        super.onDestroy()
    }

    // ---------- 오버레이 뷰 ----------

    private fun addClockView() {
        val tv = TextView(this)
        clockView = tv

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            x = prefs.posX
            y = resolvedPosY()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // 노치/컷아웃 영역까지 사용 (상단 끝에 붙일 수 있게)
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        params = lp
        applyStyle()
        tv.setOnTouchListener(DragListener())
        // 처음부터 보일지 정해 두어야 게임이 아닌 화면에서 잠깐 번쩍이지 않는다
        shown = shouldShow()
        tv.visibility = if (shown) View.VISIBLE else View.GONE
        wm.addView(tv, lp)
        handler.post(tick)
        handler.postDelayed(watch, WATCH_INTERVAL_MS)
    }

    private fun applyStyle() {
        val tv = clockView ?: return
        fmt = ClockStyle.formatter(prefs)
        ClockStyle.apply(tv, prefs)
        tv.text = fmt.format(Date())
    }

    /** 설정 화면에서 바꾼 위치를 떠 있는 시계에 반영 */
    private fun applyPosition() {
        val tv = clockView ?: return
        val lp = params ?: return
        lp.x = prefs.posX
        lp.y = resolvedPosY()
        runCatching { wm.updateViewLayout(tv, lp) }
    }

    /** 저장된 y가 없으면(POS_AUTO) 상태바 바로 아래. 상태바와 겹치면 터치가 상태바에 먹혀 드래그가 안 된다. */
    private fun resolvedPosY(): Int =
        if (prefs.posY == Prefs.POS_AUTO) statusBarHeight() else prefs.posY

    private fun statusBarHeight(): Int {
        val id = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else dp(24)
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    // ---------- 게임 실행 중에만 표시 ----------

    /**
     * 지금 시계를 보여야 하는지.
     * 게임을 아직 안 골랐거나 감지 권한이 없으면 감지를 할 수 없으니 항상 보여 준다.
     * 안드로이드에 '지금 맨 앞 앱이 무엇인지'만 묻고, 게임 안은 보지 않는다.
     */
    private fun shouldShow(): Boolean {
        if (!prefs.gameOnly) return true
        val target = prefs.targetPackage ?: return true
        if (!GameDetector.hasUsageAccess(this)) return true
        val t = tracker ?: GameDetector.ForegroundTracker(this).also { tracker = it }
        val front = t.update() ?: return false
        // 이 앱 설정 화면이 앞에 있을 때도 보여야 위치와 모양을 맞출 수 있다
        return front == target || front == packageName
    }

    private fun updateVisibility() {
        val tv = clockView ?: return
        val show = shouldShow()
        if (show == shown) return
        shown = show
        if (show) tv.text = fmt.format(Date())
        tv.visibility = if (show) View.VISIBLE else View.GONE
    }

    /** 손가락으로 끌어서 위치 이동. 짧게 탭하는 건 무시한다. */
    private inner class DragListener : View.OnTouchListener {
        private var startX = 0
        private var startY = 0
        private var touchX = 0f
        private var touchY = 0f
        private var moved = false

        override fun onTouch(v: View, e: MotionEvent): Boolean {
            if (prefs.lockPosition) return false
            val lp = params ?: return false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = lp.x
                    startY = lp.y
                    touchX = e.rawX
                    touchY = e.rawY
                    moved = false
                    return true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - touchX).toInt()
                    val dy = (e.rawY - touchY).toInt()
                    if (!moved && abs(dx) < dp(4) && abs(dy) < dp(4)) return true
                    moved = true
                    lp.x = startX + dx
                    lp.y = (startY + dy).coerceAtLeast(0)
                    runCatching { wm.updateViewLayout(v, lp) }
                    return true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (moved) {
                        prefs.posX = lp.x
                        prefs.posY = lp.y
                    } else {
                        v.performClick()
                    }
                    return true
                }
            }
            return false
        }
    }

    // ---------- 포그라운드 알림 ----------

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID, getString(R.string.noti_channel), NotificationManager.IMPORTANCE_LOW
            ).apply { setShowBadge(false) }
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun notificationText(): String {
        if (!prefs.gameOnly) return getString(R.string.noti_text)
        val label = prefs.targetLabel
        return if (prefs.targetPackage != null && label != null && GameDetector.hasUsageAccess(this))
            getString(R.string.noti_text_game, label)
        else
            getString(R.string.noti_text_need_setup)
    }

    private fun buildNotification(): Notification {
        val openIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopIntent = PendingIntent.getService(
            this, 1, Intent(this, FloatingClockService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_clock)
            .setContentTitle(getString(R.string.noti_title))
            .setContentText(notificationText())
            .setContentIntent(openIntent)
            .addAction(0, getString(R.string.stop), stopIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun refreshNotification() {
        runCatching {
            getSystemService(NotificationManager::class.java).notify(NOTI_ID, buildNotification())
        }
    }

    private fun startAsForeground() {
        val noti = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTI_ID, noti, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTI_ID, noti)
        }
    }
}
