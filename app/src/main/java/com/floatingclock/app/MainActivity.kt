package com.floatingclock.app

import android.Manifest
import android.app.AlertDialog
import android.app.ProgressDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
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
import android.widget.ArrayAdapter
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

class MainActivity : AppCompatActivity() {

    companion object {
        /** 게임 감지 안내는 앱이 살아 있는 동안 한 번만 저절로 띄운다 */
        private var detectionGuideShown = false

        /** 안드로이드가 '다른 앱 위에 표시 중' 알림에 앱마다 따로 만드는 채널 (이름 뒤에 패키지 이름이 붙는다) */
        private const val OVERLAY_NOTI_CHANNEL_PREFIX = "com.android.server.wm.AlertWindowNotification - "
    }

    private lateinit var prefs: Prefs

    private lateinit var permState: TextView
    private lateinit var btnPerm: Button
    private lateinit var btnToggle: Button
    private lateinit var swGameOnly: MaterialSwitch
    private lateinit var gameGroup: LinearLayout
    private lateinit var gameTarget: TextView
    private lateinit var btnPickGame: Button
    private lateinit var usageState: TextView
    private lateinit var btnUsagePerm: Button
    private lateinit var usageRestrictedHint: TextView
    private lateinit var btnAppInfo: Button
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
    private var checkedOnce = false
    private var autoDetectTried = false

