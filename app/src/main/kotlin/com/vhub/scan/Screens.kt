package com.vhub.scan

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun HomeScreen(store: PageStore, onNav: (Screen) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val ids = remember { mutableStateListOf<String>() }
    var status by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { ids.clear(); ids.addAll(store.list()) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) {
            val id = store.newPage()
            val mime = ctx.contentResolver.getType(uri) ?: "image/jpeg"
            val ext = if (mime.contains("png")) "png" else "jpg"
            ctx.contentResolver.openInputStream(uri)?.use { ins -> store.newOriginalFile(id, ext).outputStream().use { ins.copyTo(it) } }
            store.writeCaptureInfo(id, org.json.JSONObject().put("source", "import").put("mime", mime))
            onNav(Screen.Edit(id))
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("VHub Scan 0.1 (benchmark build)")
        Text("Originals are never modified. Exports are re-rendered from them.")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onNav(Screen.Capture) }) { Text("Capture") }
            OutlinedButton(onClick = { picker.launch("image/*") }) { Text("Import image") }
            OutlinedButton(onClick = { onNav(Screen.Report) }) { Text("Device report") }
        }
        Button(
            enabled = !busy && ids.isNotEmpty(),
            onClick = {
                busy = true
                scope.launch {
                    status = try {
                        val out = withContext(Dispatchers.Default) {
                            val f = File(store.exportDir, "scan_${SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())}.pdf")
                            PdfExport.export(store, ids.toList(), f) { p -> status = p }
                            f
                        }
                        Share.send(ctx, out, "application/pdf")
                        "PDF: ${out.absolutePath} (${out.length() / 1024} KB). Log: ${out.nameWithoutExtension}.log.json"
                    } catch (t: Throwable) {
                        "PDF export failed: ${t.javaClass.simpleName}: ${t.message}"
                    }
                    busy = false
                }
            },
        ) { Text("Export all pages to PDF (image-only)") }
        if (status.isNotEmpty()) Text(status)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(ids.toList()) { id ->
                val spec = remember(id) { store.loadSpec(id) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(Modifier.weight(1f)) {
                        Text(id)
                        Text("${spec.mode.label} · ${spec.paper.label}" + if (spec.cornersConfirmed) "" else " · corners not confirmed")
                    }
                    OutlinedButton(onClick = { onNav(Screen.Edit(id)) }) { Text("Edit") }
                    OutlinedButton(onClick = { store.delete(id); ids.remove(id) }) { Text("Del") }
                }
            }
        }
    }
}

@Composable
fun ReportScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    var text by remember { mutableStateOf("Collecting…") }
    LaunchedEffect(Unit) {
        text = withContext(Dispatchers.Default) { runCatching { DeviceReport.build(ctx) }.getOrElse { "Report failed: $it" } }
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onBack) { Text("Back") }
            Button(onClick = {
                val f = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "device_report.txt").apply { writeText(text) }
                Share.send(ctx, f, "text/plain")
            }) { Text("Share") }
        }
        Column(Modifier.verticalScroll(rememberScrollState())) { Text(text, style = androidx.compose.material3.MaterialTheme.typography.bodySmall) }
    }
}

internal fun Context.toast(msg: String) = android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_LONG).show()
