package com.vh.trend.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Same tokens as the PC dashboard (packages/pipeline/web/index.html :root). Change both together. */
@Immutable
data class Tokens(
    val bg: Color, val surface: Color, val raised: Color, val ink: Color, val ink2: Color, val mute: Color,
    val line: Color, val line2: Color, val accent: Color, val accentInk: Color, val accentSoft: Color,
    val pos: Color, val posSoft: Color, val warn: Color, val warnSoft: Color, val neg: Color,
)

val LightTokens = Tokens(
    bg = Color(0xFFF4F3EF), surface = Color(0xFFFBFAF7), raised = Color(0xFFFFFFFF), ink = Color(0xFF1C1B18), ink2 = Color(0xFF4A4842),
    mute = Color(0xFF77746B), line = Color(0xFFE2DFD6), line2 = Color(0xFFCFCBC0), accent = Color(0xFFB5461F), accentInk = Color.White,
    accentSoft = Color(0xFFF6E6DD), pos = Color(0xFF2F6B45), posSoft = Color(0xFFE3EFE6), warn = Color(0xFF8A6100), warnSoft = Color(0xFFF5ECD3),
    neg = Color(0xFFA32D23),
)

val DarkTokens = Tokens(
    bg = Color(0xFF141412), surface = Color(0xFF1A1A17), raised = Color(0xFF211F1C), ink = Color(0xFFEBE8E0), ink2 = Color(0xFFC4C0B5),
    mute = Color(0xFF918D82), line = Color(0xFF2C2B27), line2 = Color(0xFF3C3A34), accent = Color(0xFFE2805A), accentInk = Color(0xFF1A0E08),
    accentSoft = Color(0xFF3A2419), pos = Color(0xFF86C39A), posSoft = Color(0xFF1C2D22), warn = Color(0xFFD9B45A), warnSoft = Color(0xFF352B14),
    neg = Color(0xFFEC8F84),
)

val LocalTokens = staticCompositionLocalOf { LightTokens }

object T {
    val c: Tokens @Composable get() = LocalTokens.current
}

@Composable
fun TrendTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val t = if (dark) DarkTokens else LightTokens
    val scheme = if (dark) {
        darkColorScheme(
            primary = t.ink, onPrimary = t.bg, secondary = t.accent, onSecondary = t.accentInk, background = t.bg, onBackground = t.ink,
            surface = t.surface, onSurface = t.ink, surfaceVariant = t.raised, onSurfaceVariant = t.ink2, outline = t.line2, outlineVariant = t.line,
            error = t.neg, surfaceContainer = t.surface, surfaceContainerHigh = t.raised, surfaceContainerLow = t.bg, secondaryContainer = t.accentSoft,
            onSecondaryContainer = t.ink, inverseSurface = t.ink, inverseOnSurface = t.bg, inversePrimary = t.accent,
        )
    } else {
        lightColorScheme(
            primary = t.ink, onPrimary = t.bg, secondary = t.accent, onSecondary = t.accentInk, background = t.bg, onBackground = t.ink,
            surface = t.surface, onSurface = t.ink, surfaceVariant = t.raised, onSurfaceVariant = t.ink2, outline = t.line2, outlineVariant = t.line,
            error = t.neg, surfaceContainer = t.surface, surfaceContainerHigh = t.raised, surfaceContainerLow = t.bg, secondaryContainer = t.accentSoft,
            onSecondaryContainer = t.ink, inverseSurface = t.ink, inverseOnSurface = t.bg, inversePrimary = t.accent,
        )
    }
    val type = Typography(
        headlineSmall = TextStyle(fontSize = 22.sp, lineHeight = 27.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
        titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
        bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = TextStyle(fontSize = 12.5.sp, lineHeight = 17.sp),
        labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
        labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
        labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp),
    )
    CompositionLocalProvider(LocalTokens provides t) {
        MaterialTheme(colorScheme = scheme, typography = type, content = content)
    }
}
