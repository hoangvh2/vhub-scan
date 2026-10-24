package com.vh.trend.core

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.util.UUID

enum class Source { Lan, Cloud, Cache }

data class SyncState(
    val paired: Boolean,
    /** What the user sees: the last snapshot plus actions not yet reflected in it. */
    val snapshot: Snapshot?,
    val source: Source?,
    val lanUrl: String?,
    /** When the shown snapshot was fetched (ms). */
    val fetchedAt: Long?,
    /** Actions waiting to reach the PC or the cloud inbox. */
    val pending: Int,
    val cloudEnabled: Boolean,
    val error: String? = null,
)

@Serializable
private data class Cached(val source: Source, val fetchedAt: Long, val lanUrl: String? = null, val snapshot: Snapshot)

@Serializable
private data class Overlay(val entityId: String, val state: String, val at: Long)

/**
 * Where the phone gets its data and sends its actions. Order: the PC on the home network (freshest, applies at once),
 * then the cloud copy, then the last copy on the phone. Actions are queued on the phone first, so nothing is lost
 * offline, and are shown immediately on top of whatever snapshot is visible until a newer snapshot includes them.
 */
class TrendRepository(
    private val http: Http,
    private val kv: KeyValue,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { "a" + UUID.randomUUID().toString().replace("-", "") },
    private val device: String = "android",
    private val firestoreBase: String = "https://firestore.googleapis.com",
    private val authBase: String = "https://identitytoolkit.googleapis.com",
    private val tokenBase: String = "https://securetoken.googleapis.com",
) {
    private val lock = Mutex()

    val pairCode: PairCode? get() = kv.get(K_PAIR)?.let { runCatching { TrendJson.decodeFromString(PairCode.serializer(), it) }.getOrNull() }

    private fun auth(p: PairCode) = p.fb?.let { CloudAuth(http, it.k, kv, now, authBase, tokenBase) }
    private fun cloud(p: PairCode) = p.fb?.let { CloudClient(http, auth(p)!!, it.p, it.u, firestoreBase, device) }

    /** Saves the pairing. Cloud sign-in failure does not undo it: the LAN still works and the error is reported. */
    suspend fun pair(code: PairCode): String? = lock.withLock {
        clearAll()
        kv.put(K_PAIR, TrendJson.encodeToString(PairCode.serializer(), code))
        val fb = code.fb ?: return@withLock null
        try {
            auth(code)!!.signIn(fb.ct)
            null
        } catch (e: Exception) {
            "Đã ghép nối qua Wi-Fi, nhưng chưa vào được cloud: ${e.message}"
        }
    }

    fun unpair() = clearAll()

    private fun clearAll() = listOf(K_PAIR, K_CACHE, K_QUEUE, K_OVERLAY, "cloud.idToken", "cloud.refreshToken", "cloud.idUntil").forEach { kv.put(it, null) }

    fun state(error: String? = null): SyncState {
        val p = pairCode
        val c = cached()
        return SyncState(
            paired = p != null,
            snapshot = c?.snapshot?.let { applyOverlay(it) },
            source = c?.source,
            lanUrl = c?.lanUrl,
            fetchedAt = c?.fetchedAt,
            pending = queue().size,
            cloudEnabled = p?.fb != null,
            error = error,
        )
    }

    /** Sends queued actions and fetches the newest snapshot from the best place that answers. */
    suspend fun refresh(): SyncState = lock.withLock {
        val p = pairCode ?: return@withLock state()
        try {
            val lan = LanClient(http, p.t)
            val order = (listOfNotNull(cached()?.lanUrl) + p.lan).distinct()
            for (base in order) {
                // Probe first: only a PC that answers gets the queued actions.
                val probe = lan.snapshot(base) ?: continue
                flush { lan.send(base, it) }
                val fresh = if (queueWasSent) lan.snapshot(base) ?: probe else probe
                store(Cached(Source.Lan, now(), base, fresh))
                return@withLock state()
            }
            val cloud = cloud(p)
            if (cloud != null) {
                flush { cloud.send(it) }
                val snap = cloud.snapshot()
                if (snap != null) store(Cached(Source.Cloud, now(), null, snap))
                return@withLock state(if (snap == null) "PC chưa đẩy dữ liệu lên cloud. Trên PC chạy  npm run sync." else null)
            }
            state(if (cached() == null) "Không thấy PC trong mạng này. Ở cùng Wi-Fi với PC và chạy  npm run dashboard -- --lan." else "Đang xem bản lưu trên điện thoại; không thấy PC trong mạng này.")
        } catch (e: AuthLost) {
            state(e.message)
        } catch (e: Exception) {
            state("Không cập nhật được: ${e.message ?: e::class.simpleName}")
        }
    }

    /** Records the action and returns the state that already shows it. Call [refresh] afterwards to deliver it. */
    suspend fun act(item: Item, action: Action, days: Int? = null): SyncState = lock.withLock {
        val e = Event(newId(), item.id, action.wire, now(), if (action == Action.Snooze) days ?: 7 else null)
        saveQueue(queue() + e)
        saveOverlay(overlay().filter { it.entityId != item.id } + Overlay(item.id, action.state, e.at))
        state()
    }

    private var queueWasSent = false

    private suspend fun flush(send: suspend (Event) -> Boolean) {
        queueWasSent = false
        for (e in queue()) {
            if (!send(e)) break
            saveQueue(queue().filter { it.id != e.id })
            queueWasSent = true
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
        const val K_PAIR = "pair"
        const val K_CACHE = "snapshot.cache"
        const val K_QUEUE = "queue"
        const val K_OVERLAY = "overlay"
    }
}
