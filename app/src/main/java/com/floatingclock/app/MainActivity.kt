package com.floatingclock.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.appbar.MaterialToolbar

/**
 * 앱 첫 화면: 길드 위키 웹앱을 그대로 띄운다.
 * 정보와 챗봇은 웹앱 코드 하나로만 만들고 두 앱에서 똑같아야 하므로(CLAUDE.md 두 앱 규칙),
 * 안드로이드 앱은 웹앱을 앱 안에서 보여 준다. 시계, 타이머처럼 안드로이드에만 있는 기능은 위쪽 메뉴에서 연다.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        /** 길드 위키 웹앱 주소. 아이폰 길드원은 이 주소를 홈 화면에 추가해서 쓴다 */
        const val WEB_URL = WikiTimers.SITE
    }

    private lateinit var web: WebView
    private lateinit var offline: View
    private lateinit var progress: ProgressBar
    private val webHost: String? = Uri.parse(WEB_URL).host

    /** 웹앱이 그림 고르기를 열었을 때 결과를 돌려줄 곳. 사용자가 갤러리에서 직접 고른 그림만 넘긴다 */
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        setSupportActionBar(findViewById<MaterialToolbar>(R.id.toolbar))
        web = findViewById(R.id.web)
        offline = findViewById(R.id.offline)
        progress = findViewById(R.id.web_progress)
        findViewById<View>(R.id.btn_retry).setOnClickListener { reload() }

        web.settings.apply {
            javaScriptEnabled = true // 위키는 자바스크립트로 그리는 웹앱이다
            domStorageEnabled = true // 웹앱이 보던 화면 같은 상태를 저장한다
            // 웹앱이 이 앱 안에서 열렸는지 알 수 있게 표시한다 (앱에서만 보일 기능을 웹앱에 넣을 때 쓴다)
            userAgentString = "$userAgentString SapphireApp/${BuildConfig.VERSION_NAME}"
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.host == webHost) return false // 위키 안에서 이동
                openOutside(uri) // 카페 원글 같은 바깥 주소는 브라우저로 연다
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                offline.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) offline.visibility = View.VISIBLE
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress < 100) View.VISIBLE else View.GONE
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFile.launch(params.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
        // 뒤로 가기는 위키 안에서 먼저 뒤로 가고, 첫 페이지면 앱을 닫는다
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(WEB_URL)
        }
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        UpdateUi.checkOnce(this) // 앱을 열면 한 번 새 버전 확인
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.menu_clock -> {
            startActivity(Intent(this, ClockActivity::class.java))
            true
        }
        R.id.menu_timer -> {
            startActivity(Intent(this, TimerActivity::class.java))
            true
        }
        R.id.menu_share -> {
            shareWebLink()
            true
        }
        R.id.menu_reload -> {
            reload()
            true
        }
        else -> super.onOptionsItemSelected(item)
    }

    private fun reload() {
        offline.visibility = View.GONE
        if (web.url == null) web.loadUrl(WEB_URL) else web.reload()
    }

    /** 웹앱 주소 보내기 (카톡 등으로 길드원에게. 아이폰은 이 주소를 홈 화면에 추가해서 쓴다) */
    private fun shareWebLink() {
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, getString(R.string.share_web_text, WEB_URL))
        startActivity(Intent.createChooser(send, getString(R.string.menu_share_web)))
    }

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.toast_no_browser, Toast.LENGTH_SHORT).show()
        }
    }
}
