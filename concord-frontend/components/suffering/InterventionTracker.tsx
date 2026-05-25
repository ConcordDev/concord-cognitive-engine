'use client';

/**
 * InterventionTracker — links an intervention to a pain point and tracks
 * its resolution status over time, with a per-intervention status/progress
 * history. Wires intervention-list, intervention-track, intervention-update,
 * intervention-delete.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Plus, Trash2, Loader2, Wrench, ChevronDown, ChevronRight, History,
} from 'lucide-react';
import type { Pain } from './PainBoard';

interface HistoryEntry { at: string; status: string; progress?: number; note: string }
export interface Intervention {
  id: string;
  title: string;
  description: string;
  painId: string | null;
  status: string;
  owner: string;
  progress: number;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

const STATUSES = ['proposed', 'in_progress', 'completed', 'abandoned'] as const;
const STATUS_TONE: Record<string, string> = {
  proposed: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  in_progress: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  abandoned: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export function InterventionTracker({
  interventions, pains, byStatus, loading, onChanged,
}: {
  interventions: Intervention[];
  pains: Pain[];
  byStatus: Record<string, number>;
  loading: boolean;
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', painId: '', owner: '' });

  const run = useCallback(async (action: string, input: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    const res = await lensRun('suffering', action, input);
    setBusy(false);
    if (!res.data.ok) { setErr(res.data.error || `${action} failed`); return false; }
    onChanged();
    return true;
  }, [onChanged]);

  const submit = useCallback(async () => {
    if (!draft.title.trim()) { setErr('Title required'); return; }
    const ok = await run('intervention-track', {
      title: draft.title, description: draft.description,
      painId: draft.painId || undefined, owner: draft.owner,
    });
    if (ok) { setDraft({ title: '', description: '', painId: '', owner: '' }); setShowForm(false); }
  }, [draft, run]);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-neon-blue" /> Intervention Tracking
          <span className="text-xs text-gray-400">({interventions.length})</span>
          {(loading || busy) && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
        </h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-blue/20 text-neon-blue rounded-lg text-sm hover:bg-neon-blue/30"
        >
          <Plus className="w-4 h-4" /> New Intervention
        </button>
      </div>

      <div className="flex gap-2 mb-3 text-[11px]">
        {STATUSES.map((s) => (
          <span key={s} className={`px-2 py-0.5 rounded border ${STATUS_TONE[s]}`}>
            {s.replace('_', ' ')}: {byStatus[s] || 0}
          </span>
        ))}
      </div>

      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}

      {showForm && (
        <div className="mb-4 p-3 rounded-lg bg-white/[0.03] border border-white/10 space-y-2">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Intervention title"
            className="w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-sm"
          />
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="What will be done"
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-sm"
          />
          <div className="flex items-center gap-2">
            <select
              value={draft.painId}
              onChange={(e) => setDraft({ ...draft, painId: e.target.value })}
              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-200"
            >
              <option value="">Link to pain point…</option>
              {pains.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <input
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              placeholder="Owner"
              className="w-32 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm"
            />
            <button onClick={submit} disabled={busy} className="px-3 py-1.5 bg-neon-blue/20 text-neon-blue rounded text-sm hover:bg-neon-blue/30 disabled:opacity-50">
              Track
            </button>
          </div>
        </div>
      )}

      {interventions.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-4">No interventions tracked yet.</p>
      ) : (
        <div className="space-y-2">
          {interventions.map((iv) => {
            const pain = pains.find((p) => p.id === iv.painId);
            const open = expanded === iv.id;
            return (
              <div key={iv.id} className="rounded-lg bg-white/[0.03] border border-white/10">
                <div className="flex items-center gap-2 p-2.5">
                  <button onClick={() => setExpanded(open ? null : iv.id)} className="text-gray-400 hover:text-gray-200" aria-label="Expand">
                    {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{iv.title}</span>
                      {pain && <span className="text-[10px] text-gray-400">→ {pain.title}</span>}
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-neon-blue" style={{ width: `${iv.progress}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{iv.progress}%</span>
                  <select
                    value={iv.status}
                    onChange={(e) => run('intervention-update', {
                      id: iv.id, status: e.target.value,
                      resolvePain: e.target.value === 'completed' && !!iv.painId,
                    })}
                    className={`text-[11px] rounded border px-1.5 py-1 ${STATUS_TONE[iv.status]}`}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                  <button onClick={() => run('intervention-delete', { id: iv.id })} className="text-gray-600 hover:text-red-400" aria-label="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {open && (
                  <div className="border-t border-white/10 p-3 space-y-3">
                    {iv.description && <p className="text-xs text-gray-400">{iv.description}</p>}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">Progress</span>
                      <input
                        type="range" min={0} max={100} value={iv.progress}
                        onChange={(e) => run('intervention-update', { id: iv.id, progress: Number(e.target.value) })}
                        className="flex-1 accent-neon-blue"
                      />
                      <span className="text-xs text-neon-blue font-bold w-10 text-right">{iv.progress}%</span>
                    </div>
                    {iv.owner && <p className="text-xs text-gray-400">Owner: {iv.owner}</p>}
                    <div>
                      <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                        <History className="w-3 h-3" /> Resolution history
                      </p>
                      <ul className="space-y-1">
                        {iv.history.map((h, i) => (
                          <li key={i} className="text-[11px] text-gray-400 flex gap-2">
                            <span className="text-gray-600">{new Date(h.at).toLocaleString()}</span>
                            <span className="text-gray-300">{h.note}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
