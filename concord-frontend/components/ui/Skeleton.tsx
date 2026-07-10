'use client';

/**
 * Skeleton — loading-state primitive for perceived-performance work.
 *
 * Four variants: `line` (text placeholder, supports multi-line), `block`
 * (rectangular placeholder for cards/media/charts), `avatar` (circular),
 * and `table-row` (a horizontal strip of cells matching `DataTable`
 * density — pair with `SkeletonTableRows` to fill a loading table body).
 *
 * This is distinct from `components/common/Skeleton.tsx`, which ships a
 * set of app-specific *composed* skeletons (SkeletonCard, SkeletonDTU,
 * SkeletonChat, ...) built on framer-motion. This one is the lower-level,
 * dependency-free primitive those could be rebuilt on top of — kept here
 * so `components/ui` has no framer-motion requirement.
 *
 * Pure presentational — no fetching, no timers.
 */

import React from 'react';
import { cn } from '@/lib/utils';

export type SkeletonVariant = 'line' | 'block' | 'avatar' | 'table-row';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  /** `table-row` only: number of cells to render. */
  columns?: number;
  /** `line` only: render multiple lines; the last line is shorter. */
  lines?: number;
  className?: string;
}

// design-system.ts doesn't yet carry a dedicated skeleton/shimmer token —
// falling back to the lattice border tone used by components/common/Skeleton.tsx.
// TODO: migrate to `ds.skeleton` once the design-system agent lands one.
const SKELETON_BASE = 'animate-pulse bg-lattice-border/50';

function srStatus(label: string) {
  return (
    <span role="status" aria-busy="true" className="sr-only">
      {label}
    </span>
  );
}

export function Skeleton({ variant = 'line', width, height, columns = 4, lines = 1, className }: SkeletonProps) {
  if (variant === 'avatar') {
    const size = width ?? height ?? 36;
    return (
      <span
        className={cn(SKELETON_BASE, 'inline-flex shrink-0 rounded-full', className)}
        style={{ width: size, height: size }}
      >
        {srStatus('Loading')}
      </span>
    );
  }

  if (variant === 'block') {
    return (
      <div className={cn(SKELETON_BASE, 'rounded-lg', className)} style={{ width: width ?? '100%', height: height ?? '6rem' }}>
        {srStatus('Loading')}
      </div>
    );
  }

  if (variant === 'table-row') {
    return (
      <div className={cn('flex items-center gap-4 px-3 py-2.5', className)}>
        {srStatus('Loading row')}
        {Array.from({ length: columns }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={cn(SKELETON_BASE, 'h-3.5 rounded flex-1')}
            style={i === 0 ? { flex: '0 0 20%' } : undefined}
          />
        ))}
      </div>
    );
  }

  // 'line'
  if (lines > 1) {
    return (
      <div className={cn('space-y-2', className)}>
        {srStatus('Loading')}
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={cn(SKELETON_BASE, 'rounded')}
            style={{ width: i === lines - 1 ? '60%' : width ?? '100%', height: height ?? '0.875rem' }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn(SKELETON_BASE, 'rounded', className)} style={{ width: width ?? '100%', height: height ?? '0.875rem' }}>
      {srStatus('Loading')}
    </div>
  );
}

/** Fills a table body with `rows` loading strips of `columns` cells each. */
export function SkeletonTableRows({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('divide-y divide-lattice-border/50', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="table-row" columns={columns} />
      ))}
    </div>
  );
}
