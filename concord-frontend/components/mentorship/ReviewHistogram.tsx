'use client';

/**
 * ReviewHistogram — star-rating breakdown for a mentor, sourced from the
 * real `mentorship.review-list` macro's `histogram` field
 * (`[{star, count}, ...]` for star 1-5, plus `avgRating`/`count`). No
 * client-side computation of the distribution — the counts render exactly
 * what the backend returns, including the honest zero-review state.
 */

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReviewHistogramBucket {
  star: number;
  count: number;
}

interface ReviewHistogramProps {
  histogram: ReviewHistogramBucket[];
  avgRating: number;
  count: number;
  className?: string;
}

export function ReviewHistogram({ histogram, avgRating, count, className }: ReviewHistogramProps) {
  const maxCount = Math.max(1, ...histogram.map((b) => b.count));
  // Render top-down 5★ -> 1★ regardless of the array's own order.
  const byStar = new Map(histogram.map((b) => [b.star, b.count]));
  const rows = [5, 4, 3, 2, 1].map((star) => ({ star, count: byStar.get(star) || 0 }));

  return (
    <div className={cn('rounded-md border border-zinc-800 bg-zinc-950/40 p-3 space-y-2', className)} data-testid="review-histogram">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          Rating breakdown
        </div>
        <span className="text-[11px] text-zinc-400">
          {count > 0 ? (
            <>
              <span className="font-mono text-amber-300">{avgRating.toFixed(1)}</span> avg · {count} rating{count === 1 ? '' : 's'}
            </>
          ) : (
            'No ratings yet'
          )}
        </span>
      </div>
      <div className="space-y-1">
        {rows.map(({ star, count: c }) => {
          const pct = count > 0 ? Math.round((c / count) * 100) : 0;
          const barPct = count > 0 ? Math.round((c / maxCount) * 100) : 0;
          return (
            <div key={star} className="flex items-center gap-2 text-[11px]" data-testid={`histogram-row-${star}`}>
              <span className="w-8 shrink-0 font-mono text-zinc-400 flex items-center gap-0.5">
                {star}<Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
              </span>
              <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={cn('h-full rounded-full', c > 0 ? 'bg-amber-400/70' : 'bg-transparent')}
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right font-mono text-zinc-400">
                {c} <span className="text-zinc-600">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
