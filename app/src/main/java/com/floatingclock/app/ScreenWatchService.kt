package com.floatingclock.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioManager
import android.media.Image
import android.media.ImageReader
import android.media.ToneGenerator
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
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
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 화면 인식 서비스.
 * 화면 녹화(MediaProjection)로 게임 화면을 작게 받아 1초에 4번 정도 보고,
 * 규칙으로 정한 영역이 기준 모습과 같아지거나(보이면) 달라지면(바뀌면) 그 옆에 화살표와 알림을 띄운다.
 * 받은 화면은 폰 안에서 비교만 하고 저장하거나 보내지 않는다. (📷 버튼으로 찍은 1장만 폰 안에 저장)
 */
class ScreenWatchService : Service() {

    companion object {
        const val ACTION_START = "com.floatingclock.app.WATCH_START"
        const val ACTION_STOP = "com.floatingclock.app.WATCH_STOP"
        const val ACTION_RELOAD = "com.floatingclock.app.WATCH_RELOAD"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"

        private const val CHANNEL_ID = "floating_clock"
        private const val NOTI_ID = 2
        private const val KEY_CALLOUTS = "callouts"
        private const val KEY_BUTTON = "button"

        /** 화면 비교 간격 (1초에 4번) */
        private const val ANALYZE_INTERVAL_MS = 250L

        /** 앞에 떠 있는 앱, 화면 회전 확인 간격 */
        private const val WATCH_INTERVAL_MS = 400L

        /** 녹화 해상도: 긴 쪽 최대 픽셀 (작을수록 배터리 절약) */
        private const val MAX_CAPTURE_SIDE = 960

        /** 몇 번 연속으로 맞아야 알림을 켜고 끄는지 (깜빡임 방지) */
        private const val ON_FRAMES = 2
        private const val OFF_FRAMES = 2

        /** 같은 규칙의 진동/소리 최소 간격 */
        private const val ALERT_COOLDOWN_MS = 3000L

        /** 📷 버튼을 숨긴 뒤 화면에 반영될 때까지 기다리는 시간 */
        private const val SNAPSHOT_DELAY_MS = 300L

        @Volatile
        var isRunning = false
            private set
    }

    private class RuleState {
        var hits = 0
        var misses = 0
        var active = false
        var lastAlert = 0L
    }

