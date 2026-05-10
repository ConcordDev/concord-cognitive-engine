// concord-jetbrains/src/main/kotlin/ai/concord/jetbrains/settings/ConcordSettingsState.kt
//
// Persistent application-level settings for the Concord DX plugin.
// Stored under ~/.config/JetBrains/<IDE>/options/concord-dx.xml so the
// configuration follows the user across projects on the same workstation.

package ai.concord.jetbrains.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

@Service(Service.Level.APP)
@State(
    name = "ConcordDxSettings",
    storages = [Storage("concord-dx.xml")]
)
class ConcordSettingsState : PersistentStateComponent<ConcordSettingsState> {
    /** Concord API endpoint. Override for self-hosted instances. */
    var apiUrl: String = "https://concord-os.org"

    /** Pre-emptive cost cap (in Concord Coin). Operations above this prompt the user. */
    var billingConfirmThresholdCC: Double = 0.10

    /**
     * JSON-encoded { ruleId: severity } where severity is one of
     * error / warning / info / hint / off. Stored as a string so the
     * persistent serializer doesn't fight a typed Map.
     */
    var severityWeightsJson: String = "{}"

    /**
     * Optional override for the LSP server command. Empty string means
     * "use bundled concord-lsp/server.js". Path to a Node entrypoint.
     */
    var lspServerOverride: String = ""

    override fun getState(): ConcordSettingsState = this

    override fun loadState(state: ConcordSettingsState) {
        XmlSerializerUtil.copyBean(state, this)
    }

    companion object {
        fun getInstance(): ConcordSettingsState =
            ApplicationManager.getApplication().getService(ConcordSettingsState::class.java)
    }
}
