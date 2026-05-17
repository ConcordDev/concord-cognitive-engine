'use client';

// CitationChips — renders DTU references the conscious brain cited in
// its response as clickable chips. The backend extracts these from the
// final reply via regex (looking for [dtu-…] / DTU id … patterns) and
// surfaces them on the response payload as `dtuRefs`. The brain itself
// only mentions DTUs surgically (per the prompt-registry rule —
// "citations are surgical, not decorative") so this surface stays
// focused: a tight strip of chips below the message, only when at
// least one DTU was actually grounded a claim.
//
// Click → fires the existing /lenses/atlas?dtu=… deep link convention.
//
// Phase 7 — every chip mount fires dtu_surface.record so the cross-lens
// narrative substrate populates as the brain cites DTUs in chat.

import { useEffect, useRef } from 'react';
import { Link2 } from 'lucide-react';
import Link from 'next/link';
import { useDtuSurface } from '@/hooks/useDtuSurface';

interface CitationChipsProps {
  dtuRefs: Array<{ id: string; title: string | null; tier: string | null }> | undefined | null;
  /** Lens this chip strip appears in. Default 'chat'. */
  surfaceFromLens?: string;
}

const TIER_COLOR: Record<string, string> = {
  hyper:   'border-fuchsia-400/30 text-fuchsia-300 bg-fuchsia-500/10 hover:bg-fuchsia-500/15',
  mega:    'border-amber-400/30 text-amber-300 bg-amber-500/10 hover:bg-amber-500/15',
  regular: 'border-cyan-400/30 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/15',
};

export default function CitationChips({ dtuRefs, surfaceFromLens = 'chat' }: CitationChipsProps) {
  const { record } = useDtuSurface();
  const recordedRef = useRef<Set<string>>(new Set());

  // Fire-and-forget surface record for each unique DTU id we render.
  // De-dup via ref so re-renders don't double-record. No effect on
  // user; populates dtu_surface_log → DownstreamBadge counts.
  useEffect(() => {
    if (!dtuRefs || dtuRefs.length === 0) return;
    for (const ref of dtuRefs) {
      if (!ref.id || recordedRef.current.has(ref.id)) continue;
      recordedRef.current.add(ref.id);
      void record({
        dtuId: ref.id,
        lensId: surfaceFromLens,
        surfaceKind: 'citation_chip',
        meta: { tier: ref.tier },
      });
    }
  }, [dtuRefs, surfaceFromLens, record]);

  if (!dtuRefs || dtuRefs.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1">Sources:</span>
      {dtuRefs.map((ref) => {
        const colorCls = TIER_COLOR[ref.tier || 'regular'] || TIER_COLOR.regular;
        const label = ref.title || ref.id;
        return (
          <Link
            key={ref.id}
            href={`/lenses/atlas?dtu=${encodeURIComponent(ref.id)}`}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors ${colorCls}`}
            title={`${ref.id}${ref.title ? ` — ${ref.title}` : ''}`}
          >
            <Link2 className="w-2.5 h-2.5" />
            <span className="truncate max-w-[18ch]">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
