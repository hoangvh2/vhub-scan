package com.vh.trend.core

import kotlinx.coroutines.test.runTest
import java.io.File
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A fake Google/Firebase: Auth and a Firestore that admits one address, each switchable. */
class FakeNet {
    val contract = File(System.getProperty("contractDir"), "snapshot.v1.json").readText()
    var cloudUp = true
    var allowed = true
    var authStatus = 200
    var refreshStatus = 200
    var cloudSnapshot: String? = contract
    val inbox = mutableMapOf<String, String>()
    val log = mutableListOf<String>()
    val bodies = mutableListOf<String>()
    var refreshCalls = 0

    val http = Http { r ->
        log += "${r.method} ${r.url}"
        r.body?.let { bodies += it }
        when {
            r.url.startsWith("https://identitytoolkit") ->
                if (authStatus == 200) HttpResponse(200, """{"idToken":"id1","refreshToken":"rt1","expiresIn":"3600","email":"me@example.com"}""")
                else HttpResponse(authStatus, """{"error":{"message":"CONFIGURATION_NOT_FOUND"}}""")
            r.url.startsWith("https://securetoken") -> { refreshCalls++; if (refreshStatus == 200) HttpResponse(200, """{"id_token":"id2","refresh_token":"rt2","expires_in":"3600"}""") else HttpResponse(refreshStatus, "{}") }
            r.url.startsWith("https://firestore") -> {
                if (!cloudUp) throw IOException("offline")
                if (!allowed) return@Http HttpResponse(403, "{}")
                if (r.method == "GET") cloudSnapshot?.let { HttpResponse(200, """{"fields":{"payload":{"stringValue":${kotlinx.serialization.json.JsonPrimitive(it)}}}}""") } ?: HttpResponse(404, "{}")
                else {
                    val id = r.url.substringAfter("documentId=")
                    if (inbox.containsKey(id)) HttpResponse(409, "{}") else { inbox[id] = r.body!!; HttpResponse(200, "{}") }
                }
            }
            else -> error("unexpected ${r.url}")
        }
    }
}

class RepositoryTest {
    private var clock = 1_793_000_000_000L // after the contract snapshot was generated
    private var ids = 0
    private val settings = CloudSettings("vhub-trend-1", "AIzaKey", "123-abc.apps.googleusercontent.com")
    private fun repo(net: FakeNet, kv: KeyValue = MemoryKeyValue(), s: CloudSettings = settings) =
        TrendRepository(net.http, kv, s, now = { clock }, newId = { "evt_${++ids}_00000000" }, device = "test")

    private suspend fun signedIn(net: FakeNet, kv: KeyValue = MemoryKeyValue()) = repo(net, kv).also { assertNull(it.signIn("google.id.token")) }

    @Test
    fun signInTurnsTheGoogleTokenIntoASession() = runTest {
        val net = FakeNet()
        val r = repo(net)
        assertFalse(r.state().signedIn)
        assertNull(r.signIn("google.id.token"))
        val s = r.state()
        assertTrue(s.signedIn)
        assertEquals("me@example.com", s.email)
        val body = net.bodies.single()
        assertTrue(body.contains("id_token=google.id.token&providerId=google.com"), body)
        assertEquals(listOf("POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=AIzaKey"), net.log)
    }

    @Test
    fun aFailedSignInSaysWhatToFixAndLeavesSignedOut() = runTest {
        val net = FakeNet().apply { authStatus = 400 }
        val r = repo(net)
        assertTrue(r.signIn("x")!!.contains("infra/README.md"))
        assertFalse(r.state().signedIn)
    }

