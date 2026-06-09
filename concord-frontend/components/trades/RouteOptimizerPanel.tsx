'use client';

import { useState } from 'react';
import { Route, Loader2, MapPin, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Stop { id: string; lat: number; lng: number; label?: string }

export function RouteOptimizerPanel() {
  const [start, setStart] = useState({ lat: '0', lng: '0' });
  const [stops, setStops] = useState<Stop[]>([
    { id: 's1', lat: 37.7749, lng: -122.4194, label: 'SF' },
    { id: 's2', lat: 37.8044, lng: -122.2712, label: 'Oakland' },
    { id: 's3', lat: 37.5485, lng: -121.9886, label: 'Fremont' },
  ]);
  const [result, setResult] = useState<{ ordered: Array<Stop & { distanceFromPrev: number }>; totalDistanceUnits: number; estimatedDriveMin: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [newStop, setNewStop] = useState({ label: '', lat: '', lng: '' });

  async function optimize() {
    if (stops.length === 0) return;
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'trades', action: 'route-optimize',
        input: {
          start: { lat: Number(start.lat), lng: Number(start.lng) },
          stops: stops.map(s => ({ id: s.id, lat: s.lat, lng: s.lng, label: s.label })),
        },
      });
      setResult(res.data?.result || null);
    } catch (e) { console.error('[Route] failed', e); }
    finally { setLoading(false); }
  }

  function addStop() {
    if (!newStop.label.trim() || !newStop.lat || !newStop.lng) return;
    setStops(prev => [...prev, { id: `s_${Date.now()}`, lat: Number(newStop.lat), lng: Number(newStop.lng), label: newStop.label }]);
    setNewStop({ label: '', lat: '', lng: '' });
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Route className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Route optimizer · nearest-neighbour</span>
      </header>

      <div className="p-3 space-y-3">
        <div className="grid grid-cols-4 gap-2 text-xs items-center">
          <span className="text-gray-400">Start:</span>
          <input value={start.lat} onChange={e => setStart({ ...start, lat: e.target.value })} placeholder="Lat" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={start.lng} onChange={e => setStart({ ...start, lng: e.target.value })} placeholder="Lng" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={optimize} disabled={loading || stops.length === 0} className="px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">{loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Optimize'}</button>
        </div>

        <div className="rounded border border-white/10">
          <header className="px-2 py-1 bg-white/[0.02] text-[10px] uppercase tracking-wider text-gray-400">Stops ({stops.length})</header>
          <ul className="max-h-40 overflow-y-auto divide-y divide-white/5">
            {stops.map(s => (
              <li key={s.id} className="px-2 py-1 text-xs flex items-center gap-2 group">
                <MapPin className="w-3 h-3 text-cyan-300" />
                <span className="text-white">{s.label || s.id}</span>
                <span className="text-[10px] text-gray-400 font-mono">{s.lat.toFixed(4)},{s.lng.toFixed(4)}</span>
                <button aria-label="Delete" onClick={() => setStops(prev => prev.filter(x => x.id !== s.id))} className="ml-auto opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
          <div className="p-2 border-t border-white/5 grid grid-cols-4 gap-1">
            <input value={newStop.label} onChange={e => setNewStop({ ...newStop, label: e.target.value })} placeholder="Label" className="px-1.5 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={newStop.lat} onChange={e => setNewStop({ ...newStop, lat: e.target.value })} placeholder="Lat" className="px-1.5 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={newStop.lng} onChange={e => setNewStop({ ...newStop, lng: e.target.value })} placeholder="Lng" className="px-1.5 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <button onClick={addStop} className="px-1.5 py-0.5 text-[11px] rounded bg-cyan-500/30 text-cyan-300 hover:bg-cyan-500/50">+ Stop</button>
          </div>
        </div>

        {result && (
          <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1">Optimal order · {result.estimatedDriveMin}min drive estimate</div>
            <ol className="space-y-1">
              {result.ordered.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                  <span className="text-white">{s.label || s.id}</span>
                  <span className="text-[10px] text-gray-400 font-mono ml-auto">+{s.distanceFromPrev.toFixed(2)} units</span>
                </li>
              ))}
            </ol>
            <div className="mt-2 text-[10px] text-gray-400">Total: {result.totalDistanceUnits.toFixed(2)} units</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RouteOptimizerPanel;
