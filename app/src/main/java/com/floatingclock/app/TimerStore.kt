package com.floatingclock.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.UUID

/*
 * 직접 누르는 타이머와 정해진 시각 알림.
 * 현재 시각만 보고 동작하고, 게임은 읽지 않는다. (CLAUDE.md 규칙)
 */

/** 미리 만들어 둔 타이머 (예: 보스 30분) */
class TimerPreset(
    val id: String = UUID.randomUUID().toString(),
    var name: String = "",
    var durationSec: Int = 1800,
)

/** 매일 정해진 시각 알림 (예: 21:00 월드보스) */
class Reminder(
    val id: String = UUID.randomUUID().toString(),
    var name: String = "",
    var hour: Int = 21,
    var minute: Int = 0,
    var enabled: Boolean = true,
)

/** 지금 돌아가는 타이머. 끝나는 시각(벽시계 기준)을 저장해서 앱이 다시 켜져도 이어진다. */
class RunningTimer(
    val id: String = UUID.randomUUID().toString(),
    val presetId: String,
    val name: String,
    val endAt: Long,
    var preAlerted: Boolean = false,
    var alerted: Boolean = false,
)

/** 타이머 저장소. 화면과 서비스가 모두 메인 스레드에서 같은 목록을 쓴다. */
object TimerStore {
    private const val PREFS = "timers"
    private var loaded = false

    val presets = ArrayList<TimerPreset>()
    val reminders = ArrayList<Reminder>()
    val running = ArrayList<RunningTimer>()

    fun ensureLoaded(ctx: Context) {
        if (loaded) return
        loaded = true
        val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        runCatching {
            val a = JSONArray(sp.getString("presets", "[]"))
            for (i in 0 until a.length()) {
                val o = a.getJSONObject(i)
                presets += TimerPreset(o.getString("id"), o.optString("name"), o.optInt("sec", 1800))
            }
        }
        runCatching {
            val a = JSONArray(sp.getString("reminders", "[]"))
            for (i in 0 until a.length()) {
                val o = a.getJSONObject(i)
                reminders += Reminder(
                    o.getString("id"), o.optString("name"),
                    o.optInt("h", 21), o.optInt("m", 0), o.optBoolean("on", true),
                )
            }
        }
        runCatching {
            val a = JSONArray(sp.getString("running", "[]"))
            for (i in 0 until a.length()) {
                val o = a.getJSONObject(i)
                running += RunningTimer(
                    o.getString("id"), o.optString("preset"), o.optString("name"), o.optLong("end"),
                    o.optBoolean("pre"), o.optBoolean("done"),
                )
            }
        }
    }

    fun save(ctx: Context) {
        val p = JSONArray()
        presets.forEach { p.put(JSONObject().put("id", it.id).put("name", it.name).put("sec", it.durationSec)) }
        val r = JSONArray()
        reminders.forEach {
            r.put(JSONObject().put("id", it.id).put("name", it.name).put("h", it.hour).put("m", it.minute).put("on", it.enabled))
        }
        val run = JSONArray()
        running.forEach {
            run.put(
                JSONObject().put("id", it.id).put("preset", it.presetId).put("name", it.name)
                    .put("end", it.endAt).put("pre", it.preAlerted).put("done", it.alerted),
            )
        }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("presets", p.toString())
            .putString("reminders", r.toString())
            .putString("running", run.toString())
            .apply()
    }

    /** 타이머 시작. 같은 타이머가 이미 돌고 있으면 처음부터 다시. */
    fun startTimer(ctx: Context, preset: TimerPreset) {
        running.removeAll { it.presetId == preset.id }
        running += RunningTimer(
            presetId = preset.id,
            name = preset.name,
            endAt = System.currentTimeMillis() + preset.durationSec * 1000L,
        )
        save(ctx)
    }

    fun cancelTimer(ctx: Context, id: String) {
        running.removeAll { it.id == id }
        save(ctx)
    }
}

/** 시간 글자 만들기와 입력 읽기 */
object TimeFmt {
    /** 남은 시간: 1시간 미만은 "04:32", 이상은 "1:04:32" */
    fun remaining(totalSec: Long): String {
        val s = if (totalSec < 0) 0 else totalSec
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return if (h > 0) {
            String.format(Locale.US, "%d:%02d:%02d", h, m, sec)
        } else {
            String.format(Locale.US, "%02d:%02d", m, sec)
        }
    }

    /** "30" 은 30분, "5:30" 은 5분 30초, "1:00:00" 은 1시간. 잘못된 입력이면 null */
    fun parseDuration(text: String): Int? {
        val parts = text.trim().split(":")
        if (parts.isEmpty() || parts.size > 3) return null
        val nums = parts.map { part ->
            val t = part.trim()
            if (t.isEmpty() || t.length > 4 || !t.all { it.isDigit() }) return null
            t.toInt()
        }
        val sec = when (nums.size) {
            1 -> nums[0] * 60
            2 -> nums[0] * 60 + nums[1]
            else -> nums[0] * 3600 + nums[1] * 60 + nums[2]
        }
        return if (sec in 1..(24 * 3600)) sec else null
    }

    /** 입력칸에 다시 채울 글자: 30분은 "30", 5분 30초는 "5:30", 1시간 이상은 "1:00:00" */
    fun input(sec: Int): String {
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        return when {
            h > 0 -> String.format(Locale.US, "%d:%02d:%02d", h, m, s)
            s > 0 -> String.format(Locale.US, "%d:%02d", m, s)
            else -> m.toString()
        }
    }

    /** 사람이 읽는 길이: "1시간 30분", "5분 30초", "10초" */
    fun label(ctx: Context, sec: Int): String {
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        val parts = ArrayList<String>()
        if (h > 0) parts += ctx.getString(R.string.dur_h_fmt, h)
        if (m > 0) parts += ctx.getString(R.string.dur_m_fmt, m)
        if (s > 0 || parts.isEmpty()) parts += ctx.getString(R.string.dur_s_fmt, s)
        return parts.joinToString(" ")
    }
}
