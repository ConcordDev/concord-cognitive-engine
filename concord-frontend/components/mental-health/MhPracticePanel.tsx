'use client';

/**
 * MhPracticePanel — log meditation sessions, work through multi-session
 * courses and run guided breathing patterns.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Flower2, Wind, GraduationCap, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Session { id: string; type: string; durationMin: number; title: string | null; date: string }
interface Course { id: string; name: string; category: string; totalSessions: number; completedSessions: number; progressPct: number; complete: boolean }
interface Pattern { id: string; name: string; inhale: number; hold1: number; exhale: number; hold2: number; use: string }

const SESSION_TYPES = ['meditation', 'sleep', 'breathing', 'focus', 'body_scan', 'movement'];

export function MhPracticePanel({ onChange }: { onChange: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sForm, setSForm] = useState({ type: 'meditation', durationMin: '10' });
  const [cForm, setCForm] = useState({ name: '', totalSessions: '10' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, c, p] = await Promise.all([
      lensRun('mental-health', 'session-history', {}),
      lensRun('mental-health', 'course-list', {}),
      lensRun('mental-health', 'breathing-patterns', {}),
    ]);
    setSessions(s.data?.result?.sessions || []);
    setCourses(c.data?.result?.courses || []);
    setPatterns(p.data?.result?.patterns || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logSession = async () => {
    await lensRun('mental-health', 'session-log', { type: sForm.type, durationMin: Number(sForm.durationMin) || 10 });
    await refresh();
  };
  const createCourse = async () => {
    if (!cForm.name.trim()) { setError('Course name is required.'); return; }
    await lensRun('mental-health', 'course-create', { name: cForm.name.trim(), totalSessions: Number(cForm.totalSessions) || 10 });
    setCForm({ name: '', totalSessions: '10' }); setError(null);
    await refresh();
  };
  const advanceCourse = async (id: string) => {
    const r = await lensRun('mental-health', 'course-complete-session', { id, durationMin: 10 });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };
  const breathe = async (patternId: string) => {
    await lensRun('mental-health', 'breathing-log', { patternId, rounds: 6 });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Quick session */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Flower2 className="w-3.5 h-3.5 text-sky-400" /> Log a session
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <select value={sForm.type} onChange={(e) => setSForm({ ...sForm, type: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {SESSION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={sForm.durationMin} onChange={(e) => setSForm({ ...sForm, durationMin: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {[3, 5, 10, 15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
          <button type="button" onClick={logSession}
            className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Log
          </button>
        </div>
      </section>

      {/* Breathing */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Wind className="w-3.5 h-3.5 text-sky-400" /> Breathing exercises
        </h3>
        <ul className="grid grid-cols-2 gap-2">
          {patterns.map((p) => (
            <li key={p.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <p className="text-xs font-semibold text-zinc-100">{p.name}</p>
              <p className="text-[10px] text-zinc-500">
                {p.inhale}-{p.hold1}-{p.exhale}{p.hold2 ? `-${p.hold2}` : ''} · {p.use}
              </p>
              <button type="button" onClick={() => breathe(p.id)}
                className="mt-1.5 text-[11px] px-2 py-0.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white">
                Breathe 6 rounds
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Courses */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <GraduationCap className="w-3.5 h-3.5 text-sky-400" /> Courses
        </h3>
        <div className="flex gap-2 mb-2">
          <input value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} placeholder="New course — e.g. Basics"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <input value={cForm.totalSessions} onChange={(e) => setCForm({ ...cForm, totalSessions: e.target.value })}
            inputMode="numeric" className="w-16 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={createCourse}
            className="px-2.5 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg">Create</button>
        </div>
        {courses.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No courses yet.</p>
        ) : (
          <ul className="space-y-2">
            {courses.map((c) => (
              <li key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-200">{c.name}</span>
                  <span className="text-[10px] text-zinc-500">{c.completedSessions}/{c.totalSessions}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className={cn('h-full rounded-full', c.complete ? 'bg-emerald-500' : 'bg-sky-500')}
                    style={{ width: `${c.progressPct}%` }} />
                </div>
                {!c.complete ? (
                  <button type="button" onClick={() => advanceCourse(c.id)}
                    className="mt-1.5 text-[11px] text-sky-400 hover:text-sky-300">Complete next session</button>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-400">
                    <Check className="w-3 h-3" /> Course complete
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent sessions */}
      {sessions.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Recent sessions</h3>
          <ul className="space-y-1">
            {sessions.slice(0, 6).map((s) => (
              <li key={s.id} className="flex items-center justify-between text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-zinc-300 capitalize">{s.title || s.type.replace(/_/g, ' ')}</span>
                <span className="text-zinc-500">{s.durationMin} min · {s.date}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
