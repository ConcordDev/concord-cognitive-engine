'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Heart, Loader2, Wand2, Syringe, Utensils } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface FeedingResult { dailyCalories?: number; mealsPerDay?: number; gramsPerMeal?: number; recommendations?: string[]; species?: string; weight?: number }
interface VaccineEntry { name: string; due?: string; dueAt?: string; ageMonths?: number; status?: string }
interface VaccineResult { upcoming?: VaccineEntry[]; overdue?: VaccineEntry[]; completed?: VaccineEntry[]; schedule?: VaccineEntry[] }

async function callPets<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('pets', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

const ACTIVITY = ['low', 'moderate', 'high'] as const;

export function PetCarePlanner() {
  const [species, setSpecies] = useState<'dog' | 'cat'>('dog');
  const [weight, setWeight] = useState(15);
  const [age, setAge] = useState(3);
  const [activity, setActivity] = useState<typeof ACTIVITY[number]>('moderate');
  const [feeding, setFeeding] = useState<FeedingResult | null>(null);
  const [vaccines, setVaccines] = useState<VaccineResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const artifact = { data: { species, weight, age, activityLevel: activity } };
      const [f, v] = await Promise.all([
        callPets<FeedingResult>('feedingPlan', { artifact }),
        callPets<VaccineResult>('vaccinationSchedule', { artifact }),
      ]);
      setFeeding(f);
      setVaccines(v);
      return { f, v };
    },
  });

  const allVaccines = vaccines ? [...(vaccines.upcoming || []), ...(vaccines.overdue || []), ...(vaccines.schedule || [])] : [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-rose-400" />
          <h2 className="text-sm font-semibold text-white">Pet care planner</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">pets.feedingPlan + vaccinationSchedule</span>
        </div>
        {(feeding || vaccines) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-pets-care"
            title={`${species} care plan — ${weight}kg, ${age}y, ${activity}`}
            content={`Species: ${species}\nWeight: ${weight} kg\nAge: ${age} y\nActivity: ${activity}\n\nFeeding:\n  Daily calories: ${feeding?.dailyCalories ?? '—'}\n  Meals/day: ${feeding?.mealsPerDay ?? '—'}\n  Grams/meal: ${feeding?.gramsPerMeal ?? '—'}\n${feeding?.recommendations?.length ? `\nRecommendations:\n${feeding.recommendations.map((r) => `  - ${r}`).join('\n')}` : ''}\n\nVaccinations:\n${allVaccines.map((v) => `  ${v.name}${v.status ? ` (${v.status})` : ''}${v.due ? ` — due ${v.due}` : ''}`).join('\n')}`}
            extraTags={['pets', species, 'care-plan']}
            rawData={{ inputs: { species, weight, age, activity }, feeding, vaccines }}
          />
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Species</span>
          <select value={species} onChange={(e) => setSpecies(e.target.value as 'dog' | 'cat')} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            <option value="dog">Dog</option>
            <option value="cat">Cat</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Weight (kg)</span>
          <input type="number" min={0.5} max={100} step={0.5} value={weight} onChange={(e) => setWeight(Math.max(0.5, Math.min(100, Number(e.target.value) || 15)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Age (yrs)</span>
          <input type="number" min={0} max={30} step={0.5} value={age} onChange={(e) => setAge(Math.max(0, Math.min(30, Number(e.target.value) || 3)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Activity</span>
          <select value={activity} onChange={(e) => setActivity(e.target.value as typeof ACTIVITY[number])} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {ACTIVITY.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="mt-auto inline-flex items-center justify-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-mono text-rose-200 hover:bg-rose-500/25 disabled:opacity-50">
          {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Plan
        </button>
      </div>

      {compute.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Plan generation failed.</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Utensils className="h-3 w-3" />Feeding plan</div>
          {!feeding && <div className="text-[11px] text-zinc-500">Click Plan to compute.</div>}
          {feeding && (
            <div className="space-y-1.5 text-[11px]">
              <div className="grid grid-cols-3 gap-1">
                <div className="rounded border border-rose-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Daily</div><div className="font-mono text-rose-200">{feeding.dailyCalories ?? '—'} kcal</div></div>
                <div className="rounded border border-rose-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Meals</div><div className="font-mono text-rose-200">{feeding.mealsPerDay ?? '—'}/d</div></div>
                <div className="rounded border border-rose-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Per meal</div><div className="font-mono text-rose-200">{feeding.gramsPerMeal ?? '—'} g</div></div>
              </div>
              {feeding.recommendations && feeding.recommendations.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-zinc-300">
                  {feeding.recommendations.slice(0, 5).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Syringe className="h-3 w-3" />Vaccination schedule</div>
          {!vaccines && <div className="text-[11px] text-zinc-500">Click Plan to compute.</div>}
          {vaccines && (
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {vaccines.overdue && vaccines.overdue.length > 0 && (
                <div>
                  <div className="mb-0.5 text-[9px] uppercase tracking-wider text-rose-300">Overdue ({vaccines.overdue.length})</div>
                  {vaccines.overdue.map((v, i) => (
                    <div key={`o-${i}`} className="flex items-center justify-between rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px]"><span className="text-zinc-100">{v.name}</span>{v.due && <span className="font-mono text-rose-200">{v.due}</span>}</div>
                  ))}
                </div>
              )}
              {vaccines.upcoming && vaccines.upcoming.length > 0 && (
                <div>
                  <div className="mb-0.5 mt-1 text-[9px] uppercase tracking-wider text-amber-300">Upcoming ({vaccines.upcoming.length})</div>
                  {vaccines.upcoming.map((v, i) => (
                    <div key={`u-${i}`} className="flex items-center justify-between rounded border border-amber-500/15 bg-amber-500/5 px-2 py-1 text-[10px]"><span className="text-zinc-100">{v.name}</span>{v.due && <span className="font-mono text-amber-200">{v.due}</span>}</div>
                  ))}
                </div>
              )}
              {vaccines.schedule && (!vaccines.upcoming || vaccines.upcoming.length === 0) && (!vaccines.overdue || vaccines.overdue.length === 0) && (
                <div>
                  {vaccines.schedule.slice(0, 8).map((v, i) => (
                    <div key={`s-${i}`} className="flex items-center justify-between rounded border border-amber-500/15 bg-amber-500/5 px-2 py-1 text-[10px]"><span className="text-zinc-100">{v.name}</span>{v.ageMonths != null && <span className="font-mono text-amber-200">~{v.ageMonths} mo</span>}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
