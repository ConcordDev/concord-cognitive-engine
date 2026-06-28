'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * RefreshSchedule — per-brain refresh cadence config + A/B model
 * comparison. Backs migration 201 / routes/brains.js:
 *   • GET/POST  /api/brains/schedule
 *   • GET/POST  /api/brains/ab-tests
 *   • POST      /api/brains/ab-tests/:id/conclude
 *
 * Replaces the admin-only manual-trigger-only refresh with a real
 * cadence config, and exposes candidate-vs-active A/B routing.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, CalendarClock, FlaskRound, Check, X, Trophy,
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
const CADENCES = ['manual', 'daily', 'weekly'] as const;

interface ScheduleRow {
  brain_id: string;
  enabled: number;
  cadence: string;
  interval_hours: number;
  next_run_at: number | null;
  last_run_at: number | null;
  updated_at: number | null;
}
interface ABTest {
  id: string;
  brain_id: string;
  candidate_model: string;
  control_model: string;
  traffic_pct: number;
  status: string;
  candidate_calls: number;
  control_calls: number;
  candidate_score: number | null;
  control_score: number | null;
  winner: string | null;
  created_at: number;
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}
function postJSON<T = any>(url: string, body: unknown): Promise<T> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}
function fmt(ts: number | null): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
}

export function RefreshSchedule() {
  const qc = useQueryClient();
  const [abBrain, setAbBrain] = useState<string>('conscious');
  const [candidate, setCandidate] = useState('');
  const [traffic, setTraffic] = useState(10);

  const schedule = useQuery({
    queryKey: ['lattice-schedule'],
    queryFn: () => getJSON<{ ok: boolean; schedule: ScheduleRow[] }>('/api/brains/schedule'),
    refetchInterval: 60_000,
  });

  const abTests = useQuery({
    queryKey: ['lattice-ab-tests'],
    queryFn: () => getJSON<{ ok: boolean; tests: ABTest[] }>('/api/brains/ab-tests'),
    refetchInterval: 30_000,
  });

  const setSchedule = useMutation({
    mutationFn: (b: { brain: string; enabled: boolean; cadence: string }) =>
      postJSON('/api/brains/schedule', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lattice-schedule'] }),
  });

  const startAB = useMutation({
    mutationFn: () =>
      postJSON('/api/brains/ab-tests', {
        brain: abBrain,
        candidateModel: candidate.trim(),
        trafficPct: traffic,
      }),
    onSuccess: () => {
      setCandidate('');
      qc.invalidateQueries({ queryKey: ['lattice-ab-tests'] });
    },
  });

  const concludeAB = useMutation({
    mutationFn: (v: { id: string; winner: 'candidate' | 'control' }) =>
      postJSON(`/api/brains/ab-tests/${v.id}/conclude`, { winner: v.winner }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lattice-ab-tests'] }),
  });

  // schedule rows for the 4 cognitive brains only
  const rows = (schedule.data?.schedule ?? []).filter((r) =>
    (BRAINS as readonly string[]).includes(r.brain_id),
  );

  return (
    <div className="space-y-8">
      {/* ── Refresh cadence ────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <CalendarClock className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
          <h3 className="text-sm font-semibold text-fuchsia-300">Refresh cadence</h3>
        </div>
        <p className="mb-3 max-w-prose text-xs text-fuchsia-700">
          Configure automatic corpus refresh per brain instead of relying on the admin-only
          manual trigger. Enabled brains run on their cadence; the next-run time advances
          after each pass.
        </p>
        {schedule.isLoading ? (
          <Loader2 role="status" aria-label="Loading schedule" className="h-4 w-4 animate-spin text-fuchsia-500" />
        ) : schedule.isError ? (
          <ErrorRow
            message={(schedule.error as Error)?.message ?? 'Failed to load refresh schedule.'}
            onRetry={() => schedule.refetch()}
            retrying={schedule.isFetching}
          />
        ) : (
          <div className="overflow-x-auto rounded border border-fuchsia-900/40">
            <table className="w-full font-mono text-xs">
              <thead className="bg-fuchsia-950/40 text-fuchsia-400">
                <tr>
                  <th className="px-3 py-2 text-left">Brain</th>
                  <th className="px-3 py-2 text-left">Cadence</th>
                  <th className="px-3 py-2 text-left">Enabled</th>
                  <th className="px-3 py-2 text-left">Next run</th>
                  <th className="px-3 py-2 text-left">Last run</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.brain_id} className="border-t border-fuchsia-900/20">
                    <td className="px-3 py-2 text-fuchsia-300">{r.brain_id}</td>
                    <td className="px-3 py-2">
                      <select
                        value={r.cadence}
                        onChange={(e) =>
                          setSchedule.mutate({
                            brain: r.brain_id,
                            enabled: !!r.enabled,
                            cadence: e.target.value,
                          })
                        }
                        className="rounded border border-fuchsia-900/50 bg-black px-1.5 py-0.5 text-fuchsia-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                        aria-label={`Cadence for ${r.brain_id}`}
                      >
                        {CADENCES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() =>
                          setSchedule.mutate({
                            brain: r.brain_id,
                            enabled: !r.enabled,
                            cadence: r.cadence,
                          })
                        }
                        disabled={setSchedule.isPending}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400 ${
                          r.enabled
                            ? 'bg-emerald-700/40 text-emerald-200'
                            : 'bg-rose-900/40 text-rose-300'
                        }`}
                        aria-pressed={!!r.enabled}
                      >
                        {r.enabled ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                        {r.enabled ? 'on' : 'off'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-fuchsia-500">{fmt(r.next_run_at)}</td>
                    <td className="px-3 py-2 text-fuchsia-500">{fmt(r.last_run_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {setSchedule.isError && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-rose-400">
            <X className="h-3 w-3" /> {(setSchedule.error as Error)?.message}
          </p>
        )}
      </section>

      {/* ── A/B model comparison ───────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <FlaskRound className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
          <h3 className="text-sm font-semibold text-fuchsia-300">A/B model comparison</h3>
        </div>
        <p className="mb-3 max-w-prose text-xs text-fuchsia-700">
          Route a slice of traffic to a candidate model and compare it against the current
          active model before promoting.
        </p>
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded border border-fuchsia-900/40 bg-fuchsia-950/10 p-3">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-fuchsia-700">
            Brain
            <select
              value={abBrain}
              onChange={(e) => setAbBrain(e.target.value)}
              className="rounded border border-fuchsia-900/50 bg-black px-2 py-1 text-xs text-fuchsia-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
            >
              {BRAINS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-fuchsia-700">
            Candidate model tag
            <input
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              placeholder="e.g. concord-conscious:v7"
              className="w-56 rounded border border-fuchsia-900/50 bg-black px-2 py-1 text-xs text-fuchsia-200 placeholder:text-fuchsia-800 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-fuchsia-700">
            Traffic % ({traffic})
            <input
              type="range"
              min={1}
              max={50}
              value={traffic}
              onChange={(e) => setTraffic(parseInt(e.target.value, 10))}
              className="w-36 accent-fuchsia-500"
              aria-label="Candidate traffic percentage"
            />
          </label>
          <button
            onClick={() => startAB.mutate()}
            disabled={startAB.isPending || candidate.trim().length === 0}
            className="inline-flex items-center gap-1 rounded bg-fuchsia-700/50 px-3 py-1.5 text-xs text-fuchsia-100 hover:bg-fuchsia-600/60 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
          >
            {startAB.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FlaskRound className="h-3 w-3" />
            )}
            Start A/B test
          </button>
        </div>
        {startAB.isSuccess && startAB.data && !startAB.data.ok && (
          <p className="mb-2 inline-flex items-center gap-1 text-xs text-rose-400">
            <X className="h-3 w-3" /> {startAB.data.error}
          </p>
        )}

        {abTests.isLoading ? (
          <Loader2 role="status" aria-label="Loading A/B tests" className="h-4 w-4 animate-spin text-fuchsia-500" />
        ) : abTests.isError ? (
          <ErrorRow
            message={(abTests.error as Error)?.message ?? 'Failed to load A/B tests.'}
            onRetry={() => abTests.refetch()}
            retrying={abTests.isFetching}
          />
        ) : (abTests.data?.tests ?? []).length === 0 ? (
          <p className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-4 py-6 text-center text-xs text-fuchsia-600">
            No A/B tests yet — start one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {(abTests.data?.tests ?? []).map((t) => (
              <li
                key={t.id}
                className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 p-3 text-xs"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-fuchsia-800/30 px-1.5 py-0.5 text-[10px] text-fuchsia-300">
                    {t.brain_id}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      t.status === 'concluded'
                        ? 'bg-zinc-800 text-zinc-400'
                        : 'bg-amber-900/40 text-amber-300'
                    }`}
                  >
                    {t.status}
                  </span>
                  <span className="text-fuchsia-700">{t.traffic_pct}% to candidate</span>
                  {t.winner && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      <Trophy className="h-2.5 w-2.5" /> {t.winner} won
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded bg-black/40 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-fuchsia-700">
                      Candidate
                    </div>
                    <div className="font-mono text-fuchsia-200">{t.candidate_model}</div>
                    <div className="text-fuchsia-600">
                      {t.candidate_calls} calls
                      {t.candidate_score != null && ` · score ${t.candidate_score.toFixed(3)}`}
                    </div>
                  </div>
                  <div className="rounded bg-black/40 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-fuchsia-700">
                      Control
                    </div>
                    <div className="font-mono text-fuchsia-200">{t.control_model}</div>
                    <div className="text-fuchsia-600">
                      {t.control_calls} calls
                      {t.control_score != null && ` · score ${t.control_score.toFixed(3)}`}
                    </div>
                  </div>
                </div>
                {t.status !== 'concluded' && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => concludeAB.mutate({ id: t.id, winner: 'candidate' })}
                      disabled={concludeAB.isPending}
                      className="rounded bg-emerald-700/40 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-600/60 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    >
                      Conclude — candidate wins
                    </button>
                    <button
                      onClick={() => concludeAB.mutate({ id: t.id, winner: 'control' })}
                      disabled={concludeAB.isPending}
                      className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                    >
                      Conclude — control wins
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
