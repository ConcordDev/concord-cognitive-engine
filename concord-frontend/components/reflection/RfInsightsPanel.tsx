'use client';

/**
 * RfInsightsPanel — streaks, mood trend chart, tag cloud and a
 * journaling-frequency calendar for the current month.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Flame, Hash, CalendarDays } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Streak { currentStreak: number; longestStreak: number; daysJournaled: number }
interface MoodPoint { date: string; mood: string; score: number }
interface MoodTrend { entries: number; averageScore: number | null; series: MoodPoint[] }
interface Tag { tag: string; count: number }
interface Calendar { year: number; month: number; days: Record<string, number> }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function RfInsightsPanel() {
  const [streak, setStreak] = useState<Streak | null>(null);
  const [trend, setTrend] = useState<MoodTrend | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    const [s, t, tg, c] = await Promise.all([
      lensRun('reflection', 'journal-streak', {}),
      lensRun('reflection', 'mood-trend', { days: 30 }),
      lensRun('reflection', 'tags-list', {}),
      lensRun('reflection', 'calendar-month', { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }),
    ]);
    setStreak((s.data?.result as Streak | null) || null);
    setTrend((t.data?.result as MoodTrend | null) || null);
    setTags(tg.data?.result?.tags || []);
    setCalendar((c.data?.result as Calendar | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const daysInMonth = calendar ? new Date(calendar.year, calendar.month, 0).getUTCDate() : 0;
  const maxTag = Math.max(1, ...tags.map((t) => t.count));

  return (
    <div className="space-y-4">
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
    </div>
  );
}
