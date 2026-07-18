'use client';

/**
 * ActivityWeightDashboard — PetDesk / Apple-Health-style wellness rings
 * for the selected pet: a computed activity score and an assessed weight
 * trend (ideal range, condition, alerts) layered on top of the pet's
 * REAL activity/weight history.
 *
 * Rebuilt (Frontend Rebuild Program, Wave 2) to take the selected pet as
 * a PROP from PetCareSection's single real pet picker, and to source
 * activity/weight history via `pets.activity-history`/`pets.weight-history`
 * (both already petId-scoped) instead of the fake `useLensData('pets',
 * 'ActivityLog'/'HealthRecord')` artifact store filtered by a brittle
 * case-insensitive `petName` string match — see
 * docs/lens-specs/pets-capability-map.md for the audit that found the
 * previous version's fake source could never contain a record actually
 * logged through the real Health/Wellness tabs, and vice versa.
 *
 * Backend (unchanged): pets.activityScore + pets.weightTracker.
 */

import { useEffect, useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Heart, Loader2, TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { ErrorState } from '@/components/ui';

export interface ActivityWeightDashboardProps {
  petId: string;
  petName: string;
  species: string;
  ageYears?: number | null;
  weightKg?: number;
}

interface ActivityEntry { kind: string; durationMin: number; date: string }
interface WeightEntry { date: string; weightKg: number }
interface ActivityResult { dailyTarget?: number; dailyAverage?: number; weeklyTotal?: number; score?: number; rating?: string; activitiesThisWeek?: number; typeBreakdown?: Record<string, number>; recommendations?: string[] }
interface WeightResult { currentWeight?: number; idealRange?: { min: number; max: number; note: string }; condition?: string; trend?: string; weeklyChange?: number; alerts?: string[]; recommendation?: string }

async function callPets<T>(action: string, artifact: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('pets', action, { input: { artifact } });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

function Ring({ percent, size = 120, stroke = 11, colour }: { percent: number; size?: number; stroke?: number; colour: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, percent) / 100) * circumference;
  return (
    <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${Math.round(percent)} percent`}>
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(63, 63, 70, 0.5)" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={radius} stroke={colour} strokeWidth={stroke} fill="none" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function WeightChart({ history, ideal }: { history: WeightEntry[]; ideal?: { min: number; max: number } }) {
  if (history.length < 2) return <div className="text-[10px] text-zinc-400">Need 2+ weigh-ins for a chart — log them in the Wellness tab.</div>;
  const values = history.map((h) => h.weightKg);
  const min = Math.min(...values, ideal?.min || values[0]);
  const max = Math.max(...values, ideal?.max || values[0]);
  const range = max - min || 1;
  const width = 280;
  const height = 80;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => `${i * stepX},${height - ((v - min) / range) * (height - 10) - 5}`).join(' ');
  const idealMinY = ideal ? height - ((ideal.min - min) / range) * (height - 10) - 5 : null;
  const idealMaxY = ideal ? height - ((ideal.max - min) / range) * (height - 10) - 5 : null;
  return (
    <svg width={width} height={height} className="overflow-visible">
      {idealMinY != null && idealMaxY != null && (
        <rect x={0} y={Math.min(idealMinY, idealMaxY)} width={width} height={Math.abs(idealMaxY - idealMinY)} fill="rgba(34, 197, 94, 0.08)" />
      )}
      <polyline fill="none" stroke="#a78bfa" strokeWidth={2} points={points} />
      {values.map((v, i) => (
        <circle key={i} cx={i * stepX} cy={height - ((v - min) / range) * (height - 10) - 5} r={3} fill="#a78bfa" />
      ))}
    </svg>
  );
}

const SPECIES_EMOJI: Record<string, string> = { dog: '🐕', cat: '🐈', rabbit: '🐇', bird: '🦜', hamster: '🐹', fish: '🐟' };

export function ActivityWeightDashboard({ petId, petName, species, ageYears, weightKg }: ActivityWeightDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [activity, setActivity] = useState<ActivityResult | null>(null);
  const [weight, setWeight] = useState<WeightResult | null>(null);

  const speciesKey = (species || 'dog').toLowerCase();
  // pets.weightTracker's idealRanges table is in pounds; the real pet
  // record + weight-history entries store kg.
  const kgToLbs = (kg: number) => Math.round(kg * 2.20462 * 10) / 10;

  const refresh = useCallback(async () => {
    if (!petId) return;
    setLoading(true);
    const [a, w] = await Promise.all([
      lensRun('pets', 'activity-history', { petId }),
      lensRun('pets', 'weight-history', { petId }),
    ]);
    if (a.data?.ok === false || w.data?.ok === false) {
      setLoadError(a.data?.error || w.data?.error || `Could not load ${petName}'s history.`);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setActivities(a.data?.result?.activities || []);
    setWeights(w.data?.result?.series || []);
    setLoading(false);
  }, [petId, petName]);

  useEffect(() => { void refresh(); setActivity(null); setWeight(null); }, [refresh]);

  const analyze = useMutation({
    mutationFn: async () => {
      const acts = activities.map((a) => ({ date: a.date, duration: a.durationMin, type: a.kind }));
      const weightHistory = weights.map((w) => ({ date: w.date, weight: kgToLbs(w.weightKg) }));
      const currentWeightLbs = weightHistory[weightHistory.length - 1]?.weight ?? (weightKg ? kgToLbs(weightKg) : 0);
      const [a, w] = await Promise.all([
        callPets<ActivityResult>('activityScore', { data: { species: speciesKey, age: ageYears ?? 3, weight: currentWeightLbs, activities: acts } }),
        callPets<WeightResult>('weightTracker', { data: { species: speciesKey, weight: currentWeightLbs, weightHistory } }),
      ]);
      setActivity(a);
      setWeight(w);
    },
  });

  const ringColour = activity?.score != null && activity.score >= 80 ? '#22c55e' : activity?.score != null && activity.score >= 50 ? '#eab308' : '#ef4444';
  const trendIcon = weight?.trend === 'gaining' ? <TrendingUp className="h-4 w-4 text-amber-400" /> : weight?.trend === 'losing' ? <TrendingDown className="h-4 w-4 text-blue-400" /> : <Minus className="h-4 w-4 text-zinc-400" />;

  if (loading) {
    return <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" />Loading {petName}'s history…</div>;
  }
  if (loadError) {
    return <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><ErrorState message={loadError} onRetry={refresh} variant="inline" /></div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900">
      <div className="flex flex-wrap items-center gap-4 border-b border-zinc-800 bg-zinc-900/40 p-4">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-rose-500/30 to-amber-500/30 text-2xl">
          {SPECIES_EMOJI[speciesKey] || '🐾'}
        </div>
        <div className="flex-1 space-y-1">
          <div className="text-lg font-semibold text-white">{petName}</div>
          <div className="text-xs text-zinc-400">{species} {ageYears != null && `· ${ageYears}y`} {weightKg != null && `· ${weightKg} kg`}</div>
        </div>
        <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending}
          className="rounded-full bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-50">
          {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Compute wellness'}
        </button>
        {(activity || weight) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-pets-petdesk-dashboard"
            title={`${petName} (${species}) — activity ${activity?.score ?? '—'}/100 · weight ${weight?.currentWeight ?? '—'} lb ${weight?.trend ?? ''}`}
            content={`Pet: ${petName} (${species}${ageYears != null ? `, ${ageYears} years` : ''})\n\nActivity (last 7d, from ${activities.length} logged entries):\n  Score: ${activity?.score}/100 (${activity?.rating})\n  Daily avg: ${activity?.dailyAverage} min / target ${activity?.dailyTarget} min\n  Weekly total: ${activity?.weeklyTotal} min\n  ${(activity?.recommendations || []).join(' ')}\n\nWeight (from ${weights.length} weigh-ins):\n  Current: ${weight?.currentWeight} lb (ideal ${weight?.idealRange?.min}–${weight?.idealRange?.max})\n  Condition: ${weight?.condition} · Trend: ${weight?.trend} (${weight?.weeklyChange} lb/week)\n  ${(weight?.alerts || []).join(' ')}`}
            extraTags={['pets', speciesKey, 'wellness']}
            rawData={{ petId, activities, weights, activity, weight }}
          />
        )}
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-400">
            <span className="flex items-center gap-2"><Activity className="h-3 w-3" />Weekly activity</span>
            <span className="text-[10px] text-zinc-400">{activities.length} logged</span>
          </div>
          {activities.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No care-log entries yet — log walks/play in the Wellness tab.</div>
          ) : !activity ? (
            <div className="text-[11px] text-zinc-400">Click "Compute wellness" to score the last 7 days.</div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div className="relative grid place-items-center">
                  <Ring percent={activity.score ?? 0} colour={ringColour} />
                  <div className="absolute text-center">
                    <div className="font-mono text-3xl text-white">{activity.score ?? '—'}</div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-400">score</div>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-400">Daily avg</div>
                    <div className="font-mono text-sm text-rose-200">{activity.dailyAverage ?? '—'} <span className="text-[10px] text-zinc-400">/ {activity.dailyTarget ?? '—'} min target</span></div>
                  </div>
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-400">Week total</div>
                    <div className="font-mono text-sm text-rose-200">{activity.weeklyTotal ?? '—'} min</div>
                  </div>
                </div>
              </div>
              {activity.typeBreakdown && Object.keys(activity.typeBreakdown).length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {Object.entries(activity.typeBreakdown).map(([k, v]) => (
                    <span key={k} className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200">{k}: {v}</span>
                  ))}
                </div>
              )}
              {activity.recommendations && activity.recommendations.length > 0 && (
                <div className="text-[11px] text-zinc-400">{activity.recommendations[0]}</div>
              )}
            </>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-400">
            <span className="flex items-center gap-2"><Heart className="h-3 w-3" />Weight trend</span>
            <span className="text-[10px] text-zinc-400">{weights.length} weigh-ins</span>
          </div>
          {weights.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No weigh-ins yet — log one in the Wellness tab.</div>
          ) : !weight ? (
            <div className="text-[11px] text-zinc-400">Click "Compute wellness" to assess the trend.</div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="font-mono text-3xl text-white">{weight.currentWeight ?? '—'} <span className="text-sm text-zinc-400">lb</span></div>
                {weight.trend && <div className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300">{trendIcon}{weight.trend}</div>}
              </div>
              {weight.idealRange && (
                <div className="text-[10px] text-zinc-400">Ideal range: <span className="text-emerald-300">{weight.idealRange.min}–{weight.idealRange.max} lb</span> · {weight.idealRange.note}</div>
              )}
              <div className="overflow-x-auto">
                <WeightChart history={weights} ideal={weight.idealRange ? { min: weight.idealRange.min, max: weight.idealRange.max } : undefined} />
              </div>
              {weight.weeklyChange != null && (
                <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-[11px]">
                  <span className="text-zinc-400">Weekly change: </span>
                  <span className={`font-mono ${weight.weeklyChange > 0.3 ? 'text-amber-300' : weight.weeklyChange < -0.3 ? 'text-blue-300' : 'text-emerald-300'}`}>
                    {weight.weeklyChange > 0 ? '+' : ''}{weight.weeklyChange} lb
                  </span>
                </div>
              )}
              {weight.alerts && weight.alerts.length > 0 && (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">{weight.alerts[0]}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
