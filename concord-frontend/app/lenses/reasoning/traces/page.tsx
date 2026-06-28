'use client';

// Phase DC8 — HLR reasoning trace browser.
// Reader / dashboard over the High-Level-Reasoning engine
// (server/emergent/hlr-engine.js): lists recent reasoning traces, opens one for
// detail, and filters by mode (7 reasoning modes). This is a watcher surface —
// a trace is an immutable record of a reasoning pass, so there is no
// create/edit/delete here by design.
//
// Data path (all REAL, verified registered):
//   GET /api/reasoning/traces?limit=100  -> app.get @ server.js (listTraces + agent_reasoning_traces)
//   GET /api/reasoning/trace/:id         -> app.get @ server.js (getReasoningTrace)
// The same engine is also reachable through the runMacro surface
// (reasoning.traces / reasoning.trace / reasoning.run) the manifest now points at.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { Brain, Filter, Activity, Sparkles, Loader2, AlertTriangle, RefreshCcw } from 'lucide-react';

interface Trace {
  id: string;
  mode: string;
  input_summary?: string;
  chain_count?: number;
  confidence?: number;
  created_at?: number;
}

// Wave 7 / B6 — the durable agent deliberation journal (what the agent was thinking
// on each tier-3 salience wake), with the access-correlate awareness index.
interface AgentTrace {
  id: string;
  agent_id?: string;
  world_id?: string;
  attended?: string;
  quale?: string;
  surprise?: number;
  awareness_index?: number;
  reason?: string;
  note?: string;
  created_at?: number;
}

type LoadState = 'loading' | 'error' | 'ready';

// The HLR list endpoint returns traces keyed by `traceId` + summary fields.
// Normalise to the flat shape this view renders.
function normalizeTrace(raw: Record<string, unknown>): Trace {
  return {
    id: String(raw.id ?? raw.traceId ?? ''),
    mode: String(raw.mode ?? ''),
    input_summary:
      (raw.input_summary as string) ??
      (raw.synthesizedConclusion as string) ??
      (raw.topic as string) ??
      (raw.question as string) ??
      undefined,
    chain_count:
      typeof raw.chain_count === 'number'
        ? raw.chain_count
        : typeof raw.chainCount === 'number'
          ? (raw.chainCount as number)
          : undefined,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
    created_at: typeof raw.created_at === 'number' ? raw.created_at : undefined,
  };
}

