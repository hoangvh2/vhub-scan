package com.vhub.scan

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.vhub.scan.core.Paper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.opencv.android.Utils
import org.opencv.core.Mat
import org.opencv.core.Rect
import org.opencv.imgproc.Imgproc
import kotlin.math.hypot
import kotlin.math.roundToInt

private enum class View { CORNERS, RESULT, INSPECT }

private fun matToBitmap(m: Mat): Bitmap {
    val rgba = Mat()
    when (m.channels()) {
        1 -> Imgproc.cvtColor(m, rgba, Imgproc.COLOR_GRAY2RGBA)
        else -> Imgproc.cvtColor(m, rgba, Imgproc.COLOR_BGR2RGBA)
    }
    val bmp = Bitmap.createBitmap(rgba.cols(), rgba.rows(), Bitmap.Config.ARGB_8888)
    Utils.matToBitmap(rgba, bmp)
    rgba.release()
    return bmp
}

@Composable
fun EditScreen(store: PageStore, id: String, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var spec by remember { mutableStateOf(store.loadSpec(id)) }
    var preview by remember { mutableStateOf<Mat?>(null) }
    var previewBmp by remember { mutableStateOf<Bitmap?>(null) }
    var resultBmp by remember { mutableStateOf<Bitmap?>(null) }
    var resultInfo by remember { mutableStateOf("") }
    var view by remember { mutableStateOf(View.CORNERS) }
    var status by remember { mutableStateOf("Loading…") }
    var busy by remember { mutableStateOf(false) }
    var full by remember { mutableStateOf<Rendered?>(null) }
    var inspectBmp by remember { mutableStateOf<Bitmap?>(null) }
    var inspectPos by remember { mutableStateOf(0.5 to 0.5) }

    DisposableEffect(Unit) { onDispose { preview?.release(); full?.mat?.release() } }

    LaunchedEffect(id) {
        try {
            val (mat, detected) = withContext(Dispatchers.Default) {
                val p = Imaging.loadPreview(store.originalFile(id)!!.absolutePath)
                p to (if (spec.cornersConfirmed) null else Imaging.detectCorners(p))
            }
            preview = mat
            previewBmp = withContext(Dispatchers.Default) { matToBitmap(mat) }
            if (detected != null) spec = spec.copy(corners = detected)
            status = "Drag the 4 handles onto the page corners, then Save."
        } catch (t: Throwable) {
            status = "Load failed: ${t.javaClass.simpleName}: ${t.message}"
        }
    }

    // Debounced low-res preview of the real pipeline (T0/T1/T2/T3 params identical to the full-res render).
    LaunchedEffect(spec, view, preview) {
        val p = preview ?: return@LaunchedEffect
        if (view != View.RESULT && view != View.INSPECT) return@LaunchedEffect
        delay(150)
        val (bmp, info) = withContext(Dispatchers.Default) {
            val r = Imaging.render(p, spec)
            val b = matToBitmap(r.mat)
            val i = "preview ${r.mat.cols()}x${r.mat.rows()} (full output will be larger)"
            r.mat.release()
            b to i
        }
        resultBmp = bmp; resultInfo = info
        full?.mat?.release(); full = null // params changed -> cached full render invalid
    }

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            when (view) {
                View.CORNERS -> previewBmp?.let { b -> CornerEditor(b, spec.corners) { spec = spec.copy(corners = it, cornersConfirmed = false) } }
                View.RESULT -> resultBmp?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
                View.INSPECT -> Column(Modifier.fillMaxSize()) {
                    resultBmp?.let { b ->
                        Image(
                            b.asImageBitmap(), null,
                            Modifier.weight(1f).fillMaxWidth().pointerInput(b) {
                                detectTapGestures { off ->
                                    // Image is ContentScale.Fit inside the box: map the tap back to normalised coords.
                                    val s = minOf(size.width / b.width.toFloat(), size.height / b.height.toFloat())
                                    val w = b.width * s; val h = b.height * s
                                    val x0 = (size.width - w) / 2; val y0 = (size.height - h) / 2
                                    inspectPos = ((off.x - x0) / w).toDouble().coerceIn(0.0, 1.0) to ((off.y - y0) / h).toDouble().coerceIn(0.0, 1.0)
                                    inspectBmp = full?.let { f -> crop(f, inspectPos) }
                                }
                            },
                            contentScale = ContentScale.Fit,
                        )
                    }
                    inspectBmp?.let { Image(it.asImageBitmap(), null, Modifier.weight(1f).fillMaxWidth(), contentScale = ContentScale.Fit) }
                        ?: Text("Tap the result to see that spot at 1:1 output pixels.", Modifier.padding(8.dp))
                }
            }
        }

        Column(
            Modifier.heightIn(max = 330.dp).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(status + if (resultInfo.isNotEmpty() && view != View.CORNERS) "  [$resultInfo]" else "", style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                View.entries.forEach { v ->
                    FilterChip(selected = view == v, onClick = {
                        view = v
                        if (v == View.INSPECT && full == null && !busy) {
                            busy = true; status = "Rendering full resolution…"
                            scope.launch {
                                try {
                                    val r = withContext(Dispatchers.Default) {
                                        val src = Imaging.loadFull(store.originalFile(id)!!.absolutePath)
                                        try { Imaging.render(src, spec) } finally { src.release() }
                                    }
                                    full = r; inspectBmp = crop(r, inspectPos)
                                    status = "Full output ${r.size.widthPx}x${r.size.heightPx}" + (r.size.dpi?.let { " ≈ ${it.roundToInt()} dpi" } ?: "")
                                } catch (t: Throwable) { status = "Full render failed: ${t.javaClass.simpleName}: ${t.message}" }
                                busy = false
                            }
                        }
                    }, label = { Text(v.name.lowercase()) })
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                ScanMode.entries.forEach { m -> FilterChip(selected = spec.mode == m, onClick = { spec = spec.copy(mode = m) }, label = { Text(m.label) }) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                Paper.entries.forEach { p -> FilterChip(selected = spec.paper == p, onClick = { spec = spec.copy(paper = p) }, label = { Text(p.label) }) }
            }
            LabeledSwitch("Flatten background (T1)", spec.flatten) { spec = spec.copy(flatten = it) }
            LabeledSwitch("PDF lossless (Flate) instead of JPEG", spec.pdfLossless) { spec = spec.copy(pdfLossless = it) }
            if (!spec.pdfLossless) LabeledSlider("JPEG quality ${spec.jpegQuality}", spec.jpegQuality.toFloat(), 80f..100f) { spec = spec.copy(jpegQuality = it.roundToInt()) }
            Text("Experimental (default OFF; benchmark must prove safe):", style = androidx.compose.material3.MaterialTheme.typography.labelSmall)
            LabeledSlider("Unsharp amount %.2f".format(spec.unsharpAmount), spec.unsharpAmount.toFloat(), 0f..1.5f) { spec = spec.copy(unsharpAmount = it.toDouble()) }
            LabeledSwitch("CLAHE", spec.clahe) { spec = spec.copy(clahe = it) }
            if (spec.mode == ScanMode.BW) {
                LabeledSlider("Sauvola k %.2f".format(spec.sauvolaK), spec.sauvolaK.toFloat(), 0.05f..0.5f) { spec = spec.copy(sauvolaK = it.toDouble()) }
                LabeledSlider("Sauvola window %.1f%% of short side".format(spec.sauvolaWindowFrac * 100), spec.sauvolaWindowFrac.toFloat(), 0.01f..0.08f) { spec = spec.copy(sauvolaWindowFrac = it.toDouble()) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                OutlinedButton(onClick = onBack) { Text("Back") }
                OutlinedButton(enabled = preview != null, onClick = { preview?.let { spec = spec.copy(corners = Imaging.detectCorners(it), cornersConfirmed = false) } }) { Text("Auto corners") }
                Button(onClick = {
                    spec = spec.copy(cornersConfirmed = true)
                    store.saveSpec(id, spec.copy(cornersConfirmed = true)); status = "Saved."
                }) { Text("Save") }
                OutlinedButton(enabled = !busy, onClick = {
                    busy = true; status = "Building package…"
                    val s = spec.copy(cornersConfirmed = true)
                    store.saveSpec(id, s)
                    scope.launch {
                        try {
                            val z = withContext(Dispatchers.Default) { PackageExport.build(store, id, s) { p -> status = p } }
                            status = "Package: ${z.absolutePath} (${z.length() / 1024} KB)"
                            Share.send(ctx, z, "application/zip")
                        } catch (t: Throwable) { status = "Package failed: ${t.javaClass.simpleName}: ${t.message}" }
                        busy = false
                    }
                }) { Text("Export package") }
            }
        }
    }
}

private fun crop(f: Rendered, pos: Pair<Double, Double>, side: Int = 900): Bitmap {
    val w = f.mat.cols(); val h = f.mat.rows()
    val cw = minOf(side, w); val ch = minOf(side, h)
    val x = (pos.first * w - cw / 2).roundToInt().coerceIn(0, w - cw)
    val y = (pos.second * h - ch / 2).roundToInt().coerceIn(0, h - ch)
    val sub = Mat(f.mat, Rect(x, y, cw, ch))
    val bmp = matToBitmap(sub)
    sub.release()
    return bmp
}

@Composable
private fun LabeledSwitch(label: String, v: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Switch(checked = v, onCheckedChange = onChange); Text(label)
    }
}

