'use client';

// Phase G2 — DemoBadge.
//
// Shared component. Any lens that wants to surface demo seed content
// (DTUs with creator_id='system') renders this badge next to the
// item so the player sees "DEMO" rather than mistaking it for live
// user-generated content.
//
// Usage:
//   <DemoBadge />          // generic
//   <DemoBadge size="sm" /> // small, for inline lists

import { Sparkles } from 'lucide-react';

interface Props {
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'text-[8px] px-1 py-0.5 gap-0.5',
  md: 'text-[10px] px-1.5 py-0.5 gap-1',
};

const ICON_SIZE = { sm: 8, md: 10 };

export function DemoBadge({ size = 'md', className = '' }: Props) {
  return (
    <span
      className={[
        'inline-flex items-center rounded border border-amber-500/40 bg-amber-950/40 font-semibold uppercase tracking-wider text-amber-200',
        SIZE_CLASSES[size],
        className,
      ].join(' ')}
      title="Seeded demo content — visible to all players, not user-attributed"
    >
      <Sparkles size={ICON_SIZE[size]} /> DEMO
    </span>
  );
}

/**
 * Helper for lenses to detect whether a DTU is demo content.
 * The seeder writes demo DTUs with creator_id='system'.
 */
export function isDemoItem(item: { creator_id?: string } | { creatorId?: string } | null | undefined): boolean {
  if (!item) return false;
  if ('creator_id' in item && item.creator_id === 'system') return true;
  if ('creatorId' in item && item.creatorId === 'system') return true;
  return false;
}
