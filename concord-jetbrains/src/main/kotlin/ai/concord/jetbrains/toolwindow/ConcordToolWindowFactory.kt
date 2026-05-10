// concord-jetbrains/src/main/kotlin/ai/concord/jetbrains/toolwindow/ConcordToolWindowFactory.kt
//
// "View → Tool Windows → Concord" — the in-IDE control surface for the
// plugin. Three tabs:
//   1. Findings — live detector findings streamed from the LSP server.
//   2. Repair  — preview pane for repair-cortex suggestions.
//   3. Wallet  — current Concord Coin balance + recent charges,
//                fetched from /api/keys/usage when signed in.
//
// All three tabs share the bound Project + Disposable so the tool
// window can refresh in response to LSP events without leaking
// listeners on close.

package ai.concord.jetbrains.toolwindow

import ai.concord.jetbrains.actions.ConcordSignInAction
import ai.concord.jetbrains.settings.ConcordSettingsState
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.intellij.util.ui.JBUI
import javax.swing.BorderFactory
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.SwingConstants
import javax.swing.DefaultListModel
import com.intellij.util.io.HttpRequests
import com.intellij.openapi.application.ApplicationManager
import org.json.JSONObject

class ConcordToolWindowFactory : ToolWindowFactory {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val contentFactory = ContentFactory.getInstance()

        toolWindow.contentManager.addContent(
            contentFactory.createContent(buildFindingsPanel(project), "Findings", false)
        )
        toolWindow.contentManager.addContent(
            contentFactory.createContent(buildRepairPanel(project), "Repair", false)
        )
        toolWindow.contentManager.addContent(
            contentFactory.createContent(buildWalletPanel(project), "Wallet", false)
        )
    }

    // ─── Findings ───────────────────────────────────────────────────────

    private fun buildFindingsPanel(project: Project): JPanel {
        val panel = JBPanel<JBPanel<*>>().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = BorderFactory.createEmptyBorder(8, 8, 8, 8)
        }

        val statusLabel = JBLabel("Detector findings will stream here once the LSP is connected.")
        panel.add(statusLabel)

        val model = DefaultListModel<String>()
        // Placeholder rows demonstrating shape. Real rows are pushed by
        // an LSP listener attached in a follow-up commit (lsp4ij wiring).
        model.addElement("(no findings yet — open a file to begin)")

        val list = JList(model)
        val scroll = JBScrollPane(list)
        panel.add(scroll)

        val refreshBtn = JButton("Refresh").apply {
            addActionListener {
                model.clear()
                model.addElement("Refreshing…")
                ApplicationManager.getApplication().executeOnPooledThread {
                    // Real implementation will hit the LSP server's
                    // workspace/diagnostic endpoint via lsp4ij. For the
                    // scaffold landing in this commit we just confirm
                    // the status labels.
                    ApplicationManager.getApplication().invokeLater {
                        model.clear()
                        model.addElement("LSP connection: " +
                            (if (isLspReachable(project)) "active" else "not connected"))
                    }
                }
            }
        }
        panel.add(refreshBtn)

        return panel
    }

    private fun isLspReachable(project: Project): Boolean {
        // Placeholder: real check goes through lsp4ij's status API.
        return ConcordSignInAction.isSignedIn()
    }

    // ─── Repair preview ─────────────────────────────────────────────────

    private fun buildRepairPanel(project: Project): JPanel {
        val panel = JBPanel<JBPanel<*>>().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = BorderFactory.createEmptyBorder(8, 8, 8, 8)
        }
        panel.add(JBLabel("Select a finding in the Findings tab to preview the repair-cortex suggestion."))
        return panel
    }

    // ─── Wallet ─────────────────────────────────────────────────────────

    private fun buildWalletPanel(project: Project): JPanel {
        val panel = JBPanel<JBPanel<*>>().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = BorderFactory.createEmptyBorder(8, 8, 8, 8)
        }
        val balanceLabel = JBLabel("—")
        panel.add(JBLabel("Concord Coin balance:"))
        panel.add(balanceLabel)

        val refreshBtn = JButton("Refresh").apply {
            addActionListener {
                balanceLabel.text = "Loading…"
                ApplicationManager.getApplication().executeOnPooledThread {
                    val token = ConcordSignInAction.readToken()
                    if (token == null) {
                        ApplicationManager.getApplication().invokeLater {
                            balanceLabel.text = "Sign in via Settings → Tools → Concord first."
                        }
                        return@executeOnPooledThread
                    }
                    val state = ConcordSettingsState.getInstance()
                    val apiUrl = state.apiUrl.trimEnd('/')
                    try {
                        val resp = HttpRequests
                            .request("$apiUrl/api/economy/wallet/balance")
                            .tuner { it.setRequestProperty("Authorization", "Bearer $token") }
                            .readString()
                        val json = JSONObject(resp)
                        val cc = json.optDouble("balance", 0.0)
                        ApplicationManager.getApplication().invokeLater {
                            balanceLabel.text = String.format("%.4f CC", cc)
                        }
                    } catch (t: Throwable) {
                        ApplicationManager.getApplication().invokeLater {
                            balanceLabel.text = "Error: ${t.message}"
                        }
                    }
                }
            }
        }
        panel.add(refreshBtn)

        return panel
    }
}
