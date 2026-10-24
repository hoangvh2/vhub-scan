package com.vh.trend.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.vh.trend.core.Action
import com.vh.trend.core.Item
import com.vh.trend.core.Source

/** Everything the screens can ask for. The ViewModel implements it; screenshot tests pass no-ops. */
interface UiActions {
    fun refresh() {}
    fun tab(t: Tab) {}
    fun select(id: String?) {}
    fun query(q: String) {}
    fun act(item: Item, action: Action, message: String) {}
    fun undo(n: Notice) {}
    fun dismissNotice() {}
    fun scan() {}
    fun pair(text: String) {}
    fun unpair() {}
}

private val TabIcons = mapOf(Tab.Today to Icons.Today, Tab.Kept to Icons.Kept, Tab.Explore to Icons.Explore, Tab.System to Icons.System)

/** Root. Phone: list, detail on top, bottom bar. Tablet: rail + list (+ detail side by side from 840dp). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrendApp(ui: UiState, on: UiActions, now: Long = System.currentTimeMillis()) {
    val c = T.c
    if (!ui.sync.paired) return PairScreen(ui, on)
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(ui.notice?.id) {
        val n = ui.notice ?: return@LaunchedEffect
        val r = snack.showSnackbar(n.text, actionLabel = if (n.undo != null) "Hoàn tác" else null, duration = SnackbarDuration.Short)
        if (r == SnackbarResult.ActionPerformed) on.undo(n) else on.dismissNotice()
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(c.bg)) {
        val wide = maxWidth >= 600.dp
        val twoPane = maxWidth >= 840.dp && ui.tab != Tab.System
        val detail = ui.selected
        if (!twoPane && detail != null) BackHandler { on.select(null) }
        Scaffold(
            containerColor = c.bg,
            contentWindowInsets = WindowInsets.safeDrawing,
            snackbarHost = { SnackbarHost(snack) },
            bottomBar = {
                if (!wide && (detail == null || ui.tab == Tab.System)) {
                    NavigationBar(containerColor = c.surface, tonalElevation = 0.dp) {
                        Tab.entries.forEach { t ->
                            NavigationBarItem(
                                selected = ui.tab == t, onClick = { on.tab(t) },
                                icon = { Icon(TabIcons[t]!!, null, Modifier.size(20.dp)) }, label = { Text(t.label) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = c.accent, selectedTextColor = c.ink, indicatorColor = c.accentSoft,
                                    unselectedIconColor = c.mute, unselectedTextColor = c.mute,
                                ),
                            )
                        }
                    }
                }
            },
        ) { pad ->
            Row(Modifier.fillMaxSize().padding(pad)) {
                if (wide) {
                    NavigationRail(containerColor = c.surface, header = {
                        Text("VH", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold), color = c.ink, modifier = Modifier.padding(vertical = 12.dp))
                    }) {
                        Tab.entries.forEach { t ->
                            NavigationRailItem(
                                selected = ui.tab == t, onClick = { on.tab(t) },
                                icon = { Icon(TabIcons[t]!!, null, Modifier.size(20.dp)) }, label = { Text(t.label) },
                                colors = NavigationRailItemDefaults.colors(
                                    selectedIconColor = c.accent, selectedTextColor = c.ink, indicatorColor = c.accentSoft,
                                    unselectedIconColor = c.mute, unselectedTextColor = c.mute,
                                ),
                            )
                        }
                    }
                    VerticalDivider(color = c.line)
                }
                when {
                    ui.tab == Tab.System -> SystemPane(ui, on, now, Modifier.fillMaxSize())
                    twoPane -> {
                        ListPane(ui, on, now, Modifier.width(400.dp).fillMaxHeight())
                        VerticalDivider(color = c.line)
                        val shown = detail ?: ui.items.firstOrNull()
                        if (shown != null) DetailPane(shown, ui.tab, on, onBack = null, modifier = Modifier.weight(1f))
                        else Box(Modifier.weight(1f).fillMaxHeight().background(c.surface))
                    }
                    detail != null -> DetailPane(detail, ui.tab, on, onBack = { on.select(null) }, modifier = Modifier.fillMaxSize())
                    else -> ListPane(ui, on, now, Modifier.fillMaxSize())
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListPane(ui: UiState, on: UiActions, now: Long, modifier: Modifier) {
    val c = T.c
    Column(modifier) {
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(ui.tab.label, style = MaterialTheme.typography.headlineSmall, color = c.ink, modifier = Modifier.weight(1f))
                IconButton(onClick = on::refresh) { Icon(Icons.Refresh, "Cập nhật", tint = c.ink2, modifier = Modifier.size(20.dp)) }
            }
            val s = ui.snapshot
            val sub = when (ui.tab) {
                Tab.Today -> s?.day?.let { "${dayLabel(it)} · ${ui.items.size} ý" }
                Tab.Kept -> "${ui.items.size} ý đang giữ hoặc đang thử"
                Tab.Explore -> if (ui.query.isBlank()) "Ý đã phân tích, xếp theo điểm" else "${ui.items.size} kết quả"
                Tab.System -> null
            }
            sub?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.mute) }
            SourceLine(ui.sync, ui.refreshing, now)
            if (ui.tab == Tab.Explore) {
                OutlinedTextField(
                    value = ui.query, onValueChange = on::query, singleLine = true, placeholder = { Text("Tìm theo tên, mô tả, chủ đề") },
                    leadingIcon = { Icon(Icons.Explore, null, Modifier.size(18.dp)) }, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 6.dp, end = 8.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.ink2, unfocusedBorderColor = c.line2, focusedContainerColor = c.raised, unfocusedContainerColor = c.raised),
                )
            }
        }
        ui.sync.error?.let { Notice(it, Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)) }
        HorizontalDivider(color = c.line)
        PullToRefreshBox(isRefreshing = ui.refreshing, onRefresh = on::refresh, modifier = Modifier.fillMaxSize()) {
            val items = ui.items
            if (items.isEmpty()) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    when {
                        ui.snapshot == null -> EmptyState("Chưa có dữ liệu", "Ở cùng Wi-Fi với PC và giữ dashboard chạy với --lan, rồi kéo xuống để cập nhật.", code = "npm run dashboard -- --lan")
                        ui.tab == Tab.Today && ui.snapshot?.health?.lastRun == null -> EmptyState("PC chưa quét lần nào", "Chạy lần quét đầu tiên trên PC (vài phút).", code = "npm run scan")
                        ui.tab == Tab.Today -> EmptyState("Hôm nay không có ý nào đáng xem", "Lần quét gần nhất không có gì vượt ngưỡng.", "Xem toàn bộ ý đã phân tích" to { on.tab(Tab.Explore) })
                        ui.tab == Tab.Kept -> EmptyState("Chưa giữ ý nào", "Bấm Giữ ở Hôm nay hoặc Khám phá. Ý đã giữ nằm ở đây tới khi bạn đánh dấu Xong.")
                        else -> EmptyState("Không có kết quả", "Thử từ khoá khác, ví dụ: calendar, cli, budget.")
                    }
                }
            } else {
                LazyColumn(Modifier.fillMaxSize().testTag("list")) {
                    items(items, key = { it.id }) { ItemRow(it, it.id == ui.selectedId) { on.select(it.id) } }
                }
            }
        }
    }
}

@Composable
private fun Notice(text: String, modifier: Modifier = Modifier) {
    val c = T.c
    Text(text, style = MaterialTheme.typography.bodySmall, color = c.warn, modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(c.warnSoft).padding(horizontal = 10.dp, vertical = 8.dp))
}

@Composable
fun DetailPane(it: Item, tab: Tab, on: UiActions, onBack: (() -> Unit)?, modifier: Modifier) {
    val c = T.c
    val uri = LocalUriHandler.current
    val card = it.card
    Column(modifier.background(c.surface)) {
        if (onBack != null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onBack) { Icon(Icons.Back, null, Modifier.size(18.dp), tint = c.ink); Spacer(Modifier.width(6.dp)); Text(tab.label, color = c.ink) }
            }
            HorizontalDivider(color = c.line)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 18.dp).widthIn(max = 720.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(it.title, style = MaterialTheme.typography.headlineSmall, color = c.ink)
                if (it.description.isNotBlank()) Text(it.description, style = MaterialTheme.typography.bodyLarge, color = c.ink2)
                Facts(it)
            }
            it.triage.why?.let { why ->
                Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(Modifier.width(2.dp).fillMaxHeight().background(c.accent))
                    Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        SectionLabel("Vì sao đáng xem")
                        Text(why + (it.shownReason?.let { r -> " · $r" } ?: ""), style = MaterialTheme.typography.bodyLarge, color = c.ink)
                    }
                }
            }
            if (card != null) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SectionLabel("Phân tích")
                    Field("Là gì", card.what)
                    Field("Đáng học", card.learn)
                    if (card.apply.isNotEmpty()) {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("Áp dụng", style = MaterialTheme.typography.bodySmall, color = c.mute)
                            card.apply.forEach { a ->
                                Text(buildString { append(a.project); append(" — "); append(a.how) }, style = MaterialTheme.typography.bodyLarge, color = c.ink)
                            }
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Nỗ lực", style = MaterialTheme.typography.bodySmall, color = c.mute)
                        val (label, level) = EFFORT[card.effort] ?: (card.effort to 0)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                            (1..3).forEach { k -> Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(if (level >= k) c.ink2 else Color.Transparent).border(1.dp, if (level >= k) c.ink2 else c.line2, RoundedCornerShape(2.dp))) }
                            Spacer(Modifier.width(6.dp)); Text(label, style = MaterialTheme.typography.bodyLarge, color = c.ink)
                        }
                    }
                    Field("Lưu ý", card.risk)
                }
            } else {
                Text("Chưa có thẻ phân tích chi tiết: ý này chưa vào nhóm điểm cao của lần quét.", style = MaterialTheme.typography.bodySmall, color = c.mute)
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val m = it.metric
                SectionLabel(if (m?.second == "sao") "Sao GitHub theo ngày" else if (m != null) "Điểm HN theo ngày" else "Xu hướng")
                Sparkline(it.series, m?.second ?: "")
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SectionLabel("Nguồn")
                Text(it.sources.joinToString(" + ") + " · " + it.url, style = MaterialTheme.typography.bodyMedium, color = c.ink2,
                    modifier = Modifier.clickable(enabled = it.url.startsWith("https://")) { uri.openUri(it.url) })
            }
        }
        HorizontalDivider(color = c.line)
        Row(Modifier.fillMaxWidth().background(c.surface).navigationBarsPadding().padding(horizontal = 14.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            val acts = if (tab == Tab.Kept) listOf(
                Triple("Đang thử", Action.Trying, "Đã chuyển sang Đang thử") to Icons.Check,
                Triple("Xong", Action.Done, "Đã đánh dấu xong") to Icons.Check,
                Triple("Bỏ", Action.Skip, "Đã bỏ") to Icons.Close,
            ) else listOf(
                Triple("Giữ", Action.Keep, "Đã giữ") to Icons.Check,
                Triple("Bỏ", Action.Skip, "Đã bỏ") to Icons.Close,
                Triple("Hoãn 7 ngày", Action.Snooze, "Sẽ hiện lại sau 7 ngày") to Icons.Clock,
            )
            acts.forEachIndexed { i, (a, icon) ->
                val on1 = i == 0 && it.userState == a.second.state
                QuietButton(a.first, icon, emphasis = on1, modifier = Modifier.weight(1f)) { on.act(it, a.second, a.third) }
            }
            if (it.url.startsWith("https://")) IconButton(onClick = { uri.openUri(it.url) }) { Icon(Icons.Out, "Mở trang gốc", tint = c.ink2, modifier = Modifier.size(20.dp)) }
        }
    }
}

@Composable
private fun Facts(it: Item) {
    val c = T.c
    val parts = buildList {
        it.triage.score?.let { s -> add("Điểm AI $s/3") }
        it.metric?.let { (v, u) -> add("${num(v)} $u") }
        it.triage.cat?.let(::add)
        it.license?.let(::add)
        if (it.userState != "new") add(STATE_LABEL[it.userState] ?: it.userState)
    }
    Text(parts.joinToString("   "), style = MaterialTheme.typography.bodySmall, color = c.mute)
}

@Composable
private fun Field(label: String, value: String) {
    val c = T.c
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = c.mute)
        Text(value, style = MaterialTheme.typography.bodyLarge, color = c.ink)
    }
}

@Composable
fun SystemPane(ui: UiState, on: UiActions, now: Long, modifier: Modifier) {
    val c = T.c
    var confirm by rememberSaveable { mutableStateOf(false) }
    val s = ui.snapshot
    val r = s?.health?.lastRun
    Column(modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(Tab.System.label, style = MaterialTheme.typography.headlineSmall, color = c.ink)
        SourceLine(ui.sync, ui.refreshing, now)
        ui.sync.error?.let { Notice(it) }
        Panel("Lần quét gần nhất") {
            if (r == null) Text("PC chưa quét lần nào.", style = MaterialTheme.typography.bodyMedium, color = c.mute)
            else {
                val steps = listOf("Thu thập" to r.collected, "Thực thể mới" to r.created, "Phân loại AI" to r.triaged, "Thẻ chi tiết" to r.carded, "Vào digest" to r.digest)
                val top = steps.maxOf { it.second }.coerceAtLeast(1)
                steps.forEachIndexed { i, (k, n) ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(k, style = MaterialTheme.typography.bodySmall, color = c.ink2, modifier = Modifier.width(96.dp))
                        Box(Modifier.weight(1f).height(8.dp)) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(n.toFloat() / top).clip(RoundedCornerShape(2.dp)).background(if (i == steps.lastIndex) c.accent else c.ink2))
                        }
                        Text(num(n), style = MaterialTheme.typography.bodySmall, color = c.ink, modifier = Modifier.width(40.dp))
                    }
                }
                KV("Bắt đầu", ago(epochOf(r.startedAt), now))
                KV("Trạng thái", r.status)
                KV("Gọi AI / dùng lại cache", "${r.llmCalls} / ${r.cacheHits}")
                r.error?.let { Notice(it) }
            }
        }
        s?.health?.tokens?.let { t ->
            Panel("Token AI hôm nay") {
                val pct = (t.used * 100 / t.limit.coerceAtLeast(1)).coerceIn(0, 100)
                Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(3.dp)).background(c.line)) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(pct / 100f).background(if (pct > 85) c.accent else c.ink2))
                }
                KV("Đã dùng", "${num(t.used)} / ${num(t.limit)}")
                KV("Số lần gọi", num(t.calls))
            }
        }
        Panel("Kết nối") {
            KV("Nguồn đang xem", when (ui.sync.source) { Source.Lan -> "PC qua Wi-Fi"; Source.Cloud -> "Cloud"; Source.Cache -> "Bản lưu"; null -> "Chưa có" })
            ui.sync.lanUrl?.let { KV("Địa chỉ PC", it) }
            KV("Cloud", if (ui.sync.cloudEnabled) "Đã bật" else "Chưa bật (chỉ xem khi cùng Wi-Fi)")
            KV("Thao tác chờ gửi", num(ui.sync.pending))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                QuietButton("Cập nhật", Icons.Refresh) { on.refresh() }
                QuietButton("Ghép nối lại", Icons.Scan) { on.scan() }
            }
            TextButton(onClick = { confirm = true }, modifier = Modifier.testTag("unpair")) { Text("Huỷ ghép nối", color = c.neg) }
        }
    }
    if (confirm) UnpairDialog(onCancel = { confirm = false }, onConfirm = { confirm = false; on.unpair() })
}

/** Destructive: forgets the pairing, the saved copy and unsent actions. Cancel on the left, the red action on the right. */
@Composable
fun UnpairDialog(onCancel: () -> Unit, onConfirm: () -> Unit) {
    val c = T.c
    AlertDialog(
        onDismissRequest = onCancel,
        containerColor = c.raised,
        title = { Text("Huỷ ghép nối với PC?", color = c.ink) },
        text = { Text("Điện thoại sẽ quên PC, bản lưu và các thao tác chưa gửi. Danh sách trên PC không bị ảnh hưởng.", color = c.ink2) },
        dismissButton = { TextButton(onClick = onCancel, modifier = Modifier.testTag("unpair-cancel")) { Text("Không", color = c.ink) } },
        confirmButton = { TextButton(onClick = onConfirm, modifier = Modifier.testTag("unpair-confirm")) { Text("Huỷ ghép nối", color = c.neg, fontWeight = FontWeight.SemiBold) } },
    )
}

