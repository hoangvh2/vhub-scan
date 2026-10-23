package com.vhub.scan.core

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.Locale

enum class PdfColorSpace(val pdf: String) { GRAY("/DeviceGray"), RGB("/DeviceRGB") }
enum class PdfFilter(val pdf: String) { DCT("/DCTDecode"), FLATE("/FlateDecode") }

/**
 * An image whose stream bytes are already encoded. The writer copies [dataFile] verbatim into the PDF;
 * it never decodes, resamples or re-encodes, so what is embedded is exactly what the caller produced.
 */
class PdfImage(
    val widthPx: Int,
    val heightPx: Int,
    val colorSpace: PdfColorSpace,
    val bitsPerComponent: Int,
    val filter: PdfFilter,
    val dataFile: File,
)

/** What was actually written for a page, for the export log / verification. */
data class PageRecord(val widthPx: Int, val heightPx: Int, val streamBytes: Long, val sha256: String)

/**
 * Minimal PDF 1.5 writer: one full-page image per page, no text layer.
 * Pure JVM so it can be unit-tested against an independent parser.
 */
class PdfWriter(output: OutputStream, private val title: String = "VHub Scan") : AutoCloseable {
    private val out = Counting(BufferedOutputStream(output, 1 shl 16))
    private val offsets = HashMap<Int, Long>()
    private val pageObjs = ArrayList<Int>()
    private var nextObj = FIRST_PAGE_OBJ
    private var closed = false

    init {
        out.write("%PDF-1.5\n%âãÏÓ\n".toByteArray(Charsets.ISO_8859_1))
    }

    fun addPage(img: PdfImage, pageWidthPt: Double, pageHeightPt: Double): PageRecord {
        check(!closed)
        val pageObj = nextObj++
        val contentObj = nextObj++
        val imgObj = nextObj++

        val len = img.dataFile.length()
        val md = MessageDigest.getInstance("SHA-256")

        beginObj(imgObj)
        out.ascii(
            "<< /Type /XObject /Subtype /Image /Width ${img.widthPx} /Height ${img.heightPx} " +
                "/ColorSpace ${img.colorSpace.pdf} /BitsPerComponent ${img.bitsPerComponent} " +
                "/Filter ${img.filter.pdf} /Length $len >>\nstream\n",
        )
        FileInputStream(img.dataFile).use { ins ->
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = ins.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
                out.write(buf, 0, n)
            }
        }
        out.ascii("\nendstream\nendobj\n")

        val content = "q ${num(pageWidthPt)} 0 0 ${num(pageHeightPt)} 0 0 cm /Im0 Do Q\n"
        beginObj(contentObj)
        out.ascii("<< /Length ${content.length} >>\nstream\n$content" + "endstream\nendobj\n")

        beginObj(pageObj)
        out.ascii(
            "<< /Type /Page /Parent $PAGES_OBJ 0 R /MediaBox [0 0 ${num(pageWidthPt)} ${num(pageHeightPt)}] " +
                "/Resources << /XObject << /Im0 $imgObj 0 R >> /ProcSet [/PDF /ImageB /ImageC] >> " +
                "/Contents $contentObj 0 R >>\nendobj\n",
        )
        pageObjs += pageObj
        return PageRecord(img.widthPx, img.heightPx, len, md.digest().joinToString("") { "%02x".format(it) })
    }

    override fun close() {
        if (closed) return
        closed = true
        beginObj(PAGES_OBJ)
        out.ascii(
            "<< /Type /Pages /Count ${pageObjs.size} /Kids [${pageObjs.joinToString(" ") { "$it 0 R" }}] >>\nendobj\n",
        )
        beginObj(CATALOG_OBJ)
        out.ascii("<< /Type /Catalog /Pages $PAGES_OBJ 0 R >>\nendobj\n")
        beginObj(INFO_OBJ)
        out.ascii("<< /Title (${escape(title)}) /Producer (VHub Scan) >>\nendobj\n")

        val xrefPos = out.count
        val total = nextObj
        out.ascii("xref\n0 $total\n0000000000 65535 f \n")
        for (i in 1 until total) {
            out.ascii(String.format(Locale.ROOT, "%010d 00000 n \n", offsets.getValue(i)))
        }
        out.ascii("trailer\n<< /Size $total /Root $CATALOG_OBJ 0 R /Info $INFO_OBJ 0 R >>\nstartxref\n$xrefPos\n%%EOF\n")
        out.flush()
        out.close()
    }

    private fun beginObj(n: Int) {
        offsets[n] = out.count
        out.ascii("$n 0 obj\n")
    }

    private fun num(v: Double) = String.format(Locale.ROOT, "%.3f", v)

    private fun escape(s: String) = s.filter { it.code in 32..126 }.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    private class Counting(private val inner: OutputStream) : OutputStream() {
        var count = 0L
            private set

        override fun write(b: Int) { inner.write(b); count++ }
        override fun write(b: ByteArray, off: Int, len: Int) { inner.write(b, off, len); count += len }
        override fun flush() = inner.flush()
        override fun close() = inner.close()
        fun ascii(s: String) = write(s.toByteArray(Charsets.ISO_8859_1))
    }

    private companion object {
        const val CATALOG_OBJ = 1
        const val PAGES_OBJ = 2
        const val INFO_OBJ = 3
        const val FIRST_PAGE_OBJ = 4
    }
}
