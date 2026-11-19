'use client';

/**
 * MetMuseumPanel — real MET Museum Open Access search for art / gallery.
 *
 * Phase 4 of the 10-dimension UX completeness sprint. Backed by
 * art.live_met_search / gallery.live_met_search.
 *
 * The MET Museum Open Access program publishes every object in their
 * collection under CC0; we surface a search-as-you-type grid with
 * real images, artist attribution, medium / culture / date / department.
 */

import { useState, useCallback, useRef } from 'react';
import { Search, Loader2, AlertTriangle, Palette, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Work {
  objectId: number;
  title: string;
  artist: string | null;
  artistBio: string | null;
  objectDate: string | null;
  medium: string | null;
  culture: string | null;
  primaryImage: string | null;
  objectUrl: string | null;
  isPublicDomain: boolean;
  department: string | null;
  classification: string | null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface MetMuseumPanelProps {
  domain?: 'art' | 'gallery';
  className?: string;
  onSelect?: (work: Work) => void;
}

export function MetMuseumPanel({ domain = 'art', className, onSelect }: MetMuseumPanelProps) {
  const [query, setQuery] = useState('');
  const [works, setWorks] = useState<Work[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setWorks([]); setTotal(0); return; }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; works?: Work[]; total?: number; reason?: string }>(
      domain, 'live_met_search', { query: q, limit: 18 },
    );
    if (r?.ok) {
      setWorks(r.works || []);
      setTotal(r.total || 0);
    } else {
      setError(r?.reason || 'fetch_failed');
      setWorks([]);
      setTotal(0);
    }
    setLoading(false);
  }, [domain]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(next), 800);
  };

  return (
    <section className={cn('rounded-lg border border-[color:var(--at-rule)] bg-[var(--at-sunk)] overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-[color:var(--at-rule)] bg-[var(--at-gesso)]">
        <Palette className="w-4 h-4 text-[color:var(--at-bad)]" aria-hidden="true" />
        <h3 className="text-sm font-medium text-[color:var(--at-ink)] flex-1">MET Museum · Open Access</h3>
        <span className="text-[10px] text-[color:var(--at-good)] font-mono">REAL data · CC0</span>
        {total > 0 && (
          <span className="text-[10px] text-[color:var(--at-muted)] font-mono">{works.length} / {total}</span>
        )}
      </header>

      <div className="p-3 border-b border-[color:var(--at-rule)] relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--at-muted)]" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search the collection (artist / object / period / culture)…"
          className="w-full pl-8 pr-8 py-1.5 text-xs bg-[var(--at-gesso)] border border-[color:var(--at-rule-2)] rounded text-[color:var(--at-ink)] placeholder:text-[color:var(--at-faint)] focus:outline-none focus:ring-1 focus:ring-[color:var(--at-bad)]"
        />
        {loading && <Loader2 className="absolute right-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-[color:var(--at-muted)]" aria-hidden="true" />}
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-[color:var(--at-bad)]">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />MET unreachable ({error})
        </div>
      )}

      {!error && works.length === 0 && query.trim().length >= 2 && !loading && (
        <div className="px-3 py-6 text-xs text-[color:var(--at-muted)] italic text-center">No works in MET for &ldquo;{query.trim()}&rdquo;.</div>
      )}

      {!error && works.length === 0 && query.trim().length < 2 && (
        <div className="px-3 py-6 text-xs text-[color:var(--at-muted)] italic text-center">Type 2+ characters to search 470,000+ works.</div>
      )}

      {works.length > 0 && (
        <div className="grid grid-cols-2 gap-2 p-3 max-h-[700px] overflow-y-auto">
          {works.map((w) => {
            const inner = (
              <div className="group">
                {w.primaryImage ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- Met Museum serves arbitrary external image hosts; next/image domain allowlist is impractical */
                  <img
                    src={w.primaryImage}
                    alt={w.title}
                    loading="lazy"
                    className="w-full h-32 object-cover rounded border border-[color:var(--at-rule)] group-hover:border-[color:var(--at-bad)] transition-colors"
                  />
                ) : (
                  <div className="w-full h-32 rounded border border-[color:var(--at-rule)] bg-[var(--at-gesso)] flex items-center justify-center text-[color:var(--at-faint)] text-[10px]">
                    No image
                  </div>
                )}
                <div className="mt-1.5">
                  <div className="text-[11px] text-[color:var(--at-ink)] font-medium leading-snug line-clamp-2">{w.title}</div>
                  <div className="text-[10px] text-[color:var(--at-muted)] truncate mt-0.5">
                    {w.artist || w.culture || '—'}{w.objectDate ? ` · ${w.objectDate}` : ''}
                  </div>
                </div>
              </div>
            );
            return onSelect ? (
              <button key={w.objectId} type="button" onClick={() => onSelect(w)} className="text-left">
                {inner}
              </button>
            ) : w.objectUrl ? (
              <a key={w.objectId} href={w.objectUrl} target="_blank" rel="noopener noreferrer" className="text-left block">
                {inner}
                <div className="text-[10px] text-[color:var(--at-muted)] hover:text-[color:var(--at-bad)] mt-0.5 flex items-center gap-0.5">
                  <ExternalLink className="w-2.5 h-2.5" />metmuseum.org
                </div>
              </a>
            ) : (
              <div key={w.objectId}>{inner}</div>
            );
          })}
        </div>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-[color:var(--at-muted)] border-t border-[color:var(--at-rule)]">
        Source: MET Museum Open Access · ~470,000 works · CC0
      </footer>
    </section>
  );
}

export default MetMuseumPanel;
