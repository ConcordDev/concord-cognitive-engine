'use client';

/**
 * ProductivityFocusPanel — Pomodoro focus logging, the Eisenhower
 * matrix and a karma score.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Timer, Grid2x2, Award } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface FocusStats { totalSessions: number; totalMinutes: number; todaySessions: number; todayMinutes: number }
interface MatrixTask { id: string; content: string; priority: number }
interface Quadrants { do_first: MatrixTask[]; schedule: MatrixTask[]; delegate: MatrixTask[]; eliminate: MatrixTask[] }
interface Karma { karma: number; level: string; completions: number }

const QUADRANT_META: { key: keyof Quadrants; label: string; hint: string; color: string }[] = [
  { key: 'do_first', label: 'Do first', hint: 'Urgent + important', color: 'border-rose-800/50' },
  { key: 'schedule', label: 'Schedule', hint: 'Important, not urgent', color: 'border-sky-800/50' },
  { key: 'delegate', label: 'Delegate', hint: 'Urgent, not important', color: 'border-amber-800/50' },
  { key: 'eliminate', label: 'Eliminate', hint: 'Neither', color: 'border-zinc-800' },
];

export function ProductivityFocusPanel({ onChange }: { onChange: () => void }) {
  const [stats, setStats] = useState<FocusStats | null>(null);
  const [quadrants, setQuadrants] = useState<Quadrants | null>(null);
  const [karma, setKarma] = useState<Karma | null>(null);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState('25');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [f, m, k] = await Promise.all([
      lensRun('productivity', 'focus-stats', {}),
      lensRun('productivity', 'eisenhower-matrix', {}),
      lensRun('productivity', 'karma', {}),
    ]);
    setStats((f.data?.result as FocusStats | null) || null);
    setQuadrants((m.data?.result?.quadrants as Quadrants | null) || null);
    setKarma((k.data?.result as Karma | null) || null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logFocus = async () => {
    await lensRun('productivity', 'focus-log', { durationMin: Number(duration) || 25 });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Karma */}
      {karma && (
        <section className="bg-gradient-to-br from-red-900/40 to-zinc-900 border border-red-800/40 rounded-xl p-4 flex items-center gap-3">
          <Award className="w-8 h-8 text-amber-400 shrink-0" />
          <div>
            <p className="text-2xl font-bold text-zinc-100">{karma.karma} <span className="text-sm font-normal text-zinc-400">karma</span></p>
            <p className="text-[11px] text-zinc-400">{karma.level} · {karma.completions} tasks completed</p>
          </div>
        </section>
      )}

      {/* Focus */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Timer className="w-3.5 h-3.5 text-red-400" /> Pomodoro focus
        </h3>
        {stats && (
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className="text-sm font-bold text-zinc-100">{stats.todaySessions}</p>
              <p className="text-[10px] text-zinc-400 uppercase">Today</p>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className="text-sm font-bold text-zinc-100">{stats.todayMinutes}m</p>
              <p className="text-[10px] text-zinc-400 uppercase">Today min</p>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className="text-sm font-bold text-zinc-100">{stats.totalSessions}</p>
              <p className="text-[10px] text-zinc-400 uppercase">Sessions</p>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className="text-sm font-bold text-zinc-100">{Math.round(stats.totalMinutes / 60 * 10) / 10}h</p>
              <p className="text-[10px] text-zinc-400 uppercase">Total</p>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          {['15', '25', '50'].map((d) => (
            <button key={d} type="button" onClick={() => setDuration(d)}
              className={cn('text-xs px-3 py-1.5 rounded-lg border',
                duration === d ? 'border-red-700/50 bg-red-950/40 text-red-300' : 'border-zinc-700 text-zinc-400')}>
              {d} min
            </button>
          ))}
          <button type="button" onClick={logFocus}
            className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg">
            Log a {duration}-min focus session
          </button>
        </div>
      </section>

      {/* Eisenhower matrix */}
      {quadrants && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Grid2x2 className="w-3.5 h-3.5 text-red-400" /> Eisenhower matrix
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {QUADRANT_META.map((q) => (
              <div key={q.key} className={cn('bg-zinc-900/70 border rounded-xl p-2.5', q.color)}>
                <p className="text-[11px] font-semibold text-zinc-200">{q.label}</p>
                <p className="text-[9px] text-zinc-400 uppercase mb-1">{q.hint}</p>
                {quadrants[q.key].length === 0 ? (
                  <p className="text-[10px] text-zinc-400 italic">—</p>
                ) : (
                  <ul className="space-y-0.5">
                    {quadrants[q.key].slice(0, 5).map((t) => (
                      <li key={t.id} className="text-[10px] text-zinc-400 truncate">• {t.content}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
