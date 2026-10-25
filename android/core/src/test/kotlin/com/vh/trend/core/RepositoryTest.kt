package com.vh.trend.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
    /** The rules refuse settings documents (403), as they do for an oversized or malformed one. */
    var rejectSettings = false

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
                    if (rejectSettings && r.url.contains("/settingsInbox?")) return@Http HttpResponse(403, "{}")
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

    // ---- settings edited on the phone ----

    /** The contract snapshot as the PC would publish it after applying a phone change made at [sentAt]. */
    private fun pcApplied(net: FakeNet, sentAt: Long, values: Map<String, JsonElement>): String {
        val root = TrendJson.parseToJsonElement(net.contract).jsonObject
        val st = root["settings"]!!.jsonObject
        val remote = JsonObject(st["remote"]!!.jsonObject + mapOf("id" to JsonPrimitive("sevt_x"), "sentAt" to JsonPrimitive(sentAt)))
        val settings = JsonObject(st + mapOf("values" to JsonObject(st["values"]!!.jsonObject + values), "remote" to remote))
        return JsonObject(root + mapOf("settings" to settings, "generatedAt" to JsonPrimitive("2026-10-27T00:00:00.000Z"))).toString()
    }

    private fun digest(s: SyncState) = s.snapshot!!.settings!!.values["funnel.digestSize"]!!.jsonPrimitive.int

    @Test
    fun theSettingsPageArrivesWithTheSnapshot() = runTest {
        val r = signedIn(FakeNet())
        val st = r.refresh().snapshot!!.settings!!
        assertTrue(st.defs.size > 30)
        assertTrue(st.groups.map { it.id }.containsAll(listOf("scan", "filter", "ai", "projects", "system")))
        assertEquals(false, st.def("llm.command")!!.phoneEditable)
        assertEquals(false, st.def("server.port")!!.phoneEditable)
        assertEquals("Năng suất cá nhân", st.label("productivity"))
        assertTrue(st.remote!!.ok)
    }

    @Test
    fun aSettingsChangeShowsAtOnceReachesTheInboxOnceAndClearsWhenThePcAppliesIt() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        val before = r.refresh()
        assertEquals(5, digest(before))
        net.cloudUp = false
        val (shown, errors) = r.changeSettings(JsonObject(mapOf("funnel.digestSize" to JsonPrimitive(9))))
        assertTrue(errors.isEmpty())
        assertEquals(9, digest(shown))
        assertEquals(1, shown.settingsWaiting.size)
        // Offline: still waiting, still shown.
        assertEquals(9, digest(r.refresh()))
        net.cloudUp = true
        clock += 60_000
        val sent = r.refresh()
        val body = net.inbox["sevt_1_00000000"]!!
        assertTrue(net.log.any { it.endsWith("/owners/owner/settingsInbox?documentId=sevt_1_00000000") })
        assertTrue(body.contains(""""patch":{"stringValue":"{\"funnel.digestSize\":9}"}"""), body)
        assertTrue(body.contains(""""baseRev":{"stringValue":"${before.snapshot!!.settings!!.rev}"}""") && body.contains(""""device":{"stringValue":"test"}"""), body)
        assertTrue(body.contains(""""at":{"integerValue":"$clock"}"""), body) // stamped when it left the phone
        // The PC has not taken it yet: the phone keeps showing the new value.
        assertEquals(9, digest(sent))
        assertTrue(sent.settingsWaiting.single().sent)
        // Sending again sends nothing new.
        r.refresh()
        assertEquals(1, net.inbox.keys.count { it.startsWith("s") })
        // The PC applied it and published.
        net.cloudSnapshot = pcApplied(net, clock, mapOf("funnel.digestSize" to JsonPrimitive(9)))
        val done = r.refresh()
        assertTrue(done.settingsWaiting.isEmpty())
        assertEquals(9, digest(done))
    }

    @Test
    fun editsMadeBeforeSendingTravelAsOneChange() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        r.refresh()
        net.cloudUp = false
        r.changeSettings(JsonObject(mapOf("funnel.digestSize" to JsonPrimitive(7))))
        val (s, _) = r.changeSettings(JsonObject(mapOf("funnel.digestSize" to JsonPrimitive(8), "sources.hn.enabled" to JsonPrimitive(false))))
        assertEquals(1, s.settingsWaiting.size)
        assertEquals(8, digest(s))
        net.cloudUp = true
        r.refresh()
        val body = net.inbox.values.single { it.contains("patch") }
        assertTrue(body.contains("funnel.digestSize\\\":8") && body.contains("sources.hn.enabled\\\":false"), body)
    }

    @Test
    fun invalidValuesAreRefusedOnThePhoneWithThePcsWording() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        r.refresh()
        suspend fun problems(k: String, v: JsonElement) = r.changeSettingsBlocking(JsonObject(mapOf(k to v)))
        assertEquals("lớn nhất là 30", problems("funnel.digestSize", JsonPrimitive(99)))
        assertEquals("phải là số nguyên", problems("funnel.digestSize", JsonPrimitive(2.5)))
        assertEquals("chỉ sửa được trong config.json trên PC", problems("llm.command", JsonPrimitive("/tmp/evil")))
        assertEquals("chỉ sửa được trên dashboard của PC", problems("server.port", JsonPrimitive(4000)))
        assertEquals("không có cài đặt này", problems("nope", JsonPrimitive(1)))
        val topic = { id: String -> JsonObject(mapOf("id" to JsonPrimitive(id), "label" to JsonPrimitive("Khác"), "enabled" to JsonPrimitive(true), "queries" to JsonArray(emptyList()), "keywords" to JsonArray(emptyList()))) }
        assertEquals("chủ đề 1: mã \"other\" dành cho nhóm Khác", problems("topics", JsonArray(listOf(topic("other")))))
        assertEquals("chủ đề 2: mã \"a\" bị trùng", problems("topics", JsonArray(listOf(topic("a"), topic("a")))))
        assertEquals("có mục để trống", problems("scope.exclude", JsonArray(listOf(JsonPrimitive(" ")))))
        assertTrue(r.state().settingsWaiting.isEmpty())
        assertTrue(net.inbox.isEmpty())
    }

    @Test
    fun aChangeTheCloudRefusesIsDroppedWithAnExplanation() = runTest {
        val net = FakeNet().apply { rejectSettings = true }
        val r = signedIn(net)
        r.refresh()
        r.changeSettings(JsonObject(mapOf("funnel.digestSize" to JsonPrimitive(9))))
        val s = r.refresh()
        assertTrue(s.settingsWaiting.isEmpty())
        assertEquals(5, digest(s))
        assertTrue(s.error!!.contains("từ chối"), s.error)
    }

    @Test
    fun settingsCannotBeChangedBeforeThePcSendsThem() = runTest {
        val net = FakeNet().apply { cloudSnapshot = contract.replace("\"settings\"", "\"settingsFromTheFuture\"") }
        val r = signedIn(net)
        assertNull(r.refresh().snapshot!!.settings)
        val (_, errors) = r.changeSettings(JsonObject(mapOf("funnel.digestSize" to JsonPrimitive(9))))
        assertTrue(errors.single().problem.contains("npm run sync"))
    }

    @Test
    fun signOutForgetsUnsentSettings() = runTest {
        val net = FakeNet()
        val r = signedIn(net)
        r.refresh()
        net.cloudUp = false
        r.changeSettings(JsonObject(mapOf("funnel.digestSize" to JsonPrimitive(9))))
        r.signOut()
        assertNull(r.signIn("google.id.token"))
        net.cloudUp = true
        assertTrue(r.refresh().settingsWaiting.isEmpty())
        assertTrue(net.inbox.isEmpty())
    }

    @Test
    fun topicIdsFollowThePcsRule() {
        assertEquals("tai-chinh-ca-nhan", SettingRules.slug("Tài chính cá nhân"))
        assertEquals("doi-song", SettingRules.slug("Đời sống!"))
        assertEquals("chu-de", SettingRules.slug("  ***  "))
        assertEquals(32, SettingRules.slug("a".repeat(50)).length)
        val named = SettingRules.withTopicIds(listOf(Topic("productivity", "Năng suất"), Topic("moi-1", "Năng suất"), Topic("moi-2", "Khác"), Topic("moi-3", "Other")))
        assertEquals(listOf("productivity", "nang-suat", "khac", "other-2"), named.map { it.id })
    }

    private suspend fun TrendRepository.changeSettingsBlocking(patch: JsonObject) = changeSettings(patch).second.joinToString { it.problem }
}
