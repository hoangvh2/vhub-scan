package com.vh.trend.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** The PC writes docs/contract/snapshot.v1.json from its own tests; the app must read it without loss. */
class ContractTest {
    private val file = File(System.getProperty("contractDir"), "snapshot.v1.json")

    @Test
    fun readsTheSnapshotThePcProduces() {
        val s = TrendJson.decodeFromString(Snapshot.serializer(), file.readText())
        assertEquals(Snapshot.SCHEMA, s.schema)
        assertEquals("2026-10-24", s.day)
        assertTrue(s.digest.isNotEmpty())
        val first = s.digest.first()
        assertNotNull(first.card)
        assertTrue(first.series.isNotEmpty())
        assertTrue(first.sources.isNotEmpty())
        assertNotNull(first.triage.score)
        assertTrue(s.kept.any { it.id == "github:lifehub/planner" && it.userState == "kept" })
        assertEquals("ok", s.health.lastRun?.status)
        assertEquals(1, s.health.counts["kept"])
    }

    @Test
    fun toleratesFieldsAddedLater() {
        val text = file.readText().replaceFirst("{", "{\"futureField\": [1,2,3],")
        assertEquals(Snapshot.SCHEMA, TrendJson.decodeFromString(Snapshot.serializer(), text).schema)
    }
}
