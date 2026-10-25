package com.vh.trend.ui

import com.vh.trend.core.RemoteSettingsResult
import com.vh.trend.core.SettingError
import com.vh.trend.core.SettingsChange
import com.vh.trend.core.Snapshot
import com.vh.trend.core.Source
import com.vh.trend.core.SyncState
import com.vh.trend.core.TrendJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Sample data exported from the PC dashboard's demo (packages/pipeline/test/demo) via GET /api/snapshot. */
object Fixtures {
    val snapshot: Snapshot by lazy {
        TrendJson.decodeFromString(Snapshot.serializer(), javaClass.classLoader!!.getResource("demo-snapshot.json")!!.readText())
    }
    val now: Long get() = java.time.Instant.parse(snapshot.generatedAt).toEpochMilli() + 4 * 60_000

    fun ui(
        source: Source = Source.Cloud, tab: Tab = Tab.Today, selected: String? = null, pending: Int = 0, error: String? = null,
        draft: Map<String, JsonElement> = emptyMap(), cat: String? = null, snap: Snapshot = snapshot, waiting: List<SettingsChange> = emptyList(),
    ) = UiState(
        sync = SyncState(configured = true, signedIn = true, email = "you@example.com", snapshot = snap, source = source, fetchedAt = now - 60_000, pending = pending, error = error, settingsWaiting = waiting),
        tab = tab,
        selectedId = selected,
        draft = draft,
        cat = cat,
    )

    /** The PC refused the last change from the phone (as it reports it in the snapshot). */
    val refused: Snapshot by lazy {
        val st = snapshot.settings!!
        snapshot.copy(settings = st.copy(remote = RemoteSettingsResult("sabc", now - 30 * 60_000, java.time.Instant.ofEpochMilli(now - 20 * 60_000).toString(), "Pixel 8", ok = false, errors = listOf(SettingError("funnel.digestSize", "lớn nhất là 30")))))
    }

    /** One change from this phone on its way to the PC. */
    val waiting = listOf(SettingsChange("s1", now - 3 * 60_000, JsonObject(mapOf("funnel.digestSize" to JsonPrimitive(8))), "rev", sent = true))
}
