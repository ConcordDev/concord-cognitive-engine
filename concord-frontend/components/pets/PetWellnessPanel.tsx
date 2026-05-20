'use client';

/**
 * PetWellnessPanel — weight history chart, care-activity log and
 * symptom tracking for the selected pet.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Plus, Scale, Footprints, Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface WeightEntry { id: string; date: string; weightKg: number }
interface CareActivity { id: string; kind: string; note: string | null; durationMin: number; date: string }
interface Symptom { id: string; symptom: string; severity: string; note: string | null; date: string }

const ACTIVITY_KINDS = ['feeding', 'walk', 'grooming', 'nail_trim', 'play', 'potty', 'bath', 'training'];
const SEV_COLOR: Record<string, string> = { mild: 'text-emerald-400', moderate: 'text-amber-400', severe: 'text-rose-400' };

export function PetWellnessPanel({ petId, onChange }: { petId: string; onChange: () => void }) {
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [trend, setTrend] = useState<{ trend: string; changeKg: number; latest: number | null }>({ trend: 'no_data', changeKg: 0, latest: null });
  const [activities, setActivities] = useState<CareActivity[]>([]);
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [actInput, setActInput] = useState({ kind: 'walk', note: '', durationMin: '' });
  const [symInput, setSymInput] = useState({ symptom: '', severity: 'mild', note: '' });

  const refresh = useCallback(async () => {
    if (!petId) return;
    setLoading(true);
    const [w, a, s] = await Promise.all([
      lensRun('pets', 'weight-history', { petId }),
      lensRun('pets', 'activity-history', { petId }),
      lensRun('pets', 'symptom-list', { petId }),
    ]);
    setWeights(w.data?.result?.series || []);
    setTrend({
      trend: w.data?.result?.trend || 'no_data',
      changeKg: w.data?.result?.changeKg || 0,
      latest: w.data?.result?.latest ?? null,
    });
    setActivities(a.data?.result?.activities || []);
    setSymptoms(s.data?.result?.symptoms || []);
    setLoading(false);
  }, [petId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logWeight = async () => {
    const kg = Number(weightInput);
    if (!kg || kg <= 0) { setError('Enter a weight greater than zero.'); return; }
    const r = await lensRun('pets', 'weight-log', { petId, weightKg: kg });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setWeightInput('');
    setError(null);
    await refresh(); onChange();
  };
  const logActivity = async () => {
    const r = await lensRun('pets', 'activity-log', {
      petId, kind: actInput.kind, note: actInput.note.trim(), durationMin: Number(actInput.durationMin) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setActInput({ kind: 'walk', note: '', durationMin: '' });
    setError(null);
    await refresh();
  };
  const logSymptom = async () => {
    if (!symInput.symptom.trim()) { setError('Describe the symptom.'); return; }
    const r = await lensRun('pets', 'symptom-log', {
      petId, symptom: symInput.symptom.trim(), severity: symInput.severity, note: symInput.note.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setSymInput({ symptom: '', severity: 'mild', note: '' });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const TrendIcon = trend.trend === 'gaining' ? TrendingUp : trend.trend === 'losing' ? TrendingDown : Minus;
  const chartData = weights.map((w) => ({ date: w.date.slice(5), kg: w.weightKg }));

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Weight */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Scale className="w-3.5 h-3.5 text-teal-400" /> Weight
          </h3>
          {trend.latest != null && (
            <span className="flex items-center gap-1 text-[11px] text-zinc-400">
              <TrendIcon className="w-3 h-3" /> {trend.latest} kg
              {trend.changeKg !== 0 && <span className="text-zinc-500">({trend.changeKg > 0 ? '+' : ''}{trend.changeKg})</span>}
            </span>
          )}
        </div>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={28} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Line type="monotone" dataKey="kg" stroke="#2dd4bf" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-[11px] text-zinc-500 italic py-4 text-center">Log at least two weigh-ins to see a chart.</p>
        )}
        <div className="flex gap-1 mt-2">
          <input placeholder="Weight (kg)" inputMode="decimal" value={weightInput} onChange={(e) => setWeightInput(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
          <button type="button" onClick={logWeight}
            className="px-3 py-1 text-xs bg-teal-600 hover:bg-teal-500 text-white rounded-lg">Log</button>
        </div>
      </section>

      {/* Care activity */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Footprints className="w-3.5 h-3.5 text-teal-400" /> Care log
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <select value={actInput.kind} onChange={(e) => setActInput({ ...actInput, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Note" value={actInput.note} onChange={(e) => setActInput({ ...actInput, note: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Mins" inputMode="numeric" value={actInput.durationMin} onChange={(e) => setActInput({ ...actInput, durationMin: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={logActivity}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Log
          </button>
        </div>
        {activities.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No care activities logged.</p>
        ) : (
          <ul className="space-y-1">
            {activities.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center justify-between text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-zinc-300 capitalize">{a.kind.replace(/_/g, ' ')}{a.note ? ` — ${a.note}` : ''}</span>
                <span className="text-zinc-500">{a.durationMin > 0 ? `${a.durationMin}m · ` : ''}{a.date}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Symptoms */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Activity className="w-3.5 h-3.5 text-teal-400" /> Symptom log
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Symptom" value={symInput.symptom} onChange={(e) => setSymInput({ ...symInput, symptom: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={symInput.severity} onChange={(e) => setSymInput({ ...symInput, severity: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['mild', 'moderate', 'severe'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input placeholder="Note" value={symInput.note} onChange={(e) => setSymInput({ ...symInput, note: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={logSymptom}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Log
          </button>
        </div>
        {symptoms.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No symptoms logged.</p>
        ) : (
          <ul className="space-y-1">
            {symptoms.slice(0, 8).map((sy) => (
              <li key={sy.id} className="flex items-center justify-between text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-zinc-300">{sy.symptom}{sy.note ? ` — ${sy.note}` : ''}</span>
                <span className={cn('capitalize', SEV_COLOR[sy.severity])}>{sy.severity}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
