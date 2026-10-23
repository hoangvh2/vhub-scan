package com.vhub.scan

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.opencv.android.OpenCVLoader

sealed interface Screen {
    data object Home : Screen
    data object Capture : Screen
    data object Report : Screen
    data class Edit(val id: String) : Screen
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val cvOk = OpenCVLoader.initLocal()
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    if (!cvOk) {
                        Column(Modifier.padding(24.dp)) { Text("OpenCV native library failed to load.") }
                    } else {
                        AppRoot()
                    }
                }
            }
        }
    }
}

@Composable
fun AppRoot() {
    val ctx = LocalContext.current
    val store = remember { PageStore(ctx) }
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    BackHandler(enabled = screen != Screen.Home) { screen = Screen.Home }
    when (val s = screen) {
        Screen.Home -> HomeScreen(store, onNav = { screen = it })
        Screen.Capture -> CaptureScreen(store, onDone = { screen = Screen.Edit(it) }, onBack = { screen = Screen.Home })
        Screen.Report -> ReportScreen(onBack = { screen = Screen.Home })
        is Screen.Edit -> EditScreen(store, s.id, onBack = { screen = Screen.Home })
    }
}
