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

import * as vscode from "vscode";
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
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const keyStore = new ApiKeyStore(context.secrets);

  context.subscriptions.push(
    vscode.commands.registerCommand("concord.login",        () => onLogin(keyStore, context)),
    vscode.commands.registerCommand("concord.logout",       () => onLogout(keyStore)),
    vscode.commands.registerCommand("concord.syncCodebase", () => onSyncCodebase(context)),
    vscode.commands.registerCommand("concord.runDetectors", () => onRunDetectors()),
    vscode.commands.registerCommand("concord.openSidebar",  () => vscode.commands.executeCommand("workbench.view.explorer")),
  );

  const apiKey = await keyStore.get();
  if (!apiKey) {
    void vscode.window.showInformationMessage(
      "Concord DX: no API key. Run `Concord: Sign In` from the Command Palette.",
      "Sign In",
    ).then(choice => {
      if (choice === "Sign In") void onLogin(keyStore, context);
    });
    return;
  }
  await bootstrap(apiKey, context);
}

export function deactivate(): void {
  _state?.stream.disconnect();
  _state?.diagnostics.dispose();
  _state?.status.dispose();
  _state = null;
}

async function bootstrap(apiKey: string, context: vscode.ExtensionContext): Promise<void> {
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
  status.show();

  const treeView = vscode.window.createTreeView("concord.findings", { treeDataProvider: findings });
  context.subscriptions.push(treeView);

  const stream = new DxSocketStream(
    serverUrl, streamPath, apiKey,
    (ev) => onStreamEvent(ev, diagnostics, findings, repairWebview, repoRoot),
    (s) => { status.text = s.connected ? "$(eye) Concord" : `$(eye-closed) Concord (${s.reason || "off"})`; },
  );
  stream.connect();
  stream.subscribeCodebase(codebaseId);

  // File save → trigger detector run (debounced 500ms).
  let debounce: NodeJS.Timeout | null = null;
  const onSave = vscode.workspace.onDidSaveTextDocument(() => {
    if (!cfg.get("runOnSave", true)) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { void onRunDetectors(); }, 500);
  });
  context.subscriptions.push(onSave);

  _state = { client, stream, diagnostics, findings, repairWebview, codebaseId, repoRoot, status };
  void vscode.window.showInformationMessage(`Concord DX connected (codebase ${codebaseId.slice(0, 12)}…).`);
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
  _state?.stream.disconnect();
  _state?.diagnostics.clearAll();
  _state = null;
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
