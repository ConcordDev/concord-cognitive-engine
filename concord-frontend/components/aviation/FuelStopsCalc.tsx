'use client';

import { useEffect, useState } from 'react';
import { Fuel, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';

interface Aircraft { id: string; tail: string; cruiseKts: number; fuelBurnGph: number; fuelCapacityGal: number }
interface Result {
  totalDistanceNm: number; totalTimeHr: number; totalFuelGal: number;
  maxLegNm: number; fuelStopsRequired: number; reserveGal: number;
  cruiseKts: number; fuelBurnGph: number; usableFuelGal: number;
}

export function FuelStopsCalc() {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [form, setForm] = useState({ aircraftId: '', totalDistanceNm: '', reserveGal: '5' });
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.post('/api/lens/run', { domain: 'aviation', action: 'aircraft-list', input: {} });
        setAircraft((r.data?.result?.aircraft || []) as Aircraft[]);
      } catch (e) { console.error('[FuelStops] aircraft', e); }
    })();
  }, []);

  async function calc() {
    if (!form.aircraftId || !form.totalDistanceNm) return;
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'aviation', action: 'fuel-stops-calc', input: { aircraftId: form.aircraftId, totalDistanceNm: Number(form.totalDistanceNm), reserveGal: Number(form.reserveGal) || 5 } });
      setResult((r.data?.result as Result) || null);
    } catch (e) { console.error('[FuelStops] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Fuel className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Fuel stops calculator</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <select value={form.aircraftId} onChange={e => setForm({ ...form, aircraftId: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Aircraft…</option>
          {aircraft.map(a => <option key={a.id} value={a.id}>{a.tail} · {a.cruiseKts}kt @ {a.fuelBurnGph}gph</option>)}
        </select>
        <input type="number" value={form.totalDistanceNm} onChange={e => setForm({ ...form, totalDistanceNm: e.target.value })} placeholder="Total nm" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.reserveGal} onChange={e => setForm({ ...form, reserveGal: e.target.value })} placeholder="Reserve gal" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={calc} disabled={loading || !form.aircraftId} className="col-span-4 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Fuel className="w-3 h-3" />} Calculate
        </button>
      </div>
      {result && (
        <div className="p-4 grid grid-cols-3 gap-3">
          <Tile label="Fuel stops" value={String(result.fuelStopsRequired)} tone="amber" />
          <Tile label="Max leg" value={`${result.maxLegNm} nm`} tone="cyan" />
          <Tile label="Total time" value={`${result.totalTimeHr}h`} tone="violet" />
          <Tile label="Total fuel" value={`${result.totalFuelGal} gal`} tone="amber" />
          <Tile label="Usable fuel" value={`${result.usableFuelGal} gal`} tone="cyan" />
          <Tile label="Reserve" value={`${result.reserveGal} gal`} tone="emerald" />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  const colour = tone === 'amber' ? 'text-amber-300 border-amber-500/30 bg-amber-500/5' : tone === 'cyan' ? 'text-cyan-300 border-cyan-500/30 bg-cyan-500/5' : tone === 'violet' ? 'text-violet-300 border-violet-500/30 bg-violet-500/5' : 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5';
  return (
    <div className={`rounded-lg border p-3 text-center ${colour}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-xl font-mono font-bold tabular-nums">{value}</div>
    </div>
  );
}

export default FuelStopsCalc;
