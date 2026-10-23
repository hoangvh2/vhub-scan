package com.vhub.scan

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.os.Build
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.AspectRatio
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private suspend fun <T> ListenableFuture<T>.awaitMain(ctx: android.content.Context): T =
    suspendCancellableCoroutine { cont ->
        addListener({
            try { cont.resume(get()) } catch (e: Exception) { cont.resumeWithException(e) }
        }, ContextCompat.getMainExecutor(ctx))
    }

/**
 * Capture with CameraX + Camera2 interop. Goal: the highest resolution the device really exposes, and
 * (optionally) the vendor ISP's edge enhancement / noise reduction switched off so we can measure the raw optics.
 */
@OptIn(ExperimentalCamera2Interop::class)
@SuppressLint("ClickableViewAccessibility")
@Composable
fun CaptureScreen(store: PageStore, onDone: (String) -> Unit, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val owner = ctx as ComponentActivity
    var hasPerm by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasPerm = it }
    LaunchedEffect(Unit) { if (!hasPerm) permLauncher.launch(Manifest.permission.CAMERA) }

    var maxRes by remember { mutableStateOf(true) }
    var ispOff by remember { mutableStateOf(true) }
    var info by remember { mutableStateOf("") }
    var capturing by remember { mutableStateOf(false) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var imageCapture by remember { mutableStateOf<ImageCapture?>(null) }
    val cameraState = rememberUpdatedState(camera)
    val previewView = remember { PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FIT_CENTER } }

    LaunchedEffect(hasPerm, maxRes, ispOff) {
        if (!hasPerm) return@LaunchedEffect
        try {
            val provider = ProcessCameraProvider.getInstance(ctx).awaitMain(ctx)
            val res = ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
                .setAllowedResolutionMode(
                    if (maxRes) ResolutionSelector.PREFER_HIGHER_RESOLUTION_OVER_CAPTURE_RATE
                    else ResolutionSelector.PREFER_CAPTURE_RATE_OVER_HIGHER_RESOLUTION,
                )
                .build()
            val icb = ImageCapture.Builder()
                .setResolutionSelector(res)
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .setJpegQuality(100)
            var ispNote = "ISP: default"
            if (ispOff) {
                val (edgeOk, nrOk) = ispOffSupported(ctx)
                val ext = Camera2Interop.Extender(icb)
                if (edgeOk) ext.setCaptureRequestOption(CaptureRequest.EDGE_MODE, CameraMetadata.EDGE_MODE_OFF)
                if (nrOk) ext.setCaptureRequestOption(CaptureRequest.NOISE_REDUCTION_MODE, CameraMetadata.NOISE_REDUCTION_MODE_OFF)
                ispNote = "EDGE=OFF requested: $edgeOk, NR=OFF requested: $nrOk (device may still post-process)"
            }
            val ic = icb.build()
            val preview = Preview.Builder().setResolutionSelector(
                ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy(AspectRatio.RATIO_4_3, AspectRatioStrategy.FALLBACK_RULE_AUTO)).build(),
            ).build()
            provider.unbindAll()
            camera = provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, ic)
            preview.setSurfaceProvider(previewView.surfaceProvider)
            imageCapture = ic
            info = "Capture resolution: ${ic.resolutionInfo?.resolution}\n$ispNote"
        } catch (t: Throwable) {
            info = "Camera error: ${t.javaClass.simpleName}: ${t.message}"
        }
    }

    Column(Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            factory = {
                previewView.setOnTouchListener { v, e ->
                    if (e.action == MotionEvent.ACTION_UP) {
                        val p = previewView.meteringPointFactory.createPoint(e.x, e.y)
                        cameraState.value?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(p).disableAutoCancel().build())
                        v.performClick()
                    }
                    true
                }
                previewView
            },
        )
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(info, style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
            Text("Tap preview to focus (AF stays locked after tap).", style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Switch(checked = maxRes, onCheckedChange = { maxRes = it }); Text("Prefer max resolution")
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Switch(checked = ispOff, onCheckedChange = { ispOff = it }); Text("Request ISP sharpen/NR off")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onBack) { Text("Back") }
                Button(
                    enabled = imageCapture != null && !capturing,
                    onClick = {
                        val ic = imageCapture ?: return@Button
                        capturing = true
                        val id = store.newPage()
                        val file = store.newOriginalFile(id, "jpg")
                        val t0 = System.currentTimeMillis()
                        ic.takePicture(
                            ImageCapture.OutputFileOptions.Builder(file).build(),
                            ContextCompat.getMainExecutor(ctx),
                            object : ImageCapture.OnImageSavedCallback {
                                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                                    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                                    BitmapFactory.decodeFile(file.absolutePath, o)
                                    store.writeCaptureInfo(
                                        id,
                                        JSONObject()
                                            .put("source", "camera")
                                            .put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                                            .put("android", Build.VERSION.RELEASE)
                                            .put("build", Build.DISPLAY)
                                            .put("storedPixels", "${o.outWidth}x${o.outHeight}")
                                            .put("fileBytes", file.length())
                                            .put("captureLatencyMs", System.currentTimeMillis() - t0)
                                            .put("preferMaxResolution", maxRes)
                                            .put("ispOffRequested", ispOff)
                                            .put("resolutionInfo", ic.resolutionInfo?.resolution?.toString()),
                                    )
                                    capturing = false
                                    onDone(id)
                                }

                                override fun onError(e: ImageCaptureException) {
                                    capturing = false
                                    file.delete(); store.delete(id)
                                    ctx.toast("Capture failed: ${e.message}")
                                }
                            },
                        )
                    },
                ) { Text(if (capturing) "Saving…" else "Capture") }
            }
        }
    }
}

private fun ispOffSupported(ctx: android.content.Context): Pair<Boolean, Boolean> {
    val cm = ctx.getSystemService(android.content.Context.CAMERA_SERVICE) as CameraManager
    val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK }
        ?: return false to false
    val c = cm.getCameraCharacteristics(id)
    val edge = c.get(CameraCharacteristics.EDGE_AVAILABLE_EDGE_MODES)?.contains(CameraMetadata.EDGE_MODE_OFF) == true
    val nr = c.get(CameraCharacteristics.NOISE_REDUCTION_AVAILABLE_NOISE_REDUCTION_MODES)?.contains(CameraMetadata.NOISE_REDUCTION_MODE_OFF) == true
    return edge to nr
}
