package com.floatingclock.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.RectF
import android.graphics.Typeface
import android.util.TypedValue
import android.view.View
import kotlin.math.max
import kotlin.math.min

/**
 * 규칙이 맞았을 때 감시 영역 바로 옆에 화살표와 알림 문구를 그리는 전체 화면 뷰.
 * 감시 영역 자체는 절대 가리지 않는다. 가리면 화면 인식이 자기 그림을 보고 헷갈린다.
 */
@SuppressLint("ViewConstructor")
class CalloutView(
    ctx: Context,
    private val onBoundsChanged: (List<RectF>) -> Unit,
) : View(ctx) {

    class Callout(val id: String, val message: String, val region: RectF, val arrow: Boolean)

    private class Placed(
        val box: RectF,
        val text: String,
        val textX: Float,
        val baseline: Float,
        val from: PointF?,
        val to: PointF?,
    )

    private var callouts: List<Callout> = emptyList()
    private val placed = ArrayList<Placed>()

    /** 📷 캡처 중에는 잠깐 숨긴다 */
    var suppressed = false
        set(v) {
            field = v
            updateVisibility()
        }

    private val density = resources.displayMetrics.density
    private val arrowColor = Color.parseColor("#FFD600")
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        typeface = Typeface.DEFAULT_BOLD
        textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 16f, resources.displayMetrics)
    }
    private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(220, 20, 20, 20) }
    private val shaftPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = arrowColor
        style = Paint.Style.STROKE
        strokeWidth = 5 * density
        strokeCap = Paint.Cap.ROUND
    }
    private val shaftOutline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(200, 0, 0, 0)
        style = Paint.Style.STROKE
        strokeWidth = 8 * density
        strokeCap = Paint.Cap.ROUND
    }
    private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = arrowColor
        style = Paint.Style.FILL
    }
    private val headOutline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(200, 0, 0, 0)
        style = Paint.Style.STROKE
        strokeWidth = 3 * density
        strokeJoin = Paint.Join.ROUND
    }

    fun setCallouts(list: List<Callout>) {
        callouts = list
        updateVisibility()
        place()
        invalidate()
    }

    private fun updateVisibility() {
        // 그릴 게 없으면 창을 아예 숨겨서 게임 화면에 부담을 주지 않는다
        visibility = if (suppressed || callouts.isEmpty()) GONE else VISIBLE
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        place()
    }

    /** 알림 상자와 화살표 위치 계산. 영역 위에 자리가 있으면 위, 없으면 아래에 둔다. */
    private fun place() {
        placed.clear()
        if (callouts.isEmpty() || width == 0 || height == 0) {
            onBoundsChanged(emptyList())
            return
        }
        val loc = IntArray(2)
        getLocationOnScreen(loc)
        val screen = ScreenUtil.realSize(context)
        val pad = 8 * density
        val gap = 6 * density
        val fm = textPaint.fontMetrics
        val textH = fm.descent - fm.ascent
        val bounds = ArrayList<RectF>()
        for (c in callouts) {
            val r = RectF(
                c.region.left * screen.x - loc[0], c.region.top * screen.y - loc[1],
                c.region.right * screen.x - loc[0], c.region.bottom * screen.y - loc[1],
            )
            val text = c.message.ifBlank { "!" }
            val boxW = textPaint.measureText(text) + pad * 2
            val boxH = textH + pad
            val arrowLen = if (c.arrow) 40 * density else 0f
            val need = gap + arrowLen + boxH
            val above = r.top - need >= 0f || r.bottom + need > height
            val cx = r.centerX()
            val left = (cx - boxW / 2).coerceIn(0f, max(0f, width - boxW))
            val tip: Float
            val tail: Float
            val top: Float
            if (above) {
                tip = r.top - gap
                tail = tip - arrowLen
                top = tail - boxH
            } else {
                tip = r.bottom + gap
                tail = tip + arrowLen
                top = tail
            }
            val box = RectF(left, top, left + boxW, top + boxH)
            val from = if (c.arrow) PointF(cx, tail) else null
            val to = if (c.arrow) PointF(cx, tip) else null
            placed += Placed(box, text, left + pad, top + pad / 2 - fm.ascent, from, to)

            // 그린 부분(상자 + 화살표)을 알려서, 화면 인식이 이 부분은 비교에서 빼게 한다
            val all = RectF(box)
            if (c.arrow) all.union(cx - 14 * density, min(tip, tail), cx + 14 * density, max(tip, tail))
            bounds += RectF(
                (all.left + loc[0]) / screen.x, (all.top + loc[1]) / screen.y,
                (all.right + loc[0]) / screen.x, (all.bottom + loc[1]) / screen.y,
            )
        }
        onBoundsChanged(bounds)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        for (p in placed) {
            val from = p.from
            val to = p.to
            if (from != null && to != null) drawArrow(canvas, from, to)
            canvas.drawRoundRect(p.box, 8 * density, 8 * density, boxPaint)
            canvas.drawText(p.text, p.textX, p.baseline, textPaint)
        }
    }

    private fun drawArrow(canvas: Canvas, from: PointF, to: PointF) {
        val head = 14 * density
        val dir = if (to.y >= from.y) 1f else -1f
        val baseY = to.y - dir * head
        canvas.drawLine(from.x, from.y, to.x, baseY, shaftOutline)
        canvas.drawLine(from.x, from.y, to.x, baseY, shaftPaint)
        val path = Path().apply {
            moveTo(to.x, to.y)
            lineTo(to.x - head * 0.8f, baseY)
            lineTo(to.x + head * 0.8f, baseY)
            close()
        }
        canvas.drawPath(path, headOutline)
        canvas.drawPath(path, headPaint)
    }
}
