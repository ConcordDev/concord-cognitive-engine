'use client';

/**
 * DailyRecommendationPanel — personalized daily recovery recommendation.
 * Folds today's recovery signals, sleep, strain, mood, mindfulness and
 * open thought-record patterns into one prioritized actionable plan.
 * Wired to wellness.daily-recommendation.
 */

import { useCallback, useEffect, useState } from 'react';
import { Compass, Loader2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Recommendation { priority: number; area: string; text: string }
interface Signals {
  sleepHours: number | null; hrvMs: number | null; restingHr: number | null;
  strainMin: number; avgRecentMood: number | null;
  mindfulnessSessionsToday: number; openThoughtRecords: number;
}
interface DailyRec {
  date: string; recoveryScore: number; band: 'green' | 'yellow' | 'red';
  focus: string; recommendations: Recommendation[]; signals: Signals; hasEnoughData: boolean;
}

const BAND_COLOUR: Record<string, string> = { green: '#34d399', yellow: '#fbbf24', red: '#f43f5e' };
const AREA_COLOUR: Record<string, string> = {
  training: 'bg-orange-500/15 text-orange-300',
  sleep: 'bg-indigo-500/15 text-indigo-300',
  recovery: 'bg-emerald-500/15 text-emerald-300',
  mood: 'bg-rose-500/15 text-rose-300',
  cbt: 'bg-violet-500/15 text-violet-300',
  mindfulness: 'bg-sky-500/15 text-sky-300',
  tracking: 'bg-zinc-500/15 text-zinc-300',
};

export function DailyRecommendationPanel() {
  const [rec, setRec] = useState<DailyRec | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun({ domain: 'wellness', action: 'daily-recommendation', input: {} });
    if (r.data?.ok && r.data.result) setRec(r.data.result as DailyRec);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const colour = rec ? BAND_COLOUR[rec.band] : '#71717a';

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <Compass className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Today&apos;s recommendation</h3>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
        <button type="button" onClick={refresh} disabled={loading}
          className="ml-auto p-1 text-zinc-500 hover:text-white disabled:opacity-40" title="Recompute">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </header>

      {!rec ? (
        <div className="py-6 text-center text-xs text-zinc-500">No recommendation yet.</div>
      ) : (
        <>
          <div className="rounded border border-white/10 bg-black/30 p-3 flex items-center gap-4">
            <div className="relative w-16 h-16 flex-shrink-0">
              <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
                <circle cx="32" cy="32" r="27" fill="none" stroke="#ffffff10" strokeWidth="7" />
                <circle cx="32" cy="32" r="27" fill="none" stroke={colour} strokeWidth="7" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 27}`}
                  strokeDashoffset={`${2 * Math.PI * 27 * (1 - rec.recoveryScore / 100)}`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-mono font-bold" style={{ color: colour }}>{rec.recoveryScore}</span>
                <span className="text-[7px] uppercase text-zinc-500">recovery</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold capitalize" style={{ color: colour }}>{rec.band}</div>
              <div className="text-[12px] text-zinc-200 leading-snug">{rec.focus}</div>
            </div>
          </div>

          <ul className="space-y-1.5">
            {rec.recommendations.map((r, i) => (
              <li key={i} className="rounded border border-white/10 bg-black/30 p-2.5 flex items-start gap-2">
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono flex-shrink-0',
                  AREA_COLOUR[r.area] || 'bg-zinc-500/15 text-zinc-300')}>
                  {r.area}
                </span>
                <span className="text-[11px] text-zinc-300 leading-snug">{r.text}</span>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-3 gap-2">
            <Sig label="Sleep" value={rec.signals.sleepHours !== null ? `${rec.signals.sleepHours}h` : '—'} />
            <Sig label="HRV" value={rec.signals.hrvMs !== null ? `${rec.signals.hrvMs}` : '—'} />
            <Sig label="RHR" value={rec.signals.restingHr !== null ? `${rec.signals.restingHr}` : '—'} />
            <Sig label="Strain" value={`${rec.signals.strainMin}m`} />
            <Sig label="Mindful" value={String(rec.signals.mindfulnessSessionsToday)} />
            <Sig label="Open CBT" value={String(rec.signals.openThoughtRecords)} />
          </div>
        </>
      )}
    </div>
  );
}

function Sig({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/30 p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm font-mono text-white">{value}</div>
    </div>
  );
}

export default DailyRecommendationPanel;
