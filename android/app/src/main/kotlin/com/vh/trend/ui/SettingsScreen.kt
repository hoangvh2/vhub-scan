package com.vh.trend.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.vh.trend.core.Project
import com.vh.trend.core.SettingDef
import com.vh.trend.core.SettingGroup
import com.vh.trend.core.SettingRules
import com.vh.trend.core.SettingsSnapshot
import com.vh.trend.core.Topic
import com.vh.trend.core.TrendJson
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

private val TopicList = ListSerializer(Topic.serializer())
private val ProjectList = ListSerializer(Project.serializer())

/** What is about to be deleted: a topic (by id) or a project (by position). Asks first (CLAUDE.md). */
private data class Deleting(val key: String, val index: Int, val name: String)

/**
 * The PC's settings page on the phone. The catalogue (labels, help, limits, who may edit) comes from the PC in the
 * snapshot; edits go to the PC through the cloud and the PC checks them again before it writes config.json.
 */
@Composable
fun SettingsPane(ui: UiState, on: UiActions, now: Long, modifier: Modifier) {
    val c = T.c
    val st = ui.snapshot?.settings
    var deleting by remember { mutableStateOf<Deleting?>(null) }
    Column(modifier) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(Tab.Settings.label, style = MaterialTheme.typography.headlineSmall, color = c.ink)
            SourceLine(ui.sync, ui.refreshing, now)
            ui.sync.error?.let { Notice(it) }
            if (st == null) {
                EmptyState("PC chưa gửi cài đặt lên cloud", "Cập nhật pipeline trên PC rồi đồng bộ một lần. Sau đó kéo xuống ở Hôm nay để cập nhật.", code = "npm run sync")
                return@Column
            }
            val e = st.estimate
            Text(
                "Mỗi lần quét: ${e.searches} lượt tìm GitHub · ${e.triageCalls + e.cardCalls} lần gọi AI · khoảng ${compact(e.tokens)} token",
                style = MaterialTheme.typography.bodySmall, color = c.ink2,
            )
            val waiting = ui.sync.settingsWaiting
            if (waiting.isNotEmpty()) {
                Notice("${waiting.size} thay đổi đang chờ PC áp dụng (gửi ${ago(waiting.last().at, now)}). PC nhận khi đang chạy dashboard hoặc tới lịch quét; tới lúc đó điện thoại hiện giá trị mới.")
            }
            st.remote?.let { r ->
                val who = r.device ?: "thiết bị khác"
                val text = if (r.ok) "PC đã áp dụng thay đổi từ $who ${ago(epochOf(r.appliedAt), now)}" + (if (r.changed.isNotEmpty()) ": " + r.changed.mapNotNull { k -> st.def(k)?.label }.joinToString(", ") else ".")
                else "PC không nhận thay đổi từ $who ${ago(epochOf(r.appliedAt), now)}: " + r.errors.joinToString("; ") { er -> (st.def(er.key)?.label?.let { "$it: " } ?: "") + er.problem }
                if (r.ok) Text(text, style = MaterialTheme.typography.bodySmall, color = c.mute) else Notice(text)
            }
            st.groups.forEach { g -> GroupPanel(g, st, ui, on) { deleting = it } }
            Text("Cài đặt nằm trong config.json trên PC. Mỗi thay đổi đều có bản sao lưu; hoàn tác được ở trang Cài đặt trên PC.", style = MaterialTheme.typography.bodySmall, color = c.mute)
        }
        if (st != null && (ui.draft.isNotEmpty() || ui.settingsErrors.isNotEmpty())) SaveBar(ui, on)
    }
    deleting?.let { d ->
        ConfirmDelete(
            title = if (d.key == "topics") "Xoá chủ đề \"${d.name}\"?" else "Xoá dự án \"${d.name}\"?",
            text = if (d.key == "topics") "Pipeline sẽ không quét các query của chủ đề này nữa. Ý đã thu thập vẫn giữ nguyên. Thay đổi chỉ có hiệu lực khi bạn bấm Gửi."
            else "Claude sẽ không gợi ý cách áp dụng cho dự án này nữa. Thay đổi chỉ có hiệu lực khi bạn bấm Gửi.",
            onCancel = { deleting = null },
            onConfirm = {
                deleting = null
                val list = ui.settingValue(d.key) as? JsonArray
                if (list != null && d.index in list.indices) on.editSetting(d.key, JsonArray(list.filterIndexed { i, _ -> i != d.index }), reset = true)
            },
        )
    }
}

