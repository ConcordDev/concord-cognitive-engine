'use client';

// components/fishing/CatchLog.tsx
//
// The player's real catch history — `fishing.catches`, which reads
// `player_inventory WHERE item_type='raw_fish'`. Every row is a real minted
// inventory item from a completed reel, not a synthetic log.

import { Trophy } from 'lucide-react';
import { DataTable, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { formatRelativeTime } from '@/lib/utils';
import { QUALITY_TIER_COLORS, parseCatchMeta, qualityTier, type CatchRow } from './types';

interface CatchLogProps {
  catches: CatchRow[];
  loading: boolean;
  /** Honest reason the log couldn't load (e.g. "no_user") — null when fine. */
  reason: string | null;
  onRetry: () => void;
  /** Row id that was just minted this session — gets a brief highlight. */
  justCaughtId: string | null;
  density: 'compact' | 'comfortable';
}

export function CatchLog({ catches, loading, reason, onRetry, justCaughtId, density }: CatchLogProps) {
  const columns: DataTableColumn<CatchRow>[] = [
    {
      id: 'fish',
      header: 'Catch',
      accessor: (c) => <span className="text-gray-100">{c.item_name || c.item_id}</span>,
      sortValue: (c) => c.item_name || c.item_id,
      sortable: true,
    },
    {
      id: 'quality',
      header: 'Quality',
      accessor: (c) => {
        const meta = parseCatchMeta(c);
        if (meta.qualityScore == null) return <span className="text-gray-600">—</span>;
        const tier = qualityTier(meta.qualityScore);
        return (
          <span
            className={cn(
              'inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize',
              QUALITY_TIER_COLORS[tier],
            )}
          >
            {tier} · {Math.round(meta.qualityScore * 100)}%
          </span>
        );
      },
      sortValue: (c) => parseCatchMeta(c).qualityScore ?? 0,
      sortable: true,
    },
    {
      id: 'world',
      header: 'World',
      accessor: (c) => <span className="text-gray-400">{c.world_id}</span>,
      sortValue: (c) => c.world_id,
      sortable: true,
    },
    {
      id: 'when',
      header: 'Caught',
      accessor: (c) => (
        <span className="text-gray-400" title={new Date(c.acquired_at * 1000).toLocaleString()}>
          {formatRelativeTime(c.acquired_at * 1000)}
        </span>
      ),
      sortValue: (c) => c.acquired_at,
      sortable: true,
      align: 'right',
      monospace: true,
    },
  ];

  return (
    <section className={ds.panel} aria-label="Catch log">
      <div className={cn(ds.sectionHeader, 'mb-3')}>
        <h2 className={cn(ds.heading3, 'flex items-center gap-1.5')}>
          <Trophy className="h-4 w-4 text-amber-300" aria-hidden="true" /> Catch log
        </h2>
        <span className={ds.textMuted}>{loading ? 'Loading…' : `${catches.length} logged`}</span>
      </div>

      {loading && (
        <div className="space-y-1" aria-hidden="true">
          <Skeleton variant="table-row" columns={4} />
          <Skeleton variant="table-row" columns={4} />
        </div>
      )}

      {!loading && reason && (
        <ErrorState
          message={
            reason === 'no_user'
              ? 'Sign in to track your catch log.'
              : `Couldn't load your catch log (${reason}).`
          }
          onRetry={onRetry}
          variant="inline"
        />
      )}

      {!loading && !reason && catches.length === 0 && (
        <EmptyState
          icon={<Trophy className="h-5 w-5" aria-hidden="true" />}
          title="No catches yet."
          description="Cast a line to start your log — every landed fish is minted into your inventory as raw_fish."
          compact
        />
      )}

      {!loading && !reason && catches.length > 0 && (
        <DataTable
          columns={columns}
          rows={catches}
          getRowId={(c) => c.id}
          defaultSort={{ columnId: 'when', direction: 'desc' }}
          density={density}
          caption="Recent catches"
          selectedRowId={justCaughtId}
        />
      )}
    </section>
  );
}
