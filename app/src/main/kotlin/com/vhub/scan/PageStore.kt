package com.vhub.scan

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** One directory per page: original.<ext> (never modified), edit.json, capture.json. */
class PageStore(private val ctx: Context) {
    private val root = File(ctx.filesDir, "pages").apply { mkdirs() }
    val exportDir: File get() = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "exports").apply { mkdirs() }

    fun list(): List<String> = root.listFiles { f -> f.isDirectory }?.map { it.name }?.sorted() ?: emptyList()

    fun newPage(): String {
        val id = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.ROOT).format(Date())
        File(root, id).mkdirs()
        return id
    }

    fun dir(id: String) = File(root, id)

    fun originalFile(id: String): File? = dir(id).listFiles { f -> f.name.startsWith("original.") }?.firstOrNull()

    fun newOriginalFile(id: String, ext: String) = File(dir(id), "original.$ext")

    fun loadSpec(id: String): EditSpec {
        val f = File(dir(id), "edit.json")
        return if (f.exists()) runCatching { EditSpec.fromJson(JSONObject(f.readText())) }.getOrDefault(EditSpec()) else EditSpec()
    }

    fun saveSpec(id: String, spec: EditSpec) = File(dir(id), "edit.json").writeText(spec.toJson().toString(2))

    fun captureInfo(id: String): String? = File(dir(id), "capture.json").takeIf { it.exists() }?.readText()

    fun writeCaptureInfo(id: String, json: JSONObject) = File(dir(id), "capture.json").writeText(json.toString(2))

    fun delete(id: String) {
        dir(id).deleteRecursively()
    }
}
