// concord-jetbrains/src/main/kotlin/ai/concord/jetbrains/lsp/ConcordLanguageServerFactory.kt
//
// LSP4IJ entry point for Concord DX. Registered in plugin.xml under the
// com.redhat.devtools.lsp4ij.server extension point (id
// "concordLanguageServer"); the file-name-pattern mappings alongside it
// attach the server to JS/TS/Python/JSON files. Diagnostics the server
// publishes render as inline editor highlights via LSP4IJ's own client
// (LanguageClientImpl.publishDiagnostics is final in LSP4IJ 0.5.0, so
// the default client is used as-is — no custom client class needed).

package ai.concord.jetbrains.lsp

import com.intellij.openapi.project.Project
import com.redhat.devtools.lsp4ij.LanguageServerFactory
import com.redhat.devtools.lsp4ij.server.StreamConnectionProvider

class ConcordLanguageServerFactory : LanguageServerFactory {

    override fun createConnectionProvider(project: Project): StreamConnectionProvider =
        ConcordLanguageServer(project)
}
