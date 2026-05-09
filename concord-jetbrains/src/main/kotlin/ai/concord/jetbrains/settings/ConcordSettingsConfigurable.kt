// concord-jetbrains/src/main/kotlin/ai/concord/jetbrains/settings/ConcordSettingsConfigurable.kt
//
// Settings panel reachable via Settings → Tools → Concord. Lets the
// operator configure API URL, billing threshold, severity weights, and
// LSP override path. The bound state is ConcordSettingsState (the
// PersistentStateComponent declared in this same package).

package ai.concord.jetbrains.settings

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.ui.MessageDialogBuilder
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBTextField
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JTextField
import javax.swing.JButton
import org.json.JSONObject
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets

class ConcordSettingsConfigurable : Configurable {
    private val state get() = ConcordSettingsState.getInstance()

    private val apiUrlField = JBTextField()
    private val billingThresholdField = JBTextField()
    private val severityField = JBTextArea(6, 40)
    private val lspOverrideField = JBTextField()
    private val signInButton = JButton("Sign in with Concord")
    private val signedInLabel = JBLabel("Not signed in.")

    override fun getDisplayName(): String = "Concord"

    override fun createComponent(): JComponent {
        val panel = JBPanel<JBPanel<*>>(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            insets = Insets(4, 6, 4, 6)
            anchor = GridBagConstraints.WEST
        }

        var row = 0
        fun addRow(label: String, field: JComponent) {
            gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0
            panel.add(JLabel(label), gbc)
            gbc.gridx = 1; gbc.weightx = 1.0; gbc.fill = GridBagConstraints.HORIZONTAL
            panel.add(field, gbc)
            gbc.fill = GridBagConstraints.NONE
            row++
        }

        addRow("API URL:", apiUrlField.also { it.toolTipText = "https://concord-os.org for production. http://localhost:5050 for local dev." })
        addRow("Billing confirm threshold (CC):", billingThresholdField.also { it.toolTipText = "Prompt before any single operation that costs more than this amount of Concord Coin. 0 = always prompt; large value = never prompt." })
        addRow("LSP server override (optional):", lspOverrideField.also { it.toolTipText = "Path to a custom concord-lsp entrypoint. Leave blank to use the bundled binary." })

        gbc.gridx = 0; gbc.gridy = row; gbc.gridwidth = 2; gbc.fill = GridBagConstraints.HORIZONTAL
        panel.add(JLabel("Severity weights (JSON map of ruleId → severity):"), gbc)
        row++
        gbc.gridy = row
        panel.add(severityField, gbc)
        row++
        gbc.gridwidth = 1

        // Sign-in row
        gbc.gridy = row; gbc.gridx = 0; gbc.weightx = 0.0
        panel.add(signInButton, gbc)
        gbc.gridx = 1; gbc.weightx = 1.0; gbc.fill = GridBagConstraints.HORIZONTAL
        panel.add(signedInLabel, gbc)
        row++

        signInButton.addActionListener {
            // Lazy-import: the sign-in action lives in actions/ConcordSignInAction.
            // We trigger via reflection to avoid a circular Kotlin dep at compile time.
            try {
                val cls = Class.forName("ai.concord.jetbrains.actions.ConcordSignInAction")
                val instance = cls.getDeclaredConstructor().newInstance()
                cls.getMethod("startSignIn").invoke(instance)
            } catch (e: Throwable) {
                MessageDialogBuilder.okCancel(
                    "Sign-in unavailable",
                    "Concord sign-in could not start: ${e.message}"
                ).show()
            }
        }

        reset()
        return panel
    }

    override fun isModified(): Boolean =
        apiUrlField.text != state.apiUrl ||
        billingThresholdField.text != state.billingConfirmThresholdCC.toString() ||
        severityField.text.trim() != state.severityWeightsJson.trim() ||
        lspOverrideField.text != state.lspServerOverride

    override fun apply() {
        // Validate API URL.
        val url = apiUrlField.text.trim()
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw ConfigurationException("API URL must start with http:// or https://")
        }
        // Validate billing threshold.
        val threshold = billingThresholdField.text.trim().toDoubleOrNull()
            ?: throw ConfigurationException("Billing threshold must be a number (e.g. 0.10)")
        if (threshold < 0) {
            throw ConfigurationException("Billing threshold must be non-negative")
        }
        // Validate severity-weights JSON.
        val severityJson = severityField.text.trim().ifEmpty { "{}" }
        try {
            JSONObject(severityJson)
        } catch (e: Throwable) {
            throw ConfigurationException("Severity weights must be a JSON object: ${e.message}")
        }

        state.apiUrl = url
        state.billingConfirmThresholdCC = threshold
        state.severityWeightsJson = severityJson
        state.lspServerOverride = lspOverrideField.text.trim()
    }

    override fun reset() {
        apiUrlField.text = state.apiUrl
        billingThresholdField.text = state.billingConfirmThresholdCC.toString()
        severityField.text = state.severityWeightsJson
        lspOverrideField.text = state.lspServerOverride

        // Indicate sign-in status. The token is in the IDE's PasswordSafe
        // (loaded by ConcordSignInAction); we just ask whether one exists.
        try {
            val cls = Class.forName("ai.concord.jetbrains.actions.ConcordSignInAction")
            val isSignedIn = cls.getMethod("isSignedIn").invoke(null) as? Boolean ?: false
            signedInLabel.text = if (isSignedIn) "Signed in." else "Not signed in."
        } catch (_: Throwable) {
            signedInLabel.text = "Sign-in status unknown."
        }
    }
}
