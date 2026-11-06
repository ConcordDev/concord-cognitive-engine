'use client';

/**
 * InsightsPanel — personalized recommendations + milestones / achievements.
 * Wires meditation.recommendations (mood + history adaptive picks) and
 * meditation.milestones (streak / minutes / sessions badges with progress).
 * Tapping a recommendation SAVES it for later via meditation.play —
 * an intent, never a credit (S-MED-1): the old one-tap Play logged
 * the full session instantly, player and practice alike absent.
 * Every milestone states its rule where it renders (F8), and NEXT UP
 * never duplicates a tile in the grid below it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Lightbulb, Trophy, Loader2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface RecTrack {
  id: string; title: string; category: string; durationMin: number;
  narrator?: string; goal: string; matchScore: number;
}
interface RecResult {
  goal: string; reason: string;
  basedOn: { recentMood: number | null; totalSessions: number; hour: number };
  recommendations: RecTrack[];
}
interface Badge {
  id: string; label: string; icon: string; blurb: string; kind: string;
  threshold: number; progress: number; value: number; unlocked: boolean;
}
interface MilestoneResult {
  badges: Badge[]; unlockedCount: number; totalCount: number;
  nextUp: Badge | null; metrics: Record<string, number>;
}

export function InsightsPanel({ onPlayed }: { onPlayed?: () => void }) {
  void onPlayed; // practice totals no longer change from this panel (saves are intents)
  const [rec, setRec] = useState<RecResult | null>(null);
  const [mile, setMile] = useState<MilestoneResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const [r, m, iv] = await Promise.all([
      lensRun('meditation', 'recommendations', {}),
      lensRun('meditation', 'milestones', {}),
      lensRun('meditation', 'intents', {}),
    ]);
    setRec((r.data?.result as RecResult) || null);
    setMile((m.data?.result as MilestoneResult) || null);
    const intents = (iv.data?.result?.intents as { sessionId: string }[]) || [];
    setSavedIds(new Set(intents.map((x) => x.sessionId)));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const play = useCallback(async (id: string) => {
    // Save for later. Totals do not move: the session counts when it
    // is sat from the Session view, not when it is tapped here.
    setSavingId(id);
    await lensRun('meditation', 'play', { sessionId: id });
    await load();
    setSavingId(null);
  }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Recommendations */}
      <div className="rounded-2xl border border-violet-900/40 bg-gradient-to-b from-violet-950/15 to-zinc-950/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="w-4 h-4 text-violet-300" />
          <h3 className="text-sm font-bold text-zinc-100">For You</h3>
          {rec && <span className="text-[11px] text-zinc-400">goal: {rec.goal}</span>}
        </div>
        {rec ? (
          <>
            <p className="text-[12px] text-violet-200 italic mb-3">{rec.reason}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {rec.recommendations.map((t) => (
                <div key={t.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-100 truncate">{t.title}</p>
                      <p className="text-[10px] text-zinc-400">{t.narrator || t.goal} · {t.durationMin}m · {t.category}</p>
                    </div>
                    <button type="button" onClick={() => play(t.id)} disabled={!!savingId || savedIds.has(t.id)}
                      className="h-7 px-2 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center text-white text-[10px] flex-shrink-0 disabled:opacity-50"
                      aria-label="Save for later">
                      {savingId === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : savedIds.has(t.id) ? 'Saved' : 'Save'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-zinc-400 mt-2">
              Based on {rec.basedOn.totalSessions} session(s)
              {rec.basedOn.recentMood != null && ` · last mood ${rec.basedOn.recentMood}/5`}
            </p>
          </>
        ) : (
          <p className="text-xs text-zinc-400">No recommendations available.</p>
        )}
      </div>

      {/* Milestones */}
      <div className="rounded-2xl border border-yellow-900/40 bg-gradient-to-b from-yellow-950/15 to-zinc-950/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-4 h-4 text-yellow-300" />
          <h3 className="text-sm font-bold text-zinc-100">Milestones</h3>
          {mile && <span className="text-[11px] text-zinc-400">{mile.unlockedCount}/{mile.totalCount} unlocked</span>}
        </div>
        {mile ? (
          <>
            {mile.nextUp && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3">
                <p className="text-[10px] uppercase tracking-wide text-yellow-300 mb-1">Next up</p>
                <div className="flex items-center gap-2">
                  <span className="text-xl">{mile.nextUp.icon}</span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-zinc-100">{mile.nextUp.label}</p>
                    <p className="text-[10px] text-zinc-500">{mile.nextUp.blurb}</p>
                    <div className="mt-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-yellow-500" style={{ width: `${Math.round(mile.nextUp.progress * 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-[11px] text-zinc-400">{mile.nextUp.value}/{mile.nextUp.threshold}</span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {mile.badges.filter((b) => b.id !== mile.nextUp?.id).map((b) => (
                <div key={b.id}
                  className={cn('rounded-lg border p-2 text-center',
                    b.unlocked ? 'bg-yellow-950/30 border-yellow-800/50' : 'bg-zinc-950/40 border-zinc-900')}>
                  <div className={cn('text-2xl mb-0.5', !b.unlocked && 'grayscale opacity-40')}>{b.icon}</div>
                  <p className="text-[10px] font-semibold text-zinc-200 leading-tight">{b.label}</p>
                  {b.unlocked
                    ? <p className="text-[9px] text-emerald-400 inline-flex items-center gap-0.5 mt-0.5"><Check className="w-2.5 h-2.5" />done</p>
                    : <p className="text-[9px] text-zinc-400 mt-0.5">{b.value}/{b.threshold}</p>}
                  {/* The rule, stated where the tile renders (F8) —
                      Explorer is distinct kinds of practice. */}
                  <p className="text-[9px] text-zinc-500 mt-0.5">
                    {b.kind === 'sessions' && `Sit ${b.threshold} sessions`}
                    {b.kind === 'minutes' && `Practise ${b.threshold} minutes in total`}
                    {b.kind === 'streak' && `Practise ${b.threshold} days running`}
                    {b.kind === 'categories' && `Practise ${b.threshold} kinds of session`}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-zinc-400">No milestones available.</p>
        )}
      </div>
    </div>
  );
}
