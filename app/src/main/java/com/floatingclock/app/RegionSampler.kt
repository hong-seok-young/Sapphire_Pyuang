package com.floatingclock.app

import android.graphics.Bitmap
import android.graphics.RectF
import android.media.Image
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * 화면의 한 영역을 GRID x GRID 칸으로 나눠 칸마다 평균 색을 뽑고,
 * 기준 모습과 얼마나 비슷한지(0~1) 계산한다.
 * 칸 평균을 쓰기 때문에 해상도가 조금 달라도, 화면이 살짝 흔들려도 결과가 안정적이다.
 */
object RegionSampler {
    const val GRID = 12

    /** 한 칸에서 가로/세로로 몇 점씩 뽑아 평균 낼지 */
    private const val SAMPLES_PER_SIDE = 4

    interface PixelSource {
        val width: Int
        val height: Int

        /** 0xRRGGBB */
        fun rgb(x: Int, y: Int): Int
    }

    /** 화면 녹화로 받은 한 장면 (RGBA_8888) */
    class ImageSource(image: Image) : PixelSource {
        private val plane = image.planes[0]
        private val buf = plane.buffer
        private val rowStride = plane.rowStride
        private val pixelStride = plane.pixelStride
        override val width = image.width
        override val height = image.height

        override fun rgb(x: Int, y: Int): Int {
            val i = y * rowStride + x * pixelStride
            return ((buf.get(i).toInt() and 0xFF) shl 16) or
                ((buf.get(i + 1).toInt() and 0xFF) shl 8) or
                (buf.get(i + 2).toInt() and 0xFF)
        }
    }

    /** 저장해 둔 캡처 그림 */
    class BitmapSource(private val bmp: Bitmap) : PixelSource {
        override val width = bmp.width
        override val height = bmp.height
        override fun rgb(x: Int, y: Int): Int = bmp.getPixel(x, y) and 0xFFFFFF
    }

    /** 영역(비율 좌표)의 칸별 평균 색. 화면 밖 칸은 -1 */
    fun sample(src: PixelSource, x: Float, y: Float, w: Float, h: Float): IntArray {
        val out = IntArray(GRID * GRID)
        val cw = w / GRID
        val ch = h / GRID
        for (j in 0 until GRID) {
            for (i in 0 until GRID) {
                val x0 = ((x + i * cw) * src.width).toInt().coerceIn(0, src.width)
                val x1 = ((x + (i + 1) * cw) * src.width).toInt().coerceIn(0, src.width)
                val y0 = ((y + j * ch) * src.height).toInt().coerceIn(0, src.height)
                val y1 = ((y + (j + 1) * ch) * src.height).toInt().coerceIn(0, src.height)
                out[j * GRID + i] = cellAverage(src, x0, max(x1, x0 + 1), y0, max(y1, y0 + 1))
            }
        }
        return out
    }

    private fun cellAverage(src: PixelSource, x0: Int, x1: Int, y0: Int, y1: Int): Int {
        if (x0 >= src.width || y0 >= src.height) return -1
        val xe = min(x1, src.width)
        val ye = min(y1, src.height)
        val sx = max(1, (xe - x0) / SAMPLES_PER_SIDE)
        val sy = max(1, (ye - y0) / SAMPLES_PER_SIDE)
        var r = 0
        var g = 0
        var b = 0
        var n = 0
        var yy = y0
        while (yy < ye) {
            var xx = x0
            while (xx < xe) {
                val c = src.rgb(xx, yy)
                r += (c shr 16) and 0xFF
                g += (c shr 8) and 0xFF
                b += c and 0xFF
                n++
                xx += sx
            }
            yy += sy
        }
        if (n == 0) return -1
        return ((r / n) shl 16) or ((g / n) shl 8) or (b / n)
    }

    /**
     * 비슷한 정도 0~1 (1 = 똑같음). skip 으로 표시한 칸과 화면 밖 칸은 빼고 계산한다.
     * 비교할 칸이 하나도 없으면 null.
     */
    fun similarity(cur: IntArray, ref: IntArray, skip: BooleanArray?): Float? {
        if (cur.size != ref.size) return null
        var sum = 0L
        var n = 0
        for (k in cur.indices) {
            if (skip != null && skip[k]) continue
            val a = cur[k]
            val b = ref[k]
            if (a < 0 || b < 0) continue
            sum += abs(((a shr 16) and 0xFF) - ((b shr 16) and 0xFF)) +
                abs(((a shr 8) and 0xFF) - ((b shr 8) and 0xFF)) +
                abs((a and 0xFF) - (b and 0xFF))
            n++
        }
        if (n == 0) return null
        return 1f - sum.toFloat() / (n * 3 * 255f)
    }

    /** 이 앱이 그린 것(시계, 버튼, 알림)에 가려진 칸 표시. 가려진 칸이 없으면 null */
    fun occludedCells(x: Float, y: Float, w: Float, h: Float, occluders: List<RectF>): BooleanArray? {
        if (occluders.isEmpty()) return null
        val out = BooleanArray(GRID * GRID)
        var any = false
        for (j in 0 until GRID) {
            for (i in 0 until GRID) {
                val cx = x + (i + 0.5f) * w / GRID
                val cy = y + (j + 0.5f) * h / GRID
                if (occluders.any { it.contains(cx, cy) }) {
                    out[j * GRID + i] = true
                    any = true
                }
            }
        }
        return if (any) out else null
    }
}
