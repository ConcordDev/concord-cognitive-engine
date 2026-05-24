'use client';

/**
 * CwProgressPanel — word-count goal tracking, writing sessions and a
 * per-chapter breakdown.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Plus, Flame, Target } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ChapterWords { chapterId: string; title: string; words: number }
interface Session { id: string; words: number; minutes: number; date: string }
interface Stats {
  totalWords: number; targetWords: number; targetPct: number; wordsToday: number;
  sessionWords: number; sessionCount: number; streak: number;
  byChapter: ChapterWords[]; recentSessions: Session[];
}

export function CwProgressPanel({ projectId }: { projectId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [projection, setProjection] = useState<{ deadline: string | null; daysLeft: number | null; perDayNeeded: number | null; recentPace: number; onTrack: boolean | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ words: '', minutes: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, p] = await Promise.all([
      lensRun('creative-writing', 'writing-stats', { projectId }),
      lensRun('creative-writing', 'goal-projection', { projectId }),
    ]);
    setStats((r.data?.result as Stats | null) || null);
    setProjection((p.data?.result as typeof projection) || null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logSession = async () => {
    const w = Number(form.words);
    if (!w) return;
    await lensRun('creative-writing', 'session-log', {
      projectId, words: w, minutes: Number(form.minutes) || 0,
    });
    setForm({ words: '', minutes: '' });
    await refresh();
  };

  if (loading || !stats) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Goal */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Target className="w-3.5 h-3.5 text-amber-400" /> Manuscript goal
          </span>
          <span className="text-xs text-zinc-400">
            {stats.totalWords.toLocaleString()}{stats.targetWords > 0 && ` / ${stats.targetWords.toLocaleString()}`} words
          </span>
        </div>
        {stats.targetWords > 0 && (
          <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(100, stats.targetPct)}%` }} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Words today" value={stats.wordsToday.toLocaleString()} />
        <Stat label="Sessions" value={stats.sessionCount} />
        <Stat label="Day streak" value={stats.streak} icon />
      </div>

      {/* Log session */}
      <section className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Words written" inputMode="numeric" value={form.words}
          onChange={(e) => setForm({ ...form, words: e.target.value })}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Minutes" inputMode="numeric" value={form.minutes}
          onChange={(e) => setForm({ ...form, minutes: e.target.value })}
          className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={logSession}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Log session
        </button>
      </section>

      {/* By chapter */}
      {stats.byChapter.length > 0 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Words by chapter</h3>
          <ResponsiveContainer width="100%" height={Math.max(120, stats.byChapter.length * 32)}>
            <BarChart layout="vertical" data={stats.byChapter} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#71717a' }} />
              <YAxis type="category" dataKey="title" width={90} tick={{ fontSize: 9, fill: '#a1a1aa' }} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="words" fill="#f59e0b" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent sessions */}
      {stats.recentSessions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Recent sessions</h3>
          <ul className="space-y-1">
            {stats.recentSessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-[11px] text-zinc-400">{s.date}</span>
                <span className="text-xs text-zinc-200">
                  +{s.words.toLocaleString()} words{s.minutes > 0 && <span className="text-zinc-400"> · {s.minutes} min</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deadline projection */}
      {projection && projection.deadline && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="text-xs font-semibold text-zinc-300 mb-1">Deadline projection</h3>
          {projection.daysLeft != null && projection.daysLeft > 0 ? (
            <p className="text-[11px] text-zinc-400">
              {projection.daysLeft} days to {projection.deadline} ·
              {' '}<span className="text-amber-300">{projection.perDayNeeded?.toLocaleString()} words/day needed</span> ·
              {' '}recent pace {projection.recentPace.toLocaleString()}/day ·
              {' '}<span className={projection.onTrack ? 'text-emerald-400' : 'text-rose-400'}>
                {projection.onTrack ? 'on track' : 'behind pace'}</span>
            </p>
          ) : (
            <p className="text-[11px] text-zinc-400">Deadline {projection.deadline} has passed.</p>
          )}
        </div>
      )}

    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: boolean }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      <p className="flex items-center justify-center gap-1 text-lg font-bold text-zinc-100">
        {icon && <Flame className="w-4 h-4 text-orange-400" />}{value}
      </p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