@Composable
private fun GroupPanel(g: SettingGroup, st: SettingsSnapshot, ui: UiState, on: UiActions, onDelete: (Deleting) -> Unit) {
    val c = T.c
    val defs = st.defs.filter { it.group == g.id }
    if (defs.isEmpty()) return
    var advanced by rememberSaveable(g.id) { mutableStateOf(false) }
    val problems = ui.draftProblems
    Panel(g.label) {
        if (g.help.isNotBlank()) Text(g.help, style = MaterialTheme.typography.bodySmall, color = c.mute)
        val (main, more) = defs.partition { !it.advanced }
        main.forEach { d ->
            HorizontalDivider(color = c.line)
            SettingRow(d, st, ui, on, problems[d.key] ?: ui.settingsErrors.firstOrNull { it.key == d.key }?.problem, onDelete)
        }
        if (more.isNotEmpty()) {
            HorizontalDivider(color = c.line)
            TextButton(onClick = { advanced = !advanced }, modifier = Modifier.testTag("advanced-${g.id}")) {
                Text(if (advanced) "Ẩn mục nâng cao" else "Nâng cao (${more.size})", color = c.ink2, fontWeight = FontWeight.SemiBold)
            }
            if (advanced) more.forEach { d ->
                HorizontalDivider(color = c.line)
                SettingRow(d, st, ui, on, problems[d.key] ?: ui.settingsErrors.firstOrNull { it.key == d.key }?.problem, onDelete)
            }
        }
    }
}

@Composable
private fun SettingRow(d: SettingDef, st: SettingsSnapshot, ui: UiState, on: UiActions, problem: String?, onDelete: (Deleting) -> Unit) {
    val c = T.c
    val value = ui.settingValue(d.key)
    val edited = ui.draft.containsKey(d.key)
    val set = { v: JsonElement -> on.editSetting(d.key, v) }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp).testTag("row-${d.key}"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(d.label, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold), color = c.ink, modifier = Modifier.weight(1f))
            if (edited) Text("Đã sửa", style = MaterialTheme.typography.labelMedium, color = c.accent)
            if (d.type == "bool") {
                Spacer(Modifier.width(8.dp))
                Switch(
                    checked = value?.jsonPrimitive?.booleanOrNull == true, onCheckedChange = { set(JsonPrimitive(it)) }, enabled = d.phoneEditable,
                    colors = SwitchDefaults.colors(checkedTrackColor = c.pos, checkedThumbColor = c.raised), modifier = Modifier.testTag("set-${d.key}"),
                )
            }
        }
        Text(d.help, style = MaterialTheme.typography.bodySmall, color = c.ink2)
        val gen = ui.draftGen
        when (d.type) {
            "bool" -> Unit
            "int", "number" -> NumberField(d, value, gen, set)
            "choice" -> ChoiceChips(d, value, set)
            "text" -> TextBox(d.key, value?.jsonPrimitive?.contentOrNull.orEmpty(), gen, d.phoneEditable, minLines = 2, placeholder = "") { set(JsonPrimitive(it)) }
            "list" -> TextBox(d.key, (value as? JsonArray)?.joinToString("\n") { it.jsonPrimitive.content }.orEmpty(), gen, d.phoneEditable, minLines = 2, placeholder = "Mỗi dòng một mục") { set(lines(it)) }
            "topics" -> TopicCards(d, value, gen, ui, on, onDelete)
            "projects" -> ProjectCards(d, value, gen, on, onDelete)
        }
        problem?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold), color = c.neg, modifier = Modifier.testTag("problem-${d.key}")) }
        val notes = buildList {
            if (d.type != "topics" && d.type != "projects") add("Mặc định: " + SettingRules.brief(d, st.defaults[d.key]))
            if (d.applies == "restart") add("cần mở lại dashboard trên PC")
        }
        if (notes.isNotEmpty()) Text(notes.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.mute)
        if (!d.phoneEditable) Text(if (!d.editable) "Chỉ sửa trong config.json trên PC." else "Chỉ sửa trên dashboard của PC.", style = MaterialTheme.typography.bodySmall, color = c.warn)
    }
}

