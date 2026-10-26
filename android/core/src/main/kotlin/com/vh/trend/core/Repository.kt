package com.vh.trend.core

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import java.util.UUID

enum class Source { Cloud, Cache }

data class SyncState(
    /** This build knows its Firebase project (CI variables); without it the app cannot sign in. */
    val configured: Boolean,
    val signedIn: Boolean,
    val email: String?,
    /** What the user sees: the last snapshot plus actions not yet reflected in it. */
    val snapshot: Snapshot?,
    val source: Source?,
    /** When the shown snapshot was fetched (ms). */
    val fetchedAt: Long?,
    /** Actions waiting to reach the cloud inbox. */
    val pending: Int,
    val error: String? = null,
    /** Settings changes sent (or waiting to be sent) that the PC has not applied yet, oldest first. */
    val settingsWaiting: List<SettingsChange> = emptyList(),
    /** Recent "Quét bằng Gemini" requests, newest first (empty when the cloud scan is not set up). */
    val scans: List<CloudScan> = emptyList(),
    /** Today's day number (Vietnam time), to count today's scans. */
    val today: Long = 0,
    /** When this state was made (ms), to tell scans that got no answer. */
    val at: Long = 0,
) {
    /** Today's scans that ran or still run; failed, refused and stuck ones do not use up the day. */
    val scansToday: Int get() = scans.count { it.day == today && it.uses(at) }
}

/** What pressing "Quét bằng Gemini" did. */
sealed interface ScanOutcome {
    /** [n]: which of today's scans this is (failed ones not counted). */
    data class Started(val id: String, val n: Int) : ScanOutcome
    /** Another scan has not finished yet. */
    data object Busy : ScanOutcome
    /** The rules refused: today's limit is used up, or the cloud scan is switched off. */
    data class Limit(val used: Int) : ScanOutcome
    data class Failed(val message: String) : ScanOutcome
}

/** A settings change from this phone: setting key -> new value, as the PC's settings page takes it. */
@Serializable
data class SettingsChange(val id: String, val at: Long, val patch: JsonObject, val baseRev: String, val sent: Boolean = false)

@Serializable
private data class Cached(val source: Source, val fetchedAt: Long, val snapshot: Snapshot)

@Serializable
private data class Overlay(val entityId: String, val state: String, val at: Long)

/**
 * Where the phone gets its data and sends its actions: the cloud copy the PC published, else the last copy on the phone.
 * Actions are queued on the phone first, so nothing is lost offline, and are shown immediately on top of whatever snapshot
 * is visible until a newer snapshot includes them. Signing in is Google's account picker (in the app module); this class
 * only turns the ID token into a session.
 */
