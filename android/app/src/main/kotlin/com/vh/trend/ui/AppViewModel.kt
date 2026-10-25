package com.vh.trend.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vh.trend.core.Action
import com.vh.trend.core.Item
import com.vh.trend.core.SettingError
import com.vh.trend.core.SettingRules
import com.vh.trend.core.Topic
import com.vh.trend.core.TrendJson
import com.vh.trend.core.SyncState
import com.vh.trend.core.TrendRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

enum class Tab(val label: String) { Today("Hôm nay"), Kept("Đã giữ"), Explore("Khám phá"), System("Hệ thống"), Settings("Cài đặt") }

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
    /** Explore: only this category (a topic id, or "other"). */
    val cat: String? = null,
    /** Settings edited on this screen and not sent yet: setting key -> new value. */
    val draft: Map<String, JsonElement> = emptyMap(),
    /** Bumped when the editors must re-read their values (after discard, send, add or delete). */
    val draftGen: Int = 0,
    /** What the last send was refused for, per setting key. */
    val settingsErrors: List<SettingError> = emptyList(),
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
                    val inCat = if (cat == null) all else all.filter { it.triage.cat == cat }
                    if (q.isEmpty()) inCat else inCat.filter { i -> listOf(i.title, i.description, i.triage.why.orEmpty(), i.topics.joinToString(" ")).any { it.lowercase().contains(q) } }
                }
                Tab.System, Tab.Settings -> emptyList()
            }
        }

    /** The value a setting shows: the unsent edit, else what the PC has (with changes still on their way on top). */
    fun settingValue(key: String): JsonElement? = draft[key] ?: snapshot?.settings?.values?.get(key)

    /** Problems with the unsent edits, checked the way the PC will check them. */
    val draftProblems: Map<String, String>
        get() {
            val st = snapshot?.settings ?: return emptyMap()
            return draft.mapNotNull { (k, v) -> st.def(k)?.let { d -> SettingRules.problem(d, v)?.let { k to it } } }.toMap()
        }

    /** A category's name ("Năng suất cá nhân"), for ids the PC knows; "other" reads "Khác". */
    fun categoryLabel(id: String?): String? = snapshot?.settings?.label(id)

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
    fun category(id: String?) = _state.update { it.copy(cat = id) }

    /** An edit on the settings screen. Back to the PC's value = no longer a change. [reset]: editors re-read values. */
    fun editSetting(key: String, value: JsonElement, reset: Boolean = false) = _state.update {
        val saved = it.snapshot?.settings?.values?.get(key)
        val draft = if (value == saved) it.draft - key else it.draft + (key to value)
        it.copy(draft = draft, draftGen = it.draftGen + if (reset) 1 else 0, settingsErrors = it.settingsErrors.filter { e -> e.key != key })
    }

    fun discardSettings() = _state.update { it.copy(draft = emptyMap(), draftGen = it.draftGen + 1, settingsErrors = emptyList()) }

    /** Queues the edits for the PC (through the cloud) and sends them right away when online. */
    fun saveSettings() {
        val draft = _state.value.draft
        if (draft.isEmpty()) return
        viewModelScope.launch {
            val patch = draft.mapValues { (k, v) -> if (k == "topics") namedTopics(v) else v }
            val (s, errors) = repo.changeSettings(JsonObject(patch))
            _state.update {
                if (errors.isNotEmpty()) it.copy(sync = s, settingsErrors = errors)
                else it.copy(sync = s, draft = emptyMap(), draftGen = it.draftGen + 1, settingsErrors = emptyList(), notice = Notice(++noticeId, "Đã gửi về PC. Thay đổi có hiệu lực từ lần quét sau."))
            }
            if (errors.isEmpty()) refresh()
        }
    }

    private fun namedTopics(v: JsonElement): JsonElement {
        val ser = ListSerializer(Topic.serializer())
        val topics = runCatching { TrendJson.decodeFromJsonElement(ser, v) }.getOrNull() ?: return v
        return TrendJson.encodeToJsonElement(ser, SettingRules.withTopicIds(topics))
    }
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
