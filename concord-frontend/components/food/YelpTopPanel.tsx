'use client';

/**
 * YelpTopPanel — Bayesian-ranked top restaurants (Yelp Top-100 shape).
 */

import { useEffect, useState } from 'react';
import { Trophy, Star } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { SkeletonTableRows } from '@/components/ui';

interface Ranked {
  id: string; rank: number; name: string; cuisine: string; priceTier: number;
  neighborhood: string | null; rating: number; reviewCount: number; rankScore: number;
}

const priceLabel = (t: number) => '$'.repeat(Math.max(1, Math.min(4, t)));

export function YelpTopPanel() {
  const [rows, setRows] = useState<Ranked[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const r = await lensRun('food', 'top-restaurants', { limit: 50 });
      setRows(r.data?.ok === false ? [] : (r.data?.result?.restaurants || []));
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="rounded-xl border border-lattice-border bg-lattice-surface/70"><SkeletonTableRows rows={5} columns={3} /></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="text-center text-gray-400 text-sm italic py-10 border border-lattice-border rounded-xl">
        No ranked restaurants yet. Reviews drive the ranking — add reviews in Discover.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-400">
        Ranked by a Bayesian score that weights rating against review volume — high marks on a single
        review do not outrank a consistently strong restaurant.
      </p>
      <ol className="space-y-2">
        {rows.map((b) => (
          <li key={b.id} className="flex items-center gap-3 bg-lattice-surface/70 border border-lattice-border rounded-xl p-3">
            <span className={cn('flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 tabular-nums',
              b.rank === 1 ? 'bg-amber-500/20 text-amber-300'
              : b.rank <= 3 ? 'bg-lattice-border/40 text-gray-200' : 'bg-lattice-elevated text-gray-400')}>
              {b.rank}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {b.rank === 1 && <Trophy className="inline w-3.5 h-3.5 text-amber-400 mr-1" />}
                {b.name}
              </p>
              <p className="text-[11px] text-gray-400 capitalize">
                {b.cuisine} · {priceLabel(b.priceTier)}{b.neighborhood ? ` · ${b.neighborhood}` : ''}
              </p>
            </div>
            <div className="text-right shrink-0 tabular-nums">
              <span className="flex items-center gap-1 text-xs text-gray-200">
                <Star className="w-3 h-3 text-amber-400 fill-amber-400" />{b.rating}
              </span>
              <span className="text-[10px] text-gray-400">{b.reviewCount} reviews</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
