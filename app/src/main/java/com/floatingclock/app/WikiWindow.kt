package com.floatingclock.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.TypedValue
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 게임 위에 띄우는 위키 창.
 * 아이모는 다른 앱으로 넘어가면 접속이 끊겨서, 앱을 열지 않고 게임 화면 위 작은 창으로 위키를 본다.
 * 위키 웹앱을 그대로 띄울 뿐, 게임 화면을 읽거나 게임에 입력을 보내지 않는다. (CLAUDE.md: 플로팅 창)
 *
 * 창 바깥(게임)을 누르면 입력이 게임으로 돌아가고, 창을 누르면 다시 창이 글자 입력을 받는다.
 * 로그인은 앱 첫 화면과 같은 쿠키를 써서, 한쪽에서 로그인하면 다른 쪽도 로그인된다.
 */
class WikiWindow(private val ctx: Context) {

    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private var root: Frame? = null
    private var web: WebView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var attached = false
    private var big = false

    /** 게임이 뒤로 가서 잠깐 숨긴 상태. 게임이 다시 앞에 오면 저절로 다시 보인다 */
    private var hiddenForGame = false

    /** 지금 화면에 떠 있는지 */
    val isShowing: Boolean get() = attached

    fun show() {
        hiddenForGame = false
        val frame = root ?: build()
        if (!attached) attach(frame)
        setFocusableWindow(true)
        web?.onResume()
    }

    /** 접기: 창은 치우되 보던 페이지는 그대로 둔다. 시계를 눌러 다시 열면 이어서 본다 */
    fun hide() {
        hiddenForGame = false
        detach()
        web?.onPause()
    }

    /** 게임 실행 중에만 표시: 게임이 뒤로 가면 잠깐 숨기고, 다시 앞에 오면 보인다 */
    fun followGame(gameInFront: Boolean) {
        if (!gameInFront && attached) {
            detach()
            hiddenForGame = true
        } else if (gameInFront && hiddenForGame) {
            hiddenForGame = false
            root?.let { attach(it) }
        }
    }

    /** 닫기: 창과 페이지를 모두 없앤다 */
    fun destroy() {
        detach()
        runCatching { web?.destroy() }
        web = null
        root = null
        lp = null
        hiddenForGame = false
    }

    // ---------- 창 만들기 ----------

