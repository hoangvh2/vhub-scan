package com.vh.trend.core

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
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
)

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
        listOf(K_CACHE, K_QUEUE, K_OVERLAY).forEach { kv.put(it, null) }
    }

    fun state(error: String? = null): SyncState {
        val c = cached()
        return SyncState(
            configured = settings.configured,
            signedIn = auth.signedIn,
            email = auth.email,
            snapshot = c?.snapshot?.let { applyOverlay(it) },
            source = c?.source,
            fetchedAt = c?.fetchedAt,
            pending = queue().size,
            error = error,
        )
    }

    /** Sends queued actions and fetches the newest snapshot the PC published. */
    suspend fun refresh(): SyncState = lock.withLock {
        if (!settings.configured || !auth.signedIn) return@withLock state()
        try {
            flush { cloud.send(it) }
            val snap = cloud.snapshot()
            if (snap != null) store(Cached(Source.Cloud, now(), snap))
            state(if (snap == null) "PC chưa đẩy dữ liệu lên cloud. Trên PC chạy  npm run sync." else null)
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
    }
}
