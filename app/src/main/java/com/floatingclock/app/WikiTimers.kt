package com.floatingclock.app

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar
import java.util.Locale
import kotlin.concurrent.thread

/**
 * 보스·네임드 젠 타이머에 쓰는 재부활 시간.
 *
 * 자료는 길드 위키 웹앱(아이모 원클릭 드랍표, Made by iOS)이 data 폴더에 올린 JSON 을 그대로 받아 쓴다.
 * 정보는 웹앱 하나로만 관리한다는 CLAUDE.md 규칙 때문에 앱 안에 자료를 따로 넣지 않는다.
 * 원본 자료는 공개 저장소와 APK에 넣지 않고, 받은 자료는 이 폰 안에만 저장한다.
 * 사용자가 직접 눌러 시작하는 타이머에만 쓰고, 게임은 읽지 않는다.
 *
 * 위키의 build_data.py 가 만드는 JSON 모양(regions 의 places, places 의 monsters,
 * monsters 의 respawn)을 바꾸면 여기도 같이 고친다.
 */
object WikiTimers {

    const val SITE = "https://sapphire-guild.pages.dev/"
    private val FILES = listOf("regions", "places", "monsters", "meta")
    private const val PREFS = "wiki_timers"

    /** 이보다 빨리 다시 나오는 몬스터는 일반 몬스터라 넣지 않는다 (자료에 5분과 10분 사이 값이 없다) */
    private const val MIN_SEC = 10 * 60

    /** 자동으로 새 자료가 있는지 확인하는 간격 */
    private const val CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L

    class Mob(
        val key: String,
        val name: String,
        val level: Int?,
        /** 다시 나오기까지 걸리는 시간(초). 매일 정해진 시각에 나오는 몬스터는 null */
        val sec: Int?,
        /** 매일 나오는 시각(0시부터 몇 분). 시간 간격으로 나오는 몬스터는 null */
        val times: List<Int>?,
        /** 위키에 적힌 그대로의 재부활 글. 값이 여러 개거나 설명이 붙어 있을 때만 */
        val note: String?,
    ) {
        /** 목록에 보일 길이: "58분 20초" 또는 "11:00·23:00" */
        fun label(ctx: Context): String =
            sec?.let { TimeFmt.label(ctx, it) }
                ?: times.orEmpty().joinToString("·") { String.format(Locale.US, "%02d:%02d", it / 60, it % 60) }

        /** 지금 잡았을 때 다시 나오는 시각(벽시계 ms). 정해진 시각 몬스터는 다음 등장 시각 */
        fun nextAt(now: Long): Long? {
            sec?.let { return now + it * 1000L }
            val ts = times?.takeIf { it.isNotEmpty() } ?: return null
            val cal = Calendar.getInstance().apply { timeInMillis = now }
            val nowMin = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
            val next = ts.firstOrNull { it > nowMin }
            cal.set(Calendar.HOUR_OF_DAY, 0)
            cal.set(Calendar.MINUTE, 0)
            cal.set(Calendar.SECOND, 0)
            cal.set(Calendar.MILLISECOND, 0)
            if (next == null) cal.add(Calendar.DAY_OF_MONTH, 1)
            cal.add(Calendar.MINUTE, next ?: ts.first())
            return cal.timeInMillis
        }
    }

    class Place(val id: String, val name: String, val region: String, val mobs: List<Mob>)

    class Data(val places: List<Place>, val sourceTitle: String, val author: String, val patch: String) {
        val mobCount: Int get() = places.sumOf { it.mobs.size }
    }

    /** 재부활 글을 읽은 결과. sec 와 times 중 하나만 있다 */
    class Respawn(val sec: Int?, val times: List<Int>?, val count: Int)

    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var data: Data? = null

    @Volatile
    private var loadedFromDisk = false
    private var refreshing = false

    /** 받는 중에 들어온 요청. 받기가 끝나면 같이 알려 준다 */
    private val waiting = ArrayList<(Boolean) -> Unit>()

    /**
     * 위키가 길드원 로그인을 요구해서 자료를 못 받았는지.
     * 로그인은 앱 첫 화면(위키)에서 하고, 그 쿠키를 같이 보내서 자료를 받는다.
     */
    @Volatile
    var needsLogin = false
        private set

    private class LoginNeeded : Exception()

