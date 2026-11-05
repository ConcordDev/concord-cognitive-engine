'use client';

import { useEffect, useState } from 'react';
import { Activity, Flame, Footprints, Clock, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface ActivityDay {
  date: string;
  moveCalories: number; moveGoal: number;
  exerciseMinutes: number; exerciseGoal: number;
  standHours: number; standGoal: number;
  steps: number; stepsGoal: number;
  /** "device" / a wearable provider, "manual" (fitness.activity-log), or
   *  "logged" (exercise minutes derived server-side from real Log
   *  workouts + Training Hub activities — F4). */
  source?: string;
}

export function ActivityRings() {
  const [today, setToday] = useState<ActivityDay | null>(null);
  const [week, setWeek] = useState<ActivityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Manual log (fitness.activity-log — the write path the server's
  // empty note always named; it exists now, and so does this form).
  const [showLogForm, setShowLogForm] = useState(false);
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logExercise, setLogExercise] = useState('');
  const [logCalories, setLogCalories] = useState('');
  const [logSteps, setLogSteps] = useState('');
  const [logStand, setLogStand] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logNote, setLogNote] = useState<string | null>(null);

  useEffect(() => { refresh(); }, []);

  async function submitLog() {
    const input: Record<string, unknown> = { date: logDate };
    const ex = parseFloat(logExercise); if (ex > 0) input.exerciseMinutes = ex;
    const cal = parseFloat(logCalories); if (cal > 0) input.activeCalories = cal;
    const st = parseFloat(logSteps); if (st > 0) input.steps = st;
    const sh = parseFloat(logStand); if (sh > 0) input.standHours = sh;
    if (Object.keys(input).length === 1) { setLogError('Enter at least one metric.'); return; }
    setLogBusy(true); setLogError(null); setLogNote(null);
    try {
      const res = await lensRun({ domain: 'fitness', action: 'activity-log', input });
      if (res.data?.ok === false) {
        setLogError(res.data?.error || 'Log failed.');
      } else {
        setLogNote(`Logged for ${logDate} (manual entry).`);
        setLogExercise(''); setLogCalories(''); setLogSteps(''); setLogStand('');
        await refresh();
      }
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'Log failed.');
    } finally { setLogBusy(false); }
  }

  const logForm = (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <label>
          <span className="block text-[10px] uppercase text-gray-400 mb-0.5">Date</span>
          <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        </label>
        <label>
          <span className="block text-[10px] uppercase text-gray-400 mb-0.5">Exercise (min)</span>
          <input type="number" min="0" value={logExercise} onChange={e => setLogExercise(e.target.value)} placeholder="45" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        </label>
        <label>
          <span className="block text-[10px] uppercase text-gray-400 mb-0.5">Active kcal</span>
          <input type="number" min="0" value={logCalories} onChange={e => setLogCalories(e.target.value)} placeholder="400" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        </label>
        <label>
          <span className="block text-[10px] uppercase text-gray-400 mb-0.5">Steps</span>
          <input type="number" min="0" value={logSteps} onChange={e => setLogSteps(e.target.value)} placeholder="8000" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        </label>
        <label>
          <span className="block text-[10px] uppercase text-gray-400 mb-0.5">Stand (hrs)</span>
          <input type="number" min="0" step="0.5" value={logStand} onChange={e => setLogStand(e.target.value)} placeholder="10" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        </label>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button onClick={submitLog} disabled={logBusy} className="px-3 py-1.5 rounded bg-cyan-500 text-black text-xs font-bold hover:bg-cyan-400 disabled:opacity-50">
          {logBusy ? 'Logging…' : 'Log entry'}
        </button>
        <span className="text-[10px] text-gray-500">Stored as a manual entry — never shown as a device reading.</span>
      </div>
      {logError && <p role="alert" className="text-xs text-red-300 mt-2">{logError}</p>}
      {logNote && <p role="status" className="text-xs text-emerald-300 mt-2">{logNote}</p>}
    </div>
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await lensRun({ domain: 'fitness', action: 'activity-summary', input: { days: 7 } });
      // /api/lens/run unwraps one { ok, result } layer, so a handler rejection
      // surfaces at res.data.ok === false — distinguish it from genuinely-empty.
      if (res.data?.ok === false) {
        setError(res.data?.error || 'Failed to load activity data.');
        setWeek([]); setToday(null);
      } else {
        const days = (res.data?.result?.days || []) as ActivityDay[];
        setWeek(days);
        setToday(days[days.length - 1] || null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity data.');
      setWeek([]); setToday(null);
    } finally { setLoading(false); }
  }

  if (loading) {
    return <div role="status" aria-busy="true" className="bg-[#0d1117] border border-cyan-500/20 rounded-lg p-6 flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }
  if (error) {
    return (
      <div role="alert" className="bg-[#0d1117] border border-red-500/20 rounded-lg p-6 text-xs text-gray-300 space-y-2">
        <p className="text-red-300">{error}</p>
        <button onClick={() => void refresh()} className="px-3 py-1 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/30">Retry</button>
      </div>
    );
  }
  if (!today) {
    return (
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg p-6 text-xs text-gray-400">
        <p>No activity data yet. Exercise minutes from workouts you log and Training Hub activities appear here automatically; connect a wearable for Move, Stand and Steps — or log a day by hand.</p>
        <button onClick={() => setShowLogForm(v => !v)} className="mt-3 px-3 py-1.5 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/30 text-xs font-semibold">Log manually</button>
        {showLogForm && logForm}
      </div>
    );
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Activity className="w-4 h-4 text-red-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Activity rings</span>
        <span className="ml-auto text-[10px] text-gray-400">Apple Fitness+ style</span>
      </header>
      <div className="p-4 flex items-center gap-6">
        <Rings today={today} />
        <div className="space-y-2 flex-1">
          <Bar icon={Flame} color="#ff3b30" label="Move" value={today.moveCalories} goal={today.moveGoal} unit="kcal" />
          <Bar icon={Activity} color="#34c759" label="Exercise" value={today.exerciseMinutes} goal={today.exerciseGoal} unit="min" />
          <Bar icon={Clock} color="#00c7be" label="Stand" value={today.standHours} goal={today.standGoal} unit="hr" />
          <Bar icon={Footprints} color="#22d3ee" label="Steps" value={today.steps} goal={today.stepsGoal} unit="" />
        </div>
      </div>
      <div className="px-4 pb-4">
        <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Last 7 days</h3>
        <div className="grid grid-cols-7 gap-1">
          {week.map(d => {
            const closed = [d.moveCalories >= d.moveGoal, d.exerciseMinutes >= d.exerciseGoal, d.standHours >= d.standGoal].filter(Boolean).length;
            return (
              <div key={d.date} className="text-center">
                <div className="text-[9px] text-gray-400">{new Date(d.date).toLocaleDateString(undefined, { weekday: 'narrow' })}</div>
                <MiniRings day={d} />
                <div className="text-[10px] text-gray-400">{closed}/3</div>
              </div>
            );
          })}
        </div>
        {week.some(d => d.source === 'logged') && (
          <p className="mt-2 text-[10px] text-gray-500">Days marked from your logs: exercise minutes come from logged workouts and Training Hub activities; Move, Stand and Steps need a wearable or a manual log.</p>
        )}
        <div className="mt-2">
          <button onClick={() => setShowLogForm(v => !v)} className="text-xs text-cyan-300 hover:text-cyan-100 font-semibold">Log manually</button>
          {showLogForm && logForm}
        </div>
      </div>
    </div>
  );
}

function Rings({ today }: { today: ActivityDay }) {
  const r = 60;
  const stroke = 12;
  const c = 2 * Math.PI * r;
  const movePct = Math.min(1, today.moveCalories / today.moveGoal);
  const exPct = Math.min(1, today.exerciseMinutes / today.exerciseGoal);
  const standPct = Math.min(1, today.standHours / today.standGoal);
  return (
    <svg width={170} height={170} viewBox="0 0 170 170">
      <g transform="translate(85, 85)">
        <RingCircle r={r} pct={movePct} color="#ff3b30" stroke={stroke} c={c} />
        <RingCircle r={r - stroke - 4} pct={exPct} color="#34c759" stroke={stroke} c={2 * Math.PI * (r - stroke - 4)} />
        <RingCircle r={r - 2 * (stroke + 4)} pct={standPct} color="#00c7be" stroke={stroke} c={2 * Math.PI * (r - 2 * (stroke + 4))} />
      </g>
    </svg>
  );
}

function MiniRings({ day }: { day: ActivityDay }) {
  const r = 14;
  const stroke = 3;
  const movePct = Math.min(1, day.moveCalories / day.moveGoal);
  const exPct = Math.min(1, day.exerciseMinutes / day.exerciseGoal);
  const standPct = Math.min(1, day.standHours / day.standGoal);
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" className="inline-block mx-auto">
      <g transform="translate(18, 18)">
        <RingCircle r={r} pct={movePct} color="#ff3b30" stroke={stroke} c={2 * Math.PI * r} />
        <RingCircle r={r - stroke - 1} pct={exPct} color="#34c759" stroke={stroke} c={2 * Math.PI * (r - stroke - 1)} />
        <RingCircle r={r - 2 * (stroke + 1)} pct={standPct} color="#00c7be" stroke={stroke} c={2 * Math.PI * (r - 2 * (stroke + 1))} />
      </g>
    </svg>
  );
}

function RingCircle({ r, pct, color, stroke, c }: { r: number; pct: number; color: string; stroke: number; c: number }) {
  return (
    <>
      <circle cx={0} cy={0} r={r} fill="none" stroke={`${color}30`} strokeWidth={stroke} />
      <circle
        cx={0} cy={0} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform="rotate(-90)"
        style={{ transition: 'stroke-dashoffset 0.4s' }}
      />
    </>
  );
}

function Bar({ icon: Icon, color, label, value, goal, unit }: { icon: typeof Activity; color: string; label: string; value: number; goal: number; unit: string }) {
  const pct = Math.min(100, (value / Math.max(1, goal)) * 100);
  return (
    <div>
      <div className="flex items-center gap-2 text-xs">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <span className="text-white">{label}</span>
        <span className="ml-auto tabular-nums" style={{ color }}>{value.toLocaleString()} / {goal.toLocaleString()} {unit}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default ActivityRings;
