'use client';

/**
 * CatFactsPanel — real Cat Facts API drop-in for pets lens. No API key.
 *
 * Phase 4 (fifth wave) of the UX completeness sprint. Real cat facts
 * from catfact.ninja; refreshable.
 */

import { useEffect, useState } from 'react';
import { Cat, RefreshCw, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { discoverItems } from './discover-payload';

interface Fact {
  fact: string;
  length: number;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface CatFactsPanelProps {
  className?: string;
}

function readFacts(envelope: Parameters<typeof discoverItems>[0]) {
  const got = discoverItems(envelope, 'facts');
  const facts = (got.items as Fact[]).filter((f) => typeof f?.fact === 'string' && f.fact.trim() !== '');
  if (!got.error && facts.length === 0) return { facts: [] as Fact[], error: 'no_content' };
  return { facts: got.error ? [] as Fact[] : facts, error: got.error };
}

export function CatFactsPanel({ className }: CatFactsPanelProps) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; result?: { facts?: Fact[] }; error?: string | null; reason?: string }>(
      'pets', 'live_catfact', { count: 6 },
    );
    const got = readFacts(r);
    setFacts(got.facts);
    setError(got.error);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await runMacro<{ ok: boolean; result?: { facts?: Fact[] }; error?: string | null; reason?: string }>(
        'pets', 'live_catfact', { count: 6 },
      );
      if (cancelled) return;
      const got = readFacts(r);
      setFacts(got.facts);
      setError(got.error);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Cat className="w-4 h-4 text-orange-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Cat facts</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      {loading && facts.length === 0 && !error && (
        <p className="px-3 py-3 text-xs text-zinc-400">Loading Cat Facts…</p>
      )}

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
          {error === 'no_content' ? 'Cat Facts returned no facts.' : `Cat Facts unreachable (${error})`}
        </div>
      )}

      {!error && facts.length > 0 && (
        <ul className="divide-y divide-zinc-800/40">
          {facts.map((f, i) => (
            <li key={i} className="px-4 py-2.5 text-xs text-zinc-300">
              {f.fact}
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: Cat Facts API · catfact.ninja
      </footer>
    </section>
  );
}

export default CatFactsPanel;
