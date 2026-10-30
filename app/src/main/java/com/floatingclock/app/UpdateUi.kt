@file:Suppress("DEPRECATION") // ProgressDialog: 다운로드 진행을 간단히 보여 주는 데만 쓴다

package com.floatingclock.app

import android.app.Activity
import android.app.AlertDialog
import android.app.ProgressDialog
import android.widget.Toast

/**
 * 새 버전 확인과 업데이트 창. 첫 화면(위키)과 시계 설정 화면이 같이 쓴다.
 * 앱을 연 뒤 한 번만 저절로 확인하고, 시계 설정의 '업데이트 확인' 버튼으로 다시 확인할 수 있다.
 */
object UpdateUi {

    private var checkedThisRun = false

    /** 마지막으로 확인한 결과 글. 시계 설정 화면에 보여 준다 */
    var lastState: String? = null
        private set

    /** 앱을 연 뒤 처음 한 번만 조용히 확인한다. 새 버전이 있으면 업데이트 창을 띄운다 */
    fun checkOnce(activity: Activity, onState: ((String) -> Unit)? = null) {
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
                showDialog(activity, rel!!)
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
        UpdateChecker.downloadAndInstall(
            activity, rel.apkUrl,
            onProgress = { dlg.progress = it },
            onDone = { ok, err ->
                runCatching { dlg.dismiss() }
                if (!ok) {
                    Toast.makeText(activity, activity.getString(R.string.update_failed, err ?: ""), Toast.LENGTH_LONG).show()
                }
            },
        )
    }
}
