package com.floatingclock.app

import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.RectF
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioGroup
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.materialswitch.MaterialSwitch

/** 규칙 만들기/고치기: 캡처한 화면에서 네모를 고르고, 언제 무엇을 띄울지 정한다 */
class RuleEditorActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_RULE_ID = "rule_id"
    }

    private var rule: Rule? = null
    private var snapshot: Bitmap? = null
    private var regionChanged = false

    private lateinit var regionView: RegionSelectView
    private lateinit var editMessage: EditText
    private lateinit var radioMode: RadioGroup
    private lateinit var thresholdLabel: TextView
    private lateinit var seekThreshold: SeekBar
    private lateinit var scoreLabel: TextView
    private lateinit var swArrow: MaterialSwitch
    private lateinit var swVibrate: MaterialSwitch
    private lateinit var swSound: MaterialSwitch
    private lateinit var swEnabled: MaterialSwitch

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        snapshot = runCatching { BitmapFactory.decodeFile(RuleStore.snapshotFile(this).path) }.getOrNull()
        rule = intent.getStringExtra(EXTRA_RULE_ID)?.let { RuleStore.find(this, it) }

        // 게임이 가로 화면이면 편집 화면도 가로로: 그림을 크게 보고 정확히 고를 수 있게
        val snap = snapshot
        val landscape = snap == null || snap.width >= snap.height
        requestedOrientation = if (landscape) {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        }
        setContentView(R.layout.activity_rule_editor)

        regionView = findViewById(R.id.region_view)
        editMessage = findViewById(R.id.edit_message)
        radioMode = findViewById(R.id.radio_mode)
        thresholdLabel = findViewById(R.id.threshold_label)
        seekThreshold = findViewById(R.id.seek_threshold)
        scoreLabel = findViewById(R.id.score_label)
        swArrow = findViewById(R.id.sw_arrow)
        swVibrate = findViewById(R.id.sw_vibrate)
        swSound = findViewById(R.id.sw_sound)
        swEnabled = findViewById(R.id.sw_rule_enabled)

        if (landscape) {
            findViewById<LinearLayout>(R.id.editor_root).orientation = LinearLayout.HORIZONTAL
            regionView.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 3f)
            findViewById<View>(R.id.editor_controls).layoutParams =
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 2f)
        }

        val r = rule
        regionView.emptyText = getString(R.string.editor_no_snapshot)
        regionView.bitmap = snap
        regionView.selection = r?.let { RectF(it.x, it.y, it.x + it.w, it.y + it.h) }
        regionView.onSelectionChanged = { regionChanged = true }
        findViewById<TextView>(R.id.editor_hint).text =
            getString(if (r == null) R.string.editor_hint else R.string.editor_hint_edit)

        editMessage.setText(r?.message ?: "")
        radioMode.check(if ((r?.mode ?: Rule.MODE_APPEAR) == Rule.MODE_APPEAR) R.id.mode_appear else R.id.mode_change)
        seekThreshold.max = 49
        seekThreshold.progress = ((r?.threshold ?: 85) - 50).coerceIn(0, 49)
        thresholdLabel.text = getString(R.string.threshold_fmt, seekThreshold.progress + 50)
        seekThreshold.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) {
                thresholdLabel.text = getString(R.string.threshold_fmt, p + 50)
            }

            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })
        val score = r?.let { RuleStore.lastScores[it.id] }
        scoreLabel.text = if (score != null) getString(R.string.last_score_fmt, score) else ""
        scoreLabel.visibility = if (score == null) View.GONE else View.VISIBLE

        swArrow.isChecked = r?.arrow ?: true
        swVibrate.isChecked = r?.vibrate ?: true
        swSound.isChecked = r?.sound ?: false
        swEnabled.isChecked = r?.enabled ?: true

        findViewById<Button>(R.id.btn_save).setOnClickListener { save() }
        findViewById<Button>(R.id.btn_cancel).setOnClickListener { finish() }
        findViewById<Button>(R.id.btn_delete).apply {
            visibility = if (r == null) View.GONE else View.VISIBLE
            setOnClickListener { confirmDelete() }
        }
    }

    override fun onResume() {
        super.onResume()
        UiState.resumed++
    }

    override fun onPause() {
        UiState.resumed--
        super.onPause()
    }

    private fun save() {
        val sel = regionView.selection
        val snap = snapshot
        val existing = rule
        if (existing == null && (!regionChanged || sel == null || snap == null)) {
            toast(R.string.toast_pick_region)
            return
        }
        if (regionChanged && sel != null && (sel.width() < 0.01f || sel.height() < 0.01f)) {
            toast(R.string.toast_region_small)
            return
        }
        val r = existing ?: Rule()
        if (regionChanged && sel != null && snap != null) {
            // 새로 고른 네모 -> 지금 캡처를 새 기준 모습으로 저장
            r.x = sel.left.coerceIn(0f, 1f)
            r.y = sel.top.coerceIn(0f, 1f)
            r.w = sel.right.coerceIn(0f, 1f) - r.x
            r.h = sel.bottom.coerceIn(0f, 1f) - r.y
            r.ref = RegionSampler.sample(RegionSampler.BitmapSource(snap), r.x, r.y, r.w, r.h)
            RuleStore.lastScores.remove(r.id)
        }
        r.message = editMessage.text.toString().trim()
        r.mode = if (radioMode.checkedRadioButtonId == R.id.mode_change) Rule.MODE_CHANGE else Rule.MODE_APPEAR
        r.threshold = seekThreshold.progress + 50
        r.arrow = swArrow.isChecked
        r.vibrate = swVibrate.isChecked
        r.sound = swSound.isChecked
        r.enabled = swEnabled.isChecked
        RuleStore.upsert(this, r)
        notifyService()
        finish()
    }

    private fun confirmDelete() {
        val r = rule ?: return
        AlertDialog.Builder(this)
            .setMessage(R.string.delete_confirm)
            .setPositiveButton(R.string.delete) { _, _ ->
                RuleStore.delete(this, r.id)
                notifyService()
                finish()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun notifyService() {
        if (ScreenWatchService.isRunning) {
            startService(Intent(this, ScreenWatchService::class.java).setAction(ScreenWatchService.ACTION_RELOAD))
        }
    }

    private fun toast(id: Int) {
        Toast.makeText(this, id, Toast.LENGTH_SHORT).show()
    }
}
