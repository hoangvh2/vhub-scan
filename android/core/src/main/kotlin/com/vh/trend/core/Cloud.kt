package com.vh.trend.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.net.URLEncoder

/** Identifiers baked into the APK at build time (CI repository variables; none is a secret). Blank = this build has no cloud. */
data class CloudSettings(val projectId: String, val apiKey: String, val webClientId: String, val ownerUid: String = "owner") {
    val configured: Boolean get() = projectId.isNotBlank() && apiKey.isNotBlank() && webClientId.isNotBlank() && ownerUid.isNotBlank()
}

/** Firebase Auth over REST: Google ID token in, Firebase session out, then refresh tokens. No Firebase SDK. */
class CloudAuth(
    private val http: Http,
    private val apiKey: String,
    private val kv: KeyValue,
    private val now: () -> Long = System::currentTimeMillis,
    private val authBase: String = "https://identitytoolkit.googleapis.com",
    private val tokenBase: String = "https://securetoken.googleapis.com",
) {
    /** Exchanges the ID token Google's account picker returned for a Firebase session. Returns the account's address. */
    suspend fun signInWithGoogle(googleIdToken: String): String {
        val body = buildJsonObject {
            put("postBody", "id_token=" + URLEncoder.encode(googleIdToken, "UTF-8") + "&providerId=google.com")
            put("requestUri", "http://localhost")
            put("returnSecureToken", true)
            put("returnIdpCredential", true)
        }.toString()
        val r = http.send(HttpRequest("POST", "$authBase/v1/accounts:signInWithIdp?key=$apiKey", mapOf("content-type" to "application/json"), body))
        val j = TrendJson.parseToJsonElement(r.body.ifBlank { "{}" }).jsonObject
        if (!r.ok) throw CloudError(explain(j, "đăng nhập cloud"))
        val email = j["email"]?.jsonPrimitive?.content.orEmpty()
        kv.put(K_EMAIL, email)
        save(j["idToken"]!!.jsonPrimitive.content, j["refreshToken"]!!.jsonPrimitive.content, j["expiresIn"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600)
        return email
    }

    val email: String? get() = kv.get(K_EMAIL)?.takeIf { it.isNotBlank() }

    val signedIn: Boolean get() = kv.get(K_REFRESH) != null

    /** A valid ID token, refreshed when it is about to expire. */
    suspend fun idToken(): String {
        val until = kv.get(K_UNTIL)?.toLongOrNull() ?: 0
        kv.get(K_ID)?.let { if (now() < until) return it }
        val refresh = kv.get(K_REFRESH) ?: throw AuthLost("Chưa đăng nhập. Đăng nhập bằng Google để xem.")
        val form = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refresh, "UTF-8")
        val r = http.send(HttpRequest("POST", "$tokenBase/v1/token?key=$apiKey", mapOf("content-type" to "application/x-www-form-urlencoded"), form))
        val j = TrendJson.parseToJsonElement(r.body.ifBlank { "{}" }).jsonObject
        if (r.code == 400 || r.code == 401 || r.code == 403) {
            kv.put(K_REFRESH, null)
            throw AuthLost("Phiên đăng nhập đã hết hạn hoặc bị thu hồi. Đăng nhập lại bằng Google.")
        }
        if (!r.ok) throw CloudError(explain(j, "làm mới đăng nhập"))
        val id = j["id_token"]!!.jsonPrimitive.content
        save(id, j["refresh_token"]?.jsonPrimitive?.content ?: refresh, j["expires_in"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600)
        return id
    }

    fun clear() = listOf(K_ID, K_REFRESH, K_UNTIL, K_EMAIL).forEach { kv.put(it, null) }

    private fun save(id: String, refresh: String, expiresIn: Long) {
        kv.put(K_ID, id)
        kv.put(K_REFRESH, refresh)
        kv.put(K_UNTIL, (now() + (expiresIn - 120) * 1000).toString())
    }

    private fun explain(j: JsonObject, what: String): String {
        val m = (j["error"] as? JsonObject)?.get("message")?.jsonPrimitive?.content ?: "lỗi không rõ"
        return if (m.contains("CONFIGURATION_NOT_FOUND")) "Firebase Authentication chưa bật Google. Làm bước 7 trong infra/README.md." else "Không $what được ($m)."
    }

    private companion object {
        const val K_ID = "cloud.idToken"
        const val K_REFRESH = "cloud.refreshToken"
        const val K_UNTIL = "cloud.idUntil"
        const val K_EMAIL = "cloud.email"
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

    private fun notAllowed() = AuthLost("Tài khoản ${auth.email ?: "này"} không nằm trong danh sách được phép. Thêm địa chỉ vào allowed_emails (infra/terraform.tfvars) rồi chạy terraform apply, hoặc đăng xuất và dùng tài khoản khác.")

    /** Null when the PC has not published anything yet. */
    suspend fun snapshot(): Snapshot? {
        val r = http.send(HttpRequest("GET", "$docs/snapshot/latest", mapOf("authorization" to "Bearer ${auth.idToken()}")))
        if (r.code == 404) return null
        if (r.code == 401 || r.code == 403) throw notAllowed()
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
            r.code == 401 -> throw notAllowed()
            r.code == 403 -> true // rejected by the rules: retrying the same event cannot succeed, so drop it
            else -> false
        }
    }

    /** Recent cloud scan requests, newest first. Empty when the rules do not allow reading them (cloud scan not set up). */
    suspend fun scans(): List<CloudScan> {
        val r = http.send(HttpRequest("GET", "$docs/runRequests?pageSize=50", mapOf("authorization" to "Bearer ${auth.idToken()}")))
        if (r.code == 401) throw notAllowed()
        if (r.code == 403 || r.code == 404) return emptyList()
        if (!r.ok) throw CloudError("Cloud trả lỗi ${r.code}.")
        val list = TrendJson.parseToJsonElement(r.body.ifBlank { "{}" }).jsonObject["documents"]?.jsonArray ?: return emptyList()
        return list.mapNotNull { d ->
            val o = d.jsonObject
            val name = o["name"]?.jsonPrimitive?.content ?: return@mapNotNull null
            val id = name.substringAfterLast('/')
            val m = Regex("^(\\d+)-(\\d+)$").find(id) ?: return@mapNotNull null
            val f = o["fields"]?.jsonObject ?: JsonObject(emptyMap())
            fun str(k: String) = f[k]?.jsonObject?.get("stringValue")?.jsonPrimitive?.content
            fun num(k: String) = f[k]?.jsonObject?.let { v -> (v["integerValue"] ?: v["doubleValue"])?.jsonPrimitive?.content }
            CloudScan(id, m.groupValues[1].toLong(), m.groupValues[2].toInt(), num("at")?.toDoubleOrNull()?.toLong(), str("status"), str("message"), num("tokens")?.toDoubleOrNull()?.toLong(), num("costUsd")?.toDoubleOrNull())
        }.sortedWith(compareByDescending<CloudScan> { it.day }.thenByDescending { it.n })
    }

    /** Creates the request; the rules refuse (403) beyond today's limit or when the cloud scan is switched off. */
    suspend fun startScan(id: String, at: Long): ScanStart {
        val body = buildJsonObject {
            putJsonObject("fields") {
                putJsonObject("at") { put("integerValue", at.toString()) }
                putJsonObject("device") { put("stringValue", device.take(40)) }
            }
        }.toString()
        val r = http.send(HttpRequest("POST", "$docs/runRequests?documentId=$id", mapOf("authorization" to "Bearer ${auth.idToken()}", "content-type" to "application/json"), body))
        return when {
            r.ok -> ScanStart.Started
            r.code == 401 -> throw notAllowed()
            r.code == 403 -> ScanStart.Refused
            r.code == 409 -> ScanStart.Taken
            else -> ScanStart.Retry
        }
    }

    /** Puts a settings change in the PC's settingsInbox. The PC validates it again before it touches config.json. */
    suspend fun sendSettings(c: SettingsChange): Delivery {
        val body = buildJsonObject {
            putJsonObject("fields") {
                putJsonObject("patch") { put("stringValue", c.patch.toString()) }
                putJsonObject("baseRev") { put("stringValue", c.baseRev) }
                putJsonObject("at") { put("integerValue", c.at.toString()) }
                putJsonObject("device") { put("stringValue", device.take(40)) }
            }
        }.toString()
        val r = http.send(HttpRequest("POST", "$docs/settingsInbox?documentId=${c.id}", mapOf("authorization" to "Bearer ${auth.idToken()}", "content-type" to "application/json"), body))
        return when {
            r.ok || r.code == 409 -> Delivery.Stored
            r.code == 401 -> throw notAllowed()
            r.code == 403 -> Delivery.Rejected
            else -> Delivery.Retry
        }
    }
}

enum class Delivery { Stored, Rejected, Retry }

/** A "Quét bằng Gemini" request (owners/{uid}/runRequests/{day}-{n}) and what the cloud function wrote onto it. */
@Serializable
data class CloudScan(
    val id: String,
    val day: Long,
    val n: Int,
    val at: Long? = null,
    /** running, done, failed, refused; null while the function has not picked it up. */
    val status: String? = null,
    val message: String? = null,
    val tokens: Long? = null,
    val costUsd: Double? = null,
) {
    val finished: Boolean get() = status != null && status != "running"
}

/** Day numbers in Vietnam time (UTC+7, no daylight saving): the same as the Firestore rules and the pipeline. */
object ScanDay {
    fun of(ms: Long): Long = Math.floorDiv(ms + 7 * 3_600_000L, 86_400_000L)
}

enum class ScanStart { Started, Refused, Taken, Retry }

class CloudError(message: String) : Exception(message)

/** The session is gone or the account is not allowed: only signing in again (or changing the allowlist) helps. */
class AuthLost(message: String) : Exception(message)

