package com.vh.trend.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.text.Normalizer

/**
 * The PC's settings page, as the snapshot carries it (packages/pipeline/src/settings.ts). The PC owns the catalogue:
 * labels, help, limits and which settings the phone may change all come from here, so a new setting needs no app update.
 */
@Serializable
data class SettingsSnapshot(
    val groups: List<SettingGroup> = emptyList(),
    val defs: List<SettingDef> = emptyList(),
    val values: JsonObject = JsonObject(emptyMap()),
    val defaults: JsonObject = JsonObject(emptyMap()),
    val rev: String = "",
    val estimate: RunEstimate = RunEstimate(),
    val categories: List<Category> = emptyList(),
    /** The last change the PC took from the phone or the hosted page, with its result. */
    val remote: RemoteSettingsResult? = null,
) {
    fun def(key: String): SettingDef? = defs.firstOrNull { it.key == key }
    fun label(cat: String?): String? = cat?.let { c -> categories.firstOrNull { it.id == c }?.label }
}

@Serializable
data class SettingGroup(val id: String, val label: String, val help: String = "")

@Serializable
data class SettingOption(val value: String, val label: String)

@Serializable
data class SettingDef(
    val key: String,
    val group: String,
    val label: String,
    val help: String = "",
    val type: String,
    val min: Double? = null,
    val max: Double? = null,
    val step: Double? = null,
    val unit: String? = null,
    val options: List<SettingOption> = emptyList(),
    val custom: Boolean = false,
    val maxLen: Int? = null,
    val impact: List<String> = emptyList(),
    val advanced: Boolean = false,
    val editable: Boolean = true,
    val remote: Boolean = true,
    val applies: String = "next-scan",
) {
    /** False: shown on the phone, but changed only on the PC (config.json or the PC's dashboard). */
    val phoneEditable: Boolean get() = editable && remote
}

@Serializable
data class RunEstimate(val searches: Int = 0, val triageCalls: Int = 0, val cardCalls: Int = 0, val tokens: Int = 0)

@Serializable
data class Category(val id: String, val label: String, val active: Boolean = true)

@Serializable
data class SettingError(val key: String = "", val problem: String)

@Serializable
data class RemoteSettingsResult(
    val id: String,
    val sentAt: Long,
    val appliedAt: String,
    val device: String? = null,
    val ok: Boolean,
    val changed: List<String> = emptyList(),
    val errors: List<SettingError> = emptyList(),
)

@Serializable
data class Topic(val id: String, val label: String, val enabled: Boolean = true, val queries: List<String> = emptyList(), val keywords: List<String> = emptyList())

@Serializable
data class Project(val name: String, val summary: String)

/** The same checks the PC runs before it accepts a change (settings.ts validateValue), so mistakes show before sending. */
object SettingRules {
    private val TOPIC_ID = Regex("^[a-z0-9][a-z0-9-]{0,31}$")
    private val MODEL = Regex("^[A-Za-z0-9][A-Za-z0-9.:\\-\\[\\]]{0,79}$")

