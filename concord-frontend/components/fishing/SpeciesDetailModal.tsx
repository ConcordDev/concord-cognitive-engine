'use client';

// components/fishing/SpeciesDetailModal.tsx
//
// Species detail — the real, distinct `fishing.get` macro call (not a reuse
// of the already-fetched catalog row). Surfaces the fields the catalog table
// doesn't have room for: description, full ability list, drop table odds,
// and the cooking buff. Honest-by-construction: while the fetch is in
// flight this shows a skeleton, never the (possibly stale) row data passed
// in for the modal title.

import { useEffect, useState } from 'react';
import { Fish } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { ErrorState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { lensRun } from '@/lib/api/client';
import { RARITY_COLORS, type FishSpecies } from './types';

interface SpeciesDetailModalProps {
  fishId: string | null;
  fishName: string | null;
  worldId: string;
  onClose: () => void;
}

export function SpeciesDetailModal({ fishId, fishName, worldId, onClose }: SpeciesDetailModalProps) {
  const [fish, setFish] = useState<FishSpecies | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fishId) { setFish(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFish(null);
    lensRun<{ ok: boolean; fish?: FishSpecies; reason?: string }>('fishing', 'get', { fishId, worldId })
      .then((res) => {
        if (cancelled) return;
        if (res.data.ok && res.data.result?.ok && res.data.result.fish) {
          setFish(res.data.result.fish);
        } else {
          setError(res.data.result?.reason || res.data.error || 'Species lookup failed.');
        }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Species lookup failed.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fishId, worldId]);

  return (
    <Modal isOpen={fishId !== null} onClose={onClose} title={fishName || 'Species'} size="md">
      {loading && (
        <div className="space-y-3 py-1" role="status" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading species detail…</span>
          <Skeleton variant="line" lines={2} />
          <Skeleton variant="block" height="4rem" />
          <Skeleton variant="line" lines={1} width="40%" />
        </div>
      )}

      {!loading && error && <ErrorState message={error} variant="inline" />}

      {!loading && !error && fish && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Fish className="h-5 w-5 text-cyan-300" aria-hidden="true" />
              <div>
                <div className="text-base font-semibold text-white">{fish.name}</div>
                <div className={cn(ds.textMuted, 'capitalize')}>{fish.subBiome || fish.biome || 'unknown waters'}</div>
              </div>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium capitalize',
                RARITY_COLORS[fish.rarity] || 'text-zinc-400 bg-zinc-800 border-zinc-700',
              )}
            >
              {fish.rarity}
            </span>
          </div>

          {fish.description && <p className={cn(ds.textBody, 'text-sm')}>{fish.description}</p>}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className={ds.textMuted}>Mass</dt>
              <dd className="font-mono text-gray-200">{fish.mass != null ? `${fish.mass} kg` : 'unknown'}</dd>
            </div>
            <div>
              <dt className={ds.textMuted}>Behaviors</dt>
              <dd className="text-gray-200">{(fish.abilities || []).join(', ') || 'none authored'}</dd>
            </div>
          </dl>

          {fish.dropTable && Object.keys(fish.dropTable).length > 0 && (
            <div>
              <div className={cn(ds.textMuted, 'mb-1')}>Drop table</div>
              <ul className="space-y-1">
                {Object.entries(fish.dropTable).map(([itemId, chance]) => (
                  <li key={itemId} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">{itemId.replace(/_/g, ' ')}</span>
                    <span className="font-mono tabular-nums text-gray-400">{Math.round(chance * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fish.buffOnCook && Object.keys(fish.buffOnCook).length > 0 && (
            <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-300">Cooking buff</div>
              <ul className="space-y-0.5 text-sm text-emerald-100">
                {Object.entries(fish.buffOnCook).map(([k, v]) => (
                  <li key={k}>
                    {k.replace(/_/g, ' ')}: <span className="font-mono">{String(v)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
