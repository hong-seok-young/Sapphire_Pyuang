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

    /** 시계를 누르면 타이머 목록 열기 */
    var timerTapOpens: Boolean
        get() = sp.getBoolean("timer_tap_opens", true)
        set(v) = sp.edit().putBoolean("timer_tap_opens", v).apply()

    /** 타이머/시각 알림 때 진동, 소리 */
    var timerVibrate: Boolean
        get() = sp.getBoolean("timer_vibrate", true)
        set(v) = sp.edit().putBoolean("timer_vibrate", v).apply()
    var timerSound: Boolean
        get() = sp.getBoolean("timer_sound", false)
        set(v) = sp.edit().putBoolean("timer_sound", v).apply()

    /** 타이머가 끝나기 몇 초 전에 미리 알릴지 (0 = 끄기) */
    var timerPreAlertSec: Int
        get() = sp.getInt("timer_pre_alert_sec", 60)
        set(v) = sp.edit().putInt("timer_pre_alert_sec", v).apply()

    /** 정해진 시각 알림: 몇 분 전부터 남은 시간을 보여 줄지 (0 = 안 보여 줌) */
    var reminderLeadMin: Int
        get() = sp.getInt("reminder_lead_min", 5)
        set(v) = sp.edit().putInt("reminder_lead_min", v).apply()

    /** 시계를 누르면 위키의 보스·네임드 젠 타이머도 보여 줄지 */
    var wikiInPanel: Boolean
        get() = sp.getBoolean("wiki_in_panel", true)
        set(v) = sp.edit().putBoolean("wiki_in_panel", v).apply()

    /** 목록에서 뺀 사냥터(위키 사냥터 id). 위키에 새로 생긴 사냥터는 기본으로 보인다 */
    var wikiHiddenPlaces: Set<String>
        get() = sp.getStringSet("wiki_hidden_places", null)?.toSet() ?: emptySet()
        set(v) = sp.edit().putStringSet("wiki_hidden_places", HashSet(v)).apply()

    /** 목록에서 마지막으로 펼친 사냥터. 다음에 목록을 열 때 바로 펼쳐 준다 */
    var wikiOpenPlace: String?
        get() = sp.getString("wiki_open_place", null)
        set(v) = sp.edit().putString("wiki_open_place", v).apply()

    /** 앱이 스스로 업데이트하느라 닫힐 때 새 버전에서 첫 화면을 다시 열지 (StartupReceiver).
     *  설치가 시작되면 앱이 바로 닫히므로 바로 저장한다(commit) */
    var reopenAfterUpdate: Boolean
        get() = sp.getBoolean("reopen_after_update", false)
        set(v) {
            sp.edit().putBoolean("reopen_after_update", v).commit()
        }

    /** 확인 없이 설치하다 안 된 버전. 그 버전은 다음부터 업데이트 창으로 받는다 */
    var autoUpdateFailed: String?
        get() = sp.getString("auto_update_failed", null)
        set(v) = sp.edit().putString("auto_update_failed", v).apply()

    /** 없앤 기능(v1.5 화면 인식)이 남긴 설정값 정리 */
    fun removeLegacyKeys() {
        sp.edit().remove("show_capture_btn").remove("cap_btn_x").remove("cap_btn_y").apply()
    }
}
