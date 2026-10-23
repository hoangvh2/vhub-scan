package com.vhub.scan

import android.app.ActivityManager
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.os.Build
import android.util.Size

/** Implements docs/RESEARCH.md §7: what the device really exposes. Plain text so it can be pasted back. */
object DeviceReport {
    fun build(ctx: Context): String {
        val sb = StringBuilder()
        fun line(s: String = "") = sb.append(s).append('\n')

        line("VHub Scan device report")
        line("app: 0.1.0-bench")
        line()
        line("== Build ==")
        line("manufacturer/model: ${Build.MANUFACTURER} / ${Build.MODEL} (${Build.DEVICE})")
        line("android: ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT})")
        line("build.display.id: ${Build.DISPLAY}")
        line("security patch: ${Build.VERSION.SECURITY_PATCH}")
        line("hardware/board: ${Build.HARDWARE} / ${Build.BOARD}")
        if (Build.VERSION.SDK_INT >= 31) line("soc: ${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}")
        line("abis: ${Build.SUPPORTED_ABIS.joinToString()}")
        line("cores: ${Runtime.getRuntime().availableProcessors()}")
        line()
        line("== Memory ==")
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        line("total RAM: ${mi.totalMem / MB} MB, available now: ${mi.availMem / MB} MB, lowMemory=${mi.lowMemory}")
        line("memoryClass: ${am.memoryClass} MB, largeMemoryClass: ${am.largeMemoryClass} MB")
        line("java max heap: ${Runtime.getRuntime().maxMemory() / MB} MB")
        line()
        line("== Camera2 ==")
        val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        for (id in cm.cameraIdList) {
            val c = cm.getCameraCharacteristics(id)
            line("-- camera id $id --")
            line("facing: " + when (c.get(CameraCharacteristics.LENS_FACING)) {
                CameraCharacteristics.LENS_FACING_BACK -> "back"
                CameraCharacteristics.LENS_FACING_FRONT -> "front"
                else -> "external"
            })
            line("hardware level: " + when (c.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)) {
                CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
                CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
                CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
                CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
                CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL -> "EXTERNAL"
                else -> "?"
            })
            line("pixel array: ${c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)}  active: ${c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)}")
            line("physical size mm: ${c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)}")
            line("focal lengths: ${c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.joinToString()}")
            line("apertures: ${c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)?.joinToString()}")
            line("min focus distance (diopters): ${c.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE)}")
            if (Build.VERSION.SDK_INT >= 28) line("physical ids: ${c.physicalCameraIds}")
            val caps = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.map { capName(it) }
            line("capabilities: $caps")
            line("edge modes: ${c.get(CameraCharacteristics.EDGE_AVAILABLE_EDGE_MODES)?.joinToString()}  (0=OFF 1=FAST 2=HQ 3=ZSL)")
            line("noise reduction modes: ${c.get(CameraCharacteristics.NOISE_REDUCTION_AVAILABLE_NOISE_REDUCTION_MODES)?.joinToString()}  (0=OFF 1=FAST 2=HQ 3=MINIMAL 4=ZSL)")
            line("AF modes: ${c.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.joinToString()}")
            line("OIS modes: ${c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)?.joinToString()}")
            val map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            if (map != null) {
                line("JPEG sizes (largest 6): ${top(map.getOutputSizes(ImageFormat.JPEG))}")
                line("YUV_420_888 sizes (largest 4): ${top(map.getOutputSizes(ImageFormat.YUV_420_888), 4)}")
                if (map.getOutputSizes(ImageFormat.RAW_SENSOR) != null) line("RAW_SENSOR sizes: ${top(map.getOutputSizes(ImageFormat.RAW_SENSOR), 3)}")
            }
            if (Build.VERSION.SDK_INT >= 31) {
                val maxMap = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP_MAXIMUM_RESOLUTION)
                line("MAXIMUM_RESOLUTION map: " + if (maxMap == null) "none (sensor always binned in exposed modes)" else "JPEG ${top(maxMap.getOutputSizes(ImageFormat.JPEG), 3)}")
            }
            line()
        }
        return sb.toString()
    }

    private const val MB = 1024L * 1024L

    private fun top(sizes: Array<Size>?, n: Int = 6): String =
        sizes?.sortedByDescending { it.width.toLong() * it.height }?.take(n)
            ?.joinToString { "${it.width}x${it.height} (${"%.1f".format(it.width.toLong() * it.height / 1e6)}MP)" } ?: "none"

    private fun capName(v: Int) = when (v) {
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_BACKWARD_COMPATIBLE -> "BACKWARD_COMPATIBLE"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR -> "MANUAL_SENSOR"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING -> "MANUAL_POST_PROCESSING"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_RAW -> "RAW"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA -> "LOGICAL_MULTI_CAMERA"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_BURST_CAPTURE -> "BURST_CAPTURE"
        CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_ULTRA_HIGH_RESOLUTION_SENSOR -> "ULTRA_HIGH_RESOLUTION_SENSOR"
        else -> v.toString()
    }
}
