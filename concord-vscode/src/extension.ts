// concord-vscode/src/extension.ts
//
// Entry point. On activate:
//   1) Read API key from SecretStorage; if absent, prompt the user.
//   2) Compute the codebase id (sha1 over workspace root + userId scoped).
//   3) Register codebase via `dx.register_codebase`.
//   4) Connect to the /dx Socket.IO namespace and subscribe.
//   5) On didSaveTextDocument (debounced 500ms), trigger detector run.
//
// VS Code marketplace policy: this plugin NEVER auto-applies a fix.
// Repair proposals are only suggested via Code Action menu + the
// repair-webview Accept button.
//
// Two sign-in paths:
//   - `concord.signIn`  (recommended) — browser-based OAuth, RFC 8252
//     loopback redirect. Pairs with /oauth/dx + /api/dx/exchange.
//   - `concord.login`   (legacy)      — paste a csk_* key directly.
// Both end up storing the token via ApiKeyStore (vscode.SecretStorage).

import * as vscode from "vscode";
import * as http from "node:http";
import * as crypto from "node:crypto";
import { ApiKeyStore } from "./auth/api-key-store";
import { ConcordClient } from "./api/concord-client";
import { DxSocketStream, type StreamEvent } from "./api/socket-stream";
import { DiagnosticsProvider } from "./providers/diagnostics-provider";
import { FindingsTreeProvider } from "./sidebar/findings-tree";
import { RepairWebview } from "./sidebar/repair-webview";

let _state: PluginState | null = null;

interface PluginState {
  client: ConcordClient;
  stream: DxSocketStream;
  diagnostics: DiagnosticsProvider;
  findings: FindingsTreeProvider;
  repairWebview: RepairWebview;
  codebaseId: string;
  repoRoot: string;
  status: vscode.StatusBarItem;
  // Per-bootstrap disposables (save listener, tree view) so a
  // re-bootstrap after login or `concord.syncCodebase` tears down the
  // previous wiring instead of stacking listeners and triggering
  // duplicate detector runs on every save.
  disposables: vscode.Disposable[];
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const keyStore = new ApiKeyStore(context.secrets);

  context.subscriptions.push(
    vscode.commands.registerCommand("concord.signIn",        () => onSignIn(keyStore, context)),
    vscode.commands.registerCommand("concord.login",         () => onLogin(keyStore, context)),
    vscode.commands.registerCommand("concord.signOut",       () => onLogout(keyStore)),
    vscode.commands.registerCommand("concord.logout",        () => onLogout(keyStore)),
    vscode.commands.registerCommand("concord.syncCodebase",  () => onSyncCodebase(context)),
    vscode.commands.registerCommand("concord.runDetectors",  () => onRunDetectors()),
    vscode.commands.registerCommand("concord.openSidebar",   () => vscode.commands.executeCommand("workbench.view.explorer")),
    vscode.commands.registerCommand("concord.openWallet",    () => onOpenWallet()),
    vscode.commands.registerCommand("concord.repairPreview", () => onRepairPreview()),
  );

  const apiKey = await keyStore.get();
  if (!apiKey) {
    void vscode.window.showInformationMessage(
      "Concord DX: not signed in. Use `Concord: Sign in with Concord (OAuth)` from the Command Palette.",
      "Sign in",
      "Paste API key (legacy)",
    ).then(choice => {
      if (choice === "Sign in") void onSignIn(keyStore, context);
      else if (choice === "Paste API key (legacy)") void onLogin(keyStore, context);
    });
    return;
  }
  await bootstrap(apiKey, context);
}

export function deactivate(): void {
  teardown();
}

function teardown(): void {
  if (!_state) return;
  for (const d of _state.disposables) {
    try { d.dispose(); } catch { /* swallow */ }
  }
  try { _state.stream.disconnect(); } catch { /* swallow */ }
  try { _state.diagnostics.dispose(); } catch { /* swallow */ }
  try { _state.status.dispose(); } catch { /* swallow */ }
  _state = null;
}

