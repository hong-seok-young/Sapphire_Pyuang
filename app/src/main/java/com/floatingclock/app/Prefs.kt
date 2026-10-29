package com.floatingclock.app

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color

/** 시계 모양/위치 설정 저장소 */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("floating_clock", Context.MODE_PRIVATE)

    /** 글자 크기 (sp) */
    var textSizeSp: Int
        get() = sp.getInt("text_size", 13)
        set(v) = sp.edit().putInt("text_size", v).apply()

    /** 글자 색 */
    var textColor: Int
        get() = sp.getInt("text_color", Color.WHITE)
        set(v) = sp.edit().putInt("text_color", v).apply()

    /** 배경 불투명도 0~255 (0이면 배경 없이 글자만) */
    var bgAlpha: Int
        get() = sp.getInt("bg_alpha", 0)
        set(v) = sp.edit().putInt("bg_alpha", v).apply()

    /** 24시간제 여부 */
    var use24h: Boolean
        get() = sp.getBoolean("use_24h", true)
        set(v) = sp.edit().putBoolean("use_24h", v).apply()

    /** 날짜(월/일 요일)도 함께 표시 */
    var showDate: Boolean
        get() = sp.getBoolean("show_date", false)
        set(v) = sp.edit().putBoolean("show_date", v).apply()

    /** 드래그로 이동 잠금 (게임 중 실수로 움직이는 것 방지) */
    var lockPosition: Boolean
        get() = sp.getBoolean("lock_position", false)
        set(v) = sp.edit().putBoolean("lock_position", v).apply()

    /** 마지막 위치 (px). x는 화면 가로 중앙 기준 오프셋, y는 상단 기준.
     *  y가 POS_AUTO(-1)면 상태바 바로 아래에 둔다 (상태바와 겹치면 드래그가 안 됨). */
    var posX: Int
        get() = sp.getInt("pos_x", 0)
        set(v) = sp.edit().putInt("pos_x", v).apply()
    var posY: Int
        get() = sp.getInt("pos_y", POS_AUTO)
        set(v) = sp.edit().putInt("pos_y", v).apply()

    companion object {
        const val POS_AUTO = -1
    }

    /** 마지막으로 시계가 켜져 있었는지 */
    var running: Boolean
        get() = sp.getBoolean("running", false)
        set(v) = sp.edit().putBoolean("running", v).apply()

    /** 고른 게임이 화면 앞에 있을 때만 시계 표시 */
    var gameOnly: Boolean
        get() = sp.getBoolean("game_only", true)
        set(v) = sp.edit().putBoolean("game_only", v).apply()

    /** 시계를 띄울 게임의 패키지 이름과 표시 이름 (null 이면 아직 안 고름) */
    var targetPackage: String?
        get() = sp.getString("target_pkg", null)
        set(v) = sp.edit().putString("target_pkg", v).apply()
    var targetLabel: String?
        get() = sp.getString("target_label", null)
        set(v) = sp.edit().putString("target_label", v).apply()

    /** 없앤 기능(v1.5 화면 인식)이 남긴 설정값 정리 */
    fun removeLegacyKeys() {
        sp.edit().remove("show_capture_btn").remove("cap_btn_x").remove("cap_btn_y").apply()
    }
}