private fun lines(text: String) = JsonArray(text.split("\n").map { it.trim() }.filter { it.isNotEmpty() }.map { JsonPrimitive(it) })

@Composable
private fun fieldColors() = T.c.let { c ->
    OutlinedTextFieldDefaults.colors(
        focusedBorderColor = c.ink2, unfocusedBorderColor = c.line2, focusedContainerColor = c.raised, unfocusedContainerColor = c.raised,
        disabledContainerColor = c.surface, disabledBorderColor = c.line, disabledTextColor = c.mute,
    )
}

/** Keeps what is typed (a trailing new line, "1." on the way to "1.5") while the value it stands for goes to the draft. */
@Composable
private fun TextBox(key: String, initial: String, gen: Int, enabled: Boolean, minLines: Int, placeholder: String, label: String? = null, onChange: (String) -> Unit) {
    var text by remember(key, gen) { mutableStateOf(initial) }
    OutlinedTextField(
        value = text, onValueChange = { text = it; onChange(it) }, enabled = enabled, minLines = minLines,
        placeholder = if (placeholder.isNotEmpty()) ({ Text(placeholder) }) else null,
        label = if (label != null) ({ Text(label) }) else null,
        shape = RoundedCornerShape(8.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth().testTag("set-$key"),
    )
}

@Composable
private fun NumberField(d: SettingDef, value: JsonElement?, gen: Int, set: (JsonElement) -> Unit) {
    var text by remember(d.key, gen) { mutableStateOf(value?.jsonPrimitive?.contentOrNull.orEmpty()) }
    val unit = d.unit // a local: smart casts do not cross modules
    val range = listOfNotNull(d.min?.let { "từ ${trim(it)}" }, d.max?.let { "đến ${trim(it)}" }).joinToString(" ")
    OutlinedTextField(
        value = text,
        onValueChange = { t ->
            text = t
            val s = t.trim().replace(',', '.')
            // A whole number stays whole ("1", not "1.0"), so an unchanged value compares equal to the PC's.
            set(s.toLongOrNull()?.let { JsonPrimitive(it) } ?: s.toDoubleOrNull()?.let { if (d.type == "number") JsonPrimitive(it) else JsonPrimitive(t) } ?: JsonPrimitive(t))
        },
        enabled = d.phoneEditable, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = if (d.type == "int") KeyboardType.Number else KeyboardType.Decimal),
        suffix = if (unit != null) ({ Text(unit) }) else null,
        supportingText = if (range.isNotEmpty()) ({ Text(range) }) else null,
        shape = RoundedCornerShape(8.dp), colors = fieldColors(), modifier = Modifier.widthIn(max = 260.dp).fillMaxWidth().testTag("set-${d.key}"),
    )
}

private fun trim(d: Double) = if (d == Math.floor(d)) d.toLong().toString() else d.toString()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChoiceChips(d: SettingDef, value: JsonElement?, set: (JsonElement) -> Unit) {
    val c = T.c
    val cur = value?.jsonPrimitive?.contentOrNull
    // A full model id set in config.json is not among the options: shown as its own chip so nothing looks unselected.
    val options = d.options.map { it.value to it.label } + (if (cur != null && d.options.none { it.value == cur }) listOf(cur to cur) else emptyList())
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (v, label) ->
            FilterChip(
                selected = v == cur, onClick = { set(JsonPrimitive(v)) }, enabled = d.phoneEditable, label = { Text(label) },
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = c.accentSoft, selectedLabelColor = c.ink, labelColor = c.ink2),
                modifier = Modifier.testTag("opt-${d.key}-$v"),
            )
        }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    val c = T.c
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.surface).border(1.dp, c.line, RoundedCornerShape(8.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) { content() }
}