    /** 받아 둔 자료. 한 번도 못 받았으면 null. 메인 스레드에서 부른다. */
    fun get(ctx: Context): Data? {
        if (!loadedFromDisk) {
            loadedFromDisk = true
            data = runCatching { build(readFiles(dir(ctx), emptyMap())) }.getOrNull()
        }
        return data
    }

    /**
     * 위키에 새 자료가 있으면 받는다. force 가 아니면 몇 시간에 한 번만 확인한다.
     * 바뀐 파일만 받는다(ETag). done(성공 여부)은 메인 스레드에서 부른다.
     */
    fun refresh(ctx: Context, force: Boolean, done: ((Boolean) -> Unit)? = null) {
        val app = ctx.applicationContext
        val sp = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val have = get(app) != null
        if (refreshing) {
            done?.let { waiting += it }
            return
        }
        if (!force && have && now - sp.getLong("checked", 0L) < CHECK_INTERVAL_MS) {
            done?.invoke(true)
            return
        }
        refreshing = true
        done?.let { waiting += it }
        // 위키 로그인 쿠키 (앱 첫 화면이나 게임 위 창에서 로그인하면 생긴다)
        val cookie = runCatching { CookieManager.getInstance().getCookie(SITE) }.getOrNull()
        thread(name = "wiki-timers") {
            val result = runCatching { download(app, sp, cookie) }
            main.post {
                refreshing = false
                needsLogin = result.exceptionOrNull() is LoginNeeded
                result.getOrNull()?.let { fresh ->
                    if (fresh !== NOT_CHANGED) {
                        data = fresh
                        loadedFromDisk = true
                    }
                    sp.edit().putLong("checked", now).apply()
                }
                val ok = result.isSuccess && data != null
                val callbacks = waiting.toList()
                waiting.clear()
                callbacks.forEach { it(ok) }
            }
        }
    }

    /** 바뀐 것이 없을 때 download 가 돌려주는 표시 */
    private val NOT_CHANGED = Data(emptyList(), "", "", "")

