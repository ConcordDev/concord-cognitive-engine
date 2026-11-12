'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain } from 'lucide-react';
import {
  fetchJSON, Loading, ErrorState, Empty,
  type BrainStats, type ActiveModels,
} from '@/components/lattice/latticeShared';

interface BrainHistoryRow {
  id: number;
  model_name: string;
  base_model?: string;
  corpus_size?: number;
  eval_score?: number;
  active?: number;
  created_at?: number;
}
interface BrainHistory { ok: boolean; brainId: string; history: BrainHistoryRow[] }

export function BrainsPanel() {
  // S2 (F2): the page's "Open a brain" picker names a brain through
  // sessionStorage (survives the panel switch) + a live event (when
  // this panel is already mounted). The named card scrolls into view
  // and rings — the CTA's promise, kept observably.
  const [highlight, setHighlight] = useState<string | null>(null);
  // FIX-lattice-001: a picked brain also opens its DETAIL view (stats +
  // model-version history from /api/brains/:brainId/history). A ring on
  // a card was not a detail view, and on an instance with no recorded
  // interactions there was no card to ring at all — the pick silently
  // landed on the empty state.
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const stored = sessionStorage.getItem('lattice.openBrain');
    if (stored) { setHighlight(stored); setSelected(stored); sessionStorage.removeItem('lattice.openBrain'); }
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) { setHighlight(id); setSelected(id); }
    };
    window.addEventListener('lattice:open-brain', onOpen);
    return () => window.removeEventListener('lattice:open-brain', onOpen);
  }, []);
  const history = useQuery({
    queryKey: ['lattice-brain-history', selected],
    queryFn: () => fetchJSON<BrainHistory>(`/api/brains/${selected}/history`),
    enabled: !!selected,
  });
  const brainStats = useQuery({
    queryKey: ['lattice-brains-stats'],
    queryFn: () => fetchJSON<BrainStats>('/api/brains/stats'),
    refetchInterval: 30_000,
  });
  const activeModels = useQuery({
    queryKey: ['lattice-brains-active'],
    queryFn: () => fetchJSON<ActiveModels>('/api/brains/active'),
  });

  useEffect(() => {
    if (!highlight || !brainStats.data) return;
    const el = document.getElementById(`lattice-brain-${highlight}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(t);
  }, [highlight, brainStats.data]);

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Brain corpus health</h2>
      {brainStats.isLoading ? (
        <Loading label="Loading brain stats…" />
      ) : brainStats.isError ? (
        <ErrorState
          message={(brainStats.error as Error)?.message ?? 'Failed to load brain stats.'}
          onRetry={() => brainStats.refetch()}
          retrying={brainStats.isFetching}
        />
      ) : (brainStats.data?.brains ?? []).length === 0 ? (
        <Empty>No brain interactions recorded yet — corpus counts appear as the brains are exercised.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {brainStats.data!.brains.map((b) => (
            <div key={b.brainId} id={`lattice-brain-${b.brainId}`} className={`rounded-lg border bg-fuchsia-950/10 p-3 ${highlight === b.brainId ? 'border-teal-300 ring-2 ring-teal-300/60' : 'border-fuchsia-900/40'}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-fuchsia-200">{b.brainId}</span>
                <span className="flex items-center gap-2">
                  <span className="rounded bg-fuchsia-800/30 px-1.5 py-0.5 text-[10px] text-fuchsia-300">{b.total} interactions</span>
                  <button
                    type="button"
                    onClick={() => setSelected(b.brainId)}
                    className="rounded border border-teal-300/40 px-1.5 py-0.5 text-[10px] text-teal-200 hover:bg-teal-300/10"
                  >
                    Details
                  </button>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-fuchsia-500">
                <div>Positive: <span className="text-emerald-400">{b.positive}</span></div>
                <div>Pending: <span className="text-amber-400">{b.pending}</span></div>
                <div>Consented interactions: <span className="text-fuchsia-200">{b.consented}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <section aria-label={`Brain detail ${selected}`} className="mt-6 rounded-lg border border-teal-300/30 bg-teal-950/10 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-teal-200">
              Brain detail — <span className="font-mono">{selected}</span>
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-white/10"
            >
              Close
            </button>
          </div>
          {(() => {
            const s = (brainStats.data?.brains ?? []).find((b) => b.brainId === selected);
            return s ? (
              <p className="mb-2 text-xs text-fuchsia-300">
                {s.total} interactions · {s.positive} positive · {s.pending} pending · {s.consented} consented
              </p>
            ) : (
              <p className="mb-2 text-xs text-fuchsia-300">No interactions recorded yet for this brain.</p>
            );
          })()}
          <h4 className="mb-1 text-xs font-semibold text-fuchsia-300">Model versions</h4>
          {history.isLoading ? (
            <Loading label="Loading model history…" />
          ) : history.isError ? (
            <ErrorState
              message={(history.error as Error)?.message ?? 'Failed to load model history.'}
              onRetry={() => history.refetch()}
              retrying={history.isFetching}
            />
          ) : (history.data?.history ?? []).length === 0 ? (
            <Empty>No model versions yet for this brain — a refresh run builds the first one.</Empty>
          ) : (
            <ul className="space-y-1">
              {history.data!.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-3 rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-3 py-2 text-xs">
                  <span className="text-fuchsia-100">{h.model_name}</span>
                  {h.base_model && <span className="text-fuchsia-700">on {h.base_model}</span>}
                  {h.corpus_size != null && <span className="text-fuchsia-500">corpus {h.corpus_size}</span>}
                  {h.eval_score != null && <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">eval {h.eval_score.toFixed(2)}</span>}
                  {!!h.active && <span className="rounded bg-teal-900/40 px-1.5 py-0.5 text-[10px] text-teal-300">active</span>}
                  {h.created_at != null && <span className="ml-auto text-fuchsia-700">{new Date(h.created_at * 1000).toLocaleDateString()}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold text-fuchsia-300">Active models</h3>
      {activeModels.isLoading ? (
        <Loading label="Loading active models…" />
      ) : activeModels.isError ? (
        <ErrorState
          message={(activeModels.error as Error)?.message ?? 'Failed to load active models.'}
          onRetry={() => activeModels.refetch()}
          retrying={activeModels.isFetching}
        />
      ) : (activeModels.data?.active ?? []).length === 0 ? (
        <Empty>No evolved model is active yet — trigger a refresh on the Refresh tab to build one.</Empty>
      ) : (
        <ul className="space-y-1">
          {activeModels.data!.active.map((a) => (
            <li key={a.brain_id} className="flex flex-wrap items-center gap-3 rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-3 py-2 text-xs">
              <Brain className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
              <span className="font-mono text-fuchsia-300">{a.brain_id}</span>
              <span className="text-fuchsia-100">{a.model_name}</span>
              {a.base_model && <span className="text-fuchsia-700">on {a.base_model}</span>}
              {a.eval_score != null && <span className="ml-auto rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">eval {a.eval_score.toFixed(2)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
