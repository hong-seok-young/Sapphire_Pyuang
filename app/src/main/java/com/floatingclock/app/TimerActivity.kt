package com.floatingclock.app

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.TimePicker
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.materialswitch.MaterialSwitch
import java.util.Locale
import kotlin.math.abs

/** 타이머 설정: 타이머 목록, 정해진 시각 알림, 알림 방식 */
class TimerActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private lateinit var presetList: LinearLayout
    private lateinit var presetEmpty: TextView
    private lateinit var reminderList: LinearLayout
    private lateinit var reminderEmpty: TextView
    private lateinit var preAlertLabel: TextView
    private lateinit var leadLabel: TextView
    private lateinit var wikiState: TextView
    private lateinit var wikiSource: TextView
    private lateinit var wikiButtons: List<View>

    /** 미리 알림 단계 (초): 끄기, 10초, 30초, 1분, 3분, 5분 */
    private val preAlertSteps = intArrayOf(0, 10, 30, 60, 180, 300)

    /** 시각 알림 남은 시간 표시 단계 (분) */
    private val leadSteps = intArrayOf(0, 1, 3, 5, 10, 15, 30)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_timer)
        prefs = Prefs(this)
        TimerStore.ensureLoaded(this)

        presetList = findViewById(R.id.preset_list)
        presetEmpty = findViewById(R.id.preset_empty)
        reminderList = findViewById(R.id.reminder_list)
        reminderEmpty = findViewById(R.id.reminder_empty)
        preAlertLabel = findViewById(R.id.pre_alert_label)
        leadLabel = findViewById(R.id.lead_label)

        findViewById<MaterialSwitch>(R.id.sw_tap_opens).apply {
            isChecked = prefs.timerTapOpens
            setOnCheckedChangeListener { _, on -> prefs.timerTapOpens = on }
        }
        findViewById<MaterialSwitch>(R.id.sw_timer_vibrate).apply {
            isChecked = prefs.timerVibrate
            setOnCheckedChangeListener { _, on -> prefs.timerVibrate = on }
        }
        findViewById<MaterialSwitch>(R.id.sw_timer_sound).apply {
            isChecked = prefs.timerSound
            setOnCheckedChangeListener { _, on -> prefs.timerSound = on }
        }

        findViewById<SeekBar>(R.id.seek_pre_alert).apply {
            max = preAlertSteps.size - 1
            progress = nearestIndex(preAlertSteps, prefs.timerPreAlertSec)
            setOnSeekBarChangeListener(simpleSeek { p ->
                prefs.timerPreAlertSec = preAlertSteps[p]
                updateLabels()
            })
        }
        findViewById<SeekBar>(R.id.seek_lead).apply {
            max = leadSteps.size - 1
            progress = nearestIndex(leadSteps, prefs.reminderLeadMin)
            setOnSeekBarChangeListener(simpleSeek { p ->
                prefs.reminderLeadMin = leadSteps[p]
                updateLabels()
            })
        }
        updateLabels()

        findViewById<View>(R.id.btn_add_preset).setOnClickListener { showPresetDialog(null) }
        findViewById<View>(R.id.btn_add_reminder).setOnClickListener { showReminderDialog(null) }
        refreshLists()
        setupWiki()
    }

    // ---------- 위키 보스·네임드 젠 시간 ----------
    // 자료는 위키 사이트에서 받아 쓴다 (WikiTimers). 앱에 따로 넣지 않는다.

    private fun setupWiki() {
        wikiState = findViewById(R.id.wiki_state)
        wikiSource = findViewById(R.id.wiki_source)
        findViewById<MaterialSwitch>(R.id.sw_wiki_in_panel).apply {
            isChecked = prefs.wikiInPanel
            setOnCheckedChangeListener { _, on -> prefs.wikiInPanel = on }
        }
        val places = findViewById<View>(R.id.btn_wiki_places).apply { setOnClickListener { showWikiPlaces() } }
        val list = findViewById<View>(R.id.btn_wiki_list).apply { setOnClickListener { showWikiList() } }
        wikiButtons = listOf(places, list)
        findViewById<View>(R.id.btn_wiki_refresh).setOnClickListener { refreshWiki(force = true) }
        refreshWiki(force = false)
    }

    private fun refreshWiki(force: Boolean) {
        updateWikiState(loading = true)
        WikiTimers.refresh(this, force) { ok ->
            if (isFinishing || isDestroyed) return@refresh
            updateWikiState(loading = false)
            if (force) {
                Toast.makeText(this, if (ok) R.string.wiki_refreshed else if (WikiTimers.needsLogin) R.string.wiki_login_needed else R.string.wiki_failed, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun updateWikiState(loading: Boolean) {
        val d = WikiTimers.get(this)
        wikiState.text = when {
            d != null -> {
                val hidden = prefs.wikiHiddenPlaces
                getString(R.string.wiki_state_fmt, d.places.size, d.places.count { it.id !in hidden }, d.mobCount)
            }
            loading -> getString(R.string.wiki_loading)
            WikiTimers.needsLogin -> getString(R.string.wiki_login_needed)
            else -> getString(R.string.wiki_failed)
        }
        wikiSource.text = if (d != null) {
            val patch = if (d.patch.isNotEmpty()) getString(R.string.wiki_patch_fmt, d.patch) else ""
            getString(R.string.wiki_source_fmt, d.sourceTitle, d.author, patch)
        } else {
            getString(R.string.wiki_source_default)
        }
        wikiButtons.forEach { it.isEnabled = d != null }
    }

    /** 시계 목록에 보일 사냥터 고르기. 체크를 뺀 사냥터만 저장해서, 위키에 새로 생긴 곳은 기본으로 보인다 */
    private fun showWikiPlaces() {
        val d = WikiTimers.get(this) ?: return
        val hidden = prefs.wikiHiddenPlaces
        val labels = d.places.map { getString(R.string.wiki_place_fmt, it.region, it.name, it.mobs.size) }.toTypedArray()
        val checked = BooleanArray(d.places.size) { d.places[it].id !in hidden }
        val dlg = AlertDialog.Builder(this)
            .setTitle(R.string.wiki_pick_places)
            .setMultiChoiceItems(labels, checked) { _, which, on -> checked[which] = on }
            .setPositiveButton(R.string.save) { _, _ ->
                prefs.wikiHiddenPlaces = d.places.filterIndexed { i, _ -> !checked[i] }.map { it.id }.toSet()
                updateWikiState(loading = false)
            }
            .setNeutralButton(R.string.wiki_select_all, null)
            .setNegativeButton(R.string.cancel, null)
            .create()
        dlg.setOnShowListener {
            // '모두 선택/해제'는 창을 닫지 않고 체크만 바꾼다
            dlg.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                val value = !checked.all { it }
                for (i in checked.indices) {
                    checked[i] = value
                    dlg.listView.setItemChecked(i, value)
                }
            }
        }
        dlg.show()
    }

    /** 들어 있는 보스·네임드와 젠 시간을 사냥터별로 보여 준다 (위키에 적힌 글도 함께) */
    private fun showWikiList() {
        val d = WikiTimers.get(this) ?: return
        val text = buildString {
            for (place in d.places) {
                if (isNotEmpty()) append("\n")
                append("[").append(place.region).append("] ").append(place.name).append("\n")
                for (m in place.mobs) {
                    append("  ").append(m.name).append("  ").append(m.label(this@TimerActivity))
                    m.note?.let { append("\n      ").append(it) }
                    append("\n")
                }
            }
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.wiki_list_title)
            .setMessage(text)
            .setPositiveButton(R.string.ok, null)
            .show()
    }

    private fun updateLabels() {
        val pre = prefs.timerPreAlertSec
        preAlertLabel.text = if (pre <= 0) {
            getString(R.string.pre_alert_off)
        } else {
            getString(R.string.pre_alert_fmt, TimeFmt.label(this, pre))
        }
        val lead = prefs.reminderLeadMin
        leadLabel.text = if (lead <= 0) getString(R.string.lead_off) else getString(R.string.lead_fmt, lead)
    }

    // ---------- 목록 ----------

    private fun refreshLists() {
        presetList.removeAllViews()
        for (p in TimerStore.presets) {
            presetList.addView(
                row(
                    text = getString(R.string.preset_row_fmt, p.name, TimeFmt.label(this, p.durationSec)),
                    onClick = { showPresetDialog(p) },
                    onDelete = {
                        confirmDelete(p.name) {
                            TimerStore.presets.remove(p)
                            TimerStore.running.removeAll { it.presetId == p.id }
                            TimerStore.save(this)
                            refreshLists()
                        }
                    },
                ),
            )
        }
        presetEmpty.visibility = if (TimerStore.presets.isEmpty()) View.VISIBLE else View.GONE

        reminderList.removeAllViews()
        for (r in TimerStore.reminders) {
            val sw = MaterialSwitch(this).apply {
                isChecked = r.enabled
                setOnCheckedChangeListener { _, on ->
                    r.enabled = on
                    TimerStore.save(this@TimerActivity)
                }
            }
            reminderList.addView(
                row(
                    text = String.format(Locale.US, "%02d:%02d  ", r.hour, r.minute) + r.name,
                    onClick = { showReminderDialog(r) },
                    onDelete = {
                        confirmDelete(r.name) {
                            TimerStore.reminders.remove(r)
                            TimerStore.save(this)
                            refreshLists()
                        }
                    },
                    extra = sw,
                ),
            )
        }
        reminderEmpty.visibility = if (TimerStore.reminders.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun row(text: String, onClick: () -> Unit, onDelete: () -> Unit, extra: View? = null): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val label = TextView(this).apply {
            this.text = text
            textSize = 16f
            setPadding(0, dp(12), dp(8), dp(12))
            background = selectableBackground()
            isClickable = true
            setOnClickListener { onClick() }
        }
        row.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (extra != null) row.addView(extra)
        val del = TextView(this).apply {
            this.text = "✕"
            textSize = 18f
            setTextColor(Color.parseColor("#C62828"))
            setPadding(dp(14), dp(10), dp(6), dp(10))
            contentDescription = getString(R.string.delete)
            background = selectableBackground()
            isClickable = true
            setOnClickListener { onDelete() }
        }
        row.addView(del)
        return row
    }

    // ---------- 추가/수정 ----------

    private fun showPresetDialog(existing: TimerPreset?) {
        val v = layoutInflater.inflate(R.layout.dialog_preset, null)
        val name = v.findViewById<EditText>(R.id.preset_name)
        val dur = v.findViewById<EditText>(R.id.preset_duration)
        if (existing != null) {
            name.setText(existing.name)
            dur.setText(TimeFmt.input(existing.durationSec))
        }
        val dlg = AlertDialog.Builder(this)
            .setTitle(if (existing == null) R.string.add_preset else R.string.edit_preset)
            .setView(v)
            .setPositiveButton(R.string.save, null)
            .setNegativeButton(R.string.cancel, null)
            .create()
        dlg.setOnShowListener {
            dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val sec = TimeFmt.parseDuration(dur.text.toString())
                if (sec == null) {
                    Toast.makeText(this, R.string.toast_bad_duration, Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                val n = name.text.toString().trim().ifEmpty { getString(R.string.default_timer_name) }
                if (existing == null) {
                    TimerStore.presets += TimerPreset(name = n, durationSec = sec)
                } else {
                    existing.name = n
                    existing.durationSec = sec
                }
                TimerStore.save(this)
                refreshLists()
                dlg.dismiss()
            }
        }
        dlg.show()
    }

    private fun showReminderDialog(existing: Reminder?) {
        val v = layoutInflater.inflate(R.layout.dialog_reminder, null)
        val tp = v.findViewById<TimePicker>(R.id.reminder_time)
        val name = v.findViewById<EditText>(R.id.reminder_name)
        tp.setIs24HourView(true)
        tp.hour = existing?.hour ?: 21
        tp.minute = existing?.minute ?: 0
        if (existing != null) name.setText(existing.name)
        AlertDialog.Builder(this)
            .setTitle(if (existing == null) R.string.add_reminder else R.string.edit_reminder)
            .setView(v)
            .setPositiveButton(R.string.save) { _, _ ->
                val n = name.text.toString().trim().ifEmpty { getString(R.string.default_reminder_name) }
                if (existing == null) {
                    TimerStore.reminders += Reminder(name = n, hour = tp.hour, minute = tp.minute)
                } else {
                    existing.name = n
                    existing.hour = tp.hour
                    existing.minute = tp.minute
                }
                TimerStore.reminders.sortBy { it.hour * 60 + it.minute }
                TimerStore.save(this)
                refreshLists()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun confirmDelete(name: String, action: () -> Unit) {
        AlertDialog.Builder(this)
            .setMessage(getString(R.string.delete_confirm_fmt, name))
            .setPositiveButton(R.string.delete) { _, _ -> action() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    // ---------- 도우미 ----------

    private fun nearestIndex(steps: IntArray, value: Int): Int =
        steps.indices.minByOrNull { abs(steps[it] - value) } ?: 0

    private fun simpleSeek(onChange: (Int) -> Unit) = object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) = onChange(p)
        override fun onStartTrackingTouch(sb: SeekBar) {}
        override fun onStopTrackingTouch(sb: SeekBar) {}
    }

    private fun selectableBackground(): Drawable? {
        val tv = TypedValue()
        theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
        return ContextCompat.getDrawable(this, tv.resourceId)
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
}
