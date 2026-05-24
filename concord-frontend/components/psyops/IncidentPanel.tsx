'use client';

import { useState } from 'react';
import { GitMerge, FolderOpen, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import type { PsyopsIncident } from './types';

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-rose-600 text-white',
  high: 'bg-amber-600 text-white',
  medium: 'bg-zinc-700 text-zinc-200',
};

/**
 * IncidentPanel — group selected alerts into a correlated incident and
 * render its timeline. Closing an incident records an audited resolution.
 */
export function IncidentPanel({
  incidents,
  selectedIds,
  onChange,
  onClearSelection,
}: {
  incidents: PsyopsIncident[];
  selectedIds: string[];
  onChange: () => void;
  onClearSelection: () => void;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const create = async () => {
    setErr(null);
    if (!title.trim()) {
      setErr('Incident title is required.');
      return;
    }
    if (selectedIds.length === 0) {
      setErr('Select at least one alert on the board to correlate.');
      return;
    }
    setBusy(true);
    const r = await lensRun('psyops', 'incident_create', {
      title: title.trim(),
      summary: summary.trim(),
      alertIds: selectedIds,
    });
    setBusy(false);
    if (r.data?.ok) {
      setTitle('');
      setSummary('');
      onClearSelection();
      onChange();
    } else {
      setErr(r.data?.error || 'Could not create incident.');
    }
  };

  const close = async (incidentId: string) => {
    setBusy(true);
    const r = await lensRun('psyops', 'incident_close', {
      incidentId,
      resolution: (resolutions[incidentId] || '').trim(),
    });
    setBusy(false);
    if (r.data?.ok) onChange();
  };

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <GitMerge className="h-4 w-4 text-rose-400" /> Incident correlation
      </h2>
      <p className="text-[11px] text-zinc-400">
        Tick related alerts on the board, then group them into one tracked incident.
        Each incident plots its member alerts on a chronological timeline.
      </p>

      <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="incident title"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
        />
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="summary (optional)"
          rows={2}
          className="w-full resize-none rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-zinc-400">
            {selectedIds.length} alert{selectedIds.length === 1 ? '' : 's'} selected
          </span>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
            Correlate into incident
          </button>
        </div>
        {err && <p className="text-[11px] text-rose-300">{err}</p>}
      </div>

      {incidents.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 py-5 text-center text-xs italic text-zinc-400">
          No incidents yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {incidents.map((inc) => {
            const events: TimelineEvent[] = (inc.timeline || []).map((t) => ({
              id: t.id,
              label: t.label,
              time: t.time,
              tone: t.tone,
              detail: t.detail,
            }));
            return (
              <li key={inc.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${SEVERITY_BADGE[inc.severity]}`}>{inc.severity}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${inc.status === 'closed' ? 'bg-emerald-900/60 text-emerald-200' : 'bg-amber-900/60 text-amber-200'}`}>{inc.status}</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">{inc.alertCount ?? inc.alertIds.length} alerts</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{inc.title}</p>
                    {inc.summary && <p className="text-[11px] text-zinc-400">{inc.summary}</p>}
                  </div>
                  <FolderOpen className="h-4 w-4 shrink-0 text-zinc-600" />
                </div>

                {events.length > 0 && (
                  <div className="mt-2">
                    <TimelineView events={events} height={110} />
                  </div>
                )}

                {inc.status === 'closed' ? (
                  inc.resolution && (
                    <p className="mt-2 rounded border border-emerald-800/50 bg-emerald-950/30 px-2 py-1 text-[10px] text-emerald-200">
                      Resolution: {inc.resolution}
                    </p>
                  )
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={resolutions[inc.id] || ''}
                      onChange={(e) => setResolutions((p) => ({ ...p, [inc.id]: e.target.value }))}
                      placeholder="resolution note"
                      className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 focus:border-rose-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void close(inc.id)}
                      className="rounded bg-emerald-800 px-2 py-1 text-[10px] text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Close incident
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