@Composable
private fun Panel(title: String, content: @Composable () -> Unit) {
    val c = T.c
    Column(
        Modifier.fillMaxWidth().widthIn(max = 640.dp).clip(RoundedCornerShape(8.dp)).background(c.raised).border(1.dp, c.line, RoundedCornerShape(8.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
        content()
    }
}

@Composable
private fun KV(k: String, v: String) {
    val c = T.c
    Row {
        Text(k, style = MaterialTheme.typography.bodyMedium, color = c.mute, modifier = Modifier.weight(1f))
        Text(v, style = MaterialTheme.typography.bodyMedium, color = c.ink)
    }
}

@Composable
fun PairScreen(ui: UiState, on: UiActions) {
    val c = T.c
    var text by rememberSaveable { mutableStateOf("") }
    var paste by rememberSaveable { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().background(c.bg).statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("VHub Trend", style = MaterialTheme.typography.labelLarge, color = c.mute)
        Text("Kết nối với PC", style = MaterialTheme.typography.headlineSmall, color = c.ink)
        Text("App này xem và sắp xếp những ý tưởng mà PC của bạn đã quét. Ở nhà, app nói chuyện thẳng với PC qua Wi-Fi; khi bạn bật cloud, ra ngoài vẫn xem được.", style = MaterialTheme.typography.bodyLarge, color = c.ink2)
        Column(Modifier.clip(RoundedCornerShape(8.dp)).background(c.raised).border(1.dp, c.line, RoundedCornerShape(8.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Step(1, "Trên PC chạy:  npm run dashboard -- --lan")
            Step(2, "Mở dashboard → Hệ thống → Kết nối điện thoại")
            Step(3, "Bấm Quét mã bên dưới và đưa camera vào mã QR")
        }
        QuietButton("Quét mã QR", Icons.Scan, modifier = Modifier.fillMaxWidth()) { on.scan() }
        TextButton(onClick = { paste = !paste }) { Text(if (paste) "Ẩn ô dán mã" else "Không quét được? Dán mã dạng chữ", color = c.ink2) }
        if (paste) {
            OutlinedTextField(
                value = text, onValueChange = { text = it }, minLines = 3, placeholder = { Text("{\"v\":1,…} (lệnh npm run pair in ra)") },
                modifier = Modifier.fillMaxWidth().testTag("pair-input"), shape = RoundedCornerShape(8.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.ink2, unfocusedBorderColor = c.line2, focusedContainerColor = c.raised, unfocusedContainerColor = c.raised),
            )
            QuietButton(if (ui.pairing) "Đang kết nối…" else "Kết nối", modifier = Modifier.fillMaxWidth()) { if (!ui.pairing) on.pair(text) }
        }
        ui.pairError?.let { Notice(it) }
        Spacer(Modifier.height(8.dp))
        Text("Mã chứa quyền xem và sửa danh sách của bạn. Chỉ quét trên điện thoại của bạn.", style = MaterialTheme.typography.bodySmall, color = c.mute)
    }
}

@Composable
private fun Step(n: Int, text: String) {
    val c = T.c
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("$n", style = MaterialTheme.typography.labelLarge, color = c.accent, modifier = Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = c.ink)
    }
}
