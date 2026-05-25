'use client';

import { useCallback, useEffect, useState } from 'react';
import { Flame, Loader2, CheckCircle2, Trophy, Target, LogOut } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Challenge {
  slug: string;
  title: string;
  category: string;
  cadence: string;
  points: number;
  kgCo2eSavedPerCheckIn: number;
  description: string;
  citation: string;
}

interface Enrollment {
  slug: string;
  joinedAt: string;
  checkIns: string[];
  currentStreak: number;
  longestStreak: number;
  totalCheckIns: number;
  totalPoints: number;
  totalKgSaved: number;
  challenge: Challenge | null;
}

interface MineResult {
  enrollments: Enrollment[];
  totalPoints: number;
  totalKgSaved: number;
  bestStreak: number;
  activeCount: number;
}

const CATEGORY_TONE: Record<string, string> = {
  food: 'text-green-400 border-green-500/30 bg-green-500/10',
  transport: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
  home: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  waste: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
};

export function EcoChallenges() {
  const [catalog, setCatalog] = useState<Challenge[]>([]);
  const [mine, setMine] = useState<MineResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [cat, m] = await Promise.all([
      lensRun<{ challenges: Challenge[] }>('eco', 'challenges-catalog', {}),
      lensRun<MineResult>('eco', 'challenges-mine', {}),
    ]);
    if (cat.data?.ok && cat.data.result) setCatalog(cat.data.result.challenges);
    if (m.data?.ok && m.data.result) setMine(m.data.result);
    if (!cat.data?.ok && !m.data?.ok) setError('Could not load challenges.');
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const join = useCallback(
    async (slug: string) => {
      setBusy(slug);
      const r = await lensRun('eco', 'challenges-join', { slug });
      if (!r.data?.ok) setError(r.data?.error || 'Could not join challenge.');
      await load();
      setBusy(null);
    },
    [load],
  );

  const checkin = useCallback(
    async (slug: string) => {
      setBusy(slug);
      const r = await lensRun('eco', 'challenges-checkin', { slug });
      if (!r.data?.ok) setError(r.data?.error || 'Could not check in.');
      else setError(null);
      await load();
      setBusy(null);
    },
    [load],
  );

  const leave = useCallback(
    async (slug: string) => {
      setBusy(slug);
      await lensRun('eco', 'challenges-leave', { slug });
      await load();
      setBusy(null);
    },
    [load],
  );

  const today = new Date().toISOString().slice(0, 10);
  const enrolledSlugs = new Set((mine?.enrollments || []).map((e) => e.slug));
  const available = catalog.filter((c) => !enrolledSlugs.has(c.slug));

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Flame className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Sustainability challenges
        </span>
      </header>

      <div className="p-4 space-y-4">
        {error && <div className="text-xs text-red-400">{error}</div>}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading challenges…
          </div>
        )}

        {!loading && mine && (
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 bg-white/[0.03] rounded text-center">
              <p className="text-lg font-bold text-amber-400 flex items-center justify-center gap-1">
                <Trophy className="w-4 h-4" />
                {mine.totalPoints}
              </p>
              <p className="text-[10px] text-gray-400">total points</p>
            </div>
            <div className="p-2 bg-white/[0.03] rounded text-center">
              <p className="text-lg font-bold text-orange-400 flex items-center justify-center gap-1">
                <Flame className="w-4 h-4" />
                {mine.bestStreak}
              </p>
              <p className="text-[10px] text-gray-400">best streak</p>
            </div>
            <div className="p-2 bg-white/[0.03] rounded text-center">
              <p className="text-lg font-bold text-green-400">{mine.totalKgSaved}</p>
              <p className="text-[10px] text-gray-400">kg CO₂e saved</p>
            </div>
          </div>
        )}

        {!loading && mine && mine.enrollments.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">My challenges</p>
            {mine.enrollments.map((e) => {
              const checkedToday = e.checkIns.includes(today);
              return (
                <div
                  key={e.slug}
                  className="rounded border border-white/10 bg-white/[0.02] p-3 space-y-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white">
                        {e.challenge?.title || e.slug}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {e.challenge?.cadence} · {e.challenge?.points} pts/check-in
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs text-orange-400">
                      <Flame className="w-3.5 h-3.5" />
                      {e.currentStreak}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[10px] text-gray-400">
                    <span>{e.totalCheckIns} check-ins</span>
                    <span>longest streak {e.longestStreak}</span>
                    <span>{e.totalKgSaved} kg saved</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => checkin(e.slug)}
                      disabled={busy === e.slug || checkedToday}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-green-500 text-black text-xs font-bold hover:bg-green-400 disabled:opacity-50"
                    >
                      {busy === e.slug ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      {checkedToday ? 'Done today' : 'Check in'}
                    </button>
                    <button
                      onClick={() => leave(e.slug)}
                      disabled={busy === e.slug}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-white/[0.04] border border-white/10 text-gray-400 text-xs hover:text-red-400 disabled:opacity-50"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Leave
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && available.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Join a challenge</p>
            {available.map((c) => (
              <div
                key={c.slug}
                className="rounded border border-white/10 bg-white/[0.02] p-3 space-y-1.5"
              >
                <div className="flex items-start gap-2">
                  <Target className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{c.title}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded border ${
                          CATEGORY_TONE[c.category] || 'text-gray-400 border-white/10 bg-white/5'
                        }`}
                      >
                        {c.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400">{c.description}</p>
                    <p className="text-[10px] text-gray-400">
                      {c.cadence} · {c.points} pts · {c.kgCo2eSavedPerCheckIn} kg/check-in · {c.citation}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => join(c.slug)}
                  disabled={busy === c.slug}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white/[0.04] border border-green-500/30 text-green-400 text-xs hover:bg-green-500/10 disabled:opacity-50"
                >
                  {busy === c.slug ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Join challenge
                </button>
              </div>
            ))}
          </div>
        )}

        {!loading && available.length === 0 && (mine?.enrollments.length ?? 0) > 0 && (
          <p className="text-center text-xs text-gray-400 py-2">
            You&apos;ve joined every available challenge. Keep your streaks alive.
          </p>
        )}
      </div>
    </div>
  );
}

export default EcoChallenges;
