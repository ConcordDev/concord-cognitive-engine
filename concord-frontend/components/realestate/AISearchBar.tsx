'use client';

import { useState } from 'react';
import { Sparkles, Search, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Parsed {
  filters: Record<string, unknown>;
  tags: string[];
  query: string;
  parsedFieldCount: number;
}

export function AISearchBar({ onParsed }: { onParsed?: (p: Parsed) => void }) {
  const [query, setQuery] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [loading, setLoading] = useState(false);

  async function parse(q?: string) {
    const text = (q ?? query).trim();
    if (!text) return;
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'realestate', action: 'parse-search-query', input: { query: text } });
      const p = res.data?.result as Parsed | undefined;
      if (p) {
        setParsed(p);
        onParsed?.(p);
        setQuery(text);
      }
    } catch (e) { console.error('[AISearch] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Conversational search</span>
        <span className="ml-auto text-[10px] text-gray-500">type naturally</span>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); parse(); }} className="p-3 border-b border-white/10 flex items-center gap-2">
        <Search className="w-4 h-4 text-gray-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Describe what you want…" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button type="submit" disabled={loading || !query.trim()} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40 inline-flex items-center gap-1.5">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Parse
        </button>
      </form>
      <div className="p-3 space-y-2">
        {parsed && (
          <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 text-xs">
            <div className="text-[10px] uppercase tracking-wider text-violet-300 mb-1.5">Parsed → {parsed.parsedFieldCount} field{parsed.parsedFieldCount === 1 ? '' : 's'}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
              {Object.entries(parsed.filters).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="text-gray-500">{k}:</span>
                  <span className="text-emerald-300">{Array.isArray(v) ? v.join(', ') : String(v)}</span>
                </div>
              ))}
              {parsed.tags.length > 0 && (
                <div className="col-span-2 mt-1">
                  <span className="text-gray-500">tags:</span>{' '}
                  {parsed.tags.map(t => <span key={t} className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px]">{t}</span>)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AISearchBar;
