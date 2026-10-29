package com.floatingclock.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import kotlin.math.max
import kotlin.math.min

/** 캡처한 게임 화면을 보여 주고, 손가락으로 끌어서 감시할 영역(네모)을 고르는 뷰 */
class RegionSelectView @JvmOverloads constructor(
    ctx: Context,
    attrs: AttributeSet? = null,
) : View(ctx, attrs) {

    var bitmap: Bitmap? = null
        set(v) {
            field = v
            img.setEmpty()
            requestLayout()
            invalidate()
        }

    /** 고른 영역 (그림 대비 비율 0~1). 안 골랐으면 null */
    var selection: RectF? = null
        set(v) {
            field = v
            invalidate()
        }

    var onSelectionChanged: (() -> Unit)? = null

    /** 그림이 없을 때 가운데에 보여 줄 문구 */
    var emptyText: String = ""

    private val img = RectF()
    private var downX = 0f
    private var downY = 0f
    private val density = resources.displayMetrics.density
    private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val dimPaint = Paint().apply { color = Color.argb(120, 0, 0, 0) }
    private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3 * density
        color = Color.parseColor("#FFD600")
    }
    private val emptyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.LTGRAY
        textAlign = Paint.Align.CENTER
        textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 14f, resources.displayMetrics)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        // 가로는 주어진 만큼, 세로는 그림 비율에 맞춘다 (세로가 정해져 있으면 그 안에 맞춤)
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val b = bitmap
        val want = if (b != null && b.width > 0) w * b.height / b.width else w * 9 / 16
        setMeasuredDimension(w, resolveSize(want, heightMeasureSpec))
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        fitImage()
    }

    private fun fitImage() {
        val b = bitmap
        if (b == null || width == 0 || height == 0) {
            img.setEmpty()
            return
        }
        val scale = min(width.toFloat() / b.width, height.toFloat() / b.height)
        val dw = b.width * scale
        val dh = b.height * scale
        val l = (width - dw) / 2
        val t = (height - dh) / 2
        img.set(l, t, l + dw, t + dh)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val b = bitmap
        if (b == null) {
            canvas.drawText(emptyText, width / 2f, height / 2f, emptyPaint)
            return
        }
        if (img.isEmpty) fitImage()
        canvas.drawBitmap(b, null, img, bmpPaint)
        val s = selection ?: return
        val r = RectF(
            img.left + s.left * img.width(), img.top + s.top * img.height(),
            img.left + s.right * img.width(), img.top + s.bottom * img.height(),
        )
        // 고른 부분 바깥은 살짝 어둡게
        canvas.drawRect(img.left, img.top, img.right, r.top, dimPaint)
        canvas.drawRect(img.left, r.bottom, img.right, img.bottom, dimPaint)
        canvas.drawRect(img.left, r.top, r.left, r.bottom, dimPaint)
        canvas.drawRect(r.right, r.top, img.right, r.bottom, dimPaint)
        canvas.drawRect(r, boxPaint)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (bitmap == null) return false
        if (img.isEmpty) fitImage()
        if (img.isEmpty) return false
        val x = e.x.coerceIn(img.left, img.right)
        val y = e.y.coerceIn(img.top, img.bottom)
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = x
                downY = y
                // 위아래로 끌 때 바깥 스크롤이 손가락을 가져가지 않게
                parent?.requestDisallowInterceptTouchEvent(true)
                return true
            }
            MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP -> {
                selection = RectF(
                    (min(downX, x) - img.left) / img.width(), (min(downY, y) - img.top) / img.height(),
                    (max(downX, x) - img.left) / img.width(), (max(downY, y) - img.top) / img.height(),
                )
                if (e.actionMasked == MotionEvent.ACTION_UP) {
                    parent?.requestDisallowInterceptTouchEvent(false)
                    onSelectionChanged?.invoke()
                }
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }
        }
        return super.onTouchEvent(e)
    }
}
