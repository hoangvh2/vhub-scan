package com.vhub.scan.core

import kotlin.math.hypot
import kotlin.math.max

/** Paper presets. Dimensions are the *long* and *short* edge in millimetres. */
enum class Paper(val label: String, val longMm: Double, val shortMm: Double) {
    AUTO("Auto (from corners)", 0.0, 0.0),
    A4("A4", 297.0, 210.0),
    A5("A5", 210.0, 148.0),
    LETTER("Letter", 279.4, 215.9),
}

data class Pt(val x: Double, val y: Double)

/** Result of sizing the rectified page. [widthMm]/[heightMm] are null for [Paper.AUTO]. */
data class OutSize(val widthPx: Int, val heightPx: Int, val widthMm: Double?, val heightMm: Double?) {
    /** PDF page size in points. AUTO assumes 300 dpi, which is only a labelling convention. */
    val pageWidthPt: Double get() = if (widthMm != null) widthMm * 72.0 / 25.4 else widthPx * 72.0 / 300.0
    val pageHeightPt: Double get() = if (heightMm != null) heightMm * 72.0 / 25.4 else heightPx * 72.0 / 300.0

    /** Effective resolution of the rectified image on the physical page, null for AUTO. */
    val dpi: Double? get() = widthMm?.let { widthPx / (it / 25.4) }
}

object Geometry {
    /** Orders 4 points as top-left, top-right, bottom-right, bottom-left. */
    fun orderCorners(p: List<Pt>): List<Pt> {
        require(p.size == 4) { "need 4 points" }
        val tl = p.minBy { it.x + it.y }
        val br = p.maxBy { it.x + it.y }
        val tr = p.maxBy { it.x - it.y }
        val bl = p.minBy { it.x - it.y }
        return listOf(tl, tr, br, bl)
    }

    fun dist(a: Pt, b: Pt) = hypot(a.x - b.x, a.y - b.y)

    /** [q] must be ordered TL,TR,BR,BL (pixel coordinates in the source image). */
    fun outputSize(q: List<Pt>, paper: Paper): OutSize {
        val w = max(dist(q[0], q[1]), dist(q[3], q[2]))
        val h = max(dist(q[0], q[3]), dist(q[1], q[2]))
        if (paper == Paper.AUTO) {
            return OutSize(w.toInt().coerceAtLeast(1), h.toInt().coerceAtLeast(1), null, null)
        }
        val portrait = h >= w
        val longPx = max(w, h)
        val ratio = paper.longMm / paper.shortMm
        val shortPx = longPx / ratio
        return if (portrait) {
            OutSize(shortPx.toInt().coerceAtLeast(1), longPx.toInt().coerceAtLeast(1), paper.shortMm, paper.longMm)
        } else {
            OutSize(longPx.toInt().coerceAtLeast(1), shortPx.toInt().coerceAtLeast(1), paper.longMm, paper.shortMm)
        }
    }
}
