package com.vh.trend.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class PairCodeTest {
    private val token = "97lYouv4ARj1agxafF3YkTwf7D-V0mdM"

    @Test
    fun parsesLanOnlyAndCloudCodes() {
        val lan = PairCode.parse("""{"v":1,"lan":["http://192.168.1.5:4173"],"t":"$token"}""")
        assertEquals(listOf("http://192.168.1.5:4173"), lan.lan)
        val both = PairCode.parse("""  {"v":1,"lan":[],"t":"$token","fb":{"p":"vhub-trend-1","k":"AIza","u":"owner","ct":"a.b.c"}}  """)
        assertEquals("owner", both.fb?.u)
    }

    @Test
    fun explainsBadCodes() {
        assertTrue(assertFailsWith<PairError> { PairCode.parse("hello") }.message!!.contains("không phải mã ghép nối"))
        assertTrue(assertFailsWith<PairError> { PairCode.parse("""{"v":2,"t":"$token","lan":["http://a"]}""") }.message!!.contains("cập nhật app"))
        assertTrue(assertFailsWith<PairError> { PairCode.parse("""{"v":1,"t":"$token","lan":[]}""") }.message!!.contains("--lan"))
        assertFailsWith<PairError> { PairCode.parse("""{"v":1,"t":"short","lan":["http://a"]}""") }
        assertFailsWith<PairError> { PairCode.parse("""{"v":1,"t":"$token","lan":["file:///etc"]}""") }
    }
}
