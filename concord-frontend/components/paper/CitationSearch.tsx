'use client';

import { useState } from 'react';
import { Search, Loader2, FileText, Quote } from 'lucide-react';
import { api } from '@/lib/api/client';

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  journal?: string;
  year: number;
  doi?: string;
  abstract: string;
  citationCount: number;
  openAccess: boolean;
}

export function CitationSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'paper', action: 'search', input: { query: query.trim() } });
      setResults((res.data?.result?.papers || []) as Paper[]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Search className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Citation search</span>
        <span className="ml-auto text-[10px] text-gray-500">arXiv / PubMed / Semantic Scholar shape</span>
      </header>
      <div className="p-3 border-b border-white/10 flex items-center gap-2 text-xs">
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} placeholder="Search papers (e.g. transformer attention)" className="flex-1 px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={search} disabled={loading || !query.trim()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Search
        </button>
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        {results.length === 0 && !loading ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">Enter a query to search papers.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {results.map(p => (
              <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-start gap-3">
                  <FileText className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-white">{p.title}</h3>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {p.authors.slice(0, 3).join(', ')}{p.authors.length > 3 ? ' et al.' : ''} · {p.year} · {p.journal || 'arXiv'}
                      {p.doi && ` · doi:${p.doi}`}
                    </div>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-3">{p.abstract}</p>
                    <div className="text-[10px] text-gray-500 mt-1 flex items-center gap-3">
                      <span className="inline-flex items-center gap-0.5"><Quote className="w-3 h-3" /> {p.citationCount} cites</span>
                      {p.openAccess && <span className="text-green-400">Open access</span>}
                    </div>
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
export default CitationSearch;
