package com.floatingclock.app

import android.Manifest
import android.app.AlertDialog
import android.app.ProgressDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.widget.Button
import android.widget.RadioGroup
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.materialswitch.MaterialSwitch

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs

    private lateinit var permState: TextView
    private lateinit var btnPerm: Button
    private lateinit var btnToggle: Button
    private lateinit var seekSize: SeekBar
    private lateinit var seekAlpha: SeekBar
    private lateinit var sizeLabel: TextView
    private lateinit var alphaLabel: TextView
    private lateinit var colorGroup: RadioGroup
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

    /** 위치 슬라이더를 코드로 맞추는 동안 리스너가 설정을 덮어쓰지 않게 */
    private var syncingSliders = false
    private var checkedOnce = false

    // 색상 라디오 버튼 id -> 색
    private val colorMap by lazy {
        linkedMapOf(
            R.id.color_white to Color.WHITE,
            R.id.color_yellow to Color.parseColor("#FFEB3B"),
            R.id.color_green to Color.parseColor("#69F0AE"),
            R.id.color_cyan to Color.parseColor("#40C4FF"),
            R.id.color_red to Color.parseColor("#FF5252"),
        )
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
        seekSize = findViewById(R.id.seek_size)
        seekAlpha = findViewById(R.id.seek_alpha)
        sizeLabel = findViewById(R.id.size_label)
        alphaLabel = findViewById(R.id.alpha_label)
        colorGroup = findViewById(R.id.color_group)
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
        setupUpdate()
        askNotificationPermissionIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        refreshState()
        syncPositionSliders()
        if (!checkedOnce) {
            checkedOnce = true
            checkUpdate(silent = true)
        }
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

    // ---------- 서비스 시작/정지 ----------

    private fun startClock() {
        if (!hasOverlayPermission()) {
            openOverlaySettings()
            return
        }
        val i = Intent(this, FloatingClockService::class.java).setAction(FloatingClockService.ACTION_START)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i) else startService(i)
        refreshState()
    }

    private fun stopClock() {
        startService(Intent(this, FloatingClockService::class.java).setAction(FloatingClockService.ACTION_STOP))
        prefs.running = false
        refreshState()
    }

    /** 설정이 바뀌면 떠 있는 시계에 즉시 반영 */
    private fun refreshClock() {
        if (FloatingClockService.isRunning) {
            startService(Intent(this, FloatingClockService::class.java).setAction(FloatingClockService.ACTION_REFRESH))
        }
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

        // 글자 크기 8~40sp
        seekSize.max = 32
        seekSize.progress = (prefs.textSizeSp - 8).coerceIn(0, 32)
        sizeLabel.text = getString(R.string.size_fmt, prefs.textSizeSp)
        seekSize.setOnSeekBarChangeListener(simpleSeek { p ->
            val sp = p + 8
            prefs.textSizeSp = sp
            sizeLabel.text = getString(R.string.size_fmt, sp)
            refreshClock()
        })

        // 배경 불투명도 0~255 (0 = 배경 없음)
        seekAlpha.max = 255
        seekAlpha.progress = prefs.bgAlpha
        alphaLabel.text = alphaText(prefs.bgAlpha)
        seekAlpha.setOnSeekBarChangeListener(simpleSeek { p ->
            prefs.bgAlpha = p
            alphaLabel.text = alphaText(p)
            refreshClock()
        })

        // 글자 색
        val currentId = colorMap.entries.firstOrNull { it.value == prefs.textColor }?.key ?: R.id.color_white
        colorGroup.check(currentId)
        colorGroup.setOnCheckedChangeListener { _, id ->
            colorMap[id]?.let {
                prefs.textColor = it
                refreshClock()
            }
        }

        sw24h.isChecked = prefs.use24h
        sw24h.setOnCheckedChangeListener { _, on -> prefs.use24h = on; refreshClock() }

        swDate.isChecked = prefs.showDate
        swDate.setOnCheckedChangeListener { _, on -> prefs.showDate = on; refreshClock() }

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
