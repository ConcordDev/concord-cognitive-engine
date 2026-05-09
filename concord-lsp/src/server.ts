// concord-lsp/src/server.ts
//
// Concord DX Language Server — single source of truth for the editor
// integration. Both VS Code (via vscode-languageclient) and JetBrains
// (via LSP4IJ) consume this server. The web editor (Monaco) plugs in
// via the `monaco-languageclient` adapter.
//
// What it does:
//   - On `initialize`: read API key + server URL from initializationOptions.
//   - On `initialized`: register a codebase via `dx.register_codebase`,
//     connect to the /dx Socket.IO namespace, subscribe to room.
//   - On `textDocument/didSave`: trigger `detectors.runAll(codebaseId)`.
//   - Stream events become LSP `textDocument/publishDiagnostics`.
//   - Repair proposals become `window/showMessageRequest` with action
//     items (Accept / Ignore / Reject) — clicked actions feed
//     `dx.record_fix_decision`.

import {
  createConnection, ProposedFeatures,
  TextDocuments, TextDocumentSyncKind,
  DiagnosticSeverity, type Diagnostic,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { io as createSocket, type Socket } from "socket.io-client";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

interface Finding {
  id: string;
  category?: string;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  message?: string;
  location?: string;
  subject?: { kind?: string; file?: string; line?: number };
  fixHint?: string | null;
}

interface InitOpts {
  serverUrl: string;
  apiKey: string;
  streamPath?: string;
}

let _initOpts: InitOpts | null = null;
let _codebaseId: string | null = null;
let _socket: Socket | null = null;
let _repoRoot: string | null = null;
const _diagsByFile = new Map<string, Diagnostic[]>();
// URIs that received diagnostics in the previous run, so we can clear
// them when a subsequent run produces zero findings for that file.
let _lastRunUris = new Set<string>();

function severityFor(s: Finding["severity"]): DiagnosticSeverity {
  switch (s) {
    case "critical":
    case "high":   return DiagnosticSeverity.Error;
    case "medium": return DiagnosticSeverity.Warning;
    case "low":    return DiagnosticSeverity.Hint;
    default:       return DiagnosticSeverity.Information;
  }
}

connection.onInitialize((params) => {
  _initOpts = (params.initializationOptions || {}) as InitOpts;
  // Strip `file://` from BOTH workspaceFolders and rootUri — clients that
  // only send rootUri (no workspaceFolders) would otherwise produce
  // malformed `file://file:///...` URIs in diagnostics + an invalid
  // repoRoot in dx.register_codebase.
  const rawRoot = params.workspaceFolders?.[0]?.uri || params.rootUri || null;
  _repoRoot = rawRoot ? rawRoot.replace(/^file:\/\//, "") : null;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
    },
  };
});

