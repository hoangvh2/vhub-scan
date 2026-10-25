package com.vh.trend.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The PC's view, identical over the LAN (GET /api/snapshot) and in Firestore (field `payload`). Contract: docs/SYNC.md. */
@Serializable
data class Snapshot(
    val schema: Int,
    val generatedAt: String,
    val day: String? = null,
    val digest: List<Item> = emptyList(),
    val kept: List<Item> = emptyList(),
    val explore: List<Item> = emptyList(),
    val health: Health,
    /** The PC's settings page; absent from PCs older than the settings page. */
    val settings: SettingsSnapshot? = null,
) {
    fun find(id: String): Item? = digest.firstOrNull { it.id == id } ?: kept.firstOrNull { it.id == id } ?: explore.firstOrNull { it.id == id }

    companion object {
        const val SCHEMA = 1
    }
}

@Serializable
data class Item(
    val id: String,
    val title: String,
    val description: String = "",
    val url: String = "",
    val author: String? = null,
    val license: String? = null,
    val topics: List<String> = emptyList(),
    val stage: String = "",
    val userState: String = "new",
    val triage: Triage = Triage(),
    val heuristic: Double? = null,
    val card: Card? = null,
    val stars: Int? = null,
    val points: Int? = null,
    val sources: List<String> = emptyList(),
    val firstSeen: String = "",
    val shownAt: String? = null,
    val shownReason: String? = null,
    val series: List<Int> = emptyList(),
) {
    /** Stars for GitHub, points for Hacker News. */
    val metric: Pair<Int, String>? get() = stars?.let { it to "sao" } ?: points?.let { it to "điểm" }
}

@Serializable
data class Triage(val score: Int? = null, val cat: String? = null, val why: String? = null)

@Serializable
data class Card(val what: String, val learn: String, val apply: List<Apply> = emptyList(), val effort: String = "M", val risk: String = "")

@Serializable
data class Apply(val project: String, val how: String)

@Serializable
data class Health(val lastRun: LastRun? = null, val tokens: Tokens = Tokens(), val counts: Map<String, Int> = emptyMap())

@Serializable
data class LastRun(
    val startedAt: String,
    val finishedAt: String? = null,
    val status: String,
    val error: String? = null,
    val collected: Int = 0,
    val created: Int = 0,
    val merged: Int = 0,
    val triaged: Int = 0,
    val carded: Int = 0,
    val digest: Int = 0,
    val llmCalls: Int = 0,
    val cacheHits: Int = 0,
    val dropped: Map<String, Int> = emptyMap(),
    val degraded: List<String> = emptyList(),
    val sourceErrors: List<String> = emptyList(),
)

@Serializable
data class Tokens(val used: Int = 0, val limit: Int = 1, val calls: Int = 0, val costUsd: Double = 0.0)

/** What the user did; mirrors the PC's USER_ACTIONS. */
enum class Action(val wire: String, val state: String) {
    Keep("keep", "kept"), Skip("skip", "skipped"), Snooze("snooze", "snoozed"), Trying("trying", "trying"), Done("done", "done"), Reset("reset", "new");

    companion object {
        /** The action that puts an item back into [state] (for Undo). */
        fun restoring(state: String): Action = entries.firstOrNull { it.state == state } ?: Reset
    }
}

/** A queued action, sent to the PC directly (LAN) or through the Firestore inbox. */
@Serializable
data class Event(val id: String, val entityId: String, val action: String, val at: Long, val days: Int? = null)

val TrendJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
}