@Composable
private fun LabeledSlider(label: String, v: Float, range: ClosedFloatingPointRange<Float>, onChange: (Float) -> Unit) {
    Column { Text(label, style = androidx.compose.material3.MaterialTheme.typography.bodySmall); Slider(value = v, onValueChange = onChange, valueRange = range) }
}

/** Draggable 4-corner overlay; coordinates are normalised to the image so the display scale does not matter. */
@Composable
private fun CornerEditor(bmp: Bitmap, corners: DoubleArray, onChange: (DoubleArray) -> Unit) {
    val cur = rememberUpdatedState(corners)
    val cb = rememberUpdatedState(onChange)
    var active by remember { mutableStateOf(-1) }
    Canvas(
        Modifier.fillMaxSize().aspectRatio(bmp.width.toFloat() / bmp.height).pointerInput(Unit) {
            detectDragGestures(
                onDragStart = { off ->
                    val c = cur.value
                    var best = -1; var bd = 90f
                    for (i in 0 until 4) {
                        val d = hypot(off.x - (c[i * 2] * size.width).toFloat(), off.y - (c[i * 2 + 1] * size.height).toFloat())
                        if (d < bd) { bd = d; best = i }
                    }
                    active = best
                },
                onDragEnd = { active = -1 },
                onDragCancel = { active = -1 },
                onDrag = { ch, delta ->
                    if (active >= 0) {
                        ch.consume()
                        val c = cur.value.copyOf()
                        c[active * 2] = (c[active * 2] + delta.x / size.width).coerceIn(0.0, 1.0)
                        c[active * 2 + 1] = (c[active * 2 + 1] + delta.y / size.height).coerceIn(0.0, 1.0)
                        cb.value(c)
                    }
                },
            )
        },
    ) {
        drawImage(bmp.asImageBitmap(), dstSize = IntSize(size.width.roundToInt(), size.height.roundToInt()))
        val c = corners
        val pts = (0 until 4).map { Offset((c[it * 2] * size.width).toFloat(), (c[it * 2 + 1] * size.height).toFloat()) }
        for (i in 0 until 4) drawLine(Color(0xFF00C853), pts[i], pts[(i + 1) % 4], strokeWidth = 4f)
        pts.forEachIndexed { i, p ->
            drawCircle(if (i == active) Color.Yellow else Color(0xFF00C853), 26f, p, style = Stroke(width = 5f))
            drawCircle(Color(0x5500C853), 26f, p)
        }
    }
}