connection.onInitialized(async () => {
  if (!_initOpts?.serverUrl || !_initOpts?.apiKey || !_repoRoot) {
    connection.console.warn("Concord LSP: missing initializationOptions or workspace folder.");
    return;
  }

  // Register codebase via REST.
  try {
    const r = await fetch(`${_initOpts.serverUrl}/api/lens/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": _initOpts.apiKey },
      body: JSON.stringify({ domain: "dx", name: "register_codebase", input: { repoRoot: _repoRoot } }),
    });
    const json = (await r.json()) as { ok: boolean; codebaseId?: string; reason?: string };
    if (!json.ok || !json.codebaseId) {
      connection.console.error(`Concord LSP: register_codebase failed: ${json.reason || "unknown"}`);
      return;
    }
    _codebaseId = json.codebaseId;
  } catch (err) {
    connection.console.error(`Concord LSP: register fetch failed: ${(err as Error).message}`);
    return;
  }

  // Connect Socket.IO.
  const streamPath = _initOpts.streamPath || "/dx";
  _socket = createSocket(`${_initOpts.serverUrl}${streamPath}`, {
    transports: ["websocket"],
    auth: { apiKey: _initOpts.apiKey },
    extraHeaders: { "x-api-key": _initOpts.apiKey },
  });
  _socket.on("connect", () => {
    if (_codebaseId) _socket?.emit("subscribe.codebase", { codebaseId: _codebaseId });
    connection.console.info(`Concord LSP: connected; codebaseId=${_codebaseId?.slice(0, 14)}…`);
  });
  _socket.on("detector:finding.added", (msg: { finding: Finding }) => {
    if (!msg?.finding) return;
    const loc = parseLocation(msg.finding);
    if (!loc) return;
    const filePath = loc.file.startsWith("/") ? loc.file : `${_repoRoot}/${loc.file}`;
    const uri = `file://${filePath}`;
    const diag: Diagnostic = {
      severity: severityFor(msg.finding.severity),
      range: {
        start: { line: Math.max(0, loc.line - 1), character: 0 },
        end:   { line: Math.max(0, loc.line - 1), character: 200 },
      },
      message: `${msg.finding.message || msg.finding.id || ""}${msg.finding.fixHint ? `\n→ ${msg.finding.fixHint}` : ""}`,
      source: "Concord",
      code: msg.finding.category ? `${msg.finding.category}:${msg.finding.id}` : msg.finding.id,
    };
    const arr = _diagsByFile.get(uri) || [];
    arr.push(diag);
    _diagsByFile.set(uri, arr);
  });
  _socket.on("detector:run.complete", () => {
    // Send fresh diagnostics for every URI that has findings this run.
    const thisRunUris = new Set<string>();
    for (const [uri, list] of _diagsByFile.entries()) {
      void connection.sendDiagnostics({ uri, diagnostics: list });
      thisRunUris.add(uri);
    }
    // Clear stale diagnostics for files that had findings last run but
    // none this run — otherwise old highlights persist after fixes.
    for (const uri of _lastRunUris) {
      if (!thisRunUris.has(uri)) {
        void connection.sendDiagnostics({ uri, diagnostics: [] });
      }
    }
    _lastRunUris = thisRunUris;
    _diagsByFile.clear();
  });
  _socket.on("repair:prophet.proposed", async (msg: { repairId: string; finding: Finding; fix: { description?: string; diff?: string } }) => {
    const choice = await connection.window.showInformationMessage(
      `Concord: ${msg.fix?.description || "Repair proposed"}`,
      { title: "Accept" }, { title: "Ignore" }, { title: "Reject" },
    );
    if (!choice || !_initOpts?.serverUrl || !_codebaseId) return;
    const decision = choice.title.toLowerCase() === "accept" ? "accepted"
                   : choice.title.toLowerCase() === "ignore" ? "ignored"
                   : "rejected";
    void fetch(`${_initOpts.serverUrl}/api/lens/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": _initOpts.apiKey },
      body: JSON.stringify({
        domain: "dx", name: "record_fix_decision",
        input: {
          codebaseId: _codebaseId,
          repairId: msg.repairId,
          detectorId: msg.finding.category || msg.finding.id || "unknown",
          ruleId: msg.finding.id || "unknown",
          decision,
        },
      }),
    });
  });
});

documents.onDidSave(async () => {
  if (!_initOpts?.serverUrl || !_codebaseId) return;
  void fetch(`${_initOpts.serverUrl}/api/lens/run`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": _initOpts.apiKey },
    body: JSON.stringify({ domain: "detectors", name: "runAll", input: { codebaseId: _codebaseId } }),
  }).catch(() => { /* silent */ });
});

connection.onShutdown(() => {
  _socket?.disconnect();
  _socket = null;
});

function parseLocation(f: Finding): { file: string; line: number } | null {
  if (f.location) {
    const m = String(f.location).match(/^(.+):(\d+)$/);
    if (m) return { file: m[1], line: parseInt(m[2], 10) };
  }
  if (f.subject?.file) return { file: f.subject.file, line: f.subject.line ?? 1 };
  return null;
}

documents.listen(connection);
connection.listen();
