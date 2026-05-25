'use client';

/**
 * ProvenanceTrail — walks the citation graph upstream from a leaf DTU,
 * renders the trail as a vertical timeline with lens-of-origin chips.
 *
 * Phase 7 of the UX completeness sprint. Drop-in for any DTU detail
 * view where the reader benefits from seeing "where did this idea
 * come from?". Reads from dtu_surface.provenance_trail.
 *
 * No fake data — if the underlying DTU graph has no parents, the
 * component renders a single-node trail (just the leaf).
 */

import { useEffect, useState } from 'react';
import { GitMerge, Loader2, AlertTriangle, ChevronUp, Eye } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TrailNode {
  depth: number;
  dtuId: string;
  title: string | null;
  sourceLens: string | null;
  creatorId: string | null;
  kind: string | null;
  totalSurfaces: number;
}

async function runMacro<T>(name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'dtu_surface', name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface ProvenanceTrailProps {
  /** Leaf DTU id — the trail walks upstream from here. */
  dtuId: string;
  /** Max ancestor depth. Default 6. */
  maxDepth?: number;
  className?: string;
}

export function ProvenanceTrail({ dtuId, maxDepth = 6, className }: ProvenanceTrailProps) {
  const [trail, setTrail] = useState<TrailNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await runMacro<{ ok: boolean; trail?: TrailNode[]; reason?: string }>('provenance_trail', { dtuId, maxDepth });
      if (cancelled) return;
      if (r?.ok) {
        setTrail(r.trail || []);
        setError(null);
      } else setError(r?.reason || 'fetch_failed');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [dtuId, maxDepth]);

  if (loading) {
    return (
      <div className={cn('rounded border border-zinc-800 bg-zinc-950/80 p-3 text-xs text-zinc-400 flex items-center gap-2', className)}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Tracing provenance...
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('rounded border border-zinc-800 bg-zinc-950/80 p-3 text-xs text-rose-300/80', className)}>
        <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Provenance unavailable ({error})
      </div>
    );
  }

  if (trail.length === 0) {
    return (
      <div className={cn('rounded border border-zinc-800 bg-zinc-950/80 p-3 text-xs text-zinc-400 italic', className)}>
        No provenance trail.
      </div>
    );
  }

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <GitMerge className="w-4 h-4 text-amber-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">
          Provenance trail
          <span className="ml-2 text-[10px] text-zinc-400 font-mono">{trail.length} node{trail.length === 1 ? '' : 's'}</span>
        </h3>
      </header>

      <ol className="p-3 space-y-2">
        {trail.map((node, i) => (
          <li key={`${node.dtuId}-${i}`} className="flex items-start gap-2">
            <div className="flex flex-col items-center shrink-0 pt-0.5">
              <div className={cn(
                'w-2 h-2 rounded-full',
                node.depth === 0 ? 'bg-amber-400' : 'bg-zinc-600',
              )} />
              {i < trail.length - 1 && <div className="w-px flex-1 bg-zinc-800 mt-1" style={{ minHeight: 24 }} />}
            </div>
            <div className="flex-1 min-w-0 pb-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-zinc-200 font-medium truncate">
                  {node.title || `Untitled DTU`}
                </span>
                {node.depth === 0 && (
                  <span className="text-[10px] text-amber-400 font-mono uppercase">leaf</span>
                )}
                {node.depth > 0 && (
                  <span className="text-[10px] text-zinc-400 font-mono">+{node.depth}</span>
                )}
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5 flex items-center gap-2 flex-wrap">
                {node.sourceLens && (
                  <Link
                    href={`/lenses/${node.sourceLens}`}
                    className="text-zinc-400 hover:text-amber-300 underline-offset-2 hover:underline"
                  >
                    {node.sourceLens}
                  </Link>
                )}
                {node.kind && <span className="font-mono">· {node.kind}</span>}
                {node.creatorId && <span>· @{node.creatorId.slice(0, 8)}</span>}
                {node.totalSurfaces > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-emerald-400">
                    <Eye className="w-2.5 h-2.5" /> {node.totalSurfaces}
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {trail.length > 1 && (
        <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40 flex items-center gap-1">
          <ChevronUp className="w-3 h-3" />
          Latest at top · oldest ancestor at bottom
        </footer>
      )}
    </section>
  );
}

export default ProvenanceTrail;
