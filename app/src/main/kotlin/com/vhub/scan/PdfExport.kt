package com.vhub.scan

import com.vhub.scan.core.PdfColorSpace
import com.vhub.scan.core.PdfFilter
import com.vhub.scan.core.PdfImage
import com.vhub.scan.core.PdfWriter
import org.json.JSONArray
import org.json.JSONObject
import org.opencv.core.Mat
import org.opencv.core.MatOfByte
import org.opencv.core.MatOfInt
import org.opencv.imgcodecs.Imgcodecs
import org.opencv.imgproc.Imgproc
import java.io.File
import java.util.zip.Deflater
import java.util.zip.DeflaterOutputStream
import kotlin.math.min

/**
 * Builds an image-only PDF (no OCR layer yet). The image bytes are produced here, then copied
 * verbatim by [PdfWriter]. Lossy JBIG2 is intentionally not offered (docs/RESEARCH.md §5).
 */
object PdfExport {
    private const val IMWRITE_JPEG_SAMPLING_FACTOR = 7
    private const val SAMPLING_444 = 0x111111

    /** Returns the PDF file and a JSON log describing exactly what was embedded. */
    fun export(store: PageStore, ids: List<String>, outFile: File, progress: (String) -> Unit): JSONObject {
        val log = JSONObject()
        val pagesLog = JSONArray()
        val tmpDir = File(outFile.parentFile, "tmp").apply { mkdirs() }
        PdfWriter(outFile.outputStream(), "VHub Scan").use { pdf ->
            for ((i, id) in ids.withIndex()) {
                progress("Page ${i + 1}/${ids.size}: decoding")
                val spec = store.loadSpec(id)
                val orig = store.originalFile(id) ?: continue
                val t0 = System.nanoTime()
                val src = Imaging.loadFull(orig.absolutePath)
                val srcDims = "${src.cols()}x${src.rows()}"
                progress("Page ${i + 1}/${ids.size}: rendering")
                val r = Imaging.render(src, spec)
                src.release()
                val tRender = (System.nanoTime() - t0) / 1e6
                progress("Page ${i + 1}/${ids.size}: encoding")
                val data = File(tmpDir, "img_$i.bin")
                val image = encode(r, spec, data)
                val rec = pdf.addPage(image, r.size.pageWidthPt, r.size.pageHeightPt)
                r.mat.release()
                data.delete()
                pagesLog.put(
                    JSONObject().apply {
                        put("id", id)
                        put("source", srcDims)
                        put("mode", spec.mode.name)
                        put("paper", spec.paper.name)
                        put("outputPx", "${r.size.widthPx}x${r.size.heightPx}")
                        put("effectiveDpi", r.size.dpi?.let { Math.round(it) } ?: JSONObject.NULL)
                        put("filter", image.filter.name)
                        put("streamBytes", rec.streamBytes)
                        put("streamSha256", rec.sha256)
                        put("renderMs", Math.round(tRender))
                        put("spec", spec.toJson())
                    },
                )
            }
        }
        tmpDir.deleteRecursively()
        log.put("pdf", outFile.name)
        log.put("pdfBytes", outFile.length())
        log.put("textLayer", false)
        log.put("pages", pagesLog)
        File(outFile.parentFile, outFile.nameWithoutExtension + ".log.json").writeText(log.toString(2))
        return log
    }

    private fun encode(r: Rendered, spec: EditSpec, out: File): PdfImage {
        val w = r.mat.cols()
        val h = r.mat.rows()
        return when (r.kind) {
            Kind.BINARY -> {
                writeFlateBits(r.mat, out)
                PdfImage(w, h, PdfColorSpace.GRAY, 1, PdfFilter.FLATE, out)
            }
            Kind.GRAY, Kind.BGR -> {
                val cs = if (r.kind == Kind.GRAY) PdfColorSpace.GRAY else PdfColorSpace.RGB
                if (spec.pdfLossless) {
                    writeFlate8(r.mat, out, r.kind == Kind.BGR)
                    PdfImage(w, h, cs, 8, PdfFilter.FLATE, out)
                } else {
                    val buf = MatOfByte()
                    val params = MatOfInt(
                        Imgcodecs.IMWRITE_JPEG_QUALITY, spec.jpegQuality,
                        IMWRITE_JPEG_SAMPLING_FACTOR, SAMPLING_444,
                    )
                    require(Imgcodecs.imencode(".jpg", r.mat, buf, params)) { "JPEG encode failed" }
                    out.writeBytes(buf.toArray())
                    buf.release()
                    PdfImage(w, h, cs, 8, PdfFilter.DCT, out)
                }
            }
        }
    }

    private fun writeFlate8(m: Mat, out: File, bgr: Boolean) {
        val ch = m.channels()
        DeflaterOutputStream(out.outputStream().buffered(), Deflater(6)).use { os ->
            var r = 0
            val rows = 256
            while (r < m.rows()) {
                val r1 = min(m.rows(), r + rows)
                var strip: Mat = m.rowRange(r, r1)
                var tmp: Mat? = null
                if (bgr) {
                    tmp = Mat()
                    Imgproc.cvtColor(strip, tmp, Imgproc.COLOR_BGR2RGB)
                    strip = tmp
                }
                val bytes = ByteArray(strip.rows() * strip.cols() * ch)
                strip.get(0, 0, bytes)
                os.write(bytes)
                tmp?.release()
                r = r1
            }
        }
    }

    /** 1 bit/pixel, 1 = white (255), MSB first, rows padded to bytes, Flate (lossless). */
    private fun writeFlateBits(m: Mat, out: File) {
        val w = m.cols()
        val rowBytes = (w + 7) / 8
        DeflaterOutputStream(out.outputStream().buffered(), Deflater(6)).use { os ->
            var r = 0
            val rows = 256
            while (r < m.rows()) {
                val r1 = min(m.rows(), r + rows)
                val strip = m.rowRange(r, r1)
                val px = ByteArray(strip.rows() * w)
                strip.get(0, 0, px)
                val packed = ByteArray(strip.rows() * rowBytes)
                for (y in 0 until strip.rows()) {
                    val po = y * w
                    val qo = y * rowBytes
                    for (x in 0 until w) {
                        if (px[po + x].toInt() != 0) {
                            packed[qo + (x shr 3)] = (packed[qo + (x shr 3)].toInt() or (0x80 shr (x and 7))).toByte()
                        }
                    }
                }
                os.write(packed)
                r = r1
            }
        }
    }
}
