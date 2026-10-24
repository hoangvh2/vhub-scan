package com.vh.trend.core

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The PC's dashboard API on the home network. */
class LanClient(private val http: Http, private val token: String, private val timeoutMs: Int = 2_500) {
    private fun headers() = mapOf("authorization" to "Bearer $token", "content-type" to "application/json")

    /** Null when this address does not answer (another network, PC off, dashboard not started with --lan). */
    suspend fun snapshot(base: String): Snapshot? {
        val r = try {
            http.send(HttpRequest("GET", "$base/api/snapshot", headers(), timeoutMs = timeoutMs))
        } catch (e: Exception) {
            return null
        }
        if (r.code == 401) throw AuthLost("PC không nhận mã của điện thoại này nữa (token dashboard đã đổi). Ghép nối lại.")
        if (!r.ok) return null
        return TrendJson.decodeFromString(Snapshot.serializer(), r.body)
    }

    /** True when the PC applied it (or the item no longer exists there, which retrying cannot fix). */
    suspend fun send(base: String, e: Event): Boolean {
        val body = buildJsonObject {
            put("id", e.entityId)
            put("action", e.action)
            e.days?.let { put("days", it) }
        }.toString()
        val r = try {
            http.send(HttpRequest("POST", "$base/api/feedback", headers(), body, timeoutMs))
        } catch (x: Exception) {
            return false
        }
        if (r.code == 401) throw AuthLost("PC không nhận mã của điện thoại này nữa (token dashboard đã đổi). Ghép nối lại.")
        return r.ok || r.code == 404 || r.code == 400
    }
}

class AuthLost(message: String) : Exception(message)