    /** Why [v] is not valid for [d], or null when it is. */
    fun problem(d: SettingDef, v: JsonElement): String? = when (d.type) {
        "int", "number" -> {
            val n = (v as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
            when {
                n == null || !n.isFinite() -> "phải là số"
                d.type == "int" && n != Math.floor(n) -> "phải là số nguyên"
                d.min != null && n < d.min -> "nhỏ nhất là ${fmt(d.min)}"
                d.max != null && n > d.max -> "lớn nhất là ${fmt(d.max)}"
                else -> null
            }
        }
        "bool" -> if ((v as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull != null) null else "phải là bật hoặc tắt"
        "text" -> {
            val s = (v as? JsonPrimitive)?.takeIf { it.isString }?.content
            when {
                s == null -> "phải là chữ"
                s.isBlank() -> "không được để trống"
                s.length > (d.maxLen ?: 600) -> "tối đa ${d.maxLen ?: 600} ký tự"
                else -> null
            }
        }
        "list" -> stringList(v, d.maxLen ?: 100, 200, "mục")
        "choice" -> {
            val s = (v as? JsonPrimitive)?.takeIf { it.isString }?.content
            when {
                s == null -> "phải chọn một giá trị"
                d.options.any { it.value == s } -> null
                d.custom && MODEL.matches(s) -> null
                else -> "chọn một trong: " + d.options.joinToString(", ") { it.label }
            }
        }
        "topics" -> topics(v, d.maxLen ?: 20)
        "projects" -> projects(v, d.maxLen ?: 10)
        else -> null
    }

    private fun stringList(v: JsonElement, maxItems: Int, maxChars: Int, what: String): String? {
        val a = v as? JsonArray ?: return "phải là danh sách"
        if (a.size > maxItems) return "tối đa $maxItems $what"
        for (x in a) {
            val s = (x as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return "mỗi mục phải là chữ"
            if (s.isBlank()) return "có mục để trống"
            if (s.length > maxChars) return "mỗi mục tối đa $maxChars ký tự"
        }
        return null
    }

    private fun topics(v: JsonElement, max: Int): String? {
        val a = v as? JsonArray ?: return "phải là danh sách chủ đề"
        if (a.size > max) return "tối đa $max chủ đề"
        val ids = mutableSetOf<String>()
        a.forEachIndexed { i, raw ->
            val n = "chủ đề ${i + 1}"
            val t = raw as? JsonObject ?: return "$n: sai định dạng"
            val extra = t.keys - setOf("id", "label", "enabled", "queries", "keywords")
            if (extra.isNotEmpty()) return "$n: không biết trường ${extra.joinToString(", ")}"
            val id = t.str("id")
            if (id == null || !TOPIC_ID.matches(id)) return "$n: mã chỉ gồm chữ thường không dấu, số và dấu gạch ngang (tối đa 32 ký tự)"
            if (id == "other") return "$n: mã \"other\" dành cho nhóm Khác"
            if (!ids.add(id)) return "$n: mã \"$id\" bị trùng"
            val label = t.str("label")
            if (label == null || label.isBlank() || label.length > 40) return "$n: tên từ 1 đến 40 ký tự"
            if ((t["enabled"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == null) return "$n: thiếu bật/tắt"
            stringList(t["queries"] ?: JsonNull, 10, 200, "query")?.let { return "$n ($label), query: $it" }
            stringList(t["keywords"] ?: JsonNull, 40, 60, "từ khoá")?.let { return "$n ($label), từ khoá: $it" }
        }
        return null
    }

    private fun projects(v: JsonElement, max: Int): String? {
        val a = v as? JsonArray ?: return "phải là danh sách dự án"
        if (a.size > max) return "tối đa $max dự án"
        a.forEachIndexed { i, raw ->
            val p = raw as? JsonObject ?: return "dự án ${i + 1}: sai định dạng"
            if (p.keys.any { it != "name" && it != "summary" }) return "dự án ${i + 1}: chỉ có tên và mô tả"
            val name = p.str("name")
            if (name == null || name.isBlank() || name.length > 40) return "dự án ${i + 1}: tên từ 1 đến 40 ký tự"
            val summary = p.str("summary")
            if (summary == null || summary.isBlank() || summary.length > 300) return "dự án ${i + 1}: mô tả từ 1 đến 300 ký tự"
        }
        return null
    }

    private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun fmt(d: Double) = if (d == Math.floor(d)) d.toLong().toString() else d.toString()

    /** A topic id from its name, like the PC's slugify: "Tài chính cá nhân" -> "tai-chinh-ca-nhan". */
    fun slug(label: String): String {
        val plain = Normalizer.normalize(label, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").replace(Regex("[đĐ]"), "d").lowercase()
        return plain.replace(Regex("[^a-z0-9]+"), "-").trim('-').take(32).trimEnd('-').ifEmpty { "chu-de" }
    }

    /** Id of a topic added on the phone until it is sent; then [withTopicIds] names it after its label. */
    const val NEW_TOPIC = "moi-"

    /** Gives topics added on the phone their real id (from the label, unique), as the PC's page does when it saves. */
    fun withTopicIds(topics: List<Topic>): List<Topic> {
        val taken = topics.filter { !it.id.startsWith(NEW_TOPIC) }.map { it.id }.toMutableSet().apply { add("other") }
        return topics.map { t ->
            if (!t.id.startsWith(NEW_TOPIC)) return@map t
            val base = slug(t.label)
            var id = base
            var n = 2
            while (id in taken) id = base.take(29).trimEnd('-') + "-" + n++
            taken += id
            t.copy(id = id)
        }
    }

    /** How a value reads in one line ("Mặc định: ..."). */
    fun brief(d: SettingDef, v: JsonElement?): String = when {
        v == null || v is JsonNull -> "trống"
        v is JsonArray -> if (v.isEmpty()) "trống" else "${v.size} mục"
        d.type == "bool" -> if (v.jsonPrimitive.booleanOrNull == true) "bật" else "tắt"
        d.type == "choice" -> d.options.firstOrNull { it.value == v.jsonPrimitive.content }?.label ?: v.jsonPrimitive.content
        else -> v.jsonPrimitive.content.let { s -> if (s.length > 40) s.take(40) + "…" else s } + (d.unit?.let { " $it" } ?: "")
    }
}
