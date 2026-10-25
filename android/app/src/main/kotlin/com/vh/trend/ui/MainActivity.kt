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
import com.vh.trend.BuildConfig
import com.vh.trend.core.Action
import com.vh.trend.core.CloudSettings
import com.vh.trend.core.Item
import com.vh.trend.core.JdkHttp
import com.vh.trend.core.TrendRepository
import com.vh.trend.data.PrefsKeyValue
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val settings = CloudSettings(BuildConfig.FIREBASE_PROJECT_ID, BuildConfig.FIREBASE_API_KEY, BuildConfig.FIREBASE_WEB_CLIENT_ID, BuildConfig.FIREBASE_OWNER_UID)

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                AppViewModel(TrendRepository(JdkHttp, PrefsKeyValue(applicationContext), settings, device = Build.MODEL.take(40))) as T
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
            override fun signIn() = pickGoogleAccount()
            override fun signOut() {
                vm.signOut()
                lifecycleScope.launch { GoogleSignIn.forget(this@MainActivity) }
            }
        }
        setContent {
            val ui by vm.state.collectAsStateWithLifecycle()
            TrendTheme { TrendApp(ui, actions) }
        }
    }

    private fun pickGoogleAccount() {
        vm.signingIn()
        lifecycleScope.launch {
            when (val r = GoogleSignIn.pick(this@MainActivity, settings.webClientId)) {
                is GoogleResult.Token -> vm.signIn(r.idToken)
                GoogleResult.Cancelled -> vm.signInFailed(null)
                is GoogleResult.Failed -> vm.signInFailed(r.message)
            }
        }
    }
}
