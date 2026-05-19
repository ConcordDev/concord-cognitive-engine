'use client';

import { useState } from 'react';
import { Compass, Loader2, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api/client';

interface Suggestion { route: string[]; rationale: string; flownCount: number; altitudeFt: number }

export function RouteAdvisor() {
  const [form, setForm] = useState({ from: '', to: '', altitudeFt: '8000' });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  async function advise() {
    if (!form.from.trim() || !form.to.trim()) return;
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'aviation', action: 'route-advisor', input: { from: form.from, to: form.to, altitudeFt: Number(form.altitudeFt) } });
      setSuggestions((res.data?.result?.suggestions || []) as Suggestion[]);
    } catch (e) { console.error('[Route] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Compass className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Route advisor</span>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); advise(); }} className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <input value={form.from} onChange={e => setForm({ ...form, from: e.target.value.toUpperCase() })} placeholder="From ICAO" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.to} onChange={e => setForm({ ...form, to: e.target.value.toUpperCase() })} placeholder="To ICAO" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input type="number" value={form.altitudeFt} onChange={e => setForm({ ...form, altitudeFt: e.target.value })} placeholder="Alt ft" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button type="submit" disabled={loading} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Compass className="w-3 h-3" />} Advise
        </button>
      </form>
      <div className="max-h-72 overflow-y-auto p-3">
        {suggestions.length === 0 ? (
          <div className="text-center text-xs text-gray-500 py-6">Enter from/to ICAO codes to see Direct + prior-flown route options from your logbook.</div>
        ) : (
          <ul className="space-y-2">
            {suggestions.map((s, i) => (
              <li key={i} className="px-3 py-2 rounded border border-white/10 bg-white/[0.03]">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {s.route.map((p, j) => (
                    <span key={j} className="inline-flex items-center gap-1">
                      <span className="font-mono text-xs text-cyan-300">{p}</span>
                      {j < s.route.length - 1 && <ArrowRight className="w-3 h-3 text-gray-500" />}
                    </span>
                  ))}
                  <span className="ml-auto text-[10px] text-gray-400 font-mono">{s.altitudeFt}ft</span>
                </div>
                <div className="text-[11px] text-gray-400">{s.rationale}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RouteAdvisor;
