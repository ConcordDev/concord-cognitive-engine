'use client';

/**
 * TrainingRuns — MLOps experiment-tracking surface for the Lattice lens.
 *
 * Surfaces the brain-self-training pipeline shipped in migration 201 /
 * routes/brains.js:
 *   • Run history     — GET  /api/brains/runs           (diffable, eval deltas)
 *   • Eval curves     — GET  /api/brains/:id/eval-curve (loss/accuracy per run)
 *   • Model rollback  — GET  /api/brains/:id/history + POST /:id/rollback
 *   • Corpus sample   — GET  /api/brains/:id/corpus-sample
 *
 * Every value rendered comes from a real REST response — no mock data.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChartKit } from '@/components/viz';
import {
  Loader2, History as HistoryIcon, GitBranch, FlaskConical, RotateCcw, Check, X,
  AlertTriangle, RefreshCw,
} from 'lucide-react';

const BRAINS = ['conscious', 'subconscious', 'utility', 'repair'] as const;

function ErrorRow({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
      <AlertTriangle className="h-4 w-4 text-rose-400" aria-hidden />
      <span className="flex-1">{message}</span>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-2 py-1 font-medium hover:bg-rose-800/60 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-400"
      >
        {retrying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

interface RunRow {
  id: string;
  brain_id: string;
  trigger: string;
  status: string;
  corpus_size: number;
  eval_score: number | null;
  prev_score: number | null;
  swapped: number;
  model_name: string | null;
  base_model: string | null;
  triggered_by: string | null;
  created_at: number;
  delta: number | null;
}
interface CurvePoint {
  run: number;
  runId: string;
  evalScore: number;
  loss: number;
  corpusSize: number;
  swapped: boolean;
  model: string | null;
  at: number;
}
interface ModelRow {
  id: string;
  model_name: string;
  base_model: string | null;
  corpus_size: number;
  eval_score: number | null;
  active: number;
  created_at: number;
  retired_at: number | null;
}
interface SampleRow {
  idx: number;
  domain: string;
  promptPreview: string;
  responsePreview: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

function fmt(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

export function TrainingRuns() {
  const qc = useQueryClient();
  const [brain, setBrain] = useState<string>('conscious');
  const [sampleOpen, setSampleOpen] = useState(false);

  const runs = useQuery({
    queryKey: ['lattice-runs', brain],
    queryFn: () => getJSON<{ ok: boolean; runs: RunRow[] }>(`/api/brains/runs?brain=${brain}&limit=40`),
    refetchInterval: 60_000,
  });

  const curve = useQuery({
    queryKey: ['lattice-eval-curve', brain],
    queryFn: () =>
      getJSON<{ ok: boolean; curve: CurvePoint[]; bestEval: number; runCount: number }>(
        `/api/brains/${brain}/eval-curve?limit=60`,
      ),
    refetchInterval: 60_000,
  });

  const history = useQuery({
    queryKey: ['lattice-model-history', brain],
    queryFn: () =>
      getJSON<{ ok: boolean; history: ModelRow[] }>(`/api/brains/${brain}/history?limit=30`),
  });

  const sample = useQuery({
    queryKey: ['lattice-corpus-sample', brain],
    queryFn: () =>
      getJSON<{ ok: boolean; count: number; sample: SampleRow[] }>(
        `/api/brains/${brain}/corpus-sample?limit=20`,
      ),
    enabled: sampleOpen,
  });

  const rollback = useMutation({
    mutationFn: (modelId: string) =>
      fetch(`/api/brains/${brain}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lattice-model-history', brain] });
      qc.invalidateQueries({ queryKey: ['lattice-brains-active'] });
    },
  });

  const curveData = (curve.data?.curve ?? []).map((c) => ({
    run: `#${c.run}`,
    eval: c.evalScore,
    loss: c.loss,
  }));

  return (
    <div className="space-y-8">
      {/* brain selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-fuchsia-700">Brain</span>
        {BRAINS.map((b) => (
          <button
            key={b}
            onClick={() => setBrain(b)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-fuchsia-400 ${
              brain === b
                ? 'bg-fuchsia-700/50 text-fuchsia-100'
                : 'bg-fuchsia-950/30 text-fuchsia-500 hover:text-fuchsia-300'
            }`}
            aria-pressed={brain === b}
          >
            {b}
          </button>
        ))}
      </div>

      {/* ── Eval / loss curve ──────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <FlaskConical className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
          <h3 className="text-sm font-semibold text-fuchsia-300">
            Eval &amp; loss curve — {brain}
          </h3>
          {curve.data && curve.data.runCount > 0 && (
            <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
              best eval {curve.data.bestEval.toFixed(3)}
            </span>
          )}
        </div>
        {curve.isLoading ? (
          <Loader2 role="status" aria-label="Loading eval curve" className="h-4 w-4 animate-spin text-fuchsia-500" />
        ) : curve.isError ? (
          <ErrorRow
            message={(curve.error as Error)?.message ?? 'Failed to load eval curve.'}
            onRetry={() => curve.refetch()}
            retrying={curve.isFetching}
          />
        ) : curveData.length === 0 ? (
          <p className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-4 py-6 text-center text-xs text-fuchsia-600">
            No eval-scored runs for {brain} yet — trigger a refresh on the Refresh tab.
          </p>
        ) : (
          <ChartKit
            kind="line"
            data={curveData}
            xKey="run"
            series={[
              { key: 'eval', label: 'Eval score', color: '#22c55e' },
              { key: 'loss', label: 'Loss (1 − eval)', color: '#ef4444' },
            ]}
            height={240}
          />
        )}
      </section>

      {/* ── Run history ────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <HistoryIcon className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
          <h3 className="text-sm font-semibold text-fuchsia-300">Training run history</h3>
        </div>
        {runs.isLoading ? (
          <Loader2 role="status" aria-label="Loading run history" className="h-4 w-4 animate-spin text-fuchsia-500" />
        ) : runs.isError ? (
          <ErrorRow
            message={(runs.error as Error)?.message ?? 'Failed to load run history.'}
            onRetry={() => runs.refetch()}
            retrying={runs.isFetching}
          />
        ) : (runs.data?.runs ?? []).length === 0 ? (
          <p className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-4 py-6 text-center text-xs text-fuchsia-600">
            No refresh runs recorded for {brain} yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-fuchsia-900/40">
            <table className="w-full font-mono text-xs">
              <thead className="bg-fuchsia-950/40 text-fuchsia-400">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Trigger</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Corpus</th>
                  <th className="px-3 py-2 text-right">Eval</th>
                  <th className="px-3 py-2 text-right">Δ</th>
                  <th className="px-3 py-2 text-left">Model</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data?.runs ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-fuchsia-900/20">
                    <td className="px-3 py-2 text-fuchsia-400">{fmt(r.created_at)}</td>
                    <td className="px-3 py-2 text-fuchsia-300">{r.trigger}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          r.status === 'completed'
                            ? 'bg-emerald-900/40 text-emerald-300'
                            : r.status === 'failed'
                              ? 'bg-rose-900/40 text-rose-300'
                              : 'bg-amber-900/40 text-amber-300'
                        }`}
                      >
                        {r.status}
                      </span>
                      {r.swapped ? (
                        <span className="ml-1 rounded bg-fuchsia-800/40 px-1 text-[10px] text-fuchsia-200">
                          swapped
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right text-fuchsia-200">{r.corpus_size}</td>
                    <td className="px-3 py-2 text-right text-fuchsia-200">
                      {r.eval_score != null ? r.eval_score.toFixed(3) : '—'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        r.delta == null
                          ? 'text-fuchsia-700'
                          : r.delta >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                      }`}
                    >
                      {r.delta == null ? '—' : `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)}`}
                    </td>
                    <td className="px-3 py-2 text-fuchsia-300">{r.model_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Model rollback ─────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
          <h3 className="text-sm font-semibold text-fuchsia-300">Model versions &amp; rollback</h3>
        </div>
        {rollback.isSuccess && rollback.data?.ok && (
          <p className="mb-2 inline-flex items-center gap-1 text-xs text-emerald-400">
            <Check className="h-3 w-3" /> Pinned {rollback.data.activeModel} as active for {brain}.
          </p>
        )}
        {rollback.isSuccess && rollback.data && !rollback.data.ok && (
          <p className="mb-2 inline-flex items-center gap-1 text-xs text-rose-400">
            <X className="h-3 w-3" /> {rollback.data.error}
          </p>
        )}
        {history.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-fuchsia-500" />
        ) : (history.data?.history ?? []).length === 0 ? (
          <p className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-4 py-6 text-center text-xs text-fuchsia-600">
            No model versions recorded for {brain} yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {(history.data?.history ?? []).map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-3 rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-3 py-2 text-xs"
              >
                <span className="font-mono text-fuchsia-200">{m.model_name}</span>
                {m.base_model && (
                  <span className="text-fuchsia-700">base {m.base_model}</span>
                )}
                <span className="text-fuchsia-600">corpus {m.corpus_size}</span>
                {m.eval_score != null && (
                  <span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    eval {m.eval_score.toFixed(3)}
                  </span>
                )}
                <span className="text-fuchsia-700">{fmt(m.created_at)}</span>
                {m.active ? (
                  <span className="ml-auto rounded bg-fuchsia-700/50 px-1.5 py-0.5 text-[10px] text-fuchsia-100">
                    active
                  </span>
                ) : (
                  <button
                    onClick={() => rollback.mutate(m.id)}
                    disabled={rollback.isPending}
                    className="ml-auto inline-flex items-center gap-1 rounded bg-amber-900/40 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-800/60 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    {rollback.isPending ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-2.5 w-2.5" />
                    )}
                    Roll back to this
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Corpus sample inspector ────────────────────────────────── */}
      <section>
        <button
          onClick={() => setSampleOpen((o) => !o)}
          className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-fuchsia-300 hover:text-fuchsia-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
          aria-expanded={sampleOpen}
        >
          <FlaskConical className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
          Corpus sample inspector {sampleOpen ? '▾' : '▸'}
        </button>
        {sampleOpen && (
          sample.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-fuchsia-500" />
          ) : (sample.data?.sample ?? []).length === 0 ? (
            <p className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-4 py-6 text-center text-xs text-fuchsia-600">
              No consented positive interactions in the {brain} corpus yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {(sample.data?.sample ?? []).map((s) => (
                <li
                  key={s.idx}
                  className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 p-3 text-xs"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-fuchsia-800/30 px-1.5 py-0.5 text-[10px] text-fuchsia-300">
                      {s.domain}
                    </span>
                    {(s.tokensIn != null || s.tokensOut != null) && (
                      <span className="text-[10px] text-fuchsia-700">
                        {s.tokensIn ?? '?'} in / {s.tokensOut ?? '?'} out
                      </span>
                    )}
                  </div>
                  <p className="mb-1 text-fuchsia-400">
                    <span className="text-fuchsia-700">prompt&nbsp;</span>
                    {s.promptPreview || '—'}
                  </p>
                  <p className="text-fuchsia-200">
                    <span className="text-fuchsia-700">response&nbsp;</span>
                    {s.responsePreview || '—'}
                  </p>
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </div>
  );
}
