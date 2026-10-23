package com.vhub.scan

import com.vhub.scan.core.Paper
import org.json.JSONArray
import org.json.JSONObject

enum class ScanMode(val label: String) {
    ORIGINAL("Original (geometry only)"),
    COLOR("Color / Fidelity"),
    GRAY("Grayscale"),
    BW("Clean B&W (derived)"),
}

/**
 * Non-destructive edit description. The original capture is never modified; every output is
 * re-rendered from `original.*` + this spec. Corner coordinates are normalised to the
 * EXIF-oriented original so they are independent of the decode scale.
 */
data class EditSpec(
    /** TL,TR,BR,BL as x0,y0,x1,y1,... in 0..1. */
    val corners: DoubleArray = doubleArrayOf(0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.05, 0.95),
    val cornersConfirmed: Boolean = false,
    val mode: ScanMode = ScanMode.COLOR,
    val paper: Paper = Paper.A4,
    /** T1: divide by estimated page background. */
    val flatten: Boolean = true,
    // --- experimental T2 operations (default OFF, see docs/RESEARCH.md §3.1) ---
    val unsharpAmount: Double = 0.0,
    val unsharpRadius: Double = 1.0,
    val clahe: Boolean = false,
    // --- Clean B&W (T3) ---
    val sauvolaK: Double = 0.2,
    /** Window as a fraction of the shorter output side. */
    val sauvolaWindowFrac: Double = 0.03,
    // --- PDF ---
    val pdfLossless: Boolean = false,
    val jpegQuality: Int = 95,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("version", 1)
        put("corners", JSONArray(corners.toList()))
        put("cornersConfirmed", cornersConfirmed)
        put("mode", mode.name)
        put("paper", paper.name)
        put("flatten", flatten)
        put("unsharpAmount", unsharpAmount)
        put("unsharpRadius", unsharpRadius)
        put("clahe", clahe)
        put("sauvolaK", sauvolaK)
        put("sauvolaWindowFrac", sauvolaWindowFrac)
        put("pdfLossless", pdfLossless)
        put("jpegQuality", jpegQuality)
    }

    companion object {
        fun fromJson(o: JSONObject): EditSpec {
            val d = EditSpec()
            val c = o.optJSONArray("corners")
            val corners = if (c != null && c.length() == 8) DoubleArray(8) { c.getDouble(it) } else d.corners
            return EditSpec(
                corners = corners,
                cornersConfirmed = o.optBoolean("cornersConfirmed", d.cornersConfirmed),
                mode = runCatching { ScanMode.valueOf(o.optString("mode")) }.getOrDefault(d.mode),
                paper = runCatching { Paper.valueOf(o.optString("paper")) }.getOrDefault(d.paper),
                flatten = o.optBoolean("flatten", d.flatten),
                unsharpAmount = o.optDouble("unsharpAmount", d.unsharpAmount),
                unsharpRadius = o.optDouble("unsharpRadius", d.unsharpRadius),
                clahe = o.optBoolean("clahe", d.clahe),
                sauvolaK = o.optDouble("sauvolaK", d.sauvolaK),
                sauvolaWindowFrac = o.optDouble("sauvolaWindowFrac", d.sauvolaWindowFrac),
                pdfLossless = o.optBoolean("pdfLossless", d.pdfLossless),
                jpegQuality = o.optInt("jpegQuality", d.jpegQuality),
            )
        }
    }
}