async function bootstrap(apiKey: string, context: vscode.ExtensionContext): Promise<void> {
  // Tear down any prior bootstrap before standing up a new one — repeat
  // bootstraps (login → switch account, `concord.syncCodebase`) used to
  // stack save listeners and parallel socket subscriptions.
  teardown();

  const cfg = vscode.workspace.getConfiguration("concord");
  const serverUrl = String(cfg.get("serverUrl") || "http://localhost:5050");
  const streamPath = String(cfg.get("streamPath") || "/dx");
  const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  if (!repoRoot) {
    void vscode.window.showWarningMessage("Concord DX: open a folder first.");
    return;
  }

  const client = new ConcordClient(serverUrl, apiKey);
  const reg = await client.registerCodebase(repoRoot);
  if (!reg.ok || !(reg as { codebaseId?: string }).codebaseId) {
    void vscode.window.showErrorMessage(`Concord DX: register_codebase failed: ${reg.reason || "unknown"}`);
    return;
  }
  const codebaseId = (reg as { codebaseId: string }).codebaseId;

  const diagnostics = new DiagnosticsProvider();
  const findings = new FindingsTreeProvider();
  const repairWebview = new RepairWebview(client);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = "$(eye) Concord";
  status.command = "concord.openWallet";
  status.tooltip = "Concord DX — click to open wallet";
  status.show();

  const disposables: vscode.Disposable[] = [];

  const treeView = vscode.window.createTreeView("concord.findings", { treeDataProvider: findings });
  context.subscriptions.push(treeView);
  disposables.push(treeView);

  const stream = new DxSocketStream(
    serverUrl, streamPath, apiKey,
    (ev) => onStreamEvent(ev, diagnostics, findings, repairWebview, repoRoot),
    (s) => { status.text = s.connected ? "$(eye) Concord" : `$(eye-closed) Concord (${s.reason || "off"})`; },
  );
  stream.connect();
  stream.subscribeCodebase(codebaseId);

  // File save → trigger detector run (debounced 500ms). Tracked in
  // `disposables` so a re-bootstrap removes it before adding a new one.
  let debounce: NodeJS.Timeout | null = null;
  const onSave = vscode.workspace.onDidSaveTextDocument(() => {
    if (!cfg.get("runOnSave", true)) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { void onRunDetectors(); }, 500);
  });
  context.subscriptions.push(onSave);
  disposables.push(onSave);

  _state = { client, stream, diagnostics, findings, repairWebview, codebaseId, repoRoot, status, disposables };
  void vscode.window.showInformationMessage(`Concord DX connected (codebase ${codebaseId.slice(0, 12)}…).`);
}

// ── OAuth sign-in (RFC 8252 loopback redirect) ────────────────────────
//
// Pairs with server/routes/dx-oauth.js. Opens a one-shot HTTP listener
// on 127.0.0.1:<random>, points the browser at /oauth/dx?client=vscode&
// state=&port=, exchanges the returned code via /api/dx/exchange, and
// stores the resulting csk_* token in ApiKeyStore.

async function onSignIn(keyStore: ApiKeyStore, context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("concord");
  const apiUrl = String(cfg.get("serverUrl") || "http://localhost:5050").replace(/\/+$/, "");
  const state = crypto.randomBytes(16).toString("hex");

  const token = await new Promise<string | null>((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404).end("not_found");
          return;
        }
        const code  = url.searchParams.get("code");
        const rState = url.searchParams.get("state");
        const html =
          "<!doctype html><body style=\"font:16px/1.5 system-ui;text-align:center;padding:8vh\">" +
          "<h1>Concord — Authorized</h1><p>You can close this tab. Return to VS Code.</p></body>";
        res.writeHead(200, { "content-type": "text/html" }).end(html);

        if (code && rState && rState === state) {
          exchangeCode(apiUrl, code, state).then(resolve).catch(() => resolve(null));
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      } finally {
        try { server.close(); } catch { /* swallow */ }
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const consent = `${apiUrl}/oauth/dx?client=vscode&state=${state}&port=${port}`;
      void vscode.env.openExternal(vscode.Uri.parse(consent));
    });
    setTimeout(() => { try { server.close(); } catch { /* noop */ } resolve(null); }, 5 * 60 * 1000);
  });

  if (!token) {
    void vscode.window.showWarningMessage("Concord sign-in did not complete.");
    return;
  }

  await keyStore.set(token);
  void vscode.window.showInformationMessage("Signed in to Concord. Token stored in OS keychain.");
  await bootstrap(token, context);
}

