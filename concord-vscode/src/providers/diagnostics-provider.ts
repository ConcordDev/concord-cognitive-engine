// concord-vscode/src/providers/diagnostics-provider.ts
//
// Translates Concord findings into VS Code diagnostics. One DiagnosticCollection
// owned by the plugin; per-file Diagnostic[] is replaced on each run.

import * as vscode from "vscode";
import type { Finding } from "../api/socket-stream";

const SEVERITY_MAP: Record<NonNullable<Finding["severity"]>, vscode.DiagnosticSeverity> = {
  info:     vscode.DiagnosticSeverity.Information,
  low:      vscode.DiagnosticSeverity.Hint,
  medium:   vscode.DiagnosticSeverity.Warning,
  high:     vscode.DiagnosticSeverity.Error,
  critical: vscode.DiagnosticSeverity.Error,
};

export class DiagnosticsProvider {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly buffer: Map<string, vscode.Diagnostic[]> = new Map();

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("concord");
  }

  /**
   * Stage a finding for its file. Call `flush()` to publish all staged
   * diagnostics to VS Code in one batch (after a run.complete event).
   */
  add(repoRoot: string, f: Finding): void {
    const loc = parseLocation(f.location, f.subject);
    if (!loc) return;
    const filePath = resolveFilePath(repoRoot, loc.file);
    const range = new vscode.Range(
      Math.max(0, loc.line - 1), 0,
      Math.max(0, loc.line - 1), 200,
    );
    const sev = SEVERITY_MAP[(f.severity || "low") as NonNullable<Finding["severity"]>] ?? vscode.DiagnosticSeverity.Hint;
    const message = `${f.message || f.id || "(no message)"} ${f.fixHint ? `\n→ ${f.fixHint}` : ""}`.trim();
    const diag = new vscode.Diagnostic(range, message, sev);
    diag.source = "Concord";
    diag.code = f.category ? `${f.category}:${f.id}` : f.id;
    const existing = this.buffer.get(filePath) || [];
    existing.push(diag);
    this.buffer.set(filePath, existing);
  }

  /**
   * Publish all buffered diagnostics. Safe to call repeatedly — each
   * call replaces the file's prior diagnostic set.
   */
  flush(): void {
    for (const [filePath, list] of this.buffer.entries()) {
      this.collection.set(vscode.Uri.file(filePath), list);
    }
    this.buffer.clear();
  }

  clearAll(): void {
    this.collection.clear();
    this.buffer.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function parseLocation(location: string | undefined, subject: Finding["subject"]): { file: string; line: number } | null {
  if (location) {
    const m = String(location).match(/^(.+):(\d+)$/);
    if (m) return { file: m[1], line: parseInt(m[2], 10) };
  }
  if (subject?.file) {
    return { file: subject.file, line: subject.line ?? 1 };
  }
  return null;
}

function resolveFilePath(repoRoot: string, file: string): string {
  if (file.startsWith("/")) return file;
  return `${repoRoot}/${file}`;
}
