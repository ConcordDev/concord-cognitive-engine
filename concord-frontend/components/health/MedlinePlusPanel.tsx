'use client';

/**
 * MedlinePlusPanel — real MedlinePlus (NIH/NLM) consumer-health topic
 * search, drop-in for the mental-health lens. No API key.
 *
 * Phase 4 of the UX completeness sprint.
 */

import { useState, useCallback, useRef } from 'react';
import { HeartPulse, RefreshCw, AlertTriangle, ExternalLink, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MedlinePlusTopic {
  url: string;
  title: string;
  altTitle: string | null;
  snippet: string;
  group: string | null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface MedlinePlusPanelProps {
  className?: string;
  initialQuery?: string;
}

export function MedlinePlusPanel({ className, initialQuery = '' }: MedlinePlusPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [topics, setTopics] = useState<MedlinePlusTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) {
      setTopics([]);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; topics?: MedlinePlusTopic[]; fetchedAt?: number; reason?: string }>(
      'mental-health', 'live_medlineplus', { query: q },
    );
    if (r?.ok) {
      setTopics(r.topics || []);
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, []);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next), 500);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <HeartPulse className="w-4 h-4 text-rose-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">MedlinePlus · consumer health topics</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(query)}
          disabled={loading || !query.trim()}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40 relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="e.g. depression, sleep, anxiety…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-rose-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          MedlinePlus unreachable ({error})
        </div>
      )}

      {!error && !loading && topics.length === 0 && query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">No MedlinePlus topics for that query.</div>
      )}

      {!error && !query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">
          Authoritative consumer-health info from NIH / National Library of Medicine.
        </div>
      )}

      {topics.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[500px] overflow-y-auto">
          {topics.map((t, idx) => (
            <li key={`${t.url}-${idx}`} className="px-3 py-2 text-xs">
              <a
                href={t.url}
                target="_blank" rel="noopener noreferrer"
                className="text-zinc-200 font-medium hover:text-rose-300 leading-snug flex items-center gap-1"
              >
                {t.title}
                <ExternalLink className="w-3 h-3 text-zinc-400 shrink-0" />
              </a>
              {t.altTitle && (
                <div className="text-[10px] text-zinc-400 italic mt-0.5">also: {t.altTitle}</div>
              )}
              {t.snippet && (
                <p className="text-[11px] text-zinc-400 mt-1 line-clamp-3">{t.snippet}</p>
              )}
              {t.group && (
                <div className="text-[10px] text-zinc-400 mt-1 font-mono">{t.group}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: MedlinePlus (NLM/NIH) · {updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
        <span className="block mt-0.5 italic text-zinc-600">
          Information only — not a substitute for medical advice. Consult a licensed clinician.
        </span>
      </footer>
    </section>
  );
}

export default MedlinePlusPanel;
