package com.vh.trend.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vh.trend.core.Action
import com.vh.trend.core.Item
import com.vh.trend.core.SyncState
import com.vh.trend.core.TrendRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class Tab(val label: String) { Today("Hôm nay"), Kept("Đã giữ"), Explore("Khám phá"), System("Hệ thống") }

/** A short confirmation with an optional Undo, shown in the snackbar. */
data class Notice(val id: Long, val text: String, val undo: Pair<Item, String>? = null)

data class UiState(
    val sync: SyncState,
    val refreshing: Boolean = false,
    val tab: Tab = Tab.Today,
    val selectedId: String? = null,
    val query: String = "",
    val notice: Notice? = null,
    val signingIn: Boolean = false,
    val signInError: String? = null,
) {
    val snapshot get() = sync.snapshot

    /** Items of the current tab, filtered by the search box on Explore. */
    val items: List<Item>
        get() {
            val s = snapshot ?: return emptyList()
            return when (tab) {
                Tab.Today -> s.digest
                Tab.Kept -> s.kept.sortedBy { if (it.userState == "trying") 0 else 1 }
                Tab.Explore -> {
                    val all = (s.digest + s.explore + s.kept).distinctBy { it.id }.sortedByDescending { it.triage.score ?: -1 }
                    val q = query.trim().lowercase()
                    if (q.isEmpty()) all else all.filter { i -> listOf(i.title, i.description, i.triage.why.orEmpty(), i.topics.joinToString(" ")).any { it.lowercase().contains(q) } }
                }
                Tab.System -> emptyList()
            }
        }

    val selected: Item? get() = selectedId?.let { id -> snapshot?.find(id) }
}

class AppViewModel(private val repo: TrendRepository) : ViewModel() {
    private val _state = MutableStateFlow(UiState(repo.state()))
    val state: StateFlow<UiState> = _state
    private var refreshJob: Job? = null
    private var noticeId = 0L

    fun refresh() {
        if (refreshJob?.isActive == true || !_state.value.sync.signedIn) return
        refreshJob = viewModelScope.launch {
            _state.update { it.copy(refreshing = true) }
            val s = repo.refresh()
            _state.update { it.copy(sync = s, refreshing = false) }
        }
    }

    fun tab(t: Tab) = _state.update { it.copy(tab = t, selectedId = null) }
    fun select(id: String?) = _state.update { it.copy(selectedId = id) }
    fun query(q: String) = _state.update { it.copy(query = q) }
    fun dismissNotice() = _state.update { it.copy(notice = null) }

    fun act(item: Item, action: Action, message: String) {
        viewModelScope.launch {
            val prev = item.userState
            val s = repo.act(item, action)
            _state.update { it.copy(sync = s, notice = Notice(++noticeId, message, item to prev)) }
            refresh()
        }
    }

    fun undo(n: Notice) {
        val (item, prev) = n.undo ?: return
        viewModelScope.launch {
            val s = repo.act(item, Action.restoring(prev))
            _state.update { it.copy(sync = s, notice = null) }
            refresh()
        }
    }

    /** Google's account picker has returned an ID token: turn it into a Firebase session, then load the data. */
    fun signIn(googleIdToken: String) {
        _state.update { it.copy(signingIn = true, signInError = null) }
        viewModelScope.launch {
            val error = repo.signIn(googleIdToken)
            val s = if (error == null) repo.refresh() else repo.state()
            _state.update { UiState(sync = s, signInError = error) }
        }
    }

    fun signingIn() = _state.update { it.copy(signingIn = true, signInError = null) }
    fun signInFailed(message: String?) = _state.update { it.copy(signingIn = false, signInError = message) }

    fun signOut() {
        repo.signOut()
        _state.value = UiState(repo.state())
    }
}