@Composable
private fun TopicCards(d: SettingDef, value: JsonElement?, gen: Int, ui: UiState, on: UiActions, onDelete: (Deleting) -> Unit) {
    val c = T.c
    val list = value?.let { runCatching { TrendJson.decodeFromJsonElement(TopicList, it) }.getOrNull() } ?: emptyList()
    fun put(i: Int, t: Topic, reset: Boolean = false) = on.editSetting(d.key, TrendJson.encodeToJsonElement(TopicList, list.mapIndexed { j, x -> if (j == i) t else x }), reset)
    list.forEachIndexed { i, t ->
        Card {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Switch(
                    checked = t.enabled, onCheckedChange = { put(i, t.copy(enabled = it)) }, enabled = d.phoneEditable,
                    colors = SwitchDefaults.colors(checkedTrackColor = c.pos, checkedThumbColor = c.raised), modifier = Modifier.testTag("topic-on-${t.id}"),
                )
                Column(Modifier.weight(1f)) {
                    TextBox("topic-label-${t.id}", t.label, gen, d.phoneEditable, minLines = 1, placeholder = "Tên, ví dụ: Tài chính cá nhân") { put(i, t.copy(label = it)) }
                }
                if (d.phoneEditable) TextButton(onClick = { onDelete(Deleting(d.key, i, t.label.ifBlank { "chưa đặt tên" })) }, modifier = Modifier.testTag("del-topic-${t.id}")) { Text("Xoá", color = c.neg) }
            }
            TextBox("topic-q-${t.id}", t.queries.joinToString("\n"), gen, d.phoneEditable, minLines = 2, placeholder = "topic:personal-finance created:>{d14} stars:>=5", label = "Query GitHub, mỗi dòng một query") {
                put(i, t.copy(queries = lines(it).map { e -> e.jsonPrimitive.content }))
            }
            TextBox("topic-k-${t.id}", t.keywords.joinToString(", "), gen, d.phoneEditable, minLines = 1, placeholder = "budget, expense", label = "Từ khoá ưu tiên, cách nhau bằng dấu phẩy") {
                put(i, t.copy(keywords = it.split(",").map { k -> k.trim() }.filter { k -> k.isNotEmpty() }))
            }
            Text(if (t.id.startsWith(SettingRules.NEW_TOPIC)) "Chủ đề mới: mã đặt theo tên khi gửi" else "Mã: ${t.id} · ${countIn(ui, t.id)} ý đã xếp vào", style = MaterialTheme.typography.bodySmall, color = c.mute)
        }
    }
    if (d.phoneEditable && list.size < (d.maxLen ?: 20)) {
        TextButton(onClick = {
            val n = (list.mapNotNull { it.id.removePrefix(SettingRules.NEW_TOPIC).toIntOrNull() }.maxOrNull() ?: 0) + 1
            on.editSetting(d.key, TrendJson.encodeToJsonElement(TopicList, list + Topic(SettingRules.NEW_TOPIC + n, "", true)), reset = true)
        }, modifier = Modifier.testTag("add-topic")) {
            Icon(Icons.Plus, null, Modifier.size(16.dp), tint = c.ink); Spacer(Modifier.width(6.dp)); Text("Thêm chủ đề", color = c.ink)
        }
    }
}

private fun countIn(ui: UiState, cat: String): Int {
    val s = ui.snapshot ?: return 0
    return (s.digest + s.kept + s.explore).distinctBy { it.id }.count { it.triage.cat == cat }
}

