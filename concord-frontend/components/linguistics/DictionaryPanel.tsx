'use client';

/**
 * DictionaryPanel — real Free Dictionary API lookup, drop-in for
 * linguistics + education lenses. No API key.
 *
 * Phase 4 (third wave) of the UX completeness sprint.
 */

import { useState, useCallback, useRef } from 'react';
import { Book, RefreshCw, AlertTriangle, Search, Volume2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Definition {
  definition: string;
  example: string | null;
  synonyms: string[];
  antonyms: string[];
}

interface Meaning {
  partOfSpeech: string;
  definitions: Definition[];
}

interface DictionaryEntry {
  word: string;
  phonetic: string | null;
  audio: string | null;
  origin: string | null;
  meanings: Meaning[];
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface DictionaryPanelProps {
  domain: 'linguistics' | 'education';
  className?: string;
}

export function DictionaryPanel({ domain, className }: DictionaryPanelProps) {
  const [word, setWord] = useState('');
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (w: string) => {
    if (!w.trim()) {
      setEntries([]); return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; entries?: DictionaryEntry[]; reason?: string }>(
      domain, 'live_dictionary', { word: w },
    );
    if (r?.ok) setEntries(r.entries || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain]);

  const onWordChange = (next: string) => {
    setWord(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next), 500);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Book className="w-4 h-4 text-sky-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Dictionary · definitions</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(word)}
          disabled={loading || !word.trim()}
          className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40 relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
        <input
          type="search"
          value={word}
          onChange={(e) => onWordChange(e.target.value)}
          placeholder="Look up a word…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Dictionary unreachable ({error})
        </div>
      )}

      {!error && !loading && entries.length === 0 && word.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No definitions for that word.</div>
      )}

      {!error && !word.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">Type a word to look it up.</div>
      )}

      {entries.length > 0 && (
        <div className="divide-y divide-zinc-800/40 max-h-[500px] overflow-y-auto">
          {entries.map((e, idx) => (
            <article key={`${e.word}-${idx}`} className="px-3 py-3">
              <header className="flex items-baseline gap-2 mb-2">
                <h4 className="text-sm font-semibold text-zinc-100">{e.word}</h4>
                {e.phonetic && <span className="text-[11px] text-zinc-400 font-mono">{e.phonetic}</span>}
                {e.audio && (
                  <button
                    type="button"
                    onClick={() => { try { new Audio(e.audio!).play(); } catch { /* silent */ } }}
                    className="text-zinc-500 hover:text-sky-300 ml-auto"
                    aria-label="Play pronunciation"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </header>
              {e.meanings.map((m, mi) => (
                <div key={mi} className="mb-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{m.partOfSpeech}</div>
                  <ol className="space-y-1 ml-3 list-decimal text-xs text-zinc-300">
                    {m.definitions.map((d, di) => (
                      <li key={di}>
                        {d.definition}
                        {d.example && <div className="italic text-zinc-500 mt-0.5">— {d.example}</div>}
                        {d.synonyms.length > 0 && (
                          <div className="text-[10px] text-zinc-500 mt-0.5">syn: {d.synonyms.slice(0, 4).join(', ')}</div>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
              {e.origin && (
                <div className="text-[10px] text-zinc-500 italic mt-1.5">Origin: {e.origin}</div>
              )}
            </article>
          ))}
        </div>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: Free Dictionary API (dictionaryapi.dev)
      </footer>
    </section>
  );
}

export default DictionaryPanel;
