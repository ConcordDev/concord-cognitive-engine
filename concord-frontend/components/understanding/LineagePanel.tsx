'use client';

import { useCallback, useEffect, useState } from 'react';
import { GitBranch, Layers, RefreshCw, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import {
  understandingMacro,
  type LineageNode,
  type ConsolidationCandidate,
} from './understanding-shared';

export function LineagePanel() {
  const [rootId, setRootId] = useState('');
  const [maxDepth, setMaxDepth] = useState(6);
  const [lineage, setLineage] = useState<LineageNode[] | null>(null);
  const [candidates, setCandidates] = useState<ConsolidationCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consolidateMsg, setConsolidateMsg] = useState<string | null>(null);

  async function loadLineage() {
    if (!rootId) return;
    setBusy(true); setError(null);
    try {
      const r = await understandingMacro<{ ok: boolean; lineage?: LineageNode[] }>('lineage', { id: rootId, maxDepth }
      );
      setLineage(r.lineage ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'lineage failed');
    } finally {
      setBusy(false);
    }
  }

  const loadCandidates = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await understandingMacro<{ ok: boolean; candidates?: ConsolidationCandidate[] }>('consolidation_candidates'
      );
      setCandidates(r.candidates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'candidates failed');
    } finally {
      setBusy(false);
    }
  }, []);

  async function runConsolidate(c: ConsolidationCandidate) {
    setBusy(true); setError(null); setConsolidateMsg(null);
    try {
      const r = await understandingMacro<{ ok: boolean; id?: string }>('consolidate', { childIds: c.childIds }
      );
      if (r.ok) {
        setConsolidateMsg(`Consolidated → ${r.id ?? '(new)'}`);
        loadCandidates();
      } else {
        setError('consolidate failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'consolidate failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-cyan-500/30 bg-black/60 p-4">
        <h2 className="text-cyan-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <GitBranch className="w-4 h-4" /> Lineage walk
        </h2>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="flex-1 min-w-[240px]">
            <label className="text-[10px] text-white/40 uppercase tracking-wider mb-1 block">Root understanding ID</label>
            <input
              value={rootId}
              onChange={(e) => setRootId(e.target.value)}
              placeholder="und_..."
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/40 uppercase tracking-wider mb-1 block">Max depth</label>
            <input
              type="number" min={1} max={20}
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              className="w-20 bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={loadLineage}
            disabled={busy || !rootId}
            className="px-3 py-2 text-xs bg-cyan-500/20 border border-cyan-500/40 rounded text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
            Walk lineage
          </button>
        </div>
        {lineage && (lineage.length === 0 ? (
          <p className="text-xs text-white/50 italic">No lineage for this id (or root not found).</p>
        ) : (
          <ul className="space-y-1">
            {lineage.map((n) => (
              <li key={n.id} className="text-xs flex items-center gap-2">
                <span className="w-8 text-right text-cyan-300 font-mono">{n.depth ?? '?'}</span>
                <span className="font-mono truncate flex-1">{n.id}</span>
                {n.composer && <span className="text-white/40 text-[10px]">{n.composer}</span>}
              </li>
            ))}
          </ul>
        ))}
      </div>

      <div className="rounded-lg border border-white/10 bg-black/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white/80 font-semibold inline-flex items-center gap-1.5">
            <Layers className="w-4 h-4" /> Consolidation candidates
          </h2>
          <button
            onClick={loadCandidates}
            disabled={busy}
            className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        {candidates.length === 0 ? (
          <p className="text-xs text-white/50 italic">No candidates right now. Evidence + promotion accumulate over time, then candidates surface here.</p>
        ) : (
          <ul className="space-y-2">
            {candidates.map((c, i) => (
              <li key={i} className="bg-white/5 border border-white/10 rounded p-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white/70">
                    {c.childIds.length} children
                    {c.similarity != null && <span className="text-white/40 ml-2">similarity {Number(c.similarity).toFixed(2)}</span>}
                  </div>
                  {c.rationale && <div className="text-[11px] text-white/50 mt-0.5">{c.rationale}</div>}
                  <div className="text-[10px] font-mono text-white/40 mt-1 truncate">
                    {c.childIds.slice(0, 3).join(', ')}{c.childIds.length > 3 && ` +${c.childIds.length - 3}`}
                  </div>
                </div>
                <button
                  onClick={() => runConsolidate(c)}
                  disabled={busy}
                  className="px-3 py-1 text-[11px] bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1"
                >
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Consolidate
                </button>
              </li>
            ))}
          </ul>
        )}
        {consolidateMsg && <p className="text-xs text-emerald-300 mt-2">{consolidateMsg}</p>}
      </div>

      {error && <p className="text-sm text-rose-300 inline-flex items-center gap-1">
        <AlertCircle className="w-4 h-4" /> {error}
      </p>}
    </section>
  );
}
