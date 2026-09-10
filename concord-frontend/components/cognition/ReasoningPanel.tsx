'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { ReasoningTraceTree, type ReasoningTrace } from '@/components/cognition/ReasoningTraceTree';
import { ModeRecommender } from '@/components/cognition/ModeRecommender';
import { ModeComparison } from '@/components/cognition/ModeComparison';
import { TraceExports } from '@/components/cognition/TraceExports';
import { Loader2, Zap, ChevronRight } from 'lucide-react';

const REASONING_MODES = [
  { id: 'deductive',      label: 'Deductive',      desc: 'Premise → conclusion. Strict logical implication.' },
  { id: 'inductive',      label: 'Inductive',      desc: 'Pattern → generalization. Risk of overreach.' },
  { id: 'abductive',      label: 'Abductive',      desc: 'Best explanation given evidence. Inference to best fit.' },
  { id: 'adversarial',    label: 'Adversarial',    desc: 'Steelman the opposite. Stress-test claim.' },
  { id: 'analogical',     label: 'Analogical',     desc: 'Map structure across domains.' },
  { id: 'temporal',       label: 'Temporal',       desc: 'How does this evolve over time?' },
  { id: 'counterfactual', label: 'Counterfactual', desc: 'What if the premise were false?' },
];

export function ReasoningPanel() {
  const [hlrInput, setHlrInput] = useState('');
  const [hlrMode, setHlrMode] = useState('abductive');
  const [hlrTrace, setHlrTrace] = useState<ReasoningTrace | null>(null);
  const [reasoningView, setReasoningView] = useState<'run' | 'compare' | 'export'>('run');

  const runHLR = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('hlr', 'run', { question: hlrInput, mode: hlrMode });
      const run = (r.data?.result ?? r.data) as { traceId?: string } | null;
      if (run?.traceId) {
        const t = await apiHelpers.lens.runDomain('hlr', 'trace', { traceId: run.traceId });
        const full = (t.data?.result ?? t.data) as ReasoningTrace | null;
        if (full && Array.isArray(full.chains)) return full;
      }
      return run as ReasoningTrace | null;
    },
    onSuccess: (data) => setHlrTrace(data),
  });

  const loadTrace = useMutation({
    mutationFn: async (traceId: string) => {
      const t = await apiHelpers.lens.runDomain('hlr', 'trace', { traceId });
      return (t.data?.result ?? t.data) as ReasoningTrace | null;
    },
    onSuccess: (data) => setHlrTrace(data),
  });

  const traces = useQuery({
    queryKey: ['hlr-traces'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('hlr', 'list_traces', { limit: 10 });
      return (r.data?.result ?? r.data) as { traces?: Array<{ id: string; mode: string; createdAt: string; chains?: unknown[] }> };
    },
    refetchInterval: 30_000,
  });

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {([
          ['run', 'Run & inspect'],
          ['compare', 'Compare modes'],
          ['export', 'Saved exports'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setReasoningView(key)}
            className={`rounded px-3 py-1.5 text-xs font-medium ${
              reasoningView === key
                ? 'bg-violet-700/40 text-violet-100'
                : 'bg-violet-950/30 text-violet-500 hover:text-violet-300'
            }`}
            aria-pressed={reasoningView === key}
          >{label}</button>
        ))}
      </div>

      <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-4">
        <label className="block text-xs uppercase tracking-wider text-violet-700" htmlFor="hlr-claim">Claim or question</label>
        <textarea
          id="hlr-claim"
          value={hlrInput}
          onChange={(e) => setHlrInput(e.target.value)}
          className="mt-1.5 h-24 w-full rounded border border-violet-900/40 bg-black/40 p-2 font-mono text-sm text-violet-100 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          placeholder="What do you want HLR to reason about?"
        />
        {reasoningView === 'run' && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-violet-700">Mode:</span>
              {REASONING_MODES.map(m => (
                <button
                  key={m.id}
                  onClick={() => setHlrMode(m.id)}
                  title={m.desc}
                  className={`rounded px-2 py-1 text-xs ${hlrMode === m.id ? 'bg-violet-700/40 text-violet-100' : 'bg-violet-950/30 text-violet-500 hover:text-violet-300'}`}
                  aria-pressed={hlrMode === m.id}
                >{m.label}</button>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => runHLR.mutate()}
                disabled={!hlrInput || runHLR.isPending}
                className="inline-flex items-center gap-2 rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                {runHLR.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Run HLR
              </button>
            </div>
          </>
        )}
      </div>

      {reasoningView === 'run' && (
        <>
          <div className="mt-4">
            <ModeRecommender question={hlrInput} onPickMode={setHlrMode} />
          </div>
          {runHLR.isError && (
            <p className="mt-3 text-xs text-rose-400">HLR run failed — try again.</p>
          )}
          {hlrTrace != null && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-violet-300">Inference tree</h3>
              <ReasoningTraceTree trace={hlrTrace} />
            </div>
          )}

          <h3 className="mt-6 mb-2 text-sm font-semibold text-violet-300">Recent traces</h3>
          {traces.isLoading && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
          {(traces.data?.traces ?? []).length === 0 && !traces.isLoading && <p className="text-xs text-violet-700">No traces yet — run one above.</p>}
          <ul className="space-y-1">
            {(traces.data?.traces ?? []).map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => loadTrace.mutate(t.id)}
                  className="flex w-full items-center gap-2 rounded border border-violet-900/30 bg-violet-950/10 px-3 py-2 text-left text-xs hover:bg-violet-900/20"
                >
                  <ChevronRight className="h-3 w-3" />
                  <span className="font-mono text-violet-300">{t.id}</span>
                  <span className="rounded bg-violet-700/30 px-1.5 py-0.5 text-[10px]">{t.mode}</span>
                  <span className="ml-auto text-[10px] text-violet-700">{new Date(t.createdAt).toLocaleTimeString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {reasoningView === 'compare' && (
        <div className="mt-4">
          <ModeComparison prompt={hlrInput} />
        </div>
      )}

      {reasoningView === 'export' && (
        <div className="mt-4">
          <TraceExports pendingTrace={hlrTrace} />
        </div>
      )}
    </section>
  );
}
