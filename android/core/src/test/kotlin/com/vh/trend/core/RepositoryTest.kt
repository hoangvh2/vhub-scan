package com.vh.trend.core

import kotlinx.coroutines.test.runTest
import java.io.File
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A fake network: a PC on the LAN and a Firestore, each switchable on and off. */
class FakeNet {
    val contract = File(System.getProperty("contractDir"), "snapshot.v1.json").readText()
    var pcUp = true
    var cloudUp = true
    var pcToken = TOKEN
    var pcSnapshot = contract
    var cloudSnapshot: String? = contract.replace("2026-10-24T01:00:00.000Z", "2026-10-24T01:00:00.000Z")
    val pcFeedback = mutableListOf<String>()
    val inbox = mutableMapOf<String, String>()
    val log = mutableListOf<String>()
    var refreshCalls = 0

    val http = Http { r ->
        log += "${r.method} ${r.url}"
        when {
            r.url.startsWith(LAN) -> {
                if (!pcUp) throw IOException("unreachable")
                if (r.headers["authorization"] != "Bearer $pcToken") return@Http HttpResponse(401, "{}")
                if (r.url.endsWith("/api/snapshot")) HttpResponse(200, pcSnapshot)
                else { pcFeedback += r.body!!; HttpResponse(200, """{"ok":true}""") }
            }
            r.url.startsWith("https://identitytoolkit") -> HttpResponse(200, """{"idToken":"id1","refreshToken":"rt1","expiresIn":"3600"}""")
            r.url.startsWith("https://securetoken") -> { refreshCalls++; HttpResponse(200, """{"id_token":"id2","refresh_token":"rt2","expires_in":"3600"}""") }
            r.url.startsWith("https://firestore") -> {
                if (!cloudUp) throw IOException("offline")
                if (r.method == "GET") cloudSnapshot?.let { HttpResponse(200, """{"fields":{"payload":{"stringValue":${kotlinx.serialization.json.JsonPrimitive(it)}}}}""") } ?: HttpResponse(404, "{}")
                else {
                    val id = r.url.substringAfter("documentId=")
                    if (inbox.containsKey(id)) HttpResponse(409, "{}") else { inbox[id] = r.body!!; HttpResponse(200, "{}") }
                }
            }
            else -> error("unexpected ${r.url}")
        }
    }

    companion object {
        const val LAN = "http://192.168.1.5:4173"
        const val TOKEN = "97lYouv4ARj1agxafF3YkTwf7D-V0mdM"
        val CODE = PairCode(1, listOf(LAN), TOKEN, PairCode.Firebase("vhub-trend-1", "AIzaKey", "owner", "custom.token.jwt"))
    }
}

class RepositoryTest {
    private var clock = 1_793_000_000_000L // after the contract snapshot was generated
    private var ids = 0
    private fun repo(net: FakeNet, kv: KeyValue = MemoryKeyValue()) =
        TrendRepository(net.http, kv, now = { clock }, newId = { "evt_${++ids}_00000000" }, device = "test")

    @Test
    fun atHomeItReadsThePcDirectly() = runTest {
        val net = FakeNet()
        val r = repo(net)
        assertNull(r.pair(FakeNet.CODE))
        val s = r.refresh()
        assertEquals(Source.Lan, s.source)
        assertEquals(FakeNet.LAN, s.lanUrl)
        assertTrue(s.snapshot!!.digest.isNotEmpty())
        assertTrue(net.log.none { it.contains("firestore") })
    }

    @Test
    fun awayFromHomeItReadsTheCloudCopy() = runTest {
        val net = FakeNet().apply { pcUp = false }
        val r = repo(net)
        r.pair(FakeNet.CODE)
        val s = r.refresh()
        assertEquals(Source.Cloud, s.source)
        assertTrue(net.log.any { it == "GET https://firestore.googleapis.com/v1/projects/vhub-trend-1/databases/(default)/documents/owners/owner/snapshot/latest" })
    }

    @Test
    fun withNothingReachableItShowsTheLastCopyAndSaysWhy() = runTest {
        val net = FakeNet()
        val kv = MemoryKeyValue()
        val r = repo(net, kv)
        r.pair(FakeNet.CODE)
        r.refresh()
        net.pcUp = false; net.cloudUp = false
        val s = r.refresh()
        assertEquals(Source.Lan, s.source) // still the copy fetched from the PC earlier
        assertTrue(s.snapshot!!.digest.isNotEmpty())
        assertTrue(s.error!!.isNotBlank())
    }

