'use client';

import { useState } from 'react';
import { Map as MapIcon, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface EJData { lat: number; lng: number; radiusMiles: number; data?: unknown }

export function EJScreenLookup() {
  const [form, setForm] = useState({ lat: '', lng: '', radiusMiles: '1' });
  const [result, setResult] = useState<EJData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!form.lat || !form.lng) return;
    setLoading(true); setError(null);
    try {
      const r = await lensRun({ domain: 'environment', action: 'epa-ejscreen', input: { lat: Number(form.lat), lng: Number(form.lng), radiusMiles: Number(form.radiusMiles) } });
      if (r.data?.ok === false) setError((r.data?.error as string) || 'lookup failed');
      else setResult(r.data?.result as EJData);
    } catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MapIcon className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">EPA EJScreen · environmental justice</span>
        <span className="ml-auto text-[10px] text-gray-500">ejscreen.epa.gov</span>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <input type="number" step="0.0001" value={form.lat} onChange={e => setForm({ ...form, lat: e.target.value })} placeholder="Latitude" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input type="number" step="0.0001" value={form.lng} onChange={e => setForm({ ...form, lng: e.target.value })} placeholder="Longitude" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input type="number" step="0.1" value={form.radiusMiles} onChange={e => setForm({ ...form, radiusMiles: e.target.value })} placeholder="Radius miles" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button type="submit" disabled={loading} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapIcon className="w-3 h-3" />} Lookup
        </button>
      </form>
      <div className="max-h-96 overflow-y-auto p-3">
        {error && <div className="text-center text-xs text-rose-300">{error}</div>}
        {!loading && !error && !result && (
          <div className="px-3 py-8 text-center text-xs text-gray-500"><MapIcon className="w-6 h-6 mx-auto mb-2 opacity-30" />Enter coords to pull EPA environmental justice screening data for that area.</div>
        )}
        {result && (
          <div className="space-y-2">
            <div className="text-[11px] text-amber-300">Lat {result.lat}, Lng {result.lng} · {result.radiusMiles}mi radius</div>
            <pre className="text-[10px] font-mono text-gray-300 bg-black/30 rounded p-2 overflow-auto max-h-80">{JSON.stringify(result.data || result, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default EJScreenLookup;