    @SuppressLint("SetJavaScriptEnabled")
    private fun build(): Frame {
        val frame = Frame().apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(2), dp(2), dp(2), dp(2))
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(Color.argb(250, 20, 24, 49)) // 위키와 같은 밤하늘 색
                setStroke(dp(1), Color.rgb(74, 63, 134))
            }
        }
        val bar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val title = TextView(ctx).apply {
            text = ctx.getString(R.string.wiki_window_title)
            setTextColor(Color.WHITE)
            textSize = 14f
            maxLines = 1
            setPadding(dp(8), dp(8), dp(4), dp(8))
            setOnTouchListener(DragToMove()) // 제목을 끌어 창을 옮긴다
        }
        bar.addView(barButton("◀", R.string.wiki_win_back) { web?.let { if (it.canGoBack()) it.goBack() } })
        bar.addView(barButton("⌂", R.string.wiki_win_home) { web?.loadUrl(WikiTimers.SITE) })
        bar.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(barButton("⤢", R.string.wiki_win_size) { toggleSize() })
        bar.addView(barButton("—", R.string.wiki_win_hide) { hide() })
        bar.addView(barButton("✕", R.string.wiki_win_close) { destroy() })
        frame.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val view = WebView(ContextThemeWrapper(ctx, R.style.Theme_FloatingClock)).apply {
            settings.javaScriptEnabled = true // 위키는 자바스크립트로 그리는 웹앱이다
            settings.domStorageEnabled = true
            settings.builtInZoomControls = true // 지도를 손가락으로 벌려 크게 본다 (확대 버튼은 숨긴다)
            settings.displayZoomControls = false
            // SapphireFloat: 위키가 이 창 안에서는 '앱' 탭을 숨긴다 (다른 화면을 열면 게임에서 빠져나가서)
            settings.userAgentString = settings.userAgentString + " SapphireApp/" + BuildConfig.VERSION_NAME + " SapphireFloat"
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    // 카페 원글 같은 바깥 주소도 이 창 안에서 연다. 다른 앱으로 넘어가면 아이모 접속이 끊긴다
                    val scheme = request.url.scheme
                    return scheme != "http" && scheme != "https"
                }
            }
            loadUrl(WikiTimers.SITE)
        }
        frame.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        web = view
        root = frame
        return frame
    }

    private fun barButton(label: String, desc: Int, onClick: () -> Unit) = TextView(ctx).apply {
        text = label
        contentDescription = ctx.getString(desc)
        setTextColor(Color.WHITE)
        textSize = 16f
        gravity = Gravity.CENTER
        minWidth = dp(40)
        setPadding(dp(8), dp(6), dp(8), dp(6))
        isClickable = true
        setOnClickListener { onClick() }
    }

    // ---------- 창 크기와 위치 ----------

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

    /** 가로(게임) 화면에서는 오른쪽 절반쯤, 세로 화면에서는 가운데. ⤢ 를 누르면 크게 */
    private fun sizeNow(): Pair<Int, Int> {
        val dm = ctx.resources.displayMetrics
        val w = dm.widthPixels
        val h = dm.heightPixels
        return if (w > h) {
            if (big) (w * 0.72f).toInt() to (h * 0.94f).toInt() else (w * 0.46f).toInt() to (h * 0.86f).toInt()
        } else {
            if (big) (w * 0.98f).toInt() to (h * 0.85f).toInt() else (w * 0.94f).toInt() to (h * 0.6f).toInt()
        }
    }

    private fun attach(frame: Frame) {
        val dm = ctx.resources.displayMetrics
        val (w, h) = sizeNow()
        val params = lp ?: WindowManager.LayoutParams(
            w, h, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            val landscape = dm.widthPixels > dm.heightPixels
            x = if (landscape) dm.widthPixels - w - dp(8) else (dm.widthPixels - w) / 2
            y = if (landscape) (dm.heightPixels - h) / 2 else dm.heightPixels / 6
            @Suppress("DEPRECATION") // 검색칸을 누르면 키보드 위로 창이 줄어들게 (오래된 방식이지만 떠 있는 창에서는 이게 맞다)
            val resize = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            softInputMode = resize
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        // 화면 방향이 바뀌었을 수 있으니 열 때마다 크기를 다시 맞추고 화면 안으로 넣는다
        params.width = w
        params.height = h
        clamp(params)
        lp = params
        if (runCatching { wm.addView(frame, params) }.isSuccess) attached = true
    }

    private fun detach() {
        val frame = root ?: return
        if (attached) runCatching { wm.removeViewImmediate(frame) }
        attached = false
    }

    private fun toggleSize() {
        big = !big
        val frame = root ?: return
        val params = lp ?: return
        val (w, h) = sizeNow()
        params.width = w
        params.height = h
        clamp(params)
        if (attached) runCatching { wm.updateViewLayout(frame, params) }
    }

    /** 창이 화면 밖으로 나가지 않게 */
    private fun clamp(p: WindowManager.LayoutParams) {
        val dm = ctx.resources.displayMetrics
        p.x = p.x.coerceIn(0, (dm.widthPixels - p.width).coerceAtLeast(0))
        p.y = p.y.coerceIn(0, (dm.heightPixels - p.height).coerceAtLeast(0))
    }

    /** 창이 글자 입력을 받을지. 게임을 누르면 끄고(게임이 입력을 받게), 창을 누르면 켠다 */
    private fun setFocusableWindow(on: Boolean) {
        val frame = root ?: return
        val params = lp ?: return
        val focusable = params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE == 0
        if (focusable == on) return
        params.flags = if (on) {
            params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
        } else {
            params.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        }
        if (attached) runCatching { wm.updateViewLayout(frame, params) }
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()

    /** 창 틀: 바깥을 누르면 입력을 게임에 돌려주고, 뒤로 가기는 위키 안에서 먼저 뒤로 간다 */
    private inner class Frame : LinearLayout(ctx) {
        override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
            when (ev.actionMasked) {
                MotionEvent.ACTION_OUTSIDE -> {
                    setFocusableWindow(false)
                    return false
                }
                MotionEvent.ACTION_DOWN -> setFocusableWindow(true)
            }
            return super.dispatchTouchEvent(ev)
        }

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                if (event.action == KeyEvent.ACTION_UP) {
                    val view = web
                    if (view != null && view.canGoBack()) view.goBack() else hide()
                }
                return true
            }
            return super.dispatchKeyEvent(event)
        }
    }

    /** 제목 줄을 끌어서 창 옮기기 */
    private inner class DragToMove : View.OnTouchListener {
        private var startX = 0
        private var startY = 0
        private var touchX = 0f
        private var touchY = 0f

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouch(v: View, e: MotionEvent): Boolean {
            val frame = root ?: return false
            val params = lp ?: return false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x
                    startY = params.y
                    touchX = e.rawX
                    touchY = e.rawY
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = startX + (e.rawX - touchX).toInt()
                    params.y = startY + (e.rawY - touchY).toInt()
                    clamp(params)
                    if (attached) runCatching { wm.updateViewLayout(frame, params) }
                }
            }
            return true
        }
    }
}
