'use client';

/**
 * CategoryProgress — per-category completion bars.
 *
 * Pure presentational: the caller computes { category, earned, total }
 * from the real catalog + earned set (no fetching, no fabricated
 * percentages — a category with 0 achievements simply isn't rendered).
 */

import { cn } from '@/lib/utils';

export interface CategoryProgressRow {
  category: string;
  earned: number;
  total: number;
}

export function CategoryProgress({ rows, className }: { rows: CategoryProgressRow[]; className?: string }) {
  const visible = rows.filter((r) => r.total > 0);
  if (visible.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="list" aria-label="Completion by category">
      {visible.map((r) => {
        const pct = r.total > 0 ? Math.round((r.earned / r.total) * 100) : 0;
        const complete = r.earned === r.total;
        return (
          <div
            key={r.category}
            role="listitem"
            className="flex min-w-[110px] flex-1 items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-2.5 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate text-[10px] font-medium capitalize text-slate-300">{r.category}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-400">
                  {r.earned}/{r.total}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', complete ? 'bg-emerald-400' : 'bg-fuchsia-400/70')}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
