'use client';

/**
 * PetCarePlanner — feeding plan + vaccination schedule pulled from the
 * user's actual PetProfile artifacts. No defaults: if the user has no
 * pets yet, the panel renders an empty-state CTA. Otherwise, picks the
 * active pet via a selector and feeds the macros real species/weight/
 * age/activity from that pet's record.
 *
 * Backend (no changes): pets.feedingPlan + pets.vaccinationSchedule.
 * Substrate: useLensData<PetArtifact>('pets', 'PetProfile').
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Heart, Loader2, Wand2, Syringe, Utensils, PawPrint } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useLensData, type LensItem } from '@/lib/hooks/use-lens-data';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface PetArtifact {
  name?: string; species?: string; age?: number; weight?: number;
  activityLevel?: 'low' | 'moderate' | 'high';
  petName?: string; type?: string;
}

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
  const { items: pets, isLoading } = useLensData<PetArtifact>('pets', 'PetProfile', { seed: [] });
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [activityOverride, setActivityOverride] = useState<typeof ACTIVITY[number] | null>(null);
  const [feeding, setFeeding] = useState<FeedingResult | null>(null);
  const [vaccines, setVaccines] = useState<VaccineResult | null>(null);

  const activePet: LensItem<PetArtifact> | null = useMemo(() => {
    if (!pets.length) return null;
    return pets.find((p) => p.id === selectedPetId) || pets[0];
  }, [pets, selectedPetId]);

  // Use pet's stored activityLevel, falling back to 'moderate' if missing. User can override per-session via the selector.
  const effectiveActivity: typeof ACTIVITY[number] = activityOverride ?? activePet?.data.activityLevel ?? 'moderate';

  const compute = useMutation({
    mutationFn: async () => {
      if (!activePet) return null;
      const d = activePet.data;
      const species = (d.species || '').toLowerCase().includes('cat') ? 'cat' : 'dog';
      const weight = typeof d.weight === 'number' ? d.weight : 0;
      const age = typeof d.age === 'number' ? d.age : 0;
      const artifact = { data: { species, weight, age, activityLevel: effectiveActivity } };
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

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Loading pets…</div>;

  if (pets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-8 text-center">
        <PawPrint className="mx-auto h-8 w-8 text-zinc-600" />
        <div className="mt-3 text-sm text-zinc-300">Add your first pet to build a care plan.</div>
        <div className="mt-1 text-xs text-zinc-500">Create a PetProfile via the "New" button above. Once saved, this panel will compute real feeding + vaccination plans from that pet's species, weight, age, and activity level.</div>
      </div>
    );
  }

  const d = activePet?.data || {};
  const hasMissingFields = typeof d.weight !== 'number' || typeof d.age !== 'number' || !d.species;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-rose-400" />
          <h2 className="text-sm font-semibold text-white">Pet care planner</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">pets.feedingPlan + vaccinationSchedule</span>
        </div>
        {(feeding || vaccines) && activePet && (
          <SaveAsDtuButton
            compact
            apiSource="concord-pets-care"
            title={`${d.name || activePet.title} care plan — ${d.weight}kg, ${d.age}y, ${effectiveActivity}`}
            content={`Pet: ${d.name || activePet.title}\nSpecies: ${d.species}\nWeight: ${d.weight} kg\nAge: ${d.age} y\nActivity: ${effectiveActivity}\n\nFeeding:\n  Daily calories: ${feeding?.dailyCalories ?? '—'}\n  Meals/day: ${feeding?.mealsPerDay ?? '—'}\n  Grams/meal: ${feeding?.gramsPerMeal ?? '—'}\n${feeding?.recommendations?.length ? `\nRecommendations:\n${feeding.recommendations.map((r) => `  - ${r}`).join('\n')}` : ''}\n\nVaccinations:\n${allVaccines.map((v) => `  ${v.name}${v.status ? ` (${v.status})` : ''}${v.due ? ` — due ${v.due}` : ''}`).join('\n')}`}
            extraTags={['pets', (d.species || '').toLowerCase(), 'care-plan']}
            rawData={{ petId: activePet.id, pet: d, activity: effectiveActivity, feeding, vaccines }}
          />
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Pet</span>
          <select value={activePet?.id || ''} onChange={(e) => { setSelectedPetId(e.target.value); setActivityOverride(null); setFeeding(null); setVaccines(null); }} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {pets.map((p) => <option key={p.id} value={p.id}>{p.data.name || p.title}{p.data.species ? ` (${p.data.species})` : ''}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Activity (override)</span>
          <select value={effectiveActivity} onChange={(e) => setActivityOverride(e.target.value as typeof ACTIVITY[number])} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {ACTIVITY.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || !activePet || hasMissingFields} className="mt-auto inline-flex items-center justify-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-mono text-rose-200 hover:bg-rose-500/25 disabled:opacity-50">
          {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Plan
        </button>
      </div>

      {hasMissingFields && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          This pet's profile is missing species, weight, or age. Edit the PetProfile above to fill them in, then return to compute.
        </div>
      )}

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
