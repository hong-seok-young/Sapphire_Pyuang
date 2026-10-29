package com.floatingclock.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * 화면 인식 규칙: 화면의 한 영역이 기준 모습과 같아지면(보이면) 또는 달라지면(바뀌면) 알린다.
 * 영역 좌표는 화면 대비 비율(0~1)이라 해상도가 달라도 같은 자리를 가리킨다.
 */
class Rule(
    val id: String = UUID.randomUUID().toString(),
    var message: String = "",
    var x: Float = 0f,
    var y: Float = 0f,
    var w: Float = 0f,
    var h: Float = 0f,
    var mode: Int = MODE_APPEAR,
    /** 일치 기준 % (50~99) */
    var threshold: Int = 85,
    var arrow: Boolean = true,
    var vibrate: Boolean = true,
    var sound: Boolean = false,
    var enabled: Boolean = true,
    /** 기준 모습: 영역을 칸으로 나눈 칸별 평균 색 (RegionSampler.sample 결과) */
    var ref: IntArray = IntArray(0),
) {
    companion object {
        const val MODE_APPEAR = 0
        const val MODE_CHANGE = 1
    }
}

/** 규칙 저장소 (폰 안의 SharedPreferences) */
object RuleStore {
    private const val PREFS = "screen_rules"
    private const val KEY = "rules"

    /** 화면 인식 서비스가 마지막으로 잰 규칙별 일치도(%). 설정 화면에 보여 주기용. */
    val lastScores = ConcurrentHashMap<String, Int>()

    /** 📷 버튼으로 찍은 마지막 게임 화면 (폰 안에만 저장) */
    fun snapshotFile(ctx: Context) = File(ctx.filesDir, "snapshot.png")

    fun load(ctx: Context): MutableList<Rule> {
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
            ?: return mutableListOf()
        return runCatching {
            val arr = JSONArray(raw)
            MutableList(arr.length()) { fromJson(arr.getJSONObject(it)) }
        }.getOrElse { mutableListOf() }
    }

    fun find(ctx: Context, id: String): Rule? = load(ctx).firstOrNull { it.id == id }

    fun upsert(ctx: Context, rule: Rule) {
        val list = load(ctx)
        val i = list.indexOfFirst { it.id == rule.id }
        if (i >= 0) list[i] = rule else list.add(rule)
        save(ctx, list)
    }

    fun delete(ctx: Context, id: String) {
        save(ctx, load(ctx).filterNot { it.id == id })
        lastScores.remove(id)
    }

    private fun save(ctx: Context, rules: List<Rule>) {
        val arr = JSONArray()
        rules.forEach { arr.put(toJson(it)) }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
    }

    private fun toJson(r: Rule) = JSONObject().apply {
        put("id", r.id)
        put("message", r.message)
        put("x", r.x.toDouble())
        put("y", r.y.toDouble())
        put("w", r.w.toDouble())
        put("h", r.h.toDouble())
        put("mode", r.mode)
        put("threshold", r.threshold)
        put("arrow", r.arrow)
        put("vibrate", r.vibrate)
        put("sound", r.sound)
        put("enabled", r.enabled)
        put("ref", JSONArray().apply { r.ref.forEach { put(it) } })
    }

    private fun fromJson(o: JSONObject): Rule {
        val refArr = o.optJSONArray("ref")
        return Rule(
            id = o.getString("id"),
            message = o.optString("message"),
            x = o.optDouble("x", 0.0).toFloat(),
            y = o.optDouble("y", 0.0).toFloat(),
            w = o.optDouble("w", 0.0).toFloat(),
            h = o.optDouble("h", 0.0).toFloat(),
            mode = o.optInt("mode", Rule.MODE_APPEAR),
            threshold = o.optInt("threshold", 85),
            arrow = o.optBoolean("arrow", true),
            vibrate = o.optBoolean("vibrate", true),
            sound = o.optBoolean("sound", false),
            enabled = o.optBoolean("enabled", true),
            ref = if (refArr == null) IntArray(0) else IntArray(refArr.length()) { refArr.getInt(it) },
        )
    }
}
