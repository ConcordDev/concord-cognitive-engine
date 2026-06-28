'use client';

import { useEffect, useState } from 'react';
import { Moon, Activity, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface RecoveryDay {
  date: string;
  recoveryScore: number;       // 0-100
  sleepDurationHours: number;
  sleepQualityPct: number;
  restingHr: number;
  hrv: number;
  strainYesterday: number;     // 0-21 (Whoop-style)
}

export function SleepRecovery() {
  const [days, setDays] = useState<RecoveryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await lensRun({ domain: 'fitness', action: 'recovery-history', input: { days: 14 } });
      // /api/lens/run unwraps one { ok, result } layer, so a handler rejection
      // lands at res.data.ok === false (NOT swallowed into empty). Surface it
      // as a distinguishable error rather than a silent-empty CTA.
      if (res.data?.ok === false) {
        setError(res.data?.error || 'Failed to load recovery data.');
        setDays([]);
      } else {
        setDays((res.data?.result?.days || []) as RecoveryDay[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recovery data.');
      setDays([]);
    } finally { setLoading(false); }
  }

  const latest = days[days.length - 1];

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Moon className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Sleep & recovery</span>
        <span className="ml-auto text-[10px] text-gray-400">Whoop-style</span>
      </header>
      {loading ? (
        <div role="status" aria-busy="true" className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : error ? (
        <div role="alert" className="px-3 py-8 text-center text-xs space-y-2">
          <p className="text-red-300">{error}</p>
          <button onClick={() => void refresh()} className="px-3 py-1 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/30">Retry</button>
        </div>
      ) : !latest ? (
        <div className="px-3 py-8 text-center text-xs text-gray-400">No recovery data — connect a wearable or log manually.</div>
      ) : (
        <>
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <RecoveryStat label="Recovery" value={`${Math.round(latest.recoveryScore)}%`} color={
              latest.recoveryScore >= 67 ? 'green' : latest.recoveryScore >= 34 ? 'yellow' : 'red'
            } big />
            <Stat label="Sleep" value={`${latest.sleepDurationHours.toFixed(1)}h`} />
            <Stat label="HRV" value={`${Math.round(latest.hrv)} ms`} />
            <Stat label="RHR" value={`${Math.round(latest.restingHr)} bpm`} />
          </div>
          <div className="px-4 pb-4">
            <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Last 14 days</h3>
            <div className="flex items-end gap-1 h-24">
              {days.map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center" title={`${d.date}: ${Math.round(d.recoveryScore)}%`}>
                  <div className={cn('w-full rounded-t transition-all',
                    d.recoveryScore >= 67 ? 'bg-green-500/60' :
                    d.recoveryScore >= 34 ? 'bg-yellow-500/60' :
                    'bg-red-500/60'
                  )} style={{ height: `${Math.max(4, d.recoveryScore)}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[9px] text-gray-400">
              <span>{days[0]?.date}</span>
              <span>{latest.date}</span>
            </div>
          </div>
          <div className="px-4 pb-4 grid grid-cols-2 gap-3 text-xs">
            <div className="bg-white/[0.02] rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Strain yesterday</div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-300" />
                <span className="text-2xl font-bold text-cyan-300 tabular-nums">{latest.strainYesterday.toFixed(1)}</span>
                <span className="text-[10px] text-gray-400">/ 21</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                {latest.strainYesterday >= 18 ? 'All-out — give your body 2+ rest days' :
                 latest.strainYesterday >= 14 ? 'High — easy day recommended' :
                 latest.strainYesterday >= 10 ? 'Moderate' : 'Light — capacity to push harder'}
              </p>
            </div>
            <div className="bg-white/[0.02] rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Sleep quality</div>
              <div className="text-2xl font-bold text-white tabular-nums">{Math.round(latest.sleepQualityPct)}%</div>
              <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-cyan-500" style={{ width: `${latest.sleepQualityPct}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                {latest.sleepQualityPct >= 85 ? 'Excellent — well-rested.' :
                 latest.sleepQualityPct >= 70 ? 'Good — minor improvements available.' :
                 'Below target — prioritise wind-down routine.'}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RecoveryStat({ label, value, color, big }: { label: string; value: string; color: 'green' | 'yellow' | 'red'; big?: boolean }) {
  const palette = {
    green: 'text-green-300 border-green-500/30 bg-green-500/[0.05]',
    yellow: 'text-yellow-300 border-yellow-500/30 bg-yellow-500/[0.05]',
    red: 'text-red-300 border-red-500/30 bg-red-500/[0.05]',
  };
  return (
    <div className={cn('p-3 rounded border', palette[color])}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('font-bold tabular-nums', big ? 'text-4xl' : 'text-xl', palette[color].split(' ')[0])}>{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded bg-white/[0.02]">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-xl font-bold tabular-nums text-white">{value}</div>
    </div>
  );
}

export default SleepRecovery;
