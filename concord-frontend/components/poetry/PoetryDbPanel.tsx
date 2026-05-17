'use client';

/**
 * PoetryDbPanel — real PoetryDB public-domain poem search, drop-in for
 * the poetry lens. No API key.
 *
 * Phase 4 (fifth wave) of the UX completeness sprint.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Pen, RefreshCw, AlertTriangle, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Poem {
  title: string;
  author: string;
  lineCount: number;
  lines: string[];
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

const KIND_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'lines', label: 'Line text' },
];

export interface PoetryDbPanelProps {
  className?: string;
}

export function PoetryDbPanel({ className }: PoetryDbPanelProps) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('title');
  const [poems, setPoems] = useState<Poem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string, k: string) => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; poems?: Poem[]; reason?: string }>(
      'poetry', 'live_poetrydb', { query: q || undefined, kind: k },
    );
    if (r?.ok) setPoems(r.poems || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, []);

  useEffect(() => { void fetchData('', 'title'); }, [fetchData]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next, kind), 500);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Pen className="w-4 h-4 text-purple-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">PoetryDB · public-domain poems</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(query, kind)}
          disabled={loading}
          className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40 flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Leave empty for random sample…"
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
          />
        </div>
        <select
          value={kind}
          onChange={(e) => { setKind(e.target.value); void fetchData(query, e.target.value); }}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
        >
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> PoetryDB unreachable ({error})
        </div>
      )}

      {!error && !loading && poems.length === 0 && query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No poems match.</div>
      )}

      {poems.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[600px] overflow-y-auto">
          {poems.map((p, idx) => (
            <li key={`${p.title}-${p.author}-${idx}`} className="px-4 py-3 text-xs">
              <header className="mb-2">
                <h4 className="text-sm font-semibold text-zinc-100">{p.title}</h4>
                <div className="text-[11px] text-zinc-500">— {p.author} · {p.lineCount} lines</div>
              </header>
              <details>
                <summary className="text-[11px] text-zinc-400 hover:text-purple-300 cursor-pointer">Read poem</summary>
                <pre className="mt-2 text-[11px] text-zinc-300 whitespace-pre-wrap font-serif leading-relaxed bg-zinc-900/40 rounded p-2 max-h-72 overflow-y-auto">
{p.lines.join('\n')}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: PoetryDB · poetrydb.org
      </footer>
    </section>
  );
}

export default PoetryDbPanel;