    @Test
    fun anActionShowsAtOnceAndReachesThePcOverTheLan() = runTest {
        val net = FakeNet()
        val r = repo(net)
        r.pair(FakeNet.CODE)
        val item = r.refresh().snapshot!!.digest.first()
        net.pcUp = false
        val shown = r.act(item, Action.Keep)
        assertEquals("kept", shown.snapshot!!.find(item.id)!!.userState)
        assertTrue(shown.snapshot!!.kept.any { it.id == item.id })
        assertEquals(1, shown.pending)
        net.pcUp = true
        val after = r.refresh()
        assertEquals(0, after.pending)
        assertEquals(listOf("""{"id":"${item.id}","action":"keep"}"""), net.pcFeedback)
    }

    @Test
    fun awayFromHomeActionsGoToTheInboxOnceAndStayVisibleUntilThePcPublishes() = runTest {
        val net = FakeNet().apply { pcUp = false }
        val r = repo(net)
        r.pair(FakeNet.CODE)
        val item = r.refresh().snapshot!!.digest.first()
        r.act(item, Action.Snooze, 3)
        val s = r.refresh()
        assertEquals(0, s.pending)
        val body = net.inbox["evt_1_00000000"]!!
        assertTrue(body.contains(""""action":{"stringValue":"snooze"}""") && body.contains(""""days":{"integerValue":"3"}""") && body.contains(""""device":{"stringValue":"test"}"""))
        // The cloud copy is older than the action, so the action stays applied on screen.
        assertEquals("snoozed", s.snapshot!!.find(item.id)!!.userState)
        // A retry after a lost reply is harmless (409 = already stored).
        assertTrue(CloudClient(net.http, CloudAuth(net.http, "k", MemoryKeyValue().apply { put("cloud.refreshToken", "x") }), "vhub-trend-1", "owner").send(Event("evt_1_00000000", item.id, "snooze", clock, 3)))
    }

    @Test
    fun offlineActionsAreKeptInOrderUntilSomethingAnswers() = runTest {
        val net = FakeNet()
        val r = repo(net)
        r.pair(FakeNet.CODE)
        val items = r.refresh().snapshot!!.digest
        net.pcUp = false; net.cloudUp = false
        r.act(items[0], Action.Keep)
        r.act(items[1], Action.Skip)
        assertEquals(2, r.refresh().pending)
        net.pcUp = true
        assertEquals(0, r.refresh().pending)
        assertEquals(listOf("keep", "skip"), net.pcFeedback.map { it.substringAfter("\"action\":\"").substringBefore("\"") })
    }

    @Test
    fun undoRestoresThePreviousState() = runTest {
        val net = FakeNet()
        val r = repo(net)
        r.pair(FakeNet.CODE)
        val item = r.refresh().snapshot!!.digest.first()
        r.act(item, Action.Skip)
        val back = r.act(item, Action.restoring(item.userState))
        assertEquals(item.userState, back.snapshot!!.find(item.id)!!.userState)
    }

    @Test
    fun aChangedDashboardTokenAsksToPairAgain() = runTest {
        val net = FakeNet().apply { pcToken = "another-token-after-reset" }
        val r = repo(net)
        r.pair(FakeNet.CODE)
        assertTrue(r.refresh().error!!.contains("Ghép nối lại"))
    }

    @Test
    fun idTokenIsRefreshedOnlyWhenItExpires() = runTest {
        val net = FakeNet().apply { pcUp = false }
        val r = repo(net)
        r.pair(FakeNet.CODE)
        r.refresh(); r.refresh()
        assertEquals(0, net.refreshCalls)
        clock += 3_600_000
        r.refresh()
        assertEquals(1, net.refreshCalls)
    }

    @Test
    fun unpairForgetsEverything() = runTest {
        val net = FakeNet()
        val kv = MemoryKeyValue()
        val r = repo(net, kv)
        r.pair(FakeNet.CODE)
        r.refresh()
        r.unpair()
        val s = r.state()
        assertEquals(false, s.paired)
        assertNull(s.snapshot)
    }
}
