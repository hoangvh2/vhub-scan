package com.vh.trend.core

import kotlinx.serialization.Serializable

/** Scanned from the dashboard's QR or pasted from `npm run pair`. Contract: docs/SYNC.md "Mã ghép nối". */
@Serializable
data class PairCode(val v: Int, val lan: List<String> = emptyList(), val t: String, val fb: Firebase? = null) {
    @Serializable
    data class Firebase(val p: String, val k: String, val u: String, val ct: String)

    companion object {
        fun parse(text: String): PairCode {
            val c = try {
                TrendJson.decodeFromString(serializer(), text.trim())
            } catch (e: Exception) {
                throw PairError("Đây không phải mã ghép nối của VHub Trend. Quét lại mã ở dashboard → Hệ thống, hoặc dán đúng dòng mã mà lệnh npm run pair in ra.")
            }
            if (c.v != 1) throw PairError("Mã ghép nối phiên bản ${c.v}; cập nhật app lên bản mới nhất.")
            if (c.t.length < 16) throw PairError("Mã ghép nối thiếu token dashboard.")
            if (c.lan.isEmpty() && c.fb == null) {
                throw PairError("Mã không có địa chỉ LAN và cloud chưa bật. Trên PC chạy  npm run dashboard -- --lan  rồi tạo mã mới.")
            }
            if (c.lan.any { !it.startsWith("http://") && !it.startsWith("https://") }) throw PairError("Địa chỉ LAN trong mã không hợp lệ.")
            return c
        }
    }
}

class PairError(message: String) : Exception(message)
