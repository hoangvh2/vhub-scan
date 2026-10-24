package com.vh.trend.ui

import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val vi = Locale.forLanguageTag("vi-VN")
private val nf = NumberFormat.getIntegerInstance(vi)

fun num(n: Int): String = nf.format(n)

fun compact(n: Int): String = when {
    n >= 1_000_000 -> String.format(vi, "%.1f tr", n / 1_000_000.0)
    n >= 10_000 -> String.format(vi, "%.1fk", n / 1000.0)
    else -> nf.format(n)
}

fun epochOf(iso: String?): Long? = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

/** "vừa xong", "5 phút trước", "3 giờ trước", "2 ngày trước", then a date. */
fun ago(ms: Long?, now: Long = System.currentTimeMillis()): String {
    if (ms == null) return "chưa có"
    val m = (now - ms) / 60_000
    return when {
        m < 1 -> "vừa xong"
        m < 60 -> "$m phút trước"
        m < 24 * 60 -> "${m / 60} giờ trước"
        m < 8 * 24 * 60 -> "${m / (24 * 60)} ngày trước"
        else -> DateTimeFormatter.ofPattern("d/M/yyyy").format(Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()))
    }
}

fun dayLabel(day: String?): String = day?.let {
    runCatching { DateTimeFormatter.ofPattern("EEEE, d/M", vi).format(LocalDate.parse(it)).replaceFirstChar { c -> c.uppercase(vi) } }.getOrDefault(it)
} ?: ""

val STATE_LABEL = mapOf("new" to "Mới", "kept" to "Đã giữ", "skipped" to "Đã bỏ", "snoozed" to "Đang hoãn", "trying" to "Đang thử", "done" to "Xong")
val EFFORT = mapOf("S" to ("Nhỏ" to 1), "M" to ("Vừa" to 2), "L" to ("Lớn" to 3))
