'use client';

/**
 * RxAdherencePanel — refill auto-reorder, clinical-grade interaction
 * grading (RxNav ONCHigh / DrugBank) and adherence gamification
 * (calendar heatmap + streak badges). All computed from real dose
 * logs and live public APIs.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, RefreshCw, ShieldAlert, Flame, Award, Trophy, Star, CheckCircle2, CalendarDays } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Medication { id: string; name: string }
interface AutoReorderConfig { medId: string; medName: string; thresholdDays: number; pharmacy: string | null; enabled: boolean }
interface GradedInteraction { drug1: string; drug2: string; severity: string; description: string; source: string }
interface GradeResult { interactions: GradedInteraction[]; graded: number; highestSeverity?: string; sources?: string[]; note?: string; disclaimer?: string }
interface CalendarCell { date: string; scheduled: number; taken: number; pct: number | null; status: string }
interface CalendarResult { days: number; cells: CalendarCell[]; perfectDays: number; overallPct: number | null }
interface Badge { id: string; label: string; icon: string }
interface StreakResult { currentStreak: number; bestStreak: number; totalDosesTaken: number; badges: Badge[]; nextMilestone: number | null }

const BADGE_ICONS: Record<string, typeof Flame> = {
  flame: Flame, award: Award, trophy: Trophy, star: Star, check: CheckCircle2,
};
const CELL_COLOR: Record<string, string> = {
  perfect: 'bg-emerald-500', partial: 'bg-amber-500', missed: 'bg-rose-600', none: 'bg-zinc-800',
};

export function RxAdherencePanel() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [configs, setConfigs] = useState<AutoReorderConfig[]>([]);
  const [calendar, setCalendar] = useState<CalendarResult | null>(null);
  const [streak, setStreak] = useState<StreakResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reorderForm, setReorderForm] = useState({ medId: '', thresholdDays: '7', pharmacy: '' });
  const [reorderMsg, setReorderMsg] = useState<string | null>(null);
  const [gradeDrugs, setGradeDrugs] = useState('');
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [gradeLoading, setGradeLoading] = useState(false);

  const refresh = useCallback(async () => {
    const [m, c, cal, st] = await Promise.all([
      lensRun('pharmacy', 'med-list', {}),
      lensRun('pharmacy', 'autoreorder-list', {}),
      lensRun('pharmacy', 'adherence-calendar', { days: 56 }),
      lensRun('pharmacy', 'adherence-streak', {}),
    ]);
    setMeds(m.data?.result?.medications || []);
    setConfigs(c.data?.result?.configs || []);
    setCalendar((cal.data?.result as CalendarResult) || null);
    setStreak((st.data?.result as StreakResult) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addReorder = async () => {
    if (!reorderForm.medId) { setError('Choose a medication.'); return; }
    const r = await lensRun('pharmacy', 'autoreorder-set', {
      medId: reorderForm.medId, thresholdDays: Number(reorderForm.thresholdDays) || 7,
      pharmacy: reorderForm.pharmacy.trim() || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setReorderForm({ medId: '', thresholdDays: '7', pharmacy: '' });
    setError(null);
    await refresh();
  };
  const removeReorder = async (medId: string) => {
    await lensRun('pharmacy', 'autoreorder-remove', { medId });
    await refresh();
  };
  const runReorder = async () => {
    const r = await lensRun('pharmacy', 'autoreorder-run', {});
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    const count = r.data?.result?.count ?? 0;
    setReorderMsg(count > 0 ? `Filed ${count} refill request${count === 1 ? '' : 's'}.` : 'No medications below their reorder threshold.');
    await refresh();
  };

  const gradeInteractions = async () => {
    const names = gradeDrugs.split(',').map((d) => d.trim()).filter(Boolean);
    if (names.length < 2) { setError('Enter at least two drug names, comma-separated.'); return; }
    setGradeLoading(true); setError(null); setGradeResult(null);
    const r = await lensRun('pharmacy', 'interaction-grade', { medications: names });
    if (r.data?.ok === false) { setError(r.data?.error || 'Interaction grading failed'); }
    else { setGradeResult(r.data?.result as GradeResult); }
    setGradeLoading(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Streak gamification */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Flame className="w-3.5 h-3.5 text-amber-400" /> Adherence streak
        </h3>
        {streak && (
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Stat label="Current streak" value={`${streak.currentStreak}d`} highlight={streak.currentStreak >= 3} />
            <Stat label="Best streak" value={`${streak.bestStreak}d`} />
            <Stat label="Doses logged" value={streak.totalDosesTaken} />
          </div>
        )}
        {streak && streak.badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {streak.badges.map((b) => {
              const Icon = BADGE_ICONS[b.icon] || Star;
              return (
                <span key={b.id} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-amber-950/50 border border-amber-800/50 text-amber-300">
                  <Icon className="w-3 h-3" /> {b.label}
                </span>
              );
            })}
          </div>
        )}
        {streak?.nextMilestone != null && (
          <p className="text-[11px] text-zinc-500">
            {streak.nextMilestone - streak.currentStreak} day{streak.nextMilestone - streak.currentStreak === 1 ? '' : 's'} to your next badge.
          </p>
        )}
      </section>

      {/* Calendar heatmap */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <CalendarDays className="w-3.5 h-3.5 text-amber-400" /> Adherence calendar
          {calendar?.overallPct != null && <span className="text-[10px] text-zinc-500">· {calendar.overallPct}% over {calendar.days} days</span>}
        </h3>
        {calendar && calendar.cells.length > 0 ? (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
              {calendar.cells.map((c) => (
                <div key={c.date}
                  title={`${c.date}: ${c.taken}/${c.scheduled} taken`}
                  className={cn('aspect-square rounded-sm', CELL_COLOR[c.status] || 'bg-zinc-800')} />
              ))}
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Perfect</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500" /> Partial</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-600" /> Missed</span>
              <span className="ml-auto">{calendar.perfectDays} perfect days</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500 italic">Log doses on scheduled medications to build your calendar.</p>
        )}
      </section>

      {/* Auto-reorder */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <RefreshCw className="w-3.5 h-3.5 text-amber-400" /> Refill auto-reorder
          </h3>
          <button type="button" onClick={runReorder}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
            <RefreshCw className="w-3 h-3" /> Run now
          </button>
        </div>
        {reorderMsg && <p className="text-[11px] text-emerald-400 mb-2">{reorderMsg}</p>}
        {meds.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">Add a medication first to set auto-reorder.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 mb-2">
            <select value={reorderForm.medId} onChange={(e) => setReorderForm({ ...reorderForm, medId: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">Choose medication…</option>
              {meds.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input placeholder="Threshold days" inputMode="numeric" value={reorderForm.thresholdDays}
              onChange={(e) => setReorderForm({ ...reorderForm, thresholdDays: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Pharmacy (optional)" value={reorderForm.pharmacy}
              onChange={(e) => setReorderForm({ ...reorderForm, pharmacy: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addReorder}
              className="col-span-3 flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Enable auto-reorder
            </button>
          </div>
        )}
        {configs.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No auto-reorder rules configured.</p>
        ) : (
          <ul className="space-y-1">
            {configs.map((c) => (
              <li key={c.medId} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{c.medName}</p>
                  <p className="text-[10px] text-zinc-500">
                    Reorders at ≤{c.thresholdDays} days supply{c.pharmacy ? ` · ${c.pharmacy}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => removeReorder(c.medId)}
                  className="p-1 rounded-lg text-zinc-600 hover:text-rose-400 hover:bg-zinc-800" aria-label="Remove auto-reorder">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Graded interactions */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Clinical interaction grading
        </h3>
        <div className="flex gap-2">
          <input placeholder="Drugs, comma-separated (e.g. warfarin, aspirin)" value={gradeDrugs}
            onChange={(e) => setGradeDrugs(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void gradeInteractions(); }}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={gradeInteractions} disabled={gradeLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg">
            {gradeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
            Grade
          </button>
        </div>
        {gradeResult && (
          <div className="mt-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            {gradeResult.interactions.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">{gradeResult.note || 'No graded interactions found.'}</p>
            ) : (
              <>
                <p className="text-[11px] text-zinc-400 mb-1.5">
                  {gradeResult.graded} interaction{gradeResult.graded === 1 ? '' : 's'} ·
                  highest severity <span className="font-semibold capitalize">{gradeResult.highestSeverity}</span>
                  {gradeResult.sources?.length ? ` · sources: ${gradeResult.sources.join(', ')}` : ''}
                </p>
                <ul className="space-y-1.5">
                  {gradeResult.interactions.map((ix, i) => (
                    <li key={i} className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-zinc-200">{ix.drug1} + {ix.drug2}</span>
                        <span className={cn('ml-auto text-[10px] px-1.5 py-0.5 rounded-full capitalize',
                          ix.severity === 'high' ? 'bg-rose-600/30 text-rose-300' :
                            ix.severity === 'moderate' ? 'bg-amber-500/20 text-amber-300' :
                              'bg-zinc-700/50 text-zinc-400')}>
                          {ix.severity}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{ix.description}</p>
                      <p className="text-[10px] text-zinc-600">Source: {ix.source}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {gradeResult.disclaimer && <p className="text-[10px] text-zinc-600 italic mt-1.5">{gradeResult.disclaimer}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-2 py-2 text-center">
      <p className={cn('text-lg font-bold', highlight ? 'text-amber-300' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
