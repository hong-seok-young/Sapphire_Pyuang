@file:Suppress("DEPRECATION") // ProgressDialog: 다운로드 진행을 간단히 보여 주는 데만 쓴다

package com.floatingclock.app

import android.app.Activity
import android.app.AlertDialog
import android.app.ProgressDialog
import android.provider.Settings
import android.widget.Toast
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import java.io.File

/**
 * 새 버전 확인과 업데이트. 첫 화면(위키)과 시계 설정 화면이 같이 쓴다.
 * 앱을 연 뒤 한 번만 저절로 확인하고, 시계 설정의 '업데이트 확인' 버튼으로 다시 확인할 수 있다.
 * 안드로이드 12 이상에서 '이 출처 허용'을 켠 폰은 묻지 않고 받아서 설치하고(앱이 잠깐 닫혔다가 다시 열림),
 * 그 밖의 폰은 업데이트 창을 띄운다.
 */
object UpdateUi {

    private var checkedThisRun = false

    /** 받아 두었지만 앱이 뒤로 가 있어서 아직 설치하지 않은 새 버전. 다음에 앱 화면이 보일 때 설치한다 */
    private var pending: Pair<File, String>? = null

    /** 마지막으로 확인한 결과 글. 시계 설정 화면에 보여 준다 */
    var lastState: String? = null
        private set

    /** 앱을 연 뒤 처음 한 번만 조용히 확인한다. 새 버전이 있으면 받아서 설치하거나 업데이트 창을 띄운다 */
    fun checkOnce(activity: Activity, onState: ((String) -> Unit)? = null) {
        pending?.let { (apk, version) ->
            pending = null
            if (apk.exists()) installNow(activity, apk, version)
        }
        if (checkedThisRun) {
            lastState?.let { onState?.invoke(it) }
            return
        }
        checkedThisRun = true
        check(activity, silent = true, onState = onState)
    }

    /** 새 버전 확인. silent 가 아니면 최신일 때도 알려 준다. 콜백은 메인 스레드에서 부른다 */
    fun check(
        activity: Activity,
        silent: Boolean,
        onState: ((String) -> Unit)? = null,
        onDone: (() -> Unit)? = null,
    ) {
        onState?.invoke(activity.getString(R.string.update_checking))
        UpdateChecker.fetchLatest { rel ->
            if (activity.isFinishing || activity.isDestroyed) {
                checkedThisRun = false // 이 화면이 닫혔으니 다음에 여는 화면에서 다시 확인
                return@fetchLatest
            }
            val newer = rel != null && UpdateChecker.isNewer(rel.version, BuildConfig.VERSION_NAME)
            val state = when {
                rel == null -> activity.getString(R.string.update_check_failed)
                newer -> activity.getString(R.string.update_available, rel.version)
                else -> activity.getString(R.string.update_latest)
            }
            lastState = state
            onState?.invoke(state)
            if (newer) {
                // 앱을 열 때 확인한 것이면 묻지 않고 설치한다. 그렇게 하다 안 된 버전은 업데이트 창으로
                val auto = silent && UpdateInstaller.canInstallSilently(activity) &&
                    Prefs(activity).autoUpdateFailed != rel!!.version
                if (auto) autoUpdate(activity, rel!!) else showDialog(activity, rel!!)
            } else if (rel != null && !silent) {
                Toast.makeText(activity, R.string.update_latest, Toast.LENGTH_SHORT).show()
            }
            onDone?.invoke()
        }
    }

    private fun showDialog(activity: Activity, rel: UpdateChecker.Release) {
        val notes = rel.notes.trim().ifEmpty { activity.getString(R.string.update_no_notes) }
        AlertDialog.Builder(activity)
            .setTitle(activity.getString(R.string.update_title, rel.version))
            .setMessage(notes)
            .setPositiveButton(R.string.update_now) { _, _ -> startDownload(activity, rel) }
            .setNegativeButton(R.string.later, null)
            .show()
    }

    private fun startDownload(activity: Activity, rel: UpdateChecker.Release) {
        if (!UpdateChecker.canInstall(activity)) {
            Toast.makeText(activity, R.string.toast_allow_install, Toast.LENGTH_LONG).show()
            UpdateChecker.openInstallPermission(activity)
            return
        }
        val dlg = ProgressDialog(activity).apply {
            setTitle(R.string.update_downloading)
            setProgressStyle(ProgressDialog.STYLE_HORIZONTAL)
            max = 100
            setCancelable(false)
            show()
        }
        UpdateChecker.download(activity, rel.apkUrl, onProgress = { dlg.progress = it }) { apk, err ->
            runCatching { dlg.dismiss() }
            if (apk == null) {
                Toast.makeText(activity, activity.getString(R.string.update_failed, err ?: ""), Toast.LENGTH_LONG).show()
            } else {
                installNow(activity, apk, rel.version)
            }
        }
    }

    /**
     * 묻지 않고 받아서 설치한다. 받는 동안 앱을 뒤로 보냈으면(게임 위에 띄우기 등)
     * 게임 중에 앱이 닫히지 않게, 다음에 앱 화면이 보일 때 설치한다.
     */
    private fun autoUpdate(activity: Activity, rel: UpdateChecker.Release) {
        val app = activity.applicationContext
        Toast.makeText(activity, activity.getString(R.string.update_auto_downloading, rel.version), Toast.LENGTH_SHORT).show()
        UpdateChecker.download(app, rel.apkUrl, onProgress = {}) { apk, err ->
            when {
                apk == null -> Toast.makeText(app, app.getString(R.string.update_failed, err ?: ""), Toast.LENGTH_LONG).show()
                visible(activity) -> installNow(activity, apk, rel.version)
                else -> pending = apk to rel.version
            }
        }
    }

    /** 받은 새 버전 설치. 확인 없이 설치되면 앱이 곧 닫혔다가 새 버전으로 다시 열린다 (StartupReceiver) */
    private fun installNow(activity: Activity, apk: File, version: String) {
        val prefs = Prefs(activity)
        prefs.reopenAfterUpdate = true // 설치가 시작되면 앱이 바로 닫힐 수 있어서 먼저 적어 둔다
        val result = runCatching { UpdateChecker.install(activity, apk, version) }
        val silent = result.getOrDefault(false)
        if (!silent) prefs.reopenAfterUpdate = false
        val text = when {
            result.isFailure -> activity.getString(R.string.update_failed, result.exceptionOrNull()?.message ?: "")
            !silent -> return // 안드로이드 설치 화면이 떴다
            Settings.canDrawOverlays(activity) -> activity.getString(R.string.update_installing_reopen, version)
            else -> activity.getString(R.string.update_installing, version)
        }
        Toast.makeText(activity, text, Toast.LENGTH_LONG).show()
    }

    /** 앱 화면이 지금 보이는지 */
    private fun visible(activity: Activity): Boolean =
        !activity.isFinishing && !activity.isDestroyed &&
            (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) == true
}