export default function ReasoningTracesPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [agentTraces, setAgentTraces] = useState<AgentTrace[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<string>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTrace, setActiveTrace] = useState<Record<string, unknown> | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/reasoning/traces?limit=100', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || 'reasoning_traces_failed');
      setTraces((j.traces || []).map(normalizeTrace));
      setModes(j.modes || []);
      setAgentTraces(j.agentTraces || []);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    if (filterMode === 'all') return traces;
    return traces.filter((t) => t.mode === filterMode);
  }, [traces, filterMode]);

  const openTrace = async (id: string) => {
    setActiveId(id);
    setActiveTrace(null);
    try {
      const res = await fetch(`/api/reasoning/trace/${id}`, { credentials: 'include' });
      if (!res.ok) return;
      const j = await res.json();
      if (j?.ok) setActiveTrace(j.trace || null);
    } catch { /* detail fetch is best-effort; list stays usable */ }
  };

  return (
    <LensShell lensId="reasoning">
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-cyan-200">
            <Brain size={22} aria-hidden="true" /> HLR reasoning traces
          </h1>
          <p className="text-sm text-zinc-400">7 reasoning modes — deductive · inductive · abductive · adversarial · analogical · temporal · counterfactual.</p>
        </div>
        <button
          onClick={refresh}
          aria-label="Refresh reasoning traces"
          className="flex items-center gap-1 rounded border border-cyan-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-cyan-200 hover:border-cyan-400/60"
        >
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
        </button>
      </header>

      {state === 'loading' && (
        <div role="status" aria-live="polite" aria-busy="true" className="flex items-center justify-center gap-2 py-16 text-sm text-cyan-300">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>Loading reasoning traces…</span>
        </div>
      )}

      {state === 'error' && (
        <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-amber-400" aria-hidden="true" />
          <p className="text-sm text-zinc-300">Couldn&apos;t load reasoning traces.</p>
          <button
            onClick={refresh}
            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 hover:border-cyan-400"
          >
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && (
        <>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-cyan-300" aria-hidden="true" />
            <label htmlFor="reasoning-mode-filter" className="sr-only">Filter traces by reasoning mode</label>
            <select
              id="reasoning-mode-filter"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value)}
              className="rounded border border-cyan-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-cyan-100"
            >
              <option value="all">All modes ({traces.length})</option>
              {modes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {traces.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded border border-cyan-500/20 bg-zinc-900/30 py-16 text-center">
              <Brain className="h-6 w-6 text-zinc-600" aria-hidden="true" />
              <p className="text-sm text-zinc-300">No reasoning traces yet.</p>
              <p className="max-w-md text-xs text-zinc-500">
                The HLR engine records a trace each time it runs a reasoning pass — from the
                drift-scan constraint-check cycle, the lattice orchestrator, or a manual
                <code className="mx-1 rounded bg-zinc-800 px-1 text-cyan-300">reasoning.run</code> call.
                When one fires, it shows up here.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1" role="list" aria-label="Reasoning traces">
                {filtered.length === 0 && <p className="text-xs text-zinc-500">No traces match this mode.</p>}
                {filtered.map((t) => (
                  <button
                    key={t.id}
                    role="listitem"
                    onClick={() => openTrace(t.id)}
                    aria-pressed={activeId === t.id}
                    className={[
                      'block w-full rounded border p-2 text-left text-xs',
                      activeId === t.id ? 'border-cyan-300 bg-cyan-500/20' : 'border-cyan-500/20 bg-zinc-900/40 hover:border-cyan-400/50',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-cyan-100">{t.mode || '—'}</span>
                      <span className="text-[10px] text-amber-300/70">conf {Math.round((t.confidence || 0) * 100)}%</span>
                    </div>
                    {t.input_summary && <div className="text-[10px] text-zinc-400">{t.input_summary.slice(0, 80)}</div>}
                    <div className="text-[9px] text-zinc-500">chains: {t.chain_count ?? '?'}</div>
                  </button>
                ))}
              </div>

              <div className="rounded border border-cyan-500/30 bg-zinc-900/40 p-3 text-xs">
                {!activeTrace ? (
                  <p className="text-zinc-500">{activeId ? 'Loading trace…' : 'Pick a trace.'}</p>
                ) : (
                  <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-cyan-100">
                    {JSON.stringify(activeTrace, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Wave 7 / B6 — the autonomous agent's deliberation journal + the B8 awareness
              curve. The number is an ACCESS correlate (PCI-proxy), NOT a consciousness claim. */}
          <section className="space-y-2 pt-2">
            <header className="flex items-center gap-2">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-sky-200">
                <Sparkles size={18} aria-hidden="true" /> Agent deliberation journal
              </h2>
              <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                awareness = access correlate, not a consciousness claim
              </span>
            </header>

            {agentTraces.length === 0 ? (
              <p className="text-xs text-zinc-500">No agent deliberations recorded — the agent is on instinct (or none deployed). Set CONCORD_AWARENESS_LOOP=1 + deploy an agent.</p>
            ) : (
              <>
                <AwarenessCurve traces={agentTraces} />
                <div className="space-y-1">
                  {agentTraces.map((a) => (
                    <div key={a.id} className="rounded border border-sky-500/20 bg-zinc-900/40 p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sky-200">{a.reason || 'wake'}</span>
                        <span className="flex items-center gap-1 text-[10px] text-emerald-300/80">
                          <Activity size={11} aria-hidden="true" /> Φ≈{(a.awareness_index ?? 0).toFixed(3)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
                        <span>attended: <span className="text-zinc-200">{a.attended || '—'}</span></span>
                        {a.quale && <span>felt: <span className="text-fuchsia-300">{a.quale}</span></span>}
                        {a.surprise != null && <span>surprise: <span className="text-amber-300">{a.surprise.toFixed(2)}</span></span>}
                      </div>
                      {a.note && <div className="mt-1 font-mono text-[10px] text-sky-100/80">{a.note}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
    </LensShell>
  );
}

// A compact SVG sparkline of the awareness index over time — "watch it rise as it
// wakes, dip as it sleeps". Rows arrive newest-first, so we reverse for time order.
function AwarenessCurve({ traces }: { traces: AgentTrace[] }) {
  const series = traces
    .map((t) => Math.max(0, Math.min(1, t.awareness_index ?? 0)))
    .reverse();
  if (series.length < 2) return null;
  const W = 520, H = 60, pad = 4;
  const stepX = (W - pad * 2) / (series.length - 1);
  const points = series
    .map((v, i) => `${(pad + i * stepX).toFixed(1)},${(H - pad - v * (H - pad * 2)).toFixed(1)}`)
    .join(' ');
  const last = series[series.length - 1];
  return (
    <div className="rounded border border-emerald-500/20 bg-zinc-950/50 p-2">
      <div className="mb-1 flex items-center justify-between text-[10px] text-emerald-300/80">
        <span>awareness index over the last {series.length} wakes</span>
        <span>now Φ≈{last.toFixed(3)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" preserveAspectRatio="none" aria-label="awareness index curve">
        <polyline points={points} fill="none" stroke="rgb(52 211 153)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