    /** '시계 켜기'에서 권한을 허용하러 갔다면, 허용하고 돌아왔을 때 시계를 바로 켠다 */
    private var startWhenReady = false

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
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)

        permState = findViewById(R.id.perm_state)
        btnPerm = findViewById(R.id.btn_perm)
        btnToggle = findViewById(R.id.btn_toggle)
        swGameOnly = findViewById(R.id.sw_game_only)
        gameGroup = findViewById(R.id.game_group)
        gameTarget = findViewById(R.id.game_target)
        btnPickGame = findViewById(R.id.btn_pick_game)
        usageState = findViewById(R.id.usage_state)
        btnUsagePerm = findViewById(R.id.btn_usage_perm)
        usageRestrictedHint = findViewById(R.id.usage_restricted_hint)
        btnAppInfo = findViewById(R.id.btn_app_info)
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
        setupGameSection()
        findViewById<Button>(R.id.btn_open_timer).setOnClickListener {
            startActivity(Intent(this, TimerActivity::class.java))
        }
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
        if (!autoDetectTried && prefs.gameOnly && prefs.targetPackage == null) {
            autoDetectTried = true // 설치된 앱을 훑는 작업이라 화면을 열 때 한 번만
            autoDetectGame(showToast = false)
        }
        refreshGameSection()
        refreshClock() // 권한을 허용하고 돌아왔을 때 알림 문구와 표시 여부를 바로 갱신
        if (startWhenReady && detectionReady()) {
            startWhenReady = false
            launchClockService()
        } else if (!detectionGuideShown && prefs.gameOnly && FloatingClockService.isRunning && !detectionReady()) {
            // 시계는 켜져 있는데 게임을 알아볼 수 없으면 게임을 꺼도 시계가 남는다. 한 번 안내한다.
            showDetectionGuide(fromStartButton = false)
        }
        handler.post(previewTick)
        if (!checkedOnce) {
            checkedOnce = true
            checkUpdate(silent = true)
        }
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
        startWhenReady = false
        if (!hasOverlayPermission()) {
            openOverlaySettings()
            return
        }
        // 게임을 알아볼 수 없으면 게임이 꺼져 있어도 시계가 항상 뜨므로, 켜기 전에 해결 방법을 알려 준다
        if (prefs.gameOnly && !detectionReady()) {
            showDetectionGuide(fromStartButton = true)
            return
        }
        launchClockService()
    }

    private fun launchClockService() {
        val i = Intent(this, FloatingClockService::class.java).setAction(FloatingClockService.ACTION_START)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i) else startService(i)
        val label = prefs.targetLabel
        if (prefs.gameOnly && label != null && detectionReady()) {
            Toast.makeText(this, getString(R.string.toast_game_mode_started, label), Toast.LENGTH_LONG).show()
        }
        showToggleAs(running = true)
    }

    private fun stopClock() {
        startWhenReady = false
        startService(Intent(this, FloatingClockService::class.java).setAction(FloatingClockService.ACTION_STOP))
        prefs.running = false
        showToggleAs(running = false)
    }

    /** 서비스는 조금 뒤에 실제로 켜지고 꺼지므로, 버튼 글자를 먼저 바꾸고 잠시 뒤 실제 상태로 다시 맞춘다 */
    private fun showToggleAs(running: Boolean) {
        btnToggle.text = getString(if (running) R.string.stop_clock else R.string.start_clock)
        handler.postDelayed({ refreshState() }, 600)
    }

    /** 고른 게임이 있고 '사용 정보 접근'도 허용되어서, 게임이 화면 앞에 있는지 알 수 있는지 */
    private fun detectionReady(): Boolean =
        prefs.targetPackage != null && GameDetector.hasUsageAccess(this)

    /**
     * 게임을 알아볼 수 없을 때(게임을 안 골랐거나 '사용 정보 접근'이 없을 때) 해결 방법 안내.
     * 이때는 게임이 꺼져 있어도 시계가 항상 뜬다.
     * '시계 켜기'에서 왔으면 감지 없이 '그냥 켜기'도 고를 수 있다.
     */
    private fun showDetectionGuide(fromStartButton: Boolean) {
        detectionGuideShown = true
        val builder = AlertDialog.Builder(this)
        if (prefs.targetPackage == null) {
            builder.setTitle(R.string.guide_game_title)
                .setMessage(getString(R.string.guide_game_msg) + "\n\n" + getString(R.string.guide_always_hint))
                .setPositiveButton(R.string.pick_game) { _, _ ->
                    showGamePicker {
                        if (fromStartButton) startClock()
                        else if (!detectionReady()) showDetectionGuide(fromStartButton = false)
                    }
                }
        } else {
            val label = prefs.targetLabel ?: getString(R.string.default_game_name)
            val msg = buildString {
                append(getString(R.string.guide_usage_msg, label))
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    append("\n\n").append(getString(R.string.guide_usage_restricted))
                }
                append("\n\n").append(getString(R.string.guide_always_hint))
            }
            builder.setTitle(R.string.guide_usage_title)
                .setMessage(msg)
                .setPositiveButton(R.string.guide_usage_go) { _, _ ->
                    startWhenReady = fromStartButton
                    Toast.makeText(this, R.string.toast_allow_usage, Toast.LENGTH_LONG).show()
                    GameDetector.openUsageAccessSettings(this)
                }
        }
        if (fromStartButton) {
            builder.setNeutralButton(R.string.start_anyway) { _, _ -> launchClockService() }
            builder.setNegativeButton(R.string.cancel, null)
        } else {
            builder.setNegativeButton(R.string.later, null)
        }
        builder.show()
    }

    /**
     * 설정이 바뀌면 떠 있는 시계에 즉시 반영.
     * preview 면 이 앱 화면 위에서도 잠깐 보여 줘서 위치와 모양을 확인할 수 있게 한다.
     */
    private fun refreshClock(preview: Boolean = false) {
        if (FloatingClockService.isRunning) {
            startService(
                Intent(this, FloatingClockService::class.java)
                    .setAction(FloatingClockService.ACTION_REFRESH)
                    .putExtra(FloatingClockService.EXTRA_PREVIEW, preview)
            )
        }
    }

    /** 모양 설정이 바뀌면 미리보기와 떠 있는 시계 둘 다 갱신 */
    private fun onStyleChanged() {
        updatePreview()
        refreshClock(preview = true)
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

    // ---------- 게임 연동 ----------

    private fun setupGameSection() {
        swGameOnly.isChecked = prefs.gameOnly
        swGameOnly.setOnCheckedChangeListener { _, on ->
            prefs.gameOnly = on
            if (on && prefs.targetPackage == null) autoDetectGame(showToast = true)
            refreshGameSection()
            refreshClock()
        }
        btnPickGame.setOnClickListener { showGamePicker() }
        btnUsagePerm.setOnClickListener {
            Toast.makeText(this, R.string.toast_allow_usage, Toast.LENGTH_LONG).show()
            GameDetector.openUsageAccessSettings(this)
        }
        btnAppInfo.setOnClickListener {
            runCatching {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
        }
    }

    private fun refreshGameSection() {
        gameGroup.visibility = if (prefs.gameOnly) View.VISIBLE else View.GONE
        val label = prefs.targetLabel
        gameTarget.text = if (prefs.targetPackage != null && label != null)
            getString(R.string.game_target_fmt, label)
        else
            getString(R.string.game_target_none)
        val access = GameDetector.hasUsageAccess(this)
        usageState.text = getString(if (access) R.string.usage_granted else R.string.usage_missing)
        usageState.setTextColor(if (access) Color.parseColor("#2E7D32") else Color.parseColor("#C62828"))
        btnUsagePerm.visibility = if (access) View.GONE else View.VISIBLE
        // 안드로이드 13부터 스토어 밖에서 설치한 앱은 '제한된 설정'으로 스위치가 막혀 있을 수 있다
        val restricted = !access && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        usageRestrictedHint.visibility = if (restricted) View.VISIBLE else View.GONE
        btnAppInfo.visibility = if (restricted) View.VISIBLE else View.GONE
    }

    /** 설치된 앱 중에서 아이모를 찾아 대상 게임으로 지정 */
    private fun autoDetectGame(showToast: Boolean) {
        val found = GameDetector.findImo(this) ?: return
        prefs.targetPackage = found.packageName
        prefs.targetLabel = found.label
        if (showToast) {
            Toast.makeText(this, getString(R.string.toast_game_found, found.label), Toast.LENGTH_SHORT).show()
        }
    }

    /** 설치된 앱 목록에서 게임 고르기 (아이모로 보이는 앱을 맨 위에). 고르면 onPicked 실행 */
    private fun showGamePicker(onPicked: () -> Unit = {}) {
        val apps = GameDetector.launchableApps(this).sortedByDescending { GameDetector.looksLikeImo(it) }
        if (apps.isEmpty()) return
        val pm = packageManager
        val iconSize = dp(32)
        val adapter = object : ArrayAdapter<GameDetector.AppEntry>(
            this, android.R.layout.select_dialog_item, android.R.id.text1, apps
        ) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent) as TextView
                val app = apps[position]
                v.text = app.label
                val icon = runCatching { pm.getApplicationIcon(app.packageName) }.getOrNull()
                icon?.setBounds(0, 0, iconSize, iconSize)
                v.setCompoundDrawablesRelative(icon, null, null, null)
                v.compoundDrawablePadding = dp(12)
                return v
            }
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.pick_game_title)
            .setAdapter(adapter) { _, which ->
                val app = apps[which]
                prefs.targetPackage = app.packageName
                prefs.targetLabel = app.label
                refreshGameSection()
                refreshClock()
                onPicked()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
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
            refreshClock(preview = true)
        })
        seekPosY.setOnSeekBarChangeListener(simpleSeek { p ->
            if (syncingSliders) return@simpleSeek
            prefs.posY = p
            posYLabel.text = getString(R.string.pos_y_fmt, pxToDp(p))
            refreshClock(preview = true)
        })

        btnResetPos.setOnClickListener {
            prefs.posX = 0
            prefs.posY = Prefs.POS_AUTO
            syncPositionSliders()
            refreshClock(preview = true)
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

    // ---------- 업데이트 ----------

    private fun setupUpdate() {
        versionLabel.text = getString(R.string.version_fmt, BuildConfig.VERSION_NAME)
        btnUpdate.setOnClickListener { checkUpdate(silent = false) }
    }

    private fun checkUpdate(silent: Boolean) {
        updateState.text = getString(R.string.update_checking)
        btnUpdate.isEnabled = false
        UpdateChecker.fetchLatest { rel ->
            btnUpdate.isEnabled = true
            when {
                rel == null -> updateState.text = getString(R.string.update_check_failed)
                UpdateChecker.isNewer(rel.version, BuildConfig.VERSION_NAME) -> {
                    updateState.text = getString(R.string.update_available, rel.version)
                    showUpdateDialog(rel)
                }
                else -> {
                    updateState.text = getString(R.string.update_latest)
                    if (!silent) Toast.makeText(this, R.string.update_latest, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun showUpdateDialog(rel: UpdateChecker.Release) {
        val notes = rel.notes.trim().ifEmpty { getString(R.string.update_no_notes) }
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.update_title, rel.version))
            .setMessage(notes)
            .setPositiveButton(R.string.update_now) { _, _ -> startDownload(rel) }
            .setNegativeButton(R.string.later, null)
            .show()
    }

    private fun startDownload(rel: UpdateChecker.Release) {
        if (!UpdateChecker.canInstall(this)) {
            Toast.makeText(this, R.string.toast_allow_install, Toast.LENGTH_LONG).show()
            UpdateChecker.openInstallPermission(this)
            return
        }
        @Suppress("DEPRECATION")
        val dlg = ProgressDialog(this).apply {
            setTitle(R.string.update_downloading)
            setProgressStyle(ProgressDialog.STYLE_HORIZONTAL)
            max = 100
            setCancelable(false)
            show()
        }
        UpdateChecker.downloadAndInstall(
            this, rel.apkUrl,
            onProgress = { dlg.progress = it },
            onDone = { ok, err ->
                dlg.dismiss()
                if (!ok) {
                    Toast.makeText(this, getString(R.string.update_failed, err ?: ""), Toast.LENGTH_LONG).show()
                }
            }
        )
    }
}