    private lateinit var wm: WindowManager
    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())
    private lateinit var bgThread: HandlerThread
    private lateinit var bg: Handler

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var capW = 0
    private var capH = 0
    private var capDpi = 0
    private var paused = false

    // 아래는 bg 스레드에서만 쓴다
    private var tracker: GameDetector.ForegroundTracker? = null
    private var lastAnalyze = 0L
    private var rules: List<Rule> = emptyList()
    private val states = HashMap<String, RuleState>()
    private var tone: ToneGenerator? = null

    @Volatile
    private var allowed = false

    /** 📷 요청 시각 (uptime ms). 0 = 요청 없음 */
    @Volatile
    private var snapshotAt = 0L

    // 화면 위 그림 (메인 스레드)
    private var calloutView: CalloutView? = null
    private var captureButton: TextView? = null
    private var buttonParams: WindowManager.LayoutParams? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        prefs = Prefs(this)
        bgThread = HandlerThread("screen-watch").also { it.start() }
        bg = Handler(bgThread.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_RELOAD -> {
                if (projection != null) {
                    bg.post { reloadRules() }
                    refreshButtonVisibility()
                } else {
                    // 이미 꺼진 뒤에 도착한 요청이면 빈 서비스로 남지 않게 바로 끝낸다
                    stopSelf()
                }
                return START_NOT_STICKY
            }
            ACTION_START -> {
                if (projection != null) return START_NOT_STICKY
                if (runCatching { startAsForeground() }.isFailure) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                val data = resultData(intent)
                val mp = data?.let {
                    runCatching {
                        getSystemService(MediaProjectionManager::class.java).getMediaProjection(code, it)
                    }.getOrNull()
                }
                if (mp == null) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                projection = mp
                // 안드로이드 14부터는 녹화 화면을 만들기 전에 콜백을 먼저 등록해야 한다
                mp.registerCallback(projectionCallback, main)
                if (!startCapture()) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                addOverlays()
                isRunning = true
                bg.post { reloadRules() }
                bg.post(watchTick)
                return START_NOT_STICKY
            }
        }
        // 시스템이 다시 띄운 경우 등: 녹화 허용이 없으니 끝낸다
        if (projection == null) stopSelf()
        return START_NOT_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (projection == null) return
        bg.post { ensureCaptureSize() }
        clampButton()
    }

    override fun onDestroy() {
        isRunning = false
        main.removeCallbacksAndMessages(null)
        bg.removeCallbacksAndMessages(null)
        val vd = virtualDisplay
        val rd = reader
        virtualDisplay = null
        reader = null
        // 녹화 화면 정리는 장면을 처리하는 bg 스레드에서 (처리 중인 장면과 겹치지 않게)
        bg.post {
            runCatching { vd?.release() }
            runCatching { rd?.close() }
            runCatching { tone?.release() }
        }
        bgThread.quitSafely()
        runCatching { projection?.unregisterCallback(projectionCallback) }
        runCatching { projection?.stop() }
        projection = null
        calloutView?.let { runCatching { wm.removeView(it) } }
        captureButton?.let { runCatching { wm.removeView(it) } }
        calloutView = null
        captureButton = null
        OverlayRegistry.clear(KEY_CALLOUTS)
        OverlayRegistry.clear(KEY_BUTTON)
        super.onDestroy()
    }

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            // 상단의 '공유 중지'를 눌렀거나 시스템이 녹화를 끝냈을 때
            main.post {
                if (isRunning) {
                    Toast.makeText(applicationContext, R.string.toast_watch_stopped, Toast.LENGTH_SHORT).show()
                }
                stopSelf()
            }
        }
    }

    private fun resultData(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
        }

    // ---------- 화면 녹화 ----------

    private fun startCapture(): Boolean {
        val mp = projection ?: return false
        computeCaptureSize()
        val r = newReader()
        reader = r
        val vd = runCatching {
            mp.createVirtualDisplay(
                "floating-clock-watch", capW, capH, capDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, bg,
            )
        }.getOrNull()
        virtualDisplay = vd
        return vd != null
    }

    /** 지금 화면 방향에 맞는 녹화 크기 계산. 바뀌었으면 true */
    private fun computeCaptureSize(): Boolean {
        val real = ScreenUtil.realSize(this)
        val scale = min(1f, MAX_CAPTURE_SIDE.toFloat() / max(real.x, real.y))
        val w = max(2, (real.x * scale).toInt() / 2 * 2)
        val h = max(2, (real.y * scale).toInt() / 2 * 2)
        val dpi = max(1, (resources.displayMetrics.densityDpi * scale).toInt())
        if (w == capW && h == capH) return false
        capW = w
        capH = h
        capDpi = dpi
        return true
    }

    private fun newReader(): ImageReader =
        ImageReader.newInstance(capW, capH, PixelFormat.RGBA_8888, 2).also {
            it.setOnImageAvailableListener(imageListener, bg)
        }

    /** 화면이 세로/가로로 돌아가면 녹화 크기도 맞춘다. 안 맞추면 화면이 줄어든 채로 찍혀 위치가 어긋난다. (bg) */
    private fun ensureCaptureSize() {
        val vd = virtualDisplay ?: return
        if (!computeCaptureSize()) return
        val old = reader
        val r = newReader()
        reader = r
        runCatching {
            vd.resize(capW, capH, capDpi)
            vd.surface = if (paused) null else r.surface
        }
        runCatching { old?.close() }
    }

    /** 게임이 아닐 때는 녹화를 멈춰서 배터리를 아낀다 (bg) */
    private fun setPaused(p: Boolean) {
        if (paused == p) return
        paused = p
        runCatching { virtualDisplay?.surface = if (p) null else reader?.surface }
    }

    private val imageListener = ImageReader.OnImageAvailableListener { r ->
        val img = try {
            r.acquireLatestImage()
        } catch (e: Exception) {
            null
        } ?: return@OnImageAvailableListener
        try {
            val now = SystemClock.uptimeMillis()
            val snapAt = snapshotAt
            if (snapAt != 0L && now >= snapAt) {
                snapshotAt = 0L
                val ok = saveSnapshot(img)
                main.post { finishSnapshot(ok) }
            }
            if (allowed && now - lastAnalyze >= ANALYZE_INTERVAL_MS) {
                lastAnalyze = now
                analyze(img)
            }
        } catch (t: Throwable) {
            // 한 장면 처리 실패는 무시하고 다음 장면으로
        } finally {
            img.close()
        }
    }

    /** 앞에 떠 있는 앱 확인 + 회전 확인 (bg) */
    private val watchTick = object : Runnable {
        override fun run() {
            ensureCaptureSize()
            val now = computeAllowed()
            if (now != allowed) {
                allowed = now
                setPaused(!now)
                if (!now) clearAllActive()
                main.post { refreshButtonVisibility() }
            }
            bg.postDelayed(this, WATCH_INTERVAL_MS)
        }
    }

    private fun computeAllowed(): Boolean {
        // 이 앱 설정 화면을 보고 있을 때는 쉰다 (설정 화면을 게임으로 착각하지 않게)
        if (UiState.resumed > 0) return false
        if (!GameDetector.hasUsageAccess(this)) return true
        val t = tracker ?: GameDetector.ForegroundTracker(this).also { tracker = it }
        val front = t.update()
        if (front == packageName) return false
        val target = prefs.targetPackage
        return if (prefs.gameOnly && target != null) front == target else true
    }

    // ---------- 비교 ----------

    private fun reloadRules() {
        rules = RuleStore.load(this)
        states.clear()
        main.post { calloutView?.setCallouts(emptyList()) }
    }

    private fun analyze(img: Image) {
        val list = rules
        if (list.isEmpty()) return
        // 화면이 막 돌아가서 녹화 크기가 아직 안 맞으면 이 장면은 건너뛴다
        val real = ScreenUtil.realSize(this)
        if ((img.width > img.height) != (real.x > real.y)) return
        val src = RegionSampler.ImageSource(img)
        val occluders = OverlayRegistry.all()
        val now = SystemClock.uptimeMillis()
        var changed = false
        for (rule in list) {
            if (!rule.enabled || rule.ref.isEmpty()) continue
            val st = states.getOrPut(rule.id) { RuleState() }
            val cur = RegionSampler.sample(src, rule.x, rule.y, rule.w, rule.h)
            val skip = RegionSampler.occludedCells(rule.x, rule.y, rule.w, rule.h, occluders)
            val score = RegionSampler.similarity(cur, rule.ref, skip) ?: continue
            val pct = score * 100f
            RuleStore.lastScores[rule.id] = pct.roundToInt()
            val match = if (rule.mode == Rule.MODE_APPEAR) pct >= rule.threshold else pct < rule.threshold
            if (match) {
                st.hits++
                st.misses = 0
            } else {
                st.misses++
                st.hits = 0
            }
            if (!st.active && st.hits >= ON_FRAMES) {
                st.active = true
                changed = true
                if (now - st.lastAlert >= ALERT_COOLDOWN_MS) {
                    st.lastAlert = now
                    fireAlert(rule)
                }
            } else if (st.active && st.misses >= OFF_FRAMES) {
                st.active = false
                changed = true
            }
        }
        if (changed) publishCallouts()
    }

    private fun publishCallouts() {
        val active = rules
            .filter { it.enabled && states[it.id]?.active == true }
            .map {
                CalloutView.Callout(it.id, it.message, RectF(it.x, it.y, it.x + it.w, it.y + it.h), it.arrow)
            }
        main.post { calloutView?.setCallouts(active) }
    }

    private fun clearAllActive() {
        var any = false
        for (st in states.values) {
            if (st.active) any = true
            st.active = false
            st.hits = 0
            st.misses = 0
        }
        if (any) main.post { calloutView?.setCallouts(emptyList()) }
    }

    private fun fireAlert(rule: Rule) {
        if (rule.vibrate) vibrate()
        if (rule.sound) beep()
    }

    private fun vibrate() {
        runCatching {
            val v: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getSystemService(VibratorManager::class.java).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Vibrator::class.java)
            }
            v.vibrate(VibrationEffect.createOneShot(250, VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    private fun beep() {
        runCatching {
            val t = tone ?: ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80).also { tone = it }
            t.startTone(ToneGenerator.TONE_PROP_BEEP2, 200)
        }
    }

    // ---------- 📷 캡처 ----------

    private fun requestSnapshot() {
        if (snapshotAt != 0L) return
        // 버튼과 알림이 사진에 찍히지 않게 잠깐 숨긴다
        captureButton?.visibility = View.GONE
        OverlayRegistry.clear(KEY_BUTTON)
        calloutView?.suppressed = true
        snapshotAt = SystemClock.uptimeMillis() + SNAPSHOT_DELAY_MS
        main.postDelayed(snapshotTimeout, 3000)
    }

    private val snapshotTimeout = Runnable {
        if (snapshotAt != 0L) {
            snapshotAt = 0L
            finishSnapshot(false)
        }
    }

    private fun finishSnapshot(ok: Boolean) {
        main.removeCallbacks(snapshotTimeout)
        calloutView?.suppressed = false
        refreshButtonVisibility()
        val msg = if (ok) R.string.toast_snapshot_saved else R.string.toast_snapshot_failed
        Toast.makeText(applicationContext, msg, Toast.LENGTH_LONG).show()
    }

    /** 지금 장면을 그림 파일로 저장 (bg) */
    private fun saveSnapshot(img: Image): Boolean = runCatching {
        val plane = img.planes[0]
        val buf = plane.buffer
        val rs = plane.rowStride
        val ps = plane.pixelStride
        val w = img.width
        val h = img.height
        val pixels = IntArray(w * h)
        for (y in 0 until h) {
            var i = y * rs
            val row = y * w
            for (x in 0 until w) {
                val r = buf.get(i).toInt() and 0xFF
                val g = buf.get(i + 1).toInt() and 0xFF
                val b = buf.get(i + 2).toInt() and 0xFF
                pixels[row + x] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                i += ps
            }
        }
        val bmp = Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
        RuleStore.snapshotFile(this).outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bmp.recycle()
    }.isSuccess

    // ---------- 화면 위 그림 ----------

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

    private fun addOverlays() {
        // 1) 화살표와 알림을 그리는 전체 화면 창. 터치는 아래 게임으로 그대로 통과한다.
        val cv = CalloutView(this) { rects -> OverlayRegistry.set(KEY_CALLOUTS, rects) }
        cv.visibility = View.GONE
        val clp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            // 안드로이드 12부터는 불투명도 0.8 이하인 창이어야 터치가 아래 게임으로 전달된다
            alpha = 0.8f
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                fitInsetsTypes = 0
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        if (runCatching { wm.addView(cv, clp) }.isSuccess) calloutView = cv

        // 2) 📷 캡처 버튼 (끌어서 옮길 수 있음)
        val size = dp(44)
        val btn = TextView(this).apply {
            text = "📷"
            textSize = 20f
            gravity = Gravity.CENTER
            includeFontPadding = false
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.argb(150, 0, 0, 0))
                setStroke(dp(1), Color.argb(180, 255, 255, 255))
            }
            contentDescription = getString(R.string.capture_button_desc)
            visibility = View.GONE
        }
        val real = ScreenUtil.realSize(this)
        val blp = WindowManager.LayoutParams(
            size, size, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (if (prefs.capBtnX >= 0) prefs.capBtnX else dp(8)).coerceIn(0, max(0, real.x - size))
            y = (if (prefs.capBtnY >= 0) prefs.capBtnY else real.y / 2 - size / 2).coerceIn(0, max(0, real.y - size))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        btn.setOnTouchListener(ButtonTouch())
        if (runCatching { wm.addView(btn, blp) }.isSuccess) {
            captureButton = btn
            buttonParams = blp
        }
    }

    private fun refreshButtonVisibility() {
        val b = captureButton ?: return
        val show = allowed && prefs.showCaptureButton && snapshotAt == 0L
        b.visibility = if (show) View.VISIBLE else View.GONE
        publishButtonRect()
    }

    /** 화면이 돌아가서 버튼이 화면 밖으로 나가면 안쪽으로 당긴다 */
    private fun clampButton() {
        val b = captureButton ?: return
        val lp = buttonParams ?: return
        val real = ScreenUtil.realSize(this)
        val nx = lp.x.coerceIn(0, max(0, real.x - lp.width))
        val ny = lp.y.coerceIn(0, max(0, real.y - lp.height))
        if (nx != lp.x || ny != lp.y) {
            lp.x = nx
            lp.y = ny
            runCatching { wm.updateViewLayout(b, lp) }
        }
        publishButtonRect()
    }

    private fun publishButtonRect() {
        val b = captureButton
        val lp = buttonParams
        if (b == null || lp == null || b.visibility != View.VISIBLE) {
            OverlayRegistry.clear(KEY_BUTTON)
            return
        }
        val size = ScreenUtil.realSize(this)
        OverlayRegistry.set(
            KEY_BUTTON,
            listOf(
                ScreenUtil.fraction(
                    size, lp.x.toFloat(), lp.y.toFloat(),
                    (lp.x + lp.width).toFloat(), (lp.y + lp.height).toFloat(), dp(4).toFloat(),
                ),
            ),
        )
    }

    /** 📷 버튼: 짧게 누르면 캡처, 끌면 이동 */
    private inner class ButtonTouch : View.OnTouchListener {
        private var startX = 0
        private var startY = 0
        private var touchX = 0f
        private var touchY = 0f
        private var moved = false

        override fun onTouch(v: View, e: MotionEvent): Boolean {
            val lp = buttonParams ?: return false
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
                    if (!moved && abs(dx) < dp(6) && abs(dy) < dp(6)) return true
                    moved = true
                    lp.x = startX + dx
                    lp.y = startY + dy
                    runCatching { wm.updateViewLayout(v, lp) }
                    publishButtonRect()
                    return true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) {
                        prefs.capBtnX = lp.x
                        prefs.capBtnY = lp.y
                    } else {
                        v.performClick()
                        requestSnapshot()
                    }
                    return true
                }
                MotionEvent.ACTION_CANCEL -> return true
            }
            return false
        }
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    // ---------- 알림 ----------

    private fun startAsForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID, getString(R.string.noti_channel), NotificationManager.IMPORTANCE_LOW,
            ).apply { setShowBadge(false) }
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
        val open = PendingIntent.getActivity(
            this, 3, Intent(this, ScreenWatchActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 2, Intent(this, ScreenWatchService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val noti: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_clock)
            .setContentTitle(getString(R.string.watch_noti_title))
            .setContentText(getString(R.string.watch_noti_text))
            .setContentIntent(open)
            .addAction(0, getString(R.string.stop), stop)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTI_ID, noti, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTI_ID, noti)
        }
    }
}
