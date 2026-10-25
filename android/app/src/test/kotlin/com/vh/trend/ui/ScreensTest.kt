package com.vh.trend.ui

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import com.github.takahirom.roborazzi.captureRoboImage
import com.vh.trend.core.Source
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

private const val PHONE = "w411dp-h891dp-xxhdpi"
private const val SMALL_PHONE = "w360dp-h740dp-xxhdpi"
private const val TABLET = "w1280dp-h800dp-land-xhdpi"

/** Renders every main screen with the sample data and saves a PNG per screen (app/build/screenshots). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class ScreensTest {
    @get:Rule val rule = createComposeRule()

    private fun shot(name: String, ui: UiState, dark: Boolean = false, on: UiActions = object : UiActions {}) {
        rule.setContent { TrendTheme(dark = dark) { TrendApp(ui, on, now = Fixtures.now) } }
        rule.onRoot().captureRoboImage("build/screenshots/$name.png")
    }

    private fun signedOut(configured: Boolean = true, error: String? = null) =
        Fixtures.ui().let { it.copy(sync = it.sync.copy(configured = configured, signedIn = false, email = null, snapshot = null, error = error)) }

    @Test @Config(qualifiers = PHONE) fun phoneToday() = shot("phone-today-light", Fixtures.ui())
    @Test @Config(qualifiers = PHONE) fun phoneTodayDark() = shot("phone-today-dark", Fixtures.ui(), dark = true)
    @Test @Config(qualifiers = PHONE) fun phoneDetail() = shot("phone-detail-light", Fixtures.ui(selected = Fixtures.snapshot.digest.first().id))
    @Test @Config(qualifiers = PHONE) fun phoneDetailDark() = shot("phone-detail-dark", Fixtures.ui(selected = Fixtures.snapshot.digest.first().id), dark = true)
    @Test @Config(qualifiers = SMALL_PHONE) fun smallPhoneDetail() = shot("phone360-detail-light", Fixtures.ui(selected = Fixtures.snapshot.digest.first().id))
    @Test @Config(qualifiers = PHONE) fun phoneKeptFromCloud() = shot("phone-kept-cloud", Fixtures.ui(Source.Cloud, Tab.Kept, pending = 2))
    @Test @Config(qualifiers = PHONE) fun phoneSystem() = shot("phone-system-dark", Fixtures.ui(tab = Tab.System), dark = true)
    @Test @Config(qualifiers = PHONE) fun phoneOffline() = shot("phone-offline-cache", Fixtures.ui(Source.Cache, error = "Đang xem bản lưu trên điện thoại; chưa kết nối được cloud."))
    @Test @Config(qualifiers = PHONE) fun phoneSignIn() = shot("phone-signin", signedOut())
    @Test @Config(qualifiers = PHONE) fun phoneSignInRefused() = shot("phone-signin-refused", signedOut(error = "Tài khoản me@example.com không nằm trong danh sách được phép. Thêm địa chỉ vào allowed_emails (infra/terraform.tfvars) rồi chạy terraform apply, hoặc đăng xuất và dùng tài khoản khác."), dark = true)
    @Test @Config(qualifiers = PHONE) fun phoneSignInNotConfigured() = shot("phone-signin-unconfigured", signedOut(configured = false))
    @Test @Config(qualifiers = TABLET) fun tabletToday() = shot("tablet-today-light", Fixtures.ui())
    @Test @Config(qualifiers = PHONE) fun phoneSettings() = shot("phone-settings-light", Fixtures.ui(tab = Tab.Settings))
    @Test @Config(qualifiers = PHONE) fun phoneSettingsDark() = shot("phone-settings-dark", Fixtures.ui(tab = Tab.Settings), dark = true)
    @Test @Config(qualifiers = PHONE) fun phoneSettingsWaitingAndRefused() = shot("phone-settings-status", Fixtures.ui(tab = Tab.Settings, snap = Fixtures.refused, waiting = Fixtures.waiting))
    @Test @Config(qualifiers = SMALL_PHONE) fun smallPhoneSettings() = shot("phone360-settings-light", Fixtures.ui(tab = Tab.Settings))
    @Test @Config(qualifiers = TABLET) fun tabletSettingsDark() = shot("tablet-settings-dark", Fixtures.ui(tab = Tab.Settings), dark = true)
    @Test @Config(qualifiers = PHONE) fun phoneExploreByTopic() = shot("phone-explore-topic", Fixtures.ui(tab = Tab.Explore, cat = "productivity"))
    @Test @Config(qualifiers = TABLET) fun tabletExploreDark() = shot("tablet-explore-dark", Fixtures.ui(tab = Tab.Explore), dark = true)

    // "Xem thêm" folds the secondary analysis, chart and source; tests open it and capture the long version.
    @Test @Config(qualifiers = PHONE)
    fun phoneDetailExpanded() {
        rule.setContent { TrendTheme { TrendApp(Fixtures.ui(selected = Fixtures.snapshot.digest.first().id), object : UiActions {}, Fixtures.now) } }
        rule.onNodeWithTag("more").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onRoot().captureRoboImage("build/screenshots/phone-detail-expanded.png")
    }

    @Test @Config(qualifiers = PHONE)
    fun phoneSystemTechnical() {
        rule.setContent { TrendTheme { TrendApp(Fixtures.ui(tab = Tab.System), object : UiActions {}, Fixtures.now) } }
        rule.onNodeWithTag("tech").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onRoot().captureRoboImage("build/screenshots/phone-system-technical.png")
    }

    @Test @Config(qualifiers = PHONE)
    fun cloudScanButtonStartsAScanAndShowsRecentOnes() {
        var started = 0
        val base = Fixtures.ui(tab = Tab.System)
        val day = com.vh.trend.core.ScanDay.of(Fixtures.now)
        val scans = listOf(
            com.vh.trend.core.CloudScan("$day-2", day, 2, Fixtures.now - 5 * 60_000, "failed", "Lỗi: Gemini API: hết tiền nạp trước (prepay). Nạp thêm trong Google AI Studio > Billing"),
            com.vh.trend.core.CloudScan("$day-1", day, 1, Fixtures.now - 3 * 3_600_000, "done", "Xong.", 11_200, 0.0131),
        )
        val ui = base.copy(sync = base.sync.copy(scans = scans, today = day))
        rule.setContent { TrendTheme { TrendApp(ui, object : UiActions { override fun startScan() { started++ } }, Fixtures.now) } }
        rule.onNodeWithTag("scan-cloud").performScrollTo()
        rule.onRoot().captureRoboImage("build/screenshots/phone-system-cloud-scan.png")
        rule.onNodeWithTag("scan-cloud").performClick()
        rule.waitForIdle()
        assertEquals(1, started)
    }

    // Destructive action (CLAUDE.md): a confirmation dialog, tested for both "Không" and the red action.
    @Test @Config(qualifiers = PHONE)
    fun signOutAsksFirstAndNoKeepsTheSession() {
        var signedOut = 0
        rule.setContent { TrendTheme { TrendApp(Fixtures.ui(tab = Tab.System), object : UiActions { override fun signOut() { signedOut++ } }, Fixtures.now) } }
        rule.onNodeWithTag("signout").performScrollTo().performClick()
        // The dialog is its own window, so onRoot() would match two roots; capture the dialog itself.
        rule.onNode(isDialog()).captureRoboImage("build/screenshots/phone-signout-confirm.png")
        rule.onNodeWithTag("signout-cancel").performClick()
        rule.waitForIdle()
        assertEquals(0, signedOut)
    }

    @Test @Config(qualifiers = PHONE)
    fun signOutConfirmedForgetsTheAccount() {
        var signedOut = 0
        rule.setContent { TrendTheme { TrendApp(Fixtures.ui(tab = Tab.System), object : UiActions { override fun signOut() { signedOut++ } }, Fixtures.now) } }
        rule.onNodeWithTag("signout").performScrollTo().performClick()
        rule.onNodeWithTag("signout-confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, signedOut)
    }

    @Test @Config(qualifiers = PHONE)
    fun signInButtonAsksForTheGoogleAccountPicker() {
        var asked = 0
        rule.setContent { TrendTheme { TrendApp(signedOut(), object : UiActions { override fun signIn() { asked++ } }, Fixtures.now) } }
        rule.onNodeWithTag("signin").performClick()
        assertEquals(1, asked)
    }

    // ---- settings ----

    private fun settings(ui: UiState = Fixtures.ui(tab = Tab.Settings), on: UiActions = object : UiActions {}) =
        rule.setContent { TrendTheme { TrendApp(ui, on, Fixtures.now) } }

    @Test @Config(qualifiers = PHONE)
    fun anInvalidValueIsFlaggedAndCannotBeSent() {
        var saved = 0
        settings(Fixtures.ui(tab = Tab.Settings, draft = mapOf("funnel.digestSize" to JsonPrimitive(99))), object : UiActions { override fun saveSettings() { saved++ } })
        rule.onNodeWithTag("problem-funnel.digestSize").performScrollTo().assertTextEquals("lớn nhất là 30")
        rule.onRoot().captureRoboImage("build/screenshots/phone-settings-invalid.png")
        rule.onNodeWithTag("settings-save").assertIsNotEnabled()
        assertEquals(0, saved)
    }

    @Test @Config(qualifiers = PHONE)
    fun anEditCanBeSentOrDropped() {
        var saved = 0
        var dropped = 0
        settings(Fixtures.ui(tab = Tab.Settings, draft = mapOf("funnel.digestSize" to JsonPrimitive(8))), object : UiActions {
            override fun saveSettings() { saved++ }
            override fun discardSettings() { dropped++ }
        })
        rule.onNodeWithTag("savebar").captureRoboImage("build/screenshots/phone-settings-savebar.png")
        rule.onNodeWithTag("settings-save").performClick()
        rule.onNodeWithTag("settings-discard").performClick()
        assertEquals(1, saved)
        assertEquals(1, dropped)
    }

    @Test @Config(qualifiers = PHONE)
    fun typingANumberEditsTheSetting() {
        val edits = mutableListOf<Pair<String, String>>()
        settings(on = object : UiActions { override fun editSetting(key: String, value: JsonElement, reset: Boolean) { edits += key to value.toString() } })
        rule.onNodeWithTag("set-funnel.digestSize").performScrollTo().performTextReplacement("12")
        assertEquals("funnel.digestSize" to "12", edits.last())
    }

    @Test @Config(qualifiers = PHONE)
    fun settingsOnlyThePcMayChangeAreReadOnly() {
        settings()
        rule.onNodeWithTag("set-server.port").performScrollTo().assertIsNotEnabled()
        rule.onNodeWithTag("advanced-ai").performScrollTo().performClick()
        rule.onNodeWithTag("set-llm.command").performScrollTo().assertIsNotEnabled()
        rule.onNodeWithTag("set-funnel.digestSize").performScrollTo().assertIsEnabled()
    }

    // Destructive action (CLAUDE.md): deleting a topic asks first; "Không" keeps it, "Xoá" removes it from the draft.
    @Test @Config(qualifiers = PHONE)
    fun deletingATopicAsksFirstAndNoKeepsIt() {
        val edits = mutableListOf<String>()
        settings(on = object : UiActions { override fun editSetting(key: String, value: JsonElement, reset: Boolean) { edits += key } })
        rule.onNodeWithTag("del-topic-finance").performScrollTo().performClick()
        rule.onNode(isDialog()).captureRoboImage("build/screenshots/phone-settings-delete-topic.png")
        rule.onNodeWithTag("delete-cancel").performClick()
        rule.waitForIdle()
        assertEquals(emptyList<String>(), edits)
    }

    @Test @Config(qualifiers = PHONE)
    fun deletingATopicConfirmedRemovesOnlyThatTopic() {
        var sent: JsonElement? = null
        settings(on = object : UiActions { override fun editSetting(key: String, value: JsonElement, reset: Boolean) { if (key == "topics") sent = value } })
        rule.onNodeWithTag("del-topic-finance").performScrollTo().performClick()
        rule.onNodeWithTag("delete-confirm").performClick()
        rule.waitForIdle()
        val ids = (sent as JsonArray).map { it.jsonObject["id"]!!.jsonPrimitive.content }
        assertEquals(Fixtures.snapshot.settings!!.values["topics"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content } - "finance", ids)
    }

    @Test @Config(qualifiers = PHONE)
    fun aCategoryChipFiltersExplore() {
        var picked: String? = "none"
        rule.setContent { TrendTheme { TrendApp(Fixtures.ui(tab = Tab.Explore), object : UiActions { override fun category(id: String?) { picked = id } }, Fixtures.now) } }
        rule.onNodeWithTag("cat-productivity").performClick()
        assertEquals("productivity", picked)
        val shown = Fixtures.ui(tab = Tab.Explore, cat = "productivity").items
        assertTrue(shown.isNotEmpty() && shown.all { it.triage.cat == "productivity" })
    }
}