@Composable
private fun ProjectCards(d: SettingDef, value: JsonElement?, gen: Int, on: UiActions, onDelete: (Deleting) -> Unit) {
    val c = T.c
    val list = value?.let { runCatching { TrendJson.decodeFromJsonElement(ProjectList, it) }.getOrNull() } ?: emptyList()
    fun put(i: Int, p: Project) = on.editSetting(d.key, TrendJson.encodeToJsonElement(ProjectList, list.mapIndexed { j, x -> if (j == i) p else x }))
    if (list.isEmpty()) Text("Chưa có dự án. Thêm một dự án để Claude gợi ý cách áp dụng mỗi ý tưởng vào nó.", style = MaterialTheme.typography.bodySmall, color = c.mute)
    list.forEachIndexed { i, p ->
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { TextBox("project-name-$i", p.name, gen, d.phoneEditable, minLines = 1, placeholder = "Tên dự án") { put(i, p.copy(name = it)) } }
                if (d.phoneEditable) TextButton(onClick = { onDelete(Deleting(d.key, i, p.name.ifBlank { "chưa đặt tên" })) }, modifier = Modifier.testTag("del-project-$i")) { Text("Xoá", color = c.neg) }
            }
            TextBox("project-summary-$i", p.summary, gen, d.phoneEditable, minLines = 2, placeholder = "Dự án làm gì, cho ai") { put(i, p.copy(summary = it)) }
        }
    }
    if (d.phoneEditable && list.size < (d.maxLen ?: 10)) {
        TextButton(onClick = { on.editSetting(d.key, TrendJson.encodeToJsonElement(ProjectList, list + Project("", "")), reset = true) }, modifier = Modifier.testTag("add-project")) {
            Icon(Icons.Plus, null, Modifier.size(16.dp), tint = c.ink); Spacer(Modifier.width(6.dp)); Text("Thêm dự án", color = c.ink)
        }
    }
}

@Composable
private fun SaveBar(ui: UiState, on: UiActions) {
    val c = T.c
    val problems = ui.draftProblems
    val n = ui.draft.size
    Column(Modifier.fillMaxWidth().background(c.surface)) {
        HorizontalDivider(color = c.line)
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 10.dp).testTag("savebar"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(if (n > 0) "$n thay đổi chưa gửi" else "Chưa gửi được", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
                Text(
                    when {
                        problems.isNotEmpty() -> "Sửa ${problems.size} mục báo đỏ trước khi gửi"
                        ui.settingsErrors.isNotEmpty() -> ui.settingsErrors.first().problem
                        else -> "Gửi về PC qua cloud"
                    },
                    style = MaterialTheme.typography.bodySmall, color = if (problems.isNotEmpty() || ui.settingsErrors.isNotEmpty()) c.neg else c.mute,
                )
            }
            TextButton(onClick = on::discardSettings, modifier = Modifier.testTag("settings-discard")) { Text("Bỏ", color = c.ink2) }
            Button(
                onClick = on::saveSettings, enabled = n > 0 && problems.isEmpty(), shape = RoundedCornerShape(7.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.ink, contentColor = c.bg),
                modifier = Modifier.testTag("settings-save"),
            ) { Text("Gửi") }
        }
    }
}

/** Destructive: cancel on the left, the red action on the right (CLAUDE.md). */
@Composable
private fun ConfirmDelete(title: String, text: String, onCancel: () -> Unit, onConfirm: () -> Unit) {
    val c = T.c
    AlertDialog(
        onDismissRequest = onCancel,
        containerColor = c.raised,
        title = { Text(title, color = c.ink) },
        text = { Text(text, color = c.ink2) },
        dismissButton = { TextButton(onClick = onCancel, modifier = Modifier.testTag("delete-cancel")) { Text("Không", color = c.ink) } },
        confirmButton = { TextButton(onClick = onConfirm, modifier = Modifier.testTag("delete-confirm")) { Text("Xoá", color = c.neg, fontWeight = FontWeight.SemiBold) } },
    )
}

/** Explore: one chip per category the PC scans, plus "Tất cả". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoryChips(ui: UiState, on: UiActions) {
    val c = T.c
    val cats = ui.snapshot?.settings?.categories?.filter { it.active }.orEmpty()
    if (cats.isEmpty()) return
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 6.dp, end = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        (listOf<Pair<String?, String>>(null to "Tất cả") + cats.map { it.id to it.label }).forEach { (id, label) ->
            FilterChip(
                selected = ui.cat == id, onClick = { on.category(id) }, label = { Text(label) },
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = c.accentSoft, selectedLabelColor = c.ink, labelColor = c.ink2),
                modifier = Modifier.testTag("cat-${id ?: "all"}"),
            )
        }
    }
}
