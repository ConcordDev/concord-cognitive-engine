'use client';

/**
 * ActivityWeightDashboard — PetDesk / Apple-Health-style pet wellness
 * dashboard. Patterned on PetDesk's pet-profile + Apple Activity's
 * concentric rings: hero with pet name + species emoji, a single
 * circular progress ring for weekly activity vs target, a weight
 * trend mini-chart with ideal-range band, and an activity log feed.
 *
 * Backend (no changes): pets.activityScore + pets.weightTracker — both
 * already exist; this is pure UI wiring.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Heart, Plus, Trash2, Loader2, TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface ActivityEntry { date: string; duration: string; type: string }
interface WeightEntry { date: string; weight: string }

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

const today = new Date();
const dayOffset = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);

const SPECIES_EMOJI: Record<string, string> = { dog: '🐕', cat: '🐈', rabbit: '🐇', bird: '🦜', hamster: '🐹', fish: '🐟' };
const ACTIVITY_TYPES = ['walk', 'play', 'training', 'swim', 'fetch'];

const DEFAULT_ACTIVITIES: ActivityEntry[] = [
  { date: dayOffset(0), duration: '45', type: 'walk' },
  { date: dayOffset(1), duration: '30', type: 'play' },
  { date: dayOffset(2), duration: '60', type: 'walk' },
  { date: dayOffset(3), duration: '20', type: 'training' },
  { date: dayOffset(4), duration: '50', type: 'walk' },
  { date: dayOffset(5), duration: '35', type: 'play' },
  { date: dayOffset(6), duration: '55', type: 'walk' },
];

const DEFAULT_WEIGHT: WeightEntry[] = [
  { date: dayOffset(30), weight: '21.5' },
  { date: dayOffset(20), weight: '21.8' },
  { date: dayOffset(14), weight: '22.0' },
  { date: dayOffset(7), weight: '22.2' },
  { date: dayOffset(0), weight: '22.0' },
];

function Ring({ percent, size = 140, stroke = 12, colour = '#22d3ee' }: { percent: number; size?: number; stroke?: number; colour?: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, percent) / 100) * circumference;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(63, 63, 70, 0.5)" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        stroke={colour} strokeWidth={stroke} fill="none"
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

function WeightChart({ history, ideal }: { history: WeightEntry[]; ideal?: { min: number; max: number } }) {
  const values = history.map((h) => parseFloat(h.weight) || 0).filter((v) => v > 0);
  if (values.length < 2) return <div className="text-[10px] text-zinc-500">Need 2+ weight readings for chart.</div>;
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
  const [petName, setPetName] = useState('Biscuit');
  const [species, setSpecies] = useState<'dog' | 'cat' | 'rabbit' | 'bird' | 'hamster'>('dog');
  const [age, setAge] = useState(3);
  const [activities, setActivities] = useState<ActivityEntry[]>(DEFAULT_ACTIVITIES);
  const [weightHistory, setWeightHistory] = useState<WeightEntry[]>(DEFAULT_WEIGHT);
  const [activity, setActivity] = useState<ActivityResult | null>(null);
  const [weight, setWeight] = useState<WeightResult | null>(null);

  const refresh = useMutation({
    mutationFn: async () => {
      const cleanActs = activities.filter((a) => a.duration && a.date).map((a) => ({ date: a.date, duration: parseFloat(a.duration) || 0, type: a.type }));
      const cleanWeight = weightHistory.filter((w) => w.weight && w.date).map((w) => ({ date: w.date, weight: parseFloat(w.weight) || 0 }));
      const current = cleanWeight[cleanWeight.length - 1]?.weight || 22;
      const [a, w] = await Promise.all([
        callPets<ActivityResult>('activityScore', { data: { species, age, weight: current, activities: cleanActs } }),
        callPets<WeightResult>('weightTracker', { data: { species, weight: current, weightHistory: cleanWeight } }),
      ]);
      setActivity(a);
      setWeight(w);
      return { a, w };
    },
  });

  const addActivity = () => setActivities((as) => [...as, { date: dayOffset(0), duration: '', type: 'walk' }]);
  const updateActivity = <K extends keyof ActivityEntry>(i: number, key: K, value: ActivityEntry[K]) =>
    setActivities((as) => as.map((a, idx) => (idx === i ? { ...a, [key]: value } : a)));
  const removeActivity = (i: number) => setActivities((as) => as.filter((_, idx) => idx !== i));

  const addWeight = () => setWeightHistory((ws) => [...ws, { date: dayOffset(0), weight: '' }]);
  const updateWeight = (i: number, key: keyof WeightEntry, value: string) =>
    setWeightHistory((ws) => ws.map((w, idx) => (idx === i ? { ...w, [key]: value } : w)));
  const removeWeight = (i: number) => setWeightHistory((ws) => ws.filter((_, idx) => idx !== i));

  const ringColour = activity?.score && activity.score >= 80 ? '#22c55e' : activity?.score && activity.score >= 50 ? '#eab308' : '#ef4444';
  const trendIcon = weight?.trend === 'gaining' ? <TrendingUp className="h-4 w-4 text-amber-400" /> : weight?.trend === 'losing' ? <TrendingDown className="h-4 w-4 text-blue-400" /> : <Minus className="h-4 w-4 text-zinc-400" />;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900">
      {/* PetDesk-style hero card */}
      <div className="flex items-center gap-4 border-b border-zinc-800 bg-zinc-900/40 p-4">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-rose-500/30 to-amber-500/30 text-3xl">
          {SPECIES_EMOJI[species]}
        </div>
        <div className="flex-1 space-y-1">
          <input
            className="block w-full rounded border border-transparent bg-transparent text-xl font-semibold text-white hover:border-zinc-700 focus:border-rose-500/40 focus:outline-none"
            value={petName}
            onChange={(e) => setPetName(e.target.value)}
          />
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <select value={species} onChange={(e) => setSpecies(e.target.value as typeof species)} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[11px]">
              {(Object.keys(SPECIES_EMOJI) as Array<keyof typeof SPECIES_EMOJI>).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span>·</span>
            <label className="inline-flex items-center gap-1">
              <input type="number" min={0} max={30} step={0.5} value={age} onChange={(e) => setAge(Math.max(0, Math.min(30, Number(e.target.value) || 3)))} className="w-12 rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[11px] font-mono" />
              <span>yr old</span>
            </label>
          </div>
        </div>
        <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending} className="rounded-full bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-50">
          {refresh.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh'}
        </button>
        {(activity || weight) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-pets-petdesk-dashboard"
            title={`${petName} (${species}, ${age}y) — activity ${activity?.score ?? '—'}/100 · weight ${weight?.currentWeight ?? '—'} lb ${weight?.trend ?? ''}`}
            content={`Pet: ${petName} (${species}, ${age} years)\n\nActivity (last 7d):\n  Score: ${activity?.score}/100 (${activity?.rating})\n  Daily avg: ${activity?.dailyAvg} min / target ${activity?.dailyTarget} min\n  Weekly total: ${activity?.weeklyTotal} min across ${activity?.activityCount} sessions\n  ${activity?.recommendation}\n\nWeight:\n  Current: ${weight?.currentWeight} lb (ideal ${weight?.idealRange?.min}–${weight?.idealRange?.max})\n  Status: ${weight?.status} · Trend: ${weight?.trend} (${weight?.weeklyChangeLbs} lb/week)\n  ${weight?.alert || ''}`}
            extraTags={['pets', species, 'wellness']}
            rawData={{ petName, species, age, activities, weightHistory, activity, weight }}
          />
        )}
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        {/* Activity ring — Apple Activity style */}
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500"><Activity className="h-3 w-3" />Weekly activity</div>
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

          <div className="border-t border-zinc-800 pt-2">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">Log entries</div>
            <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
              {activities.map((a, i) => (
                <div key={i} className="grid grid-cols-[120px_70px_1fr_24px] gap-1">
                  <input type="date" value={a.date} onChange={(e) => updateActivity(i, 'date', e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[10px] text-white font-mono" />
                  <input type="number" min={0} value={a.duration} onChange={(e) => updateActivity(i, 'duration', e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[10px] text-white font-mono" placeholder="min" />
                  <select value={a.type} onChange={(e) => updateActivity(i, 'type', e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[10px] text-white">
                    {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button type="button" onClick={() => removeActivity(i)} className="text-zinc-600 hover:text-rose-300" aria-label="Remove"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addActivity} className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-rose-300"><Plus className="h-3 w-3" />Log activity</button>
          </div>
        </div>

        {/* Weight trend — Apple Health-style line chart with ideal band */}
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500"><Heart className="h-3 w-3" />Weight trend</div>
          <div className="flex items-center gap-3">
            <div className="font-mono text-3xl text-white">{weight?.currentWeight ?? '—'} <span className="text-sm text-zinc-500">lb</span></div>
            <div className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300">{trendIcon}{weight?.trend ?? '—'}</div>
          </div>
          {weight?.idealRange && (
            <div className="text-[10px] text-zinc-500">Ideal range: <span className="text-emerald-300">{weight.idealRange.min}–{weight.idealRange.max} lb</span> · {weight.idealRange.note}</div>
          )}
          <div className="overflow-x-auto">
            <WeightChart history={weightHistory} ideal={weight?.idealRange ? { min: weight.idealRange.min, max: weight.idealRange.max } : undefined} />
          </div>
          {weight?.weeklyChangeLbs != null && (
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-[11px]">
              <span className="text-zinc-500">Weekly change: </span>
              <span className={`font-mono ${weight.weeklyChangeLbs > 0.3 ? 'text-amber-300' : weight.weeklyChangeLbs < -0.3 ? 'text-blue-300' : 'text-emerald-300'}`}>
                {weight.weeklyChangeLbs > 0 ? '+' : ''}{weight.weeklyChangeLbs} lb
              </span>
            </div>
          )}
          {weight?.alert && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">{weight.alert}</div>
          )}

          <div className="border-t border-zinc-800 pt-2">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">Weigh-ins</div>
            <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
              {weightHistory.map((w, i) => (
                <div key={i} className="grid grid-cols-[120px_90px_24px] gap-1">
                  <input type="date" value={w.date} onChange={(e) => updateWeight(i, 'date', e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[10px] text-white font-mono" />
                  <input type="number" step={0.1} value={w.weight} onChange={(e) => updateWeight(i, 'weight', e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[10px] text-white font-mono" placeholder="lb" />
                  <button type="button" onClick={() => removeWeight(i)} className="text-zinc-600 hover:text-rose-300" aria-label="Remove"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addWeight} className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-rose-300"><Plus className="h-3 w-3" />Add weigh-in</button>
          </div>
        </div>
      </div>
    </div>
  );
}