    /**
     * 네 파일을 받아서, 바뀐 것이 있으면 새 자료를 만들어 저장하고 돌려준다.
     * 받은 글로 자료를 만들 수 없으면 저장하지 않고 예외를 낸다.
     */
    private fun download(ctx: Context, sp: SharedPreferences, cookie: String?): Data {
        val dir = dir(ctx)
        val fresh = HashMap<String, Pair<String, String?>>()
        for (name in FILES) {
            val file = File(dir, "$name.json")
            val etag = if (file.exists()) sp.getString("etag_$name", null) else null
            val conn = (URL("${SITE}data/$name.json").openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 15000
                instanceFollowRedirects = false // 로그인 화면으로 돌려보내면 그대로 알아챈다
                setRequestProperty("User-Agent", "Sapphire-Android")
                if (!cookie.isNullOrEmpty()) setRequestProperty("Cookie", cookie)
                if (etag != null) setRequestProperty("If-None-Match", etag)
            }
            try {
                when (val code = conn.responseCode) {
                    HttpURLConnection.HTTP_NOT_MODIFIED -> Unit
                    HttpURLConnection.HTTP_OK ->
                        fresh[name] = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() } to
                            conn.getHeaderField("ETag")
                    HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN,
                    HttpURLConnection.HTTP_MOVED_TEMP, HttpURLConnection.HTTP_SEE_OTHER -> throw LoginNeeded()
                    else -> error("HTTP $code")
                }
            } finally {
                conn.disconnect()
            }
        }
        if (fresh.isEmpty() && data != null) return NOT_CHANGED
        val texts = fresh.mapValues { it.value.first }
        val built = build(readFiles(dir, texts)) ?: error("wiki data incomplete")
        if (built.places.isEmpty()) error("wiki data has no respawn times")
        dir.mkdirs()
        val ed = sp.edit()
        for ((name, v) in fresh) {
            val tmp = File(dir, "$name.json.tmp")
            tmp.writeText(v.first, Charsets.UTF_8)
            val target = File(dir, "$name.json")
            if (!tmp.renameTo(target)) {
                target.delete()
                if (!tmp.renameTo(target)) error("cannot save $name.json")
            }
            if (v.second != null) ed.putString("etag_$name", v.second) else ed.remove("etag_$name")
        }
        ed.apply()
        return built
    }

    private fun dir(ctx: Context) = File(ctx.filesDir, "wiki")

    /** 저장된 파일에 방금 받은 글을 덮어서 네 파일을 모은다. 하나라도 없으면 null */
    private fun readFiles(dir: File, override: Map<String, String>): Map<String, String>? {
        val out = HashMap<String, String>()
        for (name in FILES) {
            out[name] = override[name] ?: File(dir, "$name.json").takeIf { it.exists() }?.readText(Charsets.UTF_8)
                ?: return null
        }
        return out
    }

    /** 위키 JSON 에서 사냥터별 보스·네임드 목록을 만든다. 순서는 위키의 지역, 사냥터, 표 순서 그대로 */
    internal fun build(texts: Map<String, String>?): Data? {
        texts ?: return null
        val regions = JSONArray(texts.getValue("regions"))
        val places = JSONObject(texts.getValue("places"))
        val monsters = JSONObject(texts.getValue("monsters"))
        val source = runCatching { JSONObject(texts.getValue("meta")).optJSONObject("source") }.getOrNull()
        val out = ArrayList<Place>()
        for (i in 0 until regions.length()) {
            val r = regions.optJSONObject(i) ?: continue
            val region = r.optString("name")
            if (region.contains("삭제")) continue // 게임에서 없어진 곳
            val ids = r.optJSONArray("places") ?: continue
            for (j in 0 until ids.length()) {
                val pid = ids.optString(j)
                val p = places.optJSONObject(pid) ?: continue
                val keys = p.optJSONArray("monsters") ?: continue
                val mobs = ArrayList<Mob>()
                for (k in 0 until keys.length()) {
                    val key = keys.optString(k)
                    val m = monsters.optJSONObject(key) ?: continue
                    parseMob(key, m)?.let { mobs += it }
                }
                if (mobs.isNotEmpty()) out += Place(pid, p.optString("name", pid), region, mobs)
            }
        }
        return Data(
            out,
            source?.optString("제목").orEmpty().ifEmpty { "아이모 원클릭 드랍표" },
            source?.optString("작성자").orEmpty().ifEmpty { "iOS" },
            source?.optString("패치").orEmpty(),
        )
    }

    private fun parseMob(key: String, m: JSONObject): Mob? {
        val text = if (m.isNull("respawn")) "" else m.optString("respawn").trim()
        if (text.isEmpty()) return null
        val r = parseRespawn(text) ?: return null
        if (r.sec != null && r.sec < MIN_SEC) return null
        val simple = r.sec != null && r.count == 1 && '(' !in text && '?' !in text
        return Mob(
            key = key,
            name = m.optString("name", key),
            level = if (m.isNull("level")) null else m.optInt("level"),
            sec = r.sec,
            times = r.times,
            note = if (simple) null else text,
        )
    }

    private val DURATION = Regex("""(?:(\d+)\s*시간\s*)?(?:(\d+)\s*분\s*)?(?:(\d+)\s*초)?""")
    private val CLOCK = Regex("""(\d{1,2}):(\d{2})""")
    private val PAREN = Regex("""\([^)]*\)""")

    /**
     * 위키의 재부활 글을 읽는다.
     * - "58분 20초", "72시간" 같은 시간 간격. 값이 여러 개면(잡을수록 줄어드는 보스) 마지막 값,
     *   즉 줄어든 뒤 고정되는 값을 쓴다. 괄호 안 설명과 "오차" 뒤는 계산에서 뺀다.
     * - "11:00, 23:00" 처럼 매일 정해진 시각.
     * - 그 밖에 "제단 활성화", "재점령 시", "-" 처럼 시간이 없는 글은 null.
     */
    fun parseRespawn(text: String): Respawn? {
        var t = PAREN.replace(text, " ")
        val cut = t.indexOf("오차")
        if (cut >= 0) t = t.substring(0, cut)
        val durations = DURATION.findAll(t).mapNotNull { m ->
            val h = m.groups[1]?.value?.toIntOrNull()
            val mi = m.groups[2]?.value?.toIntOrNull()
            val s = m.groups[3]?.value?.toIntOrNull()
            if (h == null && mi == null && s == null) null else (h ?: 0) * 3600 + (mi ?: 0) * 60 + (s ?: 0)
        }.filter { it > 0 }.toList()
        if (durations.isNotEmpty()) return Respawn(durations.last(), null, durations.size)
        val times = CLOCK.findAll(t).mapNotNull { m ->
            val hh = m.groupValues[1].toInt()
            val mm = m.groupValues[2].toInt()
            if (hh < 24 && mm < 60) hh * 60 + mm else null
        }.distinct().sorted().toList()
        return if (times.isNotEmpty()) Respawn(null, times, 1) else null
    }
}
