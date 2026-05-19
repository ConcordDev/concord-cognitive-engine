'use client';

import { useState } from 'react';
import { Database, Search, Loader2, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api/client';

interface Dataset { id: string; name: string; title: string; organization: string; notes: string; resourceCount: number; firstResourceUrl: string | null; firstResourceFormat: string | null; lastModified: string | null }

export function OpenDataExplorer() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Dataset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await api.post('/api/lens/run', { domain: 'government', action: 'open-data-search', input: { query } });
      if (res.data?.ok === false) {
        setError((res.data?.error as string) || 'search failed');
        setResults([]); setTotal(0);
      } else {
        setResults((res.data?.result?.results || []) as Dataset[]);
        setTotal(res.data?.result?.total || 0);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Database className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Open data search</span>
        <span className="ml-auto text-[10px] text-gray-500">data.gov CKAN</span>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="p-3 border-b border-white/10 flex items-center gap-2">
        <Search className="w-4 h-4 text-gray-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search 300,000+ federal datasets (e.g. 'crime', 'water quality', 'permits')" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button type="submit" disabled={loading} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Search
        </button>
      </form>
      <div className="max-h-96 overflow-y-auto p-3">
        {error && <div className="px-3 py-3 text-center text-xs text-rose-300">{error}</div>}
        {!loading && !error && results.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-gray-500"><Database className="w-6 h-6 mx-auto mb-2 opacity-30" />Search to explore federal/state/local open datasets.</div>
        )}
        {total > 0 && <div className="text-[10px] text-gray-500 mb-2">{total.toLocaleString()} matches · showing top {results.length}</div>}
        {results.length > 0 && (
          <ul className="space-y-2">
            {results.map(d => (
              <li key={d.id} className="px-3 py-2 rounded border border-white/10 bg-white/[0.03]">
                <div className="flex items-start gap-2">
                  <Database className="w-3.5 h-3.5 text-cyan-300 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white">{d.title}</div>
                    <div className="text-[10px] text-gray-500">{d.organization}{d.lastModified && ` · updated ${d.lastModified.slice(0, 10)}`}</div>
                    {d.notes && <p className="mt-1 text-[11px] text-gray-400 line-clamp-2">{d.notes}</p>}
                    {d.firstResourceUrl && (
                      <a href={d.firstResourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-cyan-300 hover:text-cyan-200">
                        <ExternalLink className="w-2.5 h-2.5" /> {d.firstResourceFormat || 'open'} · {d.resourceCount} files
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default OpenDataExplorer;
