'use client';

/**
 * LensSubstratePanel — generic UI for the shared lens records substrate
 * (server/lib/lens-substrate.js). Renders a dashboard strip, an add
 * form, and a managed list with status cycling + delete. Mounted in
 * lenses that were calculator-/aggregation-only to give them a real
 * persistent tracked-records workspace.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SubstrateRecord {
  id: string;
  title: string;
  kind: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
interface Dashboard {
  noun: string;
  total: number;
  open: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  statuses: string[];
  kinds: string[];
}

export function LensSubstratePanel({
  domain,
  noun = 'record',
  title,
}: {
  domain: string;
  noun?: string;
  title?: string;
}) {
  const [records, setRecords] = useState<SubstrateRecord[]>([]);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftKind, setDraftKind] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

  const refresh = useCallback(async () => {
    setBusy(true); setErr('');
    const [list, dashboard] = await Promise.all([
      lensRun(domain, 'record-list', {}),
      lensRun(domain, 'record-dashboard', {}),
    ]);
    if (list.data?.ok) setRecords((list.data.result?.items as SubstrateRecord[]) || []);
    else setErr(list.data?.error || 'Could not load records.');
    if (dashboard.data?.ok) setDash(dashboard.data.result as Dashboard);
    setBusy(false);
  }, [domain]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function add() {
    if (!draftTitle.trim()) return;
    setBusy(true); setErr('');
    const r = await lensRun(domain, 'record-add', {
      title: draftTitle.trim(),
      kind: draftKind.trim() || undefined,
      notes: draftNotes.trim() || undefined,
    });
    if (r.data?.ok) {
      setDraftTitle(''); setDraftKind(''); setDraftNotes('');
      await refresh();
    } else {
      setErr(r.data?.error || 'Could not add.');
      setBusy(false);
    }
  }

  async function cycleStatus(rec: SubstrateRecord) {
    const statuses = dash?.statuses || [];
    if (statuses.length < 2) return;
    const next = statuses[(statuses.indexOf(rec.status) + 1) % statuses.length];
    await lensRun(domain, 'record-update', { id: rec.id, status: next });
    await refresh();
  }

  async function remove(id: string) {
    await lensRun(domain, 'record-delete', { id });
    await refresh();
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-zinc-100">{title || `${noun} tracker`}</h3>
        <button
          onClick={refresh} disabled={busy}
          className="text-zinc-400 hover:text-zinc-100 disabled:opacity-50"
          aria-label="Refresh"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {dash && (
        <div className="flex flex-wrap gap-3 mb-3 text-[11px]">
          <span className="text-zinc-300">Total <b className="text-zinc-100">{dash.total}</b></span>
          <span className="text-emerald-300">Open <b>{dash.open}</b></span>
          {Object.entries(dash.byStatus).map(([k, v]) => (
            <span key={k} className="text-zinc-500">{k} {v}</span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)}
          placeholder={`New ${noun}…`}
          className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
        />
        <input
          value={draftKind} onChange={(e) => setDraftKind(e.target.value)}
          placeholder="kind"
          className="w-24 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
        />
        <input
          value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)}
          placeholder="notes"
          className="flex-1 min-w-[120px] bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
        />
        <button
          onClick={add} disabled={busy || !draftTitle.trim()}
          className="px-3 py-1 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {err && <p className="text-[11px] text-rose-400 mb-2">{err}</p>}

      {records.length === 0 ? (
        <p className="text-[11px] text-zinc-600 italic py-3 text-center">
          No {noun}s tracked yet. Add your first above.
        </p>
      ) : (
        <ul className="space-y-1">
          {records.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5">
              <button
                onClick={() => cycleStatus(r)}
                className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 shrink-0"
                title="Cycle status"
              >
                {r.status}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-100 truncate">{r.title}</p>
                {(r.kind || r.notes) && (
                  <p className="text-[10px] text-zinc-500 truncate">
                    {r.kind ? `${r.kind} · ` : ''}{r.notes}
                  </p>
                )}
              </div>
              <button
                onClick={() => remove(r.id)}
                className="text-zinc-600 hover:text-rose-400 shrink-0"
                aria-label="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
