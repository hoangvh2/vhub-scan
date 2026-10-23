package com.vhub.scan.core

import org.apache.pdfbox.Loader
import org.apache.pdfbox.cos.COSName
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.Deflater
import java.util.zip.DeflaterOutputStream
import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

class PdfWriterTest {
    private fun tmp(bytes: ByteArray) = File.createTempFile("img", ".bin").apply { deleteOnExit(); writeBytes(bytes) }

    @Test
    fun embeddedStreamsAreByteIdenticalToInput() {
        val bi = BufferedImage(64, 48, BufferedImage.TYPE_INT_RGB)
        for (y in 0 until 48) for (x in 0 until 64) bi.setRGB(x, y, (x * 4 shl 16) or (y * 5 shl 8) or 77)
        val jpg = ByteArrayOutputStream().also { ImageIO.write(bi, "jpg", it) }.toByteArray()

        // 1-bit gray, 16x4, deflated
        val raw = ByteArray(2 * 4) { (it * 37).toByte() }
        val flate = ByteArrayOutputStream().also { b ->
            DeflaterOutputStream(b, Deflater(6)).use { it.write(raw) }
        }.toByteArray()

        val pdf = File.createTempFile("vhub", ".pdf").apply { deleteOnExit() }
        val recs = PdfWriter(pdf.outputStream()).use { w ->
            listOf(
                w.addPage(PdfImage(64, 48, PdfColorSpace.RGB, 8, PdfFilter.DCT, tmp(jpg)), 595.276, 841.89),
                w.addPage(PdfImage(16, 4, PdfColorSpace.GRAY, 1, PdfFilter.FLATE, tmp(flate)), 300.0, 75.0),
            )
        }
        assertEquals(jpg.size.toLong(), recs[0].streamBytes)

        Loader.loadPDF(pdf).use { doc ->
            assertEquals(2, doc.numberOfPages)
            assertEquals(595.276f, doc.getPage(0).mediaBox.width, 0.01f)
            val xo0 = doc.getPage(0).resources.getXObject(COSName.getPDFName("Im0")) as PDImageXObject
            assertEquals(64, xo0.width); assertEquals(48, xo0.height)
            assertContentEquals(jpg, xo0.cosObject.createRawInputStream().use { it.readBytes() })

            val xo1 = doc.getPage(1).resources.getXObject(COSName.getPDFName("Im0")) as PDImageXObject
            assertEquals(1, xo1.bitsPerComponent)
            assertContentEquals(flate, xo1.cosObject.createRawInputStream().use { it.readBytes() })
            assertContentEquals(raw, xo1.cosObject.createInputStream().use { it.readBytes() })
        }
    }
}
