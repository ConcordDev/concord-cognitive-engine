'use client';

/**
 * StravaTrainingPanel — Garmin Connect-shape physiology board.
 * training-load (CTL/ATL/TSB), training-readiness, body-battery,
 * HRV status, VO2max estimate + race predictor.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { Loader2, Activity, Battery, HeartPulse, Gauge, Timer } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LoadDay { date: string; load: number; ctl: number; atl: number; tsb: number }
interface TrainingLoad { fitness: number; fatigue: number; form: number; status: string; trackedDays: number; daily: LoadDay[] }
interface Readiness { score: number; label: string; recommendation: string; factors: { factor: string; contribution: number }[] }
interface BodyBattery { battery: number; state: string; todayDrain: number }
interface HrvStatus { status: string; recent7Avg?: number; baselineAvg?: number; samples: number; notes?: string }
interface RacePrediction { distance: string; time: string; pace: string }

const STATUS_COLOR: Record<string, string> = {
  overreaching: 'text-rose-400', productive: 'text-emerald-400', maintaining: 'text-sky-400',
  fresh: 'text-amber-400', detraining: 'text-zinc-400', no_data: 'text-zinc-500',
};

export function StravaTrainingPanel() {
  const [load, setLoad] = useState<TrainingLoad | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [battery, setBattery] = useState<BodyBattery | null>(null);
  const [hrv, setHrv] = useState<HrvStatus | null>(null);
  const [vo2, setVo2] = useState<number | null>(null);
  const [predictions, setPredictions] = useState<RacePrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [sleepHours, setSleepHours] = useState('7.5');
  const [rmssd, setRmssd] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const sleep = Number(sleepHours) || 7.5;
    const [l, rd, bb, h, v, rp] = await Promise.all([
      lensRun('fitness', 'training-load', {}),
      lensRun('fitness', 'training-readiness', { sleepHours: sleep }),
      lensRun('fitness', 'body-battery', { sleepHours: sleep }),
      lensRun('fitness', 'hrv-status', {}),
      lensRun('fitness', 'vo2max-estimate', {}),
      lensRun('fitness', 'race-predictor', {}),
    ]);
    setLoad(l.data?.result as TrainingLoad | null);
    setReadiness(rd.data?.result as Readiness | null);
    setBattery(bb.data?.result as BodyBattery | null);
    setHrv(h.data?.result as HrvStatus | null);
    setVo2(v.data?.ok === false ? null : (v.data?.result?.vo2max ?? null));
    setPredictions(rp.data?.ok === false ? [] : (rp.data?.result?.predictions || []));
    setLoading(false);
  }, [sleepHours]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logHrv = async () => {
    const v = Number(rmssd);
    if (!v || v <= 0) { setNote('Enter a positive RMSSD value (ms).'); return; }
    const r = await lensRun('fitness', 'hrv-log', { rmssd: v });
    if (r.data?.ok === false) { setNote(r.data?.error || 'Could not log HRV'); return; }
    setRmssd('');
    setNote(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Top metric tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile icon={Activity} label="Fitness (CTL)" value={load ? String(load.fitness) : '—'} accent="text-sky-400" />
        <Tile icon={Gauge} label="Readiness" value={readiness ? String(readiness.score) : '—'}
          accent={readiness && readiness.score >= 60 ? 'text-emerald-400' : 'text-amber-400'}
          sub={readiness?.label} />
        <Tile icon={Battery} label="Body Battery" value={battery ? String(battery.battery) : '—'}
          accent={battery && battery.battery >= 50 ? 'text-emerald-400' : 'text-amber-400'}
          sub={battery?.state} />
        <Tile icon={Gauge} label="VO₂max" value={vo2 != null ? String(vo2) : '—'} accent="text-orange-400" />
      </div>

      {/* Training load chart */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-zinc-300">Fitness &amp; Freshness</h3>
          {load && (
            <span className={cn('text-[11px] font-medium capitalize', STATUS_COLOR[load.status] || 'text-zinc-400')}>
              {load.status.replace(/_/g, ' ')} · form {load.form}
            </span>
          )}
        </div>
        {load && load.daily.length > 1 ? (
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={load.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={28} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Area type="monotone" dataKey="ctl" name="Fitness" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.15} />
              <Line type="monotone" dataKey="atl" name="Fatigue" stroke="#fb923c" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-zinc-500 italic py-8 text-center">
            Log activities over several days to build your fitness curve.
          </p>
        )}
      </div>

      {/* Readiness factors + recommendation */}
      {readiness && readiness.factors.length > 0 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="text-xs font-semibold text-zinc-300 mb-1">Today&apos;s readiness</h3>
          <p className="text-[11px] text-zinc-400 mb-2">{readiness.recommendation}</p>
          <div className="flex flex-wrap gap-2">
            {readiness.factors.map((f) => (
              <span key={f.factor} className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 capitalize">
                {f.factor.replace(/_/g, ' ')} {f.contribution >= 0 ? '+' : ''}{f.contribution}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Sleep input drives readiness + battery */}
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span>Last night&apos;s sleep</span>
        <input
          inputMode="decimal" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)}
          className="w-16 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-100"
        />
        <span>hours — drives readiness &amp; battery</span>
      </div>

      {/* HRV + race predictor */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <HeartPulse className="w-3.5 h-3.5 text-rose-400" /> HRV status
          </h3>
          {hrv && hrv.status !== 'insufficient_data' ? (
            <p className="text-sm text-zinc-100 capitalize">
              {hrv.status.replace(/_/g, ' ')}
              <span className="text-[11px] text-zinc-500 ml-1">
                ({hrv.recent7Avg} ms vs {hrv.baselineAvg} ms baseline)
              </span>
            </p>
          ) : (
            <p className="text-[11px] text-zinc-500 italic">{hrv?.notes || 'Log nightly HRV to see a status.'}</p>
          )}
          <div className="flex gap-1 mt-2">
            <input
              placeholder="RMSSD (ms)" inputMode="decimal" value={rmssd} onChange={(e) => setRmssd(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100"
            />
            <button type="button" onClick={logHrv}
              className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Log</button>
          </div>
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Timer className="w-3.5 h-3.5 text-orange-400" /> Race predictor
          </h3>
          {predictions.length > 0 ? (
            <ul className="space-y-1">
              {predictions.map((p) => (
                <li key={p.distance} className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">{p.distance}</span>
                  <span className="text-zinc-100 font-mono">{p.time}<span className="text-zinc-500 ml-1">· {p.pace}/km</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-zinc-500 italic">Log a run of 1.5 km or more for finish-time predictions.</p>
          )}
        </div>
      </div>

      {note && <div className="text-xs text-rose-400">{note}</div>}
    </div>
  );
}

function Tile({ icon: Icon, label, value, accent, sub }: {
  icon: typeof Activity; label: string; value: string; accent: string; sub?: string;
}) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
      <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wide">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <p className={cn('text-2xl font-bold mt-0.5', accent)}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 capitalize">{sub}</p>}
    </div>
  );
}
