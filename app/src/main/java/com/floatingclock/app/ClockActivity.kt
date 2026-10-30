package com.floatingclock.app

import android.Manifest
import android.app.AlertDialog
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.materialswitch.MaterialSwitch
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date

/**
 * 시계 설정 화면: 권한, 시계 켜기/끄기, 타이머, 알림 숨기기, 모양, 위치, 업데이트.
 * 앱 첫 화면은 길드 위키(MainActivity)이고, 이 화면은 위키 위쪽 메뉴의 '⏰ 시계'로 연다.
 * 게임 감지(맨 앞 앱 확인)는 제작자 요청으로 v1.12 에서 뺐다. 시계는 켜 두는 동안 어디서나 보인다.
 */
class ClockActivity : AppCompatActivity() {

    companion object {
        /** 안드로이드가 '다른 앱 위에 표시 중' 알림에 앱마다 따로 만드는 채널 (이름 뒤에 패키지 이름이 붙는다) */
        private const val OVERLAY_NOTI_CHANNEL_PREFIX = "com.android.server.wm.AlertWindowNotification - "
    }

    private lateinit var prefs: Prefs

    private lateinit var permState: TextView
    private lateinit var btnPerm: Button
    private lateinit var btnToggle: Button
    private lateinit var preview: TextView
    private lateinit var seekSize: SeekBar
    private lateinit var btnSizeMinus: Button
    private lateinit var btnSizePlus: Button
    private lateinit var seekAlpha: SeekBar
    private lateinit var sizeLabel: TextView
    private lateinit var alphaLabel: TextView
    private lateinit var swatchContainer: LinearLayout
    private lateinit var sw24h: MaterialSwitch
    private lateinit var swDate: MaterialSwitch
    private lateinit var swLock: MaterialSwitch
    private lateinit var seekPosX: SeekBar
    private lateinit var seekPosY: SeekBar
    private lateinit var posXLabel: TextView
    private lateinit var posYLabel: TextView
    private lateinit var btnResetPos: Button
    private lateinit var versionLabel: TextView
    private lateinit var updateState: TextView
    private lateinit var btnUpdate: Button

    private val swatchViews = mutableListOf<View>()

    /** 위치 슬라이더를 코드로 맞추는 동안 리스너가 설정을 덮어쓰지 않게 */
    private var syncingSliders = false

    private val handler = Handler(Looper.getMainLooper())
    private var previewFmt: SimpleDateFormat? = null
    private val previewTick = object : Runnable {
        override fun run() {
            previewFmt?.let { preview.text = it.format(Date()) }
            handler.postDelayed(this, 1000 - System.currentTimeMillis() % 1000)
        }
    }

