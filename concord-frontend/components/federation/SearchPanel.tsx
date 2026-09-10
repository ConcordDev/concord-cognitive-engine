'use client';

import { useState, useCallback, useMemo } from 'react';
import { Search, Loader2 } from 'lucide-react';

interface SearchHit {
  id?: string;
  dtuId?: string;
  title?: string;
  source?: string;
  peerName?: string;
  score?: number;
  snippet?: string;
}

export function SearchPanel() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [meta, setMeta] = useState<{ total?: number; fanout?: number } | null>(null);
  const [scope, setScope] = useState<'all' | 'self' | 'remote'>('all');

  const runSearch = useCallback(async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/federation/search?q=${encodeURIComponent(q)}&limit=30`, {
        credentials: 'include',
      });
      const data = await r.json();
      setResults((data.results || []) as SearchHit[]);
      setMeta({ total: data.total, fanout: data.fanout });
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [q]);

  const visible = useMemo(() => {
    if (!results) return null;
    if (scope === 'self') return results.filter((r) => r.source === 'self');
    if (scope === 'remote') return results.filter((r) => r.source !== 'self');
    return results;
  }, [results, scope]);

  return (
    <section className="rounded-lg border border-violet-500/30 bg-black/60 p-4">
      <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Search className="w-4 h-4" /> Cross-instance search
      </h2>
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
          placeholder='Try "drought-tolerant agriculture" or "post-quantum signing"...'
          className="flex-1 min-w-[260px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-400"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
          className="bg-black/60 border border-white/10 rounded px-2 py-2 text-sm text-gray-200"
        >
          <option value="all">All</option>
          <option value="self">Local</option>
          <option value="remote">Remote</option>
        </select>
        <button
          type="button"
          onClick={runSearch}
          disabled={searching || !q.trim()}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {meta && (
        <div className="text-xs text-gray-400 mb-3">
          {meta.total ?? 0} result{meta.total === 1 ? '' : 's'} across {meta.fanout ?? 0} instance{meta.fanout === 1 ? '' : 's'}
          {scope !== 'all' && ` (scoped: ${scope})`}.
        </div>
      )}

      {visible === null ? (
        <p className="text-xs text-gray-400 italic">Enter a query and press Enter or Search.</p>
      ) : visible.length === 0 ? (
        <div className="text-gray-400 italic">No matches.</div>
      ) : (
        <ul className="space-y-2">
          {visible.map((r, i) => (
            <li
              key={`${r.dtuId ?? r.id ?? i}`}
              className="border-l-2 border-violet-400/40 pl-3 py-1"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-100 text-sm font-medium">{r.title ?? '(untitled)'}</span>
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  r.source === 'self'
                    ? 'bg-amber-700/60 text-amber-200'
                    : 'bg-violet-700/60 text-violet-100'
                }`}>
                  {r.source === 'self' ? 'local' : (r.peerName ?? r.source)}
                </span>
                {typeof r.score === 'number' && (
                  <span className="text-[10px] text-gray-400">{r.score.toFixed(3)}</span>
                )}
              </div>
              {r.snippet && <div className="text-xs text-gray-400 mt-1">{r.snippet}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
