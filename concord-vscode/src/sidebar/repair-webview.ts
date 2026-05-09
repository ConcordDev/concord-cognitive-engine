// concord-vscode/src/sidebar/repair-webview.ts
//
// WebviewPanel that shows a single repair-cortex proposal: the original
// finding + the prophet-proposed fix diff + Accept / Reject buttons.
// Selection POSTs to `dx.record_fix_decision` so the per-codebase
// severity weight tunes for next time.

import * as vscode from "vscode";
import type { Finding } from "../api/socket-stream";
import type { ConcordClient } from "../api/concord-client";

export interface ProphetProposal {
  repairId: string;
  codebaseId: string;
  finding: Finding;
  fix: { description?: string; diff?: string; reasoning?: string } | unknown;
}

export class RepairWebview {
  private panel: vscode.WebviewPanel | null = null;

  constructor(private readonly client: ConcordClient) {}

  show(proposal: ProphetProposal): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "concord.repair",
        "Concord — Repair Proposal",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => { this.panel = null; });
      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg, proposal));
    }
    this.panel.webview.html = this.render(proposal);
    this.panel.title = `Concord — ${shortenId(proposal.repairId)}`;
    this.panel.reveal();
  }

  private async onMessage(msg: { command?: string }, proposal: ProphetProposal): Promise<void> {
    if (msg?.command === "accept" || msg?.command === "reject" || msg?.command === "ignore") {
      await this.client.recordFixDecision({
        codebaseId: proposal.codebaseId,
        repairId: proposal.repairId,
        detectorId: proposal.finding.category || proposal.finding.id || "unknown",
        ruleId: proposal.finding.id || "unknown",
        decision: msg.command as "accepted" | "rejected" | "ignored",
      });
      this.panel?.dispose();
    }
  }

  private render(proposal: ProphetProposal): string {
    const f = proposal.finding;
    const fix = proposal.fix as { description?: string; diff?: string; reasoning?: string };
    return /* html */ `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: var(--vscode-font-family); padding: 1rem; color: var(--vscode-editor-foreground); }
            .row { margin-bottom: 1rem; }
            .label { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
            pre { background: var(--vscode-textCodeBlock-background); padding: 0.6rem; overflow: auto; }
            button {
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              border: none; padding: 0.5rem 1rem; margin-right: 0.5rem; cursor: pointer;
            }
            button:hover { background: var(--vscode-button-hoverBackground); }
            .reject { background: var(--vscode-errorForeground); }
          </style>
        </head>
        <body>
          <div class="row"><div class="label">Finding</div>
            <div>[${(f.severity || "info").toUpperCase()}] ${escapeHtml(f.message || f.id || "")}</div>
            <div class="label">${escapeHtml(f.location || f.subject?.file || "")}</div>
          </div>

          ${fix?.description ? `<div class="row"><div class="label">Proposed fix</div><div>${escapeHtml(fix.description)}</div></div>` : ""}
          ${fix?.diff        ? `<div class="row"><div class="label">Diff</div><pre>${escapeHtml(fix.diff)}</pre></div>` : ""}
          ${fix?.reasoning   ? `<div class="row"><div class="label">Reasoning</div><div>${escapeHtml(fix.reasoning)}</div></div>` : ""}

          <div class="row">
            <button onclick="api.postMessage({command: 'accept'})">Accept</button>
            <button onclick="api.postMessage({command: 'ignore'})">Ignore</button>
            <button class="reject" onclick="api.postMessage({command: 'reject'})">Reject</button>
          </div>

          <script>const api = acquireVsCodeApi();</script>
        </body>
      </html>
    `;
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortenId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}
