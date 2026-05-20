'use client';

import { useState } from 'react';
import { Sparkles, Loader2, Calendar, Dumbbell } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface PlannedDay {
  day: string;
  focus: string;
  duration: number;  // minutes
  exercises: Array<{ name: string; sets: number; reps: string; restSec: number; notes?: string }>;
}

export interface WorkoutPlan {
  goal: string;
  weeks: number;
  daysPerWeek: number;
  template: PlannedDay[];
  progression: string;
  nutrition: string;
}

export function WorkoutPlanner() {
  const [goal, setGoal] = useState<'strength' | 'hypertrophy' | 'endurance' | 'fat_loss' | 'general'>('general');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [weeks, setWeeks] = useState(8);
  const [equipment, setEquipment] = useState<'full_gym' | 'home_dumbbells' | 'bodyweight_only'>('full_gym');
  const [experience, setExperience] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true); setError(null);
    try {
      const res = await lensRun({
        domain: 'fitness', action: 'workout-plan-generate',
        input: { goal, daysPerWeek, weeks, equipment, experience },
      });
      setPlan(res.data?.result?.plan as WorkoutPlan || null);
      if (!res.data?.result?.plan) setError('No plan generated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generate failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">AI workout planner</span>
        <span className="ml-auto text-[10px] text-gray-500">Conscious brain</span>
      </header>
      <div className="p-4 grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        <Field label="Goal">
          <select value={goal} onChange={e => setGoal(e.target.value as 'strength' | 'hypertrophy' | 'endurance' | 'fat_loss' | 'general')} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="strength">Strength</option>
            <option value="hypertrophy">Hypertrophy</option>
            <option value="endurance">Endurance</option>
            <option value="fat_loss">Fat loss</option>
            <option value="general">General fitness</option>
          </select>
        </Field>
        <Field label="Days / week">
          <input type="number" min={1} max={7} value={daysPerWeek} onChange={e => setDaysPerWeek(Number(e.target.value))} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        </Field>
        <Field label="Weeks">
          <input type="number" min={1} max={24} value={weeks} onChange={e => setWeeks(Number(e.target.value))} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        </Field>
        <Field label="Equipment">
          <select value={equipment} onChange={e => setEquipment(e.target.value as 'full_gym' | 'home_dumbbells' | 'bodyweight_only')} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="full_gym">Full gym</option>
            <option value="home_dumbbells">Dumbbells + bench</option>
            <option value="bodyweight_only">Bodyweight only</option>
          </select>
        </Field>
        <Field label="Experience">
          <select value={experience} onChange={e => setExperience(e.target.value as 'beginner' | 'intermediate' | 'advanced')} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </Field>
      </div>
      <div className="px-4 pb-3">
        <button onClick={generate} disabled={loading} className="inline-flex items-center gap-2 px-4 py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate plan
        </button>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>
      {plan && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/10 pt-4">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-cyan-300 font-bold">{plan.goal}</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-300">{plan.weeks} weeks × {plan.daysPerWeek} days</span>
          </div>
          <div className="space-y-3">
            {plan.template.map(d => (
              <div key={d.day} className="bg-white/[0.02] border border-white/10 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-sm font-bold text-white">{d.day}</span>
                  <span className="text-[10px] text-gray-500">·</span>
                  <span className="text-[10px] text-gray-400">{d.focus}</span>
                  <span className="ml-auto text-[10px] text-gray-500">{d.duration} min</span>
                </div>
                <ul className="space-y-1 text-xs">
                  {d.exercises.map((ex, i) => (
                    <li key={i} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.03]">
                      <Dumbbell className="w-3 h-3 text-gray-500" />
                      <span className="text-white flex-1">{ex.name}</span>
                      <span className="text-cyan-300 font-mono tabular-nums">{ex.sets} × {ex.reps}</span>
                      <span className="text-gray-500 text-[10px]">{ex.restSec}s rest</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="bg-white/[0.02] rounded p-3">
              <h4 className="text-[10px] uppercase tracking-wider text-purple-300 mb-1">Progression</h4>
              <p className="text-gray-300">{plan.progression}</p>
            </div>
            <div className="bg-white/[0.02] rounded p-3">
              <h4 className="text-[10px] uppercase tracking-wider text-green-300 mb-1">Nutrition</h4>
              <p className="text-gray-300">{plan.nutrition}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <span className="block text-[10px] uppercase text-gray-500 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

export default WorkoutPlanner;
