'use client';

/**
 * IncidentReportPanel — persisted crisis incident / after-action reports.
 *
 * Unlike the in-memory timeline (which lives in the crisis-domain stores and
 * resets across restarts), incident reports are durable artifacts persisted
 * through the real lens artifact CRUD (`useLensData('crisis-ops',
 * 'incident_report')` → /api/lens/crisis-ops/*). They are the operator's
 * permanent record: situation summaries, after-action reviews, lessons learned.
 *
 * No mock/seed data — an empty backend renders the empty state and the first
 * report the operator files is the first real artifact.
 */

import { useState, useCallback } from 'react';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';

interface ReportData {
  crisisId?: string;
  severity?: string;
  body?: string;
}

const SEVERITIES = ['info', 'minor', 'major', 'critical'];

export function IncidentReportPanel({ crisisId }: { crisisId?: string }) {
  const { items, isLoading, isError, create, remove } = useLensData<ReportData>(
    'crisis-ops',
    'incident_report',
    { noSeed: true, limit: 50 },
  );

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('minor');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setTitle(''); setSeverity('minor'); setBody(''); setOpen(false);
  }, []);

  const submit = useCallback(async () => {
    if (!title.trim() || !body.trim() || saving) return;
    setSaving(true);
    try {
      await create({
        title: title.trim().slice(0, 120),
        data: { crisisId, severity, body: body.trim().slice(0, 4000) },
        meta: { status: severity, tags: ['incident_report', ...(crisisId ? [`crisis:${crisisId}`] : [])] },
      });
      reset();
    } finally {
      setSaving(false);
    }
  }, [title, body, severity, crisisId, create, reset, saving]);

  // Scope to the selected crisis when one is active; otherwise show all.
  const visible = crisisId
    ? items.filter((r) => r.data?.crisisId === crisisId)
    : items;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <ClipboardList className="h-4 w-4 text-amber-300" /> Incident reports
        </h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="File a new incident report"
          className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-600/20 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-600/40"
        >
          <Plus className="h-3 w-3" /> File report
        </button>
      </div>

      {open && (
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="mb-3 space-y-2 rounded-lg border border-amber-700/30 bg-amber-900/10 p-3"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Report title (e.g. Sitrep — hour 3)"
            aria-label="Report title"
            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
          />
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            aria-label="Severity"
            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
          >
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What happened, what was done, what's next…"
            aria-label="Report body"
            rows={3}
            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!title.trim() || !body.trim() || saving}
              className="rounded border border-amber-500/40 bg-amber-600/30 px-3 py-1 text-[11px] text-amber-100 disabled:opacity-40 hover:bg-amber-600/50"
            >
              {saving ? 'Saving…' : 'Save report'}
            </button>
            <button type="button" onClick={reset} className="rounded border border-white/10 px-3 py-1 text-[11px] text-gray-300 hover:bg-white/5">
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="text-xs text-gray-400">Loading reports…</p>}
      {isError && !isLoading && (
        <p className="rounded border border-rose-700/30 bg-rose-900/10 p-3 text-center text-xs text-rose-300">
          Could not load incident reports. Retry from the refresh control.
        </p>
      )}
      {!isLoading && !isError && visible.length === 0 && (
        <p className="rounded border border-white/10 bg-white/5 p-3 text-center text-xs text-gray-400">
          No incident reports filed{crisisId ? ' for this crisis' : ''} yet. File the first sitrep above.
        </p>
      )}
      {!isLoading && !isError && visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-amber-200">{r.title}</span>
                  <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">
                    {r.data?.severity || r.meta?.status || 'minor'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  aria-label={`Delete report ${r.title}`}
                  className="text-gray-500 hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {r.data?.body && <p className="mt-1 text-[11px] text-gray-300">{r.data.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
