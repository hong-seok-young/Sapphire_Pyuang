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
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max

/**
 * 다른 앱(게임) 위에 시계를 띄우는 포그라운드 서비스.
 * 초가 바뀌는 순간마다 갱신하며, 드래그로 위치를 옮길 수 있다.
 * '게임 실행 중에만 표시'가 켜져 있으면 고른 게임이 화면 앞에 있을 때만 보인다.
 * 시계를 누르면 타이머 목록이 뜨고, 돌아가는 타이머와 다가오는 시각 알림이 시계 아래에 보인다.
 *
 * 게임 화면을 읽거나, 게임에 입력을 보내거나, 게임 파일/메모리/통신에 손대지 않는다.
 * 타이머는 사용자가 직접 누르고, 현재 시각만 보고 동작한다. (CLAUDE.md 참고)
 */
class FloatingClockService : Service() {

    companion object {
        const val ACTION_START = "com.floatingclock.app.START"
        const val ACTION_STOP = "com.floatingclock.app.STOP"
        const val ACTION_REFRESH = "com.floatingclock.app.REFRESH" // 설정 변경 반영
        private const val CHANNEL_ID = "floating_clock"
        private const val ALERT_CHANNEL_ID = "timer_alert"
        private const val NOTI_ID = 1
        private const val ALERT_NOTI_BASE = 1000

        /** 화면 앞에 떠 있는 앱을 확인하는 간격 */
        private const val WATCH_INTERVAL_MS = 500L

        /** 타이머 목록 창이 저절로 닫히는 시간 */
        private const val PANEL_AUTO_HIDE_MS = 6000L

        /** 끝난 타이머를 '지금!'으로 보여 주는 시간 */
        private const val DONE_SHOW_MS = 3 * 60 * 1000L

        /** 정해진 시각 알림을 '지금!'으로 보여 주는 시간 */
        private const val REMINDER_NOW_MS = 60 * 1000L

        private val WARN_COLOR = Color.parseColor("#FFB300")
        private val DONE_COLOR = Color.parseColor("#FF5252")

        @Volatile
        var isRunning = false
            private set
    }

    /** 시계 아래 한 줄. state: 0 보통, 1 곧 끝남, 2 끝남 */
    private class Chip(val text: String, val state: Int)

    private lateinit var wm: WindowManager
    private lateinit var prefs: Prefs
    private var container: LinearLayout? = null
    private var clockText: TextView? = null
    private var chipsColumn: LinearLayout? = null
    private var params: WindowManager.LayoutParams? = null
    private var panel: LinearLayout? = null
    private var panelClosedAt = 0L
    private val handler = Handler(Looper.getMainLooper())
    private var fmt: SimpleDateFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    private var tracker: GameDetector.ForegroundTracker? = null
    private var shown = true
    private var blinkOn = true
    private var tone: ToneGenerator? = null

    /** 정해진 시각 알림: 이미 울린 날 (알림 id -> yyyyMMdd) */
    private val reminderFired = HashMap<String, Int>()
    private val reminderPreAlerted = HashMap<String, Int>()

    private val tick = object : Runnable {
        override fun run() {
            clockText?.text = fmt.format(Date())
            updateTimers()
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

    private val panelAutoHide = Runnable { closePanel() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        prefs = Prefs(this)
        TimerStore.ensureLoaded(this)
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
                if (container != null) {
                    applyStyle()
                    applyPosition()
                    updateVisibility()
                    updateTimers()
                    refreshNotification()
                    return START_STICKY
                }
            }
        }
        startAsForeground()
        if (container == null) addClockView()
        isRunning = true
        prefs.running = true
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        handler.removeCallbacks(watch)
        closePanel()
        container?.let { runCatching { wm.removeView(it) } }
        container = null
        clockText = null
        chipsColumn = null
        runCatching { tone?.release() }
        tone = null
        isRunning = false
        super.onDestroy()
    }

    // ---------- 오버레이 뷰 ----------

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

    private fun centeredWrap() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { gravity = Gravity.CENTER_HORIZONTAL }

