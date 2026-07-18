'use client';

// ShadowsPanel — read-only surface for `dx.list_shadows`
// (server/domains/dx.js), the real shadow-DTU cross-file-context store the
// concord-vscode / JetBrains plugin writes to via `dx.upsert_shadow` on
// every file it indexes (STATE.shadowDtus, tier:'shadow', kind:
// 'code_shadow'). Before this component existed the macro had no frontend
// caller anywhere — a WAVE4 dx-platform gap: the result had computed real
// data with nowhere to render it.
//
// Honest by construction: this renders ONLY what `dx.list_shadows` returns
// for the selected registered codebase (dx.list_codebases — the same real
// registry SeverityWeightsPanel reads). There is no seed/demo data — a
// codebase with zero shadow writes (the common case until the plugin has
// actually opened files in it) renders an explicit, honest empty state
// pointing at what would populate it, never a placeholder table or
// fabricated rows.

import { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface CodebaseRow {
  id: string;
  repo_root: string;
}
interface ShadowRow {
  id: string;
  path: string;
  contentHash: string;
  upsertedAt: number;
  contentLength: number;
}

function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin text-zinc-400" aria-hidden />;
}

function formatWhen(unixSeconds: number): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return '—';
  try {
    return new Date(unixSeconds * 1000).toLocaleString();
  } catch {
    return '—';
  }
}

export function ShadowsPanel() {
  const [codebases, setCodebases] = useState<CodebaseRow[]>([]);
  const [activeCb, setActiveCb] = useState('');
  const [shadows, setShadows] = useState<ShadowRow[]>([]);
  const [loadingCb, setLoadingCb] = useState(true);
  const [loadingS, setLoadingS] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadCodebases = useCallback(async () => {
    setLoadingCb(true);
    setErr(null);
    try {
      const r = await lensRun('dx', 'list_codebases', {});
      if (r.data?.ok && r.data.result) {
        const list = (r.data.result as { codebases: CodebaseRow[] }).codebases || [];
        setCodebases(list);
        setActiveCb((prev) => prev || list[0]?.id || '');
      } else {
        setErr(r.data?.error || 'Could not load registered codebases.');
      }
    } catch {
      setErr('Network error loading registered codebases.');
    } finally {
      setLoadingCb(false);
    }
  }, []);

  useEffect(() => { void loadCodebases(); }, [loadCodebases]);

  const loadShadows = useCallback(async (codebaseId: string) => {
    if (!codebaseId) { setShadows([]); return; }
    setLoadingS(true);
    try {
      const r = await lensRun('dx', 'list_shadows', { codebaseId });
      if (r.data?.ok && r.data.result) {
        setShadows((r.data.result as { shadows?: ShadowRow[] }).shadows || []);
      } else {
        setShadows([]);
      }
    } finally {
      setLoadingS(false);
    }
  }, []);

  useEffect(() => { void loadShadows(activeCb); }, [activeCb, loadShadows]);

  return (
    <section id="shadows" className="scroll-mt-20 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-medium text-white">
        <Layers className="h-4 w-4 text-amber-400" aria-hidden /> Shadow DTUs (cross-file context)
      </h2>
      <p className="max-w-2xl text-xs text-zinc-400">
        Every file your editor plugin indexes writes a shadow DTU
        (<code>dx.upsert_shadow</code>) so the conscious brain has real
        cross-file context when answering questions or proposing repairs.
        This reads the same live store — nothing here is seeded.
      </p>

      {loadingCb ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400"><Spinner /> Loading your registered codebases…</div>
      ) : err ? (
        <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {err}
        </div>
      ) : codebases.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-400" data-testid="dx-shadows-empty-no-codebase">
          No shadows yet — enable the concord-vscode plugin. Install the{' '}
          <a href="https://marketplace.visualstudio.com/items?itemName=concord-os.concord-dx" target="_blank" rel="noreferrer" className="underline">
            VS Code
          </a>{' '}
          or{' '}
          <a href="https://plugins.jetbrains.com/plugin/concord-dx" target="_blank" rel="noreferrer" className="underline">
            JetBrains
          </a>{' '}
          extension and open a workspace to register a codebase.
        </div>
      ) : (
        <>
          <select
            value={activeCb}
            onChange={(e) => setActiveCb(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
            aria-label="Select registered codebase"
          >
            {codebases.map((c) => (
              <option key={c.id} value={c.id}>{c.repo_root}</option>
            ))}
          </select>

          {loadingS ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400"><Spinner /> Loading shadows…</div>
          ) : shadows.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-400" data-testid="dx-shadows-empty">
              No shadows yet — enable the concord-vscode plugin. Open a file
              in this codebase in your editor; the plugin writes one shadow
              DTU per file it indexes.
            </div>
          ) : (
            <ul className="space-y-1" data-testid="dx-shadows-list">
              {shadows.map((sh) => (
                <li
                  key={sh.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs"
                >
                  <span className="font-mono text-zinc-200">{sh.path}</span>
                  <span className="ml-auto flex gap-2 text-[10px] text-zinc-500">
                    <span className="font-mono">{sh.contentHash}</span>
                    <span>{sh.contentLength.toLocaleString()} chars</span>
                    <span>{formatWhen(sh.upsertedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