    @Test
    fun itReadsTheCloudCopyThePcPublished() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        val s = r.refresh()
        assertEquals(Source.Cloud, s.source)
        assertTrue(s.snapshot!!.digest.isNotEmpty())
        assertTrue(net.log.any { it == "GET https://firestore.googleapis.com/v1/projects/vhub-trend-1/databases/(default)/documents/owners/owner/snapshot/latest" })
    }

    @Test
    fun withTheCloudUnreachableItShowsTheLastCopyAndSaysWhy() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        r.refresh()
        net.cloudUp = false
        val s = r.refresh()
        assertEquals(Source.Cloud, s.source) // still the copy fetched earlier
        assertTrue(s.snapshot!!.digest.isNotEmpty())
        assertTrue(s.error!!.contains("bản lưu"))
    }

    @Test
    fun beforeThePcPublishesAnythingItSaysSo() = runTest {
        val net = FakeNet().apply { cloudSnapshot = null }
        val r = signedIn(net)
        val s = r.refresh()
        assertNull(s.snapshot)
        assertTrue(s.error!!.contains("npm run sync"))
    }

    @Test
    fun anActionShowsAtOnceReachesTheInboxOnceAndStaysVisibleUntilThePcPublishes() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        val item = r.refresh().snapshot!!.digest.first()
        net.cloudUp = false
        val shown = r.act(item, Action.Snooze, 3)
        assertEquals("snoozed", shown.snapshot!!.find(item.id)!!.userState)
        assertEquals(1, shown.pending)
        net.cloudUp = true
        val s = r.refresh()
        assertEquals(0, s.pending)
        val body = net.inbox["evt_1_00000000"]!!
        assertTrue(body.contains(""""action":{"stringValue":"snooze"}""") && body.contains(""""days":{"integerValue":"3"}""") && body.contains(""""device":{"stringValue":"test"}"""))
        // The cloud copy is older than the action, so the action stays applied on screen.
        assertEquals("snoozed", s.snapshot!!.find(item.id)!!.userState)
        // A retry after a lost reply is harmless (409 = already stored).
        val again = CloudClient(net.http, CloudAuth(net.http, "k", MemoryKeyValue().apply { put("cloud.refreshToken", "x") }), "vhub-trend-1", "owner")
        assertTrue(again.send(Event("evt_1_00000000", item.id, "snooze", clock, 3)))
    }

    @Test
    fun keptActionsReachTheInboxInOrderOnceTheCloudAnswers() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        val items = r.refresh().snapshot!!.digest
        net.cloudUp = false
        r.act(items[0], Action.Keep)
        r.act(items[1], Action.Skip)
        assertEquals(2, r.refresh().pending)
        net.cloudUp = true
        assertEquals(0, r.refresh().pending)
        assertEquals(listOf("keep", "skip"), net.inbox.values.map { it.substringAfter("\"action\":{\"stringValue\":\"").substringBefore("\"") })
    }

    @Test
    fun undoRestoresThePreviousState() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        val item = r.refresh().snapshot!!.digest.first()
        r.act(item, Action.Skip)
        val back = r.act(item, Action.restoring(item.userState))
        assertEquals(item.userState, back.snapshot!!.find(item.id)!!.userState)
    }

    @Test
    fun anAccountOffTheAllowlistGetsAnExplanationNotAnEmptyScreen() = runTest {
        val net = FakeNet().apply { allowed = false }
        val r = signedIn(net)
        val s = r.refresh()
        assertTrue(s.error!!.contains("me@example.com") && s.error!!.contains("allowed_emails"), s.error)
        assertNull(s.snapshot)
        assertTrue(s.signedIn) // the person can sign out and pick another account
    }

    @Test
    fun aRevokedSessionAsksToSignInAgain() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        r.refresh()
        clock += 3_600_000
        net.refreshStatus = 400
        val s = r.refresh()
        assertFalse(s.signedIn)
        assertTrue(s.error!!.contains("Đăng nhập lại"))
    }

    @Test
    fun idTokenIsRefreshedOnlyWhenItExpires() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        r.refresh(); r.refresh()
        assertEquals(0, net.refreshCalls)
        clock += 3_600_000
        r.refresh()
        assertEquals(1, net.refreshCalls)
    }

    @Test
    fun signOutForgetsEverything() = runTest {
        val net = FakeNet()
        val kv = MemoryKeyValue()
        val r = signedIn(net, kv)
        r.act(r.refresh().snapshot!!.digest.first(), Action.Keep)
        r.signOut()
        val s = r.state()
        assertFalse(s.signedIn)
        assertNull(s.email)
        assertNull(s.snapshot)
        assertEquals(0, s.pending)
    }

    @Test
    fun aBuildWithoutCloudSettingsSaysSoAndNeverCallsTheNetwork() = runTest {
        val net = FakeNet()
        val r = repo(net, s = CloudSettings("", "", ""))
        assertFalse(r.state().configured)
        r.refresh()
        assertTrue(net.log.isEmpty())
    }
}
