package com.floatingclock.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
 */
class FloatingClockService : Service() {

    companion object {
        const val ACTION_START = "com.floatingclock.app.START"
        const val ACTION_STOP = "com.floatingclock.app.STOP"
        const val ACTION_REFRESH = "com.floatingclock.app.REFRESH" // 설정 변경 반영
        private const val CHANNEL_ID = "floating_clock"
        private const val NOTI_ID = 1

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

    private val tick = object : Runnable {
        override fun run() {
            clockView?.text = fmt.format(Date())
            // 다음 초가 시작되는 시점에 맞춰 예약 -> 초가 바뀌는 순간 바로 갱신
            val now = System.currentTimeMillis()
            handler.postAtTime(this, SystemClock.uptimeMillis() + (1000 - now % 1000))
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
        clockView?.let { runCatching { wm.removeView(it) } }
        clockView = null
        isRunning = false
        super.onDestroy()
    }

    // ---------- 오버레이 뷰 ----------

    private fun addClockView() {
        val tv = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            includeFontPadding = false
            setShadowLayer(4f, 0f, 1f, Color.BLACK)
        }
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
        wm.addView(tv, lp)
        handler.post(tick)
    }

    private fun applyStyle() {
        val tv = clockView ?: return
        val pattern = buildString {
            if (prefs.showDate) append("MM/dd(E) ")
            append(if (prefs.use24h) "HH:mm:ss" else "a hh:mm:ss")
        }
        fmt = SimpleDateFormat(pattern, Locale.getDefault())

        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, prefs.textSizeSp.toFloat())
        tv.setTextColor(prefs.textColor)
        if (prefs.bgAlpha <= 0) {
            // 배경 없이 글자만: 공간을 최소로 차지. 그림자로 밝은 배경에서도 읽히게 함.
            tv.setPadding(dp(2), 0, dp(2), 0)
            tv.background = null
        } else {
            val padH = dp(6)
            val padV = dp(2)
            tv.setPadding(padH, padV, padH, padV)
            tv.background = GradientDrawable().apply {
                cornerRadius = dp(6).toFloat()
                setColor(Color.argb(prefs.bgAlpha, 0, 0, 0))
            }
        }
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

    private fun startAsForeground() {
        val openIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopIntent = PendingIntent.getService(
            this, 1, Intent(this, FloatingClockService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val noti: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_clock)
            .setContentTitle(getString(R.string.noti_title))
            .setContentText(getString(R.string.noti_text))
            .setContentIntent(openIntent)
            .addAction(0, getString(R.string.stop), stopIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTI_ID, noti, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTI_ID, noti)
        }
    }
}