class TrendRepository(
    private val http: Http,
    private val kv: KeyValue,
    private val settings: CloudSettings,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { "a" + UUID.randomUUID().toString().replace("-", "") },
    private val device: String = "android",
    private val firestoreBase: String = "https://firestore.googleapis.com",
    private val authBase: String = "https://identitytoolkit.googleapis.com",
    private val tokenBase: String = "https://securetoken.googleapis.com",
) {
    private val lock = Mutex()
    private val auth = CloudAuth(http, settings.apiKey, kv, now, authBase, tokenBase)
    private val cloud = CloudClient(http, auth, settings.projectId, settings.ownerUid, firestoreBase, device)

    /** Null on success, else what to tell the person. Starts from a clean slate: another account's queue must not leak in. */
    suspend fun signIn(googleIdToken: String): String? = lock.withLock {
        clearAll()
        try {
            auth.signInWithGoogle(googleIdToken)
            null
        } catch (e: Exception) {
            e.message ?: "Đăng nhập không thành công"
        }
    }

    fun signOut() = clearAll()

    private fun clearAll() {
        auth.clear()
        listOf(K_CACHE, K_QUEUE, K_OVERLAY, K_SETTINGS, K_SCANS).forEach { kv.put(it, null) }
    }

    fun state(error: String? = null): SyncState {
        val c = cached()
        val waiting = settingsQueue(c?.snapshot)
        val scans = kv.get(K_SCANS)?.let { runCatching { TrendJson.decodeFromString(ListSerializer(CloudScan.serializer()), it) }.getOrNull() } ?: emptyList()
        return SyncState(
            configured = settings.configured,
            signedIn = auth.signedIn,
            email = auth.email,
            snapshot = c?.snapshot?.let { withSettings(applyOverlay(it), waiting) },
            source = c?.source,
            fetchedAt = c?.fetchedAt,
            pending = queue().size,
            error = error,
            settingsWaiting = waiting,
            scans = scans,
            today = ScanDay.of(now()),
            at = now(),
        )
    }

    private fun saveScans(l: List<CloudScan>) = kv.put(K_SCANS, TrendJson.encodeToString(ListSerializer(CloudScan.serializer()), l))

    /** Reads the cloud scan requests again (to follow a running scan). */
    suspend fun refreshScans(): SyncState = lock.withLock {
        if (!settings.configured || !auth.signedIn) return@withLock state()
        try {
            saveScans(cloud.scans())
            state()
        } catch (e: AuthLost) {
            state(e.message)
        } catch (e: Exception) {
            state()
        }
    }

    /**
     * Starts a Gemini scan on the cloud: creates today's next request, {day}-{n}. The Firestore rules accept it only while
     * fewer than the day's scans are used (failed and stuck ones do not count), so the limit holds whatever the app
     * does; a refusal is reported as [ScanOutcome.Limit].
     */
    suspend fun startScan(): ScanOutcome = lock.withLock {
        if (!settings.configured || !auth.signedIn) return@withLock ScanOutcome.Failed("Chưa đăng nhập.")
        try {
            val list = cloud.scans()
            saveScans(list)
            val t = now()
            if (list.any { it.state(t) == "waiting" || it.state(t) == "running" }) return@withLock ScanOutcome.Busy
            val day = ScanDay.of(t)
            val today = list.filter { it.day == day }
            val used = today.count { it.uses(t) }
            val n = (today.maxOfOrNull { it.n } ?: 0) + 1
            val id = "$day-$n"
            when (cloud.startScan(id, t)) {
                ScanStart.Started -> { saveScans(listOf(CloudScan(id, day, n, t)) + list); ScanOutcome.Started(id, used + 1) }
                ScanStart.Refused -> ScanOutcome.Limit(used)
                ScanStart.Taken -> ScanOutcome.Failed("Lượt này vừa được dùng ở thiết bị khác. Thử lại.")
                ScanStart.Retry -> ScanOutcome.Failed("Cloud đang bận. Thử lại sau.")
            }
        } catch (e: AuthLost) {
            ScanOutcome.Failed(e.message ?: "Phiên đăng nhập đã hết hạn.")
        } catch (e: Exception) {
            ScanOutcome.Failed("Không kết nối được cloud: ${e.message ?: e::class.simpleName}")
        }
    }

    /** Sends queued actions and fetches the newest snapshot the PC published. */
    suspend fun refresh(): SyncState = lock.withLock {
        if (!settings.configured || !auth.signedIn) return@withLock state()
        try {
            flush { cloud.send(it) }
            val rejected = flushSettings()
            val snap = cloud.snapshot()
            if (snap != null) store(Cached(Source.Cloud, now(), snap))
            // Best effort: the list of cloud scans is extra; failing to read it must not hide the snapshot.
            runCatching { cloud.scans() }.onSuccess { saveScans(it) }.onFailure { if (it is AuthLost) throw it }
            state(
                when {
                    rejected -> "Cloud từ chối một thay đổi cài đặt (quá lớn hoặc sai định dạng), nên đã bỏ nó. Sửa lại rồi gửi lần nữa."
                    snap == null -> "PC chưa đẩy dữ liệu lên cloud. Trên PC chạy  npm run sync."
                    else -> null
                },
            )
        } catch (e: AuthLost) {
            state(e.message)
        } catch (e: Exception) {
            state(if (cached() != null) "Đang xem bản lưu trên điện thoại; chưa kết nối được cloud." else "Không cập nhật được: ${e.message ?: e::class.simpleName}")
        }
    }

    /** Records the action and returns the state that already shows it. Call [refresh] afterwards to deliver it. */
    suspend fun act(item: Item, action: Action, days: Int? = null): SyncState = lock.withLock {
        val e = Event(newId(), item.id, action.wire, now(), if (action == Action.Snooze) days ?: 7 else null)
        saveQueue(queue() + e)
        saveOverlay(overlay().filter { it.entityId != item.id } + Overlay(item.id, action.state, e.at))
        state()
    }

    /**
     * Queues a settings change for the PC and returns the state that already shows it. Values are checked against the
     * catalogue first; a change that is not valid is refused here with the PC's own wording. Call [refresh] to deliver it.
     */
    suspend fun changeSettings(patch: JsonObject): Pair<SyncState, List<SettingError>> = lock.withLock {
        val st = cached()?.snapshot?.settings ?: return@withLock state() to listOf(SettingError("", "PC chưa gửi cài đặt lên cloud. Cập nhật pipeline trên PC rồi chạy: npm run sync"))
        val errors = patch.mapNotNull { (k, v) ->
            val d = st.def(k)
            when {
                d == null -> SettingError(k, "không có cài đặt này")
                !d.phoneEditable -> SettingError(k, if (!d.editable) "chỉ sửa được trong config.json trên PC" else "chỉ sửa được trên dashboard của PC")
                else -> SettingRules.problem(d, v)?.let { SettingError(k, it) }
            }
        }
        if (errors.isNotEmpty() || patch.isEmpty()) return@withLock state() to errors
        val q = settingsQueue(cached()?.snapshot)
        val last = q.lastOrNull()
        // Not sent yet: fold into the waiting change, so the PC gets one change and one entry in its history.
        val next = if (last != null && !last.sent) q.dropLast(1) + last.copy(at = now(), patch = JsonObject(last.patch + patch))
        else q + SettingsChange("s" + newId().takeLast(40), now(), patch, st.rev)
        saveSettings(next)
        state() to emptyList()
    }

    /** True when the cloud refused a change (it is dropped: sending it again cannot succeed). */
    private suspend fun flushSettings(): Boolean {
        var rejected = false
        for (waiting in settingsQueue(null).filter { !it.sent }) {
            // Stamped when it leaves: the PC applies its inbox in `at` order, so a change made offline must not sort
            // before one the PC has already taken (it would be read as applied, see settingsQueue).
            val c = waiting.copy(at = maxOf(waiting.at, now()))
            when (cloud.sendSettings(c)) {
                Delivery.Stored -> saveSettings(settingsQueue(null).map { if (it.id == c.id) c.copy(sent = true) else it })
                Delivery.Rejected -> { rejected = true; saveSettings(settingsQueue(null).filter { it.id != c.id }) }
                Delivery.Retry -> return rejected
            }
        }
        return rejected
    }

    /**
     * Changes the PC has not applied yet. The PC applies its inbox in the order the changes were made and reports the
     * last one it took, so every sent change made at or before that one is done (accepted or refused: see `remote`).
     */
    private fun settingsQueue(snap: Snapshot?): List<SettingsChange> {
        val all = kv.get(K_SETTINGS)?.let { runCatching { TrendJson.decodeFromString(ListSerializer(SettingsChange.serializer()), it) }.getOrNull() } ?: emptyList()
        val done = snap?.settings?.remote?.sentAt ?: return all
        val live = all.filter { !it.sent || it.at > done }
        if (live.size != all.size) saveSettings(live)
        return live
    }

    private fun saveSettings(q: List<SettingsChange>) = kv.put(K_SETTINGS, TrendJson.encodeToString(ListSerializer(SettingsChange.serializer()), q))

    /** Shows waiting changes on top of the PC's values, as the dashboard does, until the PC reports them applied. */
    private fun withSettings(s: Snapshot, waiting: List<SettingsChange>): Snapshot {
        val st = s.settings ?: return s
        if (waiting.isEmpty()) return s
        return s.copy(settings = st.copy(values = JsonObject(waiting.fold(st.values as Map<String, kotlinx.serialization.json.JsonElement>) { acc, c -> acc + c.patch })))
    }

    private suspend fun flush(send: suspend (Event) -> Boolean) {
        for (e in queue()) {
            if (!send(e)) break
            saveQueue(queue().filter { it.id != e.id })
        }
    }

    private fun applyOverlay(s: Snapshot): Snapshot {
        val generated = runCatching { java.time.Instant.parse(s.generatedAt).toEpochMilli() }.getOrDefault(0L)
        val live = overlay().filter { it.at > generated || queue().any { q -> q.entityId == it.entityId } }
        if (live.size != overlay().size) saveOverlay(live)
        if (live.isEmpty()) return s
        val byId = live.associateBy { it.entityId }
        fun Item.patched() = byId[id]?.let { copy(userState = it.state) } ?: this
        val all = (s.digest + s.kept + s.explore).associateBy { it.id }
        val kept = s.kept.map { it.patched() }.filter { it.userState == "kept" || it.userState == "trying" } +
            live.filter { (it.state == "kept" || it.state == "trying") && s.kept.none { k -> k.id == it.entityId } }.mapNotNull { all[it.entityId]?.patched() }
        return s.copy(digest = s.digest.map { it.patched() }, kept = kept, explore = s.explore.map { it.patched() })
    }

    private fun cached(): Cached? = kv.get(K_CACHE)?.let { runCatching { TrendJson.decodeFromString(Cached.serializer(), it) }.getOrNull() }
    private fun store(c: Cached) = kv.put(K_CACHE, TrendJson.encodeToString(Cached.serializer(), c))
    private fun queue(): List<Event> = kv.get(K_QUEUE)?.let { runCatching { TrendJson.decodeFromString(ListSerializer(Event.serializer()), it) }.getOrNull() } ?: emptyList()
    private fun saveQueue(q: List<Event>) = kv.put(K_QUEUE, TrendJson.encodeToString(ListSerializer(Event.serializer()), q))
    private fun overlay(): List<Overlay> = kv.get(K_OVERLAY)?.let { runCatching { TrendJson.decodeFromString(ListSerializer(Overlay.serializer()), it) }.getOrNull() } ?: emptyList()
    private fun saveOverlay(o: List<Overlay>) = kv.put(K_OVERLAY, TrendJson.encodeToString(ListSerializer(Overlay.serializer()), o))

    private companion object {
        const val K_CACHE = "snapshot.cache"
        const val K_QUEUE = "queue"
        const val K_OVERLAY = "overlay"
        const val K_SETTINGS = "settings.queue"
        const val K_SCANS = "scans"
    }
}
