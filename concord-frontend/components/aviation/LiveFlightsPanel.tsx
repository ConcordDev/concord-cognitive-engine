'use client';

import { useEffect, useState } from 'react';
import { Radar, Plus, X, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Watched { id: string; ident: string; addedAt: string; lastSeenAt: string | null; lastPosition: { lat: number; lng: number; altitudeFt: number } | null }

export function LiveFlightsPanel() {
  const [watched, setWatched] = useState<Watched[]>([]);
  const [loading, setLoading] = useState(true);
  const [ident, setIdent] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'aviation', action: 'live-flights-tracked', input: {} });
      setWatched((res.data?.result?.flights || []) as Watched[]);
    } catch (e) { console.error('[Live] failed', e); }
    finally { setLoading(false); }
  }

  async function watch() {
    if (!ident.trim()) return;
    try {
      const res = await lensRun({ domain: 'aviation', action: 'live-flights-watch', input: { ident } });
      if (res.data?.ok === false) alert(res.data?.error);
      setIdent('');
      await refresh();
    } catch (e) { console.error('[Live] watch', e); }
  }

  async function unwatch(i: string) {
    try {
      await lensRun({ domain: 'aviation', action: 'live-flights-unwatch', input: { ident: i } });
      await refresh();
    } catch (e) { console.error('[Live] unwatch', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Radar className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Live flight tracking</span>
        <span className="ml-auto text-[10px] text-gray-400">{watched.length} watched</span>
      </header>
      <div className="p-3 border-b border-white/10 flex items-center gap-2">
        <input value={ident} onChange={e => setIdent(e.target.value.toUpperCase())} placeholder="Callsign or tail (UAL123 / N12345)" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <button onClick={watch} disabled={!ident.trim()} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Watch</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : watched.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Radar className="w-6 h-6 mx-auto mb-2 opacity-30" />Add a callsign or tail to watch. Live position requires FAA SWIM / FlightAware AeroAPI key in production.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {watched.map(w => (
              <li key={w.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <Radar className="w-3.5 h-3.5 text-cyan-300" />
                <span className="font-mono text-sm text-white">{w.ident}</span>
                <span className="ml-auto text-[10px] text-gray-400">
                  {w.lastPosition ? `${w.lastPosition.lat.toFixed(2)},${w.lastPosition.lng.toFixed(2)} @ ${w.lastPosition.altitudeFt}ft` : 'awaiting position feed'}
                </span>
                <button aria-label="Unwatch flight" onClick={() => unwatch(w.ident)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><X className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default LiveFlightsPanel;
