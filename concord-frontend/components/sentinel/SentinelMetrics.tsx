'use client';


/**
 * SentinelMetrics — visualizes the threat-console metrics: a time-bucketed
 * cases/alerts chart, a severity-mix bar, and the append-only threat
 * timeline. Wires sentinel.metrics.series + sentinel.timeline.list.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { BarChart3, Loader2, History } from 'lucide-react';

interface ChartRow { day: string; opened: number; resolved: number; alerts: number }
interface SeverityRow { severity: string; count: number }
interface TimelineRow {
  id: string;
  at: string;
  kind: string;
  label: string;
  tone?: string;
  detail?: string;
}

const RANGE_OPTIONS = [7, 14, 30] as const;

export function SentinelMetrics({ refreshKey }: { refreshKey: number }) {
  const [days, setDays] = useState<(typeof RANGE_OPTIONS)[number]>(14);
  const [chart, setChart] = useState<ChartRow[]>([]);
  const [severity, setSeverity] = useState<SeverityRow[]>([]);
  const [openCases, setOpenCases] = useState(0);
  const [events, setEvents] = useState<TimelineRow[]>([]);
  const [kindFilter, setKindFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const tlInput: Record<string, unknown> = { limit: 120 };
    if (kindFilter !== 'all') tlInput.kind = kindFilter;
    const [mRes, tRes] = await Promise.all([
      lensRun('sentinel', 'metrics.series', { days }),
      lensRun('sentinel', 'timeline.list', tlInput),
    ]);
    const mr = mRes.data?.result as
      { chart?: ChartRow[]; severityBreakdown?: SeverityRow[]; openCases?: number } | null;
    const tr = tRes.data?.result as { events?: TimelineRow[] } | null;
    setChart(mr?.chart ?? []);
    setSeverity(mr?.severityBreakdown ?? []);
    setOpenCases(mr?.openCases ?? 0);
    setEvents(tr?.events ?? []);
    setLoading(false);
  }, [days, kindFilter]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const totalOpened = chart.reduce((s, r) => s + r.opened, 0);
  const totalResolved = chart.reduce((s, r) => s + r.resolved, 0);
  const totalAlerts = chart.reduce((s, r) => s + r.alerts, 0);

  const timelineEvents: TimelineEvent[] = events.map((e) => ({
    id: e.id,
    label: e.label,
    time: e.at,
    tone: (e.tone as TimelineEvent['tone']) ?? 'default',
    detail: e.detail ?? e.kind,
  }));

  const kinds = ['all', ...Array.from(new Set(events.map((e) => e.kind)))];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-blue-200">
          <BarChart3 className="h-4 w-4" /> Threat metrics
        </h3>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded px-2 py-1 text-xs ${
                days === d ? 'bg-blue-700/50 text-blue-100' : 'bg-blue-950/30 text-blue-500 hover:text-blue-300'
              }`}
              aria-pressed={days === d}
            >
              {d}d
            </button>
          ))}
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open cases" value={openCases} tone="rose" />
        <Stat label="Opened" value={totalOpened} tone="amber" />
        <Stat label="Resolved" value={totalResolved} tone="emerald" />
        <Stat label="Alerts" value={totalAlerts} tone="sky" />
      </div>

      <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-blue-700">
          Cases &amp; alerts — last {days} days
        </p>
        <ChartKit
          kind="area"
          data={chart as unknown as Array<Record<string, unknown>>}
          xKey="day"
          height={220}
          series={[
            { key: 'opened', label: 'Opened', color: '#f59e0b' },
            { key: 'resolved', label: 'Resolved', color: '#22c55e' },
            { key: 'alerts', label: 'Alerts', color: '#06b6d4' },
          ]}
        />
      </div>

      <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-blue-700">Case severity mix</p>
        <ChartKit
          kind="bar"
          data={severity as unknown as Array<Record<string, unknown>>}
          xKey="severity"
          height={180}
          showLegend={false}
          series={[{ key: 'count', label: 'Cases', color: '#ef4444' }]}
        />
      </div>

      <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-blue-700">
            <History className="h-3.5 w-3.5" /> Threat timeline
          </p>
          <div className="ml-auto flex flex-wrap gap-1">
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  kindFilter === k ? 'bg-blue-700/50 text-blue-100' : 'bg-blue-950/40 text-blue-600 hover:text-blue-300'
                }`}
                aria-pressed={kindFilter === k}
              >
                {k.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
        {timelineEvents.length === 0 ? (
          <p className="py-8 text-center text-xs text-blue-700">
            No timeline events yet. Triage actions and alerts are recorded here.
          </p>
        ) : (
          <>
            <TimelineView events={timelineEvents} height={130} />
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-2 rounded border border-blue-900/20 bg-black/20 px-2 py-1 text-[11px]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[e.tone ?? 'default']}`} aria-hidden />
                  <span className="text-blue-200">{e.label}</span>
                  <span className="ml-auto shrink-0 text-[9px] text-blue-700">
                    {new Date(e.at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

const TONE_DOT: Record<string, string> = {
  default: 'bg-zinc-500',
  good: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-rose-400',
  info: 'bg-sky-400',
};

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    rose: 'text-rose-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
    sky: 'text-sky-300',
  };
  return (
    <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-blue-700">{label}</div>
      <div className={`font-mono text-2xl font-semibold ${tones[tone]}`}>{value}</div>
    </div>
  );
}
