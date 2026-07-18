'use client';

/**
 * RfInsightsPanel — streaks, mood trend chart, tag cloud, a
 * journaling-frequency calendar for the current month, all-time stats
 * (`journal-stats`), and a weekly writing goal (`reflection-goal-set` /
 * `reflection-goal-status`) — Day One's "Streaks" screen shape.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Flame, Hash, CalendarDays, BarChart2, Target, Check, Pencil } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';

interface Streak { currentStreak: number; longestStreak: number; daysJournaled: number }
interface MoodPoint { date: string; mood: string; score: number }
interface MoodTrend { entries: number; averageScore: number | null; series: MoodPoint[] }
interface Tag { tag: string; count: number }
interface Calendar { year: number; month: number; days: Record<string, number> }
interface JournalStats {
  totalEntries: number; totalWords: number; avgWords: number; totalPhotos: number;
  byMood: Record<string, number>;
}
interface GoalStatus {
  weeklyEntries: number; entriesThisWeek: number; pct: number; met: boolean; isDefault: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MOOD_ORDER = ['great', 'good', 'okay', 'low', 'rough'];
const MOOD_COLOR: Record<string, string> = {
  great: 'bg-emerald-500', good: 'bg-lime-500', okay: 'bg-amber-500', low: 'bg-orange-500', rough: 'bg-rose-500',
};

export function RfInsightsPanel() {
  const [streak, setStreak] = useState<Streak | null>(null);
  const [trend, setTrend] = useState<MoodTrend | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [stats, setStats] = useState<JournalStats | null>(null);
  const [goal, setGoal] = useState<GoalStatus | null>(null);
  const [goalDraft, setGoalDraft] = useState<number | null>(null);
  const [goalSaving, setGoalSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    const [s, t, tg, c, st, g] = await Promise.all([
      lensRun('reflection', 'journal-streak', {}),
      lensRun('reflection', 'mood-trend', { days: 30 }),
      lensRun('reflection', 'tags-list', {}),
      lensRun('reflection', 'calendar-month', { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }),
      lensRun('reflection', 'journal-stats', {}),
      lensRun('reflection', 'reflection-goal-status', {}),
    ]);
    if ([s, t, tg, c, st, g].some((res) => res.data?.ok === false)) {
      setLoadError([s, t, tg, c, st, g].map((res) => res.data?.error).find(Boolean) || 'Could not load insights.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setStreak((s.data?.result as Streak | null) || null);
    setTrend((t.data?.result as MoodTrend | null) || null);
    setTags(tg.data?.result?.tags || []);
    setCalendar((c.data?.result as Calendar | null) || null);
    setStats((st.data?.result as JournalStats | null) || null);
    setGoal((g.data?.result as GoalStatus | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function saveGoal() {
    if (!goalDraft || goalDraft < 1) return;
    setGoalSaving(true);
    await lensRun('reflection', 'reflection-goal-set', { weeklyEntries: goalDraft });
    const g = await lensRun('reflection', 'reflection-goal-status', {});
    setGoal((g.data?.result as GoalStatus | null) || null);
    setGoalDraft(null);
    setGoalSaving(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  const daysInMonth = calendar ? new Date(calendar.year, calendar.month, 0).getUTCDate() : 0;
  const maxTag = Math.max(1, ...tags.map((t) => t.count));
  const maxMood = stats ? Math.max(1, ...Object.values(stats.byMood)) : 1;

  return (
    <div className="space-y-4">
      {/* Weekly goal */}
      {goal && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
              <Target className="w-3.5 h-3.5 text-emerald-400" /> Weekly writing goal
            </h3>
            {goalDraft === null ? (
              <button type="button" onClick={() => setGoalDraft(goal.weeklyEntries)}
                className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="number" min={1} max={21} value={goalDraft}
                  onChange={(e) => setGoalDraft(Math.max(1, Math.min(21, Number(e.target.value))))}
                  className="w-14 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-white"
                />
                <button type="button" onClick={saveGoal} disabled={goalSaving}
                  className="rounded bg-emerald-600/80 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                  {goalSaving ? '…' : 'Save'}
                </button>
                <button type="button" onClick={() => setGoalDraft(null)}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300">Cancel</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', goal.met ? 'bg-emerald-500' : 'bg-indigo-500')}
                style={{ width: `${Math.min(100, goal.pct)}%` }}
              />
            </div>
            <span className={cn('flex items-center gap-1 text-[11px] font-medium shrink-0', goal.met ? 'text-emerald-400' : 'text-zinc-300')}>
              {goal.met && <Check className="w-3 h-3" />}
              {goal.entriesThisWeek}/{goal.weeklyEntries} this week
            </span>
          </div>
          {goal.isDefault && <p className="mt-1 text-[10px] text-zinc-500">Default goal — set your own above.</p>}
        </div>
      )}

      {/* Streak */}
      {streak && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="flex items-center justify-center gap-1 text-2xl font-bold text-orange-300">
              <Flame className="w-5 h-5" />{streak.currentStreak}
            </p>
            <p className="text-[10px] text-zinc-400 uppercase">Current streak</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-zinc-100">{streak.longestStreak}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Longest streak</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-zinc-100">{streak.daysJournaled}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Days journaled</p>
          </div>
        </div>
      )}

      {/* Mood trend */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">
          Mood trend (30d){trend?.averageScore != null && <span className="text-zinc-400 font-normal"> · avg {trend.averageScore}/5</span>}
        </h3>
        {trend && trend.series.length > 0 ? (
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={trend.series.map((p) => ({ date: p.date.slice(5), score: p.score }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} />
              <YAxis domain={[1, 5]} tick={{ fontSize: 9, fill: '#71717a' }} width={20} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-[11px] text-zinc-400 italic py-6 text-center">Tag a mood on your entries to see the trend.</p>
        )}
      </div>

      {/* Calendar */}
      {calendar && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <CalendarDays className="w-3.5 h-3.5 text-indigo-400" /> {MONTHS[calendar.month - 1]} {calendar.year}
          </h3>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = String(i + 1).padStart(2, '0');
              const count = calendar.days[d] || 0;
              return (
                <div key={d}
                  title={count ? `${count} entr${count > 1 ? 'ies' : 'y'}` : 'no entry'}
                  className={cn('aspect-square rounded flex items-center justify-center text-[9px]',
                    count >= 2 ? 'bg-indigo-500 text-white'
                      : count === 1 ? 'bg-indigo-700/60 text-indigo-100'
                        : 'bg-zinc-800 text-zinc-600')}>
                  {i + 1}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tags */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Hash className="w-3.5 h-3.5 text-indigo-400" /> Tags
        </h3>
        {tags.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No tags yet. Add tags to entries to track themes.</p>
        ) : (
          <ul className="space-y-1.5">
            {tags.slice(0, 12).map((t) => (
              <li key={t.tag} className="flex items-center gap-2">
                <span className="w-24 text-xs text-indigo-300 truncate">#{t.tag}</span>
                <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(t.count / maxTag) * 100}%` }} />
                </div>
                <span className="text-[10px] text-zinc-400 w-6 text-right">{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* All-time stats + mood breakdown */}
      {stats && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <BarChart2 className="w-3.5 h-3.5 text-indigo-400" /> All-time stats
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <StatTile label="Entries" value={stats.totalEntries} />
            <StatTile label="Total words" value={stats.totalWords.toLocaleString()} />
            <StatTile label="Avg words/entry" value={stats.avgWords} />
            <StatTile label="Photos" value={stats.totalPhotos} />
          </div>
          {stats.totalEntries > 0 && (
            <div className="space-y-1">
              {MOOD_ORDER.filter((m) => stats.byMood[m] > 0).map((m) => (
                <div key={m} className="flex items-center gap-2">
                  <span className="w-12 text-[10px] uppercase text-zinc-400">{m}</span>
                  <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div className={cn('h-full rounded-full', MOOD_COLOR[m])} style={{ width: `${(stats.byMood[m] / maxMood) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-zinc-400 w-6 text-right">{stats.byMood[m]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-zinc-950/50 px-2 py-1.5 text-center">
      <div className="text-sm font-bold text-zinc-100">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
