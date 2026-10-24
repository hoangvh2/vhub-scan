package com.vh.trend.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.net.URLEncoder

/** Firebase Auth over REST: one custom-token sign-in at pairing, then refresh tokens. No Firebase SDK. */
class CloudAuth(
    private val http: Http,
    private val apiKey: String,
    private val kv: KeyValue,
    private val now: () -> Long = System::currentTimeMillis,
    private val authBase: String = "https://identitytoolkit.googleapis.com",
    private val tokenBase: String = "https://securetoken.googleapis.com",
) {
    suspend fun signIn(customToken: String) {
        val body = buildJsonObject { put("token", customToken); put("returnSecureToken", true) }.toString()
        val r = http.send(HttpRequest("POST", "$authBase/v1/accounts:signInWithCustomToken?key=$apiKey", mapOf("content-type" to "application/json"), body))
        val j = TrendJson.parseToJsonElement(r.body.ifBlank { "{}" }).jsonObject
        if (!r.ok) throw CloudError(explain(j, "đăng nhập cloud"))
        save(j["idToken"]!!.jsonPrimitive.content, j["refreshToken"]!!.jsonPrimitive.content, j["expiresIn"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600)
    }

    val signedIn: Boolean get() = kv.get(K_REFRESH) != null

    /** A valid ID token, refreshed when it is about to expire. */
    suspend fun idToken(): String {
        val until = kv.get(K_UNTIL)?.toLongOrNull() ?: 0
        kv.get(K_ID)?.let { if (now() < until) return it }
        val refresh = kv.get(K_REFRESH) ?: throw AuthLost("Điện thoại chưa đăng nhập cloud. Ghép nối lại với PC.")
        val form = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refresh, "UTF-8")
        val r = http.send(HttpRequest("POST", "$tokenBase/v1/token?key=$apiKey", mapOf("content-type" to "application/x-www-form-urlencoded"), form))
        val j = TrendJson.parseToJsonElement(r.body.ifBlank { "{}" }).jsonObject
        if (r.code == 400 || r.code == 401 || r.code == 403) {
            kv.put(K_REFRESH, null)
            throw AuthLost("Quyền cloud của điện thoại đã bị thu hồi. Ghép nối lại với PC.")
        }
        if (!r.ok) throw CloudError(explain(j, "làm mới đăng nhập"))
        val id = j["id_token"]!!.jsonPrimitive.content
        save(id, j["refresh_token"]?.jsonPrimitive?.content ?: refresh, j["expires_in"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600)
        return id
    }

    fun clear() = listOf(K_ID, K_REFRESH, K_UNTIL).forEach { kv.put(it, null) }

    private fun save(id: String, refresh: String, expiresIn: Long) {
        kv.put(K_ID, id)
        kv.put(K_REFRESH, refresh)
        kv.put(K_UNTIL, (now() + (expiresIn - 120) * 1000).toString())
    }

    private fun explain(j: JsonObject, what: String): String {
        val m = (j["error"] as? JsonObject)?.get("message")?.jsonPrimitive?.content ?: "lỗi không rõ"
        return if (m.contains("CONFIGURATION_NOT_FOUND")) "Cloud chưa bật Authentication. Trên PC chạy  npm run doctor  để xem cách sửa." else "Không $what được ($m)."
    }

    private companion object {
        const val K_ID = "cloud.idToken"
        const val K_REFRESH = "cloud.refreshToken"
        const val K_UNTIL = "cloud.idUntil"
    }
}

/** Reads the snapshot the PC published and queues phone actions in the inbox. Paths and shape: docs/SYNC.md. */
class CloudClient(
    private val http: Http,
    private val auth: CloudAuth,
    private val projectId: String,
    private val uid: String,
    private val base: String = "https://firestore.googleapis.com",
    private val device: String = "android",
) {
    private val docs get() = "$base/v1/projects/$projectId/databases/(default)/documents/owners/$uid"

    /** Null when the PC has not published anything yet. */
    suspend fun snapshot(): Snapshot? {
        val r = http.send(HttpRequest("GET", "$docs/snapshot/latest", mapOf("authorization" to "Bearer ${auth.idToken()}")))
        if (r.code == 404) return null
        if (r.code == 401 || r.code == 403) throw AuthLost("Cloud từ chối điện thoại này. Ghép nối lại với PC.")
        if (!r.ok) throw CloudError("Cloud trả lỗi ${r.code}.")
        val fields = TrendJson.parseToJsonElement(r.body).jsonObject["fields"]?.jsonObject ?: return null
        val payload = fields["payload"]?.jsonObject?.get("stringValue")?.jsonPrimitive?.content ?: return null
        return TrendJson.decodeFromString(Snapshot.serializer(), payload)
    }

    /** True when stored in the inbox (also when it was already there from an earlier attempt). */
    suspend fun send(e: Event): Boolean {
        val body = buildJsonObject {
            putJsonObject("fields") {
                putJsonObject("entityId") { put("stringValue", e.entityId) }
                putJsonObject("action") { put("stringValue", e.action) }
                putJsonObject("at") { put("integerValue", e.at.toString()) }
                e.days?.let { d -> putJsonObject("days") { put("integerValue", d.toString()) } }
                putJsonObject("device") { put("stringValue", device.take(40)) }
            }
        }.toString()
        val r = http.send(HttpRequest("POST", "$docs/inbox?documentId=${e.id}", mapOf("authorization" to "Bearer ${auth.idToken()}", "content-type" to "application/json"), body))
        return when {
            r.ok || r.code == 409 -> true
            r.code == 401 -> throw AuthLost("Cloud từ chối điện thoại này. Ghép nối lại với PC.")
            r.code == 403 -> true // rejected by the rules: retrying the same event cannot succeed, so drop it
            else -> false
        }
    }
}

class CloudError(message: String) : Exception(message)

