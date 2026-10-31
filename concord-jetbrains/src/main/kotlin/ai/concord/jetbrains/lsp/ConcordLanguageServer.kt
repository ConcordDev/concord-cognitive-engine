// concord-jetbrains/src/main/kotlin/ai/concord/jetbrains/lsp/ConcordLanguageServer.kt
//
// The concord-lsp connection provider for LSP4IJ. Launches the bundled
// concord-lsp (Node, stdio) and hands it the initializationOptions the
// server reads in its onInitialize handler (concord-lsp/src/server.ts):
//   { serverUrl, apiKey, streamPath }
// serverUrl comes from ConcordSettingsState.apiUrl, apiKey from the IDE
// PasswordSafe token (ConcordSignInAction), streamPath is the /dx
// Socket.IO namespace the server subscribes to.
//
// Server entrypoint resolution, per ConcordSettingsState.lspServerOverride:
//   1. the override path, when set;
//   2. the bundled copy at <pluginPath>/lsp/server.js (placed there by
//      the prepareSandbox bundling in build.gradle.kts, which requires
//      concord-lsp to be compiled first — see concord-jetbrains/README).
// If neither exists, ProcessStreamConnectionProvider.start() fails with
// CannotStartProcessException and LSP4IJ surfaces the error in its LSP
// console — an honest failure, never a fake "connected".

package ai.concord.jetbrains.lsp

import ai.concord.jetbrains.actions.ConcordSignInAction
import ai.concord.jetbrains.settings.ConcordSettingsState
import com.google.gson.JsonObject
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.redhat.devtools.lsp4ij.server.ProcessStreamConnectionProvider
import java.io.File

class ConcordLanguageServer(project: Project) : ProcessStreamConnectionProvider() {

    init {
        setCommands(listOf("node", resolveServerEntrypoint(), "--stdio"))
        project.basePath?.let { setWorkingDirectory(it) }
    }

    override fun getInitializationOptions(rootUri: VirtualFile?): Any {
        val state = ConcordSettingsState.getInstance()
        return JsonObject().apply {
            addProperty("serverUrl", state.apiUrl.trimEnd('/'))
            addProperty("apiKey", ConcordSignInAction.readToken() ?: "")
            addProperty("streamPath", "/dx")
        }
    }

    companion object {
        fun resolveServerEntrypoint(): String {
            val override = ConcordSettingsState.getInstance().lspServerOverride.trim()
            if (override.isNotEmpty()) return override
            val pluginPath = PluginManagerCore
                .getPlugin(PluginId.getId("ai.concord.jetbrains"))?.pluginPath
            return if (pluginPath != null) {
                pluginPath.resolve("lsp").resolve("server.js").toString()
            } else {
                // No plugin descriptor (should not happen outside tests):
                // fall back to a PATH-relative name so the start attempt
                // fails visibly instead of silently doing nothing.
                File("lsp/server.js").path
            }
        }

        /** True when the entrypoint the provider would launch exists. */
        fun isServerEntrypointPresent(): Boolean =
            File(resolveServerEntrypoint()).isFile
    }
}
