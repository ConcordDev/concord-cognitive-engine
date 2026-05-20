'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Loader2, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Factor { key: string; co2e: number; unit: string; scope: 1 | 2 | 3; source: string }

const SCOPE_COLOUR: Record<1 | 2 | 3, string> = {
  1: 'bg-rose-500/15 text-rose-300',
  2: 'bg-amber-500/15 text-amber-300',
  3: 'bg-cyan-500/15 text-cyan-300',
};

export function EmissionFactorsLibrary() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState<'' | '1' | '2' | '3'>('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await lensRun({ domain: 'environment', action: 'emission-factors-list', input: {} });
        setFactors((r.data?.result?.factors || []) as Factor[]);
        setSource(String(r.data?.result?.source || ''));
      } catch (e) { console.error('[Factors] failed', e); }
      finally { setLoading(false); }
    })();
  }, []);

  const filtered = factors.filter(f => {
    if (scope && String(f.scope) !== scope) return false;
    if (filter && !f.key.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Emission factors library</span>
        <span className="ml-auto text-[10px] text-gray-500">{filtered.length} / {factors.length}</span>
      </header>
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 text-[11px] text-gray-500">
        <Search className="w-3 h-3" />
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name…" className="flex-1 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={scope} onChange={e => setScope(e.target.value as typeof scope)} className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">All</option><option value="1">S1</option><option value="2">S2</option><option value="3">S3</option>
        </select>
      </div>
      {source && <div className="px-3 py-1.5 border-b border-white/10 text-[10px] text-emerald-300/70">{source}</div>}
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-gray-500 border-b border-white/5"><tr><th className="text-left px-3 py-1.5">Factor</th><th className="text-right">kg CO₂e / unit</th><th>Scope</th><th className="text-left pr-3">Source</th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map(f => (
                <tr key={f.key} className="hover:bg-white/[0.03]">
                  <td className="px-3 py-1.5 font-mono text-white">{f.key.replace(/_/g, ' ')}</td>
                  <td className="text-right font-mono tabular-nums text-emerald-300">{f.co2e} / {f.unit}</td>
                  <td><span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', SCOPE_COLOUR[f.scope])}>S{f.scope}</span></td>
                  <td className="text-[10px] text-gray-500 pr-3">{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default EmissionFactorsLibrary;
