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
 *
 * Scoping (FIX-crisis-ops-002): a report filed from the all-reports view —
 * or before a crisis was selected — carries no crisisId. The triage board
 * lists every report the operator filed, so a per-crisis list that silently
 * dropped the unscoped ones read as "no reports filed" while triage showed
 * the report. The per-crisis view now keeps this crisis's reports first and
 * shows the unscoped ones in their own labelled group, with an attach action
 * that files one against this crisis (the full record is re-sent, so no
 * field is lost). Ids compare as strings, matching the server's own
 * world_crises lookup.
 */

import { useState, useCallback } from 'react';
import { ClipboardList, Plus, Trash2, MapPin, Link2 } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';

interface ReportData {
  crisisId?: string;
  severity?: string;
  body?: string;
  location?: string;
}

const SEVERITIES = ['info', 'minor', 'major', 'critical'];

export function IncidentReportPanel({ crisisId }: { crisisId?: string }) {
  const { items, isLoading, isError, create, update, remove } = useLensData<ReportData>(
    'crisis-ops',
    'incident_report',
    { noSeed: true, limit: 50 },
  );

  const [open, setOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('minor');
  const [location, setLocation] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setTitle(''); setSeverity('minor'); setLocation(''); setBody(''); setOpen(false);
  }, []);

  const submit = useCallback(async () => {
    if (!title.trim() || !body.trim() || saving) return;
    setSaving(true);
    try {
      await create({
        title: title.trim().slice(0, 120),
        data: {
          crisisId, severity, body: body.trim().slice(0, 4000),
          ...(location.trim() ? { location: location.trim().slice(0, 120) } : {}),
        },
        meta: { status: severity, tags: ['incident_report', ...(crisisId ? [`crisis:${crisisId}`] : [])] },
      });
      reset();
    } finally {
      setSaving(false);
    }
  }, [title, body, severity, location, crisisId, create, reset, saving]);

  // Scope to the selected crisis when one is active; otherwise show all.
  // Ids compare as strings (the server compares world_crises ids the same
  // way), and reports carrying no crisisId are NOT this crisis's — they are
  // the unscoped group below, never silently dropped.
  const visible = crisisId
    ? items.filter((r) => r.data?.crisisId != null && String(r.data.crisisId) === String(crisisId))
    : items;
  const unscoped = crisisId
    ? items.filter((r) => r.data?.crisisId == null)
    : [];

  const attach = useCallback(async (r: (typeof items)[number]) => {
    if (!crisisId) return;
    const tags = Array.isArray(r.meta?.tags) ? [...(r.meta.tags as string[])] : ['incident_report'];
    if (!tags.includes(`crisis:${crisisId}`)) tags.push(`crisis:${crisisId}`);
    await update(r.id, {
      data: { ...(r.data || {}), crisisId },
      meta: { ...(r.meta || {}), tags },
    });
  }, [crisisId, update]);

  const renderReport = (r: (typeof items)[number], showAttach: boolean) => (
    <li key={r.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs font-semibold text-amber-200">{r.title}</span>
          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">
            {r.data?.severity || r.meta?.status || 'minor'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showAttach && (
            <button
              type="button"
              onClick={() => { void attach(r); }}
              aria-label={`Attach report ${r.title} to this crisis`}
              className="flex items-center gap-1 px-1 text-[11px] font-medium text-amber-200 hover:text-amber-100"
            >
              <Link2 className="h-3 w-3" /> Attach to this crisis
            </button>
          )}
          {confirmDeleteId === r.id ? (
            <button
              type="button"
              onClick={() => { setConfirmDeleteId(null); void remove(r.id); }}
              aria-label={`Confirm delete report ${r.title}`}
              className="px-1 text-[11px] font-medium text-rose-300 hover:text-rose-200"
            >
              Confirm
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDeleteId(r.id)}
              aria-label={`Delete report ${r.title}`}
              className="text-gray-500 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {r.data?.body && <p className="mt-1 text-[11px] text-gray-300">{r.data.body}</p>}
      {r.data?.location && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
          <MapPin className="h-3 w-3" />{r.data.location}
        </p>
      )}
    </li>
  );

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
            maxLength={120}
            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
          />
          {title.length > 90 && <span className="text-[10px] text-zinc-500">{title.length}/120</span>}
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            aria-label="Severity"
            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
          >
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (where — e.g. North gate, Pier 9)"
            aria-label="Location"
            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
          />
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
      {!isLoading && !isError && visible.length === 0 && unscoped.length === 0 && (
        <p className="rounded border border-white/10 bg-white/5 p-3 text-center text-xs text-gray-400">
          No incident reports filed{crisisId ? ' for this crisis' : ''} yet. File the first sitrep above.
        </p>
      )}
      {!isLoading && !isError && visible.length === 0 && unscoped.length > 0 && (
        <p className="rounded border border-white/10 bg-white/5 p-3 text-center text-xs text-gray-400">
          No incident reports filed for this crisis yet — {unscoped.length} report{unscoped.length === 1 ? '' : 's'} filed without a crisis {unscoped.length === 1 ? 'is' : 'are'} listed below.
        </p>
      )}
      {!isLoading && !isError && visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((r) => renderReport(r, false))}
        </ul>
      )}
      {!isLoading && !isError && crisisId && unscoped.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] text-gray-400">
            Filed without a crisis ({unscoped.length}) — filed before a crisis was selected, or from the
            all-reports view. The triage board lists them; attach one to file it under this crisis.
          </p>
          <ul className="space-y-2">
            {unscoped.map((r) => renderReport(r, true))}
          </ul>
        </div>
      )}
    </div>
  );
}
