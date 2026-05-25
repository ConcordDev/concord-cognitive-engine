'use client';

/**
 * PjReportsPanel — velocity, cumulative flow, cycle time and forecast.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Loader2, Gauge, Activity, Timer, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Velocity { series: { sprint: string; committed: number; completed: number }[]; avgVelocity: number; completedSprints: number }
interface Flow { series: { date: string; created: number; completed: number; open: number }[] }
interface CycleTime { completedTasks: number; avgCycleDays: number; avgLeadDays: number }
interface Forecast { remainingPoints: number; avgVelocity: number; projectedSprints: number | null; basis: number }

export function PjReportsPanel({ projectId }: { projectId: string }) {
  const [velocity, setVelocity] = useState<Velocity | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [cycle, setCycle] = useState<CycleTime | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [v, f, c, fc] = await Promise.all([
      lensRun('projects', 'report-velocity', { projectId }),
      lensRun('projects', 'report-flow', { projectId, days: 30 }),
      lensRun('projects', 'report-cycle-time', { projectId }),
      lensRun('projects', 'report-forecast', { projectId }),
    ]);
    setVelocity((v.data?.result as Velocity | null) || null);
    setFlow((f.data?.result as Flow | null) || null);
    setCycle((c.data?.result as CycleTime | null) || null);
    setForecast((fc.data?.result as Forecast | null) || null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi icon={Gauge} label="Avg velocity" value={velocity?.avgVelocity ?? 0} suffix=" pts" />
        <Kpi icon={Timer} label="Avg cycle time" value={cycle?.avgCycleDays ?? 0} suffix="d" />
        <Kpi icon={Timer} label="Avg lead time" value={cycle?.avgLeadDays ?? 0} suffix="d" />
        <Kpi icon={TrendingUp} label="Forecast"
          value={forecast?.projectedSprints != null ? forecast.projectedSprints : '—'}
          suffix={forecast?.projectedSprints != null ? ' sprints' : ''} />
      </div>

      {/* Velocity */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Gauge className="w-3.5 h-3.5 text-indigo-400" /> Velocity — committed vs completed
        </h3>
        {velocity && velocity.series.length > 0 ? (
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={velocity.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="sprint" tick={{ fontSize: 9, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={28} />
              <Tooltip contentStyle={tooltipCss} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="committed" fill="#52525b" radius={[2, 2, 0, 0]} name="Committed" />
              <Bar dataKey="completed" fill="#818cf8" radius={[2, 2, 0, 0]} name="Completed" />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="text-[11px] text-zinc-400 italic py-6 text-center">Complete a sprint to see velocity.</p>}
      </div>

      {/* Cumulative flow */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Activity className="w-3.5 h-3.5 text-indigo-400" /> Cumulative flow (30d)
        </h3>
        {flow && flow.series.length > 0 ? (
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={flow.series.map((p) => ({ date: p.date.slice(5), created: p.created, completed: p.completed, open: p.open }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={28} />
              <Tooltip contentStyle={tooltipCss} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="created" stroke="#71717a" strokeWidth={1.5} dot={false} name="Created" />
              <Line type="monotone" dataKey="open" stroke="#f59e0b" strokeWidth={2} dot={false} name="Open" />
              <Line type="monotone" dataKey="completed" stroke="#34d399" strokeWidth={2} dot={false} name="Completed" />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="text-[11px] text-zinc-400 italic py-6 text-center">No flow data yet.</p>}
      </div>

      {/* Forecast detail */}
      {forecast && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-300">
          <h3 className="text-xs font-semibold text-zinc-300 mb-1">Forecast</h3>
          {forecast.basis === 0 ? (
            <p className="text-zinc-400 italic">Complete at least one sprint for a velocity-based forecast.</p>
          ) : (
            <p>
              {forecast.remainingPoints} points remaining at {forecast.avgVelocity} pts/sprint →
              <span className="text-indigo-300 font-semibold"> ~{forecast.projectedSprints} sprints</span> to completion
              <span className="text-zinc-400"> (based on {forecast.basis} completed sprint{forecast.basis === 1 ? '' : 's'})</span>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const tooltipCss = { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 };

function Kpi({ icon: Icon, label, value, suffix }: { icon: typeof Gauge; label: string; value: string | number; suffix?: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      <p className="flex items-center justify-center gap-1 text-lg font-bold text-zinc-100">
        <Icon className="w-4 h-4 text-indigo-400" />{value}{suffix}
      </p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
