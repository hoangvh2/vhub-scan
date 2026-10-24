package com.vh.trend.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** The dashboard's line icons (same 16-unit paths as the web <symbol>s), so both apps look like one product. */
object Icons {
    private fun icon(name: String, vararg paths: String): ImageVector {
        val b = ImageVector.Builder(name, 20.dp, 20.dp, 16f, 16f)
        for (p in paths) {
            b.addPath(
                pathData = addPathNodes(p), stroke = SolidColor(Color.Black), strokeLineWidth = 1.6f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
            )
        }
        return b.build()
    }

    val Today = icon("today", "M4 3h8a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4.5A1.5 1.5 0 0 1 4 3z", "M2.5 6.5h11", "M5.5 1.8v2.4", "M10.5 1.8v2.4")
    val Kept = icon("kept", "M4 2.5h8v11l-4-2.8-4 2.8z")
    val Explore = icon("explore", "M11.5 7a4.5 4.5 0 1 1-9 0a4.5 4.5 0 1 1 9 0z", "M10.5 10.5l3 3")
    val System = icon("system", "M2 12.5h12", "M4 12.5V8", "M8 12.5V3.5", "M12 12.5V6")
    val Refresh = icon("refresh", "M13 8a5 5 0 1 1-1.5-3.6", "M13 2.5v2.8h-2.8")
    val Out = icon("out", "M9 2.5h4.5V7", "M13.5 2.5L7.5 8.5", "M11.5 9.5v3.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3.5")
    val Check = icon("check", "M3 8.5l3.2 3L13 4.5")
    val Close = icon("close", "M4 4l8 8", "M12 4l-8 8")
    val Clock = icon("clock", "M13.5 8a5.5 5.5 0 1 1-11 0a5.5 5.5 0 1 1 11 0z", "M8 5v3.2l2 1.3")
    val Back = icon("back", "M10 3L5 8l5 5")
    val Phone = icon("phone", "M6 1.5h4a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 13V3A1.5 1.5 0 0 1 6 1.5z", "M7 12.2h2")
    val Scan = icon("scan", "M2.5 5.5v-3h3", "M10.5 2.5h3v3", "M13.5 10.5v3h-3", "M5.5 13.5h-3v-3", "M4.5 8h7")
}
