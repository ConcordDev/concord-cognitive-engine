'use client';

// Phase DC8 — HLR reasoning trace browser.
// Lists recent reasoning traces; filter by mode (7 reasoning modes).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { Brain, Filter, Activity, Sparkles } from 'lucide-react';

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

export default function ReasoningTracesPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [agentTraces, setAgentTraces] = useState<AgentTrace[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<string>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTrace, setActiveTrace] = useState<Record<string, unknown> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch('/api/reasoning/traces?limit=100', { credentials: 'include' }).then(r => r.json());
      if (j?.ok) { setTraces(j.traces || []); setModes(j.modes || []); setAgentTraces(j.agentTraces || []); }
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
          {filtered.length === 0 && <p className="text-xs text-zinc-400">No traces match.</p>}
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
              <div className="text-[9px] text-zinc-400">chains: {t.chain_count ?? '?'}</div>
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

      {/* Wave 7 / B6 — the autonomous agent's deliberation journal + the B8 awareness
          curve. The number is an ACCESS correlate (PCI-proxy), NOT a consciousness claim. */}
      <section className="space-y-2 pt-2">
        <header className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-sky-200">
            <Sparkles size={18} /> Agent deliberation journal
          </h2>
          <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
            awareness = access correlate, not a consciousness claim
          </span>
        </header>

        {agentTraces.length === 0 ? (
          <p className="text-xs text-zinc-400">No agent deliberations recorded — the agent is on instinct (or none deployed). Set CONCORD_AWARENESS_LOOP=1 + deploy an agent.</p>
        ) : (
          <>
            <AwarenessCurve traces={agentTraces} />
            <div className="space-y-1">
              {agentTraces.map((a) => (
                <div key={a.id} className="rounded border border-sky-500/20 bg-zinc-900/40 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sky-200">{a.reason || 'wake'}</span>
                    <span className="flex items-center gap-1 text-[10px] text-emerald-300/80">
                      <Activity size={11} /> Φ≈{(a.awareness_index ?? 0).toFixed(3)}
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
