'use client';

/**
 * HrPerformancePanel — performance reviews and goals per employee.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Star, Target } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Employee { id: string; name: string }
interface Review { id: string; period: string; rating: number; summary: string | null }
interface Goal { id: string; title: string; dueDate: string | null; progress: number }

export function HrPerformancePanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState('');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState({ period: '', rating: 4, summary: '' });
  const [goalTitle, setGoalTitle] = useState('');

  const loadEmployees = useCallback(async () => {
    const r = await lensRun('hr', 'employee-list', {});
    const list: Employee[] = r.data?.result?.employees || [];
    setEmployees(list);
    setSelected((cur) => cur && list.some((e) => e.id === cur) ? cur : (list[0]?.id || ''));
    setLoading(false);
  }, []);

  useEffect(() => { void loadEmployees(); }, [loadEmployees]);

  const loadPerformance = useCallback(async () => {
    if (!selected) { setReviews([]); setGoals([]); return; }
    const [rv, g] = await Promise.all([
      lensRun('hr', 'review-list', { employeeId: selected }),
      lensRun('hr', 'goal-list', { employeeId: selected }),
    ]);
    setReviews(rv.data?.result?.reviews || []);
    setAvgRating(rv.data?.result?.averageRating || 0);
    setGoals(g.data?.result?.goals || []);
  }, [selected]);

  useEffect(() => { void loadPerformance(); }, [loadPerformance]);

  const addReview = async () => {
    if (!selected) return;
    const r = await lensRun('hr', 'review-create', {
      employeeId: selected, period: reviewForm.period.trim() || undefined,
      rating: reviewForm.rating, summary: reviewForm.summary.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setReviewForm({ period: '', rating: 4, summary: '' });
    setError(null);
    await loadPerformance();
  };
  const addGoal = async () => {
    if (!selected || !goalTitle.trim()) return;
    await lensRun('hr', 'goal-set', { employeeId: selected, title: goalTitle.trim() });
    setGoalTitle('');
    await loadPerformance();
  };
  const setProgress = async (id: string, progress: number) => {
    await lensRun('hr', 'goal-update-progress', { id, progress });
    await loadPerformance();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (employees.length === 0) {
    return <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-xl">Add employees in the People tab first.</div>;
  }

  return (
    <div className="space-y-4">
      <select value={selected} onChange={(e) => setSelected(e.target.value)}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
        {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Reviews */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Star className="w-3.5 h-3.5 text-emerald-400" /> Performance reviews
          {reviews.length > 0 && <span className="text-[10px] text-zinc-500">· avg {avgRating}</span>}
        </h3>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <input placeholder="Period" value={reviewForm.period} onChange={(e) => setReviewForm({ ...reviewForm, period: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={reviewForm.rating} onChange={(e) => setReviewForm({ ...reviewForm, rating: Number(e.target.value) })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
          </select>
          <button type="button" onClick={addReview}
            className="flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Review
          </button>
          <input placeholder="Summary" value={reviewForm.summary} onChange={(e) => setReviewForm({ ...reviewForm, summary: e.target.value })}
            className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        {reviews.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No reviews.</p>
        ) : (
          <ul className="space-y-1">
            {reviews.map((rv) => (
              <li key={rv.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} className={cn('w-3 h-3', n <= rv.rating ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
                    ))}
                  </span>
                  <span className="text-[11px] text-zinc-500">{rv.period}</span>
                </div>
                {rv.summary && <p className="text-[11px] text-zinc-400 mt-0.5">{rv.summary}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Goals */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Target className="w-3.5 h-3.5 text-emerald-400" /> Goals
        </h3>
        <div className="flex gap-1 mb-2">
          <input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="Add a goal…"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addGoal}
            className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">Add</button>
        </div>
        {goals.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No goals.</p>
        ) : (
          <ul className="space-y-2">
            {goals.map((g) => (
              <li key={g.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3">
                <p className="text-xs text-zinc-200">{g.title}</p>
                <div className="mt-1.5 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className={cn('h-full rounded-full', g.progress >= 100 ? 'bg-emerald-500' : 'bg-emerald-600/70')}
                    style={{ width: `${g.progress}%` }} />
                </div>
                <div className="flex gap-1 mt-1.5">
                  {[0, 25, 50, 75, 100].map((p) => (
                    <button key={p} type="button" onClick={() => setProgress(g.id, p)}
                      className={cn('text-[10px] px-1.5 py-0.5 rounded border',
                        g.progress === p ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' : 'border-zinc-700 text-zinc-500')}>
                      {p}%
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
