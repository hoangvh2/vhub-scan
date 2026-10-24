package com.vh.trend.ui

import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.captureRoboImage
import com.vh.trend.core.Source
import org.junit.Assert.assertEquals
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

    @Test @Config(qualifiers = PHONE) fun phoneToday() = shot("phone-today-light", Fixtures.ui())
    @Test @Config(qualifiers = PHONE) fun phoneTodayDark() = shot("phone-today-dark", Fixtures.ui(), dark = true)
    @Test @Config(qualifiers = PHONE) fun phoneDetail() = shot("phone-detail-light", Fixtures.ui(selected = Fixtures.snapshot.digest.first().id))
    @Test @Config(qualifiers = PHONE) fun phoneDetailDark() = shot("phone-detail-dark", Fixtures.ui(selected = Fixtures.snapshot.digest.first().id), dark = true)
    @Test @Config(qualifiers = SMALL_PHONE) fun smallPhoneDetail() = shot("phone360-detail-light", Fixtures.ui(selected = Fixtures.snapshot.digest.first().id))
    @Test @Config(qualifiers = PHONE) fun phoneKeptFromCloud() = shot("phone-kept-cloud", Fixtures.ui(Source.Cloud, Tab.Kept, pending = 2))
    @Test @Config(qualifiers = PHONE) fun phoneSystem() = shot("phone-system-dark", Fixtures.ui(tab = Tab.System), dark = true)
    @Test @Config(qualifiers = PHONE) fun phoneOffline() = shot("phone-offline-cache", Fixtures.ui(Source.Cache, error = "Đang xem bản lưu trên điện thoại; không thấy PC trong mạng này."))
    @Test @Config(qualifiers = PHONE) fun phonePair() = shot("phone-pair", Fixtures.ui().let { it.copy(sync = it.sync.copy(paired = false, snapshot = null)) })
    @Test @Config(qualifiers = TABLET) fun tabletToday() = shot("tablet-today-light", Fixtures.ui())
    @Test @Config(qualifiers = TABLET) fun tabletExploreDark() = shot("tablet-explore-dark", Fixtures.ui(tab = Tab.Explore), dark = true)

    // Destructive action (CLAUDE.md): a confirmation dialog, tested for both "Không" and the red action.
    @Test @Config(qualifiers = PHONE)
    fun unpairAsksFirstAndNoKeepsThePairing() {
        var unpaired = 0
        rule.setContent { TrendTheme { TrendApp(Fixtures.ui(tab = Tab.System), object : UiActions { override fun unpair() { unpaired++ } }, Fixtures.now) } }
        rule.onNodeWithTag("unpair").performScrollTo().performClick()
        // The dialog is its own window, so onRoot() would match two roots; capture the dialog itself.
        rule.onNode(isDialog()).captureRoboImage("build/screenshots/phone-unpair-confirm.png")
        rule.onNodeWithTag("unpair-cancel").performClick()
        rule.waitForIdle()
        assertEquals(0, unpaired)
    }

    @Test @Config(qualifiers = PHONE)
    fun unpairConfirmedForgetsThePc() {
        var unpaired = 0
        rule.setContent { TrendTheme { TrendApp(Fixtures.ui(tab = Tab.System), object : UiActions { override fun unpair() { unpaired++ } }, Fixtures.now) } }
        rule.onNodeWithTag("unpair").performScrollTo().performClick()
        rule.onNodeWithTag("unpair-confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, unpaired)
    }
}
