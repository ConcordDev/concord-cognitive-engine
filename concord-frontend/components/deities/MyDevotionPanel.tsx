'use client';

/**
 * MyDevotionPanel — per-player devotion tracking across the whole pantheon.
 * Wires deity.my_devotion + deity.my_blessings. Shows the player's patron
 * count, total pilgrimages, devotion per deity, and every granted blessing.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface DevotionEntry {
  deityId: string;
  deityName: string;
  pilgrimages: number;
  devotionScore: number;
  communeCount: number;
  alignment: number;
  lastAt: number;
  blessingsClaimed: number;
}
interface DevotionResult {
  devotions: DevotionEntry[];
  patronCount: number;
  totalPilgrimages: number;
  topPatron: DevotionEntry | null;
}
interface BoonEffect { stat: string; axis: string; magnitude: number }
interface Blessing {
  id: string;
  deityName: string;
  tierLabel: string;
  effect: BoonEffect;
  grantedAt: number;
}

export function MyDevotionPanel({
  refreshKey,
  onPickDeity,
}: {
  refreshKey: number;
  onPickDeity: (deityId: string) => void;
}) {
  const [devotion, setDevotion] = useState<DevotionResult | null>(null);
  const [blessings, setBlessings] = useState<Blessing[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, b] = await Promise.all([
      lensRun<DevotionResult>('deity', 'my_devotion', {}),
      lensRun<{ blessings: Blessing[] }>('deity', 'my_blessings', {}),
    ]);
    if (d.data.ok && d.data.result) setDevotion(d.data.result);
    if (b.data.ok && b.data.result) setBlessings(b.data.result.blessings || []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return <div role="status" aria-live="polite" aria-busy="true" className="text-xs text-zinc-400 italic">Loading devotion…</div>;
  if (!devotion || devotion.patronCount === 0) {
    return <p className="text-xs italic text-zinc-400">No patron deities yet. Make a pilgrimage to begin.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-center">
          <div className="text-xl font-bold text-purple-300">{devotion.patronCount}</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">patrons</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-center">
          <div className="text-xl font-bold text-purple-300">{devotion.totalPilgrimages}</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">pilgrimages</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-center">
          <div className="text-xl font-bold text-amber-300">{blessings.length}</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">blessings</div>
        </div>
      </div>

      {devotion.topPatron && (
        <p className="text-xs text-zinc-400">
          Top patron: <span className="font-medium text-purple-300">{devotion.topPatron.deityName}</span>
          {' '}({devotion.topPatron.devotionScore.toFixed(1)} devotion)
        </p>
      )}

      <ul className="space-y-2">
        {devotion.devotions.map((e) => (
          <li key={e.deityId}>
            <button
              type="button"
              onClick={() => onPickDeity(e.deityId)}
              className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-left hover:border-purple-700/50"
            >
              <div>
                <p className="text-sm font-medium text-zinc-100">{e.deityName}</p>
                <p className="text-[10px] text-zinc-400">
                  {e.pilgrimages} pilgrimages · {e.communeCount} communes · {e.blessingsClaimed} blessings
                </p>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-emerald-300">{e.alignment.toFixed(2)}</div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">alignment</div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {blessings.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-bold text-zinc-300">Granted blessings</h4>
          <ul className="space-y-1">
            {blessings.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded border border-emerald-700/30 bg-emerald-500/5 px-2.5 py-1.5 text-[11px]">
                <span className="text-emerald-100">{b.tierLabel} <span className="text-zinc-400">· {b.deityName}</span></span>
                <span className="font-mono text-emerald-300">+{b.effect.magnitude} {b.effect.stat}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
