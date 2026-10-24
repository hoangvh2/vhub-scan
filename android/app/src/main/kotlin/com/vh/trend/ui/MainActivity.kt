package com.vh.trend.ui

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.vh.trend.core.Item
import com.vh.trend.core.Action
import com.vh.trend.core.JdkHttp
import com.vh.trend.core.TrendRepository
import com.vh.trend.data.PrefsKeyValue
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                AppViewModel(TrendRepository(JdkHttp, PrefsKeyValue(applicationContext), device = Build.MODEL.take(40))) as T
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Fresh data whenever the app comes to the front, and every 2 minutes while it stays there.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    vm.refresh()
                    delay(120_000)
                }
            }
        }
        val actions = object : UiActions {
            override fun refresh() = vm.refresh()
            override fun tab(t: Tab) = vm.tab(t)
            override fun select(id: String?) = vm.select(id)
            override fun query(q: String) = vm.query(q)
            override fun act(item: Item, action: Action, message: String) = vm.act(item, action, message)
            override fun undo(n: Notice) = vm.undo(n)
            override fun dismissNotice() = vm.dismissNotice()
            override fun pair(text: String) = vm.pair(text)
            override fun unpair() = vm.unpair()
            override fun scan() = scanQr()
        }
        setContent {
            val ui by vm.state.collectAsStateWithLifecycle()
            TrendTheme { TrendApp(ui, actions) }
        }
    }

    private fun scanQr() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { code -> code.rawValue?.let(vm::pair) ?: vm.pairFailed("Không đọc được mã. Thử lại, hoặc dán mã dạng chữ.") }
            .addOnFailureListener { vm.pairFailed("Không mở được trình quét (cần Google Play services). Dùng ô dán mã bên dưới.") }
    }
}
