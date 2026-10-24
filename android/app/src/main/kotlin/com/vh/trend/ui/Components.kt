package com.vh.trend.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vh.trend.core.Item
import com.vh.trend.core.Source
import com.vh.trend.core.SyncState

@Composable
fun ScoreBadge(score: Int?) {
    val c = T.c
    val (fg, border, bg) = when (score) {
        3 -> Triple(c.accent, c.accent, c.accentSoft)
        2 -> Triple(c.ink, c.ink2, Color.Transparent)
        else -> Triple(c.mute, c.line2, Color.Transparent)
    }
    Box(
        Modifier.size(22.dp).clip(RoundedCornerShape(5.dp)).background(bg).border(1.dp, border, RoundedCornerShape(5.dp))
            .semantics { contentDescription = if (score == null) "Chưa chấm" else "Điểm AI $score trên 3" },
        contentAlignment = Alignment.Center,
    ) { Text(score?.toString() ?: "–", color = fg, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold)) }
}

@Composable
fun Dot(color: Color) = Box(Modifier.size(8.dp).clip(CircleShape).background(color))

/** Where the shown data comes from and how fresh it is: the one thing to trust or doubt at a glance. */
@Composable
fun SourceLine(s: SyncState, refreshing: Boolean, now: Long = System.currentTimeMillis()) {
    val c = T.c
    val (color, text) = when {
        refreshing -> c.warn to "Đang cập nhật…"
        s.source == Source.Lan -> c.pos to "PC qua Wi-Fi · ${ago(s.fetchedAt, now)}"
        s.source == Source.Cloud -> c.pos to "Cloud · PC đẩy lên ${ago(epochOf(s.snapshot?.generatedAt), now)}"
        s.snapshot != null -> c.warn to "Bản lưu · ${ago(s.fetchedAt, now)}"
        else -> c.line2 to "Chưa có dữ liệu"
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Dot(if (s.error != null && !refreshing) c.warn else color)
        Text(text + if (s.pending > 0) " · ${s.pending} thao tác chờ gửi" else "", style = MaterialTheme.typography.bodySmall, color = c.mute, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun ItemRow(item: Item, selected: Boolean, onClick: () -> Unit) {
    val c = T.c
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).background(if (selected) c.surface else Color.Transparent)
            .drawBehind { if (selected) drawRect(c.accent, size = Size(2.dp.toPx(), size.height)) }
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ScoreBadge(item.triage.score)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Text(item.title, style = MaterialTheme.typography.titleMedium, color = c.ink, modifier = Modifier.weight(1f))
                item.metric?.let { (v, u) ->
                    Spacer(Modifier.width(8.dp))
                    Text(compact(v), style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
                    Text(" $u", style = MaterialTheme.typography.bodySmall, color = c.mute)
                }
            }
            Text(item.triage.why ?: item.description, style = MaterialTheme.typography.bodyMedium, color = c.ink2, maxLines = 2, overflow = TextOverflow.Ellipsis)
            MetaRow(item)
        }
    }
}

@Composable
fun MetaRow(item: Item) {
    val c = T.c
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val style = MaterialTheme.typography.bodySmall
        Text(item.sources.joinToString(" + "), style = style, color = c.mute)
        item.triage.cat?.let { Text(it, style = style, color = c.mute) }
        item.card?.let { Text("Nỗ lực " + (EFFORT[it.effort]?.first ?: it.effort).lowercase(), style = style, color = c.mute) }
        if (item.userState != "new") {
            Text(STATE_LABEL[item.userState] ?: item.userState, style = style.copy(fontWeight = FontWeight.SemiBold), color = if (item.userState == "snoozed") c.warn else c.pos)
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = T.c.mute, modifier = modifier)
}

@Composable
fun Sparkline(series: List<Int>, unit: String, modifier: Modifier = Modifier) {
    val c = T.c
    if (series.size < 2) {
        Text("Cần ít nhất 2 ngày số liệu để thấy xu hướng.", style = MaterialTheme.typography.bodySmall, color = c.mute)
        return
    }
    val first = series.first(); val last = series.last()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Canvas(Modifier.fillMaxWidth().height(72.dp).semantics { contentDescription = "$unit: từ $first lên $last trong ${series.size} ngày" }) {
            val max = series.max().toFloat(); val min = series.min().toFloat(); val span = (max - min).coerceAtLeast(1f)
            val pts = series.mapIndexed { i, v -> Offset(i * size.width / (series.size - 1), size.height - 4f - (v - min) / span * (size.height - 8f)) }
            val area = Path().apply { moveTo(pts.first().x, size.height); pts.forEach { lineTo(it.x, it.y) }; lineTo(pts.last().x, size.height); close() }
            drawPath(area, c.ink2.copy(alpha = 0.08f))
            val line = Path().apply { moveTo(pts.first().x, pts.first().y); pts.drop(1).forEach { lineTo(it.x, it.y) } }
            drawPath(line, c.ink2, style = Stroke(width = 1.6.dp.toPx(), cap = StrokeCap.Round))
        }
        Row {
            Text("${series.size} ngày trước: ${num(first)}", style = MaterialTheme.typography.bodySmall, color = c.mute, modifier = Modifier.weight(1f))
            val d = last - first
            Text("Nay: ${num(last)} $unit (${if (d >= 0) "+" else ""}${num(d)})", style = MaterialTheme.typography.bodySmall, color = c.mute)
        }
    }
}

@Composable
fun EmptyState(title: String, text: String, action: Pair<String, () -> Unit>? = null, code: String? = null) {
    val c = T.c
    Column(Modifier.padding(horizontal = 20.dp, vertical = 40.dp).widthIn(max = 460.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = c.ink)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = c.ink2)
        code?.let {
            Text(it, style = MaterialTheme.typography.bodySmall.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace), color = c.ink,
                modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.bg).border(1.dp, c.line, RoundedCornerShape(4.dp)).padding(horizontal = 8.dp, vertical = 3.dp))
        }
        action?.let { (label, fn) -> QuietButton(label, onClick = fn) }
    }
}

@Composable
fun QuietButton(label: String, icon: ImageVector? = null, emphasis: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = T.c
    OutlinedButton(
        onClick = onClick, modifier = modifier, shape = RoundedCornerShape(7.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (emphasis) c.pos else c.line2),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = if (emphasis) c.posSoft else c.raised, contentColor = if (emphasis) c.pos else c.ink),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 8.dp),
    ) {
        icon?.let { Icon(it, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)) }
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}
