'use client';

/**
 * MhReflectPanel — gratitude journal and a daily-minutes practice goal.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Heart, Target } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { ErrorState } from '@/components/ui';

interface GratitudeEntry { id: string; items: unknown[]; date: string }

function gratitudeItemText(it: unknown): string {
  if (typeof it === 'string') return it;
  if (it && typeof it === 'object') {
    const row = it as Record<string, unknown>;
    for (const key of ['text', 'entry', 'body', 'content', 'item', 'note', 'value']) {
      const value = row[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return '';
}
interface GoalStatus { dailyMinutes: number; todayMinutes: number; pct: number; met: boolean; isDefault: boolean }

export function MhReflectPanel({ onChange }: { onChange: () => void }) {
  const [entries, setEntries] = useState<GratitudeEntry[]>([]);
  const [goal, setGoal] = useState<GoalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<string[]>(['', '', '']);
  const [goalInput, setGoalInput] = useState('');
  const [armedId, setArmedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [g, go] = await Promise.all([
      lensRun('mental-health', 'gratitude-list', {}),
      lensRun('mental-health', 'goal-status', {}),
    ]);
    if (g.data?.ok === false || go.data?.ok === false) {
      setLoadError((g.data?.ok === false ? g.data?.error : go.data?.error) || 'Could not load your reflections.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setEntries(g.data?.result?.entries || []);
    setGoal((go.data?.result as GoalStatus | null) || null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addGratitude = async () => {
    const items = drafts.map((d) => d.trim()).filter(Boolean);
    if (!items.length) { setError('Write at least one thing you are grateful for.'); return; }
    const r = await lensRun('mental-health', 'gratitude-add', { entries: items });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setDrafts(['', '', '']);
    setError(null);
    await refresh();
  };

  const saveGoal = async () => {
    const m = Number(goalInput);
    if (!(m > 0)) { setError('Enter a daily minutes goal.'); return; }
    const r = await lensRun('mental-health', 'goal-set', { dailyMinutes: m });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setGoalInput('');
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Daily practice goal */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Target className="w-3.5 h-3.5 text-sky-400" /> Daily practice goal
        </h3>
        {goal && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-zinc-300">
                {goal.todayMinutes} / {goal.dailyMinutes} min today
              </span>
              <span className={goal.met ? 'text-[11px] text-emerald-400' : 'text-[11px] text-zinc-400'}>
                {goal.met ? 'Goal met' : `${goal.pct}%`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className={goal.met ? 'h-full bg-emerald-500 rounded-full' : 'h-full bg-sky-500 rounded-full'}
                style={{ width: `${Math.min(100, goal.pct)}%` }} />
            </div>
            <div className="flex items-center gap-2 mt-2.5">
              <input aria-label="Daily minutes goal" placeholder={`Goal (now ${goal.dailyMinutes} min)`} inputMode="numeric" value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={saveGoal}
                className="px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg">
                Set goal
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Gratitude journal */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Heart className="w-3.5 h-3.5 text-sky-400" /> Gratitude journal
        </h3>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          {drafts.map((d, i) => (
            <input aria-label={`Gratitude entry ${i + 1}`} key={i} placeholder={`Grateful for… ${i + 1}`} value={d}
              onChange={(e) => setDrafts((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          ))}
          <button type="button" onClick={addGratitude}
            className="flex items-center justify-center gap-1 w-full bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg py-1.5">
            <Plus className="w-3.5 h-3.5" /> Save entry
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic mt-2">No gratitude entries yet. A few lines a day builds the habit.</p>
        ) : (
          <ul className="space-y-1.5 mt-2">
            {entries.map((e) => (
              <li key={e.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-zinc-400">{e.date}</p>
                  <span className="flex items-center gap-2">
                  {editingId !== e.id && (
                    <button type="button" className="text-[11px] text-zinc-300 underline" onClick={() => { setEditingId(e.id); setEditText(e.items.map(gratitudeItemText).filter(Boolean).join('\n')); }}>Edit</button>
                  )}
                  <StickyDeleteConfirm
                    armed={armedId === e.id}
                    onArm={() => setArmedId(e.id)}
                    onCancel={() => setArmedId(null)}
                    onConfirm={async () => {
                      await lensRun('mental-health', 'gratitude-delete', { id: e.id });
                      setArmedId(null);
                      await refresh();
                    }}
                    armLabel="Delete"
                    confirmLabel="Delete this journal entry?"
                    className="text-[11px] text-rose-300 underline"
                  />
                  </span>
                </div>
                {editingId === e.id ? (
                  <div className="space-y-1">
                    <textarea aria-label="Edit gratitude entries" value={editText} onChange={(ev) => setEditText(ev.target.value)} rows={3}
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100" />
                    <button type="button" className="text-[11px] text-sky-300 underline" onClick={async () => {
                      await lensRun('mental-health', 'gratitude-update', { id: e.id, entries: editText.split('\n') });
                      setEditingId(null);
                      await refresh();
                    }}>Save</button>
                  </div>
                ) : (
                <ul className="space-y-0.5">
                  {e.items.map((it, i) => {
                    const line = gratitudeItemText(it);
                    if (!line) return null;
                    return (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-200">
                      <Heart className="w-3 h-3 text-sky-500 mt-0.5 shrink-0" /> {line}
                    </li>
                    );
                  })}
                </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
