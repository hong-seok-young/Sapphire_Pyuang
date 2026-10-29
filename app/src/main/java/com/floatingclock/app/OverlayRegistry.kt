package com.floatingclock.app

import android.content.Context
import android.graphics.Point
import android.graphics.RectF
import android.hardware.display.DisplayManager
import android.view.Display
import java.util.concurrent.ConcurrentHashMap

/**
 * 이 앱이 화면 위에 그리는 것들(시계, 📷 버튼, 화살표/알림)의 위치.
 * 화면 인식이 자기가 그린 그림을 게임 화면으로 착각하지 않도록 이 부분은 비교에서 뺀다.
 * 좌표는 화면 대비 비율(0~1).
 */
object OverlayRegistry {
    private val rects = ConcurrentHashMap<String, List<RectF>>()

    fun set(key: String, list: List<RectF>) {
        if (list.isEmpty()) rects.remove(key) else rects[key] = list
    }

    fun clear(key: String) {
        rects.remove(key)
    }

    fun all(): List<RectF> = rects.values.flatten()
}

/** 이 앱의 화면(설정, 규칙 편집)이 지금 떠 있는지. 떠 있으면 화면 인식은 쉰다. */
object UiState {
    @Volatile
    var resumed = 0
}

object ScreenUtil {
    /** 지금 회전 방향 기준 실제 화면 크기 (상태바, 내비게이션 바 포함) */
    @Suppress("DEPRECATION")
    fun realSize(ctx: Context): Point {
        val display = ctx.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        return Point().also { display.getRealSize(it) }
    }

    /** 화면 픽셀 사각형 -> 비율 사각형 (margin 픽셀만큼 넓혀서) */
    fun fraction(size: Point, l: Float, t: Float, r: Float, b: Float, margin: Float = 0f): RectF =
        RectF(
            (l - margin) / size.x, (t - margin) / size.y,
            (r + margin) / size.x, (b + margin) / size.y,
        )
}
