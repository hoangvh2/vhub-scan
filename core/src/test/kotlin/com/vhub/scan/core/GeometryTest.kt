package com.vhub.scan.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GeometryTest {
    @Test
    fun ordersCornersFromAnyPermutation() {
        val tl = Pt(10.0, 12.0); val tr = Pt(200.0, 5.0); val br = Pt(210.0, 300.0); val bl = Pt(0.0, 290.0)
        val ordered = Geometry.orderCorners(listOf(br, tl, bl, tr))
        assertEquals(listOf(tl, tr, br, bl), ordered)
    }

    @Test
    fun a4PortraitKeepsLongEdgeAndRatio() {
        val q = listOf(Pt(0.0, 0.0), Pt(1000.0, 0.0), Pt(1000.0, 1500.0), Pt(0.0, 1500.0))
        val s = Geometry.outputSize(q, Paper.A4)
        assertEquals(1500, s.heightPx)
        assertTrue(kotlin.math.abs(s.widthPx - 1060) <= 1) // 1500 * 210/297
        assertEquals(210.0, s.widthMm!!, 1e-9)
        assertEquals(595.28, s.pageWidthPt, 0.01)
    }

    @Test
    fun a4LandscapeSwapsAxes() {
        val q = listOf(Pt(0.0, 0.0), Pt(1500.0, 0.0), Pt(1500.0, 1000.0), Pt(0.0, 1000.0))
        val s = Geometry.outputSize(q, Paper.A4)
        assertEquals(1500, s.widthPx)
        assertEquals(297.0, s.widthMm!!, 1e-9)
    }

    @Test
    fun autoUsesCornerEdgesAndNoPhysicalSize() {
        val q = listOf(Pt(0.0, 0.0), Pt(800.0, 0.0), Pt(790.0, 1000.0), Pt(0.0, 990.0))
        val s = Geometry.outputSize(q, Paper.AUTO)
        assertEquals(800, s.widthPx); assertEquals(1000, s.heightPx)
        assertEquals(null, s.dpi)
    }
}
