'use client';

/**
 * DriftTimeline — a chronological, severity-filterable feed of the
 * lattice drift-monitor's alerts. Each alert is a real finding from
 * `runDriftScan` over the actual DTU corpus, surfaced via the
 * `cognition.driftAlerts` macro. No synthetic alerts.
 */

import { useMemo, useState } from 'react';
import { TimelineView, type TimelineEvent } from '@/components/viz/TimelineView';

export interface DriftAlert {
  alertId: string;
  type: string;
  severity: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface DriftFeed {
  alerts?: DriftAlert[];
  total?: number;
  bySeverity?: Record<string, number>;
  severities?: string[];
  metrics?: { snapshotCount?: number; alertCount?: number } | null;
}

const SEV_TONE: Record<string, TimelineEvent['tone']> = {
  info: 'info',
  warning: 'warn',
  alert: 'warn',
  critical: 'bad',
};

const SEV_BADGE: Record<string, string> = {
  info: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/40',
  warning: 'bg-amber-900/40 text-amber-300 border-amber-700/40',
  alert: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  critical: 'bg-rose-900/40 text-rose-300 border-rose-700/40',
};

export function DriftTimeline({
  feed,
  severityFilter,
  onSeverityChange,
}: {
  feed: DriftFeed | null;
  severityFilter: string;
  onSeverityChange: (sev: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const alerts = useMemo(
    () => (Array.isArray(feed?.alerts) ? feed!.alerts : []),
    [feed],
  );
  const severities = feed?.severities ?? ['info', 'warning', 'alert', 'critical'];

  const events: TimelineEvent[] = useMemo(
    () =>
      alerts.map((a) => ({
        id: a.alertId,
        label: a.type.replace(/_/g, ' '),
        time: a.timestamp,
        tone: SEV_TONE[a.severity] || 'default',
        detail: a.message,
      })),
    [alerts],
  );

  const selected = alerts.find((a) => a.alertId === selectedId) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-violet-700">Severity:</span>
        <button
          onClick={() => onSeverityChange('')}
          className={`rounded px-2 py-1 text-xs ${
            severityFilter === ''
              ? 'bg-violet-700/40 text-violet-100'
              : 'bg-violet-950/30 text-violet-500 hover:text-violet-300'
          }`}
          aria-pressed={severityFilter === ''}
        >
          All
        </button>
        {severities.map((sev) => {
          const count = feed?.bySeverity?.[sev] ?? 0;
          return (
            <button
              key={sev}
              onClick={() => onSeverityChange(sev)}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-xs capitalize ${
                severityFilter === sev
                  ? SEV_BADGE[sev] || 'bg-violet-700/40 text-violet-100'
                  : 'border-transparent bg-violet-950/30 text-violet-500 hover:text-violet-300'
              }`}
              aria-pressed={severityFilter === sev}
            >
              {sev}
              <span className="rounded bg-black/40 px-1 text-[10px]">{count}</span>
            </button>
          );
        })}
      </div>

      {alerts.length === 0 ? (
        <p className="text-sm text-emerald-400">
          ✓ No drift alerts{severityFilter ? ` at "${severityFilter}" severity` : ''}.
          The lattice is coherent.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-3">
            <TimelineView events={events} onSelect={(e) => setSelectedId(e.id)} />
          </div>
          <ul className="space-y-1">
            {alerts.map((a) => (
              <li key={a.alertId}>
                <button
                  onClick={() =>
                    setSelectedId(selectedId === a.alertId ? null : a.alertId)
                  }
                  className="flex w-full items-center gap-2 rounded border border-violet-900/30 bg-violet-950/10 px-3 py-2 text-left text-xs hover:bg-violet-900/20"
                  aria-expanded={selectedId === a.alertId}
                >
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] capitalize ${
                      SEV_BADGE[a.severity] || 'border-violet-700/40 text-violet-300'
                    }`}
                  >
                    {a.severity}
                  </span>
                  <span className="font-mono text-violet-300">
                    {a.type.replace(/_/g, ' ')}
                  </span>
                  <span className="ml-auto text-[10px] text-violet-700">
                    {new Date(a.timestamp).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {selected && (
        <div className="rounded-lg border border-violet-700/40 bg-violet-900/20 p-3 text-xs">
          <div className="mb-1 flex items-center gap-2">
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] capitalize ${
                SEV_BADGE[selected.severity] || ''
              }`}
            >
              {selected.severity}
            </span>
            <span className="font-mono text-violet-200">
              {selected.type.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-violet-100">{selected.message}</p>
          {selected.data && Object.keys(selected.data).length > 0 && (
            <pre className="mt-2 max-h-40 overflow-auto rounded border border-violet-900/40 bg-black/60 p-2 font-mono text-[10px] text-violet-400">
              {JSON.stringify(selected.data, null, 2)}
            </pre>
          )}
        </div>
      )}

      {feed?.metrics && (
        <p className="text-[10px] text-violet-700">
          {feed.metrics.snapshotCount ?? 0} snapshots ·{' '}
          {feed.metrics.alertCount ?? feed.total ?? 0} total alerts on record
        </p>
      )}
    </div>
  );
}
