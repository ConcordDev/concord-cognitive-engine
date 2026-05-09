// concord-jetbrains/src/main/kotlin/ai/concord/jetbrains/actions/ConcordSignInAction.kt
//
// Sign-in flow that mirrors the VS Code path (concord-vscode/src/extension.ts):
//   1. Open a temporary loopback HTTP listener on 127.0.0.1:<random port>.
//   2. Open the user's browser to <apiUrl>/oauth/dx?client=jetbrains&state=&port=.
//   3. When the redirect lands at http://127.0.0.1:<port>/callback?code=&state=,
//      exchange the code via POST /api/dx/exchange and store the resulting
//      csk_* token in the IDE PasswordSafe (encrypted credential store).
//
// The plugin matches the VS Code extension byte-for-byte on the wire so a
// future federation-of-IDE-clients story doesn't have parity drift.

package ai.concord.jetbrains.actions

import ai.concord.jetbrains.settings.ConcordSettingsState
import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.credentialStore.generateServiceName
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.ui.Messages
import com.intellij.util.io.HttpRequests
import com.sun.net.httpserver.HttpServer
import org.json.JSONObject
import java.awt.Desktop
import java.net.InetSocketAddress
import java.net.URI
import java.security.SecureRandom
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class ConcordSignInAction : AnAction("Sign in with Concord") {
    private val logger = Logger.getInstance(ConcordSignInAction::class.java)

    override fun actionPerformed(e: AnActionEvent) {
        startSignIn()
    }

    /**
     * Public entry-point so the Settings panel can start the flow
     * without going through the AnAction dispatch.
     */
    fun startSignIn() {
        val state = ConcordSettingsState.getInstance()
        val apiUrl = state.apiUrl.trimEnd('/')
        val random = ByteArray(16)
        SecureRandom().nextBytes(random)
        val csrfState = random.joinToString("") { "%02x".format(it) }

        val grantFuture = CompletableFuture<OAuthGrant?>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val port = server.address.port

        server.createContext("/callback") { exchange ->
            try {
                val query = exchange.requestURI.rawQuery ?: ""
                val params = query.split("&").mapNotNull {
                    val (k, v) = (it.split("=", limit = 2).takeIf { kv -> kv.size == 2 } ?: return@mapNotNull null)
                    URI("?$k=$v").rawQuery!!.split("=")[0] to URI("?$k=$v").query.split("=")[1]
                }.toMap()

                val code  = params["code"]
                val state2 = params["state"]
                val response = ("<!doctype html><body style=\"font:16px/1.5 system-ui;text-align:center;padding:8vh\">" +
                                "<h1>Concord — Authorized</h1><p>You can close this tab. Return to your IDE.</p></body>")
                    .toByteArray(Charsets.UTF_8)
                exchange.responseHeaders.add("Content-Type", "text/html; charset=utf-8")
                exchange.sendResponseHeaders(200, response.size.toLong())
                exchange.responseBody.use { it.write(response) }

                if (code != null && state2 != null && state2 == csrfState) {
                    ApplicationManager.getApplication().executeOnPooledThread {
                        try {
                            val grant = exchangeCode(apiUrl, code, csrfState)
                            grantFuture.complete(grant)
                        } catch (t: Throwable) {
                            logger.warn("Concord exchange failed", t)
                            grantFuture.complete(null)
                        }
                    }
                } else {
                    grantFuture.complete(null)
                }
            } catch (t: Throwable) {
                logger.warn("Concord callback handler failed", t)
                grantFuture.complete(null)
            } finally {
                ApplicationManager.getApplication().executeOnPooledThread {
                    Thread.sleep(500); server.stop(0)
                }
            }
        }
        server.start()

        // Open the consent page in the user's browser.
        val consentUrl = "$apiUrl/oauth/dx?client=jetbrains&state=$csrfState&port=$port"
        try {
            Desktop.getDesktop().browse(URI(consentUrl))
        } catch (t: Throwable) {
            logger.warn("Could not open browser; falling back to message dialog", t)
            Messages.showInfoMessage(
                "Visit this URL to complete sign-in:\n\n$consentUrl",
                "Concord Sign-In"
            )
        }

        // Wait up to 5 minutes for the redirect.
        try {
            val grant = grantFuture.get(5, TimeUnit.MINUTES)
            if (grant != null) {
                storeToken(grant.token)
                Messages.showInfoMessage(
                    "Signed in to Concord. Token stored in IDE PasswordSafe.",
                    "Concord Sign-In"
                )
            } else {
                Messages.showWarningDialog(
                    "Sign-in did not complete. Try again from Settings → Tools → Concord.",
                    "Concord Sign-In"
                )
            }
        } catch (t: Throwable) {
            Messages.showWarningDialog(
                "Sign-in timed out. Try again from Settings → Tools → Concord.",
                "Concord Sign-In"
            )
        } finally {
            try { server.stop(0) } catch (_: Throwable) { /* noop */ }
        }
    }

    private fun exchangeCode(apiUrl: String, code: String, state: String): OAuthGrant? {
        val body = JSONObject().apply {
            put("code", code); put("state", state)
        }.toString()
        val resp = HttpRequests
            .post("$apiUrl/api/dx/exchange", "application/json")
            .connect { req ->
                req.connection.doOutput = true
                req.write(body)
                req.readString()
            }
        val json = JSONObject(resp)
        if (!json.optBoolean("ok", false)) return null
        return OAuthGrant(
            token = json.getString("token"),
            tokenId = json.optString("token_id", ""),
            client = json.optString("client", "jetbrains"),
        )
    }

    companion object {
        private const val SUBSYSTEM = "Concord DX"
        private const val USERNAME = "concord-csk"

        @JvmStatic
        fun isSignedIn(): Boolean = readToken() != null

        @JvmStatic
        fun readToken(): String? {
            val attr = CredentialAttributes(generateServiceName(SUBSYSTEM, USERNAME))
            return PasswordSafe.instance.getPassword(attr)
        }

        @JvmStatic
        fun storeToken(token: String) {
            val attr = CredentialAttributes(generateServiceName(SUBSYSTEM, USERNAME))
            PasswordSafe.instance.set(attr, Credentials(USERNAME, token))
        }

        @JvmStatic
        fun clearToken() {
            val attr = CredentialAttributes(generateServiceName(SUBSYSTEM, USERNAME))
            PasswordSafe.instance.set(attr, null)
        }
    }

    data class OAuthGrant(val token: String, val tokenId: String, val client: String)
}
