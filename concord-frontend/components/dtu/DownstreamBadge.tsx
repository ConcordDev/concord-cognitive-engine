'use client';

/**
 * DownstreamBadge — small chip showing where else a DTU has been
 * surfaced. Drop-in next to any DTU card / quote / citation.
 *
 * Phase 7 of the UX completeness sprint. Reads from
 * dtu_surface.where_used. Hides itself when the DTU hasn't been
 * surfaced anywhere else (no fake "0 uses" badge).
 */

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SurfaceRow {
  lensId: string;
  kind: string;
  count: number;
  firstSurfacedAt: number;
  lastSurfacedAt: number;
}

async function runMacro<T>(name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'dtu_surface', name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface DownstreamBadgeProps {
  dtuId: string;
  /** How many days of surface history to consider. Default 30. */
  sinceDays?: number;
  /** Hide entirely when totalSurfaces is 0. Default true. */
  hideWhenEmpty?: boolean;
  /** Don't render the lens-count tooltip. Default false. */
  compact?: boolean;
  className?: string;
}

export function DownstreamBadge({ dtuId, sinceDays = 30, hideWhenEmpty = true, compact = false, className }: DownstreamBadgeProps) {
  const [surfaces, setSurfaces] = useState<SurfaceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await runMacro<{ ok: boolean; surfaces?: SurfaceRow[]; totalSurfaces?: number }>('where_used', { dtuId, sinceDays });
      if (cancelled) return;
      if (r?.ok) {
        setSurfaces(r.surfaces || []);
        setTotal(r.totalSurfaces || 0);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [dtuId, sinceDays]);

  if (loading) return null;
  if (total === 0 && hideWhenEmpty) return null;

  // Distinct lens count for the chip body.
  const lensSet = new Set(surfaces.map(s => s.lensId));
  const distinctLenses = lensSet.size;

  return (
    <div className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-zinc-900/60 border border-zinc-800 text-zinc-400', className)}>
      <Eye className="w-2.5 h-2.5 text-emerald-400" aria-hidden="true" />
      <span className="font-mono">{total}</span>
      {!compact && (
        <span className="text-zinc-400">
          in {distinctLenses} lens{distinctLenses === 1 ? '' : 'es'}
        </span>
      )}
      {!compact && distinctLenses > 0 && distinctLenses <= 3 && (
        <span className="text-zinc-400">·</span>
      )}
      {!compact && [...lensSet].slice(0, 3).map((lensId, i) => (
        <Link
          key={lensId}
          href={`/lenses/${lensId}`}
          className="text-zinc-400 hover:text-emerald-300 underline-offset-2 hover:underline"
        >
          {lensId}{i < Math.min(distinctLenses, 3) - 1 ? ',' : ''}
        </Link>
      ))}
    </div>
  );
}

export default DownstreamBadge;
