// concord-vscode/src/sidebar/findings-tree.ts
//
// TreeDataProvider for the "Concord Findings" view. Shows findings
// grouped by detector, then by file. Each leaf shows the finding's
// severity badge + message; clicking jumps to the location.

import * as vscode from "vscode";
import type { Finding } from "../api/socket-stream";

type Node =
  | { kind: "detector"; detectorId: string; count: number }
  | { kind: "finding";  finding: Finding };

export class FindingsTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<Node | null | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private readonly findingsByDetector = new Map<string, Finding[]>();

  add(detectorId: string, finding: Finding): void {
    const arr = this.findingsByDetector.get(detectorId) || [];
    arr.push(finding);
    this.findingsByDetector.set(detectorId, arr);
    this._onDidChange.fire(undefined);
  }

  reset(): void {
    this.findingsByDetector.clear();
    this._onDidChange.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "detector") {
      const item = new vscode.TreeItem(`${node.detectorId} (${node.count})`, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon("eye");
      item.contextValue = "detector";
      return item;
    }
    const sevLabel = (node.finding.severity || "info").toUpperCase();
    const item = new vscode.TreeItem(`[${sevLabel}] ${node.finding.message || node.finding.id}`);
    item.tooltip = `${node.finding.location || node.finding.subject?.file || ""}\n\n${node.finding.fixHint || ""}`.trim();
    item.contextValue = "finding";
    item.iconPath = new vscode.ThemeIcon(iconForSeverity(node.finding.severity));
    if (node.finding.location || node.finding.subject?.file) {
      item.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [vscode.Uri.file(parseLocationFile(node.finding))],
      };
    }
    return item;
  }

  getChildren(parent?: Node): Thenable<Node[]> {
    if (!parent) {
      const out: Node[] = [];
      for (const [detectorId, arr] of this.findingsByDetector.entries()) {
        out.push({ kind: "detector", detectorId, count: arr.length });
      }
      return Promise.resolve(out);
    }
    if (parent.kind === "detector") {
      const arr = this.findingsByDetector.get(parent.detectorId) || [];
      return Promise.resolve(arr.map(f => ({ kind: "finding", finding: f } as const)));
    }
    return Promise.resolve([]);
  }
}

function iconForSeverity(s: Finding["severity"]): string {
  switch (s) {
    case "critical": return "error";
    case "high":     return "error";
    case "medium":   return "warning";
    case "low":      return "info";
    default:         return "circle-small";
  }
}

function parseLocationFile(f: Finding): string {
  if (f.location) {
    const m = String(f.location).match(/^(.+):\d+$/);
    if (m) return m[1];
  }
  return f.subject?.file || "";
}
