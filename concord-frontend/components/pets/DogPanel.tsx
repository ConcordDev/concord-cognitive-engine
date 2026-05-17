'use client';

/**
 * DogPanel — real Dog CEO random dog images, drop-in for pets lens.
 * No API key.
 *
 * Phase 4 (sixth wave) of the UX completeness sprint.
 */

import { useEffect, useState } from 'react';
import { Dog, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface DogPanelProps {
  className?: string;
}

export function DogPanel({ className }: DogPanelProps) {
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; images?: string[]; reason?: string }>(
      'pets', 'live_dog', { count: 8 },
    );
    if (r?.ok) setImages(r.images || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await runMacro<{ ok: boolean; images?: string[]; reason?: string }>(
        'pets', 'live_dog', { count: 8 },
      );
      if (cancelled) return;
      if (r?.ok) setImages(r.images || []);
      else setError(r?.reason || 'fetch_failed');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Dog className="w-4 h-4 text-amber-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Random dogs</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Dog CEO unreachable ({error})
        </div>
      )}

      {!error && images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-2">
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${src}-${i}`}
              src={src}
              alt=""
              loading="lazy"
              className="w-full aspect-square object-cover rounded border border-zinc-800/60"
            />
          ))}
        </div>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: Dog CEO API · dog.ceo
      </footer>
    </section>
  );
}

export default DogPanel;
