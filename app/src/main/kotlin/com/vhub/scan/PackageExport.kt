package com.vhub.scan

import org.opencv.core.MatOfByte
import org.opencv.core.MatOfInt
import org.opencv.imgcodecs.Imgcodecs
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Bundle for the desktop benchmark harness: untouched original + edit spec + lossless PNG of every mode,
 * all rendered from the same original with the same corners/paper/params.
 */
object PackageExport {
    fun build(store: PageStore, id: String, spec: EditSpec, progress: (String) -> Unit): File {
        val out = File(store.exportDir, "package_$id.zip")
        ZipOutputStream(out.outputStream().buffered()).use { zip ->
            fun addFile(name: String, f: File) {
                zip.putNextEntry(ZipEntry(name))
                f.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
            store.originalFile(id)?.let { addFile(it.name, it) }
            zip.putNextEntry(ZipEntry("edit.json")); zip.write(spec.toJson().toString(2).toByteArray()); zip.closeEntry()
            File(store.dir(id), "capture.json").takeIf { it.exists() }?.let { addFile("capture.json", it) }

            val orig = store.originalFile(id) ?: return@use
            val src = Imaging.loadFull(orig.absolutePath)
            try {
                for (m in ScanMode.values()) {
                    progress("Rendering ${m.name}")
                    val r = Imaging.render(src, spec.copy(mode = m))
                    val buf = MatOfByte()
                    Imgcodecs.imencode(".png", r.mat, buf, MatOfInt(Imgcodecs.IMWRITE_PNG_COMPRESSION, 1))
                    zip.putNextEntry(ZipEntry("render_${m.name.lowercase()}.png"))
                    zip.write(buf.toArray())
                    zip.closeEntry()
                    buf.release(); r.mat.release()
                }
            } finally {
                src.release()
            }
        }
        return out
    }
}
