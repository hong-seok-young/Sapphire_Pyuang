package com.floatingclock.app

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
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
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.materialswitch.MaterialSwitch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 화면 인식 설정: 켜기/끄기, 📷 버튼, 규칙 목록 */
class ScreenWatchActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private lateinit var watchState: TextView
    private lateinit var watchTarget: TextView
    private lateinit var btnToggle: Button
    private lateinit var swCaptureButton: MaterialSwitch
    private lateinit var snapshotState: TextView
    private lateinit var btnNewRule: Button
    private lateinit var rulesEmpty: TextView
    private lateinit var ruleList: LinearLayout

    /** 규칙 id -> (요약 글자, 규칙) : 1초마다 '지금 일치도'만 갱신 */
    private val summaryViews = HashMap<String, Pair<TextView, Rule>>()

    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            refreshStatus()
            refreshSummaries()
            handler.postDelayed(this, 1000)
        }
    }

    private val captureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
            val data = res.data
            if (res.resultCode == RESULT_OK && data != null) {
                val i = Intent(this, ScreenWatchService::class.java)
                    .setAction(ScreenWatchService.ACTION_START)
                    .putExtra(ScreenWatchService.EXTRA_RESULT_CODE, res.resultCode)
                    .putExtra(ScreenWatchService.EXTRA_RESULT_DATA, data)
                ContextCompat.startForegroundService(this, i)
                Toast.makeText(this, R.string.toast_watch_started, Toast.LENGTH_LONG).show()
            } else {
                Toast.makeText(this, R.string.toast_need_capture_permission, Toast.LENGTH_LONG).show()
            }
            handler.postDelayed({ refreshStatus() }, 500)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_screen_watch)
        prefs = Prefs(this)

        watchState = findViewById(R.id.watch_state)
        watchTarget = findViewById(R.id.watch_target)
        btnToggle = findViewById(R.id.btn_watch_toggle)
        swCaptureButton = findViewById(R.id.sw_capture_button)
        snapshotState = findViewById(R.id.snapshot_state)
        btnNewRule = findViewById(R.id.btn_new_rule)
        rulesEmpty = findViewById(R.id.rules_empty)
        ruleList = findViewById(R.id.rule_list)

        btnToggle.setOnClickListener { if (ScreenWatchService.isRunning) stopWatch() else startWatch() }
        swCaptureButton.isChecked = prefs.showCaptureButton
        swCaptureButton.setOnCheckedChangeListener { _, on ->
            prefs.showCaptureButton = on
            notifyService()
        }
        btnNewRule.setOnClickListener { startActivity(Intent(this, RuleEditorActivity::class.java)) }
    }

    override fun onResume() {
        super.onResume()
        UiState.resumed++
        buildRuleList()
        handler.post(ticker)
    }

    override fun onPause() {
        UiState.resumed--
        handler.removeCallbacks(ticker)
        super.onPause()
    }

    private fun startWatch() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, R.string.toast_need_overlay_first, Toast.LENGTH_LONG).show()
            return
        }
        val mpm = getSystemService(MediaProjectionManager::class.java)
        // 안드로이드 14 이상: '앱 하나'가 아닌 전체 화면 녹화만 고르게 해서 좌표가 어긋나지 않게
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
            mpm.createScreenCaptureIntent()
        }
        runCatching { captureLauncher.launch(intent) }
    }

    private fun stopWatch() {
        startService(Intent(this, ScreenWatchService::class.java).setAction(ScreenWatchService.ACTION_STOP))
        handler.postDelayed({ refreshStatus() }, 300)
    }

    private fun notifyService() {
        if (ScreenWatchService.isRunning) {
            startService(Intent(this, ScreenWatchService::class.java).setAction(ScreenWatchService.ACTION_RELOAD))
        }
    }

    private fun refreshStatus() {
        val on = ScreenWatchService.isRunning
        watchState.text = getString(if (on) R.string.watch_state_on else R.string.watch_state_off)
        watchState.setTextColor(if (on) Color.parseColor("#2E7D32") else Color.GRAY)
        btnToggle.text = getString(if (on) R.string.watch_stop else R.string.watch_start)

        val label = prefs.targetLabel
        watchTarget.text =
            if (prefs.gameOnly && prefs.targetPackage != null && label != null && GameDetector.hasUsageAccess(this)) {
                getString(R.string.watch_target_game, label)
            } else {
                getString(R.string.watch_target_all)
            }

        val f = RuleStore.snapshotFile(this)
        snapshotState.text = if (f.exists()) {
            val time = SimpleDateFormat("M/d HH:mm:ss", Locale.getDefault()).format(Date(f.lastModified()))
            getString(R.string.snapshot_fmt, time)
        } else {
            getString(R.string.snapshot_none)
        }
        btnNewRule.isEnabled = f.exists()
    }

    private fun buildRuleList() {
        ruleList.removeAllViews()
        summaryViews.clear()
        val rules = RuleStore.load(this)
        rulesEmpty.visibility = if (rules.isEmpty()) View.VISIBLE else View.GONE
        for (r in rules) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(8), 0, dp(8))
                background = selectableBackground()
                isClickable = true
                setOnClickListener {
                    startActivity(
                        Intent(this@ScreenWatchActivity, RuleEditorActivity::class.java)
                            .putExtra(RuleEditorActivity.EXTRA_RULE_ID, r.id),
                    )
                }
            }
            val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            val title = TextView(this).apply {
                text = r.message.ifBlank { getString(R.string.default_message) }
                textSize = 16f
                setTypeface(typeface, Typeface.BOLD)
            }
            val summary = TextView(this).apply { textSize = 12f }
            texts.addView(title)
            texts.addView(summary)
            row.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            val sw = MaterialSwitch(this).apply {
                isChecked = r.enabled
                setOnCheckedChangeListener { _, on ->
                    r.enabled = on
                    RuleStore.upsert(this@ScreenWatchActivity, r)
                    notifyService()
                }
            }
            row.addView(sw, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            ruleList.addView(row)
            summaryViews[r.id] = summary to r
        }
        refreshSummaries()
    }

    private fun refreshSummaries() {
        for ((id, pair) in summaryViews) {
            val (tv, r) = pair
            val mode = getString(
                if (r.mode == Rule.MODE_APPEAR) R.string.rule_mode_appear_short else R.string.rule_mode_change_short,
            )
            var s = getString(R.string.rule_summary_fmt, mode, r.threshold)
            RuleStore.lastScores[id]?.let { s += getString(R.string.rule_score_fmt, it) }
            tv.text = s
        }
    }

    private fun selectableBackground(): Drawable? {
        val tv = TypedValue()
        theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
        return ContextCompat.getDrawable(this, tv.resourceId)
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
}
