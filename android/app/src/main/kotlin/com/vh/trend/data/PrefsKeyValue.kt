package com.vh.trend.data

import android.content.Context
import com.vh.trend.core.KeyValue

/** App-private SharedPreferences. Excluded from backup and device transfer (see data_extraction_rules.xml). */
class PrefsKeyValue(context: Context) : KeyValue {
    private val p = context.getSharedPreferences("trend", Context.MODE_PRIVATE)
    override fun get(key: String): String? = p.getString(key, null)
    override fun put(key: String, value: String?) {
        p.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}
