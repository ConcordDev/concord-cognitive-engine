'use client';

/**
 * DatamusePanel — real Datamuse word-relationship lookup, drop-in for
 * linguistics / creative-writing / poetry lenses. No API key.
 *
 * Phase 4 (third wave) of the UX completeness sprint.
 */

import { useState, useCallback, useRef } from 'react';
import { Pilcrow, RefreshCw, AlertTriangle, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface WordResult {
  word: string;
  score: number | null;
  numSyllables: number | null;
  tags: string[];
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
  { value: 'rhymes',      label: 'Rhymes' },
  { value: 'near_rhymes', label: 'Near rhymes' },
  { value: 'synonyms',    label: 'Synonyms' },
  { value: 'antonyms',    label: 'Antonyms' },
  { value: 'triggers',    label: 'Triggers (associations)' },
  { value: 'follows',     label: 'Words that follow' },
  { value: 'precedes',    label: 'Words that precede' },
  { value: 'means',       label: 'Means like' },
  { value: 'sounds_like', label: 'Sounds like' },
  { value: 'spelled_like',label: 'Spelled like' },
];

export interface DatamusePanelProps {
  domain: 'linguistics' | 'creative-writing' | 'poetry';
  className?: string;
}

export function DatamusePanel({ domain, className }: DatamusePanelProps) {
  const [word, setWord] = useState('');
  const [kind, setKind] = useState('rhymes');
  const [results, setResults] = useState<WordResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (w: string, k: string) => {
    if (!w.trim()) {
      setResults([]); return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; words?: WordResult[]; reason?: string }>(
      domain, 'live_datamuse', { word: w, kind: k, max: 25 },
    );
    if (r?.ok) setResults(r.words || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain]);

  const onWordChange = (next: string) => {
    setWord(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next, kind), 400);
  };

  const onKindChange = (next: string) => {
    setKind(next);
    if (word.trim()) void fetchData(word, next);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Pilcrow className="w-4 h-4 text-fuchsia-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Datamuse · word relationships</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(word, kind)}
          disabled={loading || !word.trim()}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40 flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
          <input
            type="search"
            value={word}
            onChange={(e) => onWordChange(e.target.value)}
            placeholder="Word…"
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/40"
          />
        </div>
        <select
          value={kind}
          onChange={(e) => onKindChange(e.target.value)}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/40"
        >
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Datamuse unreachable ({error})
        </div>
      )}

      {!error && !loading && results.length === 0 && word.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">No matches for that word.</div>
      )}

      {!error && !word.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">Type a word, pick a relationship.</div>
      )}

      {results.length > 0 && (
        <div className="px-3 py-3 flex flex-wrap gap-1.5 max-h-[400px] overflow-y-auto">
          {results.map((r) => (
            <span
              key={r.word}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-zinc-900/60 border border-zinc-800 text-zinc-200 hover:border-fuchsia-500/40"
              title={r.tags.length > 0 ? r.tags.join(', ') : undefined}
            >
              {r.word}
              {r.numSyllables ? <span className="text-[9px] text-zinc-400 font-mono">{r.numSyllables}σ</span> : null}
            </span>
          ))}
        </div>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: Datamuse · word-relationship API
      </footer>
    </section>
  );
}

export default DatamusePanel;
