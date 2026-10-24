package com.vh.trend.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
    val timeoutMs: Int = 10_000,
)

data class HttpResponse(val code: Int, val body: String) {
    val ok: Boolean get() = code in 200..299
}

fun interface Http {
    /** Throws IOException when the host cannot be reached; any HTTP status is a normal response. */
    suspend fun send(req: HttpRequest): HttpResponse
}

/** java.net based client: no extra dependency, and on Android it is backed by the platform's OkHttp. */
object JdkHttp : Http {
    override suspend fun send(req: HttpRequest): HttpResponse = withContext(Dispatchers.IO) {
        val c = URI(req.url).toURL().openConnection() as HttpURLConnection
        try {
            c.requestMethod = req.method
            c.connectTimeout = req.timeoutMs
            c.readTimeout = req.timeoutMs
            c.instanceFollowRedirects = false
            c.useCaches = false
            req.headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            if (req.body != null) {
                c.doOutput = true
                c.outputStream.use { it.write(req.body.toByteArray()) }
            }
            val code = c.responseCode
            val stream = if (code >= 400) c.errorStream else c.inputStream
            HttpResponse(code, stream?.bufferedReader()?.use { it.readText() } ?: "")
        } catch (e: IOException) {
            throw e
        } finally {
            c.disconnect()
        }
    }
}
