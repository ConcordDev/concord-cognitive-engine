'use client';

/**
 * FreshnessBadge — Time-based freshness indicator for DTUs.
 *
 * Shows a colored dot based on how recently a DTU was updated:
 *   - Green dot:  updated within 7 days
 *   - Yellow dot: 7-30 days old
 *   - Red dot:    30+ days old (stale)
 *
 * Shows "Last updated X ago" on hover via title attribute.
 *
 * Usage:
 *   <FreshnessBadge updatedAt={dtu.updatedAt} />
 *   <FreshnessBadge updatedAt={dtu.updatedAt} showLabel />
 */

import { cn } from '@/lib/utils';

interface FreshnessBadgeProps {
  /** ISO date string of the last update */
  updatedAt: string | undefined | null;
  /** Also show text label */
  showLabel?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function getAgeDays(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return Math.max(0, ageMs / (1000 * 60 * 60 * 24));
}

function formatTimeAgo(updatedAt: string): string {
  const ageDays = getAgeDays(updatedAt);
  if (ageDays < 1) {
    const hours = Math.floor(ageDays * 24);
    if (hours < 1) return 'just now';
    return `${hours}h ago`;
  }
  if (ageDays < 7) return `${Math.floor(ageDays)}d ago`;
  if (ageDays < 30) return `${Math.floor(ageDays / 7)}w ago`;
  if (ageDays < 365) return `${Math.floor(ageDays / 30)}mo ago`;
  return `${Math.floor(ageDays / 365)}y ago`;
}

function freshnessLevel(ageDays: number): { color: string; label: string; dotColor: string } {
  if (ageDays <= 7) return { color: 'text-green-400', label: 'Fresh', dotColor: 'bg-green-400' };
  if (ageDays <= 30) return { color: 'text-yellow-400', label: 'Aging', dotColor: 'bg-yellow-400' };
  return { color: 'text-red-400', label: 'Stale', dotColor: 'bg-red-400' };
}

export function FreshnessBadge({
  updatedAt,
  showLabel = false,
  size = 'sm',
  className,
}: FreshnessBadgeProps) {
  if (!updatedAt) return null;

  const ageDays = getAgeDays(updatedAt);
  const { color, label, dotColor } = freshnessLevel(ageDays);
  const timeAgo = formatTimeAgo(updatedAt);

  const dotSize = size === 'lg' ? 'w-3 h-3' : size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2';
  const textSize = size === 'lg' ? 'text-sm' : size === 'md' ? 'text-xs' : 'text-[11px]';

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={`Last updated ${timeAgo} (${label})`}
    >
      <span className={cn(dotSize, 'rounded-full', dotColor)} />
      {showLabel && <span className={cn(textSize, color)}>{timeAgo}</span>}
    </span>
  );
}
