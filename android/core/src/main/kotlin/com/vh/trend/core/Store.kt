package com.vh.trend.core

/** Small persistent key-value store: SharedPreferences on the phone, a map in tests. */
interface KeyValue {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

class MemoryKeyValue(private val m: MutableMap<String, String> = mutableMapOf()) : KeyValue {
    override fun get(key: String) = m[key]
    override fun put(key: String, value: String?) {
        if (value == null) m.remove(key) else m[key] = value
    }
}
