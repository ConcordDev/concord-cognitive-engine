'use client';

/**
 * ActivityWeightDashboard — PetDesk / Apple-Health-style wellness
 * dashboard. Pulls the user's REAL data:
 *
 *   • `useLensData<PetArtifact>('pets', 'PetProfile')` — list of the
 *     user's actual pets; the panel picks the active one via a selector
 *   • `useLensData<PetArtifact>('pets', 'ActivityLog')` — real walks /
 *     play sessions logged through the lens
 *   • `useLensData<PetArtifact>('pets', 'HealthRecord')` — real weigh-ins
 *
 * No seed defaults. Empty state nudges the user to create their first
 * pet via the existing lens CRUD editor (kept as the create surface so
 * this panel stays read-mostly + analyze).
 *
 * Backend (no changes): pets.activityScore + pets.weightTracker
 * macros for the metrics; substrate `useLensData` for the records.
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Heart, Loader2, TrendingUp, TrendingDown, Minus, Activity, PawPrint } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useLensData, type LensItem } from '@/lib/hooks/use-lens-data';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface PetArtifact {
  name?: string; species?: string; age?: number; weight?: number;
  petName?: string; type?: string;
  date?: string; duration?: number; activityType?: string;
  vaccineDate?: string;
}

interface ActivityResult { dailyTarget?: number; dailyAvg?: number; weeklyTotal?: number; score?: number; rating?: string; activityCount?: number; typeBreakdown?: Record<string, number>; recommendation?: string }
interface WeightResult { currentWeight?: number; idealRange?: { min: number; max: number; note: string }; status?: string; trend?: string; weeklyChangeLbs?: number; historyPoints?: number; alert?: string }

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

const SPECIES_EMOJI: Record<string, string> = { Dog: '🐕', Cat: '🐈', Rabbit: '🐇', Bird: '🦜', Hamster: '🐹', Fish: '🐟' };

function Ring({ percent, size = 140, stroke = 12, colour }: { percent: number; size?: number; stroke?: number; colour: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, percent) / 100) * circumference;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(63, 63, 70, 0.5)" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={radius} stroke={colour} strokeWidth={stroke} fill="none" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function WeightChart({ history, ideal }: { history: Array<{ date: string; weight: number }>; ideal?: { min: number; max: number } }) {
  if (history.length < 2) return <div className="text-[10px] text-zinc-500">Need 2+ weigh-ins (HealthRecord with weight) for chart.</div>;
  const values = history.map((h) => h.weight);
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

export function ActivityWeightDashboard() {
  const { items: pets, isLoading: petsLoading } = useLensData<PetArtifact>('pets', 'PetProfile', { seed: [] });
  const { items: activityLogs } = useLensData<PetArtifact>('pets', 'ActivityLog', { seed: [] });
  const { items: healthRecords } = useLensData<PetArtifact>('pets', 'HealthRecord', { seed: [] });

  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityResult | null>(null);
  const [weight, setWeight] = useState<WeightResult | null>(null);

  const activePet: LensItem<PetArtifact> | null = useMemo(() => {
    if (!pets.length) return null;
    return pets.find((p) => p.id === selectedPetId) || pets[0];
  }, [pets, selectedPetId]);

  // Filter activity logs + health records to the active pet (by petName field on the artifact)
  const petActivities = useMemo(() => {
    if (!activePet) return [];
    const name = activePet.data.name || activePet.title;
    return activityLogs.filter((a) => (a.data.petName || '').toLowerCase() === (name || '').toLowerCase());
  }, [activePet, activityLogs]);

  const petWeights = useMemo(() => {
    if (!activePet) return [];
    const name = activePet.data.name || activePet.title;
    return healthRecords
      .filter((h) => (h.data.petName || '').toLowerCase() === (name || '').toLowerCase() && typeof h.data.weight === 'number')
      .map((h) => ({ date: h.data.vaccineDate || h.createdAt.slice(0, 10), weight: h.data.weight as number }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [activePet, healthRecords]);

  const analyze = useMutation({
    mutationFn: async () => {
      if (!activePet) return null;
      const d = activePet.data;
      const acts = petActivities.map((a) => ({
        date: a.data.date || a.createdAt.slice(0, 10),
        duration: a.data.duration || 0,
        type: a.data.activityType || 'walk',
      }));
      const weightHistory = petWeights.map((w) => ({ date: w.date, weight: w.weight }));
      const currentWeight = weightHistory[weightHistory.length - 1]?.weight ?? d.weight ?? 0;
      const species = (d.species || 'dog').toLowerCase();
      const [a, w] = await Promise.all([
        callPets<ActivityResult>('activityScore', { data: { species, age: d.age ?? 3, weight: currentWeight, activities: acts } }),
        callPets<WeightResult>('weightTracker', { data: { species, weight: currentWeight, weightHistory } }),
      ]);
      setActivity(a);
      setWeight(w);
      return { a, w };
    },
  });

  const ringColour = activity?.score && activity.score >= 80 ? '#22c55e' : activity?.score && activity.score >= 50 ? '#eab308' : '#ef4444';
  const trendIcon = weight?.trend === 'gaining' ? <TrendingUp className="h-4 w-4 text-amber-400" /> : weight?.trend === 'losing' ? <TrendingDown className="h-4 w-4 text-blue-400" /> : <Minus className="h-4 w-4 text-zinc-400" />;

  // Empty state: no pets yet
  if (!petsLoading && pets.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-8 text-center">
        <PawPrint className="mx-auto h-8 w-8 text-zinc-600" />
        <div className="mt-3 text-sm text-zinc-300">No pets in your library yet.</div>
        <div className="mt-1 text-xs text-zinc-500">Add a PetProfile via the lens's "New" button above. Once you have a pet plus some ActivityLog and HealthRecord entries, this dashboard will surface your real wellness data.</div>
      </div>
    );
  }

  if (petsLoading) {
    return <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Loading your pets…</div>;
  }

  const d = activePet?.data || {};
  const speciesKey = (d.species || 'Dog');

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900">
      <div className="flex flex-wrap items-center gap-4 border-b border-zinc-800 bg-zinc-900/40 p-4">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-rose-500/30 to-amber-500/30 text-3xl">
          {SPECIES_EMOJI[speciesKey] || '🐾'}
        </div>
        <div className="flex-1 space-y-1">
          {pets.length > 1 ? (
            <select value={activePet?.id || ''} onChange={(e) => setSelectedPetId(e.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xl font-semibold text-white">
              {pets.map((p) => <option key={p.id} value={p.id}>{p.data.name || p.title}</option>)}
            </select>
          ) : (
            <div className="text-xl font-semibold text-white">{d.name || activePet?.title}</div>
          )}
          <div className="text-xs text-zinc-400">{d.species || 'Pet'} {d.age != null && `· ${d.age}y`} {d.weight != null && `· ${d.weight} lb`}</div>
        </div>
        <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending || !activePet} className="rounded-full bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-50">
          {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Compute wellness'}
        </button>
        {(activity || weight) && activePet && (
          <SaveAsDtuButton
            compact
            apiSource="concord-pets-petdesk-dashboard"
            title={`${d.name || activePet.title} (${d.species}, ${d.age}y) — activity ${activity?.score ?? '—'}/100 · weight ${weight?.currentWeight ?? '—'} lb ${weight?.trend ?? ''}`}
            content={`Pet: ${d.name || activePet.title} (${d.species}, ${d.age} years)\n\nActivity (last 7d, from ${petActivities.length} ActivityLog records):\n  Score: ${activity?.score}/100 (${activity?.rating})\n  Daily avg: ${activity?.dailyAvg} min / target ${activity?.dailyTarget} min\n  Weekly total: ${activity?.weeklyTotal} min across ${activity?.activityCount} sessions\n  ${activity?.recommendation || ''}\n\nWeight (from ${petWeights.length} HealthRecord weigh-ins):\n  Current: ${weight?.currentWeight} lb (ideal ${weight?.idealRange?.min}–${weight?.idealRange?.max})\n  Status: ${weight?.status} · Trend: ${weight?.trend} (${weight?.weeklyChangeLbs} lb/week)\n  ${weight?.alert || ''}`}
            extraTags={['pets', (d.species || '').toLowerCase(), 'wellness']}
            rawData={{ petId: activePet.id, pet: d, activities: petActivities.map((a) => a.data), weights: petWeights, activity, weight }}
          />
        )}
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-500">
            <span className="flex items-center gap-2"><Activity className="h-3 w-3" />Weekly activity</span>
            <span className="text-[10px] text-zinc-500">{petActivities.length} logged</span>
          </div>
          {petActivities.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No ActivityLog entries for this pet yet. Log walks/play via the lens's "New" button.</div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div className="relative grid place-items-center">
                  <Ring percent={activity?.score ?? 0} colour={ringColour} />
                  <div className="absolute text-center">
                    <div className="font-mono text-3xl text-white">{activity?.score ?? '—'}</div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">score</div>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500">Daily avg</div>
                    <div className="font-mono text-sm text-rose-200">{activity?.dailyAvg ?? '—'} <span className="text-[10px] text-zinc-500">/ {activity?.dailyTarget ?? '—'} min target</span></div>
                  </div>
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500">Week total</div>
                    <div className="font-mono text-sm text-rose-200">{activity?.weeklyTotal ?? '—'} min</div>
                  </div>
                </div>
              </div>
              {activity?.typeBreakdown && Object.keys(activity.typeBreakdown).length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {Object.entries(activity.typeBreakdown).map(([k, v]) => (
                    <span key={k} className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200">{k}: {v}</span>
                  ))}
                </div>
              )}
              {activity?.recommendation && <div className="text-[11px] text-zinc-400">{activity.recommendation}</div>}
            </>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-500">
            <span className="flex items-center gap-2"><Heart className="h-3 w-3" />Weight trend</span>
            <span className="text-[10px] text-zinc-500">{petWeights.length} weigh-ins</span>
          </div>
          {petWeights.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No HealthRecord weigh-ins for this pet yet. Add records with a weight field via the lens's "New" button.</div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="font-mono text-3xl text-white">{weight?.currentWeight ?? petWeights[petWeights.length - 1]?.weight ?? '—'} <span className="text-sm text-zinc-500">lb</span></div>
                {weight?.trend && <div className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300">{trendIcon}{weight.trend}</div>}
              </div>
              {weight?.idealRange && (
                <div className="text-[10px] text-zinc-500">Ideal range: <span className="text-emerald-300">{weight.idealRange.min}–{weight.idealRange.max} lb</span> · {weight.idealRange.note}</div>
              )}
              <div className="overflow-x-auto">
                <WeightChart history={petWeights} ideal={weight?.idealRange ? { min: weight.idealRange.min, max: weight.idealRange.max } : undefined} />
              </div>
              {weight?.weeklyChangeLbs != null && (
                <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-[11px]">
                  <span className="text-zinc-500">Weekly change: </span>
                  <span className={`font-mono ${weight.weeklyChangeLbs > 0.3 ? 'text-amber-300' : weight.weeklyChangeLbs < -0.3 ? 'text-blue-300' : 'text-emerald-300'}`}>
                    {weight.weeklyChangeLbs > 0 ? '+' : ''}{weight.weeklyChangeLbs} lb
                  </span>
                </div>
              )}
              {weight?.alert && <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">{weight.alert}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
