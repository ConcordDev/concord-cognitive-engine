'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * AuditAndDrift — consent audit log + drift / eval-regression alerting.
 * Backs the two backend additions in routes/lattice.js:
 *   • GET /api/lattice/consent-log   — append-only audit of consent toggles
 *   • GET /api/lattice/drift-alerts  — recent drift-monitor alerts
 *
 * Both panels render only real backend rows.
 */

import { useQuery } from '@tanstack/react-query';
import { TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { Loader2, ScrollText, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';

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

interface ConsentLogRow {
  id: string;
  action: string;
  dtu_id: string | null;
  old_value: number | null;
  new_value: number;
  affected: number;
  created_at: number;
}
interface DriftAlert {
  id?: string;
  type?: string;
  severity?: string;
  message?: string;
  summary?: string;
  timestamp?: number;
  detail?: any;
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

const SEV_TONE: Record<string, TimelineEvent['tone']> = {
  critical: 'bad',
  high: 'bad',
  medium: 'warn',
  low: 'info',
};

export function AuditAndDrift() {
  const consentLog = useQuery({
    queryKey: ['lattice-consent-log'],
    queryFn: () => getJSON<{ ok: boolean; log: ConsentLogRow[] }>('/api/lattice/consent-log?limit=80'),
    refetchInterval: 60_000,
  });

  const drift = useQuery({
    queryKey: ['lattice-drift-alerts'],
    queryFn: () =>
      getJSON<{ ok: boolean; alerts: DriftAlert[]; total: number; available: boolean }>(
        '/api/lattice/drift-alerts?limit=60',
      ),
    refetchInterval: 45_000,
  });

  const driftEvents: TimelineEvent[] = (drift.data?.alerts ?? []).map((a, i) => ({
    id: a.id || `drift_${i}`,
    label: `${a.type || 'drift'} · ${a.severity || 'low'}`,
    time: a.timestamp || Date.now(),
    tone: SEV_TONE[(a.severity || 'low').toLowerCase()] || 'info',
    detail: a.message || a.summary || '',
  }));

  return (
    <div className="space-y-8">
      {/* ── Drift / eval-regression alerting ───────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden />
          <h3 className="text-sm font-semibold text-fuchsia-300">Drift &amp; eval-regression alerts</h3>
          {drift.data && (
            <span className="rounded bg-fuchsia-900/40 px-1.5 py-0.5 text-[10px] text-fuchsia-300">
              {drift.data.total} total
            </span>
          )}
        </div>
        <p className="mb-3 max-w-prose text-xs text-fuchsia-700">
          The drift-monitor watches the corpus for Goodhart effects, memetic drift, capability
          creep, echo chambers and metric divergence. HIGH/CRITICAL findings are auto-routed
          into a constraint-check reasoning pass.
        </p>
        {drift.isLoading ? (
          <Loader2 role="status" aria-label="Loading drift alerts" className="h-4 w-4 animate-spin text-fuchsia-500" />
        ) : drift.isError ? (
          <ErrorRow
            message={(drift.error as Error)?.message ?? 'Failed to load drift alerts.'}
            onRetry={() => drift.refetch()}
            retrying={drift.isFetching}
          />
        ) : !drift.data?.available ? (
          <p className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-4 py-6 text-center text-xs text-fuchsia-600">
            Drift monitor is not active on this instance yet.
          </p>
        ) : driftEvents.length === 0 ? (
          <p className="rounded border border-emerald-900/30 bg-emerald-950/10 px-4 py-6 text-center text-xs text-emerald-500">
            No drift alerts — corpus is stable.
          </p>
        ) : (
          <>
            <TimelineView events={driftEvents} height={120} />
            <ul className="mt-3 space-y-1">
              {(drift.data?.alerts ?? []).map((a, i) => (
                <li
                  key={a.id || i}
                  className="flex flex-wrap items-center gap-2 rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-3 py-2 text-xs"
                >
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      ['critical', 'high'].includes((a.severity || '').toLowerCase())
                        ? 'bg-rose-900/40 text-rose-300'
                        : (a.severity || '').toLowerCase() === 'medium'
                          ? 'bg-amber-900/40 text-amber-300'
                          : 'bg-indigo-900/40 text-indigo-300'
                    }`}
                  >
                    {a.severity || 'low'}
                  </span>
                  <span className="font-mono text-fuchsia-300">{a.type || 'drift'}</span>
                  <span className="text-fuchsia-200">{a.message || a.summary || '—'}</span>
                  {a.timestamp && (
                    <span className="ml-auto text-fuchsia-700">
                      {new Date(a.timestamp).toLocaleString()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── Consent audit log ──────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <ScrollText className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
          <h3 className="text-sm font-semibold text-fuchsia-300">Consent audit log</h3>
        </div>
        <p className="mb-3 max-w-prose text-xs text-fuchsia-700">
          An append-only record of every training-consent change you have made — per-DTU
          toggles and account-wide bulk flips, with the prior value where known.
        </p>
        {consentLog.isLoading ? (
          <Loader2 role="status" aria-label="Loading consent log" className="h-4 w-4 animate-spin text-fuchsia-500" />
        ) : consentLog.isError ? (
          <ErrorRow
            message={(consentLog.error as Error)?.message ?? 'Failed to load consent log.'}
            onRetry={() => consentLog.refetch()}
            retrying={consentLog.isFetching}
          />
        ) : (consentLog.data?.log ?? []).length === 0 ? (
          <p className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-4 py-6 text-center text-xs text-fuchsia-600">
            No consent changes recorded yet — toggles on the Consent tab appear here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-fuchsia-900/40">
            <table className="w-full font-mono text-xs">
              <thead className="bg-fuchsia-950/40 text-fuchsia-400">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-left">Change</th>
                  <th className="px-3 py-2 text-right">Affected</th>
                </tr>
              </thead>
              <tbody>
                {(consentLog.data?.log ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-fuchsia-900/20">
                    <td className="px-3 py-2 text-fuchsia-400">
                      {new Date(r.created_at * 1000).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-fuchsia-800/30 px-1.5 py-0.5 text-[10px] text-fuchsia-300">
                        {r.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-fuchsia-300">
                      {r.dtu_id || 'all my DTUs'}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-fuchsia-700">
                        {r.old_value == null ? '?' : r.old_value ? 'consented' : 'revoked'}
                      </span>
                      <span className="px-1 text-fuchsia-600">→</span>
                      <span
                        className={
                          r.new_value
                            ? 'inline-flex items-center gap-0.5 text-emerald-400'
                            : 'text-rose-400'
                        }
                      >
                        {r.new_value ? (
                          <>
                            <ShieldCheck className="h-2.5 w-2.5" /> consented
                          </>
                        ) : (
                          'revoked'
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-fuchsia-200">{r.affected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