    private val screenW get() = resources.displayMetrics.widthPixels
    private val screenH get() = resources.displayMetrics.heightPixels

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_clock)
        prefs = Prefs(this)

        permState = findViewById(R.id.perm_state)
        btnPerm = findViewById(R.id.btn_perm)
        btnToggle = findViewById(R.id.btn_toggle)
        preview = findViewById(R.id.clock_preview)
        seekSize = findViewById(R.id.seek_size)
        btnSizeMinus = findViewById(R.id.btn_size_minus)
        btnSizePlus = findViewById(R.id.btn_size_plus)
        seekAlpha = findViewById(R.id.seek_alpha)
        sizeLabel = findViewById(R.id.size_label)
        alphaLabel = findViewById(R.id.alpha_label)
        swatchContainer = findViewById(R.id.color_swatches)
        sw24h = findViewById(R.id.sw_24h)
        swDate = findViewById(R.id.sw_date)
        swLock = findViewById(R.id.sw_lock)
        seekPosX = findViewById(R.id.seek_pos_x)
        seekPosY = findViewById(R.id.seek_pos_y)
        posXLabel = findViewById(R.id.pos_x_label)
        posYLabel = findViewById(R.id.pos_y_label)
        btnResetPos = findViewById(R.id.btn_reset_pos)
        versionLabel = findViewById(R.id.version_label)
        updateState = findViewById(R.id.update_state)
        btnUpdate = findViewById(R.id.btn_update)

        setupControls()
        findViewById<Button>(R.id.btn_open_timer).setOnClickListener {
            startActivity(Intent(this, TimerActivity::class.java))
        }
        findViewById<Button>(R.id.btn_add_tile).setOnClickListener { addQuickSettingsTile() }
        findViewById<Button>(R.id.btn_hide_running).setOnClickListener { openRunningNotificationSettings() }
        findViewById<Button>(R.id.btn_hide_overlay).setOnClickListener { showOverlayNotificationGuide() }
        setupUpdate()
        removeOldScreenWatchData()
        updatePreview()
        askNotificationPermissionIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        refreshState()
        syncPositionSliders()
        handler.post(previewTick)
        // 첫 화면에서 이미 확인했으면 그 결과만 보여 준다 (알림에서 바로 이 화면을 연 경우에는 여기서 확인)
        UpdateUi.checkOnce(this) { updateState.text = it }
    }

    override fun onPause() {
        handler.removeCallbacks(previewTick)
        super.onPause()
    }

    // ---------- 권한 ----------

    private fun hasOverlayPermission(): Boolean = Settings.canDrawOverlays(this)

    private fun openOverlaySettings() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
        )
        startActivity(intent)
        Toast.makeText(this, R.string.toast_allow_overlay, Toast.LENGTH_LONG).show()
    }

    private fun askNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 100)
            }
        }
    }

    // ---------- 빠른 설정 버튼 ----------

    /**
     * 알림창 빠른 설정에 '시계' 켜기/끄기 버튼 넣기.
     * 안드로이드 13 부터는 시스템이 '추가할까요?' 창을 띄워 주고, 그 전이나 안 되는 폰은 직접 넣는 방법을 알려 준다.
     */
    private fun addQuickSettingsTile() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            showTileGuide()
            return
        }
        val sbm = getSystemService(StatusBarManager::class.java)
        if (sbm == null) {
            showTileGuide()
            return
        }
        sbm.requestAddTileService(
            ComponentName(this, ClockTileService::class.java),
            getString(R.string.tile_label),
            Icon.createWithResource(this, R.drawable.ic_clock),
            mainExecutor,
        ) { result ->
            if (isFinishing || isDestroyed) return@requestAddTileService
            when (result) {
                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ->
                    Toast.makeText(this, R.string.tile_added, Toast.LENGTH_SHORT).show()
                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED ->
                    Toast.makeText(this, R.string.tile_already, Toast.LENGTH_SHORT).show()
                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> Unit // 사용자가 '추가 안 함'을 눌렀다
                else -> showTileGuide() // 이 폰에서는 추가 창을 못 띄움
            }
        }
    }

    private fun showTileGuide() {
        AlertDialog.Builder(this)
            .setTitle(R.string.add_tile)
            .setMessage(R.string.tile_guide_msg)
            .setPositiveButton(R.string.ok, null)
            .show()
    }

    // ---------- 알림 숨기기 ----------
    // 두 알림 모두 안드로이드 규칙이라 앱이 직접 없앨 수는 없고, 사용자가 끌 수 있는 설정 화면으로 보내 준다.
    // 꺼도 시계는 계속 돈다.

    /** '시계 실행 중' 알림 채널 설정을 연다. '타이머 알림' 채널은 그대로 둔다. */
    private fun openRunningNotificationSettings() {
        FloatingClockService.createChannel(this) // 시계를 한 번도 안 켰으면 채널이 아직 없다
        val channel = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, FloatingClockService.CHANNEL_ID)
        if (runCatching { startActivity(channel) }.isFailure) {
            val app = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            runCatching { startActivity(app) }
        }
        Toast.makeText(this, R.string.toast_hide_running, Toast.LENGTH_LONG).show()
    }

    /**
     * '다른 앱 위에 표시 중' 알림은 안드로이드 시스템이 띄운다.
     * 그 채널 설정으로 바로 가는 게 안 되는 폰도 있어서, 알림을 길게 눌러 끄는 방법을 먼저 알려 준다.
     */
    private fun showOverlayNotificationGuide() {
        AlertDialog.Builder(this)
            .setTitle(R.string.overlay_noti_title)
            .setMessage(R.string.overlay_noti_msg)
            .setPositiveButton(R.string.open_settings) { _, _ ->
                val intent = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, "android")
                    .putExtra(Settings.EXTRA_CHANNEL_ID, OVERLAY_NOTI_CHANNEL_PREFIX + packageName)
                if (runCatching { startActivity(intent) }.isFailure) {
                    Toast.makeText(this, R.string.toast_overlay_long_press, Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton(R.string.ok, null)
            .show()
    }

    // ---------- 서비스 시작/정지 ----------

    private fun startClock() {
        if (!hasOverlayPermission()) {
            openOverlaySettings()
            return
        }
        val i = Intent(this, FloatingClockService::class.java).setAction(FloatingClockService.ACTION_START)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i) else startService(i)
        showToggleAs(running = true)
    }

    private fun stopClock() {
        startService(Intent(this, FloatingClockService::class.java).setAction(FloatingClockService.ACTION_STOP))
        prefs.running = false
        showToggleAs(running = false)
    }

    /** 서비스는 조금 뒤에 실제로 켜지고 꺼지므로, 버튼 글자를 먼저 바꾸고 잠시 뒤 실제 상태로 다시 맞춘다 */
    private fun showToggleAs(running: Boolean) {
        btnToggle.text = getString(if (running) R.string.stop_clock else R.string.start_clock)
        handler.postDelayed({ refreshState() }, 600)
    }

    /** 설정이 바뀌면 떠 있는 시계에 즉시 반영 */
    private fun refreshClock() {
        if (FloatingClockService.isRunning) {
            startService(Intent(this, FloatingClockService::class.java).setAction(FloatingClockService.ACTION_REFRESH))
        }
    }

    /** 모양 설정이 바뀌면 미리보기와 떠 있는 시계 둘 다 갱신 */
    private fun onStyleChanged() {
        updatePreview()
        refreshClock()
    }

    private fun updatePreview() {
        ClockStyle.apply(preview, prefs)
        val fmt = ClockStyle.formatter(prefs)
        previewFmt = fmt
        preview.text = fmt.format(Date())
    }

    private fun refreshState() {
        val perm = hasOverlayPermission()
        permState.text = getString(if (perm) R.string.perm_granted else R.string.perm_missing)
        permState.setTextColor(if (perm) Color.parseColor("#2E7D32") else Color.parseColor("#C62828"))
        btnPerm.isEnabled = !perm

        val running = FloatingClockService.isRunning
        btnToggle.text = getString(if (running) R.string.stop_clock else R.string.start_clock)
        btnToggle.setOnClickListener { if (FloatingClockService.isRunning) stopClock() else startClock() }
    }

    // ---------- 설정 UI ----------

    private fun setupControls() {
        btnPerm.setOnClickListener { openOverlaySettings() }

        // 글자 크기: 슬라이더 + 1씩 조절 버튼
        seekSize.max = ClockStyle.MAX_SIZE - ClockStyle.MIN_SIZE
        seekSize.progress = (prefs.textSizeSp - ClockStyle.MIN_SIZE).coerceIn(0, seekSize.max)
        sizeLabel.text = getString(R.string.size_fmt, prefs.textSizeSp)
        seekSize.setOnSeekBarChangeListener(simpleSeek { p ->
            val sp = p + ClockStyle.MIN_SIZE
            if (sp == prefs.textSizeSp) return@simpleSeek
            prefs.textSizeSp = sp
            sizeLabel.text = getString(R.string.size_fmt, sp)
            onStyleChanged()
        })
        btnSizeMinus.setOnClickListener { seekSize.progress = (seekSize.progress - 1).coerceAtLeast(0) }
        btnSizePlus.setOnClickListener { seekSize.progress = (seekSize.progress + 1).coerceAtMost(seekSize.max) }

        // 글자 색: 색 견본
        buildSwatches()

        // 배경 불투명도 0~255 (0 = 배경 없음)
        seekAlpha.max = 255
        seekAlpha.progress = prefs.bgAlpha
        alphaLabel.text = alphaText(prefs.bgAlpha)
        seekAlpha.setOnSeekBarChangeListener(simpleSeek { p ->
            prefs.bgAlpha = p
            alphaLabel.text = alphaText(p)
            onStyleChanged()
        })

        sw24h.isChecked = prefs.use24h
        sw24h.setOnCheckedChangeListener { _, on -> prefs.use24h = on; onStyleChanged() }

        swDate.isChecked = prefs.showDate
        swDate.setOnCheckedChangeListener { _, on -> prefs.showDate = on; onStyleChanged() }

        swLock.isChecked = prefs.lockPosition
        swLock.setOnCheckedChangeListener { _, on -> prefs.lockPosition = on }

        // 위치 슬라이더: 상태바 영역에 시계가 있으면 드래그가 안 되므로 여기서 옮길 수 있게 함
        seekPosX.max = screenW
        seekPosY.max = screenH / 2
        seekPosX.setOnSeekBarChangeListener(simpleSeek { p ->
            if (syncingSliders) return@simpleSeek
            prefs.posX = p - screenW / 2
            posXLabel.text = getString(R.string.pos_x_fmt, pxToDp(prefs.posX))
            refreshClock()
        })
        seekPosY.setOnSeekBarChangeListener(simpleSeek { p ->
            if (syncingSliders) return@simpleSeek
            prefs.posY = p
            posYLabel.text = getString(R.string.pos_y_fmt, pxToDp(p))
            refreshClock()
        })

        btnResetPos.setOnClickListener {
            prefs.posX = 0
            prefs.posY = Prefs.POS_AUTO
            syncPositionSliders()
            refreshClock()
            Toast.makeText(this, R.string.toast_pos_reset, Toast.LENGTH_SHORT).show()
        }
    }

    /** 동그란 색 견본을 6개씩 줄 지어 만든다 */
    private fun buildSwatches() {
        swatchContainer.removeAllViews()
        swatchViews.clear()
        ClockStyle.COLORS.toList().chunked(6).forEach { rowColors ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            rowColors.forEach { color ->
                val dot = View(this).apply {
                    tag = color
                    isClickable = true
                    contentDescription = String.format("#%06X", 0xFFFFFF and color)
                    setOnClickListener {
                        prefs.textColor = color
                        updateSwatchSelection()
                        onStyleChanged()
                    }
                }
                val cell = FrameLayout(this)
                cell.addView(dot, FrameLayout.LayoutParams(dp(34), dp(34), Gravity.CENTER))
                row.addView(cell, LinearLayout.LayoutParams(0, dp(46), 1f))
                swatchViews += dot
            }
            swatchContainer.addView(
                row,
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            )
        }
        updateSwatchSelection()
    }

    private fun updateSwatchSelection() {
        val ring = Color.parseColor("#1E88E5")
        val edge = Color.parseColor("#9E9E9E")
        swatchViews.forEach { v ->
            val c = v.tag as Int
            val selected = c == prefs.textColor
            v.background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(c)
                if (selected) setStroke(dp(4), ring) else setStroke(dp(1), edge)
            }
            v.scaleX = if (selected) 1.1f else 1f
            v.scaleY = if (selected) 1.1f else 1f
        }
    }

    private fun alphaText(alpha: Int): String =
        if (alpha <= 0) getString(R.string.alpha_none) else getString(R.string.alpha_fmt, alpha * 100 / 255)

    /** 저장된 위치(또는 시계를 드래그해서 바뀐 위치)를 슬라이더에 반영 */
    private fun syncPositionSliders() {
        syncingSliders = true
        val y = if (prefs.posY == Prefs.POS_AUTO) statusBarHeight() else prefs.posY
        seekPosX.progress = (prefs.posX + screenW / 2).coerceIn(0, seekPosX.max)
        seekPosY.progress = y.coerceIn(0, seekPosY.max)
        posXLabel.text = getString(R.string.pos_x_fmt, pxToDp(prefs.posX))
        posYLabel.text = getString(R.string.pos_y_fmt, pxToDp(y))
        syncingSliders = false
    }

    private fun statusBarHeight(): Int {
        val id = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else dp(24)
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun pxToDp(px: Int): Int = (px / resources.displayMetrics.density).toInt()

    private fun simpleSeek(onChange: (Int) -> Unit) = object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) = onChange(p)
        override fun onStartTrackingTouch(sb: SeekBar) {}
        override fun onStopTrackingTouch(sb: SeekBar) {}
    }

    /**
     * v1.5 에 잠깐 있던 화면 인식 기능을 없앴으므로, 그때 폰에 남은 캡처 그림, 규칙, 설정값을 지운다.
     * 아이모 운영 정책상 게임 화면을 읽는 기능은 넣지 않는다. (CLAUDE.md 참고)
     */
    private fun removeOldScreenWatchData() {
        runCatching { File(filesDir, "snapshot.png").delete() }
        runCatching { deleteSharedPreferences("screen_rules") }
        prefs.removeLegacyKeys()
    }

    // ---------- 업데이트 (UpdateUi 를 첫 화면과 같이 쓴다) ----------

    private fun setupUpdate() {
        versionLabel.text = getString(R.string.version_fmt, BuildConfig.VERSION_NAME)
        btnUpdate.setOnClickListener {
            btnUpdate.isEnabled = false
            UpdateUi.check(this, silent = false, onState = { updateState.text = it }) { btnUpdate.isEnabled = true }
        }
    }
}
