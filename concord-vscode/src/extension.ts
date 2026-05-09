// concord-vscode/src/extension.ts
//
// VS Code extension entrypoint for Concord DX.
//
// Responsibilities:
//   1. Spawn the bundled concord-lsp process as a language client.
//   2. Wire "Sign in with Concord" → loopback OAuth (RFC 8252, server
//      side at /oauth/dx).
//   3. Surface detector findings + wallet status in the Concord side
//      panel (defined in package.json contributes.views).
//   4. Bill against the user's Concord Coin balance for any LSP
//      operation that maps to a server-side macro call.
//
// The actual heavy lifting (detector logic, repair-cortex, billing)
// lives server-side. This extension is a thin wrapper around the LSP
// client + an HTTP shim to /api/dx/exchange and /api/keys/usage.

import * as http from "node:http";
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

const SECRET_KEY = "concord.csk_token";

interface OAuthGrant {
  token: string;
  token_id: string;
  client: string;
}

export function activate(context: vscode.ExtensionContext): void {
  // ── Language client ──────────────────────────────────────────────
  const lspMainCfg = vscode.workspace.getConfiguration("concord").get<string[]>("lspServerCommand", []);
  const serverModule = lspMainCfg.length > 0
    ? lspMainCfg[0]
    : context.asAbsolutePath(path.join("..", "concord-lsp", "out", "server.js"));

  const serverOptions: ServerOptions = {
    run:   { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6011"] } },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file" }],
    synchronize: {
      configurationSection: "concord",
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*"),
    },
  };

  client = new LanguageClient("concord", "Concord DX", serverOptions, clientOptions);
  client.start().catch((err) => {
    vscode.window.showErrorMessage(`Concord LSP failed to start: ${err.message}`);
  });

  // ── Sign in / out commands ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("concord.signIn", () => signIn(context)),
    vscode.commands.registerCommand("concord.signOut", () => signOut(context)),
    vscode.commands.registerCommand("concord.runDetector", () => runDetector()),
    vscode.commands.registerCommand("concord.openWallet", () => openWallet()),
    vscode.commands.registerCommand("concord.repairPreview", () => previewRepair()),
  );

  // ── Status bar ──────────────────────────────────────────────────
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "concord.signIn";
  context.subscriptions.push(status);

  refreshStatus(status, context).catch(() => { /* best-effort */ });
  vscode.workspace.onDidChangeConfiguration(() => refreshStatus(status, context));
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}

// ── Loopback-redirect OAuth (matches server/routes/dx-oauth.js) ──
async function signIn(context: vscode.ExtensionContext): Promise<void> {
  const apiUrl = vscode.workspace.getConfiguration("concord").get<string>("apiUrl") || "https://concord-os.org";
  const state = crypto.randomBytes(16).toString("hex");

  // Bind a one-shot loopback listener so the consent redirect lands here.
  const result = await new Promise<OAuthGrant | null>((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404).end("not_found");
          return;
        }
        const code  = url.searchParams.get("code");
        const rState = url.searchParams.get("state");
        res.writeHead(200, { "content-type": "text/html" }).end(
          "<!doctype html><body style=\"font:16px/1.5 system-ui;text-align:center;padding:8vh\">" +
          "<h1>Concord — Authorized</h1><p>You can close this tab. Return to VS Code.</p></body>"
        );
        if (code && rState && rState === state) {
          exchangeCode(apiUrl, code, state).then(resolve).catch(() => resolve(null));
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      } finally {
        server.close();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const consent = `${apiUrl}/oauth/dx?client=vscode&state=${state}&port=${port}`;
      vscode.env.openExternal(vscode.Uri.parse(consent));
    });
    // 5-minute timeout
    setTimeout(() => { try { server.close(); } catch { /* noop */ } resolve(null); }, 5 * 60 * 1000);
  });

  if (!result) {
    vscode.window.showWarningMessage("Concord sign-in was not completed.");
    return;
  }
  await context.secrets.store(SECRET_KEY, result.token);
  vscode.window.showInformationMessage("Signed in to Concord. Token stored in OS keychain.");
}

async function exchangeCode(apiUrl: string, code: string, state: string): Promise<OAuthGrant | null> {
  const res = await fetch(`${apiUrl}/api/dx/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  if (!res.ok) return null;
  const body = await res.json() as Partial<OAuthGrant> & { ok?: boolean };
  if (!body?.ok || !body.token) return null;
  return { token: body.token, token_id: body.token_id || "", client: body.client || "vscode" };
}

async function signOut(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
  vscode.window.showInformationMessage("Signed out of Concord.");
}

async function refreshStatus(status: vscode.StatusBarItem, context: vscode.ExtensionContext): Promise<void> {
  const token = await context.secrets.get(SECRET_KEY);
  if (token) {
    status.text = "$(check) Concord";
    status.tooltip = "Signed in to Concord";
    status.command = "concord.openWallet";
  } else {
    status.text = "$(person-add) Concord";
    status.tooltip = "Click to sign in to Concord";
    status.command = "concord.signIn";
  }
  status.show();
}

async function runDetector(): Promise<void> {
  if (!client) {
    vscode.window.showWarningMessage("Concord LSP is not running.");
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a file to run detectors against it.");
    return;
  }
  // Forward a custom request to the LSP.
  await client.sendNotification("concord/runDetector", {
    uri: editor.document.uri.toString(),
  });
  vscode.window.showInformationMessage("Detector pass requested — findings will appear in the Concord side panel.");
}

function openWallet(): void {
  const apiUrl = vscode.workspace.getConfiguration("concord").get<string>("apiUrl") || "https://concord-os.org";
  vscode.env.openExternal(vscode.Uri.parse(`${apiUrl}/lenses/wallet`));
}

async function previewRepair(): Promise<void> {
  if (!client) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  await client.sendNotification("concord/repairPreview", {
    uri: editor.document.uri.toString(),
    range: { start: editor.selection.start, end: editor.selection.end },
  });
}
