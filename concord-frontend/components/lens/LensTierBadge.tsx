'use client';

/**
 * LensTierBadge — implementation-tier chip (DEEP/MODERATE/THIN/SCAFFOLD).
 *
 * Distinct from DepthBadge (data tier: live/free/sim/demo). DepthBadge says
 * "is this data real?". LensTierBadge says "is the implementation here?".
 *
 * Reads `tier` from the lens manifest. Renders nothing unless the lens is
 * marked SCAFFOLD — DEEP / MODERATE / THIN ship without a badge so the
 * surface looks clean to anyone evaluating the platform. SCAFFOLD lenses
 * carry an amber "Experimental" chip so they're truthfully labelled.
 */

import { Sparkles } from 'lucide-react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { cn } from '@/lib/utils';

export interface LensTierBadgeProps {
  lensId: string;
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_CLASS = {
  sm: 'text-[10px] px-1.5 py-0.5 gap-1',
  md: 'text-xs px-2 py-0.5 gap-1.5',
} as const;

const ICON_SIZE = {
  sm: 'w-2.5 h-2.5',
  md: 'w-3 h-3',
} as const;

export function LensTierBadge({ lensId, size = 'md', className }: LensTierBadgeProps) {
  const manifest = getLensManifest(lensId);
  if (!manifest || manifest.tier !== 'SCAFFOLD') return null;
  return (
    <span
      data-testid="lens-tier-badge"
      data-tier="SCAFFOLD"
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        'bg-amber-950/60 text-amber-200 border-amber-500/40',
        SIZE_CLASS[size],
        className,
      )}
      title="UI only — backend not yet wired. This lens is a scaffold and may not persist or compute against the substrate."
      aria-label="Experimental lens: UI only, backend not yet wired"
    >
      <Sparkles className={ICON_SIZE[size]} aria-hidden="true" />
      Experimental
    </span>
  );
}

export default LensTierBadge;
