package com.floatingclock.app

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings

/**
 * 지금 화면 앞에 떠 있는 앱을 알아내고, 시계를 띄울 게임을 고르는 데 쓰는 도구.
 * 앞에 떠 있는 앱은 '사용 정보 접근' 권한으로 UsageEvents 를 읽어서 판단한다.
 * (읽은 정보는 폰 안에서만 쓰고 어디에도 보내지 않는다.)
 */
object GameDetector {

    /** 아이모 자동 감지: 앱 이름에 '아이모'가 들어가거나 컴투스 아이모 패키지 */
    private const val IMO_LABEL = "아이모"
    private const val IMO_PACKAGE_PREFIX = "com.com2us.imo"

    data class AppEntry(val packageName: String, val label: String)

    fun looksLikeImo(app: AppEntry): Boolean =
        app.label.contains(IMO_LABEL) || app.packageName.startsWith(IMO_PACKAGE_PREFIX)

    /** '사용 정보 접근'이 허용되어 있는지 */
    fun hasUsageAccess(ctx: Context): Boolean {
        val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        }
        return if (mode == AppOpsManager.MODE_DEFAULT) {
            ctx.checkCallingOrSelfPermission("android.permission.PACKAGE_USAGE_STATS") ==
                PackageManager.PERMISSION_GRANTED
        } else {
            mode == AppOpsManager.MODE_ALLOWED
        }
    }

    /** '사용 정보 접근' 설정 화면 열기. 이 앱 항목으로 바로 가는 게 안 되는 폰은 전체 목록을 연다. */
    fun openUsageAccessSettings(ctx: Context) {
        val direct = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
        if (runCatching { ctx.startActivity(direct) }.isFailure) {
            runCatching { ctx.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
        }
    }

    /** 홈 화면에 아이콘이 있는 앱 목록 (이 앱 제외), 이름순 */
    fun launchableApps(ctx: Context): List<AppEntry> {
        val pm = ctx.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        val infos = pm.queryIntentActivities(intent, 0)
        return infos
            .map { AppEntry(it.activityInfo.packageName, it.loadLabel(pm).toString()) }
            .filter { it.packageName != ctx.packageName }
            .distinctBy { it.packageName }
            .sortedBy { it.label.lowercase() }
    }

    /** 설치된 앱 중 아이모 찾기 */
    fun findImo(ctx: Context): AppEntry? = launchableApps(ctx).firstOrNull(::looksLikeImo)

    /**
     * UsageEvents 를 조금씩 이어 읽으면서 마지막으로 화면 앞에 나온 앱을 기억한다.
     * 매번 직전 조회 시점보다 조금 앞부터 읽고, 그 구간에서 시간상 마지막 '앞으로 나옴' 이벤트를 쓴다.
     */
    class ForegroundTracker(ctx: Context) {
        private val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        private var lastQueryEnd = 0L
        private var current: String? = null

        fun update(): String? {
            val now = System.currentTimeMillis()
            // 처음에는 넉넉히 과거부터 읽어서, 시계를 켜기 전에 이미 열려 있던 게임도 알아낸다.
            val from = if (lastQueryEnd == 0L) now - FIRST_LOOKBACK_MS else lastQueryEnd - OVERLAP_MS
            val events = runCatching { usm.queryEvents(from, now) }.getOrNull() ?: return current
            val e = UsageEvents.Event()
            while (events.hasNextEvent()) {
                events.getNextEvent(e)
                if (e.eventType == ACTIVITY_RESUMED) current = e.packageName
            }
            lastQueryEnd = now
            return current
        }

        private companion object {
            /** UsageEvents.Event.ACTIVITY_RESUMED (= 예전 MOVE_TO_FOREGROUND) */
            const val ACTIVITY_RESUMED = 1
            const val FIRST_LOOKBACK_MS = 6 * 60 * 60 * 1000L
            const val OVERLAP_MS = 3000L
        }
    }
}
