package com.vh.trend.ui

import com.vh.trend.core.Snapshot
import com.vh.trend.core.Source
import com.vh.trend.core.SyncState
import com.vh.trend.core.TrendJson

/** Sample data exported from the PC dashboard's demo (packages/pipeline/test/demo) via GET /api/snapshot. */
object Fixtures {
    val snapshot: Snapshot by lazy {
        TrendJson.decodeFromString(Snapshot.serializer(), javaClass.classLoader!!.getResource("demo-snapshot.json")!!.readText())
    }
    val now: Long get() = java.time.Instant.parse(snapshot.generatedAt).toEpochMilli() + 4 * 60_000

    fun ui(source: Source = Source.Cloud, tab: Tab = Tab.Today, selected: String? = null, pending: Int = 0, error: String? = null) = UiState(
        sync = SyncState(configured = true, signedIn = true, email = "you@example.com", snapshot = snapshot, source = source, fetchedAt = now - 60_000, pending = pending, error = error),
        tab = tab,
        selectedId = selected,
    )
}
