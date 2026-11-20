'use client';

/**
 * FsDistributionPanel — festival / distribution submission tracker.
 * Tracks each submission's status, deadline and fee, and rolls up
 * selected / pending counts and total entry-fee spend. Backed by the
 * festival-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Trophy, Calendar } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Submission {
  id: string; festival: string; category: string | null; status: string;
  submittedDate: string | null; deadline: string | null; fee: number;
  platform: string | null; notes: string | null;
}
interface FestivalList {
  submissions: Submission[]; count: number; byStatus: Record<string, number>;
  totalFees: number; selected: number; pending: number;
}

const STATUSES = [
  'researching', 'submitted', 'in_consideration', 'selected',
  'rejected', 'screened', 'awarded', 'withdrawn',
];
const STATUS_COLOR: Record<string, string> = {
  researching: 'bg-[var(--fo-rule,#3f3f46)] text-[var(--fo-ink,#e4e4e7)]',
  submitted: 'bg-sky-700 text-sky-100',
  in_consideration: 'bg-amber-700 text-amber-100',
  selected: 'bg-emerald-700 text-emerald-100',
  rejected: 'bg-rose-800 text-rose-100',
  screened: 'bg-violet-700 text-violet-100',
  awarded: 'bg-yellow-600 text-yellow-50',
  withdrawn: 'bg-[var(--fo-paper-2,#27272a)] text-[var(--fo-muted,#a1a1aa)]',
};

export function FsDistributionPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<FestivalList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ festival: '', category: '', platform: '', deadline: '', fee: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('film-studios', 'festival-list', { projectId });
    setData((r.data?.result as FestivalList | null) || null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addSubmission = async () => {
    if (!form.festival.trim()) { setError('Festival name is required.'); return; }
    const r = await lensRun('film-studios', 'festival-submit', {
      projectId, festival: form.festival.trim(),
      category: form.category.trim() || undefined,
      platform: form.platform.trim() || undefined,
      deadline: form.deadline || undefined,
      fee: Number(form.fee) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ festival: '', category: '', platform: '', deadline: '', fee: '' });
    setError(null);
    await refresh();
  };

  const updateStatus = async (id: string, status: string) => {
    const params: Record<string, unknown> = { id, status };
    if (status === 'submitted') params.submittedDate = new Date().toISOString().slice(0, 10);
    await lensRun('film-studios', 'festival-update', params);
    await refresh();
  };

  const delSubmission = async (id: string) => {
    await lensRun('film-studios', 'festival-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-[var(--fo-muted,#a1a1aa)]"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-[var(--fo-bad,#fb7185)] bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Roll-up */}
      {data && data.count > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Stat label="Submissions" value={data.count} />
          <Stat label="Selected" value={data.selected} accent="text-[var(--fo-good,#34d399)]" />
          <Stat label="Pending" value={data.pending} accent="text-amber-400" />
          <Stat label="Entry fees" value={`$${data.totalFees.toLocaleString()}`} />
        </div>
      )}

      {/* New submission */}
      <section className="bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input placeholder="Festival / platform name" value={form.festival}
            onChange={(e) => setForm({ ...form, festival: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <input placeholder="Category (e.g. Short Film)" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <input placeholder="Submission platform" value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <input placeholder="Entry fee ($)" inputMode="decimal" value={form.fee}
            onChange={(e) => setForm({ ...form, fee: e.target.value })}
            className="w-28 bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
          <button type="button" onClick={addSubmission}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[var(--fo-tape,#c026d3)] hover:bg-[#b72d23] text-white rounded-lg ml-auto">
            <Plus className="w-3.5 h-3.5" /> Track submission
          </button>
        </div>
      </section>

      {/* Submission list */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
          <Trophy className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Festival submissions
        </h3>
        {!data || data.count === 0 ? (
          <p className="text-[11px] text-[var(--fo-muted,#a1a1aa)] italic py-6 text-center">No submissions tracked. Add a festival above to start your distribution plan.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.submissions.map((s) => (
              <li key={s.id} className="bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--fo-ink,#f4f4f5)] truncate">{s.festival}</span>
                  {s.category && <span className="text-[10px] text-[var(--fo-muted,#a1a1aa)]">{s.category}</span>}
                  <select value={s.status} onChange={(e) => updateStatus(s.id, e.target.value)}
                    className={cn('text-[10px] rounded px-1.5 py-0.5 border-0 font-medium ml-auto', STATUS_COLOR[s.status] || 'bg-[var(--fo-rule,#3f3f46)] text-[var(--fo-ink-2,#d4d4d8)]')}>
                    {STATUSES.map((st) => <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>)}
                  </select>
                  <button aria-label="Delete" type="button" onClick={() => delSubmission(s.id)} className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)]">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] text-[var(--fo-muted,#a1a1aa)]">
                  {s.deadline && (
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> deadline {s.deadline}</span>
                  )}
                  {s.submittedDate && <span>submitted {s.submittedDate}</span>}
                  {s.fee > 0 && <span className="text-[var(--fo-muted,#a1a1aa)]">fee ${s.fee.toLocaleString()}</span>}
                  {s.platform && <span>via {s.platform}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-lg p-2 text-center">
      <p className={cn('text-base font-bold', accent || 'text-[var(--fo-ink,#f4f4f5)]')}>{value}</p>
      <p className="text-[10px] text-[var(--fo-muted,#a1a1aa)] uppercase tracking-wide">{label}</p>
    </div>
  );
}