    private fun addClockView() {
        val clock = TextView(this)
        val chips = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            visibility = View.GONE
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(clock, centeredWrap())
            addView(chips, centeredWrap())
        }
        clockText = clock
        chipsColumn = chips
        container = box

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
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
        box.setOnTouchListener(DragListener())
        // 처음부터 보일지 정해 두어야 게임이 아닌 화면에서 잠깐 번쩍이지 않는다
        shown = shouldShow()
        box.visibility = if (shown) View.VISIBLE else View.GONE
        wm.addView(box, lp)
        handler.post(tick)
        handler.postDelayed(watch, WATCH_INTERVAL_MS)
    }

    private fun applyStyle() {
        val tv = clockText ?: return
        fmt = ClockStyle.formatter(prefs)
        ClockStyle.apply(tv, prefs)
        tv.text = fmt.format(Date())
        chipsColumn?.let { col ->
            for (i in 0 until col.childCount) styleChip(col.getChildAt(i) as TextView)
        }
    }

    /** 타이머 줄은 시계와 같은 모양에 글자만 조금 작게 */
    private fun styleChip(tv: TextView) {
        ClockStyle.apply(tv, prefs)
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, prefs.textSizeSp * 0.85f)
    }

    /** 설정 화면에서 바꾼 위치를 떠 있는 시계에 반영 */
    private fun applyPosition() {
        val box = container ?: return
        val lp = params ?: return
        lp.x = prefs.posX
        lp.y = resolvedPosY()
        runCatching { wm.updateViewLayout(box, lp) }
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
        val box = container ?: return
        val show = shouldShow()
        if (show == shown) return
        shown = show
        if (show) clockText?.text = fmt.format(Date())
        box.visibility = if (show) View.VISIBLE else View.GONE
        if (!show) closePanel()
    }

    /** 손가락으로 끌어서 위치 이동, 짧게 누르면 타이머 목록 */
    private inner class DragListener : View.OnTouchListener {
        private var startX = 0
        private var startY = 0
        private var touchX = 0f
        private var touchY = 0f
        private var moved = false

        override fun onTouch(v: View, e: MotionEvent): Boolean {
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
                    if (prefs.lockPosition) return true // 위치 고정: 움직이지 않음
                    lp.x = startX + dx
                    lp.y = (startY + dy).coerceAtLeast(0)
                    runCatching { wm.updateViewLayout(v, lp) }
                    closePanel()
                    return true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) {
                        if (!prefs.lockPosition) {
                            prefs.posX = lp.x
                            prefs.posY = lp.y
                        }
                    } else {
                        v.performClick()
                        onClockTapped()
                    }
                    return true
                }
                MotionEvent.ACTION_CANCEL -> return true
            }
            return false
        }
    }

    // ---------- 타이머 목록 창 ----------

    private fun onClockTapped() {
        if (!prefs.timerTapOpens) return
        // 바깥을 눌러 방금 닫힌 경우, 같은 터치로 다시 열리지 않게
        if (panel == null && SystemClock.uptimeMillis() - panelClosedAt < 400) return
        if (panel != null) closePanel() else openPanel()
    }

    private fun openPanel() {
        val anchor = container ?: return
        val anchorLp = params ?: return
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(4), dp(4), dp(4), dp(4))
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(Color.argb(230, 25, 25, 25))
            }
        }
        if (TimerStore.presets.isEmpty()) {
            box.addView(panelItem(getString(R.string.panel_no_presets), null))
        }
        for (p in TimerStore.presets) {
            box.addView(panelItem(getString(R.string.panel_start_fmt, p.name, TimeFmt.label(this, p.durationSec))) {
                TimerStore.startTimer(this, p)
                closePanel()
                updateTimers()
            })
        }
        for (t in TimerStore.running.toList()) {
            box.addView(panelItem(getString(R.string.panel_cancel_fmt, t.name)) {
                TimerStore.cancelTimer(this, t.id)
                closePanel()
                updateTimers()
            })
        }
        box.addView(panelItem(getString(R.string.panel_close)) { closePanel() })
        // 목록 바깥을 누르면 닫는다 (그 터치는 게임에도 그대로 전달된다)
        box.setOnTouchListener { _, e ->
            if (e.actionMasked == MotionEvent.ACTION_OUTSIDE) {
                closePanel()
                panelClosedAt = SystemClock.uptimeMillis()
                true
            } else {
                false
            }
        }

        val plp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            x = anchorLp.x
            y = anchorLp.y + anchor.height + dp(4)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        if (runCatching { wm.addView(box, plp) }.isFailure) return
        panel = box
        handler.postDelayed(panelAutoHide, PANEL_AUTO_HIDE_MS)
        // 화면 아래로 넘치면 시계 위쪽으로 옮긴다
        box.post {
            if (panel !== box) return@post
            val screenH = resources.displayMetrics.heightPixels
            if (plp.y + box.height > screenH) {
                plp.y = max(0, anchorLp.y - box.height - dp(4))
                runCatching { wm.updateViewLayout(box, plp) }
            }
        }
    }

    private fun panelItem(text: String, onClick: (() -> Unit)?): TextView = TextView(this).apply {
        this.text = text
        setTextColor(if (onClick != null) Color.WHITE else Color.LTGRAY)
        textSize = 15f
        minWidth = dp(160)
        setPadding(dp(14), dp(10), dp(14), dp(10))
        if (onClick != null) {
            isClickable = true
            setOnClickListener { onClick() }
        }
    }

    private fun closePanel() {
        handler.removeCallbacks(panelAutoHide)
        panel?.let { runCatching { wm.removeView(it) } }
        panel = null
    }

    // ---------- 타이머와 시각 알림 ----------

    /** 1초마다: 남은 시간 계산, 미리 알림/알림, 시계 아래 줄 갱신 */
    private fun updateTimers() {
        val col = chipsColumn ?: return
        val now = System.currentTimeMillis()
        val chips = ArrayList<Chip>()

        // 1) 직접 누른 타이머
        val preMs = prefs.timerPreAlertSec * 1000L
        var changed = false
        val it = TimerStore.running.iterator()
        while (it.hasNext()) {
            val t = it.next()
            val remain = t.endAt - now
            if (remain <= -DONE_SHOW_MS) {
                it.remove()
                changed = true
                continue
            }
            if (!t.preAlerted && preMs > 0 && remain in 1..preMs) {
                t.preAlerted = true
                changed = true
                preAlert()
            }
            if (!t.alerted && remain <= 0) {
                t.alerted = true
                t.preAlerted = true
                changed = true
                mainAlert(t.name, t.id)
            }
            chips += chipFor(t.name, remain, preMs)
        }
        if (changed) TimerStore.save(this)

        // 2) 정해진 시각 알림 (매일)
        val leadMs = prefs.reminderLeadMin * 60_000L
        for (r in TimerStore.reminders) {
            if (!r.enabled) continue
            val target = reminderTarget(r, now)
            val key = dayKey(target)
            val diff = target - now
            if (diff in 1..leadMs) {
                if (reminderPreAlerted[r.id] != key) {
                    reminderPreAlerted[r.id] = key
                    preAlert()
                }
                chips += chipFor(r.name, diff, leadMs)
            } else if (diff <= 0) {
                if (reminderFired[r.id] != key) {
                    reminderFired[r.id] = key
                    mainAlert(r.name, r.id)
                }
                chips += chipFor(r.name, diff, leadMs)
            }
        }

        renderChips(col, chips)
        blinkOn = !blinkOn
    }

    /** 오늘 그 시각. 이미 1분 넘게 지났으면 내일 그 시각. */
    private fun reminderTarget(r: Reminder, now: Long): Long {
        val c = Calendar.getInstance().apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, r.hour)
            set(Calendar.MINUTE, r.minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (now - c.timeInMillis >= REMINDER_NOW_MS) c.add(Calendar.DAY_OF_YEAR, 1)
        return c.timeInMillis
    }

    private fun dayKey(millis: Long): Int {
        val c = Calendar.getInstance().apply { timeInMillis = millis }
        return c.get(Calendar.YEAR) * 10000 + (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH)
    }

    private fun chipFor(name: String, remainMs: Long, warnMs: Long): Chip =
        if (remainMs > 0) {
            val sec = (remainMs + 999) / 1000
            Chip("$name ${TimeFmt.remaining(sec)}", if (warnMs > 0 && remainMs <= warnMs) 1 else 0)
        } else {
            Chip(getString(R.string.chip_done_fmt, name, TimeFmt.remaining(-remainMs / 1000)), 2)
        }

    private fun renderChips(col: LinearLayout, chips: List<Chip>) {
        while (col.childCount < chips.size) {
            col.addView(TextView(this).also { styleChip(it) }, centeredWrap())
        }
        while (col.childCount > chips.size) col.removeViewAt(col.childCount - 1)
        for (i in chips.indices) {
            val tv = col.getChildAt(i) as TextView
            val c = chips[i]
            tv.text = c.text
            tv.setTextColor(
                when (c.state) {
                    1 -> WARN_COLOR
                    2 -> DONE_COLOR
                    else -> prefs.textColor
                },
            )
            // 끝난 줄은 깜빡여서 눈에 띄게
            tv.alpha = if (c.state == 2 && !blinkOn) 0.35f else 1f
        }
        col.visibility = if (chips.isEmpty()) View.GONE else View.VISIBLE
    }

    /** 곧 끝남: 게임 중이면 짧게 진동/소리. 게임 밖이면 조용히 넘긴다. */
    private fun preAlert() {
        if (!shown) return
        if (prefs.timerVibrate) vibrate(longArrayOf(0, 150))
        if (prefs.timerSound) beep(150)
    }

    /** 시간 됨: 게임 중이면 진동/소리 (시계 아래에 '지금!'이 깜빡임), 게임 밖이면 폰 알림 */
    private fun mainAlert(name: String, id: String) {
        if (shown) {
            if (prefs.timerVibrate) vibrate(longArrayOf(0, 300, 150, 300))
            if (prefs.timerSound) beep(400)
        } else {
            postAlertNotification(name, id)
        }
    }

    private fun vibrate(pattern: LongArray) {
        runCatching {
            val v: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getSystemService(VibratorManager::class.java).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Vibrator::class.java)
            }
            v.vibrate(VibrationEffect.createWaveform(pattern, -1))
        }
    }

    private fun beep(ms: Int) {
        runCatching {
            val t = tone ?: ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80).also { tone = it }
            t.startTone(ToneGenerator.TONE_PROP_BEEP2, ms)
        }
    }

    private fun postAlertNotification(name: String, id: String) {
        runCatching {
            val nm = getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        ALERT_CHANNEL_ID, getString(R.string.alert_channel), NotificationManager.IMPORTANCE_HIGH,
                    ),
                )
            }
            val open = PendingIntent.getActivity(
                this, 0, Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_clock)
                .setContentTitle(getString(R.string.alert_title_fmt, name))
                .setContentText(getString(R.string.alert_text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            nm.notify(ALERT_NOTI_BASE + (id.hashCode() and 0xFFFF), n)
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
