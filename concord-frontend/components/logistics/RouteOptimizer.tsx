'use client';

import { useState } from 'react';
import { Route, X, Loader2, MapPin, Clock, TrendingDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface OptimizedStop {
  order: number;
  address: string;
  arrivalTime: string;
  durationMin: number;
  distanceMi: number;
}

export interface RouteOptimization {
  totalDistanceMi: number;
  totalDurationMin: number;
  totalDurationSavedMin: number;
  totalDistanceSavedMi: number;
  fuelCostUsd: number;
  stops: OptimizedStop[];
}

export function RouteOptimizer() {
  const [stops, setStops] = useState<string[]>(['', '']);
  const [startTime, setStartTime] = useState('08:00');
  const [vehicleType, setVehicleType] = useState<'car' | 'van' | 'truck' | 'ev'>('van');
  const [result, setResult] = useState<RouteOptimization | null>(null);
  const [loading, setLoading] = useState(false);

  function updateStop(i: number, v: string) {
    setStops(prev => prev.map((s, idx) => idx === i ? v : s));
  }
  function addStop() { setStops(prev => [...prev, '']); }
  function removeStop(i: number) { setStops(prev => prev.filter((_, idx) => idx !== i)); }

  async function optimize() {
    const cleaned = stops.map(s => s.trim()).filter(Boolean);
    if (cleaned.length < 2) return;
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'route-optimize', input: { stops: cleaned, startTime, vehicleType } });
      setResult(res.data?.result as RouteOptimization || null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Route className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Route optimizer</span>
        <span className="ml-auto text-[10px] text-gray-400">TSP solver</span>
      </header>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <label className="text-gray-400">Start:</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
            <label className="text-gray-400 ml-2">Vehicle:</label>
            <select value={vehicleType} onChange={e => setVehicleType(e.target.value as 'car' | 'van' | 'truck' | 'ev')} className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="car">Car</option><option value="van">Van</option><option value="truck">Truck</option><option value="ev">EV</option>
            </select>
          </div>
          <div className="space-y-1.5">
            {stops.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-4 tabular-nums">{i + 1}.</span>
                <input value={s} onChange={e => updateStop(i, e.target.value)} placeholder={i === 0 ? 'Origin' : i === stops.length - 1 ? 'Final destination' : 'Stop address'} className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                {stops.length > 2 && (
                  <button aria-label="Remove" onClick={() => removeStop(i)} className="p-1 text-gray-400 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
            ))}
            <button onClick={addStop} className="text-[10px] text-cyan-300 hover:text-cyan-100">+ add stop</button>
          </div>
          <button onClick={optimize} disabled={loading} className="w-full py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Optimize route'}
          </button>
        </div>
        <div>
          {!result ? (
            <div className="text-xs text-gray-400 italic text-center py-10">Enter at least 2 stops to optimize.</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 bg-white/[0.02] rounded">
                  <div className="text-lg font-bold tabular-nums text-white">{result.totalDistanceMi.toFixed(1)} mi</div>
                  <div className="text-[9px] uppercase text-gray-400">Distance</div>
                  {result.totalDistanceSavedMi > 0 && <div className="text-[9px] text-green-400">−{result.totalDistanceSavedMi.toFixed(1)} saved</div>}
                </div>
                <div className="p-2 bg-white/[0.02] rounded">
                  <div className="text-lg font-bold tabular-nums text-white">{Math.round(result.totalDurationMin)} min</div>
                  <div className="text-[9px] uppercase text-gray-400">Duration</div>
                  {result.totalDurationSavedMin > 0 && <div className="text-[9px] text-green-400">−{Math.round(result.totalDurationSavedMin)} saved</div>}
                </div>
                <div className="p-2 bg-white/[0.02] rounded">
                  <div className="text-lg font-bold tabular-nums text-yellow-300">${result.fuelCostUsd.toFixed(2)}</div>
                  <div className="text-[9px] uppercase text-gray-400">Fuel cost</div>
                </div>
              </div>
              <ol className="space-y-1.5 text-xs">
                {result.stops.map(s => (
                  <li key={s.order} className="flex items-center gap-2 p-2 bg-white/[0.02] rounded">
                    <span className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-bold">{s.order}</span>
                    <MapPin className="w-3 h-3 text-gray-400" />
                    <span className="text-white flex-1 truncate">{s.address}</span>
                    <span className="text-[10px] text-cyan-300 inline-flex items-center gap-0.5"><Clock className="w-3 h-3" /> {s.arrivalTime}</span>
                    <span className="text-[10px] text-gray-400 tabular-nums">{s.distanceMi.toFixed(1)}mi · {Math.round(s.durationMin)}m</span>
                  </li>
                ))}
              </ol>
              {result.totalDistanceSavedMi > 0 && (
                <div className="text-[10px] text-green-300 inline-flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> Saved {result.totalDistanceSavedMi.toFixed(1)} mi vs entered order
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export default RouteOptimizer;
