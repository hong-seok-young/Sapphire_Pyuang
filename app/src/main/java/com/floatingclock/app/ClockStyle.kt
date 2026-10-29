package com.floatingclock.app

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import java.text.SimpleDateFormat
import java.util.Locale

/** 오버레이 시계와 설정 화면 미리보기가 똑같이 보이도록 스타일을 한 곳에서 적용한다. */
object ClockStyle {

    /** 고를 수 있는 글자 색 (6개씩 두 줄로 표시) */
    val COLORS = intArrayOf(
        Color.WHITE,
        Color.parseColor("#BDBDBD"), // 회색
        Color.BLACK,
        Color.parseColor("#FFEB3B"), // 노랑
        Color.parseColor("#FF9800"), // 주황
        Color.parseColor("#FF5252"), // 빨강
        Color.parseColor("#FF80AB"), // 분홍
        Color.parseColor("#B388FF"), // 보라
        Color.parseColor("#448AFF"), // 파랑
        Color.parseColor("#40C4FF"), // 하늘
        Color.parseColor("#69F0AE"), // 초록
        Color.parseColor("#C6FF00"), // 연두
    )

    const val MIN_SIZE = 8
    const val MAX_SIZE = 40

    // 일반 글꼴 + 고정폭 숫자(tnum): 초가 바뀌어도 폭이 흔들리지 않으면서
    // 고정폭(monospace) 글꼴보다 숫자와 콜론 사이가 훨씬 촘촘하다.
    private val typeface: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    fun formatter(prefs: Prefs): SimpleDateFormat {
        val pattern = buildString {
            if (prefs.showDate) append("MM/dd(E) ")
            append(if (prefs.use24h) "HH:mm:ss" else "a hh:mm:ss")
        }
        return SimpleDateFormat(pattern, Locale.getDefault())
    }

    fun apply(tv: TextView, prefs: Prefs) {
        val dm = tv.resources.displayMetrics
        fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, dm)

        tv.typeface = typeface
        tv.fontFeatureSettings = "tnum"
        tv.letterSpacing = 0f
        tv.includeFontPadding = false
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, prefs.textSizeSp.toFloat())
        tv.setTextColor(prefs.textColor)

        // 어두운 글자는 밝은 그림자, 밝은 글자는 어두운 그림자 -> 어떤 화면 위에서도 읽힘
        val darkText = ColorUtils.calculateLuminance(prefs.textColor) < 0.35
        tv.setShadowLayer(dp(2f), 0f, dp(0.5f), if (darkText) Color.WHITE else Color.BLACK)

        if (prefs.bgAlpha <= 0) {
            // 배경 없음: 좌우 여백을 거의 0으로
            val h = dp(1f).toInt()
            tv.setPadding(h, 0, h, 0)
            tv.background = null
        } else {
            val h = dp(4f).toInt()
            val v = dp(1f).toInt()
            tv.setPadding(h, v, h, v)
            tv.background = GradientDrawable().apply {
                cornerRadius = dp(4f)
                val base = if (darkText) 255 else 0
                setColor(Color.argb(prefs.bgAlpha, base, base, base))
            }
        }
    }
}
