'use client';

/**
 * PetCarePlanner — feeding plan, vaccination schedule, medication-dose
 * reminders, and a manual vet-cost estimator for the selected pet.
 *
 * Rebuilt (Frontend Rebuild Program, Wave 2) to take the selected pet as
 * a PROP from PetCareSection's single real pet picker (`pets.pet-list`)
 * instead of maintaining its own duplicate selector backed by the fake
 * `useLensData('pets','PetProfile')` artifact store — see
 * docs/lens-specs/pets-capability-map.md for the audit that found the
 * previous version computed real plans from fabricated, never-persisted
 * pet records.
 *
 * Backend: pets.feedingPlan, pets.vaccinationSchedule (species/age/weight
 * inputs from the real pet), pets.medicationReminder (fed the pet's REAL
 * active medications via pets.medication-list — a previously zero-caller
 * macro), and pets.vetCostAnalysis. vetCostAnalysis takes a caller-supplied
 * `expenses[]` array with per-entry dates; pets.js exposes only an
 * aggregate `expense-summary` (no raw per-entry list macro), so this stays
 * an honestly-labeled manual "what-if" calculator rather than silently
 * feeding it a single synthesized entry per category (which would present
 * a monthly-average/trend computed from fabricated dates as if real).
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Wand2, Syringe, Utensils, Pill, Receipt, Plus, Trash2 } from 'lucide-react';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { ErrorState } from '@/components/ui';

export interface PetCarePlannerProps {
  petId: string;
  petName: string;
  species: string;
  weightKg?: number;
  ageYears?: number | null;
}

interface FeedingResult {
  dailyCalories?: number;
  portions?: { cupsPerDay?: number; mealsPerDay?: number; cupsPerMeal?: number; note?: string };
  tips?: string[];
}
interface VaccineScheduleEntry { vaccine: string; status: string; nextDue: string; daysUntilDue: number }
interface VaccineScheduleResult { vaccinations?: VaccineScheduleEntry[]; summary?: { total: number; current: number; overdue: number } }
interface MedReminderEntry { medication: string; status: string; action: string; hoursUntilDue?: number }
interface MedReminderResult { medications?: MedReminderEntry[]; overdue?: number; dueNow?: number; onTrack?: number }
interface CostCategory { category: string; total: number; percentage: number }
interface CostResult { annualTotal?: number; monthlyAverage?: number; projectedAnnual?: number; byCategory?: CostCategory[]; savings?: string[]; message?: string }

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

const STATUS_TONE: Record<string, string> = {
  overdue: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
  'due-now': 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  'on-track': 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  unscheduled: 'text-zinc-400 border-zinc-700 bg-zinc-900/60',
  'no-record': 'text-zinc-400 border-zinc-700 bg-zinc-900/60',
};

const EXPENSE_CATEGORIES = ['Vet', 'Food', 'Medication', 'Grooming', 'Insurance', 'Boarding', 'Other'];

export function PetCarePlanner({ petId, petName, species, weightKg, ageYears }: PetCarePlannerProps) {
  const [feeding, setFeeding] = useState<FeedingResult | null>(null);
  const [vaccines, setVaccines] = useState<VaccineScheduleResult | null>(null);
  const [medReminders, setMedReminders] = useState<MedReminderResult | null>(null);
  const [medError, setMedError] = useState<string | null>(null);
  const [costResult, setCostResult] = useState<CostResult | null>(null);
  const [costRows, setCostRows] = useState<Array<{ date: string; category: string; amount: string }>>([
    { date: new Date().toISOString().slice(0, 10), category: 'Vet', amount: '' },
  ]);

  const speciesKey = (species || 'dog').toLowerCase();
  // pets.feedingPlan's RER formula (`weight / 2.205`) and pets.weightTracker's
  // idealRanges table both expect pounds; the real pet record stores kg.
  const weightLbs = weightKg ? Math.round(weightKg * 2.20462 * 10) / 10 : 0;

  const compute = useMutation({
    mutationFn: async () => {
      const artifact = { data: { species: speciesKey, weight: weightLbs, age: ageYears ?? 1, activityLevel: 'moderate' } };
      const [f, v] = await Promise.all([
        callPets<FeedingResult>('feedingPlan', { artifact }),
        callPets<VaccineScheduleResult>('vaccinationSchedule', { artifact }),
      ]);
      setFeeding(f);
      setVaccines(v);
    },
  });

  const computeMeds = useMutation({
    mutationFn: async () => {
      const m = await lensRun('pets', 'medication-list', { petId });
      if (m.data?.ok === false) {
        setMedError(m.data?.error || `Could not load ${petName}'s medications.`);
        setMedReminders(null);
        return;
      }
      setMedError(null);
      const active: Array<{ name: string; frequency: string | null; startDate: string }> =
        (m.data?.result?.medications || []).filter((x: { active: boolean }) => x.active);
      if (active.length === 0) { setMedReminders({ medications: [], overdue: 0, dueNow: 0, onTrack: 0 }); return; }
      const artifact = {
        data: {
          medications: active.map((a) => a.name).join(','),
          schedules: active.map((a) => ({ med: a.name, frequency: a.frequency || 'daily', lastDose: a.startDate })),
        },
      };
      const r = await callPets<MedReminderResult>('medicationReminder', { artifact });
      setMedReminders(r);
    },
  });

  const computeCost = useMutation({
    mutationFn: async () => {
      const expenses = costRows
        .filter((r) => Number(r.amount) > 0)
        .map((r) => ({ date: r.date, category: r.category, amount: Number(r.amount) }));
      if (expenses.length === 0) { setCostResult({ message: 'Add at least one cost line to analyse.' }); return; }
      const r = await callPets<CostResult>('vetCostAnalysis', { artifact: { data: { expenses } } });
      setCostResult(r);
    },
  });

  const addCostRow = () => setCostRows((rows) => [...rows, { date: new Date().toISOString().slice(0, 10), category: 'Vet', amount: '' }]);
  const removeCostRow = (i: number) => setCostRows((rows) => rows.filter((_, idx) => idx !== i));
  const updateCostRow = (i: number, patch: Partial<{ date: string; category: string; amount: string }>) =>
    setCostRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            pets.feedingPlan · vaccinationSchedule · medicationReminder · vetCostAnalysis
          </span>
        </div>
        {(feeding || vaccines) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-pets-care"
            title={`${petName} care plan — ${weightKg ?? '—'}kg, ${speciesKey}`}
            content={`Pet: ${petName}\nSpecies: ${speciesKey}\nWeight: ${weightKg ?? '—'} kg\n\nFeeding:\n  Daily calories: ${feeding?.dailyCalories ?? '—'}\n  Meals/day: ${feeding?.portions?.mealsPerDay ?? '—'}\n\nVaccinations:\n${(vaccines?.vaccinations || []).map((v) => `  ${v.vaccine} (${v.status}) — next due ${v.nextDue}`).join('\n')}`}
            extraTags={['pets', speciesKey, 'care-plan']}
            rawData={{ petId, feeding, vaccines }}
          />
        )}
      </header>

      <button
        type="button"
        onClick={() => compute.mutate()}
        disabled={compute.isPending}
        className="inline-flex items-center justify-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-mono text-rose-200 hover:bg-rose-500/25 disabled:opacity-50"
      >
        {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
        Plan feeding &amp; vaccinations
      </button>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Utensils className="h-3 w-3" />Feeding plan</div>
          {!feeding && <div className="text-[11px] text-zinc-400">Click "Plan" to compute from {petName}'s species/weight.</div>}
          {feeding && (
            <div className="space-y-1.5 text-[11px]">
              <div className="grid grid-cols-3 gap-1">
                <div className="rounded border border-rose-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Daily</div><div className="font-mono text-rose-200">{feeding.dailyCalories ?? '—'} kcal</div></div>
                <div className="rounded border border-rose-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Meals</div><div className="font-mono text-rose-200">{feeding.portions?.mealsPerDay ?? '—'}/d</div></div>
                <div className="rounded border border-rose-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Cups/meal</div><div className="font-mono text-rose-200">{feeding.portions?.cupsPerMeal ?? '—'}</div></div>
              </div>
              {feeding.tips && feeding.tips.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-zinc-300">
                  {feeding.tips.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Syringe className="h-3 w-3" />Vaccination schedule</div>
          {!vaccines && <div className="text-[11px] text-zinc-400">Click "Plan" to compute.</div>}
          {vaccines && (
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {(vaccines.vaccinations || []).map((v, i) => (
                <div key={`${v.vaccine}-${i}`} className={`flex items-center justify-between rounded border px-2 py-1 text-[10px] ${STATUS_TONE[v.status] || 'border-zinc-700 bg-zinc-900/60 text-zinc-300'}`}>
                  <span className="text-zinc-100">{v.vaccine}</span>
                  <span className="font-mono">{v.status === 'overdue' ? 'overdue' : v.nextDue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Pill className="h-3 w-3" />Medication dose reminders</div>
          <button type="button" onClick={() => computeMeds.mutate()} disabled={computeMeds.isPending}
            className="inline-flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/15 px-2 py-1 text-[10px] text-violet-200 hover:bg-violet-500/25 disabled:opacity-50">
            {computeMeds.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} Check doses
          </button>
        </div>
        {medError && <ErrorState message={medError} onRetry={() => computeMeds.mutate()} variant="inline" />}
        {!medError && !medReminders && <div className="text-[11px] text-zinc-400">Computes real per-dose overdue/due-now status from {petName}'s active medications.</div>}
        {medReminders && medReminders.medications && medReminders.medications.length === 0 && (
          <div className="text-[11px] text-zinc-400">No active medications on file for {petName}.</div>
        )}
        {medReminders && medReminders.medications && medReminders.medications.length > 0 && (
          <ul className="space-y-1">
            {medReminders.medications.map((m, i) => (
              <li key={`${m.medication}-${i}`} className={`flex items-center justify-between rounded border px-2 py-1 text-[10px] ${STATUS_TONE[m.status] || 'border-zinc-700 bg-zinc-900/60 text-zinc-300'}`}>
                <span className="text-zinc-100">{m.medication}</span>
                <span>{m.action}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Receipt className="h-3 w-3" />Cost estimator (manual — not tied to logged expenses)</div>
        <p className="text-[10px] text-zinc-400 mb-2">
          Enter a few cost lines to project annual spend. This is a what-if calculator; the Reminders tab's real "Expenses" total is separate.
        </p>
        <div className="space-y-1.5">
          {costRows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
              <input type="date" value={row.date} onChange={(e) => updateCostRow(i, { date: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
              <select value={row.category} onChange={(e) => updateCostRow(i, { category: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100">
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="Amount ($)" inputMode="decimal" value={row.amount} onChange={(e) => updateCostRow(i, { amount: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
              <button type="button" onClick={() => removeCostRow(i)} disabled={costRows.length === 1} aria-label="Remove row"
                className="text-zinc-500 hover:text-rose-400 disabled:opacity-30 px-1"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button type="button" onClick={addCostRow} className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200">
            <Plus className="h-3 w-3" /> Add line
          </button>
          <button type="button" onClick={() => computeCost.mutate()} disabled={computeCost.isPending}
            className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50">
            {computeCost.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} Analyse
          </button>
        </div>
        {costResult && (
          costResult.message ? (
            <p className="mt-2 text-[11px] text-zinc-400">{costResult.message}</p>
          ) : (
            <div className="mt-2 space-y-1.5 text-[11px]">
              <div className="grid grid-cols-3 gap-1">
                <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Annual (12mo window)</div><div className="font-mono text-emerald-200">${costResult.annualTotal ?? 0}</div></div>
                <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Monthly avg</div><div className="font-mono text-emerald-200">${costResult.monthlyAverage ?? 0}</div></div>
                <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Projected/yr</div><div className="font-mono text-emerald-200">${costResult.projectedAnnual ?? 0}</div></div>
              </div>
              {costResult.byCategory && costResult.byCategory.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {costResult.byCategory.map((c) => (
                    <span key={c.category} className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[10px] text-emerald-200">
                      {c.category}: ${c.total} ({c.percentage}%)
                    </span>
                  ))}
                </div>
              )}
              {costResult.savings && costResult.savings.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-zinc-300">
                  {costResult.savings.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