async function exchangeCode(apiUrl: string, code: string, state: string): Promise<string | null> {
  const res = await fetch(`${apiUrl}/api/dx/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  if (!res.ok) return null;
  const body = await res.json() as { ok?: boolean; token?: string };
  if (!body?.ok || !body.token) return null;
  return body.token;
}

async function onLogin(keyStore: ApiKeyStore, context: vscode.ExtensionContext): Promise<void> {
  const key = await vscode.window.showInputBox({
    prompt: "Concord API key (csk_…). Issue one from your Concord dashboard.",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.startsWith("csk_") ? null : "Key must start with csk_"),
  });
  if (!key) return;
  try {
    await keyStore.set(key);
    void vscode.window.showInformationMessage("Concord DX: key stored. Bootstrapping…");
    await bootstrap(key, context);
  } catch (err) {
    void vscode.window.showErrorMessage(`Concord DX: login failed: ${(err as Error).message}`);
  }
}

async function onLogout(keyStore: ApiKeyStore): Promise<void> {
  await keyStore.clear();
  teardown();
  void vscode.window.showInformationMessage("Concord DX: signed out.");
}

async function onSyncCodebase(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = (await new ApiKeyStore(context.secrets).get()) || "";
  if (!apiKey) {
    void vscode.window.showWarningMessage("Concord DX: not signed in.");
    return;
  }
  await bootstrap(apiKey, context);
}

async function onRunDetectors(): Promise<void> {
  if (!_state) {
    void vscode.window.showWarningMessage("Concord DX: not connected.");
    return;
  }
  _state.diagnostics.clearAll();
  _state.findings.reset();
  try {
    await _state.client.runAllDetectors(_state.codebaseId);
  } catch (err) {
    void vscode.window.showErrorMessage(`Concord DX: runAll failed: ${(err as Error).message}`);
  }
}

function onOpenWallet(): void {
  const cfg = vscode.workspace.getConfiguration("concord");
  const apiUrl = String(cfg.get("serverUrl") || "http://localhost:5050").replace(/\/+$/, "");
  void vscode.env.openExternal(vscode.Uri.parse(`${apiUrl}/lenses/dx-platform/billing`));
}

function onRepairPreview(): void {
  if (!_state) {
    void vscode.window.showWarningMessage("Concord DX: not connected.");
    return;
  }
  // The repair webview is driven by stream events — when the server's
  // repair-cortex proposes a fix, the webview reveals itself
  // automatically. This command is a no-op affordance for users who
  // expect a "show me the latest proposal" command; it surfaces a
  // hint instead of failing silently.
  void vscode.window.showInformationMessage(
    "Concord DX: repair previews appear automatically when the server proposes a fix. " +
    "Save a file to trigger a detector run.",
  );
}

function onStreamEvent(
  ev: StreamEvent,
  diagnostics: DiagnosticsProvider,
  findings: FindingsTreeProvider,
  repairWebview: RepairWebview,
  repoRoot: string,
): void {
  switch (ev.kind) {
    case "detector:finding.added": {
      const finding = ev.payload.finding;
      diagnostics.add(repoRoot, finding);
      findings.add(ev.payload.detectorId || finding.category || finding.id || "unknown", finding);
      break;
    }
    case "detector:run.complete": {
      diagnostics.flush();
      break;
    }
    case "repair:prophet.proposed": {
      repairWebview.show({
        repairId: ev.payload.repairId,
        codebaseId: ev.payload.codebaseId,
        finding: ev.payload.finding,
        fix: ev.payload.fix,
      });
      break;
    }
    default: /* other events ignored for v0.1 */ break;
  }
}
