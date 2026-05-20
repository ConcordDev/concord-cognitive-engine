'use client';

import { useEffect, useMemo, useState } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface HRZone {
  zone: 1 | 2 | 3 | 4 | 5;
  name: string;
  lowBpm: number;
  highBpm: number;
  pctOfMax: string;
  purpose: string;
  weeklyMinutesTarget: number;
  weeklyMinutesActual: number;
}

export function HeartRateZones() {
  const [age, setAge] = useState<number>(30);
  const [restingHr, setRestingHr] = useState<number>(60);
  const [method, setMethod] = useState<'tanaka' | 'fox' | 'karvonen'>('tanaka');
  const [zones, setZones] = useState<HRZone[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { compute(); }, [age, restingHr, method]);

  async function compute() {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'fitness', action: 'hr-zones', input: { age, restingHr, method },
      });
      setZones((res.data?.result?.zones || []) as HRZone[]);
    } catch (e) { console.error('[HR] compute failed', e); }
    finally { setLoading(false); }
  }

  const maxBpm = useMemo(() => Math.max(0, ...zones.map(z => z.highBpm)), [zones]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Heart className="w-4 h-4 text-red-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Heart rate zones</span>
        <span className="ml-auto text-[10px] text-gray-500">{method}</span>
      </header>
      <div className="p-4 grid grid-cols-3 gap-3 text-xs">
        <label>
          <span className="block text-[10px] uppercase text-gray-500">Age</span>
          <input type="number" min={5} max={100} value={age} onChange={e => setAge(Number(e.target.value) || 30)} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        </label>
        <label>
          <span className="block text-[10px] uppercase text-gray-500">Resting HR</span>
          <input type="number" min={30} max={120} value={restingHr} onChange={e => setRestingHr(Number(e.target.value) || 60)} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        </label>
        <label>
          <span className="block text-[10px] uppercase text-gray-500">Method</span>
          <select value={method} onChange={e => setMethod(e.target.value as 'tanaka' | 'fox' | 'karvonen')} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="tanaka">Tanaka (208 − 0.7×age)</option>
            <option value="fox">Fox (220 − age)</option>
            <option value="karvonen">Karvonen (HR reserve)</option>
          </select>
        </label>
      </div>
      <div className="px-4 pb-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Computing…</div>
        ) : (
          zones.map(z => (
            <div key={z.zone} className="bg-white/[0.02] rounded p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn('w-7 h-7 inline-flex items-center justify-center rounded-full text-sm font-bold',
                  z.zone === 1 ? 'bg-blue-500/30 text-blue-200' :
                  z.zone === 2 ? 'bg-green-500/30 text-green-200' :
                  z.zone === 3 ? 'bg-yellow-500/30 text-yellow-200' :
                  z.zone === 4 ? 'bg-orange-500/30 text-orange-200' :
                  'bg-red-500/30 text-red-200'
                )}>{z.zone}</span>
                <span className="text-sm text-white">{z.name}</span>
                <span className="ml-auto text-xs font-mono tabular-nums text-cyan-300">{z.lowBpm}–{z.highBpm} bpm</span>
                <span className="text-[10px] text-gray-500">({z.pctOfMax})</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-1">{z.purpose}</p>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-gray-500">Weekly:</span>
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full transition-all',
                      z.weeklyMinutesActual >= z.weeklyMinutesTarget ? 'bg-green-500' : 'bg-cyan-500'
                    )}
                    style={{ width: `${Math.min(100, (z.weeklyMinutesActual / Math.max(1, z.weeklyMinutesTarget)) * 100)}%` }}
                  />
                </div>
                <span className="text-gray-400 tabular-nums">{z.weeklyMinutesActual}/{z.weeklyMinutesTarget} min</span>
              </div>
            </div>
          ))
        )}
        {maxBpm > 0 && (
          <p className="text-[10px] text-gray-500 text-center mt-2">Max HR estimate: {maxBpm} bpm</p>
        )}
      </div>
    </div>
  );
}

export default HeartRateZones;
