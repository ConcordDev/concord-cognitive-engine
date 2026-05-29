'use client';

// Phase DC8 — HLR reasoning trace browser.
// Lists recent reasoning traces; filter by mode (7 reasoning modes).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { Brain, Filter } from 'lucide-react';

interface Trace {
  id: string;
  mode: string;
  input_summary?: string;
  chain_count?: number;
  confidence?: number;
  created_at?: number;
}

export default function ReasoningTracesPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<string>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTrace, setActiveTrace] = useState<Record<string, unknown> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch('/api/reasoning/traces?limit=100', { credentials: 'include' }).then(r => r.json());
      if (j?.ok) { setTraces(j.traces || []); setModes(j.modes || []); }
    } catch { /* swallow */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    if (filterMode === 'all') return traces;
    return traces.filter((t) => t.mode === filterMode);
  }, [traces, filterMode]);

  const openTrace = async (id: string) => {
    setActiveId(id);
    try {
      const j = await fetch(`/api/reasoning/trace/${id}`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setActiveTrace(j.trace || null);
    } catch { /* swallow */ }
  };

  return (
    <LensShell lensId="reasoning">
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-cyan-200">
          <Brain size={22} /> HLR reasoning traces
        </h1>
        <p className="text-sm text-zinc-400">7 reasoning modes — deductive · inductive · abductive · adversarial · analogical · temporal · counterfactual.</p>
      </header>

      <div className="flex items-center gap-2">
        <Filter size={14} className="text-cyan-300" />
        <select value={filterMode} onChange={(e) => setFilterMode(e.target.value)} className="rounded border border-cyan-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-cyan-100">
          <option value="all">All modes ({traces.length})</option>
          {modes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          {filtered.length === 0 && <p className="text-xs text-zinc-500">No traces match.</p>}
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => openTrace(t.id)}
              className={[
                'block w-full rounded border p-2 text-left text-xs',
                activeId === t.id ? 'border-cyan-300 bg-cyan-500/20' : 'border-cyan-500/20 bg-zinc-900/40 hover:border-cyan-400/50',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-cyan-100">{t.mode}</span>
                <span className="text-[10px] text-amber-300/70">conf {Math.round((t.confidence || 0) * 100)}%</span>
              </div>
              {t.input_summary && <div className="text-[10px] text-zinc-400">{t.input_summary.slice(0, 80)}</div>}
              <div className="text-[9px] text-zinc-500">chains: {t.chain_count ?? '?'}</div>
            </button>
          ))}
        </div>

        <div className="rounded border border-cyan-500/30 bg-zinc-900/40 p-3 text-xs">
          {!activeTrace ? (
            <p className="text-zinc-500">Pick a trace.</p>
          ) : (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-cyan-100">
              {JSON.stringify(activeTrace, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
    </LensShell>
  );
}
