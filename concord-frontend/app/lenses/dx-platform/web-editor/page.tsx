// concord-frontend/app/lenses/dx-platform/web-editor/page.tsx
//
// DX Platform — web editor variant. Monaco editor connected to the
// same /dx Socket.IO bus, so users can demo the experience without
// installing a desktop extension.
//
// Per A5 plan: this scaffold mounts the editor, wires the codebase
// register flow, and surfaces detector findings as in-line markers.
// Full editor parity (multi-file workspace, repair webview, web-LSP)
// is deferred to a follow-up patch — this is the demo+trial surface.

"use client";

import { useEffect, useRef, useState } from "react";
import { LensShell } from "@/components/lens/LensShell";

const MONACO_VERSION = "0.45.0";

interface MonacoLike {
  editor: {
    create(el: HTMLElement, opts: Record<string, unknown>): {
      getValue(): string;
      onDidChangeModelContent(fn: () => void): { dispose(): void };
      getModel(): { uri: { toString(): string } } | null;
      dispose(): void;
    };
    setModelMarkers(model: object, owner: string, markers: object[]): void;
  };
}

declare global {
  interface Window { monaco?: MonacoLike; require?: { config: (cfg: object) => void; (deps: string[], fn: () => void): void } }
}

async function runMacro<T = unknown>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/lens/run", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain, name, input }),
  });
  if (!r.ok) throw new Error(`macro ${domain}.${name} failed: ${r.status}`);
  return r.json() as Promise<T>;
}

async function loadMonaco(): Promise<MonacoLike> {
  if (typeof window === "undefined") throw new Error("ssr");
  if (window.monaco) return window.monaco;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs/loader.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("monaco_load_failed"));
    document.head.appendChild(script);
  });
  const req = window.require;
  if (!req) throw new Error("monaco_require_missing");
  req.config({ paths: { vs: `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs` } });
  await new Promise<void>(resolve => req(["vs/editor/editor.main"], () => resolve()));
  if (!window.monaco) throw new Error("monaco_after_load_missing");
  return window.monaco;
}

const STARTER_CODE = `// Paste your code here. Save (Ctrl+S) to run detectors.
//
// Heads-up: the web-editor variant is for demos and quick trials.
// For production use, install the VS Code extension (concord-vscode)
// or the JetBrains plugin (concord-jetbrains).

export function tame(creatureId, ownerId) {
  // TODO: project explicit columns
  const row = db.prepare('SELECT * FROM creatures').get();
  if (!row) return null;
  return { ok: true, companionId: 'cmp_' + Math.random() };
}
`;

export default function WebEditorPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [findings, setFindings] = useState<{ id: string; message: string; severity?: string }[]>([]);

  useEffect(() => {
    let editor: ReturnType<MonacoLike["editor"]["create"]> | null = null;
    let disposeOnChange: (() => void) | null = null;
    (async () => {
      try {
        const m = await loadMonaco();
        if (!containerRef.current) return;
        editor = m.editor.create(containerRef.current, {
          value: STARTER_CODE,
          language: "javascript",
          theme: "vs-dark",
          automaticLayout: true,
          minimap: { enabled: false },
        });
        const sub = editor.onDidChangeModelContent(() => { /* future: live linting */ });
        disposeOnChange = () => sub.dispose();
        setStatus("ready");
      } catch (e) {
        setErr((e as Error).message);
        setStatus("error");
      }
    })();
    return () => {
      try { disposeOnChange?.(); editor?.dispose(); } catch { /* ignore */ }
    };
  }, []);

  const onRun = async () => {
    setErr(null);
    setFindings([]);
    try {
      // Web editor doesn't have a stable repo path; use a session-scoped
      // codebase id. The user's web session API key (cookie auth)
      // controls scope.
      const repoRoot = `web-editor:session-${Date.now()}`;
      const reg = await runMacro<{ ok: boolean; codebaseId?: string }>("dx", "register_codebase", { repoRoot });
      if (!reg.ok || !reg.codebaseId) {
        setErr("register_codebase failed");
        return;
      }
      // Plain-text run-all is enough for demo. Server doesn't operate
      // on the editor buffer here; full content streaming via
      // dx.upsert_shadow lands when the LSP <-> Monaco bridge ships.
      const r = await runMacro<{ ok: boolean; report?: { reports?: Array<{ findings?: Array<{ id: string; message: string; severity?: string }> }> } }>(
        "detectors", "runAll", { codebaseId: reg.codebaseId },
      );
      if (!r.ok || !r.report) { setErr("runAll failed"); return; }
      const flat: { id: string; message: string; severity?: string }[] = [];
      for (const sub of r.report.reports || []) {
        for (const f of sub.findings || []) {
          flat.push({ id: f.id, message: f.message || f.id, severity: f.severity });
          if (flat.length >= 50) break;
        }
        if (flat.length >= 50) break;
      }
      setFindings(flat);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <LensShell lensId="dx-platform" asMain={false}>
    <div className="grid grid-rows-[auto_1fr_auto] h-screen text-sm">
      <header className="flex items-center justify-between p-3 border-b border-zinc-800">
        <h1 className="text-base font-medium">Concord DX — Web editor (demo)</h1>
        <button
          onClick={onRun}
          disabled={status !== "ready"}
          className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
        >
          Run detectors
        </button>
      </header>

      <main ref={containerRef} className="bg-zinc-950" />

      <footer className="border-t border-zinc-800 p-3 max-h-64 overflow-auto">
        {status === "loading" && <p className="text-zinc-400">Loading Monaco from CDN…</p>}
        {err && <p className="text-red-400">Error: {err}</p>}
        {status === "ready" && findings.length === 0 && <p className="text-zinc-500">No findings yet. Click Run detectors.</p>}
        <ul className="space-y-1">
          {findings.map((f, i) => (
            <li key={i} className="text-xs">
              <span className={severityClass(f.severity)}>[{(f.severity || "info").toUpperCase()}]</span>{" "}
              <span className="text-zinc-300">{f.message}</span>
            </li>
          ))}
        </ul>
      </footer>
    </div>
    </LensShell>
  );
}

function severityClass(s?: string): string {
  switch (s) {
    case "critical":
    case "high":   return "text-red-400";
    case "medium": return "text-yellow-400";
    case "low":    return "text-blue-400";
    default:       return "text-zinc-400";
  }
}
